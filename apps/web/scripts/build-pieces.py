"""
Builds the service pieces of the AEGIS scale model and exports them as GLB.

    blender --background --python apps/web/scripts/build-pieces.py
    blender --background --python apps/web/scripts/build-pieces.py -- --preview sheet.png

Written for and run with Blender 5.2 LTS; the API it uses dates from 4.2, but
no older version has been tried. Writes `apps/web/src/graphics/pieces.glb`,
which the web client loads at start-up (`src/graphics/pieces.ts`). The
`--preview` option renders a contact sheet of the set with the client's own
shading, to judge a change before exporting it.

The pieces are modelled here, in code, so the asset is reproducible and its
decisions can be read: every service type is a turned or milled block with
one chamfer size, standing on z = 0 and fitting a radius of about one unit.

Each piece is one object named after its service type. It carries:

  * three materials, `aegis-body`, `aegis-detail` and `aegis-mark`, which the
    client reads as the part of the piece a face belongs to. The colours in
    the file are the light theme's; the client applies its own.
  * a colour attribute, `ao`, exported as COLOR_0: ambient occlusion per
    vertex, computed below by casting rays against the piece and the plate
    it stands on. It is what makes a matte piece read as a solid object
    under the scene's single light. It needs no render engine, so the build
    runs the same in any Blender.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

BODY, DETAIL, MARK = 0, 1, 2
PART_NAMES = ("aegis-body", "aegis-detail", "aegis-mark")
# The light theme's piece colours, for anyone opening the file in a viewer.
PART_COLORS = ((0.115, 0.130, 0.147), (0.171, 0.194, 0.220), (0.896, 0.905, 0.887))

TAU = math.tau
CHAMFER = 0.035
# Edges that bend more than this are drawn crisp; gentler ones are smoothed.
SHARP_ANGLE = math.radians(38)
AO_SAMPLES = 96
AO_REACH = 1.1
COLLECTION_NAME = "AEGIS pieces"

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
DEFAULT_OUTPUT = os.path.normpath(os.path.join(HERE, "..", "src", "graphics", "pieces.glb"))


# -----------------------------------------------------------------------------
# Modelling helpers
# -----------------------------------------------------------------------------


def arc(cx, cy, radius, start, end, steps):
    """Points on a circle from angle `start` to `end` (degrees), inclusive."""
    return [
        (
            cx + radius * math.cos(math.radians(start + (end - start) * k / steps)),
            cy + radius * math.sin(math.radians(start + (end - start) * k / steps)),
        )
        for k in range(steps + 1)
    ]


def polygon(sides, radius, phase=0.0):
    return [
        (radius * math.cos(phase + TAU * k / sides), radius * math.sin(phase + TAU * k / sides))
        for k in range(sides)
    ]


def rect(width, depth, cx=0.0, cy=0.0):
    w, d = width / 2, depth / 2
    return [(cx - w, cy - d), (cx + w, cy - d), (cx + w, cy + d), (cx - w, cy + d)]


def quadratic(a, c, b, steps):
    """Samples of the quadratic curve a → c → b, without its first point."""
    points = []
    for k in range(1, steps + 1):
        t = k / steps
        u = 1 - t
        points.append(
            (
                a[0] * u * u + c[0] * 2 * u * t + b[0] * t * t,
                a[1] * u * u + c[1] * 2 * u * t + b[1] * t * t,
            )
        )
    return points


# A profile drawn in the XZ plane is extruded along Y by standing a prism up.
UPRIGHT = Matrix.Rotation(math.radians(90), 4, "X")


class Piece:
    """One service piece, assembled from closed solids tagged with a part."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()

    def _commit(self, bm, part, matrix=None, flat=False):
        if matrix is not None:
            bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts[:])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        for face in bm.faces:
            face.material_index = part
            face.smooth = True
        if flat:
            for edge in bm.edges:
                edge.smooth = False
        mesh = bpy.data.meshes.new("aegis-part")
        bm.to_mesh(mesh)
        bm.free()
        self.bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)

    def lathe(self, profile, part, segments=40, closed=False, matrix=None, flat=False):
        """Revolves `profile`, a list of (radius, z), around the Z axis.

        A point with radius 0 becomes a pole, so a profile that starts and
        ends on the axis makes a closed solid; `closed` joins the last point
        back to the first, for rings.
        """
        bm = bmesh.new()
        rings = []
        for radius, z in profile:
            if radius < 1e-6:
                rings.append([bm.verts.new((0.0, 0.0, z))])
            else:
                rings.append(
                    [
                        bm.verts.new(
                            (
                                radius * math.cos(TAU * k / segments),
                                radius * math.sin(TAU * k / segments),
                                z,
                            )
                        )
                        for k in range(segments)
                    ]
                )
        pairs = list(zip(rings, rings[1:]))
        if closed:
            pairs.append((rings[-1], rings[0]))
        for a, b in pairs:
            if len(a) == 1 and len(b) == 1:
                continue
            for k in range(segments):
                n = (k + 1) % segments
                if len(a) == 1:
                    bm.faces.new((a[0], b[k], b[n]))
                elif len(b) == 1:
                    bm.faces.new((a[k], a[n], b[0]))
                else:
                    bm.faces.new((a[k], a[n], b[n], b[k]))
        self._commit(bm, part, matrix, flat)

    def prism(self, points, z0, z1, part, bevel=CHAMFER, matrix=None, flat=False):
        """Extrudes a polygon in XY from `z0` to `z1` and chamfers its corners."""
        bm = bmesh.new()
        bottom = [bm.verts.new((x, y, z0)) for x, y in points]
        top = [bm.verts.new((x, y, z1)) for x, y in points]
        count = len(points)
        bm.faces.new(bottom)
        bm.faces.new(top)
        for k in range(count):
            n = (k + 1) % count
            bm.faces.new((bottom[k], bottom[n], top[n], top[k]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if bevel > 0:
            # Only real corners: the short edges that approximate a curve
            # stay as they are and are smoothed instead.
            corners = [
                edge
                for edge in bm.edges
                if len(edge.link_faces) == 2 and edge.calc_face_angle(0.0) > math.radians(30)
            ]
            bmesh.ops.bevel(
                bm,
                geom=corners,
                offset=bevel,
                offset_type="OFFSET",
                segments=1,
                profile=0.5,
                affect="EDGES",
                clamp_overlap=True,
            )
        self._commit(bm, part, matrix, flat)

    def box(self, center, size, part, bevel=CHAMFER, matrix=None):
        cx, cy, cz = center
        sx, sy, sz = size
        self.prism(rect(sx, sy, cx, cy), cz - sz / 2, cz + sz / 2, part, bevel, matrix)

    def slab(self, points, thickness, part, bevel=CHAMFER, y=0.0):
        """A profile drawn in the XZ plane, `thickness` deep along Y."""
        matrix = Matrix.Translation((0.0, y, 0.0)) @ UPRIGHT
        self.prism(points, -thickness / 2, thickness / 2, part, bevel, matrix)

    def sphere(self, center, radius, part, segments=40, rings=18):
        profile = [
            (radius * math.sin(math.pi * k / rings), -radius * math.cos(math.pi * k / rings))
            for k in range(rings + 1)
        ]
        self.lathe(profile, part, segments, matrix=Matrix.Translation(center))

    def plinth(self, radius=0.64, height=0.12, part=BODY):
        self.lathe(
            [
                (0, 0),
                (radius, 0),
                (radius, height - 0.04),
                (radius - 0.04, height),
                (radius * 0.45, height),
                (0, height),
            ],
            part,
        )

    def finish(self):
        bm = self.bm
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
        for edge in bm.edges:
            if (
                edge.smooth
                and len(edge.link_faces) == 2
                and edge.calc_face_angle(0.0) > SHARP_ANGLE
            ):
                edge.smooth = False
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        return mesh


# -----------------------------------------------------------------------------
# The pieces
# -----------------------------------------------------------------------------


def api_gateway():
    """A gate: everything that enters the region passes under it."""
    p = Piece("api-gateway")
    p.box((0, 0, 0.07), (1.96, 1.0, 0.14), BODY)
    base, spring, outer, inner = 0.12, 0.92, 0.82, 0.44
    profile = (
        [(-outer, base), (-outer, base + spring)]
        + arc(0, base + spring, outer, 180, 0, 22)[1:]
        + [(outer, base), (inner, base), (inner, base + spring)]
        + arc(0, base + spring, inner, 0, 180, 16)[1:]
        + [(-inner, base)]
    )
    p.slab(profile, 0.52, BODY, bevel=0.045)
    # The threshold: the way through, marked on the floor of the gate.
    p.box((0, 0, 0.152), (inner * 2 - 0.1, 0.9, 0.024), MARK, bevel=0)
    return p


def network_gateway():
    """A desk globe: the network that reaches everywhere."""
    p = Piece("network-gateway")
    p.lathe(
        [(0, 0), (0.6, 0), (0.6, 0.07), (0.55, 0.12), (0.22, 0.16), (0.11, 0.26), (0.11, 0.5), (0, 0.5)],
        BODY,
    )
    centre = (0.0, 0.0, 1.14)
    radius = 0.7
    p.sphere(centre, radius, BODY)
    tilt = Matrix.Translation(centre) @ Matrix.Rotation(math.radians(21), 4, "Y")
    # The equator, standing a little proud of the sphere.
    p.lathe(
        [(radius - 0.02, -0.045), (radius + 0.03, -0.045), (radius + 0.03, 0.045), (radius - 0.02, 0.045)],
        MARK,
        closed=True,
        matrix=tilt,
    )
    # The meridian that carries it, pole to pole, and its two pins.
    band = arc(0, 0, 0.9, -90, 90, 24) + arc(0, 0, 0.8, 90, -90, 24)
    p.prism(band, -0.055, 0.055, DETAIL, bevel=0.02, matrix=tilt @ UPRIGHT)
    for side in (1, -1):
        p.lathe(
            [(0, side * 0.66), (0.05, side * 0.66), (0.05, side * 0.86), (0, side * 0.86)],
            DETAIL,
            segments=12,
            matrix=tilt,
        )
    return p


def security_monitor():
    """A lighthouse: it stands apart and watches."""
    p = Piece("security-monitor")

    def tower(z):
        return 0.52 + (0.33 - 0.52) * (z - 0.16) / (1.2 - 0.16)

    p.lathe([(0, 0), (0.62, 0), (0.62, 0.1), (0.52, 0.16), (tower(0.56), 0.56), (0, 0.56)], BODY)
    p.lathe([(0, 0.56), (tower(0.56), 0.56), (tower(0.84), 0.84), (0, 0.84)], DETAIL)
    p.lathe(
        [(0, 0.84), (tower(0.84), 0.84), (tower(1.2), 1.2), (0.5, 1.24), (0.5, 1.31), (0.2, 1.31), (0, 1.31)],
        BODY,
    )
    # The lantern room is the mark: the one part that is the light.
    p.lathe([(0, 1.31), (0.27, 1.31), (0.27, 1.62), (0, 1.62)], MARK)
    p.lathe([(0, 1.62), (0.4, 1.62), (0.4, 1.67), (0.06, 1.98), (0, 1.98)], BODY)
    return p


def auth_service():
    """A shield with a keyhole: who are you?"""
    p = Piece("auth-service")
    p.plinth(0.62)
    half, shoulder, tip = 0.74, 1.12, 0.09
    profile = (
        [(-half, 1.86), (0, 1.97), (half, 1.86), (half, shoulder)]
        + quadratic((half, shoulder), (0.66, 0.5), (0, tip), 12)
        + quadratic((0, tip), (-0.66, 0.5), (-half, shoulder), 12)[:-1]
    )
    p.slab(profile, 0.3, BODY, bevel=0.05)
    keyhole = arc(0, 1.3, 0.19, -62, 242, 22) + [(-0.13, 0.74), (0.13, 0.74)]
    p.slab(keyhole, 0.34, MARK, bevel=0)
    return p


def cedar_authorizer():
    """A cedar, because the policies are written in Cedar."""
    p = Piece("cedar-authorizer")
    p.plinth(0.6)
    p.lathe([(0, 0.1), (0.15, 0.1), (0.12, 0.6), (0, 0.6)], DETAIL, segments=8, flat=True)
    tiers = ((0.5, 0.76, 0.56), (0.92, 0.6, 0.52), (1.3, 0.44, 0.7))
    for index, (z, radius, height) in enumerate(tiers):
        last = index == len(tiers) - 1
        top = [(0, z + height)] if last else [(radius * 0.3, z + height), (0, z + height)]
        p.lathe([(0, z), (radius, z), (radius, z + 0.04)] + top, BODY, segments=8, flat=True)
    return p


def microservice():
    """A cell: one of many, each with its lid on."""
    p = Piece("microservice")
    p.prism(polygon(6, 0.88), 0.0, 0.46, BODY, bevel=0.045)
    p.prism(polygon(6, 0.78), 0.44, 0.56, DETAIL, bevel=0)
    p.prism(polygon(6, 0.88), 0.54, 0.82, BODY, bevel=0.045)
    p.prism(polygon(6, 0.42), 0.8, 0.846, MARK, bevel=0)
    return p


def container():
    """A shipping container, corrugated sides and all."""
    p = Piece("container")
    length, width, height, floor = 1.84, 0.86, 0.9, 0.06
    p.box((0, 0, floor + height / 2), (length, width, height), BODY, bevel=0.03)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((sx * (length / 2 - 0.1), sy * (width / 2 - 0.1), 0.04), (0.2, 0.2, 0.08), BODY, bevel=0.015)
    ribs = 9
    for k in range(ribs):
        x = (k - (ribs - 1) / 2) * 0.185
        for sy in (-1, 1):
            p.box((x, sy * (width / 2 + 0.012), floor + height / 2), (0.085, 0.05, height - 0.2), DETAIL, bevel=0.012)
        p.box((x, 0, floor + height + 0.008), (0.085, width - 0.2, 0.04), DETAIL, bevel=0.012)
    # The door end, with its two locking bars.
    for sy in (-1, 1):
        p.box((length / 2 + 0.01, sy * 0.14, floor + height / 2), (0.04, 0.05, height - 0.16), MARK, bevel=0)
    return p


def serverless():
    """A bolt: compute that is there only while it is called."""
    p = Piece("serverless")
    p.plinth(0.66)
    bolt = [(0.09, 1.96), (-0.6, 0.86), (-0.03, 0.86), (-0.11, 0.08), (0.6, 1.2), (0.03, 1.2)]
    p.slab(bolt, 0.3, BODY, bevel=0.045)
    return p


def message_queue():
    """Messages standing in line; the next one out is marked."""
    p = Piece("message-queue")
    p.box((0, 0, 0.07), (1.96, 0.92, 0.14), BODY)
    for sy in (-1, 1):
        p.box((0, sy * 0.4, 0.19), (1.96, 0.07, 0.12), DETAIL, bevel=0.02)
    slots = 5
    for k in range(slots):
        x = (k - (slots - 1) / 2) * 0.36
        p.box((x, 0, 0.14 + 0.36), (0.17, 0.64, 0.72), MARK if k == slots - 1 else BODY, bevel=0.03)
    return p


def database():
    """The stack of platters every diagram draws."""
    p = Piece("database")
    radius, platter, gap = 0.8, 0.42, 0.09
    for k in range(3):
        z = k * (platter + gap)
        p.lathe(
            [
                (0, z),
                (radius - 0.04, z),
                (radius, z + 0.04),
                (radius, z + platter - 0.04),
                (radius - 0.04, z + platter),
                (radius * 0.5, z + platter),
                (0, z + platter),
            ],
            BODY,
            segments=48,
        )
        if k < 2:
            p.lathe(
                [(0, z + platter - 0.01), (radius - 0.1, z + platter - 0.01), (radius - 0.1, z + platter + gap + 0.01), (0, z + platter + gap + 0.01)],
                DETAIL,
                segments=48,
            )
    top = 3 * platter + 2 * gap
    p.lathe([(0, top - 0.01), (0.5, top - 0.01), (0.5, top + 0.022), (0, top + 0.022)], MARK, segments=48)
    return p


def storage():
    """A bucket with objects in it."""
    p = Piece("storage")
    p.lathe(
        [(0, 0), (0.5, 0), (0.55, 0.05), (0.8, 1.02), (0.7, 1.02), (0.47, 0.18), (0, 0.18)],
        BODY,
    )
    p.lathe([(0.68, 0.96), (0.87, 0.96), (0.87, 1.08), (0.68, 1.08)], DETAIL, closed=True)
    blocks = (
        ((-0.2, -0.12, 0.84), 0.5, 18, 8),
        ((0.24, 0.16, 0.9), 0.44, -24, -12),
        ((0.02, -0.02, 1.22), 0.4, 40, 16),
    )
    for centre, size, turn, lean in blocks:
        matrix = (
            Matrix.Translation(centre)
            @ Matrix.Rotation(math.radians(turn), 4, "Z")
            @ Matrix.Rotation(math.radians(lean), 4, "X")
        )
        p.box((0, 0, 0), (size, size, size), MARK, bevel=0.035, matrix=matrix)
    return p


def external_client():
    """A pawn: the people on the other end."""
    p = Piece("external-client")
    p.lathe(
        [
            (0, 0),
            (0.58, 0),
            (0.6, 0.05),
            (0.6, 0.12),
            (0.5, 0.2),
            (0.36, 0.25),
            (0.28, 0.36),
            (0.16, 1.02),
            (0.3, 1.06),
            (0.31, 1.12),
            (0.16, 1.17),
            (0, 1.17),
        ],
        BODY,
    )
    p.sphere((0, 0, 1.46), 0.32, MARK)
    return p


BUILDERS = (
    api_gateway,
    auth_service,
    cedar_authorizer,
    microservice,
    container,
    serverless,
    message_queue,
    database,
    storage,
    network_gateway,
    security_monitor,
    external_client,
)


# -----------------------------------------------------------------------------
# Ambient occlusion
# -----------------------------------------------------------------------------


def hemisphere(count):
    """Cosine-weighted directions around +Z, the same set for every vertex."""
    golden = math.pi * (3 - math.sqrt(5))
    directions = []
    for k in range(count):
        u = (k + 0.5) / count
        radius = math.sqrt(u)
        angle = golden * k
        directions.append(Vector((radius * math.cos(angle), radius * math.sin(angle), math.sqrt(1 - u))))
    return directions


def bake_occlusion(mesh):
    """Writes how open each corner is to the sky into the `ao` attribute."""
    vertices = [v.co.copy() for v in mesh.vertices]
    triangles = [tuple(p.vertices) for p in mesh.polygons]
    # The plate the piece stands on shades its foot.
    base = len(vertices)
    reach = 6.0
    vertices += [Vector((-reach, -reach, 0)), Vector((reach, -reach, 0)), Vector((reach, reach, 0)), Vector((-reach, reach, 0))]
    triangles += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    tree = BVHTree.FromPolygons(vertices, triangles, epsilon=0.0)

    samples = hemisphere(AO_SAMPLES)
    attribute = mesh.color_attributes.new("ao", "FLOAT_COLOR", "CORNER")
    normals = mesh.corner_normals
    cache = {}
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.loops[loop_index].vertex_index
            normal = normals[loop_index].vector
            key = (vertex, round(normal.x, 3), round(normal.y, 3), round(normal.z, 3))
            openness = cache.get(key)
            if openness is None:
                frame = normal.to_track_quat("Z", "Y")
                origin = vertices[vertex] + normal * 0.004
                blocked = 0.0
                for sample in samples:
                    hit = tree.ray_cast(origin, frame @ sample, AO_REACH)
                    if hit[0] is not None:
                        blocked += 1 - hit[3] / AO_REACH
                openness = 1 - blocked / len(samples)
                cache[key] = openness
            attribute.data[loop_index].color = (openness, openness, openness, 1.0)
    mesh.color_attributes.active_color = attribute
    mesh.color_attributes.render_color_index = mesh.color_attributes.find("ao")


# -----------------------------------------------------------------------------
# Scene, export, preview
# -----------------------------------------------------------------------------


def node_tree(material):
    # Before Blender 5 a new material has no node tree until it is asked for.
    if bpy.app.version < (5, 0, 0):
        material.use_nodes = True
    return material.node_tree


def export_material(index):
    name = PART_NAMES[index]
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    tree = node_tree(material)
    nodes, links = tree.nodes, tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 1.0
    shader.inputs["Metallic"].default_value = 0.0
    occlusion = nodes.new("ShaderNodeVertexColor")
    occlusion.layer_name = "ao"
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["A"].default_value = (*PART_COLORS[index], 1.0)
    links.new(occlusion.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def build_all():
    """Builds every piece into a collection of the current scene."""
    scene = bpy.context.scene
    collection = bpy.data.collections.get(COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION_NAME)
    if collection.name not in scene.collection.children:
        scene.collection.children.link(collection)
    for obj in list(collection.objects):
        mesh = obj.data
        bpy.data.objects.remove(obj)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    materials = [export_material(index) for index in range(3)]
    objects = []
    for builder in BUILDERS:
        mesh = builder().finish()
        for material in materials:
            mesh.materials.append(material)
        bake_occlusion(mesh)
        obj = bpy.data.objects.new(mesh.name, mesh)
        collection.objects.link(obj)
        objects.append(obj)
    return scene, objects


def export(scene, objects, path=DEFAULT_OUTPUT):
    # The exporter reads the active scene's dependency graph; exporting from
    # any other scene crashes it, so the pieces live in this one and are
    # picked out by selection.
    bpy.context.view_layer.update()
    for obj in scene.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )
    return path


def preview_material(index, night):
    """The client's own shading, so the sheet shows what the scene will."""
    name = f"aegis-preview-{index}-{'night' if night else 'light'}"
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    tree = node_tree(material)
    nodes, links = tree.nodes, tree.links
    nodes.clear()
    light = ((0.115, 0.130, 0.147), (0.171, 0.194, 0.220), (0.896, 0.905, 0.887))
    dark = ((0.397, 0.423, 0.439), (0.202, 0.223, 0.238), (0.012, 0.014, 0.015))
    colour = (dark if night else light)[index]

    def math_node(operation, a, b):
        node = nodes.new("ShaderNodeMath")
        node.operation = operation
        for socket, value in zip(node.inputs, (a, b)):
            if isinstance(value, (int, float)):
                socket.default_value = value
            else:
                links.new(value, socket)
        return node.outputs[0]

    geometry = nodes.new("ShaderNodeNewGeometry")
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    links.new(geometry.outputs["Normal"], dot.inputs[0])
    # The scene's key light (-0.42, 0.82, 0.38 with Y up), in Blender's axes.
    dot.inputs[1].default_value = Vector((-0.42, -0.38, 0.82)).normalized()
    key = math_node("MAXIMUM", dot.outputs["Value"], 0.0)
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Normal"], split.inputs[0])
    sky = math_node("ADD", math_node("MULTIPLY", split.outputs["Z"], 0.5), 0.5)
    shade = math_node("ADD", math_node("ADD", math_node("MULTIPLY", key, 0.36), 0.56), math_node("MULTIPLY", sky, 0.1))
    occlusion = nodes.new("ShaderNodeVertexColor")
    occlusion.layer_name = "ao"
    channel = nodes.new("ShaderNodeSeparateColor")
    links.new(occlusion.outputs["Color"], channel.inputs[0])
    lit = math_node("MULTIPLY", shade, math_node("ADD", math_node("MULTIPLY", channel.outputs[0], 0.7), 0.3))
    tint = nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs["A"].default_value = (*colour, 1.0)
    links.new(lit, tint.inputs["B"])
    emission = nodes.new("ShaderNodeEmission")
    links.new(tint.outputs["Result"], emission.inputs["Color"])
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def render_preview(scene, objects, path, night=False, columns=4, spacing=3.1):
    """A contact sheet of every piece from the scene's own camera angle."""
    exported = [list(obj.data.materials) for obj in objects]
    others = [obj for obj in scene.objects if obj not in objects and not obj.hide_render]
    for obj in others:
        obj.hide_render = True
    settings = (
        scene.camera,
        scene.render.engine,
        scene.render.resolution_x,
        scene.render.resolution_y,
        scene.render.resolution_percentage,
        scene.render.filepath,
        scene.render.image_settings.file_format,
        scene.view_settings.view_transform,
        scene.view_settings.look,
    )
    for obj in objects:
        for index in range(3):
            obj.data.materials[index] = preview_material(index, night)
    rows = math.ceil(len(objects) / columns)
    for index, obj in enumerate(objects):
        obj.location = (
            (index % columns - (columns - 1) / 2) * spacing,
            -(index // columns - (rows - 1) / 2) * spacing,
            0,
        )

    extras = []
    plate_mesh = bpy.data.meshes.new("aegis-preview-plate")
    plate_bm = bmesh.new()
    bmesh.ops.create_grid(plate_bm, x_segments=1, y_segments=1, size=60)
    plate_bm.to_mesh(plate_mesh)
    plate_bm.free()
    plate = bpy.data.objects.new("aegis-preview-plate", plate_mesh)
    plate_material = bpy.data.materials.new("aegis-preview-plate")
    plate_nodes = node_tree(plate_material).nodes
    plate_nodes.clear()
    plate_emission = plate_nodes.new("ShaderNodeEmission")
    plate_emission.inputs["Color"].default_value = (0.021, 0.023, 0.025, 1) if night else (0.879, 0.888, 0.871, 1)
    plate_output = plate_nodes.new("ShaderNodeOutputMaterial")
    plate_material.node_tree.links.new(plate_emission.outputs[0], plate_output.inputs["Surface"])
    plate_mesh.materials.append(plate_material)
    scene.collection.objects.link(plate)
    extras.append(plate)

    camera_data = bpy.data.cameras.new("aegis-preview-camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = columns * spacing * 1.08
    camera = bpy.data.objects.new("aegis-preview-camera", camera_data)
    elevation, azimuth = 0.62, -0.42
    direction = Vector(
        (math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation))
    )
    target = Vector((0, 0, 0.8))
    camera.location = target + direction * 60
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(camera)
    extras.append(camera)

    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1150
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    bpy.ops.render.render(write_still=True)

    (
        scene.camera,
        scene.render.engine,
        scene.render.resolution_x,
        scene.render.resolution_y,
        scene.render.resolution_percentage,
        scene.render.filepath,
        scene.render.image_settings.file_format,
        scene.view_settings.view_transform,
        scene.view_settings.look,
    ) = settings
    for obj in others:
        obj.hide_render = False
    for obj, materials in zip(objects, exported):
        obj.location = (0, 0, 0)
        for index, material in enumerate(materials):
            obj.data.materials[index] = material
    for obj in extras:
        data = obj.data
        bpy.data.objects.remove(obj)
        if isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
        else:
            bpy.data.cameras.remove(data)
    bpy.data.materials.remove(plate_material)
    return path


def summary(objects):
    return {
        obj.name: {
            "triangles": len(obj.data.polygons),
            "height": round(max(v.co.z for v in obj.data.vertices), 3),
            "radius": round(max(math.hypot(v.co.x, v.co.y) for v in obj.data.vertices), 3),
        }
        for obj in objects
    }


def main(argv):
    scene, objects = build_all()
    output = DEFAULT_OUTPUT
    if "--out" in argv:
        output = os.path.abspath(argv[argv.index("--out") + 1])
    if "--preview" in argv:
        render_preview(scene, objects, os.path.abspath(argv[argv.index("--preview") + 1]))
    export(scene, objects, output)
    for name, facts in summary(objects).items():
        print(f"{name:18} {facts['triangles']:5} triangles, {facts['height']:.2f} high")
    print(f"wrote {output}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])

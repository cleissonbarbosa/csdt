/**
 * Node materials written in the Three.js Shading Language (TSL).
 *
 * TSL compiles to WGSL on the WebGPU backend and to GLSL ES 3.0 on the WebGL 2
 * fallback, so there is exactly one implementation of every effect. Nothing
 * here uses compute shaders or storage buffers, which the fallback cannot
 * provide: animation is a pure function of time and per-instance data.
 *
 * The look is a scale model on a table: matte pieces under one fixed light,
 * no glow, no additive blending. Materials are unlit in the engine's sense
 * and compute their own shading, so a surface facing the light shows exactly
 * the palette colour and both backends, and both themes, agree.
 */
import {
  abs,
  attribute,
  cameraPosition,
  cross,
  dot,
  float,
  fract,
  fwidth,
  int,
  ivec2,
  length,
  max,
  mix,
  normalLocal,
  normalWorld,
  normalize,
  oneMinus,
  positionGeometry,
  saturate,
  sin,
  cos,
  smoothstep,
  step,
  texture,
  textureLoad,
  time,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';

import { BEAD_SHAPE_ID, type ScenePalette } from '@/lib/palette';

/**
 * TSL nodes are composed dynamically; the generated typings cannot follow a
 * node through arithmetic and swizzles, so shader-building helpers take and
 * return this deliberately loose type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShaderNode = any;

/** A uniform as the application sees it: something with a settable value. */
export interface Uniform<T> {
  value: T;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME_COLORS = [
  'table',
  'plate',
  'plateSide',
  'plateLine',
  'piece',
  'pieceCore',
  'ghost',
  'ink',
  'inkDim',
  'track',
  'shadow',
  'warning',
  'critical',
  'hostile',
] as const satisfies readonly (keyof ScenePalette)[];

type ThemeColor = (typeof THEME_COLORS)[number];

/**
 * The palette as uniforms shared by every material, so switching between the
 * light and night themes is a matter of writing new values: nothing is
 * rebuilt or recompiled.
 */
export type SceneTheme = Record<ThemeColor, ShaderNode & Uniform<THREE.Color>> & {
  shadowOpacity: ShaderNode & Uniform<number>;
};

export function createSceneTheme(palette: ScenePalette): SceneTheme {
  const theme = { shadowOpacity: uniform(palette.shadowOpacity) } as SceneTheme;
  for (const name of THEME_COLORS) theme[name] = uniform(new THREE.Color(palette[name]));
  return theme;
}

export function applyPalette(theme: SceneTheme, palette: ScenePalette): void {
  for (const name of THEME_COLORS) theme[name].value.set(palette[name]);
  theme.shadowOpacity.value = palette.shadowOpacity;
}

function flat<M extends THREE.NodeMaterial>(material: M): M {
  // Colours are chosen, not graded: keep the tone mapper away from them.
  material.toneMapped = false;
  return material;
}

function blended<M extends THREE.NodeMaterial>(material: M): M {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.NormalBlending;
  return flat(material);
}

/** The one light of the scene: high, from the front-left. */
const KEY_LIGHT = new THREE.Vector3(-0.42, 0.82, 0.38).normalize();

/**
 * Matte shading for a world-space normal: 1 where the surface faces the
 * light, falling to about two thirds in shade. Never black: this is a model
 * under studio light, not a scene with drama.
 */
function shade(normal: ShaderNode): ShaderNode {
  const key = saturate(dot(normal, vec3(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z)));
  const sky = normal.y.mul(0.5).add(0.5);
  return float(0.64).add(key.mul(0.3)).add(sky.mul(0.1));
}

/** Quadratic Bézier `a → c → b` evaluated at `t`. */
function bezier(a: ShaderNode, c: ShaderNode, b: ShaderNode, t: ShaderNode): ShaderNode {
  const u = oneMinus(t);
  return a
    .mul(u.mul(u))
    .add(c.mul(u.mul(t).mul(2)))
    .add(b.mul(t.mul(t)));
}

/** Coverage of a shape from its signed distance, antialiased over one pixel. */
function coverage(distance: ShaderNode): ShaderNode {
  const edge = max(fwidth(distance), float(0.0001));
  return oneMinus(smoothstep(edge.negate(), edge, distance));
}

/** Premultiplied "source over destination" for layers built in one shader. */
interface Layer {
  rgb: ShaderNode;
  alpha: ShaderNode;
}
function over(below: Layer, color: ShaderNode, alpha: ShaderNode): Layer {
  return {
    rgb: color.mul(alpha).add(below.rgb.mul(oneMinus(alpha))),
    alpha: alpha.add(below.alpha.mul(oneMinus(alpha))),
  };
}

// ---------------------------------------------------------------------------
// Service pieces
// ---------------------------------------------------------------------------

/**
 * A solid, matte piece.
 *
 * Geometry: `aPart` (0 body, 1 lighter detail, 2 mark) and `aAo`, how open
 *           each vertex is to the sky, baked when the piece was modelled.
 * Instance: `aTint` rgb — the piece colour, already decided by the scene
 *           (neutral when healthy, a signal colour when not) — and
 *           `aFx` = (_, _, visibility, _).
 */
export function createPieceMaterial(theme: SceneTheme): THREE.MeshBasicNodeMaterial {
  const material = flat(new THREE.MeshBasicNodeMaterial());
  const tint = attribute('aTint', 'vec3');
  const visibility = attribute('aFx', 'vec4').z;
  const part = attribute('aPart', 'float');
  const detail = saturate(part);
  const mark = saturate(part.sub(1));

  // Details are a slightly lighter tone of the same piece; marks take the
  // contrasting "core" colour so a silhouette's defining feature stays readable.
  const surface = mix(mix(tint, tint.mul(1.22), detail), theme.pieceCore, mark);
  // A little more modelling than the plates get: the key light does more of
  // the work, and the baked occlusion darkens what the piece itself shades,
  // which is what turns a silhouette into a solid.
  const key = saturate(dot(normalWorld, vec3(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z)));
  const sky = normalWorld.y.mul(0.5).add(0.5);
  const light = float(0.56).add(key.mul(0.34)).add(sky.mul(0.1));
  const occlusion = mix(float(0.4), float(1), attribute('aAo', 'float'));
  const lit = surface.mul(light).mul(occlusion);
  // Filtered-out pieces recede into the plate instead of going dark.
  material.colorNode = mix(theme.plate, lit, mix(float(0.14), float(1), visibility));
  return material;
}

/** Thin supports under pieces that are raised above their plate. */
export function createStemMaterial(theme: SceneTheme): THREE.MeshBasicNodeMaterial {
  const material = flat(new THREE.MeshBasicNodeMaterial());
  material.colorNode = theme.track.mul(shade(normalWorld));
  return material;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface EdgeUniforms {
  /** World units per pixel at unit distance: `2·tan(fov/2) / viewportHeight`. */
  pixelScale: Uniform<number>;
}

/**
 * Camera-facing hairlines along quadratic curves. One instanced draw call
 * for every connection. Direction and volume are shown by the beads that
 * travel along them, so the line itself is still.
 *
 * Geometry: `position` = (t, side, 0), t ∈ [0,1], side ∈ {-1, +1}.
 * Instance: `aStart`, `aEnd`, `aCtrl`, `aColor`,
 *           `aEdgeFx` = (opacity, drawn 0…1, width px, drawn from: +1 the
 *           start, -1 the end). A connection draws itself along its length
 *           when the model is assembled and when it joins a selection.
 */
export function createEdgeMaterial(): {
  material: THREE.MeshBasicNodeMaterial;
  uniforms: EdgeUniforms;
} {
  const material = blended(new THREE.MeshBasicNodeMaterial());
  material.side = THREE.DoubleSide;
  const pixelScale = uniform(0.001);

  const t = positionGeometry.x;
  const side = positionGeometry.y;
  const a = attribute('aStart', 'vec3');
  const b = attribute('aEnd', 'vec3');
  const c = attribute('aCtrl', 'vec3');
  const fx = attribute('aEdgeFx', 'vec4');

  const u = oneMinus(t);
  const point = bezier(a, c, b, t);
  const tangent = normalize(
    c
      .sub(a)
      .mul(u.mul(2))
      .add(b.sub(c).mul(t.mul(2))),
  );
  const toCamera = cameraPosition.sub(point);
  const sideways = normalize(cross(tangent, normalize(toCamera)));
  // Constant on-screen width regardless of distance. One extra pixel is added
  // and spent on the antialiased edge.
  const halfWidth = max(length(toCamera).mul(pixelScale).mul(fx.z.add(1)).mul(0.5), float(0.004));
  material.positionNode = point.add(sideways.mul(side).mul(halfWidth));

  const across = oneMinus(abs(side));
  const feather = saturate(across.mul(fx.z.add(1)).mul(0.5));
  // Stop short of the pieces at either end so their shapes stay clean.
  const ends = smoothstep(0.02, 0.07, t).mul(oneMinus(smoothstep(0.93, 0.98, t)));
  material.colorNode = attribute('aColor', 'vec3');
  const along = mix(oneMinus(t), t, step(0, fx.w));
  const reach = fx.y.mul(1.06);
  const drawn = oneMinus(smoothstep(reach.sub(0.05), reach, along));
  material.opacityNode = feather.mul(fx.x).mul(ends).mul(drawn);
  return { material, uniforms: { pixelScale } };
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

/** Rows of the per-edge data texture read by the particle shader. */
export const EDGE_ROWS = 4;

export interface ParticleUniforms {
  /** Global multiplier on particle density (adaptive quality). */
  density: Uniform<number>;
  size: Uniform<number>;
}

const SHAPE = BEAD_SHAPE_ID;
/** Share of a connection's traffic above which errors are drawn in red. */
export const ERROR_SIGNAL = 0.01;
/** Share above which rejections are drawn in amber rather than ink. */
export const REJECT_SIGNAL = 0.1;

/** Signed distance to each bead shape in sprite space, `p` ∈ [-1, 1]². */
function beadDistance(p: ShaderNode, shape: ShaderNode): ShaderNode {
  const r = length(p);
  const box = max(abs(p.x), abs(p.y));
  const is = (id: number) => oneMinus(step(0.5, abs(shape.sub(id))));
  const disc = r.sub(0.66);
  const ring = abs(r.sub(0.58)).sub(0.2);
  const diamond = abs(p.x).add(abs(p.y)).sub(0.88);
  const square = box.sub(0.6);
  const frame = abs(box.sub(0.56)).sub(0.19);
  const bar = max(abs(p.x).sub(0.92), abs(p.y).sub(0.3));
  const triangle = max(abs(p.x).mul(0.866).add(p.y.mul(0.5)), p.y.negate()).sub(0.46);
  return disc
    .mul(is(SHAPE.disc))
    .add(ring.mul(is(SHAPE.ring)))
    .add(diamond.mul(is(SHAPE.diamond)))
    .add(square.mul(is(SHAPE.square)))
    .add(frame.mul(is(SHAPE.frame)))
    .add(bar.mul(is(SHAPE.bar)))
    .add(triangle.mul(is(SHAPE.triangle)));
}

/**
 * Every request in flight, as stateless GPU beads on the connections.
 *
 * A bead owns only static data: which edge it lives on and four random seeds.
 * Everything that changes — how many beads an edge shows, how fast they move,
 * what share is errors, rejections or suspicious — lives in a tiny float
 * texture with one column per edge. The CPU touches that texture, never the
 * beads; position, category, shape and colour are derived in the vertex
 * shader from `time`.
 *
 * Ordinary traffic is ink and is told apart by shape (see `TRAFFIC_LEGEND`).
 * Only traffic that went wrong has a hue, and only where it amounts to
 * something: every platform rejects a little junk and fails a request now
 * and then, and that routine trickle keeps its shape but stays ink.
 *
 * Texture rows (per edge column):
 *   0: start.xyz, density      1: end.xyz, speed
 *   2: control.xyz, kind       3: error, rejected, suspicious share, visibility
 *
 * Instance: `aEdge` (column), `aSeed` (phase, speed jitter, lane, roll).
 */
export function createParticleMaterial(
  data: THREE.DataTexture,
  theme: SceneTheme,
): {
  material: THREE.SpriteNodeMaterial;
  uniforms: ParticleUniforms;
} {
  const material = blended(new THREE.SpriteNodeMaterial());
  const density = uniform(1);
  const size = uniform(0.21);

  const column = int(attribute('aEdge', 'float'));
  const seed = attribute('aSeed', 'vec4');
  const row0 = textureLoad(data, ivec2(column, 0));
  const row1 = textureLoad(data, ivec2(column, 1));
  const row2 = textureLoad(data, ivec2(column, 2));
  const row3 = textureLoad(data, ivec2(column, 3));
  const kind = row2.w;
  const errorShare = row3.x;
  const rejectShare = row3.y;
  const suspiciousShare = row3.z;

  // Category from one random roll against cumulative shares.
  const roll = seed.w;
  const isSuspicious = step(roll, suspiciousShare);
  const isRejected = step(roll, suspiciousShare.add(rejectShare)).mul(oneMinus(isSuspicious));
  const isError = step(roll, suspiciousShare.add(rejectShare).add(errorShare))
    .mul(oneMinus(isSuspicious))
    .mul(oneMinus(isRejected));
  const isNormal = oneMinus(isSuspicious).mul(oneMinus(isRejected)).mul(oneMinus(isError));
  // On synchronous edges a share of the normal beads are responses
  // travelling back to the caller.
  const isResponse = isNormal.mul(step(0.66, fract(seed.z.mul(7.31)))).mul(step(kind, 2.5));
  // Replication and telemetry: background chatter, drawn smaller and paler.
  const isBackground = step(3.5, kind).mul(isNormal);

  const progress = fract(seed.x.add(time.mul(row1.w).mul(seed.y.mul(0.6).add(0.7))));
  // Rejected traffic never arrives: it stops short of the target.
  const forward = mix(progress, progress.mul(0.9), isRejected);
  const t = mix(forward, oneMinus(progress), isResponse);
  // Beads ride the line like beads on a wire, with just enough spread that
  // a busy connection reads as a stream rather than a single file.
  const lane = vec3(sin(seed.x.mul(41.3)), cos(seed.y.mul(57.9)), sin(seed.z.mul(33.7))).mul(0.04);
  material.positionNode = bezier(row0.xyz, row2.xyz, row1.xyz, t).add(lane);

  const visible = step(fract(seed.x.mul(13.7).add(seed.y.mul(3.1))), row0.w.mul(density));
  const grow = smoothstep(0, 0.06, progress).mul(oneMinus(smoothstep(0.94, 1, progress)));
  const scale = size
    .mul(visible)
    .mul(grow)
    .mul(float(1).add(isError.mul(0.3)).add(isSuspicious.mul(0.45)).add(isRejected.mul(0.4)))
    .mul(mix(float(1), float(0.62), isBackground))
    .mul(mix(float(0.82), float(1), seed.y));
  material.scaleNode = varying(vec2(scale, scale));

  let shape: ShaderNode = float(SHAPE.disc);
  shape = mix(shape, float(SHAPE.diamond), step(0.5, kind));
  shape = mix(shape, float(SHAPE.square), step(1.5, kind));
  shape = mix(shape, float(SHAPE.frame), step(2.5, kind));
  shape = mix(shape, float(SHAPE.disc), step(3.5, kind));
  shape = mix(shape, float(SHAPE.ring), isResponse);
  shape = mix(shape, float(SHAPE.disc), isError);
  shape = mix(shape, float(SHAPE.bar), isRejected);
  shape = mix(shape, float(SHAPE.triangle), isSuspicious);

  let tone: ShaderNode = mix(theme.inkDim, theme.track, isBackground);
  tone = mix(tone, theme.critical, isError.mul(step(ERROR_SIGNAL, errorShare)));
  tone = mix(tone, theme.warning, isRejected.mul(step(REJECT_SIGNAL, rejectShare)));
  tone = mix(tone, theme.hostile, isSuspicious);

  const p = uv().sub(0.5).mul(2);
  const vTone: ShaderNode = varying(tone);
  const vShape: ShaderNode = varying(shape);
  const vDim: ShaderNode = varying(row3.w);
  material.colorNode = vTone;
  material.opacityNode = coverage(beadDistance(p, vShape)).mul(vDim);
  return { material, uniforms: { density, size } };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface LabelUniforms {
  fadeNear: Uniform<number>;
  fadeFar: Uniform<number>;
  opacity: Uniform<number>;
  /** `2·tan(fov/2) / viewportHeight`: turns pixels into sprite scale. */
  pixelScale: Uniform<number>;
}

/**
 * Billboarded text from a canvas atlas: every label in one draw call.
 *
 * Labels keep one size on screen however far the camera is, like the names
 * on a map: text is for reading and should not grow into the picture. Which
 * labels are shown at all is decided by distance.
 *
 * Instance: `aPos`, `aSize` (width, height in pixels), `aRect` (u, v, w, h),
 *           `aLabelFx` = (visibility, always shown, alarm, _).
 */
export function createLabelMaterial(
  atlas: THREE.Texture,
  theme: SceneTheme,
): {
  material: THREE.SpriteNodeMaterial;
  uniforms: LabelUniforms;
} {
  const material = blended(new THREE.SpriteNodeMaterial());
  // Names are read, not looked at: nothing in the model may cover them.
  material.depthTest = false;
  material.sizeAttenuation = false;
  const fadeNear = uniform(40);
  const fadeFar = uniform(80);
  const opacity = uniform(1);
  const pixelScale = uniform(0.001);

  const position = attribute('aPos', 'vec3');
  const rect = attribute('aRect', 'vec4');
  const fx = attribute('aLabelFx', 'vec4');
  material.positionNode = position;
  material.scaleNode = attribute('aSize', 'vec2').mul(pixelScale);

  const texel = texture(atlas, rect.xy.add(uv().mul(rect.zw)));
  const distance = length(cameraPosition.sub(position));
  const fade = max(oneMinus(smoothstep(fadeNear, fadeFar, distance)), fx.y);
  // Red is the letters, alpha is letters plus halo (see `labels.ts`).
  const letters = mix(mix(theme.inkDim, theme.ink, fx.y), theme.critical, fx.z);
  material.colorNode = mix(theme.plate, letters, texel.r);
  material.opacityNode = texel.a.mul(varying(fade)).mul(fx.x).mul(opacity);
  return { material, uniforms: { fadeNear, fadeFar, opacity, pixelScale } };
}

// ---------------------------------------------------------------------------
// Ground marks: contact shadow, status lamp, selection
// ---------------------------------------------------------------------------

/**
 * What lies on the plate under every piece.
 *
 * A soft contact shadow is always there: it is what makes a piece stand on
 * its plate instead of floating in front of it. A lamp lights up under a
 * piece that is not in its normal state. A ring marks the selection.
 *
 * Geometry: unit quad lying in XZ.
 * Instance: `aPos`, `aColor` (lamp colour),
 *           `aRing` = (radius, lamp, change time, selected).
 */
export function createGroundMaterial(theme: SceneTheme): THREE.MeshBasicNodeMaterial {
  const material = blended(new THREE.MeshBasicNodeMaterial());
  material.side = THREE.DoubleSide;
  const ring = attribute('aRing', 'vec4');
  const lampColor = attribute('aColor', 'vec3');
  material.positionNode = attribute('aPos', 'vec3').add(positionGeometry.mul(ring.x.mul(4.4)));

  const d = length(uv().sub(0.5).mul(2));
  const band = (radius: ShaderNode | number, half: number) =>
    coverage(abs(d.sub(radius)).sub(half));

  // Contact shadow: darkest under the piece, gone by the edge of the quad.
  const shadow = oneMinus(smoothstep(0.18, 0.74, d));
  let layer: Layer = { rgb: theme.shadow.mul(0), alpha: float(0) };
  layer = over(layer, theme.shadow, shadow.mul(shadow).mul(theme.shadowOpacity));
  // Lamp: a tinted disc with a firm edge, only when there is a state to show.
  layer = over(layer, lampColor, coverage(d.sub(0.62)).mul(0.2).mul(ring.y));
  layer = over(layer, lampColor, band(0.62, 0.018).mul(ring.y));
  // A change of state sends one ring outward, once.
  const age = time.sub(ring.z);
  const alive = step(0, age).mul(oneMinus(smoothstep(0, 1.1, age)));
  layer = over(
    layer,
    lampColor,
    band(saturate(age.div(1.1)).mul(0.34).add(0.62), 0.014).mul(alive),
  );
  // Selection: a plain ink ring.
  layer = over(layer, theme.ink, band(0.74, 0.028).mul(ring.w));

  material.colorNode = layer.rgb.div(max(layer.alpha, float(0.0001)));
  material.opacityNode = layer.alpha;
  return material;
}

// ---------------------------------------------------------------------------
// Plates, the board and what they rest on
// ---------------------------------------------------------------------------

export interface PlateUniforms {
  /** Signal colour of the region's state. */
  tone: Uniform<THREE.Color>;
  /** 0 = normal … 1 = the region is in that state. */
  alarm: Uniform<number>;
  /** 1 when the region is down: the plate goes dark. */
  off: Uniform<number>;
}

/**
 * A region plate or the dependency board: a low solid with a top face.
 *
 * Geometry: a unit cylinder (round plates) or a unit box (the board), scaled
 * by the mesh. `round` selects how the outline on the top face is measured.
 */
export function createPlateMaterial(
  theme: SceneTheme,
  round: boolean,
): {
  material: THREE.MeshBasicNodeMaterial;
  uniforms: PlateUniforms;
} {
  const material = flat(new THREE.MeshBasicNodeMaterial());
  const tone = uniform(new THREE.Color('#ffffff'));
  const alarm = uniform(0);
  const off = uniform(0);

  const top = step(0.5, normalLocal.y);
  const d = round
    ? length(positionGeometry.xz)
    : max(abs(positionGeometry.x), abs(positionGeometry.z)).mul(2);
  // The outline is a hairline normally and a firm band in an abnormal state.
  const outline = round
    ? smoothstep(mix(float(0.988), float(0.955), alarm), mix(float(0.992), float(0.96), alarm), d)
    : float(0);
  const lineColor = mix(mix(theme.plateLine, tone, alarm), theme.ink, off);
  const fill = mix(mix(theme.plate, tone, alarm.mul(0.055)), theme.table, off.mul(0.7));
  const face = mix(fill, lineColor, outline);
  const side = theme.plateSide.mul(shade(normalWorld).mul(1.08));
  material.colorNode = mix(side, face, top);
  return { material, uniforms: { tone, alarm, off } };
}

/** The column that carries the raised edge plate. */
export function createSupportMaterial(theme: SceneTheme): THREE.MeshBasicNodeMaterial {
  const material = flat(new THREE.MeshBasicNodeMaterial());
  material.colorNode = theme.plateSide.mul(shade(normalWorld).mul(1.08));
  return material;
}

/**
 * The soft shadow a plate casts on whatever is below it.
 * Geometry: unit disc or unit square lying in XZ, larger than the plate.
 */
export function createCastShadowMaterial(
  theme: SceneTheme,
  round: boolean,
  strength: number,
): THREE.MeshBasicNodeMaterial {
  const material = blended(new THREE.MeshBasicNodeMaterial());
  const centered = uv().sub(0.5).mul(2);
  const d = round ? length(centered) : max(abs(centered.x), abs(centered.y));
  const falloff = oneMinus(smoothstep(round ? 0.8 : 0.88, 1, d));
  material.colorNode = theme.shadow;
  material.opacityNode = falloff.mul(theme.shadowOpacity).mul(strength);
  return material;
}

// ---------------------------------------------------------------------------
// The traced request
// ---------------------------------------------------------------------------

/**
 * Sprites positioned on the CPU: the head and tail of a traced request, and
 * the ring that marks where it arrived or was stopped.
 */
export function createTracerMaterial(): THREE.SpriteNodeMaterial {
  const material = blended(new THREE.SpriteNodeMaterial());
  material.depthTest = false;
  const fx = attribute('aTracerFx', 'vec4');
  material.positionNode = attribute('aPos', 'vec3');
  material.scaleNode = vec2(fx.x, fx.x);
  const r = length(uv().sub(0.5).mul(2));
  const disc = coverage(r.sub(0.72));
  // `fx.z` > 0 turns the sprite into a ring.
  const ring = coverage(abs(r.sub(0.82)).sub(0.07));
  material.colorNode = attribute('aColor', 'vec3');
  material.opacityNode = mix(disc, ring, fx.z).mul(fx.y);
  return material;
}

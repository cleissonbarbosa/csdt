/**
 * Node materials written in the Three.js Shading Language (TSL).
 *
 * TSL compiles to WGSL on the WebGPU backend and to GLSL ES 3.0 on the WebGL 2
 * fallback, so there is exactly one implementation of every effect. Nothing
 * here uses compute shaders or storage buffers, which the fallback cannot
 * provide: animation is a pure function of time, per-instance data and small
 * data textures.
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
  cameraViewMatrix,
  cameraWorldMatrix,
  cross,
  dot,
  float,
  floor,
  fract,
  fwidth,
  instanceIndex,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  mod,
  modelWorldMatrix,
  normalGeometry,
  normalLocal,
  normalWorld,
  normalize,
  oneMinus,
  positionGeometry,
  positionLocal,
  saturate,
  sign,
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
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';

import { BEAD_SHAPE_ID, type ScenePalette } from '@/lib/palette';

import { MOTION } from './pieces';

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
  'focus',
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
  pieceDetail: ShaderNode & Uniform<number>;
};

export function createSceneTheme(palette: ScenePalette): SceneTheme {
  const theme = {
    shadowOpacity: uniform(palette.shadowOpacity),
    pieceDetail: uniform(palette.pieceDetail),
  } as SceneTheme;
  for (const name of THEME_COLORS) theme[name] = uniform(new THREE.Color(palette[name]));
  return theme;
}

export function applyPalette(theme: SceneTheme, palette: ScenePalette): void {
  for (const name of THEME_COLORS) theme[name].value.set(palette[name]);
  theme.shadowOpacity.value = palette.shadowOpacity;
  theme.pieceDetail.value = palette.pieceDetail;
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

/** How many times in a cycle a degraded service's mechanism catches. */
const HESITATIONS = 3;
/** How unevenly it then runs: 0 is evenly, 1 would stop dead at each catch. */
const HESITATION = 0.85;
/** How often, per second, a jammed mechanism tries again. */
const JAM_RATE = 1.6;
/** How hard its part shakes while it pushes, in piece units, and how fast, in hertz. */
const STRAIN = 0.022;
const STRAIN_RATE = 13;

/** `v` turned by `angle` about the unit vector `axis` (Rodrigues' rotation). */
function turned(v: ShaderNode, axis: ShaderNode, angle: ShaderNode): ShaderNode {
  const c = cos(angle);
  return v
    .mul(c)
    .add(cross(axis, v).mul(sin(angle)))
    .add(axis.mul(dot(axis, v)).mul(oneMinus(c)));
}

/**
 * The part of a piece that works: where one of its vertices is, and which
 * way its surface faces, once its mechanism has run for `work` seconds in
 * the manner of the service's `state`.
 *
 * A mechanism is one column of `table` (see `PieceSet.table`): a kind of
 * motion about a pivot and an axis. A vertex names its column in `aPart.y`,
 * and column 0, all zeros, leaves a vertex where it was modelled, so the
 * same few lines move a door, a globe and a line of messages, and one
 * material draws every piece.
 *
 *   spin    turns about the axis, once per period
 *   index   turns one notch, then rests for the remainder of the period
 *   swing   turns by an angle, holds, and turns back
 *   slide   moves along the axis, holds, and moves back
 *   convey  moves along the axis and starts again, growing from nothing or
 *           shrinking to nothing on the way if it is the part that joins or
 *           leaves, so a line of equal parts advances without a seam
 *
 * `state` is the service's health as a number that travels between the
 * codes (0 healthy, 1 degraded, 2 critical, 3 down), and it changes how the
 * part moves, in the same way whatever the kind:
 *
 *   healthy   it runs evenly
 *   degraded  it hesitates: the same cycle, gone through in fits and starts
 *   critical  it is jammed: it pushes a little way into its motion, slips
 *             back and tries again, and gets nowhere
 *   down      it stands still and hangs crooked, turned about its slump axis
 *
 * A negative `work` means motion is off. Every part then rests as it was
 * modelled, except that one whose service is down still hangs: that is a
 * state, not a movement.
 */
function mechanism(
  table: THREE.DataTexture,
  work: ShaderNode,
  state: ShaderNode,
): { shift: ShaderNode; normal: ShaderNode } {
  const column = int(attribute('aPart', 'vec2').y);
  const row0 = textureLoad(table, ivec2(column, 0));
  const row1 = textureLoad(table, ivec2(column, 1));
  const row2 = textureLoad(table, ivec2(column, 2));
  const row3 = textureLoad(table, ivec2(column, 3));
  const pivot = row0.xyz;
  const kind = row0.w;
  const axis = row1.xyz;
  const amount = row2.y;
  const extra = row2.z;
  const is = (id: number) => oneMinus(step(0.5, abs(kind.sub(id))));
  const notches = max(abs(amount), float(1));
  /** The share of an index's period it spends moving. */
  const share = max(extra, float(0.01));

  // How much of each manner applies while the state passes from one code
  // to the next.
  const running = step(0, work);
  const hesitating = saturate(state)
    .mul(oneMinus(saturate(state.sub(1))))
    .mul(running);
  const jammed = saturate(state.sub(1))
    .mul(oneMinus(saturate(state.sub(2))))
    .mul(running);
  const fallen = saturate(state.sub(2));

  // Where the part is in its period: whole cycles done, and the share of
  // the one under way.
  const cycles = work.mul(row1.w).add(row2.x).mul(running);
  const done = floor(cycles);
  const even = cycles.sub(done);
  // Hesitating, the cycle takes as long as ever but is uneven: nearly
  // stopped, then catching up, a few times over.
  const catches = Math.PI * 2 * HESITATIONS;
  const fits = even.add(sin(even.mul(catches)).mul(HESITATION / catches));
  // Jammed, the part is held near the start of its motion. On every beat it
  // pushes on as far as `reach` and slips back, each piece in its own time.
  const beat = fract(time.mul(JAM_RATE).add(float(instanceIndex).mul(0.37)));
  const push = smoothstep(0, 0.72, beat).sub(smoothstep(0.78, 1, beat));
  const from = is(MOTION.spin)
    .mul(0.1)
    .add(is(MOTION.index).mul(share).mul(0.2))
    .add(is(MOTION.swing).mul(0.105))
    .add(is(MOTION.slide).mul(0.07))
    .add(is(MOTION.convey).mul(0.09));
  const reach = is(MOTION.spin)
    .mul(0.065)
    .add(
      is(MOTION.index)
        .mul(share)
        .mul(min(notches.mul(0.065), float(0.6))),
    )
    .add(is(MOTION.swing).mul(0.09))
    .add(is(MOTION.slide).mul(0.2))
    .add(is(MOTION.convey).mul(0.24));
  const t = mix(mix(even, fits, hesitating), from.add(reach.mul(push)), jammed);

  const thereAndBack = smoothstep(0, 0.35, t).sub(smoothstep(0.5, 0.85, t));
  const carried = smoothstep(0, 0.6, t);
  const notch = mod(done, notches)
    .add(smoothstep(0, share, t))
    .div(notches)
    .mul(sign(amount));

  const angle = is(MOTION.spin)
    .mul(t)
    .mul(amount)
    .add(is(MOTION.index).mul(notch))
    .mul(Math.PI * 2)
    .add(is(MOTION.swing).mul(thereAndBack).mul(amount));
  const travel = is(MOTION.slide).mul(thereAndBack).add(is(MOTION.convey).mul(carried)).mul(amount);
  const joins = step(0.5, extra);
  const leaves = step(0.5, extra.negate());
  const size = float(1).add(
    is(MOTION.convey).mul(joins.mul(carried.sub(1)).sub(leaves.mul(carried))),
  );

  // Down, the part drops into the way it hangs and settles there: a little
  // too far, then back.
  const short = fallen.sub(1);
  const settled = float(1).add(short.mul(short).mul(short).mul(2.4)).add(short.mul(short).mul(1.4));
  const hang = row3.w.mul(settled);

  // The harder a jammed part pushes, the more it shakes: across the piece,
  // never up and down, so it stays on what carries it.
  const shake = sin(time.mul(Math.PI * 2 * STRAIN_RATE).add(float(instanceIndex).mul(2.1)))
    .mul(push)
    .mul(jammed)
    .mul(step(0.5, kind))
    .mul(STRAIN);

  // Its own motion first, then the way it hangs, then where it has got to.
  const pose = (v: ShaderNode) => turned(turned(v, axis, angle), row3.xyz, hang);
  const arm = positionGeometry.sub(pivot).mul(size);
  const moved = pivot
    .add(pose(arm))
    .add(axis.mul(travel))
    .add(vec3(0.8, 0, 0.6).mul(shake));
  return { shift: moved.sub(positionGeometry), normal: pose(normalGeometry) };
}

/**
 * A solid, matte piece, with the one part of it that works.
 *
 * Geometry: `aPart` = (0 body, 1 lighter detail, 2 mark; mechanism column)
 *           and `aAo`, how open each vertex is to the sky, baked when the
 *           piece was modelled.
 * Instance: `aTint` rgb — the piece colour, already decided by the scene
 *           (neutral when healthy, a signal colour when not) — and
 *           `aFx` = (seconds its mechanism has worked or -1 for at rest,
 *           the state it works in from 0 healthy to 3 down,
 *           visibility, size).
 */
export function createPieceMaterial(
  theme: SceneTheme,
  mechanisms: THREE.DataTexture,
): THREE.MeshBasicNodeMaterial {
  const material = flat(new THREE.MeshBasicNodeMaterial());
  const tint = attribute('aTint', 'vec3');
  const fx = attribute('aFx', 'vec4');
  const visibility = fx.z;
  const part = attribute('aPart', 'vec2').x;
  const detail = saturate(part);
  const mark = saturate(part.sub(1));

  // By the time this runs the instance has been placed and scaled. A piece
  // is never turned, so what its mechanism adds only needs the piece's size,
  // and the turned normal is already in world space.
  const working = mechanism(mechanisms, fx.x, fx.y);
  material.positionNode = positionLocal.add(working.shift.mul(fx.w));
  const normal = normalize(varying(working.normal));

  // Details are a neighbouring tone of the same piece; marks take the
  // contrasting "core" colour so a silhouette's defining feature stays readable.
  const surface = mix(mix(tint, tint.mul(theme.pieceDetail), detail), theme.pieceCore, mark);
  // A little more modelling than the plates get: the key light does more of
  // the work, and the baked occlusion darkens what the piece itself shades,
  // which is what turns a silhouette into a solid. A face turned to the
  // light shows the palette colour itself, so a porcelain piece is as light
  // as the field it stands on and is read from its sides and its shadow.
  const key = saturate(dot(normal, vec3(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z)));
  const sky = normal.y.mul(0.5).add(0.5);
  const light = float(0.6).add(key.mul(0.36)).add(sky.mul(0.1));
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
 * A label is hung from its anchor: `aAlign` says where the middle of the
 * text goes, in units of its own width and height. A service's name stands
 * on its anchor, `(0, 0.5)`; a plate's name is pushed off the rim to whichever
 * side is outward on screen, so it never lies across what it names.
 *
 * Instance: `aPos`, `aSize` (width, height in pixels), `aRect` (u, v, w, h),
 *           `aAlign`, `aLabelFx` = (visibility, always shown, alarm, _).
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
  const size = attribute('aSize', 'vec2').mul(pixelScale);
  // Pixels become world units at the anchor's depth, along the camera's own
  // right and up, which is the plane the label is drawn in.
  const depth = cameraViewMatrix.mul(vec4(position, 1)).z.negate();
  const hang = attribute('aAlign', 'vec2').mul(size).mul(depth);
  material.positionNode = position.add(cameraWorldMatrix.mul(vec4(hang, 0, 0)).xyz);
  material.scaleNode = size;

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
  // Selection: a ring in the colour of the viewer's attention.
  layer = over(layer, theme.focus, band(0.74, 0.034).mul(ring.w));

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
 * A region's plate: a low solid with a top face, round in the regions
 * arrangement and rectangular in the swimlanes.
 *
 * Geometry: a unit cylinder or a unit box, scaled by the mesh to the size of
 * the plate. The outline on the top face is measured in world units from
 * that scale, so it is the same hairline on a plate of any size.
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
  const matrix: ShaderNode = modelWorldMatrix;
  const across = length(matrix[0].xyz);
  const deep = length(matrix[2].xyz);
  // Distance from the rim, inward.
  const inset = round
    ? oneMinus(length(positionGeometry.xz)).mul(across)
    : min(
        float(0.5).sub(abs(positionGeometry.x)).mul(across),
        float(0.5).sub(abs(positionGeometry.z)).mul(deep),
      );
  // The outline is a hairline normally and a firm band in an abnormal state.
  const band = mix(float(0.14), float(0.5), alarm);
  const outline = oneMinus(smoothstep(band.sub(0.05), band, inset));
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

/** How far past a plate's rim its shadow reaches on the table. */
export const SHADOW_REACH = 2;

/**
 * The soft shadow a plate casts on the table.
 *
 * Geometry: a square lying in XZ, scaled to the plate's half extents plus
 * `SHADOW_REACH`. The softness is measured in world units from that scale,
 * so plates of every size and shape throw the same shadow.
 */
export function createCastShadowMaterial(
  theme: SceneTheme,
  round: boolean,
  strength: number,
): THREE.MeshBasicNodeMaterial {
  const material = blended(new THREE.MeshBasicNodeMaterial());
  const matrix: ShaderNode = modelWorldMatrix;
  const half = vec2(length(matrix[0].xyz), length(matrix[2].xyz));
  const p = uv().sub(0.5).mul(2).mul(half);
  const plate = max(half.sub(SHADOW_REACH), vec2(0, 0));
  const beyond = abs(p).sub(plate);
  // Distance from the plate's rim, negative under the plate.
  const d = round
    ? length(p).sub(plate.x)
    : length(max(beyond, vec2(0, 0))).add(min(max(beyond.x, beyond.y), float(0)));
  const falloff = oneMinus(smoothstep(-0.7, SHADOW_REACH, d));
  material.colorNode = theme.shadow;
  material.opacityNode = falloff.mul(theme.shadowOpacity).mul(strength);
  return material;
}

// ---------------------------------------------------------------------------
// The traced request
// ---------------------------------------------------------------------------

/**
 * Sprites positioned on the CPU: the head and tail of a traced request, the
 * ring that opens where it arrived, and the badge that marks where a request
 * was stopped.
 *
 * Instance: `aPos`, `aColor`, `aTracerFx` = (size, opacity, form, _) where
 *           form is 0 for a disc, 1 for a ring and 2 for a badge: a solid
 *           disc with a cross cut out of it, so "stopped here" is a shape
 *           before it is a colour.
 */
export function createTracerMaterial(theme: SceneTheme): THREE.SpriteNodeMaterial {
  const material = blended(new THREE.SpriteNodeMaterial());
  material.depthTest = false;
  const fx = attribute('aTracerFx', 'vec4');
  material.positionNode = attribute('aPos', 'vec3');
  material.scaleNode = vec2(fx.x, fx.x);
  const p = uv().sub(0.5).mul(2);
  const r = length(p);
  const disc = coverage(r.sub(0.72));
  const ring = coverage(abs(r.sub(0.82)).sub(0.07));
  const isRing = oneMinus(step(0.5, abs(fx.z.sub(1))));
  const isBadge = step(1.5, fx.z);
  const plate = coverage(r.sub(0.9));
  // The two arms of the cross, each measured from its own diagonal.
  const arm = min(abs(p.x.add(p.y)), abs(p.x.sub(p.y))).mul(0.7071);
  const cross = coverage(arm.sub(0.1)).mul(coverage(r.sub(0.52)));
  material.colorNode = mix(attribute('aColor', 'vec3'), theme.plate, cross.mul(isBadge));
  material.opacityNode = mix(mix(disc, ring, isRing), plate, isBadge).mul(fx.y);
  return material;
}

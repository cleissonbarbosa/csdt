/**
 * Node materials written in the Three.js Shading Language (TSL).
 *
 * TSL compiles to WGSL on the WebGPU backend and to GLSL ES 3.0 on the WebGL 2
 * fallback, so there is exactly one implementation of every effect. Nothing
 * here uses compute shaders or storage buffers, which the fallback cannot
 * provide: animation is a pure function of time and per-instance data.
 */
import {
  abs,
  atan,
  attribute,
  cameraPosition,
  cos,
  cross,
  dot,
  float,
  fract,
  fwidth,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  normalView,
  normalize,
  oneMinus,
  positionGeometry,
  positionViewDirection,
  positionWorld,
  pow,
  saturate,
  sin,
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

import { COLOR, TRAFFIC_COLOR } from '@/lib/palette';

const TAU = Math.PI * 2;

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

function rgb(hex: string): ShaderNode {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}

function additive<M extends THREE.NodeMaterial>(material: M): M {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;
  return material;
}

/** Quadratic Bézier `a → c → b` evaluated at `t`. */
function bezier(a: ShaderNode, c: ShaderNode, b: ShaderNode, t: ShaderNode): ShaderNode {
  const u = oneMinus(t);
  return a
    .mul(u.mul(u))
    .add(c.mul(u.mul(t).mul(2)))
    .add(b.mul(t.mul(t)));
}

// ---------------------------------------------------------------------------
// Service nodes
// ---------------------------------------------------------------------------

/**
 * Dark, glassy structural parts with luminous accents.
 *
 * Geometry: `aPart` (0 body, 1 accent, 2 core).
 * Instance: `aTint` rgb, `aFx` = (glow, pulse Hz, visibility, selected).
 */
export function createNodeMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const tint = attribute('aTint', 'vec3');
  const fx = attribute('aFx', 'vec4');
  const part = attribute('aPart', 'float');
  const glow = fx.x;
  const pulseHz = fx.y;
  const visibility = fx.z;
  const selected = fx.w;

  const wave = sin(time.mul(pulseHz).mul(TAU)).mul(0.5).add(0.5);
  const pulse = mix(float(1), wave.mul(0.82).add(0.18), step(0.001, pulseHz));
  const accent = saturate(part);
  const core = saturate(part.sub(1));
  // Fresnel rim: silhouettes stay readable against the dark scene.
  const rim = pow(oneMinus(saturate(dot(normalView, positionViewDirection))), 2.6);
  const dim = mix(float(0.16), float(1), visibility);

  material.colorNode = mix(vec3(0.04, 0.062, 0.105), tint.mul(0.42), accent).mul(dim);
  material.emissiveNode = tint
    .mul(
      accent
        .mul(glow)
        .mul(pulse)
        .mul(mix(float(1), float(2.4), core))
        .add(rim.mul(float(0.5).add(selected.mul(2.2)))),
    )
    .mul(dim);
  material.roughness = 0.36;
  material.metalness = 0.62;
  return material;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export interface EdgeUniforms {
  /** World units per pixel at unit distance: `2·tan(fov/2) / viewportHeight`. */
  pixelScale: Uniform<number>;
}

/**
 * Camera-facing ribbons along quadratic curves, with light flowing source →
 * target. One instanced draw call for every edge.
 *
 * Geometry: `position` = (t, side, 0), t ∈ [0,1], side ∈ {-1, +1}.
 * Instance: `aStart`, `aEnd`, `aCtrl`, `aColor`,
 *           `aEdgeFx` = (intensity, flow speed, width px, visibility).
 */
export function createEdgeMaterial(): {
  material: THREE.MeshBasicNodeMaterial;
  uniforms: EdgeUniforms;
} {
  const material = additive(new THREE.MeshBasicNodeMaterial());
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
  // Constant on-screen width regardless of distance.
  const width = max(length(toCamera).mul(pixelScale).mul(fx.z), float(0.012));
  material.positionNode = point.add(sideways.mul(side).mul(width));

  const across = oneMinus(abs(side));
  const flow = fract(t.mul(5).sub(time.mul(fx.y)));
  const dash = smoothstep(0, 0.3, flow).mul(oneMinus(smoothstep(0.5, 1, flow)));
  // Fade out where the ribbon meets a node so shapes stay clean.
  const ends = smoothstep(0, 0.07, t).mul(oneMinus(smoothstep(0.93, 1, t)));
  material.colorNode = attribute('aColor', 'vec3');
  material.opacityNode = pow(across, 1.6)
    .mul(mix(float(0.3), float(1), dash))
    .mul(fx.x)
    .mul(ends)
    .mul(fx.w);
  return { material, uniforms: { pixelScale } };
}

// ---------------------------------------------------------------------------
// Traffic particles
// ---------------------------------------------------------------------------

/** Rows of the per-edge data texture read by the particle shader. */
export const EDGE_ROWS = 4;

export interface ParticleUniforms {
  /** Global multiplier on particle density (adaptive quality). */
  density: Uniform<number>;
  size: Uniform<number>;
}

/**
 * Every request in flight, as stateless GPU particles.
 *
 * A particle owns only static data: which edge it lives on and four random
 * seeds. Everything that changes — how many particles an edge shows, how fast
 * they move, what share is errors, rejections or suspicious — lives in a tiny
 * float texture with one column per edge. The CPU touches that texture, never
 * the particles; position, category, colour and size are derived in the vertex
 * shader from `time`.
 *
 * Texture rows (per edge column):
 *   0: start.xyz, density      1: end.xyz, speed
 *   2: control.xyz, kind       3: error, rejected, suspicious share, visibility
 *
 * Instance: `aEdge` (column), `aSeed` (phase, speed jitter, lane, roll).
 */
export function createParticleMaterial(data: THREE.DataTexture): {
  material: THREE.SpriteNodeMaterial;
  uniforms: ParticleUniforms;
} {
  const material = additive(new THREE.SpriteNodeMaterial());
  const density = uniform(1);
  const size = uniform(0.34);

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
  // On synchronous edges a share of the normal particles are responses
  // travelling back to the caller.
  const isResponse = isNormal.mul(step(0.66, fract(seed.z.mul(7.31)))).mul(step(kind, 2.5));

  const progress = fract(seed.x.add(time.mul(row1.w).mul(seed.y.mul(0.6).add(0.7))));
  // Rejected traffic never arrives: it stops short of the target and flares.
  const forward = mix(progress, progress.mul(0.9), isRejected);
  const t = mix(forward, oneMinus(progress), isResponse);
  const lane = vec3(sin(seed.x.mul(41.3)), cos(seed.y.mul(57.9)), sin(seed.z.mul(33.7))).mul(0.17);
  material.positionNode = bezier(row0.xyz, row2.xyz, row1.xyz, t).add(lane);

  const visible = step(fract(seed.x.mul(13.7).add(seed.y.mul(3.1))), row0.w.mul(density));
  const grow = smoothstep(0, 0.06, progress).mul(oneMinus(smoothstep(0.94, 1, progress)));
  const flare = mix(float(1), smoothstep(0.7, 1, progress).mul(2.2).add(1), isRejected);
  const scale = size
    .mul(visible)
    .mul(grow)
    .mul(flare)
    .mul(float(1).add(isError.mul(0.7)).add(isSuspicious.mul(0.35)))
    .mul(mix(float(1), float(0.72), isResponse))
    .mul(mix(float(0.62), float(1), seed.y));
  material.scaleNode = varying(vec2(scale, scale));

  let tone: ShaderNode = rgb(TRAFFIC_COLOR.request);
  tone = mix(tone, rgb(TRAFFIC_COLOR.authentication), step(0.5, kind));
  tone = mix(tone, rgb(TRAFFIC_COLOR.authorization), step(1.5, kind));
  tone = mix(tone, rgb(TRAFFIC_COLOR.queue), step(2.5, kind));
  tone = mix(tone, rgb(TRAFFIC_COLOR.background), step(3.5, kind));
  tone = mix(tone, rgb(TRAFFIC_COLOR.response), isResponse);
  tone = mix(tone, rgb(TRAFFIC_COLOR.error), isError);
  tone = mix(tone, rgb(TRAFFIC_COLOR.rejected), isRejected);
  tone = mix(tone, rgb(TRAFFIC_COLOR.suspicious), isSuspicious);
  const brightness = mix(float(0.55), float(1), step(kind, 3.5)).mul(row3.w);

  const radial = length(uv().sub(0.5)).mul(2);
  const halo = oneMinus(smoothstep(0, 1, radial));
  const hot = pow(oneMinus(saturate(radial)), 4);
  const vTone: ShaderNode = varying(tone);
  material.colorNode = vTone.mul(halo.add(hot.mul(1.6)));
  material.opacityNode = halo.mul(varying(brightness));
  return { material, uniforms: { density, size } };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface LabelUniforms {
  fadeNear: Uniform<number>;
  fadeFar: Uniform<number>;
  opacity: Uniform<number>;
}

/**
 * Billboarded text from a canvas atlas: every label in one draw call.
 *
 * Instance: `aPos`, `aSize` (world width, height), `aRect` (u, v, w, h),
 *           `aLabelFx` = (visibility, always-on boost, tint mix, _).
 */
export function createLabelMaterial(atlas: THREE.Texture): {
  material: THREE.SpriteNodeMaterial;
  uniforms: LabelUniforms;
} {
  const material = new THREE.SpriteNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.toneMapped = false;
  const fadeNear = uniform(40);
  const fadeFar = uniform(80);
  const opacity = uniform(1);

  const position = attribute('aPos', 'vec3');
  const rect = attribute('aRect', 'vec4');
  const fx = attribute('aLabelFx', 'vec4');
  material.positionNode = position;
  material.scaleNode = attribute('aSize', 'vec2');

  const texel = texture(atlas, rect.xy.add(uv().mul(rect.zw)));
  const distance = length(cameraPosition.sub(position));
  const fade = max(oneMinus(smoothstep(fadeNear, fadeFar, distance)), fx.y);
  material.colorNode = mix(rgb(COLOR.inkDim), rgb(COLOR.ink), fx.y).mul(
    mix(float(1), float(1.5), fx.z),
  );
  material.opacityNode = texel.a.mul(varying(fade)).mul(fx.x).mul(opacity);
  return { material, uniforms: { fadeNear, fadeFar, opacity } };
}

// ---------------------------------------------------------------------------
// Ground rings (health, selection, impact shockwaves)
// ---------------------------------------------------------------------------

/**
 * A flat ring under every node.
 *
 * Geometry: unit quad lying in XZ.
 * Instance: `aPos`, `aColor`,
 *           `aRing` = (radius, intensity, shockwave start time, selected).
 */
export function createRingMaterial(): THREE.MeshBasicNodeMaterial {
  const material = additive(new THREE.MeshBasicNodeMaterial());
  material.side = THREE.DoubleSide;
  const ring = attribute('aRing', 'vec4');
  material.positionNode = attribute('aPos', 'vec3').add(positionGeometry.mul(ring.x.mul(4.4)));

  const centered = uv().sub(0.5).mul(2);
  const d = length(centered);
  const band = (radius: number, width: number) =>
    smoothstep(radius - width, radius, d).mul(oneMinus(smoothstep(radius, radius + width, d)));
  const base = band(0.46, 0.03);
  const disc = pow(oneMinus(saturate(d.div(0.46))), 2).mul(0.22);
  // Selection: a second, dashed ring that rotates.
  const angle = atan(centered.y, centered.x).div(TAU).add(time.mul(0.06));
  const dashes = step(0.5, fract(angle.mul(18)));
  const selection = band(0.62, 0.022).mul(dashes).mul(ring.w).mul(1.6);
  // Impact: a ring that expands and fades once from `ring.z`.
  const age = time.sub(ring.z);
  const alive = step(0, age).mul(oneMinus(smoothstep(0.0, 1.4, age)));
  const front = saturate(age.div(1.4)).mul(0.52).add(0.46);
  const shock = smoothstep(front.sub(0.07), front, d)
    .mul(oneMinus(smoothstep(front, front.add(0.03), d)))
    .mul(alive)
    .mul(1.8);

  material.colorNode = attribute('aColor', 'vec3');
  material.opacityNode = base.add(disc).mul(ring.y).add(selection).add(shock);
  return material;
}

// ---------------------------------------------------------------------------
// Region platforms
// ---------------------------------------------------------------------------

export interface PlateUniforms {
  tint: Uniform<THREE.Color>;
  /** 0 = healthy calm … 1 = alarmed. */
  alarm: Uniform<number>;
  visibility: Uniform<number>;
}

/** A translucent disc with a lit rim, range rings and a slow radar sweep. */
export function createPlateMaterial(halo: boolean): {
  material: THREE.MeshBasicNodeMaterial;
  uniforms: PlateUniforms;
} {
  const material = additive(new THREE.MeshBasicNodeMaterial());
  material.side = THREE.DoubleSide;
  const tint = uniform(new THREE.Color(COLOR.blue));
  const alarm = uniform(0);
  const visibility = uniform(1);

  const centered = uv().sub(0.5).mul(2);
  const d = length(centered);
  const rim = smoothstep(0.955, 0.985, d).mul(oneMinus(smoothstep(0.985, 1, d)));
  const innerRim = smoothstep(0.9, 0.915, d)
    .mul(oneMinus(smoothstep(0.915, 0.93, d)))
    .mul(0.35);
  const rings = oneMinus(
    smoothstep(
      0,
      0.012,
      abs(fract(d.mul(4)).sub(0.5))
        .sub(0.488)
        .abs(),
    ),
  )
    .mul(0.045)
    .mul(step(d, 0.9));
  const angle = atan(centered.y, centered.x).div(TAU);
  const sweep = pow(fract(angle.sub(time.mul(0.045))), 10)
    .mul(0.09)
    .mul(step(d, 0.955));
  const fill = oneMinus(d).mul(0.02).add(0.008).mul(step(d, 0.955));
  const beat = mix(float(1), sin(time.mul(5)).mul(0.3).add(0.7), alarm);

  material.colorNode = tint;
  const body = halo ? rim.add(innerRim) : rim.add(innerRim).add(rings).add(sweep).add(fill);
  material.opacityNode = body.mul(beat).mul(visibility);
  return { material, uniforms: { tint, alarm, visibility } };
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** An infinite-looking floor grid that dissolves into the dark. */
export function createGridMaterial(radius: number): THREE.MeshBasicNodeMaterial {
  const material = additive(new THREE.MeshBasicNodeMaterial());
  const plane = positionWorld.xz;
  const line = (cell: number) => {
    const coordinate = plane.div(cell);
    const distance = abs(fract(coordinate.sub(0.5)).sub(0.5)).div(fwidth(coordinate));
    return oneMinus(min(min(distance.x, distance.y), float(1)));
  };
  const r = length(plane);
  const fade = oneMinus(smoothstep(radius * 0.25, radius, r));
  const glow = oneMinus(smoothstep(0, radius * 0.55, r)).mul(0.05);
  material.colorNode = mix(rgb('#2B4B7E'), rgb(COLOR.cyan), 0.25);
  material.opacityNode = line(4).mul(0.05).add(line(20).mul(0.1)).mul(fade).add(glow);
  return material;
}

/** Distant points of light with a slow twinkle. Instance: `aPos`, `aStar`. */
export function createStarMaterial(): THREE.SpriteNodeMaterial {
  const material = additive(new THREE.SpriteNodeMaterial());
  material.sizeAttenuation = false;
  const star = attribute('aStar', 'vec4');
  material.positionNode = attribute('aPos', 'vec3');
  material.scaleNode = vec2(star.x, star.x);
  const twinkle = sin(time.mul(star.z).add(star.y.mul(TAU)))
    .mul(0.35)
    .add(0.65);
  const radial = length(uv().sub(0.5)).mul(2);
  material.colorNode = mix(rgb('#9FC4FF'), rgb('#FFFFFF'), star.w);
  material.opacityNode = oneMinus(smoothstep(0, 1, radial))
    .mul(twinkle)
    .mul(0.75);
  return material;
}

/** Soft additive sprites positioned on the CPU (tracers and bursts). */
export function createTracerMaterial(): THREE.SpriteNodeMaterial {
  const material = additive(new THREE.SpriteNodeMaterial());
  material.depthTest = false;
  const fx = attribute('aTracerFx', 'vec4');
  material.positionNode = attribute('aPos', 'vec3');
  material.scaleNode = vec2(fx.x, fx.x);
  const radial = length(uv().sub(0.5)).mul(2);
  const halo = oneMinus(smoothstep(0, 1, radial));
  // `fx.z` > 0 turns the sprite into an expanding ring (a burst).
  const ring = smoothstep(0.55, 0.8, radial).mul(oneMinus(smoothstep(0.8, 1, radial)));
  material.colorNode = attribute('aColor', 'vec3').mul(float(1).add(pow(halo, 3).mul(2)));
  material.opacityNode = mix(halo, ring, fx.z).mul(fx.y);
  return material;
}

/** The vertical beam marking the selected node. */
export function createBeamMaterial(): {
  material: THREE.MeshBasicNodeMaterial;
  tint: Uniform<THREE.Color>;
} {
  const material = additive(new THREE.MeshBasicNodeMaterial());
  material.side = THREE.DoubleSide;
  const tint = uniform(new THREE.Color(COLOR.cyan));
  const rise = uv().y;
  const shimmer = sin(rise.mul(40).sub(time.mul(4)))
    .mul(0.15)
    .add(0.85);
  material.colorNode = tint;
  material.opacityNode = pow(oneMinus(rise), 2.2).mul(0.5).mul(shimmer);
  return { material, tint };
}

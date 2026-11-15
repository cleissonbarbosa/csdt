/**
 * The scene, as an imperative system.
 *
 * React mounts the canvas and forwards state; everything that happens per
 * frame happens here, without React. The whole topology renders in a fixed,
 * small number of draw calls regardless of its size:
 *
 *   nodes      one instanced mesh per service type (≤ 12)
 *   rings      1      edges   1      particles   1      labels   1
 *
 * Snapshots set targets; the controller eases displayed values toward them
 * every frame, so the scene moves continuously between 5 Hz updates.
 */
import {
  HEALTH_BY_CODE,
  SERVICE_TYPES,
  type AuthorizationDecision,
  type Relationship,
  type ServiceType,
  type TelemetrySnapshot,
  type Topology,
} from '@aegis/contracts';
import CameraControls from 'camera-controls';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { length, mix, pass, screenUV, smoothstep } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { COLOR, HEALTH_COLOR, SERVICE_TYPE } from '@/lib/palette';

import { buildNodeGeometry, SPIN_RATE } from './geometries';
import { buildLabelAtlas, loadLabelFonts, type LabelAtlas } from './labels';
import {
  bezierPoint,
  computeLayout,
  curveLength,
  edgeControl,
  nodePosition,
  type LayoutMode,
  type SceneLayout,
  type Vec3,
} from './layout';
import {
  createBeamMaterial,
  createEdgeMaterial,
  createGridMaterial,
  createLabelMaterial,
  createNodeMaterial,
  createParticleMaterial,
  createPlateMaterial,
  createRingMaterial,
  createStarMaterial,
  createTracerMaterial,
  EDGE_ROWS,
  type EdgeUniforms,
  type LabelUniforms,
  type ParticleUniforms,
  type PlateUniforms,
} from './materials';
import { AdaptiveQuality, FrameStats, QUALITY, type QualityLevel } from './quality';
import type { Backend } from './renderer';

CameraControls.install({
  THREE: {
    Vector2: THREE.Vector2,
    Vector3: THREE.Vector3,
    Vector4: THREE.Vector4,
    Quaternion: THREE.Quaternion,
    Matrix4: THREE.Matrix4,
    Spherical: THREE.Spherical,
    Box3: THREE.Box3,
    Sphere: THREE.Sphere,
    Raycaster: THREE.Raycaster,
  },
});

export type SceneSelection = { kind: 'node' | 'edge'; id: string } | null;

export interface SceneHooks {
  onHover(nodeId: string | null): void;
  onSelect(selection: SceneSelection): void;
  onQuality(level: QualityLevel): void;
  onTraceEnd(): void;
}

export interface SceneOptions {
  quality: QualityLevel | 'auto';
  bloom: boolean;
  labels: boolean;
  autoRotate: boolean;
  reducedMotion: boolean;
}

export interface SceneStats {
  fps: number;
  frameMs: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  /** Particles currently visible (estimated from per-edge density). */
  particles: number;
  particleCapacity: number;
  nodes: number;
  edges: number;
  backend: Backend;
  quality: QualityLevel;
  pixelRatio: number;
  /** GPU resources currently alive, as tracked by the renderer. */
  geometries: number;
  textures: number;
}

const EDGE_SEGMENTS = 20;
const PARTICLE_BUDGET = 26_000;
const TRAIL = 18;
const FOV = 40;
/** Relationship → particle kind understood by the particle shader. */
const KIND: Record<Relationship, number> = {
  route: 0,
  call: 0,
  data: 0,
  auth: 1,
  authz: 2,
  publish: 3,
  consume: 3,
  replication: 4,
  telemetry: 4,
};

const HEALTH_GLOW = [1.25, 1.7, 2.5, 0.1] as const;
const HEALTH_PULSE = [0, 0.7, 2.4, 0] as const;

function hex(color: string): Vec3 {
  const c = new THREE.Color(color);
  return [c.r, c.g, c.b];
}

const EDGE_COLOR: Vec3[] = [
  hex('#3D8BD8'),
  hex(COLOR.violet),
  hex(COLOR.blue),
  hex('#B9A8F2'),
  hex('#3A5680'),
];
const STATUS_COLOR: (Vec3 | null)[] = [
  null,
  null,
  hex(COLOR.warning),
  hex(COLOR.critical),
  hex(COLOR.magenta),
];
const CRITICAL = hex(COLOR.critical);
const HEALTH_TINT: Vec3[] = HEALTH_BY_CODE.map((h) => hex(HEALTH_COLOR[h]));

/** Small deterministic generator: the scene looks the same on every load. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function instancedQuad(count: number, flat = false): THREE.InstancedBufferGeometry {
  const base = new THREE.PlaneGeometry(1, 1);
  if (flat) base.rotateX(-Math.PI / 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(base.getIndex());
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setAttribute('uv', base.getAttribute('uv'));
  geometry.instanceCount = count;
  return geometry;
}

function instanced(
  geometry: THREE.BufferGeometry,
  name: string,
  itemSize: number,
  count: number,
  dynamic = true,
): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(
    new Float32Array(count * itemSize),
    itemSize,
  );
  if (dynamic) attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
}

interface TypeBatch {
  mesh: THREE.InstancedMesh;
  tint: THREE.InstancedBufferAttribute;
  fx: THREE.InstancedBufferAttribute;
}

interface TraceSegment {
  a: Vec3;
  c: Vec3;
  b: Vec3;
  length: number;
}

interface Trace {
  segments: TraceSegment[];
  total: number;
  travelled: number;
  color: Vec3;
  edges: number[];
  burstAt: Vec3;
  burstAge: number;
  done: boolean;
}

export class SceneController {
  private readonly root = new THREE.Group();
  private readonly world = new THREE.Group();
  private readonly controls: CameraControls;
  private readonly pipeline: THREE.RenderPipeline;
  private readonly bloomNode: ReturnType<typeof bloom>;
  private readonly adaptive = new AdaptiveQuality('high');
  private readonly frames = new FrameStats();
  private readonly disposables: { dispose(): void }[] = [];
  private worldDisposables: { dispose(): void }[] = [];

  private options: SceneOptions;
  private quality: QualityLevel = 'high';
  private time = 0;
  private userMoved = false;
  private disposed = false;
  private frameDrawCalls = 0;
  private frameTriangles = 0;
  private insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private viewKey = '';

  // Topology-bound state -----------------------------------------------------
  private topology: Topology | null = null;
  private layout: SceneLayout | null = null;
  private layoutMode: LayoutMode = 'regions';
  private n = 0;
  private m = 0;
  private nodeTypeIndex = new Uint8Array(0);
  private nodeSlot = new Uint16Array(0);
  private nodeIds: string[] = [];
  private edgeIds: string[] = [];
  private edgeSource = new Uint32Array(0);
  private edgeTarget = new Uint32Array(0);
  private edgeKind = new Uint8Array(0);
  private edgeCapacity = new Float32Array(0);
  private edgeCtrl = new Float32Array(0);
  private batches: (TypeBatch | null)[] = [];
  private trafficReference = 1;

  // Targets (from snapshots and UI) and displayed values ----------------------
  private health = new Uint8Array(0);
  private load = new Float32Array(0);
  private visibilityTarget = new Float32Array(0);
  private visibility = new Float32Array(0);
  private impacted = new Uint8Array(0);
  private tint = new Float32Array(0);
  private glow = new Float32Array(0);
  private spin = new Float32Array(0);
  private shockAt = new Float32Array(0);
  private edgeTraffic = new Float32Array(0);
  private edgeError = new Float32Array(0);
  private edgeRejected = new Float32Array(0);
  private edgeSuspicious = new Float32Array(0);
  private edgeSecurity = new Uint8Array(0);
  private edgeDensity = new Float32Array(0);
  private edgeErrShown = new Float32Array(0);
  private edgeRejShown = new Float32Array(0);
  private edgeSusShown = new Float32Array(0);
  private edgeHighlight = new Float32Array(0);
  private hasSnapshot = false;

  private selectedNode = -1;
  private selectedEdge = -1;
  private hoveredNode = -1;

  // GPU resources -------------------------------------------------------------
  private ringAttr: {
    pos: THREE.InstancedBufferAttribute;
    color: THREE.InstancedBufferAttribute;
    ring: THREE.InstancedBufferAttribute;
  } | null = null;
  private edgeAttr: {
    color: THREE.InstancedBufferAttribute;
    fx: THREE.InstancedBufferAttribute;
  } | null = null;
  private edgeUniforms: EdgeUniforms | null = null;
  private particleData: THREE.DataTexture | null = null;
  private particleUniforms: ParticleUniforms | null = null;
  private particleCapacity = 0;
  private labelAttr: { fx: THREE.InstancedBufferAttribute } | null = null;
  private labelUniforms: LabelUniforms | null = null;
  private labelMesh: THREE.Mesh | null = null;
  private plates: { uniforms: PlateUniforms; regionId: string }[] = [];
  private stars: THREE.Mesh | null = null;
  private readonly beam: THREE.Mesh;
  private readonly beamTint: ReturnType<typeof createBeamMaterial>['tint'];
  private readonly tracerMesh: THREE.Mesh;
  private readonly tracerAttr: {
    pos: THREE.InstancedBufferAttribute;
    color: THREE.InstancedBufferAttribute;
    fx: THREE.InstancedBufferAttribute;
  };
  private trace: Trace | null = null;

  // Interaction ----------------------------------------------------------------
  private readonly pointer = {
    x: 0,
    y: 0,
    inside: false,
    dirty: false,
    downX: 0,
    downY: 0,
    downAt: 0,
  };
  private tooltip: HTMLElement | null = null;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly viewProjection = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();
  private readonly ray = new THREE.Ray();

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly backend: Backend,
    private readonly hooks: SceneHooks,
    options: SceneOptions,
  ) {
    this.options = options;
    renderer.info.autoReset = false;
    scene.background = new THREE.Color(COLOR.void);
    camera.fov = FOV;
    camera.near = 0.5;
    camera.far = 4000;
    camera.updateProjectionMatrix();

    this.root.add(this.world);
    scene.add(this.root);
    const key = new THREE.DirectionalLight('#CFE1FF', 2.1);
    key.position.set(0.5, 1, 0.7);
    const fill = new THREE.DirectionalLight('#8A6BFF', 1.2);
    fill.position.set(-0.7, 0.35, -0.6);
    this.root.add(new THREE.HemisphereLight('#9DB8FF', '#0B1220', 1.4), key, fill);

    this.controls = new CameraControls(camera, dom);
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.smoothTime = 0.32;
    this.controls.draggingSmoothTime = 0.1;
    this.controls.dollyToCursor = true;
    this.controls.restThreshold = 0.02;
    this.controls.addEventListener('controlstart', this.onControlStart);

    // Selection beam.
    const beam = createBeamMaterial();
    this.beamTint = beam.tint;
    const beamGeometry = new THREE.CylinderGeometry(0.05, 0.42, 1, 16, 1, true);
    beamGeometry.translate(0, 0.5, 0);
    this.beam = new THREE.Mesh(beamGeometry, beam.material);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.root.add(this.beam);
    this.disposables.push(beamGeometry, beam.material);

    // Tracer sprites (comet head + trail + burst).
    const tracerGeometry = instancedQuad(TRAIL + 1);
    this.tracerAttr = {
      pos: instanced(tracerGeometry, 'aPos', 3, TRAIL + 1),
      color: instanced(tracerGeometry, 'aColor', 3, TRAIL + 1),
      fx: instanced(tracerGeometry, 'aTracerFx', 4, TRAIL + 1),
    };
    const tracerMaterial = createTracerMaterial();
    this.tracerMesh = new THREE.Mesh(tracerGeometry, tracerMaterial);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.visible = false;
    this.tracerMesh.renderOrder = 10;
    this.root.add(this.tracerMesh);
    this.disposables.push(tracerGeometry, tracerMaterial);

    // Post-processing: bloom on bright accents plus a soft vignette.
    this.pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    this.bloomNode = bloom(sceneColor, 0.55, 0.5, 0.82);
    const vignette = smoothstep(1.45, 0.4, length(screenUV.sub(0.5)).mul(2));
    this.pipeline.outputNode = sceneColor.add(this.bloomNode).mul(mix(0.5, 1, vignette));
    this.disposables.push(this.pipeline);

    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('dblclick', this.onDoubleClick);

    this.applyQuality(options.quality === 'auto' ? 'high' : options.quality);
  }

  // ---------------------------------------------------------------------------
  // Topology
  // ---------------------------------------------------------------------------

  setTopology(topology: Topology, mode: LayoutMode): void {
    const first = this.topology === null;
    const changed = this.topology?.id !== topology.id || this.n !== topology.nodes.length;
    this.clearWorld();
    this.topology = topology;
    this.layoutMode = mode;
    const layout = computeLayout(topology, mode);
    this.layout = layout;
    const n = (this.n = topology.nodes.length);
    const m = (this.m = topology.edges.length);
    const index = new Map(topology.nodes.map((node, i) => [node.id, i]));
    this.nodeIds = topology.nodes.map((node) => node.id);
    this.edgeIds = topology.edges.map((edge) => edge.id);

    if (changed) {
      this.health = new Uint8Array(n);
      this.load = new Float32Array(n);
      this.visibilityTarget = new Float32Array(n).fill(1);
      this.visibility = new Float32Array(n).fill(1);
      this.impacted = new Uint8Array(n);
      this.tint = new Float32Array(n * 3);
      this.glow = new Float32Array(n).fill(1);
      this.spin = new Float32Array(n);
      this.shockAt = new Float32Array(n).fill(-100);
      this.edgeTraffic = new Float32Array(m);
      this.edgeError = new Float32Array(m);
      this.edgeRejected = new Float32Array(m);
      this.edgeSuspicious = new Float32Array(m);
      this.edgeSecurity = new Uint8Array(m);
      this.edgeDensity = new Float32Array(m);
      this.edgeErrShown = new Float32Array(m);
      this.edgeRejShown = new Float32Array(m);
      this.edgeSusShown = new Float32Array(m);
      this.edgeHighlight = new Float32Array(m);
      this.hasSnapshot = false;
      this.selectedNode = this.selectedEdge = this.hoveredNode = -1;
      this.trace = null;
      topology.nodes.forEach((node, i) => {
        this.health[i] = HEALTH_BY_CODE.indexOf(node.metrics.health);
        this.load[i] = node.metrics.saturation;
        const c = hex(SERVICE_TYPE[node.serviceType].color);
        this.tint.set(c, i * 3);
      });
      topology.edges.forEach((edge, e) => {
        this.edgeTraffic[e] = edge.metrics.trafficRps;
        this.edgeError[e] = edge.metrics.errorRate;
      });
      const busiest = Math.max(1, ...topology.edges.map((edge) => edge.metrics.trafficRps));
      this.trafficReference = busiest * 1.5;
    }

    this.edgeSource = new Uint32Array(m);
    this.edgeTarget = new Uint32Array(m);
    this.edgeKind = new Uint8Array(m);
    topology.edges.forEach((edge, e) => {
      this.edgeSource[e] = index.get(edge.source) ?? 0;
      this.edgeTarget[e] = index.get(edge.target) ?? 0;
      this.edgeKind[e] = KIND[edge.relationship];
    });

    this.buildEnvironment(layout);
    this.buildPlates(layout);
    this.buildNodes(topology, layout);
    this.buildRings(layout);
    this.buildEdges(layout);
    this.buildParticles(layout);
    void this.buildLabels(topology, layout);
    this.applyQuality(this.quality);
    this.refreshHighlights();

    this.controls.minDistance = 6;
    this.controls.maxDistance = layout.radius * 5;
    if (first) this.intro();
    else this.frameAll(!this.options.reducedMotion);
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.worldDisposables.push(resource);
    return resource;
  }

  private clearWorld(): void {
    this.world.clear();
    for (const resource of this.worldDisposables) resource.dispose();
    this.worldDisposables = [];
    this.batches = [];
    this.plates = [];
    this.ringAttr = null;
    this.edgeAttr = null;
    this.particleData = null;
    this.labelAttr = null;
    this.labelMesh = null;
    this.stars = null;
  }

  private buildEnvironment(layout: SceneLayout): void {
    const reach = Math.max(120, layout.radius * 4);
    const gridGeometry = this.track(
      new THREE.PlaneGeometry(reach * 2, reach * 2).rotateX(-Math.PI / 2),
    );
    const grid = new THREE.Mesh(gridGeometry, this.track(createGridMaterial(reach)));
    grid.position.y = -0.9;
    grid.renderOrder = -2;
    this.world.add(grid);

    const count = 900;
    const geometry = this.track(instancedQuad(count));
    const pos = instanced(geometry, 'aPos', 3, count, false);
    const star = instanced(geometry, 'aStar', 4, count, false);
    const random = mulberry(0x5eed);
    for (let i = 0; i < count; i++) {
      // Upper hemisphere shell, denser toward the horizon.
      const azimuth = random() * Math.PI * 2;
      const elevation = Math.asin(random() ** 1.6) * 0.96 + 0.03;
      const radius = reach * (2.2 + random() * 1.4);
      pos.setXYZ(
        i,
        Math.cos(azimuth) * Math.cos(elevation) * radius,
        Math.sin(elevation) * radius,
        Math.sin(azimuth) * Math.cos(elevation) * radius,
      );
      star.setXYZW(i, 0.0016 + random() ** 3 * 0.0034, random(), 0.4 + random() * 1.6, random());
    }
    this.stars = new THREE.Mesh(geometry, this.track(createStarMaterial()));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -3;
    this.world.add(this.stars);
  }

  private buildPlates(layout: SceneLayout): void {
    const geometry = this.track(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2));
    for (const region of layout.regions) {
      const { material, uniforms } = createPlateMaterial(region.kind === 'edge');
      this.track(material);
      const plate = new THREE.Mesh(geometry, material);
      plate.position.set(region.center[0], region.center[1] + 0.02, region.center[2]);
      plate.scale.setScalar(region.radius);
      plate.renderOrder = -1;
      this.world.add(plate);
      this.plates.push({ uniforms, regionId: region.id });
    }
  }

  private buildNodes(topology: Topology, layout: SceneLayout): void {
    const material = this.track(createNodeMaterial());
    const perType = SERVICE_TYPES.map(() => [] as number[]);
    this.nodeTypeIndex = new Uint8Array(this.n);
    this.nodeSlot = new Uint16Array(this.n);
    topology.nodes.forEach((node, i) => {
      const type = SERVICE_TYPES.indexOf(node.serviceType);
      this.nodeTypeIndex[i] = type;
      this.nodeSlot[i] = perType[type]!.length;
      perType[type]!.push(i);
    });
    this.batches = SERVICE_TYPES.map((type: ServiceType, t) => {
      const members = perType[t]!;
      if (members.length === 0) return null;
      const geometry = this.track(buildNodeGeometry(type));
      const mesh = new THREE.InstancedMesh(geometry, material, members.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.world.add(mesh);
      return {
        mesh,
        tint: instanced(geometry, 'aTint', 3, members.length),
        fx: instanced(geometry, 'aFx', 4, members.length),
      };
    });
    void layout;
  }

  private buildRings(layout: SceneLayout): void {
    const geometry = this.track(instancedQuad(this.n, true));
    this.ringAttr = {
      pos: instanced(geometry, 'aPos', 3, this.n, false),
      color: instanced(geometry, 'aColor', 3, this.n),
      ring: instanced(geometry, 'aRing', 4, this.n),
    };
    for (let i = 0; i < this.n; i++) {
      const p = nodePosition(layout, i);
      const s = layout.scales[i] ?? 1;
      this.ringAttr.pos.setXYZ(i, p[0], p[1] - s * 1.32, p[2]);
    }
    const mesh = new THREE.Mesh(geometry, this.track(createRingMaterial()));
    mesh.frustumCulled = false;
    this.world.add(mesh);
  }

  private buildEdges(layout: SceneLayout): void {
    const m = this.m;
    const vertices = new Float32Array((EDGE_SEGMENTS + 1) * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i <= EDGE_SEGMENTS; i++) {
      const t = i / EDGE_SEGMENTS;
      vertices.set([t, -1, 0, t, 1, 0], i * 6);
      if (i < EDGE_SEGMENTS) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = this.track(new THREE.InstancedBufferGeometry());
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.instanceCount = m;
    const start = instanced(geometry, 'aStart', 3, m, false);
    const end = instanced(geometry, 'aEnd', 3, m, false);
    const ctrl = instanced(geometry, 'aCtrl', 3, m, false);
    this.edgeCtrl = new Float32Array(m * 3);
    for (let e = 0; e < m; e++) {
      const a = nodePosition(layout, this.edgeSource[e]!);
      const b = nodePosition(layout, this.edgeTarget[e]!);
      const c = edgeControl(a, b);
      start.setXYZ(e, ...a);
      end.setXYZ(e, ...b);
      ctrl.setXYZ(e, ...c);
      this.edgeCtrl.set(c, e * 3);
    }
    this.edgeAttr = {
      color: instanced(geometry, 'aColor', 3, m),
      fx: instanced(geometry, 'aEdgeFx', 4, m),
    };
    const { material, uniforms } = createEdgeMaterial();
    this.edgeUniforms = uniforms;
    const mesh = new THREE.Mesh(geometry, this.track(material));
    mesh.frustumCulled = false;
    this.world.add(mesh);
  }

  private buildParticles(layout: SceneLayout): void {
    const m = this.m;
    if (m === 0) return;
    // Distribute the particle budget by curve length and expected traffic.
    const lengths = new Float32Array(m);
    const weights = new Float32Array(m);
    let total = 0;
    for (let e = 0; e < m; e++) {
      const a = nodePosition(layout, this.edgeSource[e]!);
      const b = nodePosition(layout, this.edgeTarget[e]!);
      const c: Vec3 = [this.edgeCtrl[e * 3]!, this.edgeCtrl[e * 3 + 1]!, this.edgeCtrl[e * 3 + 2]!];
      lengths[e] = curveLength(a, c, b);
      const share = Math.min(
        1,
        Math.max(this.edgeTraffic[e]! * 1.5, this.trafficReference * 0.2) / this.trafficReference,
      );
      weights[e] = lengths[e]! * (0.45 + Math.sqrt(share));
      total += weights[e]!;
    }
    this.edgeCapacity = new Float32Array(m);
    let capacity = 0;
    for (let e = 0; e < m; e++) {
      const count = Math.min(900, Math.max(8, Math.round((PARTICLE_BUDGET * weights[e]!) / total)));
      this.edgeCapacity[e] = count;
      capacity += count;
    }
    this.particleCapacity = capacity;

    const geometry = this.track(instancedQuad(capacity));
    const edge = instanced(geometry, 'aEdge', 1, capacity, false);
    const seed = instanced(geometry, 'aSeed', 4, capacity, false);
    const random = mulberry(0xae615);
    let cursor = 0;
    for (let e = 0; e < m; e++) {
      for (let k = 0; k < this.edgeCapacity[e]!; k++) {
        edge.setX(cursor, e);
        seed.setXYZW(cursor, random(), random(), random(), random());
        cursor++;
      }
    }

    // One texel column per edge; see `createParticleMaterial` for the rows.
    const data = new Float32Array(m * EDGE_ROWS * 4);
    for (let e = 0; e < m; e++) {
      const a = nodePosition(layout, this.edgeSource[e]!);
      const b = nodePosition(layout, this.edgeTarget[e]!);
      data.set([a[0], a[1], a[2], 0], (0 * m + e) * 4);
      // Roughly constant world speed: short edges cycle faster.
      const speed = Math.min(1.5, Math.max(0.07, 7 / lengths[e]!));
      data.set([b[0], b[1], b[2], speed], (1 * m + e) * 4);
      data.set(
        [
          this.edgeCtrl[e * 3]!,
          this.edgeCtrl[e * 3 + 1]!,
          this.edgeCtrl[e * 3 + 2]!,
          this.edgeKind[e]!,
        ],
        (2 * m + e) * 4,
      );
      data.set([0, 0, 0, 1], (3 * m + e) * 4);
    }
    const texture = this.track(
      new THREE.DataTexture(data, m, EDGE_ROWS, THREE.RGBAFormat, THREE.FloatType),
    );
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.particleData = texture;

    const { material, uniforms } = createParticleMaterial(texture);
    this.particleUniforms = uniforms;
    const mesh = new THREE.Mesh(geometry, this.track(material));
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.world.add(mesh);
  }

  private async buildLabels(topology: Topology, layout: SceneLayout): Promise<void> {
    await loadLabelFonts();
    // The topology may have been replaced while fonts were loading.
    if (this.disposed || this.layout !== layout) return;
    const labels = [
      ...topology.nodes.map((node) => ({ text: node.name.toUpperCase(), style: 'node' as const })),
      ...layout.regions.map((region) => ({
        text: region.name.toUpperCase(),
        style: 'region' as const,
      })),
    ];
    const atlas: LabelAtlas = this.track(buildLabelAtlas(labels));
    const count = this.n + layout.regions.length;
    const geometry = this.track(instancedQuad(count));
    const pos = instanced(geometry, 'aPos', 3, count, false);
    const size = instanced(geometry, 'aSize', 2, count, false);
    const rect = instanced(geometry, 'aRect', 4, count, false);
    const fx = instanced(geometry, 'aLabelFx', 4, count);
    topology.nodes.forEach((node, i) => {
      const r = atlas.rect(node.name.toUpperCase(), 'node');
      const p = nodePosition(layout, i);
      const s = layout.scales[i] ?? 1;
      pos.setXYZ(i, p[0], p[1] - s * 1.55 - 0.42, p[2]);
      if (r) {
        size.setXY(i, 0.62 * r.aspect, 0.62);
        rect.setXYZW(i, r.u, r.v, r.w, r.h);
      }
      fx.setXYZW(i, 1, 0, 0, 0);
    });
    layout.regions.forEach((region, k) => {
      const i = this.n + k;
      const r = atlas.rect(region.name.toUpperCase(), 'region');
      // Region titles sit on the outer rim, away from the hub.
      const reach = Math.hypot(region.center[0], region.center[2]);
      const out = reach > 0.01 ? (region.radius + 1.6) / reach : 0;
      pos.setXYZ(
        i,
        region.center[0] * (1 + out),
        region.center[1] + (region.kind === 'edge' ? -1.4 : 0.9),
        region.center[2] * (1 + out),
      );
      if (r) {
        const height = region.kind === 'edge' ? 1.5 : 2.1;
        size.setXY(i, height * r.aspect, height);
        rect.setXYZW(i, r.u, r.v, r.w, r.h);
      }
      fx.setXYZW(i, 1, 1, 0.4, 0);
    });
    this.labelAttr = { fx };
    const { material, uniforms } = createLabelMaterial(atlas.texture);
    this.labelUniforms = uniforms;
    this.labelMesh = new THREE.Mesh(geometry, this.track(material));
    this.labelMesh.frustumCulled = false;
    this.labelMesh.renderOrder = 4;
    this.world.add(this.labelMesh);
    this.applyQuality(this.quality);
  }

  // ---------------------------------------------------------------------------
  // Inputs from the application
  // ---------------------------------------------------------------------------

  applySnapshot(snapshot: TelemetrySnapshot): void {
    if (snapshot.nodes.health.length !== this.n || snapshot.edges.trafficRps.length !== this.m) {
      return;
    }
    for (let i = 0; i < this.n; i++) {
      const next = snapshot.nodes.health[i]!;
      // A node that just turned critical or went down sends out a shockwave.
      if (this.hasSnapshot && next >= 2 && next > this.health[i]!) this.shockAt[i] = this.time;
      this.health[i] = next;
      this.load[i] = snapshot.nodes.saturation[i]!;
    }
    for (let e = 0; e < this.m; e++) {
      this.edgeTraffic[e] = snapshot.edges.trafficRps[e]!;
      this.edgeError[e] = snapshot.edges.errorRate[e]!;
      this.edgeRejected[e] = snapshot.edges.rejectedRps[e]!;
      this.edgeSuspicious[e] = snapshot.edges.suspiciousRps[e]!;
      this.edgeSecurity[e] = snapshot.edges.securityStatus[e]!;
    }
    for (const plate of this.plates) {
      const status = snapshot.regions.find((region) => region.id === plate.regionId);
      const code = status ? HEALTH_BY_CODE.indexOf(status.health) : 0;
      plate.uniforms.tint.value.set(code === 0 ? COLOR.blue : HEALTH_COLOR[HEALTH_BY_CODE[code]!]);
      plate.uniforms.alarm.value = code >= 2 ? 1 : 0;
    }
    this.hasSnapshot = true;
  }

  setOptions(options: SceneOptions): void {
    this.options = options;
    if (options.quality !== 'auto') this.applyQuality(options.quality);
    else this.adaptive.reset(this.quality);
    this.applyQuality(this.quality);
  }

  setLayoutMode(mode: LayoutMode): void {
    if (this.topology && mode !== this.layoutMode) this.setTopology(this.topology, mode);
  }

  /** `mask[i]` is 1 for nodes that pass the active filters, 0 otherwise. */
  setVisibility(mask: Float32Array | null): void {
    for (let i = 0; i < this.n; i++) this.visibilityTarget[i] = mask ? (mask[i] ?? 1) : 1;
  }

  setImpacted(nodeIds: readonly string[]): void {
    this.impacted.fill(0);
    for (const id of nodeIds) {
      const i = this.nodeIds.indexOf(id);
      if (i !== -1) this.impacted[i] = 1;
    }
  }

  setSelection(selection: SceneSelection): void {
    this.selectedNode = selection?.kind === 'node' ? this.nodeIds.indexOf(selection.id) : -1;
    this.selectedEdge = selection?.kind === 'edge' ? this.edgeIds.indexOf(selection.id) : -1;
    this.refreshHighlights();
  }

  setHoveredNode(nodeId: string | null): void {
    this.hoveredNode = nodeId ? this.nodeIds.indexOf(nodeId) : -1;
  }

  setTooltipElement(element: HTMLElement | null): void {
    this.tooltip = element;
  }

  private refreshHighlights(): void {
    this.edgeHighlight.fill(0);
    if (this.selectedEdge >= 0) this.edgeHighlight[this.selectedEdge] = 1;
    if (this.selectedNode >= 0) {
      for (let e = 0; e < this.m; e++) {
        if (this.edgeSource[e] === this.selectedNode || this.edgeTarget[e] === this.selectedNode) {
          this.edgeHighlight[e] = 0.75;
        }
      }
    }
    if (this.trace) for (const e of this.trace.edges) this.edgeHighlight[e] = 1;
  }

  /** Animates an authorization decision along its path through the scene. */
  playDecision(decision: AuthorizationDecision): void {
    const layout = this.layout;
    if (!layout) return;
    const segments: TraceSegment[] = [];
    const edges: number[] = [];
    let at = -1;
    const push = (from: number, to: number, e: number) => {
      const a = nodePosition(layout, from);
      const b = nodePosition(layout, to);
      const c: Vec3 = [this.edgeCtrl[e * 3]!, this.edgeCtrl[e * 3 + 1]!, this.edgeCtrl[e * 3 + 2]!];
      segments.push({ a, c, b, length: Math.max(0.1, curveLength(a, c, b)) });
    };
    let previous = -1;
    for (const hop of decision.hops) {
      const e = this.edgeIds.indexOf(hop);
      if (e === -1) continue;
      const source = this.edgeSource[e]!;
      const target = this.edgeTarget[e]!;
      // A check (authentication, authorization) returns to its caller before
      // the request moves on.
      if (at !== -1 && at !== source && previous !== -1) push(at, source, previous);
      push(source, target, e);
      edges.push(e);
      at = target;
      previous = e;
    }
    if (segments.length === 0) {
      this.hooks.onTraceEnd();
      return;
    }
    const last = segments[segments.length - 1]!;
    this.trace = {
      segments,
      total: segments.reduce((sum, s) => sum + s.length, 0),
      travelled: 0,
      color: hex(decision.decision === 'allow' ? COLOR.healthy : COLOR.critical),
      edges,
      burstAt: last.b,
      burstAge: -1,
      done: false,
    };
    this.tracerMesh.visible = true;
    this.refreshHighlights();
  }

  clearTrace(): void {
    this.trace = null;
    this.tracerMesh.visible = false;
    this.refreshHighlights();
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  private framing(): { position: Vec3; target: Vec3 } {
    const layout = this.layout;
    const center: Vec3 = layout ? layout.center : [0, 0, 0];
    const radius = layout?.radius ?? 30;
    const width = this.dom.clientWidth || 1600;
    const height = this.dom.clientHeight || 900;
    // Only the area not covered by interface panels counts as visible.
    const freeX = Math.max(0.3, (width - this.insets.left - this.insets.right) / width);
    const freeY = Math.max(0.3, (height - this.insets.top - this.insets.bottom) / height);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    // Fit the bounding sphere into the narrower of the two free view angles.
    const fit = Math.min(Math.atan(tanHalf * freeY), Math.atan(tanHalf * (width / height) * freeX));
    const distance = (radius / Math.sin(fit)) * 0.8;
    const elevation = this.layoutMode === 'regions' ? 0.52 : 0.72;
    const target: Vec3 = [center[0], center[1] * 0.55, center[2]];
    return {
      target,
      position: [
        target[0],
        target[1] + Math.sin(elevation) * distance,
        target[2] + Math.cos(elevation) * distance,
      ],
    };
  }

  private intro(): void {
    const { position, target } = this.framing();
    if (this.options.reducedMotion) {
      void this.controls.setLookAt(...position, ...target, false);
      return;
    }
    // Start high and far to one side, then settle into the framing shot.
    void this.controls.setLookAt(
      target[0] + (position[2] - target[2]) * 1.5,
      position[1] * 2.3,
      position[2] * 1.5,
      ...target,
      false,
    );
    const settle = this.controls.smoothTime;
    this.controls.smoothTime = 1.25;
    void this.controls.setLookAt(...position, ...target, true).then(() => {
      this.controls.smoothTime = settle;
    });
  }

  /**
   * Tells the scene how much of the canvas is covered by interface panels so
   * it can keep its subject centred in the area that is actually visible.
   */
  setViewInsets(insets: { left: number; right: number; top: number; bottom: number }): void {
    const changed =
      insets.left !== this.insets.left ||
      insets.right !== this.insets.right ||
      insets.top !== this.insets.top ||
      insets.bottom !== this.insets.bottom;
    this.insets = insets;
    if (changed && !this.userMoved && this.layout) this.frameAll(true);
  }

  private applyViewOffset(): void {
    const width = this.dom.clientWidth;
    const height = this.dom.clientHeight;
    if (width === 0 || height === 0) return;
    const { left, right, top, bottom } = this.insets;
    const key = `${width}x${height}:${left},${right},${top},${bottom}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    // Shift the projection so its centre is the centre of the free area.
    this.camera.setViewOffset(
      width,
      height,
      -(left - right) / 2,
      -(top - bottom) / 2,
      width,
      height,
    );
  }

  frameAll(animate = true): void {
    const { position, target } = this.framing();
    void this.controls.setLookAt(...position, ...target, animate && !this.options.reducedMotion);
  }

  resetView(): void {
    this.userMoved = false;
    this.frameAll(true);
  }

  focusNode(nodeId: string): void {
    const i = this.nodeIds.indexOf(nodeId);
    if (i === -1 || !this.layout) return;
    const p = nodePosition(this.layout, i);
    const animate = !this.options.reducedMotion;
    this.userMoved = true;
    void this.controls.moveTo(p[0], p[1], p[2], animate);
    void this.controls.dollyTo(11 + (this.layout.scales[i] ?? 1) * 5, animate);
  }

  frameRegion(regionId: string): void {
    const region = this.layout?.regions.find((r) => r.id === regionId);
    if (!region) return;
    const animate = !this.options.reducedMotion;
    this.userMoved = true;
    void this.controls.moveTo(region.center[0], region.center[1] + 2, region.center[2], animate);
    void this.controls.dollyTo(region.radius * 2.9, animate);
  }

  /** Screen position of a node in CSS pixels, or null when off screen. */
  projectNode(nodeId: string): { x: number; y: number } | null {
    const i = this.nodeIds.indexOf(nodeId);
    return i === -1 ? null : this.project(i);
  }

  private project(i: number): { x: number; y: number } | null {
    if (!this.layout) return null;
    const p = nodePosition(this.layout, i);
    this.scratch.set(p[0], p[1], p[2]).project(this.camera);
    if (this.scratch.z < -1 || this.scratch.z > 1) return null;
    const rect = this.dom.getBoundingClientRect();
    return {
      x: (this.scratch.x * 0.5 + 0.5) * rect.width,
      y: (-this.scratch.y * 0.5 + 0.5) * rect.height,
    };
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  private readonly onControlStart = () => {
    this.userMoved = true;
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = event.clientX - rect.left;
    this.pointer.y = event.clientY - rect.top;
    this.pointer.inside = true;
    this.pointer.dirty = true;
  };

  private readonly onPointerLeave = () => {
    this.pointer.inside = false;
    this.pointer.dirty = true;
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    this.pointer.downX = event.clientX;
    this.pointer.downY = event.clientY;
    this.pointer.downAt = performance.now();
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    // A press that moved or lingered was a camera drag, not a click.
    const moved = Math.hypot(
      event.clientX - this.pointer.downX,
      event.clientY - this.pointer.downY,
    );
    if (moved > 5 || performance.now() - this.pointer.downAt > 450 || event.button !== 0) return;
    this.onPointerMove(event);
    const node = this.pickNode();
    if (node !== -1) {
      this.hooks.onSelect({ kind: 'node', id: this.nodeIds[node]! });
      return;
    }
    const edge = this.pickEdge();
    this.hooks.onSelect(edge === -1 ? null : { kind: 'edge', id: this.edgeIds[edge]! });
  };

  private readonly onDoubleClick = () => {
    const node = this.pickNode();
    if (node !== -1) this.focusNode(this.nodeIds[node]!);
  };

  private pickNode(): number {
    const layout = this.layout;
    if (!layout || !this.pointer.inside) return -1;
    const rect = this.dom.getBoundingClientRect();
    this.scratch.set(
      (this.pointer.x / rect.width) * 2 - 1,
      -(this.pointer.y / rect.height) * 2 + 1,
      0.5,
    );
    this.scratch.unproject(this.camera);
    this.ray.origin.copy(this.camera.position);
    this.ray.direction.copy(this.scratch).sub(this.camera.position).normalize();
    let best = -1;
    let bestDepth = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.visibilityTarget[i]! < 0.5) continue;
      const p = nodePosition(layout, i);
      const ox = p[0] - this.ray.origin.x;
      const oy = p[1] - this.ray.origin.y;
      const oz = p[2] - this.ray.origin.z;
      const along =
        ox * this.ray.direction.x + oy * this.ray.direction.y + oz * this.ray.direction.z;
      if (along <= 0 || along >= bestDepth) continue;
      const radius = (layout.scales[i] ?? 1) * 1.15;
      if (ox * ox + oy * oy + oz * oz - along * along <= radius * radius) {
        best = i;
        bestDepth = along;
      }
    }
    return best;
  }

  private pickEdge(): number {
    const layout = this.layout;
    if (!layout || !this.pointer.inside) return -1;
    const rect = this.dom.getBoundingClientRect();
    this.viewProjection.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    const samples = 10;
    let best = -1;
    let bestDistance = 8; // pixels
    for (let e = 0; e < this.m; e++) {
      const s = this.edgeSource[e]!;
      const t = this.edgeTarget[e]!;
      if (this.visibilityTarget[s]! < 0.5 || this.visibilityTarget[t]! < 0.5) continue;
      const a = nodePosition(layout, s);
      const b = nodePosition(layout, t);
      const c: Vec3 = [this.edgeCtrl[e * 3]!, this.edgeCtrl[e * 3 + 1]!, this.edgeCtrl[e * 3 + 2]!];
      let px = 0;
      let py = 0;
      let valid = false;
      for (let k = 0; k <= samples; k++) {
        const point = bezierPoint(a, c, b, 0.08 + (0.84 * k) / samples);
        this.scratch.set(point[0], point[1], point[2]).applyMatrix4(this.viewProjection);
        const visible = this.scratch.z > -1 && this.scratch.z < 1;
        const x = (this.scratch.x * 0.5 + 0.5) * rect.width;
        const y = (-this.scratch.y * 0.5 + 0.5) * rect.height;
        if (visible && valid) {
          // Distance from the pointer to this projected segment.
          const dx = x - px;
          const dy = y - py;
          const lengthSq = dx * dx + dy * dy || 1;
          const u = Math.max(
            0,
            Math.min(1, ((this.pointer.x - px) * dx + (this.pointer.y - py) * dy) / lengthSq),
          );
          const distance = Math.hypot(
            this.pointer.x - (px + u * dx),
            this.pointer.y - (py + u * dy),
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            best = e;
          }
        }
        px = x;
        py = y;
        valid = visible;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Quality
  // ---------------------------------------------------------------------------

  private applyQuality(level: QualityLevel): void {
    const changed = level !== this.quality;
    this.quality = level;
    const profile = QUALITY[level];
    if (this.particleUniforms) this.particleUniforms.density.value = profile.particles;
    if (this.stars) this.stars.visible = profile.stars;
    if (this.labelMesh) this.labelMesh.visible = this.options.labels;
    if (this.labelUniforms && this.layout) {
      const range = Math.max(34, this.layout.radius * 1.15) * profile.labelRange;
      this.labelUniforms.fadeNear.value = range * 0.62;
      this.labelUniforms.fadeFar.value = range;
    }
    if (changed) this.hooks.onQuality(level);
  }

  private get bloomEnabled(): boolean {
    return this.options.bloom && QUALITY[this.quality].bloom;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  /** Advances animation and uploads per-frame data. `dt` is in seconds. */
  update(dt: number): void {
    if (this.disposed) return;
    const frameMs = dt * 1000;
    this.frames.push(frameMs);
    if (this.options.quality === 'auto') {
      const next = this.adaptive.sample(frameMs);
      if (next) this.applyQuality(next);
    }
    // Clamp so a background tab does not fast-forward the animation.
    const step = Math.min(dt, 0.1);
    this.time += step;
    const motion = !this.options.reducedMotion;

    if (motion && this.options.autoRotate && !this.userMoved && this.trace === null) {
      this.controls.azimuthAngle += step * 0.035;
    }
    this.controls.update(step);

    if (this.pointer.dirty) {
      this.pointer.dirty = false;
      const hit = this.pickNode();
      if (hit !== this.hoveredNode) {
        this.hoveredNode = hit;
        this.hooks.onHover(hit === -1 ? null : this.nodeIds[hit]!);
      }
      this.dom.style.cursor = hit === -1 ? '' : 'pointer';
    }

    const ease = 1 - Math.exp(-step * 7);
    this.updateNodes(step, ease, motion);
    this.updateEdges(ease);
    this.updateOverlays(step);

    this.applyViewOffset();
    if (this.edgeUniforms) {
      const height = this.dom.clientHeight || 1;
      this.edgeUniforms.pixelScale.value =
        (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / height;
    }
  }

  private updateNodes(step: number, ease: number, motion: boolean): void {
    const layout = this.layout;
    const ring = this.ringAttr;
    if (!layout || !ring) return;
    const labelFx = this.labelAttr?.fx;
    for (let i = 0; i < this.n; i++) {
      const batch = this.batches[this.nodeTypeIndex[i]!];
      if (!batch) continue;
      const slot = this.nodeSlot[i]!;
      const code = this.health[i]!;
      const type = SERVICE_TYPES[this.nodeTypeIndex[i]!]!;
      const selected = i === this.selectedNode;
      const hovered = i === this.hoveredNode;

      // Healthy nodes wear their type colour; unhealthy ones their status.
      const target = code === 0 ? hex(SERVICE_TYPE[type].color) : HEALTH_TINT[code]!;
      for (let k = 0; k < 3; k++) {
        this.tint[i * 3 + k]! += (target[k]! - this.tint[i * 3 + k]!) * ease;
      }
      const load = Math.min(1, this.load[i]!);
      const glowTarget = HEALTH_GLOW[code]! + (code === 0 ? load * 0.55 : 0) + (hovered ? 0.6 : 0);
      this.glow[i]! += (glowTarget - this.glow[i]!) * ease;
      this.visibility[i]! += (this.visibilityTarget[i]! - this.visibility[i]!) * ease;
      const visible = this.visibility[i]!;

      batch.tint.setXYZ(slot, this.tint[i * 3]!, this.tint[i * 3 + 1]!, this.tint[i * 3 + 2]!);
      batch.fx.setXYZW(
        slot,
        this.glow[i]!,
        motion ? HEALTH_PULSE[code]! : 0,
        visible,
        selected ? 1 : hovered ? 0.45 : 0,
      );

      const p = nodePosition(layout, i);
      if (motion && code !== 3) this.spin[i]! += step * SPIN_RATE[type] * (0.7 + load);
      const bob = motion ? Math.sin(this.time * 0.9 + i * 1.7) * 0.07 : 0;
      const size = (layout.scales[i] ?? 1) * (selected ? 1.14 : hovered ? 1.07 : 1);
      this.position.set(p[0], p[1] + bob, p[2]);
      this.quaternion.setFromAxisAngle(this.axisY, this.spin[i]!);
      this.scale.setScalar(size);
      batch.mesh.setMatrixAt(slot, this.matrix.compose(this.position, this.quaternion, this.scale));

      const impacted = this.impacted[i] === 1;
      ring.color.setXYZ(i, this.tint[i * 3]!, this.tint[i * 3 + 1]!, this.tint[i * 3 + 2]!);
      ring.ring.setXYZW(
        i,
        (layout.scales[i] ?? 1) * 0.95,
        (0.42 + (code > 0 ? 0.5 : 0) + (impacted ? 0.5 : 0)) * visible,
        motion ? this.shockAt[i]! : -100,
        selected ? 1 : 0,
      );
      // Labels of selected, hovered or impacted nodes never fade with distance.
      labelFx?.setXYZW(
        i,
        visible,
        selected || hovered || (impacted && code > 0) ? 1 : 0,
        code >= 2 ? 1 : 0,
        0,
      );
    }
    for (const batch of this.batches) {
      if (!batch) continue;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.tint.needsUpdate = true;
      batch.fx.needsUpdate = true;
    }
    ring.color.needsUpdate = true;
    ring.ring.needsUpdate = true;
    if (labelFx) labelFx.needsUpdate = true;
  }

  private updateEdges(ease: number): void {
    const attr = this.edgeAttr;
    if (!attr) return;
    const data = this.particleData?.image.data as Float32Array | undefined;
    const m = this.m;
    for (let e = 0; e < m; e++) {
      const traffic = this.edgeTraffic[e]!;
      // Square root keeps quiet edges visible next to very busy ones.
      let density = Math.min(1, Math.sqrt(traffic / this.trafficReference));
      if (traffic > 0.3) density = Math.max(density, 0.05);
      this.edgeDensity[e]! += (density - this.edgeDensity[e]!) * ease;
      const share = (x: number) => (traffic > 1e-3 ? Math.min(1, x / traffic) : 0);
      const rejected = share(this.edgeRejected[e]!);
      const suspicious = Math.max(0, share(this.edgeSuspicious[e]!) - rejected);
      const error = Math.min(0.9, this.edgeError[e]!) * (1 - rejected - suspicious);
      this.edgeRejShown[e]! += (rejected - this.edgeRejShown[e]!) * ease;
      this.edgeSusShown[e]! += (suspicious - this.edgeSusShown[e]!) * ease;
      this.edgeErrShown[e]! += (error - this.edgeErrShown[e]!) * ease;

      const shown = this.edgeDensity[e]!;
      const visible = Math.min(
        this.visibility[this.edgeSource[e]!]!,
        this.visibility[this.edgeTarget[e]!]!,
      );
      const highlight = this.edgeHighlight[e]!;
      const base = EDGE_COLOR[this.edgeKind[e]!]!;
      const status = STATUS_COLOR[this.edgeSecurity[e]!] ?? null;
      const alarm = Math.min(1, this.edgeErrShown[e]! * 2.5);
      for (let k = 0; k < 3; k++) {
        let channel = status ? status[k]! : base[k]!;
        channel += (CRITICAL[k]! - channel) * alarm;
        attr.color.array[e * 3 + k] = channel;
      }
      attr.fx.setXYZW(
        e,
        (0.16 + shown * 0.6 + highlight * 0.9) * (0.12 + 0.88 * visible),
        0.22 + shown * 0.85,
        1.5 + shown * 2.4 + highlight * 2.2,
        1,
      );
      if (data) {
        data[(0 * m + e) * 4 + 3] = shown * (visible > 0.5 ? 1 : 0.12);
        const row = (3 * m + e) * 4;
        data[row] = this.edgeErrShown[e]!;
        data[row + 1] = this.edgeRejShown[e]!;
        data[row + 2] = this.edgeSusShown[e]!;
        data[row + 3] = 0.25 + 0.75 * visible;
      }
    }
    attr.color.needsUpdate = true;
    attr.fx.needsUpdate = true;
    if (this.particleData) this.particleData.needsUpdate = true;
  }

  private updateOverlays(step: number): void {
    const layout = this.layout;
    // Selection beam.
    if (layout && this.selectedNode >= 0) {
      const p = nodePosition(layout, this.selectedNode);
      const s = layout.scales[this.selectedNode] ?? 1;
      this.beam.visible = true;
      this.beam.position.set(p[0], p[1] - s * 1.3, p[2]);
      this.beam.scale.set(s * 1.6, 15, s * 1.6);
      const i = this.selectedNode;
      this.beamTint.value.setRGB(this.tint[i * 3]!, this.tint[i * 3 + 1]!, this.tint[i * 3 + 2]!);
    } else {
      this.beam.visible = false;
    }

    // Hover tooltip anchor.
    if (this.tooltip) {
      const at = this.hoveredNode >= 0 ? this.project(this.hoveredNode) : null;
      if (at) {
        this.tooltip.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0)`;
        this.tooltip.style.visibility = 'visible';
      } else {
        this.tooltip.style.visibility = 'hidden';
      }
    }

    this.updateTrace(step);
  }

  private updateTrace(step: number): void {
    const trace = this.trace;
    if (!trace) return;
    const { pos, color, fx } = this.tracerAttr;
    const speed = this.options.reducedMotion ? 1e6 : Math.max(16, trace.total / 2.6);
    if (trace.burstAge < 0) {
      trace.travelled = Math.min(trace.total, trace.travelled + step * speed);
      if (trace.travelled >= trace.total) trace.burstAge = 0;
    } else {
      trace.burstAge += step;
    }
    const sample = (distance: number): Vec3 => {
      let remaining = Math.max(0, distance);
      for (const segment of trace.segments) {
        if (remaining <= segment.length) {
          return bezierPoint(segment.a, segment.c, segment.b, remaining / segment.length);
        }
        remaining -= segment.length;
      }
      return trace.burstAt;
    };
    const fade = trace.burstAge < 0 ? 1 : Math.max(0, 1 - trace.burstAge / 0.5);
    for (let k = 0; k < TRAIL; k++) {
      const p = sample(trace.travelled - k * 0.55);
      const falloff = 1 - k / TRAIL;
      pos.setXYZ(k, p[0], p[1], p[2]);
      color.setXYZ(k, trace.color[0], trace.color[1], trace.color[2]);
      fx.setXYZW(k, 0.5 + falloff * (k === 0 ? 1.7 : 0.9), falloff * falloff * fade, 0, 0);
    }
    // The burst: a ring that expands where the request stopped or arrived.
    const burst = trace.burstAge < 0 ? 0 : Math.max(0, 1 - trace.burstAge / 1.3);
    pos.setXYZ(TRAIL, trace.burstAt[0], trace.burstAt[1], trace.burstAt[2]);
    color.setXYZ(TRAIL, trace.color[0], trace.color[1], trace.color[2]);
    fx.setXYZW(TRAIL, trace.burstAge < 0 ? 0 : 2 + trace.burstAge * 9, burst, 1, 0);
    pos.needsUpdate = color.needsUpdate = fx.needsUpdate = true;

    if (!trace.done && trace.burstAge > 1.3) {
      trace.done = true;
      this.tracerMesh.visible = false;
      this.hooks.onTraceEnd();
    }
  }

  render(): void {
    if (this.disposed) return;
    // Count every pass of the frame (scene, bloom chain, output), not just
    // the last one.
    this.renderer.info.reset();
    if (this.bloomEnabled) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render as {
      drawCalls?: number;
      calls?: number;
      triangles?: number;
    };
    this.frameDrawCalls = info.drawCalls ?? info.calls ?? 0;
    this.frameTriangles = info.triangles ?? 0;
  }

  /**
   * Renders one frame into an offscreen target and returns its pixels
   * (RGBA, 8 bits per channel). Used to verify output where the canvas itself
   * cannot be captured, such as WebGPU in headless browsers.
   */
  async captureFrame(): Promise<{
    width: number;
    height: number;
    pixels: Uint8Array;
    flipY: boolean;
  }> {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.RenderTarget(size.x, size.y, { type: THREE.UnsignedByteType });
    this.renderer.setRenderTarget(target);
    if (this.bloomEnabled) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    const pixels = await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, size.x, size.y);
    target.dispose();
    return {
      width: size.x,
      height: size.y,
      pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      // WebGL reads rows bottom-up; WebGPU top-down.
      flipY: this.backend === 'webgl2',
    };
  }

  getStats(): SceneStats {
    let particles = 0;
    const density = this.particleUniforms?.density.value ?? 1;
    for (let e = 0; e < this.m; e++) {
      particles += (this.edgeCapacity[e] ?? 0) * Math.min(1, this.edgeDensity[e]! * density);
    }
    return {
      fps: this.frames.fps(),
      frameMs: this.frames.average(),
      frameMsP95: this.frames.percentile(0.95),
      drawCalls: this.frameDrawCalls,
      triangles: this.frameTriangles,
      particles: Math.round(particles),
      particleCapacity: this.particleCapacity,
      nodes: this.n,
      edges: this.m,
      backend: this.backend,
      quality: this.quality,
      pixelRatio: this.renderer.getPixelRatio(),
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointerleave', this.onPointerLeave);
    this.dom.removeEventListener('dblclick', this.onDoubleClick);
    this.dom.style.cursor = '';
    this.controls.removeEventListener('controlstart', this.onControlStart);
    this.controls.dispose();
    this.clearWorld();
    for (const resource of this.disposables) resource.dispose();
    this.scene.remove(this.root);
  }
}

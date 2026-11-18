/**
 * The scene, as an imperative system.
 *
 * React mounts the canvas and forwards state; everything that happens per
 * frame happens here, without React.
 *
 * The scene is a scale model on a porcelain field: matte pieces standing on
 * plates, connections as hairlines, traffic as beads. It is drawn in neutral
 * tones; a hue appears only as an answer, blue to what the viewer is
 * following and a signal colour to what deviates. The whole topology renders in
 * a small number of draw calls that follows the number of object classes,
 * not the number of objects:
 *
 *   pieces        one instanced mesh per service type (≤ 12)
 *   ground marks  1      connections  1      beads  1
 *   plates        one per region, its shadow, and the plinth under the hub
 *
 * Names are not part of that picture: they are placed here and drawn by
 * `labelLayer.ts` on a canvas of their own, at the display's full resolution.
 *
 * Snapshots set targets; the controller eases displayed values toward them
 * every frame, so the scene moves continuously between 5 Hz updates.
 *
 * Motion is always an answer to something. The model assembles itself when a
 * topology is laid out (plates, then pieces, then the connections between
 * them), pieces walk to their new places when the layout changes, a selected
 * piece is lifted and its connections are redrawn outward from it, and a
 * piece that fails is jolted once. Two things keep moving, and both because
 * requests do: the beads on the connections, and the one working part of
 * each piece, which runs at the pace of its service's traffic and in the
 * manner of its state: evenly, hesitating when degraded, jammed when
 * critical, and hanging crooked and still when the service is down.
 */
import {
  HEALTH_BY_CODE,
  SERVICE_TYPES,
  type AuthorizationDecision,
  type Relationship,
  type ServiceType,
} from '@aegis/contracts';
import CameraControls from 'camera-controls';
import * as THREE from 'three/webgpu';

import { SCENE_PALETTE, type ScenePalette, type ThemeName } from '@/lib/palette';

import {
  aimPiece,
  groundMarkOf,
  UNKNOWN,
  unknownRingTone,
  unknownTone,
  type PieceAim,
  type SceneFrame,
  type SceneTopology,
} from './sceneData';
import { LabelLayer, loadLabelFonts, type LabelColours, type LabelTone } from './labelLayer';
import {
  bezierPoint,
  computeLayout,
  curveLength,
  edgeControl,
  hang,
  nameAnchor,
  nodePosition,
  TOLD_BY_FACE,
  UPRIGHT_ASPECT,
  askew,
  VIEW,
  VIEW_UPRIGHT,
  headingOf,
  viewOf,
  type LayoutMode,
  type SceneLayout,
  type Vec3,
} from './layout';
import {
  applyPalette,
  createCastShadowMaterial,
  createEdgeMaterial,
  createGroundMaterial,
  createParticleMaterial,
  createPieceMaterial,
  createPlateMaterial,
  createSceneTheme,
  createStemMaterial,
  createSupportMaterial,
  createTracerMaterial,
  EDGE_ROWS,
  SHADOW_REACH,
  type EdgeUniforms,
  type ParticleUniforms,
  type PlateUniforms,
  type SceneTheme,
} from './materials';
import { paceOf, referenceThroughput } from './pace';
import { MECHANISM_ROWS, WORK_CYCLE, type PieceSet } from './pieces';
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
  theme: ThemeName;
  quality: QualityLevel | 'auto';
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
  /** Names on screen, and what placing and drawing them costs a frame (smoothed). */
  names: number;
  namesMs: number;
  /** Pieces drawn as unknown: services whose state the data does not give. */
  unknown: number;
}

const EDGE_SEGMENTS = 20;
/**
 * How far a name in the overview steps out for the selection's ring, in
 * units of its piece's size. The name's anchor is 1.3 from the piece and the
 * ring's outer edge 1.72 (`createGroundMaterial`: 0.774 of a quad 2.2 times
 * 0.95 times 1.06 of the size), so this leaves a little of the plate between.
 */
const RING_CLEARANCE = 0.5;
/** The vertical, which the pieces are turned about to face the attitude in use. */
const UP = new THREE.Vector3(0, 1, 0);
/**
 * Beads are ink on a light plate: past a certain density a stream turns into
 * a solid rope and stops saying anything. The budget keeps single beads
 * discernible on the busiest connection.
 */
const PARTICLE_BUDGET = 9_000;
/**
 * The overview is read from its lines: each of its connections stands for
 * many, so the line is drawn firmly and only a few beads ride it.
 */
const LAYER_PARTICLES = 0.2;
const TRAIL = 12;
/**
 * A long lens: lines that are parallel in the model stay very nearly parallel
 * on screen, as in an axonometric drawing, while orbiting still works.
 */
export const FOV = 14;
/** How much farther this lens stands than a 40° one for the same framing. */
const LENS = Math.tan(THREE.MathUtils.degToRad(20)) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** About how tall a plate's name is on screen, in CSS pixels, for framing. */
const REGION_LABEL_PX = 24;
/** Thickness of a region plate, and so the height of the table below it. */
const PLATE_THICKNESS = 0.6;
/** A layer of the overview is a lower step: it marks a stage, not a place. */
const LAYER_THICKNESS = 0.34;
/** How flat connections are drawn over the overview, where they run far. */
const LAYER_ARC = 0.42;
/** Badges that mark where a flow was stopped, beside the traced request's own. */
const MARKERS = 4;
/** How far the plinth under a raised plate stands back from its rim. */
const PLINTH_INSET = 0.55;
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

/** Assembly: how long a plate takes to open and a piece to land or walk. */
const PLATE_TIME = 0.6;
const DROP_TIME = 0.55;
const WALK_TIME = 0.85;
/** How long a connection takes to draw itself, and its beads to follow. */
const DRAW_TIME = 0.45;
const BEADS_TIME = 0.6;
/** How quickly a mechanism takes up a new pace, per second: it has inertia. */
const WIND = 1.6;
/** How fast a mechanism passes from one state's manner to the next, in states per second. */
const MANNER_RATE = 3;
/** How far the connections outside a selection's neighbourhood recede (pieces: `FOCUS_DIM`). */
const EDGE_FOCUS_DIM = 0.26;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Ease out with a small overshoot: a piece settling where it was put. */
const easeOutBack = (x: number) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2;

/** A plate's name is drawn at a fixed size; this is about how wide it comes out. */
const nameWidth = (name: string) => 12 * name.length + 8;

/** The colours names are drawn in, for the canvas they are drawn on. */
function labelColoursOf(palette: ScenePalette): LabelColours {
  return {
    ink: palette.ink,
    inkDim: palette.inkDim,
    critical: palette.critical,
    halo: palette.plate,
  };
}

function hex(color: string): Vec3 {
  const c = new THREE.Color(color);
  return [c.r, c.g, c.b];
}

/** The palette resolved to linear RGB triples, for per-instance attributes. */
interface Tones {
  ink: Vec3;
  track: Vec3;
  /** The viewer's attention: selection and the path being followed. */
  focus: Vec3;
  /** Piece colour by health code: healthy, degraded, critical, down. */
  piece: [Vec3, Vec3, Vec3, Vec3];
  /** Piece colour where the state is unknown: neither normal nor any state. */
  unknown: Vec3;
  /** The dashed ring under a piece whose state is unknown: without hue. */
  unknownRing: Vec3;
  /** Lamp colour under a piece, by health code. */
  lamp: [Vec3, Vec3, Vec3, Vec3];
  /** Connection colour by security status code; `null` keeps the track tone. */
  status: (Vec3 | null)[];
  critical: Vec3;
  warning: Vec3;
}

function tonesOf(palette: ScenePalette): Tones {
  const warning = hex(palette.warning);
  const critical = hex(palette.critical);
  const ink = hex(palette.ink);
  return {
    ink,
    track: hex(palette.track),
    focus: hex(palette.focus),
    piece: [hex(palette.piece), warning, critical, hex(palette.ghost)],
    unknown: unknownTone(hex(palette.piece), hex(palette.plate)),
    unknownRing: unknownRingTone(hex(palette.track), hex(palette.inkDim)),
    // A piece that is down gets a quiet mark, not a light: it is off.
    lamp: [ink, warning, critical, hex(palette.track)],
    // secure, authorized, throttled, denied, suspicious
    status: [null, null, warning, warning, hex(palette.hostile)],
    critical,
    warning,
  };
}

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

function instancedQuad(count: number, flat = false, lift = 0): THREE.InstancedBufferGeometry {
  const base = new THREE.PlaneGeometry(1, 1);
  // `lift` moves the quad up so it grows from its anchor instead of around it.
  if (lift !== 0) base.translate(0, lift, 0);
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
  /** Cosine and sine of the turn each piece has about the vertical. */
  turn: THREE.InstancedBufferAttribute;
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
  edges: number[];
  /** The pieces the request passed, for the neighbourhood that stays in front. */
  nodes: number[];
  burstAt: Vec3;
  burstAge: number;
  /** Where the camera looks while the whole path is in the picture. */
  home: Vec3;
  /** Where the camera stood before the path took it, to be given back. */
  before: { position: Vec3; target: Vec3 };
  /** The piece the request was stopped at, or -1 when it went through. */
  blockedAt: number;
  done: boolean;
}

export class SceneController {
  private readonly root = new THREE.Group();
  private readonly world = new THREE.Group();
  private readonly controls: CameraControls;
  private readonly theme: SceneTheme;
  private tones: Tones;
  private readonly adaptive = new AdaptiveQuality('high');
  private readonly frames = new FrameStats();
  private readonly disposables: { dispose(): void }[] = [];
  private worldDisposables: { dispose(): void }[] = [];

  private options: SceneOptions;
  private quality: QualityLevel = 'high';
  private time = 0;
  private userMoved = false;
  /** The viewer took the camera while a request was being followed. */
  private steered = false;
  private disposed = false;
  private frameDrawCalls = 0;
  private frameTriangles = 0;
  private insets = { left: 0, right: 0, top: 0, bottom: 0 };
  /** The insets the projection is using; they follow `insets` as panels slide. */
  private insetsShown = { left: 0, right: 0, top: 0, bottom: 0 };
  private viewKey = '';

  // Topology-bound state -----------------------------------------------------
  private topology: SceneTopology | null = null;
  private layout: SceneLayout | null = null;
  private layoutMode: LayoutMode = 'regions';
  /** What to write beside each piece, when it is not the node's own name. */
  private labels: readonly string[] | null = null;
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
  /** 0 where the data does not give a service's state: it is drawn as unknown. */
  private known = new Uint8Array(0);
  /** 0 where a service's traffic was not measured: its part rests as modelled. */
  private measured = new Uint8Array(0);
  /** What the piece being updated is aimed at; reused, so a frame allocates nothing. */
  private readonly pieceAim: PieceAim = {
    tone: 0,
    focus: 1,
    manner: 0,
    lamp: 0,
    open: 0,
    alarm: 0,
  };
  private visibilityTarget = new Float32Array(0);
  private visibility = new Float32Array(0);
  private impacted = new Uint8Array(0);
  /** 1 where a piece stands for several services and only some deviate. */
  private partial = new Uint8Array(0);
  /** Connections an incident's traffic is taking, and where it was stopped. */
  private route = new Uint8Array(0);
  private stopped: number[] = [];
  private routed = false;
  private tint = new Float32Array(0);
  private shockAt = new Float32Array(0);
  /** Requests per second through each service, and what counts as its normal. */
  private throughput = new Float32Array(0);
  private throughputReference = new Float32Array(0);
  /** How fast each piece's mechanism runs, and for how long it has worked. */
  private pace = new Float32Array(0);
  private work = new Float32Array(0);
  /** The state each mechanism works in, on its way to the service's health code. */
  private manner = new Float32Array(0);
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

  // Motion ---------------------------------------------------------------------
  /** True while an assembly (first layout or a change of layout) is running. */
  private assembling = false;
  private assembleAt = -100;
  private assembleEnd = -100;
  /** When each piece starts to land or walk, relative to `assembleAt`. */
  private delay = new Float32Array(0);
  /** Where each piece walks from when the layout changes; null to drop in. */
  private walkFrom: Float32Array | null = null;
  /** Position and scale of every piece as drawn in the last frame. */
  private shown = new Float32Array(0);
  /** 0 at rest, 0.5 pointed at, 1 selected; eased. */
  private emphasis = new Float32Array(0);
  /** 1 inside the selection's neighbourhood, less outside it; eased. */
  private focus = new Float32Array(0);
  private related = new Uint8Array(0);
  private edgeRelated = new Uint8Array(0);
  private edgeFocus = new Float32Array(0);
  private edgeGlow = new Float32Array(0);
  /** When each connection starts drawing itself, and from which end. */
  private edgeDrawAt = new Float32Array(0);
  private edgeDrawFrom = new Float32Array(0);
  /** When each connection's beads start to flow. */
  private edgeLiveAt = new Float32Array(0);
  private focusActive = false;

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
  /** The names, drawn on a canvas of their own over the scene. */
  private readonly labelLayer: LabelLayer;
  /** World anchors of every name: the nodes', then the regions'. */
  private labelAnchors = new Float32Array(0);
  /** Where a node's name hangs from its anchor, in units of its own size. */
  private labelAlign: [number, number] = [0, 0.5];
  /** Whether the stage is taller than wide, which the overview is seen differently on. */
  private upright = false;
  /** See `setReached`. */
  private reached = new Uint8Array(0);
  private reachedAny = false;
  /** The size of the stage the shot and the names were last taken for. */
  private stageWidth = 0;
  private stageHeight = 0;
  /** The way toward the viewer on the ground, `[x, z]`: where an overview name lies from its piece. */
  private nameToward: [number, number] = [0, 1];
  /**
   * How far each piece is turned about the vertical, and how far it is to
   * be: toward its traffic if it has a side for that, else by as much as
   * the attitude in use is turned from the one the pieces were modelled for.
   */
  private yaw = new Float32Array(0);
  private yawAim = new Float32Array(0);
  private readonly facingTurn = new THREE.Quaternion();
  /** Per node: how present its name is, whether it is always shown, its alarm. */
  private labelNamed = new Float32Array(0);
  private labelEmphasis = new Uint8Array(0);
  private labelAlarm = new Uint8Array(0);
  /** How much of the selection's ring is drawn round each piece, 0 to 1. */
  private labelRing = new Float32Array(0);
  /** Per region: whether its plate has opened far enough to be named. */
  private regionNamed = new Float32Array(0);
  private labelFadeNear = 40;
  private labelFadeFar = 80;
  private labelsReady = false;
  /** What a frame spends on names, smoothed over the last few dozen. */
  private namesMs = 0;
  private labelColours: LabelColours;
  private plates: {
    uniforms: PlateUniforms;
    regionId: string;
    health: number;
    alarm: number;
    off: number;
  }[] = [];
  /** Everything that belongs to one plate, so it can open as one thing. */
  private bases: { group: THREE.Group; delay: number; slab: boolean; label: number }[] = [];
  private stems: { mesh: THREE.InstancedMesh; nodes: number[] } | null = null;
  /** Height of the top of each service type's geometry, at unit scale. */
  private typeTop: number[] = [];
  private readonly tracerMesh: THREE.Mesh;
  /** What moves on every piece, as the texture the piece material reads. */
  private readonly mechanisms: THREE.DataTexture;
  private readonly tracerAttr: {
    pos: THREE.InstancedBufferAttribute;
    color: THREE.InstancedBufferAttribute;
    fx: THREE.InstancedBufferAttribute;
  };
  private trace: Trace | null = null;
  private captureTarget: THREE.RenderTarget | null = null;

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
    private readonly pieces: PieceSet,
  ) {
    this.options = options;
    const palette = SCENE_PALETTE[options.theme];
    this.theme = createSceneTheme(palette);
    this.tones = tonesOf(palette);
    this.labelColours = labelColoursOf(palette);
    this.labelLayer = new LabelLayer(dom);
    renderer.info.autoReset = false;
    scene.background = new THREE.Color(palette.table);
    camera.fov = FOV;
    camera.near = 2;
    camera.far = 8000;
    camera.updateProjectionMatrix();

    this.root.add(this.world);
    scene.add(this.root);

    this.controls = new CameraControls(camera, dom);
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.smoothTime = 0.32;
    this.controls.draggingSmoothTime = 0.1;
    this.controls.dollyToCursor = true;
    this.controls.restThreshold = 0.02;
    this.controls.addEventListener('control', this.onControl);

    this.mechanisms = new THREE.DataTexture(
      pieces.table.data,
      pieces.table.columns,
      MECHANISM_ROWS,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.mechanisms.minFilter = this.mechanisms.magFilter = THREE.NearestFilter;
    this.mechanisms.generateMipmaps = false;
    this.mechanisms.needsUpdate = true;
    this.disposables.push(this.mechanisms);

    // Tracer sprites (head, tail and the ring where the request ends).
    const sprites = TRAIL + 1 + MARKERS;
    const tracerGeometry = instancedQuad(sprites);
    this.tracerAttr = {
      pos: instanced(tracerGeometry, 'aPos', 3, sprites),
      color: instanced(tracerGeometry, 'aColor', 3, sprites),
      fx: instanced(tracerGeometry, 'aTracerFx', 4, sprites),
    };
    const tracerMaterial = createTracerMaterial(this.theme);
    this.tracerMesh = new THREE.Mesh(tracerGeometry, tracerMaterial);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.visible = false;
    this.tracerMesh.renderOrder = 10;
    this.root.add(this.tracerMesh);
    this.disposables.push(tracerGeometry, tracerMaterial);

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

  /**
   * `labels`, when given, is what to write beside each node instead of its
   * name: the overview's pieces stand for several services and say how many.
   */
  setTopology(
    topology: SceneTopology,
    mode: LayoutMode,
    labels: readonly string[] | null = null,
  ): void {
    const first = this.topology === null;
    const changed = this.topology?.id !== topology.id || this.n !== topology.nodes.length;
    // The same services in another arrangement: they walk there.
    const walkFrom = !changed && mode !== this.layoutMode ? this.shown.slice() : null;
    const relaid = first || changed || walkFrom !== null;
    this.clearWorld();
    this.topology = topology;
    this.layoutMode = mode;
    this.labels = labels;
    const layout = computeLayout(topology, mode);
    this.layout = layout;
    const n = (this.n = topology.nodes.length);
    const m = (this.m = topology.edges.length);
    const index = new Map(topology.nodes.map((node, i) => [node.id, i]));
    this.nodeIds = topology.nodes.map((node) => node.id);
    this.edgeIds = topology.edges.map((edge) => edge.id);

    if (changed) {
      this.health = new Uint8Array(n);
      this.known = new Uint8Array(n).fill(1);
      this.measured = new Uint8Array(n).fill(1);
      this.visibilityTarget = new Float32Array(n).fill(1);
      this.visibility = new Float32Array(n).fill(1);
      this.impacted = new Uint8Array(n);
      this.partial = new Uint8Array(n);
      this.route = new Uint8Array(m);
      this.stopped = [];
      this.routed = false;
      this.tint = new Float32Array(n * 3);
      this.shockAt = new Float32Array(n).fill(-100);
      this.throughput = Float32Array.from(topology.nodes, (node) => node.metrics.throughputRps);
      this.throughputReference = referenceThroughput(topology.nodes);
      this.pace = new Float32Array(n);
      // Pieces of a kind do not work in step: each starts somewhere in its
      // cycle, the same place on every load.
      const start = mulberry(0x3ec4a);
      this.work = Float32Array.from({ length: n }, () => start() * WORK_CYCLE);
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
      this.shown = new Float32Array(n * 4);
      this.emphasis = new Float32Array(n);
      this.focus = new Float32Array(n).fill(1);
      this.related = new Uint8Array(n);
      this.edgeRelated = new Uint8Array(m);
      this.edgeFocus = new Float32Array(m).fill(1);
      this.edgeGlow = new Float32Array(m);
      this.edgeDrawFrom = new Float32Array(m).fill(1);
      this.hasSnapshot = false;
      this.selectedNode = this.selectedEdge = this.hoveredNode = -1;
      this.reached = new Uint8Array(n);
      this.reachedAny = false;
      this.trace = null;
      this.userMoved = false;
      topology.nodes.forEach((node, i) => {
        this.health[i] = HEALTH_BY_CODE.indexOf(node.metrics.health);
        this.tint.set(this.tones.piece[this.health[i]!]!, i * 3);
      });
      // A model laid out in the middle of an incident is drawn as it is.
      this.manner = Float32Array.from(this.health);
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

    this.buildBase(layout);
    this.buildNodes(topology);
    this.buildGroundMarks(layout);
    this.buildEdges(layout);
    this.buildParticles(layout);
    void this.buildLabels(topology, layout);
    this.applyQuality(this.quality);
    this.refreshHighlights();
    this.beginAssembly(topology, layout, relaid, walkFrom);

    this.controls.minDistance = 6 * LENS;
    this.controls.maxDistance = layout.radius * 5 * LENS;
    // The shot is taken from the attitude of the stage as it is now.
    this.syncStage(false);
    // Pieces that walk to a new arrangement turn to it on the way. A model
    // that is laid out afresh arrives already turned.
    if (this.yaw.length !== n) this.yaw = new Float32Array(n);
    this.yawAim = new Float32Array(n);
    this.aimPieces();
    if (walkFrom === null || this.options.reducedMotion) this.yaw.set(this.yawAim);
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
    this.bases = [];
    this.stems = null;
    this.ringAttr = null;
    this.edgeAttr = null;
    this.particleData = null;
    this.labelsReady = false;
    this.labelLayer.clear();
  }

  /** The plates, the shadows they cast on the table and the plinth under the hub. */
  /** How thick the plates of the current arrangement are. */
  private relief(): number {
    return this.layoutMode === 'layers' ? LAYER_THICKNESS : PLATE_THICKNESS;
  }

  private buildBase(layout: SceneLayout): void {
    const theme = this.theme;
    const thickness = this.relief();
    const table = -thickness;
    const disc = this.track(new THREE.CylinderGeometry(1, 1, 1, 96).translate(0, -0.5, 0));
    const slab = this.track(new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0));
    const blob = this.track(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2));
    const shadows = {
      disc: this.track(createCastShadowMaterial(theme, true, 0.55)),
      slab: this.track(createCastShadowMaterial(theme, false, 0.55)),
    };
    const support = this.track(createSupportMaterial(theme));

    layout.regions.forEach((region, k) => {
      // Children are placed relative to the plate's axis, so the group can
      // open outward from it.
      const group = new THREE.Group();
      group.position.set(region.center[0], 0, region.center[2]);
      this.world.add(group);
      const round = region.shape === 'disc';
      this.bases.push({ group, delay: 0, slab: !round, label: k });

      const { material, uniforms } = createPlateMaterial(theme, round);
      this.track(material);
      const plate = new THREE.Mesh(round ? disc : slab, material);
      plate.position.set(0, region.center[1], 0);
      if (round) plate.scale.set(region.radius, thickness, region.radius);
      else plate.scale.set(region.halfWidth * 2, thickness, region.halfDepth * 2);
      group.add(plate);
      this.plates.push({ uniforms, regionId: region.id, health: 0, alarm: 0, off: 0 });

      const shadow = new THREE.Mesh(blob, shadows[region.shape]);
      shadow.position.set(0, table + 0.01, 0);
      shadow.scale.set(region.halfWidth + SHADOW_REACH, 1, region.halfDepth + SHADOW_REACH);
      shadow.renderOrder = -1;
      group.add(shadow);

      // A raised plate stands on a plinth, a step in from its rim.
      const under = region.center[1] - thickness;
      if (under - table > 0.05) {
        const plinth = new THREE.Mesh(round ? disc : slab, support);
        plinth.position.set(0, under, 0);
        if (round) {
          const radius = Math.max(0.5, region.radius - PLINTH_INSET);
          plinth.scale.set(radius, under - table, radius);
        } else {
          plinth.scale.set(
            Math.max(0.5, (region.halfWidth - PLINTH_INSET) * 2),
            under - table,
            Math.max(0.5, (region.halfDepth - PLINTH_INSET) * 2),
          );
        }
        group.add(plinth);
      }
    });
  }

  private buildNodes(topology: SceneTopology): void {
    const material = this.track(createPieceMaterial(this.theme, this.mechanisms));
    const perType = SERVICE_TYPES.map(() => [] as number[]);
    this.nodeTypeIndex = new Uint8Array(this.n);
    this.nodeSlot = new Uint16Array(this.n);
    topology.nodes.forEach((node, i) => {
      const type = SERVICE_TYPES.indexOf(node.serviceType);
      this.nodeTypeIndex[i] = type;
      this.nodeSlot[i] = perType[type]!.length;
      perType[type]!.push(i);
    });
    this.typeTop = SERVICE_TYPES.map(() => 1);
    this.batches = SERVICE_TYPES.map((type: ServiceType, t) => {
      const members = perType[t]!;
      if (members.length === 0) return null;
      // A copy per layout: instance attributes are attached to the geometry.
      const geometry = this.track(this.pieces.shapes[type].clone());
      this.typeTop[t] = geometry.boundingBox?.max.y ?? 1;
      const mesh = new THREE.InstancedMesh(geometry, material, members.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.world.add(mesh);
      return {
        mesh,
        tint: instanced(geometry, 'aTint', 3, members.length),
        fx: instanced(geometry, 'aFx', 4, members.length),
        turn: instanced(geometry, 'aTurn', 2, members.length),
      };
    });
  }

  /**
   * Contact shadows, status lamps, the dashed ring of an unknown state and
   * the selection ring; stems for raised pieces.
   */
  private buildGroundMarks(layout: SceneLayout): void {
    const geometry = this.track(instancedQuad(this.n, true));
    this.ringAttr = {
      pos: instanced(geometry, 'aPos', 3, this.n),
      color: instanced(geometry, 'aColor', 3, this.n),
      ring: instanced(geometry, 'aRing', 4, this.n),
    };
    const raised: number[] = [];
    for (let i = 0; i < this.n; i++) {
      const p = nodePosition(layout, i);
      const ground = layout.ground[i] ?? 0;
      this.ringAttr.pos.setXYZ(i, p[0], ground + 0.035, p[2]);
      if (p[1] - (layout.scales[i] ?? 1) - ground > 0.3) raised.push(i);
    }
    const mesh = new THREE.Mesh(geometry, this.track(createGroundMaterial(this.theme)));
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.world.add(mesh);

    if (raised.length > 0) {
      const stem = this.track(new THREE.CylinderGeometry(0.07, 0.07, 1, 10).translate(0, 0.5, 0));
      const stems = new THREE.InstancedMesh(
        stem,
        this.track(createStemMaterial(this.theme)),
        raised.length,
      );
      raised.forEach((i, k) => {
        const p = nodePosition(layout, i);
        const ground = layout.ground[i] ?? 0;
        this.position.set(p[0], ground, p[2]);
        this.scale.set(1, p[1] - (layout.scales[i] ?? 1) - ground, 1);
        stems.setMatrixAt(k, this.matrix.compose(this.position, this.quaternion, this.scale));
      });
      stems.frustumCulled = false;
      stems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.world.add(stems);
      this.stems = { mesh: stems, nodes: raised };
    }
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
      const c = edgeControl(a, b, layout.mode === 'layers' ? LAYER_ARC : 1);
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
    mesh.renderOrder = 3;
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
      const budget = PARTICLE_BUDGET * (layout.mode === 'layers' ? LAYER_PARTICLES : 1);
      const count = Math.min(300, Math.max(4, Math.round((budget * weights[e]!) / total)));
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

    const { material, uniforms } = createParticleMaterial(texture, this.theme);
    this.particleUniforms = uniforms;
    const mesh = new THREE.Mesh(geometry, this.track(material));
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.world.add(mesh);
  }

  private async buildLabels(topology: SceneTopology, layout: SceneLayout): Promise<void> {
    await loadLabelFonts();
    // The topology may have been replaced while fonts were loading.
    if (this.disposed || this.layout !== layout) return;
    const names = topology.nodes.map((node, i) => this.labels?.[i] ?? node.name);
    this.labelLayer.setLabels([
      ...names.map((text) => ({ text, style: 'node' as const })),
      // A layer's heading is "02 Identity": where the headings would touch
      // they are all cut to their number, which is what orders them.
      ...layout.regions.map((region) => ({
        text: region.name,
        style: 'region' as const,
        short: region.heading ? region.name.split(' ')[0] : undefined,
      })),
    ]);
    const count = this.n + layout.regions.length;
    this.labelAnchors = new Float32Array(count * 3);
    this.labelNamed = new Float32Array(this.n);
    this.labelEmphasis = new Uint8Array(this.n);
    this.labelRing = new Float32Array(this.n);
    this.labelAlarm = new Uint8Array(this.n);
    // A plate is named unless an assembly under way says it has not opened
    // yet. The names may be ready after the plates have all opened (fonts
    // take a moment, and with reduced motion the assembly takes none).
    this.regionNamed = new Float32Array(layout.regions.length).fill(1);
    if (this.assembling) this.applyBases(this.time - this.assembleAt);
    this.placeNames();
    this.labelsReady = true;
    this.applyQuality(this.quality);
  }

  /**
   * Where every name is anchored. It follows the attitude the model is seen
   * from, so it is done again when a stage turns from wide to upright.
   */
  private placeNames(): void {
    const layout = this.layout;
    if (!layout || this.labelAnchors.length !== (this.n + layout.regions.length) * 3) return;
    const upright = this.upright && layout.mode === 'layers';
    this.labelLayer.shortHeadings = upright;
    this.nameToward = upright
      ? [Math.sin(VIEW_UPRIGHT.azimuth), Math.cos(VIEW_UPRIGHT.azimuth)]
      : [0, 1];
    const [tx, tz] = this.nameToward;
    for (let i = 0; i < this.n; i++) {
      const p = nodePosition(layout, i);
      const s = layout.scales[i] ?? 1;
      if (layout.mode === 'layers') {
        // In the overview a name lies on the plate at the foot of its piece,
        // toward the viewer, where it covers nothing that stands behind.
        this.labelAnchors.set(
          [p[0] + tx * s * 1.3, layout.ground[i] ?? 0, p[2] + tz * s * 1.3],
          i * 3,
        );
      } else {
        // A service's name stands above its piece, clear of the silhouette.
        this.labelAnchors.set(
          [p[0], p[1] + (this.typeTop[this.nodeTypeIndex[i]!] ?? 1) * s + 0.25, p[2]],
          i * 3,
        );
      }
    }
    this.labelAlign = layout.mode === 'layers' ? [0, -0.5] : [0, 0.5];
    // A plate's name stands on the table just off its rim, on the side that
    // faces away from the rest of the model. Which way that is on screen
    // depends on the camera, so the text is hung from the anchor every frame.
    layout.regions.forEach((region, k) => {
      this.labelAnchors.set(nameAnchor(region, upright), (this.n + k) * 3);
    });
  }

  /**
   * Which way every piece is to face. A piece with a side its traffic
   * arrives at is turned to where that traffic comes from: a gate stands
   * across the path. The others have a front that was modelled toward the
   * usual attitude, and seen along the path instead they are turned by as
   * much as the camera went round.
   */
  private aimPieces(): void {
    const layout = this.layout;
    if (!layout || this.yawAim.length !== this.n) return;
    const turned =
      this.upright && layout.mode === 'layers' ? VIEW_UPRIGHT.azimuth - VIEW.layers.azimuth : 0;
    const sight = viewOf(layout.mode, this.upright).azimuth;
    const nodes = this.topology?.nodes;
    for (let i = 0; i < this.n; i++) {
      const toTraffic = layout.facing[i]!;
      if (!Number.isFinite(toTraffic)) this.yawAim[i] = turned;
      else {
        // A gate turned all the way along a path that crosses the picture
        // shows its flank: it is held where its arch can still be seen.
        const byFace = nodes !== undefined && TOLD_BY_FACE.has(nodes[i]!.serviceType);
        this.yawAim[i] = byFace ? askew(toTraffic, sight) : toTraffic;
      }
    }
  }

  /**
   * Takes up the stage as it is now. A stage that has changed size is a
   * different picture, and one that has turned upright, or back, is seen
   * from another attitude: the names are placed again for it. Unless the
   * viewer has taken the camera, the shot is taken again as well. It used
   * to be kept, so a model framed before the canvas had its size, or before
   * a window was made narrower, stayed cut off at both sides until "Frame
   * everything" was asked for.
   */
  private syncStage(reframe: boolean): void {
    const width = this.dom.clientWidth;
    const height = this.dom.clientHeight;
    if (width === 0 || height === 0) return;
    if (width === this.stageWidth && height === this.stageHeight) return;
    this.stageWidth = width;
    this.stageHeight = height;
    const upright = height > width * UPRIGHT_ASPECT;
    if (upright !== this.upright) {
      this.upright = upright;
      this.placeNames();
      this.aimPieces();
    }
    if (reframe && this.layout && !this.userMoved) this.reframe();
  }

  // ---------------------------------------------------------------------------
  // Inputs from the application
  // ---------------------------------------------------------------------------

  applySnapshot(snapshot: SceneFrame): void {
    if (snapshot.nodes.health.length !== this.n || snapshot.edges.trafficRps.length !== this.m) {
      return;
    }
    const { known, measured } = snapshot.nodes;
    for (let i = 0; i < this.n; i++) {
      const next = snapshot.nodes.health[i]!;
      // A node that just turned critical or went down sends out a shockwave.
      if (this.hasSnapshot && next >= 2 && next > this.health[i]!) this.shockAt[i] = this.time;
      this.health[i] = next;
      this.throughput[i] = snapshot.nodes.throughputRps[i] ?? 0;
      this.known[i] = known && known[i] === 0 ? 0 : 1;
      this.measured[i] = measured && measured[i] === 0 ? 0 : 1;
      // A model laid out where nothing is known is drawn so from the start.
      if (!this.hasSnapshot && this.known[i] === 0) this.tint.set(this.tones.unknown, i * 3);
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
      plate.health = status ? HEALTH_BY_CODE.indexOf(status.health) : 0;
    }
    this.applyPlateStates();
    this.hasSnapshot = true;
  }

  /**
   * A plate shows its region's state: outlined in a signal colour, or dark.
   * The colour is set at once; how strongly it shows is eased every frame.
   */
  private applyPlateStates(): void {
    const palette = SCENE_PALETTE[this.options.theme];
    for (const plate of this.plates) {
      const code = plate.health;
      if (code === 1 || code === 2) {
        plate.uniforms.tone.value.set(code === 2 ? palette.critical : palette.warning);
      }
      plate.alarm = code === 1 || code === 2 ? 1 : 0;
      plate.off = code === 3 ? 1 : 0;
    }
  }

  setOptions(options: SceneOptions): void {
    if (options.theme !== this.options.theme) {
      const palette = SCENE_PALETTE[options.theme];
      applyPalette(this.theme, palette);
      this.tones = tonesOf(palette);
      this.labelColours = labelColoursOf(palette);
      (this.scene.background as THREE.Color).set(palette.table);
      this.options = options;
      this.applyPlateStates();
    }
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

  /**
   * `mask[i]` is 1 where a piece stands for several services of which only
   * some are unwell: its lamp shows the state, the piece itself stays neutral.
   */
  setPartial(mask: Uint8Array | null): void {
    for (let i = 0; i < this.n; i++) this.partial[i] = mask ? (mask[i] ?? 0) : 0;
  }

  /**
   * The route an incident's traffic is taking: the connections it crosses
   * and the pieces at which it was stopped. While there is one, and nothing
   * is selected, the route stays in front and the rest of the model recedes;
   * the first time it appears the camera moves in on it.
   */
  setRoute(edgeIds: readonly string[], blockedNodeIds: readonly string[]): void {
    this.route.fill(0);
    let any = false;
    for (const id of edgeIds) {
      const e = this.edgeIds.indexOf(id);
      if (e === -1) continue;
      this.route[e] = 1;
      any = true;
    }
    this.stopped = [];
    for (const id of blockedNodeIds) {
      const i = this.nodeIds.indexOf(id);
      if (i !== -1 && !this.stopped.includes(i) && this.stopped.length < MARKERS) {
        this.stopped.push(i);
      }
    }
    const began = any && !this.routed;
    const ended = !any && this.routed;
    this.routed = any;
    this.refreshHighlights();
    if (this.trace || this.userMoved) return;
    if (began) this.frameSubject(this.routeNodes());
    else if (ended) this.frameAll(true);
  }

  private routeNodes(): number[] {
    const nodes = new Set<number>(this.stopped);
    for (let e = 0; e < this.m; e++) {
      if (this.route[e] !== 1) continue;
      nodes.add(this.edgeSource[e]!);
      nodes.add(this.edgeTarget[e]!);
    }
    return [...nodes];
  }

  setSelection(selection: SceneSelection): void {
    const node = selection?.kind === 'node' ? this.nodeIds.indexOf(selection.id) : -1;
    const edge = selection?.kind === 'edge' ? this.edgeIds.indexOf(selection.id) : -1;
    const changed = node !== this.selectedNode || edge !== this.selectedEdge;
    this.selectedNode = node;
    this.selectedEdge = edge;
    this.refreshHighlights();
    // The connections of a newly selected piece are redrawn outward from it.
    if (changed && node >= 0 && !this.assembling && !this.options.reducedMotion) {
      for (let e = 0; e < this.m; e++) {
        const outgoing = this.edgeSource[e] === node;
        if (!outgoing && this.edgeTarget[e] !== node) continue;
        this.edgeDrawAt[e] = this.time;
        this.edgeDrawFrom[e] = outgoing ? 1 : -1;
      }
    }
  }

  setHoveredNode(nodeId: string | null): void {
    const next = nodeId ? this.nodeIds.indexOf(nodeId) : -1;
    if (next === this.hoveredNode) return;
    this.hoveredNode = next;
    this.refreshHighlights();
  }

  setTooltipElement(element: HTMLElement | null): void {
    this.tooltip = element;
  }

  /**
   * Works out what the selection, the pointer and a running trace emphasise:
   * which connections are inked, and which pieces and connections form the
   * neighbourhood that stays in front while the rest recedes.
   */
  /**
   * The pieces a question of the viewer's reached, to be kept in front with
   * what is selected while the rest recedes: the services a fault that was
   * tried, not placed, took out of their normal state. They are an answer
   * to the viewer, so the connections among them take the focus colour and
   * the pieces themselves take none: on the timeline in use they are well.
   */
  setReached(nodeIds: readonly string[]): void {
    const reached = new Uint8Array(this.n);
    let any = false;
    for (const id of nodeIds) {
      const i = this.nodeIds.indexOf(id);
      if (i < 0) continue;
      reached[i] = 1;
      any = true;
    }
    this.reached = reached;
    this.reachedAny = any;
    this.refreshHighlights();
  }

  private refreshHighlights(): void {
    this.edgeHighlight.fill(0);
    this.related.fill(0);
    this.edgeRelated.fill(0);
    const tracing = this.trace !== null;
    const selecting = this.selectedNode >= 0 || this.selectedEdge >= 0;
    this.focusActive = tracing || selecting || this.routed || this.reachedAny;
    if (this.trace) {
      // A traced request is the one thing on stage: its path, and nothing else.
      for (const e of this.trace.edges) {
        this.edgeHighlight[e] = 1;
        this.edgeRelated[e] = 1;
      }
      for (const i of this.trace.nodes) this.related[i] = 1;
      return;
    }
    if (!selecting && this.routed) {
      for (let e = 0; e < this.m; e++) {
        if (this.route[e] !== 1) continue;
        this.edgeRelated[e] = 1;
        this.related[this.edgeSource[e]!] = 1;
        this.related[this.edgeTarget[e]!] = 1;
      }
    }
    if (this.selectedEdge >= 0) {
      const e = this.selectedEdge;
      this.edgeHighlight[e] = 1;
      this.edgeRelated[e] = 1;
      this.related[this.edgeSource[e]!] = 1;
      this.related[this.edgeTarget[e]!] = 1;
    }
    if (this.selectedNode >= 0) {
      this.related[this.selectedNode] = 1;
      for (let e = 0; e < this.m; e++) {
        if (this.edgeSource[e] === this.selectedNode || this.edgeTarget[e] === this.selectedNode) {
          this.edgeHighlight[e] = 0.75;
          this.edgeRelated[e] = 1;
          this.related[this.edgeSource[e]!] = 1;
          this.related[this.edgeTarget[e]!] = 1;
        }
      }
    }
    if (this.reachedAny && this.reached.length === this.n) {
      for (let i = 0; i < this.n; i++) if (this.reached[i] === 1) this.related[i] = 1;
      for (let e = 0; e < this.m; e++) {
        if (this.reached[this.edgeSource[e]!] === 1 && this.reached[this.edgeTarget[e]!] === 1) {
          this.edgeHighlight[e] = Math.max(this.edgeHighlight[e]!, 0.75);
          this.edgeRelated[e] = 1;
        }
      }
    }
    // Pointing at a piece previews what selecting it would show.
    if (this.hoveredNode >= 0 && this.hoveredNode !== this.selectedNode) {
      for (let e = 0; e < this.m; e++) {
        if (this.edgeSource[e] === this.hoveredNode || this.edgeTarget[e] === this.hoveredNode) {
          this.edgeHighlight[e] = Math.max(this.edgeHighlight[e]!, 0.42);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Assembly
  // ---------------------------------------------------------------------------

  /**
   * Schedules how a freshly built layout comes together: plates open one
   * after another, the edge first, pieces land on them in a wave (or walk
   * over from where they stood in the previous layout), each connection
   * draws itself once both of its ends are in place, and its traffic follows.
   */
  private beginAssembly(
    topology: SceneTopology,
    layout: SceneLayout,
    relaid: boolean,
    walkFrom: Float32Array | null,
  ): void {
    const n = this.n;
    const m = this.m;
    this.delay = new Float32Array(n);
    this.edgeDrawAt = new Float32Array(m).fill(-100);
    this.edgeLiveAt = new Float32Array(m).fill(-100);
    this.edgeDrawFrom.fill(1);
    this.walkFrom = null;
    this.assembling = false;
    for (const base of this.bases) base.delay = 0;
    if (!relaid || this.options.reducedMotion) {
      this.applyBases(1);
      return;
    }

    let landed = 0;
    if (walkFrom) {
      this.walkFrom = walkFrom;
      // A short ripple so the pieces do not move as one block.
      for (let i = 0; i < n; i++) this.delay[i] = (i / Math.max(1, n)) * 0.22;
      landed = 0.22 + WALK_TIME;
    } else {
      // The edge first, then the regions, one after another.
      const order = layout.regions
        .map((region, k) => ({ k, id: region.id, edge: region.kind === 'edge' }))
        .sort((a, b) => Number(b.edge) - Number(a.edge) || a.k - b.k);
      const pace = Math.min(0.1, 0.5 / Math.max(1, order.length));
      const plateDelay = new Map<string, number>();
      order.forEach((entry, rank) => {
        const delay = rank * pace;
        plateDelay.set(entry.id, delay);
        const base = this.bases[entry.k];
        if (base) base.delay = delay;
      });
      const members = new Map<string, number[]>();
      topology.nodes.forEach((node, i) => {
        const list = members.get(node.region) ?? [];
        list.push(i);
        members.set(node.region, list);
      });
      // Pieces land in the direction requests travel: outward from the hub,
      // or from left to right along the lanes.
      const along = (i: number) => {
        const p = nodePosition(layout, i);
        return layout.mode === 'regions' ? Math.hypot(p[0], p[2]) : p[0];
      };
      for (const [regionId, list] of members) {
        list.sort((a, b) => along(a) - along(b) || a - b);
        const start = (plateDelay.get(regionId) ?? 0) + PLATE_TIME * 0.45;
        const spacing = Math.min(0.03, 0.5 / Math.max(1, list.length));
        list.forEach((i, rank) => {
          this.delay[i] = start + rank * spacing;
          landed = Math.max(landed, this.delay[i]! + DROP_TIME);
        });
      }
    }

    const duration = walkFrom ? WALK_TIME : DROP_TIME;
    for (let e = 0; e < m; e++) {
      const ready =
        Math.max(this.delay[this.edgeSource[e]!]!, this.delay[this.edgeTarget[e]!]!) +
        duration * 0.8;
      this.edgeDrawAt[e] = this.time + ready;
      this.edgeLiveAt[e] = this.time + ready + DRAW_TIME * 0.7;
    }
    this.assembleAt = this.time;
    this.assembleEnd = this.time + landed + DRAW_TIME + BEADS_TIME + 0.2;
    this.assembling = true;
    this.applyBases(0);
  }

  /** Opens every plate to where it stands `elapsed` seconds into an assembly. */
  private applyBases(elapsed: number): void {
    for (const base of this.bases) {
      const open = this.assembling ? easeOutCubic(clamp01((elapsed - base.delay) / PLATE_TIME)) : 1;
      const size = Math.max(open, 0.0001);
      // A plate opens from its axis and rises the last little way; a lane
      // unrolls along the direction requests travel.
      if (base.slab) base.group.scale.set(size, 1, 1);
      else base.group.scale.set(size, 1, size);
      base.group.position.y = (open - 1) * 1.2;
      if (base.label >= 0 && base.label < this.regionNamed.length) {
        this.regionNamed[base.label] = open > 0.98 ? 1 : 0;
      }
    }
  }

  /**
   * Follows an authorization decision along its path through the scene. The
   * camera moves in on the path and goes with the request; when the request
   * arrives, or is stopped, the path stays drawn until the trace is cleared.
   */
  playDecision(decision: Pick<AuthorizationDecision, 'hops' | 'blockedAt' | 'decision'>): void {
    const layout = this.layout;
    if (!layout) return;
    const segments: TraceSegment[] = [];
    const edges: number[] = [];
    const nodes = new Set<number>();
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
      nodes.add(source);
      nodes.add(target);
      at = target;
      previous = e;
    }
    if (segments.length === 0) {
      this.hooks.onTraceEnd();
      return;
    }
    const last = segments[segments.length - 1]!;
    const blockedAt =
      decision.decision === 'deny' && decision.blockedAt !== null
        ? this.nodeIds.indexOf(decision.blockedAt)
        : -1;
    // One trace after another is still one visit: the camera goes back to
    // where it was before the first of them.
    const stood = this.controls.getPosition(this.scratch, true).toArray() as Vec3;
    const looked = this.controls.getTarget(this.scratch, true).toArray() as Vec3;
    const before = this.trace?.before ?? { position: stood, target: looked };
    this.trace = {
      segments,
      total: segments.reduce((sum, s) => sum + s.length, 0),
      travelled: 0,
      edges,
      nodes: [...nodes],
      burstAt: last.b,
      burstAge: -1,
      home: [0, 0, 0],
      before,
      blockedAt,
      done: false,
    };
    this.steered = false;
    this.refreshHighlights();
    this.trace.home = this.frameSubject(this.trace.nodes) ?? last.b;
  }

  clearTrace(): void {
    const trace = this.trace;
    if (!trace) return;
    this.trace = null;
    this.refreshHighlights();
    // The path had the camera. With it gone the camera goes back to where
    // it stood, unless the viewer has taken it in the meantime.
    if (this.steered) return;
    // Where it stood was the scene's own shot unless the viewer had chosen
    // one. The scene's own is taken again for the stage as it is now: a
    // panel that came or went while the path was up changed what fits, and
    // the shot from before left the model lying under it.
    if (!this.userMoved) {
      this.reframe();
      return;
    }
    void this.controls.setLookAt(
      ...trace.before.position,
      ...trace.before.target,
      !this.options.reducedMotion,
    );
  }

  /**
   * The shot the scene would choose for itself right now: the path of a
   * traced request, the route of an incident, or else the whole model.
   */
  private reframe(): void {
    if (this.trace) this.trace.home = this.frameSubject(this.trace.nodes) ?? this.trace.home;
    else if (this.routed) this.frameSubject(this.routeNodes());
    else this.frameAll(true);
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  /**
   * The shot that shows the whole model, as large as the free part of the
   * canvas allows.
   *
   * Everything that has to be in the picture (the rim of every plate, every
   * piece from foot to top, the plates' names) is projected through a camera
   * standing at the layout's own attitude, and the camera is moved until the
   * rectangle those points cover is centred in the free area and just fits
   * it. Fitting a bounding sphere instead leaves the model small and off to
   * one side whenever it is not round, which plates seen at an angle are not.
   *
   * The lens is long, so the picture is nearly a parallel projection and the
   * fit is nearly linear: a few rounds of measuring and correcting settle it,
   * and the number of rounds is fixed so the shot is always the same one.
   */
  private framing(subject: readonly number[] | null = null): { position: Vec3; target: Vec3 } {
    const layout = this.layout;
    const width = this.dom.clientWidth || 1600;
    const height = this.dom.clientHeight || 900;
    // The classic axonometric attitude: a little under 40° above the horizon,
    // turned so that three faces of every piece show. The layout is drawn
    // for this view (see `VIEW`).
    const upright = this.upright && this.layoutMode === 'layers';
    const { azimuth, elevation } = viewOf(this.layoutMode, this.upright);
    const toCamera: Vec3 = [
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    ];
    const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
    const up: Vec3 = [
      toCamera[1] * right[2] - toCamera[2] * right[1],
      toCamera[2] * right[0] - toCamera[0] * right[2],
      toCamera[0] * right[1] - toCamera[1] * right[0],
    ];
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    // What has to be in the picture: points of the model, and names, which
    // are boxes of a fixed size on screen hung from a point of the model.
    const points: Vec3[] = [];
    const names: { anchor: Vec3; width: number; height: number; hang: [number, number] }[] = [];
    if (layout && subject) {
      // A few pieces and the room around them: enough of the model stays in
      // the picture to say where on it they are.
      for (const i of subject) {
        const p = nodePosition(layout, i);
        const scale = layout.scales[i] ?? 1;
        const top = (this.typeTop[this.nodeTypeIndex[i]!] ?? 1) * scale;
        const room = scale * 2.2 + 2.5;
        points.push([p[0], p[1] + top + 1.6, p[2]], [p[0], p[1] - scale, p[2]]);
        for (const [dx, dz] of [
          [room, 0],
          [-room, 0],
          [0, room],
          [0, -room],
        ] as const) {
          points.push([p[0] + dx, p[1] - scale, p[2] + dz]);
        }
      }
    } else if (layout) {
      for (const region of layout.regions) {
        const [cx, top, cz] = region.center;
        const rim: [number, number][] = [];
        if (region.shape === 'disc') {
          for (let k = 0; k < 24; k++) {
            const angle = (k / 24) * Math.PI * 2;
            rim.push([Math.cos(angle) * region.radius, Math.sin(angle) * region.radius]);
          }
        } else {
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) rim.push([sx * region.halfWidth, sz * region.halfDepth]);
          }
        }
        // The rim of the plate, and the table under it.
        for (const [x, z] of rim) {
          points.push([cx + x, top, cz + z], [cx + x, -this.relief(), cz + z]);
        }
        if (this.options.labels) {
          const outward: Vec3 = [region.outward[0], 0, region.outward[1]];
          // Upright, a heading is its number: that is all the room it asks for.
          const w = nameWidth(upright ? region.name.split(' ')[0]! : region.name);
          names.push({
            anchor: nameAnchor(region, upright),
            width: w,
            height: REGION_LABEL_PX,
            hang:
              headingOf(region, upright)?.align ??
              hang(dot(outward, right), dot(outward, up), w, REGION_LABEL_PX),
          });
        }
      }
      for (let i = 0; i < this.n; i++) {
        const p = nodePosition(layout, i);
        const scale = layout.scales[i] ?? 1;
        const top = (this.typeTop[this.nodeTypeIndex[i]!] ?? 1) * scale;
        points.push([p[0], p[1] + top + 0.6, p[2]], [p[0], p[1] - scale, p[2]]);
      }
    }

    // Only the area not covered by interface panels counts as visible, less
    // a margin so nothing touches an edge.
    const margin = 28;
    const freeW = Math.max(width * 0.3, width - this.insets.left - this.insets.right - margin * 2);
    const freeH = Math.max(
      height * 0.3,
      height - this.insets.top - this.insets.bottom - margin * 2,
    );
    // Labels have a fixed screen size. When their offsets alone take most
    // of the frame, stepping back cannot make enough room for the model.
    // Frame the geometry and let the label layer place the names that fit.
    let labelLeft = 0;
    let labelRight = 0;
    let labelBottom = 0;
    let labelTop = 0;
    for (const name of names) {
      labelLeft = Math.min(labelLeft, (name.hang[0] - 0.5) * name.width);
      labelRight = Math.max(labelRight, (name.hang[0] + 0.5) * name.width);
      labelBottom = Math.min(labelBottom, (name.hang[1] - 0.5) * name.height);
      labelTop = Math.max(labelTop, (name.hang[1] + 0.5) * name.height);
    }
    if (labelRight - labelLeft > freeW * 0.8 || labelTop - labelBottom > freeH * 0.8) {
      names.length = 0;
    }
    // Pixels a length of one covers at distance one.
    const lens = height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));

    const target: Vec3 = layout ? [...layout.center] : [0, 0, 0];
    let distance = (layout ? layout.radius : 30) * 2 * LENS;
    for (let round = 0; round < 6 && points.length > 0; round++) {
      const camera: Vec3 = [
        target[0] + toCamera[0] * distance,
        target[1] + toCamera[1] * distance,
        target[2] + toCamera[2] * distance,
      ];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      /** Where a point of the model lands, in pixels from the middle of the shot. */
      const project = (p: Vec3): [number, number] => {
        const v: Vec3 = [p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]];
        const scale = lens / Math.max(1e-3, -dot(v, toCamera));
        return [dot(v, right) * scale, dot(v, up) * scale];
      };
      for (const p of points) {
        const [x, y] = project(p);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      for (const name of names) {
        const [x, y] = project(name.anchor);
        const cx = x + name.hang[0] * name.width;
        const cy = y + name.hang[1] * name.height;
        minX = Math.min(minX, cx - name.width / 2);
        maxX = Math.max(maxX, cx + name.width / 2);
        minY = Math.min(minY, cy - name.height / 2);
        maxY = Math.max(maxY, cy + name.height / 2);
      }
      // Move the middle of what was measured to the middle of the shot, then
      // stand as far back as it takes for it to fit.
      const perPixel = distance / lens;
      const shiftX = ((minX + maxX) / 2) * perPixel;
      const shiftY = ((minY + maxY) / 2) * perPixel;
      for (let k = 0; k < 3; k++) target[k] = target[k]! + right[k]! * shiftX + up[k]! * shiftY;
      distance *= Math.max((maxX - minX) / freeW, (maxY - minY) / freeH);
    }
    return {
      target,
      position: [
        target[0] + toCamera[0] * distance,
        target[1] + toCamera[1] * distance,
        target[2] + toCamera[2] * distance,
      ],
    };
  }

  private intro(): void {
    const { position, target } = this.framing();
    if (this.options.reducedMotion) {
      void this.controls.setLookAt(...position, ...target, false);
      return;
    }
    // The one orchestrated moment: start a little higher and farther, then
    // settle into the framing shot.
    void this.controls.setLookAt(
      target[0] + (position[0] - target[0]) * 1.25,
      target[1] + (position[1] - target[1]) * 1.5,
      target[2] + (position[2] - target[2]) * 1.25,
      ...target,
      false,
    );
    const settle = this.controls.smoothTime;
    this.controls.smoothTime = 0.9;
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
    if (changed && !this.userMoved && this.layout) this.reframe();
  }

  private applyViewOffset(step: number): void {
    const width = this.dom.clientWidth;
    const height = this.dom.clientHeight;
    if (width === 0 || height === 0) return;
    this.syncStage(true);
    // A panel slides in over a fifth of a second; the picture slides with it
    // instead of jumping to its new centre.
    const shown = this.insetsShown;
    const ease = this.options.reducedMotion || this.viewKey === '' ? 1 : 1 - Math.exp(-step * 11);
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const gap = this.insets[side] - shown[side];
      shown[side] = Math.abs(gap) < 0.5 ? this.insets[side] : shown[side] + gap * ease;
    }
    const { left, right, top, bottom } = shown;
    const key = `${width}x${height}:${left.toFixed(1)},${right.toFixed(1)},${top.toFixed(1)},${bottom.toFixed(1)}`;
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

  /**
   * Moves in on a few pieces, without leaving the attitude the arrangement
   * is drawn for, and only part of the way: the subject is brought forward
   * and the model it belongs to stays in the picture. The overview is a
   * dozen pieces that are all in view already, and moving in would only
   * push some of them out of it, so there the shot stays the whole model;
   * among fifty services the camera goes closer.
   *
   * Returns where the camera ends up looking.
   */
  private frameSubject(nodes: readonly number[]): Vec3 | null {
    if (nodes.length === 0 || !this.layout) return null;
    const whole = this.framing();
    const close = this.framing(nodes);
    const length = (shot: { position: Vec3; target: Vec3 }) =>
      Math.hypot(
        shot.position[0] - shot.target[0],
        shot.position[1] - shot.target[1],
        shot.position[2] - shot.target[2],
      );
    const far = length(whole);
    const nearest = Math.min(far, length(close));
    const limit = far * (this.layoutMode === 'layers' ? 1 : 0.56);
    // How far along the way from the whole shot to the close one to go.
    const way = far - nearest < 1e-3 ? 0 : Math.min(1, (far - limit) / (far - nearest));
    const mix = (a: Vec3, b: Vec3): Vec3 => [
      a[0] + (b[0] - a[0]) * way,
      a[1] + (b[1] - a[1]) * way,
      a[2] + (b[2] - a[2]) * way,
    ];
    const target = mix(whole.target, close.target);
    const position = mix(whole.position, close.position);
    void this.controls.setLookAt(...position, ...target, !this.options.reducedMotion);
    return target;
  }

  resetView(): void {
    this.userMoved = false;
    this.steered = false;
    this.reframe();
  }

  focusNode(nodeId: string): void {
    const i = this.nodeIds.indexOf(nodeId);
    if (i === -1 || !this.layout) return;
    const p = nodePosition(this.layout, i);
    const animate = !this.options.reducedMotion;
    this.userMoved = true;
    void this.controls.moveTo(p[0], p[1], p[2], animate);
    void this.controls.dollyTo((11 + (this.layout.scales[i] ?? 1) * 5) * LENS, animate);
  }

  frameRegion(regionId: string): void {
    const region = this.layout?.regions.find((r) => r.id === regionId);
    if (!region) return;
    const animate = !this.options.reducedMotion;
    this.userMoved = true;
    void this.controls.moveTo(region.center[0], region.center[1] + 1, region.center[2], animate);
    void this.controls.dollyTo(region.radius * 2.9 * LENS, animate);
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

  // Fired while the viewer is actually moving the camera. A plain click on
  // a piece is not that, and must not stop the shot following the panels.
  private readonly onControl = () => {
    this.userMoved = true;
    this.steered = true;
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
    if (node !== -1) {
      this.focusNode(this.nodeIds[node]!);
      return;
    }
    // On a plate, away from any piece: move in on that region.
    const region = this.pickRegion();
    if (region) this.frameRegion(region);
  };

  /** Points `this.ray` from the camera through the pointer. */
  private aim(): boolean {
    if (!this.pointer.inside) return false;
    const rect = this.dom.getBoundingClientRect();
    this.scratch.set(
      (this.pointer.x / rect.width) * 2 - 1,
      -(this.pointer.y / rect.height) * 2 + 1,
      0.5,
    );
    this.scratch.unproject(this.camera);
    this.ray.origin.copy(this.camera.position);
    this.ray.direction.copy(this.scratch).sub(this.camera.position).normalize();
    return true;
  }

  /** The region whose plate is under the pointer, nearest the camera first. */
  private pickRegion(): string | null {
    const layout = this.layout;
    if (!layout || !this.aim()) return null;
    let best: string | null = null;
    let bestDepth = Infinity;
    for (const region of layout.regions) {
      if (Math.abs(this.ray.direction.y) < 1e-4) continue;
      const along = (region.center[1] - this.ray.origin.y) / this.ray.direction.y;
      if (along <= 0 || along >= bestDepth) continue;
      const x = this.ray.origin.x + this.ray.direction.x * along - region.center[0];
      const z = this.ray.origin.z + this.ray.direction.z * along - region.center[2];
      const inside =
        region.shape === 'disc'
          ? x * x + z * z <= region.radius * region.radius
          : Math.abs(x) <= region.halfWidth && Math.abs(z) <= region.halfDepth;
      if (inside) {
        best = region.id;
        bestDepth = along;
      }
    }
    return best;
  }

  private pickNode(): number {
    const layout = this.layout;
    if (!layout || !this.aim()) return -1;
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
    if (this.layout) {
      // The overview has a dozen pieces: every one of them may be named, at
      // any distance. Elsewhere names come as the camera gets close enough.
      // How sharp they are does not depend on the tier: they are not drawn
      // in the scene's own picture (`labelLayer.ts`).
      const range =
        this.layoutMode === 'layers'
          ? 1e6
          : Math.max(34, this.layout.radius * 1.15) * profile.labelRange * LENS;
      this.labelFadeNear = range * 0.62;
      this.labelFadeFar = range;
    }
    if (changed) this.hooks.onQuality(level);
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
        this.refreshHighlights();
        this.hooks.onHover(hit === -1 ? null : this.nodeIds[hit]!);
      }
      this.dom.style.cursor = hit === -1 ? '' : 'pointer';
    }

    if (this.assembling && this.time >= this.assembleEnd) {
      this.assembling = false;
      this.walkFrom = null;
      this.applyBases(0);
    }
    if (this.assembling) this.applyBases(this.time - this.assembleAt);
    const ease = 1 - Math.exp(-step * 7);
    this.updatePlates(ease);
    this.updateNodes(step, ease, 1 - Math.exp(-step * 16), motion);
    this.updateEdges(ease, 1 - Math.exp(-step * 12));
    this.updateOverlays(step);

    this.applyViewOffset(step);
    const pixelScale =
      (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / (this.dom.clientHeight || 1);
    if (this.edgeUniforms) this.edgeUniforms.pixelScale.value = pixelScale;
    // After the view offset: names are placed where the picture now is.
    const before = performance.now();
    this.drawLabels(step, motion);
    this.namesMs += (performance.now() - before - this.namesMs) * 0.05;
  }

  private updatePlates(ease: number): void {
    for (const plate of this.plates) {
      const { alarm, off } = plate.uniforms;
      alarm.value += (plate.alarm - alarm.value) * ease;
      off.value += (plate.off - off.value) * ease;
    }
  }

  private updateNodes(step: number, ease: number, quick: number, motion: boolean): void {
    const layout = this.layout;
    const ring = this.ringAttr;
    if (!layout || !ring) return;
    const named = this.labelNamed;
    const tones = this.tones;
    const elapsed = this.time - this.assembleAt;
    const walkFrom = this.assembling ? this.walkFrom : null;
    const shown = this.shown;
    const wind = 1 - Math.exp(-step * WIND);
    this.quaternion.identity();
    for (let i = 0; i < this.n; i++) {
      const batch = this.batches[this.nodeTypeIndex[i]!];
      if (!batch) continue;
      const slot = this.nodeSlot[i]!;
      const known = this.known[i] === 1;
      // A state the data does not give is no state: neither normal nor any other.
      const code = known ? this.health[i]! : 0;
      const selected = i === this.selectedNode;
      const hovered = i === this.hoveredNode;
      const impacted = this.impacted[i] === 1;
      const look = aimPiece(
        this.pieceAim,
        code,
        known,
        this.partial[i] === 1,
        impacted,
        this.focusActive,
        this.related[i] === 1,
      );

      // A healthy piece is neutral; only a deviation gives it a colour. A
      // piece that stands for several services takes it when all of them
      // deviate; when only some do, its lamp says so and the piece does not.
      // One whose state is unknown takes a tone of its own, nearer the plate.
      const target = look.tone === UNKNOWN ? tones.unknown : tones.piece[look.tone]!;
      for (let k = 0; k < 3; k++) {
        this.tint[i * 3 + k]! += (target[k]! - this.tint[i * 3 + k]!) * ease;
      }
      this.visibility[i]! += (this.visibilityTarget[i]! - this.visibility[i]!) * ease;
      // With something selected, its neighbourhood stays in front and the
      // rest recedes. A piece that is not in its normal state never does,
      // nor one whose state is unknown.
      this.focus[i]! += (look.focus - this.focus[i]!) * ease;
      const visible = this.visibility[i]!;
      const present = visible * this.focus[i]!;
      this.emphasis[i]! += ((selected ? 1 : hovered ? 0.5 : 0) - this.emphasis[i]!) * quick;
      const emphasis = this.emphasis[i]!;

      batch.tint.setXYZ(slot, this.tint[i * 3]!, this.tint[i * 3 + 1]!, this.tint[i * 3 + 2]!);

      const p = nodePosition(layout, i);
      const base = layout.scales[i] ?? 1;
      const floor = layout.ground[i] ?? 0;
      let x = p[0];
      let y = p[1];
      let z = p[2];
      let size = base;
      // 0 while a piece has not arrived, 1 once it stands on its plate.
      let arrived = 1;
      // How far above its resting height the piece is, in piece heights.
      let airborne = 0;
      // Whether it stands on a plate: a piece still on its way down does not work yet.
      let standing = true;
      if (this.assembling) {
        if (walkFrom) {
          const k = easeInOutCubic(clamp01((elapsed - this.delay[i]!) / WALK_TIME));
          const hop = Math.sin(Math.PI * k) * 2.6;
          x = walkFrom[i * 4]! + (p[0] - walkFrom[i * 4]!) * k;
          y = walkFrom[i * 4 + 1]! + (p[1] - walkFrom[i * 4 + 1]!) * k + hop;
          z = walkFrom[i * 4 + 2]! + (p[2] - walkFrom[i * 4 + 2]!) * k;
          size = walkFrom[i * 4 + 3]! + (base - walkFrom[i * 4 + 3]!) * k;
          airborne = hop / (2 * base);
        } else {
          const local = clamp01((elapsed - this.delay[i]!) / DROP_TIME);
          const fall = (1 - easeOutCubic(local)) * 3.2 * base;
          y += fall;
          arrived = local <= 0 ? 0 : easeOutBack(local);
          size = base * Math.max(arrived, 0.0001);
          airborne = fall / (2 * base);
          standing = local >= 1;
        }
      }
      // The part of a piece that works runs at the pace of its service's
      // traffic. It starts once the piece stands on its plate, takes up a
      // new pace gradually, and winds down when nothing passes. Where the
      // traffic was not measured it rests as it was modelled, as with
      // motion off: stillness there would claim that nothing passed.
      const measured = this.measured[i] === 1;
      const pace =
        motion && standing && measured
          ? paceOf(this.throughput[i]!, this.throughputReference[i]!)
          : 0;
      this.pace[i]! += (pace - this.pace[i]!) * wind;
      this.work[i] = (this.work[i]! + step * this.pace[i]!) % WORK_CYCLE;
      // How it runs follows the service's state (`aimPiece`).
      const turn = motion ? step * MANNER_RATE : Infinity;
      this.manner[i]! += Math.max(-turn, Math.min(turn, look.manner - this.manner[i]!));
      // A piece that has just failed is jolted, once.
      const age = this.time - this.shockAt[i]!;
      if (motion && age >= 0 && age < 0.7)
        size *= 1 + Math.exp(-age * 7) * Math.cos(age * 24) * 0.11;
      // Selecting or pointing at a piece picks it up a little.
      size *= 1 + emphasis * 0.08;
      y += size - base + emphasis * base * 0.14;

      // It turns the short way round to where it is to face.
      const aim = this.yawAim[i]!;
      const round = Math.atan2(Math.sin(aim - this.yaw[i]!), Math.cos(aim - this.yaw[i]!));
      this.yaw[i] = motion ? this.yaw[i]! + round * ease : aim;
      this.facingTurn.setFromAxisAngle(UP, this.yaw[i]!);
      this.position.set(x, y, z);
      this.scale.setScalar(size);
      batch.mesh.setMatrixAt(slot, this.matrix.compose(this.position, this.facingTurn, this.scale));
      // The working part is moved in the shader, in the piece's own frame:
      // it has to be told the turn, or the part moves as if the piece
      // still stood the way it was modelled.
      batch.turn.setXY(slot, Math.cos(this.yaw[i]!), Math.sin(this.yaw[i]!));
      // With motion off every mechanism rests as it was modelled.
      batch.fx.setXYZW(
        slot,
        motion && measured ? this.work[i]! : -1,
        this.manner[i]!,
        present,
        size,
      );
      shown[i * 4] = x;
      shown[i * 4 + 1] = y;
      shown[i * 4 + 2] = z;
      shown[i * 4 + 3] = size;

      // One whose state is unknown has no lamp: a dashed ring without hue.
      const lamp = look.open
        ? tones.unknownRing
        : code > 0
          ? tones.lamp[code]!
          : impacted
            ? tones.warning
            : tones.ink;
      ring.pos.setXYZ(i, x, floor + 0.035, z);
      ring.color.setXYZ(i, lamp[0], lamp[1], lamp[2]);
      const ringed = selected || hovered ? Math.min(1, emphasis * 2) : 0;
      ring.ring.setXYZW(
        i,
        // The contact shadow tightens as the piece leaves the plate.
        base * 0.95 * clamp01(arrived) * (1 - 0.45 * clamp01(airborne) + emphasis * 0.06),
        groundMarkOf(look, present),
        motion ? this.shockAt[i]! : -100,
        (selected ? 1 : 0.45) * ringed,
      );
      // The selected and the pointed-at piece are always named; the rest
      // get their names when the camera is close enough to read them.
      if (i < named.length) {
        named[i] = this.assembling && (walkFrom !== null || arrived < 0.99) ? 0 : present;
        this.labelEmphasis[i] = selected || hovered ? 1 : 0;
        this.labelRing[i] = ringed;
        // What matters more is named first: a failing service, then one an
        // incident has reached, then the rest.
        this.labelAlarm[i] = look.alarm;
      }
    }
    for (const batch of this.batches) {
      if (!batch) continue;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.tint.needsUpdate = true;
      batch.fx.needsUpdate = true;
      batch.turn.needsUpdate = true;
    }
    ring.pos.needsUpdate = true;
    ring.color.needsUpdate = true;
    ring.ring.needsUpdate = true;
    this.updateStems();
  }

  /**
   * Hands every name to the label layer for this frame: where its anchor is
   * on the screen, how present it is and how much it matters. The layer
   * decides which of them there is room for and draws those.
   *
   * A plate's name is hung off its rim on whichever side is outward as the
   * camera now sees it, so the text never lies across the plate it names.
   */
  private drawLabels(step: number, motion: boolean): void {
    const layer = this.labelLayer;
    const layout = this.layout;
    const width = this.dom.clientWidth;
    const height = this.dom.clientHeight;
    if (!layout || !this.labelsReady || !this.options.labels || width === 0 || height === 0) {
      layer.draw(width, height, step, true, null);
      return;
    }
    this.camera.updateMatrixWorld();
    const anchors = this.labelAnchors;
    const eye = this.camera.position;
    const [alignX, alignY] = this.labelAlign;
    const span = Math.max(1e-6, this.labelFadeFar - this.labelFadeNear);
    // In the overview a name lies at the foot of its piece, which is where
    // the ring of a selection is drawn: the name steps out as the ring
    // comes, so the ring never runs through the words.
    const clearance = layout.mode === 'layers' ? RING_CLEARANCE : 0;
    for (let i = 0; i < this.n; i++) {
      const present = this.labelNamed[i]!;
      const emphasis = this.labelEmphasis[i] === 1;
      const out = clearance * this.labelRing[i]! * (layout.scales[i] ?? 1);
      this.scratch.set(
        anchors[i * 3]! + out * this.nameToward[0],
        anchors[i * 3 + 1]!,
        anchors[i * 3 + 2]! + out * this.nameToward[1],
      );
      const distance = this.scratch.distanceTo(eye);
      // Away from the camera a name fades out, unless it is the one in hand.
      const near = clamp01((distance - this.labelFadeNear) / span);
      const fade = emphasis ? 1 : 1 - near * near * (3 - 2 * near);
      this.scratch.project(this.camera);
      const behind = this.scratch.z < -1 || this.scratch.z > 1;
      const alarm = this.labelAlarm[i]!;
      layer.set(
        i,
        (this.scratch.x * 0.5 + 0.5) * width,
        (-this.scratch.y * 0.5 + 0.5) * height,
        alignX,
        alignY,
        behind ? 0 : present * fade,
        // Among names of the same standing, the nearer one first.
        alarm * 100 + 10 - Math.min(9.99, distance / Math.max(1, this.labelFadeFar)),
        (alarm === 3 ? 2 : emphasis ? 1 : 0) as LabelTone,
        emphasis,
      );
    }
    // The camera's own right and up, in world space.
    const m = this.camera.matrixWorld.elements;
    layout.regions.forEach((region, k) => {
      const i = this.n + k;
      this.scratch.set(anchors[i * 3]!, anchors[i * 3 + 1]!, anchors[i * 3 + 2]!);
      this.scratch.project(this.camera);
      const behind = this.scratch.z < -1 || this.scratch.z > 1;
      const [ox, oz] = region.outward;
      const [w, h] = layer.sizeOf(i);
      // A heading keeps the place it was given; a name is hung off the rim.
      const [ax, ay] =
        headingOf(region, this.upright && layout.mode === 'layers')?.align ??
        hang(ox * m[0]! + oz * m[2]!, ox * m[4]! + oz * m[6]!, w, h);
      layer.set(
        i,
        (this.scratch.x * 0.5 + 0.5) * width,
        (-this.scratch.y * 0.5 + 0.5) * height,
        ax,
        ay,
        behind ? 0 : (this.regionNamed[k] ?? 0),
        // Places come before the services that stand on them, and after a
        // service that is failing.
        250,
        1,
        false,
      );
    });
    // A name is read where nothing of the interface lies over it.
    layer.draw(width, height, step, !motion, this.labelColours, this.insetsShown);
  }

  /** The supports under raised pieces follow them. */
  private updateStems(): void {
    const stems = this.stems;
    const layout = this.layout;
    if (!stems || !layout) return;
    stems.nodes.forEach((i, k) => {
      const floor = layout.ground[i] ?? 0;
      const size = this.shown[i * 4 + 3]!;
      const height = Math.max(0.0001, this.shown[i * 4 + 1]! - size - floor);
      this.position.set(this.shown[i * 4]!, floor, this.shown[i * 4 + 2]!);
      const present = Math.min(1, size / (layout.scales[i] ?? 1));
      this.scale.set(present, height, present);
      stems.mesh.setMatrixAt(k, this.matrix.compose(this.position, this.quaternion, this.scale));
    });
    stems.mesh.instanceMatrix.needsUpdate = true;
  }

  private updateEdges(ease: number, quick: number): void {
    const attr = this.edgeAttr;
    if (!attr) return;
    const data = this.particleData?.image.data as Float32Array | undefined;
    const m = this.m;
    // The more connections a topology has, the quieter each one is at rest,
    // so a dense graph stays a drawing instead of turning into a mat.
    const calm = Math.min(1, Math.sqrt(120 / Math.max(1, m)));
    // In the overview a line is the main thing drawn: firmer, and wider.
    const firm = this.layoutMode === 'layers' ? 1 : 0;
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

      // A connection is a neutral hairline; it takes the focus colour when
      // it is part of what the viewer is following and a signal colour when
      // its traffic is in trouble.
      const status = this.tones.status[this.edgeSecurity[e]!] ?? null;
      const alarm = Math.min(1, this.edgeErrShown[e]! * 2.5);
      const troubled = status !== null || alarm > 0.05 ? 1 : 0;
      this.edgeGlow[e]! += (this.edgeHighlight[e]! - this.edgeGlow[e]!) * quick;
      const highlight = this.edgeGlow[e]!;
      const inFocus = !this.focusActive || this.edgeRelated[e] === 1 || troubled === 1;
      this.edgeFocus[e]! += ((inFocus ? 1 : EDGE_FOCUS_DIM) - this.edgeFocus[e]!) * ease;

      const shown = this.edgeDensity[e]!;
      const filtered = Math.min(
        this.visibility[this.edgeSource[e]!]!,
        this.visibility[this.edgeTarget[e]!]!,
      );
      const visible = filtered * this.edgeFocus[e]!;
      for (let k = 0; k < 3; k++) {
        let channel = this.tones.track[k]!;
        channel += (this.tones.focus[k]! - channel) * highlight;
        if (status) channel = status[k]!;
        channel += (this.tones.critical[k]! - channel) * alarm;
        attr.color.array[e * 3 + k] = channel;
      }
      // How much of the line has been drawn, and from which of its ends.
      const drawn = easeOutCubic(clamp01((this.time - this.edgeDrawAt[e]!) / DRAW_TIME));
      const flowing = clamp01((this.time - this.edgeLiveAt[e]!) / BEADS_TIME);
      attr.fx.setXYZW(
        e,
        Math.min(1, (0.3 + shown * 0.3) * calm + firm * 0.5 + highlight * 0.6 + troubled * 0.35) *
          (0.1 + 0.9 * visible),
        drawn,
        0.9 + shown * 0.9 + firm * 0.4 + highlight * 1.1 + troubled * 0.6,
        this.edgeDrawFrom[e]!,
      );
      if (data) {
        data[(0 * m + e) * 4 + 3] = shown * (filtered > 0.5 ? 1 : 0.12) * flowing;
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

  /**
   * The sprites that are placed by hand: the traced request and its tail,
   * the mark where it arrived or was stopped, and the badges on pieces at
   * which an incident's traffic is being stopped.
   */
  private updateTrace(step: number): void {
    const { pos, color, fx } = this.tracerAttr;
    const trace = this.trace;
    const focus = this.tones.focus;
    const stop = this.tones.critical;
    let any = false;

    if (trace && !trace.done) {
      const speed = this.options.reducedMotion ? 1e6 : Math.max(11, trace.total / 3.2);
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
      // The traced request is drawn in the colour of the viewer's attention:
      // it is the one request on the model they asked to see.
      const fade = trace.burstAge < 0 ? 1 : Math.max(0, 1 - trace.burstAge / 0.5);
      for (let k = 0; k < TRAIL; k++) {
        const p = sample(trace.travelled - k * 0.5);
        const falloff = 1 - k / TRAIL;
        pos.setXYZ(k, p[0], p[1], p[2]);
        color.setXYZ(k, focus[0], focus[1], focus[2]);
        fx.setXYZW(
          k,
          k === 0 ? 1.05 : 0.22 + falloff * 0.36,
          (k === 0 ? 1 : falloff * 0.7) * fade,
          0,
          0,
        );
      }
      any = true;
      // The camera goes a little of the way with the request, so the eye is
      // led along the path without the path ever leaving the picture.
      const follow = !this.options.reducedMotion && !this.steered;
      if (follow && trace.burstAge < 0) {
        const head = sample(trace.travelled);
        const [hx, hy, hz] = trace.home;
        // Less in the overview, where the whole model is in the picture and
        // should stay in it.
        const lead = this.layoutMode === 'layers' ? 0.1 : 0.22;
        void this.controls.moveTo(
          hx + (head[0] - hx) * lead,
          hy + (head[1] - hy) * lead,
          hz + (head[2] - hz) * lead,
          true,
        );
      }
      if (trace.burstAge > 0.55) {
        trace.done = true;
        // The request has arrived: the camera settles on the whole path.
        if (follow) void this.controls.moveTo(...trace.home, true);
        this.hooks.onTraceEnd();
      }
    } else {
      for (let k = 0; k < TRAIL; k++) fx.setXYZW(k, 0, 0, 0, 0);
    }

    // Where the traced request ended. Allowed, a ring opens there once;
    // stopped, a badge stays on the piece that stopped it.
    if (trace && trace.blockedAt >= 0) {
      const shown = trace.burstAge < 0 ? 0 : Math.min(1, trace.burstAge / 0.18);
      this.badge(TRAIL, trace.blockedAt, stop, trace.done ? 1 : shown);
      any = any || shown > 0 || trace.done;
    } else if (trace && !trace.done) {
      const burst = trace.burstAge < 0 ? 0 : Math.max(0, 1 - trace.burstAge / 0.55);
      pos.setXYZ(TRAIL, trace.burstAt[0], trace.burstAt[1], trace.burstAt[2]);
      color.setXYZ(TRAIL, focus[0], focus[1], focus[2]);
      fx.setXYZW(TRAIL, trace.burstAge < 0 ? 0 : 1.6 + trace.burstAge * 7, burst, 1, 0);
    } else {
      fx.setXYZW(TRAIL, 0, 0, 0, 0);
    }

    // Where an incident's traffic is being stopped. A trace has the stage
    // to itself, so these wait while one is shown.
    for (let k = 0; k < MARKERS; k++) {
      const i = trace ? undefined : this.stopped[k];
      if (i === undefined) fx.setXYZW(TRAIL + 1 + k, 0, 0, 0, 0);
      else {
        this.badge(TRAIL + 1 + k, i, stop, 1);
        any = true;
      }
    }

    this.tracerMesh.visible = any;
    if (any) pos.needsUpdate = color.needsUpdate = fx.needsUpdate = true;
  }

  /**
   * Pins a badge to a piece: at its upper right as the camera sees it, the
   * way a mark is put on the corner of a card.
   */
  private badge(slot: number, node: number, tone: Vec3, shown: number): void {
    const { pos, color, fx } = this.tracerAttr;
    const m = this.camera.matrixWorld.elements;
    const size = this.shown[node * 4 + 3] || (this.layout?.scales[node] ?? 1);
    const out = size * 0.82;
    const up = size * 0.95;
    // A badge is a mark on a piece, not a part of it: it grows only a
    // little with the piece it is pinned to.
    const span = 1.1 + size * 0.35;
    pos.setXYZ(
      slot,
      this.shown[node * 4]! + m[0]! * out + m[4]! * up,
      this.shown[node * 4 + 1]! + m[1]! * out + m[5]! * up,
      this.shown[node * 4 + 2]! + m[2]! * out + m[6]! * up,
    );
    color.setXYZ(slot, tone[0], tone[1], tone[2]);
    fx.setXYZW(slot, span * (0.6 + 0.4 * shown), shown, 2, 0);
  }

  render(): void {
    if (this.disposed) return;
    // One pass, straight to the canvas: there is no post-processing.
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
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
   * (RGBA, 8 bits per channel), in the colours the canvas shows. Used to
   * verify output where the canvas itself cannot be captured, such as WebGPU
   * in headless browsers.
   */
  async captureFrame(): Promise<{
    width: number;
    height: number;
    pixels: Uint8Array;
    flipY: boolean;
  }> {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2()).floor();
    if (this.backend === 'webgl2') {
      // The canvas's own drawing buffer can be read back for as long as the
      // task that drew it lasts, so the frame is drawn to the canvas as any
      // other and read from there. The output-target path below was found
      // to leave this backend presenting nothing once the world is rebuilt
      // after a capture (the arrangement is switched), and to never answer
      // the next read; it is kept for the backend that has no other way.
      const gl = (this.dom as HTMLCanvasElement).getContext('webgl2');
      if (gl) {
        this.renderer.render(this.scene, this.camera);
        const pixels = new Uint8Array(size.x * size.y * 4);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        // Rows come bottom-up.
        return { width: size.x, height: size.y, pixels, flipY: true };
      }
    }
    // One target for the life of the scene: the renderer keeps state for its
    // output target, and a fresh target per capture is not picked up again
    // after the first.
    if (!this.captureTarget) {
      this.captureTarget = new THREE.RenderTarget(size.x, size.y, {
        type: THREE.UnsignedByteType,
      });
      this.disposables.push(this.captureTarget);
    } else if (this.captureTarget.width !== size.x || this.captureTarget.height !== size.y) {
      this.captureTarget.setSize(size.x, size.y);
    }
    const target = this.captureTarget;
    // As the *output* target it receives what the canvas would: colours
    // converted to the display colour space, not the linear working values.
    this.renderer.setOutputRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setOutputRenderTarget(null);
    const pixels = await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, size.x, size.y);
    return {
      width: size.x,
      height: size.y,
      pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      // WebGPU hands rows back top-down.
      flipY: this.backend === 'webgl2',
    };
  }

  /** The names on screen right now, each with the box it is drawn in (CSS pixels). */
  labelBoxes(): { text: string; left: number; top: number; right: number; bottom: number }[] {
    return this.labelLayer.boxes();
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
      names: this.labelLayer.drawn,
      namesMs: this.namesMs,
      unknown: this.known.reduce((count, known) => count + (known === 0 ? 1 : 0), 0),
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
    this.controls.removeEventListener('control', this.onControl);
    this.controls.dispose();
    this.clearWorld();
    this.labelLayer.dispose();
    for (const resource of this.disposables) resource.dispose();
    this.scene.remove(this.root);
  }
}

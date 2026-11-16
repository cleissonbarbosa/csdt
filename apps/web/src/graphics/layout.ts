/**
 * Deterministic spatial layout of a topology.
 *
 * Pure functions of the topology: no randomness, no simulation, no
 * dependence on insertion order beyond explicit sorting. The same topology
 * always produces the same picture, which keeps the scene stable across
 * reloads and makes the layout testable.
 *
 * The scene is a scale model, so every service stands on something. Node
 * geometry is built with its base at `y = -1`; a node of scale `s` placed at
 * `ground + s` therefore rests exactly on the surface below it. `ground` is
 * kept per node so the scene can draw contact shadows and support stems.
 *
 * Both arrangements are built from the same three decisions:
 *
 * - A tier is a line of pieces, and the space between two tiers is wider
 *   than the space between two pieces of one tier, so the lines can be read
 *   without anything being drawn to mark them.
 * - Within a line, pieces of one kind stand together, and among those each
 *   stands as near as it can to what it is connected to in the lines before
 *   it, which keeps connections from crossing more than they have to.
 * - A plate is as large as what stands on it, and no larger.
 *
 * `regions` mode — a hub and its spokes. The global edge is a low plinth at
 * the centre (the edge router in the middle, clients around it, the security
 * monitor on a mast above). Each cloud region is a round plate beside it,
 * with its gateway at the hub's side and its tiers running outward. Nothing
 * stands over anything else, so no piece is hidden behind a plate.
 *
 * `dependencies` mode — swimlanes. Tiers are columns that run left to right
 * in the direction requests travel, and each region is a lane of its own
 * across them, so a tier can be compared between regions along one line.
 *
 * `layers` mode — the overview. It is given a platform already reduced to
 * its kinds of service (see `lib/overview.ts`), whose "regions" are the
 * logical layers a request crosses. Each layer is a low plate, and the
 * plates stand one after another in the direction requests travel, so depth
 * into the picture is distance along the path and nothing else.
 */
import type { InfrastructureNode, ServiceType, Topology } from '@aegis/contracts';

export type LayoutMode = 'layers' | 'regions' | 'dependencies';

export type Vec3 = [number, number, number];

/**
 * The attitude each arrangement is drawn for: where the default camera
 * stands, as an angle around the model and an angle above the horizon. The
 * layout faces it, and the scene frames its opening shot from it.
 */
export const VIEW: Record<LayoutMode, { azimuth: number; elevation: number }> = {
  layers: { azimuth: -0.3, elevation: 0.66 },
  regions: { azimuth: -0.42, elevation: 0.68 },
  dependencies: { azimuth: -0.3, elevation: 0.74 },
};

/**
 * The overview on a stage that is taller than it is wide, a phone held
 * upright. Drawn for the usual attitude, its four layers run across the
 * picture, and a picture 390 pixels across left them a strip a hundred
 * pixels tall with names larger than the pieces. Here the camera stands at
 * the entry and looks along the path instead, so the layers stand one above
 * another and fill the height: depth into the picture is still distance
 * along the path, more plainly than before. It stands a little higher as
 * well, so a piece does not cover the name of the one behind it.
 */
export const VIEW_UPRIGHT = { azimuth: -Math.PI / 2 + 0.3, elevation: 0.9 };

/** How much taller than wide a stage has to be for the upright attitude. */
export const UPRIGHT_ASPECT = 1.15;

/** The attitude an arrangement is seen from, on a stage that is `upright` or not. */
export function viewOf(mode: LayoutMode, upright: boolean): { azimuth: number; elevation: number } {
  return upright && mode === 'layers' ? VIEW_UPRIGHT : VIEW[mode];
}

/** A plate: the surface a region's services stand on. */
export interface RegionLayout {
  id: string;
  name: string;
  /** A layer is a way of looking at the platform, not a place in it. */
  kind: 'edge' | 'cloud' | 'layer';
  /** Round in the regions arrangement, rectangular in the swimlanes. */
  shape: 'disc' | 'slab';
  /** Middle of the plate's top face. */
  center: Vec3;
  /** Radius of a disc; for a slab, of the circle around its corners. */
  radius: number;
  /** Half extents along x and z (both equal to `radius` for a disc). */
  halfWidth: number;
  halfDepth: number;
  /**
   * Unit direction on the ground, `[x, z]`, that points away from the rest
   * of the model. The plate's name stands off the rim on this side.
   */
  outward: [number, number];
  /**
   * Set when the name is a heading with a fixed place instead: where it is
   * anchored, and where the middle of the text goes from there, in units of
   * its own width and height.
   */
  heading?: {
    anchor: Vec3;
    align: [number, number];
    /** The same, for the attitude of a stage that is taller than wide. */
    upright?: { anchor: Vec3; align: [number, number] };
  };
}

export interface SceneLayout {
  mode: LayoutMode;
  /** `x, y, z` per node, in topology order. */
  positions: Float32Array;
  /** Uniform scale per node. */
  scales: Float32Array;
  /** Height of the surface under each node. */
  ground: Float32Array;
  /** Plates; `center` is the middle of the plate's top face. */
  regions: RegionLayout[];
  /** Centre and radius of a sphere enclosing everything. */
  center: Vec3;
  radius: number;
  /**
   * How far each piece is turned about the vertical so that the side its
   * traffic arrives at faces where that traffic comes from (see `ARRIVAL`).
   * Not a number for a piece that has no such side, or nothing arriving.
   */
  facing: Float32Array;
}

/**
 * The side of a piece its traffic arrives at, as a direction on the ground
 * in the piece's own frame, `[x, z]`. A gate is gone through, a shield is
 * faced, a container is loaded at its door end and a queue is joined at its
 * tail. The other pieces are the same from every side that matters, and
 * keep the attitude they were modelled for.
 *
 * The gate and the shield used to stand as they were modelled, facing the
 * viewer, whichever way requests came: the line of traffic went into the
 * flank of the arch and out of the other.
 */
export const ARRIVAL: Partial<Record<ServiceType, readonly [number, number]>> = {
  'api-gateway': [0, 1],
  'auth-service': [0, 1],
  container: [-1, 0],
  'message-queue': [-1, 0],
};

/** Clear space between two neighbours in a line, and two lines of one tier. */
const PIECE_CLEAR = 0.9;
/** Clear space between two tiers: about twice the above, so tiers read apart. */
const TIER_CLEAR = 1.9;
/** From the centre of the outermost piece to the rim of its plate. */
const PLATE_MARGIN = 2.5;
const MIN_PLATE = 6;
/** Table left showing between two plates. */
const PLATE_GAP = 1.8;
/** Height of the plinth that carries the global edge. */
const HUB_HEIGHT = 1.8;
/** Gap between the edge router and the monitor on its mast. */
const MAST_GAP = 1.4;
/** Each further line of a tier costs this much plate, when weighing plates. */
const LINE_COST = 0.3;
/** Clear space between two tiers of the swimlanes, where connections run. */
const COLUMN_CLEAR = 5;
/** The picture the swimlanes are proportioned for. */
const PICTURE_ASPECT = 16 / 9;
/** Table left between a plate's rim and its name. */
const NAME_GAP = 0.9;
/**
 * The overview has a dozen pieces and the whole screen, so it is given air.
 * Two pieces of one column stand far enough apart that the nearer one, seen
 * from where the camera first stands, covers neither the farther one nor
 * the name written at its foot.
 */
const LAYER_CLEAR = 5.2;
const LAYER_COLUMN_CLEAR = 3.6;
const LAYER_MARGIN = 2.6;
/** Table left showing between two layers: the line that separates them. */
const LAYER_GAP = 1.3;
/**
 * With so few of them the pieces can be larger, and nearer one another in
 * size: here a piece stands for a kind, and no kind is the main one.
 */
const layerScale = (scale: number) => 1.3 * (0.6 * scale + 0.56);

const TYPE_ORDER: Record<ServiceType, number> = {
  'external-client': 0,
  'network-gateway': 1,
  'security-monitor': 2,
  'api-gateway': 3,
  'auth-service': 4,
  'cedar-authorizer': 5,
  microservice: 6,
  container: 7,
  serverless: 8,
  'message-queue': 9,
  database: 10,
  storage: 11,
};

const TYPE_SCALE: Record<ServiceType, number> = {
  'network-gateway': 2.1,
  'api-gateway': 1.62,
  'security-monitor': 1.68,
  'cedar-authorizer': 1.38,
  'auth-service': 1.32,
  database: 1.26,
  'external-client': 1.2,
  microservice: 1.14,
  container: 1.14,
  serverless: 1.14,
  'message-queue': 1.2,
  storage: 1.14,
};

interface Indexed {
  node: InfrastructureNode;
  index: number;
}

const byId = (a: Indexed, b: Indexed) =>
  a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0;

function byTypeThenId(a: Indexed, b: Indexed): number {
  return TYPE_ORDER[a.node.serviceType] - TYPE_ORDER[b.node.serviceType] || byId(a, b);
}

/** The members of each tier, lowest tier first, each sorted by kind. */
function tiersOf(nodes: Indexed[]): Indexed[][] {
  const tiers = new Map<number, Indexed[]>();
  for (const entry of nodes) {
    const list = tiers.get(entry.node.tier) ?? [];
    list.push(entry);
    tiers.set(entry.node.tier, list);
  }
  return [...tiers.keys()].sort((a, b) => a - b).map((tier) => tiers.get(tier)!.sort(byTypeThenId));
}

/** Splits a tier into lines of at most `cap`, as equal in length as they can be. */
function split(members: Indexed[], cap: number): Indexed[][] {
  const count = Math.ceil(members.length / Math.max(1, cap));
  const base = Math.floor(members.length / count);
  const longer = members.length % count;
  const lines: Indexed[][] = [];
  let from = 0;
  for (let k = 0; k < count; k++) {
    const length = base + (k < longer ? 1 : 0);
    lines.push(members.slice(from, from + length));
    from += length;
  }
  return lines;
}

/** For every node, the nodes it shares a connection with. */
function neighboursOf(topology: Topology): number[][] {
  const index = new Map(topology.nodes.map((node, i) => [node.id, i]));
  const lists: number[][] = topology.nodes.map(() => []);
  for (const edge of topology.edges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    lists[a]!.push(b);
    lists[b]!.push(a);
  }
  return lists;
}

/**
 * Orders one line. Pieces of a kind stay together; among them, each goes
 * toward the pieces it is connected to in the lines already placed, whose
 * positions along the line are in `placed`.
 */
function arrange(line: Indexed[], links: number[][], placed: Map<number, number>): Indexed[] {
  const pull = new Map<number, number>();
  for (const entry of line) {
    let sum = 0;
    let count = 0;
    for (const other of links[entry.index] ?? []) {
      const at = placed.get(other);
      if (at === undefined) continue;
      sum += at;
      count++;
    }
    pull.set(entry.index, count > 0 ? sum / count : 0);
  }
  return [...line].sort(
    (a, b) =>
      TYPE_ORDER[a.node.serviceType] - TYPE_ORDER[b.node.serviceType] ||
      pull.get(a.index)! - pull.get(b.index)! ||
      byId(a, b),
  );
}

/** One line of pieces, measured along the axis its tiers run on. */
interface Line {
  members: Indexed[];
  /** Distance from the first line. */
  depth: number;
  /** Distance between neighbours, and from the middle to the last of them. */
  pitch: number;
  half: number;
}

function linesOf(tiers: Indexed[][], cap: number, scales: Float32Array, tierClear: number): Line[] {
  const lines: Line[] = [];
  let depth = 0;
  let previous = 0;
  for (const members of tiers) {
    split(members, cap).forEach((run, r) => {
      const size = Math.max(...run.map((entry) => scales[entry.index]!));
      if (lines.length > 0) depth += previous + size + (r === 0 ? tierClear : PIECE_CLEAR);
      const pitch = 2 * size + PIECE_CLEAR;
      lines.push({ members: run, depth, pitch, half: ((run.length - 1) * pitch) / 2 });
      previous = size;
    });
  }
  return lines;
}

/**
 * The smallest circle, centred on the axis, around the ends of every line.
 * Its centre is either level with one line or where two lines are equally
 * far away, so the candidates can simply be listed.
 */
function circleAround(lines: Line[]): { centre: number; radius: number } {
  const reach = (t: number) => {
    let farthest = 0;
    for (const line of lines) farthest = Math.max(farthest, line.half ** 2 + (line.depth - t) ** 2);
    return farthest;
  };
  let centre = 0;
  let best = Infinity;
  const consider = (t: number) => {
    const squared = reach(t);
    if (squared < best - 1e-9) {
      best = squared;
      centre = t;
    }
  };
  for (const line of lines) consider(line.depth);
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!;
      const b = lines[j]!;
      if (a.depth === b.depth) continue;
      consider(
        (a.half ** 2 - b.half ** 2 + a.depth ** 2 - b.depth ** 2) / (2 * (a.depth - b.depth)),
      );
    }
  }
  return { centre, radius: Number.isFinite(best) ? Math.sqrt(best) : 0 };
}

interface Plate {
  lines: Line[];
  /** Where the middle of the plate is, measured from the first line. */
  centre: number;
  radius: number;
}

/**
 * Fits a region onto a round plate: tiers as straight lines across it, the
 * first at the rim. A long tier may be broken into several lines; of the
 * ways of doing that, the one that needs the smallest plate is taken.
 */
function plateFor(nodes: Indexed[], scales: Float32Array): Plate {
  const tiers = tiersOf(nodes);
  const longest = Math.max(1, ...tiers.map((tier) => tier.length));
  let chosen: Plate | null = null;
  let lowest = Infinity;
  for (let cap = longest; cap >= 2; cap--) {
    const lines = linesOf(tiers, cap, scales, TIER_CLEAR);
    const { centre, radius } = circleAround(lines);
    const cost = radius + LINE_COST * (lines.length - tiers.length);
    if (cost < lowest - 1e-9) {
      lowest = cost;
      chosen = { lines, centre, radius };
    }
  }
  if (!chosen) {
    const lines = linesOf(tiers, longest, scales, TIER_CLEAR);
    chosen = { lines, ...circleAround(lines) };
  }
  return { ...chosen, radius: Math.max(MIN_PLATE, chosen.radius + PLATE_MARGIN) };
}

function enclose(positions: Float32Array, extra: number): { center: Vec3; radius: number } {
  const n = positions.length / 3;
  if (n === 0) return { center: [0, 0, 0], radius: 10 };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let radius = 0;
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3]! - center[0];
    const dy = positions[i * 3 + 1]! - center[1];
    const dz = positions[i * 3 + 2]! - center[2];
    radius = Math.max(radius, Math.hypot(dx, dy, dz));
  }
  return { center, radius: radius + extra };
}

/** The nodes of each region, and a way to stand one of them on a surface. */
function stage(topology: Topology) {
  const n = topology.nodes.length;
  const positions = new Float32Array(n * 3);
  const scales = new Float32Array(n);
  const ground = new Float32Array(n);
  topology.nodes.forEach((node, i) => (scales[i] = TYPE_SCALE[node.serviceType]));
  /** Stands a node on the surface at `floor`, optionally raised by `lift`. */
  const put = (index: number, x: number, floor: number, z: number, lift = 0) => {
    positions[index * 3] = x;
    positions[index * 3 + 1] = floor + lift + scales[index]!;
    positions[index * 3 + 2] = z;
    ground[index] = floor;
  };
  const byRegion = new Map<string, Indexed[]>();
  topology.nodes.forEach((node, index) => {
    const list = byRegion.get(node.region) ?? [];
    list.push({ node, index });
    byRegion.set(node.region, list);
  });
  return { positions, scales, ground, put, byRegion };
}

/** What stands at the global edge, sorted into the roles the hub gives them. */
function edgeCast(members: Indexed[]) {
  const sorted = [...members].sort(byTypeThenId);
  const routers = sorted.filter((m) => m.node.serviceType === 'network-gateway');
  const core = routers.shift();
  // Monitors watch from a mast above the router. Without one they are
  // ordinary pieces.
  const monitors = core ? sorted.filter((m) => m.node.serviceType === 'security-monitor') : [];
  const rest = sorted.filter((m) => m !== core && !monitors.includes(m));
  return { core, monitors, rest };
}

function layoutRegions(topology: Topology): Arrangement {
  const { positions, scales, ground, put, byRegion } = stage(topology);
  const links = neighboursOf(topology);

  const cloud = topology.regions.filter((r) => r.kind === 'cloud' && byRegion.has(r.id));
  const edge = topology.regions.filter((r) => r.kind !== 'cloud' && byRegion.has(r.id));
  const count = cloud.length;
  // The first region faces the default camera, so its tiers run straight
  // across the picture; the rest follow round the hub.
  const front = Math.PI / 2 - VIEW.regions.azimuth;
  const regions: RegionLayout[] = [];

  // The global edge: a plinth at the centre. Clients stand in a ring round
  // the router, far enough apart to be told from one another.
  let hubRadius = 0;
  for (const region of edge) {
    const { core, monitors, rest } = edgeCast(byRegion.get(region.id)!);
    if (core) put(core.index, 0, HUB_HEIGHT, 0);
    let mast = core ? scales[core.index]! * 2 + MAST_GAP : 0;
    for (const m of monitors) {
      put(m.index, 0, HUB_HEIGHT, 0, mast);
      mast += scales[m.index]! * 2 + MAST_GAP;
    }
    const clients = rest.filter((m) => m.node.serviceType === 'external-client');
    const others = rest.filter((m) => m.node.serviceType !== 'external-client');
    let reach = core ? scales[core.index]! : 0;
    for (const ring of [others, clients]) {
      if (ring.length === 0) continue;
      const size = Math.max(...ring.map((m) => scales[m.index]!));
      const pitch = 2 * size + PIECE_CLEAR;
      const radius = Math.max(
        reach > 0 || ring.length > 1 ? reach + TIER_CLEAR + size : 0,
        ring.length > 1 ? pitch / 2 / Math.sin(Math.PI / ring.length) : 0,
      );
      // Nobody stands on the line from the camera through the router, where a
      // piece would hide behind it or lie under the route to the first
      // region: half a step off that line, or a quarter when the count is
      // odd and half a step would put one straight behind.
      const turn = (2 * Math.PI) / ring.length;
      const phase = front + turn * (ring.length % 2 === 0 ? 0.5 : 0.25);
      ring.forEach((m, i) => {
        const angle = phase + i * turn;
        put(m.index, radius * Math.cos(angle), HUB_HEIGHT, radius * Math.sin(angle));
      });
      reach = radius + size;
    }
    hubRadius = Math.max(hubRadius, reach + PLATE_MARGIN - 1.2, 4);
  }

  // Every region gets the plate it needs. The plates stand round the hub at
  // equal angles, each as close to it as its neighbours allow.
  const plates = cloud.map((region) => plateFor(byRegion.get(region.id)!, scales));
  const step = count > 0 ? (2 * Math.PI) / count : 0;
  let inner = hubRadius > 0 ? hubRadius + PLATE_GAP : 0;
  for (let i = 0; i < count && count > 1; i++) {
    const a = plates[i]!.radius;
    const b = plates[(i + 1) % count]!.radius;
    // Two neighbours at distances `inner + a` and `inner + b` from the hub,
    // `step` apart, must be `a + b + gap` from each other: a quadratic in
    // `inner`, of which the larger root is the one that separates them.
    const cos = Math.cos(step);
    const qa = 2 * (1 - cos);
    const qb = qa * (a + b);
    const qc = a * a + b * b - 2 * a * b * cos - (a + b + PLATE_GAP) ** 2;
    inner = Math.max(inner, (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa));
  }

  plates.forEach((plate, i) => {
    const region = cloud[i]!;
    const angle = front + i * step;
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    // A region with neither hub nor neighbour is simply the middle of things.
    const distance = count === 1 && hubRadius === 0 ? 0 : inner + plate.radius;
    const cx = distance * ux;
    const cz = distance * uz;
    const placed = new Map<number, number>();
    for (const line of plate.lines) {
      const radial = line.depth - plate.centre;
      arrange(line.members, links, placed).forEach((entry, c) => {
        const tangent = (c - (line.members.length - 1) / 2) * line.pitch;
        placed.set(entry.index, tangent);
        // The tangent axis is the radial axis turned a quarter of the way round.
        put(entry.index, cx + ux * radial - uz * tangent, 0, cz + uz * radial + ux * tangent);
      });
    }
    regions.push({
      id: region.id,
      name: region.name,
      kind: 'cloud',
      shape: 'disc',
      center: [cx, 0, cz],
      radius: plate.radius,
      halfWidth: plate.radius,
      halfDepth: plate.radius,
      outward: [ux, uz],
    });
  });

  // The hub's own name goes where no region is: in the gap after the first
  // one, which faces the default camera.
  const gap = front + (count > 0 ? step / 2 : 0);
  for (const region of edge) {
    regions.push({
      id: region.id,
      name: region.name,
      kind: 'edge',
      shape: 'disc',
      center: [0, HUB_HEIGHT, 0],
      radius: hubRadius,
      halfWidth: hubRadius,
      halfDepth: hubRadius,
      outward: [Math.cos(gap), Math.sin(gap)],
    });
  }

  const bounds = enclose(positions, 3);
  let reach = bounds.radius;
  for (const region of regions) {
    reach = Math.max(reach, Math.hypot(region.center[0], region.center[2]) + region.radius + 2.5);
  }
  return {
    mode: 'regions',
    positions,
    scales,
    ground,
    regions,
    center: [0, bounds.center[1], 0],
    radius: reach,
  };
}

/** One tier of the swimlanes: how many lines it takes, and where it starts. */
interface Column {
  tier: number;
  /** Scale of the largest piece that stands in it, in any lane. */
  size: number;
  lines: number;
  /** Position of its first line along x, measured from the first tier. */
  at: number;
}

interface LanePlan {
  /** The most pieces a line may hold. */
  cap: number;
  columns: Column[];
  /** Half the depth of each lane, margin included. */
  halves: number[];
  /** Extent of the lanes along x and z, margins included. */
  width: number;
  depth: number;
}

function layoutDependencies(topology: Topology): Arrangement {
  const { positions, scales, ground, put, byRegion } = stage(topology);
  const links = neighboursOf(topology);
  const n = topology.nodes.length;

  const lanes = topology.regions.filter((r) => r.kind === 'cloud' && byRegion.has(r.id));
  const inLane = new Set(lanes.map((region) => region.id));
  const edgeRegion = topology.regions.find((r) => !inLane.has(r.id) && byRegion.has(r.id));
  const outside: Indexed[] = [];
  topology.nodes.forEach((node, index) => {
    if (!inLane.has(node.region)) outside.push({ node, index });
  });
  const { core, monitors, rest } = edgeCast(outside);
  const edgeTiers = tiersOf(core ? [core, ...rest] : rest);
  const laneTiers = lanes.map((region) => tiersOf(byRegion.get(region.id)!));
  const tierIds = [...new Set(laneTiers.flat().map((tier) => tier[0]!.node.tier))].sort(
    (a, b) => a - b,
  );
  const sizeOf = (members: Indexed[]) => Math.max(...members.map((m) => scales[m.index]!));
  const pitchOf = (size: number) => 2 * size + PIECE_CLEAR;

  /** Lays the lanes out with at most `cap` pieces to a line. */
  const plan = (cap: number): LanePlan => {
    const columns: Column[] = tierIds.map((tier) => ({ tier, size: 0, lines: 0, at: 0 }));
    const halves = laneTiers.map((tiers) => {
      let half = 0;
      for (const members of tiers) {
        const column = columns.find((c) => c.tier === members[0]!.node.tier)!;
        const runs = split(members, cap);
        const size = sizeOf(members);
        column.size = Math.max(column.size, size);
        column.lines = Math.max(column.lines, runs.length);
        // The first run is the longest.
        half = Math.max(half, ((runs[0]!.length - 1) * pitchOf(size)) / 2);
      }
      return half + PLATE_MARGIN;
    });
    let x = 0;
    columns.forEach((column, k) => {
      const before = columns[k - 1];
      if (before) x += before.size + column.size + COLUMN_CLEAR;
      column.at = x;
      x += (column.lines - 1) * pitchOf(column.size);
    });
    const depth = halves.reduce((sum, half) => sum + 2 * half, 0) + (lanes.length - 1) * PLATE_GAP;
    return { cap, columns, halves, width: x + 2 * PLATE_MARGIN, depth: Math.max(0, depth) };
  };

  /**
   * The edge stands to the left of the lanes, its own tiers as columns, and
   * is no deeper than the lanes are.
   */
  const edgePlan = (lanesDepth: number) => {
    const crowd = edgeTiers.filter((tier) => tier.length > 1);
    const pitch = pitchOf(crowd.length > 0 ? Math.max(...crowd.map(sizeOf)) : 1);
    const room = Math.floor((lanesDepth - 2 * PLATE_MARGIN) / pitch) + 1;
    const lines = linesOf(
      edgeTiers,
      lanes.length > 0 ? Math.max(2, room) : 8,
      scales,
      COLUMN_CLEAR,
    );
    const last = lines[lines.length - 1];
    return {
      lines,
      half: Math.max(0, ...lines.map((line) => line.half)) + PLATE_MARGIN,
      // From its first column to its last.
      span: last ? last.depth : 0,
      // From its last column to the first tier of the lanes.
      lead: last && tierIds.length > 0 ? sizeOf(last.members) + COLUMN_CLEAR : 0,
    };
  };

  // How long a line may be decides the shape of the whole board: short lines
  // make it wide, long ones deep. The one that fills the picture best, seen
  // from where the camera first stands, is taken.
  const { azimuth, elevation } = VIEW.dependencies;
  let chosen = plan(4);
  let lowest = Infinity;
  for (let cap = 2; cap <= 8 && lanes.length > 0; cap++) {
    const candidate = plan(cap);
    const side = edgePlan(candidate.depth);
    const first = candidate.columns[0]!;
    const width =
      candidate.width +
      (side.lines.length > 0 ? side.span + side.lead + first.size + PLATE_MARGIN : 0);
    const depth = Math.max(candidate.depth, 2 * side.half);
    const across = width * Math.cos(azimuth) + depth * Math.abs(Math.sin(azimuth));
    const up =
      (width * Math.abs(Math.sin(azimuth)) + depth * Math.cos(azimuth)) * Math.sin(elevation);
    const cost = Math.max(across / PICTURE_ASPECT, up);
    if (cost < lowest - 1e-9) {
      lowest = cost;
      chosen = candidate;
    }
  }
  const { columns, halves } = chosen;
  const edgeSide = edgePlan(chosen.depth);
  const regions: RegionLayout[] = [];

  // The edge, each of its columns centred on the middle of the board.
  if (edgeSide.lines.length > 0) {
    const first = columns[0];
    const left = -(edgeSide.span + edgeSide.lead + (first ? first.size : 0));
    const placed = new Map<number, number>();
    for (const line of edgeSide.lines) {
      arrange(line.members, links, placed).forEach((entry, r) => {
        const z = (r - (line.members.length - 1) / 2) * line.pitch;
        placed.set(entry.index, z);
        put(entry.index, left + line.depth, 0, z);
      });
    }
    if (core) {
      // The monitor keeps its place on the mast above the router.
      let mast = scales[core.index]! * 2 + MAST_GAP;
      const x = positions[core.index * 3]!;
      const z = positions[core.index * 3 + 2]!;
      for (const m of monitors) {
        put(m.index, x, 0, z, mast);
        mast += scales[m.index]! * 2 + MAST_GAP;
      }
    }
    const halfWidth = edgeSide.span / 2 + PLATE_MARGIN;
    regions.push({
      id: edgeRegion?.id ?? 'edge',
      name: edgeRegion?.name ?? 'Edge',
      kind: 'edge',
      shape: 'slab',
      center: [left + edgeSide.span / 2, 0, 0],
      radius: Math.hypot(halfWidth, edgeSide.half),
      halfWidth,
      halfDepth: edgeSide.half,
      // Toward the camera: the lanes are deeper than the edge, so there is
      // table in front of it.
      outward: [0, 1],
    });
  }

  // The lanes, the first region farthest from the camera.
  const halfWidth = chosen.width / 2;
  let z = -chosen.depth / 2;
  lanes.forEach((region, b) => {
    const half = halves[b]!;
    const middle = z + half;
    const placed = new Map<number, number>();
    for (const members of laneTiers[b]!) {
      const column = columns.find((c) => c.tier === members[0]!.node.tier)!;
      const pitch = pitchOf(sizeOf(members));
      split(members, chosen.cap).forEach((run, s) => {
        const x = column.at + s * pitchOf(column.size);
        arrange(run, links, placed).forEach((entry, r) => {
          const offset = (r - (run.length - 1) / 2) * pitch;
          placed.set(entry.index, offset);
          put(entry.index, x, 0, middle + offset);
        });
      });
    }
    regions.push({
      id: region.id,
      name: region.name,
      kind: 'cloud',
      shape: 'slab',
      center: [halfWidth - PLATE_MARGIN, 0, middle],
      radius: Math.hypot(halfWidth, half),
      halfWidth,
      halfDepth: half,
      // Off the far end of the lane, past its last tier.
      outward: [1, 0],
    });
    z += 2 * half + PLATE_GAP;
  });

  // Centre the board on the origin.
  let low = Infinity;
  let high = -Infinity;
  for (const region of regions) {
    low = Math.min(low, region.center[0] - region.halfWidth);
    high = Math.max(high, region.center[0] + region.halfWidth);
  }
  const shift = regions.length > 0 ? (low + high) / 2 : 0;
  for (let i = 0; i < n; i++) positions[i * 3] = positions[i * 3]! - shift;
  for (const region of regions) region.center[0] -= shift;

  return {
    mode: 'dependencies',
    positions,
    scales,
    ground,
    regions,
    ...enclose(positions, 6),
  };
}

/**
 * The overview: one plate per layer, left to right in the order a request
 * crosses them. Within a layer its tiers are columns, and the pieces of a
 * column stand side by side across the path. A plate is as deep as what
 * stands on it, like any other, and all of them are centred on the path.
 */
function layoutLayers(topology: Topology): Arrangement {
  const { positions, scales, ground, put, byRegion } = stage(topology);
  for (let i = 0; i < scales.length; i++) scales[i] = layerScale(scales[i]!);
  const links = neighboursOf(topology);
  const layers = topology.regions.filter((region) => byRegion.has(region.id));

  const plans = layers.map((region) => {
    const columns = tiersOf(byRegion.get(region.id)!);
    const sizes = columns.map((column) => Math.max(...column.map((m) => scales[m.index]!)));
    const pitches = sizes.map((size) => 2 * size + LAYER_CLEAR);
    // Where each column stands, measured from the first.
    const at: number[] = [];
    let span = 0;
    columns.forEach((_, k) => {
      if (k > 0) span += sizes[k - 1]! + sizes[k]! + LAYER_COLUMN_CLEAR;
      at.push(span);
    });
    const half = Math.max(
      ...columns.map((column, k) => ((column.length - 1) * pitches[k]!) / 2 + sizes[k]!),
    );
    const width = 2 * LAYER_MARGIN + sizes[0]! + span + sizes[sizes.length - 1]!;
    return { region, columns, sizes, pitches, at, half, width };
  });
  const total =
    plans.reduce((sum, plan) => sum + plan.width, 0) + Math.max(0, plans.length - 1) * LAYER_GAP;

  const regions: RegionLayout[] = [];
  const placed = new Map<number, number>();
  let left = -total / 2;
  for (const plan of plans) {
    const halfDepth = plan.half + LAYER_MARGIN;
    plan.columns.forEach((column, k) => {
      const x = left + LAYER_MARGIN + plan.sizes[0]! + plan.at[k]!;
      arrange(column, links, placed).forEach((entry, r) => {
        const z = (r - (column.length - 1) / 2) * plan.pitches[k]!;
        placed.set(entry.index, z);
        put(entry.index, x, 0, z);
      });
    });
    regions.push({
      id: plan.region.id,
      name: plan.region.name,
      kind: 'layer',
      shape: 'slab',
      center: [left + plan.width / 2, 0, 0],
      radius: Math.hypot(plan.width / 2, halfDepth),
      halfWidth: plan.width / 2,
      halfDepth,
      outward: [0, -1],
      // A heading: off the far rim, starting at the layer's left corner, so
      // it stands above the layer on screen and clear of what is on it.
      heading: {
        anchor: [left + 0.3, 0, -halfDepth - NAME_GAP],
        align: [0.5, 0.5],
        // Seen along the path the far rim is the next layer's near one, so
        // nothing can stand above a layer. Its heading stands beside it
        // instead, off the left rim and level with the layer's middle,
        // clear of the pieces and of the names at their feet.
        upright: {
          anchor: [left + plan.width / 2, 0, -halfDepth - NAME_GAP * 0.5],
          align: [-0.5, 0],
        },
      },
    });
    left += plan.width + LAYER_GAP;
  }

  return {
    mode: 'layers',
    positions,
    scales,
    ground,
    regions,
    ...enclose(positions, 6),
  };
}

/**
 * The pieces that are told by their face: an arch, a shield. Turned fully
 * along a path that runs across the picture they show the viewer their
 * edge, a slab and a blade, and the kind can no longer be read.
 */
export const TOLD_BY_FACE: ReadonlySet<ServiceType> = new Set(['api-gateway', 'auth-service']);

/** The most such a face is turned away from the line of sight. */
export const MOST_ASKEW = Math.PI / 4;

/**
 * Where a piece that is told by its face ends up facing. It turns toward
 * its traffic (`facing`) as far as it can with its face, or the back of it,
 * still no more than `MOST_ASKEW` from the line of sight (`sight`, the way
 * to the camera on the ground, as an angle from `+z` toward `+x`). At that
 * angle the line of traffic still goes through the opening of the gate,
 * which is wider than the gate is deep, and the arch is still an arch.
 */
export function askew(facing: number, sight: number): number {
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const fromSight = wrap(facing - sight);
  // Whichever of its two faces is the nearer to the viewer is the one kept in view.
  const back = Math.abs(fromSight) > Math.PI / 2;
  const off = back ? wrap(fromSight - Math.PI) : fromSight;
  const held = Math.max(-MOST_ASKEW, Math.min(MOST_ASKEW, off));
  return wrap(sight + (back ? Math.PI : 0) + held);
}

/** A layout before the pieces are turned to their traffic. */
type Arrangement = Omit<SceneLayout, 'facing'>;

/**
 * Which way each piece with an arrival side is turned: toward what calls
 * it, each caller counted once whatever its distance, or away from what it
 * calls when nothing calls it. Callers are taken in the order of their ids,
 * so the answer does not depend on the order the topology lists them in.
 */
function facingOf(topology: Topology, positions: Float32Array): Float32Array {
  const n = topology.nodes.length;
  const facing = new Float32Array(n).fill(Number.NaN);
  const index = new Map(topology.nodes.map((node, i) => [node.id, i]));
  const callers: number[][] = Array.from({ length: n }, () => []);
  const callees: number[][] = Array.from({ length: n }, () => []);
  for (const edge of topology.edges) {
    const source = index.get(edge.source);
    const target = index.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    callers[target]!.push(source);
    callees[source]!.push(target);
  }
  const byId = (a: number, b: number) =>
    topology.nodes[a]!.id < topology.nodes[b]!.id
      ? -1
      : topology.nodes[a]!.id > topology.nodes[b]!.id
        ? 1
        : 0;
  topology.nodes.forEach((node, i) => {
    const arrival = ARRIVAL[node.serviceType];
    if (!arrival) return;
    const toward = (others: number[]): [number, number] => {
      let x = 0;
      let z = 0;
      for (const j of [...others].sort(byId)) {
        const dx = positions[j * 3]! - positions[i * 3]!;
        const dz = positions[j * 3 + 2]! - positions[i * 3 + 2]!;
        const length = Math.hypot(dx, dz);
        if (length < 1e-6) continue;
        x += dx / length;
        z += dz / length;
      }
      return [x, z];
    };
    let [x, z] = toward(callers[i]!);
    if (Math.hypot(x, z) < 1e-3) {
      const [ox, oz] = toward(callees[i]!);
      x = -ox;
      z = -oz;
    }
    if (Math.hypot(x, z) < 1e-3) return;
    // A turn of `t` about the vertical takes `+z` toward `+x` by `t`.
    facing[i] = Math.atan2(x, z) - Math.atan2(arrival[0], arrival[1]);
  });
  return facing;
}

export function computeLayout(topology: Topology, mode: LayoutMode): SceneLayout {
  const layout =
    mode === 'layers'
      ? layoutLayers(topology)
      : mode === 'regions'
        ? layoutRegions(topology)
        : layoutDependencies(topology);
  return { ...layout, facing: facingOf(topology, layout.positions) };
}

/** A plate's heading as it is placed for the attitude in use, if it has one. */
export function headingOf(
  region: RegionLayout,
  upright = false,
): { anchor: Vec3; align: [number, number] } | undefined {
  return (upright && region.heading?.upright) || region.heading;
}

/** The point beside a plate, off its rim on the outward side, where its name is anchored. */
export function nameAnchor(region: RegionLayout, upright = false): Vec3 {
  const heading = headingOf(region, upright);
  if (heading) return heading.anchor;
  const [ox, oz] = region.outward;
  const reach =
    region.shape === 'disc'
      ? region.radius
      : Math.abs(ox) * region.halfWidth + Math.abs(oz) * region.halfDepth;
  return [
    region.center[0] + ox * (reach + NAME_GAP),
    region.center[1],
    region.center[2] + oz * (reach + NAME_GAP),
  ];
}

/**
 * Where the middle of a `width × height` box goes, in units of its own size,
 * so that it touches its anchor and lies wholly on the side `(x, y)` points
 * to. The scene uses it to hang a plate's name off the rim, whichever way
 * "outward" happens to point on screen, so a name never lies across the
 * plate it names.
 */
export function hang(x: number, y: number, width: number, height: number): [number, number] {
  const length = Math.hypot(x, y);
  if (length < 1e-4) return [0, 0.5];
  const ux = x / length;
  const uy = y / length;
  const reach = Math.min(
    Math.abs(ux) > 1e-6 ? width / (2 * Math.abs(ux)) : Infinity,
    Math.abs(uy) > 1e-6 ? height / (2 * Math.abs(uy)) : Infinity,
  );
  return [(ux * reach) / width, (uy * reach) / height];
}

/**
 * Control point of the quadratic curve an edge is drawn along. `arc` scales
 * how high the curve rises: lower where connections run far over open table.
 */
export function edgeControl(a: Vec3, b: Vec3, arc = 1): Vec3 {
  const distance = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const lift = Math.min(13, 0.7 + distance * 0.17) * arc;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + lift, (a[2] + b[2]) / 2];
}

/** Point at parameter `t` on the quadratic Bézier `a → control → b`. */
export function bezierPoint(a: Vec3, control: Vec3, b: Vec3, t: number): Vec3 {
  const u = 1 - t;
  const wa = u * u;
  const wc = 2 * u * t;
  const wb = t * t;
  return [
    a[0] * wa + control[0] * wc + b[0] * wb,
    a[1] * wa + control[1] * wc + b[1] * wb,
    a[2] * wa + control[2] * wc + b[2] * wb,
  ];
}

/** Approximate arc length of an edge curve (polyline through 8 samples). */
export function curveLength(a: Vec3, control: Vec3, b: Vec3): number {
  let length = 0;
  let previous = a;
  for (let i = 1; i <= 8; i++) {
    const point = bezierPoint(a, control, b, i / 8);
    length += Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
    previous = point;
  }
  return length;
}

export function nodePosition(layout: SceneLayout, index: number): Vec3 {
  return [
    layout.positions[index * 3] ?? 0,
    layout.positions[index * 3 + 1] ?? 0,
    layout.positions[index * 3 + 2] ?? 0,
  ];
}

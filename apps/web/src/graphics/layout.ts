/**
 * Deterministic spatial layout of a topology.
 *
 * Pure functions of the topology: no randomness, no iteration to convergence,
 * no dependence on insertion order beyond explicit sorting. The same topology
 * always produces the same picture, which keeps the scene stable across
 * reloads and makes the layout testable.
 *
 * The scene is a scale model, so every service stands on something. Node
 * geometry is built with its base at `y = -1`; a node of scale `s` placed at
 * `ground + s` therefore rests exactly on the surface below it. `ground` is
 * kept per node so the scene can draw contact shadows and support stems.
 *
 * `regions` mode — a hub-and-spoke archipelago. The global edge is a raised
 * plate at the centre (clients on its rim, the edge router in the middle, the
 * security monitor on a mast above it). Cloud regions are plates on a ring
 * around it, one step lower. Inside a region, tiers run outward from the hub.
 *
 * `dependencies` mode — a layered left-to-right dependency graph on a single
 * board: one column per tier, ignoring region placement.
 */
import type { InfrastructureNode, ServiceType, Topology } from '@aegis/contracts';

export type LayoutMode = 'regions' | 'dependencies';

export type Vec3 = [number, number, number];

export interface RegionLayout {
  id: string;
  name: string;
  kind: 'edge' | 'cloud';
  center: Vec3;
  radius: number;
}

/** The rectangular base the dependency layout stands on. */
export interface BoardLayout {
  center: Vec3;
  halfWidth: number;
  halfDepth: number;
}

export interface SceneLayout {
  mode: LayoutMode;
  /** `x, y, z` per node, in topology order. */
  positions: Float32Array;
  /** Uniform scale per node. */
  scales: Float32Array;
  /** Height of the surface under each node. */
  ground: Float32Array;
  /** Region plates; `center` is the middle of the plate's top face. */
  regions: RegionLayout[];
  board: BoardLayout | null;
  /** Centre and radius of a sphere enclosing everything. */
  center: Vec3;
  radius: number;
}

const ROW_GAP = 3.3;
const COL_GAP = 3.1;
const MAX_PER_ROW = 6;
const PLATFORM_MARGIN = 2.7;
const REGION_GAP = 2.4;
const HUB_RING = 7.6;
/** How far a region platform keeps from the central pillar. */
const HUB_CLEARANCE = 5.2;
/** Height of the raised plate that carries the global edge. */
const HUB_HEIGHT = 5.4;
/** Gap between the edge router and the monitor on its mast. */
const MAST_GAP = 1.4;

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

function byTypeThenId(a: { node: InfrastructureNode }, b: { node: InfrastructureNode }): number {
  return (
    TYPE_ORDER[a.node.serviceType] - TYPE_ORDER[b.node.serviceType] ||
    (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0)
  );
}

interface Indexed {
  node: InfrastructureNode;
  index: number;
}

/** Splits a region's nodes into rows: one or more per tier, inner tier first. */
function rowsOf(nodes: Indexed[]): Indexed[][] {
  const tiers = new Map<number, Indexed[]>();
  for (const entry of nodes) {
    const list = tiers.get(entry.node.tier) ?? [];
    list.push(entry);
    tiers.set(entry.node.tier, list);
  }
  const rows: Indexed[][] = [];
  for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
    const members = tiers.get(tier)!.sort(byTypeThenId);
    const rowCount = Math.ceil(members.length / MAX_PER_ROW);
    const perRow = Math.ceil(members.length / rowCount);
    for (let r = 0; r < rowCount; r++) rows.push(members.slice(r * perRow, (r + 1) * perRow));
  }
  return rows;
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

function layoutRegions(topology: Topology): SceneLayout {
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

  const cloud = topology.regions.filter((r) => r.kind === 'cloud' && byRegion.has(r.id));
  const edge = topology.regions.filter((r) => r.kind !== 'cloud' && byRegion.has(r.id));

  // Measure every cloud region first: the ring must fit the largest one.
  const measured = cloud.map((region) => {
    const rows = rowsOf(byRegion.get(region.id)!);
    const columns = Math.max(1, ...rows.map((row) => row.length));
    const halfDepth = ((rows.length - 1) * ROW_GAP) / 2;
    const halfWidth = ((columns - 1) * COL_GAP) / 2;
    return { region, rows, halfDepth, radius: Math.hypot(halfDepth, halfWidth) + PLATFORM_MARGIN };
  });
  const platform = Math.max(8, ...measured.map((m) => m.radius));
  const count = measured.length;
  // Platforms tuck in under the elevated hub, so the pillar only needs a
  // little clearance; beyond that the ring is as tight as the platforms allow.
  const hub = edge.length > 0 ? HUB_CLEARANCE : 0;
  const ring =
    count <= 1
      ? count * (platform + hub)
      : Math.max((platform + REGION_GAP / 2) / Math.sin(Math.PI / count), platform + hub);

  const regions: RegionLayout[] = [];
  measured.forEach(({ region, rows, halfDepth }, i) => {
    // Region 0 faces the default camera (+z); the rest follow clockwise.
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, count);
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    const cx = ring * ux;
    const cz = ring * uz;
    rows.forEach((row, r) => {
      const radial = -halfDepth + r * ROW_GAP;
      row.forEach((entry, c) => {
        const tangent = (c - (row.length - 1) / 2) * COL_GAP;
        // Tangent axis is the radial axis rotated a quarter turn.
        put(entry.index, cx + ux * radial - uz * tangent, 0, cz + uz * radial + ux * tangent);
      });
    });
    regions.push({
      id: region.id,
      name: region.name,
      kind: 'cloud',
      center: [cx, 0, cz],
      radius: platform,
    });
  });

  // The global edge: a raised plate at the centre of the ring.
  for (const region of edge) {
    const members = byRegion.get(region.id)!.sort(byTypeThenId);
    const clients = members.filter((m) => m.node.serviceType === 'external-client');
    const routers = members.filter((m) => m.node.serviceType === 'network-gateway');
    const monitors = members.filter((m) => m.node.serviceType === 'security-monitor');
    const others = members.filter(
      (m) => !clients.includes(m) && !routers.includes(m) && !monitors.includes(m),
    );
    const core = routers.shift();
    if (core) put(core.index, 0, HUB_HEIGHT, 0);
    // Monitors watch from a mast above the router, one over the other.
    let mast = core ? scales[core.index]! * 2 + MAST_GAP : 0;
    for (const m of monitors) {
      put(m.index, 0, HUB_HEIGHT, 0, mast);
      mast += scales[m.index]! * 2 + MAST_GAP;
    }
    clients.forEach((m, i) => {
      const angle =
        Math.PI / 2 + Math.PI / Math.max(1, clients.length) + (i * 2 * Math.PI) / clients.length;
      put(m.index, HUB_RING * Math.cos(angle), HUB_HEIGHT, HUB_RING * Math.sin(angle));
    });
    const inner = [...routers, ...others];
    inner.forEach((m, i) => {
      const angle = (i * 2 * Math.PI) / inner.length;
      put(m.index, 4.6 * Math.cos(angle), HUB_HEIGHT, 4.6 * Math.sin(angle));
    });
    regions.push({
      id: region.id,
      name: region.name,
      kind: 'edge',
      center: [0, HUB_HEIGHT, 0],
      radius: HUB_RING + 2.2,
    });
  }

  // Frame the platforms and their titles, not just the nodes standing on them.
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
    board: null,
    center: [0, bounds.center[1], 0],
    radius: reach,
  };
}

const COLUMN_GAP = 9.5;
const LANE_GAP = 3.3;
const MAX_PER_COLUMN = 14;

function layoutDependencies(topology: Topology): SceneLayout {
  const n = topology.nodes.length;
  const positions = new Float32Array(n * 3);
  const scales = new Float32Array(n);
  const regionOrder = new Map(topology.regions.map((region, i) => [region.id, i]));
  const tiers = new Map<number, Indexed[]>();
  topology.nodes.forEach((node, index) => {
    scales[index] = TYPE_SCALE[node.serviceType] * 0.9;
    const list = tiers.get(node.tier) ?? [];
    list.push({ node, index });
    tiers.set(node.tier, list);
  });

  let x = 0;
  for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
    const members = tiers
      .get(tier)!
      .sort(
        (a, b) =>
          (regionOrder.get(a.node.region) ?? 0) - (regionOrder.get(b.node.region) ?? 0) ||
          byTypeThenId(a, b),
      );
    const columns = Math.ceil(members.length / MAX_PER_COLUMN);
    const perColumn = Math.ceil(members.length / columns);
    for (let c = 0; c < columns; c++) {
      const column = members.slice(c * perColumn, (c + 1) * perColumn);
      column.forEach((entry, r) => {
        positions[entry.index * 3] = x + c * 3.6;
        // Standing on the board, which is at height zero.
        positions[entry.index * 3 + 1] = scales[entry.index]!;
        positions[entry.index * 3 + 2] = (r - (column.length - 1) / 2) * LANE_GAP;
      });
    }
    x += COLUMN_GAP + (columns - 1) * 3.6;
  }
  // Centre the graph on the origin.
  const shift = (x - COLUMN_GAP) / 2;
  for (let i = 0; i < n; i++) positions[i * 3] = positions[i * 3]! - shift;

  let halfWidth = 0;
  let halfDepth = 0;
  for (let i = 0; i < n; i++) {
    halfWidth = Math.max(halfWidth, Math.abs(positions[i * 3]!));
    halfDepth = Math.max(halfDepth, Math.abs(positions[i * 3 + 2]!));
  }
  return {
    mode: 'dependencies',
    positions,
    scales,
    ground: new Float32Array(n),
    regions: [],
    board:
      n === 0 ? null : { center: [0, 0, 0], halfWidth: halfWidth + 4, halfDepth: halfDepth + 4 },
    ...enclose(positions, 6),
  };
}

export function computeLayout(topology: Topology, mode: LayoutMode): SceneLayout {
  return mode === 'regions' ? layoutRegions(topology) : layoutDependencies(topology);
}

/** Control point of the quadratic curve an edge is drawn along. */
export function edgeControl(a: Vec3, b: Vec3): Vec3 {
  const distance = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const lift = Math.min(13, 0.7 + distance * 0.17);
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

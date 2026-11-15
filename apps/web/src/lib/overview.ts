/**
 * The overview: a platform reduced to its kinds of service.
 *
 * A topology of fifty or five hundred services cannot be taken in at once,
 * and does not have to be. Whatever its size, a platform is made of the same
 * dozen kinds of thing (clients, gateways, an authorizer, services, stores),
 * and a request crosses them in the same order. The overview draws one piece
 * per kind, in the four layers a request passes through, and nothing else:
 * overview first, details on demand.
 *
 * Nothing here is invented. A group is exactly the services of one kind, and
 * every figure it shows is derived from theirs: rates are summed, latency and
 * error rate are averaged by the traffic that experienced them, and a group
 * is as unwell as its worst member. A connection between two groups is every
 * connection between their members, added up.
 *
 * Everything is a pure function of the topology (and, for the figures, of a
 * snapshot), so the same platform always gives the same overview. The result
 * is itself a `Topology` with columnar snapshots, which is why the scene can
 * draw it without knowing it is looking at a summary.
 */
import {
  RelationshipSchema,
  type EdgeMetrics,
  type InfrastructureEdge,
  type InfrastructureNode,
  type NodeMetrics,
  type Relationship,
  type ServiceType,
  type TelemetrySnapshot,
  type Topology,
} from '@aegis/contracts';

import { SERVICE_TYPE } from './palette';

export interface LayerSpec {
  id: string;
  name: string;
  /**
   * The kinds that stand in this layer, as the columns a request crosses
   * from left to right. Kinds of one column stand side by side.
   */
  columns: ServiceType[][];
}

/** Where a request goes: in, past identity, through compute, to the data. */
export const LAYERS: readonly LayerSpec[] = [
  {
    id: 'layer:entry',
    name: 'Entry',
    columns: [['external-client'], ['network-gateway'], ['api-gateway']],
  },
  {
    id: 'layer:identity',
    name: 'Identity',
    columns: [['auth-service', 'cedar-authorizer', 'security-monitor']],
  },
  {
    id: 'layer:compute',
    name: 'Compute',
    columns: [['microservice', 'container', 'serverless']],
  },
  {
    id: 'layer:data',
    name: 'Data',
    columns: [['message-queue'], ['database', 'storage']],
  },
];

const GROUP_PREFIX = 'kind:';

export const groupId = (type: ServiceType) => `${GROUP_PREFIX}${type}`;
export const isGroupId = (id: string) => id.startsWith(GROUP_PREFIX);

export interface Overview {
  /** The topology this is a summary of. */
  source: Topology;
  /** One node per kind of service, one edge per pair of kinds that talk. */
  topology: Topology;
  /** What the scene writes beside each group: its name, with its head count. */
  labels: string[];
  /** For each source node, the index of its group. */
  groupOf: Int32Array;
  /** For each source edge, its group edge, or -1 when it stays inside a group. */
  edgeOf: Int32Array;
  /** For each group, the indices of its source nodes. */
  members: number[][];
  /** For each group edge, the indices of the source edges it stands for. */
  memberEdges: number[][];
  groupIndex: Map<string, number>;
  /** The group a source node belongs to, by id. */
  groupOfNode: Map<string, string>;
  /** The group edge a source edge belongs to, by id. */
  groupOfEdge: Map<string, string>;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The mean of `value` over `items`, each counting for its `weight`. */
function weighted<T>(items: readonly T[], value: (item: T) => number, weight: (item: T) => number) {
  let sum = 0;
  let total = 0;
  for (const item of items) {
    sum += value(item) * weight(item);
    total += weight(item);
  }
  if (total > 0) return sum / total;
  // Nothing is flowing: the plain mean is the fairest thing left to say.
  return items.length > 0 ? items.reduce((s, item) => s + value(item), 0) / items.length : 0;
}

const HEALTH_CODE = { healthy: 0, degraded: 1, critical: 2, down: 3 } as const;
const HEALTH = ['healthy', 'degraded', 'critical', 'down'] as const;
const SECURITY = ['secure', 'authorized', 'throttled', 'denied', 'suspicious'] as const;
const RELATIONSHIPS = RelationshipSchema.options;

function nodeBaseline(nodes: readonly InfrastructureNode[]): NodeMetrics {
  const rate = (node: InfrastructureNode) => node.metrics.throughputRps;
  return {
    health: HEALTH[Math.max(0, ...nodes.map((node) => HEALTH_CODE[node.metrics.health]))]!,
    latencyMs: weighted(nodes, (node) => node.metrics.latencyMs, rate),
    throughputRps: nodes.reduce((sum, node) => sum + rate(node), 0),
    errorRate: weighted(nodes, (node) => node.metrics.errorRate, rate),
    saturation: Math.max(0, ...nodes.map((node) => node.metrics.saturation)),
    queueDepth: nodes.reduce((sum, node) => sum + node.metrics.queueDepth, 0),
  };
}

function edgeBaseline(edges: readonly InfrastructureEdge[]): EdgeMetrics {
  const rate = (edge: InfrastructureEdge) => edge.metrics.trafficRps;
  return {
    trafficRps: edges.reduce((sum, edge) => sum + rate(edge), 0),
    latencyMs: weighted(edges, (edge) => edge.metrics.latencyMs, rate),
    errorRate: weighted(edges, (edge) => edge.metrics.errorRate, rate),
    rejectedRps: edges.reduce((sum, edge) => sum + edge.metrics.rejectedRps, 0),
    suspiciousRps: edges.reduce((sum, edge) => sum + edge.metrics.suspiciousRps, 0),
    securityStatus:
      SECURITY[Math.max(0, ...edges.map((edge) => SECURITY.indexOf(edge.metrics.securityStatus)))]!,
  };
}

/**
 * What kind of connection a group edge is: the relationship that carries
 * most of its traffic, and the first in the contract's own order on a tie.
 */
function dominant(edges: readonly InfrastructureEdge[]): InfrastructureEdge {
  const load = new Map<Relationship, number>();
  for (const edge of edges) {
    load.set(edge.relationship, (load.get(edge.relationship) ?? 0) + edge.metrics.trafficRps + 1);
  }
  let chosen: Relationship = edges[0]!.relationship;
  let most = -1;
  for (const relationship of RELATIONSHIPS) {
    const weight = load.get(relationship) ?? -1;
    if (weight > most) {
      most = weight;
      chosen = relationship;
    }
  }
  return edges.find((edge) => edge.relationship === chosen)!;
}

export function buildOverview(source: Topology): Overview {
  const byType = new Map<ServiceType, number[]>();
  source.nodes.forEach((node, i) => {
    const list = byType.get(node.serviceType) ?? [];
    list.push(i);
    byType.set(node.serviceType, list);
  });
  const regionName = new Map(source.regions.map((region) => [region.id, region.name]));

  const nodes: InfrastructureNode[] = [];
  const labels: string[] = [];
  const members: number[][] = [];
  const regions: Topology['regions'] = [];
  const groupOf = new Int32Array(source.nodes.length).fill(-1);
  const groupOfNode = new Map<string, string>();
  let column = 0;
  for (const layer of LAYERS) {
    const before = nodes.length;
    for (const kinds of layer.columns) {
      let stands = false;
      for (const type of kinds) {
        const indices = byType.get(type);
        if (!indices) continue;
        stands = true;
        const group = indices.map((i) => source.nodes[i]!);
        const first = group[0]!;
        const plural = SERVICE_TYPE[type].plural;
        const id = groupId(type);
        // A kind with one member is that member: it keeps its own name.
        const single = group.length === 1;
        const places = [
          ...new Set(group.map((node) => regionName.get(node.region) ?? node.region)),
        ];
        for (const i of indices) {
          groupOf[i] = nodes.length;
          groupOfNode.set(source.nodes[i]!.id, id);
        }
        members.push(indices);
        labels.push(single ? first.name : `${group.length} ${plural}`);
        nodes.push({
          id,
          name: single ? first.name : capitalise(plural),
          serviceType: type,
          region: layer.id,
          environment: first.environment,
          tier: column,
          description: single
            ? first.description
            : `${group.length} ${plural} in ${places.length === 1 ? places[0] : `${places.length} regions`}.`,
          dataSource: first.dataSource,
          capacityRps: group.reduce((sum, node) => sum + node.capacityRps, 0),
          baselineLatencyMs: weighted(
            group,
            (node) => node.baselineLatencyMs,
            (node) => node.metrics.throughputRps,
          ),
          connectedServices: [],
          metrics: nodeBaseline(group),
        });
      }
      if (stands) column++;
    }
    if (nodes.length > before) {
      regions.push({
        id: layer.id,
        // Numbered in the order a request meets them.
        name: `${String(regions.length + 1).padStart(2, '0')} ${layer.name}`,
        kind: 'cloud',
        location: '',
      });
    }
  }

  // Connections between kinds. What stays inside one kind (replication
  // between databases, a service calling another) is not drawn here: it is
  // detail, and the detailed arrangements show it.
  const sourceIndex = new Map(source.nodes.map((node, i) => [node.id, i]));
  const pairs = new Map<string, number[]>();
  source.edges.forEach((edge, e) => {
    const a = groupOf[sourceIndex.get(edge.source) ?? -1] ?? -1;
    const b = groupOf[sourceIndex.get(edge.target) ?? -1] ?? -1;
    if (a < 0 || b < 0 || a === b) return;
    const key = `${a}:${b}`;
    const list = pairs.get(key) ?? [];
    list.push(e);
    pairs.set(key, list);
  });
  const ordered = [...pairs.entries()]
    .map(([key, list]) => {
      const [a, b] = key.split(':').map(Number) as [number, number];
      return { a, b, list };
    })
    .sort((x, y) => x.a - y.a || x.b - y.b);

  const edgeOf = new Int32Array(source.edges.length).fill(-1);
  const groupOfEdge = new Map<string, string>();
  const memberEdges: number[][] = [];
  const edges: InfrastructureEdge[] = ordered.map(({ a, b, list }, k) => {
    const group = list.map((e) => source.edges[e]!);
    const lead = dominant(group);
    const id = `${nodes[a]!.id}->${nodes[b]!.id}`;
    for (const e of list) {
      edgeOf[e] = k;
      groupOfEdge.set(source.edges[e]!.id, id);
    }
    memberEdges.push(list);
    const from = nodes[a]!;
    const to = nodes[b]!;
    if (!from.connectedServices.includes(to.id)) from.connectedServices.push(to.id);
    if (!to.connectedServices.includes(from.id)) to.connectedServices.push(from.id);
    return {
      id,
      source: from.id,
      target: to.id,
      protocol: lead.protocol,
      relationship: lead.relationship,
      weight: weighted(
        group,
        (edge) => edge.weight,
        (edge) => edge.metrics.trafficRps,
      ),
      crossRegion: false,
      metrics: edgeBaseline(group),
    };
  });

  return {
    source,
    topology: {
      schemaVersion: source.schemaVersion,
      // A different thing from its source, and it must not be mistaken for it.
      id: `${source.id}#overview`,
      name: source.name,
      description: source.description,
      dataSource: source.dataSource,
      regions,
      roles: {},
      nodes,
      edges,
    },
    labels,
    groupOf,
    edgeOf,
    members,
    memberEdges,
    groupIndex: new Map(nodes.map((node, i) => [node.id, i])),
    groupOfNode,
    groupOfEdge,
  };
}

const cache = new WeakMap<Topology, Overview>();

/** The overview of a topology, built once for as long as the topology lives. */
export function overviewOf(source: Topology): Overview {
  let overview = cache.get(source);
  if (!overview) {
    overview = buildOverview(source);
    cache.set(source, overview);
  }
  return overview;
}

/** Edge ids in the source, as the group edges they belong to, repeats removed. */
export function projectHops(overview: Overview, hops: readonly string[]): string[] {
  const out: string[] = [];
  for (const hop of hops) {
    const id = overview.groupOfEdge.get(hop);
    if (id !== undefined && out[out.length - 1] !== id) out.push(id);
  }
  return out;
}

/** Node ids in the source, as the groups they belong to, each once. */
export function projectNodeIds(overview: Overview, ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const group = overview.groupOfNode.get(id);
    if (group !== undefined) out.add(group);
  }
  return [...out];
}

/** A group is shown if any of its members is. */
export function projectMask(overview: Overview, mask: Float32Array | null): Float32Array | null {
  if (!mask) return null;
  const out = new Float32Array(overview.members.length);
  overview.members.forEach((indices, g) => {
    for (const i of indices) if ((mask[i] ?? 1) > (out[g] ?? 0)) out[g] = mask[i] ?? 1;
  });
  return out;
}

/**
 * Which groups are only partly affected: at least one member is not in its
 * normal state and at least one still is. The scene lights the lamp under
 * such a group and leaves the piece itself neutral, so "some of these" and
 * "all of these" can be told apart without a number.
 */
export function partialGroups(overview: Overview, snapshot: TelemetrySnapshot): Uint8Array {
  const out = new Uint8Array(overview.members.length);
  overview.members.forEach((indices, g) => {
    let unwell = 0;
    for (const i of indices) if ((snapshot.nodes.health[i] ?? 0) > 0) unwell++;
    out[g] = unwell > 0 && unwell < indices.length ? 1 : 0;
  });
  return out;
}

/** A snapshot of the source topology, as a snapshot of its overview. */
export function projectSnapshot(
  overview: Overview,
  snapshot: TelemetrySnapshot,
): TelemetrySnapshot {
  const from = snapshot.nodes;
  const groups = overview.members.length;
  const health = new Array<number>(groups).fill(0);
  const latencyMs = new Array<number>(groups).fill(0);
  const throughputRps = new Array<number>(groups).fill(0);
  const errorRate = new Array<number>(groups).fill(0);
  const saturation = new Array<number>(groups).fill(0);
  const queueDepth = new Array<number>(groups).fill(0);
  overview.members.forEach((indices, g) => {
    const rate = (i: number) => from.throughputRps[i] ?? 0;
    for (const i of indices) {
      health[g] = Math.max(health[g]!, from.health[i] ?? 0);
      throughputRps[g]! += rate(i);
      saturation[g] = Math.max(saturation[g]!, from.saturation[i] ?? 0);
      queueDepth[g]! += from.queueDepth[i] ?? 0;
    }
    latencyMs[g] = weighted(indices, (i) => from.latencyMs[i] ?? 0, rate);
    // Averaging keeps a fraction a fraction, but not to the last bit.
    errorRate[g] = Math.min(
      1,
      weighted(indices, (i) => from.errorRate[i] ?? 0, rate),
    );
  });

  const wires = snapshot.edges;
  const count = overview.memberEdges.length;
  const trafficRps = new Array<number>(count).fill(0);
  const edgeLatency = new Array<number>(count).fill(0);
  const edgeError = new Array<number>(count).fill(0);
  const rejectedRps = new Array<number>(count).fill(0);
  const suspiciousRps = new Array<number>(count).fill(0);
  const securityStatus = new Array<number>(count).fill(0);
  overview.memberEdges.forEach((indices, k) => {
    const rate = (e: number) => wires.trafficRps[e] ?? 0;
    for (const e of indices) {
      trafficRps[k]! += rate(e);
      rejectedRps[k]! += wires.rejectedRps[e] ?? 0;
      suspiciousRps[k]! += wires.suspiciousRps[e] ?? 0;
      securityStatus[k] = Math.max(securityStatus[k]!, wires.securityStatus[e] ?? 0);
    }
    edgeLatency[k] = weighted(indices, (e) => wires.latencyMs[e] ?? 0, rate);
    edgeError[k] = Math.min(
      1,
      weighted(indices, (e) => wires.errorRate[e] ?? 0, rate),
    );
  });

  return {
    ...snapshot,
    topologyId: overview.topology.id,
    nodes: { health, latencyMs, throughputRps, errorRate, saturation, queueDepth },
    edges: {
      trafficRps,
      latencyMs: edgeLatency,
      errorRate: edgeError,
      rejectedRps,
      suspiciousRps,
      securityStatus,
    },
    // A layer is a way of looking, not a place: it has no state of its own.
    regions: [],
    flows: snapshot.flows.map((flow) => ({
      ...flow,
      hops: projectHops(overview, flow.hops),
      blockedAt:
        flow.blockedAt === null ? null : (overview.groupOfNode.get(flow.blockedAt) ?? null),
    })),
    incident: snapshot.incident
      ? {
          ...snapshot.incident,
          impactedNodeIds: projectNodeIds(overview, snapshot.incident.impactedNodeIds),
        }
      : null,
  };
}

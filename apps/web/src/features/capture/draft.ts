// not-interface-text: whole file. What is written here goes into the platform
// files of a draft, which are shown as written like any other file's text.
// What the interface says of a draft is in `draftNotes.ts`.
/**
 * A draft of a platform, written from an incident capture.
 *
 * A capture is a real incident; a platform file is something the simulation
 * computes on. This writes the second from the first, in the browser, as a
 * starting point to edit: the capture's services and the calls it saw become
 * a topology, and the traffic it measured at its entry becomes a scenario
 * that repeats that load. The capture itself goes nowhere: what leaves this
 * module is two workspace files, labelled `synthetic` like any other, whose
 * description says which figures were measured, which follow from a stated
 * rule and which are defaults. Nothing the capture did not state is given as
 * measured, and capacity, which no capture states, is left to the model.
 *
 * Every rule is in this file and written into the draft's own description:
 *
 * - **At rest** is the capture before its first event, or all of it when it
 *   has none before a sample.
 * - **Demand** is the median rate the entry services handled at rest, sent
 *   by one client added in front of them (a capture holds none).
 * - **A service that counted no requests of its own** (an entry seen only
 *   through the calls it makes) is taken to be as busy as its busiest call.
 *   That is a convention, said as one: the calls it makes downstream come
 *   out as measured whatever figure is taken, and only its own load rests
 *   on it.
 * - **A connection's weight** is the calls seen on it over the requests its
 *   caller handled, both at rest; 1 where the calls were not measured.
 * - **Calls are kept acyclic**, as a topology has to be: connections are
 *   taken busiest first and one that would close a circle is left out, and
 *   said to be.
 * - **Latency at rest** is a service's median p95 less that of what it
 *   calls, weighted by calls; a placeholder where p95 was not measured.
 * - **The scenario** multiplies the client's demand by what was measured in
 *   each period over the level at rest. It prescribes load and nothing else:
 *   what fails under it is the model's to compute.
 */
import type { ServiceType, WorkspaceFile } from '@aegis/contracts';

import { typicalRate, type Bucket, type Capture, type CaptureEdge } from './capture';

/** Longest id a topology takes. */
const MAX_ID = 64;
/** Most phases a scenario holds, and the longest it lasts. */
const MAX_PHASES = 32;
const MAX_SCENARIO_MS = 30 * 60 * 1000;
const TICK_MS = 200;
/** Demand given to the client when the capture measured no requests. */
export const DEFAULT_DEMAND_RPS = 100;
/** A service's own latency where the capture measured no p95. */
export const DEFAULT_LATENCY_MS = 5;
/** The least a service's own latency is written as. */
const LEAST_LATENCY_MS = 0.5;

export interface Draft {
  files: WorkspaceFile[];
  topologyId: string;
  /** The capture's services and connections that the topology holds. */
  services: number;
  connections: number;
  /** Connections left out so that the calls run one way. */
  leftOut: { source: string; target: string }[];
  /** How many figures were read from the capture, and how many are defaults. */
  weights: { measured: number; assumed: number };
  latency: { measured: number; assumed: number };
  /**
   * Where the client's demand comes from: `measured` at the entry,
   * `convention` when the entry counted no requests and is taken to be as
   * busy as its busiest call, `default` when the capture measured no calls.
   */
  demand: 'measured' | 'convention' | 'default';
  /** Services the capture saw in no call: in the platform, connected to nothing. */
  unconnected: number;
  /** The scenario of measured load, when the capture measured any. */
  scenario: {
    id: string;
    phases: number;
    /** The lowest and highest multiple of the demand at rest. */
    low: number;
    high: number;
    /** Seconds of the capture in one second of the scenario. */
    compression: number;
  } | null;
}

export type DraftRefusal = 'id-too-long' | 'no-service';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** A capture's id as a topology id: its letters, digits, `.`, `_` and `-`. */
function slug(text: string): string {
  const cleaned = text
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID - 6);
  return cleaned || 'capture';
}

/** An id none of `taken` has. */
function unused(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const next = `${wanted}-${n}`;
    if (!taken.has(next)) return next;
  }
}

/** How a call into a service of each kind is filed; as the Compose reader files it. */
function callInto(
  source: ServiceType,
  target: ServiceType,
): [protocol: string, relationship: string] {
  if (source === 'message-queue') return ['amqp', 'consume'];
  switch (target) {
    case 'database':
      return ['sql', 'data'];
    case 'storage':
      return ['s3', 'data'];
    case 'message-queue':
      return ['amqp', 'publish'];
    case 'auth-service':
      return ['https', 'auth'];
    case 'cedar-authorizer':
      return ['https', 'authz'];
    case 'security-monitor':
      return ['otlp', 'telemetry'];
    default:
      return ['https', 'call'];
  }
}

const SYNCHRONOUS = new Set(['call', 'data', 'auth', 'authz', 'route']);

const ROLE_OF: Partial<Record<ServiceType, string>> = {
  'api-gateway': 'primaryGateway',
  database: 'primaryDatabase',
  'auth-service': 'primaryAuth',
  'cedar-authorizer': 'primaryAuthorizer',
  'security-monitor': 'securityMonitor',
};

/**
 * Writes the draft. `id` names the capture: a bundled capture's own id, or
 * anything for a file. Refused when a service's id is longer than a
 * topology takes, or when the capture holds nothing but clients.
 */
export function draftOf(capture: Capture, id: string): Draft | { refused: DraftRefusal } {
  if (capture.nodes.some((node) => node.id.length > MAX_ID)) return { refused: 'id-too-long' };
  const period = capture.periodMs;
  const firstEvent = capture.events[0]?.atMs;
  // The capture at rest: before its first event, if any sample is.
  const atRest = (buckets: readonly Bucket[] | undefined): Bucket[] => {
    const all = buckets ?? [];
    if (firstEvent === undefined) return [...all];
    const before = all.filter((point) => point.atMs < firstEvent);
    return before.length > 0 ? before : [...all];
  };
  const rate = (buckets: readonly Bucket[] | undefined) => typicalRate(atRest(buckets), period);
  const p95 = (buckets: readonly Bucket[] | undefined): number | null => {
    const values = atRest(buckets).flatMap((point) =>
      point.p95Ms === undefined ? [] : [point.p95Ms],
    );
    return values.length > 0 ? median(values) : null;
  };

  const kind = new Map(capture.nodes.map((node) => [node.id, node.type]));
  const services = capture.nodes.filter((node) => node.type !== 'external-client');
  if (services.length === 0) return { refused: 'no-service' };

  // Connections busiest first, the file's order between equals; one that
  // would close a circle is left out.
  const ranked = capture.edges
    .map((edge, index) => ({ edge, index, calls: rate(edge.buckets) }))
    .sort((a, b) => b.calls - a.calls || a.index - b.index);
  const out = new Map<string, string[]>();
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      const node = queue.pop()!;
      if (node === to) return true;
      for (const next of out.get(node) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  const kept: { edge: CaptureEdge; index: number; calls: number }[] = [];
  const leftOut: Draft['leftOut'] = [];
  for (const entry of ranked) {
    const { source, target } = entry.edge;
    // Nothing calls a client: a call into one is the answer coming back.
    if (kind.get(target) === 'external-client' || reaches(target, source)) {
      leftOut.push({ source, target });
      continue;
    }
    out.set(source, [...(out.get(source) ?? []), target]);
    kept.push(entry);
  }
  kept.sort((a, b) => a.index - b.index);

  // The requests a second a service handled at rest: counted by the
  // capture, or, where it counted none, as many as its busiest call.
  const counted = new Map(capture.nodes.map((node) => [node.id, rate(node.buckets)]));
  const busiestCall = (nodeId: string) =>
    Math.max(0, ...kept.filter((e) => e.edge.source === nodeId).map((e) => e.calls));
  const handledBy = (nodeId: string) => counted.get(nodeId) || busiestCall(nodeId);

  const called = new Set(kept.map((entry) => entry.edge.target));
  const uncalled = services.filter((node) => !called.has(node.id));
  const taken = new Set(capture.nodes.map((node) => node.id));
  const hasClients = capture.nodes.some((node) => node.type === 'external-client');

  // One client in front of every service nothing calls and something was
  // seen of, unless the capture has clients of its own. With nothing seen
  // of any (a report), in front of them all.
  const seen = uncalled.filter((node) => handledBy(node.id) > 0);
  const entries = seen.length > 0 ? seen : uncalled;
  const entryRates = entries.map((node) => handledBy(node.id));
  const entryTotal = entryRates.reduce((sum, value) => sum + value, 0);
  const demand: Draft['demand'] =
    hasClients || entryTotal <= 0
      ? 'default'
      : entries.every((node) => (counted.get(node.id) ?? 0) > 0)
        ? 'measured'
        : 'convention';
  const demandMeasured = demand !== 'default';
  const unconnected = hasClients ? 0 : uncalled.length - entries.length;
  const clientId = unused('clients', taken);
  const regionIds = new Set(capture.regions.map((region) => region.id));
  const outside = unused('outside', regionIds);

  const weights = { measured: 0, assumed: 0 };
  const edges = kept.map(({ edge, calls }) => {
    const handled = handledBy(edge.source);
    const measured = calls > 0 && handled > 0;
    weights[measured ? 'measured' : 'assumed'] += 1;
    const [protocol, relationship] = callInto(kind.get(edge.source)!, kind.get(edge.target)!);
    return {
      source: edge.source,
      target: edge.target,
      protocol,
      relationship,
      weight: measured ? round(calls / handled, 4) : 1,
    };
  });

  // A service's own latency: its p95 less that of what it calls in line.
  const measuredP95 = new Map(capture.nodes.map((node) => [node.id, p95(node.buckets)]));
  const latency = { measured: 0, assumed: 0 };
  const ownLatency = (nodeId: string): number => {
    const whole = measuredP95.get(nodeId) ?? null;
    if (whole === null) {
      latency.assumed += 1;
      return DEFAULT_LATENCY_MS;
    }
    latency.measured += 1;
    const callees = edges
      .filter((edge) => edge.source === nodeId && SYNCHRONOUS.has(edge.relationship))
      .reduce(
        (sum, edge) => sum + Math.min(edge.weight, 1) * (measuredP95.get(edge.target) ?? 0),
        0,
      );
    return round(Math.max(LEAST_LATENCY_MS, whole - callees), 2);
  };

  // How far along the path each service is: one past the furthest caller.
  const tier = new Map<string, number>();
  const tierOf = (nodeId: string): number => {
    const known = tier.get(nodeId);
    if (known !== undefined) return known;
    tier.set(nodeId, 1);
    const callers = kept.filter((entry) => entry.edge.target === nodeId);
    const depth =
      callers.length === 0
        ? 1
        : Math.min(250, 1 + Math.max(...callers.map((c) => tierOf(c.edge.source))));
    tier.set(nodeId, depth);
    return depth;
  };

  const nodes: Record<string, unknown>[] = capture.nodes.map((node) =>
    node.type === 'external-client'
      ? {
          id: node.id,
          name: node.name,
          type: node.type,
          region: node.region,
          tier: 0,
          baseLatencyMs: 0,
          baseRps: round(rate(node.buckets) || DEFAULT_DEMAND_RPS, 2),
        }
      : {
          id: node.id,
          name: node.name,
          type: node.type,
          region: node.region,
          tier: tierOf(node.id),
          ...(node.note ? { description: node.note } : {}),
          baseLatencyMs: ownLatency(node.id),
        },
  );
  const regions: Record<string, unknown>[] = capture.regions.map((region) => ({
    id: region.id,
    name: region.name,
    kind: 'cloud',
    location: region.name,
  }));
  const allEdges: Record<string, unknown>[] = [...edges];
  const clients: string[] = capture.nodes
    .filter((node) => node.type === 'external-client')
    .map((node) => node.id);
  if (!hasClients) {
    regions.unshift({
      id: outside,
      name: 'Clients',
      kind: 'cloud',
      location: 'Outside the capture',
    });
    nodes.unshift({
      id: clientId,
      name: 'Clients',
      type: 'external-client',
      region: outside,
      tier: 0,
      baseLatencyMs: 0,
      baseRps: demandMeasured ? round(entryTotal, 2) : DEFAULT_DEMAND_RPS,
    });
    clients.push(clientId);
    entries.forEach((node, index) => {
      allEdges.push({
        source: clientId,
        target: node.id,
        protocol: 'https',
        relationship: 'route',
        weight: demandMeasured
          ? round(entryRates[index]! / entryTotal, 4)
          : round(1 / entries.length, 4),
      });
    });
  }

  const roles: Record<string, string> = {};
  for (const node of services) {
    const role = ROLE_OF[node.type];
    if (role && !(role in roles)) roles[role] = node.id;
  }

  const topologyId = `${slug(id)}-draft`;
  const description = [
    `Drafted from the incident capture “${capture.title}” (${capture.source.label}). A starting point to edit, not a measurement: what is on show is computed by the simulation.`,
    `From the capture: its ${services.length} services, ${kept.length} of the connections it saw` +
      (leftOut.length > 0
        ? ` (${leftOut.length} left out so that calls run one way: ${leftOut
            .map((edge) => `${edge.source} to ${edge.target}`)
            .join(', ')})`
        : '') +
      `, ${weights.measured} connection weights (calls seen over requests the caller handled, at rest)` +
      `, the latency of ${latency.measured} services (median p95 at rest less that of what each calls)` +
      (demand === 'measured'
        ? `, and the demand of ${round(entryTotal, 2)} requests a second (median at the entry, at rest).`
        : '.'),
    ...(demand === 'convention'
      ? [
          `By convention: the capture did not count the requests its entry handled, so the entry is taken to be as busy as its busiest call, ${round(entryTotal, 2)} requests a second. The calls it makes downstream come out as measured; its own load rests on that convention.`,
        ]
      : []),
    ...(unconnected > 0
      ? [
          `${unconnected} services were seen in no call: they are in the platform, connected to nothing.`,
        ]
      : []),
    `Defaults: ${weights.assumed} connection weights of 1, ${latency.assumed} latencies of ${DEFAULT_LATENCY_MS} ms` +
      (demandMeasured ? '' : `, a demand of ${DEFAULT_DEMAND_RPS} requests a second`) +
      (hasClients ? '.' : ', and the client in front of every service nothing was seen to call.'),
    'No capture states a capacity: each service has the model’s default headroom over its load at rest. Give capacityRps to the services whose limits are known before reading what breaks.',
  ].join(' ');

  const topology = {
    id: topologyId,
    name: `${capture.title} (draft)`,
    description,
    dataSource: 'synthetic',
    regions,
    roles,
    nodes,
    edges: allEdges,
  };
  const files: WorkspaceFile[] = [
    { path: `topologies/${topologyId}.json`, text: `${JSON.stringify(topology, null, 2)}\n` },
  ];

  const scenario = demandMeasured
    ? loadScenario(
        capture,
        entries.map((n) => n.id),
        clientId,
        entryTotal,
        topologyId,
      )
    : null;
  if (scenario) {
    files.push({
      path: `scenarios/${scenario.summary.id}.json`,
      text: `${JSON.stringify(scenario.file, null, 2)}\n`,
    });
  }
  return {
    files,
    topologyId,
    services: services.length,
    connections: kept.length,
    leftOut,
    weights,
    latency,
    demand,
    unconnected,
    scenario: scenario?.summary ?? null,
  };
}

/** The demand measured at the entry, period by period, as a scenario. */
function loadScenario(
  capture: Capture,
  entryIds: string[],
  clientId: string,
  atRest: number,
  topologyId: string,
): { file: Record<string, unknown>; summary: NonNullable<Draft['scenario']> } | null {
  const period = capture.periodMs;
  if (!period) return null;
  // Requests a second into the entry in each period: what an entry counted,
  // or, for one that counted none, its busiest call of that period.
  const totals = new Map<number, number>();
  for (const node of capture.nodes) {
    if (!entryIds.includes(node.id)) continue;
    const own = new Map<number, number>();
    for (const point of node.buckets ?? []) {
      if (point.requests !== undefined) own.set(point.atMs, point.requests);
    }
    if (own.size === 0) {
      for (const edge of capture.edges) {
        if (edge.source !== node.id) continue;
        for (const point of edge.buckets ?? []) {
          if (point.requests === undefined) continue;
          own.set(point.atMs, Math.max(own.get(point.atMs) ?? 0, point.requests));
        }
      }
    }
    for (const [atMs, requests] of own) {
      totals.set(atMs, (totals.get(atMs) ?? 0) + (1000 * requests) / period);
    }
  }
  const points = [...totals.entries()].sort((a, b) => a[0] - b[0]);
  if (points.length < 2) return null;

  // As many periods to a phase as it takes to fit, each phase their mean.
  const group = Math.ceil(points.length / MAX_PHASES);
  const windowMs = capture.window.endMs - capture.window.startMs;
  const compression = Math.max(1, Math.ceil(windowMs / MAX_SCENARIO_MS));
  const toScenario = (ms: number) => Math.floor(ms / compression / TICK_MS) * TICK_MS;
  const durationMs = Math.max(TICK_MS, Math.min(MAX_SCENARIO_MS, toScenario(windowMs)));
  const phases: Record<string, unknown>[] = [];
  let low = Infinity;
  let high = 0;
  let last = -1;
  for (let start = 0; start < points.length; start += group) {
    const members = points.slice(start, start + group);
    const factor = round(
      members.reduce((sum, [, value]) => sum + value, 0) / members.length / atRest,
      3,
    );
    const atMs = toScenario(members[0]![0] - capture.window.startMs);
    // Phases are entered on tick boundaries and need one between them.
    if (atMs <= last || atMs >= durationMs) continue;
    last = atMs;
    low = Math.min(low, factor);
    high = Math.max(high, factor);
    phases.push({
      name: `${new Date(members[0]![0]).toISOString().slice(11, 19)} UTC`,
      atMs,
      rampMs: Math.max(TICK_MS, toScenario(period * members.length)),
      status: 'active',
      description: `Demand at ×${factor} its level at rest, as measured in the capture.`,
      effects: [{ type: 'demand', node: `node:${clientId}`, factor: Math.min(factor, 1000) }],
    });
  }
  if (phases.length === 0) return null;
  const id = `${topologyId.slice(0, MAX_ID - 5)}-load`;
  return {
    file: {
      id,
      name: `Measured load of ${capture.title}`,
      summary:
        `The demand the capture measured at its entry, as a multiple of its level at rest (×${low} to ×${high}). ` +
        `It prescribes load and nothing else: what fails under it is computed by the model.` +
        (compression > 1 ? ` One second here is ${compression} seconds of the capture.` : ''),
      category: 'availability',
      severity: 'warning',
      durationMs,
      targets: [`node:${clientId}`],
      phases,
    },
    summary: { id, phases: phases.length, low, high, compression },
  };
}

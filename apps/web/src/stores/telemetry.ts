/**
 * Telemetry store: topology, the latest snapshot, the event log and metric
 * history.
 *
 * Snapshots arrive several times a second. React components subscribe to
 * narrow slices with selectors so only what changed re-renders; the 3D scene
 * bypasses React entirely and reads the store through `subscribe`.
 */
import {
  HEALTH_BY_CODE,
  type ConnectionState,
  type Health,
  type InfrastructureEdge,
  type InfrastructureNode,
  type MetricSample,
  type PlaybackState,
  type SecurityEvent,
  type TelemetrySnapshot,
  type Topology,
} from '@aegis/contracts';
import { create } from 'zustand';

/** Events kept in memory. Older ones remain available from the server. */
export const MAX_EVENTS = 2500;
/** Global metric samples kept for the timeline (one per virtual second). */
export const MAX_HISTORY = 1900;
/** Per-node samples kept for inspector sparklines. */
export const NODE_HISTORY = 90;

export interface TopologyIndex {
  nodeIndex: Map<string, number>;
  edgeIndex: Map<string, number>;
  /** Edge indices leaving / entering each node. */
  outgoing: number[][];
  incoming: number[][];
  nodesByRegion: Map<string, number[]>;
}

export function indexTopology(topology: Topology): TopologyIndex {
  const nodeIndex = new Map(topology.nodes.map((node, i) => [node.id, i]));
  const edgeIndex = new Map(topology.edges.map((edge, i) => [edge.id, i]));
  const outgoing: number[][] = topology.nodes.map(() => []);
  const incoming: number[][] = topology.nodes.map(() => []);
  topology.edges.forEach((edge, i) => {
    const source = nodeIndex.get(edge.source);
    const target = nodeIndex.get(edge.target);
    if (source !== undefined) outgoing[source]!.push(i);
    if (target !== undefined) incoming[target]!.push(i);
  });
  const nodesByRegion = new Map<string, number[]>();
  topology.nodes.forEach((node, i) => {
    const list = nodesByRegion.get(node.region) ?? [];
    list.push(i);
    nodesByRegion.set(node.region, list);
  });
  return { nodeIndex, edgeIndex, outgoing, incoming, nodesByRegion };
}

/** Fixed-size ring of the most recent per-node samples. */
export interface NodeSeries {
  latency: Float32Array;
  throughput: Float32Array;
  error: Float32Array;
}

interface NodeHistory {
  series: NodeSeries[];
  /** Number of valid samples (≤ NODE_HISTORY). */
  length: number;
  /** Virtual time of the newest sample. */
  lastTimeMs: number;
}

function emptyNodeHistory(nodeCount: number): NodeHistory {
  return {
    series: Array.from({ length: nodeCount }, () => ({
      latency: new Float32Array(NODE_HISTORY),
      throughput: new Float32Array(NODE_HISTORY),
      error: new Float32Array(NODE_HISTORY),
    })),
    length: 0,
    lastTimeMs: -1,
  };
}

export interface TelemetryState {
  connection: ConnectionState;
  /** Stream round-trip time in milliseconds, when measured. */
  latencyMs: number | null;
  /** Set when the first load fails; cleared on success. */
  loadError: string | null;
  topology: Topology | null;
  index: TopologyIndex | null;
  snapshot: TelemetrySnapshot | null;
  playback: PlaybackState | null;
  events: SecurityEvent[];
  history: MetricSample[];
  nodeHistory: NodeHistory;
  /** Bumped whenever the node history rings receive a sample. */
  nodeHistoryVersion: number;

  setConnection: (state: ConnectionState) => void;
  setLatency: (ms: number) => void;
  setLoadError: (message: string | null) => void;
  setTopology: (topology: Topology) => void;
  applySnapshot: (snapshot: TelemetrySnapshot) => void;
  setPlayback: (playback: PlaybackState) => void;
  appendEvents: (events: SecurityEvent[]) => void;
  replaceEvents: (events: SecurityEvent[]) => void;
  replaceHistory: (samples: MetricSample[]) => void;
  /** Drops everything derived from a timeline that no longer exists. */
  clearTimeline: () => void;
}

/** Merges two seq-ordered event lists, de-duplicating by sequence number. */
export function mergeEvents(current: SecurityEvent[], incoming: SecurityEvent[]): SecurityEvent[] {
  if (incoming.length === 0) return current;
  const last = current[current.length - 1];
  const first = incoming[0]!;
  let merged: SecurityEvent[];
  if (!last || first.seq > last.seq) {
    merged = current.concat(incoming);
  } else {
    const bySeq = new Map<number, SecurityEvent>();
    for (const event of current) bySeq.set(event.seq, event);
    for (const event of incoming) bySeq.set(event.seq, event);
    merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  }
  return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
}

export const useTelemetry = create<TelemetryState>((set, get) => ({
  connection: 'idle',
  latencyMs: null,
  loadError: null,
  topology: null,
  index: null,
  snapshot: null,
  playback: null,
  events: [],
  history: [],
  nodeHistory: emptyNodeHistory(0),
  nodeHistoryVersion: 0,

  setConnection: (connection) => set({ connection }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setLoadError: (loadError) => set({ loadError }),

  setTopology: (topology) =>
    set({
      topology,
      index: indexTopology(topology),
      nodeHistory: emptyNodeHistory(topology.nodes.length),
      nodeHistoryVersion: 0,
      loadError: null,
    }),

  applySnapshot: (snapshot) => {
    const state = get();
    const { topology } = state;
    // A snapshot for another topology (mid-switch) cannot be indexed safely.
    if (
      !topology ||
      snapshot.topologyId !== topology.id ||
      snapshot.nodes.health.length !== topology.nodes.length ||
      snapshot.edges.trafficRps.length !== topology.edges.length
    ) {
      set({ playback: snapshot.playback });
      return;
    }
    const update: Partial<TelemetryState> = { snapshot, playback: snapshot.playback };

    // One sample per virtual second, only while time moves forward.
    const second = Math.floor(snapshot.virtualTimeMs / 1000);
    const nodeHistory = state.nodeHistory;
    if (second > Math.floor(nodeHistory.lastTimeMs / 1000) || nodeHistory.lastTimeMs < 0) {
      const shift = nodeHistory.length === NODE_HISTORY;
      const at = shift ? NODE_HISTORY - 1 : nodeHistory.length;
      for (let i = 0; i < nodeHistory.series.length; i++) {
        const series = nodeHistory.series[i]!;
        if (shift) {
          series.latency.copyWithin(0, 1);
          series.throughput.copyWithin(0, 1);
          series.error.copyWithin(0, 1);
        }
        series.latency[at] = snapshot.nodes.latencyMs[i] ?? 0;
        series.throughput[at] = snapshot.nodes.throughputRps[i] ?? 0;
        series.error[at] = snapshot.nodes.errorRate[i] ?? 0;
      }
      nodeHistory.length = Math.min(NODE_HISTORY, nodeHistory.length + 1);
      nodeHistory.lastTimeMs = snapshot.virtualTimeMs;
      update.nodeHistoryVersion = state.nodeHistoryVersion + 1;

      // Extend the global history only at the live head; replayed time is
      // already in it.
      const lastSample = state.history[state.history.length - 1];
      if (snapshot.playback.mode === 'live' && (!lastSample || snapshot.tick > lastSample.tick)) {
        const g = snapshot.global;
        const sample: MetricSample = {
          tick: snapshot.tick,
          virtualTimeMs: snapshot.virtualTimeMs,
          rps: g.rps,
          avgLatencyMs: g.avgLatencyMs,
          p95LatencyMs: g.p95LatencyMs,
          p99LatencyMs: g.p99LatencyMs,
          errorRate: g.errorRate,
          authzDenialRate: g.authzDenialRate,
          suspiciousRps: g.suspiciousRps,
        };
        const history = state.history.concat(sample);
        update.history =
          history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history;
      }
    }
    set(update);
  },

  setPlayback: (playback) => set({ playback }),
  appendEvents: (events) => set((state) => ({ events: mergeEvents(state.events, events) })),
  replaceEvents: (events) =>
    set({ events: events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events }),
  replaceHistory: (history) =>
    set({
      history: history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history,
    }),
  clearTimeline: () =>
    set((state) => ({
      events: [],
      history: [],
      nodeHistory: emptyNodeHistory(state.topology?.nodes.length ?? 0),
      nodeHistoryVersion: 0,
    })),
}));

// -- derived helpers ---------------------------------------------------------

export interface LiveNode {
  node: InfrastructureNode;
  index: number;
  health: Health;
  latencyMs: number;
  throughputRps: number;
  errorRate: number;
  saturation: number;
  queueDepth: number;
}

/** A node with its metrics from the latest snapshot (or the topology's). */
export function liveNode(
  topology: Topology,
  snapshot: TelemetrySnapshot | null,
  index: number,
): LiveNode | null {
  const node = topology.nodes[index];
  if (!node) return null;
  if (!snapshot) {
    return { node, index, ...node.metrics };
  }
  return {
    node,
    index,
    health: HEALTH_BY_CODE[snapshot.nodes.health[index] ?? 0] ?? 'healthy',
    latencyMs: snapshot.nodes.latencyMs[index] ?? 0,
    throughputRps: snapshot.nodes.throughputRps[index] ?? 0,
    errorRate: snapshot.nodes.errorRate[index] ?? 0,
    saturation: snapshot.nodes.saturation[index] ?? 0,
    queueDepth: snapshot.nodes.queueDepth[index] ?? 0,
  };
}

export interface LiveEdge {
  edge: InfrastructureEdge;
  index: number;
  trafficRps: number;
  latencyMs: number;
  errorRate: number;
  rejectedRps: number;
  suspiciousRps: number;
  securityCode: number;
}

export function liveEdge(
  topology: Topology,
  snapshot: TelemetrySnapshot | null,
  index: number,
): LiveEdge | null {
  const edge = topology.edges[index];
  if (!edge) return null;
  if (!snapshot) {
    return {
      edge,
      index,
      trafficRps: edge.metrics.trafficRps,
      latencyMs: edge.metrics.latencyMs,
      errorRate: edge.metrics.errorRate,
      rejectedRps: edge.metrics.rejectedRps,
      suspiciousRps: edge.metrics.suspiciousRps,
      securityCode: 0,
    };
  }
  return {
    edge,
    index,
    trafficRps: snapshot.edges.trafficRps[index] ?? 0,
    latencyMs: snapshot.edges.latencyMs[index] ?? 0,
    errorRate: snapshot.edges.errorRate[index] ?? 0,
    rejectedRps: snapshot.edges.rejectedRps[index] ?? 0,
    suspiciousRps: snapshot.edges.suspiciousRps[index] ?? 0,
    securityCode: snapshot.edges.securityStatus[index] ?? 0,
  };
}

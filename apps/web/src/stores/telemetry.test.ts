import type { SecurityEvent } from '@aegis/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  events as eventsSample,
  snapshot as snapshotSample,
  topology as topologySample,
} from '@/test/fixtures';

import {
  indexTopology,
  liveEdge,
  liveNode,
  MAX_EVENTS,
  mergeEvents,
  NODE_HISTORY,
  useTelemetry,
} from './telemetry';

const helios = topologySample();
const base = snapshotSample();

function at(tick: number, patch: Partial<typeof base> = {}) {
  return {
    ...base,
    tick,
    virtualTimeMs: tick * 200,
    playback: { ...base.playback, tick, mode: 'live' as const },
    ...patch,
  };
}

function event(seq: number): SecurityEvent {
  return { ...eventsSample().events[0]!, seq, id: `evt-${seq}` };
}

beforeEach(() => {
  useTelemetry.setState(useTelemetry.getInitialState(), true);
});

describe('topology index', () => {
  it('maps ids to positions and edges to their endpoints', () => {
    const index = indexTopology(helios);
    const gateway = index.nodeIndex.get('use-gateway')!;
    expect(helios.nodes[gateway]!.id).toBe('use-gateway');
    const outgoing = index.outgoing[gateway]!.map((e) => helios.edges[e]!.target);
    expect(outgoing).toContain('use-cedar');
    const incoming = index.incoming[gateway]!.map((e) => helios.edges[e]!.source);
    expect(incoming).toEqual(['edge-router']);
    expect(index.nodesByRegion.get('eu-west')).toHaveLength(13);
  });
});

describe('event log', () => {
  it('appends newer events without re-sorting', () => {
    const merged = mergeEvents([event(1), event(2)], [event(3), event(4)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('de-duplicates overlapping deliveries by sequence number', () => {
    const merged = mergeEvents([event(1), event(2), event(3)], [event(2), event(3), event(4)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('is bounded', () => {
    const many = Array.from({ length: MAX_EVENTS + 50 }, (_, i) => event(i + 1));
    const merged = mergeEvents([], many);
    expect(merged).toHaveLength(MAX_EVENTS);
    expect(merged[0]!.seq).toBe(51);
  });
});

describe('snapshots', () => {
  it('are ignored until they match the loaded topology', () => {
    useTelemetry.getState().applySnapshot(at(10));
    expect(useTelemetry.getState().snapshot).toBeNull();
    // Playback is still adopted so controls stay responsive.
    expect(useTelemetry.getState().playback?.tick).toBe(10);

    useTelemetry.getState().setTopology(helios);
    useTelemetry.getState().applySnapshot(at(11, { topologyId: 'another' }));
    expect(useTelemetry.getState().snapshot).toBeNull();
    useTelemetry.getState().applySnapshot(at(12));
    expect(useTelemetry.getState().snapshot?.tick).toBe(12);
  });

  it('feed one history sample per virtual second while live', () => {
    const store = useTelemetry.getState();
    store.setTopology(helios);
    for (let tick = 1; tick <= 25; tick++) useTelemetry.getState().applySnapshot(at(tick));
    const { history, nodeHistory } = useTelemetry.getState();
    // Ticks 1..25 at 200 ms cover seconds 0..5.
    expect(history.map((s) => Math.floor(s.virtualTimeMs / 1000))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(nodeHistory.length).toBe(6);
    expect(history.at(-1)!.rps).toBe(base.global.rps);
  });

  it('do not rewrite history while replaying the past', () => {
    const store = useTelemetry.getState();
    store.setTopology(helios);
    for (let tick = 1; tick <= 10; tick++) useTelemetry.getState().applySnapshot(at(tick));
    const before = useTelemetry.getState().history.length;
    const replay = at(60, { playback: { ...base.playback, tick: 60, mode: 'replay' } });
    useTelemetry.getState().applySnapshot(replay);
    expect(useTelemetry.getState().history).toHaveLength(before);
  });

  it('keep per-node series in a fixed-size ring', () => {
    const store = useTelemetry.getState();
    store.setTopology(helios);
    for (let second = 0; second < NODE_HISTORY + 20; second++) {
      const snap = at(second * 5 + 1);
      snap.nodes = { ...snap.nodes, throughputRps: snap.nodes.throughputRps.map(() => second) };
      useTelemetry.getState().applySnapshot(snap);
    }
    const { nodeHistory } = useTelemetry.getState();
    expect(nodeHistory.length).toBe(NODE_HISTORY);
    const series = nodeHistory.series[0]!.throughput;
    expect(series[NODE_HISTORY - 1]).toBe(NODE_HISTORY + 19);
    expect(series[0]).toBe(20);
  });

  it('clearing the timeline drops derived history but keeps the topology', () => {
    const store = useTelemetry.getState();
    store.setTopology(helios);
    store.appendEvents([event(1)]);
    useTelemetry.getState().applySnapshot(at(5));
    useTelemetry.getState().clearTimeline();
    const state = useTelemetry.getState();
    expect(state.events).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.nodeHistory.length).toBe(0);
    expect(state.topology).toBe(helios);
  });
});

describe('live views', () => {
  it('prefer snapshot metrics over the ones the topology was loaded with', () => {
    const index = indexTopology(helios);
    const auth = index.nodeIndex.get('use-auth')!;
    expect(liveNode(helios, null, auth)!.health).toBe(helios.nodes[auth]!.metrics.health);
    const live = liveNode(helios, base, auth)!;
    expect(live.health).toBe('critical');
    expect(live.throughputRps).toBe(base.nodes.throughputRps[auth]);
    expect(liveNode(helios, base, 9999)).toBeNull();

    const edge = index.edgeIndex.get('use-gateway->use-auth')!;
    expect(liveEdge(helios, base, edge)!.rejectedRps).toBeGreaterThan(100);
  });

  it('lets go of the incident of a timeline that was replaced, and of nothing else', () => {
    const store = useTelemetry.getState();
    store.setTopology(helios);
    store.applySnapshot(base);
    const before = useTelemetry.getState().snapshot!;
    expect(before.incident?.id).toBe('inc-001');
    useTelemetry.getState().forgetIncident();
    const after = useTelemetry.getState().snapshot!;
    expect(after.incident).toBeNull();
    // The figures stay until the next snapshot replaces them.
    expect(after.nodes).toBe(before.nodes);
    expect(after.global).toBe(before.global);
    // With no incident there is nothing to let go of, and nothing changes.
    useTelemetry.getState().forgetIncident();
    expect(useTelemetry.getState().snapshot).toBe(after);
  });
});

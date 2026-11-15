import type { ActiveFault } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import { snapshot as snapshotSample, topology as topologySample } from '@/test/fixtures';

import {
  describeFault,
  EDGE_FAULTS,
  faultEffect,
  faultLabel,
  faultTarget,
  NODE_FAULTS,
} from './faults';

const topology = topologySample();
const nodeIndex = (id: string) => topology.nodes.findIndex((node) => node.id === id);
const edgeIndex = (source: string, target: string) =>
  topology.edges.findIndex((edge) => edge.source === source && edge.target === target);

function fault(partial: Partial<ActiveFault> & Pick<ActiveFault, 'kind'>): ActiveFault {
  return { node: null, edge: null, onto: null, value: 1, ...partial };
}

describe('faults placed by hand', () => {
  it('are worded as the timeline words them', () => {
    expect(describeFault('latency', 4)).toBe('latency ×4');
    expect(describeFault('capacity', 0.5)).toBe('capacity ×0.5');
    expect(describeFault('errorInject', 0.2)).toBe('20% of requests fail');
    expect(describeFault('edgeError', 0.125)).toBe('12.5% of calls fail');
    expect(describeFault('down', 1)).toBe('unreachable');
    expect(describeFault('edgeLatency', 2.5)).toBe('network latency ×2.5');
    // The same words open a line or name a button.
    expect(faultLabel('latency', 4)).toBe('Latency ×4');
    expect(faultLabel('errorInject', 0.2)).toBe('20% of requests fail');
  });

  it('are written for the server in the format of a scenario effect', () => {
    const gateway = nodeIndex('use-gateway');
    expect(faultEffect(topology, fault({ kind: 'latency', node: gateway, value: 4 }))).toEqual({
      type: 'latency',
      nodes: 'node:use-gateway',
      factor: 4,
    });
    expect(
      faultEffect(topology, fault({ kind: 'errorInject', node: gateway, value: 0.2 })),
    ).toEqual({ type: 'errorInject', nodes: 'node:use-gateway', rate: 0.2 });
    // Being down has no figure to send.
    expect(faultEffect(topology, fault({ kind: 'down', node: gateway }))).toEqual({
      type: 'down',
      nodes: 'node:use-gateway',
    });
    const edge = edgeIndex('use-gateway', 'use-catalog');
    expect(edge).toBeGreaterThanOrEqual(0);
    expect(faultEffect(topology, fault({ kind: 'edgeLatency', edge, value: 4 }))).toEqual({
      type: 'edgeLatency',
      edges: { between: { from: 'node:use-gateway', to: 'node:use-catalog' } },
      factor: 4,
    });
  });

  it('are not written for a position the topology does not have', () => {
    expect(faultEffect(topology, fault({ kind: 'latency', node: 9999 }))).toBeNull();
    expect(faultEffect(topology, fault({ kind: 'latency' }))).toBeNull();
    expect(faultEffect(topology, fault({ kind: 'edgeError', edge: 9999 }))).toBeNull();
    expect(faultEffect(topology, fault({ kind: 'routeShift', edge: 0 }))).toBeNull();
  });

  it('name what they are on', () => {
    expect(faultTarget(topology, fault({ kind: 'down', node: nodeIndex('use-search') }))).toBe(
      'Search',
    );
    const edge = edgeIndex('use-gateway', 'use-catalog');
    expect(faultTarget(topology, fault({ kind: 'edgeLatency', edge }))).toBe(
      'API Gateway → Catalog',
    );
  });

  it('are read from a snapshot the server sent', () => {
    // The sample was taken with one service slowed down by hand.
    const [placed] = snapshotSample().faults;
    expect(placed).toBeDefined();
    expect(faultTarget(topology, placed!)).toBe('Search');
    expect(describeFault(placed!.kind, placed!.value)).toBe('latency ×3');
    expect(faultEffect(topology, placed!)).toEqual({
      type: 'latency',
      nodes: 'node:use-search',
      factor: 3,
    });
  });

  it('offer a few on a service and fewer on a connection', () => {
    expect(NODE_FAULTS.map((choice) => choice.kind)).toEqual([
      'latency',
      'errorInject',
      'capacity',
      'down',
    ]);
    expect(EDGE_FAULTS.map((choice) => choice.kind)).toEqual(['edgeLatency', 'edgeError']);
  });
});

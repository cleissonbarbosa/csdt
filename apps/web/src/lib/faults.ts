/**
 * Faults placed by hand: one figure of a service or a connection held away
 * from nominal, outside any scenario. The server takes them in the format a
 * scenario phase is written in and reports the ones in force with every
 * snapshot, by position in the topology.
 */
import type { ActiveFault, FaultEffect, FaultKind, Topology } from '@aegis/contracts';

import { t } from '@/i18n';

import { nodeLabel } from './names';

function times(value: number): string {
  return `×${Number(value.toFixed(2))}`;
}

function percent(value: number): string {
  return `${Number((value * 100).toFixed(1))}%`;
}

/** A fault in a few words, as the timeline words it: `latency ×4`. */
export function describeFault(kind: FaultKind, value: number): string {
  switch (kind) {
    case 'demand':
      return t('demand {factor}', { factor: times(value) });
    case 'capacity':
      return t('capacity {factor}', { factor: times(value) });
    case 'latency':
      return t('latency {factor}', { factor: times(value) });
    case 'errorInject':
      return t('{share} of requests fail', { share: percent(value) });
    case 'down':
      return t('unreachable');
    case 'edgeWeight':
      return t('calls {factor}', { factor: times(value) });
    case 'edgeLatency':
      return t('network latency {factor}', { factor: times(value) });
    case 'edgeError':
      return t('{share} of calls fail', { share: percent(value) });
    case 'routeShift':
      return t('{share} of traffic moved', { share: percent(value) });
  }
}

/** The same words at the start of a line or on a button. */
export function faultLabel(kind: FaultKind, value: number): string {
  const words = describeFault(kind, value);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A fault the interface offers to place. */
export interface FaultChoice {
  kind: FaultKind;
  value: number;
}

/** What can be placed on a service from its card. */
export const NODE_FAULTS: readonly FaultChoice[] = [
  { kind: 'latency', value: 4 },
  { kind: 'errorInject', value: 0.2 },
  { kind: 'capacity', value: 0.5 },
  { kind: 'down', value: 1 },
];

/** What can be placed on a connection from its card. */
export const EDGE_FAULTS: readonly FaultChoice[] = [
  { kind: 'edgeLatency', value: 4 },
  { kind: 'edgeError', value: 0.2 },
];

function between(topology: Topology, edge: number): { from: string; to: string } | null {
  const found = topology.edges[edge];
  return found ? { from: `node:${found.source}`, to: `node:${found.target}` } : null;
}

/**
 * The effect that places a fault of this kind on a service or connection of
 * the topology, or names one in force so it can be lifted. `null` when the
 * position is not in this topology.
 */
export function faultEffect(
  topology: Topology,
  fault: Pick<ActiveFault, 'kind' | 'node' | 'edge' | 'onto' | 'value'>,
): FaultEffect | null {
  const node = fault.node === null ? undefined : topology.nodes[fault.node];
  const edge = fault.edge === null ? null : between(topology, fault.edge);
  const { value } = fault;
  switch (fault.kind) {
    case 'demand':
      return node ? { type: 'demand', node: `node:${node.id}`, factor: value } : null;
    case 'capacity':
    case 'latency':
      return node ? { type: fault.kind, nodes: `node:${node.id}`, factor: value } : null;
    case 'errorInject':
      return node ? { type: 'errorInject', nodes: `node:${node.id}`, rate: value } : null;
    case 'down':
      return node ? { type: 'down', nodes: `node:${node.id}` } : null;
    case 'edgeWeight':
    case 'edgeLatency':
      return edge ? { type: fault.kind, edges: { between: edge }, factor: value } : null;
    case 'edgeError':
      return edge ? { type: 'edgeError', edges: { between: edge }, rate: value } : null;
    case 'routeShift': {
      const onto = fault.onto === null ? null : between(topology, fault.onto);
      return edge && onto ? { type: 'routeShift', edge, onto, fraction: value } : null;
    }
  }
}

/** What a fault is on, by name: a service, or the two ends of a connection. */
export function faultTarget(topology: Topology, fault: ActiveFault): string {
  // With its region where the name alone would be one of several.
  const name = (id: string) => nodeLabel(topology, id);
  if (fault.node !== null) {
    const node = topology.nodes[fault.node];
    return node ? name(node.id) : t('Unknown service');
  }
  const edge = fault.edge === null ? undefined : topology.edges[fault.edge];
  if (!edge) return t('Unknown connection');
  return `${name(edge.source)} → ${name(edge.target)}`;
}

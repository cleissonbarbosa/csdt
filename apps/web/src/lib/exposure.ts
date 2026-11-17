/**
 * What a service is exposed to and exposes, read from the topology alone.
 *
 * A service that is taken over can open every connection the service opens,
 * and so can whatever those lead to. This follows the connections of the
 * topology, forward and back, and counts what it finds. Nothing is
 * simulated and nothing is judged: a path existing says a connection is
 * drawn there, not that anything would get through it.
 */
import type { AccessMatrix, AuthorizationCatalog, ServiceType, Topology } from '@aegis/contracts';

import { entityType } from './format';

/** Where data rests, or waits: what a path through a platform is usually after. */
const STORES: ReadonlySet<ServiceType> = new Set(['database', 'storage', 'message-queue']);

export interface Exposure {
  /** Every service its connections lead to, directly or through others, nearest first. */
  reaches: string[];
  /** Those of them that hold data: databases, object stores and queues. */
  stores: string[];
  /** Every service whose connections lead to it, nearest first. */
  reachedBy: string[];
  /**
   * The shortest way in from outside the platform: an external client, then
   * each service on the way, ending at this one. `null` when no connection
   * leads here from a client.
   */
  wayIn: string[] | null;
}

/** Neighbours by breadth, with the node each was first reached from. */
function spread(
  start: string,
  next: Map<string, string[]>,
): { order: string[]; from: Map<string, string> } {
  const from = new Map<string, string>();
  const order: string[] = [];
  const queue = [start];
  const seen = new Set([start]);
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    for (const other of next.get(at) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      from.set(other, at);
      order.push(other);
      queue.push(other);
    }
  }
  return { order, from };
}

export function exposureOf(topology: Topology, nodeId: string): Exposure {
  const forward = new Map<string, string[]>();
  const back = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const edge of topology.edges) {
    add(forward, edge.source, edge.target);
    add(back, edge.target, edge.source);
  }
  const typeOf = new Map(topology.nodes.map((node) => [node.id, node.serviceType]));
  const out = spread(nodeId, forward);
  const into = spread(nodeId, back);

  // Going back from this service, the first client met is the nearest one,
  // and the way it was reached, read the other way round, is the way in.
  const client = into.order.find((id) => typeOf.get(id) === 'external-client');
  let wayIn: string[] | null = null;
  if (client !== undefined) {
    wayIn = [client];
    for (let at = client; at !== nodeId;) {
      const toward = into.from.get(at);
      if (toward === undefined) break;
      wayIn.push(toward);
      at = toward;
    }
  }
  return {
    reaches: out.order,
    stores: out.order.filter((id) => STORES.has(typeOf.get(id)!)),
    reachedBy: into.order,
    wayIn,
  };
}

/** What Cedar is asked about the data a service stands for, and what it answers. */
export interface Guarded {
  /** The kind of entity requests for which end at this service. */
  resourceType: string;
  asked: number;
  allowed: number;
  /** Principals Cedar allows at least one such request. */
  principals: number;
  ofPrincipals: number;
}

/**
 * The kinds of resource a service stands for: a topology says, by a role
 * named `resource:<EntityType>`, where a request for such an entity ends.
 */
export function resourceTypesAt(topology: Topology, nodeId: string): string[] {
  return Object.entries(topology.roles)
    .filter(([role, id]) => role.startsWith('resource:') && id === nodeId)
    .map(([role]) => role.slice('resource:'.length))
    .sort();
}

/**
 * How Cedar answers the requests the catalogue describes for one kind of
 * resource, counted from an access matrix. Every figure is a count of the
 * engine's answers under the matrix's own context and policies.
 */
export function guardedBy(
  matrix: AccessMatrix,
  catalog: AuthorizationCatalog,
  resourceType: string,
): Guarded {
  const cells = matrix.cells.filter((cell) => entityType(cell.resource) === resourceType);
  const allowed = cells.filter((cell) => cell.decision === 'allow');
  return {
    resourceType,
    asked: cells.length,
    allowed: allowed.length,
    principals: new Set(allowed.map((cell) => cell.principal)).size,
    ofPrincipals: catalog.principals.length,
  };
}

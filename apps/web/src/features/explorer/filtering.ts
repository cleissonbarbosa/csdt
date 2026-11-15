/** Pure filter logic shared by the explorer list, the table view and the scene. */
import {
  HEALTH_BY_CODE,
  type Health,
  type InfrastructureNode,
  type TelemetrySnapshot,
  type Topology,
} from '@aegis/contracts';

import { SERVICE_TYPE } from '@/lib/palette';
import { filtersActive, type Filters } from '@/stores/ui';

export function nodeHealth(
  topology: Topology,
  snapshot: TelemetrySnapshot | null,
  index: number,
): Health {
  const code = snapshot?.nodes.health[index];
  if (code !== undefined) return HEALTH_BY_CODE[code] ?? 'healthy';
  return topology.nodes[index]?.metrics.health ?? 'healthy';
}

/** Every whitespace-separated term must appear in the node's searchable text. */
export function matchesSearch(node: InfrastructureNode, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    node.name,
    node.id,
    node.region,
    node.serviceType,
    SERVICE_TYPE[node.serviceType].label,
  ]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function matchesFilters(
  node: InfrastructureNode,
  health: Health,
  filters: Filters,
  impacted: ReadonlySet<string>,
): boolean {
  if (filters.types.length > 0 && !filters.types.includes(node.serviceType)) return false;
  if (filters.regions.length > 0 && !filters.regions.includes(node.region)) return false;
  if (filters.health.length > 0 && !filters.health.includes(health)) return false;
  if (filters.impactedOnly && !impacted.has(node.id)) return false;
  return matchesSearch(node, filters.search);
}

export function impactedSet(snapshot: TelemetrySnapshot | null): ReadonlySet<string> {
  return new Set(snapshot?.incident?.impactedNodeIds ?? []);
}

/**
 * One entry per node: 1 when it passes the filters, 0 when it should be
 * dimmed. Returns `null` when no filter is active (everything is visible).
 */
export function computeVisibilityMask(
  topology: Topology,
  snapshot: TelemetrySnapshot | null,
  filters: Filters,
): Float32Array | null {
  if (!filtersActive(filters)) return null;
  const impacted = impactedSet(snapshot);
  const mask = new Float32Array(topology.nodes.length);
  topology.nodes.forEach((node, i) => {
    mask[i] = matchesFilters(node, nodeHealth(topology, snapshot, i), filters, impacted) ? 1 : 0;
  });
  return mask;
}

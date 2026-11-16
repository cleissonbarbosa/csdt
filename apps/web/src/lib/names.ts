/**
 * What to call a service where its place is not on show.
 *
 * A platform runs the same service in several regions under one name: three
 * "Orders DB", four "API Gateway". In the model each stands on its region's
 * plate and needs no more. In a list of what a service calls, or of what an
 * incident affected, the names alone are the same word several times. There
 * the region is said, and only there: a name that is unique stays as it is.
 */
import type { Topology } from '@aegis/contracts';

export interface ServiceName {
  name: string;
  /** The region's name, when another service shares this one's name. */
  region: string | null;
}

const cache = new WeakMap<Topology, Map<string, ServiceName>>();

/** Every service's name, by id, with its region where the name repeats. */
export function serviceNames(topology: Topology): Map<string, ServiceName> {
  const known = cache.get(topology);
  if (known) return known;
  const regions = new Map(topology.regions.map((region) => [region.id, region.name]));
  const uses = new Map<string, number>();
  for (const node of topology.nodes) uses.set(node.name, (uses.get(node.name) ?? 0) + 1);
  const names = new Map<string, ServiceName>();
  for (const node of topology.nodes) {
    names.set(node.id, {
      name: node.name,
      region: (uses.get(node.name) ?? 0) > 1 ? (regions.get(node.region) ?? node.region) : null,
    });
  }
  cache.set(topology, names);
  return names;
}

/** The same as one string: `Orders DB, EU West`. */
export function labelOf(name: ServiceName): string {
  return name.region === null ? name.name : `${name.name}, ${name.region}`;
}

const labels = new WeakMap<Topology, Map<string, string>>();

/** Every service's label, by id. An id that is not in the topology has none. */
export function nodeLabels(topology: Topology): Map<string, string> {
  const known = labels.get(topology);
  if (known) return known;
  const out = new Map<string, string>();
  for (const [id, name] of serviceNames(topology)) out.set(id, labelOf(name));
  labels.set(topology, out);
  return out;
}

/** A service's label, or its id when the topology does not have it. */
export function nodeLabel(topology: Topology | null, id: string): string {
  return (topology && nodeLabels(topology).get(id)) ?? id;
}

/**
 * Services named for a reader who stands in one region: the table of that
 * region, where a row says what its service calls. There a name alone is a
 * service of that region. A call that leaves the region says where it goes,
 * when the name alone would not: the edge router calls three "API Gateway".
 */
export function namedFrom(topology: Topology, regionId: string, ids: readonly string[]): string[] {
  const names = serviceNames(topology);
  const regionOf = new Map(topology.nodes.map((node) => [node.id, node.region]));
  return ids.map((id) => {
    const entry = names.get(id);
    if (!entry) return id;
    return entry.region !== null && regionOf.get(id) !== regionId ? labelOf(entry) : entry.name;
  });
}

/**
 * Several such names as one line. A name that carries its region has taken
 * the comma, so the names are then set apart by semicolons.
 */
export function listNames(labels: readonly string[]): string {
  return labels.join(labels.some((label) => label.includes(', ')) ? '; ' : ', ');
}

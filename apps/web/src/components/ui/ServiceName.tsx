import type { Topology } from '@aegis/contracts';

import { serviceNames } from '@/lib/names';

/**
 * A service's name where its place is not on show. When several services
 * share the name, the region follows it, quieter than the name itself.
 */
export function ServiceName({ topology, id }: { topology: Topology | null; id: string }) {
  const entry = topology ? serviceNames(topology).get(id) : undefined;
  if (!entry) return <>{id}</>;
  return (
    <>
      {entry.name}
      {entry.region !== null && (
        <span className="font-normal text-ink-faint">, {entry.region}</span>
      )}
    </>
  );
}

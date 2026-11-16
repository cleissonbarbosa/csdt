import type { Health, InfrastructureNode } from '@aegis/contracts';
import { useMemo } from 'react';

import { useThrottledSnapshot } from '@/app/hooks';
import { HealthBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Section';
import { impactedSet, matchesFilters, nodeHealth } from '@/features/explorer/filtering';
import { cn } from '@/lib/cn';
import { formatMs, formatPercent, formatRate } from '@/lib/format';
import { listNames, namedFrom } from '@/lib/names';
import { SERVICE_TYPE } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

interface Row {
  node: InfrastructureNode;
  index: number;
  health: Health;
}

/**
 * The topology without 3D: one table per region, fully keyboard and screen
 * reader accessible. Shown on request, and automatically when the browser
 * can render neither WebGPU nor WebGL 2.
 */
export function TopologyTable({ notice }: { notice?: string | null }) {
  const topology = useTelemetry((state) => state.topology);
  const index = useTelemetry((state) => state.index);
  const snapshot = useThrottledSnapshot(1000);
  const filters = useUi((state) => state.filters);
  const selection = useUi((state) => state.selection);

  const groups = useMemo(() => {
    if (!topology) return [];
    const live = snapshot?.topologyId === topology.id ? snapshot : null;
    const impacted = impactedSet(live);
    return topology.regions
      .map((region) => {
        const rows: Row[] = [];
        topology.nodes.forEach((node, i) => {
          if (node.region !== region.id) return;
          const health = nodeHealth(topology, live, i);
          if (matchesFilters(node, health, filters, impacted))
            rows.push({ node, index: i, health });
        });
        rows.sort((a, b) => a.node.tier - b.node.tier || a.node.name.localeCompare(b.node.name));
        return { region, rows };
      })
      .filter((group) => group.rows.length > 0);
  }, [topology, snapshot, filters]);

  if (!topology || !index) return <EmptyState title="Loading topology" />;
  const live = snapshot?.topologyId === topology.id ? snapshot : null;

  return (
    <div className="h-full overflow-y-auto px-4 pb-6 pt-4" data-testid="topology-table">
      {notice && (
        <p role="status" className="panel mb-4 px-3 py-2 text-xs text-ink">
          {notice}
        </p>
      )}
      {groups.length === 0 && (
        <EmptyState title="No services match">Loosen the filters to see services again.</EmptyState>
      )}
      <div className="mx-auto max-w-5xl space-y-5">
        {groups.map(({ region, rows }) => (
          <table key={region.id} className="panel w-full border-collapse text-left text-xs">
            <caption className="px-3 pb-2 pt-3 text-left">
              <span className="text-sm font-bold text-ink">{region.name}</span>
              <span className="ml-2 text-[11px] text-ink-faint">
                {region.location}, {rows.length} service{rows.length === 1 ? '' : 's'}
              </span>
            </caption>
            <thead>
              <tr className="border-y border-line">
                {[
                  'Service',
                  'Type',
                  'Health',
                  'Throughput',
                  'Latency',
                  'Errors',
                  'Saturation',
                  'Calls',
                ].map((heading, i) => (
                  <th
                    key={heading}
                    scope="col"
                    className={cn('caption px-3 py-1.5', i >= 3 && i <= 6 && 'text-right')}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ node, index: i, health }) => {
                const selected = selection?.kind === 'node' && selection.id === node.id;
                // A call that leaves this table's region says where it
                // goes: several services carry the same name.
                const calls = namedFrom(
                  topology,
                  node.region,
                  (index.outgoing[i] ?? []).map((e) => topology.edges[e]!.target),
                );
                return (
                  <tr
                    key={node.id}
                    aria-selected={selected}
                    className={cn(
                      'border-b border-line last:border-b-0',
                      selected ? 'bg-raised' : 'hover:bg-raised',
                    )}
                  >
                    <th scope="row" className="px-3 py-1.5 font-normal">
                      <button
                        type="button"
                        onClick={() => useUi.getState().selectNode(node.id)}
                        className="text-left text-ink hover:underline hover:underline-offset-2"
                        data-testid={`table-service-${node.id}`}
                      >
                        {node.name}
                      </button>
                    </th>
                    <td className="px-3 py-1.5 text-ink-dim">
                      {SERVICE_TYPE[node.serviceType].label}
                    </td>
                    <td className="px-3 py-1.5">
                      <HealthBadge health={health} />
                    </td>
                    <td className="numeric px-3 py-1.5 text-right text-ink">
                      {formatRate(live?.nodes.throughputRps[i] ?? node.metrics.throughputRps)}/s
                    </td>
                    <td className="numeric px-3 py-1.5 text-right text-ink">
                      {formatMs(live?.nodes.latencyMs[i] ?? node.metrics.latencyMs)}
                    </td>
                    <td className="numeric px-3 py-1.5 text-right text-ink">
                      {formatPercent(live?.nodes.errorRate[i] ?? node.metrics.errorRate)}
                    </td>
                    <td className="numeric px-3 py-1.5 text-right text-ink">
                      {node.capacityRps > 0
                        ? formatPercent(live?.nodes.saturation[i] ?? node.metrics.saturation)
                        : 'n/a'}
                    </td>
                    {/* Written out, on as many lines as it takes: cut to
                        one line, three gateways read as one name repeated. */}
                    <td
                      className="max-w-[36ch] px-3 py-1.5 text-ink-faint"
                      data-testid={`table-calls-${node.id}`}
                    >
                      {calls.length > 0 ? listNames(calls) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

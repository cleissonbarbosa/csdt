import { SERVICE_TYPES, type Health, type InfrastructureNode } from '@aegis/contracts';
import { Crosshair, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useThrottledSnapshot } from '@/app/hooks';
import { HealthGlyph, HealthMark } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Section';
import { sceneHandle } from '@/graphics/handle';
import { cn } from '@/lib/cn';
import { formatRate } from '@/lib/format';
import { HEALTH_LABEL, SERVICE_TYPE } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';
import { filtersActive, useUi } from '@/stores/ui';

import { impactedSet, matchesFilters, nodeHealth } from './filtering';

const HEALTHS: Health[] = ['healthy', 'degraded', 'critical', 'down'];
/** Worst first: what needs attention is at the top of its region. */
const SEVERITY: Record<Health, number> = { down: 0, critical: 1, degraded: 2, healthy: 3 };

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-[3px] border px-1.5 text-[11px] transition-colors',
        active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

interface Row {
  node: InfrastructureNode;
  index: number;
  health: Health;
  rps: number;
}

export function Explorer() {
  const topology = useTelemetry((state) => state.topology);
  const snapshot = useThrottledSnapshot(1000);
  const filters = useUi((state) => state.filters);
  const selection = useUi((state) => state.selection);
  const ui = useUi.getState();
  const [showFilters, setShowFilters] = useState(false);

  const typesPresent = useMemo(
    () => SERVICE_TYPES.filter((type) => topology?.nodes.some((n) => n.serviceType === type)),
    [topology],
  );

  const groups = useMemo(() => {
    if (!topology) return [];
    const impacted = impactedSet(snapshot);
    const live = snapshot?.topologyId === topology.id ? snapshot : null;
    return topology.regions.map((region) => {
      const rows: Row[] = [];
      let total = 0;
      topology.nodes.forEach((node, index) => {
        if (node.region !== region.id) return;
        total += 1;
        const health = nodeHealth(topology, live, index);
        if (!matchesFilters(node, health, filters, impacted)) return;
        rows.push({
          node,
          index,
          health,
          rps: live?.nodes.throughputRps[index] ?? node.metrics.throughputRps,
        });
      });
      rows.sort(
        (a, b) =>
          SEVERITY[a.health] - SEVERITY[b.health] ||
          a.node.tier - b.node.tier ||
          a.node.name.localeCompare(b.node.name),
      );
      const status = live?.regions.find((r) => r.id === region.id)?.health ?? 'healthy';
      return { region, rows, total, status };
    });
  }, [topology, snapshot, filters]);

  if (!topology) return <EmptyState title="Loading topology" />;
  const shown = groups.reduce((sum, g) => sum + g.rows.length, 0);
  const active = filtersActive(filters);

  const narrowed = filters.health.length + filters.types.length + (filters.impactedOnly ? 1 : 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="explorer">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => ui.setSearch(event.target.value)}
              placeholder="Search services"
              aria-label="Search services by name, type or region"
              data-testid="explorer-search"
              className="h-8 w-full rounded-[3px] border border-line-strong bg-paper pl-7 pr-2 text-xs text-ink placeholder:text-ink-faint"
            />
          </div>
          <Button
            icon={<SlidersHorizontal size={13} aria-hidden />}
            pressed={showFilters}
            aria-expanded={showFilters}
            aria-controls="explorer-filters"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="explorer-filters-toggle"
          >
            Filter{narrowed > 0 ? ` (${narrowed})` : ''}
          </Button>
        </div>
        {showFilters && (
          <div id="explorer-filters" className="space-y-2.5 pt-1">
            <fieldset>
              <legend className="caption mb-1">State</legend>
              <div className="flex flex-wrap gap-1">
                {HEALTHS.map((health) => (
                  <Chip
                    key={health}
                    active={filters.health.includes(health)}
                    onClick={() => ui.toggleHealth(health)}
                  >
                    {!filters.health.includes(health) && <HealthGlyph health={health} size={8} />}
                    {HEALTH_LABEL[health]}
                  </Chip>
                ))}
                <Chip
                  active={filters.impactedOnly}
                  onClick={() => ui.setImpactedOnly(!filters.impactedOnly)}
                >
                  Affected by the incident
                </Chip>
              </div>
            </fieldset>
            <fieldset>
              <legend className="caption mb-1">Kind of service</legend>
              <div className="flex flex-wrap gap-1">
                {typesPresent.map((type) => (
                  <Chip
                    key={type}
                    active={filters.types.includes(type)}
                    onClick={() => ui.toggleType(type)}
                  >
                    {SERVICE_TYPE[type].short}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="caption" aria-live="polite" data-testid="explorer-count">
            {shown} of {topology.nodes.length} services
          </p>
          {active && (
            <button
              type="button"
              onClick={ui.clearFilters}
              className="inline-flex items-center gap-1 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            >
              <X size={12} aria-hidden /> Clear filters
            </button>
          )}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Infrastructure by region">
        {shown === 0 && (
          <EmptyState title="No services match">
            Loosen the filters to see services again.
          </EmptyState>
        )}
        {groups.map(({ region, rows, total, status }) => {
          const regionActive = filters.regions.includes(region.id);
          if (rows.length === 0) return null;
          return (
            <section key={region.id} aria-label={region.name}>
              <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper py-1 pl-3 pr-1.5">
                {status !== 'healthy' && <HealthMark health={status} />}
                <button
                  type="button"
                  aria-pressed={regionActive}
                  onClick={() => ui.toggleRegion(region.id)}
                  title={regionActive ? 'Show all regions' : 'Show only this region'}
                  className={cn(
                    'min-w-0 flex-1 truncate text-left text-xs font-bold text-ink',
                    regionActive
                      ? 'underline decoration-2 underline-offset-4'
                      : 'hover:underline hover:underline-offset-4',
                  )}
                >
                  {region.name}
                </button>
                <span className="caption">
                  {rows.length}
                  {rows.length !== total && ` of ${total}`}
                </span>
                <IconButton
                  label={`Frame ${region.name}`}
                  size="sm"
                  onClick={() => sceneHandle.current?.frameRegion(region.id)}
                >
                  <Crosshair size={13} />
                </IconButton>
              </header>
              <ul>
                {rows.map(({ node, health, rps }) => {
                  const selected = selection?.kind === 'node' && selection.id === node.id;
                  return (
                    <li key={node.id}>
                      <button
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        data-testid={`service-${node.id}`}
                        data-health={health}
                        onClick={() => ui.selectNode(node.id)}
                        onDoubleClick={() => sceneHandle.current?.focusNode(node.id)}
                        onMouseEnter={() => ui.setHovered(node.id)}
                        onMouseLeave={() => ui.setHovered(null)}
                        onFocus={() => ui.setHovered(node.id)}
                        onBlur={() => ui.setHovered(null)}
                        // One line per service: its name, and how busy it is.
                        // What kind of service it is shows in its piece, in
                        // the inspector and here on hover.
                        title={SERVICE_TYPE[node.serviceType].label}
                        className={cn(
                          'flex h-7 w-full items-center gap-2 border-l-2 pl-2.5 pr-3 text-left transition-colors',
                          selected ? 'border-ink bg-raised' : 'border-transparent hover:bg-raised',
                        )}
                      >
                        <HealthMark health={health} />
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-xs text-ink',
                            (selected || health !== 'healthy') && 'font-bold',
                          )}
                        >
                          {node.name}
                          <span className="sr-only">, {SERVICE_TYPE[node.serviceType].label}</span>
                        </span>
                        <span className="numeric shrink-0 text-[11px] text-ink-faint">
                          {formatRate(rps)}/s
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>
    </div>
  );
}

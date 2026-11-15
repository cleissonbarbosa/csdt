import { SERVICE_TYPES, type Health, type InfrastructureNode } from '@aegis/contracts';
import { Crosshair, Search, X } from 'lucide-react';
import { useMemo } from 'react';

import { useThrottledSnapshot } from '@/app/hooks';
import { StatusDot } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Section';
import { sceneHandle } from '@/graphics/handle';
import { cn } from '@/lib/cn';
import { formatRate } from '@/lib/format';
import { HEALTH_COLOR, HEALTH_LABEL, SERVICE_TYPE } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';
import { filtersActive, useUi } from '@/stores/ui';

import { impactedSet, matchesFilters, nodeHealth } from './filtering';

const HEALTHS: Health[] = ['healthy', 'degraded', 'critical', 'down'];

function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-[3px] border px-1.5 text-[11px] transition-colors',
        active
          ? 'border-cyan/70 bg-cyan/15 text-ink'
          : 'border-line text-ink-dim hover:border-line-bright hover:text-ink',
      )}
    >
      {color && (
        <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      )}
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
      rows.sort((a, b) => a.node.tier - b.node.tier || a.node.name.localeCompare(b.node.name));
      const status = live?.regions.find((r) => r.id === region.id)?.health ?? 'healthy';
      return { region, rows, total, status };
    });
  }, [topology, snapshot, filters]);

  if (!topology) return <EmptyState title="Loading topology" />;
  const shown = groups.reduce((sum, g) => sum + g.rows.length, 0);
  const active = filtersActive(filters);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="explorer">
      <div className="space-y-2.5 border-b border-line/70 p-3">
        <div className="relative">
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
            className="h-8 w-full rounded-[3px] border border-line-bright bg-abyss pl-7 pr-2 text-xs text-ink placeholder:text-ink-faint"
          />
        </div>
        <fieldset>
          <legend className="eyebrow mb-1.5">Health</legend>
          <div className="flex flex-wrap gap-1">
            {HEALTHS.map((health) => (
              <Chip
                key={health}
                active={filters.health.includes(health)}
                onClick={() => ui.toggleHealth(health)}
                color={HEALTH_COLOR[health]}
              >
                {HEALTH_LABEL[health]}
              </Chip>
            ))}
            <Chip
              active={filters.impactedOnly}
              onClick={() => ui.setImpactedOnly(!filters.impactedOnly)}
            >
              Impacted
            </Chip>
          </div>
        </fieldset>
        <fieldset>
          <legend className="eyebrow mb-1.5">Service type</legend>
          <div className="flex flex-wrap gap-1">
            {typesPresent.map((type) => (
              <Chip
                key={type}
                active={filters.types.includes(type)}
                onClick={() => ui.toggleType(type)}
                color={SERVICE_TYPE[type].color}
              >
                {SERVICE_TYPE[type].short}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center justify-between">
          <p
            className="numeric text-[11px] text-ink-faint"
            aria-live="polite"
            data-testid="explorer-count"
          >
            {shown} of {topology.nodes.length} services
          </p>
          {active && (
            <button
              type="button"
              onClick={ui.clearFilters}
              className="inline-flex items-center gap-1 text-[11px] text-cyan hover:underline"
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
              <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line/60 bg-abyss px-3 py-1.5">
                <StatusDot
                  color={HEALTH_COLOR[status]}
                  pulse={status !== 'healthy'}
                  label={HEALTH_LABEL[status]}
                />
                <button
                  type="button"
                  aria-pressed={regionActive}
                  onClick={() => ui.toggleRegion(region.id)}
                  title={regionActive ? 'Show all regions' : 'Show only this region'}
                  className={cn(
                    'min-w-0 flex-1 truncate text-left font-display text-[11px] font-semibold uppercase tracking-[0.12em]',
                    regionActive ? 'text-cyan' : 'text-ink hover:text-cyan',
                  )}
                >
                  {region.name}
                </button>
                <span className="numeric text-[10px] text-ink-faint">
                  {rows.length}
                  {rows.length !== total && `/${total}`}
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
                        className={cn(
                          'flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left transition-colors',
                          selected
                            ? 'border-cyan bg-cyan/10'
                            : 'border-transparent hover:bg-raised/70',
                        )}
                      >
                        <StatusDot
                          color={HEALTH_COLOR[health]}
                          pulse={health === 'critical'}
                          label={HEALTH_LABEL[health]}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-ink">{node.name}</span>
                          <span className="block truncate text-[10px] text-ink-faint">
                            {SERVICE_TYPE[node.serviceType].label}
                          </span>
                        </span>
                        <span className="numeric shrink-0 text-[10px] text-ink-dim">
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

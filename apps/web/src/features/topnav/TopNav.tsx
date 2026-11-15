import { useQuery } from '@tanstack/react-query';
import {
  Box,
  CircleHelp,
  KeyRound,
  PanelLeft,
  PanelRight,
  Plug,
  Settings,
  Table2,
} from 'lucide-react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { Badge, SourceBadge, StatusDot } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { Logo } from './Logo';

function ConnectionHealth() {
  const connection = useTelemetry((state) => state.connection);
  const latency = useTelemetry((state) => state.latencyMs);
  const view = {
    open: { color: COLOR.healthy, label: 'Stream live', pulse: false },
    connecting: { color: COLOR.warning, label: 'Connecting', pulse: true },
    reconnecting: { color: COLOR.warning, label: 'Reconnecting', pulse: true },
    idle: { color: COLOR.down, label: 'Offline', pulse: false },
    closed: { color: COLOR.critical, label: 'Disconnected', pulse: false },
  }[connection];
  return (
    <div
      className="flex items-center gap-2 rounded-[3px] border border-line px-2 py-1"
      role="status"
      aria-live="polite"
      data-testid="connection-health"
      data-state={connection}
    >
      <StatusDot color={view.color} pulse={view.pulse} label={view.label} />
      <span className="hidden text-[11px] text-ink-dim sm:inline">{view.label}</span>
      {connection === 'open' && latency !== null && (
        <span className="numeric text-[10px] text-ink-faint" title="Stream round-trip time">
          {latency < 1 ? '<1' : latency.toFixed(0)} ms
        </span>
      )}
    </div>
  );
}

function ModeSwitch() {
  const { data: providers } = useQuery({
    queryKey: queryKeys.providers,
    queryFn: api.providers,
    refetchInterval: 5000,
  });
  const openPanel = useUi((state) => state.openPanel);
  const setPanel = useUi((state) => state.setPanel);
  const live =
    providers?.filter((p) => p.kind === 'live-adapter' && p.state === 'connected').length ?? 0;
  const connected = live > 0;
  return (
    <div
      className="flex items-center gap-1.5"
      data-testid="mode-switch"
      data-mode={connected ? 'connected' : 'demo'}
    >
      <Badge
        color={connected ? COLOR.healthy : COLOR.cyan}
        dot
        title={
          connected
            ? `${live} local integration${live === 1 ? '' : 's'} connected alongside the simulation.`
            : 'Everything shown is produced by the built-in simulation.'
        }
      >
        {connected ? `Connected · ${live} live` : 'Demo mode'}
      </Badge>
      <Button
        size="sm"
        variant="ghost"
        icon={<Plug size={13} aria-hidden />}
        pressed={openPanel === 'integrations'}
        onClick={() => setPanel('integrations')}
        aria-label="Integrations"
        data-testid="open-integrations"
      >
        <span className="hidden lg:inline">Integrations</span>
      </Button>
    </div>
  );
}

function TopologyPicker() {
  const { data } = useQuery({ queryKey: queryKeys.topologies, queryFn: api.topologies });
  const topology = useTelemetry((state) => state.topology);
  if (!data || !topology) return null;
  return (
    <Select
      label="Environment"
      hideLabel
      value={topology.id}
      onChange={(event) => void actions.selectTopology(event.target.value)}
      className="w-60"
      data-testid="topology-picker"
    >
      {data.topologies.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} · {t.nodeCount} services
        </option>
      ))}
    </Select>
  );
}

export function TopNav() {
  const topology = useTelemetry((state) => state.topology);
  const viewMode = useUi((state) => state.viewMode);
  const setViewMode = useUi((state) => state.setViewMode);
  const openPanel = useUi((state) => state.openPanel);
  const togglePanel = useUi((state) => state.togglePanel);
  const explorerOpen = useUi((state) => state.explorerOpen);
  const inspectorOpen = useUi((state) => state.inspectorOpen);
  const setExplorerOpen = useUi((state) => state.setExplorerOpen);
  const setInspectorOpen = useUi((state) => state.setInspectorOpen);

  return (
    <header className="panel relative z-30 flex h-12 shrink-0 items-center gap-3 border-x-0 border-t-0 px-3">
      <IconButton
        label={explorerOpen ? 'Hide explorer' : 'Show explorer'}
        pressed={explorerOpen}
        onClick={() => setExplorerOpen(!explorerOpen)}
      >
        <PanelLeft size={16} />
      </IconButton>
      <div className="flex items-center gap-2.5">
        <Logo />
        <div className="leading-none">
          <h1 className="font-display text-[15px] font-semibold tracking-[0.34em] text-ink">
            AEGIS
          </h1>
          <p className="mt-1 hidden text-[9px] uppercase tracking-[0.2em] text-ink-faint xl:block">
            Cloud security digital twin
          </p>
        </div>
      </div>

      <div className="mx-1 hidden h-6 w-px bg-line md:block" aria-hidden />
      <div className="hidden items-center gap-2 md:flex">
        <TopologyPicker />
        {topology && <SourceBadge source={topology.dataSource} />}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <ModeSwitch />
        <ConnectionHealth />
        <div className="mx-0.5 h-6 w-px bg-line" aria-hidden />
        <div
          role="radiogroup"
          aria-label="Topology view"
          className="flex overflow-hidden rounded-[3px] border border-line-bright"
        >
          {(
            [
              ['scene', '3D view', Box],
              ['table', 'Table view', Table2],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={viewMode === mode}
              aria-label={label}
              title={label}
              onClick={() => setViewMode(mode)}
              className={cn(
                'flex size-8 items-center justify-center border-r border-line-bright transition-colors last:border-r-0',
                viewMode === mode
                  ? 'bg-cyan/20 text-cyan'
                  : 'text-ink-dim hover:bg-raised hover:text-ink',
              )}
            >
              <Icon size={15} aria-hidden />
            </button>
          ))}
        </div>
        <IconButton
          label="Authorization explorer"
          pressed={openPanel === 'authorization'}
          onClick={() => togglePanel('authorization')}
        >
          <KeyRound size={16} />
        </IconButton>
        <IconButton
          label="Settings"
          pressed={openPanel === 'settings'}
          onClick={() => togglePanel('settings')}
        >
          <Settings size={16} />
        </IconButton>
        <IconButton
          label="Help and legend"
          pressed={openPanel === 'help'}
          onClick={() => togglePanel('help')}
        >
          <CircleHelp size={16} />
        </IconButton>
        <IconButton
          label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          pressed={inspectorOpen}
          onClick={() => setInspectorOpen(!inspectorOpen)}
        >
          <PanelRight size={16} />
        </IconButton>
      </div>
    </header>
  );
}

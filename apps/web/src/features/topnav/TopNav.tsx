import type { Health } from '@aegis/contracts';
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
import { HealthGlyph } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Deviations } from '@/features/hud/Hud';
import { cn } from '@/lib/cn';
import { COLOR, DATA_SOURCE_HINT, DATA_SOURCE_LABEL, HEALTH_COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { Logo } from './Logo';

/**
 * The state of the platform in one sentence.
 *
 * While everything is normal it says so, quietly. When something is wrong it
 * names it, in the colour of its severity, and leads to the details: the
 * cockpit's master caution, then the system, then the fault. A new incident
 * blinks until the viewer has looked at it.
 */
function PlatformStatus() {
  const global = useTelemetry((state) => state.snapshot?.global);
  const incident = useTelemetry((state) => state.snapshot?.incident ?? null);
  const topology = useTelemetry((state) => state.topology);
  const acknowledged = useUi((state) => state.acknowledgedIncidentId);
  const { data: scenarios } = useQuery({ queryKey: queryKeys.scenarios, queryFn: api.scenarios });
  if (!global || !topology) return null;

  const unhealthy = global.health.degraded + global.health.critical + global.health.down;
  const total = unhealthy + global.health.healthy;
  const worst: Health =
    global.health.down > 0
      ? 'down'
      : global.health.critical > 0
        ? 'critical'
        : global.health.degraded > 0
          ? 'degraded'
          : 'healthy';

  let sentence = `${total} services, all normal`;
  let level: Health = 'healthy';
  if (incident && incident.status !== 'resolved') {
    const scenario = scenarios?.scenarios.find((s) => s.id === incident.scenarioId);
    const affected = incident.impactedNodeIds.length;
    // Name the incident and where it stands; the count says how far it reaches.
    sentence = `${scenario?.name ?? 'Incident'}: ${incident.phaseName.toLowerCase()}, ${affected} service${affected === 1 ? '' : 's'} affected`;
    level = worst === 'healthy' ? 'degraded' : worst;
  } else if (unhealthy > 0) {
    sentence = `${unhealthy} of ${total} services not normal`;
    level = worst;
  }
  const abnormal = level !== 'healthy';
  const fresh = incident !== null && incident.status !== 'resolved' && incident.id !== acknowledged;

  const phase = incident && incident.status !== 'resolved' ? incident.phaseName : '';
  return (
    // The live region wraps the button, so the sentence is announced when it
    // changes and the control keeps its own role.
    <div role="status" aria-live="polite" className="min-w-0">
      <button
        type="button"
        className={cn(
          'flex min-w-0 max-w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left text-xs transition-colors hover:bg-raised',
          abnormal ? 'font-bold' : 'text-ink-dim hover:text-ink',
        )}
        style={abnormal ? { color: HEALTH_COLOR[level] } : undefined}
        title={abnormal ? 'Show the incident' : 'Show the platform overview'}
        onClick={() => {
          const ui = useUi.getState();
          if (abnormal) {
            ui.acknowledgeIncident(incident?.id ?? null);
            ui.setLeftTab('incidents');
          } else {
            // The overview is the inspector with nothing selected.
            ui.select(null);
            ui.setPanel(null);
            ui.setInspectorOpen(true);
          }
        }}
        data-testid="platform-status"
        data-level={level}
        data-incidents={global.activeIncidents}
      >
        {/* Keyed by what happened, not by the counts, so the sentence is
          replaced with a movement when the situation changes and simply
          updates while it develops. */}
        <span key={`${level}:${phase}`} className="flex min-w-0 animate-swap items-center gap-2">
          {abnormal && (
            <span className={cn('inline-flex', fresh && 'animate-attention')}>
              <HealthGlyph health={level} size={10} />
            </span>
          )}
          <span className="truncate">{sentence}</span>
        </span>
      </button>
    </div>
  );
}

/** Says nothing while the stream is healthy; speaks up when it is not. */
function ConnectionHealth() {
  const connection = useTelemetry((state) => state.connection);
  const view = {
    open: { label: 'Stream live', tone: undefined },
    connecting: { label: 'Connecting', tone: COLOR.warning },
    reconnecting: { label: 'Reconnecting', tone: COLOR.warning },
    idle: { label: 'Offline', tone: COLOR.warning },
    closed: { label: 'Disconnected', tone: COLOR.critical },
  }[connection];
  return (
    <span
      className={cn('text-[11px]', view.tone ? 'font-bold' : 'sr-only')}
      style={{ color: view.tone }}
      role="status"
      aria-live="polite"
      data-testid="connection-health"
      data-state={connection}
    >
      {view.label}
    </span>
  );
}

/**
 * Where the data comes from, in words: simulation, and any live adapters.
 * The statement is also the way to the integrations that could change it.
 */
function Provenance() {
  const topology = useTelemetry((state) => state.topology);
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
  const hint = connected
    ? `${live} local integration${live === 1 ? '' : 's'} connected alongside the simulation.`
    : (topology && DATA_SOURCE_HINT[topology.dataSource]) ||
      'Everything shown is produced by the built-in simulation.';
  return (
    <div data-testid="mode-switch" data-mode={connected ? 'connected' : 'demo'}>
      <Button
        size="sm"
        variant="ghost"
        icon={<Plug size={13} aria-hidden />}
        pressed={openPanel === 'integrations'}
        onClick={() => setPanel('integrations')}
        aria-label="Integrations"
        title={`${hint} Open integrations.`}
        data-testid="open-integrations"
      >
        <span className="hidden lg:inline">
          {connected
            ? `Simulation with ${live} live integration${live === 1 ? '' : 's'}`
            : `${topology ? DATA_SOURCE_LABEL[topology.dataSource] : 'Synthetic'} data, simulated`}
        </span>
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
      className="w-44"
      data-testid="topology-picker"
    >
      {data.topologies.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </Select>
  );
}

export function TopNav() {
  const viewMode = useUi((state) => state.viewMode);
  const setViewMode = useUi((state) => state.setViewMode);
  const openPanel = useUi((state) => state.openPanel);
  const togglePanel = useUi((state) => state.togglePanel);
  const explorerOpen = useUi((state) => state.explorerOpen);
  const inspectorOpen = useUi((state) => state.inspectorOpen);
  const setExplorerOpen = useUi((state) => state.setExplorerOpen);
  const setInspectorOpen = useUi((state) => state.setInspectorOpen);

  return (
    // On a narrow screen the controls drop to a second row, so the sentence
    // that says how the platform is keeps its place.
    <header className="relative z-30 flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 border-b border-line bg-paper px-2">
      <IconButton
        label={explorerOpen ? 'Hide explorer' : 'Show explorer'}
        pressed={explorerOpen}
        onClick={() => setExplorerOpen(!explorerOpen)}
        data-testid="toggle-explorer"
      >
        <PanelLeft size={16} />
      </IconButton>
      <div className="flex items-center gap-2 text-ink">
        <Logo />
        <h1 className="text-sm font-bold">AEGIS</h1>
      </div>

      <div className="hidden md:block">
        <TopologyPicker />
      </div>
      <div className="flex min-w-0 flex-[1_1_11rem] items-center gap-5">
        <PlatformStatus />
        <div className="hidden shrink-0 md:block">
          <Deviations />
        </div>
      </div>

      <div className="ml-auto flex h-11 shrink-0 items-center gap-1.5">
        <ConnectionHealth />
        <button
          type="button"
          onClick={() => useUi.getState().setCommandOpen(true)}
          className="hidden h-7 items-center gap-2 rounded-[3px] border border-line px-2 text-[11px] text-ink-faint transition-colors hover:border-line-strong hover:text-ink xl:flex"
          aria-label="Go to anything"
          data-testid="open-command"
        >
          Go to
          <kbd className="code text-[10px]">Ctrl K</kbd>
        </button>
        <Provenance />
        <div
          role="radiogroup"
          aria-label="Topology view"
          className="flex overflow-hidden rounded-[3px] border border-line-strong"
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
                'flex size-7 items-center justify-center border-r border-line-strong transition-colors last:border-r-0',
                viewMode === mode
                  ? 'bg-accent text-on-accent'
                  : 'bg-paper text-ink-dim hover:bg-raised hover:text-ink',
              )}
            >
              <Icon size={14} aria-hidden />
            </button>
          ))}
        </div>
        <IconButton
          label="Authorization explorer"
          pressed={openPanel === 'authorization'}
          onClick={() => togglePanel('authorization')}
          data-testid="open-authorization"
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
          data-testid="toggle-inspector"
        >
          <PanelRight size={16} />
        </IconButton>
      </div>
    </header>
  );
}

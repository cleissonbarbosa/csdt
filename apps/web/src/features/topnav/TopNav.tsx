import type { DataSource, Health } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Box,
  CircleHelp,
  Ellipsis,
  Flag,
  FolderOpen,
  GitCompareArrows,
  Grid3x3,
  History,
  KeyRound,
  List,
  Play,
  Search,
  Settings,
  Share2,
  Table2,
} from 'lucide-react';

import { actions } from '@/app/actions';
import { HOST } from '@/app/host';
import { queryKeys } from '@/app/queryClient';
import { HealthGlyph } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Menu } from '@/components/ui/Menu';
import { Deviations } from '@/features/hud/Hud';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import { COLOR, DATA_SOURCE_HINT, HEALTH_COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useGuide } from '@/stores/guide';
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
  const faults = useTelemetry((state) => state.snapshot?.faults.length ?? 0);
  const topology = useTelemetry((state) => state.topology);
  const acknowledged = useUi((state) => state.acknowledgedIncidentId);
  // The snapshot is of the moment the cursor is at. In the history that is
  // not now, and the sentence has to say which moment it speaks of: "all
  // normal" read as the present while an incident ran at the head.
  const replayedAt = useTelemetry((state) =>
    state.playback?.mode === 'replay' ? formatClock(state.playback.virtualTimeMs) : null,
  );
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

  // A fault placed by hand may not have moved anything out of range yet;
  // it is said anyway, so "all normal" is never the whole story.
  let sentence =
    faults === 0
      ? t('{total} services, all normal', { total })
      : t(
          faults === 1
            ? '{total} services, all normal; {faults} fault placed by hand'
            : '{total} services, all normal; {faults} faults placed by hand',
          { total, faults },
        );
  let level: Health = 'healthy';
  if (incident && incident.status !== 'resolved') {
    const scenario = scenarios?.scenarios.find((s) => s.id === incident.scenarioId);
    const affected = incident.impactedNodeIds.length;
    // Name the incident and where it stands; the count says how far it reaches.
    sentence = t(
      affected === 1
        ? '{incident}: {phase}, {affected} service affected'
        : '{incident}: {phase}, {affected} services affected',
      {
        incident: scenario?.name ?? t('Incident'),
        phase: incident.phaseName.toLowerCase(),
        affected,
      },
    );
    level = worst === 'healthy' ? 'degraded' : worst;
  } else if (unhealthy > 0) {
    sentence = t('{unhealthy} of {total} services not normal', { unhealthy, total });
    level = worst;
  }
  if (replayedAt !== null) {
    sentence = t('At {moment}, in history: {sentence}', { moment: replayedAt, sentence });
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
          'flex min-w-0 max-w-full items-center gap-2 rounded-control px-1.5 py-1 text-left text-xs transition-colors hover:bg-raised',
          abnormal ? 'font-bold' : 'text-ink-faint hover:text-ink',
        )}
        style={abnormal ? { color: HEALTH_COLOR[level] } : undefined}
        // The sentence is cut where the bar is short of room; pointing at it
        // says all of it, and then what the button does.
        title={`${sentence}. ${
          abnormal
            ? t('Show the incident')
            : faults > 0
              ? t('Show what was placed by hand')
              : t('Show the platform overview')
        }`}
        onClick={() => {
          const ui = useUi.getState();
          if (incident && incident.status !== 'resolved') {
            followIncident(incident.id);
          } else if (abnormal || faults > 0) {
            if (abnormal) ui.acknowledgeIncident(incident?.id ?? null);
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
        data-faults={faults}
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
    open: { label: t('Stream connected'), tone: undefined },
    connecting: { label: HOST.connecting, tone: COLOR.warning },
    reconnecting: { label: HOST.reconnecting, tone: COLOR.warning },
    idle: { label: t('Offline'), tone: COLOR.warning },
    closed: { label: t('Disconnected'), tone: COLOR.critical },
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
 * Where the data comes from, in a word, on every screen: this is a
 * simulation. It is also the way to the integrations that could add to it.
 */ /** What the bar says the figures are, by where they come from. */
const SIMULATED_FROM: Record<DataSource, string> = {
  synthetic: t('Simulated, synthetic data'),
  recording: t('Simulated, recording data'),
  live: t('Simulated, live data'),
};

function Provenance() {
  const topology = useTelemetry((state) => state.topology);
  const { data: providers } = useQuery({
    queryKey: queryKeys.providers,
    queryFn: api.providers,
    refetchInterval: 5000,
  });
  const setPanel = useUi((state) => state.setPanel);
  const live =
    providers?.filter((p) => p.kind === 'live-adapter' && p.state === 'connected').length ?? 0;
  const connected = live > 0;
  const hint = connected
    ? t(
        live === 1
          ? '{n} local integration connected alongside the simulation.'
          : '{n} local integrations connected alongside the simulation.',
        { n: live },
      )
    : !topology || topology.dataSource === 'synthetic'
      ? HOST.synthetic
      : DATA_SOURCE_HINT[topology.dataSource];
  return (
    <div data-testid="mode-switch" data-mode={connected ? 'connected' : 'demo'}>
      <button
        type="button"
        onClick={() => setPanel('integrations')}
        aria-label={t('Simulated: {hint} Open integrations.', { hint })}
        title={t('{hint} Open integrations.', { hint })}
        data-testid="open-integrations"
        className="inline-flex h-7 items-center gap-2 rounded-control bg-sunken px-2.5 text-[11px] text-ink-dim transition-colors hover:text-ink"
      >
        {/* A mark, not a lamp: it has no state to show. */}
        <span aria-hidden className="size-1.5 rounded-full border border-current" />
        <span className="max-2xl:hidden">
          {connected
            ? t(
                live === 1
                  ? 'Simulated, with {n} live integration'
                  : 'Simulated, with {n} live integrations',
                { n: live },
              )
            : SIMULATED_FROM[topology?.dataSource ?? 'synthetic']}
        </span>
        <span className="2xl:hidden">{t('Simulated')}</span>
      </button>
    </div>
  );
}

function TopologyPicker() {
  const { data } = useQuery({ queryKey: queryKeys.topologies, queryFn: api.topologies });
  const topology = useTelemetry((state) => state.topology);
  if (!data || !topology) return null;
  return (
    <Select
      label={t('Environment')}
      hideLabel
      quiet
      value={topology.id}
      onChange={(event) => void actions.selectTopology(event.target.value)}
      className="w-40"
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

/**
 * Brings the incident under way in front of the viewer: its phases, at the
 * head of the incidents, whatever that panel was showing. The button used
 * to close the panel when it was open, which took the incident away from
 * someone who had asked to follow it. A summary of this same incident that
 * is being read is left where it is.
 */
function followIncident(incidentId: string): void {
  const ui = useUi.getState();
  ui.acknowledgeIncident(incidentId);
  ui.inspectEvent(null);
  if (ui.inspectedIncidentId !== incidentId) ui.inspectIncident(null);
  ui.setLeftTab('incidents');
  requestAnimationFrame(() => {
    const list = document.querySelector('[data-testid="scenario-console"]');
    if (list) list.scrollTop = 0;
  });
}

/**
 * The bar: what this is, how it is, and the things to do first: find
 * something, ask Cedar, follow an incident. The rest of the application is
 * one step away, in the menu at its end and in the model itself.
 */
export function TopNav() {
  const viewMode = useUi((state) => state.viewMode);
  const incidentsOpen = useUi((state) => state.explorerOpen && state.leftTab === 'incidents');
  const timelineOpen = useUi((state) => state.timelineOpen);
  const tracerOpen = useUi((state) => state.inspectorOpen && state.openPanel === 'authorization');
  const guideOpen = useGuide((state) => state.open);
  const incidentActive = useTelemetry((state) => {
    const incident = state.snapshot?.incident;
    return incident != null && incident.status !== 'resolved';
  });

  return (
    // On a narrow screen the controls drop to a second row, so the sentence
    // that says how the platform is keeps its place.
    <header className="relative z-30 flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 border-b border-line bg-plate px-3">
      <div className="flex items-center gap-2 text-ink">
        <Logo />
        <h1 className="text-sm font-bold">AEGIS</h1>
      </div>
      <span aria-hidden className="h-4 w-px bg-line-strong max-md:hidden" />
      <div className="hidden md:block">
        <TopologyPicker />
      </div>
      {/* The sentence comes first. The instruments take what is left of the
          row, and at least the room of one: where the two do not both fit,
          the sentence is the one that is cut, and says the rest when
          pointed at. */}
      <div className="flex min-w-0 flex-[1_1_11rem] items-center gap-5">
        <PlatformStatus />
        <Deviations className="hidden flex-1 basis-0 md:flex" />
      </div>

      <div className="ml-auto flex h-12 shrink-0 items-center gap-2">
        <ConnectionHealth />
        <Provenance />
        <button
          type="button"
          onClick={() => useUi.getState().setCommandOpen(true)}
          className="inline-flex h-8 items-center gap-2 rounded-control border border-line bg-paper px-2.5 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
          aria-label={t('Search services and commands')}
          data-testid="open-command"
        >
          <Search size={14} aria-hidden />
          <span className="max-lg:hidden">{t('Search')}</span>
          <kbd className="code text-[10px] text-ink-faint max-2xl:hidden">Ctrl K</kbd>
        </button>
        {/* What makes this a security model, not only an operations one:
            on the bar itself, a step from anywhere. On a phone too, where
            it is its icon: the menu at the end is where it was overlooked. */}
        <Button
          icon={<KeyRound size={13} aria-hidden />}
          aria-expanded={tracerOpen}
          aria-label={t('Test an authorization with Cedar')}
          title={t('Ask Cedar who may do what, and follow the request across the model')}
          onClick={() => useUi.getState().togglePanel('authorization')}
          data-testid="open-tracer"
          className="max-lg:w-8 max-lg:px-0"
        >
          <span className="max-lg:hidden">{t('Test an authorization')}</span>
        </Button>
        <Button
          variant="primary"
          icon={<Play size={13} aria-hidden />}
          // With an incident under way the button does what it says and
          // never closes what it leads to, so it has nothing to expand.
          aria-expanded={incidentActive ? undefined : incidentsOpen}
          onClick={() => {
            const ui = useUi.getState();
            const incident = useTelemetry.getState().snapshot?.incident;
            if (incident && incident.status !== 'resolved') {
              followIncident(incident.id);
            } else if (incidentsOpen) ui.setExplorerOpen(false);
            else ui.setLeftTab('incidents');
          }}
          data-testid="explore-incident"
        >
          {/* A phone's bar has room for the last word, which is the one
              that says what the button is about. */}
          <span>
            <span className="max-sm:hidden">
              {incidentActive ? t('Follow the#incident') : t('Explore an#incident')}{' '}
            </span>
            <span className="max-sm:capitalize">{t('incident')}</span>
          </span>
        </Button>
        <Menu
          label={t('More')}
          testId="open-menu"
          icon={<Ellipsis size={17} />}
          items={[
            {
              id: 'trace',
              label: t('Trace a request through Cedar'),
              icon: <KeyRound size={14} />,
              onSelect: () => useUi.getState().togglePanel('authorization'),
            },
            {
              id: 'matrix',
              label: t('Who may do what'),
              icon: <Grid3x3 size={14} />,
              onSelect: () => useUi.getState().setPanel('matrix'),
            },
            {
              id: 'experiment',
              label: t('Compare an intervention'),
              icon: <GitCompareArrows size={14} />,
              onSelect: () => useUi.getState().openExperiment(),
            },
            {
              id: 'guide',
              label: t('Guided challenges'),
              icon: <Flag size={14} />,
              checked: guideOpen,
              onSelect: () => useGuide.getState().setOpen(!guideOpen),
            },
            {
              id: 'services',
              label: t('List every service'),
              hint: '/',
              icon: <List size={14} />,
              onSelect: () => useUi.getState().setLeftTab('explorer'),
            },
            {
              id: 'overview',
              label: t('Platform signals'),
              icon: <Activity size={14} />,
              onSelect: () => {
                const ui = useUi.getState();
                ui.select(null);
                ui.setPanel(null);
                ui.setInspectorOpen(true);
              },
            },
            {
              id: 'timeline',
              label: t('Timeline and playback'),
              icon: <History size={14} />,
              checked: timelineOpen,
              onSelect: () => useUi.getState().setTimelineOpen(!timelineOpen),
            },
            {
              id: 'view',
              label: viewMode === 'scene' ? t('Table view') : t('3D model'),
              hint: 'T',
              icon: viewMode === 'scene' ? <Table2 size={14} /> : <Box size={14} />,
              onSelect: () =>
                useUi.getState().setViewMode(viewMode === 'scene' ? 'table' : 'scene'),
            },
            {
              id: 'session',
              label: t('Save or share this session'),
              icon: <Share2 size={14} />,
              onSelect: () => useUi.getState().setPanel('session'),
            },
            {
              id: 'workspace',
              label: t('Import or export files'),
              icon: <FolderOpen size={14} />,
              onSelect: () => useUi.getState().setPanel('workspace'),
            },
            {
              id: 'settings',
              label: t('Settings'),
              icon: <Settings size={14} />,
              onSelect: () => useUi.getState().setPanel('settings'),
            },
            {
              id: 'help',
              label: t('Help and legend'),
              hint: '?',
              icon: <CircleHelp size={14} />,
              onSelect: () => useUi.getState().setPanel('help'),
            },
          ]}
        />
      </div>
    </header>
  );
}

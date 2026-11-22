import type { DataSource, Health } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  Box,
  CircleHelp,
  Ellipsis,
  FileClock,
  Flag,
  FolderOpen,
  Gauge,
  GitCompareArrows,
  Grid3x3,
  History,
  KeyRound,
  List,
  PencilRuler,
  Play,
  Search,
  Settings,
  Share2,
  SquarePlus,
  Table2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { actions } from '@/app/actions';
import { leaveCapture, openCapture } from '@/app/captureUrl';
import { HOST } from '@/app/host';
import { queryKeys } from '@/app/queryClient';
import { HealthGlyph } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Menu } from '@/components/ui/Menu';
import { BUNDLED } from '@/features/capture/bundled';
import { isReport } from '@/features/capture/capture';
import { draftOf } from '@/features/capture/draft';
import { draftNotes, draftRefusal } from '@/features/capture/draftNotes';
import { provenanceOf } from '@/features/capture/CaptureCard';
import { CaptureStatus } from '@/features/capture/CaptureStatus';
import { EditorActions, EditorStatus, EditorTabs } from '@/features/editor/EditorBar';
import {
  IncidentActions,
  IncidentStatus,
  useIncidentVerdict,
} from '@/features/editor/incident/IncidentBar';
import { editBlankPlatform, editPlatformInUse } from '@/features/editor/open';
import { Deviations } from '@/features/hud/Hud';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import { COLOR, DATA_SOURCE_HINT, HEALTH_COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { selectOpen, useCapture } from '@/stores/capture';
import { selectEditing, useEditor } from '@/stores/editor';
import { useGuide } from '@/stores/guide';
import { useNotices } from '@/stores/notices';
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
 * What the bar says the figures are, by where they come from. A recording
 * is an incident capture, which is never simulated: the simulation never
 * produces one, and its own chip takes this one's place while one is open.
 */
const SIMULATED_FROM: Record<DataSource, string> = {
  synthetic: t('Simulated, synthetic data'),
  recording: t('Captured, not simulated'),
  live: t('Simulated, live data'),
};

/**
 * Where the data comes from, in a word, on every screen: this is a
 * simulation. It is also the way to the integrations that could add to it.
 */
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
 * The bar itself: the name of the application, then whatever the mode it is
 * in puts after it. On a narrow screen the controls drop to a second row, so
 * the sentence that says how things are keeps its place.
 */
function Bar({ children }: { children: ReactNode }) {
  return (
    <header className="relative z-30 flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 border-b border-line bg-plate px-3">
      <div className="flex items-center gap-2 text-ink">
        <Logo />
        <h1 className="text-sm font-bold">AEGIS</h1>
      </div>
      <span aria-hidden className="h-4 w-px bg-line-strong max-md:hidden" />
      {children}
    </header>
  );
}

/** The menu's way to an incident capture, in either mode. */
const openCaptures = () => useUi.getState().setPanel('capture');

/**
 * Writes a platform file from the capture on show and hands it to the import
 * dialog, staged. The capture is left first: from here on it is a file for
 * the simulation, checked and applied like any other, or not at all.
 */
const draftPlatform = () => {
  const { capture, id } = useCapture.getState();
  if (!capture) return;
  const draft = draftOf(capture, id ?? 'capture');
  if ('refused' in draft) {
    useNotices.getState().push('error', draftRefusal(draft.refused));
    return;
  }
  const topology = JSON.parse(draft.files[0]?.text ?? '{}') as {
    nodes?: { type: string; baseRps?: number }[];
  };
  const demand = topology.nodes?.find((node) => node.type === 'external-client')?.baseRps ?? null;
  leaveCapture();
  useUi.getState().offerImport(draft.files, draftNotes(capture, draft, demand));
};

/**
 * The bar: what this is, how it is, and the things to do first: find
 * something, ask Cedar, follow an incident. The rest of the application is
 * one step away, in the menu at its end and in the model itself. While an
 * incident capture is open the bar is the capture's instead.
 */
export function TopNav() {
  const captured = useCapture(selectOpen);
  const editing = useEditor(selectEditing);
  return captured ? <CaptureNav /> : editing ? <EditorNav /> : <SimulationNav />;
}

/** The bar while a platform is drawn: what it is, what the engine makes of it, what to do with it. */
function EditorNav() {
  const tab = useEditor((state) => state.tab);
  // The tabs stay where they are when one is chosen, and the keyboard with them.
  return (
    <Bar>
      <EditorTabs />
      {tab === 'incident' ? <IncidentNav /> : <PlatformNav />}
    </Bar>
  );
}

function PlatformNav() {
  return (
    <>
      <EditorStatus />
      <EditorActions />
    </>
  );
}

function IncidentNav() {
  const verdict = useIncidentVerdict();
  return (
    <>
      <IncidentStatus verdict={verdict} />
      <IncidentActions runs={verdict.runs} />
    </>
  );
}

function SimulationNav() {
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
    <Bar>
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
        {/* Grouped by what the viewer came to do: the three things the card
            of a first visit offers, which says they are all in this menu,
            then a platform of their own and its files. Settings, help and
            the challenges, which serve all of it, run along the foot. */}
        <Menu
          label={t('More')}
          testId="open-menu"
          icon={<Ellipsis size={17} />}
          layout="columns"
          sections={[
            {
              id: 'understand',
              label: t('Understand the platform'),
              items: [
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
                  id: 'services',
                  label: t('List every service'),
                  hint: '/',
                  icon: <List size={14} />,
                  onSelect: () => useUi.getState().setLeftTab('explorer'),
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
                  id: 'limits',
                  label: t('Find where the platform gives'),
                  icon: <Gauge size={14} />,
                  onSelect: () => useUi.getState().setPanel('limits'),
                },
              ],
            },
            {
              id: 'investigate',
              label: t('Investigate a failure'),
              items: [
                {
                  id: 'timeline',
                  label: t('Timeline and playback'),
                  icon: <History size={14} />,
                  checked: timelineOpen,
                  onSelect: () => useUi.getState().setTimelineOpen(!timelineOpen),
                },
                {
                  id: 'experiment',
                  label: t('Compare an intervention'),
                  icon: <GitCompareArrows size={14} />,
                  onSelect: () => useUi.getState().openExperiment(),
                },
                {
                  // A real incident, read in this tab: not the simulation's
                  // timeline, so not its clock either.
                  id: 'capture',
                  label: t('Open an incident capture'),
                  icon: <FileClock size={14} />,
                  onSelect: openCaptures,
                },
              ],
            },
            {
              id: 'authorization',
              label: t('Test an authorization'),
              items: [
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
              ],
            },
            {
              id: 'files',
              label: t('Platform and files'),
              items: [
                {
                  // Drawn on the model itself, as a mode of the same shell.
                  id: 'edit-platform',
                  label: t('Edit this platform'),
                  icon: <PencilRuler size={14} />,
                  onSelect: () => void editPlatformInUse(),
                },
                {
                  id: 'draw-platform',
                  label: t('Draw a new platform'),
                  icon: <SquarePlus size={14} />,
                  onSelect: () => void editBlankPlatform(),
                },
                {
                  id: 'workspace',
                  label: t('Import or export files'),
                  icon: <FolderOpen size={14} />,
                  onSelect: () => useUi.getState().setPanel('workspace'),
                },
                {
                  id: 'session',
                  label: t('Save or share this session'),
                  icon: <Share2 size={14} />,
                  onSelect: () => useUi.getState().setPanel('session'),
                },
              ],
            },
            {
              id: 'general',
              items: [
                {
                  id: 'guide',
                  label: t('Guided challenges'),
                  icon: <Flag size={14} />,
                  checked: guideOpen,
                  onSelect: () => useGuide.getState().setOpen(!guideOpen),
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
              ],
            },
          ]}
        />
      </div>
    </Bar>
  );
}

/** What the picker calls a capture read from a file. */
const FROM_FILE = 'file';

/**
 * The captures there are to choose from, in the place where the simulation
 * chooses its environment: the ones that come with AEGIS, and the file that
 * is open, if one is. Another file is opened from the menu's dialog.
 */
function CapturePicker() {
  const id = useCapture((state) => state.id);
  const fileName = useCapture((state) => state.fileName);
  return (
    <Select
      label={t('Incident capture')}
      hideLabel
      quiet
      value={id ?? FROM_FILE}
      onChange={(event) => {
        const next = event.target.value;
        // One that cannot be opened leaves the open one where it is, and
        // says why in a notice (`useCaptureFailures` in `App.tsx`).
        if (next !== FROM_FILE) void openCapture(next);
      }}
      // A capture's title is shown as written, whole: the picker is as wide
      // as it, and the sentence beside it gives way first.
      fit
      className="max-w-[24rem]"
      data-testid="capture-picker"
    >
      {BUNDLED.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.title}
        </option>
      ))}
      {id === null && fileName !== null && <option value={FROM_FILE}>{fileName}</option>}
    </Select>
  );
}

/**
 * Where a capture's figures come from, in the place of the simulation's
 * provenance: captured, or from the provider's report, and never simulated.
 * It is the way to what the capture is (its source, window and notes).
 * Where the picker is not on the bar (a phone or a tablet, short of room
 * for a title whole), it carries the capture's title.
 */
function CaptureChip() {
  const capture = useCapture((state) => state.capture);
  const open = useCapture((state) => state.detailsOpen);
  if (!capture) return null;
  const long = provenanceOf(capture);
  const short = isReport(capture) ? t('Reported') : t('Captured');
  return (
    <button
      type="button"
      onClick={() => useCapture.getState().setDetails(!open)}
      aria-expanded={open}
      aria-label={t('{provenance}: {title}. Show what the capture is.', {
        provenance: long,
        title: capture.title,
      })}
      title={t('{provenance}: {title}. Show what the capture is.', {
        provenance: long,
        title: capture.title,
      })}
      data-testid="capture-chip"
      data-mode="capture"
      data-kind={capture.source.kind}
      className="inline-flex h-7 min-w-0 items-center gap-2 rounded-control bg-sunken px-2.5 text-[11px] text-ink-dim transition-colors hover:text-ink"
    >
      {/* A mark, not a lamp: it has no state to show. */}
      <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-current" />
      <span className="max-2xl:hidden">{long}</span>
      <span className="shrink-0 2xl:hidden">{short}</span>
      <span className="min-w-0 max-w-[8rem] truncate text-ink xl:hidden">{capture.title}</span>
    </button>
  );
}

/**
 * The bar while an incident capture is open. It says what the capture says
 * at the cursor and where it comes from, and leads to its services and
 * events and back to the simulation. Nothing on it belongs to the
 * simulation, which goes on untouched behind it: no instruments, no stream,
 * no search, no Cedar, no incidents.
 */
function CaptureNav() {
  const viewMode = useUi((state) => state.viewMode);
  const listOpen = useCapture((state) => state.listOpen);
  return (
    <Bar>
      {/* Where there is room for a title whole; below that the chip carries it. */}
      <div className="hidden shrink-0 xl:block">
        <CapturePicker />
      </div>
      <div className="flex min-w-0 flex-[1_1_11rem] items-center gap-5">
        <CaptureStatus />
      </div>

      <div className="ml-auto flex h-12 min-w-0 items-center gap-2">
        <CaptureChip />
        <Button
          icon={<List size={13} aria-hidden />}
          aria-expanded={listOpen}
          aria-label={t('Services and events')}
          onClick={() => useCapture.getState().setList(!listOpen)}
          data-testid="capture-list"
          className="max-lg:w-8 max-lg:px-0"
        >
          <span className="max-lg:hidden">{t('Services and events')}</span>
        </Button>
        <Button
          variant="primary"
          icon={<ArrowLeft size={13} aria-hidden />}
          aria-label={t('Back to the simulation')}
          onClick={leaveCapture}
          data-testid="capture-back"
        >
          <span className="max-sm:hidden">{t('Back to the simulation')}</span>
          <span className="sm:hidden">{t('Back')}</span>
        </Button>
        {/* Short enough to need no headings: the view, the capture and the
            way out of it, then what serves both modes. */}
        <Menu
          label={t('More')}
          testId="open-menu"
          icon={<Ellipsis size={17} />}
          sections={[
            {
              id: 'view',
              items: [
                {
                  id: 'view',
                  label: viewMode === 'scene' ? t('Table view') : t('3D model'),
                  hint: 'T',
                  icon: viewMode === 'scene' ? <Table2 size={14} /> : <Box size={14} />,
                  onSelect: () =>
                    useUi.getState().setViewMode(viewMode === 'scene' ? 'table' : 'scene'),
                },
              ],
            },
            {
              id: 'capture',
              items: [
                {
                  id: 'capture',
                  label: t('Open another capture'),
                  icon: <FileClock size={14} />,
                  onSelect: openCaptures,
                },
                {
                  // Leaves the capture: what it becomes is a file for the simulation.
                  id: 'draft',
                  label: t('Draft a platform from this capture'),
                  icon: <FolderOpen size={14} />,
                  onSelect: draftPlatform,
                },
                {
                  id: 'back',
                  label: t('Back to the simulation'),
                  icon: <ArrowLeft size={14} />,
                  onSelect: leaveCapture,
                },
              ],
            },
            {
              id: 'general',
              items: [
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
              ],
            },
          ]}
        />
      </div>
    </Bar>
  );
}

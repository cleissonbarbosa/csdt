import {
  PLAYBACK_SPEEDS,
  SEVERITY_ORDER,
  type ActiveFault,
  type Health,
  type Incident,
  type PlaybackSpeed,
  type Scenario,
  type SecurityEvent,
  type Severity,
} from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  GitCompareArrows,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Square,
  X,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { actions } from '@/app/actions';
import { HOST } from '@/app/host';
import { queryKeys } from '@/app/queryClient';
import { HealthGlyph, SeverityBadge, SourceBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented, Select } from '@/components/ui/Field';
import { EmptyState, Section } from '@/components/ui/Section';
import { ServiceName } from '@/components/ui/ServiceName';
import { cn } from '@/lib/cn';
import { describeFault, faultEffect, faultTarget } from '@/lib/faults';
import { formatClock, titleCase } from '@/lib/format';
import { COLOR, SEVERITY_LABEL } from '@/lib/palette';
import { api } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { foldEvents } from './events';
import {
  IncidentSummary,
  PhaseExplanation,
  TransitionWhy,
  useIncidentReport,
} from './IncidentReport';

type IncidentStatus = Incident['status'];

const STATUS_LABEL: Record<IncidentStatus, string> = {
  active: 'Active',
  mitigating: 'Mitigating',
  recovering: 'Recovering',
  resolved: 'Resolved',
};

/** An incident is a deviation until it is resolved; how severe, by stage. */
const STATUS_TONE: Record<IncidentStatus, string | undefined> = {
  active: COLOR.critical,
  mitigating: COLOR.warning,
  recovering: COLOR.warning,
  resolved: undefined,
};

/** The glyph that goes with a severity, shared with service health. */
const SEVERITY_GLYPH: Record<Severity, Health> = {
  info: 'healthy',
  notice: 'healthy',
  warning: 'degraded',
  critical: 'critical',
};

const SPEEDS = PLAYBACK_SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` }));

function ScenarioCard({ scenario, running }: { scenario: Scenario; running: boolean }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    await (running ? actions.restartScenario(scenario.id) : actions.startScenario(scenario.id));
    setBusy(false);
  };
  return (
    <li className="py-2.5" data-testid={`scenario-${scenario.id}`} data-running={running}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-bold text-ink">{scenario.name}</h4>
          <p className="caption mt-0.5">
            {titleCase(scenario.category)},{' '}
            <span className="numeric">{formatClock(scenario.durationMs)}</span>,{' '}
            {scenario.phases.length} phases
          </p>
        </div>
        <Button
          size="sm"
          variant={running ? 'outline' : 'primary'}
          disabled={!scenario.available || busy}
          onClick={() => void start()}
          icon={running ? <RotateCcw size={12} aria-hidden /> : <Zap size={12} aria-hidden />}
          data-testid={`scenario-start-${scenario.id}`}
          aria-describedby={scenario.available ? undefined : `scenario-reason-${scenario.id}`}
        >
          {running ? 'Restart' : 'Start'}
        </Button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{scenario.summary}</p>
      {scenario.available && (
        <button
          type="button"
          onClick={() => useUi.getState().openExperiment(scenario.id)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          title="Run this scenario twice from the same seed, once with one change, and compare"
          data-testid={`scenario-compare-${scenario.id}`}
        >
          <GitCompareArrows size={12} aria-hidden /> Compare an intervention
        </button>
      )}
      {!scenario.available && (
        <p id={`scenario-reason-${scenario.id}`} className="mt-1.5 text-xs text-ink-dim">
          Cannot run:{' '}
          {scenario.unavailableReason ?? 'This scenario is incompatible with the active platform.'}
        </p>
      )}
    </li>
  );
}

function ActiveIncident({ scenario }: { scenario: Scenario | undefined }) {
  const incident = useTelemetry((state) => state.snapshot?.incident ?? null);
  const playback = useTelemetry((state) => state.playback);
  const topology = useTelemetry((state) => state.topology);
  // The phase the viewer asked to have explained; none until they ask.
  const [explained, setExplained] = useState<number | null>(null);
  const { data: report } = useIncidentReport(
    incident?.id ?? null,
    incident !== null && playback?.mode === 'live' && playback.status === 'playing',
  );
  if (!incident || !playback) return null;
  const playing = playback.status === 'playing';
  const tone = STATUS_TONE[incident.status];
  // The report is of the whole record; a phase the cursor has not reached
  // yet (in history) is not explained ahead of its time.
  const reportOf = (index: number) =>
    report?.incidentId === incident.id && index <= incident.phaseIndex
      ? report.phases.find((phase) => phase.index === index)
      : undefined;
  return (
    <section
      className="border-b border-line px-3 py-3"
      data-testid="active-incident"
      data-scenario={incident.scenarioId}
      data-status={incident.status}
    >
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold text-ink">
          {scenario?.name ?? titleCase(incident.scenarioId)}
        </h3>
        <span className="text-[11px] font-bold" style={{ color: tone }}>
          {STATUS_LABEL[incident.status]}
        </span>
      </header>
      <div>
        <div
          className="h-1 bg-line"
          role="progressbar"
          aria-label="Scenario progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(incident.progress * 100)}
        >
          <div
            className="h-full transition-[width] duration-300"
            style={{ width: `${incident.progress * 100}%`, backgroundColor: tone ?? COLOR.ink }}
          />
        </div>
        {scenario && (
          <>
            <p className="caption mt-3" data-testid="phase-times">
              Phases, timed from the start of the incident
              {report?.incidentId === incident.id && (
                <>
                  {' '}
                  (<span className="numeric">{formatClock(report.startedAtMs)}</span> on the
                  simulation clock)
                </>
              )}
              . Select one to see why.
            </p>
            <ol className="mt-1.5 space-y-1.5" aria-label="Phases">
              {scenario.phases.map((phase, i) => {
                const state =
                  i < incident.phaseIndex ? 'done' : i === incident.phaseIndex ? 'current' : 'next';
                const entered = reportOf(i);
                const open = explained === i && entered !== undefined;
                return (
                  <li
                    key={phase.name}
                    aria-current={state === 'current' ? 'step' : undefined}
                    className={cn(
                      'grid grid-cols-[1.25rem_1fr] text-xs',
                      state === 'current' ? 'text-ink' : 'text-ink-faint',
                    )}
                  >
                    <span className="numeric" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <button
                        type="button"
                        disabled={state === 'next'}
                        aria-expanded={open}
                        onClick={() => setExplained(open ? null : i)}
                        title={
                          state === 'next'
                            ? 'Not reached yet'
                            : entered
                              ? `Entered at ${formatClock(entered.atMs)} on the simulation clock. ${open ? 'Hide' : 'Show'} what it prescribes and what followed.`
                              : undefined
                        }
                        className="group text-left enabled:hover:text-ink"
                        data-testid={`phase-${i}`}
                      >
                        <span
                          className={cn(
                            state === 'current' && 'font-bold',
                            state !== 'next' &&
                              'underline decoration-line-strong underline-offset-2 group-hover:decoration-ink',
                          )}
                        >
                          {phase.name}
                        </span>
                        <span className="numeric ml-1.5 text-[11px] text-ink-faint">
                          +{formatClock(phase.atMs)}
                        </span>
                      </button>
                      {state === 'current' && (
                        <span
                          className="mt-0.5 block text-[11px] leading-snug text-ink-dim"
                          data-testid="incident-phase"
                        >
                          {phase.description}
                        </span>
                      )}
                      {open && <PhaseExplanation report={report!} phase={entered} />}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            icon={playing ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
            onClick={() => void actions.control({ action: playing ? 'pause' : 'play' })}
            data-testid="incident-pause"
          >
            {playing ? 'Pause' : 'Resume'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Square size={11} aria-hidden />}
            onClick={() => void actions.stopScenario()}
            data-testid="incident-stop"
            title="Stop the scenario and let the platform recover. History is kept."
          >
            Stop
          </Button>
          <Segmented<PlaybackSpeed>
            label="Scenario speed"
            size="sm"
            value={playback.speed as PlaybackSpeed}
            options={SPEEDS}
            onChange={(speed) => void actions.control({ action: 'setSpeed', speed })}
          />
        </div>
        <button
          type="button"
          onClick={() => useUi.getState().inspectIncident(incident.id)}
          className="mt-2 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          data-testid="incident-summary-open"
        >
          Summary so far: origin, propagation, peak
        </button>
        {incident.impactedNodeIds.length > 0 && (
          <div className="mt-3">
            <p className="caption mb-1">
              {incident.impactedNodeIds.length} service
              {incident.impactedNodeIds.length === 1 ? '' : 's'} affected
            </p>
            <ul
              className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs"
              data-testid="impacted-services"
            >
              {incident.impactedNodeIds.slice(0, 18).map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().selectNode(id)}
                    onMouseEnter={() => useUi.getState().setHovered(id)}
                    onMouseLeave={() => useUi.getState().setHovered(null)}
                    className="text-ink-dim hover:text-ink hover:underline hover:underline-offset-2"
                  >
                    <ServiceName topology={topology} id={id} />
                  </button>
                </li>
              ))}
              {incident.impactedNodeIds.length > 18 && (
                <li className="text-ink-faint">and {incident.impactedNodeIds.length - 18} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function EventDetail({ event, onBack }: { event: SecurityEvent; onBack: () => void }) {
  const topology = useTelemetry((state) => state.topology);
  // An event of an incident is also so long into it; the two clocks differ
  // by when the incident began, so both are said.
  const { data: started } = useQuery({
    queryKey: queryKeys.incidents,
    queryFn: api.incidents,
    select: (response) =>
      response.incidents.find((incident) => incident.id === event.incidentId)?.startedAtMs,
    enabled: event.incidentId !== null,
  });
  const { data: report } = useIncidentReport(
    event.kind === 'incident-phase' ? event.incidentId : null,
  );
  const phaseIndex =
    event.kind === 'incident-phase' && typeof event.details === 'object' && event.details !== null
      ? (event.details as { phaseIndex?: unknown }).phaseIndex
      : undefined;
  const phase =
    typeof phaseIndex === 'number'
      ? report?.phases.find((entry) => entry.index === phaseIndex)
      : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="event-detail">
      <div className="border-b border-line px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
        >
          <ChevronLeft size={13} aria-hidden /> All events
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h4 className="text-sm font-bold text-ink">{event.title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">{event.message}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-ink-faint">Severity</dt>
          <dd>
            <SeverityBadge severity={event.severity} />
          </dd>
          <dt className="text-ink-faint">Kind</dt>
          <dd className="text-ink">{titleCase(event.kind)}</dd>
          <dt className="text-ink-faint">Simulation clock</dt>
          <dd className="numeric text-ink" data-testid="event-clock">
            {formatClock(event.virtualTimeMs)}
          </dd>
          {started !== undefined && event.virtualTimeMs >= started && (
            <>
              <dt className="text-ink-faint">Into the incident</dt>
              <dd className="numeric text-ink" data-testid="event-since-incident">
                +{formatClock(event.virtualTimeMs - started)}
                <span className="font-normal text-ink-faint">
                  {' '}
                  (it began at {formatClock(started)})
                </span>
              </dd>
            </>
          )}
          <dt className="text-ink-faint">Sequence</dt>
          <dd className="numeric text-ink">{event.seq}</dd>
          {event.incidentId && (
            <>
              <dt className="text-ink-faint">Incident</dt>
              <dd className="code text-ink">{event.incidentId}</dd>
            </>
          )}
          <dt className="text-ink-faint">Data</dt>
          <dd>
            <SourceBadge source={event.dataSource} />
          </dd>
        </dl>
        {event.kind === 'health-transition' && event.incidentId && (
          <TransitionWhy incidentId={event.incidentId} seq={event.seq} />
        )}
        {phase && report && (
          <div className="mt-3">
            <p className="caption">What this phase prescribes, and what followed</p>
            <PhaseExplanation report={report} phase={phase} />
          </div>
        )}
        {event.nodeIds.length > 0 && (
          <div className="mt-3">
            <p className="caption mb-1">Services</p>
            <ul className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs">
              {event.nodeIds.slice(0, 16).map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().selectNode(id)}
                    className="text-ink-dim hover:text-ink hover:underline hover:underline-offset-2"
                  >
                    <ServiceName topology={topology} id={id} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3">
          <Button
            size="sm"
            onClick={() =>
              void actions.control({
                action: 'seek',
                toMs: Math.max(0, event.virtualTimeMs - 2000),
              })
            }
            data-testid="event-jump"
          >
            Jump to this moment
          </Button>
        </div>
        {event.details !== undefined && (
          <div className="mt-3">
            <p className="caption mb-1">Details</p>
            <pre className="code max-h-72 overflow-auto rounded-control border border-line bg-sunken p-2 text-[11px] leading-relaxed text-ink-dim">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The incidents this timeline holds, newest first. Each leads to its
 * summary: the one that just ended most of all.
 */
function RecordedIncidents() {
  const { data: incidents } = useQuery({
    queryKey: queryKeys.incidents,
    queryFn: api.incidents,
    select: (response) => response.incidents,
  });
  if (!incidents || incidents.length === 0) return null;
  return (
    <Section title="On this timeline">
      <ul className="-mx-1.5" data-testid="recorded-incidents">
        {[...incidents].reverse().map((incident) => (
          <li key={incident.id}>
            <button
              type="button"
              onClick={() => useUi.getState().inspectIncident(incident.id)}
              className="grid w-full grid-cols-[1fr_auto] items-baseline gap-x-2 rounded-control px-1.5 py-1 text-left hover:bg-raised"
              data-testid={`incident-${incident.id}`}
              data-status={incident.status}
            >
              <span className="min-w-0 truncate text-xs text-ink">
                {incident.title}
                <span className="text-ink-faint">
                  , {STATUS_LABEL[incident.status].toLowerCase()}
                </span>
              </span>
              <span className="numeric text-[11px] text-ink-faint">
                {formatClock(incident.startedAtMs)}
                {incident.resolvedAtMs !== null && ` to ${formatClock(incident.resolvedAtMs)}`}
              </span>
              <span className="caption col-span-2">
                Summary: origin, propagation, peak and recovery
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const LEVELS: { value: Severity; label: string }[] = [
  { value: 'info', label: 'All' },
  { value: 'notice', label: 'Notices' },
  { value: 'warning', label: 'Warnings' },
  { value: 'critical', label: 'Critical' },
];

function EventRow({
  event,
  cursor,
  nested,
}: {
  event: SecurityEvent;
  cursor: number;
  nested?: boolean;
}) {
  const loud = event.severity === 'warning' || event.severity === 'critical';
  return (
    <button
      type="button"
      onClick={() => useUi.getState().inspectEvent(event.seq)}
      data-testid="event-row"
      data-kind={event.kind}
      data-severity={event.severity}
      className={cn(
        'grid w-full grid-cols-[0.75rem_1fr_auto] items-baseline gap-x-1.5 rounded-control px-1.5 py-1 text-left hover:bg-raised',
        nested && 'pl-5',
        // Events ahead of the cursor belong to the recorded future.
        event.virtualTimeMs > cursor && 'opacity-45',
      )}
    >
      <span className="self-center">
        <HealthGlyph health={SEVERITY_GLYPH[event.severity]} size={8} />
      </span>
      <span className={cn('min-w-0 truncate text-xs text-ink', loud && !nested && 'font-bold')}>
        {event.title}
        <span className="sr-only">, severity {SEVERITY_LABEL[event.severity]}</span>
        {event.dataSource !== 'synthetic' && (
          <span className="ml-1.5 font-normal text-ink-faint">{event.dataSource}</span>
        )}
      </span>
      <span className="numeric text-[11px] text-ink-faint">{formatClock(event.virtualTimeMs)}</span>
    </button>
  );
}

function EventLog() {
  const events = useTelemetry((state) => state.events);
  const cursor = useTelemetry((state) => state.playback?.virtualTimeMs ?? Infinity);
  const [level, setLevel] = useState<Severity>('notice');
  const [open, setOpen] = useState<number | null>(null);
  const entries = useMemo(() => {
    const floor = SEVERITY_ORDER[level];
    const newest: SecurityEvent[] = [];
    for (let i = events.length - 1; i >= 0 && newest.length < 120; i--) {
      const event = events[i]!;
      if (SEVERITY_ORDER[event.severity] >= floor) newest.push(event);
    }
    return foldEvents(newest);
  }, [events, level]);
  return (
    <Section
      title="Events"
      aside={
        <Segmented
          label="Minimum severity"
          size="sm"
          value={level}
          options={LEVELS}
          onChange={setLevel}
        />
      }
    >
      {entries.length === 0 ? (
        <p className="text-xs text-ink-faint">No events at this level yet.</p>
      ) : (
        <ol className="-mx-1.5" data-testid="event-log" aria-label="Events, newest first">
          {entries.map((entry) =>
            entry.kind === 'event' ? (
              <li key={entry.event.seq}>
                <EventRow event={entry.event} cursor={cursor} />
              </li>
            ) : (
              <li key={`run-${entry.key}`}>
                <button
                  type="button"
                  aria-expanded={open === entry.key}
                  onClick={() => setOpen(open === entry.key ? null : entry.key)}
                  data-testid="event-run"
                  className={cn(
                    'grid w-full grid-cols-[0.75rem_1fr_auto] items-baseline gap-x-1.5 rounded-control px-1.5 py-1 text-left hover:bg-raised',
                    entry.events[0]!.virtualTimeMs > cursor && 'opacity-45',
                  )}
                >
                  <span className="self-center">
                    <HealthGlyph health={SEVERITY_GLYPH[entry.severity]} size={8} />
                  </span>
                  <span className="min-w-0 truncate text-xs text-ink">
                    {entry.events.length} services changed state
                  </span>
                  <span className="numeric text-[11px] text-ink-faint">
                    {formatClock(entry.events[0]!.virtualTimeMs)}
                  </span>
                </button>
                {open === entry.key && (
                  <ol>
                    {entry.events.map((event) => (
                      <li key={event.seq}>
                        <EventRow event={event} cursor={cursor} nested />
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ),
          )}
        </ol>
      )}
    </Section>
  );
}

/** Bundled recordings: a seed and a command list the engine replays exactly. */
function Recordings() {
  const { data: recordings } = useQuery({
    queryKey: queryKeys.recordings,
    queryFn: api.recordings,
  });
  if (!recordings || recordings.length === 0) return null;
  return (
    <Select
      label="Load a recorded incident"
      hideLabel
      value=""
      onChange={(event) => {
        if (event.target.value) void actions.loadRecording(event.target.value);
      }}
      className="mt-2 w-full"
      data-testid="recording-picker"
    >
      <option value="">Load a recorded incident…</option>
      {recordings.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name} ({formatClock(r.durationMs)})
        </option>
      ))}
    </Select>
  );
}

/**
 * Everything placed by hand, wherever it is on the platform. It is here
 * only while there is something to list.
 */
function PlacedByHand() {
  const topology = useTelemetry((state) => state.topology);
  // The list changes rarely; the snapshot that carries it arrives all the time.
  const key = useTelemetry((state) =>
    state.snapshot && state.snapshot.topologyId === state.topology?.id
      ? JSON.stringify(state.snapshot.faults)
      : '[]',
  );
  const faults = useMemo(() => JSON.parse(key) as ActiveFault[], [key]);
  if (!topology || faults.length === 0) return null;
  return (
    <Section
      title="Placed by hand"
      aside={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void actions.liftFault()}
          data-testid="faults-lift-all"
        >
          Lift all
        </Button>
      }
    >
      <ul className="space-y-1" data-testid="faults-in-force">
        {faults.map((fault) => {
          const effect = faultEffect(topology, fault);
          const node = fault.node === null ? undefined : topology.nodes[fault.node];
          const edge = fault.edge === null ? undefined : topology.edges[fault.edge];
          const target = faultTarget(topology, fault);
          return (
            <li
              key={`${fault.kind}:${fault.node ?? ''}:${fault.edge ?? ''}:${fault.onto ?? ''}`}
              className="flex items-center justify-between gap-2"
            >
              <button
                type="button"
                className="min-w-0 flex-1 rounded-control px-1.5 py-1 text-left text-xs hover:bg-raised"
                onClick={() => {
                  if (node) useUi.getState().selectNode(node.id);
                  else if (edge) useUi.getState().select({ kind: 'edge', id: edge.id });
                }}
              >
                <span className="block truncate text-ink">{target}</span>
                <span className="caption block">{describeFault(fault.kind, fault.value)}</span>
              </button>
              {effect && (
                <IconButton
                  label={`Lift this fault from ${target}`}
                  size="sm"
                  onClick={() => void actions.liftFault(effect)}
                >
                  <X size={13} />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function ScenarioConsole() {
  const { data, isError } = useQuery({ queryKey: queryKeys.scenarios, queryFn: api.scenarios });
  const activeId = useTelemetry((state) => state.snapshot?.incident?.scenarioId ?? null);
  const inspectedSeq = useUi((state) => state.inspectedEventSeq);
  const inspected = useTelemetry((state) =>
    inspectedSeq === null ? undefined : state.events.find((event) => event.seq === inspectedSeq),
  );
  const inspectedIncident = useUi((state) => state.inspectedIncidentId);
  const [confirming, setConfirming] = useState(false);

  if (inspected) {
    return <EventDetail event={inspected} onBack={() => useUi.getState().inspectEvent(null)} />;
  }
  if (inspectedIncident !== null) {
    return (
      <IncidentSummary
        incidentId={inspectedIncident}
        onBack={() => useUi.getState().inspectIncident(null)}
      />
    );
  }
  const active = data?.scenarios.find((s) => s.id === activeId);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="scenario-console">
      <ActiveIncident scenario={active} />
      <RecordedIncidents />
      <PlacedByHand />
      <Section
        title="Scenarios"
        aside={
          confirming ? (
            <span className="flex items-center gap-1">
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirming(false);
                  void actions.resetSimulation();
                }}
                data-testid="reset-confirm"
              >
                Erase history
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={12} aria-hidden />}
              onClick={() => setConfirming(true)}
              data-testid="reset-simulation"
              title="Return to a clean baseline at 0:00"
            >
              Reset
            </Button>
          )
        }
      >
        <p className="caption mb-1">
          Fictional, deterministic incidents that run only inside the simulation engine. Nothing
          here touches a real system.
        </p>
        {isError && <EmptyState title="Scenarios unavailable">{HOST.unreachable}</EmptyState>}
        <ul className="divide-y divide-line">
          {data?.scenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              running={scenario.id === activeId}
            />
          ))}
        </ul>
        <Recordings />
        <button
          type="button"
          onClick={() => useUi.getState().setPanel('scenario-editor')}
          className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          data-testid="open-scenario-editor"
        >
          <PencilLine size={12} aria-hidden /> Write a scenario of your own
        </button>
      </Section>
      <EventLog />
    </div>
  );
}

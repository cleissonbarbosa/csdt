import {
  PLAYBACK_SPEEDS,
  SEVERITY_ORDER,
  type PlaybackSpeed,
  type Scenario,
  type SecurityEvent,
  type Severity,
} from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Pause, Play, RotateCcw, Square, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { Badge, SeverityBadge, SourceBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { EmptyState, Section } from '@/components/ui/Section';
import { cn } from '@/lib/cn';
import { formatClock, titleCase } from '@/lib/format';
import { COLOR, SEVERITY_COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

const STATUS_COLOR = {
  active: COLOR.critical,
  mitigating: COLOR.warning,
  recovering: COLOR.cyan,
  resolved: COLOR.healthy,
} as const;

const SPEEDS = PLAYBACK_SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` }));

function ScenarioCard({ scenario, running }: { scenario: Scenario; running: boolean }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    await (running ? actions.restartScenario(scenario.id) : actions.startScenario(scenario.id));
    setBusy(false);
  };
  return (
    <li
      className={cn(
        'rounded-[4px] border p-2.5 transition-colors',
        running ? 'border-critical/60 bg-critical/[0.07]' : 'border-line hover:border-line-bright',
      )}
      data-testid={`scenario-${scenario.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-display text-[13px] font-semibold text-ink">{scenario.name}</h4>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            <span style={{ color: SEVERITY_COLOR[scenario.severity] }}>{scenario.category}</span>
            <span aria-hidden>·</span>
            <span className="numeric">{formatClock(scenario.durationMs)}</span>
            <span aria-hidden>·</span>
            <span>{scenario.phases.length} phases</span>
          </p>
        </div>
        <Button
          size="sm"
          variant={running ? 'outline' : 'primary'}
          disabled={!scenario.available || busy}
          onClick={() => void start()}
          icon={running ? <RotateCcw size={12} aria-hidden /> : <Zap size={12} aria-hidden />}
          data-testid={`scenario-start-${scenario.id}`}
          title={
            scenario.available ? undefined : 'The active topology lacks a role this scenario needs.'
          }
        >
          {running ? 'Restart' : 'Start'}
        </Button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{scenario.summary}</p>
    </li>
  );
}

function ActiveIncident({ scenario }: { scenario: Scenario | undefined }) {
  const incident = useTelemetry((state) => state.snapshot?.incident ?? null);
  const playback = useTelemetry((state) => state.playback);
  const topology = useTelemetry((state) => state.topology);
  if (!incident || !playback) return null;
  const playing = playback.status === 'playing';
  const nameOf = (id: string) => topology?.nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <Section title="Active incident" className="bg-critical/[0.05]">
      <div
        data-testid="active-incident"
        data-scenario={incident.scenarioId}
        data-status={incident.status}
      >
        <div className="flex items-center justify-between gap-2">
          <h4 className="min-w-0 truncate font-display text-sm font-semibold text-ink">
            {scenario?.name ?? titleCase(incident.scenarioId)}
          </h4>
          <Badge color={STATUS_COLOR[incident.status]} dot pulse={incident.status === 'active'}>
            {incident.status}
          </Badge>
        </div>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-abyss"
          role="progressbar"
          aria-label="Scenario progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(incident.progress * 100)}
        >
          <div
            className="h-full transition-[width] duration-300"
            style={{
              width: `${incident.progress * 100}%`,
              backgroundColor: STATUS_COLOR[incident.status],
            }}
          />
        </div>
        {scenario && (
          <ol className="mt-2.5 space-y-1" aria-label="Phases">
            {scenario.phases.map((phase, i) => {
              const state =
                i < incident.phaseIndex ? 'done' : i === incident.phaseIndex ? 'current' : 'next';
              return (
                <li
                  key={phase.name}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'flex gap-2 text-xs',
                    state === 'current'
                      ? 'text-ink'
                      : state === 'done'
                        ? 'text-ink-faint'
                        : 'text-ink-faint/70',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1 size-2 shrink-0 rounded-full border',
                      state === 'current' && 'animate-pulse-soft',
                    )}
                    style={{
                      borderColor: state === 'next' ? COLOR.line : STATUS_COLOR[phase.status],
                      backgroundColor:
                        state === 'next' ? 'transparent' : STATUS_COLOR[phase.status],
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{phase.name}</span>
                    <span className="numeric ml-1.5 text-[10px] text-ink-faint">
                      +{formatClock(phase.atMs)}
                    </span>
                    {state === 'current' && (
                      <span
                        className="mt-0.5 block text-[11px] leading-snug text-ink-dim"
                        data-testid="incident-phase"
                      >
                        {phase.description}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
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
        {incident.impactedNodeIds.length > 0 && (
          <div className="mt-3">
            <p className="eyebrow mb-1.5">Impacted services · {incident.impactedNodeIds.length}</p>
            <ul className="flex flex-wrap gap-1" data-testid="impacted-services">
              {incident.impactedNodeIds.slice(0, 18).map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().selectNode(id)}
                    onMouseEnter={() => useUi.getState().setHovered(id)}
                    onMouseLeave={() => useUi.getState().setHovered(null)}
                    className="rounded-[3px] border border-critical/40 bg-critical/10 px-1.5 py-0.5 text-[11px] text-ink hover:border-critical"
                  >
                    {nameOf(id)}
                  </button>
                </li>
              ))}
              {incident.impactedNodeIds.length > 18 && (
                <li className="px-1 py-0.5 text-[11px] text-ink-faint">
                  +{incident.impactedNodeIds.length - 18} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

function EventDetail({ event, onBack }: { event: SecurityEvent; onBack: () => void }) {
  const topology = useTelemetry((state) => state.topology);
  const nameOf = (id: string) => topology?.nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="event-detail">
      <div className="border-b border-line/70 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[11px] text-cyan hover:underline"
        >
          <ChevronLeft size={13} aria-hidden /> All events
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={event.severity} />
          <Badge color={COLOR.inkDim}>{event.kind}</Badge>
          <SourceBadge source={event.dataSource} />
        </div>
        <h4 className="mt-2 font-display text-sm font-semibold text-ink">{event.title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">{event.message}</p>
        <dl className="numeric mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-ink-faint">Time</dt>
          <dd className="text-ink">{formatClock(event.virtualTimeMs)}</dd>
          <dt className="text-ink-faint">Sequence</dt>
          <dd className="text-ink">#{event.seq}</dd>
          {event.incidentId && (
            <>
              <dt className="text-ink-faint">Incident</dt>
              <dd className="text-ink">{event.incidentId}</dd>
            </>
          )}
        </dl>
        {event.nodeIds.length > 0 && (
          <div className="mt-3">
            <p className="eyebrow mb-1.5">Services</p>
            <ul className="flex flex-wrap gap-1">
              {event.nodeIds.slice(0, 16).map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().selectNode(id)}
                    className="rounded-[3px] border border-line-bright px-1.5 py-0.5 text-[11px] text-ink hover:border-cyan"
                  >
                    {nameOf(id)}
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
            <p className="eyebrow mb-1.5">Details</p>
            <pre className="numeric max-h-72 overflow-auto rounded-[3px] border border-line bg-abyss p-2 text-[10px] leading-relaxed text-ink-dim">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

const LEVELS: { value: Severity; label: string }[] = [
  { value: 'info', label: 'All' },
  { value: 'notice', label: 'Notice+' },
  { value: 'warning', label: 'Warning+' },
  { value: 'critical', label: 'Critical' },
];

function EventLog() {
  const events = useTelemetry((state) => state.events);
  const cursor = useTelemetry((state) => state.playback?.virtualTimeMs ?? Infinity);
  const [level, setLevel] = useState<Severity>('notice');
  const visible = useMemo(() => {
    const floor = SEVERITY_ORDER[level];
    const out: SecurityEvent[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 120; i--) {
      const event = events[i]!;
      if (SEVERITY_ORDER[event.severity] >= floor) out.push(event);
    }
    return out;
  }, [events, level]);
  return (
    <Section
      title="Event inspector"
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
      {visible.length === 0 ? (
        <p className="text-xs text-ink-faint">No events at this level yet.</p>
      ) : (
        <ol className="-mx-1.5" data-testid="event-log" aria-label="Events, newest first">
          {visible.map((event) => (
            <li key={event.seq}>
              <button
                type="button"
                onClick={() => useUi.getState().inspectEvent(event.seq)}
                data-testid="event-row"
                data-kind={event.kind}
                data-severity={event.severity}
                className={cn(
                  'flex w-full items-start gap-2 rounded-[3px] px-1.5 py-1 text-left hover:bg-raised/70',
                  // Events ahead of the cursor belong to the recorded future.
                  event.virtualTimeMs > cursor && 'opacity-45',
                )}
              >
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: SEVERITY_COLOR[event.severity] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-ink">{event.title}</span>
                  <span className="numeric block text-[10px] text-ink-faint">
                    {formatClock(event.virtualTimeMs)} · <span className="sr-only">severity </span>
                    {event.severity}
                    {event.dataSource !== 'synthetic' && ` · ${event.dataSource}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
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
  const [confirming, setConfirming] = useState(false);

  if (inspected) {
    return <EventDetail event={inspected} onBack={() => useUi.getState().inspectEvent(null)} />;
  }
  const active = data?.scenarios.find((s) => s.id === activeId);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="scenario-console">
      <ActiveIncident scenario={active} />
      <Section
        title="Incident scenarios"
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
        <p className="mb-2.5 text-[11px] leading-relaxed text-ink-faint">
          Fictional, deterministic incidents that run only inside the simulation engine. Nothing
          here touches a real system.
        </p>
        {isError && (
          <EmptyState title="Scenarios unavailable">The server could not be reached.</EmptyState>
        )}
        <ul className="space-y-2">
          {data?.scenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              running={scenario.id === activeId}
            />
          ))}
        </ul>
      </Section>
      <EventLog />
    </div>
  );
}

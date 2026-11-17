/**
 * An incident explained from its own record.
 *
 * Watching an incident shows that things changed; why one change followed
 * another has to be pieced together from the model, the events and the
 * metrics. The server does that piecing together (`/incidents/{id}/report`)
 * and says for each line what kind of statement it is. These components
 * show it: one phase at a time while the incident runs, and as a summary
 * with its moments once it is over.
 */
import type { IncidentReport, ReportPhase, ReportTransition, Topology } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Copy } from 'lucide-react';
import { useState } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { DecisionTag, HealthGlyph, SourceBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, Section, Stat } from '@/components/ui/Section';
import { ServiceName } from '@/components/ui/ServiceName';
import { cn } from '@/lib/cn';
import { entityId, formatClock, formatMs, formatPercent, titleCase } from '@/lib/format';
import { COLOR } from '@/lib/palette';
import {
  BASIS_HINT,
  BASIS_LABEL,
  bothClocks,
  describeObjective,
  describeOrigin,
  describeOutcome,
  describePrescribed,
  explainCause,
  moments,
  objectiveName,
  reportText,
  sinceStart,
  type Basis,
} from '@/lib/report';
import { api } from '@/providers/api';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

/** The report of an incident; refreshed while the incident is still running. */
export function useIncidentReport(incidentId: string | null, running = false) {
  return useQuery({
    queryKey: queryKeys.report(incidentId ?? ''),
    queryFn: () => api.incidentReport(incidentId ?? ''),
    enabled: incidentId !== null,
    // What followed in the model keeps arriving for as long as it runs.
    refetchInterval: running ? 3000 : false,
    staleTime: running ? 0 : 15_000,
  });
}

/**
 * What kind of statement a line is. A word in a box, not a colour: the
 * three kinds are told apart by reading, and none of them is an alarm.
 */
export function BasisTag({ basis }: { basis: Basis }) {
  return (
    <span
      title={BASIS_HINT[basis]}
      data-basis={basis}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center rounded-control border px-1.5 text-[10px] leading-none',
        basis === 'prescribed'
          ? 'border-ink bg-ink text-on-accent'
          : basis === 'unexplained'
            ? 'border-dashed border-line-strong text-ink-faint'
            : 'border-ink text-ink',
      )}
    >
      {BASIS_LABEL[basis]}
    </span>
  );
}

/** A moment of the incident, said both ways and one click from being shown. */
function When({ report, atMs }: { report: IncidentReport; atMs: number }) {
  return (
    <button
      type="button"
      title={`${bothClocks(report, atMs)}. Go to this moment.`}
      onClick={() => void actions.control({ action: 'seek', toMs: Math.max(0, atMs - 1000) })}
      className="numeric shrink-0 text-[11px] text-ink-dim underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink"
    >
      {sinceStart(report, atMs)}
    </button>
  );
}

function TransitionRow({
  report,
  transition,
  topology,
}: {
  report: IncidentReport;
  transition: ReportTransition;
  topology: Topology | null;
}) {
  const why = transition.cause ? explainCause(transition.cause, topology) : null;
  return (
    <li className="py-1" data-testid="report-transition" data-node-id={transition.nodeId}>
      <div className="flex items-baseline gap-1.5">
        <span className="self-center">
          <HealthGlyph health={transition.to} size={8} />
        </span>
        <button
          type="button"
          onClick={() => useUi.getState().selectNode(transition.nodeId)}
          onMouseEnter={() => useUi.getState().setHovered(transition.nodeId)}
          onMouseLeave={() => useUi.getState().setHovered(null)}
          className="min-w-0 flex-1 truncate text-left text-xs text-ink hover:underline hover:underline-offset-2"
        >
          <ServiceName topology={topology} id={transition.nodeId} />
          <span className="sr-only">, {transition.to}</span>
        </button>
        <When report={report} atMs={transition.atMs} />
      </div>
      {/* The state is said with its reason, so a long name cannot push it
          out of sight. */}
      <p className="mt-0.5 flex items-baseline gap-1.5 pl-[14px] text-[11px] leading-snug text-ink-dim">
        {why && <BasisTag basis={why.basis} />}
        <span data-testid="report-cause">
          {transition.to === 'healthy'
            ? 'Back to normal.'
            : why
              ? `${titleCase(transition.to)} because ${why.text}.`
              : `${titleCase(transition.to)}, from ${transition.from}.`}
        </span>
      </p>
    </li>
  );
}

/**
 * One phase explained: what the scenario does in it by itself, what
 * followed from that in the model, and what the figures showed.
 */
export function PhaseExplanation({
  report,
  phase,
}: {
  report: IncidentReport;
  phase: ReportPhase;
}) {
  const topology = useTelemetry((state) => state.topology);
  const scripted = phase.events.filter((event) => event.scripted);
  const raised = phase.events.filter((event) => !event.scripted);
  return (
    <div
      className="mt-1.5 space-y-2 border-l border-line-strong pl-2.5"
      data-testid="phase-explanation"
      data-phase={phase.index}
    >
      <div>
        <p className="caption mb-0.5" title={BASIS_HINT.prescribed}>
          Prescribed by the scenario
        </p>
        {phase.prescribed.length === 0 && scripted.length === 0 ? (
          <p className="text-[11px] text-ink-faint">
            Nothing: what earlier phases held eases back to nominal.
          </p>
        ) : (
          <ul
            className="space-y-0.5 text-[11px] leading-snug text-ink"
            data-testid="phase-prescribed"
          >
            {phase.prescribed.map((effect) => (
              <li key={effect.description + effect.nodeIds.join()}>
                {describePrescribed(effect, topology)}
              </li>
            ))}
            {scripted.map((event) => (
              <li key={event.seq} className="text-ink-dim">
                Announces “{event.title}” at {sinceStart(report, event.atMs)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="caption mb-0.5">What followed</p>
        {phase.transitions.length === 0 ? (
          <p className="text-[11px] text-ink-faint">
            {phase.endedAtMs === null
              ? 'No service has left its normal state in this phase so far.'
              : 'No service got worse during this phase.'}
          </p>
        ) : (
          <ul className="-my-1" data-testid="phase-followed">
            {phase.transitions.map((transition) => (
              <TransitionRow
                key={transition.seq}
                report={report}
                transition={transition}
                topology={topology}
              />
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="caption mb-0.5">Observed</p>
        <ul
          className="space-y-0.5 text-[11px] leading-snug text-ink-dim"
          data-testid="phase-observed"
        >
          {phase.peakErrorRate && (
            <li>
              Error rate up to{' '}
              <span className="numeric text-ink">{formatPercent(phase.peakErrorRate.value)}</span>{' '}
              at <When report={report} atMs={phase.peakErrorRate.atMs} />
              {report.baseline && (
                <>
                  , from <span className="numeric">{formatPercent(report.baseline.errorRate)}</span>{' '}
                  before the incident
                </>
              )}
            </li>
          )}
          {phase.peakP95LatencyMs && (
            <li>
              Latency p95 up to{' '}
              <span className="numeric text-ink">{formatMs(phase.peakP95LatencyMs.value)}</span>
              {report.baseline && (
                <>
                  , from <span className="numeric">{formatMs(report.baseline.p95LatencyMs)}</span>{' '}
                  before
                </>
              )}
            </li>
          )}
          {raised.map((event) => (
            <li key={event.seq}>
              A detection rule raised “{event.title}” at <When report={report} atMs={event.atMs} />
            </li>
          ))}
          {!phase.peakErrorRate && !phase.peakP95LatencyMs && raised.length === 0 && (
            <li className="text-ink-faint">No sample of this phase is on record yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** Why one service changed health, for the event that recorded it. */
export function TransitionWhy({ incidentId, seq }: { incidentId: string; seq: number }) {
  const topology = useTelemetry((state) => state.topology);
  const { data: report } = useIncidentReport(incidentId);
  if (!report) return null;
  const transition = [
    ...report.phases.flatMap((phase) => phase.transitions),
    ...report.propagation,
    ...report.recovery,
  ].find((entry) => entry.seq === seq);
  if (!transition?.cause) return null;
  const why = explainCause(transition.cause, topology);
  return (
    <div className="mt-3" data-testid="event-why">
      <p className="caption mb-1">Why</p>
      <p className="flex items-baseline gap-1.5 text-xs leading-relaxed text-ink">
        <BasisTag basis={why.basis} />
        <span>Because {why.text}.</span>
      </p>
      {transition.cause.viaNodeId && (
        <button
          type="button"
          onClick={() => useUi.getState().selectNode(transition.cause!.viaNodeId!)}
          className="mt-1 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
        >
          Show <ServiceName topology={topology} id={transition.cause.viaNodeId} />
        </button>
      )}
    </div>
  );
}

const SHOWN = 8;

/** A list that shows its beginning and keeps the rest one click away. */
function Transitions({
  report,
  transitions,
  testId,
}: {
  report: IncidentReport;
  transitions: ReportTransition[];
  testId: string;
}) {
  const topology = useTelemetry((state) => state.topology);
  const [all, setAll] = useState(false);
  const shown = all ? transitions : transitions.slice(0, SHOWN);
  return (
    <>
      <ol className="-my-1" data-testid={testId}>
        {shown.map((transition) => (
          <TransitionRow
            key={transition.seq}
            report={report}
            transition={transition}
            topology={topology}
          />
        ))}
      </ol>
      {transitions.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-1.5 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
        >
          {all ? 'Show fewer' : `Show all ${transitions.length}`}
        </button>
      )}
    </>
  );
}

/**
 * The incident from start to end: where it began, how it spread, how bad it
 * got, how it ended, with the moments to go back to and a text to take away.
 */
export function IncidentSummary({
  incidentId,
  onBack,
}: {
  incidentId: string;
  onBack: () => void;
}) {
  const topology = useTelemetry((state) => state.topology);
  const running = useTelemetry(
    (state) => state.snapshot?.incident?.id === incidentId && state.playback?.mode === 'live',
  );
  const { data: report, isError } = useIncidentReport(incidentId, running);
  const back = (
    <div className="border-b border-line px-3 py-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
      >
        <ChevronLeft size={13} aria-hidden /> Incidents and scenarios
      </button>
    </div>
  );
  if (isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {back}
        <EmptyState title="No summary">
          This incident is not on the timeline any more: it was reset, or is older than the history
          that is kept.
        </EmptyState>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {back}
        <EmptyState title="Reading the incident back" />
      </div>
    );
  }
  const origin = describeOrigin(report, topology);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(report, topology));
      useNotices.getState().push('info', 'Summary copied as text.');
    } catch {
      useNotices.getState().push('error', 'The summary could not be copied.');
    }
  };
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="incident-summary"
      data-incident={report.incidentId}
      data-status={report.status}
    >
      {back}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="border-b border-line px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-sm font-bold text-ink">{report.title}</h3>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={12} aria-hidden />}
              onClick={() => void copy()}
              data-testid="summary-copy"
              title="Copy this summary as plain text"
            >
              Copy
            </Button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim" data-testid="summary-outcome">
            {describeOutcome(report)}
          </p>
          <p className="caption mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Read back from this run. Times are since the incident began, at{' '}
              <span className="numeric">{formatClock(report.startedAtMs)}</span> on the simulation
              clock.
            </span>
            <SourceBadge source={report.dataSource} />
          </p>
        </header>

        <Section title="Moments">
          <ul className="flex flex-wrap gap-x-3 gap-y-1" data-testid="summary-moments">
            {moments(report).map((moment) => (
              <li key={moment.id}>
                <button
                  type="button"
                  onClick={() =>
                    void actions.control({
                      action: 'seek',
                      toMs: Math.max(0, moment.atMs - 1000),
                    })
                  }
                  title={`${bothClocks(report, moment.atMs)}. Go to this moment.`}
                  className="text-xs text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                  data-testid={`moment-${moment.id}`}
                >
                  {moment.label}{' '}
                  <span className="numeric text-ink-dim">{sinceStart(report, moment.atMs)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>

        {origin && (
          <Section title="Origin">
            <button
              type="button"
              onClick={() => useUi.getState().selectNode(report.origin!.nodeId)}
              className="text-left text-xs leading-relaxed text-ink hover:underline hover:underline-offset-2"
              data-testid="summary-origin"
              data-node-id={report.origin!.nodeId}
            >
              {origin}
            </button>
          </Section>
        )}

        <Section
          title="Propagation"
          aside={
            <span className="numeric text-[11px] text-ink-faint">
              {report.impactedNodeIds.length} affected
            </span>
          }
        >
          {report.propagation.length === 0 ? (
            <p className="text-xs text-ink-faint">No service left its normal state.</p>
          ) : (
            <>
              <p className="caption mb-1.5">
                The first time each service left its normal state, and why.
              </p>
              <Transitions
                report={report}
                transitions={report.propagation}
                testId="summary-propagation"
              />
            </>
          )}
        </Section>

        <Section title="Peak impact">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5" data-testid="summary-peaks">
            <Stat
              label="Highest error rate"
              value={report.peakErrorRate ? formatPercent(report.peakErrorRate.value) : 'n/a'}
              tone={
                report.peakErrorRate && report.peakErrorRate.value >= 0.05
                  ? COLOR.critical
                  : undefined
              }
            />
            <Stat
              label="Highest latency p95"
              value={report.peakP95LatencyMs ? formatMs(report.peakP95LatencyMs.value) : 'n/a'}
            />
            <Stat
              label="Not normal at once"
              value={report.peakUnhealthy ? String(report.peakUnhealthy.value) : '0'}
              unit="services"
            />
            <Stat
              label="Mean error rate"
              value={report.meanErrorRate === null ? 'n/a' : formatPercent(report.meanErrorRate)}
            />
          </dl>
          {report.baseline && (
            <p className="caption mt-2">
              Before the incident: error rate{' '}
              <span className="numeric">{formatPercent(report.baseline.errorRate)}</span>, latency
              p95 <span className="numeric">{formatMs(report.baseline.p95LatencyMs)}</span>.
            </p>
          )}
        </Section>

        {report.objectives.length > 0 && (
          <Section title="Objectives">
            <ul className="space-y-1.5" data-testid="summary-objectives">
              {report.objectives.map((objective) => (
                <li
                  key={objective.kind}
                  className="text-xs leading-snug"
                  data-objective={objective.kind}
                  data-met={objective.breachedMs === 0}
                >
                  <span className="text-ink">{objectiveName(objective)}</span>
                  <span
                    className={
                      objective.breachedMs === 0
                        ? 'block text-ink-faint'
                        : 'block font-bold text-ink'
                    }
                  >
                    {describeObjective(objective, report)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="caption mt-2">
              Observed: the objectives are the ones the engine alerts on, and the time each was not
              met is its samples counted, one a second.
            </p>
          </Section>
        )}

        {report.decisions.length > 0 && (
          <Section title="What Cedar decided">
            <p className="caption mb-1.5">
              For the requests the scenario sends, as the decision events of this run record them.
            </p>
            <ul className="space-y-1" data-testid="summary-decisions">
              {report.decisions.map((decision) => (
                <li key={decision.requestId}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().inspectEvent(decision.firstSeq)}
                    className="w-full rounded-control px-1.5 py-1 text-left hover:bg-raised"
                  >
                    <span className="flex items-center gap-2">
                      <DecisionTag decision={decision.decision} />
                      {/* With what it was asked of: the same principal asks the
                          same action of several resources. */}
                      <span
                        className="min-w-0 flex-1 truncate text-xs text-ink"
                        title={`${entityId(decision.principal)} → ${entityId(decision.action)} on ${entityId(decision.resource)}`}
                      >
                        {entityId(decision.principal)} → {entityId(decision.action)}
                        <span className="text-ink-faint"> on {entityId(decision.resource)}</span>
                      </span>
                      <span className="numeric text-[11px] text-ink-faint">{decision.count}×</span>
                    </span>
                    <span className="code mt-0.5 block truncate text-[11px] text-ink-faint">
                      {decision.determiningPolicies.length > 0
                        ? decision.determiningPolicies.join(', ')
                        : 'no policy permits it: denied by default'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Phases">
          <ol className="space-y-2.5">
            {report.phases.map((phase) => (
              <li key={phase.index}>
                <p className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-bold text-ink">{phase.name}</span>
                  <When report={report} atMs={phase.atMs} />
                </p>
                <PhaseExplanation report={report} phase={phase} />
              </li>
            ))}
          </ol>
        </Section>

        {report.recovery.length > 0 && (
          <Section title="Recovery">
            <Transitions report={report} transitions={report.recovery} testId="summary-recovery" />
          </Section>
        )}
        {report.truncated && (
          <p className="caption px-3 py-2">Some lists were cut to their bound.</p>
        )}
      </div>
    </div>
  );
}

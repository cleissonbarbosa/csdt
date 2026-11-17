/**
 * Words for an incident report.
 *
 * The server reads an incident back from its record and says, for every
 * line, what kind of statement it is. These helpers turn that into the
 * sentences the interface shows and the text someone can take away. They
 * add nothing: a figure or a relation that is not in the report is not in
 * what they write.
 */
import type {
  Cause,
  IncidentReport,
  ReportPhase,
  ReportTransition,
  Topology,
  ReportObjective,
} from '@aegis/contracts';

import { formatClock, formatMs, formatPercent, entityId } from './format';
import { nodeLabel } from './names';

/**
 * The three kinds of statement a report makes, and a fourth for what it
 * declines to explain.
 */
export type Basis = 'prescribed' | 'modelled' | 'by-hand' | 'unexplained';

export const BASIS_LABEL: Record<Basis, string> = {
  prescribed: 'Prescribed',
  modelled: 'Modelled',
  'by-hand': 'By hand',
  unexplained: 'Not explained',
};

export const BASIS_HINT: Record<Basis, string> = {
  prescribed: 'Written in the scenario file: the scenario does this by itself.',
  modelled:
    'A relation of the topology the model follows: a dependency carries failures back to its callers, added traffic flows on to what is called.',
  'by-hand': 'A fault placed by hand was in force on the service.',
  unexplained: 'None of the relations the report knows explains this change. It does not guess.',
};

/** A moment counted from the start of the incident: `+0:14`. */
export function sinceStart(report: Pick<IncidentReport, 'startedAtMs'>, atMs: number): string {
  return atMs >= report.startedAtMs
    ? `+${formatClock(atMs - report.startedAtMs)}`
    : `-${formatClock(report.startedAtMs - atMs)}`;
}

/** The same moment both ways, for a tooltip or a line of text. */
export function bothClocks(report: Pick<IncidentReport, 'startedAtMs'>, atMs: number): string {
  return `${sinceStart(report, atMs)} since the incident began, ${formatClock(atMs)} on the simulation clock`;
}

export interface Explained {
  basis: Basis;
  /** Completes "It became degraded because …" without the "because". */
  text: string;
}

/** Why a service got worse, in words, with the kind of statement it is. */
export function explainCause(cause: Cause, topology: Topology | null): Explained {
  const via = cause.viaNodeId ? nodeLabel(topology, cause.viaNodeId) : 'another service';
  switch (cause.kind) {
    case 'prescribed':
      return {
        basis: 'prescribed',
        text: `the scenario acts on it${cause.effect ? ` (${cause.effect})` : ''}`,
      };
    case 'fault':
      return {
        basis: 'by-hand',
        text: `a fault placed by hand is in force on it${cause.effect ? ` (${cause.effect})` : ''}`,
      };
    case 'dependency': {
      const edge = topology?.edges.find((e) => e.id === cause.edgeId);
      return {
        basis: 'modelled',
        text:
          edge?.relationship === 'consume'
            ? `${via}, which drains it, was already not normal`
            : `it calls ${via}, which was already not normal`,
      };
    }
    case 'load':
      return {
        basis: 'modelled',
        text: `it receives the traffic the scenario adds at ${via}`,
      };
    case 'unattributed':
      return { basis: 'unexplained', text: 'of nothing the report can point to' };
  }
}

/** `Orders DB became degraded at +0:16` */
export function describeTransition(
  report: Pick<IncidentReport, 'startedAtMs'>,
  transition: ReportTransition,
  topology: Topology | null,
): string {
  const verb = transition.to === 'healthy' ? 'was back to normal' : `became ${transition.to}`;
  return `${nodeLabel(topology, transition.nodeId)} ${verb} at ${sinceStart(report, transition.atMs)}`;
}

/** `latency ×6 on Orders DB` */
export function describePrescribed(
  effect: ReportPhase['prescribed'][number],
  topology: Topology | null,
  most = 3,
): string {
  if (effect.nodeIds.length === 0) return effect.description;
  const names = effect.nodeIds.slice(0, most).map((id) => nodeLabel(topology, id));
  const rest = effect.nodeIds.length - names.length;
  return `${effect.description} on ${names.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}

/** Where the incident began, and on what grounds that is said. */
export function describeOrigin(report: IncidentReport, topology: Topology | null): string | null {
  if (!report.origin) return null;
  const name = nodeLabel(topology, report.origin.nodeId);
  switch (report.origin.basis) {
    case 'declared':
      return `${name}: the scenario names it as the root cause.`;
    case 'first-prescribed':
      return `${name}: the first service the scenario acts on.`;
    case 'first-observed':
      return `${name}: the first service seen to leave its normal state.`;
  }
}

/** How the incident stands or ended, in one sentence. */
/** What an objective holds the platform to, in a few words. */
export function objectiveName(objective: ReportObjective): string {
  return objective.kind === 'error-rate'
    ? `Error rate under ${formatPercent(objective.threshold)}`
    : `Latency p95 under ${formatMs(objective.threshold)}`;
}

/**
 * How an objective fared over an incident: met throughout, or not met for
 * how long and from when. The time is the engine's samples counted, so it
 * is said in whole seconds and nothing finer.
 */
export function describeObjective(
  objective: ReportObjective,
  report: Pick<IncidentReport, 'startedAtMs'>,
): string {
  if (objective.breachedMs === 0 || objective.firstBreachedAtMs === null) return 'met throughout';
  return `not met for ${formatClock(objective.breachedMs)}, first at ${sinceStart(report, objective.firstBreachedAtMs)}`;
}

export function describeOutcome(report: IncidentReport): string {
  if (report.resolvedAtMs === null) {
    return `Still running: ${sinceStart(report, report.observedUntilMs)} recorded so far.`;
  }
  const ended = `The scenario ended at ${sinceStart(report, report.resolvedAtMs)}`;
  const how = report.resolution ? ` (${report.resolution.replace(/\.$/, '')})` : '';
  if (report.impactedNodeIds.length === 0) {
    return `${ended}${how}. No service left its normal state.`;
  }
  if (report.recoveredAtMs !== null) {
    return `${ended}${how}. Every affected service was back to normal by ${sinceStart(report, report.recoveredAtMs)}.`;
  }
  const left = report.stillUnhealthyNodeIds.length;
  return `${ended}${how}. ${left} service${left === 1 ? ' was' : 's were'} still not normal at ${sinceStart(report, report.observedUntilMs)}, where the record stops.`;
}

export interface Moment {
  id: string;
  label: string;
  atMs: number;
}

/** The moments of the incident worth going back to, in order. */
export function moments(report: IncidentReport): Moment[] {
  const list: Moment[] = [{ id: 'start', label: 'Start', atMs: report.startedAtMs }];
  for (const phase of report.phases.slice(1)) {
    list.push({ id: `phase-${phase.index}`, label: phase.name, atMs: phase.atMs });
  }
  const first = report.propagation[0];
  if (first) list.push({ id: 'first', label: 'First service affected', atMs: first.atMs });
  if (report.peakErrorRate && report.peakErrorRate.value > 0) {
    list.push({ id: 'peak-errors', label: 'Most errors', atMs: report.peakErrorRate.atMs });
  }
  if (report.peakUnhealthy) {
    list.push({
      id: 'peak-unhealthy',
      label: 'Most services not normal',
      atMs: report.peakUnhealthy.atMs,
    });
  }
  if (report.recoveredAtMs !== null && report.impactedNodeIds.length > 0) {
    list.push({ id: 'recovered', label: 'All back to normal', atMs: report.recoveredAtMs });
  }
  if (report.resolvedAtMs !== null) {
    list.push({ id: 'end', label: 'End', atMs: report.resolvedAtMs });
  }
  return list.sort((a, b) => a.atMs - b.atMs);
}

/**
 * The report as plain text, to paste somewhere else. It says where the
 * figures come from, because away from the application nothing else does.
 */
export function reportText(report: IncidentReport, topology: Topology | null): string {
  const at = (ms: number) => `${sinceStart(report, ms)} (${formatClock(ms)})`;
  const lines: string[] = [
    `${report.title}: incident ${report.incidentId}`,
    `Simulated on ${topology?.name ?? 'the platform'}. Every figure comes from the AEGIS simulation engine; none is measured from a real system.`,
    '',
    describeOutcome(report),
  ];
  const origin = describeOrigin(report, topology);
  if (origin) lines.push('', 'Origin', `  ${origin}`);

  lines.push('', 'Phases (time since the incident began, then the simulation clock)');
  for (const phase of report.phases) {
    lines.push(`  ${at(phase.atMs)} ${phase.name}`);
    for (const effect of phase.prescribed) {
      lines.push(`    prescribed: ${describePrescribed(effect, topology)}`);
    }
  }

  if (report.propagation.length > 0) {
    lines.push('', 'Propagation (the first time each service left its normal state)');
    for (const transition of report.propagation) {
      const why = transition.cause ? explainCause(transition.cause, topology) : null;
      lines.push(
        `  ${describeTransition(report, transition, topology)}${
          why ? `: ${why.text} [${BASIS_LABEL[why.basis].toLowerCase()}]` : ''
        }`,
      );
    }
  }

  lines.push('', 'Impact');
  lines.push(`  Services affected: ${report.impactedNodeIds.length}`);
  if (report.peakUnhealthy) {
    lines.push(
      `  Most services not normal at once: ${report.peakUnhealthy.value} at ${at(report.peakUnhealthy.atMs)}`,
    );
  }
  if (report.peakErrorRate) {
    lines.push(
      `  Highest error rate: ${formatPercent(report.peakErrorRate.value)} at ${at(report.peakErrorRate.atMs)}${
        report.baseline ? `, from ${formatPercent(report.baseline.errorRate)} before` : ''
      }`,
    );
  }
  if (report.peakP95LatencyMs) {
    lines.push(
      `  Highest p95 latency: ${formatMs(report.peakP95LatencyMs.value)} at ${at(report.peakP95LatencyMs.atMs)}${
        report.baseline ? `, from ${formatMs(report.baseline.p95LatencyMs)} before` : ''
      }`,
    );
  }
  if (report.meanErrorRate !== null) {
    lines.push(`  Mean error rate over the incident: ${formatPercent(report.meanErrorRate)}`);
  }
  if (report.objectives.length > 0) {
    lines.push('', 'Objectives (observed)');
    for (const objective of report.objectives) {
      lines.push(`  ${objectiveName(objective)}: ${describeObjective(objective, report)}`);
    }
  }

  if (report.decisions.length > 0) {
    lines.push('', "Cedar's decisions for the scenario's requests");
    for (const decision of report.decisions) {
      lines.push(
        `  ${decision.decision === 'allow' ? 'Allow' : 'Deny'} ${entityId(decision.principal)} -> ${entityId(decision.action)} on ${entityId(decision.resource)}, ${decision.count}x, ${
          decision.determiningPolicies.length > 0
            ? `decided by ${decision.determiningPolicies.join(', ')}`
            : 'denied by default'
        }`,
      );
    }
  }
  if (report.truncated) lines.push('', 'Some lists were cut to their bound.');
  return `${lines.join('\n')}\n`;
}

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
import { HEALTH_LABEL } from './palette';

import { t } from '@/i18n';

/**
 * The three kinds of statement a report makes, and a fourth for what it
 * declines to explain.
 */
export type Basis = 'prescribed' | 'modelled' | 'by-hand' | 'unexplained';

export const BASIS_LABEL: Record<Basis, string> = {
  prescribed: t('Prescribed'),
  modelled: t('Modelled'),
  'by-hand': t('By hand'),
  unexplained: t('Not explained'),
};

export const BASIS_HINT: Record<Basis, string> = {
  prescribed: t('Written in the scenario file: the scenario does this by itself.'),
  modelled: t(
    'A relation of the topology the model follows: a dependency carries failures back to its callers, added traffic flows on to what is called.',
  ),
  'by-hand': t('A fault placed by hand was in force on the service.'),
  unexplained: t('None of the relations the report knows explains this change. It does not guess.'),
};

/** A moment counted from the start of the incident: `+0:14`. */
export function sinceStart(report: Pick<IncidentReport, 'startedAtMs'>, atMs: number): string {
  return atMs >= report.startedAtMs
    ? `+${formatClock(atMs - report.startedAtMs)}`
    : `-${formatClock(report.startedAtMs - atMs)}`;
}

/** The same moment both ways, for a tooltip or a line of text. */
export function bothClocks(report: Pick<IncidentReport, 'startedAtMs'>, atMs: number): string {
  return t('{since} since the incident began, {clock} on the simulation clock', {
    since: sinceStart(report, atMs),
    clock: formatClock(atMs),
  });
}

export interface Explained {
  basis: Basis;
  /**
   * Completes "It became degraded because …" without the "because". The one
   * exception is `unexplained`: in Portuguese it cannot follow the word for
   * "because" ("sem causa que…"), so a sentence that joins the two takes
   * that case as a phrase of its own, as `IncidentReport.tsx` does.
   */
  text: string;
}

/** Why a service got worse, in words, with the kind of statement it is. */
export function explainCause(cause: Cause, topology: Topology | null): Explained {
  const via = cause.viaNodeId ? nodeLabel(topology, cause.viaNodeId) : t('another service');
  // An effect is said as the engine wrote it: `latency ×6`.
  const effect = cause.effect;
  switch (cause.kind) {
    case 'prescribed':
      return {
        basis: 'prescribed',
        text: effect
          ? t('the scenario acts on it ({effect})', { effect })
          : t('the scenario acts on it'),
      };
    case 'fault':
      return {
        basis: 'by-hand',
        text: effect
          ? t('a fault placed by hand is in force on it ({effect})', { effect })
          : t('a fault placed by hand is in force on it'),
      };
    case 'dependency': {
      const edge = topology?.edges.find((e) => e.id === cause.edgeId);
      return {
        basis: 'modelled',
        text:
          edge?.relationship === 'consume'
            ? t('{via}, which drains it, was already not normal', { via })
            : t('it calls {via}, which was already not normal', { via }),
      };
    }
    case 'load':
      return {
        basis: 'modelled',
        text: t('it receives the traffic the scenario adds at {via}', { via }),
      };
    case 'unattributed':
      return { basis: 'unexplained', text: t('of nothing the report can point to') };
  }
}

/** `Orders DB became degraded at +0:16` */
export function describeTransition(
  report: Pick<IncidentReport, 'startedAtMs'>,
  transition: ReportTransition,
  topology: Topology | null,
): string {
  const name = nodeLabel(topology, transition.nodeId);
  const at = sinceStart(report, transition.atMs);
  return transition.to === 'healthy'
    ? t('{name} was back to normal at {at}', { name, at })
    : t('{name} became {state} at {at}', {
        name,
        state: HEALTH_LABEL[transition.to].toLowerCase(),
        at,
      });
}

/** `latency ×6 on Orders DB` */
export function describePrescribed(
  effect: ReportPhase['prescribed'][number],
  topology: Topology | null,
  most = 3,
): string {
  if (effect.nodeIds.length === 0) return effect.description;
  const shown = effect.nodeIds.slice(0, most).map((id) => nodeLabel(topology, id));
  const rest = effect.nodeIds.length - shown.length;
  // The description is the engine's own: `latency ×6`.
  const values = { effect: effect.description, names: shown.join(', '), rest };
  return rest > 0
    ? t('{effect} on {names} and {rest} more', values)
    : t('{effect} on {names}', values);
}

/** Where the incident began, and on what grounds that is said. */
export function describeOrigin(report: IncidentReport, topology: Topology | null): string | null {
  if (!report.origin) return null;
  const name = nodeLabel(topology, report.origin.nodeId);
  switch (report.origin.basis) {
    case 'declared':
      return t('{name}: the scenario names it as the root cause.', { name });
    case 'first-prescribed':
      return t('{name}: the first service the scenario acts on.', { name });
    case 'first-observed':
      return t('{name}: the first service seen to leave its normal state.', { name });
  }
}

/** What an objective holds the platform to, in a few words. */
export function objectiveName(objective: ReportObjective): string {
  return objective.kind === 'error-rate'
    ? t('Error rate under {threshold}', { threshold: formatPercent(objective.threshold) })
    : t('Latency p95 under {threshold}', { threshold: formatMs(objective.threshold) });
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
  if (objective.breachedMs === 0 || objective.firstBreachedAtMs === null) {
    return t('met throughout');
  }
  return t('not met for {duration}, first at {at}', {
    duration: formatClock(objective.breachedMs),
    at: sinceStart(report, objective.firstBreachedAtMs),
  });
}

/** How the incident stands, or how it ended and how the services stood. */
export function describeOutcome(report: IncidentReport): string {
  if (report.resolvedAtMs === null) {
    return t('Still running: {at} recorded so far.', {
      at: sinceStart(report, report.observedUntilMs),
    });
  }
  const at = sinceStart(report, report.resolvedAtMs);
  // How it ended is the engine's sentence, quoted without its full stop.
  const ended = report.resolution
    ? t('The scenario ended at {at} ({how}).', { at, how: report.resolution.replace(/\.$/, '') })
    : t('The scenario ended at {at}.', { at });
  return `${ended} ${afterwards(report)}`;
}

/** How the services stood once the scenario had ended: the second sentence of the outcome. */
function afterwards(report: IncidentReport): string {
  if (report.impactedNodeIds.length === 0) return t('No service left its normal state.');
  if (report.recoveredAtMs !== null) {
    return t('Every affected service was back to normal by {at}.', {
      at: sinceStart(report, report.recoveredAtMs),
    });
  }
  const values = {
    n: report.stillUnhealthyNodeIds.length,
    at: sinceStart(report, report.observedUntilMs),
  };
  return values.n === 1
    ? t('{n} service was still not normal at {at}, where the record stops.', values)
    : t('{n} services were still not normal at {at}, where the record stops.', values);
}

export interface Moment {
  id: string;
  label: string;
  atMs: number;
}

/** The moments of the incident worth going back to, in order. */
export function moments(report: IncidentReport): Moment[] {
  const list: Moment[] = [{ id: 'start', label: t('Start#moment'), atMs: report.startedAtMs }];
  for (const phase of report.phases.slice(1)) {
    list.push({ id: `phase-${phase.index}`, label: phase.name, atMs: phase.atMs });
  }
  const first = report.propagation[0];
  if (first) list.push({ id: 'first', label: t('First service affected'), atMs: first.atMs });
  if (report.peakErrorRate && report.peakErrorRate.value > 0) {
    list.push({ id: 'peak-errors', label: t('Most errors'), atMs: report.peakErrorRate.atMs });
  }
  if (report.peakUnhealthy) {
    list.push({
      id: 'peak-unhealthy',
      label: t('Most services not normal'),
      atMs: report.peakUnhealthy.atMs,
    });
  }
  if (report.recoveredAtMs !== null && report.impactedNodeIds.length > 0) {
    list.push({ id: 'recovered', label: t('All back to normal'), atMs: report.recoveredAtMs });
  }
  if (report.resolvedAtMs !== null) {
    list.push({ id: 'end', label: t('End#moment'), atMs: report.resolvedAtMs });
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
    t('{title}: incident {id}', { title: report.title, id: report.incidentId }),
    topology
      ? t(
          'Simulated on {platform}. Every figure comes from the AEGIS simulation engine; none is measured from a real system.',
          { platform: topology.name },
        )
      : t(
          'Simulated on the platform. Every figure comes from the AEGIS simulation engine; none is measured from a real system.',
        ),
    '',
    describeOutcome(report),
  ];
  const origin = describeOrigin(report, topology);
  if (origin) lines.push('', t('Origin'), `  ${origin}`);

  lines.push('', t('Phases (time since the incident began, then the simulation clock)'));
  for (const phase of report.phases) {
    lines.push(`  ${at(phase.atMs)} ${phase.name}`);
    for (const effect of phase.prescribed) {
      lines.push(
        `    ${t('prescribed: {effect}', { effect: describePrescribed(effect, topology) })}`,
      );
    }
  }

  if (report.propagation.length > 0) {
    lines.push('', t('Propagation (the first time each service left its normal state)'));
    for (const transition of report.propagation) {
      const why = transition.cause ? explainCause(transition.cause, topology) : null;
      lines.push(
        `  ${describeTransition(report, transition, topology)}${
          why ? `: ${why.text} [${BASIS_LABEL[why.basis].toLowerCase()}]` : ''
        }`,
      );
    }
  }

  lines.push('', t('Impact'));
  lines.push(`  ${t('Services affected: {n}', { n: report.impactedNodeIds.length })}`);
  if (report.peakUnhealthy) {
    const values = { n: report.peakUnhealthy.value, at: at(report.peakUnhealthy.atMs) };
    lines.push(`  ${t('Most services not normal at once: {n} at {at}', values)}`);
  }
  if (report.peakErrorRate) {
    const values = {
      peak: formatPercent(report.peakErrorRate.value),
      at: at(report.peakErrorRate.atMs),
    };
    lines.push(
      `  ${
        report.baseline
          ? t('Highest error rate: {peak} at {at}, from {baseline} before', {
              ...values,
              baseline: formatPercent(report.baseline.errorRate),
            })
          : t('Highest error rate: {peak} at {at}', values)
      }`,
    );
  }
  if (report.peakP95LatencyMs) {
    const values = {
      peak: formatMs(report.peakP95LatencyMs.value),
      at: at(report.peakP95LatencyMs.atMs),
    };
    lines.push(
      `  ${
        report.baseline
          ? t('Highest p95 latency: {peak} at {at}, from {baseline} before', {
              ...values,
              baseline: formatMs(report.baseline.p95LatencyMs),
            })
          : t('Highest p95 latency: {peak} at {at}', values)
      }`,
    );
  }
  if (report.meanErrorRate !== null) {
    lines.push(
      `  ${t('Mean error rate over the incident: {rate}', { rate: formatPercent(report.meanErrorRate) })}`,
    );
  }
  if (report.objectives.length > 0) {
    lines.push('', t('Objectives (observed)'));
    for (const objective of report.objectives) {
      lines.push(`  ${objectiveName(objective)}: ${describeObjective(objective, report)}`);
    }
  }

  if (report.decisions.length > 0) {
    lines.push('', t("Cedar's decisions for the scenario's requests"));
    for (const decision of report.decisions) {
      // Entity ids and policy ids are Cedar's, the same in every language.
      const values = {
        decision: decision.decision === 'allow' ? t('Allow') : t('Deny'),
        principal: entityId(decision.principal),
        action: entityId(decision.action),
        resource: entityId(decision.resource),
        count: decision.count,
        why:
          decision.determiningPolicies.length > 0
            ? t('decided by {policies}', { policies: decision.determiningPolicies.join(', ') })
            : t('denied by default'),
      };
      lines.push(
        `  ${t('{decision} {principal} -> {action} on {resource}, {count}x, {why}', values)}`,
      );
    }
  }
  if (report.truncated) lines.push('', t('Some lists were cut to their bound.'));
  return `${lines.join('\n')}\n`;
}

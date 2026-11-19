/**
 * Two runs of one incident, laid side by side.
 *
 * The server runs a scenario twice from the same seed, the second time with
 * one fault placed (`/demo/experiments/compare`) or on the platform a set of
 * files describes (`/demo/experiments/platforms`), and reports both. These
 * helpers line the two reports up and say by how much each figure differs.
 * Every figure is read from the reports; nothing is computed about the
 * platform here.
 */
import type { Experiment, ExperimentRun, FaultEffect, MetricSample } from '@aegis/contracts';

import { formatClock, formatMs, formatPercent } from './format';

import { t } from '@/i18n';

/** Two runs of one incident: `variant` is read against `baseline`. */
export interface Runs {
  baseline: ExperimentRun;
  variant: ExperimentRun;
}

export interface ComparedRow {
  id: string;
  label: string;
  /** The run as it is. */
  a: string;
  /** The run with the intervention. */
  b: string;
  /** B against A, signed, in the figure's own unit; empty when equal or not comparable. */
  delta: string;
}

function signed(value: number, text: (magnitude: number) => string): string {
  if (Math.abs(value) < 1e-9) return '';
  return `${value > 0 ? '+' : '−'}${text(Math.abs(value))}`;
}

/** A difference of two fractions, in percentage points. */
function points(a: number, b: number): string {
  return signed((b - a) * 100, (v) => t('{n} pts', { n: v < 10 ? v.toFixed(2) : v.toFixed(1) }));
}

/** When a run was back to normal, counted from the start of its incident. */
function recovery(run: ExperimentRun): { text: string; ms: number | null } {
  const { report } = run;
  if (report.impactedNodeIds.length === 0) return { text: t('nothing was affected'), ms: null };
  if (report.recoveredAtMs === null) return { text: t('not within the run'), ms: null };
  const ms = report.recoveredAtMs - report.startedAtMs;
  return { text: `+${formatClock(ms)}`, ms };
}

/** The figures of the two runs, row by row. */
export function comparedRows(runs: Runs): ComparedRow[] {
  const a = runs.baseline.report;
  const b = runs.variant.report;
  const rows: ComparedRow[] = [];
  const peak = (value: { value: number } | null) => value?.value ?? null;

  const errorA = peak(a.peakErrorRate);
  const errorB = peak(b.peakErrorRate);
  rows.push({
    id: 'peak-error',
    label: t('Highest error rate'),
    a: errorA === null ? t('n/a') : formatPercent(errorA),
    b: errorB === null ? t('n/a') : formatPercent(errorB),
    delta: errorA === null || errorB === null ? '' : points(errorA, errorB),
  });
  rows.push({
    id: 'mean-error',
    label: t('Mean error rate'),
    a: a.meanErrorRate === null ? t('n/a') : formatPercent(a.meanErrorRate),
    b: b.meanErrorRate === null ? t('n/a') : formatPercent(b.meanErrorRate),
    delta:
      a.meanErrorRate === null || b.meanErrorRate === null
        ? ''
        : points(a.meanErrorRate, b.meanErrorRate),
  });
  const latencyA = peak(a.peakP95LatencyMs);
  const latencyB = peak(b.peakP95LatencyMs);
  rows.push({
    id: 'peak-latency',
    label: t('Highest latency p95'),
    a: latencyA === null ? t('n/a') : formatMs(latencyA),
    b: latencyB === null ? t('n/a') : formatMs(latencyB),
    delta:
      latencyA === null || latencyB === null ? '' : signed(latencyB - latencyA, (v) => formatMs(v)),
  });
  rows.push({
    id: 'affected',
    label: t('Services affected'),
    a: String(a.impactedNodeIds.length),
    b: String(b.impactedNodeIds.length),
    delta: signed(b.impactedNodeIds.length - a.impactedNodeIds.length, (v) => String(v)),
  });
  const unwellA = peak(a.peakUnhealthy) ?? 0;
  const unwellB = peak(b.peakUnhealthy) ?? 0;
  rows.push({
    id: 'at-once',
    label: t('Not normal at once'),
    a: String(unwellA),
    b: String(unwellB),
    delta: signed(unwellB - unwellA, (v) => String(v)),
  });
  // How long each objective was not met, where both runs report it.
  for (const objective of a.objectives) {
    const other = b.objectives.find((entry) => entry.kind === objective.kind);
    if (!other) continue;
    const time = (ms: number) => (ms === 0 ? t('met throughout') : formatClock(ms));
    const figure = objective.kind === 'error-rate' ? formatPercent : formatMs;
    // An objective on latency is a multiple of the platform's own latency at
    // rest, so two platforms may each have theirs: then each run says which.
    const shared = other.threshold === objective.threshold;
    const cell = (entry: typeof objective) =>
      shared
        ? time(entry.breachedMs)
        : t('{time} (objective {threshold})', {
            time: time(entry.breachedMs),
            threshold: figure(entry.threshold),
          });
    rows.push({
      id: `objective-${objective.kind}`,
      label: !shared
        ? objective.kind === 'error-rate'
          ? t('Error rate at its objective or over for')
          : t('Latency p95 at its objective or over for')
        : objective.kind === 'error-rate'
          ? t('Error rate at {threshold} or over for', {
              threshold: formatPercent(objective.threshold),
            })
          : t('Latency p95 at {threshold} or over for', {
              threshold: formatMs(objective.threshold),
            }),
      a: cell(objective),
      b: cell(other),
      delta: signed(other.breachedMs - objective.breachedMs, (v) => formatClock(v)),
    });
  }
  const backA = recovery(runs.baseline);
  const backB = recovery(runs.variant);
  rows.push({
    id: 'recovered',
    label: t('All back to normal'),
    a: backA.text,
    b: backB.text,
    delta:
      backA.ms === null || backB.ms === null
        ? ''
        : signed(backB.ms - backA.ms, (v) => formatClock(v)),
  });
  return rows;
}

/** Services one run affected and the other did not. */
export function affectedOnlyIn(runs: Runs): { a: string[]; b: string[] } {
  const a = runs.baseline.report.impactedNodeIds;
  const b = runs.variant.report.impactedNodeIds;
  return {
    a: a.filter((id) => !b.includes(id)),
    b: b.filter((id) => !a.includes(id)),
  };
}

/** When the intervention is placed, on the clock of the runs. */
export function placedAtMs(experiment: Experiment): number {
  return experiment.incidentStartedAtMs + experiment.intervention.atMs;
}

/** Whether the two runs are the same up to the intervention, sample for sample. */
export function sameUntilPlaced(experiment: Experiment): boolean {
  const until = placedAtMs(experiment);
  const before = (samples: MetricSample[]) => samples.filter((s) => s.virtualTimeMs < until);
  const a = before(experiment.baseline.samples);
  const b = before(experiment.variant.samples);
  return (
    a.length === b.length &&
    a.every((sample, i) => {
      const other = b[i]!;
      return (
        sample.virtualTimeMs === other.virtualTimeMs &&
        sample.errorRate === other.errorRate &&
        sample.p95LatencyMs === other.p95LatencyMs &&
        sample.rps === other.rps
      );
    })
  );
}

/** What can be changed in the second run, and the figure each starts from. */
export type InterventionKind = 'capacity' | 'latency' | 'errorInject' | 'down';

export const INTERVENTIONS: readonly {
  kind: InterventionKind;
  label: string;
  /** What the figure is, or `null` when there is none to give. */
  unit: 'factor' | 'percent' | null;
  value: number;
  hint: string;
}[] = [
  {
    kind: 'capacity',
    label: t('Change its capacity'),
    unit: 'factor',
    value: 2,
    hint: t('Above 1 scales the service up; below 1 takes capacity away.'),
  },
  {
    kind: 'latency',
    label: t('Change its latency'),
    unit: 'factor',
    value: 0.5,
    hint: t('Below 1 makes the service faster; above 1 slower.'),
  },
  {
    kind: 'errorInject',
    label: t('Make a share of its requests fail'),
    unit: 'percent',
    value: 20,
    hint: t('A share of the requests it handles, from 0 to 100.'),
  },
  {
    kind: 'down',
    label: t('Take it out of service'),
    unit: null,
    value: 1,
    hint: t('The service becomes unreachable for the rest of the run.'),
  },
];

/** The effect to place, in the format a scenario phase writes it in. */
export function interventionEffect(
  kind: InterventionKind,
  nodeId: string,
  value: number,
): FaultEffect {
  const nodes = `node:${nodeId}`;
  switch (kind) {
    case 'capacity':
    case 'latency':
      return { type: kind, nodes, factor: value };
    case 'errorInject':
      return { type: 'errorInject', nodes, rate: value / 100 };
    case 'down':
      return { type: 'down', nodes };
  }
}

// -- one intervention at several figures ------------------------------------

/** The figures a sweep starts from, for a kind of intervention that has one. */
export const SWEEP_VALUES: Record<'factor' | 'percent', readonly number[]> = {
  factor: [0.5, 1, 1.5, 2, 3],
  percent: [5, 10, 20, 40],
};
/** Most figures tried in one sweep: each is two simulated runs. */
export const MAX_SWEEP = 8;

/**
 * The figures written in a field, in the order they were written, without
 * repeats. `null` when something in it is not a figure, there are none, or
 * there are too many to run.
 */
export function parseSweep(text: string, unit: 'factor' | 'percent'): number[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0 || parts.length > MAX_SWEEP) return null;
  const values: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0 || (unit === 'percent' && value > 100)) return null;
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

/** One run of a sweep, read from its report: what the figure it was run at did. */
export interface SweepPoint {
  value: number;
  peakErrorRate: number | null;
  peakP95LatencyMs: number | null;
  affected: number;
  /** When everything was back to normal, from the start of the incident; `null` if not within the run. */
  recoveredMs: number | null;
}

export interface Sweep {
  /** The incident as it is: the same in every comparison, since the seed is. */
  baseline: Omit<SweepPoint, 'value'>;
  points: SweepPoint[];
}

function pointOf(run: ExperimentRun): Omit<SweepPoint, 'value'> {
  const { report } = run;
  return {
    peakErrorRate: report.peakErrorRate?.value ?? null,
    peakP95LatencyMs: report.peakP95LatencyMs?.value ?? null,
    affected: report.impactedNodeIds.length,
    recoveredMs:
      report.recoveredAtMs === null || report.impactedNodeIds.length === 0
        ? null
        : report.recoveredAtMs - report.startedAtMs,
  };
}

/**
 * Several comparisons of one incident, each with the same intervention at
 * another figure, lined up by figure. Every number is read from a report of
 * a run the engine made; none is interpolated between two figures.
 */
export function sweepOf(runs: readonly { value: number; experiment: Experiment }[]): Sweep | null {
  const first = runs[0];
  if (!first) return null;
  return {
    baseline: pointOf(first.experiment.baseline),
    points: runs
      .map((run) => ({ value: run.value, ...pointOf(run.experiment.variant) }))
      .sort((a, b) => a.value - b.value),
  };
}

/** The figure of a sweep at which a measure was lowest, the smaller figure on a tie. */
export function lowestAt(
  sweep: Sweep,
  measure: (point: Omit<SweepPoint, 'value'>) => number | null,
): number | null {
  let best: { value: number; measured: number } | null = null;
  for (const point of sweep.points) {
    const measured = measure(point);
    if (measured === null) continue;
    if (best === null || measured < best.measured - 1e-12) best = { value: point.value, measured };
  }
  return best?.value ?? null;
}

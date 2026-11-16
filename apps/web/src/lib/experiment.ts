/**
 * Two runs of one incident, laid side by side.
 *
 * The server runs a scenario twice from the same seed, the second time with
 * one fault placed, and reports both (`/demo/experiments/compare`). These
 * helpers line the two reports up and say by how much each figure differs.
 * Every figure is read from the reports; nothing is computed about the
 * platform here.
 */
import type { Experiment, ExperimentRun, FaultEffect, MetricSample } from '@aegis/contracts';

import { formatClock, formatMs, formatPercent } from './format';

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
  return signed((b - a) * 100, (v) => `${v < 10 ? v.toFixed(2) : v.toFixed(1)} pts`);
}

/** When a run was back to normal, counted from the start of its incident. */
function recovery(run: ExperimentRun): { text: string; ms: number | null } {
  const { report } = run;
  if (report.impactedNodeIds.length === 0) return { text: 'nothing was affected', ms: null };
  if (report.recoveredAtMs === null) return { text: 'not within the run', ms: null };
  const ms = report.recoveredAtMs - report.startedAtMs;
  return { text: `+${formatClock(ms)}`, ms };
}

/** The figures of the two runs, row by row. */
export function comparedRows(experiment: Experiment): ComparedRow[] {
  const a = experiment.baseline.report;
  const b = experiment.variant.report;
  const rows: ComparedRow[] = [];
  const peak = (value: { value: number } | null) => value?.value ?? null;

  const errorA = peak(a.peakErrorRate);
  const errorB = peak(b.peakErrorRate);
  rows.push({
    id: 'peak-error',
    label: 'Highest error rate',
    a: errorA === null ? 'n/a' : formatPercent(errorA),
    b: errorB === null ? 'n/a' : formatPercent(errorB),
    delta: errorA === null || errorB === null ? '' : points(errorA, errorB),
  });
  rows.push({
    id: 'mean-error',
    label: 'Mean error rate',
    a: a.meanErrorRate === null ? 'n/a' : formatPercent(a.meanErrorRate),
    b: b.meanErrorRate === null ? 'n/a' : formatPercent(b.meanErrorRate),
    delta:
      a.meanErrorRate === null || b.meanErrorRate === null
        ? ''
        : points(a.meanErrorRate, b.meanErrorRate),
  });
  const latencyA = peak(a.peakP95LatencyMs);
  const latencyB = peak(b.peakP95LatencyMs);
  rows.push({
    id: 'peak-latency',
    label: 'Highest latency p95',
    a: latencyA === null ? 'n/a' : formatMs(latencyA),
    b: latencyB === null ? 'n/a' : formatMs(latencyB),
    delta:
      latencyA === null || latencyB === null ? '' : signed(latencyB - latencyA, (v) => formatMs(v)),
  });
  rows.push({
    id: 'affected',
    label: 'Services affected',
    a: String(a.impactedNodeIds.length),
    b: String(b.impactedNodeIds.length),
    delta: signed(b.impactedNodeIds.length - a.impactedNodeIds.length, (v) => String(v)),
  });
  const unwellA = peak(a.peakUnhealthy) ?? 0;
  const unwellB = peak(b.peakUnhealthy) ?? 0;
  rows.push({
    id: 'at-once',
    label: 'Not normal at once',
    a: String(unwellA),
    b: String(unwellB),
    delta: signed(unwellB - unwellA, (v) => String(v)),
  });
  const backA = recovery(experiment.baseline);
  const backB = recovery(experiment.variant);
  rows.push({
    id: 'recovered',
    label: 'All back to normal',
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
export function affectedOnlyIn(experiment: Experiment): { a: string[]; b: string[] } {
  const a = experiment.baseline.report.impactedNodeIds;
  const b = experiment.variant.report.impactedNodeIds;
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
    label: 'Change its capacity',
    unit: 'factor',
    value: 2,
    hint: 'Above 1 scales the service up; below 1 takes capacity away.',
  },
  {
    kind: 'latency',
    label: 'Change its latency',
    unit: 'factor',
    value: 0.5,
    hint: 'Below 1 makes the service faster; above 1 slower.',
  },
  {
    kind: 'errorInject',
    label: 'Make a share of its requests fail',
    unit: 'percent',
    value: 20,
    hint: 'A share of the requests it handles, from 0 to 100.',
  },
  {
    kind: 'down',
    label: 'Take it out of service',
    unit: null,
    value: 1,
    hint: 'The service becomes unreachable for the rest of the run.',
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

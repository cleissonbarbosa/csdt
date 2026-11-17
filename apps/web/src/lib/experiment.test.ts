import { describe, expect, it } from 'vitest';

import { experiment as sampleExperiment } from '@/test/fixtures';

import {
  affectedOnlyIn,
  comparedRows,
  INTERVENTIONS,
  interventionEffect,
  lowestAt,
  MAX_SWEEP,
  parseSweep,
  placedAtMs,
  sameUntilPlaced,
  sweepOf,
} from './experiment';
import { formatPercent } from './format';

const experiment = sampleExperiment();

describe('two runs of one incident', () => {
  it('are lined up figure by figure, each read from its own report', () => {
    const rows = comparedRows(experiment);
    expect(rows.map((row) => row.id)).toEqual([
      'peak-error',
      'mean-error',
      'peak-latency',
      'affected',
      'at-once',
      'objective-error-rate',
      'objective-latency-p95',
      'recovered',
    ]);
    // With three times the capacity the error objective is met throughout,
    // where the incident as it is misses it for seventeen seconds.
    const errors = rows.find((row) => row.id === 'objective-error-rate')!;
    expect(errors.label).toBe('Error rate at 5.00% or over for');
    expect(errors.a).toBe('0:17');
    expect(errors.b).toBe('met throughout');
    expect(errors.delta).toBe('−0:17');
    expect(rows.find((row) => row.id === 'objective-latency-p95')).toMatchObject({
      a: 'met throughout',
      b: 'met throughout',
      delta: '',
    });
    const peak = rows[0]!;
    expect(peak.a).toBe(formatPercent(experiment.baseline.report.peakErrorRate!.value));
    expect(peak.b).toBe(formatPercent(experiment.variant.report.peakErrorRate!.value));
    const affected = rows.find((row) => row.id === 'affected')!;
    expect(affected.a).toBe(String(experiment.baseline.report.impactedNodeIds.length));
    expect(affected.b).toBe(String(experiment.variant.report.impactedNodeIds.length));
  });

  it('give the difference a sign, and none where there is no difference', () => {
    const same = { ...experiment, variant: experiment.baseline };
    expect(comparedRows(same).every((row) => row.delta === '')).toBe(true);
    // Three times the capacity of authentication lowers the peak of errors.
    const peak = comparedRows(experiment)[0]!;
    expect(
      experiment.variant.report.peakErrorRate!.value <
        experiment.baseline.report.peakErrorRate!.value,
    ).toBe(true);
    expect(peak.delta).toMatch(/^−\d+\.\d+ pts$/);
  });

  it('say which services only one of them affected', () => {
    const only = affectedOnlyIn(experiment);
    const a = experiment.baseline.report.impactedNodeIds;
    const b = experiment.variant.report.impactedNodeIds;
    expect(only.a.every((id) => a.includes(id) && !b.includes(id))).toBe(true);
    expect(only.b.every((id) => b.includes(id) && !a.includes(id))).toBe(true);
    expect(affectedOnlyIn({ ...experiment, variant: experiment.baseline })).toEqual({
      a: [],
      b: [],
    });
  });

  it('are one run until the change is placed', () => {
    expect(placedAtMs(experiment)).toBe(
      experiment.incidentStartedAtMs + experiment.intervention.atMs,
    );
    expect(sameUntilPlaced(experiment)).toBe(true);
    // A comparison whose runs part ways earlier would be flagged.
    const tampered = structuredClone(experiment);
    tampered.variant.samples[2]!.errorRate = 0.5;
    expect(sameUntilPlaced(tampered)).toBe(false);
  });
});

describe('an intervention', () => {
  it('is written as the scenario effect it is', () => {
    expect(interventionEffect('capacity', 'use-auth', 3)).toEqual({
      type: 'capacity',
      nodes: 'node:use-auth',
      factor: 3,
    });
    expect(interventionEffect('latency', 'db', 0.5)).toEqual({
      type: 'latency',
      nodes: 'node:db',
      factor: 0.5,
    });
    // The form asks for a percentage; the file holds a share.
    expect(interventionEffect('errorInject', 'db', 20)).toEqual({
      type: 'errorInject',
      nodes: 'node:db',
      rate: 0.2,
    });
    expect(interventionEffect('down', 'db', 1)).toEqual({ type: 'down', nodes: 'node:db' });
  });

  it('is offered for every kind the form lists', () => {
    for (const choice of INTERVENTIONS) {
      expect(interventionEffect(choice.kind, 'x', choice.value).type).toBe(choice.kind);
    }
  });
});

describe('one intervention at several figures', () => {
  /** The sample's comparison, as if it had been run at another figure with another outcome. */
  const at = (value: number, peakError: number) => ({
    value,
    experiment: {
      ...experiment,
      variant: {
        ...experiment.variant,
        report: {
          ...experiment.variant.report,
          peakErrorRate: { value: peakError, atMs: 0 },
        },
      },
    } as typeof experiment,
  });

  it('reads the figures written in a field, and refuses what is not one', () => {
    expect(parseSweep('0.5, 1, 2', 'factor')).toEqual([0.5, 1, 2]);
    expect(parseSweep(' 5;10  20 ', 'percent')).toEqual([5, 10, 20]);
    // Written twice is run once.
    expect(parseSweep('2, 2, 3', 'factor')).toEqual([2, 3]);
    expect(parseSweep('', 'factor')).toBeNull();
    expect(parseSweep('1, two', 'factor')).toBeNull();
    expect(parseSweep('-1', 'factor')).toBeNull();
    expect(parseSweep('120', 'percent')).toBeNull();
    expect(
      parseSweep(Array.from({ length: MAX_SWEEP + 1 }, (_, i) => i).join(','), 'factor'),
    ).toBeNull();
  });

  it('lines the runs up by figure, each number read from its own report', () => {
    const sweep = sweepOf([at(3, 0.31), at(1, 0.22), at(2, 0.4)])!;
    expect(sweep.points.map((point) => point.value)).toEqual([1, 2, 3]);
    expect(sweep.points.map((point) => point.peakErrorRate)).toEqual([0.22, 0.4, 0.31]);
    // The incident as it is does not depend on the figure tried.
    expect(sweep.baseline.peakErrorRate).toBe(experiment.baseline.report.peakErrorRate?.value);
    expect(sweep.baseline.affected).toBe(experiment.baseline.report.impactedNodeIds.length);
    expect(sweepOf([])).toBeNull();
  });

  it('says at which figure a measure was lowest', () => {
    const sweep = sweepOf([at(1, 0.22), at(2, 0.4), at(3, 0.22)])!;
    // The smaller figure on a tie: the least that was needed.
    expect(lowestAt(sweep, (point) => point.peakErrorRate)).toBe(1);
    expect(lowestAt(sweep, () => null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { experiment as sampleExperiment } from '@/test/fixtures';

import {
  affectedOnlyIn,
  comparedRows,
  INTERVENTIONS,
  interventionEffect,
  placedAtMs,
  sameUntilPlaced,
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
      'recovered',
    ]);
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

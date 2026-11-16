import type { Cause } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import { incidentReport, topology as sampleTopology } from '@/test/fixtures';

import {
  bothClocks,
  describeOrigin,
  describeOutcome,
  describePrescribed,
  explainCause,
  moments,
  reportText,
  sinceStart,
} from './report';

const report = incidentReport();
const topology = sampleTopology();

describe('an incident report in words', () => {
  it('times a moment from the start of the incident, and says both clocks', () => {
    expect(sinceStart(report, report.startedAtMs)).toBe('+0:00');
    expect(sinceStart(report, report.startedAtMs + 14_000)).toBe('+0:14');
    expect(sinceStart(report, report.startedAtMs - 2000)).toBe('-0:02');
    // The incident began at 0:08 on the clock: the two differ by that.
    expect(bothClocks(report, report.startedAtMs + 14_000)).toBe(
      '+0:14 since the incident began, 0:22 on the simulation clock',
    );
  });

  it('says what kind of statement each cause is', () => {
    const cause = (kind: Cause['kind'], extra: Partial<Cause> = {}): Cause => ({ kind, ...extra });
    expect(explainCause(cause('prescribed', { effect: 'latency ×6' }), topology)).toEqual({
      basis: 'prescribed',
      text: 'the scenario acts on it (latency ×6)',
    });
    expect(
      explainCause(
        cause('dependency', { viaNodeId: 'use-orders-db', edgeId: 'use-orders->use-orders-db' }),
        topology,
      ),
    ).toEqual({
      basis: 'modelled',
      text: 'it calls Orders DB, US East · Primary, which was already not normal',
    });
    expect(explainCause(cause('load', { viaNodeId: 'use-gateway' }), topology).basis).toBe(
      'modelled',
    );
    expect(explainCause(cause('fault', { effect: 'capacity ×2' }), topology).basis).toBe('by-hand');
    // What the report cannot explain is said to be unexplained, not guessed.
    expect(explainCause(cause('unattributed'), topology)).toEqual({
      basis: 'unexplained',
      text: 'of nothing the report can point to',
    });
  });

  it('names a queue’s consumer as what drains it', () => {
    const consume = topology.edges.find((edge) => edge.relationship === 'consume');
    if (!consume) throw new Error('the sample topology has a queue');
    const why = explainCause(
      { kind: 'dependency', viaNodeId: consume.target, edgeId: consume.id },
      topology,
    );
    expect(why.text).toMatch(/which drains it, was already not normal$/);
  });

  it('says where it began and on what grounds', () => {
    expect(describeOrigin(report, topology)).toBe(
      'Identity Service, US East · Primary: the scenario names it as the root cause.',
    );
    expect(
      describeOrigin(
        { ...report, origin: { nodeId: 'use-auth', basis: 'first-observed' } },
        topology,
      ),
    ).toMatch(/the first service seen to leave its normal state/);
    expect(describeOrigin({ ...report, origin: null }, topology)).toBeNull();
  });

  it('writes an effect out with the services it acts on', () => {
    const [first] = report.phases[0]!.prescribed;
    expect(describePrescribed(first!, topology)).toMatch(
      /^injected traffic .* on Global Edge Router/,
    );
    expect(
      describePrescribed(
        { description: 'unreachable', nodeIds: ['a', 'b', 'c', 'd', 'e'], edgeIds: [] },
        null,
        3,
      ),
    ).toBe('unreachable on a, b, c and 2 more');
  });

  it('says how the incident stands without claiming an end it has not had', () => {
    // The sample is taken while the incident runs.
    expect(report.resolvedAtMs).toBeNull();
    expect(describeOutcome(report)).toBe('Still running: +0:23 recorded so far.');
    const ended = {
      ...report,
      resolvedAtMs: report.startedAtMs + 90_000,
      resolution: 'The scenario ran to completion.',
    };
    expect(describeOutcome({ ...ended, recoveredAtMs: report.startedAtMs + 60_000 })).toBe(
      'The scenario ended at +1:30 (The scenario ran to completion). Every affected service was back to normal by +1:00.',
    );
    expect(
      describeOutcome({
        ...ended,
        observedUntilMs: report.startedAtMs + 100_000,
        stillUnhealthyNodeIds: ['use-auth'],
      }),
    ).toMatch(/1 service was still not normal at \+1:40, where the record stops\.$/);
    expect(describeOutcome({ ...ended, impactedNodeIds: [] })).toMatch(
      /No service left its normal state\.$/,
    );
  });

  it('lists the moments worth going back to, in order, all inside the record', () => {
    const list = moments(report);
    expect(list[0]).toEqual({ id: 'start', label: 'Start', atMs: report.startedAtMs });
    expect(list.map((moment) => moment.atMs)).toEqual(
      [...list.map((moment) => moment.atMs)].sort((a, b) => a - b),
    );
    for (const moment of list) {
      expect(moment.atMs).toBeGreaterThanOrEqual(report.startedAtMs);
      expect(moment.atMs).toBeLessThanOrEqual(report.observedUntilMs);
    }
    // An incident that has not ended has no end to go to.
    expect(list.some((moment) => moment.id === 'end' || moment.id === 'recovered')).toBe(false);
    expect(list.some((moment) => moment.id === 'peak-errors')).toBe(true);
  });

  it('can be taken away as text that says where its figures come from', () => {
    const text = reportText(report, topology);
    expect(text).toContain('Credential Stuffing: incident inc-001');
    expect(text).toContain('Every figure comes from the AEGIS simulation engine');
    expect(text).toContain('Identity Service, US East · Primary: the scenario names it');
    // Each affected service, with why and what kind of statement that is.
    for (const transition of report.propagation) {
      expect(text).toContain(`[${transition.cause?.kind === 'prescribed' ? 'prescribed' : ''}`);
    }
    expect(text).toContain(`Services affected: ${report.impactedNodeIds.length}`);
    // The peak it quotes is the report's own.
    expect(text).toContain('Highest error rate: 7.39%');
    expect(text.endsWith('\n')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { headroom as sampleHeadroom, weakPoints } from '@/test/fixtures';

import { firstToLeave, objectiveLabel, objectivesMissed, timesDemand } from './limits';

const headroom = sampleHeadroom();

describe('how much demand the platform takes', () => {
  it('is two of the multiples that were run, and nothing between them', () => {
    const factors = headroom.steps.map((step) => step.factor);
    expect(factors).toContain(headroom.givesAt);
    expect(factors).toContain(headroom.holdsAt);
    expect(headroom.holdsAt!).toBeLessThan(headroom.givesAt!);
    // No multiple tried lies between the two: that is what narrowing means.
    expect(factors.filter((f) => f > headroom.holdsAt! && f < headroom.givesAt!)).toEqual([]);
    for (const step of headroom.steps) {
      expect(step.missed.length > 0).toBe(step.factor >= headroom.givesAt!);
    }
  });

  it('is written as a multiple, as the engine gave it', () => {
    expect(timesDemand(2)).toBe('×2');
    expect(timesDemand(2.04)).toBe('×2.04');
  });

  it('names the objective that was missed with the figure it holds the platform under', () => {
    expect(objectiveLabel('error-rate')).toBe('error rate');
    expect(objectivesMissed(headroom, ['error-rate'])).toBe('error rate at 5.00% or over');
    const latency = headroom.objectives.find((entry) => entry.kind === 'latency-p95')!;
    expect(objectivesMissed(headroom, ['error-rate', 'latency-p95'])).toBe(
      `error rate at 5.00% or over; latency p95 at ${latency.threshold.toFixed(0)} ms or over`,
    );
    // An objective the answer does not list is still named.
    expect(objectivesMissed({ objectives: [] }, ['latency-p95'])).toBe('latency p95');
  });

  it('says which service leaves normal first, which may be before any objective is missed', () => {
    const first = firstToLeave(headroom)!;
    const step = headroom.steps.find((entry) => entry.factor === first.factor)!;
    expect(step.first).toEqual(first.effect);
    expect(headroom.steps.filter((entry) => entry.factor < first.factor)).toSatisfy(
      (earlier: typeof headroom.steps) => earlier.every((entry) => entry.first === null),
    );
    // On the bundled platform a worker degrades while the objectives hold.
    expect(first.factor).toBeLessThan(headroom.givesAt!);
    expect(firstToLeave({ steps: [] })).toBeNull();
  });
});

describe('what each service takes with it', () => {
  const points = weakPoints();

  it('lists every service once, the one that takes the most first', () => {
    const ids = points.points.map((point) => point.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
    const taken = points.points.map((point) => point.affected.length);
    expect(taken).toEqual([...taken].sort((a, b) => b - a));
    for (const point of points.points) {
      expect(point.affected.map((effect) => effect.nodeId)).not.toContain(point.nodeId);
    }
  });
});

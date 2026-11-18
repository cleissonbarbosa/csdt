import { describe, expect, it } from 'vitest';

import { PACE_MAX, PACE_MIN, paceOf, referenceThroughput } from './pace';

const node = (serviceType: string, throughputRps: number) => ({
  serviceType,
  metrics: { throughputRps },
});

describe('the pace of a mechanism', () => {
  it('is 1 at the traffic the service is measured against', () => {
    expect(paceOf(480, 480)).toBe(1);
  });

  it('stands still when nothing passes', () => {
    expect(paceOf(0, 480)).toBe(0);
    expect(paceOf(4, 480)).toBe(0);
    expect(paceOf(Number.NaN, 480)).toBe(0);
    expect(paceOf(480, 0)).toBe(0);
  });

  it('is a number whatever it is given, so a mechanism never carries one that is not', () => {
    for (const [throughput, reference] of [
      [Infinity, Infinity],
      [Infinity, 480],
      [480, Infinity],
      [Math.fround(1e300), Math.fround(1e300)],
    ] as const) {
      expect(Number.isNaN(paceOf(throughput, reference)), `${throughput}/${reference}`).toBe(false);
    }
    expect(paceOf(Infinity, Infinity)).toBe(0);
  });

  it('follows the traffic, within what still reads as running', () => {
    expect(paceOf(960, 480)).toBeGreaterThan(paceOf(480, 480));
    expect(paceOf(240, 480)).toBeLessThan(paceOf(480, 480));
    expect(paceOf(48, 480)).toBe(PACE_MIN);
    expect(paceOf(480_000, 480)).toBe(PACE_MAX);
  });

  it('never decreases as traffic grows', () => {
    let last = 0;
    for (let rate = 0; rate <= 5000; rate += 25) {
      const pace = paceOf(rate, 480);
      expect(pace).toBeGreaterThanOrEqual(last);
      last = pace;
    }
  });
});

describe('what a service is measured against', () => {
  it('is its own traffic when it has any', () => {
    expect([...referenceThroughput([node('database', 900), node('database', 300)])]).toEqual([
      900, 300,
    ]);
  });

  it('is the typical service of its type when it has none', () => {
    const reference = referenceThroughput([
      node('external-client', 0),
      node('external-client', 100),
      node('external-client', 700),
      node('external-client', 300),
      node('database', 5000),
    ]);
    expect(reference[0]).toBe(300);
  });

  it('falls back to the platform, and never to zero', () => {
    expect([...referenceThroughput([node('storage', 0), node('database', 200)])]).toEqual([
      200, 200,
    ]);
    expect([...referenceThroughput([node('storage', 0)])]).toEqual([1]);
  });
});

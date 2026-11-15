import { describe, expect, it } from 'vitest';

import { AdaptiveQuality, FrameStats, QUALITY, QUALITY_ORDER } from './quality';

/** Feeds `seconds` of frames of a fixed duration; returns the level changes. */
function run(quality: AdaptiveQuality, frameMs: number, seconds: number) {
  const changes: string[] = [];
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += frameMs) {
    const next = quality.sample(frameMs);
    if (next) changes.push(next);
  }
  return changes;
}

describe('adaptive quality', () => {
  it('holds its level while frames are on time', () => {
    const quality = new AdaptiveQuality('ultra');
    expect(run(quality, 16.7, 30)).toEqual([]);
    expect(quality.level).toBe('ultra');
  });

  it('steps down one tier at a time while frames stay slow', () => {
    const quality = new AdaptiveQuality('ultra');
    const changes = run(quality, 40, 30);
    expect(changes).toEqual(['high', 'medium', 'low']);
    expect(quality.level).toBe('low');
    // There is nowhere left to go.
    expect(run(quality, 40, 20)).toEqual([]);
  });

  it('steps back up once there is headroom', () => {
    const quality = new AdaptiveQuality('low');
    const changes = run(quality, 10, 60);
    expect(changes).toEqual(['medium', 'high', 'ultra']);
  });

  it('does not react to a brief hitch', () => {
    const quality = new AdaptiveQuality('high');
    run(quality, 16.7, 5);
    expect(run(quality, 60, 0.4)).toEqual([]);
    expect(run(quality, 16.7, 2)).toEqual([]);
    expect(quality.level).toBe('high');
  });

  it('remembers a tier that proved too expensive instead of oscillating', () => {
    const quality = new AdaptiveQuality('medium');
    expect(run(quality, 12, 12)).toEqual(['high']);
    // "high" turns out to be slow on this machine; stepping back fixes it.
    expect(run(quality, 35, 5)).toEqual(['medium']);
    // Plenty of headroom again, but "high" is not retried.
    expect(run(quality, 12, 60)).toEqual([]);
    expect(quality.level).toBe('medium');
  });

  it('ignores gaps that are not rendering time', () => {
    const quality = new AdaptiveQuality('high');
    for (const gap of [5000, 0, -1, Number.NaN, Infinity]) expect(quality.sample(gap)).toBeNull();
    expect(quality.averageFrameMs).toBeCloseTo(16.7);
  });

  it('orders profiles from cheapest to most expensive', () => {
    for (let i = 1; i < QUALITY_ORDER.length; i++) {
      const lower = QUALITY[QUALITY_ORDER[i - 1]!];
      const higher = QUALITY[QUALITY_ORDER[i]!];
      expect(higher.maxDpr).toBeGreaterThanOrEqual(lower.maxDpr);
      expect(higher.particles).toBeGreaterThan(lower.particles);
    }
  });
});

describe('frame statistics', () => {
  it('reports average, percentile and fps over a rolling window', () => {
    const stats = new FrameStats(4);
    expect(stats.fps()).toBe(0);
    for (const ms of [10, 20, 30, 40]) stats.push(ms);
    expect(stats.average()).toBe(25);
    expect(stats.percentile(1)).toBe(40);
    expect(stats.fps()).toBe(40);
    // The window rolls: the oldest sample is replaced.
    stats.push(20);
    expect(stats.count).toBe(4);
    expect(stats.average()).toBe(27.5);
    stats.push(Number.NaN);
    expect(stats.average()).toBe(27.5);
  });
});

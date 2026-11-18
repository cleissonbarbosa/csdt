import { describe, expect, it } from 'vitest';

import { readCapture, type Capture } from './capture';
import { levelColumns, spreadMarks } from './marks';

const START = 1_700_000_000_000;
const PERIOD = 60_000;
const SIZE = 9;

/** `count` services whose samples are past the critical level, none of them at the same moment. */
function unaligned(count: number, samples: number): Capture {
  const capture = readCapture({
    kind: 'aegis-incident-capture',
    version: 1,
    title: 'Unaligned samples',
    source: { kind: 'tempo-prometheus', label: 'Tempo / Prometheus' },
    window: { startMs: START, endMs: START + samples * PERIOD },
    periodMs: PERIOD,
    regions: [{ id: 'r', name: 'Location not reported' }],
    nodes: Array.from({ length: count }, (_, n) => ({
      id: `s${n}`,
      name: `s${n}`,
      region: 'r',
      type: 'microservice',
      buckets: Array.from({ length: samples }, (_, k) => ({
        atMs: START + k * PERIOD + n,
        requests: 1,
        faults: n % 3 === 0 ? 1 : 0.1,
      })),
    })),
    edges: [],
  });
  if (!capture) throw new Error('not a capture');
  return capture;
}

describe('the ticks of samples past the levels', () => {
  it('are never more than the strip has columns, however many samples the file holds', () => {
    // Forty services sampled a millisecond apart: 12 000 distinct moments.
    const capture = unaligned(40, 300);
    for (const width of [120, 333.5, 600, 1400]) {
      const columns = levelColumns(capture, width);
      expect(columns.length).toBeLessThanOrEqual(Math.ceil(width));
      expect(columns.length).toBeGreaterThan(0);
      for (const { column } of columns) {
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThan(Math.ceil(width));
      }
      // Left to right, one per column.
      const order = columns.map(({ column }) => column);
      expect(order).toEqual([...new Set(order)].sort((a, b) => a - b));
    }
  });

  it('keep the worst level of the samples in a column', () => {
    // In every period one service is critical and the others degraded.
    const columns = levelColumns(unaligned(3, 10), 600);
    expect(columns.every(({ level }) => level === 2)).toBe(true);
    const degraded = levelColumns(
      readCapture({
        ...unaligned(1, 1),
        nodes: [
          {
            id: 'a',
            name: 'a',
            region: 'r',
            type: 'microservice',
            buckets: [{ atMs: START, requests: 100, faults: 5 }],
          },
        ],
      })!,
      600,
    );
    expect(degraded).toEqual([{ column: 0, level: 1 }]);
  });
});

describe('the marks of events', () => {
  const gapOf = (placed: number[]) => Math.min(...placed.slice(1).map((x, i) => x - placed[i]!));

  it('stay at their own places where they have room', () => {
    expect(spreadMarks([20, 100, 300], SIZE, 600)).toEqual([20, 100, 300]);
  });

  it('are set side by side around a moment they share, each whole', () => {
    // Three events at one moment, as at 23:13 in Google's report.
    const placed = spreadMarks([10, 200, 200, 200, 500], SIZE, 600);
    expect(placed[0]).toBe(10);
    expect(placed[4]).toBe(500);
    expect(gapOf(placed)).toBeGreaterThanOrEqual(SIZE);
    // Around the moment: the middle one is on it.
    expect(placed[2]).toBeCloseTo(200);
    expect(placed[1]!).toBeLessThan(200);
    expect(placed[3]!).toBeGreaterThan(200);
  });

  it('are spread where they are only a few pixels apart, and stay in order', () => {
    const wanted = [100, 103, 106, 108, 140];
    const placed = spreadMarks(wanted, SIZE, 600);
    expect(gapOf(placed)).toBeGreaterThanOrEqual(SIZE);
    expect(placed).toEqual([...placed].sort((a, b) => a - b));
    // The run is centred on where its marks wanted to be.
    const middle = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
    expect(middle(placed.slice(0, 4))).toBeCloseTo(middle(wanted.slice(0, 4)));
  });

  it('are never cut by an end of the strip', () => {
    const placed = spreadMarks([0, 0, 598, 600], SIZE, 600);
    expect(placed[0]).toBeGreaterThanOrEqual(SIZE / 2);
    expect(placed[3]).toBeLessThanOrEqual(600 - SIZE / 2);
    expect(gapOf(placed)).toBeGreaterThanOrEqual(SIZE);
  });

  it('stay at their own places where the strip cannot hold them all side by side', () => {
    const wanted = Array.from({ length: 80 }, (_, i) => 100 + (i % 4));
    const placed = spreadMarks(wanted, SIZE, 600);
    expect(placed).toEqual(wanted);
  });

  it('give the same places for the same moments', () => {
    const wanted = Array.from({ length: 40 }, (_, i) => (i * 37) % 600).sort((a, b) => a - b);
    expect(spreadMarks(wanted, SIZE, 600)).toEqual(spreadMarks(wanted, SIZE, 600));
  });
});

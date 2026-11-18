import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatPercent } from './format';
import { ERROR_CRITICAL, ERROR_DEGRADED, errorLevel, formatErrorRate } from './thresholds';

const ENGINE = join(import.meta.dirname, '../../../server/src/simulation/engine.rs');

/** The body of the engine's node `classify`, from its signature to its closing brace. */
function classify(): string {
  const source = readFileSync(ENGINE, 'utf8');
  const start = source.indexOf('fn classify(');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the error levels a capture is coloured by', () => {
  it('are the ones the engine classifies a service by', () => {
    const body = classify();
    expect(body).toContain('error >= 0.04');
    expect(body).toContain('error >= 0.2');
    const levels = new Set([...body.matchAll(/error >= ([0-9.]+)/g)].map((m) => Number(m[1])));
    expect([...levels].sort((a, b) => a - b)).toEqual([ERROR_DEGRADED, ERROR_CRITICAL]);
  });

  it('are not the alert rules’ objective', () => {
    const source = readFileSync(ENGINE, 'utf8');
    const objective = /pub const ERROR_OBJECTIVE: f64 = ([0-9.]+);/.exec(source)?.[1];
    expect(objective).toBeDefined();
    expect(Number(objective)).not.toBe(ERROR_DEGRADED);
    expect(Number(objective)).not.toBe(ERROR_CRITICAL);
  });

  it('are reached at the level, not past it', () => {
    expect(errorLevel(0)).toBe(0);
    expect(errorLevel(0.0399)).toBe(0);
    expect(errorLevel(ERROR_DEGRADED)).toBe(1);
    expect(errorLevel(0.19)).toBe(1);
    expect(errorLevel(ERROR_CRITICAL)).toBe(2);
    expect(errorLevel(1)).toBe(2);
  });
});

describe('an error rate, written', () => {
  it('is never written as a level it is under', () => {
    // Rounded as any percentage, these two read as the levels themselves.
    expect(formatPercent(0.03996)).toBe(formatPercent(ERROR_DEGRADED));
    expect(formatPercent(0.1996)).toBe(formatPercent(ERROR_CRITICAL));
    for (const rate of [0.03996, 0.039999, 0.1996, 0.19999]) {
      const written = formatErrorRate(rate);
      expect(written, String(rate)).not.toBe(formatPercent(ERROR_DEGRADED));
      expect(written, String(rate)).not.toBe(formatPercent(ERROR_CRITICAL));
      expect(written.startsWith('<'), String(rate)).toBe(true);
    }
    expect(formatErrorRate(0.03996)).toBe('<4.00%');
    expect(formatErrorRate(0.1996)).toBe('<20.0%');
  });

  it('is written as any percentage everywhere else, the levels themselves included', () => {
    for (const rate of [
      0,
      0.0004,
      0.012,
      0.0395,
      ERROR_DEGRADED,
      0.05,
      0.1949,
      ERROR_CRITICAL,
      1,
    ]) {
      expect(formatErrorRate(rate), String(rate)).toBe(formatPercent(rate));
    }
  });
});

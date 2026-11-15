import { describe, expect, it } from 'vitest';

import {
  entityId,
  entityType,
  formatClock,
  formatCount,
  formatMs,
  formatPercent,
  formatRate,
  titleCase,
} from './format';

describe('formatting', () => {
  it('scales request rates', () => {
    expect(formatRate(0)).toBe('0');
    expect(formatRate(4.321)).toBe('4.32');
    expect(formatRate(42.19)).toBe('42.2');
    expect(formatRate(979.4)).toBe('979');
    expect(formatRate(2164)).toBe('2.16k');
    expect(formatRate(15_300)).toBe('15.3k');
    expect(formatRate(Number.NaN)).toBe('–');
  });

  it('scales latencies', () => {
    expect(formatMs(3.14159)).toBe('3.1 ms');
    expect(formatMs(166.8)).toBe('167 ms');
    expect(formatMs(1461.9)).toBe('1.46 s');
    expect(formatMs(30_000)).toBe('30.0 s');
  });

  it('never rounds a non-zero rate down to zero', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.0004)).toBe('<0.1%');
    expect(formatPercent(0.07)).toBe('7.00%');
    expect(formatPercent(0.302)).toBe('30.2%');
  });

  it('renders virtual time as a clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(34_600)).toBe('0:34');
    expect(formatClock(943_000)).toBe('15:43');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('abbreviates counts', () => {
    expect(formatCount(87_139)).toBe('87k');
    expect(formatCount(4837)).toBe('4.8k');
    expect(formatCount(41)).toBe('41');
  });

  it('takes Cedar entity references apart', () => {
    expect(entityId('User::"alice"')).toBe('alice');
    expect(entityType('Ledger::"acme-ledger-2026"')).toBe('Ledger');
    expect(entityId('not-a-uid')).toBe('not-a-uid');
    expect(titleCase('cedar-denial')).toBe('Cedar Denial');
  });
});

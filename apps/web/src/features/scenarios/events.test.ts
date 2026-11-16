import type { SecurityEvent, Severity } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import { askedByViewer, foldEvents } from './events';

let seq = 0;
function event(kind: string, severity: Severity, title: string): SecurityEvent {
  seq += 1;
  return {
    seq,
    tick: seq,
    virtualTimeMs: seq * 1000,
    kind,
    severity,
    title,
    message: title,
    nodeIds: [],
    edgeIds: [],
    incidentId: null,
    dataSource: 'synthetic',
  } as unknown as SecurityEvent;
}

describe('folding the event log', () => {
  it('folds a run of state changes into one entry', () => {
    const folded = foldEvents([
      event('alert', 'critical', 'Volumetric attack detected'),
      event('health-transition', 'critical', 'A is critical'),
      event('health-transition', 'critical', 'B is critical'),
      event('health-transition', 'critical', 'C is critical'),
      event('alert', 'warning', 'Latency objective breached'),
    ]);
    expect(folded.map((entry) => entry.kind)).toEqual(['event', 'run', 'event']);
    const run = folded[1]!;
    expect(run.kind === 'run' && run.events.map((e) => e.title)).toEqual([
      'A is critical',
      'B is critical',
      'C is critical',
    ]);
  });

  it('keeps the cause visible: alerts are never folded', () => {
    const folded = foldEvents([
      event('alert', 'critical', 'one'),
      event('alert', 'critical', 'two'),
      event('scenario', 'notice', 'three'),
    ]);
    expect(folded).toHaveLength(3);
    expect(folded.every((entry) => entry.kind === 'event')).toBe(true);
  });

  it('does not mix severities in one run, and leaves a lone change alone', () => {
    const folded = foldEvents([
      event('health-transition', 'critical', 'A is critical'),
      event('health-transition', 'warning', 'B is degraded'),
      event('health-transition', 'warning', 'C is degraded'),
    ]);
    expect(folded.map((entry) => entry.kind)).toEqual(['event', 'run']);
    expect(folded[1]!.kind === 'run' && folded[1]!.severity).toBe('warning');
  });

  it('returns nothing for nothing', () => {
    expect(foldEvents([])).toEqual([]);
  });
});

describe('a decision the viewer asked for', () => {
  it('is told apart from one the platform made', () => {
    const asked = {
      ...event('authz-decision', 'warning', 'Deny'),
      details: { origin: 'explorer' },
    };
    const sampled = { ...event('authz-decision', 'notice', 'Deny'), details: { requestId: 'r1' } };
    const inIncident = event('authz-decision', 'warning', 'Deny');
    expect(askedByViewer(asked)).toBe(true);
    expect(askedByViewer(sampled)).toBe(false);
    expect(askedByViewer(inIncident)).toBe(false);
    // Only a decision can be one: the same mark on anything else is not.
    expect(
      askedByViewer({ ...event('alert', 'warning', 'x'), details: { origin: 'explorer' } }),
    ).toBe(false);
  });
});

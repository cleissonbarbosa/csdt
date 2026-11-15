import type { SecurityEvent, Severity } from '@aegis/contracts';

/** One entry of the log: a single event, or a run of state changes. */
export type LogEntry =
  | { kind: 'event'; event: SecurityEvent }
  | { kind: 'run'; key: number; severity: Severity; events: SecurityEvent[] };

/**
 * When a fault spreads, every service it reaches reports its own change of
 * state. Listing each one buries the cause under its consequences, so
 * consecutive state changes of the same severity are folded into one line.
 */
export function foldEvents(events: SecurityEvent[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const event of events) {
    const last = out[out.length - 1];
    if (event.kind === 'health-transition') {
      if (last?.kind === 'run' && last.severity === event.severity) {
        last.events.push(event);
        continue;
      }
      out.push({ kind: 'run', key: event.seq, severity: event.severity, events: [event] });
      continue;
    }
    out.push({ kind: 'event', event });
  }
  // A run of one is just an event.
  return out.map((entry) =>
    entry.kind === 'run' && entry.events.length === 1
      ? { kind: 'event', event: entry.events[0]! }
      : entry,
  );
}

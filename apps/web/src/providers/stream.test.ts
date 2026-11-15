import type { ConnectionState, StreamMessage } from '@aegis/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { events as eventsSample, snapshot as snapshotSample } from '@/test/fixtures';

import { StreamClient, type SocketLike } from './stream';

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  onmessage: SocketLike['onmessage'] = null;
  sent: unknown[] = [];
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: unknown) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const latest = () => FakeSocket.instances.at(-1)!;
const sample = eventsSample().events;
const eventsMessage = (seqs: number[]) => ({
  type: 'events',
  data: seqs.map((seq) => ({ ...sample[0]!, seq, id: `evt-${seq}` })),
});

function setup() {
  const messages: StreamMessage[] = [];
  const states: ConnectionState[] = [];
  const latencies: number[] = [];
  const violations: string[] = [];
  let clock = 0;
  const client = new StreamClient({
    url: 'ws://test/api/v1/stream',
    onMessage: (m) => messages.push(m),
    onState: (s) => states.push(s),
    onLatency: (ms) => latencies.push(ms),
    onViolation: (reason) => violations.push(reason),
    createSocket: (url) => new FakeSocket(url),
    now: () => clock,
    random: () => 1,
  });
  return {
    client,
    messages,
    states,
    latencies,
    violations,
    advance: (ms: number) => (clock += ms),
  };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('stream client', () => {
  it('connects and delivers validated messages', () => {
    const { client, messages, states } = setup();
    client.start();
    expect(states).toEqual(['connecting']);
    latest().open();
    latest().receive({ type: 'snapshot', data: snapshotSample() });
    expect(states).toEqual(['connecting', 'open']);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('snapshot');
  });

  it('drops anything that violates the contract', () => {
    const { client, messages, violations } = setup();
    client.start();
    latest().open();
    latest().receive('not json');
    latest().receive({ type: 'exec', command: 'rm -rf /' });
    latest().receive({ type: 'snapshot', data: { tick: 'soon' } });
    expect(messages).toEqual([]);
    expect(violations).toHaveLength(3);
  });

  it('tracks the event cursor and de-duplicates replays', () => {
    const { client, messages } = setup();
    client.start();
    latest().open();
    latest().receive(eventsMessage([1, 2, 3]));
    latest().receive(eventsMessage([2, 3, 4]));
    latest().receive(eventsMessage([3, 4]));
    expect(client.lastSequence).toBe(4);
    const delivered = messages.flatMap((m) =>
      m.type === 'events' ? m.data.map((e) => e.seq) : [],
    );
    expect(delivered).toEqual([1, 2, 3, 4]);
  });

  it('reconnects with exponential backoff and asks for what it missed', () => {
    const { client, states } = setup();
    client.start();
    latest().open();
    latest().receive(eventsMessage([1, 2, 3]));

    latest().drop();
    expect(states.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // Still down: the next attempts wait 1 s, 2 s, 4 s, then cap at 8 s.
    for (const wait of [1000, 2000, 4000, 8000, 8000]) {
      const count = FakeSocket.instances.length;
      latest().drop();
      vi.advanceTimersByTime(wait - 1);
      expect(FakeSocket.instances).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.instances).toHaveLength(count + 1);
    }

    latest().open();
    expect(states.at(-1)).toBe('open');
    expect(latest().sent).toContainEqual({ type: 'resync', afterSeq: 3 });

    // A successful connection resets the backoff.
    const count = FakeSocket.instances.length;
    latest().drop();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(count + 1);
  });

  it('asks for a resync when the server says it lagged', () => {
    const { client, messages } = setup();
    client.start();
    latest().open();
    latest().receive(eventsMessage([7]));
    latest().receive({ type: 'lagged', dropped: 120 });
    expect(latest().sent).toContainEqual({ type: 'resync', afterSeq: 7 });
    expect(messages.at(-1)).toEqual({ type: 'lagged', dropped: 120 });
  });

  it('re-reads the event cursor after the timeline changes shape', () => {
    const { client, messages } = setup();
    client.start();
    latest().open();
    latest().receive(eventsMessage([40, 41]));
    // The operator seeks into the past: sequence numbers restart from there.
    latest().receive({ type: 'timeline', reason: 'seek', playback: snapshotSample().playback });
    latest().receive({ type: 'snapshot', data: { ...snapshotSample(), seq: 12 } });
    expect(client.lastSequence).toBe(12);
    latest().receive(eventsMessage([13]));
    expect(messages.at(-1)).toMatchObject({ type: 'events' });
    expect(client.lastSequence).toBe(13);
  });

  it('measures round-trip time with pings and replaces silent connections', () => {
    const { client, latencies, advance } = setup();
    client.start();
    latest().open();
    advance(5000);
    vi.advanceTimersByTime(5000);
    const ping = latest().sent.find((m) => (m as { type: string }).type === 'ping') as {
      t: number;
    };
    expect(ping.t).toBe(5000);
    advance(18);
    latest().receive({ type: 'pong', t: ping.t });
    expect(latencies).toEqual([18]);

    // Nothing arrives for longer than the stale threshold.
    const socket = latest();
    advance(13_000);
    vi.advanceTimersByTime(5000);
    expect(socket.readyState).toBe(3);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('stops for good when asked to', () => {
    const { client, states } = setup();
    client.start();
    latest().open();
    client.stop();
    expect(states.at(-1)).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    // Starting again is allowed.
    client.start();
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

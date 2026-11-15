import type { ConnectionState, StreamMessage } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import { StreamClient } from '@/providers/stream';
import { snapshot as snapshotSample } from '@/test/fixtures';

import { EngineError } from './binding';
import { EngineClient } from './client';
import type { FromWorker, ToWorker, WorkerLike } from './messages';

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  posted: ToWorker[] = [];
  terminated = false;
  postMessage(message: ToWorker) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  say(message: FromWorker) {
    this.onmessage?.({ data: message });
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = new EngineClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { client, workers, worker: () => workers.at(-1)! };
}

/** Lets queued microtasks run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('engine client', () => {
  it('starts the worker when first needed and matches each answer to its request', async () => {
    const { client, workers, worker } = setup();
    expect(workers).toHaveLength(0);

    const health = client.request('GET', '/api/v1/health');
    const start = client.request('POST', '/api/v1/demo/scenarios/start', '{"scenarioId":"x"}');
    expect(workers).toHaveLength(1);
    expect(worker().posted).toEqual([
      { type: 'request', id: 1, method: 'GET', path: '/api/v1/health' },
      {
        type: 'request',
        id: 2,
        method: 'POST',
        path: '/api/v1/demo/scenarios/start',
        body: '{"scenarioId":"x"}',
      },
    ]);

    // Answers may come in any order.
    worker().say({ type: 'response', id: 2, status: 404, body: '{"error":{}}' });
    worker().say({ type: 'response', id: 1, status: 200, body: '{"status":"ok"}' });
    await expect(start).resolves.toEqual({ status: 404, body: '{"error":{}}' });
    await expect(health).resolves.toEqual({ status: 200, body: '{"status":"ok"}' });
  });

  it('lets a request wait for a loading engine, and gives up only on a running one', async () => {
    const { client, worker } = setup();
    const early = new AbortController();
    const first = client.request('GET', '/api/v1/topology', undefined, early.signal);
    // The module is still being fetched: the time allowed has not started.
    early.abort();
    worker().say({ type: 'ready' });
    worker().say({ type: 'response', id: 1, status: 200, body: '{}' });
    await expect(first).resolves.toEqual({ status: 200, body: '{}' });

    const late = new AbortController();
    const second = client.request('GET', '/api/v1/topology', undefined, late.signal);
    late.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    // The answer that still arrives is dropped.
    worker().say({ type: 'response', id: 2, status: 200, body: '{}' });

    const gone = new AbortController();
    gone.abort();
    await expect(
      client.request('GET', '/api/v1/topology', undefined, gone.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fails what was waiting when the engine stops, and everything asked after', async () => {
    const { client, workers, worker } = setup();
    const waiting = client.request('GET', '/api/v1/health');
    worker().say({ type: 'failed', message: 'The simulation engine stopped: index out of bounds' });

    await expect(waiting).rejects.toBeInstanceOf(EngineError);
    await expect(waiting).rejects.toThrow('index out of bounds');
    expect(worker().terminated).toBe(true);
    expect(client.stopped?.message).toContain('index out of bounds');
    // It is not started again behind the viewer's back.
    await expect(client.request('GET', '/api/v1/health')).rejects.toBeInstanceOf(EngineError);
    expect(workers).toHaveLength(1);
  });

  it('reports a worker that could not be loaded or created', async () => {
    const { client, worker } = setup();
    const waiting = client.request('GET', '/api/v1/health');
    worker().onerror?.({});
    await expect(waiting).rejects.toThrow('could not be loaded');

    const none = new EngineClient(() => {
      throw new Error('Worker is not defined');
    });
    await expect(none.request('GET', '/api/v1/health')).rejects.toThrow('could not start');
  });

  it('opens the stream once the engine runs and hands over what it says', async () => {
    const { client, worker } = setup();
    const socket = client.socket();
    const received: unknown[] = [];
    let opened = 0;
    socket.onopen = () => (opened += 1);
    socket.onmessage = (event) => received.push(event.data);
    await settle();
    expect(opened).toBe(0);
    expect(socket.readyState).toBe(0);
    // Nothing is said to a subscriber that is not open yet.
    worker().say({ type: 'stream', messages: ['{"type":"snapshot"}'] });
    expect(received).toEqual([]);

    worker().say({ type: 'ready' });
    expect(opened).toBe(1);
    expect(socket.readyState).toBe(1);
    expect(worker().posted).toEqual([{ type: 'open' }]);
    worker().say({ type: 'stream', messages: ['{"type":"hello"}', '{"type":"snapshot"}'] });
    expect(received).toEqual(['{"type":"hello"}', '{"type":"snapshot"}']);

    socket.send('{"type":"ping","t":1}');
    socket.close();
    socket.send('{"type":"ping","t":2}');
    expect(worker().posted.slice(1)).toEqual([
      { type: 'message', text: '{"type":"ping","t":1}' },
      { type: 'close' },
    ]);
    expect(socket.readyState).toBe(3);
  });

  it('gives the stream to the newest subscriber and closes the one before', async () => {
    const { client, worker } = setup();
    const first = client.socket();
    await settle();
    worker().say({ type: 'ready' });
    let closed = 0;
    first.onclose = () => (closed += 1);
    const heard: unknown[] = [];
    first.onmessage = (event) => heard.push(event.data);

    const second = client.socket();
    const received: unknown[] = [];
    second.onmessage = (event) => received.push(event.data);
    await settle();
    expect(closed).toBe(1);
    expect(second.readyState).toBe(1);
    worker().say({ type: 'stream', messages: ['{"type":"hello"}'] });
    expect(heard).toEqual([]);
    expect(received).toEqual(['{"type":"hello"}']);
    // The one that was replaced has nothing left to say or to release.
    first.send('{"type":"ping","t":1}');
    first.close();
    expect(worker().posted.filter((message) => message.type !== 'open')).toEqual([]);
  });

  it('closes the stream when the engine stops, and every stream opened after', async () => {
    const { client, worker } = setup();
    const socket = client.socket();
    await settle();
    worker().say({ type: 'ready' });
    let closed = 0;
    socket.onclose = () => (closed += 1);
    worker().say({ type: 'failed', message: 'The simulation engine stopped: overflow' });
    expect(closed).toBe(1);
    expect(socket.readyState).toBe(3);

    const next = client.socket();
    let nextClosed = 0;
    next.onclose = () => (nextClosed += 1);
    await settle();
    expect(nextClosed).toBe(1);
  });

  it('is a socket the stream client can use as it uses the server', async () => {
    const { client, worker } = setup();
    const messages: StreamMessage[] = [];
    const states: ConnectionState[] = [];
    const latencies: number[] = [];
    const violations: string[] = [];
    let clock = 0;
    const stream = new StreamClient({
      url: 'ws://engine/api/v1/stream',
      onMessage: (message) => messages.push(message),
      onState: (state) => states.push(state),
      onLatency: (ms) => latencies.push(ms),
      onViolation: (reason) => violations.push(reason),
      createSocket: () => client.socket(),
      now: () => clock,
    });
    stream.start();
    await settle();
    expect(states).toEqual(['connecting']);

    worker().say({ type: 'ready' });
    expect(states).toEqual(['connecting', 'open']);
    const snapshot = { type: 'snapshot', data: snapshotSample() };
    worker().say({ type: 'stream', messages: [JSON.stringify(snapshot), 'not json'] });
    expect(messages).toEqual([snapshot]);
    expect(violations).toEqual(['message is not JSON']);

    // The answer to a ping is timed like any other.
    clock = 40;
    worker().say({ type: 'stream', messages: ['{"type":"pong","t":25}'] });
    expect(latencies).toEqual([15]);

    stream.stop();
    expect(states.at(-1)).toBe('closed');
    expect(worker().posted.at(-1)).toEqual({ type: 'close' });
  });
});

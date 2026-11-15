import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topology as topologySample } from '@/test/fixtures';

import type { FromWorker, ToWorker } from './messages';

/** Stands in for the browser's `Worker`; answers every request with `reply`. */
class StubWorker {
  static instances: StubWorker[] = [];
  static reply: (message: Extract<ToWorker, { type: 'request' }>) => FromWorker | null = () => null;
  onmessage: ((event: { data: FromWorker }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(
    readonly url: URL,
    readonly options: { type: string; name: string },
  ) {
    StubWorker.instances.push(this);
  }
  postMessage(message: ToWorker) {
    if (message.type !== 'request') return;
    const reply = StubWorker.reply(message);
    if (reply) queueMicrotask(() => this.onmessage?.({ data: reply }));
  }
  terminate() {}
}

beforeEach(() => {
  StubWorker.instances = [];
  vi.resetModules();
  vi.stubGlobal('Worker', StubWorker);
  // The application as the static build links it: the engine's transport.
  vi.doMock('@transport', () => import('./transport'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('@transport');
});

describe('engine transport', () => {
  it('answers the REST client with what the engine said, and nothing leaves the page', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const seen: ToWorker[] = [];
    StubWorker.reply = (message) => {
      seen.push(message);
      return {
        type: 'response',
        id: message.id,
        status: 200,
        body: JSON.stringify(topologySample()),
      };
    };
    const { api } = await import('@/providers/api');

    const topology = await api.topology();
    expect(topology.id).toBe('helios-commerce');
    await api.startScenario('ddos-surge').catch(() => undefined);
    expect(seen).toEqual([
      { type: 'request', id: 1, method: 'GET', path: '/api/v1/topology' },
      {
        type: 'request',
        id: 2,
        method: 'POST',
        path: '/api/v1/demo/scenarios/start',
        body: '{"scenarioId":"ddos-surge"}',
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // One worker, a module, for the whole page.
    expect(StubWorker.instances).toHaveLength(1);
    expect(StubWorker.instances[0]!.options.type).toBe('module');
  });

  it('carries the error envelope and the contract check through unchanged', async () => {
    StubWorker.reply = (message) => ({
      type: 'response',
      id: message.id,
      status: message.path.endsWith('/topology') ? 200 : 404,
      body: message.path.endsWith('/topology')
        ? '{"id":"x"}'
        : '{"error":{"code":"not_found","message":"unknown scenario"}}',
    });
    const { api } = await import('@/providers/api');

    await expect(api.startScenario('nope')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'unknown scenario',
    });
    await expect(api.topology()).rejects.toMatchObject({ code: 'contract_violation' });
  });

  it('says the engine stopped, in its own words, where the server would be unreachable', async () => {
    StubWorker.reply = () => null;
    const { api } = await import('@/providers/api');
    const pending = api.health();
    StubWorker.instances[0]!.onmessage?.({
      data: { type: 'failed', message: 'The simulation engine stopped: out of memory' },
    });
    await expect(pending).rejects.toMatchObject({
      status: 0,
      code: 'unreachable',
      message: 'The simulation engine stopped: out of memory',
    });
  });

  it('names the engine, not a server, in what the interface says', async () => {
    const { HOST, IN_BROWSER, evaluationTime } = await import('@/app/host');
    expect(IN_BROWSER).toBe(true);
    expect(Object.values(HOST).join(' ')).not.toMatch(/\b(this|the) server (was|started|could)/);
    expect(HOST.imported).toContain('gone when it is reloaded');
    // A time nobody measured is not shown as a measurement.
    expect(evaluationTime(0)).toBe('not timed in the browser');
  });
});

describe('server transport', () => {
  it('is what the application is linked with unless it is built as a static site', async () => {
    vi.doUnmock('@transport');
    const { HOST, IN_BROWSER, evaluationTime } = await import('@/app/host');
    expect(IN_BROWSER).toBe(false);
    expect(HOST.unreachable).toBe('The server could not be reached.');
    expect(evaluationTime(412)).toBe('412 µs measured');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { topology as topologySample } from '@/test/fixtures';

import { api, ApiError, apiUrl } from './api';

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('targets the versioned API on the same origin by default', () => {
    expect(apiUrl('/topology')).toBe('/api/v1/topology');
  });

  it('returns responses that satisfy the contract', async () => {
    const fetchMock = respond(200, topologySample());
    vi.stubGlobal('fetch', fetchMock);
    const topology = await api.topology();
    expect(topology.id).toBe('helios-commerce');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/topology',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects responses that violate the contract instead of passing them on', async () => {
    const broken = { ...topologySample(), nodes: [{ id: 'x' }] };
    vi.stubGlobal('fetch', respond(200, broken));
    await expect(api.topology()).rejects.toMatchObject({ code: 'contract_violation' });
  });

  it('surfaces the server error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      respond(404, { error: { code: 'not_found', message: 'unknown scenario `nope`' } }),
    );
    const error = await api.startScenario('nope').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'unknown scenario `nope`',
    });
  });

  it('copes with errors that are not in the envelope', async () => {
    vi.stubGlobal('fetch', respond(502, { oops: true }));
    await expect(api.health()).rejects.toMatchObject({ status: 502, code: 'http_error' });
    vi.stubGlobal('fetch', respond(200, '<html>'));
    await expect(api.health()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('reports an unreachable server distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.health()).rejects.toMatchObject({ status: 0, code: 'unreachable' });
  });

  it('sends commands as JSON', async () => {
    const fetchMock = respond(200, {
      playback: (await import('@/test/fixtures')).snapshot().playback,
    });
    vi.stubGlobal('fetch', fetchMock);
    await api.control({ action: 'seek', toMs: 4000 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/demo/playback/control');
    expect(init).toMatchObject({ method: 'POST', body: '{"action":"seek","toMs":4000}' });
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('encodes identifiers placed in a path', async () => {
    const fetchMock = respond(200, []);
    vi.stubGlobal('fetch', fetchMock);
    await api.connectProvider('a/b c');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/providers/a%2Fb%20c/connect');
  });
});

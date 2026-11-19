/**
 * A draft written from a capture is a workspace the engine accepts.
 *
 * `features/capture/draft.ts` writes platform files in the browser. This
 * hands the drafts of the two bundled captures to the real engine, the
 * module the static site runs, through the same routes the import dialog
 * uses: the check that applies nothing, then the import, then the scenario
 * of measured load. What the engine refuses, no test of the writer alone
 * would notice.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { BUNDLED } from '@/features/capture/bundled';
import { readCapture } from '@/features/capture/capture';
import { draftOf, type Draft } from '@/features/capture/draft';

import { Engine } from './binding';

const MODULE = fileURLToPath(new URL('./aegis.wasm', import.meta.url));

describe('a platform drafted from a bundled capture', () => {
  let engine: Engine;
  let clock = 0;
  const post = (path: string, body: unknown) => {
    const answer = engine.request('POST', `/api/v1${path}`, JSON.stringify(body), clock);
    return { status: answer.status, body: JSON.parse(answer.body) as Record<string, unknown> };
  };
  const get = (path: string) =>
    JSON.parse(engine.request('GET', `/api/v1${path}`, undefined, clock).body) as Record<
      string,
      unknown
    >;
  const draft = async (id: string): Promise<Draft> => {
    const capture = readCapture(await BUNDLED.find((entry) => entry.id === id)!.load());
    const written = draftOf(capture!, id);
    if ('refused' in written) throw new Error(written.refused);
    return written;
  };

  beforeAll(async () => {
    if (!existsSync(MODULE)) {
      throw new Error('src/engine/aegis.wasm is missing. Build it with `pnpm engine:build`.');
    }
    const { instance } = await WebAssembly.instantiate(readFileSync(MODULE), {});
    engine = Engine.from(instance.exports);
    engine.boot(42, clock);
  });

  it.each(BUNDLED.map((entry) => entry.id))('%s is a valid workspace', async (id) => {
    const written = await draft(id);
    const check = post('/demo/workspace/check', { files: written.files });
    expect(check.status, JSON.stringify(check.body)).toBe(200);
    expect(check.body.valid, JSON.stringify(check.body.problem)).toBe(true);
    const workspace = check.body.workspace as {
      topologies: { id: string; nodeCount: number; dataSource: string }[];
      scenarioIds: string[];
      unavailable: unknown[];
    };
    expect(workspace.topologies).toHaveLength(1);
    expect(workspace.topologies[0]).toMatchObject({
      id: written.topologyId,
      dataSource: 'synthetic',
      // The capture's services and the client added in front of them.
      nodeCount: written.services + 1,
    });
    if (written.scenario) {
      expect(workspace.scenarioIds).toEqual([written.scenario.id]);
      expect(workspace.unavailable).toEqual([]);
    }
  });

  it('runs the measured load once it is applied', async () => {
    const written = await draft('online-boutique-rcaeval');
    expect(post('/demo/workspace/import', { files: written.files }).status).toBe(200);
    expect(get('/topology').id).toBe(written.topologyId);
    const started = post('/demo/scenarios/start', { scenarioId: written.scenario!.id });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    for (let tick = 0; tick < 5 * 30; tick += 1) {
      clock += 200;
      engine.advance(200, clock);
    }
    const report = get('/incidents/inc-001/report') as {
      scenarioId: string;
      phases: { prescribed: { description: string }[] }[];
    };
    expect(report.scenarioId).toBe(written.scenario!.id);
    // What the scenario prescribes is demand, and only that.
    const prescribed = report.phases.flatMap((phase) => phase.prescribed);
    expect(prescribed.length).toBeGreaterThan(0);
    expect(prescribed.every((effect) => effect.description.startsWith('demand ×'))).toBe(true);
    // And the platform is asked what it takes, as any other is.
    const headroom = post('/demo/experiments/headroom', {});
    expect(headroom.status, JSON.stringify(headroom.body)).toBe(200);
    expect(post('/demo/workspace/reset', {}).status).toBe(200);
  });
});

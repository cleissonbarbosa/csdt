import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { topology as sampleTopology } from '@/test/fixtures';

import {
  blankScenario,
  derivedTargets,
  draftFromFile,
  draftProblems,
  draftToFile,
  EFFECT,
  EFFECT_KINDS,
  emptyPhase,
  rowKey,
  slug,
  targetChoices,
} from './scenarioFile';

// Vitest runs with the package directory as its working directory.
const FIXTURES = resolve(process.cwd(), '../../fixtures/scenarios');
const EXAMPLE = resolve(process.cwd(), '../../examples/corner-shop/scenarios');
const files = [FIXTURES, EXAMPLE].flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({
      name,
      json: JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as Record<string, unknown>,
    })),
);
const topology = sampleTopology();

describe('a scenario file in the editor', () => {
  it.each(files)('reads $name and writes it back unchanged', ({ json }) => {
    const draft = draftFromFile(json);
    expect(draft).not.toBeNull();
    const written = draftToFile(draft!);
    // What the file leaves to a default, the editor writes out; nothing
    // that was in the file is lost or altered.
    expect(written).toMatchObject(json);
    expect(draftToFile(draftFromFile(written)!)).toEqual(written);
  });

  it('reads flows and their rates, and keeps what it has no control for as written', () => {
    const flood = files.find((file) => file.name === '01-ddos-surge.json')!.json;
    const draft = draftFromFile(flood)!;
    expect(draft.flows.every((flow) => flow.kind === 'flow')).toBe(true);
    const effects = draft.phases.flatMap((phase) => phase.effects);
    expect(effects.some((effect) => effect.kind === 'flowRate')).toBe(true);
    // A flow rejected at a node has no control: it is kept.
    const kept = effects.filter((effect) => effect.kind === 'raw');
    expect(kept.every((effect) => effect.json.type === 'flowReject')).toBe(true);
    expect(draftToFile(draft).flows).toEqual(flood.flows);
  });

  it('writes an effect on one connection, and reads it back as one', () => {
    const draft = blankScenario('');
    draft.phases[0]!.effects = [
      {
        key: rowKey(),
        kind: 'edgeError',
        target: '',
        value: 0.3,
        between: { from: 'role:primaryGateway', to: 'node:use-orders' },
      },
    ];
    const written = draftToFile(draft);
    const phases = written.phases as { effects: Record<string, unknown>[] }[];
    expect(phases[0]!.effects).toEqual([
      {
        type: 'edgeError',
        edges: { between: { from: 'role:primaryGateway', to: 'node:use-orders' } },
        rate: 0.3,
      },
    ]);
    // It names no one service as affected.
    expect(written.targets).toEqual([]);
    expect(draftFromFile(written)!.phases[0]!.effects[0]).toMatchObject({
      kind: 'edgeError',
      between: { from: 'role:primaryGateway', to: 'node:use-orders' },
    });
  });

  it('refuses what is not a scenario', () => {
    expect(draftFromFile(null)).toBeNull();
    expect(draftFromFile([])).toBeNull();
    expect(draftFromFile({ id: 'x' })).toBeNull();
  });

  it('writes each effect in the shape the engine reads', () => {
    const draft = blankScenario('role:primaryDatabase');
    draft.phases[0]!.effects = EFFECT_KINDS.map((kind) => ({
      key: rowKey(),
      kind,
      target: 'node:use-auth',
      value: EFFECT[kind].start,
    }));
    const effects = (draftToFile(draft).phases as { effects: Record<string, unknown>[] }[])[0]!
      .effects;
    expect(effects).toEqual([
      { type: 'capacity', nodes: 'node:use-auth', factor: 0.3 },
      { type: 'latency', nodes: 'node:use-auth', factor: 4 },
      { type: 'errorInject', nodes: 'node:use-auth', rate: 0.2 },
      { type: 'down', nodes: 'node:use-auth' },
      { type: 'demand', node: 'node:use-auth', factor: 3 },
      { type: 'edgeWeight', edges: { inboundSync: 'node:use-auth' }, factor: 1.8 },
      { type: 'edgeLatency', edges: { inboundSync: 'node:use-auth' }, factor: 4 },
      { type: 'edgeError', edges: { inboundSync: 'node:use-auth' }, rate: 0.2 },
    ]);
  });

  it('names as targets what its effects act on, and writes phases in time order', () => {
    const draft = blankScenario('role:primaryDatabase');
    draft.phases.unshift({ ...emptyPhase(45_000, 'recovering'), name: 'Late' });
    expect(derivedTargets(draft)).toEqual(['role:primaryDatabase']);
    const written = draftToFile(draft);
    expect(written.targets).toEqual(['role:primaryDatabase']);
    expect((written.phases as { atMs: number }[]).map((phase) => phase.atMs)).toEqual([
      0, 30_000, 45_000,
    ]);
    expect(written).not.toHaveProperty('rootCause');
  });

  it('says what is plainly missing before the server is asked', () => {
    const fine = blankScenario('role:primaryDatabase');
    expect(draftProblems(fine)).toEqual([]);
    const broken = blankScenario('');
    broken.phases[0]!.effects = [{ key: rowKey(), kind: 'latency', target: '', value: 4 }];
    broken.name = ' ';
    broken.id = 'two words';
    broken.phases[0]!.atMs = 5000;
    broken.phases[1]!.atMs = 90_000;
    expect(draftProblems(broken)).toEqual([
      'The scenario needs a name.',
      'The id is 1 to 64 letters, digits, "-", "_" or ".".',
      'One phase has to start at 0 seconds.',
      'An effect of “Degradation” is not placed on anything.',
      '“Recovery” starts after the scenario ends.',
    ]);
  });

  it('makes an id out of a name', () => {
    expect(slug('Slow database!')).toBe('slow-database');
    expect(slug('  Região São Paulo  ')).toBe('regiao-sao-paulo');
    expect(slug('x'.repeat(100))).toHaveLength(64);
  });

  it('offers roles first, then regions and services, for what an effect is placed on', () => {
    const many = targetChoices(topology, false);
    expect(many[0]!.group).toMatch(/^By role/);
    expect(many.map((choice) => choice.value)).toEqual(
      expect.arrayContaining([
        'role:primaryDatabase',
        'region:outageRegion',
        'gatewayOf:outageRegion',
        'region:eu-west',
        'node:use-orders-db',
      ]),
    );
    expect(many.find((choice) => choice.value === 'role:primaryDatabase')?.label).toBe(
      'primaryDatabase (Orders DB, US East · Primary)',
    );
    // Where one service is wanted, nothing that names several is offered.
    const one = targetChoices(topology, true);
    expect(one.some((choice) => choice.value.startsWith('region:'))).toBe(false);
    expect(one.some((choice) => choice.value === 'gatewayOf:outageRegion')).toBe(true);
  });
});

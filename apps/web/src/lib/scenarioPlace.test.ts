import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blankScenario,
  GATEWAY_TYPES,
  hopsThrough,
  inOrder,
  movePhase,
  newFlow,
  phaseAt,
  placeEffect,
  reachOf,
  removePhase,
  resolveNode,
  resolveNodes,
  rowKey,
  selectorLabel,
  selectorOfNode,
  selectorOfRegion,
  setDuration,
  setRamp,
  splitPhase,
  SYNC_RELATIONSHIPS,
  TICK_MS,
  type ScenarioDraft,
} from './scenarioFile';
import { draftFromFile as platformFromFile, type TopologyDraft } from './topologyFile';

// Vitest runs with the package directory as its working directory.
const root = (path: string) => resolve(process.cwd(), '../..', path);
const helios = platformFromFile(
  JSON.parse(readFileSync(root('fixtures/topologies/helios-commerce.json'), 'utf8')),
) as TopologyDraft;

/** Three phases: 0, 20 s and 40 s of a minute. */
function threePhases(): ScenarioDraft {
  const draft = blankScenario('role:primaryDatabase');
  const split = splitPhase(draft, 40_000)!;
  return split.draft;
}

describe('the phases of a scenario on its timeline', () => {
  it('starts with a phase at zero and one that lets go', () => {
    const draft = blankScenario('');
    expect(inOrder(draft).map((phase) => [phase.atMs, phase.status])).toEqual([
      [0, 'active'],
      [30_000, 'recovering'],
    ]);
    expect(draft.phases[0]!.effects).toEqual([]);
  });

  it('moves a start on the tick, a tick from its neighbours, and never the first', () => {
    const draft = threePhases();
    const [first, second, third] = inOrder(draft);
    expect(
      movePhase(draft, second!.key, 12_345).phases.find((p) => p.key === second!.key)?.atMs,
    ).toBe(12_400);
    // Against the next phase, and against the one before.
    expect(inOrder(movePhase(draft, second!.key, 99_000))[1]!.atMs).toBe(40_000 - TICK_MS);
    expect(inOrder(movePhase(draft, second!.key, -5))[1]!.atMs).toBe(TICK_MS);
    // Past the end of the scenario.
    expect(inOrder(movePhase(draft, third!.key, 70_000))[2]!.atMs).toBe(60_000 - TICK_MS);
    expect(movePhase(draft, first!.key, 5000)).toBe(draft);
  });

  it('keeps a ramp within its phase, and the end past the last start', () => {
    const draft = threePhases();
    const second = inOrder(draft)[1]!;
    const ramped = setRamp(draft, second.key, 25_000);
    expect(ramped.phases.find((p) => p.key === second.key)?.rampMs).toBe(10_000);
    expect(setRamp(draft, second.key, 1234).phases.find((p) => p.key === second.key)?.rampMs).toBe(
      1200,
    );
    expect(setDuration(draft, 1000).durationMs).toBe(40_000 + TICK_MS);
    expect(setDuration(draft, 9e9).durationMs).toBe(1_800_000);
  });

  it('cuts a phase in two where there is room, and takes one out', () => {
    const draft = blankScenario('');
    expect(splitPhase(draft, 30_050)).toBeNull();
    expect(splitPhase(draft, 59_999)).toBeNull();
    const split = splitPhase(draft, 12_000)!;
    const added = split.draft.phases.find((phase) => phase.key === split.key)!;
    expect(added).toMatchObject({ atMs: 12_000, status: 'mitigating', effects: [] });
    expect(phaseAt(split.draft, 15_000)?.key).toBe(split.key);
    // The first taken out, the next starts at zero.
    const first = inOrder(split.draft)[0]!;
    const without = removePhase(split.draft, first.key);
    expect(inOrder(without).map((phase) => phase.atMs)).toEqual([0, 30_000]);
    expect(removePhase(blankScenario(''), 'nothing').phases).toHaveLength(2);
  });
});

describe('what a scenario names on a platform', () => {
  it('reads a selector as the server does', () => {
    expect(resolveNode(helios, 'role:primaryDatabase')).toBe('use-orders-db');
    expect(resolveNode(helios, 'node:euw-cart')).toBe('euw-cart');
    expect(resolveNode(helios, 'gatewayOf:outageRegion')).toBe('euw-gateway');
    expect(resolveNode(helios, 'gatewayOf:eu-west')).toBe('euw-gateway');
    // A role that names a region names no one service.
    expect(resolveNode(helios, 'role:outageRegion')).toBeNull();
    expect(resolveNode(helios, 'node:nowhere')).toBeNull();
    expect(resolveNodes(helios, 'region:outageRegion')).toEqual(
      helios.nodes.filter((node) => node.region === 'eu-west').map((node) => node.id),
    );
  });

  it('says what an effect is placed on: services, every call into one, or one connection', () => {
    expect(
      reachOf(helios, { key: rowKey(), kind: 'down', target: 'role:primaryDatabase', value: 1 }),
    ).toEqual({
      nodes: ['use-orders-db'],
      edges: [],
    });
    const into = reachOf(helios, {
      key: rowKey(),
      kind: 'edgeLatency',
      target: 'role:primaryDatabase',
      value: 4,
    });
    expect(into.nodes).toEqual(['use-orders-db']);
    expect(into.edges).toEqual(
      expect.arrayContaining(['use-orders->use-orders-db', 'use-inventory->use-orders-db']),
    );
    const one = reachOf(helios, {
      key: rowKey(),
      kind: 'edgeError',
      target: '',
      value: 0.2,
      between: { from: 'node:use-orders', to: 'role:primaryDatabase' },
    });
    expect(one).toEqual({
      nodes: ['use-orders', 'use-orders-db'],
      edges: ['use-orders->use-orders-db'],
    });
    // A connection the platform does not have is placed on nothing.
    expect(
      reachOf(helios, {
        key: rowKey(),
        kind: 'edgeError',
        target: '',
        value: 0.2,
        between: { from: 'role:primaryDatabase', to: 'node:use-orders' },
      }),
    ).toEqual({ nodes: [], edges: [] });
  });

  it('names a service by its role first, and a region by a role that points at it', () => {
    expect(selectorOfNode(helios, 'use-orders-db')).toBe('role:primaryDatabase');
    expect(selectorOfNode(helios, 'euw-cart')).toBe('node:euw-cart');
    expect(selectorOfRegion(helios, 'eu-west')).toBe('region:outageRegion');
    expect(selectorOfRegion(helios, 'ap-southeast')).toBe('region:ap-southeast');
    expect(selectorLabel(helios, 'region:outageRegion')).toBe('every service of EU West');
    expect(selectorLabel(helios, 'node:nowhere')).toBe('node:nowhere (not on this platform)');
  });

  it('places an effect once, and draws a flow through what was clicked', () => {
    const draft = blankScenario('');
    const phase = draft.phases[0]!.key;
    const effect = { kind: 'latency' as const, target: 'role:primaryDatabase', value: 4 };
    const placed = placeEffect(draft, phase, effect);
    const again = placeEffect(placed.draft, phase, effect);
    expect(again.draft).toBe(placed.draft);
    expect(again.key).toBe(placed.key);

    const hops = hopsThrough(helios, ['partner-api', 'edge-router', 'use-orders']);
    expect(hops[0]).toEqual({ from: 'role:partnerClient', to: 'role:edgeRouter', via: 'edge' });
    // No connection from the router to the orders service: the shortest path between them.
    expect(hops[1]).toEqual({ from: 'role:edgeRouter', to: 'role:resource:Order', via: 'path' });
    expect(newFlow(draft, hops).id).toBe('flow-1');
  });

  it('looks for a gateway and a waiting call among the kinds the server does', () => {
    const rust = readFileSync(root('apps/server/src/domain/topology.rs'), 'utf8');
    const variants = (fn: string) => {
      const body = new RegExp(`fn ${fn}\\(self\\) -> bool \\{([^}]*)\\}`).exec(rust)?.[1] ?? '';
      return [...body.matchAll(/Self::(\w+)/g)].map(([, name]) =>
        name!.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
      );
    };
    expect(variants('is_gateway')).toEqual(GATEWAY_TYPES);
    expect(variants('is_sync')).toEqual(SYNC_RELATIONSHIPS);
  });
});

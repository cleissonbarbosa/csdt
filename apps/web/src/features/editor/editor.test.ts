import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DropSlot } from '@/graphics/layout';
import {
  addService,
  blankTopology,
  draftFromFile,
  draftText,
  edgeId,
  type TopologyDraft,
} from '@/lib/topologyFile';
import { snapshot as sampleSnapshot, topology as sampleTopology } from '@/test/fixtures';

import { addNear, dropMove, dropNew, placeFor } from './drop';
import { DRAFT_SCENE_ID, draftScene } from './scene';

const HELIOS = resolve(process.cwd(), '../../fixtures/topologies/helios-commerce.json');
const helios = () => draftFromFile(JSON.parse(readFileSync(HELIOS, 'utf8'))) as TopologyDraft;

const slot = (patch: Partial<DropSlot>): DropSlot => ({
  region: 'main',
  newRegion: false,
  tier: 1,
  insert: false,
  rect: { x0: 0, x1: 1, z0: 0, z1: 1 },
  ...patch,
});

describe('a drop', () => {
  it('stands a new service in the slot it was dropped on', () => {
    const { draft, id } = dropNew(blankTopology(), 'api-gateway', slot({ tier: 1 }));
    expect(draft.nodes.find((node) => node.id === id)).toMatchObject({
      type: 'api-gateway',
      region: 'main',
      tier: 1,
    });
  });

  it('makes a region for a slot past the last lane', () => {
    const { draft, id } = dropNew(
      blankTopology(),
      'database',
      slot({ region: null, newRegion: true }),
    );
    expect(draft.regions).toHaveLength(2);
    expect(draft.nodes.find((node) => node.id === id)?.region).toBe(draft.regions[1]?.id);
  });

  it('makes room for a new column, keeping the order along the path', () => {
    let draft = blankTopology();
    draft = addService(draft, 'api-gateway', 'main', 1).draft;
    const { draft: after, id } = dropNew(draft, 'load-balancer', slot({ tier: 1, insert: true }));
    const tiers = Object.fromEntries(after.nodes.map((node) => [node.id, node.tier]));
    expect(tiers).toEqual({ clients: 0, [id]: 1, 'api-gateway': 2 });
  });

  it('moves a service, into a new region too', () => {
    let draft = addService(blankTopology(), 'cache', 'main', 2).draft;
    draft = dropMove(draft, 'cache', slot({ tier: 4 }));
    expect(draft.nodes.find((node) => node.id === 'cache')?.tier).toBe(4);
    draft = dropMove(draft, 'cache', slot({ region: null, newRegion: true, tier: 2 }));
    const moved = draft.nodes.find((node) => node.id === 'cache');
    expect(moved?.region).not.toBe('main');
    expect(moved?.tier).toBe(2);
  });

  it('adds without a carry one tier past the selection, a client at the start', () => {
    const draft = addService(blankTopology(), 'api-gateway', 'main', 3).draft;
    expect(placeFor(draft, 'microservice', 'api-gateway')).toEqual({ region: 'main', tier: 4 });
    expect(placeFor(draft, 'external-client', 'api-gateway')).toEqual({ region: 'main', tier: 0 });
    expect(placeFor(draft, 'database', null)).toEqual({ region: 'main', tier: 4 });
    expect(addNear(draft, 'database', null).draft.nodes.at(-1)?.tier).toBe(4);
  });
});

describe('the draft as the scene draws it', () => {
  it('is unknown everywhere until the engine has run it', () => {
    const { topology, frame } = draftScene(helios(), null);
    expect(topology.id).toBe(DRAFT_SCENE_ID);
    expect(topology.nodes).toHaveLength(helios().nodes.length);
    expect(Array.from(frame.nodes.known!)).toEqual(helios().nodes.map(() => 0));
    expect(Array.from(frame.nodes.measured!)).toEqual(helios().nodes.map(() => 0));
    expect(frame.edges.trafficRps.every((rps) => rps === 0)).toBe(true);
  });

  it('takes each figure from the run, by id, whatever order either lists them in', () => {
    const run = sampleTopology();
    const snap = sampleSnapshot();
    const draft = { ...helios(), nodes: [...helios().nodes].reverse() };
    const answer = { text: draftText(draft), state: 'ran' as const, topology: run, snapshot: snap };
    const { topology, frame } = draftScene(draft, answer);
    draft.nodes.forEach((node, i) => {
      const k = run.nodes.findIndex((entry) => entry.id === node.id);
      expect(k, node.id).toBeGreaterThanOrEqual(0);
      expect(frame.nodes.health[i]).toBe(snap.nodes.health[k]);
      expect(frame.nodes.throughputRps[i]).toBe(snap.nodes.throughputRps[k]);
      expect(frame.nodes.known?.[i]).toBe(1);
      expect(topology.nodes[i]?.id).toBe(node.id);
    });
    draft.edges.forEach((edge, e) => {
      const k = run.edges.findIndex((entry) => entry.id === edgeId(edge));
      expect(k, edgeId(edge)).toBeGreaterThanOrEqual(0);
      expect(frame.edges.trafficRps[e]).toBe(snap.edges.trafficRps[k]);
    });
  });

  it('draws a service the run did not have as unknown', () => {
    const run = sampleTopology();
    const answer = {
      text: '',
      state: 'ran' as const,
      topology: run,
      snapshot: sampleSnapshot(),
    };
    const { draft, id } = addService(helios(), 'cache', 'us-east', 3);
    const { frame } = draftScene(draft, answer);
    const i = draft.nodes.findIndex((node) => node.id === id);
    expect(frame.nodes.known?.[i]).toBe(0);
    expect(Array.from(frame.nodes.known ?? []).filter((known) => known === 1)).toHaveLength(
      draft.nodes.length - 1,
    );
  });
});

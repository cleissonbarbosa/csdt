import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SERVICE_TYPES, type ServiceType } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import {
  addRegion,
  addService,
  blankTopology,
  circleIn,
  connect,
  connectable,
  connectionDefaults,
  DEFAULT_LATENCY_MS,
  disconnect,
  draftFromFile,
  draftProblems,
  draftToFile,
  edgeId,
  insertTier,
  moveService,
  pathBetween,
  removeRegion,
  removeService,
  renameService,
  rolesOf,
  setRole,
  uniqueId,
  updateService,
  type TopologyDraft,
} from './topologyFile';

// Vitest runs with the package directory as its working directory.
const ROOT = resolve(process.cwd(), '../..');
const COMPOSE = resolve(ROOT, 'apps/server/src/workspace/compose.rs');

/** Every topology file the repository ships: the fixtures and the examples. */
const files = [
  resolve(ROOT, 'fixtures/topologies'),
  ...readdirSync(resolve(ROOT, 'examples')).map((name) =>
    resolve(ROOT, 'examples', name, 'topologies'),
  ),
].flatMap((dir) => {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return (
    names
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({
        name,
        json: JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as Record<string, unknown>,
      }))
      // A cloud inventory sits in `topologies/` too, and is not this format.
      .filter(({ json }) => Array.isArray(json.nodes) && Array.isArray(json.edges))
  );
});

/** `ApiGateway` → `api-gateway`. */
const kebab = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

/** The body of a Rust function of `compose.rs`, from its signature to its closing brace. */
function body(signature: string): string {
  const source = readFileSync(COMPOSE, 'utf8');
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end);
}

function draft(): TopologyDraft {
  const read = draftFromFile({
    id: 'shop',
    name: 'Shop',
    dataSource: 'synthetic',
    regions: [{ id: 'floor', name: 'Floor', kind: 'cloud', location: 'Here' }],
    roles: { primaryGateway: 'door', outageRegion: 'floor' },
    nodes: [
      {
        id: 'buyers',
        name: 'Buyers',
        type: 'external-client',
        region: 'floor',
        tier: 0,
        baseLatencyMs: 0,
        baseRps: 50,
      },
      { id: 'door', name: 'Door', type: 'api-gateway', region: 'floor', tier: 1, baseLatencyMs: 4 },
      {
        id: 'till',
        name: 'Till',
        type: 'microservice',
        region: 'floor',
        tier: 2,
        baseLatencyMs: 20,
      },
      {
        id: 'ledger',
        name: 'Ledger',
        type: 'database',
        region: 'floor',
        tier: 3,
        baseLatencyMs: 5,
      },
    ],
    edges: [
      { source: 'buyers', target: 'door', protocol: 'https', relationship: 'route', weight: 1 },
      { source: 'door', target: 'till', protocol: 'https', relationship: 'call', weight: 1 },
      { source: 'till', target: 'ledger', protocol: 'sql', relationship: 'data', weight: 2 },
    ],
  });
  if (!read) throw new Error('the sample is a topology');
  return read;
}

describe('a topology file read and written back', () => {
  it('finds the files it is held to', () => {
    expect(files.map((file) => file.name)).toContain('helios-commerce.json');
    expect(files.map((file) => file.name)).toContain('corner-shop.json');
  });

  it.each(files.map((file) => [file.name, file.json] as const))(
    '%s loses and adds nothing',
    (_, json) => {
      const read = draftFromFile(json);
      expect(read).not.toBeNull();
      expect(draftToFile(read as TopologyDraft)).toEqual(json);
    },
  );

  it('is not something without nodes and edges', () => {
    expect(draftFromFile({ phases: [] })).toBeNull();
    expect(draftFromFile('text')).toBeNull();
    expect(draftFromFile(null)).toBeNull();
  });

  it('is always written as synthetic, and leaves out what is not stated', () => {
    const file = draftToFile(blankTopology());
    expect(file.dataSource).toBe('synthetic');
    const [client] = file.nodes as Record<string, unknown>[];
    expect(client).toEqual({
      id: 'clients',
      name: expect.any(String),
      type: 'external-client',
      region: 'main',
      tier: 0,
      baseLatencyMs: 0,
      baseRps: 100,
    });
    expect(draftProblems(blankTopology())).toEqual([]);
  });
});

describe('what a new service and a new connection start with', () => {
  it('is what the Compose reader gives a service of that kind', () => {
    const arms = [
      ...body('fn default_latency_ms(').matchAll(/((?:ServiceType::\w+\s*\|?\s*)+)=>\s*([0-9.]+)/g),
    ];
    const rust = new Map<string, number>();
    for (const [, kinds, ms] of arms) {
      for (const [, kind] of (kinds as string).matchAll(/ServiceType::(\w+)/g)) {
        rust.set(kebab(kind as string), Number(ms));
      }
    }
    expect([...rust.keys()].sort()).toEqual([...SERVICE_TYPES].sort());
    for (const type of SERVICE_TYPES) expect(DEFAULT_LATENCY_MS[type]).toBe(rust.get(type));
  });

  it('connects as the Compose reader links, except that a client routes', () => {
    const source = body('fn link(');
    const arms = new Map<string, { protocol: string; relationship: string }>();
    let fallback: { protocol: string; relationship: string } | null = null;
    for (const [, kind, protocol, relationship] of source.matchAll(
      /(ServiceType::\w+|_)\s*=>\s*\(Protocol::(\w+),\s*Relationship::(\w+)\)/g,
    )) {
      const link = {
        protocol: kebab(protocol as string),
        relationship: kebab(relationship as string),
      };
      if (kind === '_') fallback = link;
      else arms.set(kebab((kind as string).replace('ServiceType::', '')), link);
    }
    expect(fallback).not.toBeNull();
    for (const target of SERVICE_TYPES) {
      expect(connectionDefaults('microservice', target)).toEqual(arms.get(target) ?? fallback);
      expect(connectionDefaults('external-client', target)).toEqual({
        protocol: 'https',
        relationship: 'route',
      });
    }
  });
});

describe('changing a draft', () => {
  it('adds a service with an id and a name nobody has', () => {
    const first = addService(draft(), 'database', 'floor', 3);
    const second = addService(first.draft, 'database', 'floor', 3);
    expect(first.id).toBe('database');
    expect(second.id).toBe('database-2');
    const added = second.draft.nodes.slice(-2);
    expect(new Set(added.map((node) => node.name)).size).toBe(2);
    expect(added.every((node) => node.baseLatencyMs === DEFAULT_LATENCY_MS.database)).toBe(true);
    expect(added.every((node) => node.baseRps === null)).toBe(true);
  });

  it('keeps a tier within what the file can hold', () => {
    expect(addService(draft(), 'cache', 'floor', 900).draft.nodes.at(-1)?.tier).toBe(255);
    expect(moveService(draft(), 'till', 'floor', -4).nodes.find((n) => n.id === 'till')?.tier).toBe(
      0,
    );
  });

  it('moves a service by its region and its tier, and nothing else', () => {
    const before = draft();
    const after = moveService(before, 'till', 'floor', 5);
    expect(after.nodes.find((node) => node.id === 'till')?.tier).toBe(5);
    expect(after.edges).toBe(before.edges);
    expect(moveService(before, 'till', 'floor', 2)).toBe(before);
  });

  it('makes room for a column, keeping the order along the path', () => {
    const after = insertTier(draft(), 2);
    expect(after.nodes.map((node) => [node.id, node.tier])).toEqual([
      ['buyers', 0],
      ['door', 1],
      ['till', 3],
      ['ledger', 4],
    ]);
    const full = updateService(draft(), 'ledger', { tier: 255 });
    expect(insertTier(full, 2)).toBe(full);
  });

  it('connects with what the two kinds suggest', () => {
    const { draft: withCache, id } = addService(draft(), 'cache', 'floor', 3);
    const outcome = connect(withCache, 'till', id);
    expect('draft' in outcome).toBe(true);
    if (!('draft' in outcome)) return;
    expect(outcome.draft.edges.at(-1)).toEqual({
      source: 'till',
      target: id,
      protocol: 'redis',
      relationship: 'data',
      weight: 1,
      criticality: null,
      latencyMs: null,
    });
  });

  it('refuses a connection to itself, a second one, and one to nothing', () => {
    expect(connect(draft(), 'till', 'till')).toEqual({ refused: { reason: 'self' } });
    expect(connect(draft(), 'door', 'till')).toEqual({ refused: { reason: 'exists' } });
    expect(connect(draft(), 'door', 'nowhere')).toEqual({ refused: { reason: 'unknown' } });
  });

  it('refuses a connection that would close a circle, and names it', () => {
    expect(connect(draft(), 'ledger', 'door')).toEqual({
      refused: { reason: 'cycle', circle: ['ledger', 'door', 'till', 'ledger'] },
    });
    // Everything already reaches the ledger, so it can call nothing.
    expect([...connectable(draft(), 'ledger')]).toEqual([]);
    expect([...connectable(draft(), 'buyers')].sort()).toEqual(['ledger', 'till']);
  });

  it('finds the shortest path the same way every time', () => {
    const shortcut = connect(draft(), 'door', 'ledger');
    if (!('draft' in shortcut)) throw new Error('door can reach the ledger directly');
    expect(pathBetween(shortcut.draft, 'buyers', 'ledger')).toEqual(['buyers', 'door', 'ledger']);
    expect(pathBetween(draft(), 'ledger', 'buyers')).toBeNull();
    expect(pathBetween(draft(), 'till', 'till')).toEqual(['till']);
  });

  it('takes a service away with its connections and its roles', () => {
    const after = removeService(draft(), 'door');
    expect(after.nodes.map((node) => node.id)).toEqual(['buyers', 'till', 'ledger']);
    expect(after.edges.map(edgeId)).toEqual(['till->ledger']);
    expect(after.roles).toEqual({ outageRegion: 'floor' });
    expect(draftProblems(after)).toEqual([]);
  });

  it('renames a service everywhere it is named, and only to a free, valid id', () => {
    const after = renameService(draft(), 'door', 'front-door');
    expect(after.edges.map(edgeId)).toEqual([
      'buyers->front-door',
      'front-door->till',
      'till->ledger',
    ]);
    expect(rolesOf(after, 'front-door')).toEqual(['primaryGateway']);
    const before = draft();
    expect(renameService(before, 'door', 'till')).toBe(before);
    expect(renameService(before, 'door', 'not an id')).toBe(before);
  });

  it('disconnects one connection by its id', () => {
    expect(disconnect(draft(), 'door->till').edges.map(edgeId)).toEqual([
      'buyers->door',
      'till->ledger',
    ]);
  });

  it('adds regions, and takes away only an empty one', () => {
    const { draft: more, id } = addRegion(draft());
    expect(id).toBe('region');
    expect(removeRegion(more, id).regions.map((region) => region.id)).toEqual(['floor']);
    const before = draft();
    expect(removeRegion(before, 'floor')).toBe(before);
  });

  it('points a role and takes it away', () => {
    const pointed = setRole(draft(), 'primaryDatabase', 'ledger');
    expect(rolesOf(pointed, 'ledger')).toEqual(['primaryDatabase']);
    expect(rolesOf(setRole(pointed, 'primaryDatabase', null), 'ledger')).toEqual([]);
  });

  it('makes ids of names', () => {
    expect(uniqueId('API gateway', ['api-gateway'])).toBe('api-gateway-2');
    expect(uniqueId('***', [])).toBe('service');
  });
});

describe('what is plainly wrong before the server is asked', () => {
  it('names a circle a file was written with', () => {
    const json = draftToFile(draft()) as { edges: unknown[] };
    json.edges.push({
      source: 'ledger',
      target: 'door',
      protocol: 'https',
      relationship: 'call',
      weight: 1,
    });
    const read = draftFromFile(json) as TopologyDraft;
    expect(circleIn(read)).not.toBeNull();
    expect(draftProblems(read).some((problem) => problem.includes('→'))).toBe(true);
  });

  it('names a region, a connection and a role that point at nothing', () => {
    const broken: TopologyDraft = {
      ...draft(),
      roles: { primaryGateway: 'gone' },
      nodes: draft().nodes.map((node) =>
        node.id === 'till' ? { ...node, region: 'attic' } : node,
      ),
      edges: [...draft().edges, { ...draft().edges[0]!, target: 'ghost' }],
    };
    expect(draftProblems(broken)).toHaveLength(3);
  });

  it('is nothing for every file the repository ships', () => {
    for (const file of files)
      expect(draftProblems(draftFromFile(file.json) as TopologyDraft)).toEqual([]);
  });

  it('knows every kind of service', () => {
    const kinds: ServiceType[] = [...SERVICE_TYPES];
    for (const kind of kinds) expect(DEFAULT_LATENCY_MS[kind]).toBeGreaterThanOrEqual(0);
  });
});

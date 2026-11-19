import { describe, expect, it } from 'vitest';

import { BUNDLED } from './bundled';
import { readCapture, type Capture } from './capture';
import { DEFAULT_DEMAND_RPS, DEFAULT_LATENCY_MS, draftOf, type Draft } from './draft';
import { draftNotes, draftRefusal } from './draftNotes';

async function bundled(id: string): Promise<Capture> {
  const capture = readCapture(await BUNDLED.find((entry) => entry.id === id)!.load());
  if (!capture) throw new Error(`${id} is not a capture`);
  return capture;
}

interface Platform {
  id: string;
  description: string;
  dataSource: string;
  regions: { id: string }[];
  roles: Record<string, string>;
  nodes: {
    id: string;
    type: string;
    region: string;
    tier: number;
    baseLatencyMs: number;
    baseRps?: number;
    capacityRps?: number;
  }[];
  edges: { source: string; target: string; relationship: string; weight: number }[];
}

function drafted(capture: Capture, id: string): { draft: Draft; platform: Platform } {
  const draft = draftOf(capture, id);
  if ('refused' in draft) throw new Error(`refused: ${draft.refused}`);
  return { draft, platform: JSON.parse(draft.files[0]!.text) as Platform };
}

/** Whether the connections run one way: no service is reached from itself. */
function acyclic(platform: Platform): boolean {
  const out = new Map<string, string[]>();
  for (const edge of platform.edges)
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
  const done = new Set<string>();
  const open = new Set<string>();
  const visit = (node: string): boolean => {
    if (done.has(node)) return true;
    if (open.has(node)) return false;
    open.add(node);
    const ok = (out.get(node) ?? []).every(visit);
    open.delete(node);
    done.add(node);
    return ok;
  };
  return platform.nodes.every((node) => visit(node.id));
}

describe('a platform drafted from measurements', () => {
  it('holds the capture’s services, with the calls it measured between them', async () => {
    const capture = await bundled('online-boutique-rcaeval');
    const { draft, platform } = drafted(capture, 'online-boutique-rcaeval');

    expect(platform.id).toBe('online-boutique-rcaeval-draft');
    expect(platform.dataSource).toBe('synthetic');
    // Every service of the capture, and one client in front of what nothing calls.
    const services = platform.nodes.filter((node) => node.type !== 'external-client');
    expect(services.map((node) => node.id).sort()).toEqual(capture.nodes.map((n) => n.id).sort());
    const clients = platform.nodes.filter((node) => node.type === 'external-client');
    expect(clients).toHaveLength(1);
    // The benchmark's traces begin at the frontend, which therefore counted
    // no requests of its own: it is taken to be as busy as its busiest call.
    expect(draft.demand).toBe('convention');
    expect(clients[0]!.baseRps).toBeGreaterThan(0);
    // So the calls it makes downstream come out as the capture measured them:
    // demand times weight is the rate of each call, whatever figure is taken.
    const fromFrontend = platform.edges.filter((edge) => edge.source === 'frontend');
    expect(fromFrontend.length).toBeGreaterThan(1);
    expect(Math.max(...fromFrontend.map((edge) => edge.weight))).toBeCloseTo(1, 3);
    // Services seen in no call are in the platform, connected to nothing.
    expect(draft.unconnected).toBe(4);
    const linked = new Set(platform.edges.flatMap((edge) => [edge.source, edge.target]));
    expect(services.filter((node) => !linked.has(node.id))).toHaveLength(4);
    // The client's requests each take one way in.
    const ways = platform.edges.filter((edge) => edge.source === clients[0]!.id);
    expect(ways.every((edge) => edge.relationship === 'route')).toBe(true);
    expect(ways.reduce((sum, edge) => sum + edge.weight, 0)).toBeCloseTo(1, 3);

    // Connections the capture saw, or left out and said to be.
    expect(draft.connections + draft.leftOut.length).toBe(capture.edges.length);
    expect(acyclic(platform)).toBe(true);
    for (const edge of platform.edges) {
      expect(Number.isFinite(edge.weight) && edge.weight >= 0).toBe(true);
    }
    expect(draft.weights.measured).toBeGreaterThan(0);
    expect(draft.weights.measured + draft.weights.assumed).toBe(draft.connections);
    expect(draft.latency.measured + draft.latency.assumed).toBe(services.length);

    // No capacity is given: a capture states none.
    expect(platform.nodes.every((node) => node.capacityRps === undefined)).toBe(true);
    expect(platform.description).toContain('No capture states a capacity');
    expect(platform.description).toContain(capture.title);
    // A service is further along the path than whatever calls it.
    const tier = new Map(platform.nodes.map((node) => [node.id, node.tier]));
    for (const edge of platform.edges) {
      expect(tier.get(edge.target)!).toBeGreaterThan(tier.get(edge.source)!);
    }
  });

  it('comes with a scenario of the load that was measured, and of nothing else', async () => {
    const capture = await bundled('online-boutique-rcaeval');
    const { draft } = drafted(capture, 'online-boutique-rcaeval');
    expect(draft.scenario).not.toBeNull();
    const scenario = JSON.parse(draft.files[1]!.text) as {
      id: string;
      durationMs: number;
      phases: { atMs: number; effects: { type: string; node: string; factor: number }[] }[];
    };
    expect(draft.files[1]!.path).toBe(`scenarios/${scenario.id}.json`);
    expect(scenario.phases.length).toBe(draft.scenario!.phases);
    expect(scenario.phases.length).toBeLessThanOrEqual(32);
    // Ten minutes fit as they are: a second is a second.
    expect(draft.scenario!.compression).toBe(1);
    expect(scenario.durationMs).toBe(capture.window.endMs - capture.window.startMs);
    const times = scenario.phases.map((phase) => phase.atMs);
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
    expect(times.every((at) => at % 200 === 0 && at < scenario.durationMs)).toBe(true);
    // Only demand is prescribed, on the client, at the multiples measured.
    for (const phase of scenario.phases) {
      expect(phase.effects).toHaveLength(1);
      expect(phase.effects[0]).toMatchObject({ type: 'demand', node: 'node:clients' });
    }
    const factors = scenario.phases.map((phase) => phase.effects[0]!.factor);
    expect(Math.min(...factors)).toBe(draft.scenario!.low);
    expect(Math.max(...factors)).toBe(draft.scenario!.high);
    // At rest the load is, by the rule, about its own median.
    expect(draft.scenario!.low).toBeLessThanOrEqual(1);
    expect(draft.scenario!.high).toBeGreaterThanOrEqual(1);
  });
});

describe('a platform drafted from a provider’s report', () => {
  it('holds what the report names and gives every figure as a default', async () => {
    const capture = await bundled('google-cloud-2025-06-12');
    const { draft, platform } = drafted(capture, 'google-cloud-2025-06-12');
    expect(draft.demand).toBe('default');
    expect(draft.unconnected).toBe(0);
    expect(draft.scenario).toBeNull();
    expect(draft.files).toHaveLength(1);
    expect(draft.weights).toEqual({ measured: 0, assumed: draft.connections });
    expect(draft.latency).toEqual({ measured: 0, assumed: draft.services });
    const client = platform.nodes.find((node) => node.type === 'external-client')!;
    expect(client.baseRps).toBe(DEFAULT_DEMAND_RPS);
    for (const node of platform.nodes) {
      if (node !== client) expect(node.baseLatencyMs).toBe(DEFAULT_LATENCY_MS);
    }
    expect(platform.description).toContain(`a demand of ${DEFAULT_DEMAND_RPS} requests a second`);
    expect(acyclic(platform)).toBe(true);
    // What the dialog says of it says the same.
    const notes = draftNotes(capture, draft, client.baseRps ?? null);
    expect(notes.join(' ')).toContain('The capture measured no requests at its entry');
    expect(notes.join(' ')).toContain('No capture states a capacity');
  });
});

describe('what a draft cannot be written from', () => {
  it('leaves out a call that closes a circle, the less busy way, and says so', async () => {
    const capture = await bundled('online-boutique-rcaeval');
    const [first] = capture.edges;
    const back = { source: first!.target, target: first!.source, buckets: [] };
    const { draft, platform } = drafted({ ...capture, edges: [...capture.edges, back] }, 'looped');
    expect(draft.leftOut).toEqual([{ source: back.source, target: back.target }]);
    expect(acyclic(platform)).toBe(true);
    expect(platform.description).toContain(`${back.source} to ${back.target}`);
  });

  it('is refused with the reason', async () => {
    const capture = await bundled('google-cloud-2025-06-12');
    const long = { ...capture.nodes[0]!, id: 'x'.repeat(65) };
    expect(draftOf({ ...capture, nodes: [long, ...capture.nodes.slice(1)] }, 'x')).toEqual({
      refused: 'id-too-long',
    });
    const clients = capture.nodes.map((node) => ({ ...node, type: 'external-client' as const }));
    expect(draftOf({ ...capture, nodes: clients, edges: [] }, 'x')).toEqual({
      refused: 'no-service',
    });
    expect(draftRefusal('id-too-long')).toContain('64 characters');
  });

  it('gives a capture from a file an id a platform file takes', async () => {
    const capture = await bundled('google-cloud-2025-06-12');
    expect(drafted(capture, 'My capture (2).json').platform.id).toBe('My-capture-2-.json-draft');
    expect(drafted(capture, '!!!').platform.id).toBe('capture-draft');
    expect(drafted(capture, 'a'.repeat(200)).platform.id.length).toBeLessThanOrEqual(64);
  });
});

/**
 * The engine in the browser answers as the server does.
 *
 * `packages/contracts/samples` is what the native server emitted when
 * `export-contract-samples` drove it through a fixed sequence. This test
 * drives the WebAssembly module through the same sequence and compares what
 * comes out with those files. The module is the real one, loaded in Node the
 * way the worker loads it in a browser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { Engine } from './binding';

const POLICIES = fileURLToPath(
  new URL('../../../../fixtures/cedar/policies.json', import.meta.url),
);
const HELIOS = fileURLToPath(
  new URL('../../../../fixtures/topologies/helios-commerce.json', import.meta.url),
);
const MODULE = fileURLToPath(new URL('./aegis.wasm', import.meta.url));
const SAMPLES = fileURLToPath(new URL('../../../../packages/contracts/samples/', import.meta.url));

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function sample(name: string): Json {
  return JSON.parse(readFileSync(`${SAMPLES}${name}.json`, 'utf8')) as Json;
}

/** The fields the exporter zeroes because they depend on the wall clock. */
function normalise(value: Json): Json {
  if (Array.isArray(value)) return value.map(normalise);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'evaluationMicros' || key === 'uptimeSeconds' ? 0 : normalise(entry),
    ]),
  );
}

/** Where two values differ, as paths; numbers are compared exactly. */
function differences(actual: Json, expected: Json, path = '$', found: string[] = []): string[] {
  if (found.length >= 20) return found;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      found.push(`${path}: ${actual.length} items, expected ${expected.length}`);
      return found;
    }
    actual.forEach((item, index) =>
      differences(item, expected[index]!, `${path}[${index}]`, found),
    );
    return found;
  }
  const objects =
    actual !== null &&
    expected !== null &&
    typeof actual === 'object' &&
    typeof expected === 'object';
  if (objects && !Array.isArray(actual) && !Array.isArray(expected)) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) {
      if (!(key in actual)) found.push(`${path}.${key}: missing`);
      else if (!(key in expected)) found.push(`${path}.${key}: not expected`);
      else differences(actual[key]!, expected[key]!, `${path}.${key}`, found);
    }
    return found;
  }
  if (actual !== expected) {
    found.push(`${path}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
  return found;
}

/** The smallest workspace that replaces something; the exporter's own. */
function tinyWorkspace(): { path: string; text: string }[] {
  const topology = {
    id: 'front-desk',
    name: 'Front Desk',
    description: 'Fictional two-service platform used for the contract samples.',
    dataSource: 'synthetic',
    regions: [{ id: 'lobby', name: 'Lobby', kind: 'cloud', location: 'Ground floor' }],
    roles: { primaryGateway: 'door' },
    nodes: [
      {
        id: 'visitors',
        name: 'Visitors',
        type: 'external-client',
        region: 'lobby',
        tier: 0,
        baseLatencyMs: 0,
        baseRps: 40,
      },
      {
        id: 'door',
        name: 'Door',
        type: 'api-gateway',
        region: 'lobby',
        tier: 1,
        baseLatencyMs: 3,
        rateLimitRps: 90,
        suspiciousFilter: 0.9,
        autoscale: { maxFactor: 3, seconds: 20 },
      },
    ],
    edges: [
      {
        source: 'visitors',
        target: 'door',
        protocol: 'https',
        relationship: 'route',
        weight: 1.0,
      },
    ],
  };
  const scenario = {
    id: 'slow-door',
    name: 'Slow door',
    summary: 'The door takes several times longer to open.',
    category: 'resilience',
    severity: 'warning',
    durationMs: 20000,
    rootCause: 'role:primaryGateway',
    targets: ['role:primaryGateway'],
    phases: [
      {
        name: 'Stiff hinge',
        atMs: 0,
        rampMs: 2000,
        status: 'active',
        effects: [{ type: 'latency', nodes: 'role:primaryGateway', factor: 6.0 }],
      },
      { name: 'Recovery', atMs: 12000, rampMs: 3000, status: 'recovering' },
    ],
  };
  return [
    { path: 'topologies/front-desk.json', text: JSON.stringify(topology) },
    { path: 'scenarios/01-slow-door.json', text: JSON.stringify(scenario) },
  ];
}

/** The exporter's intervention: three times the capacity of authentication. */
const EXPERIMENT = {
  scenarioId: 'credential-stuffing',
  intervention: {
    effect: { type: 'capacity', nodes: 'node:use-auth', factor: 3.0 },
    atMs: 12000,
    rampMs: 1000,
  },
};

/** The bundled policies as an uploaded file, with one of them left out. */
function policiesWithout(id: string): { path: string; text: string } {
  const bundled = JSON.parse(readFileSync(POLICIES, 'utf8')) as { id: string; content: string }[];
  return {
    path: 'cedar/policies.json',
    text: JSON.stringify(
      bundled
        .filter((policy) => policy.id !== id)
        .map((policy) => ({ id: policy.id, content: policy.content })),
    ),
  };
}

/** The bundled platform with a larger gateway and one more service; the exporter's own. */
function largerGateway(): { path: string; text: string } {
  const topology = JSON.parse(readFileSync(HELIOS, 'utf8')) as {
    nodes: { id: string; capacityRps?: number }[];
    edges: { source: string; target: string; weight: number }[];
    roles: Record<string, string>;
  };
  for (const node of topology.nodes) {
    if (node.id === 'use-gateway') node.capacityRps = 7300;
  }
  topology.nodes.push({
    id: 'use-loyalty',
    name: 'Loyalty',
    type: 'microservice',
    region: 'us-east',
    tier: 4,
    baseLatencyMs: 9,
  } as (typeof topology.nodes)[number]);
  for (const edge of topology.edges) {
    if (edge.source === 'use-gateway' && edge.target === 'use-search') edge.weight = 0.1;
  }
  topology.edges.push(
    {
      source: 'use-gateway',
      target: 'use-loyalty',
      protocol: 'grpc',
      relationship: 'call',
      weight: 0.2,
    } as (typeof topology.edges)[number],
    {
      source: 'use-loyalty',
      target: 'use-orders-db',
      protocol: 'sql',
      relationship: 'data',
      weight: 1,
    } as (typeof topology.edges)[number],
  );
  topology.roles['resource:Loyalty'] = 'use-loyalty';
  return { path: 'topologies/helios-commerce.json', text: JSON.stringify(topology) };
}

describe('the engine built for the browser', () => {
  let engine: Engine;
  let clock = 0;
  /** What each step of the sequence produced, by the name of its sample. */
  const produced = new Map<string, Json>();

  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * 5; tick += 1) {
      clock += 200;
      engine.advance(200, clock);
    }
  };
  const call = (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const answer = engine.request(
      method,
      `/api/v1${path}`,
      body === undefined ? undefined : JSON.stringify(body),
      clock,
    );
    expect(answer.status, `${method} ${path}: ${answer.body}`).toBe(200);
    return { body: JSON.parse(answer.body) as Json, stream: answer.stream };
  };
  const get = (path: string) => call('GET', path).body;
  const post = (path: string, body: unknown) => call('POST', path, body);
  const message = (text: string) => JSON.parse(text) as Json;

  beforeAll(async () => {
    if (!existsSync(MODULE)) {
      throw new Error('src/engine/aegis.wasm is missing. Build it with `pnpm engine:build`.');
    }
    const { instance } = await WebAssembly.instantiate(readFileSync(MODULE), {});
    engine = Engine.from(instance.exports);
    engine.boot(42, clock);

    // The sequence of `export-contract-samples`, step for step.
    const [hello] = engine.open(clock);
    produced.set('stream-hello', message(hello!));
    advance(8);
    produced.set('health', get('/health'));
    produced.set('topologies', get('/topologies'));
    produced.set('recordings', get('/recordings'));
    produced.set('authorization-catalog', get('/demo/authorization/catalog'));

    produced.set(
      'control-response',
      post('/demo/scenarios/start', { scenarioId: 'credential-stuffing' }).body,
    );
    advance(22);
    produced.set(
      'decision-allow',
      post('/demo/authorization/evaluate', {
        principal: 'User::"alice"',
        action: 'Action::"exportLedger"',
        resource: 'Ledger::"acme-ledger-2026"',
        context: { mfa: true },
      }).body,
    );
    produced.set(
      'decision-deny',
      post('/demo/authorization/evaluate', {
        principal: 'User::"mallory"',
        action: 'Action::"exportLedger"',
        resource: 'Ledger::"acme-ledger-2026"',
      }).body,
    );
    produced.set(
      'authorization-explanation',
      post('/demo/authorization/explain', {
        principal: 'User::"bob"',
        action: 'Action::"refundOrder"',
        resource: 'Order::"acme-ord-9000"',
      }).body,
    );
    produced.set(
      'access-matrix',
      post('/demo/authorization/matrix', { context: { mfa: true } }).body,
    );
    post('/demo/faults/inject', {
      effect: { type: 'latency', nodes: 'node:use-search', factor: 3.0 },
      rampMs: 1000,
    });
    advance(2);

    produced.set('topology', get('/topology'));
    produced.set('scenarios', get('/scenarios'));
    produced.set('incidents', get('/incidents'));
    produced.set('incident-report', get('/incidents/inc-001/report'));
    produced.set('metrics', get('/metrics'));
    produced.set('events', get('/events?limit=1000'));
    produced.set('providers', get('/providers'));
    produced.set('authorization-decisions', get('/demo/authorization/decisions'));
    produced.set('session', get('/session'));
    produced.set('experiment', post('/demo/experiments/compare', EXPERIMENT).body);
    produced.set(
      'trial',
      post('/demo/experiments/trial', {
        effect: { type: 'down', nodes: 'node:use-orders-db' },
        rampMs: 1000,
      }).body,
    );
    produced.set(
      'platform-comparison',
      post('/demo/experiments/platforms', { files: [largerGateway()], scenarioId: 'ddos-surge' })
        .body,
    );
    produced.set('headroom', post('/demo/experiments/headroom', {}).body);
    produced.set('weak-points', post('/demo/experiments/weak-points', {}).body);
    produced.set('stream-snapshot', message(engine.open(clock)[1]!));
    const [replay] = engine.message('{"type":"resync","afterSeq":0}', clock);
    produced.set('stream-events', message(replay!));
    const seek = post('/demo/playback/control', { action: 'seek', toMs: 6000 });
    produced.set('stream-timeline', message(seek.stream[0]!));

    post('/demo/topology/select', { topologyId: 'hyperscale-stress' });
    advance(2);
    const stress = get('/topology') as {
      id: string;
      nodes: Json[];
      edges: Json[];
      regions: Json[];
    };
    produced.set('topology-stress-summary', {
      id: stress.id,
      nodes: stress.nodes.length,
      edges: stress.edges.length,
      regions: stress.regions.length,
    });

    produced.set('workspace', get('/workspace'));
    produced.set('workspace-check', post('/demo/workspace/check', { files: tinyWorkspace() }).body);
    produced.set(
      'workspace-diff',
      post('/demo/workspace/diff', { files: [policiesWithout('finance-view-ledger')] }).body,
    );
    const broken = tinyWorkspace();
    broken[1]!.text = '{ "id": "slow-door" }';
    produced.set('workspace-check-invalid', post('/demo/workspace/check', { files: broken }).body);
    const imported = post('/demo/workspace/import', { files: tinyWorkspace() });
    produced.set('workspace-response', imported.body);
    produced.set('workspace-export', get('/workspace/export'));
    produced.set('topology-mitigated', get('/topology'));
    produced.set('stream-timeline-workspace', message(imported.stream[0]!));
  });

  it.each([
    'stream-hello',
    'health',
    'topologies',
    'recordings',
    'authorization-catalog',
    'control-response',
    'decision-allow',
    'decision-deny',
    'authorization-explanation',
    'access-matrix',
    'topology',
    'scenarios',
    'incidents',
    'incident-report',
    'metrics',
    'events',
    'authorization-decisions',
    'session',
    'experiment',
    'trial',
    'platform-comparison',
    'headroom',
    'weak-points',
    'stream-snapshot',
    'stream-timeline',
    'topology-stress-summary',
    'workspace',
    'workspace-check',
    'workspace-check-invalid',
    'workspace-diff',
    'workspace-response',
    'workspace-export',
    'topology-mitigated',
    'stream-timeline-workspace',
  ])('answers %s exactly as the server does', (name) => {
    const actual = produced.get(name);
    expect(actual, `the sequence did not produce ${name}`).toBeDefined();
    expect(differences(normalise(actual!), sample(name))).toEqual([]);
  });

  it('replays the same events a subscriber of the server is sent', () => {
    // The sample holds the newest five; a resync from the start returns them all.
    const actual = produced.get('stream-events') as { type: string; data: Json[] };
    const expected = sample('stream-events') as { type: string; data: Json[] };
    expect(actual.type).toBe(expected.type);
    expect(actual.data.length).toBeGreaterThan(expected.data.length);
    expect(differences(normalise(actual.data.slice(-expected.data.length)), expected.data)).toEqual(
      [],
    );
  });

  it('lists only the built-in simulation as a provider', () => {
    const expected = (sample('providers') as { kind: string }[]).filter(
      (provider) => provider.kind === 'simulation',
    );
    expect(expected).toHaveLength(1);
    expect(differences(produced.get('providers')!, expected as Json)).toEqual([]);
  });

  it('refuses an engine it cannot reach, as the server does without one', () => {
    const answer = engine.request(
      'POST',
      '/api/v1/demo/authorization/evaluate',
      JSON.stringify({
        principal: 'User::"alice"',
        action: 'Action::"viewLedger"',
        resource: 'Ledger::"acme-ledger-2026"',
        engine: 'cedar-agent',
      }),
      clock,
    );
    expect(answer.status).toBe(503);
  });

  it('imports nothing from its host', async () => {
    const module = await WebAssembly.compile(readFileSync(MODULE));
    expect(WebAssembly.Module.imports(module)).toEqual([]);
  });
});

describe('every route, in the module', () => {
  // A route that reads a clock, a file or a thread the browser does not
  // have would stop the module with a panic. Each one is called here.
  it('answers without stopping the engine', async () => {
    if (!existsSync(MODULE)) {
      throw new Error('src/engine/aegis.wasm is missing. Build it with `pnpm engine:build`.');
    }
    const { instance } = await WebAssembly.instantiate(readFileSync(MODULE), {});
    const engine = Engine.from(instance.exports);
    let clock = 0;
    engine.boot(7, clock);
    const run = (ticks: number) => {
      for (let tick = 0; tick < ticks; tick += 1) {
        clock += 200;
        engine.advance(200, clock);
      }
    };
    const calls: [method: 'GET' | 'POST', path: string, body?: unknown, status?: number][] = [
      ['GET', '/health'],
      ['GET', '/topology'],
      ['GET', '/topologies'],
      ['GET', '/metrics'],
      ['GET', '/events?afterSeq=0&limit=10'],
      ['GET', '/incidents'],
      ['GET', '/scenarios'],
      ['GET', '/recordings'],
      ['GET', '/providers'],
      ['GET', '/workspace'],
      ['GET', '/workspace/export'],
      ['GET', '/demo/authorization/catalog'],
      ['GET', '/demo/authorization/decisions'],
      [
        'POST',
        '/demo/authorization/explain',
        {
          principal: 'User::"bob"',
          action: 'Action::"refundOrder"',
          resource: 'Order::"acme-ord-9000"',
        },
      ],
      ['POST', '/demo/authorization/matrix', {}],
      ['GET', '/session'],
      ['POST', '/demo/scenarios/start', { scenarioId: 'regional-outage' }],
      ['GET', '/incidents/inc-001/report'],
      [
        'POST',
        '/demo/experiments/compare',
        {
          scenarioId: 'regional-outage',
          intervention: { effect: { type: 'down', nodes: 'node:use-search' }, atMs: 4000 },
        },
      ],
      ['POST', '/demo/experiments/trial', { effect: { type: 'down', nodes: 'node:use-search' } }],
      [
        'POST',
        '/demo/experiments/platforms',
        { files: [largerGateway()], scenarioId: 'regional-outage' },
      ],
      ['POST', '/demo/experiments/headroom', {}],
      ['POST', '/demo/experiments/weak-points', {}],
      ['POST', '/demo/playback/control', { action: 'setSpeed', speed: 4 }],
      ['POST', '/demo/playback/control', { action: 'pause' }],
      ['POST', '/demo/playback/control', { action: 'step' }],
      ['POST', '/demo/playback/control', { action: 'seek', toMs: 1000 }],
      ['POST', '/demo/playback/control', { action: 'replay' }],
      ['POST', '/demo/playback/control', { action: 'live' }],
      ['POST', '/demo/playback/control', { action: 'play' }],
      ['POST', '/demo/scenarios/reset', { scope: 'scenario' }],
      [
        'POST',
        '/demo/faults/inject',
        { effect: { type: 'down', nodes: 'node:use-search' }, rampMs: 400 },
      ],
      [
        'POST',
        '/demo/faults/inject',
        {
          effect: {
            type: 'edgeError',
            edges: { between: { from: 'node:use-gateway', to: 'node:use-catalog' } },
            rate: 0.3,
          },
        },
      ],
      ['POST', '/demo/faults/clear', { effect: { type: 'down', nodes: 'node:use-search' } }],
      ['POST', '/demo/faults/clear', {}],
      ['POST', '/providers/demo-simulation/connect', {}],
      ['POST', '/providers/demo-simulation/disconnect', {}, 409],
      ['POST', '/demo/recordings/load', { recordingId: 'black-friday-flood' }],
      [
        'POST',
        '/demo/session/load',
        {
          recording: {
            id: 'session',
            name: 'Session',
            description: '',
            topologyId: 'helios-commerce',
            seed: 7,
            durationMs: 20000,
            commands: [
              { atMs: 2000, command: { type: 'startScenario', scenarioId: 'cedar-denial' } },
              {
                atMs: 6000,
                command: {
                  type: 'injectFault',
                  effect: { type: 'latency', nodes: 'node:use-search', factor: 2 },
                  rampMs: 400,
                },
              },
              { atMs: 9000, command: { type: 'clearFaults' } },
              { atMs: 12000, command: { type: 'abortScenario' } },
            ],
          },
          cursorMs: 8000,
        },
      ],
      ['POST', '/demo/playback/control', { action: 'play' }],
      ['POST', '/demo/workspace/diff', { files: [policiesWithout('forbid-suspended')] }],
      ['POST', '/demo/topology/select', { topologyId: 'hyperscale-stress' }],
      ['POST', '/demo/scenarios/reset', { scope: 'simulation' }],
      ['POST', '/demo/workspace/reset', {}],
    ];
    for (const [method, path, body, status = 200] of calls) {
      const answer = engine.request(
        method,
        `/api/v1${path}`,
        body === undefined ? undefined : JSON.stringify(body),
        clock,
      );
      expect(answer.status, `${method} ${path}: ${answer.body}`).toBe(status);
      expect(() => JSON.parse(answer.body) as unknown).not.toThrow();
      run(10);
    }
    expect(engine.failure).toBeNull();
    // The 178-service topology, for a virtual minute.
    engine.request(
      'POST',
      '/api/v1/demo/topology/select',
      '{"topologyId":"hyperscale-stress"}',
      clock,
    );
    run(300);
    expect(engine.failure).toBeNull();
  });
});

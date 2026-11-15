import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AuthorizationCatalogSchema,
  AuthorizationDecisionSchema,
  ControlResponseSchema,
  EventsResponseSchema,
  HEALTH_BY_CODE,
  HealthResponseSchema,
  HealthSchema,
  IncidentsResponseSchema,
  IntegrationStatusSchema,
  MetricsReportSchema,
  RecordingSummarySchema,
  SECURITY_STATUS_BY_CODE,
  ScenariosResponseSchema,
  SecurityStatusSchema,
  StreamMessageSchema,
  TopologiesResponseSchema,
  TopologySchema,
} from './index';

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples');

function sample(name: string): unknown {
  return JSON.parse(readFileSync(join(SAMPLES, `${name}.json`), 'utf8'));
}

/**
 * Every sample is real server output. Parsing strips unknown keys, so
 * requiring the parsed value to equal the input also catches fields the
 * server sends that the schema does not know about.
 */
const CASES: Record<string, z.ZodType> = {
  health: HealthResponseSchema,
  topology: TopologySchema,
  topologies: TopologiesResponseSchema,
  metrics: MetricsReportSchema,
  events: EventsResponseSchema,
  incidents: IncidentsResponseSchema,
  scenarios: ScenariosResponseSchema,
  recordings: z.array(RecordingSummarySchema),
  providers: z.array(IntegrationStatusSchema),
  'authorization-catalog': AuthorizationCatalogSchema,
  'authorization-decisions': z.array(AuthorizationDecisionSchema),
  'decision-allow': AuthorizationDecisionSchema,
  'decision-deny': AuthorizationDecisionSchema,
  'control-response': ControlResponseSchema,
  'stream-hello': StreamMessageSchema,
  'stream-snapshot': StreamMessageSchema,
  'stream-events': StreamMessageSchema,
  'stream-timeline': StreamMessageSchema,
  'stream-lagged': StreamMessageSchema,
  'stream-pong': StreamMessageSchema,
};

describe('contracts match real server output', () => {
  it.each(Object.entries(CASES))('%s', (name, schema) => {
    const raw = sample(name);
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new Error(`${name} does not satisfy its schema:\n${z.prettifyError(result.error)}`);
    }
    expect(result.data).toEqual(raw);
  });

  it('covers every sample the server exports', () => {
    const exported = readdirSync(SAMPLES)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''))
      .filter((name) => name !== 'topology-stress-summary');
    expect(exported.sort()).toEqual(Object.keys(CASES).sort());
  });
});

describe('columnar snapshots', () => {
  const message = StreamMessageSchema.parse(sample('stream-snapshot'));
  const topology = TopologySchema.parse(sample('topology'));
  if (message.type !== 'snapshot') throw new Error('expected a snapshot');
  const snapshot = message.data;

  it('align index-for-index with the topology', () => {
    for (const column of Object.values(snapshot.nodes)) {
      expect(column).toHaveLength(topology.nodes.length);
    }
    for (const column of Object.values(snapshot.edges)) {
      expect(column).toHaveLength(topology.edges.length);
    }
    expect(snapshot.regions.map((r) => r.id)).toEqual(topology.regions.map((r) => r.id));
  });

  it('use numeric codes that map onto the enums in declaration order', () => {
    expect([...HEALTH_BY_CODE]).toEqual(HealthSchema.options);
    expect([...SECURITY_STATUS_BY_CODE]).toEqual(SecurityStatusSchema.options);
    // The sample is taken mid-incident, so more than one code is in use.
    expect(new Set(snapshot.nodes.health).size).toBeGreaterThan(1);
    expect(new Set(snapshot.edges.securityStatus).size).toBeGreaterThan(1);
  });

  it('carry an active incident and its injected flow', () => {
    expect(snapshot.incident?.scenarioId).toBe('credential-stuffing');
    expect(snapshot.flows[0]?.hops.every((hop) => topology.edges.some((e) => e.id === hop))).toBe(
      true,
    );
  });
});

describe('schemas reject malformed data', () => {
  it('unknown enum members', () => {
    const topology = sample('topology') as { nodes: { serviceType: string }[] };
    const [first] = topology.nodes;
    if (!first) throw new Error('the topology sample has no nodes');
    first.serviceType = 'mainframe';
    expect(TopologySchema.safeParse(topology).success).toBe(false);
  });

  it('out-of-range rates and codes', () => {
    const message = sample('stream-snapshot') as {
      data: { global: { errorRate: number }; nodes: { health: number[] } };
    };
    message.data.global.errorRate = 1.5;
    expect(StreamMessageSchema.safeParse(message).success).toBe(false);
    message.data.global.errorRate = 0;
    message.data.nodes.health[0] = 9;
    expect(StreamMessageSchema.safeParse(message).success).toBe(false);
  });

  it('a different schema version', () => {
    const topology = sample('topology') as { schemaVersion: string };
    topology.schemaVersion = '2.0';
    expect(TopologySchema.safeParse(topology).success).toBe(false);
  });

  it('unknown stream message types', () => {
    expect(StreamMessageSchema.safeParse({ type: 'exec', command: 'rm' }).success).toBe(false);
  });
});

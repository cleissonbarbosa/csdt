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
  ExperimentSchema,
  HEALTH_BY_CODE,
  HealthResponseSchema,
  HealthSchema,
  IncidentReportSchema,
  IncidentsResponseSchema,
  IntegrationStatusSchema,
  MetricsReportSchema,
  RecordingSummarySchema,
  SECURITY_STATUS_BY_CODE,
  ScenariosResponseSchema,
  SecurityStatusSchema,
  SessionExportSchema,
  StreamMessageSchema,
  TopologiesResponseSchema,
  TopologySchema,
  WorkspaceBundleSchema,
  WorkspaceCheckSchema,
  WorkspaceDiffSchema,
  WorkspaceResponseSchema,
  WorkspaceStatusSchema,
  AccessMatrixSchema,
  AuthorizationExplanationSchema,
  TrialSchema,
  PlatformComparisonSchema,
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
  'incident-report': IncidentReportSchema,
  session: SessionExportSchema,
  experiment: ExperimentSchema,
  trial: TrialSchema,
  'platform-comparison': PlatformComparisonSchema,
  scenarios: ScenariosResponseSchema,
  'scenarios-unavailable': ScenariosResponseSchema,
  recordings: z.array(RecordingSummarySchema),
  providers: z.array(IntegrationStatusSchema),
  'authorization-catalog': AuthorizationCatalogSchema,
  'authorization-decisions': z.array(AuthorizationDecisionSchema),
  'decision-allow': AuthorizationDecisionSchema,
  'decision-deny': AuthorizationDecisionSchema,
  'authorization-explanation': AuthorizationExplanationSchema,
  'access-matrix': AccessMatrixSchema,
  'control-response': ControlResponseSchema,
  'stream-hello': StreamMessageSchema,
  'stream-snapshot': StreamMessageSchema,
  'stream-events': StreamMessageSchema,
  'stream-timeline': StreamMessageSchema,
  'stream-timeline-workspace': StreamMessageSchema,
  workspace: WorkspaceStatusSchema,
  'workspace-check': WorkspaceCheckSchema,
  'workspace-check-invalid': WorkspaceCheckSchema,
  'workspace-diff': WorkspaceDiffSchema,
  'workspace-response': WorkspaceResponseSchema,
  'workspace-export': WorkspaceBundleSchema,
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

  it('carry the faults placed by hand, by position in the topology', () => {
    // The exporter slows one service down by hand before taking the sample.
    expect(snapshot.faults).toEqual([
      { kind: 'latency', node: expect.any(Number), edge: null, onto: null, value: 3 },
    ]);
    expect(topology.nodes[snapshot.faults[0]?.node ?? -1]?.id).toBe('use-search');
  });
});

describe('what is read back from a run', () => {
  const report = IncidentReportSchema.parse(sample('incident-report'));
  const topology = TopologySchema.parse(sample('topology'));
  const experiment = ExperimentSchema.parse(sample('experiment'));

  it('names only services and connections of the topology', () => {
    const nodes = new Set(topology.nodes.map((node) => node.id));
    const edges = new Set(topology.edges.map((edge) => edge.id));
    expect(nodes.has(report.origin?.nodeId ?? '')).toBe(true);
    for (const phase of report.phases) {
      for (const effect of phase.prescribed) {
        expect(effect.nodeIds.every((id) => nodes.has(id))).toBe(true);
        expect(effect.edgeIds.every((id) => edges.has(id))).toBe(true);
      }
    }
    for (const transition of report.propagation) {
      expect(nodes.has(transition.nodeId)).toBe(true);
      // Every service that got worse says why, or says it cannot.
      expect(transition.cause).toBeDefined();
    }
  });

  it('counts a phase from the start of the incident as well as on the clock', () => {
    for (const phase of report.phases) {
      expect(phase.atMs - report.startedAtMs).toBe(phase.sinceStartMs);
    }
  });

  it('runs a comparison twice from one seed, with one command of difference', () => {
    const { baseline, variant, intervention } = experiment;
    expect(variant.recording.seed).toBe(baseline.recording.seed);
    expect(variant.recording.topologyId).toBe(baseline.recording.topologyId);
    expect(variant.recording.commands).toHaveLength(baseline.recording.commands.length + 1);
    const extra = variant.recording.commands.at(-1);
    expect(extra?.command).toEqual({
      type: 'injectFault',
      effect: intervention.effect,
      rampMs: intervention.rampMs,
    });
    // The runs are one run until the intervention is placed.
    const placedAt = experiment.incidentStartedAtMs + intervention.atMs;
    const before = (samples: typeof baseline.samples) =>
      samples.filter((s) => s.virtualTimeMs < placedAt);
    expect(before(variant.samples)).toEqual(before(baseline.samples));
    expect(variant.samples).not.toEqual(baseline.samples);
  });
});

describe('one scenario on two platforms', () => {
  const comparison = PlatformComparisonSchema.parse(sample('platform-comparison'));
  const { baseline, variant, changes } = comparison;

  it('runs the same commands from one seed on each', () => {
    expect(variant.recording.seed).toBe(baseline.recording.seed);
    expect(variant.recording.commands).toEqual(baseline.recording.commands);
    expect(variant.recording.durationMs).toBe(baseline.recording.durationMs);
    expect(baseline.recording.topologyId).toBe(comparison.base.id);
    expect(variant.recording.topologyId).toBe(comparison.candidate.id);
  });

  it('states what the file changed, as the file wrote it', () => {
    // The exporter's file: a larger gateway, one more service, fewer calls to search.
    expect(changes.servicesAdded).toEqual([{ id: 'use-loyalty', name: 'Loyalty' }]);
    expect(changes.servicesChanged).toEqual([
      {
        id: 'use-gateway',
        name: 'API Gateway',
        fields: [{ field: 'capacityRps', base: null, candidate: 7300 }],
      },
    ]);
    expect(changes.connectionsChanged[0]?.fields).toEqual([
      { field: 'weight', base: 0.14, candidate: 0.1 },
    ]);
    expect(comparison.candidate.nodeCount).toBe(comparison.base.nodeCount + 1);
  });

  it('lists capacity only where no file states it', () => {
    const stated = new Set(
      changes.servicesChanged
        .filter((change) => change.fields.some((entry) => entry.field === 'capacityRps'))
        .map((change) => change.id),
    );
    expect(changes.derivedCapacity.length).toBeGreaterThan(0);
    for (const entry of changes.derivedCapacity) {
      expect(stated.has(entry.id)).toBe(false);
      expect(entry.candidate).not.toBe(entry.base);
    }
  });

  it('says where the scenario prescribes another figure, from the two reports', () => {
    // The surge is written as a share of the gateway's capacity.
    expect(comparison.prescribed.length).toBeGreaterThan(0);
    for (const change of comparison.prescribed) {
      const phase = (run: typeof baseline) =>
        run.report.phases.find((entry) => entry.name === change.phase)?.prescribed;
      expect(change.base).toEqual(phase(baseline));
      expect(change.candidate).toEqual(phase(variant));
      expect(change.candidate).not.toEqual(change.base);
    }
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

  it('a session that carries an outcome', () => {
    const session = sample('session') as {
      recording: { commands: { atMs: number; command: unknown }[] };
    };
    session.recording.commands.push({
      atMs: 0,
      command: { type: 'recordDecision', decision: sample('decision-allow') },
    });
    expect(SessionExportSchema.safeParse(session).success).toBe(false);
  });

  it('unknown stream message types', () => {
    expect(StreamMessageSchema.safeParse({ type: 'exec', command: 'rm' }).success).toBe(false);
  });
});

/**
 * AEGIS data contracts, version 1.0.
 *
 * The Rust server is the source of truth. These zod schemas mirror it and are
 * verified against real server output (`samples/`, produced by
 * `cargo run -p aegis-server --bin export-contract-samples`), so a field
 * added, removed or retyped on either side fails the contract tests.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = '1.0';
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Provenance of data. AEGIS never presents one kind as another. */
export const DataSourceSchema = z.enum(['synthetic', 'recording', 'live']);
export type DataSource = z.infer<typeof DataSourceSchema>;

export const ServiceTypeSchema = z.enum([
  'api-gateway',
  'auth-service',
  'cedar-authorizer',
  'microservice',
  'container',
  'serverless',
  'message-queue',
  'database',
  'storage',
  'network-gateway',
  'security-monitor',
  'external-client',
  'load-balancer',
  'virtual-machine',
  'kubernetes-cluster',
  'cache',
  'event-stream',
]);
export type ServiceType = z.infer<typeof ServiceTypeSchema>;
export const SERVICE_TYPES = ServiceTypeSchema.options;

export const HealthSchema = z.enum(['healthy', 'degraded', 'critical', 'down']);
export type Health = z.infer<typeof HealthSchema>;
/** Health by the numeric code used in columnar snapshots. */
export const HEALTH_BY_CODE = [
  'healthy',
  'degraded',
  'critical',
  'down',
] as const satisfies readonly Health[];

export const SecurityStatusSchema = z.enum([
  'secure',
  'authorized',
  'throttled',
  'denied',
  'suspicious',
]);
export type SecurityStatus = z.infer<typeof SecurityStatusSchema>;
/** Security status by the numeric code used in columnar snapshots. */
export const SECURITY_STATUS_BY_CODE = [
  'secure',
  'authorized',
  'throttled',
  'denied',
  'suspicious',
] as const satisfies readonly SecurityStatus[];

export const ProtocolSchema = z.enum([
  'https',
  'grpc',
  'amqp',
  'sql',
  'redis',
  's3',
  'tcp',
  'otlp',
]);
export type Protocol = z.infer<typeof ProtocolSchema>;

export const RelationshipSchema = z.enum([
  'route',
  'call',
  'auth',
  'authz',
  'data',
  'publish',
  'consume',
  'replication',
  'telemetry',
]);
export type Relationship = z.infer<typeof RelationshipSchema>;

export const SeveritySchema = z.enum(['info', 'notice', 'warning', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;
export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  notice: 1,
  warning: 2,
  critical: 3,
};

/**
 * Where the files in use came from: compiled into the server, a workspace it
 * was started with, or an import made since (held in memory, gone on restart).
 */
export const WorkspaceOriginSchema = z.enum(['bundled', 'startup', 'imported']);
export type WorkspaceOrigin = z.infer<typeof WorkspaceOriginSchema>;

const count = z.number().int().nonnegative();
const rate = z.number().nonnegative();
const fraction = z.number().min(0).max(1);

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['edge', 'cloud']),
  location: z.string(),
});
export type Region = z.infer<typeof RegionSchema>;

export const NodeMetricsSchema = z.object({
  health: HealthSchema,
  latencyMs: rate,
  throughputRps: rate,
  errorRate: fraction,
  saturation: rate,
  queueDepth: rate,
});
export type NodeMetrics = z.infer<typeof NodeMetricsSchema>;

export const InfrastructureNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  serviceType: ServiceTypeSchema,
  region: z.string(),
  environment: z.enum(['production', 'staging', 'demo']),
  tier: count,
  description: z.string(),
  dataSource: DataSourceSchema,
  /** 0 for external clients, which have no capacity limit. */
  capacityRps: rate,
  baselineLatencyMs: rate,
  /**
   * What the topology file states the service does about load; each is
   * absent when the file states none. `rateLimitRps`: the most it admits a
   * second, the rest turned away at its door. `suspiciousFilter`: the share
   * of traffic a scenario marks suspicious that it turns away on arrival.
   * `autoscale`: capacity that follows the load, up to `maxFactor` times
   * what it is at rest, closing the gap with a time constant of `seconds`.
   */
  rateLimitRps: z.number().positive().optional(),
  suspiciousFilter: fraction.optional(),
  autoscale: z.object({ maxFactor: z.number().min(1), seconds: z.number().positive() }).optional(),
  connectedServices: z.array(z.string()),
  metrics: NodeMetricsSchema,
});
export type InfrastructureNode = z.infer<typeof InfrastructureNodeSchema>;

export const EdgeMetricsSchema = z.object({
  trafficRps: rate,
  latencyMs: rate,
  errorRate: fraction,
  rejectedRps: rate,
  suspiciousRps: rate,
  securityStatus: SecurityStatusSchema,
});
export type EdgeMetrics = z.infer<typeof EdgeMetricsSchema>;

export const InfrastructureEdgeSchema = z.object({
  /** `"<source>-><target>"`. */
  id: z.string(),
  source: z.string(),
  target: z.string(),
  protocol: ProtocolSchema,
  relationship: RelationshipSchema,
  weight: rate,
  crossRegion: z.boolean(),
  metrics: EdgeMetricsSchema,
});
export type InfrastructureEdge = z.infer<typeof InfrastructureEdgeSchema>;

export const TopologySchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  dataSource: DataSourceSchema,
  regions: z.array(RegionSchema),
  roles: z.record(z.string(), z.string()),
  nodes: z.array(InfrastructureNodeSchema),
  edges: z.array(InfrastructureEdgeSchema),
});
export type Topology = z.infer<typeof TopologySchema>;

export const TopologySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodeCount: count,
  edgeCount: count,
  regionCount: count,
  dataSource: DataSourceSchema,
});
export type TopologySummary = z.infer<typeof TopologySummarySchema>;

export const TopologiesResponseSchema = z.object({
  activeId: z.string(),
  topologies: z.array(TopologySummarySchema),
});
export type TopologiesResponse = z.infer<typeof TopologiesResponseSchema>;

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const PlaybackStateSchema = z.object({
  status: z.enum(['playing', 'paused']),
  /** `live`: at the head of the timeline. `replay`: inside recorded history. */
  mode: z.enum(['live', 'replay']),
  speed: z.number().positive(),
  tick: count,
  virtualTimeMs: count,
  headTick: count,
  headTimeMs: count,
  /** Earliest point that can still be sought to. */
  windowStartMs: count,
  tickMs: z.number().int().positive(),
  recordingId: z.string().nullable(),
});
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;

export const ControlResponseSchema = z.object({ playback: PlaybackStateSchema });
export type ControlResponse = z.infer<typeof ControlResponseSchema>;

export type ControlAction =
  | { action: 'play' | 'pause' | 'step' | 'replay' | 'live' }
  | { action: 'seek'; toMs: number }
  | { action: 'setSpeed'; speed: PlaybackSpeed };

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export const HealthCountsSchema = z.object({
  healthy: count,
  degraded: count,
  critical: count,
  down: count,
});
export type HealthCounts = z.infer<typeof HealthCountsSchema>;

export const GlobalMetricsSchema = z.object({
  /** Requests per second arriving at the edge (legitimate + injected). */
  rps: rate,
  avgLatencyMs: rate,
  p50LatencyMs: rate,
  p95LatencyMs: rate,
  p99LatencyMs: rate,
  /** Share of legitimate client requests that fail. */
  errorRate: fraction,
  authzChecksRps: rate,
  /** Share of authorization checks that end in Deny. */
  authzDenialRate: fraction,
  rejectedRps: rate,
  suspiciousRps: rate,
  activeIncidents: count,
  health: HealthCountsSchema,
});
export type GlobalMetrics = z.infer<typeof GlobalMetricsSchema>;

/** Per-node metrics, struct-of-arrays. Index `i` is `topology.nodes[i]`. */
export const NodeColumnsSchema = z.object({
  /** Codes into {@link HEALTH_BY_CODE}. */
  health: z.array(z.number().int().min(0).max(3)),
  latencyMs: z.array(rate),
  throughputRps: z.array(rate),
  errorRate: z.array(fraction),
  saturation: z.array(rate),
  queueDepth: z.array(rate),
});
export type NodeColumns = z.infer<typeof NodeColumnsSchema>;

/** Per-edge metrics, struct-of-arrays. Index `i` is `topology.edges[i]`. */
export const EdgeColumnsSchema = z.object({
  trafficRps: z.array(rate),
  latencyMs: z.array(rate),
  errorRate: z.array(fraction),
  rejectedRps: z.array(rate),
  suspiciousRps: z.array(rate),
  /** Codes into {@link SECURITY_STATUS_BY_CODE}. */
  securityStatus: z.array(z.number().int().min(0).max(4)),
});
export type EdgeColumns = z.infer<typeof EdgeColumnsSchema>;

export const RegionStatusSchema = z.object({
  id: z.string(),
  health: HealthSchema,
  rps: rate,
  errorRate: fraction,
  nodesTotal: count,
  nodesUnhealthy: count,
});
export type RegionStatus = z.infer<typeof RegionStatusSchema>;

export const TrafficCategorySchema = z.enum([
  'request',
  'response',
  'authentication',
  'authorization',
  'queue-message',
  'error',
  'rejected',
  'suspicious',
]);
export type TrafficCategory = z.infer<typeof TrafficCategorySchema>;

export const RejectReasonSchema = z.enum([
  'waf',
  'rate-limit',
  'auth-failure',
  'session-revoked',
  'policy-deny',
]);
export type RejectReason = z.infer<typeof RejectReasonSchema>;

/** A scenario-injected traffic flow currently active in the simulation. */
export const TrafficEventSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: TrafficCategorySchema,
  /** Edge ids the flow traverses, in order. */
  hops: z.array(z.string()),
  rps: rate,
  deliveredRps: rate,
  blockedAt: z.string().nullable(),
  blockedReason: RejectReasonSchema.nullable(),
});
export type TrafficEvent = z.infer<typeof TrafficEventSchema>;

export const IncidentStatusSchema = z.enum(['active', 'mitigating', 'recovering', 'resolved']);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentPulseSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  status: IncidentStatusSchema,
  phaseIndex: count,
  phaseCount: count,
  phaseName: z.string(),
  /** Progress through the whole scenario, 0..1. */
  progress: fraction,
  impactedNodeIds: z.array(z.string()),
});
export type IncidentPulse = z.infer<typeof IncidentPulseSchema>;

/**
 * What a fault placed by hand bends. The names are those of the scenario
 * effects that do the same.
 */
export const FaultKindSchema = z.enum([
  'demand',
  'capacity',
  'latency',
  'errorInject',
  'down',
  'edgeWeight',
  'edgeLatency',
  'edgeError',
  'routeShift',
]);
export type FaultKind = z.infer<typeof FaultKindSchema>;

/**
 * A fault placed by hand that is in force: one figure of one service or
 * connection, held away from nominal until it is lifted.
 */
export const ActiveFaultSchema = z.object({
  kind: FaultKindSchema,
  /** The service it is on, as an index into the topology's nodes. */
  node: count.nullable(),
  /** The connection it is on, as an index into the topology's edges. */
  edge: count.nullable(),
  /** For a route shift, the connection the traffic is moved onto. */
  onto: count.nullable(),
  /** A factor, or a rate or fraction from 0 to 1. A service that is down has 1. */
  value: rate,
});
export type ActiveFault = z.infer<typeof ActiveFaultSchema>;

/** One connection, by its two ends, each written as in a scenario file. */
export interface FaultEdge {
  from: string;
  to: string;
}

/** The connections a fault is placed on: one, or every synchronous one into a service. */
export type FaultEdges = { between: FaultEdge } | { inboundSync: string };

/**
 * A fault to place by hand: one scenario effect on services or connections,
 * in the format a scenario phase writes it in. Services are named
 * `node:<id>`, or `region:<id>` for every service of a region.
 */
export type FaultEffect =
  | { type: 'demand'; node: string; factor: number }
  | { type: 'capacity' | 'latency'; nodes: string; factor: number }
  | { type: 'errorInject'; nodes: string; rate: number }
  | { type: 'down'; nodes: string }
  | { type: 'edgeWeight' | 'edgeLatency'; edges: FaultEdges; factor: number }
  | { type: 'edgeError'; edges: FaultEdges; rate: number }
  | { type: 'routeShift'; edge: FaultEdge; onto: FaultEdge; fraction: number };

export const TelemetrySnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  topologyId: z.string(),
  dataSource: DataSourceSchema,
  tick: count,
  virtualTimeMs: count,
  /** Sequence number of the newest event at this point in time. */
  seq: count,
  global: GlobalMetricsSchema,
  nodes: NodeColumnsSchema,
  edges: EdgeColumnsSchema,
  regions: z.array(RegionStatusSchema),
  flows: z.array(TrafficEventSchema),
  incident: IncidentPulseSchema.nullable(),
  /** Faults placed by hand and in force at this point in time. */
  faults: z.array(ActiveFaultSchema),
  playback: PlaybackStateSchema,
});
export type TelemetrySnapshot = z.infer<typeof TelemetrySnapshotSchema>;

export const MetricSampleSchema = z.object({
  tick: count,
  virtualTimeMs: count,
  rps: rate,
  avgLatencyMs: rate,
  p95LatencyMs: rate,
  p99LatencyMs: rate,
  errorRate: fraction,
  authzDenialRate: fraction,
  suspiciousRps: rate,
});
export type MetricSample = z.infer<typeof MetricSampleSchema>;

export const MetricsReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  dataSource: DataSourceSchema,
  current: GlobalMetricsSchema,
  history: z.array(MetricSampleSchema),
});
export type MetricsReport = z.infer<typeof MetricsReportSchema>;

// ---------------------------------------------------------------------------
// Events and incidents
// ---------------------------------------------------------------------------

export const EventKindSchema = z.enum([
  'health-transition',
  'incident-started',
  'incident-phase',
  'incident-resolved',
  'authz-decision',
  'auth-failure',
  'mitigation',
  'reroute',
  'alert',
  'system',
]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const SecurityEventSchema = z.object({
  /** Monotonic, gapless within a timeline. */
  seq: count,
  id: z.string(),
  tick: count,
  virtualTimeMs: count,
  severity: SeveritySchema,
  kind: EventKindSchema,
  title: z.string(),
  message: z.string(),
  nodeIds: z.array(z.string()),
  edgeIds: z.array(z.string()),
  incidentId: z.string().nullable(),
  dataSource: DataSourceSchema,
  /** Kind-specific payload; absent when there is none. */
  details: z.unknown().optional(),
});
export type SecurityEvent = z.infer<typeof SecurityEventSchema>;

export const EventsResponseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  events: z.array(SecurityEventSchema),
  playback: PlaybackStateSchema,
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  title: z.string(),
  severity: SeveritySchema,
  status: IncidentStatusSchema,
  startedAtMs: count,
  resolvedAtMs: count.nullable(),
  phaseIndex: count,
  phaseName: z.string(),
  rootCauseNodeId: z.string().nullable(),
  impactedNodeIds: z.array(z.string()),
  summary: z.string(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const IncidentsResponseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  incidents: z.array(IncidentSchema),
});

export const ScenarioPhaseSchema = z.object({
  name: z.string(),
  atMs: count,
  status: IncidentStatusSchema,
  description: z.string(),
});
export type ScenarioPhase = z.infer<typeof ScenarioPhaseSchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  category: z.enum(['availability', 'identity', 'authorization', 'resilience']),
  severity: SeveritySchema,
  durationMs: count,
  phases: z.array(ScenarioPhaseSchema),
  targetNodeIds: z.array(z.string()),
  /** False when the active topology lacks a role the scenario needs. */
  available: z.boolean(),
  /** Specific reason this scenario cannot run on the active topology. */
  unavailableReason: z.string().optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenariosResponseSchema = z.object({
  scenarios: z.array(ScenarioSchema),
  activeScenarioId: z.string().nullable(),
});
export type ScenariosResponse = z.infer<typeof ScenariosResponseSchema>;

export const RecordingSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  topologyId: z.string(),
  durationMs: count,
  scenarioIds: z.array(z.string()),
});
export type RecordingSummary = z.infer<typeof RecordingSummarySchema>;

// ---------------------------------------------------------------------------
// Incident report: an incident read back from the timeline it ran on
// ---------------------------------------------------------------------------

/** Something the scenario file holds the model to during a phase. */
export const PrescribedEffectSchema = z.object({
  /** The effect in a few words: `latency ×6`. */
  description: z.string(),
  nodeIds: z.array(z.string()),
  edgeIds: z.array(z.string()),
});
export type PrescribedEffect = z.infer<typeof PrescribedEffectSchema>;

/**
 * Why a service left its normal state, as far as the run shows.
 * `prescribed`: the scenario acts on it. `dependency`: something it calls
 * (or a queue's consumer) was already unwell. `load`: it receives traffic
 * the scenario adds elsewhere. `fault`: a fault placed by hand is on it.
 * `unattributed`: none of those; the report does not guess.
 */
export const CauseKindSchema = z.enum([
  'prescribed',
  'dependency',
  'load',
  'fault',
  'unattributed',
]);
export type CauseKind = z.infer<typeof CauseKindSchema>;

export const CauseSchema = z.object({
  kind: CauseKindSchema,
  effect: z.string().optional(),
  viaNodeId: z.string().optional(),
  edgeId: z.string().optional(),
});
export type Cause = z.infer<typeof CauseSchema>;

export const ReportTransitionSchema = z.object({
  /** Sequence number of the event it was read from. */
  seq: count,
  nodeId: z.string(),
  atMs: count,
  from: HealthSchema,
  to: HealthSchema,
  /** Present when the service got worse. */
  cause: CauseSchema.optional(),
});
export type ReportTransition = z.infer<typeof ReportTransitionSchema>;

export const ReportEventSchema = z.object({
  seq: count,
  atMs: count,
  severity: SeveritySchema,
  title: z.string(),
  /** True when the scenario announces it; false when a detection rule raised it. */
  scripted: z.boolean(),
});
export type ReportEvent = z.infer<typeof ReportEventSchema>;

export const PeakSchema = z.object({ value: rate, atMs: count });
export type Peak = z.infer<typeof PeakSchema>;

export const ReportPhaseSchema = z.object({
  index: count,
  name: z.string(),
  status: IncidentStatusSchema,
  description: z.string(),
  /** When the phase was entered, on the simulation clock. */
  atMs: count,
  /** The same moment, counted from the start of the incident. */
  sinceStartMs: count,
  endedAtMs: count.nullable(),
  prescribed: z.array(PrescribedEffectSchema),
  /** Services that got worse during the phase, in order. */
  transitions: z.array(ReportTransitionSchema),
  events: z.array(ReportEventSchema),
  peakErrorRate: PeakSchema.nullable(),
  peakP95LatencyMs: PeakSchema.nullable(),
});
export type ReportPhase = z.infer<typeof ReportPhaseSchema>;

export const ReportDecisionSchema = z.object({
  requestId: z.string(),
  principal: z.string(),
  action: z.string(),
  resource: z.string(),
  decision: z.enum(['allow', 'deny']),
  determiningPolicies: z.array(z.string()),
  /** Decision events of the incident that carry this request. */
  count,
  firstAtMs: count,
  firstSeq: count,
});
export type ReportDecision = z.infer<typeof ReportDecisionSchema>;

/**
 * One of the platform's objectives over an incident: the figure it holds the
 * platform under, and how long it was not met. The objectives are the ones
 * the engine's own detection rules alert on; the time is counted from the
 * samples it recorded, one a second.
 */
export const ReportObjectiveSchema = z.object({
  kind: z.enum(['error-rate', 'latency-p95']),
  /** A share of requests for the error rate; milliseconds for latency. */
  threshold: z.number().nonnegative(),
  breachedMs: count,
  /** When it first was not met, on the simulation clock. */
  firstBreachedAtMs: count.nullable(),
});
export type ReportObjective = z.infer<typeof ReportObjectiveSchema>;

export const IncidentReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  dataSource: DataSourceSchema,
  incidentId: z.string(),
  scenarioId: z.string(),
  title: z.string(),
  severity: SeveritySchema,
  status: IncidentStatusSchema,
  startedAtMs: count,
  /** When the scenario ended or was stopped. */
  resolvedAtMs: count.nullable(),
  /** How it ended, in the engine's words. */
  resolution: z.string().nullable(),
  /** When the last affected service was back to normal, once it has ended. */
  recoveredAtMs: count.nullable(),
  /** The last moment the report covers. */
  observedUntilMs: count,
  origin: z
    .object({
      nodeId: z.string(),
      /** On what grounds: the scenario says so, or the run shows it. */
      basis: z.enum(['declared', 'first-prescribed', 'first-observed']),
    })
    .nullable(),
  /** The platform's figures just before the incident began. */
  baseline: z.object({ errorRate: fraction, p95LatencyMs: rate }).nullable(),
  phases: z.array(ReportPhaseSchema),
  /** The first time each affected service left its normal state, in order. */
  propagation: z.array(ReportTransitionSchema),
  recovery: z.array(ReportTransitionSchema),
  /** What Cedar decided for the scenario's own requests. */
  decisions: z.array(ReportDecisionSchema),
  impactedNodeIds: z.array(z.string()),
  stillUnhealthyNodeIds: z.array(z.string()),
  peakErrorRate: PeakSchema.nullable(),
  peakP95LatencyMs: PeakSchema.nullable(),
  /** Most services not normal at the same time. */
  peakUnhealthy: PeakSchema.nullable(),
  meanErrorRate: fraction.nullable(),
  /** The platform's objectives, and how long each was not met. */
  objectives: z.array(ReportObjectiveSchema),
  truncated: z.boolean(),
});
export type IncidentReport = z.infer<typeof IncidentReportSchema>;

// ---------------------------------------------------------------------------
// Sessions and experiments: a timeline as what reproduces it
// ---------------------------------------------------------------------------

/**
 * One effect in the format a scenario phase writes it in. The server checks
 * it; here it is only carried.
 */
export const EffectSchema = z.looseObject({ type: z.string() });
export type Effect = z.infer<typeof EffectSchema>;

/** A command a recording may hold. Outcomes are never among them. */
export const RecordedCommandSchema = z.object({
  atMs: count,
  command: z.discriminatedUnion('type', [
    z.object({ type: z.literal('startScenario'), scenarioId: z.string() }),
    z.object({ type: z.literal('abortScenario') }),
    z.object({ type: z.literal('injectFault'), effect: EffectSchema, rampMs: count }),
    z.object({ type: z.literal('clearFaults'), effect: EffectSchema.optional() }),
  ]),
});
export type RecordedCommand = z.infer<typeof RecordedCommandSchema>;

/** A seed and a command list: what the engine needs to give a history back. */
export const RecordingSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  topologyId: z.string(),
  seed: count,
  durationMs: count,
  commands: z.array(RecordedCommandSchema),
});
export type Recording = z.infer<typeof RecordingSchema>;

/** The timeline in use, written out as what reproduces it. */
export const SessionExportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  recording: RecordingSchema,
  cursorMs: count,
  /** Commands a session may not carry, counted. */
  omitted: z.object({ decisions: count }),
  /** False when loading the recording would not give this history back. */
  reproducible: z.boolean(),
  note: z.string().nullable(),
  /** Anything but `bundled` has to travel with the session. */
  workspaceOrigin: WorkspaceOriginSchema,
});
export type SessionExport = z.infer<typeof SessionExportSchema>;

export const ExperimentRunSchema = z.object({
  recording: RecordingSchema,
  report: IncidentReportSchema,
  samples: z.array(MetricSampleSchema),
});
export type ExperimentRun = z.infer<typeof ExperimentRunSchema>;

/** The same incident twice, with one thing changed. */
export const ExperimentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  dataSource: DataSourceSchema,
  topologyId: z.string(),
  seed: count,
  scenarioId: z.string(),
  scenarioName: z.string(),
  incidentStartedAtMs: count,
  durationMs: count,
  /** The one thing the second run does that the first does not. */
  intervention: z.object({
    description: z.string(),
    nodeIds: z.array(z.string()),
    /** Counted from the start of the incident. */
    atMs: count,
    rampMs: count,
    effect: EffectSchema,
  }),
  baseline: ExperimentRunSchema,
  variant: ExperimentRunSchema,
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export interface ExperimentRequest {
  scenarioId: string;
  intervention: { effect: FaultEffect; atMs: number; rampMs?: number };
}

/**
 * What one fault does to the platform at rest, tried on timelines of its
 * own: the same quiet run twice from one seed, the second time with the
 * fault. A service is listed because the engine recorded it leaving its
 * normal state in the run with the fault and not in the run without.
 */
export const TrialSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  dataSource: DataSourceSchema,
  topologyId: z.string(),
  seed: count,
  fault: z.object({
    description: z.string(),
    nodeIds: z.array(z.string()),
    /** On the trial's own clock. */
    atMs: count,
    rampMs: count,
    effect: EffectSchema,
  }),
  durationMs: count,
  /** In the order they first left normal, timed from the fault being placed. */
  affected: z.array(
    z.object({
      nodeId: z.string(),
      atMs: count,
      /** What it became when it first left normal. */
      health: HealthSchema,
      /** The worst it was at any time after. */
      worst: HealthSchema,
    }),
  ),
  /** The platform just before the fault was placed. */
  before: z.object({ errorRate: fraction, p95LatencyMs: z.number().nonnegative() }),
  /** The worst each figure got afterwards. */
  peak: z.object({ errorRate: fraction, p95LatencyMs: z.number().nonnegative() }),
  /** What reproduces the run with the fault. */
  recording: RecordingSchema,
});
export type Trial = z.infer<typeof TrialSchema>;

export interface TrialRequest {
  effect: FaultEffect;
  rampMs?: number;
}

/**
 * One field two descriptions of the same thing state differently, as each
 * file wrote it. `null` is a field the file left out.
 */
export const FieldChangeSchema = z.object({
  field: z.string(),
  base: z.unknown(),
  candidate: z.unknown(),
});
export type FieldChange = z.infer<typeof FieldChangeSchema>;

const NamedSchema = z.object({ id: z.string(), name: z.string() });
const ItemChangeSchema = z.object({
  id: z.string(),
  /** Its name on the platform in use. */
  name: z.string(),
  fields: z.array(FieldChangeSchema),
});
const ConnectionSchema = z.object({ source: z.string(), target: z.string() });

/**
 * What two descriptions of a platform state differently, matched by id, and
 * the one thing that follows without being stated: a capacity neither file
 * gives is sized from the service's load at rest, which follows from
 * everything that calls it.
 */
export const PlatformChangesSchema = z.object({
  servicesAdded: z.array(NamedSchema),
  servicesRemoved: z.array(NamedSchema),
  servicesChanged: z.array(ItemChangeSchema),
  connectionsAdded: z.array(ConnectionSchema),
  connectionsRemoved: z.array(ConnectionSchema),
  connectionsChanged: z.array(
    z.object({ source: z.string(), target: z.string(), fields: z.array(FieldChangeSchema) }),
  ),
  regionsAdded: z.array(NamedSchema),
  regionsRemoved: z.array(NamedSchema),
  regionsChanged: z.array(ItemChangeSchema),
  roles: z.array(
    z.object({ role: z.string(), base: z.string().nullable(), candidate: z.string().nullable() }),
  ),
  derivedCapacity: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      base: z.number().positive(),
      candidate: z.number().positive(),
    }),
  ),
});
export type PlatformChanges = z.infer<typeof PlatformChangesSchema>;

/**
 * One scenario on the platform in use and on the one a set of files
 * describes, each on a timeline of its own from the same seed. `baseline`
 * is the run in use and `variant` the run on the files; nothing is applied.
 */
export const PlatformComparisonSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  dataSource: DataSourceSchema,
  seed: count,
  scenarioId: z.string(),
  scenarioName: z.string(),
  incidentStartedAtMs: count,
  durationMs: count,
  /** The platform in use. */
  base: TopologySummarySchema,
  /** The platform the files describe. */
  candidate: TopologySummarySchema,
  changes: PlatformChangesSchema,
  /** Whether Cedar answers the simulation differently under the files. */
  decisionsChanged: z.boolean(),
  /**
   * Phases in which the same scenario prescribes something else on each
   * platform: a role that names another service, or a rate written as a
   * share of a capacity that is another.
   */
  prescribed: z.array(
    z.object({
      phase: z.string(),
      base: z.array(PrescribedEffectSchema),
      candidate: z.array(PrescribedEffectSchema),
    }),
  ),
  baseline: ExperimentRunSchema,
  variant: ExperimentRunSchema,
});
export type PlatformComparison = z.infer<typeof PlatformComparisonSchema>;

/** A platform objective and the figure it holds the platform under. */
const ObjectiveSchema = z.object({
  kind: z.enum(['error-rate', 'latency-p95']),
  threshold: z.number().nonnegative(),
});
const FiguresSchema = z.object({ errorRate: fraction, p95LatencyMs: z.number().nonnegative() });
/** A service that left its normal state, timed from what was done to the platform. */
const LeftNormalSchema = z.object({
  nodeId: z.string(),
  atMs: count,
  health: HealthSchema,
  worst: HealthSchema,
});

/**
 * How many times its ordinary demand the platform takes before one of its
 * objectives is missed. Every multiple in `steps` is a run the engine made;
 * `holdsAt` and `givesAt` are two of them, and nothing is said of the
 * multiples between.
 */
export const HeadroomSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  dataSource: DataSourceSchema,
  topologyId: z.string(),
  seed: count,
  durationMs: count,
  /** The external clients whose demand was multiplied. */
  clientIds: z.array(z.string()),
  objectives: z.array(ObjectiveSchema),
  atRest: FiguresSchema,
  /** Every multiple tried, lowest first. */
  steps: z.array(
    z.object({
      factor: z.number().positive(),
      peak: FiguresSchema,
      /** The objectives missed at any sample once the demand was raised. */
      missed: z.array(ObjectiveSchema.shape.kind),
      /** The first service to leave its normal state, if any did. */
      first: LeftNormalSchema.nullable(),
      affected: count,
    }),
  ),
  /** The highest multiple tried at which every objective was met. */
  holdsAt: z.number().positive().nullable(),
  /** The lowest multiple tried at which one was missed. */
  givesAt: z.number().positive().nullable(),
  /** What reproduces the run at `givesAt`. */
  recording: RecordingSchema.nullable(),
});
export type Headroom = z.infer<typeof HeadroomSchema>;

/**
 * Every service of the platform taken out in turn, as a trial takes one
 * out: the one that takes the most others with it first.
 */
export const WeakPointsSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  dataSource: DataSourceSchema,
  topologyId: z.string(),
  seed: count,
  durationMs: count,
  objectives: z.array(ObjectiveSchema),
  atRest: FiguresSchema,
  points: z.array(
    z.object({
      nodeId: z.string(),
      /** The other services that left normal, in the order they did. */
      affected: z.array(LeftNormalSchema),
      peak: FiguresSchema,
      missed: z.array(ObjectiveSchema.shape.kind),
    }),
  ),
});
export type WeakPoints = z.infer<typeof WeakPointsSchema>;

export interface PlatformComparisonRequest {
  files: WorkspaceFile[];
  scenarioId: string;
  /** Which platform of the files to run on, when they describe several. */
  topologyId?: string;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export const AuthorizationRequestSchema = z.object({
  /** Cedar entity reference, e.g. `User::"alice"`. */
  principal: z.string(),
  action: z.string(),
  resource: z.string(),
  context: z.record(z.string(), z.unknown()),
});
export type AuthorizationRequest = z.infer<typeof AuthorizationRequestSchema>;

export const EngineKindSchema = z.enum(['embedded-cedar', 'cedar-agent']);
export type EngineKind = z.infer<typeof EngineKindSchema>;

export const EngineInfoSchema = z.object({
  kind: EngineKindSchema,
  /** Evaluator version when the engine reports one. */
  version: z.string().nullable(),
});
export type EngineInfo = z.infer<typeof EngineInfoSchema>;

export const PathStageSchema = z.object({
  nodeId: z.string(),
  kind: z.enum(['client', 'edge', 'gateway', 'authentication', 'authorization', 'resource']),
  reached: z.boolean(),
});
export type PathStage = z.infer<typeof PathStageSchema>;

export const AuthorizationDecisionSchema = z.object({
  id: z.string(),
  virtualTimeMs: count,
  request: AuthorizationRequestSchema,
  decision: z.enum(['allow', 'deny']),
  /** Ids of the policies that determined the decision (Cedar's `reason`). */
  determiningPolicies: z.array(z.string()),
  /** Evaluation errors reported by the engine (Cedar's `errors`). */
  errors: z.array(z.string()),
  engine: EngineInfoSchema,
  /** Wall-clock evaluation time measured by the server. */
  evaluationMicros: count,
  path: z.array(PathStageSchema),
  /** Edge ids to animate, in order. */
  hops: z.array(z.string()),
  blockedAt: z.string().nullable(),
  disabledPolicies: z.array(z.string()),
  dataSource: DataSourceSchema,
});
export type AuthorizationDecision = z.infer<typeof AuthorizationDecisionSchema>;

/**
 * How one policy stands to one request. Both facts are Cedar's own: the
 * policy was evaluated by itself, and once more with its conditions left out.
 */
export const PolicyStandingSchema = z.object({
  policyId: z.string(),
  effect: z.enum(['permit', 'forbid']),
  /** Whether the policy's scope takes the request in, whatever its conditions say. */
  inScope: z.boolean(),
  /** Whether the whole policy holds for the request: scope and conditions. */
  holds: z.boolean(),
});
export type PolicyStanding = z.infer<typeof PolicyStandingSchema>;

/** A request explained policy by policy. Asking for one records nothing. */
export const AuthorizationExplanationSchema = z.object({
  request: AuthorizationRequestSchema,
  decision: z.enum(['allow', 'deny']),
  determiningPolicies: z.array(z.string()),
  errors: z.array(z.string()),
  /** Policies left out of the evaluation; they have no standing. */
  disabledPolicies: z.array(z.string()),
  policies: z.array(PolicyStandingSchema),
  engine: EngineInfoSchema,
  dataSource: DataSourceSchema,
});
export type AuthorizationExplanation = z.infer<typeof AuthorizationExplanationSchema>;

/** One request of the access matrix and Cedar's answer to it. */
export const AccessCellSchema = z.object({
  principal: z.string(),
  action: z.string(),
  resource: z.string(),
  decision: z.enum(['allow', 'deny']),
  determiningPolicies: z.array(z.string()),
});
export type AccessCell = z.infer<typeof AccessCellSchema>;

/**
 * Who may do what: every principal, action and resource of the catalogue
 * that go together, each asked of Cedar under one context.
 */
export const AccessMatrixSchema = z.object({
  context: z.record(z.string(), z.unknown()),
  disabledPolicies: z.array(z.string()),
  /** In the catalogue's order: by principal, then action, then resource. */
  cells: z.array(AccessCellSchema),
  /** Said when the catalogue is too large to ask in one go; then `cells` is empty. */
  note: z.string().nullable(),
  engine: EngineInfoSchema,
  dataSource: DataSourceSchema,
});
export type AccessMatrix = z.infer<typeof AccessMatrixSchema>;

export const PolicyInfoSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** Cedar source text. */
  content: z.string(),
  effect: z.enum(['permit', 'forbid']),
});
export type PolicyInfo = z.infer<typeof PolicyInfoSchema>;

export const AuthorizationCatalogSchema = z.object({
  engines: z.array(EngineInfoSchema.extend({ available: z.boolean() })),
  policies: z.array(PolicyInfoSchema),
  tenants: z.array(z.object({ id: z.string(), name: z.string() })),
  principals: z.array(
    z.object({
      uid: z.string(),
      label: z.string(),
      tenant: z.string(),
      roles: z.array(z.string()),
      note: z.string(),
    }),
  ),
  actions: z.array(z.object({ uid: z.string(), label: z.string(), resourceType: z.string() })),
  resources: z.array(
    z.object({
      uid: z.string(),
      label: z.string(),
      tenant: z.string(),
      resourceType: z.string(),
    }),
  ),
  contextKeys: z.array(z.object({ key: z.string(), label: z.string(), description: z.string() })),
  /** Share of simulated baseline authorization traffic Cedar denies. */
  baselineDenyFraction: fraction,
  dataSource: DataSourceSchema,
});
export type AuthorizationCatalog = z.infer<typeof AuthorizationCatalogSchema>;

export interface EvaluateRequest {
  principal: string;
  action: string;
  resource: string;
  context?: Record<string, unknown>;
  disabledPolicies?: string[];
  engine?: 'embedded' | 'cedar-agent';
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export const IntegrationStateSchema = z.enum([
  'active',
  'not-configured',
  'available',
  'connecting',
  'connected',
  'error',
]);
export type IntegrationState = z.infer<typeof IntegrationStateSchema>;

export const IntegrationStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['simulation', 'live-adapter']),
  state: IntegrationStateSchema,
  dataSource: DataSourceSchema,
  description: z.string(),
  /** Public repository the integration is built against. */
  repository: z.string().nullable(),
  /** The interface verified in that repository. */
  verifiedInterface: z.string().nullable(),
  /** Target the adapter talks to. Never contains credentials. */
  endpoint: z.string().nullable(),
  capabilities: z.array(z.string()),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })),
  lastError: z.string().nullable(),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  mode: z.literal('demo'),
  uptimeSeconds: count,
  topologyId: z.string(),
  tick: count,
  authorizationEngine: EngineInfoSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---------------------------------------------------------------------------
// Workspace: the files the platform, its scenarios and its policies come from
// ---------------------------------------------------------------------------

export const UnavailableScenarioSchema = z.object({
  topologyId: z.string(),
  scenarioId: z.string(),
  reason: z.string(),
});
export type UnavailableScenario = z.infer<typeof UnavailableScenarioSchema>;

export const WorkspaceStatusSchema = z.object({
  origin: WorkspaceOriginSchema,
  /** Whether this server accepts imports. */
  importEnabled: z.boolean(),
  formatVersion: count,
  /** Parts taken from the workspace, such as `topologies` or `cedar/policies`. */
  replaced: z.array(z.string()),
  /** Files of the workspace that were not read. */
  ignored: z.array(z.string()),
  topologies: z.array(TopologySummarySchema),
  /** The topology that opens. */
  defaultTopologyId: z.string(),
  scenarioIds: z.array(z.string()),
  recordingIds: z.array(z.string()),
  policyCount: count,
  /** Share of ordinary authorization traffic Cedar denies. */
  baselineDenyFraction: fraction,
  unavailable: z.array(UnavailableScenarioSchema),
});
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

export const WorkspaceProblemSchema = z.object({
  /** The file the problem is in, when it is in one file. */
  path: z.string().optional(),
  message: z.string(),
});
export type WorkspaceProblem = z.infer<typeof WorkspaceProblemSchema>;

// -- a cloud inventory among the files, and what there is to choose from ---

export const InventoryProviderSchema = z.enum(['aws', 'gcp', 'oci']);
export type InventoryProvider = z.infer<typeof InventoryProviderSchema>;

/** What states a connection of an inventory, strongest first. */
export const InventoryBasisSchema = z.enum(['routing', 'event', 'declared', 'network']);
export type InventoryBasis = z.infer<typeof InventoryBasisSchema>;

/** Two resources, in the direction a connection runs. */
export const InventoryPairSchema = z.object({ from: z.string(), to: z.string() });
export type InventoryPair = z.infer<typeof InventoryPairSchema>;

/**
 * Which part of an inventory is brought, as the file carries it. `null`
 * asks for everything; among `networks`, `null` stands for the resources
 * that are in none.
 */
export const InventorySelectionSchema = z.object({
  regions: z.array(z.string()).nullable(),
  networks: z.array(z.string().nullable()).nullable(),
  kinds: z.array(ServiceTypeSchema).nullable(),
  tags: z.array(z.object({ key: z.string(), values: z.array(z.string()) })),
  name: z.string().nullable(),
  bases: z.array(InventoryBasisSchema).nullable(),
  alongPaths: z.boolean(),
  connectedOnly: z.boolean(),
  exclude: z.array(z.string()),
  without: z.array(InventoryPairSchema),
});
export type InventorySelection = z.infer<typeof InventorySelectionSchema>;

/** One thing a selection can ask for, with how many resources have it. */
const facet = <T extends z.ZodType>(value: T) => z.object({ value, count });

/** A resource named in a survey: brought, or left out by hand. */
export const InventoryListedSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: ServiceTypeSchema,
  region: z.string(),
  kept: z.boolean(),
});
export type InventoryListed = z.infer<typeof InventoryListedSchema>;

/**
 * What a cloud inventory holds to choose from and what its selection
 * brings. The server reads the file; the page only rewrites its selection.
 */
export const InventorySurveySchema = z.object({
  /** The file it is of, as it was named. */
  path: z.string(),
  provider: InventoryProviderSchema,
  name: z.string(),
  collectedAt: z.string().optional(),
  /** How many the file lists, whatever is selected. */
  resources: count,
  relations: count,
  regions: z.array(facet(z.string())),
  networks: z.array(facet(z.string().nullable())),
  kinds: z.array(facet(ServiceTypeSchema)),
  tags: z.array(z.object({ key: z.string(), count, values: z.array(facet(z.string())) })),
  bases: z.array(facet(InventoryBasisSchema)),
  selection: InventorySelectionSchema,
  kept: z.object({ resources: count, relations: count, entries: count }),
  leftOut: z.object({
    unselected: count,
    excluded: count,
    unconnected: count,
    /** Connections left out so that calls run one way. */
    circular: z.array(InventoryPairSchema),
  }),
  listed: z.array(InventoryListedSchema),
  /** Why the selection is no topology, when it is not. */
  problem: z.string().optional(),
  /** The file's own notes, as written. */
  notes: z.array(z.string()),
});
export type InventorySurvey = z.infer<typeof InventorySurveySchema>;

/** The outcome of checking files without applying them. */
/** The parts of a workspace a file can be read as, and `ignored` for none. */
export const WORKSPACE_PARTS = [
  'topologies',
  'scenarios',
  'recordings',
  'cedar/policies',
  'cedar/entities',
  'cedar/catalog',
  'cedar/schema',
  'manifest',
  'ignored',
] as const;
export type WorkspacePart = (typeof WORKSPACE_PARTS)[number];

/** Where one file of a set is read, as the server sorts it. */
export const SortedFileSchema = z.object({
  /** The file as it was handed over. */
  path: z.string(),
  /** For a file inside a bundle, where it sits in the bundle. */
  within: z.string().optional(),
  part: z.enum(WORKSPACE_PARTS),
});
export type SortedFile = z.infer<typeof SortedFileSchema>;

export const WorkspaceCheckSchema = z.object({
  valid: z.boolean(),
  workspace: WorkspaceStatusSchema.optional(),
  problem: WorkspaceProblemSchema.optional(),
  /** A survey of each cloud inventory among the files, valid or not. */
  inventories: z.array(InventorySurveySchema).optional(),
  /** The part of a workspace each file is read as, valid or not; a file that cannot be told is left out. */
  sorted: z.array(SortedFileSchema).optional(),
});
export type WorkspaceCheck = z.infer<typeof WorkspaceCheckSchema>;

/** One file of a workspace: where it sits (a bare name is enough) and its text. */
export const WorkspaceFileSchema = z.object({ path: z.string(), text: z.string() });
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

/** A whole workspace as one document: what is downloaded, and can be imported. */
export const WorkspaceBundleSchema = z.object({
  formatVersion: count,
  files: z.array(WorkspaceFileSchema),
});
export type WorkspaceBundle = z.infer<typeof WorkspaceBundleSchema>;

export const WorkspaceResponseSchema = z.object({
  workspace: WorkspaceStatusSchema,
  playback: PlaybackStateSchema,
});
export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;

/**
 * One platform a set of files describes, at rest: run with nothing started
 * and nothing placed, on a timeline of its own from the server's seed, for
 * the quiet lead-in an experiment begins with (4 virtual seconds). `topology`
 * and `snapshot` are what the timeline in use shows once the files are
 * applied and as long has passed; the snapshot's playback is paused, since
 * nothing advances that timeline. Nothing is applied.
 */
export const WorkspacePreviewSchema = z.object({
  topology: TopologySchema,
  snapshot: TelemetrySnapshotSchema,
  /**
   * The topology as the server read it, in the format a topology file is
   * written in (`schemas/v1/topology.schema.json`): for a Compose file or a
   * cloud inventory, the topology it was converted to. Not checked here.
   */
  spec: z.record(z.string(), z.unknown()),
});
export type WorkspacePreview = z.infer<typeof WorkspacePreviewSchema>;

export interface WorkspacePreviewRequest {
  files: WorkspaceFile[];
  /** Which platform of the files to run, when they describe several; else the one they open on. */
  topologyId?: string;
}

// -- what Cedar would decide differently under other files -----------------

const PolicyOutcomeSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  determiningPolicies: z.array(z.string()),
  errors: z.array(z.string()),
});
export type PolicyOutcome = z.infer<typeof PolicyOutcomeSchema>;

const IdChangesSchema = z.object({ added: z.array(z.string()), removed: z.array(z.string()) });

export const RequestChangeSchema = z.object({
  list: z.enum(['traffic-mix', 'scenario-requests']),
  id: z.string(),
  /** `attribution`: the same decision, determined by other policies. */
  kind: z.enum(['decision', 'attribution', 'added', 'removed']),
  request: z.object({
    principal: z.string(),
    action: z.string(),
    resource: z.string(),
    context: z.record(z.string(), z.unknown()),
  }),
  base: PolicyOutcomeSchema.nullable(),
  candidate: PolicyOutcomeSchema.nullable(),
});
export type RequestChange = z.infer<typeof RequestChangeSchema>;

export const MatrixChangeSchema = z.object({
  principal: z.string(),
  action: z.string(),
  resource: z.string(),
  base: z.enum(['allow', 'deny']),
  candidate: z.enum(['allow', 'deny']),
  /** True when it changed this way in every context tried. */
  everyContext: z.boolean(),
  contexts: z.array(z.record(z.string(), z.unknown())),
  basePolicies: z.array(z.string()),
  candidatePolicies: z.array(z.string()),
});
export type MatrixChange = z.infer<typeof MatrixChangeSchema>;

/**
 * Uploaded files compared with the ones in use: every answer on either side
 * is Cedar's. `base` is what is in use, `candidate` what was uploaded.
 */
export const WorkspaceDiffSchema = z.object({
  decisionsChanged: z.boolean(),
  diff: z.object({
    policies: z.object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      changed: z.array(z.string()),
    }),
    entitiesChanged: z.boolean(),
    catalogChanged: z.boolean(),
    topologies: IdChangesSchema,
    scenarios: IdChangesSchema,
    /** Share of ordinary authorization traffic Cedar denies. */
    deniedAtRest: z.object({ base: fraction, candidate: fraction }),
    requests: z.object({ compared: count, changes: z.array(RequestChangeSchema) }),
    /** Scenario flows stopped on one side and let through on the other. */
    flows: z.array(
      z.object({
        topology: z.string(),
        scenario: z.string(),
        flow: z.string(),
        label: z.string(),
        request: z.string(),
        base: z.enum(['permitted', 'denied']),
        candidate: z.enum(['permitted', 'denied']),
      }),
    ),
    availability: z.array(
      z.object({
        topology: z.string(),
        scenario: z.string(),
        base: z.string().nullable(),
        candidate: z.string().nullable(),
      }),
    ),
    /** Every request the tracer can build, evaluated on both sides. */
    matrix: z.object({
      principals: count,
      actions: count,
      resources: count,
      contextKeys: z.array(z.string()),
      contexts: count,
      compared: count,
      note: z.string().nullable(),
      allowToDeny: count,
      denyToAllow: count,
      attributionOnly: count,
      changes: z.array(MatrixChangeSchema),
    }),
  }),
});
export type WorkspaceDiff = z.infer<typeof WorkspaceDiffSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// Stream (WS /api/v1/stream)
// ---------------------------------------------------------------------------

export const TimelineReasonSchema = z.enum([
  'reset',
  'branch',
  'seek',
  'topology',
  'recording',
  /** The topologies, scenarios or policies themselves were replaced. */
  'workspace',
]);
export type TimelineReason = z.infer<typeof TimelineReasonSchema>;

export const StreamMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    schemaVersion: z.literal(SCHEMA_VERSION),
    topologyId: z.string(),
    playback: PlaybackStateSchema,
  }),
  z.object({ type: z.literal('snapshot'), data: TelemetrySnapshotSchema }),
  z.object({ type: z.literal('events'), data: z.array(SecurityEventSchema) }),
  /** History changed shape: refetch REST state. */
  z.object({
    type: z.literal('timeline'),
    reason: TimelineReasonSchema,
    playback: PlaybackStateSchema,
  }),
  /** The subscriber fell behind; `dropped` messages were skipped. */
  z.object({ type: z.literal('lagged'), dropped: count }),
  z.object({ type: z.literal('pong'), t: z.number() }),
]);
export type StreamMessage = z.infer<typeof StreamMessageSchema>;

export type ClientMessage = { type: 'ping'; t: number } | { type: 'resync'; afterSeq: number };

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * A source of topology and telemetry. The web client only ever talks to this
 * interface; `DemoSimulationProvider` (the AEGIS server) is its production
 * implementation and tests substitute an in-memory one.
 */
export interface TelemetryProvider {
  /** Where this provider's data comes from. */
  readonly dataSource: DataSource;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getTopology(): Promise<Topology>;
  getSnapshot(): Promise<TelemetrySnapshot>;
  subscribeSnapshots(callback: (snapshot: TelemetrySnapshot) => void): Unsubscribe;
  subscribeEvents(callback: (event: SecurityEvent) => void): Unsubscribe;
  subscribeTimeline(
    callback: (reason: TimelineReason, playback: PlaybackState) => void,
  ): Unsubscribe;
  subscribeConnection(callback: (state: ConnectionState) => void): Unsubscribe;
}

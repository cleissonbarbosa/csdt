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
  'cve-advisory',
  'scan-finding',
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
  'imported',
  'error',
]);
export type IntegrationState = z.infer<typeof IntegrationStateSchema>;

export const IntegrationStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['simulation', 'live-adapter', 'fixture']),
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

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// Stream (WS /api/v1/stream)
// ---------------------------------------------------------------------------

export const TimelineReasonSchema = z.enum(['reset', 'branch', 'seek', 'topology', 'recording']);
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

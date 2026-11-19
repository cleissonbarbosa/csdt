/**
 * Test fixtures: real server output from the contract samples, parsed through
 * the same schemas the application uses.
 */
import {
  AccessMatrixSchema,
  AuthorizationCatalogSchema,
  AuthorizationDecisionSchema,
  AuthorizationExplanationSchema,
  EventsResponseSchema,
  ExperimentSchema,
  IncidentReportSchema,
  IncidentsResponseSchema,
  IntegrationStatusSchema,
  MetricsReportSchema,
  PlatformComparisonSchema,
  RecordingSummarySchema,
  ScenariosResponseSchema,
  SessionExportSchema,
  StreamMessageSchema,
  TopologiesResponseSchema,
  TopologySchema,
  TrialSchema,
  WorkspaceBundleSchema,
  WorkspaceCheckSchema,
  WorkspaceDiffSchema,
  WorkspaceResponseSchema,
  WorkspaceStatusSchema,
  type InfrastructureNode,
  type ServiceType,
  type TelemetrySnapshot,
  type Topology,
} from '@aegis/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Vitest runs with the package directory as its working directory.
const SAMPLES = resolve(process.cwd(), '../../packages/contracts/samples');

function sample<T>(name: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(resolve(SAMPLES, `${name}.json`), 'utf8')));
}

export const topology = () => sample('topology', TopologySchema);
/** The orders database taken out of service, tried on the platform at rest. */
export const trial = () => sample('trial', TrialSchema);
/** Bob refunding an order above the support limit, taken policy by policy. */
export const explanation = () =>
  sample('authorization-explanation', AuthorizationExplanationSchema);
/** Every request of the bundled catalogue, with a fresh MFA assertion in the context. */
export const accessMatrix = () => sample('access-matrix', AccessMatrixSchema);
export const topologies = () => sample('topologies', TopologiesResponseSchema);
export const scenarios = () => sample('scenarios', ScenariosResponseSchema);
export const incidents = () => sample('incidents', IncidentsResponseSchema);
export const events = () => sample('events', EventsResponseSchema);
export const metrics = () => sample('metrics', MetricsReportSchema);
export const recordings = () => sample('recordings', z.array(RecordingSummarySchema));
export const providers = () => sample('providers', z.array(IntegrationStatusSchema));
export const catalog = () => sample('authorization-catalog', AuthorizationCatalogSchema);
export const decisionAllow = () => sample('decision-allow', AuthorizationDecisionSchema);
export const decisionDeny = () => sample('decision-deny', AuthorizationDecisionSchema);
export const workspace = () => sample('workspace', WorkspaceStatusSchema);
export const workspaceCheck = () => sample('workspace-check', WorkspaceCheckSchema);
export const workspaceCheckInvalid = () => sample('workspace-check-invalid', WorkspaceCheckSchema);
export const workspaceResponse = () => sample('workspace-response', WorkspaceResponseSchema);
export const workspaceExport = () => sample('workspace-export', WorkspaceBundleSchema);
export const workspaceDiff = () => sample('workspace-diff', WorkspaceDiffSchema);
/** The report of the incident under way in the samples (credential stuffing). */
export const incidentReport = () => sample('incident-report', IncidentReportSchema);
export const session = () => sample('session', SessionExportSchema);
export const experiment = () => sample('experiment', ExperimentSchema);
/** The surge on the bundled platform and on one with a larger gateway and one more service. */
export const platformComparison = () => sample('platform-comparison', PlatformComparisonSchema);

/** A snapshot taken mid-incident (credential stuffing). */
export function snapshot(): TelemetrySnapshot {
  const message = sample('stream-snapshot', StreamMessageSchema);
  if (message.type !== 'snapshot') throw new Error('sample is not a snapshot');
  return message.data;
}

const TYPES: ServiceType[] = [
  'api-gateway',
  'auth-service',
  'cedar-authorizer',
  'microservice',
  'container',
  'serverless',
  'message-queue',
  'database',
  'storage',
];

/** A synthetic topology of arbitrary size, for layout and scale tests. */
export function largeTopology(regionCount: number, perRegion: number): Topology {
  const base = topology();
  const template = base.nodes[0]!;
  const regions = [
    { id: 'global', name: 'Global Edge', kind: 'edge' as const, location: 'Anycast' },
    ...Array.from({ length: regionCount }, (_, r) => ({
      id: `region-${r}`,
      name: `Region ${r}`,
      kind: 'cloud' as const,
      location: 'Somewhere',
    })),
  ];
  const nodes: InfrastructureNode[] = [
    {
      ...template,
      id: 'router',
      name: 'Router',
      serviceType: 'network-gateway' as const,
      region: 'global',
      tier: 1,
    },
    {
      ...template,
      id: 'monitor',
      name: 'Monitor',
      serviceType: 'security-monitor' as const,
      region: 'global',
      tier: 2,
    },
    ...Array.from({ length: regionCount }, (_, r) => ({
      ...template,
      id: `client-${r}`,
      name: `Client ${r}`,
      serviceType: 'external-client' as const,
      region: 'global',
      tier: 0,
    })),
  ];
  for (let r = 0; r < regionCount; r++) {
    for (let i = 0; i < perRegion; i++) {
      const serviceType = TYPES[i % TYPES.length]!;
      nodes.push({
        ...template,
        id: `r${r}-n${i}`,
        name: `Service ${i}`,
        serviceType,
        region: `region-${r}`,
        tier: 2 + Math.min(4, Math.floor((i / perRegion) * 5)),
      });
    }
  }
  return { ...base, id: 'large', regions, nodes, edges: [], roles: {} };
}

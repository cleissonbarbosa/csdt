import type {
  DataSource,
  Health,
  Relationship,
  SecurityStatus,
  ServiceType,
  Severity,
} from '@aegis/contracts';

/** The Obsidian Command Center palette. Mirrors the tokens in `index.css`. */
export const COLOR = {
  void: '#070B14',
  abyss: '#0A101C',
  surface: '#101827',
  line: '#1E2B42',
  ink: '#EAF2FF',
  inkDim: '#9FB0CC',
  inkFaint: '#64748F',
  cyan: '#55E6F2',
  blue: '#4A8DFF',
  violet: '#9B7BFF',
  magenta: '#FF5FD2',
  healthy: '#45D6A0',
  warning: '#FFBF69',
  critical: '#FF6178',
  down: '#6B7890',
} as const;

export const HEALTH_COLOR: Record<Health, string> = {
  healthy: COLOR.healthy,
  degraded: COLOR.warning,
  critical: COLOR.critical,
  down: COLOR.down,
};

export const HEALTH_LABEL: Record<Health, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
  down: 'Down',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  info: COLOR.inkDim,
  notice: COLOR.cyan,
  warning: COLOR.warning,
  critical: COLOR.critical,
};

export const SECURITY_COLOR: Record<SecurityStatus, string> = {
  secure: COLOR.healthy,
  authorized: COLOR.blue,
  throttled: COLOR.warning,
  denied: COLOR.critical,
  suspicious: COLOR.magenta,
};

export const SECURITY_LABEL: Record<SecurityStatus, string> = {
  secure: 'Secure',
  authorized: 'Authorizing',
  throttled: 'Throttled',
  denied: 'Denied',
  suspicious: 'Suspicious',
};

interface ServiceTypeInfo {
  label: string;
  /** Short label for dense lists. */
  short: string;
  /** Accent colour of a healthy node of this type. */
  color: string;
}

export const SERVICE_TYPE: Record<ServiceType, ServiceTypeInfo> = {
  'api-gateway': { label: 'API Gateway', short: 'Gateway', color: COLOR.cyan },
  'auth-service': { label: 'Authentication', short: 'Auth', color: COLOR.violet },
  'cedar-authorizer': { label: 'Cedar Authorizer', short: 'Cedar', color: '#6FA8FF' },
  microservice: { label: 'Microservice', short: 'Service', color: '#5CC8FF' },
  container: { label: 'Container', short: 'Container', color: '#4FB0F0' },
  serverless: { label: 'Serverless', short: 'Function', color: '#B79BFF' },
  'message-queue': { label: 'Message Queue', short: 'Queue', color: '#E0CFFF' },
  database: { label: 'Database', short: 'Database', color: COLOR.blue },
  storage: { label: 'Storage', short: 'Storage', color: '#6C8CFF' },
  'network-gateway': { label: 'Network Gateway', short: 'Network', color: COLOR.cyan },
  'security-monitor': { label: 'Security Monitor', short: 'Monitor', color: COLOR.violet },
  'external-client': { label: 'External Client', short: 'Client', color: '#D5E4FF' },
};

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  route: 'Routes to',
  call: 'Calls',
  auth: 'Authenticates with',
  authz: 'Authorizes with',
  data: 'Reads / writes',
  publish: 'Publishes to',
  consume: 'Consumed by',
  replication: 'Replicates to',
  telemetry: 'Reports to',
};

export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  synthetic: 'Synthetic',
  recording: 'Recording',
  live: 'Live',
};

export const DATA_SOURCE_HINT: Record<DataSource, string> = {
  synthetic: 'Produced by the built-in simulation engine.',
  recording: 'Imported from a bundled fixture file.',
  live: 'Measured from an explicitly connected local instance.',
};

/** Colours of traffic particles, shared by the scene and its legend. */
export const TRAFFIC_COLOR = {
  request: COLOR.cyan,
  response: COLOR.healthy,
  authentication: COLOR.violet,
  authorization: COLOR.blue,
  queue: '#E8DEFF',
  error: COLOR.critical,
  rejected: '#FF8A5C',
  suspicious: COLOR.magenta,
  background: '#5E7BA8',
} as const;

export const TRAFFIC_LEGEND: { key: keyof typeof TRAFFIC_COLOR; label: string }[] = [
  { key: 'request', label: 'Request' },
  { key: 'response', label: 'Response' },
  { key: 'authentication', label: 'Authentication' },
  { key: 'authorization', label: 'Authorization' },
  { key: 'queue', label: 'Queue message' },
  { key: 'error', label: 'Error' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspicious', label: 'Suspicious' },
];

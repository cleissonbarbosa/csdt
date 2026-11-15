import type {
  DataSource,
  Health,
  Relationship,
  SecurityStatus,
  ServiceType,
  Severity,
} from '@aegis/contracts';

/**
 * The Signal Field palette.
 *
 * Five colours do the work. Porcelain is the field everything stands on,
 * graphite is ink, and a cool grey called structure draws what is merely
 * there: plates, rules, connections at rest. Two hues are answers. Focus
 * (blue) is the answer to the viewer: what is selected, the path being
 * followed. Incident (a warm red) is the answer to the data: what failed,
 * where a request was stopped. Two rarer signals stand beside it, amber for
 * a deviation that is not yet a failure and magenta for hostile traffic.
 *
 * Nothing normal has a hue. With nothing selected and nothing wrong, the
 * screen is porcelain, graphite and grey, and it stays that way until there
 * is something to say.
 *
 * Interface colours are CSS custom properties (defined in `index.css`) and
 * follow the active theme. The 3D scene cannot read custom properties, so it
 * takes the same decisions as literal values from `SCENE_PALETTE`.
 */
export const COLOR = {
  plate: 'var(--color-plate)',
  paper: 'var(--color-paper)',
  line: 'var(--color-line)',
  lineStrong: 'var(--color-line-strong)',
  ink: 'var(--color-ink)',
  inkDim: 'var(--color-ink-dim)',
  inkFaint: 'var(--color-ink-faint)',
  /** The viewer's own attention: selection, the path being followed. */
  focus: 'var(--color-focus)',
  /** Deviation: degraded, throttled, rejected. */
  warning: 'var(--color-warning)',
  /** Failure: critical health, errors, a request that was stopped. */
  critical: 'var(--color-critical)',
  /** Hostile or suspicious traffic. */
  hostile: 'var(--color-hostile)',
} as const;

export type ThemeName = 'light' | 'night';

export interface ScenePalette {
  /** The field the model stands on (the page background). */
  table: string;
  /** Top, side and outline of a plate. */
  plate: string;
  plateSide: string;
  plateLine: string;
  /** A service in its normal state, and the mark that says what it is. */
  piece: string;
  pieceCore: string;
  /**
   * How a piece's secondary parts differ from its body: a little darker on
   * a light piece, a little lighter on a dark one.
   */
  pieceDetail: number;
  /** A service that is down: drained of presence rather than coloured. */
  ghost: string;
  /** Labels and ordinary traffic. */
  ink: string;
  inkDim: string;
  /** Connections at rest. */
  track: string;
  /** Selection and the path being followed. */
  focus: string;
  shadow: string;
  shadowOpacity: number;
  warning: string;
  critical: string;
  hostile: string;
}

export const SCENE_PALETTE: Record<ThemeName, ScenePalette> = {
  light: {
    table: '#F5F4F0',
    plate: '#F0EFEA',
    plateSide: '#D6D5D0',
    plateLine: '#C6C8C6',
    piece: '#FDFCFA',
    pieceCore: '#7C858A',
    pieceDetail: 0.9,
    ghost: '#CDCECB',
    ink: '#252B30',
    inkDim: '#545C63',
    track: '#A9AFB1',
    focus: '#4269CE',
    shadow: '#23282C',
    shadowOpacity: 0.22,
    warning: '#B07200',
    critical: '#D95D48',
    hostile: '#B0177E',
  },
  night: {
    table: '#1E2226',
    plate: '#262B30',
    plateSide: '#15181B',
    plateLine: '#474E54',
    piece: '#BFC4C7',
    pieceCore: '#1E2226',
    pieceDetail: 1.16,
    ghost: '#3F454A',
    ink: '#ECEDEA',
    inkDim: '#B5BABD',
    track: '#6B7378',
    focus: '#86A3F0',
    shadow: '#000000',
    shadowOpacity: 0.42,
    warning: '#FFB224',
    critical: '#F0705A',
    hostile: '#F26BC4',
  },
};

/** Healthy is deliberately not a colour: normal things stay neutral. */
export const HEALTH_COLOR: Record<Health, string> = {
  healthy: COLOR.inkDim,
  degraded: COLOR.warning,
  critical: COLOR.critical,
  down: COLOR.ink,
};

export const HEALTH_LABEL: Record<Health, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
  down: 'Down',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  info: COLOR.inkFaint,
  notice: COLOR.inkDim,
  warning: COLOR.warning,
  critical: COLOR.critical,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'Info',
  notice: 'Notice',
  warning: 'Warning',
  critical: 'Critical',
};

export const SECURITY_COLOR: Record<SecurityStatus, string> = {
  secure: COLOR.inkDim,
  authorized: COLOR.inkDim,
  throttled: COLOR.warning,
  denied: COLOR.warning,
  suspicious: COLOR.hostile,
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
  /** Several of them, as written in the middle of a sentence. */
  plural: string;
}

/** Service types are told apart by silhouette and name, not by colour. */
export const SERVICE_TYPE: Record<ServiceType, ServiceTypeInfo> = {
  'api-gateway': { label: 'API gateway', short: 'Gateway', plural: 'API gateways' },
  'auth-service': { label: 'Authentication', short: 'Auth', plural: 'identity services' },
  'cedar-authorizer': { label: 'Cedar authorizer', short: 'Cedar', plural: 'Cedar authorizers' },
  microservice: { label: 'Microservice', short: 'Service', plural: 'microservices' },
  container: { label: 'Container', short: 'Container', plural: 'containers' },
  serverless: { label: 'Serverless', short: 'Function', plural: 'functions' },
  'message-queue': { label: 'Message queue', short: 'Queue', plural: 'queues' },
  database: { label: 'Database', short: 'Database', plural: 'databases' },
  storage: { label: 'Storage', short: 'Storage', plural: 'object stores' },
  'network-gateway': { label: 'Network gateway', short: 'Network', plural: 'network gateways' },
  'security-monitor': { label: 'Security monitor', short: 'Monitor', plural: 'security monitors' },
  'external-client': { label: 'External client', short: 'Client', plural: 'external clients' },
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

/**
 * How traffic is drawn. Ordinary traffic is told apart by the shape of its
 * bead; only traffic that went wrong carries a hue. The numeric `shape` is
 * the id the particle shader and the legend both draw from.
 */
export type BeadShape = 'disc' | 'ring' | 'diamond' | 'square' | 'frame' | 'bar' | 'triangle';

export const BEAD_SHAPE_ID: Record<BeadShape, number> = {
  disc: 0,
  ring: 1,
  diamond: 2,
  square: 3,
  frame: 4,
  bar: 5,
  triangle: 6,
};

export interface TrafficKind {
  key: string;
  label: string;
  shape: BeadShape;
  /** `null` for ordinary traffic, which is drawn in ink. */
  tone: 'warning' | 'critical' | 'hostile' | null;
}

export const TRAFFIC_LEGEND: TrafficKind[] = [
  { key: 'request', label: 'Request', shape: 'disc', tone: null },
  { key: 'response', label: 'Response', shape: 'ring', tone: null },
  { key: 'authentication', label: 'Authentication', shape: 'diamond', tone: null },
  { key: 'authorization', label: 'Authorization', shape: 'square', tone: null },
  { key: 'queue', label: 'Queue message', shape: 'frame', tone: null },
  { key: 'error', label: 'Error', shape: 'disc', tone: 'critical' },
  { key: 'rejected', label: 'Rejected', shape: 'bar', tone: 'warning' },
  { key: 'suspicious', label: 'Suspicious', shape: 'triangle', tone: 'hostile' },
];

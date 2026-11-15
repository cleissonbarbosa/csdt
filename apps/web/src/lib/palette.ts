import type {
  DataSource,
  Health,
  Relationship,
  SecurityStatus,
  ServiceType,
  Severity,
} from '@aegis/contracts';

/**
 * The Sinótico palette.
 *
 * One rule shapes it: hue is a signal. Everything that is normal is drawn in
 * neutral ink on a neutral plate; amber, red and magenta appear only when
 * something deviates, and never as decoration. Selection and focus are shown
 * with ink, so the three signal hues stay unambiguous.
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
  /** Deviation: degraded, throttled, rejected. */
  warning: 'var(--color-warning)',
  /** Failure: critical health, errors. */
  critical: 'var(--color-critical)',
  /** Hostile or suspicious traffic. */
  hostile: 'var(--color-hostile)',
} as const;

export type ThemeName = 'light' | 'night';

export interface ScenePalette {
  /** The surface the model stands on (the page background). */
  table: string;
  /** Top, side and outline of a region plate. */
  plate: string;
  plateSide: string;
  plateLine: string;
  /** A service in its normal state, and its lighter and marked parts. */
  piece: string;
  pieceAccent: string;
  pieceCore: string;
  /** A service that is down: drained of presence rather than coloured. */
  ghost: string;
  /** Selection, labels and ordinary traffic. */
  ink: string;
  inkDim: string;
  /** Connections at rest. */
  track: string;
  shadow: string;
  shadowOpacity: number;
  warning: string;
  critical: string;
  hostile: string;
}

export const SCENE_PALETTE: Record<ThemeName, ScenePalette> = {
  light: {
    table: '#E3E5E4',
    plate: '#F1F2F0',
    plateSide: '#CFD2D2',
    plateLine: '#B4B8BA',
    piece: '#5F656B',
    pieceAccent: '#8B9197',
    pieceCore: '#F3F4F2',
    ghost: '#C4C8C9',
    ink: '#191B1D',
    inkDim: '#4F545A',
    track: '#7E848A',
    shadow: '#1B1D1F',
    shadowOpacity: 0.2,
    warning: '#BD7000',
    critical: '#D0261B',
    hostile: '#B0177E',
  },
  night: {
    table: '#1D1F20',
    plate: '#27292B',
    plateSide: '#151718',
    plateLine: '#44484B',
    piece: '#A9AEB1',
    pieceAccent: '#7C8286',
    pieceCore: '#1D1F20',
    ghost: '#3D4043',
    ink: '#ECEDEC',
    inkDim: '#B4B9BC',
    track: '#6A7074',
    shadow: '#000000',
    shadowOpacity: 0.42,
    warning: '#FFB224',
    critical: '#FF5D4F',
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
}

/** Service types are told apart by silhouette and name, not by colour. */
export const SERVICE_TYPE: Record<ServiceType, ServiceTypeInfo> = {
  'api-gateway': { label: 'API gateway', short: 'Gateway' },
  'auth-service': { label: 'Authentication', short: 'Auth' },
  'cedar-authorizer': { label: 'Cedar authorizer', short: 'Cedar' },
  microservice: { label: 'Microservice', short: 'Service' },
  container: { label: 'Container', short: 'Container' },
  serverless: { label: 'Serverless', short: 'Function' },
  'message-queue': { label: 'Message queue', short: 'Queue' },
  database: { label: 'Database', short: 'Database' },
  storage: { label: 'Storage', short: 'Storage' },
  'network-gateway': { label: 'Network gateway', short: 'Network' },
  'security-monitor': { label: 'Security monitor', short: 'Monitor' },
  'external-client': { label: 'External client', short: 'Client' },
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

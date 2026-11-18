import type {
  DataSource,
  Health,
  Relationship,
  SecurityStatus,
  ServiceType,
  Severity,
} from '@aegis/contracts';

import { t } from '@/i18n';

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
  healthy: t('Healthy'),
  degraded: t('Degraded'),
  critical: t('Critical'),
  down: t('Down'),
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  info: COLOR.inkFaint,
  notice: COLOR.inkDim,
  warning: COLOR.warning,
  critical: COLOR.critical,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: t('Info'),
  notice: t('Notice'),
  warning: t('Warning'),
  critical: t('Critical'),
};

export const SECURITY_COLOR: Record<SecurityStatus, string> = {
  secure: COLOR.inkDim,
  authorized: COLOR.inkDim,
  throttled: COLOR.warning,
  denied: COLOR.warning,
  suspicious: COLOR.hostile,
};

export const SECURITY_LABEL: Record<SecurityStatus, string> = {
  secure: t('Secure'),
  authorized: t('Authorizing'),
  throttled: t('Throttled'),
  denied: t('Denied'),
  suspicious: t('Suspicious'),
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
  'api-gateway': { label: t('API gateway'), short: t('Gateway'), plural: t('API gateways') },
  'auth-service': { label: t('Authentication'), short: t('Auth'), plural: t('identity services') },
  'cedar-authorizer': {
    label: t('Cedar authorizer'),
    short: t('Cedar'),
    plural: t('Cedar authorizers'),
  },
  microservice: { label: t('Microservice'), short: t('Service'), plural: t('microservices') },
  container: { label: t('Container'), short: t('Container'), plural: t('containers') },
  serverless: { label: t('Serverless'), short: t('Function'), plural: t('functions') },
  'message-queue': { label: t('Message queue'), short: t('Queue'), plural: t('queues') },
  database: { label: t('Database'), short: t('Database'), plural: t('databases') },
  storage: { label: t('Storage'), short: t('Storage'), plural: t('object stores') },
  'network-gateway': {
    label: t('Network gateway'),
    short: t('Network'),
    plural: t('network gateways'),
  },
  'security-monitor': {
    label: t('Security monitor'),
    short: t('Monitor'),
    plural: t('security monitors'),
  },
  'external-client': {
    label: t('External client'),
    short: t('Client'),
    plural: t('external clients'),
  },
};

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  route: t('Routes to'),
  call: t('Calls'),
  auth: t('Authenticates with'),
  authz: t('Authorizes with'),
  data: t('Reads / writes'),
  publish: t('Publishes to'),
  consume: t('Consumed by'),
  replication: t('Replicates to'),
  telemetry: t('Reports to'),
};

export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  synthetic: t('Synthetic'),
  recording: t('Recording'),
  live: t('Live'),
};

export const DATA_SOURCE_HINT: Record<DataSource, string> = {
  synthetic: t('Produced by the built-in simulation engine.'),
  recording: t('Imported from a bundled fixture file.'),
  live: t('Measured from an explicitly connected local instance.'),
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
  { key: 'request', label: t('Request'), shape: 'disc', tone: null },
  { key: 'response', label: t('Response'), shape: 'ring', tone: null },
  { key: 'authentication', label: t('Authentication'), shape: 'diamond', tone: null },
  { key: 'authorization', label: t('Authorization'), shape: 'square', tone: null },
  { key: 'queue', label: t('Queue message'), shape: 'frame', tone: null },
  { key: 'error', label: t('Error'), shape: 'disc', tone: 'critical' },
  { key: 'rejected', label: t('Rejected'), shape: 'bar', tone: 'warning' },
  { key: 'suspicious', label: t('Suspicious'), shape: 'triangle', tone: 'hostile' },
];

/**
 * A topology being drawn, and the file it becomes.
 *
 * The format is the server's (`docs/WORKSPACE.md`, `schemas/v1/topology`):
 * regions, services that stand in them at a tier, connections between
 * them and roles that name places. This module is the editor's model of
 * such a file: read one in, change it, write it out. Every change is a
 * pure function from one draft to the next, which is what lets the editor
 * undo and lets a test hold each one.
 *
 * Where a service stands on the model is not a field of its own: the
 * layout is a function of its region and its tier, so moving a piece is
 * changing those two. Nothing about position is invented or written.
 *
 * It checks only what is plain before the server is asked (an id, a
 * region that exists, a circle of connections, which the editor refuses
 * as it is drawn). Whether the file is valid, and what the platform does,
 * is the server's to say.
 */
import type { Protocol, Relationship, ServiceType } from '@aegis/contracts';
import { SERVICE_TYPES } from '@aegis/contracts';

import { SERVICE_TYPE } from './palette';
import { slug } from './scenarioFile';

import { t } from '@/i18n';

export const ENVIRONMENTS = ['production', 'staging', 'demo'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const PROTOCOLS: readonly Protocol[] = [
  'https',
  'grpc',
  'amqp',
  'sql',
  'redis',
  's3',
  'tcp',
  'otlp',
];
export const RELATIONSHIPS: readonly Relationship[] = [
  'route',
  'call',
  'auth',
  'authz',
  'data',
  'publish',
  'consume',
  'replication',
  'telemetry',
];

export interface RegionDraft {
  id: string;
  name: string;
  kind: 'edge' | 'cloud';
  location: string;
}

export interface AutoscaleDraft {
  maxFactor: number;
  seconds: number;
}

/** A service. A figure the file does not state is `null`, and is not written. */
export interface NodeDraft {
  id: string;
  name: string;
  type: ServiceType;
  region: string;
  tier: number;
  description: string;
  environment: Environment | null;
  baseLatencyMs: number;
  baseRps: number | null;
  capacityRps: number | null;
  headroom: number | null;
  rateLimitRps: number | null;
  suspiciousFilter: number | null;
  autoscale: AutoscaleDraft | null;
}

export interface EdgeDraft {
  source: string;
  target: string;
  protocol: Protocol;
  relationship: Relationship;
  weight: number;
  criticality: number | null;
  latencyMs: number | null;
}

export interface TopologyDraft {
  id: string;
  name: string;
  description: string;
  regions: RegionDraft[];
  roles: Record<string, string>;
  nodes: NodeDraft[];
  edges: EdgeDraft[];
}

/** The most tiers a service can be placed at: the file keeps a tier in one byte. */
export const MAX_TIER = 255;
/** The demand a new external client is given, as the Compose reader gives one. */
export const DEFAULT_DEMAND_RPS = 100;

/**
 * A new service's own latency when idle, by kind. These are the Compose
 * reader's defaults (`default_latency_ms` in `workspace/compose.rs`), so a
 * service drawn here and one read from a Compose file start alike; a test
 * holds the two equal. The figure is written into the file, where the card
 * shows it and it can be changed.
 */
export const DEFAULT_LATENCY_MS: Record<ServiceType, number> = {
  'external-client': 0,
  'api-gateway': 4,
  'network-gateway': 4,
  'message-queue': 2,
  database: 5,
  'cedar-authorizer': 3,
  'auth-service': 15,
  'security-monitor': 10,
  storage: 25,
  microservice: 20,
  container: 20,
  serverless: 20,
  'virtual-machine': 20,
  'kubernetes-cluster': 20,
  'load-balancer': 2,
  cache: 1,
  'event-stream': 3,
};

/**
 * How a service reaches another, by what the other is: the Compose
 * reader's `link` (`workspace/compose.rs`), which a test holds this to. A
 * client's requests are routed, whatever they reach first.
 */
export function connectionDefaults(
  source: ServiceType,
  target: ServiceType,
): { protocol: Protocol; relationship: Relationship } {
  if (source === 'external-client') return { protocol: 'https', relationship: 'route' };
  switch (target) {
    case 'database':
      return { protocol: 'sql', relationship: 'data' };
    case 'cache':
      return { protocol: 'redis', relationship: 'data' };
    case 'load-balancer':
      return { protocol: 'https', relationship: 'route' };
    case 'event-stream':
      return { protocol: 'tcp', relationship: 'publish' };
    case 'storage':
      return { protocol: 's3', relationship: 'data' };
    case 'message-queue':
      return { protocol: 'amqp', relationship: 'publish' };
    case 'auth-service':
      return { protocol: 'https', relationship: 'auth' };
    case 'cedar-authorizer':
      return { protocol: 'https', relationship: 'authz' };
    case 'security-monitor':
      return { protocol: 'otlp', relationship: 'telemetry' };
    default:
      return { protocol: 'https', relationship: 'call' };
  }
}

export interface RoleInfo {
  name: string;
  /** Whether the role names a service or a region. */
  points: 'node' | 'region';
  /** The kinds a service it names is expected to be; empty when any will do. */
  types: readonly ServiceType[];
  /** What the role is for, in a sentence. */
  use: string;
}

/** The roles the bundled scenarios and the request tracer ask for (`docs/WORKSPACE.md`). */
export const ROLES: readonly RoleInfo[] = [
  {
    name: 'primaryGateway',
    points: 'node',
    types: ['api-gateway'],
    use: t('The gateway requests are traced through; the DDoS surge is aimed at it.'),
  },
  {
    name: 'primaryAuth',
    points: 'node',
    types: ['auth-service'],
    use: t('The authentication service traced requests and credential stuffing reach.'),
  },
  {
    name: 'primaryAuthorizer',
    points: 'node',
    types: ['cedar-authorizer'],
    use: t('The authorizer that puts traced requests to Cedar.'),
  },
  {
    name: 'partnerClient',
    points: 'node',
    types: ['external-client'],
    use: t('Where a traced request starts.'),
  },
  {
    name: 'attackSource',
    points: 'node',
    types: ['external-client'],
    use: t('Where hostile traffic comes from.'),
  },
  {
    name: 'edgeRouter',
    points: 'node',
    types: ['network-gateway'],
    use: t('The router of the global edge.'),
  },
  {
    name: 'primaryDatabase',
    points: 'node',
    types: ['database'],
    use: t('The database the cascading failure starts at.'),
  },
  {
    name: 'protectedResource',
    points: 'node',
    types: [],
    use: t('What a traced request is for, when no resource role matches.'),
  },
  {
    name: 'securityMonitor',
    points: 'node',
    types: ['security-monitor'],
    use: t('The monitor named on the alerts the engine raises.'),
  },
  {
    name: 'outageRegion',
    points: 'region',
    types: [],
    use: t('The region the regional outage takes down.'),
  },
  {
    name: 'failoverRegion',
    points: 'region',
    types: [],
    use: t('The region its traffic fails over to.'),
  },
];

const ID = /^[A-Za-z0-9_.-]{1,64}$/;

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const optional = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `base`, or `base-2`, `base-3`… whichever is not taken. Always a valid id. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slug(base).slice(0, 56) || 'service';
  if (!used.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const id = `${root}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** An edge's id, as the server writes it (`EdgeSpec::id`). */
export const edgeId = (edge: Pick<EdgeDraft, 'source' | 'target'>): string =>
  `${edge.source}->${edge.target}`;

/** Reads a topology file. `null` when it is not an object with nodes and edges. */
export function draftFromFile(raw: unknown): TopologyDraft | null {
  const json = record(raw);
  if (!json || !Array.isArray(json.nodes) || !Array.isArray(json.edges)) return null;
  const roles: Record<string, string> = {};
  for (const [name, value] of Object.entries(record(json.roles) ?? {})) {
    if (typeof value === 'string') roles[name] = value;
  }
  return {
    id: text(json.id),
    name: text(json.name),
    description: text(json.description),
    regions: list(json.regions).flatMap((entry) => {
      const region = record(entry);
      if (!region) return [];
      return [
        {
          id: text(region.id),
          name: text(region.name),
          kind: region.kind === 'edge' ? ('edge' as const) : ('cloud' as const),
          location: text(region.location),
        },
      ];
    }),
    roles,
    nodes: json.nodes.flatMap((entry) => {
      const node = record(entry);
      if (!node) return [];
      const autoscale = record(node.autoscale);
      return [
        {
          id: text(node.id),
          name: text(node.name),
          type: oneOf(SERVICE_TYPES, node.type, 'microservice'),
          region: text(node.region),
          tier: Math.max(0, Math.min(MAX_TIER, Math.round(number(node.tier)))),
          description: text(node.description),
          environment:
            typeof node.environment === 'string'
              ? oneOf(ENVIRONMENTS, node.environment, 'demo')
              : null,
          baseLatencyMs: number(node.baseLatencyMs),
          baseRps: optional(node.baseRps),
          capacityRps: optional(node.capacityRps),
          headroom: optional(node.headroom),
          rateLimitRps: optional(node.rateLimitRps),
          suspiciousFilter: optional(node.suspiciousFilter),
          autoscale: autoscale
            ? { maxFactor: number(autoscale.maxFactor, 2), seconds: number(autoscale.seconds, 30) }
            : null,
        },
      ];
    }),
    edges: json.edges.flatMap((entry) => {
      const edge = record(entry);
      if (!edge) return [];
      return [
        {
          source: text(edge.source),
          target: text(edge.target),
          protocol: oneOf(PROTOCOLS, edge.protocol, 'https'),
          relationship: oneOf(RELATIONSHIPS, edge.relationship, 'call'),
          weight: number(edge.weight, 1),
          criticality: optional(edge.criticality),
          latencyMs: optional(edge.latencyMs),
        },
      ];
    }),
  };
}

/** The file, in the format the engine reads. A figure that is `null` is left out. */
export function draftToFile(draft: TopologyDraft): Record<string, unknown> {
  const stated = <K extends string>(key: K, value: number | null) =>
    value === null ? {} : ({ [key]: value } as Record<K, number>);
  return {
    id: draft.id,
    name: draft.name,
    ...(draft.description !== '' ? { description: draft.description } : {}),
    dataSource: 'synthetic',
    regions: draft.regions.map((region) => ({
      id: region.id,
      name: region.name,
      kind: region.kind,
      location: region.location,
    })),
    ...(Object.keys(draft.roles).length > 0 ? { roles: { ...draft.roles } } : {}),
    nodes: draft.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      region: node.region,
      tier: node.tier,
      baseLatencyMs: node.baseLatencyMs,
      ...stated('baseRps', node.baseRps),
      ...stated('capacityRps', node.capacityRps),
      ...stated('headroom', node.headroom),
      ...stated('rateLimitRps', node.rateLimitRps),
      ...stated('suspiciousFilter', node.suspiciousFilter),
      ...(node.autoscale ? { autoscale: { ...node.autoscale } } : {}),
      ...(node.description !== '' ? { description: node.description } : {}),
      ...(node.environment !== null ? { environment: node.environment } : {}),
    })),
    edges: draft.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      protocol: edge.protocol,
      relationship: edge.relationship,
      weight: edge.weight,
      ...stated('criticality', edge.criticality),
      ...stated('latencyMs', edge.latencyMs),
    })),
  };
}

/** The file as text, as the editor saves it and hands it to the server. */
export const draftText = (draft: TopologyDraft): string =>
  `${JSON.stringify(draftToFile(draft), null, 2)}\n`;

/** A platform to start from: one region and a client that sends it requests. */
export function blankTopology(): TopologyDraft {
  return {
    id: 'my-platform',
    name: t('My platform'),
    description: '',
    regions: [{ id: 'main', name: t('Main region'), kind: 'cloud', location: '' }],
    roles: {},
    nodes: [newNode('external-client', 'clients', t('Clients'), 'main', 0)],
    edges: [],
  };
}

function newNode(
  type: ServiceType,
  id: string,
  name: string,
  region: string,
  tier: number,
): NodeDraft {
  return {
    id,
    name,
    type,
    region,
    tier,
    description: '',
    environment: null,
    baseLatencyMs: DEFAULT_LATENCY_MS[type],
    baseRps: type === 'external-client' ? DEFAULT_DEMAND_RPS : null,
    capacityRps: null,
    headroom: null,
    rateLimitRps: null,
    suspiciousFilter: null,
    autoscale: null,
  };
}

const clampTier = (tier: number) => Math.max(0, Math.min(MAX_TIER, Math.round(tier)));

/** A service of `type`, added at a region and a tier. Its id and name are new. */
export function addService(
  draft: TopologyDraft,
  type: ServiceType,
  region: string,
  tier: number,
): { draft: TopologyDraft; id: string } {
  const id = uniqueId(
    type,
    draft.nodes.map((node) => node.id),
  );
  const label = SERVICE_TYPE[type].label;
  const names = new Set(draft.nodes.map((node) => node.name));
  let name = label;
  for (let n = 2; names.has(name); n += 1) name = `${label} ${n}`;
  const node = newNode(type, id, name, region, clampTier(tier));
  return { draft: { ...draft, nodes: [...draft.nodes, node] }, id };
}

/** The service stood somewhere else: another region, another tier, or both. */
export function moveService(
  draft: TopologyDraft,
  id: string,
  region: string,
  tier: number,
): TopologyDraft {
  const at = clampTier(tier);
  const node = draft.nodes.find((entry) => entry.id === id);
  if (!node || (node.region === region && node.tier === at)) return draft;
  return {
    ...draft,
    nodes: draft.nodes.map((entry) => (entry.id === id ? { ...entry, region, tier: at } : entry)),
  };
}

/**
 * Makes room for a column at `tier`: every service at that tier or beyond
 * moves one on, so the order along the path is kept. Refused (the draft
 * returned as it was) when a service is already at the last tier a file
 * can hold.
 */
export function insertTier(draft: TopologyDraft, tier: number): TopologyDraft {
  const at = clampTier(tier);
  if (draft.nodes.some((node) => node.tier >= at && node.tier >= MAX_TIER)) return draft;
  return {
    ...draft,
    nodes: draft.nodes.map((node) => (node.tier >= at ? { ...node, tier: node.tier + 1 } : node)),
  };
}

/** Changes a service's figures. Its id is changed with `renameService`. */
export function updateService(
  draft: TopologyDraft,
  id: string,
  patch: Partial<Omit<NodeDraft, 'id'>>,
): TopologyDraft {
  return {
    ...draft,
    nodes: draft.nodes.map((node) =>
      node.id === id ? { ...node, ...patch, tier: clampTier(patch.tier ?? node.tier) } : node,
    ),
  };
}

/**
 * Gives a service another id, and every connection and role that named it
 * the new one. Refused (the draft returned as it was) when the id is not
 * valid or another service has it.
 */
export function renameService(draft: TopologyDraft, from: string, to: string): TopologyDraft {
  if (from === to || !ID.test(to) || draft.nodes.some((node) => node.id === to)) return draft;
  const roles: Record<string, string> = {};
  for (const [role, value] of Object.entries(draft.roles))
    roles[role] = value === from ? to : value;
  return {
    ...draft,
    roles,
    nodes: draft.nodes.map((node) => (node.id === from ? { ...node, id: to } : node)),
    edges: draft.edges.map((edge) => ({
      ...edge,
      source: edge.source === from ? to : edge.source,
      target: edge.target === from ? to : edge.target,
    })),
  };
}

/** Takes a service away, with its connections and the roles that named it. */
export function removeService(draft: TopologyDraft, id: string): TopologyDraft {
  if (!draft.nodes.some((node) => node.id === id)) return draft;
  return {
    ...draft,
    roles: Object.fromEntries(Object.entries(draft.roles).filter(([, value]) => value !== id)),
    nodes: draft.nodes.filter((node) => node.id !== id),
    edges: draft.edges.filter((edge) => edge.source !== id && edge.target !== id),
  };
}

/**
 * The services a request goes through from `from` to reach `to` along the
 * connections, both ends included, or `null` when it cannot. Breadth first
 * and in the order the connections are listed, so the same draft always
 * gives the same path, and the shortest one.
 */
export function pathBetween(draft: TopologyDraft, from: string, to: string): string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const edge of draft.edges) {
    const next = outgoing.get(edge.source) ?? [];
    next.push(edge.target);
    outgoing.set(edge.source, next);
  }
  const previous = new Map<string, string>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const at = queue.shift() as string;
    if (at === to) {
      const path = [to];
      while (path[0] !== from) path.unshift(previous.get(path[0] as string) as string);
      return path;
    }
    for (const next of outgoing.get(at) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, at);
      queue.push(next);
    }
  }
  return null;
}

export type Refusal =
  | { reason: 'self' }
  | { reason: 'exists' }
  | { reason: 'unknown' }
  | { reason: 'cycle'; circle: string[] };

/**
 * A connection from `source` to `target`, with the protocol and
 * relationship their kinds suggest and one call per request. Refused when
 * it joins a service to itself, already exists, names a service the draft
 * does not have, or would close a circle: the model carries load one way
 * along the connections, and the server refuses a circle too.
 */
export function connect(
  draft: TopologyDraft,
  source: string,
  target: string,
): { draft: TopologyDraft } | { refused: Refusal } {
  if (source === target) return { refused: { reason: 'self' } };
  const from = draft.nodes.find((node) => node.id === source);
  const to = draft.nodes.find((node) => node.id === target);
  if (!from || !to) return { refused: { reason: 'unknown' } };
  if (draft.edges.some((edge) => edge.source === source && edge.target === target)) {
    return { refused: { reason: 'exists' } };
  }
  const back = pathBetween(draft, target, source);
  if (back) return { refused: { reason: 'cycle', circle: [source, ...back] } };
  const edge: EdgeDraft = {
    source,
    target,
    ...connectionDefaults(from.type, to.type),
    weight: 1,
    criticality: null,
    latencyMs: null,
  };
  return { draft: { ...draft, edges: [...draft.edges, edge] } };
}

/** The services `source` can be connected to without a refusal. */
export function connectable(draft: TopologyDraft, source: string): Set<string> {
  const open = new Set<string>();
  for (const node of draft.nodes) {
    if ('draft' in connect(draft, source, node.id)) open.add(node.id);
  }
  return open;
}

export function updateConnection(
  draft: TopologyDraft,
  id: string,
  patch: Partial<Omit<EdgeDraft, 'source' | 'target'>>,
): TopologyDraft {
  return {
    ...draft,
    edges: draft.edges.map((edge) => (edgeId(edge) === id ? { ...edge, ...patch } : edge)),
  };
}

export function disconnect(draft: TopologyDraft, id: string): TopologyDraft {
  return { ...draft, edges: draft.edges.filter((edge) => edgeId(edge) !== id) };
}

/** A new region, named in order. */
export function addRegion(
  draft: TopologyDraft,
  kind: RegionDraft['kind'] = 'cloud',
): { draft: TopologyDraft; id: string } {
  const id = uniqueId(
    kind === 'edge' ? 'edge' : 'region',
    draft.regions.map((r) => r.id),
  );
  const name =
    kind === 'edge' ? t('Global edge') : t('Region {n}', { n: draft.regions.length + 1 });
  return { draft: { ...draft, regions: [...draft.regions, { id, name, kind, location: '' }] }, id };
}

export function updateRegion(
  draft: TopologyDraft,
  id: string,
  patch: Partial<Omit<RegionDraft, 'id'>>,
): TopologyDraft {
  return {
    ...draft,
    regions: draft.regions.map((region) => (region.id === id ? { ...region, ...patch } : region)),
  };
}

/** Takes an empty region away, with the roles that named it. A region with services stays. */
export function removeRegion(draft: TopologyDraft, id: string): TopologyDraft {
  if (draft.nodes.some((node) => node.region === id)) return draft;
  return {
    ...draft,
    roles: Object.fromEntries(Object.entries(draft.roles).filter(([, value]) => value !== id)),
    regions: draft.regions.filter((region) => region.id !== id),
  };
}

/** Points a role at a service or a region, or, with `null`, takes it away. */
export function setRole(draft: TopologyDraft, role: string, target: string | null): TopologyDraft {
  const roles = Object.fromEntries(Object.entries(draft.roles).filter(([name]) => name !== role));
  if (target !== null) roles[role] = target;
  return { ...draft, roles };
}

/** The roles that name `id`, in the order the file lists them. */
export const rolesOf = (draft: TopologyDraft, id: string): string[] =>
  Object.entries(draft.roles)
    .filter(([, value]) => value === id)
    .map(([role]) => role);

/** A circle among the connections, as the services it runs through, or `null`. */
export function circleIn(draft: TopologyDraft): string[] | null {
  for (const edge of draft.edges) {
    const back = pathBetween(draft, edge.target, edge.source);
    if (back) return [edge.source, ...back];
  }
  return null;
}

/**
 * What is plainly wrong before the server is asked: ids, regions,
 * connections and roles that name nothing, a circle. Ranges and what the
 * model makes of the platform are the server's to say.
 */
export function draftProblems(draft: TopologyDraft): string[] {
  const problems: string[] = [];
  if (draft.name.trim() === '') problems.push(t('The platform needs a name.'));
  if (!ID.test(draft.id)) problems.push(t('The id is 1 to 64 letters, digits, "-", "_" or ".".'));
  if (draft.regions.length === 0) problems.push(t('A platform needs at least one region.'));
  if (draft.nodes.length === 0) problems.push(t('A platform needs at least one service.'));
  const regions = new Set(draft.regions.map((region) => region.id));
  const ids = new Set<string>();
  for (const node of draft.nodes) {
    if (!ID.test(node.id)) {
      problems.push(
        t('The id of “{name}” is not 1 to 64 letters, digits, "-", "_" or ".".', {
          name: node.name,
        }),
      );
    }
    if (ids.has(node.id)) problems.push(t('Two services have the id “{id}”.', { id: node.id }));
    ids.add(node.id);
    if (node.name.trim() === '') problems.push(t('Every service needs a name.'));
    if (!regions.has(node.region)) {
      problems.push(
        t('“{name}” stands in a region the platform does not have.', {
          name: node.name,
        }),
      );
    }
  }
  for (const edge of draft.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      problems.push(
        t('The connection {id} joins a service the platform does not have.', {
          id: edgeId(edge),
        }),
      );
    }
  }
  for (const [role, value] of Object.entries(draft.roles)) {
    if (!ids.has(value) && !regions.has(value)) {
      problems.push(t('The role “{role}” names nothing on this platform.', { role }));
    }
  }
  const circle = circleIn(draft);
  if (circle)
    problems.push(
      t('The connections run in a circle: {circle}.', {
        circle: circle.join(' → '),
      }),
    );
  return [...new Set(problems)];
}

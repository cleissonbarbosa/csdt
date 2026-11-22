/**
 * A scenario being written, and the file it becomes.
 *
 * The format is the server's (`docs/WORKSPACE.md`, `schemas/v1/scenario`):
 * phases on a timeline, each with the effects that hold during it and the
 * events it announces. This module is the editor's model of such a file:
 * read one in, change it, write it out. It checks nothing about a
 * platform; whether the file is valid, and where it can run, is asked of
 * the server, which is the only place that decides.
 *
 * What the editor has no control for (a shift of traffic from one
 * connection onto another, a flow rejected at a node) is kept exactly as it
 * was read and written back untouched, so opening a file here and saving
 * it loses nothing.
 *
 * It also says which services and connections a selector names on a
 * platform, by the server's own rules (`incidents/mod.rs`, `Resolver`), so
 * the model can show what an effect is placed on. That is a reading of
 * names, not of outcomes: what an effect does is the engine's to say.
 */
import type { IncidentStatus, Topology } from '@aegis/contracts';

import { nodeLabel } from './names';

import { t } from '@/i18n';

export const CATEGORIES = ['availability', 'identity', 'authorization', 'resilience'] as const;
export const SEVERITIES = ['info', 'notice', 'warning', 'critical'] as const;
export const PHASE_STATUSES = ['active', 'mitigating', 'recovering'] as const;
export const EVENT_KINDS = ['alert', 'auth-failure', 'mitigation', 'reroute'] as const;

export const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  availability: t('Availability'),
  identity: t('Identity'),
  authorization: t('Authorization'),
  resilience: t('Resilience'),
};

/** The stage an incident is at, which each phase of a scenario names. */
export const STATUS_LABEL: Record<IncidentStatus, string> = {
  active: t('Active'),
  mitigating: t('Mitigating'),
  recovering: t('Recovering'),
  resolved: t('Resolved'),
};

/** The effects the editor has controls for. */
export const EFFECT_KINDS = [
  'capacity',
  'latency',
  'errorInject',
  'down',
  'demand',
  'edgeWeight',
  'edgeLatency',
  'edgeError',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const EFFECT: Record<
  EffectKind,
  {
    label: string;
    /** `factor` multiplies, `rate` is a share from 0 to 1, `none` takes no figure. */
    figure: 'factor' | 'rate' | 'none';
    /** What it is placed on: services, one service, or the calls into one. */
    on: 'nodes' | 'node' | 'inbound';
    /** The figure a new effect starts from. */
    start: number;
  }
> = {
  capacity: { label: t('Capacity ×'), figure: 'factor', on: 'nodes', start: 0.3 },
  latency: { label: t('Latency ×'), figure: 'factor', on: 'nodes', start: 4 },
  errorInject: { label: t('Share of requests that fail'), figure: 'rate', on: 'nodes', start: 0.2 },
  down: { label: t('Unreachable'), figure: 'none', on: 'nodes', start: 1 },
  demand: { label: t('Demand ×'), figure: 'factor', on: 'node', start: 3 },
  edgeWeight: { label: t('Calls into it ×'), figure: 'factor', on: 'inbound', start: 1.8 },
  edgeLatency: { label: t('Network latency into it ×'), figure: 'factor', on: 'inbound', start: 4 },
  edgeError: {
    label: t('Share of calls into it that fail'),
    figure: 'rate',
    on: 'inbound',
    start: 0.2,
  },
};

/** One existing connection, by the selectors of its two ends. */
export interface EdgeEnds {
  from: string;
  to: string;
}

/** An effect the editor has a control for, placed on something of the platform. */
export interface PlacedEffect {
  key: string;
  kind: EffectKind;
  /**
   * A selector: what the effect acts on, or for a connection effect the
   * service every synchronous call into which it acts on. Empty when it is
   * placed on nothing yet, or on the one connection `between` names.
   */
  target: string;
  value: number;
  /** For a connection effect, the one connection it acts on. */
  between?: EdgeEnds;
}

/** How fast an injected flow arrives: requests a second, or a multiple of a service's capacity. */
export type FlowRate = { rps: number } | { ofCapacity: { node: string; factor: number } };

/** The rate of one of the scenario's own flows while a phase holds. */
export interface FlowRateEffect {
  key: string;
  kind: 'flowRate';
  flow: string;
  rate: FlowRate;
}

export type EffectDraft =
  | PlacedEffect
  | FlowRateEffect
  /** Something the editor has no control for, kept as written. */
  | { key: string; kind: 'raw'; json: Record<string, unknown> };

/** One step of a flow: an existing connection, or the shortest synchronous path between two services. */
export interface HopDraft {
  from: string;
  to: string;
  via: 'edge' | 'path';
}

/** A stream of requests the scenario injects along explicit hops. */
export interface FlowDraft {
  key: string;
  kind: 'flow';
  id: string;
  label: string;
  /** Drawn as hostile traffic. */
  suspicious: boolean;
  /** What survives the last hop joins that service's own traffic. */
  spill: boolean;
  hops: HopDraft[];
  /** The catalogue request it is tied to, kept as written. */
  authz: Record<string, unknown> | null;
}

export type FlowEntry = FlowDraft | { key: string; kind: 'raw'; json: unknown };

export interface EventDraft {
  key: string;
  delayMs: number;
  severity: (typeof SEVERITIES)[number];
  kind: (typeof EVENT_KINDS)[number];
  title: string;
  message: string;
  /** Selectors of the services it is about. */
  nodes: string[];
}

export interface PhaseDraft {
  key: string;
  name: string;
  atMs: number;
  rampMs: number;
  status: (typeof PHASE_STATUSES)[number];
  description: string;
  effects: EffectDraft[];
  events: EventDraft[];
}

export interface ScenarioDraft {
  id: string;
  name: string;
  summary: string;
  category: (typeof CATEGORIES)[number];
  severity: (typeof SEVERITIES)[number];
  durationMs: number;
  /** A selector, or empty for none. */
  rootCause: string;
  /** As read from a file; `null` for "whatever the effects act on". */
  targets: string[] | null;
  /** Injected flows; one the editor cannot read is kept as written. */
  flows: FlowEntry[];
  phases: PhaseDraft[];
}

let serial = 0;
/** A key for a row of the editor. It is never written to the file. */
export function rowKey(): string {
  serial += 1;
  return `row-${serial}`;
}

/** `Slow database` → `slow-database`, within what an id may hold. */
export function slug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function emptyPhase(atMs: number, status: PhaseDraft['status'] = 'active'): PhaseDraft {
  return {
    key: rowKey(),
    name: status === 'recovering' ? t('Recovery') : t('New phase'),
    atMs,
    rampMs: 2000,
    status,
    description: '',
    effects: [],
    events: [],
  };
}

/**
 * A scenario to start from: one phase that does something, one that lets
 * go. With no `target` the first phase holds no effect yet.
 */
export function blankScenario(target: string): ScenarioDraft {
  const first = emptyPhase(0);
  first.name = t('Degradation');
  first.effects =
    target === '' ? [] : [{ key: rowKey(), kind: 'latency', target, value: EFFECT.latency.start }];
  return {
    id: 'my-scenario',
    name: t('My scenario'),
    summary: '',
    category: 'resilience',
    severity: 'warning',
    durationMs: 60_000,
    rootCause: '',
    targets: null,
    flows: [],
    phases: [first, emptyPhase(30_000, 'recovering')],
  };
}

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Two selectors as one connection's ends, or `null`. */
function endsOf(raw: unknown): EdgeEnds | null {
  const json = record(raw);
  return json && typeof json.from === 'string' && typeof json.to === 'string'
    ? { from: json.from, to: json.to }
    : null;
}

function rateFromFile(raw: unknown): FlowRate | null {
  const json = record(raw);
  if (!json) return null;
  if (typeof json.rps === 'number' && Object.keys(json).length === 1) return { rps: json.rps };
  const of = record(json.ofCapacity);
  if (of && typeof of.node === 'string' && typeof of.factor === 'number') {
    return { ofCapacity: { node: of.node, factor: of.factor } };
  }
  return null;
}

function effectFromFile(raw: unknown): EffectDraft | null {
  const json = record(raw);
  if (!json) return null;
  const kept: EffectDraft = { key: rowKey(), kind: 'raw', json };
  if (json.type === 'flowRate') {
    const rate = rateFromFile(json.rate);
    return typeof json.flow === 'string' && rate
      ? { key: rowKey(), kind: 'flowRate', flow: json.flow, rate }
      : kept;
  }
  const kind = EFFECT_KINDS.find((entry) => entry === json.type);
  if (!kind) return kept;
  const shape = EFFECT[kind];
  const figure = shape.figure === 'factor' ? json.factor : shape.figure === 'rate' ? json.rate : 1;
  if (typeof figure !== 'number') return kept;
  if (shape.on === 'inbound') {
    const edges = record(json.edges);
    const between = endsOf(edges?.between);
    if (between) return { key: rowKey(), kind, target: '', value: figure, between };
    const into = edges?.inboundSync;
    return typeof into === 'string' ? { key: rowKey(), kind, target: into, value: figure } : kept;
  }
  const target = shape.on === 'nodes' ? json.nodes : json.node;
  // One whose figures are not where the editor expects them is not rewritten: it is kept.
  if (typeof target !== 'string') return kept;
  return { key: rowKey(), kind, target, value: figure };
}

function effectToFile(effect: EffectDraft): Record<string, unknown> {
  if (effect.kind === 'raw') return effect.json;
  if (effect.kind === 'flowRate') return { type: 'flowRate', flow: effect.flow, rate: effect.rate };
  const shape = EFFECT[effect.kind];
  const on =
    shape.on === 'nodes'
      ? { nodes: effect.target }
      : shape.on === 'node'
        ? { node: effect.target }
        : effect.between
          ? { edges: { between: effect.between } }
          : { edges: { inboundSync: effect.target } };
  const figure =
    shape.figure === 'factor'
      ? { factor: effect.value }
      : shape.figure === 'rate'
        ? { rate: effect.value }
        : {};
  return { type: effect.kind, ...on, ...figure };
}

function flowFromFile(raw: unknown): FlowEntry {
  const json = record(raw);
  const kept: FlowEntry = { key: rowKey(), kind: 'raw', json: raw };
  if (!json || typeof json.id !== 'string' || !Array.isArray(json.hops)) return kept;
  const known = new Set(['id', 'label', 'suspicious', 'spill', 'hops', 'authz']);
  if (Object.keys(json).some((field) => !known.has(field))) return kept;
  const hops: HopDraft[] = [];
  for (const entry of json.hops) {
    const hop = record(entry);
    const ends = endsOf(hop);
    if (!hop || !ends || (hop.via !== undefined && hop.via !== 'edge' && hop.via !== 'path')) {
      return kept;
    }
    hops.push({ ...ends, via: hop.via === 'path' ? 'path' : 'edge' });
  }
  return {
    key: rowKey(),
    kind: 'flow',
    id: json.id,
    label: text(json.label),
    suspicious: json.suspicious === true,
    spill: json.spill === true,
    hops,
    authz: record(json.authz),
  };
}

function flowToFile(flow: FlowEntry): unknown {
  if (flow.kind === 'raw') return flow.json;
  return {
    id: flow.id,
    label: flow.label,
    suspicious: flow.suspicious,
    hops: flow.hops.map((hop) => ({
      from: hop.from,
      to: hop.to,
      ...(hop.via === 'path' ? { via: 'path' } : {}),
    })),
    spill: flow.spill,
    ...(flow.authz ? { authz: flow.authz } : {}),
  };
}

/** Reads a scenario file. `null` when it is not an object with phases. */
export function draftFromFile(raw: unknown): ScenarioDraft | null {
  const json = record(raw);
  if (!json || !Array.isArray(json.phases)) return null;
  return {
    id: text(json.id),
    name: text(json.name),
    summary: text(json.summary),
    category: oneOf(CATEGORIES, json.category, 'resilience'),
    severity: oneOf(SEVERITIES, json.severity, 'warning'),
    durationMs: number(json.durationMs, 60_000),
    rootCause: text(json.rootCause),
    targets: Array.isArray(json.targets)
      ? json.targets.filter((entry): entry is string => typeof entry === 'string')
      : null,
    flows: (Array.isArray(json.flows) ? json.flows : []).map(flowFromFile),
    phases: json.phases.flatMap((entry) => {
      const phase = record(entry);
      if (!phase) return [];
      return [
        {
          key: rowKey(),
          name: text(phase.name),
          atMs: number(phase.atMs),
          rampMs: number(phase.rampMs, 2000),
          status: oneOf(PHASE_STATUSES, phase.status, 'active'),
          description: text(phase.description),
          effects: (Array.isArray(phase.effects) ? phase.effects : []).flatMap((effect) => {
            const read = effectFromFile(effect);
            return read ? [read] : [];
          }),
          events: (Array.isArray(phase.events) ? phase.events : []).flatMap((event) => {
            const read = record(event);
            if (!read) return [];
            return [
              {
                key: rowKey(),
                delayMs: number(read.delayMs),
                severity: oneOf(SEVERITIES, read.severity, 'warning'),
                kind: oneOf(EVENT_KINDS, read.kind, 'alert'),
                title: text(read.title),
                message: text(read.message),
                nodes: Array.isArray(read.nodes)
                  ? read.nodes.filter((node): node is string => typeof node === 'string')
                  : [],
              },
            ];
          }),
        },
      ];
    }),
  };
}

/** What the scenario's effects act on, each selector once, in order. */
export function derivedTargets(draft: ScenarioDraft): string[] {
  const seen: string[] = [];
  for (const phase of draft.phases) {
    for (const effect of phase.effects) {
      if (effect.kind === 'raw' || effect.kind === 'flowRate' || effect.between) continue;
      if (effect.target !== '' && !seen.includes(effect.target)) seen.push(effect.target);
    }
  }
  return seen;
}

/** The file, in the format the engine reads. Phases are written in time order. */
export function draftToFile(draft: ScenarioDraft): Record<string, unknown> {
  return {
    id: draft.id,
    name: draft.name,
    summary: draft.summary,
    category: draft.category,
    severity: draft.severity,
    durationMs: draft.durationMs,
    ...(draft.rootCause !== '' ? { rootCause: draft.rootCause } : {}),
    targets: draft.targets ?? derivedTargets(draft),
    flows: draft.flows.map(flowToFile),
    phases: [...draft.phases]
      .sort((a, b) => a.atMs - b.atMs)
      .map((phase) => ({
        name: phase.name,
        atMs: phase.atMs,
        rampMs: phase.rampMs,
        status: phase.status,
        description: phase.description,
        effects: phase.effects.map(effectToFile),
        events: phase.events.map((event) => ({
          delayMs: event.delayMs,
          severity: event.severity,
          kind: event.kind,
          title: event.title,
          message: event.message,
          nodes: event.nodes,
        })),
      })),
  };
}

/**
 * What is plainly missing before the server is asked: a name, an order of
 * phases. Everything else (ranges, what a platform has) is the server's to
 * say, and it says it about the file itself.
 */
export function draftProblems(draft: ScenarioDraft): string[] {
  const problems: string[] = [];
  if (draft.name.trim() === '') problems.push(t('The scenario needs a name.'));
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(draft.id)) {
    problems.push(t('The id is 1 to 64 letters, digits, "-", "_" or ".".'));
  }
  if (draft.phases.length === 0) problems.push(t('A scenario needs at least one phase.'));
  if (draft.phases.length > 0 && !draft.phases.some((phase) => phase.atMs === 0)) {
    problems.push(t('One phase has to start at 0 seconds.'));
  }
  for (const phase of draft.phases) {
    if (phase.name.trim() === '') problems.push(t('Every phase needs a name.'));
    if (phase.atMs >= draft.durationMs) {
      problems.push(t('“{phase}” starts after the scenario ends.', { phase: phase.name }));
    }
    for (const effect of phase.effects) {
      if (effect.kind === 'raw') continue;
      if (effect.kind === 'flowRate') {
        if (!draft.flows.some((flow) => flow.kind === 'flow' && flow.id === effect.flow)) {
          problems.push(
            t('An effect of “{phase}” sets the rate of a flow the scenario does not have.', {
              phase: phase.name,
            }),
          );
        }
      } else if (effect.target === '' && !effect.between) {
        problems.push(
          t('An effect of “{phase}” is not placed on anything.', { phase: phase.name }),
        );
      }
    }
    for (const event of phase.events) {
      if (event.title.trim() === '') {
        problems.push(t('An event of “{phase}” has no title.', { phase: phase.name }));
      }
    }
  }
  for (const flow of draft.flows) {
    if (flow.kind !== 'flow') continue;
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(flow.id)) {
      problems.push(t('A flow’s id is 1 to 64 letters, digits, "-", "_" or ".".'));
    }
    if (flow.hops.length === 0) {
      problems.push(t('The flow “{flow}” has no hop.', { flow: flow.label || flow.id }));
    }
  }
  return [...new Set(problems)];
}

export interface TargetChoice {
  value: string;
  label: string;
  group: string;
}

/**
 * What an effect can be placed on, on a platform: its roles first, since a
 * scenario written against roles runs on any platform that has them, then
 * its regions and its services by id. `single` leaves out what names more
 * than one service.
 */
export function targetChoices(topology: Topology, single: boolean): TargetChoice[] {
  const choices: TargetChoice[] = [];
  const regionName = new Map(topology.regions.map((region) => [region.id, region.name]));
  for (const [role, target] of Object.entries(topology.roles).sort()) {
    if (topology.nodes.some((node) => node.id === target)) {
      choices.push({
        value: `role:${role}`,
        label: `${role} (${nodeLabel(topology, target)})`,
        group: t('By role: runs wherever the role exists'),
      });
    } else if (regionName.has(target)) {
      if (!single) {
        choices.push({
          value: `region:${role}`,
          label: t('every service of {role} ({region})', {
            role,
            region: regionName.get(target) ?? target,
          }),
          group: t('By role: runs wherever the role exists'),
        });
      }
      choices.push({
        value: `gatewayOf:${role}`,
        label: t('the gateway of {role} ({region})', {
          role,
          region: regionName.get(target) ?? target,
        }),
        group: t('By role: runs wherever the role exists'),
      });
    }
  }
  if (!single) {
    for (const region of topology.regions) {
      choices.push({
        value: `region:${region.id}`,
        label: t('every service of {region}', { region: region.name }),
        group: t('A region of this platform'),
      });
    }
  }
  for (const node of topology.nodes) {
    choices.push({
      value: `node:${node.id}`,
      label: nodeLabel(topology, node.id),
      group: t('A service of this platform'),
    });
  }
  return choices;
}

// ---------------------------------------------------------------------------
// The phases on a timeline
// ---------------------------------------------------------------------------

/** The engine's tick: phases start on one, at least one apart. */
export const TICK_MS = 200;
/** The longest a scenario lasts: the half hour of history the timeline keeps. */
export const MAX_DURATION_MS = 1_800_000;

/** A time rounded to the tick, never before zero. */
export const snapMs = (ms: number): number => Math.max(0, Math.round(ms / TICK_MS) * TICK_MS);

/** The phases in the order they hold. */
export const inOrder = (draft: ScenarioDraft): PhaseDraft[] =>
  [...draft.phases].sort((a, b) => a.atMs - b.atMs);

/** When a phase stops holding: where the next one starts, or the scenario's end. */
export function phaseEnd(draft: ScenarioDraft, key: string): number {
  const phases = inOrder(draft);
  const k = phases.findIndex((phase) => phase.key === key);
  return phases[k + 1]?.atMs ?? draft.durationMs;
}

/** The phase that holds at a moment of the scenario. */
export function phaseAt(draft: ScenarioDraft, ms: number): PhaseDraft | null {
  let held: PhaseDraft | null = null;
  for (const phase of inOrder(draft)) if (phase.atMs <= ms) held = phase;
  return held;
}

const withPhases = (draft: ScenarioDraft, phases: PhaseDraft[]): ScenarioDraft => ({
  ...draft,
  phases: [...phases].sort((a, b) => a.atMs - b.atMs),
});

/**
 * Moves where a phase starts, on the tick, at least a tick after the phase
 * before it and before the one after it (or the scenario's end). The first
 * phase starts at zero and stays there.
 */
export function movePhase(draft: ScenarioDraft, key: string, atMs: number): ScenarioDraft {
  const phases = inOrder(draft);
  const k = phases.findIndex((phase) => phase.key === key);
  if (k <= 0) return draft;
  const low = phases[k - 1]!.atMs + TICK_MS;
  const high = (phases[k + 1]?.atMs ?? draft.durationMs) - TICK_MS;
  if (high < low) return draft;
  const at = Math.min(high, Math.max(low, snapMs(atMs)));
  return withPhases(
    draft,
    phases.map((phase) => (phase.key === key ? { ...phase, atMs: at } : phase)),
  );
}

/** How long a phase's effects take to ease in: on the tick, at most as long as the phase. */
export function setRamp(draft: ScenarioDraft, key: string, rampMs: number): ScenarioDraft {
  const phase = draft.phases.find((entry) => entry.key === key);
  if (!phase) return draft;
  const ramp = Math.min(phaseEnd(draft, key) - phase.atMs, snapMs(rampMs));
  return {
    ...draft,
    phases: draft.phases.map((entry) => (entry.key === key ? { ...entry, rampMs: ramp } : entry)),
  };
}

/** How long the scenario lasts: on the tick, a tick past its last phase's start at least. */
export function setDuration(draft: ScenarioDraft, ms: number): ScenarioDraft {
  const last = Math.max(0, ...draft.phases.map((phase) => phase.atMs));
  return {
    ...draft,
    durationMs: Math.min(MAX_DURATION_MS, Math.max(last + TICK_MS, snapMs(ms))),
  };
}

/**
 * A phase that starts at `atMs`, cutting the one that holds there in two.
 * It holds no effect: whatever it lists is what holds from then on, and it
 * lists nothing yet. `null` where there is no room for one (within a tick
 * of a start, or of the end).
 */
export function splitPhase(
  draft: ScenarioDraft,
  atMs: number,
): { draft: ScenarioDraft; key: string } | null {
  const at = snapMs(atMs);
  if (at <= 0 || at > draft.durationMs - TICK_MS) return null;
  if (draft.phases.some((phase) => Math.abs(phase.atMs - at) < TICK_MS)) return null;
  const held = phaseAt(draft, at);
  const phase = emptyPhase(at, held?.status === 'recovering' ? 'recovering' : 'mitigating');
  return { draft: withPhases(draft, [...draft.phases, phase]), key: phase.key };
}

/**
 * Takes a phase out. The one left alone cannot be. When it was the first,
 * the next starts at zero instead.
 */
export function removePhase(draft: ScenarioDraft, key: string): ScenarioDraft {
  if (draft.phases.length <= 1) return draft;
  const phases = inOrder(draft).filter((phase) => phase.key !== key);
  if (phases.length === draft.phases.length) return draft;
  const [first, ...rest] = phases;
  return withPhases(draft, first ? [{ ...first, atMs: 0 }, ...rest] : rest);
}

// ---------------------------------------------------------------------------
// What a scenario names on a platform
// ---------------------------------------------------------------------------

/** As much of a platform as a selector is read against: a topology file, or one the server runs. */
export interface PlatformShape {
  roles: Readonly<Record<string, string>>;
  regions: readonly { id: string; name: string }[];
  nodes: readonly { id: string; name: string; region: string; type: string }[];
  edges: readonly { source: string; target: string; relationship: string }[];
}

/** The kinds a region's gateway is looked for among (`ServiceType::is_gateway`). */
export const GATEWAY_TYPES: readonly string[] = ['api-gateway', 'load-balancer'];
/** The relationships a call waits on (`Relationship::is_sync`). */
export const SYNC_RELATIONSHIPS: readonly string[] = ['route', 'call', 'auth', 'authz', 'data'];

const connectionId = (source: string, target: string) => `${source}->${target}`;

function split(selector: string): [string, string] | null {
  const at = selector.indexOf(':');
  return at > 0 && at < selector.length - 1
    ? [selector.slice(0, at), selector.slice(at + 1)]
    : null;
}

/** A region named by a role that points at it, or by its own id. */
export function regionNamed(platform: PlatformShape, name: string): string | null {
  const role = platform.roles[name];
  if (role !== undefined && platform.regions.some((region) => region.id === role)) return role;
  return platform.regions.some((region) => region.id === name) ? name : null;
}

/** The one service a selector names on a platform, or `null` where it names none. */
export function resolveNode(platform: PlatformShape, selector: string): string | null {
  const parts = split(selector);
  if (!parts) return null;
  const [kind, name] = parts;
  const has = (id: string) => platform.nodes.some((node) => node.id === id);
  if (kind === 'role') {
    const id = platform.roles[name];
    return id !== undefined && has(id) ? id : null;
  }
  if (kind === 'node') return has(name) ? name : null;
  if (kind === 'gatewayOf') {
    const region = regionNamed(platform, name);
    return (
      platform.nodes.find((node) => node.region === region && GATEWAY_TYPES.includes(node.type))
        ?.id ?? null
    );
  }
  return null;
}

/** Every service a selector (`region:` included) names on a platform. */
export function resolveNodes(platform: PlatformShape, selector: string): string[] {
  const parts = split(selector);
  if (parts?.[0] === 'region') {
    const region = regionNamed(platform, parts[1]);
    return region === null
      ? []
      : platform.nodes.filter((node) => node.region === region).map((node) => node.id);
  }
  const one = resolveNode(platform, selector);
  return one === null ? [] : [one];
}

/**
 * What an effect is placed on, on a platform: the services and the
 * connections (by id, `source->target`) its selectors name. A flow's rate
 * is on the connections of the flow's hops that are single connections.
 */
export function reachOf(
  platform: PlatformShape,
  effect: EffectDraft,
  flows: readonly FlowEntry[] = [],
): { nodes: string[]; edges: string[] } {
  if (effect.kind === 'raw') return { nodes: [], edges: [] };
  if (effect.kind === 'flowRate') {
    const flow = flows.find((entry) => entry.kind === 'flow' && entry.id === effect.flow);
    return flow?.kind === 'flow' ? flowReach(platform, flow) : { nodes: [], edges: [] };
  }
  if (EFFECT[effect.kind].on !== 'inbound') {
    return { nodes: resolveNodes(platform, effect.target), edges: [] };
  }
  if (effect.between) {
    const from = resolveNode(platform, effect.between.from);
    const to = resolveNode(platform, effect.between.to);
    const there = platform.edges.some((edge) => edge.source === from && edge.target === to);
    return from !== null && to !== null && there
      ? { nodes: [from, to], edges: [connectionId(from, to)] }
      : { nodes: [], edges: [] };
  }
  const into = resolveNode(platform, effect.target);
  if (into === null) return { nodes: [], edges: [] };
  const edges = platform.edges
    .filter((edge) => edge.target === into && SYNC_RELATIONSHIPS.includes(edge.relationship))
    .map((edge) => connectionId(edge.source, edge.target));
  return { nodes: [into], edges };
}

/** The services a flow passes and the single connections it takes. */
export function flowReach(
  platform: PlatformShape,
  flow: FlowDraft,
): { nodes: string[]; edges: string[] } {
  const nodes: string[] = [];
  const edges: string[] = [];
  for (const hop of flow.hops) {
    const from = resolveNode(platform, hop.from);
    const to = resolveNode(platform, hop.to);
    for (const id of [from, to]) if (id !== null && !nodes.includes(id)) nodes.push(id);
    if (from !== null && to !== null && hop.via === 'edge') edges.push(connectionId(from, to));
  }
  return { nodes, edges };
}

/**
 * How a scenario names a service: by a role that points at it, so the
 * scenario runs on any platform with that role, or by its id.
 */
export function selectorOfNode(platform: PlatformShape, nodeId: string): string {
  const role = Object.entries(platform.roles)
    .sort(([a], [b]) => a.localeCompare(b))
    .find(([, target]) => target === nodeId)?.[0];
  return role !== undefined ? `role:${role}` : `node:${nodeId}`;
}

/** How a scenario names every service of a region: by a role that points at it, or by its id. */
export function selectorOfRegion(platform: PlatformShape, regionId: string): string {
  const role = Object.entries(platform.roles)
    .sort(([a], [b]) => a.localeCompare(b))
    .find(([, target]) => target === regionId)?.[0];
  return `region:${role ?? regionId}`;
}

/** A service's name, with its region's where another service has the same one. */
export function serviceName(platform: PlatformShape, nodeId: string): string {
  const node = platform.nodes.find((entry) => entry.id === nodeId);
  if (!node) return nodeId;
  const repeats = platform.nodes.some((other) => other.id !== nodeId && other.name === node.name);
  const region = platform.regions.find((entry) => entry.id === node.region)?.name ?? node.region;
  return repeats ? `${node.name}, ${region}` : node.name;
}

/** What a selector names on a platform, in words; one that names nothing there says so. */
export function selectorLabel(platform: PlatformShape, selector: string): string {
  const parts = split(selector);
  if (!parts) return selector;
  const [kind, name] = parts;
  if (kind === 'region' || kind === 'gatewayOf') {
    const region = regionNamed(platform, name);
    const regionName = platform.regions.find((entry) => entry.id === region)?.name;
    if (regionName === undefined) return t('{value} (not on this platform)', { value: selector });
    if (kind === 'region') return t('every service of {region}', { region: regionName });
    const gateway = resolveNode(platform, selector);
    return gateway === null
      ? t('{value} (not on this platform)', { value: selector })
      : t('the gateway of {region} ({name})', {
          region: regionName,
          name: serviceName(platform, gateway),
        });
  }
  const id = resolveNode(platform, selector);
  if (id === null) return t('{value} (not on this platform)', { value: selector });
  return kind === 'role' ? `${name} (${serviceName(platform, id)})` : serviceName(platform, id);
}

/**
 * Places an effect in a phase. One of the same kind already on the same
 * thing is not doubled: its key is given back and nothing changes.
 */
export function placeEffect(
  draft: ScenarioDraft,
  phaseKey: string,
  effect: Omit<PlacedEffect, 'key'>,
): { draft: ScenarioDraft; key: string } {
  const phase = draft.phases.find((entry) => entry.key === phaseKey);
  if (!phase) return { draft, key: '' };
  const same = phase.effects.find(
    (entry) =>
      entry.kind === effect.kind &&
      entry.target === effect.target &&
      entry.between?.from === effect.between?.from &&
      entry.between?.to === effect.between?.to,
  );
  if (same) return { draft, key: same.key };
  const key = rowKey();
  return {
    draft: {
      ...draft,
      phases: draft.phases.map((entry) =>
        entry.key === phaseKey
          ? { ...entry, effects: [...entry.effects, { ...effect, key }] }
          : entry,
      ),
    },
    key,
  };
}

/** A new flow along `hops`, with an id no other flow of the scenario has. */
export function newFlow(draft: ScenarioDraft, hops: HopDraft[]): FlowDraft {
  const taken = new Set(draft.flows.map((flow) => (flow.kind === 'flow' ? flow.id : '')));
  let n = 1;
  while (taken.has(`flow-${n}`)) n += 1;
  return {
    key: rowKey(),
    kind: 'flow',
    id: `flow-${n}`,
    label: t('Flow {n}', { n }),
    suspicious: true,
    spill: true,
    hops,
    authz: null,
  };
}

/**
 * The hops of a flow drawn through services one after another: a single
 * connection where the two are connected, otherwise the shortest
 * synchronous path between them.
 */
export function hopsThrough(platform: PlatformShape, nodeIds: readonly string[]): HopDraft[] {
  const hops: HopDraft[] = [];
  for (let k = 1; k < nodeIds.length; k++) {
    const from = nodeIds[k - 1]!;
    const to = nodeIds[k]!;
    const direct = platform.edges.some((edge) => edge.source === from && edge.target === to);
    hops.push({
      from: selectorOfNode(platform, from),
      to: selectorOfNode(platform, to),
      via: direct ? 'edge' : 'path',
    });
  }
  return hops;
}

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
 * What the editor has no control for (injected flows, an effect between
 * two named ends) is kept exactly as it was read and written back
 * untouched, so opening a file here and saving it loses nothing.
 */
import type { Topology } from '@aegis/contracts';

import { nodeLabel } from './names';

export const CATEGORIES = ['availability', 'identity', 'authorization', 'resilience'] as const;
export const SEVERITIES = ['info', 'notice', 'warning', 'critical'] as const;
export const PHASE_STATUSES = ['active', 'mitigating', 'recovering'] as const;
export const EVENT_KINDS = ['alert', 'auth-failure', 'mitigation', 'reroute'] as const;

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
  capacity: { label: 'Capacity ×', figure: 'factor', on: 'nodes', start: 0.3 },
  latency: { label: 'Latency ×', figure: 'factor', on: 'nodes', start: 4 },
  errorInject: { label: 'Share of requests that fail', figure: 'rate', on: 'nodes', start: 0.2 },
  down: { label: 'Unreachable', figure: 'none', on: 'nodes', start: 1 },
  demand: { label: 'Demand ×', figure: 'factor', on: 'node', start: 3 },
  edgeWeight: { label: 'Calls into it ×', figure: 'factor', on: 'inbound', start: 1.8 },
  edgeLatency: { label: 'Network latency into it ×', figure: 'factor', on: 'inbound', start: 4 },
  edgeError: {
    label: 'Share of calls into it that fail',
    figure: 'rate',
    on: 'inbound',
    start: 0.2,
  },
};

export type EffectDraft =
  | { key: string; kind: EffectKind; target: string; value: number }
  /** Something the editor has no control for, kept as written. */
  | { key: string; kind: 'raw'; json: Record<string, unknown> };

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
  /** Injected flows, kept as written. */
  flows: unknown[];
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
    name: status === 'recovering' ? 'Recovery' : 'New phase',
    atMs,
    rampMs: 2000,
    status,
    description: '',
    effects: [],
    events: [],
  };
}

/** A scenario to start from: one phase that does something, one that lets go. */
export function blankScenario(target: string): ScenarioDraft {
  const first = emptyPhase(0);
  first.name = 'Degradation';
  first.effects = [{ key: rowKey(), kind: 'latency', target, value: EFFECT.latency.start }];
  return {
    id: 'my-scenario',
    name: 'My scenario',
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

function effectFromFile(raw: unknown): EffectDraft | null {
  const json = record(raw);
  if (!json) return null;
  const kind = EFFECT_KINDS.find((entry) => entry === json.type);
  const kept: EffectDraft = { key: rowKey(), kind: 'raw', json };
  if (!kind) return kept;
  const shape = EFFECT[kind];
  const figure = shape.figure === 'factor' ? json.factor : shape.figure === 'rate' ? json.rate : 1;
  const target =
    shape.on === 'nodes'
      ? json.nodes
      : shape.on === 'node'
        ? json.node
        : record(json.edges)?.inboundSync;
  // An effect between two named ends, or one whose figures are not where
  // the editor expects them, is not rewritten: it is kept.
  if (typeof target !== 'string' || typeof figure !== 'number') return kept;
  return { key: rowKey(), kind, target, value: figure };
}

function effectToFile(effect: EffectDraft): Record<string, unknown> {
  if (effect.kind === 'raw') return effect.json;
  const shape = EFFECT[effect.kind];
  const on =
    shape.on === 'nodes'
      ? { nodes: effect.target }
      : shape.on === 'node'
        ? { node: effect.target }
        : { edges: { inboundSync: effect.target } };
  const figure =
    shape.figure === 'factor'
      ? { factor: effect.value }
      : shape.figure === 'rate'
        ? { rate: effect.value }
        : {};
  return { type: effect.kind, ...on, ...figure };
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
    flows: Array.isArray(json.flows) ? json.flows : [],
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
      if (effect.kind !== 'raw' && effect.target !== '' && !seen.includes(effect.target)) {
        seen.push(effect.target);
      }
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
    flows: draft.flows,
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
  if (draft.name.trim() === '') problems.push('The scenario needs a name.');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(draft.id)) {
    problems.push('The id is 1 to 64 letters, digits, "-", "_" or ".".');
  }
  if (draft.phases.length === 0) problems.push('A scenario needs at least one phase.');
  if (draft.phases.length > 0 && !draft.phases.some((phase) => phase.atMs === 0)) {
    problems.push('One phase has to start at 0 seconds.');
  }
  for (const phase of draft.phases) {
    if (phase.name.trim() === '') problems.push('Every phase needs a name.');
    if (phase.atMs >= draft.durationMs) {
      problems.push(`“${phase.name}” starts after the scenario ends.`);
    }
    for (const effect of phase.effects) {
      if (effect.kind !== 'raw' && effect.target === '') {
        problems.push(`An effect of “${phase.name}” is not placed on anything.`);
      }
    }
    for (const event of phase.events) {
      if (event.title.trim() === '') problems.push(`An event of “${phase.name}” has no title.`);
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
        group: 'By role: runs wherever the role exists',
      });
    } else if (regionName.has(target)) {
      if (!single) {
        choices.push({
          value: `region:${role}`,
          label: `every service of ${role} (${regionName.get(target)})`,
          group: 'By role: runs wherever the role exists',
        });
      }
      choices.push({
        value: `gatewayOf:${role}`,
        label: `the gateway of ${role} (${regionName.get(target)})`,
        group: 'By role: runs wherever the role exists',
      });
    }
  }
  if (!single) {
    for (const region of topology.regions) {
      choices.push({
        value: `region:${region.id}`,
        label: `every service of ${region.name}`,
        group: 'A region of this platform',
      });
    }
  }
  for (const node of topology.nodes) {
    choices.push({
      value: `node:${node.id}`,
      label: nodeLabel(topology, node.id),
      group: 'A service of this platform',
    });
  }
  return choices;
}

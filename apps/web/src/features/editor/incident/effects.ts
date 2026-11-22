/**
 * The effects of an incident as the editor places and shows them.
 *
 * An effect is carried from the palette onto the model and placed in the
 * phase in hand on what it is let go over: a service, by its role first so
 * the scenario runs on any platform with that role, then by its id; every
 * service of a region, by a role that points at the region or by its id; or
 * one connection, for an effect on calls. Each kind says what it can be
 * placed on (`EFFECT[kind].on`), and a carry over anything else says why
 * not, in words, instead of placing it somewhere it does nothing.
 *
 * What the phase's effects are placed on is read from their selectors by
 * the server's rules (`reachOf` in `lib/scenarioFile.ts`): the services and
 * connections it names, which the model keeps in front in the viewer's
 * blue. It says where an effect is, not what it will do: that is the
 * engine's, when the incident runs.
 */
import {
  ArrowRightLeft,
  Ban,
  Gauge,
  Hourglass,
  OctagonX,
  Route,
  Timer,
  TrendingUp,
  Unplug,
  type LucideIcon,
} from 'lucide-react';

import { t } from '@/i18n';
import { formatPercent, formatRate } from '@/lib/format';
import {
  EFFECT,
  flowReach,
  reachOf,
  selectorLabel,
  selectorOfNode,
  selectorOfRegion,
  type EffectDraft,
  type EffectKind,
  type FlowDraft,
  type FlowRate,
  type PlacedEffect,
  type ScenarioDraft,
} from '@/lib/scenarioFile';
import { edgeId, type TopologyDraft } from '@/lib/topologyFile';

/** A glyph for each kind of effect, after what it changes. */
export const EFFECT_GLYPH: Record<EffectKind, LucideIcon> = {
  capacity: Gauge,
  latency: Hourglass,
  errorInject: OctagonX,
  down: Unplug,
  demand: TrendingUp,
  edgeWeight: ArrowRightLeft,
  edgeLatency: Timer,
  edgeError: Ban,
};

/** The glyph of an injected flow. */
export const FLOW_GLYPH = Route;

/** What each effect is called in the palette, where no figure goes with it yet. */
export const EFFECT_NAME: Record<EffectKind, string> = {
  capacity: t('Capacity'),
  latency: t('Latency'),
  errorInject: t('Requests fail'),
  down: t('Unreachable'),
  demand: t('Demand'),
  edgeWeight: t('Calls into it'),
  edgeLatency: t('Network latency into it'),
  edgeError: t('Calls into it fail'),
};

/** A factor as the file keeps it, without trailing zeros. */
const figure = (value: number) => String(Number(value.toFixed(2)));

/** What is under the pointer, as far as placing an effect is concerned. */
export interface Under {
  node: string | null;
  edge: string | null;
  region: string | null;
}

/** Where a carried effect would go, with what it is placed on; or why it cannot go there. */
export type Placement = { effect: Omit<PlacedEffect, 'key'>; on: Under } | { refusal: string };

/**
 * What placing an effect of `kind` over `under` means: a piece before a
 * connection, a connection before the plate under both. `null` where there
 * is nothing to place it on.
 */
export function placementAt(
  platform: TopologyDraft,
  kind: EffectKind,
  under: Under,
): Placement | null {
  const shape = EFFECT[kind];
  const value = shape.start;
  const none: Under = { node: null, edge: null, region: null };
  if (under.node !== null) {
    const node = platform.nodes.find((entry) => entry.id === under.node);
    if (!node) return null;
    if (shape.on === 'node' && node.type !== 'external-client') {
      return { refusal: t('Demand is what a client sends: carry it onto a client.') };
    }
    return {
      effect: { kind, target: selectorOfNode(platform, node.id), value },
      on: { ...none, node: node.id },
    };
  }
  if (under.edge !== null) {
    const edge = platform.edges.find((entry) => edgeId(entry) === under.edge);
    if (!edge) return null;
    if (shape.on === 'node') {
      return { refusal: t('Demand is what a client sends: carry it onto a client.') };
    }
    if (shape.on === 'nodes') {
      return {
        refusal: t('This effect is placed on a service or a region, not on a connection.'),
      };
    }
    return {
      effect: {
        kind,
        target: '',
        value,
        between: {
          from: selectorOfNode(platform, edge.source),
          to: selectorOfNode(platform, edge.target),
        },
      },
      on: { ...none, edge: under.edge },
    };
  }
  if (under.region !== null && platform.regions.some((region) => region.id === under.region)) {
    if (shape.on !== 'nodes') {
      return { refusal: t('This effect is placed on one service, not on a whole region.') };
    }
    return {
      effect: { kind, target: selectorOfRegion(platform, under.region), value },
      on: { ...none, region: under.region },
    };
  }
  return null;
}

/** An effect in a few words, figure included: what a chip on the model says. */
export function chipText(effect: PlacedEffect): string {
  const n = figure(effect.value);
  switch (effect.kind) {
    case 'capacity':
      return t('Capacity ×{n}', { n });
    case 'latency':
      return t('Latency ×{n}', { n });
    case 'errorInject':
      return t('{share} of requests fail', { share: formatPercent(effect.value) });
    case 'down':
      return t('Unreachable');
    case 'demand':
      return t('Demand ×{n}', { n });
    case 'edgeWeight':
      return t('Calls ×{n}', { n });
    case 'edgeLatency':
      return t('Network latency ×{n}', { n });
    case 'edgeError':
      return t('{share} of calls fail', { share: formatPercent(effect.value) });
  }
}

/** A flow's rate in a few words. */
export function rateText(platform: TopologyDraft, rate: FlowRate): string {
  return 'rps' in rate
    ? t('{rate} requests a second', { rate: formatRate(rate.rps) })
    : t('{n} times the capacity of {service}', {
        n: figure(rate.ofCapacity.factor),
        service: selectorLabel(platform, rate.ofCapacity.node),
      });
}

/** What an effect is placed on, in words. */
export function placedOn(platform: TopologyDraft, effect: PlacedEffect): string {
  if (effect.between) {
    return t('the connection {from} → {to}', {
      from: selectorLabel(platform, effect.between.from),
      to: selectorLabel(platform, effect.between.to),
    });
  }
  if (effect.target === '') return t('nothing yet');
  if (EFFECT[effect.kind].on === 'inbound') {
    return t('every call into {service}', { service: selectorLabel(platform, effect.target) });
  }
  return selectorLabel(platform, effect.target);
}

const flowsOf = (scenario: ScenarioDraft): FlowDraft[] =>
  scenario.flows.filter((flow): flow is FlowDraft => flow.kind === 'flow');

/** Everything the effects of a phase are placed on, for the model to keep in front. */
export function phaseReach(
  platform: TopologyDraft,
  scenario: ScenarioDraft,
  phaseKey: string | null,
): { nodes: string[]; edges: string[] } {
  const phase = scenario.phases.find((entry) => entry.key === phaseKey);
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const effect of phase?.effects ?? []) {
    const reach = reachOf(platform, effect, scenario.flows);
    for (const id of reach.nodes) nodes.add(id);
    for (const id of reach.edges) edges.add(id);
  }
  return { nodes: [...nodes], edges: [...edges] };
}

/** Where a chip is hung on the model: one service, a connection, or the middle of several. */
export type Anchor = { node: string } | { edge: string } | { nodes: string[] };

export interface Chip {
  key: string;
  text: string;
  glyph: LucideIcon;
  at: Anchor;
}

/** A chip for each effect of a phase that is placed on something of the platform. */
export function chipsOf(
  platform: TopologyDraft,
  scenario: ScenarioDraft,
  phaseKey: string | null,
): Chip[] {
  const phase = scenario.phases.find((entry) => entry.key === phaseKey);
  const chips: Chip[] = [];
  for (const effect of phase?.effects ?? []) {
    const chip = chipOf(platform, scenario, effect);
    if (chip) chips.push(chip);
  }
  return chips;
}

function chipOf(
  platform: TopologyDraft,
  scenario: ScenarioDraft,
  effect: EffectDraft,
): Chip | null {
  if (effect.kind === 'raw') return null;
  if (effect.kind === 'flowRate') {
    const flow = flowsOf(scenario).find((entry) => entry.id === effect.flow);
    const first = flow ? flowReach(platform, flow).nodes[0] : undefined;
    if (!flow || first === undefined) return null;
    return {
      key: effect.key,
      text: t('{flow}: {rate}', {
        flow: flow.label || flow.id,
        rate: rateText(platform, effect.rate),
      }),
      glyph: FLOW_GLYPH,
      at: { node: first },
    };
  }
  const reach = reachOf(platform, effect);
  const glyph = EFFECT_GLYPH[effect.kind];
  const text = chipText(effect);
  if (effect.between) {
    const edge = reach.edges[0];
    return edge === undefined ? null : { key: effect.key, text, glyph, at: { edge } };
  }
  if (reach.nodes.length === 0) return null;
  const at: Anchor =
    reach.nodes.length === 1 ? { node: reach.nodes[0] as string } : { nodes: reach.nodes };
  return { key: effect.key, text, glyph, at };
}

export interface Choice {
  value: string;
  label: string;
  group: string;
}

/**
 * What an effect can be placed on, on the platform being drawn: its roles
 * first, then its regions and its services. `single` leaves out what names
 * more than one service.
 */
export function choicesOn(platform: TopologyDraft, single: boolean): Choice[] {
  const byRole = t('By role: runs wherever the role exists');
  const choices: Choice[] = [];
  const offer = (value: string, group: string) =>
    choices.push({ value, label: selectorLabel(platform, value), group });
  for (const [role, target] of Object.entries(platform.roles).sort()) {
    if (platform.nodes.some((node) => node.id === target)) {
      offer(`role:${role}`, byRole);
    } else if (platform.regions.some((region) => region.id === target)) {
      if (!single) offer(`region:${role}`, byRole);
      offer(`gatewayOf:${role}`, byRole);
    }
  }
  if (!single) {
    const group = t('A region of this platform');
    for (const region of platform.regions) offer(`region:${region.id}`, group);
  }
  const group = t('A service of this platform');
  for (const node of platform.nodes) offer(`node:${node.id}`, group);
  return choices;
}

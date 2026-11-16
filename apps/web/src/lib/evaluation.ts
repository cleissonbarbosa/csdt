/**
 * What a Cedar evaluation was made with, and what has changed since.
 *
 * A decision answers one configuration: a request, a context, the policies
 * that were switched on and the engine that evaluated them. Shown beside a
 * form that has moved on, it reads as the answer to something else. These
 * helpers say whether a decision still belongs to what is on screen, and in
 * what the two differ. They decide nothing about access: that is Cedar's.
 */
import type {
  AuthorizationCatalog,
  AuthorizationDecision,
  EvaluateRequest,
} from '@aegis/contracts';

import { entityId } from './format';

export type EngineChoice = 'embedded' | 'cedar-agent';

/** Everything that shapes Cedar's answer. Context keys left absent are not listed. */
export interface EvaluationInputs {
  principal: string;
  action: string;
  resource: string;
  context: Record<string, boolean>;
  /** Ids of policies switched off, sorted. */
  disabled: string[];
  engine: EngineChoice;
}

export interface Evaluation {
  decision: AuthorizationDecision;
  inputs: EvaluationInputs;
  /** The policies that were loaded when it was made, as a fingerprint. */
  policies: string;
  /** How many there were. */
  policyCount: number;
}

export function requestOf(inputs: EvaluationInputs): EvaluateRequest {
  return {
    principal: inputs.principal,
    action: inputs.action,
    resource: inputs.resource,
    context: inputs.context,
    engine: inputs.engine,
    // The agent's own store is authoritative: nothing can be switched off in it.
    ...(inputs.engine === 'embedded' && inputs.disabled.length > 0
      ? { disabledPolicies: inputs.disabled }
      : {}),
  };
}

/**
 * The loaded policies as one string: ids and source text. Two catalogues
 * with the same fingerprint evaluate a request the same way.
 */
export function policyFingerprint(catalog: Pick<AuthorizationCatalog, 'policies'>): string {
  return catalog.policies.map((policy) => `${policy.id}\u0000${policy.content}`).join('\u0001');
}

export interface Labels {
  /** Context key to the words the form uses for it. */
  context: Record<string, string>;
}

const word = (value: boolean | undefined) =>
  value === undefined ? 'absent' : value ? 'true' : 'false';

/**
 * In what `now` differs from `before`, one sentence fragment per difference,
 * each naming the old value and the new. Empty when they are the same
 * configuration.
 */
export function differences(
  before: EvaluationInputs,
  now: EvaluationInputs,
  labels: Labels = { context: {} },
): string[] {
  const out: string[] = [];
  const part = (name: string, from: string, to: string) => {
    if (from !== to) out.push(`${name} was ${entityId(from)}, now ${entityId(to)}`);
  };
  part('Principal', before.principal, now.principal);
  part('Action', before.action, now.action);
  part('Resource', before.resource, now.resource);
  const keys = [...new Set([...Object.keys(before.context), ...Object.keys(now.context)])].sort();
  for (const key of keys) {
    const from = word(before.context[key]);
    const to = word(now.context[key]);
    if (from !== to) out.push(`${labels.context[key] ?? `context.${key}`} was ${from}, now ${to}`);
  }
  const switched = (from: string[], to: string[]) => from.filter((id) => !to.includes(id));
  for (const id of switched(now.disabled, before.disabled)) out.push(`Policy ${id} switched off`);
  for (const id of switched(before.disabled, now.disabled)) out.push(`Policy ${id} switched on`);
  if (before.engine !== now.engine) {
    out.push(`Engine was ${before.engine}, now ${now.engine}`);
  }
  return out;
}

/**
 * Why a decision no longer answers what is on screen; empty when it does.
 * The loaded policies being replaced counts as much as a field of the form.
 */
export function staleReasons(
  evaluation: Evaluation,
  now: EvaluationInputs,
  catalog: Pick<AuthorizationCatalog, 'policies'>,
  labels?: Labels,
): string[] {
  const reasons = differences(evaluation.inputs, now, labels);
  if (evaluation.policies !== policyFingerprint(catalog)) {
    reasons.push('The policies in use were replaced');
  }
  return reasons;
}

/** A context as the form shows it: every key the catalogue offers, with its value. */
export function contextRows(
  context: Record<string, unknown>,
  keys: readonly { key: string; label: string }[],
): { key: string; label: string; value: string }[] {
  const known = keys.map(({ key, label }) => ({
    key,
    label,
    value: word(typeof context[key] === 'boolean' ? context[key] : undefined),
  }));
  // A key the catalogue no longer lists is still part of what was evaluated.
  const extra = Object.keys(context)
    .filter((key) => !keys.some((entry) => entry.key === key))
    .sort()
    .map((key) => ({ key, label: `context.${key}`, value: JSON.stringify(context[key]) }));
  return [...known, ...extra];
}

export interface Comparison {
  /** Whether both sides ask the same thing of Cedar: principal, action, resource. */
  sameRequest: boolean;
  /** Whether Cedar's answer differs. */
  decisionChanged: boolean;
  /** Policies that determine one side's answer and not the other's. */
  onlyInA: string[];
  onlyInB: string[];
  /** In what B's configuration differs from A's. */
  differences: string[];
}

/** Two evaluations side by side. Reads both; evaluates nothing. */
export function compare(a: Evaluation, b: Evaluation, labels?: Labels): Comparison {
  const only = (from: string[], other: string[]) => from.filter((id) => !other.includes(id));
  const configured = differences(a.inputs, b.inputs, labels);
  if (a.policies !== b.policies) configured.push('The policies in use were replaced in between');
  return {
    sameRequest:
      a.inputs.principal === b.inputs.principal &&
      a.inputs.action === b.inputs.action &&
      a.inputs.resource === b.inputs.resource,
    decisionChanged: a.decision.decision !== b.decision.decision,
    onlyInA: only(a.decision.determiningPolicies, b.decision.determiningPolicies),
    onlyInB: only(b.decision.determiningPolicies, a.decision.determiningPolicies),
    differences: configured,
  };
}

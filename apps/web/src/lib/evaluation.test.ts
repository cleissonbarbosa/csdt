import { describe, expect, it } from 'vitest';

import { catalog as sampleCatalog, decisionAllow, decisionDeny } from '@/test/fixtures';

import {
  compare,
  contextRows,
  differences,
  policyFingerprint,
  requestOf,
  staleReasons,
  type Evaluation,
  type EvaluationInputs,
} from './evaluation';

const catalog = sampleCatalog();
const labels = { context: { mfa: 'Fresh MFA assertion' } };

const inputs = (over: Partial<EvaluationInputs> = {}): EvaluationInputs => ({
  principal: 'User::"alice"',
  action: 'Action::"exportLedger"',
  resource: 'Ledger::"acme-ledger-2026"',
  context: { mfa: true },
  disabled: [],
  engine: 'embedded',
  ...over,
});

const evaluation = (over: Partial<EvaluationInputs> = {}, allow = true): Evaluation => ({
  decision: allow ? decisionAllow() : decisionDeny(),
  inputs: inputs(over),
  policies: policyFingerprint(catalog),
  policyCount: catalog.policies.length,
});

describe('what an evaluation was made with', () => {
  it('is the request the server is sent', () => {
    expect(requestOf(inputs())).toEqual({
      principal: 'User::"alice"',
      action: 'Action::"exportLedger"',
      resource: 'Ledger::"acme-ledger-2026"',
      context: { mfa: true },
      engine: 'embedded',
    });
    expect(requestOf(inputs({ disabled: ['forbid-suspended'] })).disabledPolicies).toEqual([
      'forbid-suspended',
    ]);
    // The agent's own store decides; nothing can be switched off in it.
    expect(
      requestOf(inputs({ disabled: ['forbid-suspended'], engine: 'cedar-agent' })),
    ).not.toHaveProperty('disabledPolicies');
  });

  it('still answers a form that has not changed', () => {
    expect(staleReasons(evaluation(), inputs(), catalog, labels)).toEqual([]);
  });

  it('no longer answers once the context changes, and says what changed', () => {
    expect(
      staleReasons(evaluation(), inputs({ context: { mfa: false } }), catalog, labels),
    ).toEqual(['Fresh MFA assertion was true, now false']);
    expect(staleReasons(evaluation(), inputs({ context: {} }), catalog, labels)).toEqual([
      'Fresh MFA assertion was true, now absent',
    ]);
  });

  it('no longer answers once a policy is switched, the request or the engine changes', () => {
    expect(differences(inputs(), inputs({ disabled: ['forbid-suspended'] }))).toEqual([
      'Policy forbid-suspended switched off',
    ]);
    expect(differences(inputs({ disabled: ['forbid-suspended'] }), inputs())).toEqual([
      'Policy forbid-suspended switched on',
    ]);
    expect(differences(inputs(), inputs({ principal: 'User::"bob"' }))).toEqual([
      'Principal was alice, now bob',
    ]);
    expect(differences(inputs(), inputs({ engine: 'cedar-agent' }))).toEqual([
      'Engine was embedded, now cedar-agent',
    ]);
  });

  it('no longer answers once the policies themselves are replaced', () => {
    const replaced = {
      policies: catalog.policies.map((policy, i) =>
        i === 0 ? { ...policy, content: `${policy.content} // edited` } : policy,
      ),
    };
    expect(staleReasons(evaluation(), inputs(), replaced, labels)).toEqual([
      'The policies in use were replaced',
    ]);
    // Formatting the list differently is not a replacement.
    expect(staleReasons(evaluation(), inputs(), { policies: [...catalog.policies] })).toEqual([]);
  });

  it('writes a context out key by key, absent ones included', () => {
    expect(contextRows({ mfa: true }, catalog.contextKeys).map((row) => row.value)).toEqual([
      'true',
      'absent',
    ]);
    // A key the catalogue does not list was still part of what was asked.
    expect(contextRows({ region: 'eu' }, []).at(-1)).toEqual({
      key: 'region',
      label: 'context.region',
      value: '"eu"',
    });
  });
});

describe('two evaluations side by side', () => {
  it('says when the decision changed and which policies decide each side', () => {
    const a = evaluation();
    const b = evaluation({ context: { mfa: false } }, false);
    const result = compare(a, b, labels);
    expect(result.decisionChanged).toBe(true);
    expect(result.sameRequest).toBe(true);
    expect(result.differences).toEqual(['Fresh MFA assertion was true, now false']);
    expect(result.onlyInA).toEqual(a.decision.determiningPolicies);
    expect(result.onlyInB).toEqual(b.decision.determiningPolicies);
  });

  it('says when the two are different requests', () => {
    const result = compare(evaluation(), evaluation({ principal: 'User::"mallory"' }, false));
    expect(result.sameRequest).toBe(false);
  });

  it('finds nothing to report between an evaluation and itself', () => {
    const result = compare(evaluation(), evaluation());
    expect(result).toEqual({
      sameRequest: true,
      decisionChanged: false,
      onlyInA: [],
      onlyInB: [],
      differences: [],
    });
  });
});

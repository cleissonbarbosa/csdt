import { describe, expect, it } from 'vitest';

import * as fixtures from '@/test/fixtures';

import { closestPermits, describeStanding, groupStandings } from './standings';

const explanation = fixtures.explanation();

describe('a request taken policy by policy', () => {
  it('sorts the policies by how each stands to the request', () => {
    const groups = groupStandings(explanation.policies);
    // Bob, a support agent, refunding an order above the limit.
    expect(groups.holding).toEqual([]);
    expect(groups.near.map((policy) => policy.policyId)).toEqual([
      'support-refund-limit',
      'forbid-cross-tenant',
      'forbid-suspended',
    ]);
    expect(groups.outside).toHaveLength(explanation.policies.length - 3);
    // Every policy is in exactly one group.
    expect(groups.holding.length + groups.near.length + groups.outside.length).toBe(
      explanation.policies.length,
    );
  });

  it('names the permits a denial by default came closest to', () => {
    expect(explanation.decision).toBe('deny');
    expect(explanation.determiningPolicies).toEqual([]);
    expect(closestPermits(explanation.policies)).toEqual(['support-refund-limit']);
  });

  it('says of each policy only what Cedar found', () => {
    const permit = { policyId: 'p', effect: 'permit', inScope: true, holds: true } as const;
    const forbid = { policyId: 'f', effect: 'forbid', inScope: true, holds: true } as const;
    expect(describeStanding(permit, 'allow')).toMatch(/permits the request/);
    expect(describeStanding(permit, 'deny')).toMatch(/a forbid overrides it/);
    expect(describeStanding(forbid, 'deny')).toMatch(/forbids the request/);
    expect(describeStanding({ ...permit, holds: false }, 'deny')).toMatch(/does not permit/);
    expect(describeStanding({ ...forbid, holds: false }, 'allow')).toMatch(/does not forbid/);
    expect(describeStanding({ ...permit, inScope: false, holds: false }, 'deny')).toMatch(
      /Not about this request/,
    );
  });
});

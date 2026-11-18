import type { AuthorizationExplanation, PolicyStanding } from '@aegis/contracts';

import { t } from '@/i18n';

/** The policies in force, by how each stands to a request. */
export interface Standings {
  /** Hold for the request: these are what Cedar decided by, or would have. */
  holding: PolicyStanding[];
  /** About the request (their scope takes it in), with a condition that does not hold. */
  near: PolicyStanding[];
  /** Not about the request at all: who asks, what, or on which thing differs. */
  outside: PolicyStanding[];
}

const permitsFirst = (a: PolicyStanding, b: PolicyStanding) =>
  Number(a.effect === 'forbid') - Number(b.effect === 'forbid');

export function groupStandings(policies: readonly PolicyStanding[]): Standings {
  const holding = policies.filter((policy) => policy.holds).sort(permitsFirst);
  const near = policies.filter((policy) => policy.inScope && !policy.holds).sort(permitsFirst);
  const outside = policies.filter((policy) => !policy.inScope).sort(permitsFirst);
  return { holding, near, outside };
}

/**
 * What a standing says of its policy, in a sentence. The words follow what
 * Cedar found and add nothing: a condition that does not hold is not said
 * to fail for any particular reason, because Cedar gives none.
 */
export function describeStanding(
  standing: PolicyStanding,
  decision: AuthorizationExplanation['decision'],
): string {
  const forbid = standing.effect === 'forbid';
  if (standing.holds) {
    if (forbid) return t('Holds: it forbids the request.');
    return decision === 'allow'
      ? t('Holds: it permits the request.')
      : t('Holds, and would permit the request, but a forbid overrides it.');
  }
  if (standing.inScope) {
    return forbid
      ? t('About this request, but its condition does not hold: it does not forbid.')
      : t('About this request, but its condition does not hold: it does not permit.');
  }
  return t('Not about this request: who asks, what for, or on which thing is outside its scope.');
}

/**
 * Why a request that no policy permits was denied, as far as Cedar can be
 * made to say: the permits that were about it and did not hold.
 */
export function closestPermits(policies: readonly PolicyStanding[]): string[] {
  return policies
    .filter((policy) => policy.effect === 'permit' && policy.inScope && !policy.holds)
    .map((policy) => policy.policyId);
}

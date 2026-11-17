import type { AuthorizationCatalog, AuthorizationDecision, PolicyStanding } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { queryKeys } from '@/app/queryClient';
import { cn } from '@/lib/cn';
import { closestPermits, describeStanding, groupStandings } from '@/lib/standings';
import { api } from '@/providers/api';

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function Standing({
  standing,
  decision,
  source,
}: {
  standing: PolicyStanding;
  decision: 'allow' | 'deny';
  source: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const state = standing.holds ? 'holds' : standing.inScope ? 'near' : 'outside';
  return (
    <li data-testid={`standing-${standing.policyId}`} data-standing={state}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-control px-1 py-0.5 text-left hover:bg-raised"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Show the policy"
      >
        <span
          className={cn(
            'inline-flex h-[18px] w-12 shrink-0 items-center justify-center rounded-control border border-ink text-[10px]',
            standing.effect === 'forbid' ? 'bg-ink text-on-accent' : 'text-ink',
          )}
        >
          {standing.effect === 'forbid' ? 'Forbid' : 'Permit'}
        </span>
        <span className="numeric min-w-0 flex-1 truncate text-[11px] text-ink">
          {standing.policyId}
        </span>
      </button>
      {open && (
        <div className="mb-1 ml-1 mt-0.5">
          <p className="text-[11px] leading-relaxed text-ink-dim">
            {describeStanding(standing, decision)}
          </p>
          {source !== undefined && (
            <pre className="code mt-1 overflow-x-auto whitespace-pre-wrap rounded-control bg-sunken p-2 text-[11px] leading-relaxed text-ink-dim">
              {source}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

function Group({
  title,
  standings,
  decision,
  catalog,
}: {
  title: string;
  standings: PolicyStanding[];
  decision: 'allow' | 'deny';
  catalog: AuthorizationCatalog;
}) {
  if (standings.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-ink-faint">{title}</p>
      <ul className="-mx-1">
        {standings.map((standing) => (
          <Standing
            key={standing.policyId}
            standing={standing}
            decision={decision}
            source={catalog.policies.find((policy) => policy.id === standing.policyId)?.content}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * The decision taken policy by policy. Cedar names the policies that
 * decided, and for a denial by default it names none: a permit that was
 * about the request and did not hold leaves no trace in its answer. Here
 * each policy in force is put to the same request by itself, so the one
 * that came closest can be seen, and read.
 *
 * It is a second question to the engine, not a reading of the first: where
 * the two do not agree (the policies were replaced in between) it says so
 * and shows nothing.
 */
export function PolicyByPolicy({
  decision,
  catalog,
}: {
  decision: AuthorizationDecision;
  catalog: AuthorizationCatalog;
}) {
  const question = useMemo(
    () => ({
      principal: decision.request.principal,
      action: decision.request.action,
      resource: decision.request.resource,
      context: decision.request.context,
      disabledPolicies: decision.disabledPolicies,
    }),
    [decision],
  );
  const { data, isError } = useQuery({
    queryKey: queryKeys.explanation(question),
    queryFn: () => api.explain(question),
  });
  if (isError) {
    return (
      <p className="mt-3 text-[11px] text-ink-faint" data-testid="policy-standings-unavailable">
        The policies could not be taken one by one.
      </p>
    );
  }
  if (!data) return null;
  const agrees =
    data.decision === decision.decision &&
    same(data.determiningPolicies, decision.determiningPolicies);
  if (!agrees) {
    return (
      <p className="mt-3 text-[11px] text-ink-faint" data-testid="policy-standings-moved">
        The policies in force are no longer the ones this was decided under: evaluate again to see
        how each stands.
      </p>
    );
  }
  const groups = groupStandings(data.policies);
  const byDefault = data.decision === 'deny' && data.determiningPolicies.length === 0;
  const closest = closestPermits(data.policies);
  return (
    <div className="mt-3" data-testid="policy-standings">
      <p className="caption mb-1">Policy by policy</p>
      {byDefault && (
        <p className="text-xs leading-relaxed text-ink-dim" data-testid="policy-closest">
          {closest.length === 0 ? (
            'No permit is about this request at all.'
          ) : (
            <>
              Closest: <span className="code text-ink">{closest.join(', ')}</span>{' '}
              {closest.length === 1 ? 'is' : 'are'} about this request, but{' '}
              {closest.length === 1 ? 'its condition does' : 'their conditions do'} not hold.
            </>
          )}
        </p>
      )}
      <Group
        title="Hold for this request"
        standings={groups.holding}
        decision={data.decision}
        catalog={catalog}
      />
      <Group
        title="About it, with a condition that does not hold"
        standings={groups.near}
        decision={data.decision}
        catalog={catalog}
      />
      {groups.outside.length > 0 && (
        <details className="mt-1.5">
          <summary className="text-[11px] text-ink-faint hover:text-ink">
            {groups.outside.length} not about this request
          </summary>
          <Group title="" standings={groups.outside} decision={data.decision} catalog={catalog} />
        </details>
      )}
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        Each policy in force, put to this request by itself by the embedded Cedar engine.
      </p>
    </div>
  );
}

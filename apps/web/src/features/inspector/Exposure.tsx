/**
 * What a service is exposed to and exposes, on its card.
 *
 * The card says what a service calls and what calls it. This follows those
 * connections all the way: everything a service that was taken over could
 * open a connection toward, the shortest way to it from outside, and, where
 * requests for a kind of data end at it, how Cedar answers those requests.
 * The first two are read from the topology and the third is counted from
 * the engine's own answers. None of it says an attack would succeed.
 */
import type { Topology } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { queryKeys } from '@/app/queryClient';
import { Button } from '@/components/ui/Button';
import { Fold } from '@/components/ui/Section';
import { ServiceName } from '@/components/ui/ServiceName';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { exposureOf, guardedBy, resourceTypesAt } from '@/lib/exposure';
import { api } from '@/providers/api';
import { useUi } from '@/stores/ui';

/** How many services are named before the rest is counted. */
const SHOWN = 6;
/** The matrix under every policy and nothing in the context. */
const AS_IT_IS = { context: {}, disabledPolicies: [] as string[] };

/** What a service's connections lead to, and how many of those hold data. */
function reachSentence(reaches: number, stores: number): string {
  const values = { n: reaches, stores };
  if (stores === 0) {
    return t(reaches === 1 ? 'It reaches {n} service.' : 'It reaches {n} services.', values);
  }
  if (stores === 1) {
    return t(
      reaches === 1
        ? 'It reaches {n} service, {stores} of them a store of data.'
        : 'It reaches {n} services, {stores} of them a store of data.',
      values,
    );
  }
  return t('It reaches {n} services, {stores} of them stores of data.', values);
}

/** How many services lead to this one, and whether any of the ways starts outside. */
function reachedBySentence(count: number, fromOutside: boolean): string {
  if (fromOutside) {
    return t(count === 1 ? '{n} service leads to it.' : '{n} services lead to it.', { n: count });
  }
  return t(
    count === 1
      ? '{n} service leads to it, none of them from outside the platform.'
      : '{n} services lead to it, none of them from outside the platform.',
    { n: count },
  );
}

function Names({ topology, ids }: { topology: Topology; ids: string[] }) {
  const [all, setAll] = useState(false);
  const listed = all ? ids : ids.slice(0, SHOWN);
  return (
    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
      {listed.map((id, i) => (
        <span key={id}>
          {i > 0 && '; '}
          <button
            type="button"
            className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            onClick={() => useUi.getState().selectNode(id)}
          >
            <ServiceName topology={topology} id={id} />
          </button>
        </span>
      ))}
      {ids.length > SHOWN && (
        <>
          {' '}
          <button
            type="button"
            className="text-ink-dim underline decoration-line-strong underline-offset-2 hover:text-ink"
            onClick={() => setAll(!all)}
          >
            {all ? t('fewer') : t('and {n} more', { n: ids.length - SHOWN })}
          </button>
        </>
      )}
    </p>
  );
}

function Guarded({ topology, nodeId }: { topology: Topology; nodeId: string }) {
  const types = useMemo(() => resourceTypesAt(topology, nodeId), [topology, nodeId]);
  const { data: catalog } = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.authorizationCatalog,
    enabled: types.length > 0,
  });
  const { data: matrix } = useQuery({
    queryKey: queryKeys.matrix(AS_IT_IS),
    queryFn: () => api.accessMatrix(AS_IT_IS),
    enabled: types.length > 0,
  });
  if (types.length === 0 || !catalog || !matrix) return null;
  const guarded = types
    .map((type) => guardedBy(matrix, catalog, type))
    .filter((entry) => entry.asked > 0);
  if (guarded.length === 0) return null;
  return (
    <div className="mt-2.5" data-testid="exposure-guarded">
      <p className="text-xs text-ink">{t('What Cedar guards here')}</p>
      {guarded.map((entry) => (
        <p key={entry.resourceType} className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
          {tr(
            'Requests for a <code>{type}</code> end at this service. Of the {asked} the catalogue describes, Cedar allows {allowed}, to {principals} of {total} principals.',
            {
              code: (children) => <span className="code text-ink">{children}</span>,
              type: entry.resourceType,
              asked: entry.asked,
              allowed: entry.allowed,
              principals: entry.principals,
              total: entry.ofPrincipals,
            },
          )}
        </p>
      ))}
      <Button
        size="sm"
        className="mt-1.5"
        onClick={() => useUi.getState().setPanel('matrix')}
        data-testid="exposure-matrix"
      >
        {t('Who may do what')}
      </Button>
      <p className="caption mt-1">{t('Under every policy in force and an empty context.')}</p>
    </div>
  );
}

export function Exposure({ topology, nodeId }: { topology: Topology; nodeId: string }) {
  const exposure = useMemo(() => exposureOf(topology, nodeId), [topology, nodeId]);
  const [shown, setShown] = useState(false);
  // What is kept in front belongs to this card, and goes with it.
  useEffect(() => {
    setShown(false);
    return () => useUi.getState().setReach(null);
  }, [topology, nodeId]);
  const show = (on: boolean) => {
    setShown(on);
    useUi.getState().setReach(on ? [nodeId, ...exposure.reaches] : null);
  };
  const { reaches, stores, reachedBy, wayIn } = exposure;
  return (
    <Fold title={t('Exposure')} testId="node-exposure">
      <p className="caption mb-2">
        {t(
          'Were this service taken over: what its connections lead to, and how it is reached. Read from the topology; nothing is simulated.',
        )}
      </p>

      <div data-testid="exposure-reaches" data-count={reaches.length}>
        <p className="text-xs text-ink">
          {reaches.length === 0
            ? t('It opens no connection: nothing is reached from it.')
            : reachSentence(reaches.length, stores.length)}
        </p>
        {stores.length > 0 && <Names topology={topology} ids={stores} />}
        {reaches.length > 0 && (
          <Button
            size="sm"
            variant={shown ? 'primary' : 'outline'}
            aria-pressed={shown}
            className="mt-1.5"
            onClick={() => show(!shown)}
            data-testid="exposure-show"
          >
            {shown ? t('Kept in front on the model') : t('Keep them in front on the model')}
          </Button>
        )}
      </div>

      <div className="mt-2.5" data-testid="exposure-way-in">
        <p className="text-xs text-ink">
          {reachedBy.length === 0
            ? t('No connection leads to it.')
            : reachedBySentence(reachedBy.length, wayIn !== null)}
        </p>
        {wayIn && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
            {t(
              wayIn.length === 2
                ? 'The shortest way in from outside, {n} connection:'
                : 'The shortest way in from outside, {n} connections:',
              { n: wayIn.length - 1 },
            )}{' '}
            {wayIn.map((id, i) => (
              <span key={id}>
                {i > 0 && <ArrowRight size={10} aria-label={t('then')} className="mx-1 inline" />}
                <span className="text-ink">
                  <ServiceName topology={topology} id={id} />
                </span>
              </span>
            ))}
          </p>
        )}
      </div>

      <Guarded topology={topology} nodeId={nodeId} />
    </Fold>
  );
}

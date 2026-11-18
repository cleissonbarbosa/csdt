/**
 * What Cedar would decide differently under a set of files.
 *
 * The same comparison `aegis-server diff-workspace` prints, asked of the
 * server for the files staged in the dialog against the ones in use. Both
 * sides are built the way start-up builds them and every decision on either
 * is Cedar's; this only lays the differences out. Nothing is applied.
 */
import type { WorkspaceDiff, WorkspaceFile } from '@aegis/contracts';
import { useEffect, useState, type ReactNode } from 'react';

import { DecisionTag } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { entityId, formatPercent } from '@/lib/format';
import { api, ApiError } from '@/providers/api';

type Diff = WorkspaceDiff['diff'];

const SHOWN = 12;

const numeric = (children: ReactNode) => <span className="numeric text-ink">{children}</span>;
const code = (children: ReactNode) => <span className="code">{children}</span>;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2.5">
      <p className="text-[11px] font-bold text-ink">{title}</p>
      <div className="mt-1 text-[11px] leading-relaxed text-ink-dim">{children}</div>
    </div>
  );
}

function Arrow({ from, to }: { from: 'allow' | 'deny'; to: 'allow' | 'deny' }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <DecisionTag decision={from} />
      <span aria-hidden>→</span>
      <span className="sr-only">{t('becomes')}</span>
      <DecisionTag decision={to} />
    </span>
  );
}

function ids(list: string[]): ReactNode {
  return <span className="code break-words">{list.join(', ')}</span>;
}

function context(value: Record<string, unknown>): string {
  const entries = Object.entries(value);
  return entries.length === 0
    ? t('an empty context')
    : entries.map(([key, entry]) => `${key} = ${JSON.stringify(entry)}`).join(', ');
}

/** A catalogued request Cedar decides differently, and what decided it before. */
function Decided({ id, scenario, by }: { id: string; scenario: boolean; by: string[] }) {
  const parts = {
    c: (children: ReactNode) => <span className="code text-ink">{children}</span>,
    id,
    policies: ids(by),
  };
  if (by.length > 0) {
    return (
      <>
        {tr(
          scenario
            ? '<c>{id}</c> (a scenario request); was decided by {policies}'
            : '<c>{id}</c>; was decided by {policies}',
          parts,
        )}
      </>
    );
  }
  return <>{scenario ? tr('<c>{id}</c> (a scenario request)', parts) : parts.c(id)}</>;
}

type MatrixEntry = Diff['matrix']['changes'][number];

/** One request of the matrix whose decision changes: where, and what decides it on each side. */
function MatrixChange({ change }: { change: MatrixEntry }) {
  const parts = {
    e: (children: ReactNode) => <span className="text-ink">{children}</span>,
    principal: entityId(change.principal),
    action: entityId(change.action),
    resource: entityId(change.resource),
    where: change.everyContext
      ? t('in every context')
      : t('under {contexts}', { contexts: change.contexts.map(context).join('; ') }),
    now: ids(change.basePolicies),
    then: ids(change.candidatePolicies),
  };
  const now = change.basePolicies.length > 0;
  const then = change.candidatePolicies.length > 0;
  return (
    <>
      {tr(
        now && then
          ? '<e>{principal} → {action} on {resource}</e>, {where}; now decided by {now}; would be decided by {then}'
          : now
            ? '<e>{principal} → {action} on {resource}</e>, {where}; now decided by {now}'
            : then
              ? '<e>{principal} → {action} on {resource}</e>, {where}; would be decided by {then}'
              : '<e>{principal} → {action} on {resource}</e>, {where}',
        parts,
      )}
    </>
  );
}

function Details({ diff }: { diff: Diff }) {
  const { policies, matrix, requests } = diff;
  const decided = requests.changes.filter((change) => change.kind === 'decision');
  const policiesChanged =
    policies.added.length + policies.removed.length + policies.changed.length > 0;
  const atRest = Math.abs(diff.deniedAtRest.base - diff.deniedAtRest.candidate) > 1e-12;
  return (
    <>
      {policiesChanged && (
        <Block title={t('Policies')}>
          <ul className="space-y-0.5" data-testid="diff-policies">
            {policies.added.length > 0 && (
              <li>{tr('Added: {policies}', { policies: ids(policies.added) })}</li>
            )}
            {policies.removed.length > 0 && (
              <li>{tr('Removed: {policies}', { policies: ids(policies.removed) })}</li>
            )}
            {policies.changed.length > 0 && (
              <li>{tr('Changed in meaning: {policies}', { policies: ids(policies.changed) })}</li>
            )}
          </ul>
        </Block>
      )}
      {(diff.entitiesChanged || diff.catalogChanged) && (
        <Block title={t('What they are evaluated over')}>
          {diff.entitiesChanged && <p>{t('The entity store is another one.')}</p>}
          {diff.catalogChanged && (
            <p>{t('The catalogue of principals, actions and requests changed.')}</p>
          )}
        </Block>
      )}
      {atRest && (
        <Block title={t('Ordinary traffic')}>
          <p data-testid="diff-at-rest">
            {tr(
              'Cedar denies <n>{candidate}</n> of ordinary authorization requests, where it now denies <n>{base}</n>.',
              {
                n: numeric,
                candidate: formatPercent(diff.deniedAtRest.candidate),
                base: formatPercent(diff.deniedAtRest.base),
              },
            )}
          </p>
        </Block>
      )}
      {decided.length > 0 && (
        <Block
          title={t('Catalogued requests decided differently: {n} of {total}', {
            n: decided.length,
            total: requests.compared,
          })}
        >
          <ul className="space-y-1" data-testid="diff-requests">
            {decided.slice(0, SHOWN).map((change) => (
              <li key={`${change.list}:${change.id}`} className="flex items-baseline gap-2">
                {change.base && change.candidate && (
                  <Arrow from={change.base.decision} to={change.candidate.decision} />
                )}
                <span className="min-w-0">
                  <Decided
                    id={change.id}
                    scenario={change.list === 'scenario-requests'}
                    by={change.base?.determiningPolicies ?? []}
                  />
                </span>
              </li>
            ))}
            {decided.length > SHOWN && (
              <li className="text-ink-faint">{t('and {n} more', { n: decided.length - SHOWN })}</li>
            )}
          </ul>
        </Block>
      )}
      {diff.flows.length > 0 && (
        <Block title={t('Scenario traffic')}>
          <ul className="space-y-0.5" data-testid="diff-flows">
            {diff.flows.slice(0, SHOWN).map((flow) => (
              <li key={`${flow.topology}:${flow.scenario}:${flow.flow}`}>
                {tr(
                  flow.candidate === 'denied'
                    ? 'In <c>{scenario}</c> on <c>{topology}</c>, “{flow}” would stop at the authorizer; it now reaches its resource.'
                    : 'In <c>{scenario}</c> on <c>{topology}</c>, “{flow}” would reach its resource; it now stops at the authorizer.',
                  { c: code, scenario: flow.scenario, topology: flow.topology, flow: flow.label },
                )}
              </li>
            ))}
            {diff.flows.length > SHOWN && (
              <li className="text-ink-faint">
                {t('and {n} more', { n: diff.flows.length - SHOWN })}
              </li>
            )}
          </ul>
        </Block>
      )}
      {diff.availability.length > 0 && (
        <Block title={t('Scenarios that can run')}>
          <ul className="space-y-0.5">
            {diff.availability.map((entry) => (
              <li key={`${entry.topology}:${entry.scenario}`}>
                {entry.candidate === null
                  ? tr('<c>{scenario}</c> on <c>{topology}</c> could run, which it cannot now.', {
                      c: code,
                      scenario: entry.scenario,
                      topology: entry.topology,
                    })
                  : tr('<c>{scenario}</c> on <c>{topology}</c> could no longer run: {reason}.', {
                      c: code,
                      scenario: entry.scenario,
                      topology: entry.topology,
                      // Why, as the server's check wrote it.
                      reason: entry.candidate,
                    })}
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Block title={t('Every request the tracer can build')}>
        <p data-testid="diff-matrix">
          {matrix.note ??
            tr(
              matrix.attributionOnly > 0
                ? 'Of <n>{compared}</n> requests ({principals} principals, {actions} actions, {resources} resources, {contexts} contexts), <n>{allowToDeny}</n> go from allow to deny and <n>{denyToAllow}</n> from deny to allow; {attribution} keep their decision but are decided by other policies.'
                : 'Of <n>{compared}</n> requests ({principals} principals, {actions} actions, {resources} resources, {contexts} contexts), <n>{allowToDeny}</n> go from allow to deny and <n>{denyToAllow}</n> from deny to allow.',
              {
                n: numeric,
                compared: matrix.compared,
                principals: matrix.principals,
                actions: matrix.actions,
                resources: matrix.resources,
                contexts: matrix.contexts,
                allowToDeny: matrix.allowToDeny,
                denyToAllow: matrix.denyToAllow,
                attribution: matrix.attributionOnly,
              },
            )}
        </p>
        {matrix.changes.length > 0 && (
          <ul className="mt-1.5 space-y-1.5" data-testid="diff-matrix-changes">
            {matrix.changes.slice(0, SHOWN).map((change) => (
              <li
                key={`${change.principal}:${change.action}:${change.resource}:${change.candidate}`}
                className="flex items-baseline gap-2"
              >
                <Arrow from={change.base} to={change.candidate} />
                <span className="min-w-0">
                  <MatrixChange change={change} />
                </span>
              </li>
            ))}
            {matrix.changes.length > SHOWN && (
              <li className="text-ink-faint">
                {t('and {n} more', { n: matrix.changes.length - SHOWN })}
              </li>
            )}
          </ul>
        )}
      </Block>
    </>
  );
}

/** The comparison for the staged files; asked for, since it evaluates a great deal. */
export function PolicyDiff({ files }: { files: WorkspaceFile[] }) {
  const [state, setState] = useState<
    { files: WorkspaceFile[]; result: WorkspaceDiff | string } | 'busy' | null
  >(null);
  // An answer belongs to the files it was asked about.
  useEffect(() => setState(null), [files]);
  const run = () => {
    setState('busy');
    api.diffWorkspace(files).then(
      (result) => setState({ files, result }),
      (error: unknown) =>
        setState({
          files,
          result: error instanceof ApiError ? error.message : t('The files could not be compared.'),
        }),
    );
  };
  const answer = state !== null && state !== 'busy' && state.files === files ? state.result : null;
  return (
    <div className="mt-3 rounded-control border border-line px-2.5 py-2" data-testid="policy-diff">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] leading-relaxed text-ink-dim">
          <span className="font-bold text-ink">{t('What would Cedar decide differently?')}</span>{' '}
          {t('The policies in use and these are both asked every request; nothing is applied.')}
        </p>
        <Button size="sm" disabled={state === 'busy'} onClick={run} data-testid="policy-diff-run">
          {state === 'busy'
            ? t('Comparing…')
            : answer
              ? t('Compare again')
              : t('Compare with what is in use')}
        </Button>
      </div>
      {typeof answer === 'string' && (
        <p role="alert" className="mt-2 text-[11px] text-critical">
          {answer}
        </p>
      )}
      {answer !== null && typeof answer !== 'string' && (
        <div role="status" data-testid="policy-diff-result" data-changed={answer.decisionsChanged}>
          <p className="mt-2 text-xs text-ink">
            {answer.decisionsChanged
              ? t('Cedar would decide some requests differently.')
              : t('Cedar would decide every request it is asked here the same as now.')}
          </p>
          <Details diff={answer.diff} />
        </div>
      )}
    </div>
  );
}

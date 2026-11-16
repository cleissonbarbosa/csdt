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
import { entityId, formatPercent } from '@/lib/format';
import { api, ApiError } from '@/providers/api';

type Diff = WorkspaceDiff['diff'];

const SHOWN = 12;

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
      <span className="sr-only">becomes</span>
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
    ? 'an empty context'
    : entries.map(([key, entry]) => `${key} = ${JSON.stringify(entry)}`).join(', ');
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
        <Block title="Policies">
          <ul className="space-y-0.5" data-testid="diff-policies">
            {policies.added.length > 0 && <li>Added: {ids(policies.added)}</li>}
            {policies.removed.length > 0 && <li>Removed: {ids(policies.removed)}</li>}
            {policies.changed.length > 0 && <li>Changed in meaning: {ids(policies.changed)}</li>}
          </ul>
        </Block>
      )}
      {(diff.entitiesChanged || diff.catalogChanged) && (
        <Block title="What they are evaluated over">
          {diff.entitiesChanged && <p>The entity store is another one.</p>}
          {diff.catalogChanged && <p>The catalogue of principals, actions and requests changed.</p>}
        </Block>
      )}
      {atRest && (
        <Block title="Ordinary traffic">
          <p data-testid="diff-at-rest">
            Cedar denies{' '}
            <span className="numeric text-ink">{formatPercent(diff.deniedAtRest.candidate)}</span>{' '}
            of ordinary authorization requests, where it now denies{' '}
            <span className="numeric text-ink">{formatPercent(diff.deniedAtRest.base)}</span>.
          </p>
        </Block>
      )}
      {decided.length > 0 && (
        <Block
          title={`Catalogued requests decided differently: ${decided.length} of ${requests.compared}`}
        >
          <ul className="space-y-1" data-testid="diff-requests">
            {decided.slice(0, SHOWN).map((change) => (
              <li key={`${change.list}:${change.id}`} className="flex items-baseline gap-2">
                {change.base && change.candidate && (
                  <Arrow from={change.base.decision} to={change.candidate.decision} />
                )}
                <span className="min-w-0">
                  <span className="code text-ink">{change.id}</span>
                  {change.list === 'scenario-requests' && ' (a scenario request)'}
                  {change.base && change.base.determiningPolicies.length > 0 && (
                    <>; was decided by {ids(change.base.determiningPolicies)}</>
                  )}
                </span>
              </li>
            ))}
            {decided.length > SHOWN && (
              <li className="text-ink-faint">and {decided.length - SHOWN} more</li>
            )}
          </ul>
        </Block>
      )}
      {diff.flows.length > 0 && (
        <Block title="Scenario traffic">
          <ul className="space-y-0.5" data-testid="diff-flows">
            {diff.flows.slice(0, SHOWN).map((flow) => (
              <li key={`${flow.topology}:${flow.scenario}:${flow.flow}`}>
                In <span className="code">{flow.scenario}</span> on{' '}
                <span className="code">{flow.topology}</span>, “{flow.label}”{' '}
                {flow.candidate === 'denied'
                  ? 'would stop at the authorizer; it now reaches its resource'
                  : 'would reach its resource; it now stops at the authorizer'}
                .
              </li>
            ))}
            {diff.flows.length > SHOWN && (
              <li className="text-ink-faint">and {diff.flows.length - SHOWN} more</li>
            )}
          </ul>
        </Block>
      )}
      {diff.availability.length > 0 && (
        <Block title="Scenarios that can run">
          <ul className="space-y-0.5">
            {diff.availability.map((entry) => (
              <li key={`${entry.topology}:${entry.scenario}`}>
                <span className="code">{entry.scenario}</span> on{' '}
                <span className="code">{entry.topology}</span>{' '}
                {entry.candidate === null
                  ? 'could run, which it cannot now'
                  : `could no longer run: ${entry.candidate}`}
                .
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Block title="Every request the tracer can build">
        <p data-testid="diff-matrix">
          {matrix.note ?? (
            <>
              Of <span className="numeric text-ink">{matrix.compared}</span> requests (
              {matrix.principals} principals, {matrix.actions} actions, {matrix.resources}{' '}
              resources, {matrix.contexts} contexts),{' '}
              <span className="numeric text-ink">{matrix.allowToDeny}</span> go from allow to deny
              and <span className="numeric text-ink">{matrix.denyToAllow}</span> from deny to allow
              {matrix.attributionOnly > 0 &&
                `; ${matrix.attributionOnly} keep their decision but are decided by other policies`}
              .
            </>
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
                  <span className="text-ink">
                    {entityId(change.principal)} → {entityId(change.action)} on{' '}
                    {entityId(change.resource)}
                  </span>
                  ,{' '}
                  {change.everyContext
                    ? 'in every context'
                    : `under ${change.contexts.map(context).join('; ')}`}
                  {change.basePolicies.length > 0 && (
                    <>; now decided by {ids(change.basePolicies)}</>
                  )}
                  {change.candidatePolicies.length > 0 && (
                    <>; would be decided by {ids(change.candidatePolicies)}</>
                  )}
                </span>
              </li>
            ))}
            {matrix.changes.length > SHOWN && (
              <li className="text-ink-faint">and {matrix.changes.length - SHOWN} more</li>
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
          result: error instanceof ApiError ? error.message : 'The files could not be compared.',
        }),
    );
  };
  const answer = state !== null && state !== 'busy' && state.files === files ? state.result : null;
  return (
    <div className="mt-3 rounded-control border border-line px-2.5 py-2" data-testid="policy-diff">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] leading-relaxed text-ink-dim">
          <span className="font-bold text-ink">What would Cedar decide differently?</span> The
          policies in use and these are both asked every request; nothing is applied.
        </p>
        <Button size="sm" disabled={state === 'busy'} onClick={run} data-testid="policy-diff-run">
          {state === 'busy'
            ? 'Comparing…'
            : answer
              ? 'Compare again'
              : 'Compare with what is in use'}
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
              ? 'Cedar would decide some requests differently.'
              : 'Cedar would decide every request it is asked here the same as now.'}
          </p>
          <Details diff={answer.diff} />
        </div>
      )}
    </div>
  );
}

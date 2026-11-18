import type { AccessCell, AuthorizationCatalog } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { Check, KeyRound, PencilLine, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { queryKeys } from '@/app/queryClient';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented, Switch } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/Section';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { describeAccess, tabulate, type ActionAccess } from '@/lib/accessMatrix';
import { cn } from '@/lib/cn';
import { api } from '@/providers/api';
import { useUi } from '@/stores/ui';

type Tri = 'absent' | 'true' | 'false';
const TRI: { value: Tri; label: string }[] = [
  { value: 'absent', label: t('Absent') },
  { value: 'true', label: t('True') },
  { value: 'false', label: t('False') },
];

interface Picked {
  principal: string;
  action: string;
}

function contextOf(settings: Record<string, Tri>): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(settings)
      .filter(([, value]) => value !== 'absent')
      .map(([key, value]) => [key, value === 'true']),
  );
}

/** One request of the picked cell: Cedar's answer, and the way to follow it. */
function Answer({
  cell,
  catalog,
  context,
  disabled,
  changed,
}: {
  cell: AccessCell;
  catalog: AuthorizationCatalog;
  context: Record<string, boolean>;
  disabled: string[];
  changed: boolean;
}) {
  const allowed = cell.decision === 'allow';
  const resource = catalog.resources.find((entry) => entry.uid === cell.resource);
  return (
    <li
      className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-x-2 border-b border-line py-1.5 last:border-b-0"
      data-testid="matrix-answer"
      data-decision={cell.decision}
    >
      {/* Told by its mark and its word. A denial here is not an alarm: it is
          one of a hundred answers, and takes no colour. */}
      <span className="inline-flex items-center gap-1 text-xs font-bold text-ink">
        {allowed ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
        {allowed ? t('Allow') : t('Deny')}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-ink">{resource?.label ?? cell.resource}</span>
        <span className="block text-[11px] leading-snug text-ink-faint">
          {cell.determiningPolicies.length > 0
            ? tr(
                changed
                  ? 'decided by {ids}; differs from all policies in force'
                  : 'decided by {ids}',
                { ids: <span className="code">{cell.determiningPolicies.join(', ')}</span> },
              )
            : t(
                changed
                  ? 'no policy permits it; differs from all policies in force'
                  : 'no policy permits it',
              )}
        </span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        icon={<KeyRound size={12} aria-hidden />}
        onClick={() =>
          useUi.getState().presetAuthorization({
            principal: cell.principal,
            action: cell.action,
            resource: cell.resource,
            context,
            disabledPolicies: disabled,
          })
        }
        data-testid="matrix-trace"
      >
        {t('Trace it')}
      </Button>
    </li>
  );
}

function Matrix({ catalog }: { catalog: AuthorizationCatalog }) {
  const [settings, setSettings] = useState<Record<string, Tri>>({});
  const [off, setOff] = useState<string[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);

  // A policy that is no longer loaded cannot stay switched off.
  const disabled = useMemo(
    () => off.filter((id) => catalog.policies.some((policy) => policy.id === id)),
    [off, catalog.policies],
  );
  const context = useMemo(() => contextOf(settings), [settings]);
  const question = useMemo(() => ({ context, disabledPolicies: disabled }), [context, disabled]);
  const { data: matrix, isError } = useQuery({
    queryKey: queryKeys.matrix(question),
    queryFn: () => api.accessMatrix(question),
  });
  // With policies switched off, the same requests under all of them: what
  // the switch changed is counted against it, never guessed.
  const everything = useMemo(() => ({ context, disabledPolicies: [] as string[] }), [context]);
  const { data: all } = useQuery({
    queryKey: queryKeys.matrix(everything),
    queryFn: () => api.accessMatrix(everything),
    enabled: disabled.length > 0,
  });
  const against = disabled.length > 0 ? (all ?? null) : null;
  const table = useMemo(
    () => (matrix ? tabulate(matrix, catalog, against) : null),
    [matrix, catalog, against],
  );
  const before = useMemo(() => (against ? tabulate(against, catalog) : null), [against, catalog]);

  if (isError) {
    return (
      <EmptyState title={t('The matrix could not be worked out')}>
        {t('Cedar was not asked. Try again in a moment.')}
      </EmptyState>
    );
  }
  const labelOf = {
    principal: (uid: string) => catalog.principals.find((p) => p.uid === uid)?.label ?? uid,
    action: (uid: string) => catalog.actions.find((a) => a.uid === uid)?.label ?? uid,
  };
  const pickedAccess: ActionAccess | undefined =
    picked && table
      ? table.rows
          .find((row) => row.principal === picked.principal)
          ?.actions.find((entry) => entry.action === picked.action)
      : undefined;
  const wasDecision = (cell: AccessCell) =>
    against?.cells.find(
      (other) =>
        other.principal === cell.principal &&
        other.action === cell.action &&
        other.resource === cell.resource,
    )?.decision;

  return (
    <div data-testid="access-matrix">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {catalog.contextKeys.map((key) => (
          <div key={key.key}>
            <p className="caption mb-1" title={key.description}>
              {key.label} <span className="code">context.{key.key}</span>
            </p>
            <Segmented<Tri>
              label={key.label}
              size="sm"
              value={settings[key.key] ?? 'absent'}
              options={TRI}
              onChange={(value) => setSettings((current) => ({ ...current, [key.key]: value }))}
              testId={`matrix-context-${key.key}`}
            />
          </div>
        ))}
        <Button
          size="sm"
          icon={<PencilLine size={12} aria-hidden />}
          onClick={() => useUi.getState().setPanel('policies')}
          data-testid="matrix-edit-policies"
        >
          {t('Edit the policies')}
        </Button>
      </div>

      <details className="mt-3" data-testid="matrix-policies">
        <summary className="text-xs text-ink-dim hover:text-ink">
          {t('Policies in force: {on} of {total}', {
            on: catalog.policies.length - disabled.length,
            total: catalog.policies.length,
          })}
        </summary>
        <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {catalog.policies.map((policy) => (
            <li key={policy.id}>
              <Switch
                label={policy.id}
                hint={policy.description}
                checked={!disabled.includes(policy.id)}
                onCheckedChange={(on) =>
                  setOff((current) =>
                    on ? current.filter((id) => id !== policy.id) : [...current, policy.id],
                  )
                }
              />
            </li>
          ))}
        </ul>
      </details>

      {matrix?.note && (
        <p className="mt-3 text-xs text-ink-dim" data-testid="matrix-note">
          {t('Not asked: {reason}.', { reason: matrix.note })}
        </p>
      )}

      {table && table.asked > 0 && (
        <>
          <p className="mt-3 text-xs text-ink" role="status" data-testid="matrix-summary">
            {t(
              !against
                ? 'Cedar allows {allowed} of {asked} requests.'
                : table.changed === 0
                  ? 'Cedar allows {allowed} of {asked} requests; none differs from all policies in force.'
                  : table.changed === 1
                    ? 'Cedar allows {allowed} of {asked} requests; {changed} differs from all policies in force.'
                    : 'Cedar allows {allowed} of {asked} requests; {changed} differ from all policies in force.',
              { allowed: table.allowed, asked: table.asked, changed: table.changed },
            )}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="sr-only">
                {t('For each principal and action, on how many resources Cedar allows it')}
              </caption>
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="caption py-1.5 pr-3 font-normal">
                    {t('Principal')}
                  </th>
                  {catalog.actions.map((action) => (
                    <th key={action.uid} scope="col" className="caption px-1 py-1.5 font-normal">
                      {action.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => {
                  const principal = catalog.principals.find((p) => p.uid === row.principal);
                  return (
                    <tr key={row.principal} className="border-b border-line last:border-b-0">
                      <th scope="row" className="max-w-[14rem] py-1.5 pr-3 font-normal">
                        <span className="block truncate text-ink">{principal?.label}</span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {principal?.note}
                        </span>
                      </th>
                      {row.actions.map((entry, a) => {
                        const isPicked =
                          picked?.principal === row.principal && picked.action === entry.action;
                        const was = before?.rows[r]?.actions[a];
                        return (
                          <td key={entry.action} className="px-1 py-1 align-top">
                            <button
                              type="button"
                              disabled={entry.cells.length === 0}
                              aria-pressed={isPicked}
                              aria-label={`${labelOf.principal(row.principal)}, ${labelOf.action(entry.action)}: ${describeAccess(entry)}`}
                              onClick={() =>
                                setPicked(
                                  isPicked
                                    ? null
                                    : { principal: row.principal, action: entry.action },
                                )
                              }
                              className={cn(
                                'w-full rounded-control border px-1.5 py-1 text-left transition-colors hover:border-line-strong',
                                isPicked ? 'border-ink bg-raised' : 'border-transparent',
                                entry.allowed === 0 ? 'text-ink-faint' : 'text-ink',
                                entry.changed > 0 && 'font-bold',
                              )}
                              data-testid={`matrix-cell-${r}-${a}`}
                              data-allowed={entry.allowed}
                              data-changed={entry.changed}
                            >
                              {describeAccess(entry)}
                              {entry.changed > 0 && was && (
                                <span className="block text-[10px] font-normal text-ink-faint">
                                  {t('was {access}', { access: describeAccess(was) })}
                                </span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 min-h-[5.5rem]" aria-live="polite">
            {picked && pickedAccess ? (
              <section data-testid="matrix-detail">
                <h3 className="text-xs font-bold text-ink">
                  {labelOf.principal(picked.principal)}: {labelOf.action(picked.action)}
                </h3>
                <ul className="mt-1">
                  {pickedAccess.cells.map((cell) => {
                    const was = wasDecision(cell);
                    return (
                      <Answer
                        key={cell.resource}
                        cell={cell}
                        catalog={catalog}
                        context={context}
                        disabled={disabled}
                        changed={was !== undefined && was !== cell.decision}
                      />
                    );
                  })}
                </ul>
              </section>
            ) : (
              <p className="text-[11px] leading-relaxed text-ink-faint">
                {t(
                  'Select a cell to see each request it stands for, the policy that decided it, and to follow it across the model.',
                )}
              </p>
            )}
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        {t(
          "Each answer is the embedded Cedar engine's, to a request made of the catalogue's principals, actions and resources. Asking leaves the timeline as it is.",
        )}
      </p>
    </div>
  );
}

/**
 * Who may do what: the whole of what the policies decide, at once. The
 * tracer answers one request; this asks Cedar every request the catalogue
 * describes, under one context, and counts the answers. Switching a policy
 * off asks them all again and says how many answers moved.
 */
export function AccessMatrixDialog() {
  const open = useUi((state) => state.openPanel === 'matrix');
  const { data: catalog, isError } = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.authorizationCatalog,
    enabled: open,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && useUi.getState().setPanel(null)}
      title={t('Who may do what')}
      description={t(
        'Every principal and action of the catalogue, on every resource the action applies to, each asked of Cedar.',
      )}
      width="max-w-4xl"
    >
      {isError ? (
        <EmptyState title={t('The catalogue is unavailable')}>
          {t('Cedar could not be asked.')}
        </EmptyState>
      ) : catalog ? (
        <Matrix catalog={catalog} />
      ) : null}
    </Dialog>
  );
}

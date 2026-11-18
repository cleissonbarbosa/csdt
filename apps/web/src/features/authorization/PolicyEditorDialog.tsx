import type { WorkspaceCheck, WorkspaceFile } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Section';
import { PolicyDiff } from '@/features/workspace/PolicyDiff';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { policiesAsCedar, withPolicies } from '@/lib/policies';
import { api, ApiError } from '@/providers/api';
import { useUi } from '@/stores/ui';

/** What the engine said of one text: an answer, or why it could not be asked. */
interface Checked {
  text: string;
  outcome: WorkspaceCheck | string;
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : t('The policies could not be checked.');
}

function Editor({ inUse, files }: { inUse: string; files: WorkspaceFile[] }) {
  const [text, setText] = useState(inUse);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = text !== inUse;
  const candidate = useMemo(() => withPolicies(files, text), [files, text]);

  // Ask about the text a moment after it stops changing. An answer is kept
  // with the text it is about, so a late one is never shown against another.
  useEffect(() => {
    if (!changed) return;
    let stale = false;
    const timer = setTimeout(() => {
      api.checkWorkspace(candidate).then(
        (outcome) => !stale && setChecked({ text, outcome }),
        (error: unknown) => !stale && setChecked({ text, outcome: message(error) }),
      );
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [candidate, text, changed]);

  const outcome = changed && checked?.text === text ? checked.outcome : null;
  const valid = typeof outcome === 'object' && outcome?.valid === true;

  const apply = async () => {
    setBusy(true);
    const result = await actions.importWorkspace(candidate);
    setBusy(false);
    if (result instanceof ApiError) {
      setFailure(result.message);
      return;
    }
    // Out of the way: what changed is what Cedar decides.
    useUi.getState().setPanel('matrix');
  };

  return (
    <div data-testid="policy-editor">
      <label className="caption mb-1 block" htmlFor="policy-text">
        {t("The policies in force, in Cedar's own syntax")}
      </label>
      <textarea
        id="policy-text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setFailure(null);
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={18}
        className="code block w-full resize-y rounded-control border border-line-strong bg-sunken p-2.5 text-[12px] leading-relaxed text-ink focus:border-ink focus:outline-none"
        data-testid="policy-text"
      />
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        {tr(
          'A policy goes by its {id}. Nothing is applied until you say so, and applying replaces the policies only: the platform, its scenarios and its entities stay as they are. The timeline starts again, as it does for any change of files.',
          { id: <span className="code">@id</span> },
        )}
      </p>

      <div
        className="mt-3 min-h-[2.5rem]"
        role="status"
        aria-live="polite"
        data-testid="policy-check"
      >
        {!changed ? (
          <p className="text-[11px] text-ink-faint">{t('These are the policies in use.')}</p>
        ) : outcome === null ? (
          <p className="text-[11px] text-ink-faint">{t('Checking…')}</p>
        ) : typeof outcome === 'string' ? (
          <p className="text-xs text-ink" data-valid="false">
            {outcome}
          </p>
        ) : outcome.workspace ? (
          <div data-valid="true">
            <p className="text-xs text-ink">
              {t(
                outcome.workspace.policyCount === 1
                  ? 'Cedar accepts them: {n} policy.'
                  : 'Cedar accepts them: {n} policies.',
                { n: outcome.workspace.policyCount },
              )}
            </p>
            <PolicyDiff files={candidate} />
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-ink" data-valid="false">
            <span className="font-bold">{t('Not valid.')} </span>
            {outcome.problem?.path && <span className="code">{outcome.problem.path}: </span>}
            <span className="whitespace-pre-wrap">{outcome.problem?.message}</span>
          </p>
        )}
        {failure && (
          <p className="mt-1 text-xs text-ink" data-testid="policy-failure">
            {t('Not applied: {reason}', { reason: failure })}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={!changed || !valid || busy}
          onClick={() => void apply()}
          data-testid="policy-apply"
        >
          {busy ? t('Applying…') : t('Apply these policies')}
        </Button>
        <Button
          icon={<RotateCcw size={13} aria-hidden />}
          disabled={!changed || busy}
          onClick={() => {
            setText(inUse);
            setFailure(null);
          }}
          data-testid="policy-revert"
        >
          {t('Put back the ones in use')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The Cedar policies, edited where they are evaluated. The text goes the way
 * a file does: the engine checks it, says what Cedar would decide
 * differently from what is in use, and applies it only when asked. The page
 * decides nothing about it: what is valid is what the engine accepts.
 */
export function PolicyEditorDialog() {
  const open = useUi((state) => state.openPanel === 'policies');
  const { data: catalog, isError: noCatalog } = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.authorizationCatalog,
    enabled: open,
  });
  // The files in use, asked for each time the editor opens: what is applied
  // is these with the policies replaced.
  const { data: bundle, isError: noFiles } = useQuery({
    queryKey: [...queryKeys.workspace, 'export'],
    queryFn: api.exportWorkspace,
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const inUse = useMemo(() => (catalog ? policiesAsCedar(catalog.policies) : null), [catalog]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && useUi.getState().setPanel(null)}
      title={t('Edit the Cedar policies')}
      description={t('Change what Cedar decides by, see which answers would change, then apply.')}
      width="max-w-3xl"
    >
      {noCatalog || noFiles ? (
        <EmptyState title={t('The policies are unavailable')}>
          {t('The files in use could not be read.')}
        </EmptyState>
      ) : inUse !== null && bundle ? (
        // A new editor for each set of policies: applying, or an import made
        // elsewhere, starts it again from what is then in force.
        <Editor key={inUse} inUse={inUse} files={bundle.files} />
      ) : null}
    </Dialog>
  );
}

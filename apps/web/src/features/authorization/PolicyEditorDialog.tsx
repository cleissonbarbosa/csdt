import type { AuthorizationCatalog, WorkspaceCheck, WorkspaceFile } from '@aegis/contracts';
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
import { formatPercent } from '@/lib/format';
import { policiesAsCedar, withPolicies } from '@/lib/policies';
import { appendPolicy } from '@/lib/policySentence';
import { CATALOG_FILE, readMix, withCatalog, writeMix } from '@/lib/trafficMix';
import { api, ApiError } from '@/providers/api';
import { useUi } from '@/stores/ui';

import { PolicySentence } from './PolicySentence';
import { TrafficMixBar } from './TrafficMixBar';

/** Where the entity store is among the files a workspace is saved as. */
const ENTITIES_FILE = 'cedar/entities.json';

/** What the engine said of one text: an answer, or why it could not be asked. */
interface Checked {
  text: string;
  outcome: WorkspaceCheck | string;
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : t('The policies could not be checked.');
}

function Editor({
  inUse,
  files,
  catalog,
}: {
  inUse: string;
  files: WorkspaceFile[];
  catalog: AuthorizationCatalog;
}) {
  const [text, setText] = useState(inUse);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The ids the sentence has given policies here, besides those in force.
  const [added, setAdded] = useState<string[]>([]);
  const catalogText = files.find((file) => file.path === CATALOG_FILE)?.text ?? null;
  const entitiesText = files.find((file) => file.path === ENTITIES_FILE)?.text ?? '[]';
  const mix = useMemo(() => (catalogText ? readMix(catalogText) : null), [catalogText]);
  const [shares, setShares] = useState<number[]>(() => mix?.shares ?? []);
  const mixedText = useMemo(
    () => (mix && catalogText ? writeMix(catalogText, mix, shares) : null),
    [mix, catalogText, shares],
  );
  const mixChanged = mixedText !== null && mixedText !== catalogText;
  const changed = text !== inUse || mixChanged;
  const candidate = useMemo(() => {
    const policies = withPolicies(files, text);
    return mixChanged && mixedText !== null ? withCatalog(policies, mixedText) : policies;
  }, [files, text, mixChanged, mixedText]);
  const taken = useMemo(
    () => [...catalog.policies.map((policy) => policy.id), ...added],
    [catalog.policies, added],
  );

  // Ask about the text a moment after it stops changing. An answer is kept
  // with the text it is about, so a late one is never shown against another.
  // What a check is about: the policies and the shares together.
  const asked = `${text}\n${mixedText ?? ''}`;
  useEffect(() => {
    if (!changed) return;
    let stale = false;
    const timer = setTimeout(() => {
      api.checkWorkspace(candidate).then(
        (outcome) => !stale && setChecked({ text: asked, outcome }),
        (error: unknown) => !stale && setChecked({ text: asked, outcome: message(error) }),
      );
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [candidate, asked, changed]);

  const outcome = changed && checked?.text === asked ? checked.outcome : null;
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
      <PolicySentence
        catalog={catalog}
        entitiesText={entitiesText}
        taken={taken}
        onAdd={(policy, id) => {
          setText((current) => appendPolicy(current, policy));
          setAdded((ids) => [...ids, id]);
          setFailure(null);
        }}
      />
      <label className="caption mb-1 mt-4 block" htmlFor="policy-text">
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
          'A policy goes by its {id}. Nothing is applied until you say so, and applying replaces the policies and the shares of ordinary traffic only: the platform, its scenarios and its entities stay as they are. The timeline starts again, as it does for any change of files.',
          { id: <span className="code">@id</span> },
        )}
      </p>

      {mix && (
        <section className="mt-4" aria-labelledby="traffic-mix-title">
          <h3 id="traffic-mix-title" className="text-xs font-bold text-ink">
            {t('What ordinary traffic asks')}
          </h3>
          <p className="mb-2 mt-0.5 text-[11px] leading-relaxed text-ink-faint">
            {t(
              'The request shapes the catalogue sends at rest, each as wide as its share. Carry a boundary to move share from one to the next. The share Cedar denies is the denial rate at rest.',
            )}
          </p>
          <TrafficMixBar catalog={catalog} mix={mix} shares={shares} onShares={setShares} />
        </section>
      )}

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
              )}{' '}
              <span data-testid="policy-deny-rate">
                {t('At rest Cedar would deny {then} of ordinary requests; it denies {now} now.', {
                  then: formatPercent(outcome.workspace.baselineDenyFraction),
                  now: formatPercent(catalog.baselineDenyFraction),
                })}
              </span>
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
            setShares(mix?.shares ?? []);
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
      ) : inUse !== null && bundle && catalog ? (
        // A new editor for each set of policies: applying, or an import made
        // elsewhere, starts it again from what is then in force.
        <Editor
          key={`${inUse}\n${bundle.files.find((file) => file.path === CATALOG_FILE)?.text ?? ''}`}
          inUse={inUse}
          files={bundle.files}
          catalog={catalog}
        />
      ) : null}
    </Dialog>
  );
}

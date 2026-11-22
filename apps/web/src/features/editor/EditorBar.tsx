/**
 * The bar while a platform is drawn: what is being drawn, what the engine
 * makes of it, and what can be done with it.
 *
 * The engine is asked about the draft a moment after it stops changing,
 * with the files in use around it (`open.ts`), and its answer is kept with
 * the text it is about (`stores/editor.ts`). While a change is being asked
 * about the model goes on showing the last run, and the sentence here says
 * that it is the last run, not this one.
 */
import { GitCompareArrows, LogOut, Redo2, Save, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { t } from '@/i18n';
import { draftProblems, draftText } from '@/lib/topologyFile';
import { api, ApiError } from '@/providers/api';
import { selectCanRedo, selectCanUndo, useEditor, type EditorTab } from '@/stores/editor';
import { useNotices } from '@/stores/notices';

import { applyDraft, leaveEditor, openIncident, saveDraft, stageDraft, withDraft } from './open';

const TABS: readonly { value: EditorTab; label: string }[] = [
  { value: 'platform', label: t('Platform') },
  { value: 'incident', label: t('Incident') },
];

/**
 * What the editor has in hand: the platform, or an incident written on it.
 * The incident is written against the platform as it is drawn, and run
 * with it.
 */
export function EditorTabs() {
  const tab = useEditor((state) => state.tab);
  return (
    <Segmented
      label={t('What is edited')}
      value={tab}
      options={TABS}
      onChange={(next) =>
        next === 'incident' ? openIncident() : useEditor.getState().setTab(next)
      }
      size="sm"
      testId="editor-tab"
    />
  );
}

/** How long the draft has to stay as it is before the engine is asked about it. */
const ASK_AFTER_MS = 600;

/** Asks the engine about the draft as it settles. */
export function usePreview(): void {
  const draft = useEditor((state) => state.draft);
  const text = useMemo(() => (draft ? draftText(draft) : null), [draft]);
  useEffect(() => {
    const current = useEditor.getState().draft;
    if (!current || text === null || draftProblems(current).length > 0) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      useEditor.getState().answered({ text, state: 'asking' });
      api.previewWorkspace(withDraft(current), current.id).then(
        (preview) => {
          if (stale) return;
          useEditor.getState().answered({
            text,
            state: 'ran',
            topology: preview.topology,
            snapshot: preview.snapshot,
          });
        },
        (error: unknown) => {
          if (stale) return;
          useEditor.getState().answered({
            text,
            state: 'refused',
            message:
              error instanceof ApiError
                ? error.message
                : t('The engine could not run the platform.'),
          });
        },
      );
    }, ASK_AFTER_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [text]);
}

/** What the engine makes of the draft, in a sentence. */
export function EditorStatus() {
  usePreview();
  const draft = useEditor((state) => state.draft);
  const answer = useEditor((state) => state.answer);
  const refused = useEditor((state) => state.refused);
  const origin = useEditor((state) => state.origin);
  if (!draft) return null;
  const problems = draftProblems(draft);
  const current = answer !== null && answer.text === draftText(draft);

  let sentence: string;
  let tone: 'plain' | 'problem' = 'plain';
  if (refused) {
    sentence = refused.message;
    tone = 'problem';
  } else if (problems.length > 0) {
    sentence =
      problems.length === 1
        ? (problems[0] as string)
        : t('{n} things to put right before the engine can run it, first: {first}', {
            n: problems.length,
            first: problems[0] as string,
          });
    tone = 'problem';
  } else if (!current || answer.state === 'asking') {
    sentence = t('The engine is running the change at rest; the model shows the last run.');
  } else if (answer.state === 'refused') {
    sentence = answer.message;
    tone = 'problem';
  } else {
    const health = answer.snapshot.nodes.health;
    const off = health.filter((code) => code !== 0).length;
    sentence =
      off === 0
        ? health.length === 1
          ? t('At rest, as the engine runs it: one service, normal.')
          : t('At rest, as the engine runs it: {n} services, all normal.', { n: health.length })
        : t('At rest, as the engine runs it: {off} of {n} services out of normal.', {
            off,
            n: health.length,
          });
  }

  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-3" data-testid="editor-status">
      <span className="shrink-0 text-xs font-bold text-ink">
        {origin?.kind === 'blank'
          ? t('Drawing a platform')
          : t('Editing {name}', { name: draft.name || origin?.name || draft.id })}
      </span>
      <span
        role="status"
        className={
          tone === 'problem' ? 'truncate text-xs text-warning' : 'truncate text-xs text-ink-dim'
        }
        title={sentence}
      >
        {sentence}
      </span>
    </div>
  );
}

/** Undo, redo, save, compare, apply, leave. */
export function EditorActions() {
  const canUndo = useEditor(selectCanUndo);
  const canRedo = useEditor(selectCanRedo);
  const changed = useEditor((state) => state.past.length > 0);
  const valid = useEditor(
    (state) => state.draft !== null && draftProblems(state.draft).length === 0,
  );
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  if (leaving) {
    return (
      <div
        className="ml-auto flex h-12 shrink-0 items-center gap-2"
        data-testid="editor-leave-confirm"
      >
        <span className="text-xs text-ink-dim">
          {t('Leave without applying? The draft is not kept.')}
        </span>
        <Button onClick={() => setLeaving(false)}>{t('Keep editing')}</Button>
        <Button variant="primary" onClick={leaveEditor} data-testid="editor-leave-anyway">
          {t('Leave')}
        </Button>
      </div>
    );
  }

  return (
    <div className="ml-auto flex h-12 shrink-0 items-center gap-1.5">
      <IconButton
        label={t('Undo')}
        disabled={!canUndo}
        onClick={() => useEditor.getState().undo()}
        data-testid="editor-undo"
      >
        <Undo2 size={15} />
      </IconButton>
      <IconButton
        label={t('Redo')}
        disabled={!canRedo}
        onClick={() => useEditor.getState().redo()}
        data-testid="editor-redo"
      >
        <Redo2 size={15} />
      </IconButton>
      <Button
        icon={<Save size={13} aria-hidden />}
        onClick={saveDraft}
        className="max-lg:w-8 max-lg:px-0"
        aria-label={t('Save the file')}
        data-testid="editor-save"
      >
        <span className="max-lg:hidden">{t('Save the file')}</span>
      </Button>
      <Button
        icon={<GitCompareArrows size={13} aria-hidden />}
        disabled={!valid}
        onClick={stageDraft}
        className="max-lg:w-8 max-lg:px-0"
        aria-label={t('Run an incident on it and on the platform in use')}
        title={t('Run an incident on it and on the platform in use')}
        data-testid="editor-compare"
      >
        <span className="max-xl:hidden">{t('Compare an incident')}</span>
      </Button>
      <Button
        variant="primary"
        disabled={!valid || busy}
        onClick={() => {
          setBusy(true);
          void applyDraft().then((problem) => {
            setBusy(false);
            if (problem) useNotices.getState().push('error', problem);
          });
        }}
        title={t('Put it in use: the simulation starts a new timeline, for everyone connected.')}
        data-testid="editor-apply"
      >
        {busy ? t('Applying…') : t('Apply')}
      </Button>
      <IconButton
        label={t('Leave the editor')}
        onClick={() => (changed ? setLeaving(true) : leaveEditor())}
        data-testid="editor-leave"
      >
        <LogOut size={15} />
      </IconButton>
    </div>
  );
}

/**
 * The bar while an incident is written: whether the engine accepts it, and
 * where it can run, then what can be done with it.
 *
 * The engine is asked a moment after the scenario stops changing, with
 * every file in use around it and the platform as it is drawn
 * (`withIncident`), which is the check an imported file gets; its answer is
 * kept with the text it is about (`stores/incident.ts`). Running it is an
 * import of those same files and the start of the scenario on the platform
 * drawn, for everyone connected.
 */
import type { WorkspaceCheck } from '@aegis/contracts';
import { Download, LogOut, Redo2, Undo2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { t } from '@/i18n';
import { draftProblems } from '@/lib/scenarioFile';
import { draftText } from '@/lib/topologyFile';
import { api, ApiError } from '@/providers/api';
import { useEditor } from '@/stores/editor';
import { selectIncidentCanRedo, selectIncidentCanUndo, useIncident } from '@/stores/incident';
import { useNotices } from '@/stores/notices';

import { usePreview } from '../EditorBar';
import { leaveEditor, runIncident, saveIncident, scenarioText, withIncident } from '../open';

/** How long the scenario has to stay as it is before the engine is asked about it. */
const ASK_AFTER_MS = 450;

/** The text a check is about: the scenario and the platform it is written on. */
function useCheckText(): string | null {
  const scenario = useIncident((state) => state.scenario);
  const platform = useEditor((state) => state.draft);
  return useMemo(
    () => (scenario && platform ? `${scenarioText(scenario)}\n${draftText(platform)}` : null),
    [scenario, platform],
  );
}

/** Asks the engine about the scenario as it settles. */
function useIncidentCheck(text: string | null): void {
  useEffect(() => {
    const scenario = useIncident.getState().scenario;
    if (!scenario || text === null || draftProblems(scenario).length > 0) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      const keep = (outcome: WorkspaceCheck | string) =>
        !stale && useIncident.getState().checked({ text, outcome }, text);
      api
        .checkWorkspace(withIncident(scenario))
        .then(keep, (error: unknown) =>
          keep(error instanceof ApiError ? error.message : t('The file could not be checked.')),
        );
    }, ASK_AFTER_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [text]);
}

/** What the engine says of the incident, as it now is. */
export function useIncidentVerdict(): {
  sentence: string;
  tone: 'plain' | 'problem';
  runs: boolean;
} {
  const text = useCheckText();
  useIncidentCheck(text);
  const scenario = useIncident((state) => state.scenario);
  const check = useIncident((state) => state.check);
  const platform = useEditor((state) => state.draft);
  const refused = useEditor((state) => state.refused);
  if (!scenario || !platform) return { sentence: '', tone: 'plain', runs: false };
  const problems = draftProblems(scenario);
  if (refused) return { sentence: refused.message, tone: 'problem', runs: false };
  if (problems.length > 0) {
    return {
      sentence:
        problems.length === 1
          ? (problems[0] as string)
          : t('{n} things to put right before the engine can check it, first: {first}', {
              n: problems.length,
              first: problems[0] as string,
            }),
      tone: 'problem',
      runs: false,
    };
  }
  const outcome = check?.text === text ? check.outcome : null;
  if (outcome === null) {
    return {
      sentence: t('The engine is checking the incident with everything in use…'),
      tone: 'plain',
      runs: false,
    };
  }
  if (typeof outcome === 'string') {
    return {
      // The error is the server's, in its own words.
      sentence: t('{error} The file can still be saved and given to a server when it starts.', {
        error: outcome,
      }),
      tone: 'problem',
      runs: false,
    };
  }
  if (!outcome.valid) {
    return {
      sentence: outcome.problem?.message ?? t('The engine does not accept this scenario.'),
      tone: 'problem',
      runs: false,
    };
  }
  const missing = outcome.workspace?.unavailable.find(
    (entry) => entry.scenarioId === scenario.id && entry.topologyId === platform.id,
  );
  if (missing) {
    return {
      // The reason is the server's, in its own words.
      sentence: t('The engine accepts it, but it cannot run on {platform}: {reason}', {
        platform: platform.name || platform.id,
        reason: missing.reason,
      }),
      tone: 'problem',
      runs: false,
    };
  }
  return {
    sentence: t('The engine accepts this incident and can run it on {platform}.', {
      platform: platform.name || platform.id,
    }),
    tone: 'plain',
    runs: true,
  };
}

/** The incident, and what the engine says of it, in a sentence. */
export function IncidentStatus({ verdict }: { verdict: ReturnType<typeof useIncidentVerdict> }) {
  // The model shows the platform at rest, as the engine runs it, here too.
  usePreview();
  const scenario = useIncident((state) => state.scenario);
  if (!scenario) return null;
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-3" data-testid="incident-status">
      <span className="shrink-0 text-xs font-bold text-ink">
        {t('Writing {name}', { name: scenario.name || scenario.id })}
      </span>
      <span
        role="status"
        className={
          verdict.tone === 'problem'
            ? 'truncate text-xs text-warning'
            : 'truncate text-xs text-ink-dim'
        }
        title={verdict.sentence}
        data-testid="incident-verdict"
      >
        {verdict.sentence}
      </span>
    </div>
  );
}

/** Undo, redo, save, run, leave. */
export function IncidentActions({ runs }: { runs: boolean }) {
  const canUndo = useIncident(selectIncidentCanUndo);
  const canRedo = useIncident(selectIncidentCanRedo);
  const changed = useIncident((state) => state.past.length > 0);
  const platformChanged = useEditor((state) => state.past.length > 0);
  const saveable = useIncident(
    (state) => state.scenario !== null && draftProblems(state.scenario).length === 0,
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
          {t('Leave without running it? The incident is not kept.')}
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
        onClick={() => useIncident.getState().undo()}
        data-testid="incident-undo"
      >
        <Undo2 size={15} />
      </IconButton>
      <IconButton
        label={t('Redo')}
        disabled={!canRedo}
        onClick={() => useIncident.getState().redo()}
        data-testid="incident-redo"
      >
        <Redo2 size={15} />
      </IconButton>
      <Button
        icon={<Download size={13} aria-hidden />}
        disabled={!saveable}
        onClick={saveIncident}
        className="max-lg:w-8 max-lg:px-0"
        aria-label={t('Save the scenario')}
        data-testid="incident-save"
      >
        <span className="max-lg:hidden">{t('Save the scenario')}</span>
      </Button>
      <Button
        variant="primary"
        icon={<Zap size={13} aria-hidden />}
        disabled={!runs || busy}
        onClick={() => {
          setBusy(true);
          void runIncident().then((problem) => {
            setBusy(false);
            if (problem) useNotices.getState().push('error', problem);
          });
        }}
        title={t(
          'Apply the platform as drawn with the incident in, and start it: the simulation starts a new timeline, for everyone connected.',
        )}
        data-testid="incident-run"
      >
        {busy ? t('Starting…') : t('Run it')}
      </Button>
      <IconButton
        label={t('Leave the editor')}
        onClick={() => (changed || platformChanged ? setLeaving(true) : leaveEditor())}
        data-testid="editor-leave"
      >
        <LogOut size={15} />
      </IconButton>
    </div>
  );
}

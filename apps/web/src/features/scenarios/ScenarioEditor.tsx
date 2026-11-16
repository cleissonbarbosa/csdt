/**
 * Writing a scenario by hand.
 *
 * A scenario is a file: phases on a timeline, each with the effects that
 * hold during it and the events it announces. This dialog is a form over
 * that file. It writes exactly the format the engine reads, asks the server
 * whether the result is valid and where it can run (the same check an
 * imported file gets), and only then offers to run it. The file can be
 * saved at any point and used with any AEGIS server.
 */
import type { Topology, WorkspaceCheck, WorkspaceFile } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { NumberField, Select, TextArea, TextField } from '@/components/ui/Field';
import { downloadJson } from '@/features/workspace/files';
import {
  blankScenario,
  CATEGORIES,
  draftFromFile,
  draftProblems,
  draftToFile,
  EFFECT,
  EFFECT_KINDS,
  emptyPhase,
  EVENT_KINDS,
  PHASE_STATUSES,
  rowKey,
  SEVERITIES,
  slug,
  targetChoices,
  type EffectDraft,
  type EffectKind,
  type EventDraft,
  type PhaseDraft,
  type ScenarioDraft,
  type TargetChoice,
} from '@/lib/scenarioFile';
import { titleCase } from '@/lib/format';
import { api, ApiError } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

/** A time typed in seconds, as the file keeps it: whole milliseconds, never before zero. */
const millis = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

/** The services, roles and regions an effect can be placed on, grouped. */
function TargetSelect({
  label,
  value,
  choices,
  onChange,
  allowNone,
  hideLabel,
  testId,
}: {
  label: string;
  value: string;
  choices: TargetChoice[];
  onChange: (value: string) => void;
  allowNone?: string;
  hideLabel?: boolean;
  testId?: string;
}) {
  const groups = [...new Set(choices.map((choice) => choice.group))];
  // A selector read from a file may name something this platform lacks; it
  // stays selectable so the file is not changed by being looked at.
  const known = value === '' || choices.some((choice) => choice.value === value);
  return (
    <Select
      label={label}
      hideLabel={hideLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      data-testid={testId}
    >
      {allowNone !== undefined && <option value="">{allowNone}</option>}
      {!known && <option value={value}>{value} (not on this platform)</option>}
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {choices
            .filter((choice) => choice.group === group)
            .map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

function EffectRow({
  effect,
  topology,
  onChange,
  onRemove,
}: {
  effect: EffectDraft;
  topology: Topology;
  onChange: (effect: EffectDraft) => void;
  onRemove: () => void;
}) {
  const remove = (
    <IconButton label="Remove this effect" size="sm" onClick={onRemove}>
      <Trash2 size={13} />
    </IconButton>
  );
  if (effect.kind === 'raw') {
    return (
      <li className="flex items-center gap-2" data-testid="effect-raw">
        <span className="code min-w-0 flex-1 truncate text-[11px] text-ink-dim">
          {JSON.stringify(effect.json)}
        </span>
        <span className="caption shrink-0">kept as written</span>
        {remove}
      </li>
    );
  }
  const shape = EFFECT[effect.kind];
  const choices = targetChoices(topology, shape.on !== 'nodes');
  return (
    <li
      className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_4.5rem_auto] items-end gap-1.5"
      data-testid="effect-row"
    >
      <Select
        label="Effect"
        hideLabel
        value={effect.kind}
        onChange={(event) => {
          const kind = event.target.value as EffectKind;
          const next = EFFECT[kind];
          // A region cannot take an effect that is placed on one service.
          const single = next.on !== 'nodes';
          const fits = targetChoices(topology, single).some((c) => c.value === effect.target);
          onChange({
            ...effect,
            kind,
            value: next.start,
            target: fits ? effect.target : '',
          });
        }}
      >
        {EFFECT_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {EFFECT[kind].label}
          </option>
        ))}
      </Select>
      <TargetSelect
        label="On"
        hideLabel
        value={effect.target}
        choices={choices}
        allowNone="Choose what it acts on…"
        onChange={(target) => onChange({ ...effect, target })}
        testId="effect-target"
      />
      {shape.figure === 'none' ? (
        <span />
      ) : (
        <NumberField
          label={shape.figure === 'rate' ? 'Share, 0 to 1' : 'Factor'}
          hideLabel
          min={0}
          max={shape.figure === 'rate' ? 1 : 1000}
          step="any"
          value={effect.value}
          onValue={(value) => onChange({ ...effect, value })}
          title={
            shape.figure === 'rate'
              ? 'A share from 0 to 1'
              : 'A factor: 1 leaves it as it is, 0.5 halves it, 2 doubles it'
          }
        />
      )}
      {remove}
    </li>
  );
}

function EventRow({
  event,
  onChange,
  onRemove,
}: {
  event: EventDraft;
  onChange: (event: EventDraft) => void;
  onRemove: () => void;
}) {
  return (
    <li
      className="grid grid-cols-[4rem_5.5rem_6.5rem_minmax(0,1fr)_auto] items-end gap-1.5"
      data-testid="event-draft"
    >
      <NumberField
        label="After, s"
        hideLabel
        min={0}
        step="any"
        value={event.delayMs / 1000}
        onValue={(value) => onChange({ ...event, delayMs: millis(value) })}
        title="Seconds after the phase begins"
      />
      <Select
        label="Severity"
        hideLabel
        value={event.severity}
        onChange={(e) => onChange({ ...event, severity: e.target.value as EventDraft['severity'] })}
      >
        {SEVERITIES.map((severity) => (
          <option key={severity} value={severity}>
            {titleCase(severity)}
          </option>
        ))}
      </Select>
      <Select
        label="Kind"
        hideLabel
        value={event.kind}
        onChange={(e) => onChange({ ...event, kind: e.target.value as EventDraft['kind'] })}
      >
        {EVENT_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {titleCase(kind)}
          </option>
        ))}
      </Select>
      <TextField
        label="What it says"
        hideLabel
        placeholder="What the event says"
        value={event.title}
        onChange={(e) => onChange({ ...event, title: e.target.value })}
      />
      <IconButton label="Remove this event" size="sm" onClick={onRemove}>
        <Trash2 size={13} />
      </IconButton>
    </li>
  );
}

function PhaseCard({
  phase,
  index,
  topology,
  only,
  onChange,
  onRemove,
}: {
  phase: PhaseDraft;
  index: number;
  topology: Topology;
  /** The one phase left cannot be removed. */
  only: boolean;
  onChange: (phase: PhaseDraft) => void;
  onRemove: () => void;
}) {
  const setEffect = (key: string, next: EffectDraft) =>
    onChange({ ...phase, effects: phase.effects.map((e) => (e.key === key ? next : e)) });
  const setEvent = (key: string, next: EventDraft) =>
    onChange({ ...phase, events: phase.events.map((e) => (e.key === key ? next : e)) });
  const firstTarget = targetChoices(topology, false)[0]?.value ?? '';
  return (
    <li className="rounded-control border border-line p-2.5" data-testid={`phase-draft-${index}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_auto] items-end gap-1.5">
        <TextField
          label={`Phase ${index + 1}`}
          value={phase.name}
          onChange={(event) => onChange({ ...phase, name: event.target.value })}
          data-testid="phase-name"
        />
        <NumberField
          label="Starts at, s"
          min={0}
          step="any"
          value={phase.atMs / 1000}
          onValue={(value) => onChange({ ...phase, atMs: millis(value) })}
          title="Seconds after the scenario starts"
          data-testid="phase-at"
        />
        <NumberField
          label="Eases in, s"
          min={0}
          step="any"
          value={phase.rampMs / 1000}
          onValue={(value) => onChange({ ...phase, rampMs: millis(value) })}
          title="How long its effects take to ease in from what held before"
        />
        <Select
          label="Incident is"
          value={phase.status}
          onChange={(event) =>
            onChange({ ...phase, status: event.target.value as PhaseDraft['status'] })
          }
        >
          {PHASE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {titleCase(status)}
            </option>
          ))}
        </Select>
        <IconButton
          label={`Remove phase ${index + 1}`}
          size="sm"
          disabled={only}
          onClick={onRemove}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
      <TextArea
        label="What happens, in a sentence"
        className="mt-2"
        value={phase.description}
        onChange={(event) => onChange({ ...phase, description: event.target.value })}
      />

      <div className="mt-2.5">
        <p className="caption mb-1">
          Effects held during this phase. Whatever a phase does not list eases back to nominal.
        </p>
        {phase.effects.length > 0 && (
          <ul className="space-y-1.5">
            {phase.effects.map((effect) => (
              <EffectRow
                key={effect.key}
                effect={effect}
                topology={topology}
                onChange={(next) => setEffect(effect.key, next)}
                onRemove={() =>
                  onChange({
                    ...phase,
                    effects: phase.effects.filter((e) => e.key !== effect.key),
                  })
                }
              />
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={12} aria-hidden />}
          className="mt-1"
          onClick={() =>
            onChange({
              ...phase,
              effects: [
                ...phase.effects,
                {
                  key: rowKey(),
                  kind: 'latency',
                  target: firstTarget,
                  value: EFFECT.latency.start,
                },
              ],
            })
          }
          data-testid="phase-add-effect"
        >
          Add an effect
        </Button>
      </div>

      <div className="mt-2">
        {phase.events.length > 0 && (
          <>
            <p className="caption mb-1">Events it announces</p>
            <ul className="space-y-1.5">
              {phase.events.map((event) => (
                <EventRow
                  key={event.key}
                  event={event}
                  onChange={(next) => setEvent(event.key, next)}
                  onRemove={() =>
                    onChange({
                      ...phase,
                      events: phase.events.filter((e) => e.key !== event.key),
                    })
                  }
                />
              ))}
            </ul>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={12} aria-hidden />}
          className="mt-1"
          onClick={() =>
            onChange({
              ...phase,
              events: [
                ...phase.events,
                {
                  key: rowKey(),
                  delayMs: 4000,
                  severity: 'warning',
                  kind: 'alert',
                  title: '',
                  message: '',
                  nodes: [],
                },
              ],
            })
          }
        >
          Add an event it announces
        </Button>
      </div>
    </li>
  );
}

function Note({ tone, children }: { tone: 'problem' | 'fine'; children: ReactNode }) {
  return tone === 'problem' ? (
    <div
      role="alert"
      className="rounded-control border border-critical/40 bg-critical/10 px-2 py-1.5 text-[11px] leading-relaxed text-critical"
      data-testid="editor-problem"
    >
      {children}
    </div>
  ) : (
    <div className="text-[11px] leading-relaxed text-ink-dim" data-testid="editor-valid">
      {children}
    </div>
  );
}

/** Every file the platform in use comes from, as it would be saved. */
function useFilesInUse() {
  return useQuery({
    queryKey: [...queryKeys.workspace, 'files'],
    queryFn: async () => (await api.exportWorkspace()).files,
  });
}

const isScenario = (file: WorkspaceFile) => /(^|\/)scenarios\/[^/]+\.json$/.test(file.path);

function idOf(file: WorkspaceFile): string | null {
  try {
    const json = JSON.parse(file.text) as { id?: unknown };
    return typeof json.id === 'string' ? json.id : null;
  } catch {
    return null;
  }
}

/**
 * The files an import would install: everything in use, with the scenario
 * being written added, or put in the place of the one with its id. An
 * import is laid over what the server started with, not over what is in
 * use, so everything in use goes with it: adding a scenario must not take
 * an imported platform away.
 */
function withDraft(inUse: WorkspaceFile[], draft: ScenarioDraft): WorkspaceFile[] {
  const text = `${JSON.stringify(draftToFile(draft), null, 2)}\n`;
  const same = inUse.find((file) => isScenario(file) && idOf(file) === draft.id);
  if (same) return inUse.map((file) => (file === same ? { ...file, text } : file));
  // Scenarios are offered in file-name order: a new one goes last.
  return [...inUse, { path: `scenarios/zz-${draft.id}.json`, text }];
}

function readDraft(text: string): ScenarioDraft | null {
  try {
    return draftFromFile(JSON.parse(text));
  } catch {
    return null;
  }
}

/** What the editor holds, kept while its dialog is closed. */
export interface EditorState {
  draft: ScenarioDraft;
  idTouched: boolean;
  startFrom: string;
}

type Checked = { text: string; outcome: WorkspaceCheck | string };

function Editor({
  topology,
  initial,
  onChange,
}: {
  topology: Topology;
  initial: EditorState | null;
  onChange: (state: EditorState) => void;
}) {
  const { data: files, error: filesError } = useFilesInUse();
  const scenarioFiles = useMemo(() => files?.filter(isScenario) ?? [], [files]);
  const firstTarget = useMemo(() => targetChoices(topology, false)[0]?.value ?? '', [topology]);
  const [draft, setDraft] = useState<ScenarioDraft>(
    () => initial?.draft ?? blankScenario(firstTarget),
  );
  // The id follows the name until it is typed in by hand or read from a file.
  const [idTouched, setIdTouched] = useState(initial?.idTouched ?? false);
  const [startFrom, setStartFrom] = useState(initial?.startFrom ?? '');
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    onChange({ draft, idTouched, startFrom });
  }, [draft, idTouched, startFrom, onChange]);

  const local = draftProblems(draft);
  const fileText = useMemo(() => JSON.stringify(draftToFile(draft), null, 2), [draft]);
  // The server is asked a moment after the file stops changing, and its
  // answer is kept with the text it is about.
  useEffect(() => {
    if (!files || local.length > 0) return;
    let stale = false;
    const timer = setTimeout(() => {
      api.checkWorkspace(withDraft(files, draft)).then(
        (outcome) => !stale && setChecked({ text: fileText, outcome }),
        (error: unknown) =>
          !stale &&
          setChecked({
            text: fileText,
            outcome: error instanceof ApiError ? error.message : 'The file could not be checked.',
          }),
      );
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `draft` and `local` are functions of `fileText`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, fileText]);

  const outcome = checked?.text === fileText ? checked.outcome : null;
  const valid = local.length === 0 && typeof outcome === 'object' && outcome?.valid === true;
  const cannotRun =
    typeof outcome === 'object' && outcome?.workspace
      ? outcome.workspace.unavailable.filter((entry) => entry.scenarioId === draft.id)
      : [];
  const runsHere = valid && !cannotRun.some((entry) => entry.topologyId === topology.id);
  const replaces = scenarioFiles.some((file) => idOf(file) === draft.id);

  const set = (patch: Partial<ScenarioDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const setPhase = (key: string, next: PhaseDraft) =>
    set({ phases: draft.phases.map((phase) => (phase.key === key ? next : phase)) });

  const load = (path: string) => {
    setStartFrom(path);
    setFailure(null);
    if (path === '') {
      setDraft(blankScenario(firstTarget));
      setIdTouched(false);
      return;
    }
    const file = scenarioFiles.find((entry) => entry.path === path);
    const read = file ? readDraft(file.text) : null;
    if (!read) {
      setFailure('That file could not be read as a scenario.');
      return;
    }
    // A copy, so the scenario it was read from is not replaced by accident.
    setDraft({ ...read, id: `${read.id}-copy`.slice(0, 64), name: `${read.name} (copy)` });
    setIdTouched(true);
  };

  const run = async () => {
    if (!files || !valid) return;
    setBusy(true);
    setFailure(null);
    const imported = await actions.importWorkspace(withDraft(files, draft));
    if (imported instanceof ApiError) {
      setFailure(imported.message);
      setBusy(false);
      return;
    }
    // The import opens the platform's first topology; the scenario was
    // checked against the one that was on screen.
    if (imported.defaultTopologyId !== topology.id) {
      await actions.selectTopology(topology.id);
    }
    const started = await actions.startScenario(draft.id);
    setBusy(false);
    if (started) {
      useUi.getState().setPanel(null);
      useUi.getState().setLeftTab('incidents');
    }
  };

  const single = targetChoices(topology, true);
  const lastStart = Math.max(0, ...draft.phases.map((phase) => phase.atMs));
  return (
    <div data-testid="scenario-editor">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Select
          label="Start from"
          value={startFrom}
          onChange={(event) => load(event.target.value)}
          className="sm:col-span-2"
          data-testid="editor-start-from"
        >
          <option value="">A blank scenario</option>
          {scenarioFiles.map((file) => (
            <option key={file.path} value={file.path}>
              A copy of {idOf(file) ?? file.path}
            </option>
          ))}
        </Select>
        <TextField
          label="Name"
          value={draft.name}
          onChange={(event) =>
            set({
              name: event.target.value,
              ...(idTouched ? {} : { id: slug(event.target.value) }),
            })
          }
          data-testid="editor-name"
        />
        <TextField
          label="Id, as the file and the API name it"
          value={draft.id}
          onChange={(event) => {
            setIdTouched(true);
            set({ id: event.target.value });
          }}
          data-testid="editor-id"
        />
        <TextArea
          label="Summary"
          className="sm:col-span-2"
          value={draft.summary}
          onChange={(event) => set({ summary: event.target.value })}
          data-testid="editor-summary"
        />
        <Select
          label="Category"
          value={draft.category}
          onChange={(event) => set({ category: event.target.value as ScenarioDraft['category'] })}
        >
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {titleCase(category)}
            </option>
          ))}
        </Select>
        <Select
          label="Severity"
          value={draft.severity}
          onChange={(event) => set({ severity: event.target.value as ScenarioDraft['severity'] })}
        >
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {titleCase(severity)}
            </option>
          ))}
        </Select>
        <NumberField
          label="Lasts, in seconds"
          min={1}
          max={1800}
          step="any"
          value={draft.durationMs / 1000}
          onValue={(value) => set({ durationMs: millis(value) })}
          hint="Up to 1800: the half hour of history the timeline keeps."
          data-testid="editor-duration"
        />
        <TargetSelect
          label="Root cause, if it names one"
          value={draft.rootCause}
          choices={single}
          allowNone="None named"
          onChange={(rootCause) => set({ rootCause })}
          testId="editor-root-cause"
        />
      </div>

      <h3 className="mt-4 text-xs font-bold text-ink">Phases</h3>
      <ol className="mt-1.5 space-y-2">
        {draft.phases.map((phase, index) => (
          <PhaseCard
            key={phase.key}
            phase={phase}
            index={index}
            topology={topology}
            only={draft.phases.length === 1}
            onChange={(next) => setPhase(phase.key, next)}
            onRemove={() => set({ phases: draft.phases.filter((p) => p.key !== phase.key) })}
          />
        ))}
      </ol>
      <Button
        size="sm"
        icon={<Plus size={12} aria-hidden />}
        className="mt-2"
        onClick={() =>
          set({
            phases: [
              ...draft.phases,
              emptyPhase(
                Math.min(lastStart + 10_000, Math.max(0, draft.durationMs - 1000)),
                'recovering',
              ),
            ],
          })
        }
        data-testid="editor-add-phase"
      >
        Add a phase
      </Button>
      {draft.flows.length > 0 && (
        <p className="caption mt-2" data-testid="editor-flows">
          {draft.flows.length} injected flow{draft.flows.length === 1 ? '' : 's'} read from the file{' '}
          {draft.flows.length === 1 ? 'is' : 'are'} kept as written. Flows are edited in the file
          itself.
        </p>
      )}

      <div className="mt-4 space-y-2 border-t border-line pt-3" role="status" aria-live="polite">
        {local.length > 0 ? (
          <Note tone="problem">
            <ul className="space-y-0.5">
              {local.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Note>
        ) : filesError ? (
          <Note tone="problem">
            The scenarios in use could not be read, so this one cannot be checked against them.
          </Note>
        ) : outcome === null ? (
          <p className="text-[11px] text-ink-faint">Asking the engine whether this is valid…</p>
        ) : typeof outcome === 'string' ? (
          <Note tone="problem">
            {outcome} The file can still be saved and given to a server when it starts.
          </Note>
        ) : !outcome.valid ? (
          <Note tone="problem">
            {outcome.problem?.message ?? 'The engine does not accept this scenario.'}
          </Note>
        ) : (
          <Note tone="fine">
            <p className="text-xs text-ink">
              The engine accepts this scenario
              {runsHere ? ` and can run it on ${topology.name}.` : '.'}
            </p>
            {cannotRun.map((entry) => (
              <p key={entry.topologyId} data-testid="editor-unavailable">
                It cannot run on <span className="code">{entry.topologyId}</span>: {entry.reason}
              </p>
            ))}
            {replaces && (
              <p>
                A scenario with the id <span className="code">{draft.id}</span> is in use; running
                this one takes its place.
              </p>
            )}
          </Note>
        )}
        {failure && <Note tone="problem">{failure}</Note>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={<Zap size={13} aria-hidden />}
            disabled={!runsHere || busy}
            onClick={() => void run()}
            data-testid="editor-run"
          >
            {busy ? 'Starting…' : 'Add it and run it'}
          </Button>
          <Button
            icon={<Download size={13} aria-hidden />}
            disabled={local.length > 0}
            onClick={() => downloadJson(draftToFile(draft), `${draft.id}.json`)}
            data-testid="editor-download"
          >
            Save the file
          </Button>
          <span className="caption">
            Running it adds it to the scenarios in use and starts a new timeline for everyone
            connected.
          </span>
        </div>
        <details>
          <summary className="text-[11px] text-ink-dim hover:text-ink">The file</summary>
          <pre
            className="code mt-1 max-h-64 overflow-auto rounded-control border border-line bg-sunken p-2 text-[11px] leading-relaxed text-ink-dim"
            data-testid="editor-file"
          >
            {fileText}
          </pre>
        </details>
      </div>
    </div>
  );
}

export function ScenarioEditor() {
  const open = useUi((state) => state.openPanel === 'scenario-editor');
  const topology = useTelemetry((state) => state.topology);
  // What was being written survives closing the dialog, for the platform it
  // was written against: what a scenario can name belongs to that platform.
  const [kept, setKept] = useState<{ topologyId: string; state: EditorState } | null>(null);
  const topologyId = topology?.id ?? '';
  const keep = useCallback((state: EditorState) => setKept({ topologyId, state }), [topologyId]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'scenario-editor' : null)}
      title="Write a scenario"
      description="Phases on a timeline, the effects each holds and the events it announces, in the file format the engine reads. A scenario changes figures inside the simulation and nothing else."
      width="max-w-3xl"
    >
      {open && topology && (
        <Editor
          key={topology.id}
          topology={topology}
          initial={kept?.topologyId === topology.id ? kept.state : null}
          onChange={keep}
        />
      )}
    </Dialog>
  );
}

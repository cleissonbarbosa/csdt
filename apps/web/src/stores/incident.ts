/**
 * The incident being written in the editor, on the platform being drawn.
 *
 * A scenario file, edited the way the platform is: every change is a pure
 * function of `lib/scenarioFile.ts`, undoing is keeping the drafts that
 * came before, and a run of changes with one `key` (typing in one field) is
 * one step to undo. It lives beside `useEditor` and closes with it; it
 * holds nothing of the simulation's and acts on nothing until the viewer
 * runs it.
 *
 * One phase is always the one in hand (`phase`): the strip at the foot of
 * the stage shows it, the card edits it, and what its effects are placed
 * on is what the model keeps in front. What the engine said of the files
 * with the scenario in them is kept with the exact text it was asked about.
 */
import type { WorkspaceCheck } from '@aegis/contracts';
import { create } from 'zustand';

import { inOrder, phaseAt, type ScenarioDraft } from '@/lib/scenarioFile';

import { HISTORY_LIMIT } from './editor';

/** What the engine said of one text of the files, or why it could not be asked. */
export interface Checked {
  text: string;
  outcome: WorkspaceCheck | string;
}

export interface IncidentState {
  scenario: ScenarioDraft | null;
  past: ScenarioDraft[];
  future: ScenarioDraft[];
  lastKey: string | null;
  /** The id follows the name until it is typed in by hand or read from a file. */
  idTouched: boolean;
  /** The phase in hand, by key. */
  phase: string | null;
  /** The effect or the flow the card has open, by key. */
  item: string | null;
  /** The services a flow being drawn passes, in the order they were clicked; null when none is. */
  drawing: string[] | null;
  check: Checked | null;

  /** Opens a scenario to write, with nothing to undo, its first phase in hand. */
  open(scenario: ScenarioDraft, idTouched: boolean): void;
  close(): void;
  /** Makes a change. One that changes nothing is not a step. */
  change(next: (scenario: ScenarioDraft) => ScenarioDraft, key?: string): void;
  undo(): void;
  redo(): void;
  selectPhase(key: string | null): void;
  selectItem(key: string | null): void;
  /** Starts, extends or ends (`null`) the flow being drawn. */
  draw(ids: string[] | null): void;
  /** Keeps what the engine said, when it is about the files as they now are. */
  checked(check: Checked, current: string): void;
}

const CLOSED = {
  scenario: null,
  past: [],
  future: [],
  lastKey: null,
  idTouched: false,
  phase: null,
  item: null,
  drawing: null,
  check: null,
} satisfies Partial<IncidentState>;

/** The phase in hand, if it is still there; otherwise the one that holds where it started. */
function keptPhase(
  phase: string | null,
  before: ScenarioDraft | null,
  after: ScenarioDraft,
): string | null {
  if (phase !== null && after.phases.some((entry) => entry.key === phase)) return phase;
  const at = before?.phases.find((entry) => entry.key === phase)?.atMs ?? 0;
  return (phaseAt(after, at) ?? inOrder(after)[0] ?? null)?.key ?? null;
}

/** The effect or flow the card has open, if it is still there. */
function keptItem(item: string | null, after: ScenarioDraft): string | null {
  if (item === null) return null;
  const there =
    after.flows.some((flow) => flow.key === item) ||
    after.phases.some((phase) => phase.effects.some((effect) => effect.key === item));
  return there ? item : null;
}

export const useIncident = create<IncidentState>((set, get) => ({
  ...CLOSED,

  open: (scenario, idTouched) =>
    set({ ...CLOSED, scenario, idTouched, phase: inOrder(scenario)[0]?.key ?? null }),
  close: () => set({ ...CLOSED }),

  change: (next, key) => {
    const { scenario, past, lastKey, phase, item } = get();
    if (!scenario) return;
    const after = next(scenario);
    if (after === scenario) return;
    const coalesce = key !== undefined && key === lastKey;
    set({
      scenario: after,
      past: coalesce ? past : [...past, scenario].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: key ?? null,
      phase: keptPhase(phase, scenario, after),
      item: keptItem(item, after),
    });
  },

  undo: () => {
    const { scenario, past, future, phase, item } = get();
    const before = past[past.length - 1];
    if (!scenario || !before) return;
    set({
      scenario: before,
      past: past.slice(0, -1),
      future: [scenario, ...future],
      lastKey: null,
      phase: keptPhase(phase, scenario, before),
      item: keptItem(item, before),
    });
  },

  redo: () => {
    const { scenario, past, future, phase, item } = get();
    const after = future[0];
    if (!scenario || !after) return;
    set({
      scenario: after,
      past: [...past, scenario].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      lastKey: null,
      phase: keptPhase(phase, scenario, after),
      item: keptItem(item, after),
    });
  },

  selectPhase: (phase) => {
    const { scenario } = get();
    if (!scenario) return;
    set({
      phase: phase !== null && scenario.phases.some((entry) => entry.key === phase) ? phase : null,
      item: null,
      lastKey: null,
    });
  },
  selectItem: (item) => {
    const { scenario } = get();
    set({ item: scenario ? keptItem(item, scenario) : null, lastKey: null });
  },
  draw: (drawing) => set({ drawing }),
  checked: (check, current) => {
    if (check.text === current) set({ check });
  },
}));

export const selectIncidentCanUndo = (state: IncidentState): boolean => state.past.length > 0;
export const selectIncidentCanRedo = (state: IncidentState): boolean => state.future.length > 0;

/**
 * The platform being drawn in the editor, and how far its history goes.
 *
 * While `draft` is set the application is in edit mode: the scene draws the
 * draft (`features/scene/SceneCanvas.tsx`) in the swimlanes, where a piece's
 * column is its tier and its lane its region, and the shell shows the
 * editor's parts in place of the simulation's. Nothing here enters
 * `useTelemetry` or `useUi.selection`, and nothing here acts on the
 * simulation, which runs on untouched behind it until the viewer applies
 * the file.
 *
 * Every change is a pure function of `lib/topologyFile.ts`, so undoing is
 * keeping the drafts that came before. A run of changes with one `key`
 * (typing in one field) is one step to undo.
 *
 * What the engine made of the draft is kept with the exact text of the
 * file it was asked about: an answer about an earlier text is never shown
 * against a later one.
 */
import type { ServiceType, TelemetrySnapshot, Topology } from '@aegis/contracts';
import { create } from 'zustand';

import type { DropSlot } from '@/graphics/layout';
import type { SceneSelection } from '@/graphics/SceneController';
import { draftText, edgeId, type TopologyDraft } from '@/lib/topologyFile';

/** How many steps can be undone. */
export const HISTORY_LIMIT = 100;

/** Where a draft came from: the platform in use, an empty page, or a file. */
export interface Origin {
  kind: 'in-use' | 'blank' | 'file';
  /** The platform's or the file's name, as written. */
  name: string;
}

/** What is being carried over the model. */
export type Carrying =
  | { kind: 'new'; type: ServiceType }
  | { kind: 'move'; id: string }
  | { kind: 'connect'; from: string };

/** What the engine made of one text of the file. */
export type Answer =
  | { text: string; state: 'asking' }
  | { text: string; state: 'ran'; topology: Topology; snapshot: TelemetrySnapshot }
  | { text: string; state: 'refused'; message: string };

/**
 * Where something carried is, while it is carried: the pointer on the page,
 * the slot of the table it would take, and the piece it would be connected
 * to, with the reason when it could not be.
 */
export interface Drag {
  x: number;
  y: number;
  slot: DropSlot | null;
  target: string | null;
  refusal: string | null;
}

/** A change that was not made, and why, as the editor says it. */
export interface Refused {
  message: string;
  /** The services a refused connection would have closed a circle through. */
  circle: string[];
  /** The connection that was asked for and refused, which goes back to where it was drawn from. */
  link?: { from: string; to: string };
}

export interface EditorState {
  draft: TopologyDraft | null;
  origin: Origin | null;
  past: TopologyDraft[];
  future: TopologyDraft[];
  lastKey: string | null;
  /** Draft ids: never the simulation's selection. */
  selection: SceneSelection;
  hovered: string | null;
  carrying: Carrying | null;
  drag: Drag | null;
  refused: Refused | null;
  /** The engine's answer about the draft as it now is, or the last one asked. */
  answer: Answer | null;
  /**
   * The last time the engine ran the draft. It is what the model shows
   * while a change is being asked about; the bar says it is not current.
   */
  lastRun: Extract<Answer, { state: 'ran' }> | null;
  paletteOpen: boolean;

  /** Opens the editor on a draft, with nothing to undo. */
  open(draft: TopologyDraft, origin: Origin): void;
  close(): void;
  /** Makes a change. One that changes nothing is not a step. */
  change(next: (draft: TopologyDraft) => TopologyDraft, key?: string): void;
  undo(): void;
  redo(): void;
  select(selection: SceneSelection): void;
  hover(id: string | null): void;
  carry(carrying: Carrying | null): void;
  setDrag(drag: Drag | null): void;
  refuse(refused: Refused | null): void;
  /** Keeps what the engine said, when it is about the draft as it now is. */
  answered(answer: Answer): void;
  setPalette(open: boolean): void;
}

const CLOSED = {
  draft: null,
  origin: null,
  past: [],
  future: [],
  lastKey: null,
  selection: null,
  hovered: null,
  carrying: null,
  drag: null,
  refused: null,
  answer: null,
  lastRun: null,
  paletteOpen: true,
} satisfies Partial<EditorState>;

/** The selection, if what it names is still in the draft. */
function kept(selection: SceneSelection, draft: TopologyDraft): SceneSelection {
  if (!selection) return null;
  if (selection.kind === 'node') {
    return draft.nodes.some((node) => node.id === selection.id) ? selection : null;
  }
  return draft.edges.some((edge) => edgeId(edge) === selection.id) ? selection : null;
}

export const useEditor = create<EditorState>((set, get) => ({
  ...CLOSED,

  open: (draft, origin) => set({ ...CLOSED, draft, origin }),
  close: () => set({ ...CLOSED }),

  change: (next, key) => {
    const { draft, past, lastKey, selection, hovered } = get();
    if (!draft) return;
    const after = next(draft);
    if (after === draft) return;
    const coalesce = key !== undefined && key === lastKey;
    set({
      draft: after,
      past: coalesce ? past : [...past, draft].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: key ?? null,
      selection: kept(selection, after),
      hovered: hovered && after.nodes.some((node) => node.id === hovered) ? hovered : null,
      refused: null,
    });
  },

  undo: () => {
    const { draft, past, future, selection } = get();
    const before = past[past.length - 1];
    if (!draft || !before) return;
    set({
      draft: before,
      past: past.slice(0, -1),
      future: [draft, ...future],
      lastKey: null,
      selection: kept(selection, before),
      refused: null,
    });
  },

  redo: () => {
    const { draft, past, future, selection } = get();
    const after = future[0];
    if (!draft || !after) return;
    set({
      draft: after,
      past: [...past, draft].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      lastKey: null,
      selection: kept(selection, after),
      refused: null,
    });
  },

  select: (selection) => {
    const { draft } = get();
    set({ selection: draft ? kept(selection, draft) : null, lastKey: null });
  },
  hover: (hovered) => set({ hovered }),
  carry: (carrying) => set(carrying ? { carrying } : { carrying, drag: null }),
  setDrag: (drag) => set({ drag }),
  refuse: (refused) => set({ refused }),
  answered: (answer) => {
    const { draft } = get();
    if (!draft || answer.text !== draftText(draft)) return;
    set(answer.state === 'ran' ? { answer, lastRun: answer } : { answer });
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
}));

export const selectEditing = (state: EditorState): boolean => state.draft !== null;
export const selectCanUndo = (state: EditorState): boolean => state.past.length > 0;
export const selectCanRedo = (state: EditorState): boolean => state.future.length > 0;

/** Whether the editor holds the shell. The scene's bridge asks this everywhere. */
export const editing = (): boolean => useEditor.getState().draft !== null;

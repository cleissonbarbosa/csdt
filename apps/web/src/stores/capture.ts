/**
 * The incident capture being looked at, and how.
 *
 * While `capture` is set the application is in capture mode: the scene draws
 * the capture (`features/scene/SceneCanvas.tsx`) and the shell shows the
 * capture's parts in place of the simulation's. Nothing here enters
 * `useTelemetry` or `useUi.selection`, and nothing here acts on the
 * simulation, which runs on untouched behind it.
 *
 * The store owns the capture's clock. `play()` starts a 200 ms tick, the
 * simulation's own snapshot cadence, and each tick moves the cursor on by
 * `speed` times that much capture time. Components read derived values
 * (`selectStep`, `selectEventCount`), which change only when what is shown
 * changes, not at every tick; only the bar's clock and playhead follow
 * `atMs` itself. The scene reads the store through `subscribe`.
 */
import { create } from 'zustand';

import { bundledCapture } from '@/features/capture/bundled';
import {
  bundledTopologyId,
  defaultSpeed,
  eventsUpTo,
  fileTopologyId,
  MAX_CAPTURE_BYTES,
  readCapture,
  sceneTopologyOf,
  sha256Hex,
  stepAt,
  type Capture,
  type Speed,
} from '@/features/capture/capture';
import type { SceneSelection } from '@/graphics/SceneController';
import type { SceneTopology } from '@/graphics/sceneData';
import { t } from '@/i18n';

/** The clock's tick, in milliseconds of the viewer's time. */
export const TICK_MS = 200;

export type ListTab = 'services' | 'events';

/** A capture that did not open: the bundled one's id (null for a file), and its title or file name. */
export interface Failed {
  id: string | null;
  name: string;
}

export interface CaptureState {
  capture: Capture | null;
  /** The bundled capture's id; null for a capture read from a file. */
  id: string | null;
  /** The name of the file it was read from. */
  fileName: string | null;
  /** The capture as the scene draws it, built once when it is opened. */
  topology: SceneTopology | null;
  /** The cursor, in the capture's own time (UTC milliseconds). */
  atMs: number;
  playing: boolean;
  speed: Speed;
  /** Capture ids: never the simulation's selection. */
  selection: SceneSelection;
  hovered: string | null;
  listOpen: boolean;
  listTab: ListTab;
  detailsOpen: boolean;
  /** Height of the card over the model on a narrow stage, for the scene's insets. */
  cardHeight: number;
  /**
   * Why the last attempt to open a capture failed, naming what it tried to
   * open, as the dialog says it in place and the notice over the stage does
   * when it was asked for elsewhere (the bar's picker, a link, Back).
   */
  error: string | null;
  /** What that attempt tried to open: a bundled capture's id (null for a file), and its title or file name. */
  failed: Failed | null;
  loading: boolean;

  /** Opens a bundled capture, paused at the start of its window. False when it did not open. */
  openBundled(id: string): Promise<boolean>;
  /** Reads a capture from a file in the tab, paused at the start of its window. */
  openFile(file: File): Promise<boolean>;
  close(): void;
  seek(atMs: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  setSpeed(speed: Speed): void;
  select(selection: SceneSelection): void;
  hover(id: string | null): void;
  setList(open: boolean, tab?: ListTab): void;
  setDetails(open: boolean): void;
  setCardHeight(height: number): void;
  clearError(): void;
}

const CLOSED = {
  capture: null,
  id: null,
  fileName: null,
  topology: null,
  atMs: 0,
  playing: false,
  speed: 600,
  selection: null,
  hovered: null,
  listOpen: false,
  listTab: 'services',
  detailsOpen: false,
  error: null,
  failed: null,
  loading: false,
} satisfies Partial<CaptureState>;

/**
 * Every attempt to open (and every close) takes the next token; a load that
 * finishes after a later attempt began is dropped, whatever it found.
 */
let token = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function stopClock(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

export const useCapture = create<CaptureState>((set, get) => {
  const show = (
    capture: Capture,
    id: string | null,
    fileName: string | null,
    topologyId: string,
  ) => {
    stopClock();
    set({
      capture,
      id,
      fileName,
      topology: sceneTopologyOf(capture, topologyId),
      atMs: capture.window.startMs,
      playing: false,
      speed: defaultSpeed(capture),
      selection: null,
      hovered: null,
      listOpen: false,
      listTab: 'services',
      detailsOpen: false,
      error: null,
      failed: null,
      loading: false,
    });
  };
  // Each message is a whole phrase that names what failed, so the notice
  // over the stage says which capture it was without the dialog beside it.
  const fail = (failed: Failed, error: string) => set({ error, failed, loading: false });
  const fileFailed = (file: File, reason: string) =>
    fail(
      { id: null, name: file.name },
      t('“{file}” could not be opened. {reason}', { file: file.name, reason }),
    );

  return {
    ...CLOSED,
    cardHeight: 0,

    openBundled: async (id) => {
      const mine = ++token;
      const entry = bundledCapture(id);
      if (!entry) {
        fail({ id, name: id }, t('There is no incident capture called “{id}”.', { id }));
        return false;
      }
      set({ loading: true, error: null, failed: null });
      const capture = await entry.load().then(readCapture, () => null);
      // Replaced by a later attempt (or a close): whatever it found, it says nothing.
      if (mine !== token) return false;
      if (!capture) {
        fail({ id, name: entry.title }, t('“{title}” could not be read.', { title: entry.title }));
        return false;
      }
      show(capture, id, null, bundledTopologyId(id));
      return true;
    },

    openFile: async (file) => {
      const mine = ++token;
      if (file.size > MAX_CAPTURE_BYTES) {
        fileFailed(file, t('The file is larger than 12 MiB.'));
        return false;
      }
      set({ loading: true, error: null, failed: null });
      let opened: { capture: Capture; sha256: string } | null = null;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length <= MAX_CAPTURE_BYTES) {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          const capture = readCapture(JSON.parse(text));
          if (capture) opened = { capture, sha256: await sha256Hex(bytes) };
        }
      } catch {
        opened = null;
      }
      if (mine !== token) return false;
      if (!opened) {
        fileFailed(file, t('The file is not an incident capture this version can read.'));
        return false;
      }
      show(opened.capture, null, file.name, fileTopologyId(opened.sha256));
      return true;
    },

    close: () => {
      token++;
      stopClock();
      set(CLOSED);
    },

    seek: (atMs) => {
      const { capture } = get();
      if (!capture || !Number.isFinite(atMs)) return;
      const { startMs, endMs } = capture.window;
      set({ atMs: Math.min(endMs, Math.max(startMs, atMs)) });
    },

    play: () => {
      const { capture, atMs } = get();
      if (!capture) return;
      stopClock();
      const { startMs, endMs } = capture.window;
      // Played from its end, a capture starts again.
      set({ playing: true, atMs: atMs >= endMs ? startMs : atMs });
      timer = setInterval(() => {
        const state = get();
        if (!state.capture || !state.playing) {
          stopClock();
          return;
        }
        const end = state.capture.window.endMs;
        const next = Math.min(end, state.atMs + state.speed * TICK_MS);
        if (next >= end) {
          stopClock();
          set({ atMs: end, playing: false });
        } else set({ atMs: next });
      }, TICK_MS);
    },

    pause: () => {
      stopClock();
      if (get().playing) set({ playing: false });
    },

    toggle: () => {
      if (get().playing) get().pause();
      else get().play();
    },

    setSpeed: (speed) => set({ speed }),

    // A selection brings its card, which takes the place of the details.
    select: (selection) =>
      set((state) => ({ selection, detailsOpen: selection ? false : state.detailsOpen })),

    hover: (hovered) => {
      if (get().hovered !== hovered) set({ hovered });
    },

    setList: (listOpen, tab) => set(tab ? { listOpen, listTab: tab } : { listOpen }),

    // The details card is what the right side shows with nothing selected.
    setDetails: (detailsOpen) =>
      set(detailsOpen ? { detailsOpen, selection: null } : { detailsOpen }),

    setCardHeight: (cardHeight) => set({ cardHeight }),

    clearError: () => set({ error: null, failed: null }),
  };
});

/** Whether a capture is open: the application is in capture mode. */
export const selectOpen = (state: CaptureState): boolean => state.capture !== null;

/**
 * Which stretch of the capture the cursor is in (`stepAt`): every reading,
 * the frame and the status are the same until it changes. -1 when closed.
 */
export const selectStep = (state: CaptureState): number =>
  state.capture ? stepAt(state.capture, state.atMs) : -1;

/** How many of the capture's events are at or before the cursor. */
export const selectEventCount = (state: CaptureState): number =>
  state.capture ? eventsUpTo(state.capture, state.atMs) : 0;

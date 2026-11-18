/**
 * An incident capture, in the address and the browser's history.
 *
 * Opening a capture from the interface adds an entry to the history, so the
 * browser's Back leaves it as "Back to the simulation" does. A bundled
 * capture is named in the address (`?capture=<id>`), so the address is a
 * link to it; one read from a file is not, since a file cannot be reached
 * from a link. An address that names a capture is read once, when the page
 * loads, and adds nothing to the history; in an embed it is not read at all.
 *
 * Each entry this file writes is marked in `history.state`: which capture
 * it shows, and how many entries back the simulation it was opened from is
 * (0 when it was not opened from this page: an arrival by link). Everything
 * else in `history.state` is kept as it was, as `urlState.ts` and the
 * session dialog keep this.
 */
import { bundledCapture } from '@/features/capture/bundled';
import { useCapture } from '@/stores/capture';

import { embedFromSearch } from './embed';

/** The query parameter that names a bundled capture. */
export const CAPTURE_PARAM = 'capture';
/** What an entry's state holds: the capture's id, or `FILE` for one read from a file. */
const MARK = 'aegisCapture';
/** How many entries back the simulation is; 0 when this page did not add the entry. */
const BASE = 'aegisCaptureBase';
const FILE = 'file';

type EntryState = Record<string, unknown>;

/** The bundled capture an address asks for, or null. An embed asks for none. */
export function captureIdFromSearch(search: string): string | null {
  if (embedFromSearch(search) !== null) return null;
  const id = new URLSearchParams(search).get(CAPTURE_PARAM);
  return id !== null && bundledCapture(id) ? id : null;
}

/** The query string with `capture` set to `id`, or without it; every other parameter is kept. */
export function searchWithCapture(search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id === null) params.delete(CAPTURE_PARAM);
  else params.set(CAPTURE_PARAM, id);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

function entryState(): EntryState {
  const state: unknown = window.history.state;
  return state !== null && typeof state === 'object' ? { ...(state as EntryState) } : {};
}

function markOf(state: EntryState): string | null {
  const mark = state[MARK];
  return typeof mark === 'string' ? mark : null;
}

function baseOf(state: EntryState): number {
  const base = state[BASE];
  return typeof base === 'number' && Number.isInteger(base) && base > 0 ? base : 0;
}

/** The entry's state without this file's marks. */
function unmarked(state: EntryState): EntryState {
  return Object.fromEntries(Object.entries(state).filter(([key]) => key !== MARK && key !== BASE));
}

function addressWith(id: string | null): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${searchWithCapture(search, id)}${hash}`;
}

/** The last file opened, so Forward can show it again; it is not kept across a reload. */
let lastFile: File | null = null;

/**
 * The entry that shows the open capture: the parts of its address that say
 * which capture it is (the path and the `capture` parameter), its fragment
 * and how far back the simulation is from it, to tell a move within the page
 * (a link to `#main`) from leaving the capture. The rest of the query is
 * left out on purpose: the view is rewritten into the same entry as it
 * changes (`urlState.ts`), and that is not a different place.
 */
let shownAt: { place: string; hash: string; base: number } | null = null;

/** Where an address is, as far as a capture is concerned. */
function placeOf(location: Pick<Location, 'pathname' | 'search'>): string {
  const capture = new URLSearchParams(location.search).get(CAPTURE_PARAM);
  return JSON.stringify([location.pathname, capture]);
}

function remember(): void {
  shownAt = {
    place: placeOf(window.location),
    hash: window.location.hash,
    base: baseOf(entryState()),
  };
}

/**
 * Marks the history for a capture just opened: a new entry when the
 * simulation was showing, the same entry when another capture was, so
 * Back always returns to the simulation.
 */
function record(id: string | null): void {
  const state = entryState();
  const url = addressWith(id);
  const mark = id ?? FILE;
  if (markOf(state) !== null) {
    window.history.replaceState({ ...state, [MARK]: mark }, '', url);
  } else {
    window.history.pushState({ ...state, [MARK]: mark, [BASE]: 1 }, '', url);
  }
  remember();
}

/**
 * Whether the page is an embed, which reaches no capture whatever asks for
 * one: it has no bar to say what a capture is, and no way back from it.
 */
const embedded = () => embedFromSearch(window.location.search) !== null;

/** Opens a bundled capture from the interface; never in an embed. */
export async function openCapture(id: string): Promise<boolean> {
  if (embedded()) return false;
  const opened = await useCapture.getState().openBundled(id);
  if (opened) record(id);
  return opened;
}

/** Opens a capture file from the interface; never in an embed. */
export async function openCaptureFile(file: File): Promise<boolean> {
  if (embedded()) return false;
  const opened = await useCapture.getState().openFile(file);
  if (opened) {
    lastFile = file;
    record(null);
  }
  return opened;
}

/**
 * "Back to the simulation": the history goes back to the entry the capture
 * was opened from, when this page added it; otherwise the entry is rewritten
 * without the capture, so a reload shows the simulation.
 */
export function leaveCapture(): void {
  const state = entryState();
  const base = markOf(state) === null ? 0 : baseOf(state);
  shownAt = null;
  useCapture.getState().close();
  if (base > 0) {
    window.history.go(-base);
    return;
  }
  if (markOf(state) !== null || captureIdFromSearch(window.location.search) !== null) {
    window.history.replaceState(unmarked(state), '', addressWith(null));
  }
}

/** Answers Back and Forward: the capture an entry shows, or the simulation. */
function onPopState(): void {
  const state = entryState();
  // An embed shows the simulation whatever an entry says.
  const mark = embedded() ? null : markOf(state);
  const store = useCapture.getState();
  if (mark === null) {
    // A link to a part of the page (`#main`) adds an entry that still
    // shows the capture: it is marked as one, one step further from the
    // simulation, so leaving still lands there.
    if (
      store.capture !== null &&
      shownAt !== null &&
      shownAt.place === placeOf(window.location) &&
      shownAt.hash !== window.location.hash
    ) {
      const base = shownAt.base > 0 ? shownAt.base + 1 : 0;
      window.history.replaceState(
        { ...state, [MARK]: store.id ?? FILE, [BASE]: base },
        '',
        window.location.href,
      );
      remember();
      return;
    }
    shownAt = null;
    if (store.capture !== null || store.loading) store.close();
    return;
  }
  remember();
  if (mark === FILE) {
    if (store.capture !== null && store.id === null) return;
    if (lastFile) {
      void store.openFile(lastFile);
      return;
    }
    // The file is not in this page any more: the entry shows the simulation.
    window.history.replaceState(unmarked(state), '', window.location.href);
    shownAt = null;
    store.close();
    return;
  }
  if (store.id === mark && store.capture !== null) return;
  if (bundledCapture(mark)) void store.openBundled(mark);
  else store.close();
}

/**
 * Reads the address once and follows the history from then on. Returns
 * what stops following it. The page calls it once, before it is drawn.
 */
export function followCaptureAddress(): () => void {
  const asked = captureIdFromSearch(window.location.search);
  if (asked !== null) {
    // An arrival by link: the entry is marked, not added to.
    const state = entryState();
    window.history.replaceState({ ...state, [MARK]: asked, [BASE]: 0 }, '', window.location.href);
    remember();
    void useCapture.getState().openBundled(asked);
  }
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
}

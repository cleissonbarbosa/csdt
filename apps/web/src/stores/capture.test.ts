import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { frameAt, MAX_CAPTURE_BYTES, statusAt, stepAt } from '@/features/capture/capture';
import google from '@/features/capture/google-cloud-2025-06-12.json';

import { bundledCapture } from '@/features/capture/bundled';

import { selectEventCount, selectOpen, selectStep, TICK_MS, useCapture } from './capture';
import { useTelemetry } from './telemetry';
import { useUi } from './ui';

const GOOGLE = 'google-cloud-2025-06-12';
const BOUTIQUE = 'online-boutique-rcaeval';

function fileOf(text: string, name = 'capture.json'): File {
  const bytes = new TextEncoder().encode(text);
  // Only what the store reads of a file.
  return {
    name,
    size: bytes.length,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
  } as unknown as File;
}

afterEach(() => {
  useCapture.getState().close();
  vi.useRealTimers();
});

describe('opening a capture', () => {
  it('opens a bundled one paused at the start of its window, at its default speed', async () => {
    expect(await useCapture.getState().openBundled(GOOGLE)).toBe(true);
    const state = useCapture.getState();
    expect(selectOpen(state)).toBe(true);
    expect(state.id).toBe(GOOGLE);
    expect(state.fileName).toBeNull();
    expect(state.atMs).toBe(google.window.startMs);
    expect(state.playing).toBe(false);
    expect(state.speed).toBe(600);
    expect(state.topology?.id).toBe(`capture:${GOOGLE}`);
    expect(state.topology?.nodes).toHaveLength(google.nodes.length);
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('keeps only the last of several attempts, whichever finishes first', async () => {
    const first = useCapture.getState().openBundled(GOOGLE);
    const second = useCapture.getState().openBundled(BOUTIQUE);
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(useCapture.getState().id).toBe(BOUTIQUE);
  });

  it('drops a load that finishes after the capture was closed', async () => {
    const opening = useCapture.getState().openBundled(GOOGLE);
    useCapture.getState().close();
    expect(await opening).toBe(false);
    expect(useCapture.getState().capture).toBeNull();
  });

  it('reads a file, named by the SHA-256 of its bytes', async () => {
    const text = JSON.stringify(google);
    expect(await useCapture.getState().openFile(fileOf(text, 'outage.json'))).toBe(true);
    const state = useCapture.getState();
    const sha = createHash('sha256').update(text).digest('hex');
    expect(state.topology?.id).toBe(`capture:file:${sha}`);
    expect(state.id).toBeNull();
    expect(state.fileName).toBe('outage.json');
  });

  it('says why a file did not open, without throwing, and keeps what was open', async () => {
    await useCapture.getState().openBundled(BOUTIQUE);
    const big = {
      name: 'big.json',
      size: MAX_CAPTURE_BYTES + 1,
      arrayBuffer: () => Promise.reject(new Error('must not be read')),
    } as unknown as File;
    expect(await useCapture.getState().openFile(big)).toBe(false);
    expect(useCapture.getState().error).toBe(
      '“big.json” could not be opened. The file is larger than 12 MiB.',
    );
    expect(useCapture.getState().failed).toEqual({ id: null, name: 'big.json' });
    expect(useCapture.getState().id).toBe(BOUTIQUE);

    for (const text of [
      '{',
      '{"kind":"aegis-cloud-replay"}',
      JSON.stringify({ ...google, version: 2 }),
    ]) {
      expect(await useCapture.getState().openFile(fileOf(text))).toBe(false);
      expect(useCapture.getState().error).toBe(
        '“capture.json” could not be opened. The file is not an incident capture this version can read.',
      );
    }
    const invalid = {
      name: 'x.json',
      size: 2,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0xff, 0xfe]).buffer),
    };
    expect(await useCapture.getState().openFile(invalid as unknown as File)).toBe(false);
    expect(useCapture.getState().loading).toBe(false);
    expect(useCapture.getState().id).toBe(BOUTIQUE);
    useCapture.getState().clearError();
    expect(useCapture.getState().error).toBeNull();
    expect(useCapture.getState().failed).toBeNull();
  });

  it('names the capture that did not open, and forgets it once one does', async () => {
    const load = vi.spyOn(bundledCapture(GOOGLE)!, 'load');
    try {
      load.mockRejectedValueOnce(new Error('chunk failed'));
      expect(await useCapture.getState().openBundled(GOOGLE)).toBe(false);
      // Its title as the file writes it, in a whole phrase.
      expect(useCapture.getState().error).toBe(
        '“Google Cloud outage · 12 June 2025” could not be read.',
      );
      expect(useCapture.getState().failed).toEqual({
        id: GOOGLE,
        name: 'Google Cloud outage · 12 June 2025',
      });
      // A file the reader cannot take is refused as well: what it held is
      // no capture of this version.
      load.mockResolvedValueOnce({ kind: 'aegis-cloud-replay' });
      expect(await useCapture.getState().openBundled(GOOGLE)).toBe(false);
      expect(useCapture.getState().failed?.id).toBe(GOOGLE);
    } finally {
      load.mockRestore();
    }
    expect(await useCapture.getState().openBundled('no-such-capture')).toBe(false);
    expect(useCapture.getState().error).toBe(
      'There is no incident capture called “no-such-capture”.',
    );
    expect(useCapture.getState().failed).toEqual({
      id: 'no-such-capture',
      name: 'no-such-capture',
    });

    expect(await useCapture.getState().openBundled(BOUTIQUE)).toBe(true);
    expect(useCapture.getState().error).toBeNull();
    expect(useCapture.getState().failed).toBeNull();
  });

  it('says nothing of a load that failed after a later attempt began', async () => {
    const load = vi.spyOn(bundledCapture(GOOGLE)!, 'load');
    try {
      let refuse: (reason: Error) => void = () => {};
      load.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
      const first = useCapture.getState().openBundled(GOOGLE);
      const second = useCapture.getState().openBundled(BOUTIQUE);
      expect(await second).toBe(true);
      refuse(new Error('chunk failed'));
      expect(await first).toBe(false);
      expect(useCapture.getState().error).toBeNull();
      expect(useCapture.getState().failed).toBeNull();
      expect(useCapture.getState().id).toBe(BOUTIQUE);

      // Nor of one replaced by a close.
      load.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
      const third = useCapture.getState().openBundled(GOOGLE);
      useCapture.getState().close();
      refuse(new Error('chunk failed'));
      expect(await third).toBe(false);
      expect(useCapture.getState().error).toBeNull();
    } finally {
      load.mockRestore();
    }
  });

  it('touches neither the simulation’s selection nor its telemetry', async () => {
    const telemetry = useTelemetry.getState();
    const selection = useUi.getState().selection;
    await useCapture.getState().openBundled(GOOGLE);
    useCapture.getState().select({ kind: 'node', id: 'iam' });
    useCapture.getState().hover('iam');
    useCapture.getState().seek(google.window.endMs);
    expect(useUi.getState().selection).toBe(selection);
    expect(useUi.getState().hoveredNodeId).toBeNull();
    expect(useTelemetry.getState()).toBe(telemetry);
  });
});

describe('the capture’s clock', () => {
  it('moves the cursor on by its speed every 200 ms, and stops at the end', async () => {
    await useCapture.getState().openBundled(BOUTIQUE);
    vi.useFakeTimers();
    const { startMs, endMs } = useCapture.getState().capture!.window;
    useCapture.getState().play();
    expect(useCapture.getState().playing).toBe(true);
    vi.advanceTimersByTime(TICK_MS);
    expect(useCapture.getState().atMs).toBe(startMs + 10 * TICK_MS);
    useCapture.getState().setSpeed(600);
    vi.advanceTimersByTime(TICK_MS);
    expect(useCapture.getState().atMs).toBe(startMs + 10 * TICK_MS + 600 * TICK_MS);
    vi.advanceTimersByTime(10_000);
    expect(useCapture.getState().atMs).toBe(endMs);
    expect(useCapture.getState().playing).toBe(false);
    // Played from its end, it starts again.
    useCapture.getState().toggle();
    expect(useCapture.getState().atMs).toBe(startMs);
    expect(useCapture.getState().playing).toBe(true);
  });

  it('ends playback on a frame that still holds the last measurements', async () => {
    await useCapture.getState().openBundled(BOUTIQUE);
    vi.useFakeTimers();
    const capture = useCapture.getState().capture!;
    useCapture.getState().play();
    vi.advanceTimersByTime(capture.window.endMs - capture.window.startMs);
    expect(useCapture.getState()).toMatchObject({ playing: false, atMs: capture.window.endMs });
    const atMs = useCapture.getState().atMs;
    expect(frameAt(capture, atMs)).toEqual(frameAt(capture, atMs - 1));
    expect(frameAt(capture, atMs).nodes.measured.some((measured) => measured === 1)).toBe(true);
    expect(statusAt(capture, atMs)).toMatchObject({ measuredNow: true });
    // End, as the bar's key takes it, is the same moment.
    useCapture.getState().seek(Number.MAX_SAFE_INTEGER);
    expect(statusAt(capture, useCapture.getState().atMs)).toEqual(statusAt(capture, atMs));
  });

  it('stops when paused and when closed', async () => {
    await useCapture.getState().openBundled(BOUTIQUE);
    vi.useFakeTimers();
    useCapture.getState().play();
    vi.advanceTimersByTime(TICK_MS);
    useCapture.getState().pause();
    const paused = useCapture.getState().atMs;
    vi.advanceTimersByTime(5 * TICK_MS);
    expect(useCapture.getState().atMs).toBe(paused);
    useCapture.getState().play();
    useCapture.getState().close();
    vi.advanceTimersByTime(5 * TICK_MS);
    expect(useCapture.getState()).toMatchObject({ capture: null, playing: false, atMs: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a seek inside the window', async () => {
    await useCapture.getState().openBundled(GOOGLE);
    const { startMs, endMs } = google.window;
    useCapture.getState().seek(0);
    expect(useCapture.getState().atMs).toBe(startMs);
    useCapture.getState().seek(endMs + 1e9);
    expect(useCapture.getState().atMs).toBe(endMs);
    useCapture.getState().seek(Number.NaN);
    expect(useCapture.getState().atMs).toBe(endMs);
  });

  it('changes what components read only when what is shown changes', async () => {
    await useCapture.getState().openBundled(GOOGLE);
    const state = () => useCapture.getState();
    const step = selectStep(state());
    const events = selectEventCount(state());
    expect(events).toBe(1);
    // A minute on, between two events: nothing a component reads has changed.
    useCapture.getState().seek(google.window.startMs + 60_000);
    expect(selectStep(state())).toBe(step);
    expect(selectEventCount(state())).toBe(1);
    // The next event (17:49) changes both.
    useCapture.getState().seek(google.events[1]!.atMs);
    expect(selectStep(state())).toBe(step + 1);
    expect(selectEventCount(state())).toBe(2);
    expect(selectStep(state())).toBe(stepAt(state().capture!, state().atMs));
    useCapture.getState().close();
    expect(selectStep(state())).toBe(-1);
    expect(selectEventCount(state())).toBe(0);
  });
});

describe('what the viewer has in hand', () => {
  it('brings a selection’s card in place of the details, and the details in place of it', async () => {
    await useCapture.getState().openBundled(GOOGLE);
    useCapture.getState().setDetails(true);
    expect(useCapture.getState().detailsOpen).toBe(true);
    useCapture.getState().select({ kind: 'node', id: 'iam' });
    expect(useCapture.getState()).toMatchObject({
      detailsOpen: false,
      selection: { kind: 'node', id: 'iam' },
    });
    useCapture.getState().setDetails(true);
    expect(useCapture.getState().selection).toBeNull();
    useCapture.getState().setList(true, 'events');
    expect(useCapture.getState()).toMatchObject({ listOpen: true, listTab: 'events' });
    useCapture.getState().setList(false);
    expect(useCapture.getState()).toMatchObject({ listOpen: false, listTab: 'events' });
  });

  it('is let go of when another capture is opened, and when it is closed', async () => {
    await useCapture.getState().openBundled(GOOGLE);
    useCapture.getState().select({ kind: 'node', id: 'iam' });
    useCapture.getState().hover('iam');
    useCapture.getState().setList(true);
    await useCapture.getState().openBundled(BOUTIQUE);
    expect(useCapture.getState()).toMatchObject({
      selection: null,
      hovered: null,
      listOpen: false,
    });
    useCapture.getState().close();
    expect(useCapture.getState()).toMatchObject({
      capture: null,
      topology: null,
      selection: null,
      error: null,
    });
  });
});

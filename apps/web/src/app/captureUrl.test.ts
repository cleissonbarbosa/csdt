import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import google from '@/features/capture/google-cloud-2025-06-12.json';
import { useCapture } from '@/stores/capture';

import {
  captureIdFromSearch,
  followCaptureAddress,
  leaveCapture,
  openCapture,
  openCaptureFile,
  searchWithCapture,
} from './captureUrl';

const GOOGLE = 'google-cloud-2025-06-12';
const BOUTIQUE = 'online-boutique-rcaeval';

const shown = () => useCapture.getState().id;
const open = () => useCapture.getState().capture !== null;
const address = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

function fileOf(text: string): File {
  const bytes = new TextEncoder().encode(text);
  return {
    name: 'outage.json',
    size: bytes.length,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
  } as unknown as File;
}

let stop: (() => void) | null = null;

beforeEach(() => {
  window.history.replaceState(null, '', '/?arrangement=regions');
});

afterEach(() => {
  stop?.();
  stop = null;
  useCapture.getState().close();
});

describe('an address that names a capture', () => {
  it('names a bundled one, and only outside an embed', () => {
    expect(captureIdFromSearch(`?capture=${GOOGLE}`)).toBe(GOOGLE);
    expect(captureIdFromSearch(`?arrangement=regions&capture=${BOUTIQUE}`)).toBe(BOUTIQUE);
    expect(captureIdFromSearch('?capture=')).toBeNull();
    expect(captureIdFromSearch('?capture=../../etc/passwd')).toBeNull();
    expect(captureIdFromSearch('?capture=Google%20Cloud%20outage')).toBeNull();
    expect(captureIdFromSearch(`?embed=1&capture=${GOOGLE}`)).toBeNull();
    expect(captureIdFromSearch(`?embed=0&capture=${GOOGLE}`)).toBe(GOOGLE);
  });

  it('is written keeping every other parameter', () => {
    expect(searchWithCapture('?arrangement=regions', GOOGLE)).toBe(
      `?arrangement=regions&capture=${GOOGLE}`,
    );
    expect(searchWithCapture(`?capture=${GOOGLE}&view=table`, null)).toBe('?view=table');
    expect(searchWithCapture(`?capture=${GOOGLE}`, null)).toBe('');
  });

  it('opens the capture when the page loads, without adding to the history', async () => {
    window.history.replaceState({ kept: true }, '', `/?arrangement=regions&capture=${BOUTIQUE}`);
    const length = window.history.length;
    stop = followCaptureAddress();
    await vi.waitFor(() => expect(shown()).toBe(BOUTIQUE));
    expect(window.history.length).toBe(length);
    expect(window.history.state).toMatchObject({ kept: true });

    // Leaving rewrites this entry: a reload then shows the simulation.
    leaveCapture();
    expect(open()).toBe(false);
    expect(address()).toBe('/?arrangement=regions');
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ kept: true });
  });

  it('opens nothing in an embed', async () => {
    window.history.replaceState(null, '', `/?embed=1&capture=${GOOGLE}`);
    stop = followCaptureAddress();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(open()).toBe(false);
    expect(useCapture.getState().loading).toBe(false);
  });

  it('is not reached in an embed from the interface or the history either', async () => {
    window.history.replaceState(null, '', '/?embed=1');
    stop = followCaptureAddress();
    const length = window.history.length;
    expect(await openCapture(GOOGLE)).toBe(false);
    expect(await openCaptureFile(fileOf(JSON.stringify(google)))).toBe(false);
    expect(open()).toBe(false);
    expect(window.history.length).toBe(length);
    expect(address()).toBe('/?embed=1');
    // An entry that names a capture is shown as the simulation.
    const entry = { aegisCapture: GOOGLE, aegisCaptureBase: 1 };
    window.history.replaceState(entry, '', '/?embed=1');
    window.dispatchEvent(new PopStateEvent('popstate', { state: entry }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(open()).toBe(false);
    expect(useCapture.getState().loading).toBe(false);
  });
});

describe('a capture opened from the interface', () => {
  it('adds one entry to the history, which Back leaves', async () => {
    stop = followCaptureAddress();
    const length = window.history.length;
    expect(await openCapture(GOOGLE)).toBe(true);
    expect(window.history.length).toBe(length + 1);
    expect(address()).toBe(`/?arrangement=regions&capture=${GOOGLE}`);

    // Another capture takes the same entry: Back still goes to the simulation.
    expect(await openCapture(BOUTIQUE)).toBe(true);
    expect(window.history.length).toBe(length + 1);
    expect(address()).toBe(`/?arrangement=regions&capture=${BOUTIQUE}`);

    window.history.back();
    await vi.waitFor(() => expect(open()).toBe(false));
    expect(address()).toBe('/?arrangement=regions');

    // Forward shows it again; Back leaves it again.
    window.history.forward();
    await vi.waitFor(() => expect(shown()).toBe(BOUTIQUE));
    window.history.back();
    await vi.waitFor(() => expect(open()).toBe(false));
  });

  it('is left by "Back to the simulation" as by the browser’s Back', async () => {
    stop = followCaptureAddress();
    await openCapture(GOOGLE);
    leaveCapture();
    expect(open()).toBe(false);
    await vi.waitFor(() => expect(address()).toBe('/?arrangement=regions'));
    window.history.forward();
    await vi.waitFor(() => expect(shown()).toBe(GOOGLE));
  });

  it('keeps a file out of the address, and shows it again on Forward', async () => {
    stop = followCaptureAddress();
    const length = window.history.length;
    expect(await openCaptureFile(fileOf(JSON.stringify(google)))).toBe(true);
    expect(window.history.length).toBe(length + 1);
    expect(address()).toBe('/?arrangement=regions');
    expect(useCapture.getState().fileName).toBe('outage.json');

    window.history.back();
    await vi.waitFor(() => expect(open()).toBe(false));
    window.history.forward();
    await vi.waitFor(() => expect(useCapture.getState().fileName).toBe('outage.json'));
  });

  it('adds nothing when it does not open', async () => {
    stop = followCaptureAddress();
    const length = window.history.length;
    expect(await openCaptureFile(fileOf('{'))).toBe(false);
    expect(window.history.length).toBe(length);
    expect(window.history.state).toBeNull();
  });

  it('stays open across a link to a part of the page, and is still left in one step', async () => {
    stop = followCaptureAddress();
    await openCapture(GOOGLE);
    // What following `#main` does: a new entry, and a popstate without state.
    window.history.pushState(null, '', `${address()}#main`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(shown()).toBe(GOOGLE);
    expect(window.history.state).toMatchObject({ aegisCapture: GOOGLE, aegisCaptureBase: 2 });

    leaveCapture();
    await vi.waitFor(() => expect(address()).toBe('/?arrangement=regions'));
    expect(open()).toBe(false);
  });

  it('stays open across a link to a part of the page after the view was written into the address', async () => {
    stop = followCaptureAddress();
    await openCapture(GOOGLE);
    // What `useUrlView` does when T switches to the table: the same entry, rewritten.
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}&view=table${window.location.hash}`,
    );
    expect(address()).toBe(`/?arrangement=regions&capture=${GOOGLE}&view=table`);
    window.history.pushState(null, '', `${address()}#main`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(shown()).toBe(GOOGLE);
    expect(window.history.state).toMatchObject({ aegisCapture: GOOGLE, aegisCaptureBase: 2 });

    // Leaving is still one step, back to where the capture was opened from.
    leaveCapture();
    await vi.waitFor(() => expect(address()).toBe('/?arrangement=regions'));
    expect(open()).toBe(false);
  });

  it('does the same for a file, and still closes it on Back after the view changed', async () => {
    stop = followCaptureAddress();
    await openCaptureFile(fileOf(JSON.stringify(google)));
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}&view=table`,
    );
    window.history.pushState(null, '', `${address()}#main`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(open()).toBe(true);
    expect(window.history.state).toMatchObject({ aegisCapture: 'file', aegisCaptureBase: 2 });

    // Back to the capture's own entry keeps it; one more Back reaches the simulation.
    window.history.back();
    await vi.waitFor(() => expect(window.location.hash).toBe(''));
    expect(open()).toBe(true);
    window.history.back();
    await vi.waitFor(() => expect(open()).toBe(false));
    expect(address()).toBe('/?arrangement=regions');
  });
});

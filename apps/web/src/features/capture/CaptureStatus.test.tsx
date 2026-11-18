/**
 * The bar's sentence as the capture plays: what it says is worked out and
 * read out where the capture changes, not at every tick of the clock. A
 * Profiler around the sentence would count its minute too, which follows
 * the clock on purpose, so the sentence's own work is counted where it is
 * done (`statusAt`) and what assistive technology is told is counted in the
 * live region itself.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TICK_MS, useCapture } from '@/stores/capture';

import { statusAt } from './capture';
import { CaptureStatus } from './CaptureStatus';

vi.mock('./capture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./capture')>();
  return { ...actual, statusAt: vi.fn(actual.statusAt) };
});

const GOOGLE = 'google-cloud-2025-06-12';

afterEach(() => {
  act(() => useCapture.getState().close());
  vi.useRealTimers();
  vi.mocked(statusAt).mockClear();
});

/** Moves the capture's clock on by so many ticks, one at a time. */
function tick(times: number) {
  for (let i = 0; i < times; i++) act(() => vi.advanceTimersByTime(TICK_MS));
}

describe('the bar’s sentence, while the capture plays', () => {
  it('is worked out and read out only where the capture changes', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    // The Google capture opens at 600×: each tick moves the cursor two minutes.
    expect(useCapture.getState().speed).toBe(600);
    render(<CaptureStatus />);
    const button = screen.getByTestId('capture-status');
    const said = screen.getByRole('status');
    expect(said).toBe(screen.getByTestId('capture-status-said'));
    expect(said).toHaveAttribute('aria-live', 'polite');
    expect(said).toHaveAttribute('aria-atomic', 'true');
    // The live region holds what the capture says, not the minute before it.
    expect(said).toHaveTextContent(/^12 services, none stated yet in the report$/);
    expect(button.contains(said)).toBe(false);

    // What the live region was told since the last look: its text, if it changed.
    let delivered = 0;
    const observer = new MutationObserver((records) => (delivered += records.length));
    observer.observe(said, { childList: true, characterData: true, subtree: true });
    const told = (): string[] => {
      const changes = delivered + observer.takeRecords().length;
      delivered = 0;
      return changes > 0 ? [said.textContent ?? ''] : [];
    };

    vi.useFakeTimers();
    act(() => useCapture.getState().play());
    // 17:45 → 17:51, past 17:49, when the report has six services fail.
    tick(3);
    expect(button).toHaveTextContent('At 17:51 UTC: 6 services reported affected; 6 not stated');
    expect(told()).toEqual(['6 services reported affected; 6 not stated']);

    // Ten ticks to 18:11, with no change in the capture: the minute moves on
    // every tick, and the sentence is neither worked out nor read out again.
    vi.mocked(statusAt).mockClear();
    tick(10);
    expect(button).toHaveTextContent('At 18:11 UTC: 6 services reported affected; 6 not stated');
    expect(statusAt).not.toHaveBeenCalled();
    expect(told()).toEqual([]);

    // Past ~18:14, an update that states no service: a change of the
    // capture, worked out once, but nothing new to say.
    tick(2);
    expect(statusAt).toHaveBeenCalledTimes(1);
    expect(told()).toEqual([]);

    // Past ~18:29, when the policy store in Iowa is reported affected.
    vi.mocked(statusAt).mockClear();
    tick(8);
    expect(button).toHaveTextContent('At 18:31 UTC: 7 services reported affected; 5 not stated');
    expect(statusAt).toHaveBeenCalledTimes(1);
    expect(told()).toEqual(['7 services reported affected; 5 not stated']);
    observer.disconnect();
  });

  it('stops saying anything when the capture is closed', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    render(<CaptureStatus />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => useCapture.getState().close());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('capture-status')).not.toBeInTheDocument();
  });
});

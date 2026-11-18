import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Track } from './Track';

function renderTrack(overrides: Partial<React.ComponentProps<typeof Track>> = {}) {
  const onSeek = vi.fn();
  render(
    <Track
      startMs={0}
      endMs={100_000}
      cursorMs={40_000}
      formatTime={(ms) => `t${ms / 1000}`}
      valueText={(ms) => `at ${ms / 1000}`}
      steps={{ small: 1_000, large: 10_000 }}
      onSeek={onSeek}
      {...overrides}
    >
      {(xOf) => <rect data-testid="layer" x={xOf(50_000)} />}
    </Track>,
  );
  return { onSeek, track: screen.getByRole('slider', { name: 'Timeline position' }) };
}

describe('the track', () => {
  it('reads out where the cursor is, between its two ends', () => {
    const { track } = renderTrack();
    expect(track).toHaveAttribute('data-testid', 'timeline-track');
    expect(track).toHaveAttribute('aria-valuemin', '0');
    expect(track).toHaveAttribute('aria-valuemax', '100');
    expect(track).toHaveAttribute('aria-valuenow', '40');
    expect(track).toHaveAttribute('aria-valuetext', 'at 40');
    expect(track).toHaveTextContent('t0');
    expect(track).toHaveTextContent('t100');
  });

  it('hands what is drawn on it the place of a moment across it', () => {
    renderTrack();
    // jsdom has no layout: the track is as wide as its least.
    expect(screen.getByTestId('layer')).toHaveAttribute('x', '60');
  });

  it('steps from the keyboard, by its own steps, within its ends', async () => {
    const user = userEvent.setup();
    const { onSeek, track } = renderTrack();
    track.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSeek).toHaveBeenLastCalledWith(41_000, 'key');
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(onSeek).toHaveBeenLastCalledWith(30_000, 'key');
    await user.keyboard('{Home}');
    expect(onSeek).toHaveBeenLastCalledWith(0, 'key');
    await user.keyboard('{End}');
    expect(onSeek).toHaveBeenLastCalledWith(100_000, 'key');
  });

  it('leaves End to whoever owns the time, when asked to', async () => {
    const user = userEvent.setup();
    const onEnd = vi.fn();
    const { onSeek, track } = renderTrack({ onEnd, cursorMs: 99_500 });
    track.focus();
    await user.keyboard('{End}');
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onSeek).not.toHaveBeenCalled();
    await user.keyboard('{ArrowRight}');
    expect(onSeek).toHaveBeenLastCalledWith(100_000, 'key');
  });

  it('says how a drag goes: pressed, moved and let go', () => {
    const { onSeek, track } = renderTrack();
    track.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 18, right: 200, bottom: 18 }) as DOMRect;
    fireEvent.pointerDown(track, { clientX: 50, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(25_000, 'start');
    expect(track).toHaveAttribute('data-dragging', 'true');
    fireEvent.pointerMove(track, { clientX: 100, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(50_000, 'move');
    fireEvent.pointerUp(track, { clientX: 150, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(75_000, 'end');
    expect(track).toHaveAttribute('data-dragging', 'false');
  });

  it('has no layer of marks unless it is given one', () => {
    renderTrack();
    expect(screen.queryByTestId('timeline-marks')).not.toBeInTheDocument();
  });

  it('lays marks that keep their shape over its picture, under the cursor', () => {
    const { track } = renderTrack({
      marks: (fractionOf) => (
        <span data-testid="mark" style={{ left: `${fractionOf(25_000) * 100}%` }} />
      ),
    });
    const layer = screen.getByTestId('timeline-marks');
    const drawing = track.querySelector(':scope > svg')!;
    // The picture is stretched to the track's height; the marks are not in it.
    expect(drawing).toHaveAttribute('preserveAspectRatio', 'none');
    expect(drawing.contains(screen.getByTestId('mark'))).toBe(false);
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.className).toMatch(/pointer-events-none/);
    // Placed by how far across the track their moment is.
    expect(screen.getByTestId('mark').style.left).toBe('25%');
    // Before the picture, so the cursor and the shade of what is to come lie over them.
    expect(layer.compareDocumentPosition(drawing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

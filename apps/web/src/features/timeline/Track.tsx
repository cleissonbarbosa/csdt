import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { t } from '@/i18n';
import { COLOR } from '@/lib/palette';

/** Height of the open track; closed, it is the same drawing pressed flat. */
export const TRACK_HEIGHT = 60;

/** How a move of the cursor came about: a pointer pressed, dragged or let go, or a key. */
export type SeekPhase = 'start' | 'move' | 'end' | 'key';

function useWidth(): [React.RefCallback<HTMLElement>, number] {
  const [width, setWidth] = useState(600);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!element || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(120, entry.contentRect.width));
    });
    observer.current.observe(element);
    setWidth(Math.max(120, element.clientWidth));
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width];
}

export interface TrackProps {
  /** The first moment the track reaches, and the last. */
  startMs: number;
  endMs: number;
  /** Where the cursor is; while the track is dragged it is drawn where the pointer is. */
  cursorMs: number;
  /** A moment as the ends of the track say it. */
  formatTime: (ms: number) => string;
  /** Where the cursor is, as the slider reads it out. */
  valueText: (cursorMs: number) => string;
  /** How far an arrow key moves the cursor, and how far with Shift. */
  steps: { small: number; large: number };
  /** Moves the cursor. Whoever owns the time decides how often to act on `move`. */
  onSeek: (ms: number, phase: SeekPhase) => void;
  /** The End key. Without it, End moves the cursor to the end of the track. */
  onEnd?: () => void;
  /** What is drawn on the track, under the cursor, given where a moment is across it. */
  children?: (xOf: (ms: number) => number, width: number) => ReactNode;
  /**
   * Marks that keep their own shape whatever the track's height. The
   * drawing above is pressed flat while the track is closed, which turns a
   * square into a bar; these are laid over it at their own size, each placed
   * by how far across the track its moment is (0 to 1), given the track's
   * width in pixels. They lie under the cursor and the shade of what is
   * still to come, as the drawing does.
   */
  marks?: (fractionOf: (ms: number) => number, width: number) => ReactNode;
  /**
   * The moments those marks stand at. Where the track is short (a phone) the
   * times at its ends are printed in the marks' row, and one with a mark in
   * its place stands aside rather than be printed over it.
   */
  marked?: readonly number[];
}

/** The room a time at an end of the track takes from its edge, in pixels: inset, digits, a mark's half. */
const endRoom = (text: string) => 6 + text.length * 6.5 + 6;

/**
 * The scrubber: what happened along a stretch of time, and the playhead.
 *
 * At rest it is a strip a few pixels tall: enough to see where the cursor is
 * and where the incidents were. Reaching for it (pointer, keyboard focus or a
 * drag) opens it upward into the full chart. The drawing is the same in both
 * states, scaled, so it grows rather than being swapped.
 *
 * It owns no time of its own: the simulation's timeline and an incident
 * capture each hand it their span and cursor, draw what is on it, and are
 * told where the viewer moved the cursor.
 */
export function Track({
  startMs: start,
  endMs: head,
  cursorMs,
  formatTime,
  valueText,
  steps,
  onSeek,
  onEnd,
  children,
  marks,
  marked,
}: TrackProps) {
  const [ref, width] = useWidth();
  const dragging = useRef(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [held, setHeld] = useState(false);

  const span = Math.max(1, head - start);
  const xOf = useCallback((ms: number) => ((ms - start) / span) * width, [start, span, width]);
  const fractionOf = useCallback((ms: number) => (ms - start) / span, [start, span]);

  const timeAt = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return start + ratio * span;
  };

  const cursor = preview ?? cursorMs;
  const startText = formatTime(start);
  const endText = formatTime(head);
  const startCrowded = marked?.some((ms) => xOf(ms) < endRoom(startText)) ?? false;
  const endCrowded = marked?.some((ms) => xOf(ms) > width - endRoom(endText)) ?? false;
  const step = (delta: number) => onSeek(Math.min(head, Math.max(start, cursorMs + delta)), 'key');

  return (
    // The slot keeps the strip's place in the bar; the track is anchored to
    // its bottom edge and grows out of it.
    <div
      ref={ref}
      className="timeline-slot relative h-[18px] min-w-24 flex-1 py-0 max-sm:order-last max-sm:h-7 max-sm:basis-full"
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('Timeline position')}
        aria-orientation="horizontal"
        aria-valuemin={Math.round(start / 1000)}
        aria-valuemax={Math.round(head / 1000)}
        aria-valuenow={Math.round(cursor / 1000)}
        aria-valuetext={valueText(cursor)}
        data-testid="timeline-track"
        data-dragging={held}
        className="timeline-track absolute inset-x-0 bottom-0 cursor-ew-resize touch-none select-none overflow-hidden rounded-control border border-line bg-sunken"
        onPointerDown={(event) => {
          dragging.current = true;
          setHeld(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          const at = timeAt(event.clientX, event.currentTarget);
          setPreview(at);
          onSeek(at, 'start');
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const at = timeAt(event.clientX, event.currentTarget);
          setPreview(at);
          onSeek(at, 'move');
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          setHeld(false);
          onSeek(timeAt(event.clientX, event.currentTarget), 'end');
          setPreview(null);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setHeld(false);
          setPreview(null);
        }}
        onKeyDown={(event) => {
          const big = event.shiftKey ? steps.large : steps.small;
          if (event.key === 'ArrowLeft') step(-big);
          else if (event.key === 'ArrowRight') step(big);
          else if (event.key === 'Home') onSeek(start, 'key');
          else if (event.key === 'End') {
            if (onEnd) onEnd();
            else onSeek(head, 'key');
          } else return;
          event.preventDefault();
        }}
      >
        {marks && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            data-testid="timeline-marks"
          >
            {marks(fractionOf, width)}
          </div>
        )}
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${width} ${TRACK_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0"
        >
          {children?.(xOf, width)}
          {/* What lies beyond the cursor is still to come. */}
          <rect
            x={xOf(cursor)}
            y={0}
            width={Math.max(0, width - xOf(cursor))}
            height={TRACK_HEIGHT}
            fill={COLOR.plate}
            opacity={0.6}
          />
          <rect x={xOf(cursor) - 1} y={0} width={2} height={TRACK_HEIGHT} fill={COLOR.ink} />
        </svg>
        <span
          className="timeline-ends numeric pointer-events-none absolute bottom-0.5 left-1.5 text-[10px] text-ink-faint"
          data-crowded={startCrowded || undefined}
          data-testid="timeline-start"
        >
          {startText}
        </span>
        <span
          className="timeline-ends numeric pointer-events-none absolute bottom-0.5 right-1.5 text-[10px] text-ink-faint"
          data-crowded={endCrowded || undefined}
          data-testid="timeline-end"
        >
          {endText}
        </span>
      </div>
    </div>
  );
}

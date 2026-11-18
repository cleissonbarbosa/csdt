import { Pause, Play } from 'lucide-react';
import { memo, useMemo } from 'react';

import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { Track } from '@/features/timeline/Track';
import { useTimelineHeight } from '@/features/timeline/Timeline';
import { t } from '@/i18n';
import { COLOR } from '@/lib/palette';
import { useCapture } from '@/stores/capture';

import { SPEEDS, stepMs, type Capture, type Speed } from './capture';
import { levelColumns, spreadMarks } from './marks';
import { EventGlyph, isoOf, sinceCaptureStart, utcDay, utcDayShort, utcTime } from './present';

const SPEED_OPTIONS = SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` }));

/**
 * How far down the track an event's mark stands, as a share of its height:
 * under the ticks of the samples, which hang from the top edge, and clear of
 * the times printed along the foot of the open track.
 */
const EVENT_TOP = 50;

/** The size of an event's mark, in pixels, whether the track is open or closed. */
export const EVENT_SIZE = 9;

/**
 * What lies along the capture, drawn into the track: a tick where some
 * service's sample is past the simulation's levels (short and amber at
 * degraded, tall and red at critical, as the simulation's own marks are, so
 * the two still differ by height when the track is pressed flat). There is
 * no line of traffic: a capture's services are measured separately, and a
 * sum of them would count one call several times over.
 *
 * One tick per column of pixels at most (`levelColumns`), however many
 * samples the file holds, and drawn again only when the capture or the
 * width changes: what is still to come is shaded by the track itself, so
 * nothing here follows the cursor.
 */
const LevelTicks = memo(function LevelTicks({
  capture,
  width,
}: {
  capture: Capture;
  width: number;
}) {
  const columns = useMemo(() => levelColumns(capture, width), [capture, width]);
  return (
    <>
      {columns.map(({ column, level }) => (
        <rect
          key={column}
          x={column + 0.5 - 0.75}
          y={0}
          width={1.5}
          height={level === 2 ? 14 : 9}
          fill={level === 2 ? COLOR.critical : COLOR.warning}
          data-mark={`level-${level}`}
        />
      ))}
    </>
  );
});

/**
 * The capture's events, laid over the track at their own size: a mark for
 * each, shaped by what it states (a square for impact, a triangle for
 * recovery under way, a disc for recovery, a stroke for no state). They are
 * not drawn into the track's picture, which is pressed flat while it is
 * closed: there a square would be a bar, and the three told apart by hue
 * alone. Events at one moment, or a few pixels apart, are set side by side
 * around it (`spreadMarks`), so that each keeps its shape; what is still to
 * come is shaded by the track, so they too are drawn again only when the
 * capture or the width changes.
 */
const EventMarks = memo(function EventMarks({
  capture,
  fractionOf,
  width,
}: {
  capture: Capture;
  fractionOf: (ms: number) => number;
  width: number;
}) {
  const placed = useMemo(
    () =>
      spreadMarks(
        capture.events.map((event) => fractionOf(event.atMs) * width),
        EVENT_SIZE,
        width,
      ),
    [capture, fractionOf, width],
  );
  return (
    <>
      {capture.events.map((event, i) => {
        const at = fractionOf(event.atMs);
        const shift = placed[i]! - at * width;
        return (
          <span
            key={i}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{
              left: `${at * 100}%`,
              marginLeft: Math.abs(shift) < 0.01 ? undefined : `${shift.toFixed(2)}px`,
              top: `${EVENT_TOP}%`,
              width: EVENT_SIZE,
              height: EVENT_SIZE,
            }}
            data-mark={`event-${event.state ?? 'none'}`}
          >
            {event.state ? (
              <EventGlyph state={event.state} size={EVENT_SIZE} />
            ) : (
              <span className="block h-[7px] w-[1.5px] bg-ink-faint" />
            )}
          </span>
        );
      })}
    </>
  );
});

/**
 * The transport of an incident capture, in the timeline's place at the foot
 * of the stage: play, the clock, the strip of the capture's window, and the
 * speed. It is on screen for as long as the capture is open, and it is the
 * only part that follows the cursor at every tick of the capture's clock.
 *
 * The clock is the capture's own: the UTC date and time the cursor is at,
 * and how far into the capture that is. Nothing here is the simulation's
 * time, and nothing here acts on the simulation.
 */
export function CaptureBar() {
  const capture = useCapture((state) => state.capture);
  const atMs = useCapture((state) => state.atMs);
  const playing = useCapture((state) => state.playing);
  const speed = useCapture((state) => state.speed);
  const height = useTimelineHeight();
  const eventMoments = useMemo(() => capture?.events.map((event) => event.atMs) ?? [], [capture]);
  if (!capture) return null;

  const { startMs, endMs } = capture.window;
  const step = stepMs(capture);
  const offset = sinceCaptureStart(capture, atMs);
  const store = useCapture.getState;

  return (
    <section
      className="panel floating absolute inset-x-3 bottom-3 z-20 flex animate-rise flex-wrap items-center gap-x-3 gap-y-2 px-2 max-sm:content-center max-sm:gap-x-2"
      style={{ height }}
      aria-label={t('Capture timeline and playback')}
      data-testid="timeline"
      data-status={playing ? 'playing' : 'paused'}
      data-mode="capture"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="primary"
          size="sm"
          icon={playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
          onClick={() => store().toggle()}
          data-testid="capture-toggle"
          // As wide as its word needs, never so narrow that the word pushes
          // the icon out (as "Reproduzir" did).
          className="min-w-[72px]"
        >
          {playing ? t('Pause') : t('Play')}
        </Button>
      </div>

      {/* The date stays on screen, its year given up on a phone so the
          time always fits; the offset gives way first. */}
      <div className="flex min-w-0 items-baseline gap-2 max-sm:flex-1" aria-live="off">
        <time
          dateTime={isoOf(atMs)}
          className="numeric shrink-0 whitespace-nowrap text-sm text-ink"
          data-testid="capture-time"
          title={t('{time} UTC, {offset} into the capture', {
            time: utcTime(atMs, true),
            offset,
          })}
        >
          <span className="text-[11px] text-ink-dim max-sm:hidden">{utcDay(atMs)}</span>
          <span className="text-[11px] text-ink-dim sm:hidden" data-testid="capture-day-short">
            {utcDayShort(atMs)}
          </span>{' '}
          {t('{time} UTC', { time: utcTime(atMs, true) })}
        </time>
        <span
          className="numeric min-w-0 truncate whitespace-nowrap text-[11px] text-ink-faint max-sm:hidden"
          data-testid="capture-offset"
        >
          {t('{offset} into the capture', { offset })}
        </span>
      </div>

      <Track
        startMs={startMs}
        endMs={endMs}
        cursorMs={atMs}
        formatTime={(ms) => utcTime(ms)}
        valueText={(cursor) =>
          t('{time} UTC, {offset} into the capture', {
            time: utcTime(cursor, true),
            offset: sinceCaptureStart(capture, cursor),
          })
        }
        // An arrow moves one sampling period (a hundredth of the window
        // without one), and ten with Shift.
        steps={{ small: step, large: step * 10 }}
        onSeek={(toMs) => store().seek(toMs)}
        marks={(fractionOf, width) => (
          <EventMarks capture={capture} fractionOf={fractionOf} width={width} />
        )}
        marked={eventMoments}
      >
        {(_, width) => <LevelTicks capture={capture} width={width} />}
      </Track>

      {/* On a narrow screen the strip matters more than the speed: the
          capture opens at the speed that plays it within a minute. */}
      <div
        className="flex shrink-0 items-center gap-1 max-md:hidden"
        title={t('How much capture time passes in each second of yours')}
      >
        <Segmented<Speed>
          label={t('Playback speed')}
          size="sm"
          value={speed}
          options={SPEED_OPTIONS}
          onChange={(next) => store().setSpeed(next)}
          testId="capture-speed"
        />
      </div>
    </section>
  );
}

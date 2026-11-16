import { PLAYBACK_SPEEDS, type Incident, type PlaybackSpeed } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronLast, History, Pause, Play, SkipForward, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { actions } from '@/app/actions';
import { useMinWidth } from '@/app/hooks';
import { queryKeys } from '@/app/queryClient';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import { COLOR, SEVERITY_COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` }));
/** Height of the open track; closed, it is the same drawing pressed flat. */
const TRACK_HEIGHT = 60;
/** Seeks issued while dragging are spaced at least this far apart. */
const SEEK_INTERVAL_MS = 110;

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

interface TrackProps {
  incidents: Incident[];
}

/**
 * The scrubber: traffic history, incident bands, event marks and the playhead.
 *
 * At rest it is a strip a few pixels tall: enough to see where the cursor is
 * and where the incidents were. Reaching for it (pointer, keyboard focus or a
 * drag) opens it upward into the full chart. The drawing is the same in both
 * states, scaled, so it grows rather than being swapped.
 */
function Track({ incidents }: TrackProps) {
  const playback = useTelemetry((state) => state.playback);
  const history = useTelemetry((state) => state.history);
  const events = useTelemetry((state) => state.events);
  const [ref, width] = useWidth();
  const dragging = useRef(false);
  const lastSeek = useRef(0);
  const pending = useRef<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [held, setHeld] = useState(false);

  const start = playback?.windowStartMs ?? 0;
  const head = Math.max(playback?.headTimeMs ?? 0, start + 1000);
  const span = head - start;
  const xOf = useCallback((ms: number) => ((ms - start) / span) * width, [start, span, width]);

  const paths = useMemo(() => {
    const samples = history.filter((s) => s.virtualTimeMs >= start && s.virtualTimeMs <= head);
    if (samples.length < 2) return null;
    let peak = 1;
    let trough = Infinity;
    for (const s of samples) {
      peak = Math.max(peak, s.rps);
      trough = Math.min(trough, s.rps);
    }
    // Scale to the observed range (with headroom below) so the everyday
    // ebb and flow of traffic is visible, not a flat line.
    const floor = Math.max(0, trough - (peak - trough) * 0.8 - peak * 0.05);
    const traffic = samples
      .map(
        (s) =>
          `${xOf(s.virtualTimeMs).toFixed(1)},${(TRACK_HEIGHT - 2 - ((s.rps - floor) / (peak - floor)) * (TRACK_HEIGHT - 14)).toFixed(1)}`,
      )
      .join(' ');
    // Error rate on its own scale: 25 % fills the track. It is only drawn
    // where there are errors to speak of, so a healthy stretch has no red.
    const errors: string[] = [];
    let run: string[] = [];
    for (const s of samples) {
      if (s.errorRate > 0.005) {
        run.push(
          `${xOf(s.virtualTimeMs).toFixed(1)},${(TRACK_HEIGHT - 2 - Math.min(1, s.errorRate / 0.25) * (TRACK_HEIGHT - 12)).toFixed(1)}`,
        );
      } else if (run.length > 0) {
        errors.push(run.join(' '));
        run = [];
      }
    }
    if (run.length > 0) errors.push(run.join(' '));
    return { traffic, errors, peak };
  }, [history, start, head, xOf]);

  const marks = useMemo(
    () =>
      events.filter(
        (event) =>
          (event.severity === 'warning' || event.severity === 'critical') &&
          event.kind !== 'health-transition' &&
          event.virtualTimeMs >= start,
      ),
    [events, start],
  );

  const seek = useCallback((toMs: number, force: boolean) => {
    const now = performance.now();
    if (!force && now - lastSeek.current < SEEK_INTERVAL_MS) {
      pending.current = toMs;
      return;
    }
    lastSeek.current = now;
    pending.current = null;
    void actions.control({ action: 'seek', toMs: Math.round(toMs) });
  }, []);

  const timeAt = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return start + ratio * span;
  };

  if (!playback) {
    return <div ref={ref} className="h-[18px] flex-1 max-sm:order-last max-sm:basis-full" />;
  }
  const cursor = preview ?? playback.virtualTimeMs;
  const step = (delta: number) =>
    seek(Math.min(head, Math.max(start, playback.virtualTimeMs + delta)), true);

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
        aria-label="Timeline position"
        aria-orientation="horizontal"
        aria-valuemin={Math.round(start / 1000)}
        aria-valuemax={Math.round(head / 1000)}
        aria-valuenow={Math.round(cursor / 1000)}
        aria-valuetext={`${formatClock(cursor)} of ${formatClock(head)}`}
        data-testid="timeline-track"
        data-dragging={held}
        className="timeline-track absolute inset-x-0 bottom-0 cursor-ew-resize touch-none select-none overflow-hidden rounded-control border border-line bg-sunken"
        onPointerDown={(event) => {
          dragging.current = true;
          setHeld(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          const at = timeAt(event.clientX, event.currentTarget);
          setPreview(at);
          seek(at, true);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const at = timeAt(event.clientX, event.currentTarget);
          setPreview(at);
          seek(at, false);
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          setHeld(false);
          seek(pending.current ?? timeAt(event.clientX, event.currentTarget), true);
          setPreview(null);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setHeld(false);
          setPreview(null);
        }}
        onKeyDown={(event) => {
          const big = event.shiftKey ? 30_000 : 5_000;
          if (event.key === 'ArrowLeft') step(-big);
          else if (event.key === 'ArrowRight') step(big);
          else if (event.key === 'Home') seek(start, true);
          // The end of the track is the simulation's now.
          else if (event.key === 'End') void actions.control({ action: 'live' });
          else return;
          event.preventDefault();
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${width} ${TRACK_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0"
        >
          {incidents.map((incident) => {
            const from = Math.max(start, incident.startedAtMs);
            const to = Math.min(head, incident.resolvedAtMs ?? head);
            if (to <= start) return null;
            return (
              <g key={incident.id}>
                <rect
                  x={xOf(from)}
                  y={0}
                  width={Math.max(2, xOf(to) - xOf(from))}
                  height={TRACK_HEIGHT}
                  fill={COLOR.critical}
                  opacity={incident.status === 'resolved' ? 0.08 : 0.16}
                />
                <rect
                  x={xOf(from)}
                  y={0}
                  width={1.5}
                  height={TRACK_HEIGHT}
                  fill={COLOR.critical}
                  opacity={0.75}
                />
              </g>
            );
          })}
          {paths && (
            <>
              <polyline
                points={paths.traffic}
                fill="none"
                stroke={COLOR.inkDim}
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
              {paths.errors.map((points, i) => (
                <polyline
                  key={i}
                  points={points}
                  fill="none"
                  stroke={COLOR.critical}
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          )}
          {marks.map((event) => (
            <rect
              key={event.seq}
              x={xOf(event.virtualTimeMs) - 0.75}
              y={0}
              width={1.5}
              height={event.severity === 'critical' ? 14 : 9}
              fill={SEVERITY_COLOR[event.severity]}
              opacity={event.virtualTimeMs > playback.virtualTimeMs ? 0.4 : 1}
            />
          ))}
          {/* What lies beyond the cursor is the recorded future while replaying. */}
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
        <span className="timeline-ends numeric pointer-events-none absolute bottom-0.5 left-1.5 text-[10px] text-ink-faint">
          {formatClock(start)}
        </span>
        <span className="timeline-ends numeric pointer-events-none absolute bottom-0.5 right-1.5 text-[10px] text-ink-faint">
          {formatClock(head)}
        </span>
      </div>
    </div>
  );
}

/** Height of the bar, for whoever has to make room for it. */
export const TIMELINE_HEIGHT = 48;
/**
 * On a narrow screen the strip of history takes a row of its own under the
 * controls, so neither is squeezed out of reach by the other.
 */
export const TIMELINE_HEIGHT_NARROW = 86;
/** The width from which the bar is one row. */
const ONE_ROW_FROM = 640;

/** How tall the bar is on this screen. */
export function useTimelineHeight(): number {
  return useMinWidth(ONE_ROW_FROM) ? TIMELINE_HEIGHT : TIMELINE_HEIGHT_NARROW;
}

/**
 * Where the cursor is, in the interface's own words. The contract calls the
 * head of the timeline `live`; on a page where everything is simulated that
 * word claims too much, and "live, paused" contradicts itself. Time is
 * either at the simulation's now or in its history, and either runs or is
 * paused.
 */
export function describePlayback(
  mode: 'live' | 'replay',
  status: 'playing' | 'paused',
): { label: string; hint: string } {
  if (mode === 'live') {
    return status === 'playing'
      ? {
          label: 'Simulation now',
          hint: "At the simulation's now: new history is being made.",
        }
      : {
          label: 'Paused',
          hint: "Paused at the simulation's now: nothing advances until it is played.",
        };
  }
  return status === 'playing'
    ? {
        label: 'History',
        hint: 'Inside recorded history: the past is being re-simulated exactly.',
      }
    : {
        label: 'Paused in history',
        hint: 'Paused inside recorded history, at a moment that was re-simulated exactly.',
      };
}

/**
 * Whether there is anything on the timeline to reach for: an incident under
 * way or in the recorded window, time that is paused or being replayed.
 */
function useTimelineNeeded(): boolean {
  const moved = useTelemetry((state) => {
    const playback = state.playback;
    if (!playback) return false;
    return (
      playback.mode !== 'live' || playback.status !== 'playing' || state.snapshot?.incident != null
    );
  });
  const { data: recorded } = useQuery({
    queryKey: queryKeys.incidents,
    queryFn: api.incidents,
    select: (response) => response.incidents.length > 0,
  });
  return moved || recorded === true;
}

/**
 * The timeline is not on screen while there is nothing on it. It comes when
 * time stops being simply "now" (an incident, a pause, a replay) and when it
 * is asked for, and goes again when neither holds.
 */
export function useTimelineVisible(): boolean {
  const asked = useUi((state) => state.timelineOpen);
  const needed = useTimelineNeeded();
  const ready = useTelemetry((state) => state.playback !== null);
  return ready && (asked || needed);
}

/**
 * The transport, floating at the foot of the stage: play and the clock, the
 * strip of history, then the few controls that change how time runs. One
 * row where there is room for it; on a narrow screen the strip drops to a
 * row of its own. Recorded incidents are loaded from the incidents panel,
 * where the scenarios are.
 */
export function Timeline() {
  const playback = useTelemetry((state) => state.playback);
  const visible = useTimelineVisible();
  const needed = useTimelineNeeded();
  const height = useTimelineHeight();
  const { data: incidents } = useQuery({
    queryKey: queryKeys.incidents,
    queryFn: api.incidents,
    select: (response) => response.incidents,
  });
  const { data: recordings } = useQuery({
    queryKey: queryKeys.recordings,
    queryFn: api.recordings,
  });

  if (!playback || !visible) return null;
  const playing = playback.status === 'playing';
  const atNow = playback.mode === 'live';
  const recording = recordings?.find((r) => r.id === playback.recordingId);
  const where = describePlayback(playback.mode, playback.status);

  return (
    <section
      className="panel floating absolute inset-x-3 bottom-3 z-20 flex animate-rise flex-wrap items-center gap-x-3 gap-y-2 px-2 max-sm:content-center max-sm:gap-x-2"
      style={{ height }}
      aria-label="Timeline and playback"
      data-testid="timeline"
      data-status={playback.status}
      data-mode={playback.mode}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="primary"
          size="sm"
          icon={playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
          onClick={() => void actions.control({ action: playing ? 'pause' : 'play' })}
          data-testid="playback-toggle"
          className="w-[72px]"
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <IconButton
          label="Step one tick forward"
          size="sm"
          disabled={playing}
          onClick={() => void actions.control({ action: 'step' })}
          className="max-sm:hidden"
        >
          <SkipForward size={14} />
        </IconButton>
      </div>

      {/* The words give way before a control does: they shorten, then clip. */}
      <div className="flex min-w-0 items-baseline gap-2 max-sm:flex-1" aria-live="off">
        <span className="numeric shrink-0 text-sm text-ink" data-testid="playback-clock">
          {formatClock(playback.virtualTimeMs)}
        </span>
        <p
          className={cn(
            'min-w-0 truncate whitespace-nowrap text-[11px]',
            atNow && playing ? 'text-ink-faint' : 'font-bold text-ink',
          )}
          title={
            atNow
              ? where.hint
              : `${where.hint} The simulation's now is at ${formatClock(playback.headTimeMs)}.`
          }
        >
          <span data-testid="playback-mode">{where.label}</span>
          {!atNow && (
            <span className="numeric font-normal max-sm:hidden" data-testid="playback-head">
              , now is {formatClock(playback.headTimeMs)}
            </span>
          )}
          {recording && (
            <span className="hidden font-normal lg:inline" title={recording.description}>
              , recording {recording.name}
            </span>
          )}
        </p>
      </div>

      <Track incidents={incidents ?? []} />

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          icon={<History size={13} aria-hidden />}
          disabled={(incidents ?? []).length === 0}
          onClick={() => void actions.control({ action: 'replay' })}
          title="Go back to where the latest incident began and watch it again"
          aria-label="Replay the incident"
          data-testid="playback-replay"
        >
          <span className="max-lg:hidden">Replay the incident</span>
          <span className="max-sm:hidden lg:hidden">Replay</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLast size={13} aria-hidden />}
          pressed={atNow}
          onClick={() => void actions.control({ action: 'live' })}
          title="Jump to the simulation's now, the end of recorded history"
          aria-label="Go to the simulation's now"
          data-testid="playback-live"
        >
          Now
        </Button>
        {/* On a narrow screen the strip of history matters more than the
            speed, which the incident panel still sets while a scenario runs. */}
        <div className="max-md:hidden">
          <Segmented<PlaybackSpeed>
            label="Playback speed"
            size="sm"
            value={playback.speed as PlaybackSpeed}
            options={SPEED_OPTIONS}
            onChange={(speed) => void actions.control({ action: 'setSpeed', speed })}
          />
        </div>
        {!needed && (
          <IconButton
            label="Put the timeline away"
            size="sm"
            onClick={() => useUi.getState().setTimelineOpen(false)}
            data-testid="timeline-close"
          >
            <X size={14} />
          </IconButton>
        )}
      </div>
    </section>
  );
}

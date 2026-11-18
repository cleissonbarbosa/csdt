import {
  PLAYBACK_SPEEDS,
  type Incident,
  type MetricSample,
  type PlaybackSpeed,
  type SecurityEvent,
} from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronLast, History, Pause, Play, SkipForward, X } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';

import { actions } from '@/app/actions';
import { useMinWidth } from '@/app/hooks';
import { queryKeys } from '@/app/queryClient';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import { COLOR, SEVERITY_COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { Track, TRACK_HEIGHT } from './Track';

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` }));
/** Seeks issued while dragging are spaced at least this far apart. */
const SEEK_INTERVAL_MS = 110;

interface SimulationTrackProps {
  incidents: Incident[];
}

/**
 * The simulation's history on the scrubber: traffic, incident bands and
 * event marks, with the playhead at the simulation's cursor. A drag previews
 * where it is going and asks the server to seek at most every
 * `SEEK_INTERVAL_MS`; End goes to the simulation's now.
 */
function SimulationTrack({ incidents }: SimulationTrackProps) {
  const playback = useTelemetry((state) => state.playback);
  const history = useTelemetry((state) => state.history);
  const events = useTelemetry((state) => state.events);
  const lastSeek = useRef(0);
  const pending = useRef<number | null>(null);

  const start = playback?.windowStartMs ?? 0;
  const head = Math.max(playback?.headTimeMs ?? 0, start + 1000);

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

  if (!playback) {
    return <div className="h-[18px] flex-1 max-sm:order-last max-sm:basis-full" />;
  }

  return (
    <Track
      startMs={start}
      endMs={head}
      cursorMs={playback.virtualTimeMs}
      formatTime={formatClock}
      valueText={(cursor) =>
        t('{cursor} of {head}', { cursor: formatClock(cursor), head: formatClock(head) })
      }
      steps={{ small: 5_000, large: 30_000 }}
      onSeek={(toMs, phase) => {
        if (phase === 'move') seek(toMs, false);
        // Let go of, the track seeks to where the drag last asked for.
        else if (phase === 'end') seek(pending.current ?? toMs, true);
        else seek(toMs, true);
      }}
      // The end of the track is the simulation's now.
      onEnd={() => void actions.control({ action: 'live' })}
    >
      {(xOf) => (
        <SimulationLayers
          incidents={incidents}
          history={history}
          marks={marks}
          start={start}
          head={head}
          cursorMs={playback.virtualTimeMs}
          xOf={xOf}
        />
      )}
    </Track>
  );
}

/** Incident bands, the traffic and error lines, and the marks of what went wrong. */
function SimulationLayers({
  incidents,
  history,
  marks,
  start,
  head,
  cursorMs,
  xOf,
}: {
  incidents: Incident[];
  history: MetricSample[];
  marks: SecurityEvent[];
  start: number;
  head: number;
  cursorMs: number;
  xOf: (ms: number) => number;
}) {
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

  return (
    <>
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
          opacity={event.virtualTimeMs > cursorMs ? 0.4 : 1}
        />
      ))}
    </>
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
          label: t('Simulation now'),
          hint: t("At the simulation's now: new history is being made."),
        }
      : {
          label: t('Paused'),
          hint: t("Paused at the simulation's now: nothing advances until it is played."),
        };
  }
  return status === 'playing'
    ? {
        label: t('History'),
        hint: t('Inside recorded history: the past is being re-simulated exactly.'),
      }
    : {
        label: t('Paused in history'),
        hint: t('Paused inside recorded history, at a moment that was re-simulated exactly.'),
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
      aria-label={t('Timeline and playback')}
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
          // As wide as its word needs, never so narrow that the word pushes
          // the icon out (as "Reproduzir" did).
          className="min-w-[72px]"
        >
          {playing ? t('Pause') : t('Play')}
        </Button>
        <IconButton
          label={t('Step one tick forward')}
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
              : t("{hint} The simulation's now is at {head}.", {
                  hint: where.hint,
                  head: formatClock(playback.headTimeMs),
                })
          }
        >
          <span data-testid="playback-mode">{where.label}</span>
          {!atNow && (
            <span className="numeric font-normal max-sm:hidden" data-testid="playback-head">
              {t(', now is {head}', { head: formatClock(playback.headTimeMs) })}
            </span>
          )}
          {recording && (
            <span className="hidden font-normal lg:inline" title={recording.description}>
              {t(', recording {name}', { name: recording.name })}
            </span>
          )}
        </p>
      </div>

      <SimulationTrack incidents={incidents ?? []} />

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          icon={<History size={13} aria-hidden />}
          disabled={(incidents ?? []).length === 0}
          onClick={() => void actions.control({ action: 'replay' })}
          title={t('Go back to where the latest incident began and watch it again')}
          aria-label={t('Replay the incident')}
          data-testid="playback-replay"
        >
          <span className="max-lg:hidden">{t('Replay the incident')}</span>
          <span className="max-sm:hidden lg:hidden">{t('Replay')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLast size={13} aria-hidden />}
          pressed={atNow}
          onClick={() => void actions.control({ action: 'live' })}
          title={t("Jump to the simulation's now, the end of recorded history")}
          aria-label={t("Go to the simulation's now")}
          data-testid="playback-live"
        >
          {t('Now')}
        </Button>
        {/* On a narrow screen the strip of history matters more than the
            speed, which the incident panel still sets while a scenario runs. */}
        <div className="max-md:hidden">
          <Segmented<PlaybackSpeed>
            label={t('Playback speed')}
            size="sm"
            value={playback.speed as PlaybackSpeed}
            options={SPEED_OPTIONS}
            onChange={(speed) => void actions.control({ action: 'setSpeed', speed })}
          />
        </div>
        {!needed && (
          <IconButton
            label={t('Put the timeline away')}
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

import { PLAYBACK_SPEEDS, type Incident, type PlaybackSpeed } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { History, Pause, Play, Radio, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented, Select } from '@/components/ui/Field';
import { formatClock } from '@/lib/format';
import { COLOR, SEVERITY_COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` }));
const TRACK_HEIGHT = 56;
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

/** The scrubber: traffic history, incident bands, event marks and the playhead. */
function Track({ incidents }: TrackProps) {
  const playback = useTelemetry((state) => state.playback);
  const history = useTelemetry((state) => state.history);
  const events = useTelemetry((state) => state.events);
  const [ref, width] = useWidth();
  const dragging = useRef(false);
  const lastSeek = useRef(0);
  const pending = useRef<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

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
    // Error rate on its own scale: 25 % fills the track.
    const errors = samples
      .map(
        (s) =>
          `${xOf(s.virtualTimeMs).toFixed(1)},${(TRACK_HEIGHT - 2 - Math.min(1, s.errorRate / 0.25) * (TRACK_HEIGHT - 12)).toFixed(1)}`,
      )
      .join(' ');
    const first = xOf(samples[0]!.virtualTimeMs).toFixed(1);
    const last = xOf(samples[samples.length - 1]!.virtualTimeMs).toFixed(1);
    return {
      traffic,
      errors,
      area: `${first},${TRACK_HEIGHT} ${traffic} ${last},${TRACK_HEIGHT}`,
      peak,
    };
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

  if (!playback) return <div ref={ref} style={{ height: TRACK_HEIGHT }} />;
  const cursor = preview ?? playback.virtualTimeMs;
  const step = (delta: number) =>
    seek(Math.min(head, Math.max(start, playback.virtualTimeMs + delta)), true);

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Timeline position"
      aria-orientation="horizontal"
      aria-valuemin={Math.round(start / 1000)}
      aria-valuemax={Math.round(head / 1000)}
      aria-valuenow={Math.round(cursor / 1000)}
      aria-valuetext={`${formatClock(cursor)} of ${formatClock(head)}`}
      data-testid="timeline-track"
      className="relative cursor-ew-resize touch-none select-none overflow-hidden rounded-[3px] border border-line bg-abyss/80"
      style={{ height: TRACK_HEIGHT }}
      onPointerDown={(event) => {
        dragging.current = true;
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
        seek(pending.current ?? timeAt(event.clientX, event.currentTarget), true);
        setPreview(null);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setPreview(null);
      }}
      onKeyDown={(event) => {
        const big = event.shiftKey ? 30_000 : 5_000;
        if (event.key === 'ArrowLeft') step(-big);
        else if (event.key === 'ArrowRight') step(big);
        else if (event.key === 'Home') seek(start, true);
        else if (event.key === 'End') void actions.control({ action: 'live' });
        else return;
        event.preventDefault();
      }}
    >
      <svg width={width} height={TRACK_HEIGHT} aria-hidden className="absolute inset-0">
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
                opacity={incident.status === 'resolved' ? 0.09 : 0.17}
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
            <polygon points={paths.area} fill={COLOR.cyan} opacity={0.1} />
            <polyline
              points={paths.traffic}
              fill="none"
              stroke={COLOR.cyan}
              strokeWidth={1.2}
              opacity={0.85}
            />
            <polyline
              points={paths.errors}
              fill="none"
              stroke={COLOR.critical}
              strokeWidth={1.2}
              opacity={0.9}
            />
          </>
        )}
        {marks.map((event) => (
          <rect
            key={event.seq}
            x={xOf(event.virtualTimeMs) - 0.75}
            y={0}
            width={1.5}
            height={event.severity === 'critical' ? 9 : 6}
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
          fill={COLOR.void}
          opacity={0.45}
        />
        <rect x={xOf(cursor) - 1} y={0} width={2} height={TRACK_HEIGHT} fill={COLOR.ink} />
        <path d={`M${xOf(cursor) - 5},0 h10 l-5,6 z`} fill={COLOR.ink} />
      </svg>
      <span className="numeric pointer-events-none absolute bottom-0.5 left-1.5 text-[9px] text-ink-faint">
        {formatClock(start)}
      </span>
      <span className="numeric pointer-events-none absolute bottom-0.5 right-1.5 text-[9px] text-ink-faint">
        {formatClock(head)}
      </span>
    </div>
  );
}

export function Timeline() {
  const playback = useTelemetry((state) => state.playback);
  const { data: incidents } = useQuery({
    queryKey: queryKeys.incidents,
    queryFn: api.incidents,
    select: (response) => response.incidents,
  });
  const { data: recordings } = useQuery({
    queryKey: queryKeys.recordings,
    queryFn: api.recordings,
  });

  if (!playback) return null;
  const playing = playback.status === 'playing';
  const live = playback.mode === 'live';
  const recording = recordings?.find((r) => r.id === playback.recordingId);

  return (
    <section
      className="panel relative z-20 flex shrink-0 flex-col gap-2 border-x-0 border-b-0 px-3 py-2"
      aria-label="Timeline and playback"
      data-testid="timeline"
      data-status={playback.status}
      data-mode={playback.mode}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button
            variant="primary"
            icon={playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
            onClick={() => void actions.control({ action: playing ? 'pause' : 'play' })}
            data-testid="playback-toggle"
            className="w-[88px]"
          >
            {playing ? 'Pause' : 'Play'}
          </Button>
          <IconButton
            label="Step one tick forward"
            disabled={playing}
            onClick={() => void actions.control({ action: 'step' })}
          >
            <SkipForward size={15} />
          </IconButton>
          <Button
            variant="ghost"
            icon={<History size={14} aria-hidden />}
            onClick={() => void actions.control({ action: 'replay' })}
            title="Rewind to the start of the latest incident and play"
            data-testid="playback-replay"
          >
            Replay
          </Button>
          <Button
            variant="ghost"
            icon={<Radio size={14} aria-hidden />}
            pressed={live}
            onClick={() => void actions.control({ action: 'live' })}
            title="Jump to the head of the timeline"
            data-testid="playback-live"
          >
            Live
          </Button>
        </div>

        <Segmented<PlaybackSpeed>
          label="Playback speed"
          value={playback.speed as PlaybackSpeed}
          options={SPEED_OPTIONS}
          onChange={(speed) => void actions.control({ action: 'setSpeed', speed })}
        />

        <div className="flex items-baseline gap-1.5" aria-live="off">
          <span className="numeric text-base font-medium text-ink" data-testid="playback-clock">
            {formatClock(playback.virtualTimeMs)}
          </span>
          <span className="numeric text-[11px] text-ink-faint">
            / {formatClock(playback.headTimeMs)}
          </span>
        </div>
        <Badge
          color={live ? COLOR.healthy : COLOR.warning}
          dot
          pulse={live && playing}
          title={
            live
              ? 'At the head of the timeline: new history is being made.'
              : 'Inside recorded history: the past is being re-simulated exactly.'
          }
        >
          <span data-testid="playback-mode">{live ? 'Live' : 'Replay'}</span>
        </Badge>
        {!playing && <Badge color={COLOR.inkDim}>Paused</Badge>}
        {recording && (
          <Badge color={COLOR.warning} title={recording.description}>
            Recording · {recording.name}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {recordings && recordings.length > 0 && (
            <Select
              label="Load a recorded incident"
              hideLabel
              value=""
              onChange={(event) => {
                if (event.target.value) void actions.loadRecording(event.target.value);
              }}
              className="w-52"
              data-testid="recording-picker"
            >
              <option value="">Load recorded incident…</option>
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({formatClock(r.durationMs)})
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>
      <Track incidents={incidents ?? []} />
    </section>
  );
}

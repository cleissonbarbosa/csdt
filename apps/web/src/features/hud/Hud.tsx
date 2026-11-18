import { useEffect, useRef, useState } from 'react';

import { RangeBar } from '@/components/ui/Sparkline';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatMs, formatPercent, formatRate } from '@/lib/format';
import { COLOR } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

/** Colour for a value that is fine below `warn` and alarming above `alarm`. */
function grade(value: number, warn: number, alarm: number): string | undefined {
  if (value >= alarm) return COLOR.critical;
  if (value >= warn) return COLOR.warning;
  return undefined;
}

interface PlatformSignal {
  key: 'rps' | 'p95' | 'errors' | 'saturation';
  label: string;
  /** The name it goes by where there is little room. */
  short: string;
  value: string;
  /** The number the marker shows, on the scale `0…max`. */
  reading: number;
  max: number;
  normal: readonly [number, number];
  /** Set only while the reading is outside its normal range. */
  tone?: string;
}

/**
 * The four signals that say whether a service platform is well: how much
 * traffic, how slow, how many failures, how full. Each comes with its normal
 * range, so "is this where it should be?" needs no arithmetic, and takes a
 * colour only when it has left that range.
 */
function usePlatformSignals(): PlatformSignal[] | null {
  const global = useTelemetry((state) => state.snapshot?.global);
  const saturation = useTelemetry((state) => {
    const values = state.snapshot?.nodes.saturation;
    if (!values) return 0;
    let peak = 0;
    for (const value of values) if (value > peak) peak = value;
    return peak;
  });
  const baseline = useTelemetry((state) => state.history[0]);
  if (!global) return null;
  const normalRps = Math.max(1, baseline?.rps ?? global.rps);
  const normalP95 = Math.max(1, baseline?.p95LatencyMs ?? global.p95LatencyMs);
  return [
    {
      key: 'rps',
      label: t('Traffic'),
      short: t('Traffic'),
      value: `${formatRate(global.rps)}/s`,
      reading: global.rps,
      max: normalRps * 3,
      normal: [normalRps * 0.6, normalRps * 1.4],
      tone: grade(global.rps / normalRps, 1.6, 2.5),
    },
    {
      key: 'p95',
      label: t('Latency p95'),
      short: t('Latency'),
      value: formatMs(global.p95LatencyMs),
      reading: global.p95LatencyMs,
      max: normalP95 * 4,
      normal: [0, normalP95 * 1.6],
      tone: grade(global.p95LatencyMs / normalP95, 1.6, 2.5),
    },
    {
      key: 'errors',
      label: t('Errors'),
      short: t('Errors'),
      value: formatPercent(global.errorRate),
      reading: global.errorRate,
      max: 0.2,
      normal: [0, 0.01],
      tone: grade(global.errorRate, 0.01, 0.05),
    },
    {
      key: 'saturation',
      label: t('Peak saturation'),
      short: t('Saturation'),
      value: formatPercent(Math.min(1, saturation)),
      reading: saturation,
      max: 1,
      normal: [0, 0.7],
      tone: grade(saturation, 0.85, 0.97),
    },
  ];
}

/** All four signals, as shown in the platform overview. */
export function Hud() {
  const signals = usePlatformSignals();
  if (!signals) return null;
  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-3"
      aria-label={t('Platform signals')}
      data-testid="hud"
    >
      {signals.map((signal) => (
        <div key={signal.key} className="min-w-0">
          <dt className="caption truncate">{signal.label}</dt>
          <dd
            className={cn('numeric text-[15px] leading-snug text-ink', signal.tone && 'font-bold')}
            style={{ color: signal.tone }}
            data-testid={`hud-${signal.key}`}
          >
            {signal.value}
          </dd>
          <RangeBar
            value={signal.reading}
            max={signal.max}
            normal={signal.normal}
            tone={signal.tone}
            className="mt-1.5"
          />
        </div>
      ))}
    </dl>
  );
}

/** What one instrument takes of the bar, the gap between two, and the count of the rest. */
const INSTRUMENT_WIDTH = 116;
const INSTRUMENT_GAP = 16;
const REST_WIDTH = 28;

/**
 * Which reading is said first where there is not room for all of them: the
 * one further out of range, and between two as far out, failures before
 * slowness before fullness before volume.
 */
const URGENCY: Record<PlatformSignal['key'], number> = { errors: 0, p95: 1, saturation: 2, rps: 3 };

function byUrgency(a: PlatformSignal, b: PlatformSignal): number {
  const alarm = (signal: PlatformSignal) => (signal.tone === COLOR.critical ? 0 : 1);
  return alarm(a) - alarm(b) || URGENCY[a.key] - URGENCY[b.key];
}

/**
 * How many of `count` instruments a row `room` pixels wide shows whole. When
 * they do not all fit, room is kept to say how many were left out. A width
 * that is not known yet leaves none out.
 */
export function instrumentsShown(count: number, room: number | null): number {
  if (room === null) return count;
  const whole = (width: number) =>
    Math.max(0, Math.floor((width + INSTRUMENT_GAP) / (INSTRUMENT_WIDTH + INSTRUMENT_GAP)));
  if (whole(room) >= count) return count;
  return Math.min(count, whole(room - REST_WIDTH - INSTRUMENT_GAP));
}

/**
 * The dark cockpit applied to the top bar: an instrument is on show only
 * while its reading is outside the normal range. With the platform well this
 * renders nothing; the readings themselves are always in the overview.
 *
 * The bar has room for all of them on a wide screen and for one on a
 * laptop's. Only whole instruments are drawn, the most urgent first, and the
 * ones that do not fit are counted beside them: a reading that is out of
 * range is never simply absent. The row asks the bar for the width of one
 * instrument and that count, which the sentence beside it gives up.
 */
export function Deviations({ className }: { className?: string }) {
  const signals = usePlatformSignals();
  const abnormal = (signals?.filter((signal) => signal.tone) ?? []).sort(byUrgency);
  const row = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const node = row.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    // Not laid out (a phone, where the row is not shown) is not "no room".
    const measure = () => setRoom(node.clientWidth > 0 ? node.clientWidth : null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const shown = instrumentsShown(abnormal.length, room);
  const rest = abnormal.slice(shown);
  const needs =
    abnormal.length === 0
      ? 0
      : abnormal.length === 1
        ? INSTRUMENT_WIDTH
        : INSTRUMENT_WIDTH + INSTRUMENT_GAP + REST_WIDTH;
  return (
    <div
      ref={row}
      className={cn('h-[30px] items-center overflow-hidden', className)}
      style={{ minWidth: needs, gap: INSTRUMENT_GAP }}
    >
      <dl
        className="flex items-center"
        style={{ gap: INSTRUMENT_GAP }}
        aria-label={t('Signals outside their normal range')}
      >
        {abnormal.slice(0, shown).map((signal) => (
          <div
            key={signal.key}
            className="shrink-0 animate-swap"
            style={{ width: INSTRUMENT_WIDTH }}
            title={signal.label}
            data-testid={`deviation-${signal.key}`}
          >
            <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
              <dt className="caption">{signal.short}</dt>
              <dd className="numeric text-xs font-bold" style={{ color: signal.tone }}>
                {signal.value}
              </dd>
            </div>
            <RangeBar
              value={signal.reading}
              max={signal.max}
              normal={signal.normal}
              tone={signal.tone}
              className="mt-1"
            />
          </div>
        ))}
      </dl>
      {rest.length > 0 && (
        <button
          type="button"
          className="numeric shrink-0 rounded-control px-1 text-xs font-bold transition-colors hover:bg-raised"
          style={{ color: rest[0]!.tone }}
          aria-label={t(
            rest.length === 1
              ? '{n} more signal outside the normal range: {signals}. Show the platform signals.'
              : '{n} more signals outside the normal range: {signals}. Show the platform signals.',
            {
              n: rest.length,
              signals: rest.map((signal) => `${signal.label} ${signal.value}`).join(', '),
            },
          )}
          title={rest.map((signal) => `${signal.label} ${signal.value}`).join(', ')}
          onClick={() => {
            // The overview is the inspector with nothing selected.
            const ui = useUi.getState();
            ui.select(null);
            ui.setPanel(null);
            ui.setInspectorOpen(true);
          }}
          data-testid="deviations-more"
        >
          +{rest.length}
        </button>
      )}
    </div>
  );
}

import { RangeBar } from '@/components/ui/Sparkline';
import { cn } from '@/lib/cn';
import { formatMs, formatPercent, formatRate } from '@/lib/format';
import { COLOR } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';

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
      label: 'Traffic',
      short: 'Traffic',
      value: `${formatRate(global.rps)}/s`,
      reading: global.rps,
      max: normalRps * 3,
      normal: [normalRps * 0.6, normalRps * 1.4],
      tone: grade(global.rps / normalRps, 1.6, 2.5),
    },
    {
      key: 'p95',
      label: 'Latency p95',
      short: 'Latency',
      value: formatMs(global.p95LatencyMs),
      reading: global.p95LatencyMs,
      max: normalP95 * 4,
      normal: [0, normalP95 * 1.6],
      tone: grade(global.p95LatencyMs / normalP95, 1.6, 2.5),
    },
    {
      key: 'errors',
      label: 'Errors',
      short: 'Errors',
      value: formatPercent(global.errorRate),
      reading: global.errorRate,
      max: 0.2,
      normal: [0, 0.01],
      tone: grade(global.errorRate, 0.01, 0.05),
    },
    {
      key: 'saturation',
      label: 'Peak saturation',
      short: 'Saturation',
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
      aria-label="Platform signals"
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

/**
 * The dark cockpit applied to the top bar: an instrument is on show only
 * while its reading is outside the normal range. With the platform well this
 * renders nothing; the readings themselves are always in the overview.
 */
export function Deviations() {
  const signals = usePlatformSignals();
  const abnormal = signals?.filter((signal) => signal.tone) ?? [];
  return (
    <dl className="flex items-center gap-4" aria-label="Signals outside their normal range">
      {abnormal.map((signal) => (
        <div
          key={signal.key}
          className="min-w-[104px] shrink-0 animate-swap"
          title={signal.label}
          data-testid={`deviation-${signal.key}`}
        >
          <div className="flex items-baseline justify-between gap-3 whitespace-nowrap">
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
  );
}

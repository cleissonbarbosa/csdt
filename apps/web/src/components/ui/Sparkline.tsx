import { t } from '@/i18n';
import { COLOR } from '@/lib/palette';

interface SparklineProps {
  /** Values oldest → newest. Typed arrays are accepted. */
  values: ArrayLike<number>;
  /** Number of leading entries that are valid (defaults to all). */
  length?: number;
  width?: number;
  height?: number;
  /** Line colour; ink unless the series itself is in an abnormal state. */
  color?: string;
  /** Fixed upper bound; defaults to the largest value. */
  max?: number;
  /** The range considered normal, drawn as a band behind the line. */
  normal?: readonly [number, number];
  label: string;
  /**
   * Where each value stands along the line, in any unit (a time, say).
   * Without it the values are evenly spaced.
   */
  at?: ArrayLike<number>;
  /** The stretch the line spans, in the unit of `at`; its first and last value without it. */
  span?: readonly [number, number];
  /**
   * A value that is not a number (`NaN`) is a gap: the line stops there and
   * starts again after it, instead of being drawn across what is not known.
   */
  gaps?: boolean;
  /** A moment to mark across the line, in the unit of `at` (an index without it). */
  cursor?: number;
}

/**
 * A trend without axes. It only means something next to its normal range,
 * so that range is drawn whenever it is known.
 */
export function Sparkline({
  values,
  length = values.length,
  width = 120,
  height = 28,
  color = COLOR.inkDim,
  max,
  normal,
  label,
  at,
  span,
  gaps = false,
  cursor,
}: SparklineProps) {
  const count = Math.min(length, values.length, at ? at.length : Infinity);
  const known = (value: number) => !gaps || Number.isFinite(value);
  let drawn = 0;
  for (let i = 0; i < count; i++) if (known(values[i]!)) drawn++;
  if (gaps ? drawn === 0 : count < 2) {
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t('{label}: not enough data', { label })}
      />
    );
  }
  let top = max ?? 0;
  if (max === undefined) {
    for (let i = 0; i < count; i++) if (known(values[i]!)) top = Math.max(top, values[i]!);
    if (normal) top = Math.max(top, normal[1] * 1.15);
  }
  if (top <= 0) top = 1;
  const yOf = (value: number) => height - 1 - (Math.min(value, top) / top) * (height - 2);
  const from = span?.[0] ?? (at ? at[0]! : 0);
  const to = span?.[1] ?? (at ? at[count - 1]! : count - 1);
  const xOf = (position: number) => (to > from ? ((position - from) / (to - from)) * width : 0);
  const positionOf = (i: number) => (at ? at[i]! : i);

  // Without gaps the line is one run, as it always was; with them, a run
  // ends where a value is missing.
  const runs: [string, string][][] = [];
  let run: [string, string][] = [];
  for (let i = 0; i < count; i++) {
    const value = values[i]!;
    if (!known(value)) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push([xOf(positionOf(i)).toFixed(1), yOf(value).toFixed(1)]);
  }
  if (run.length > 0) runs.push(run);
  const marked = cursor !== undefined && cursor >= from && cursor <= to ? xOf(cursor) : null;

  return (
    <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
      {normal && (
        <rect
          x={0}
          y={yOf(normal[1])}
          width={width}
          height={Math.max(1, yOf(normal[0]) - yOf(normal[1]))}
          fill={COLOR.line}
          opacity={0.7}
        />
      )}
      {runs.map((points, i) =>
        points.length === 1 ? (
          // A value with nothing known on either side is a point, not a line.
          <circle key={i} cx={points[0]![0]} cy={points[0]![1]} r={1.25} fill={color} />
        ) : (
          <polyline
            key={i}
            points={points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="1.25"
            strokeLinejoin="round"
          />
        ),
      )}
      {marked !== null && (
        <line
          x1={marked}
          x2={marked}
          y1={0}
          y2={height}
          stroke={COLOR.ink}
          strokeWidth={1}
          data-cursor=""
        />
      )}
    </svg>
  );
}

interface RangeBarProps {
  /** Current value and the value that fills the bar. */
  value: number;
  max: number;
  /** The range considered normal. */
  normal: readonly [number, number];
  /** Marker colour: a signal colour when the value is outside the range. */
  tone?: string;
  className?: string;
}

/**
 * A value against its normal range: a neutral band and a marker. The reading
 * "is this where it should be?" takes one glance and no arithmetic.
 */
export function RangeBar({ value, max, normal, tone, className }: RangeBarProps) {
  const pct = (v: number) => `${(Math.min(1, Math.max(0, v / (max || 1))) * 100).toFixed(1)}%`;
  return (
    <span className={`relative block h-1 bg-line ${className ?? ''}`} aria-hidden>
      <span
        className="absolute inset-y-0 bg-line-strong"
        style={{ left: pct(normal[0]), right: `calc(100% - ${pct(normal[1])})` }}
      />
      <span
        // The marker glides between readings instead of jumping: updates
        // arrive five times a second and a needle should look like one.
        className="absolute -top-[3px] h-[10px] w-[2px] -translate-x-1/2 transition-[left] duration-200 ease-linear"
        style={{ left: pct(value), backgroundColor: tone ?? COLOR.ink }}
      />
    </span>
  );
}

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
}: SparklineProps) {
  const count = Math.min(length, values.length);
  if (count < 2) {
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
    for (let i = 0; i < count; i++) top = Math.max(top, values[i]!);
    if (normal) top = Math.max(top, normal[1] * 1.15);
  }
  if (top <= 0) top = 1;
  const yOf = (value: number) => height - 1 - (Math.min(value, top) / top) * (height - 2);
  const points: string[] = [];
  for (let i = 0; i < count; i++) {
    points.push(`${((i / (count - 1)) * width).toFixed(1)},${yOf(values[i]!).toFixed(1)}`);
  }
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
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
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

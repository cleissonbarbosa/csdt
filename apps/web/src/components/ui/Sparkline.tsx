import { useId } from 'react';

interface SparklineProps {
  /** Values oldest → newest. Typed arrays are accepted. */
  values: ArrayLike<number>;
  /** Number of leading entries that are valid (defaults to all). */
  length?: number;
  width?: number;
  height?: number;
  color: string;
  /** Fixed upper bound; defaults to the largest value. */
  max?: number;
  label: string;
}

/** A tiny area chart. Decorative detail; the number next to it is the data. */
export function Sparkline({
  values,
  length = values.length,
  width = 120,
  height = 28,
  color,
  max,
  label,
}: SparklineProps) {
  const id = useId();
  const count = Math.min(length, values.length);
  if (count < 2) {
    return (
      <svg width={width} height={height} role="img" aria-label={`${label}: not enough data`} />
    );
  }
  let top = max ?? 0;
  if (max === undefined) for (let i = 0; i < count; i++) top = Math.max(top, values[i]!);
  if (top <= 0) top = 1;
  const points: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * width;
    const y = height - 1 - (Math.min(values[i]!, top) / top) * (height - 3);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const line = points.join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

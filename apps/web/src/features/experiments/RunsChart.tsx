/**
 * One figure over two runs of one incident.
 *
 * Run A is the dashed line and run B the solid one: told apart by the
 * stroke, so neither needs a colour. The thin tick is where the incident
 * begins; a thick one, where there is one, is where run B was changed.
 */
import type { MetricSample } from '@aegis/contracts';

import { t } from '@/i18n';
import { COLOR } from '@/lib/palette';

const CHART_W = 560;
const CHART_H = 96;

export function RunsChart({
  a,
  b,
  durationMs,
  startedAtMs,
  placedAtMs,
  label,
  value,
  format,
  summary,
}: {
  a: MetricSample[];
  b: MetricSample[];
  durationMs: number;
  startedAtMs: number;
  /** Where run B was changed, when it was changed at one moment. */
  placedAtMs?: number;
  label: string;
  value: (sample: MetricSample) => number;
  format: (value: number) => string;
  /** The chart in a sentence, given the highest figure of each run. */
  summary: (a: string, b: string) => string;
}) {
  const end = Math.max(1, durationMs);
  let top = 0;
  for (const sample of a) top = Math.max(top, value(sample));
  for (const sample of b) top = Math.max(top, value(sample));
  const peak = top;
  // Headroom, so a line at its highest does not run along the frame.
  top = top > 0 ? top * 1.12 : 1;
  const x = (ms: number) => (ms / end) * CHART_W;
  const y = (v: number) => CHART_H - 3 - (v / top) * (CHART_H - 12);
  const line = (samples: MetricSample[]) =>
    samples.map((s) => `${x(s.virtualTimeMs).toFixed(1)},${y(value(s)).toFixed(1)}`).join(' ');
  return (
    <figure className="min-w-0">
      <figcaption className="caption mb-1 flex items-baseline justify-between gap-2">
        <span>{label}</span>
        <span className="numeric">{t('up to {peak}', { peak: format(peak) })}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="h-24 w-full rounded-control border border-line bg-sunken"
        role="img"
        aria-label={summary(
          format(Math.max(0, ...a.map(value))),
          format(Math.max(0, ...b.map(value))),
        )}
      >
        <rect x={x(startedAtMs)} y={0} width={1} height={CHART_H} fill={COLOR.inkFaint} />
        {placedAtMs !== undefined && (
          <rect x={x(placedAtMs) - 0.75} y={0} width={1.5} height={CHART_H} fill={COLOR.ink} />
        )}
        <polyline
          points={line(a)}
          fill="none"
          stroke={COLOR.inkDim}
          strokeWidth={1.4}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line(b)}
          fill="none"
          stroke={COLOR.ink}
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

/** The stroke of one of the two runs, for the line under the charts that names them. */
export function RunStroke({ run }: { run: 'a' | 'b' }) {
  return (
    <svg width="22" height="6" aria-hidden>
      {run === 'a' ? (
        <line
          x1="0"
          y1="3"
          x2="22"
          y2="3"
          stroke={COLOR.inkDim}
          strokeWidth="1.4"
          strokeDasharray="5 4"
        />
      ) : (
        <line x1="0" y1="3" x2="22" y2="3" stroke={COLOR.ink} strokeWidth="1.6" />
      )}
    </svg>
  );
}

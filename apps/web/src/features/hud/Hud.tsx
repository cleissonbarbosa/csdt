import type { Health } from '@aegis/contracts';

import { sceneHandle } from '@/graphics/handle';
import { cn } from '@/lib/cn';
import { formatMs, formatPercent, formatRate } from '@/lib/format';
import { COLOR, HEALTH_COLOR, HEALTH_LABEL } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';

function Metric({
  label,
  value,
  tone,
  testId,
  wide,
}: {
  label: string;
  value: string;
  tone?: string;
  testId: string;
  wide?: boolean;
}) {
  return (
    <div className={cn('flex shrink-0 flex-col px-3 py-1.5', wide ? 'w-[104px]' : 'w-[92px]')}>
      <dt className="eyebrow whitespace-nowrap">{label}</dt>
      <dd
        className="numeric mt-0.5 whitespace-nowrap text-[15px] font-medium leading-tight text-ink"
        style={tone ? { color: tone } : undefined}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

/** Colour for a rate that is fine below `warn` and alarming above `alarm`. */
function grade(value: number, warn: number, alarm: number): string | undefined {
  if (value >= alarm) return COLOR.critical;
  if (value >= warn) return COLOR.warning;
  return undefined;
}

/** Platform-wide figures. Every number comes from the latest snapshot. */
export function Hud() {
  const global = useTelemetry((state) => state.snapshot?.global);
  const baselineP95 = useTelemetry((state) => state.history[0]?.p95LatencyMs);
  if (!global) return null;
  const total =
    global.health.healthy + global.health.degraded + global.health.critical + global.health.down;
  const latencyTone =
    baselineP95 !== undefined
      ? grade(global.p95LatencyMs / Math.max(1, baselineP95), 1.6, 2.5)
      : undefined;
  return (
    <dl
      className="panel panel-ticks flex items-stretch divide-x divide-line/70 rounded-md"
      aria-label="Platform metrics"
      data-testid="hud"
    >
      <Metric label="Requests/s" value={formatRate(global.rps)} testId="hud-rps" />
      <Metric label="Avg latency" value={formatMs(global.avgLatencyMs)} testId="hud-avg" wide />
      <Metric
        label="p95"
        value={formatMs(global.p95LatencyMs)}
        tone={latencyTone}
        testId="hud-p95"
      />
      <Metric
        label="p99"
        value={formatMs(global.p99LatencyMs)}
        tone={latencyTone}
        testId="hud-p99"
      />
      <Metric
        label="Errors"
        value={formatPercent(global.errorRate)}
        tone={grade(global.errorRate, 0.01, 0.05)}
        testId="hud-errors"
      />
      <Metric
        label="Denials"
        value={formatPercent(global.authzDenialRate)}
        tone={grade(global.authzDenialRate, 0.12, 0.2)}
        testId="hud-denials"
      />
      <Metric
        label="Incidents"
        value={String(global.activeIncidents)}
        tone={global.activeIncidents > 0 ? COLOR.critical : undefined}
        testId="hud-incidents"
      />
      <div className="flex w-[150px] shrink-0 flex-col justify-center px-3 py-1.5">
        <dt className="eyebrow">Service health</dt>
        <dd className="mt-1.5">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-abyss" aria-hidden>
            {(['healthy', 'degraded', 'critical', 'down'] as const).map((health) =>
              global.health[health] > 0 ? (
                <div
                  key={health}
                  style={{
                    width: `${(global.health[health] / Math.max(1, total)) * 100}%`,
                    backgroundColor: HEALTH_COLOR[health],
                  }}
                />
              ) : null,
            )}
          </div>
          <p className="numeric mt-1 flex gap-2 text-[10px]" data-testid="hud-health">
            {(['healthy', 'degraded', 'critical', 'down'] as const).map((health) => (
              <span
                key={health}
                style={{ color: HEALTH_COLOR[health] }}
                title={HEALTH_LABEL[health]}
              >
                <span className="sr-only">{HEALTH_LABEL[health]}: </span>
                {global.health[health]}
              </span>
            ))}
          </p>
        </dd>
      </div>
    </dl>
  );
}

/** One chip per region: status at a glance, click to frame it. */
export function RegionStrip() {
  const regions = useTelemetry((state) => state.snapshot?.regions);
  const topology = useTelemetry((state) => state.topology);
  if (!regions || !topology) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Regional status">
      {regions.map((status) => {
        const region = topology.regions.find((r) => r.id === status.id);
        const health: Health = status.health;
        return (
          <li key={status.id}>
            <button
              type="button"
              onClick={() => sceneHandle.current?.frameRegion(status.id)}
              className="panel flex items-center gap-2 rounded-[3px] px-2 py-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
              title={`${region?.name ?? status.id}: ${HEALTH_LABEL[health]}, ${status.nodesUnhealthy} of ${status.nodesTotal} services unhealthy`}
              data-testid={`region-${status.id}`}
              data-health={health}
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  health !== 'healthy' && 'animate-pulse-soft',
                )}
                style={{ backgroundColor: HEALTH_COLOR[health] }}
              />
              <span className="font-display font-semibold uppercase tracking-[0.1em]">
                {region?.name ?? status.id}
              </span>
              <span className="sr-only">{HEALTH_LABEL[health]}</span>
              <span className="numeric text-ink-faint">{formatRate(status.rps)}/s</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What an embedded model says about itself, in one line in a corner of the
 * stage: that it is a simulation, how the platform is, and where the whole
 * application is. It stands in for the bar, which an embed does not have.
 */
import { ExternalLink } from 'lucide-react';

import { fullAddress } from '@/app/embed';
import { HealthGlyph } from '@/components/ui/Badge';
import { HEALTH_COLOR } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';

import { Logo } from './Logo';

export function EmbedBar() {
  const global = useTelemetry((state) => state.snapshot?.global);
  const incident = useTelemetry((state) => state.snapshot?.incident ?? null);
  const unhealthy = global
    ? global.health.degraded + global.health.critical + global.health.down
    : 0;
  const total = global ? unhealthy + global.health.healthy : 0;
  const level =
    !global || unhealthy === 0
      ? 'healthy'
      : global.health.down > 0
        ? 'down'
        : global.health.critical > 0
          ? 'critical'
          : 'degraded';
  const running = incident !== null && incident.status !== 'resolved';
  return (
    <div
      className="panel floating pointer-events-auto absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-2 px-2 py-1 text-[11px] text-ink-dim"
      data-testid="embed-bar"
    >
      <span className="flex items-center gap-1.5 text-ink">
        <Logo />
        <span className="font-bold">AEGIS</span>
      </span>
      <span className="max-sm:hidden">Simulated, synthetic data</span>
      {global && (
        <span
          role="status"
          className={unhealthy > 0 ? 'flex items-center gap-1 font-bold' : 'truncate'}
          style={unhealthy > 0 ? { color: HEALTH_COLOR[level] } : undefined}
          data-testid="embed-status"
        >
          {unhealthy > 0 && <HealthGlyph health={level} size={9} />}
          {running
            ? `${incident.phaseName}, ${incident.impactedNodeIds.length} affected`
            : unhealthy > 0
              ? `${unhealthy} of ${total} services not normal`
              : `${total} services, all normal`}
        </span>
      )}
      <a
        href={fullAddress(window.location)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1 text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
        data-testid="embed-open"
      >
        Open <ExternalLink size={11} aria-hidden />
      </a>
    </div>
  );
}

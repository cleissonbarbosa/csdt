import { useEffect, useState } from 'react';

import { sceneHandle } from '@/graphics/handle';
import type { SceneStats } from '@/graphics/SceneController';
import { formatCount } from '@/lib/format';
import { COLOR } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';

/** Renderer statistics, sampled twice a second from the scene controller. */
export function DevOverlay() {
  const [stats, setStats] = useState<SceneStats | null>(null);
  const latency = useTelemetry((state) => state.latencyMs);
  const tick = useTelemetry((state) => state.playback?.tick ?? 0);
  useEffect(() => {
    const read = () => setStats(sceneHandle.current?.getStats() ?? null);
    read();
    const timer = setInterval(read, 500);
    return () => clearInterval(timer);
  }, []);
  if (!stats) return null;
  // A frame rate only takes a colour when it has dropped.
  const fpsTone = stats.fps >= 55 ? undefined : stats.fps >= 40 ? COLOR.warning : COLOR.critical;
  const rows: [string, string, string?][] = [
    ['FPS', stats.fps.toFixed(0), fpsTone],
    ['Frame', `${stats.frameMs.toFixed(1)} ms`],
    ['Frame p95', `${stats.frameMsP95.toFixed(1)} ms`],
    ['Draw calls', String(stats.drawCalls)],
    ['Triangles', formatCount(stats.triangles)],
    ['Beads', `${formatCount(stats.particles)} of ${formatCount(stats.particleCapacity)}`],
    ['Objects', `${stats.nodes} services, ${stats.edges} connections`],
    ['Backend', stats.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'],
    ['Quality', `${stats.quality} at ${stats.pixelRatio.toFixed(2)}×`],
    ['Stream', latency === null ? '–' : `${latency.toFixed(0)} ms, tick ${tick}`],
  ];
  return (
    <aside
      className="panel pointer-events-none px-2.5 py-2"
      aria-label="Performance overlay"
      data-testid="dev-overlay"
    >
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[11px]">
        {rows.map(([label, value, tone]) => (
          <div key={label} className="contents">
            <dt className="text-ink-faint">{label}</dt>
            <dd className="numeric text-right text-ink" style={tone ? { color: tone } : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

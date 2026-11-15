import { HEALTH_BY_CODE } from '@aegis/contracts';
import { Maximize2, RotateCcw } from 'lucide-react';

import { HealthBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { sceneHandle } from '@/graphics/handle';
import { formatMs, formatRate } from '@/lib/format';
import { SERVICE_TYPE } from '@/lib/palette';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { filtersActive, useUi, type LayoutMode } from '@/stores/ui';

const LAYOUTS: { value: LayoutMode; label: string }[] = [
  { value: 'regions', label: 'Regions' },
  { value: 'dependencies', label: 'Dependencies' },
];

/** Camera and layout controls floating over the scene. */
export function SceneToolbar() {
  const layoutMode = useUi((state) => state.layoutMode);
  const filters = useUi((state) => state.filters);
  return (
    <div
      className="panel flex items-center gap-1.5 rounded-[3px] p-1"
      role="toolbar"
      aria-label="Scene controls"
    >
      <Segmented
        label="Topology layout"
        size="sm"
        value={layoutMode}
        options={LAYOUTS}
        onChange={(mode) => useUi.getState().setLayoutMode(mode)}
      />
      <IconButton
        label="Frame everything"
        size="sm"
        onClick={() => sceneHandle.current?.frameAll()}
        data-testid="scene-frame"
      >
        <Maximize2 size={13} />
      </IconButton>
      <IconButton
        label="Reset camera"
        size="sm"
        onClick={() => sceneHandle.current?.resetView()}
        data-testid="scene-reset"
      >
        <RotateCcw size={13} />
      </IconButton>
      {filtersActive(filters) && (
        <Button size="sm" variant="ghost" onClick={() => useUi.getState().clearFilters()}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

/** Contents of the tooltip the scene anchors to the hovered service. */
export function HoverCard() {
  const hoveredId = useUi((state) => state.hoveredNodeId);
  const topology = useTelemetry((state) => state.topology);
  const index = useTelemetry((state) => state.index);
  const snapshot = useTelemetry((state) => state.snapshot);
  if (!hoveredId || !topology || !index) return null;
  const i = index.nodeIndex.get(hoveredId);
  const node = i === undefined ? undefined : topology.nodes[i];
  if (!node || i === undefined) return null;
  const health = HEALTH_BY_CODE[snapshot?.nodes.health[i] ?? 0] ?? node.metrics.health;
  return (
    <div
      // Keyed by the service so the card arrives again for each new piece.
      key={hoveredId}
      className="-translate-x-1/2 -translate-y-[calc(100%+22px)]"
    >
      <div className="panel animate-rise whitespace-nowrap rounded-[3px] px-2.5 py-1.5">
        <p className="text-xs font-bold text-ink">{node.name}</p>
        <p className="caption">{SERVICE_TYPE[node.serviceType].label}</p>
        <p className="mt-1 flex items-center gap-2.5 text-[11px]">
          {health !== 'healthy' && <HealthBadge health={health} />}
          <span className="numeric text-ink-dim">
            {formatRate(snapshot?.nodes.throughputRps[i] ?? 0)}/s
          </span>
          <span className="numeric text-ink-dim">
            {formatMs(snapshot?.nodes.latencyMs[i] ?? 0)}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Polite live region for action results and errors. */
export function Notices() {
  const notices = useNotices((state) => state.notices);
  return (
    <div
      className="pointer-events-none flex flex-col items-center gap-1.5"
      role="status"
      aria-live="polite"
    >
      {notices.map((notice) => (
        <button
          key={notice.id}
          type="button"
          onClick={() => useNotices.getState().dismiss(notice.id)}
          className={`panel pointer-events-auto max-w-md animate-rise rounded-[3px] px-3 py-1.5 text-left text-xs ${
            notice.tone === 'error' ? 'font-bold text-critical' : 'text-ink'
          }`}
        >
          {notice.message}
        </button>
      ))}
    </div>
  );
}

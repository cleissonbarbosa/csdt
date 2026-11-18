import { HEALTH_BY_CODE } from '@aegis/contracts';
import { Maximize2, RotateCcw } from 'lucide-react';

import { HealthBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { CaptureHover } from '@/features/capture/CaptureHover';
import { sceneHandle } from '@/graphics/handle';
import { t } from '@/i18n';
import { formatMs, formatRate } from '@/lib/format';
import { overviewOf, projectSnapshot } from '@/lib/overview';
import { SERVICE_TYPE } from '@/lib/palette';
import { selectOpen, useCapture } from '@/stores/capture';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { filtersActive, useUi, type LayoutMode } from '@/stores/ui';

/** The overview first, then the two arrangements that show every service. */
const LAYOUTS: { value: LayoutMode; label: string }[] = [
  { value: 'layers', label: t('Overview') },
  { value: 'regions', label: t('Regions') },
  { value: 'dependencies', label: t('Dependencies') },
];

/**
 * Camera and layout controls floating over the scene. An incident capture
 * is drawn by region only and has no filters, so while one is open the
 * toolbar keeps the camera's two controls.
 */
export function SceneToolbar() {
  const layoutMode = useUi((state) => state.layoutMode);
  const filters = useUi((state) => state.filters);
  const captured = useCapture(selectOpen);
  return (
    <div
      className="panel flex items-center gap-1.5 p-1"
      role="toolbar"
      aria-label={t('Scene controls')}
    >
      {!captured && (
        <Segmented
          label={t('Topology layout')}
          size="sm"
          value={layoutMode}
          options={LAYOUTS}
          testId="layout"
          onChange={(mode) => useUi.getState().setLayoutMode(mode)}
        />
      )}
      <IconButton
        label={t('Frame everything')}
        size="sm"
        onClick={() => sceneHandle.current?.frameAll()}
        data-testid="scene-frame"
      >
        <Maximize2 size={13} />
      </IconButton>
      <IconButton
        label={t('Reset camera')}
        size="sm"
        onClick={() => sceneHandle.current?.resetView()}
        data-testid="scene-reset"
      >
        <RotateCcw size={13} />
      </IconButton>
      {!captured && filtersActive(filters) && (
        <Button size="sm" variant="ghost" onClick={() => useUi.getState().clearFilters()}>
          {t('Clear filters')}
        </Button>
      )}
    </div>
  );
}

/**
 * Contents of the tooltip the scene anchors to the piece being pointed at:
 * the simulation's service, or a captured one while a capture is open.
 */
export function HoverCard() {
  const captured = useCapture(selectOpen);
  return captured ? <CaptureHover /> : <SimulationHoverCard />;
}

function SimulationHoverCard() {
  const hoveredId = useUi((state) => state.hoveredNodeId);
  const layers = useUi((state) => state.layoutMode === 'layers');
  const source = useTelemetry((state) => state.topology);
  const raw = useTelemetry((state) => state.snapshot);
  if (!hoveredId || !source) return null;
  // In the overview the piece is a kind of service; a service pointed at in
  // a list is shown as the kind it belongs to.
  const overview = layers ? overviewOf(source) : null;
  const topology = overview?.topology ?? source;
  const id = overview ? (overview.groupOfNode.get(hoveredId) ?? hoveredId) : hoveredId;
  const i = topology.nodes.findIndex((node) => node.id === id);
  const node = topology.nodes[i];
  if (!node) return null;
  const current = raw && raw.topologyId === source.id ? raw : null;
  const snapshot = overview && current ? projectSnapshot(overview, current) : current;
  const health = HEALTH_BY_CODE[snapshot?.nodes.health[i] ?? 0] ?? node.metrics.health;
  const count = overview?.members[i]?.length ?? 1;
  return (
    <div
      // Keyed by the piece so the card arrives again for each new one.
      key={id}
      className="-translate-x-1/2 -translate-y-[calc(100%+22px)]"
    >
      <div className="panel floating animate-rise whitespace-nowrap px-2.5 py-1.5">
        <p className="text-xs font-bold text-ink">{node.name}</p>
        <p className="caption">
          {count > 1
            ? t('{n} {kinds}', { n: count, kinds: SERVICE_TYPE[node.serviceType].plural })
            : SERVICE_TYPE[node.serviceType].label}
        </p>
        <p className="mt-1 flex items-center gap-2.5 text-[11px]">
          {health !== 'healthy' && <HealthBadge health={health} />}
          <span className="numeric text-ink-dim">
            {formatRate(snapshot?.nodes.throughputRps[i] ?? node.metrics.throughputRps)}/s
          </span>
          <span className="numeric text-ink-dim">
            {formatMs(snapshot?.nodes.latencyMs[i] ?? node.metrics.latencyMs)}
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
        <div
          key={notice.id}
          className="panel pointer-events-auto flex max-w-md animate-rise items-center gap-1"
        >
          <button
            type="button"
            onClick={() => useNotices.getState().dismiss(notice.id)}
            title={t('Dismiss')}
            className={`min-w-0 px-3 py-1.5 text-left text-xs ${
              notice.tone === 'error' ? 'font-bold text-critical' : 'text-ink'
            }`}
          >
            {notice.message}
          </button>
          {notice.action && (
            <button
              type="button"
              onClick={() => {
                notice.action?.run();
                useNotices.getState().dismiss(notice.id);
              }}
              className="mr-1.5 shrink-0 rounded-control border border-line-strong px-2 py-0.5 text-[11px] text-ink hover:bg-raised"
              data-testid="notice-action"
            >
              {notice.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

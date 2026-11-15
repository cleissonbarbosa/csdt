import * as Tabs from '@radix-ui/react-tabs';
import { useCallback, useEffect, useState } from 'react';

import { actions } from '@/app/actions';
import { useAegisConnection } from '@/app/useAegisConnection';
import { Button } from '@/components/ui/Button';
import { AuthorizationExplorer } from '@/features/authorization/AuthorizationExplorer';
import { Explorer } from '@/features/explorer/Explorer';
import { HelpDialog } from '@/features/help/HelpDialog';
import { Hud, RegionStrip } from '@/features/hud/Hud';
import { Inspector } from '@/features/inspector/Inspector';
import { IntegrationsDialog } from '@/features/integrations/IntegrationsDialog';
import { ScenarioConsole } from '@/features/scenarios/ScenarioConsole';
import { DevOverlay } from '@/features/scene/DevOverlay';
import { SceneCanvas } from '@/features/scene/SceneCanvas';
import { HoverCard, Notices, SceneToolbar } from '@/features/scene/SceneOverlays';
import { TopologyTable } from '@/features/scene/TopologyTable';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { Timeline } from '@/features/timeline/Timeline';
import { TopNav } from '@/features/topnav/TopNav';
import { sceneHandle } from '@/graphics/handle';
import {
  canRender3D,
  detectRenderingSupport,
  probeRenderingSupport,
  type RenderingSupport,
} from '@/graphics/renderer';
import { cn } from '@/lib/cn';
import { useTelemetry } from '@/stores/telemetry';
import { prefersReducedMotion, useSettings, useUi } from '@/stores/ui';

const LEFT_WIDTH = 304;
const RIGHT_WIDTH = 344;
const GUTTER = 8;

const tabClass =
  'flex-1 border-b-2 border-transparent px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-ink data-[state=active]:border-cyan data-[state=active]:text-ink';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const ui = useUi.getState();
      const settings = useSettings.getState();
      switch (event.key) {
        case ' ': {
          // Space on a button or a slider belongs to that control.
          if (
            event.target instanceof HTMLElement &&
            event.target.closest('button, [role="slider"], [role="radio"], [role="tab"], summary')
          )
            return;
          const playing = useTelemetry.getState().playback?.status === 'playing';
          void actions.control({ action: playing ? 'pause' : 'play' });
          break;
        }
        case 'r':
        case 'R':
          sceneHandle.current?.resetView();
          break;
        case 'f':
        case 'F':
          if (ui.selection?.kind === 'node') sceneHandle.current?.focusNode(ui.selection.id);
          else sceneHandle.current?.frameAll();
          break;
        case 'l':
        case 'L':
          ui.setLayoutMode(ui.layoutMode === 'regions' ? 'dependencies' : 'regions');
          break;
        case 't':
        case 'T':
          ui.setViewMode(ui.viewMode === 'scene' ? 'table' : 'scene');
          break;
        case 'p':
        case 'P':
          settings.set('devOverlay', !settings.devOverlay);
          break;
        case '/':
          ui.setLeftTab('explorer');
          requestAnimationFrame(() =>
            document.querySelector<HTMLInputElement>('[data-testid="explorer-search"]')?.focus(),
          );
          break;
        case '?':
          ui.setPanel('help');
          break;
        case 'Escape':
          if (ui.openPanel === null && ui.selection) ui.select(null);
          else return;
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Unreachable({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6" role="alert">
      <div className="panel panel-ticks max-w-md rounded-md p-6 text-center">
        <p className="eyebrow text-critical">No telemetry</p>
        <h2 className="mt-2 font-display text-lg font-semibold text-ink">
          The AEGIS server is not answering
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">{message}</p>
        <p className="numeric mt-3 rounded-[3px] border border-line bg-abyss px-2 py-1.5 text-[11px] text-ink-dim">
          cargo run -p aegis-server
        </p>
        <p className="mt-3 text-[11px] text-ink-faint">
          The interface reconnects by itself as soon as the server is up. Nothing is shown in the
          meantime: AEGIS does not invent data.
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Retry now
        </Button>
      </div>
    </div>
  );
}

export function App() {
  useAegisConnection();
  useShortcuts();

  const viewMode = useUi((state) => state.viewMode);
  const explorerOpen = useUi((state) => state.explorerOpen);
  const inspectorOpen = useUi((state) => state.inspectorOpen);
  const leftTab = useUi((state) => state.leftTab);
  const authorizationOpen = useUi((state) => state.openPanel === 'authorization');
  const incidentActive = useTelemetry((state) => state.snapshot?.incident != null);
  const hasTopology = useTelemetry((state) => state.topology !== null);
  const loadError = useTelemetry((state) => state.loadError);
  const devOverlay = useSettings((state) => state.devOverlay);
  const motion = useSettings((state) => state.motion);

  const [tooltip, setTooltip] = useState<HTMLDivElement | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  // Without `navigator.gpu` the answer is known at once; with it, an adapter
  // has to be requested before WebGPU can be counted on.
  const [support, setSupport] = useState<RenderingSupport | null>(() => {
    const quick = detectRenderingSupport();
    return quick.webgpu ? null : quick;
  });
  useEffect(() => {
    if (support !== null) return;
    let cancelled = false;
    void probeRenderingSupport().then((result) => {
      if (!cancelled) setSupport(result);
    });
    return () => {
      cancelled = true;
    };
  }, [support]);
  const probing = support === null;
  const can3D = support !== null && canRender3D(support) && sceneError === null;
  const showScene = viewMode === 'scene' && can3D;

  // Small screens start with the side panels tucked away.
  useEffect(() => {
    const ui = useUi.getState();
    if (window.innerWidth < 1180) ui.setInspectorOpen(false);
    if (window.innerWidth < 860) ui.setExplorerOpen(false);
  }, []);

  const left = explorerOpen ? LEFT_WIDTH + GUTTER * 2 : 0;
  const right = inspectorOpen ? RIGHT_WIDTH + GUTTER * 2 : 0;
  useEffect(() => {
    sceneHandle.current?.setViewInsets({ left, right, top: 100, bottom: 56 });
  }, [left, right, showScene, hasTopology]);
  const onRuntime = useCallback(() => {
    sceneHandle.current?.setViewInsets({ left, right, top: 100, bottom: 56 });
  }, [left, right]);

  const unavailable =
    sceneError !== null
      ? 'The 3D renderer could not start on this device. Showing the table view instead.'
      : support !== null && !canRender3D(support)
        ? 'This browser offers neither WebGPU nor WebGL 2, so the 3D scene is unavailable. Showing the table view instead.'
        : null;

  return (
    <div
      className="flex h-full flex-col"
      data-reduced-motion={prefersReducedMotion(motion)}
      data-testid="app"
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-xs"
      >
        Skip to the topology
      </a>
      <TopNav />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <main
          id="main"
          tabIndex={-1}
          className="absolute inset-0"
          aria-label="Infrastructure topology"
        >
          {probing ? null : showScene ? (
            <SceneCanvas
              tooltip={tooltip}
              onRuntime={onRuntime}
              onUnavailable={(reason) => {
                console.warn(`[aegis] 3D renderer unavailable: ${reason}`);
                setSceneError(reason);
              }}
            />
          ) : (
            <div
              className="h-full"
              style={{ paddingLeft: left, paddingRight: right, paddingTop: 92 }}
            >
              <TopologyTable notice={viewMode === 'scene' ? unavailable : null} />
            </div>
          )}
        </main>
        {!hasTopology && loadError && <Unreachable message={loadError} />}

        {/* Hover tooltip: the scene moves this element, React fills it. */}
        <div ref={setTooltip} className="pointer-events-none invisible absolute left-0 top-0 z-10">
          <HoverCard />
        </div>

        <div
          className="pointer-events-none absolute top-2 z-10 flex flex-col items-center gap-1.5 px-2"
          style={{ left, right }}
        >
          <div className="pointer-events-auto max-w-full overflow-x-auto">
            <Hud />
          </div>
          <div className="pointer-events-auto">
            <RegionStrip />
          </div>
          <Notices />
        </div>

        <div
          className="pointer-events-none absolute bottom-2 z-10 flex items-end justify-between gap-2 px-2"
          style={{ left, right }}
        >
          <div className="pointer-events-auto">{showScene && devOverlay && <DevOverlay />}</div>
          <div className="pointer-events-auto">{showScene && <SceneToolbar />}</div>
        </div>

        {explorerOpen && (
          <aside
            className="panel absolute bottom-2 left-2 top-2 z-20 flex flex-col rounded-md"
            style={{ width: LEFT_WIDTH }}
            aria-label="Explorer and incidents"
          >
            <Tabs.Root
              value={leftTab}
              onValueChange={(value) => useUi.getState().setLeftTab(value as typeof leftTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <Tabs.List className="flex shrink-0 border-b border-line" aria-label="Left panel">
                <Tabs.Trigger value="explorer" className={tabClass} data-testid="tab-explorer">
                  Explorer
                </Tabs.Trigger>
                <Tabs.Trigger value="incidents" className={tabClass} data-testid="tab-incidents">
                  Incidents
                  {incidentActive && (
                    <span className="ml-1.5 inline-block size-1.5 animate-pulse-soft rounded-full bg-critical align-middle">
                      <span className="sr-only">(incident active)</span>
                    </span>
                  )}
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content
                value="explorer"
                className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
              >
                <Explorer />
              </Tabs.Content>
              <Tabs.Content
                value="incidents"
                className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
              >
                <ScenarioConsole />
              </Tabs.Content>
            </Tabs.Root>
          </aside>
        )}

        {inspectorOpen && (
          <aside
            className="panel absolute bottom-2 right-2 top-2 z-20 flex flex-col rounded-md"
            style={{ width: RIGHT_WIDTH }}
            aria-label="Inspector and authorization"
          >
            <Tabs.Root
              value={authorizationOpen ? 'authorization' : 'inspector'}
              onValueChange={(value) =>
                useUi.getState().setPanel(value === 'authorization' ? 'authorization' : null)
              }
              className="flex min-h-0 flex-1 flex-col"
            >
              <Tabs.List className="flex shrink-0 border-b border-line" aria-label="Right panel">
                <Tabs.Trigger value="inspector" className={tabClass} data-testid="tab-inspector">
                  Inspector
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="authorization"
                  className={tabClass}
                  data-testid="tab-authorization"
                >
                  Authorization
                </Tabs.Trigger>
              </Tabs.List>
              {/* Both stay mounted so a decision survives a trip to the inspector. */}
              <Tabs.Content
                value="inspector"
                forceMount
                className={cn('min-h-0 flex-1 overflow-y-auto', authorizationOpen && 'hidden')}
              >
                <Inspector />
              </Tabs.Content>
              <Tabs.Content
                value="authorization"
                forceMount
                className={cn('flex min-h-0 flex-1 flex-col', !authorizationOpen && 'hidden')}
              >
                <AuthorizationExplorer />
              </Tabs.Content>
            </Tabs.Root>
          </aside>
        )}
      </div>

      <Timeline />
      <IntegrationsDialog />
      <SettingsDialog />
      <HelpDialog />
    </div>
  );
}

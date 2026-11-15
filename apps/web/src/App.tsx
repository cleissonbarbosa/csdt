import * as Tabs from '@radix-ui/react-tabs';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { actions } from '@/app/actions';
import { useAegisConnection } from '@/app/useAegisConnection';
import { usePresence } from '@/app/usePresence';
import { useTheme } from '@/app/useTheme';
import { Button } from '@/components/ui/Button';
import { AuthorizationExplorer } from '@/features/authorization/AuthorizationExplorer';
import { CommandPalette } from '@/features/command/CommandPalette';
import { Explorer } from '@/features/explorer/Explorer';
import { HelpDialog } from '@/features/help/HelpDialog';
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

const LEFT_WIDTH = 300;
const RIGHT_WIDTH = 340;
/** Space between a sheet and the edges of the stage it floats over. */
const GUTTER = 12;
/** Room the scene keeps clear at the top (its toolbar) and the bottom. */
const TOP_INSET = 28;
const BOTTOM_INSET = 8;

const tabClass =
  'relative z-10 flex-1 px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink data-[state=active]:font-bold data-[state=active]:text-ink';

/**
 * A panel that is called for rather than always there: a sheet of paper laid
 * on the stage, clear of its edges, sliding in from the side it belongs to.
 */
function Sheet({
  side,
  open,
  width,
  label,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  width: number;
  label: string;
  children: ReactNode;
}) {
  const presence = usePresence(open);
  if (!presence.mounted) return null;
  return (
    <aside
      className="sheet panel absolute z-20 flex flex-col overflow-hidden rounded-[3px]"
      data-side={side}
      data-state={presence.state}
      // Out of reach while it leaves; reachable from the first frame it is
      // asked for, so focus can be sent into it straight away.
      inert={!open}
      style={{
        width: `min(${width}px, calc(100% - ${GUTTER * 2}px))`,
        top: GUTTER,
        bottom: GUTTER,
        [side]: GUTTER,
      }}
      aria-label={label}
    >
      {children}
    </aside>
  );
}

/** The line under the active tab; it travels when the tab changes. */
function TabMarker({ index, count }: { index: number; count: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-ink transition-transform duration-200 ease-travel"
      style={{ width: `${100 / count}%`, transform: `translateX(${index * 100}%)` }}
    />
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The command palette opens from anywhere, including while typing.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const state = useUi.getState();
        state.setCommandOpen(!state.commandOpen);
        return;
      }
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
          // Let go of the selection first, then put the panels away.
          if (ui.openPanel === 'authorization') ui.setInspectorOpen(false);
          else if (ui.openPanel !== null) return;
          else if (ui.selection) ui.select(null);
          else if (ui.inspectorOpen) ui.setInspectorOpen(false);
          else if (ui.explorerOpen) ui.setExplorerOpen(false);
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
      <div className="panel max-w-md rounded-[3px] p-6">
        <h2 className="text-base font-bold text-ink">The AEGIS server is not answering</h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">{message}</p>
        <p className="mt-3 text-xs text-ink-dim">Start it with:</p>
        <p className="numeric mt-1 rounded-[3px] border border-line bg-sunken px-2 py-1.5 text-xs text-ink">
          cargo run -p aegis-server
        </p>
        <p className="caption mt-3">
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
  const theme = useTheme();

  const viewMode = useUi((state) => state.viewMode);
  const explorerOpen = useUi((state) => state.explorerOpen);
  const inspectorOpen = useUi((state) => state.inspectorOpen);
  const leftTab = useUi((state) => state.leftTab);
  const authorizationOpen = useUi((state) => state.openPanel === 'authorization');
  const selection = useUi((state) => state.selection);
  // Clearing the selection closes the inspector. While it slides away it
  // goes on showing what it showed, instead of flashing the overview.
  const [inspected, setInspected] = useState(selection);
  if (inspectorOpen && inspected !== selection) setInspected(selection);
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

  const left = explorerOpen ? LEFT_WIDTH + GUTTER : 0;
  const right = inspectorOpen ? RIGHT_WIDTH + GUTTER : 0;
  useEffect(() => {
    sceneHandle.current?.setViewInsets({ left, right, top: TOP_INSET, bottom: BOTTOM_INSET });
  }, [left, right, showScene, hasTopology]);
  const onRuntime = useCallback(() => {
    sceneHandle.current?.setViewInsets({ left, right, top: TOP_INSET, bottom: BOTTOM_INSET });
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
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-[3px] focus:border focus:border-ink focus:bg-paper focus:px-3 focus:py-2 focus:text-xs"
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
              theme={theme}
              tooltip={tooltip}
              onRuntime={onRuntime}
              onUnavailable={(reason) => {
                console.warn(`[aegis] 3D renderer unavailable: ${reason}`);
                setSceneError(reason);
              }}
            />
          ) : (
            <div
              className="h-full transition-[padding] duration-200 ease-arrive"
              style={{ paddingLeft: left, paddingRight: right }}
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
          className="pointer-events-none absolute top-3 z-10 flex items-start justify-end gap-2 px-3 transition-[left,right] duration-200 ease-arrive"
          style={{ left, right }}
        >
          <div className="pointer-events-auto">{showScene && <SceneToolbar />}</div>
        </div>
        <div
          className="pointer-events-none absolute top-3 z-30 flex justify-center px-3 transition-[left,right] duration-200 ease-arrive"
          style={{ left, right }}
        >
          <Notices />
        </div>

        {showScene && devOverlay && (
          <div
            className="absolute bottom-3 z-10 transition-[left] duration-200 ease-arrive"
            style={{ left: left + GUTTER }}
          >
            <DevOverlay />
          </div>
        )}

        <Sheet side="left" open={explorerOpen} width={LEFT_WIDTH} label="Explorer and incidents">
          <Tabs.Root
            value={leftTab}
            onValueChange={(value) => useUi.getState().setLeftTab(value as typeof leftTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <Tabs.List
              className="relative flex shrink-0 border-b border-line"
              aria-label="Left panel"
            >
              <Tabs.Trigger value="explorer" className={tabClass} data-testid="tab-explorer">
                Explorer
              </Tabs.Trigger>
              <Tabs.Trigger value="incidents" className={tabClass} data-testid="tab-incidents">
                Incidents
                {incidentActive && (
                  <span className="ml-1.5 inline-block size-[7px] bg-critical align-baseline">
                    <span className="sr-only">(incident active)</span>
                  </span>
                )}
              </Tabs.Trigger>
              <TabMarker index={leftTab === 'explorer' ? 0 : 1} count={2} />
            </Tabs.List>
            <Tabs.Content
              value="explorer"
              className="flex min-h-0 flex-1 animate-fade flex-col data-[state=inactive]:hidden"
            >
              <Explorer />
            </Tabs.Content>
            <Tabs.Content
              value="incidents"
              className="flex min-h-0 flex-1 animate-fade flex-col data-[state=inactive]:hidden"
            >
              <ScenarioConsole />
            </Tabs.Content>
          </Tabs.Root>
        </Sheet>

        <Sheet
          side="right"
          open={inspectorOpen}
          width={RIGHT_WIDTH}
          label="Inspector and authorization"
        >
          <Tabs.Root
            value={authorizationOpen ? 'authorization' : 'inspector'}
            onValueChange={(value) =>
              useUi.getState().setPanel(value === 'authorization' ? 'authorization' : null)
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            <Tabs.List
              className="relative flex shrink-0 border-b border-line"
              aria-label="Right panel"
            >
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
              <TabMarker index={authorizationOpen ? 1 : 0} count={2} />
            </Tabs.List>
            {/* Both stay mounted so a decision survives a trip to the inspector. */}
            <Tabs.Content
              value="inspector"
              forceMount
              className={cn('min-h-0 flex-1 overflow-y-auto', authorizationOpen && 'hidden')}
            >
              <Inspector selection={inspectorOpen ? selection : inspected} />
            </Tabs.Content>
            <Tabs.Content
              value="authorization"
              forceMount
              className={cn('flex min-h-0 flex-1 flex-col', !authorizationOpen && 'hidden')}
            >
              <AuthorizationExplorer />
            </Tabs.Content>
          </Tabs.Root>
        </Sheet>
      </div>

      <Timeline />
      <IntegrationsDialog />
      <SettingsDialog />
      <HelpDialog />
      <CommandPalette />
    </div>
  );
}

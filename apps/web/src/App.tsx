import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { actions } from '@/app/actions';
import { embedFromSearch } from '@/app/embed';
import { useMinWidth, useReportedHeight } from '@/app/hooks';
import { IN_BROWSER } from '@/app/host';
import { useAegisConnection } from '@/app/useAegisConnection';
import { useUrlView } from '@/app/urlState';
import { usePresence } from '@/app/usePresence';
import { useTheme } from '@/app/useTheme';
import { Button, IconButton } from '@/components/ui/Button';
import { AccessMatrixDialog } from '@/features/authorization/AccessMatrixDialog';
import { AuthorizationExplorer } from '@/features/authorization/AuthorizationExplorer';
import { PolicyEditorDialog } from '@/features/authorization/PolicyEditorDialog';
import { CommandPalette } from '@/features/command/CommandPalette';
import { ExperimentDialog } from '@/features/experiments/ExperimentDialog';
import { Explorer } from '@/features/explorer/Explorer';
import { GuideCard } from '@/features/guide/GuideCard';
import { Orientation } from '@/features/guide/Orientation';
import { HelpDialog } from '@/features/help/HelpDialog';
import { Inspector } from '@/features/inspector/Inspector';
import { IntegrationsDialog } from '@/features/integrations/IntegrationsDialog';
import { ScenarioConsole } from '@/features/scenarios/ScenarioConsole';
import { ScenarioEditor } from '@/features/scenarios/ScenarioEditor';
import { DevOverlay } from '@/features/scene/DevOverlay';
import { SceneCanvas } from '@/features/scene/SceneCanvas';
import { SessionDialog } from '@/features/session/SessionDialog';
import { HoverCard, Notices, SceneToolbar } from '@/features/scene/SceneOverlays';
import { TopologyTable } from '@/features/scene/TopologyTable';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { WorkspaceDialog } from '@/features/workspace/WorkspaceDialog';
import { Timeline, useTimelineHeight, useTimelineVisible } from '@/features/timeline/Timeline';
import { EmbedBar } from '@/features/topnav/EmbedBar';
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
import { LAYOUT_MODES, prefersReducedMotion, useSettings, useUi } from '@/stores/ui';

const LEFT_WIDTH = 300;
const RIGHT_WIDTH = 332;
/** Space between a card and the edges of the stage it floats over. */
const GUTTER = 12;
/** Room the scene keeps clear at the top (its toolbar) and the bottom. */
const TOP_INSET = 28;
const BOTTOM_INSET = 8;
/** Under this width a panel takes the whole stage: nothing fits beside one. */
const PANELS_FILL_UNDER = 640;
/**
 * How much of the stage's height a card may take there, so that what it is
 * about stays in the picture under it.
 */
const CARD_SHARE_WHEN_NARROW = '52%';
/** How wide the guide's card is, and what it needs of the stage with its gutters. */
const GUIDE_WIDTH = 336;
const GUIDE_ROOM = GUIDE_WIDTH + GUTTER * 2;
/** The least width the model is left with beside the cards for it to be read. */
const MODEL_ROOM = 320;
/** What the scene's toolbar needs of the stage's width, its margins included. */
const TOOLBAR_ROOM = 320;

const tabClass =
  'relative z-10 flex-1 px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink data-[state=active]:font-bold data-[state=active]:text-ink';

/**
 * A panel that is called for rather than always there: a card laid on the
 * stage, clear of its edges, sliding in from the side it belongs to. A
 * `compact` card is only as tall as what it has to say, up to the height of
 * the stage; the other kind fills the side it is on.
 */
function Sheet({
  side,
  open,
  width,
  label,
  compact,
  share,
  foot,
  onHeight,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  width: number;
  label: string;
  compact?: boolean;
  /** The most of the stage's height a compact card may take, as a CSS length. */
  share?: string;
  /** Room to leave at the bottom of the stage, for the timeline. */
  foot: number;
  /** Told how tall the card is while it is open, and zero once it is not. */
  onHeight?: (height: number) => void;
  children: ReactNode;
}) {
  const presence = usePresence(open);
  const element = useReportedHeight<HTMLElement>(
    open && onHeight !== undefined,
    onHeight ?? ignore,
  );
  if (!presence.mounted) return null;
  const room = `calc(100% - ${GUTTER * 2 + foot}px)`;
  return (
    <aside
      ref={element}
      className="sheet panel floating absolute z-20 flex flex-col overflow-hidden"
      data-side={side}
      data-state={presence.state}
      // Out of reach while it leaves; reachable from the first frame it is
      // asked for, so focus can be sent into it straight away.
      inert={!open}
      style={{
        width: `min(${width}px, calc(100% - ${GUTTER * 2}px))`,
        top: GUTTER,
        ...(compact
          ? { maxHeight: share ? `min(${share}, ${room})` : room }
          : { bottom: GUTTER + foot }),
        [side]: GUTTER,
      }}
      aria-label={label}
    >
      {children}
    </aside>
  );
}

function ignore(): void {}

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
      // A dialog that has just closed itself on this key has dealt with it;
      // the same Escape must not go on to put a panel away as well.
      if (event.defaultPrevented) return;
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
          // A piece, whether it is one service or a kind of them.
          if (ui.selection && ui.selection.kind !== 'edge') {
            sceneHandle.current?.focusNode(ui.selection.id);
          } else sceneHandle.current?.frameAll();
          break;
        case 'l':
        case 'L':
          // The next arrangement: overview, by region, by dependency.
          ui.setLayoutMode(
            LAYOUT_MODES[(LAYOUT_MODES.indexOf(ui.layoutMode) + 1) % LAYOUT_MODES.length]!,
          );
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

/** The engine in this tab could not start, or stopped. Only a reload brings it back. */
function EngineStopped({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6" role="alert">
      <div className="panel max-w-md p-6" data-testid="engine-stopped">
        <h2 className="text-base font-bold text-ink">The simulation engine is not running</h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">{message}</p>
        <p className="caption mt-3">
          On this page the simulation runs in the browser, from a WebAssembly module. Nothing is
          shown in its place: AEGIS does not invent data.
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>
    </div>
  );
}

function Unreachable({ message }: { message: string }) {
  if (IN_BROWSER) return <EngineStopped message={message} />;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6" role="alert">
      <div className="panel max-w-md p-6">
        <h2 className="text-base font-bold text-ink">The AEGIS server is not answering</h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">{message}</p>
        <p className="mt-3 text-xs text-ink-dim">Start it with:</p>
        <p className="numeric mt-1 rounded-control border border-line bg-sunken px-2 py-1.5 text-xs text-ink">
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

/**
 * An embed that names a scenario has it running. Only where the engine is
 * this page's own: on a server the simulation is shared, and an address
 * must not start an incident in it. Once, and not over one already running.
 */
function useEmbeddedScenario(scenarioId: string | null): void {
  const ready = useTelemetry((state) => state.topology !== null && state.snapshot !== null);
  const started = useRef(false);
  useEffect(() => {
    if (!IN_BROWSER || scenarioId === null || !ready || started.current) return;
    started.current = true;
    if (useTelemetry.getState().snapshot?.incident == null) void actions.startScenario(scenarioId);
  }, [scenarioId, ready]);
}

export function App() {
  useAegisConnection();
  useUrlView();
  useShortcuts();
  const theme = useTheme();
  // Read once: an address that changes under the page does not turn it into
  // an embed, or out of one.
  const embed = useMemo(() => embedFromSearch(window.location.search), []);
  useEmbeddedScenario(embed?.scenarioId ?? null);

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
  // The timeline floats at the foot of the stage when there is one.
  const timelineHeight = useTimelineHeight();
  const foot = useTimelineVisible() ? timelineHeight + GUTTER : 0;
  // On a first visit the orientation lies over the foot of the stage; the
  // model is framed above it for as long as it is there.
  const [orientation, setOrientation] = useState(0);
  // The guide is a card beside the panels where the stage has room for it
  // between them. Where it has not (a phone, where a panel takes the whole
  // width, or a tablet with a panel on each side) the card lies along the
  // foot and the panels end above it: a challenge is answered in a panel,
  // and the card must not cover what it asks for.
  const narrow = !useMinWidth(PANELS_FILL_UNDER);
  const roomBeside = useMinWidth(left + right + GUIDE_ROOM + MODEL_ROOM);
  const guideAlongFoot = narrow || !roomBeside;
  const [guide, setGuide] = useState(0);
  const guideFoot = guideAlongFoot && guide > 0 ? guide + GUTTER : 0;
  // Beside the panels the card stands on the model's side of them, and the
  // model moves over for it as it does for a panel. It used to stay where it
  // was, under the card: the first layer of the overview, and the edge's
  // lane with its name, could not be seen while a challenge was open.
  const guideBeside = !guideAlongFoot && guide > 0 ? GUIDE_WIDTH + GUTTER : 0;
  // The toolbar and the notices move over for the panels where the stage
  // has room for them in between. Where it has not (a phone with a panel
  // open, a tablet with one on each side) they were squeezed into what was
  // left and cut at its edge, so there they keep the full width: the
  // notices over the panels and the toolbar under them.
  const roomBetween = useMinWidth(left + right + TOOLBAR_ROOM);
  const beside = roomBetween ? { left, right } : { left: 0, right: 0 };
  const bottom = BOTTOM_INSET + foot + (orientation > 0 ? orientation + GUTTER : 0) + guideFoot;
  // On a phone a card takes the width of the stage, so the model cannot move
  // over beside it. It used to be asked to, and went out of the picture the
  // moment a piece was selected. There the card keeps to the upper part of
  // the stage and the model is framed in what is left under it.
  const [card, setCard] = useState(0);
  const onCard = useCallback((height: number) => setCard(Math.ceil(height / 8) * 8), []);
  const under = narrow && inspectorOpen && card > 0;
  const sceneLeft = narrow ? 0 : left + guideBeside;
  const sceneRight = narrow ? 0 : right;
  const sceneTop = under ? GUTTER + card : TOP_INSET;
  useEffect(() => {
    sceneHandle.current?.setViewInsets({
      left: sceneLeft,
      right: sceneRight,
      top: sceneTop,
      bottom,
    });
  }, [sceneLeft, sceneRight, sceneTop, bottom, showScene, hasTopology]);
  const onRuntime = useCallback(() => {
    sceneHandle.current?.setViewInsets({
      left: sceneLeft,
      right: sceneRight,
      top: sceneTop,
      bottom,
    });
  }, [sceneLeft, sceneRight, sceneTop, bottom]);

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
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:border focus:border-ink focus:bg-paper focus:px-3 focus:py-2 focus:text-xs"
      >
        Skip to the topology
      </a>
      {embed === null && <TopNav />}

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
              style={{ paddingLeft: left, paddingRight: right, paddingBottom: foot }}
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
          style={beside}
        >
          <div className="pointer-events-auto">{showScene && <SceneToolbar />}</div>
        </div>
        <div
          className="pointer-events-none absolute top-3 z-30 flex justify-center px-3 transition-[left,right] duration-200 ease-arrive"
          style={beside}
        >
          <Notices />
        </div>

        {showScene && devOverlay && (
          <div
            className="absolute z-10 transition-[left,bottom] duration-200 ease-arrive"
            style={{ left: left + GUTTER, bottom: GUTTER + foot }}
          >
            <DevOverlay />
          </div>
        )}

        <Sheet
          side="left"
          open={explorerOpen}
          width={LEFT_WIDTH}
          foot={foot + guideFoot}
          label="Services and incidents"
        >
          <Tabs.Root
            value={leftTab}
            onValueChange={(value) => useUi.getState().setLeftTab(value as typeof leftTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center border-b border-line pr-1">
              <Tabs.List className="relative flex flex-1" aria-label="Left panel">
                <Tabs.Trigger value="explorer" className={tabClass} data-testid="tab-explorer">
                  Services
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
              <IconButton
                label="Close this panel"
                size="sm"
                onClick={() => useUi.getState().setExplorerOpen(false)}
                data-testid="close-explorer"
              >
                <X size={14} />
              </IconButton>
            </div>
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

        {/* What the selection, or the request being traced, has to say. Both
            stay mounted so a decision survives a trip to the inspector. */}
        <Sheet
          side="right"
          open={inspectorOpen}
          width={RIGHT_WIDTH}
          foot={foot + guideFoot}
          compact
          share={narrow ? CARD_SHARE_WHEN_NARROW : undefined}
          onHeight={onCard}
          label={authorizationOpen ? 'Trace a request' : 'Inspector'}
        >
          <div className={cn('min-h-0 flex-1 overflow-y-auto', authorizationOpen && 'hidden')}>
            <Inspector selection={inspectorOpen ? selection : inspected} />
          </div>
          <div className={cn('flex min-h-0 flex-1 flex-col', !authorizationOpen && 'hidden')}>
            <AuthorizationExplorer />
          </div>
        </Sheet>

        {/* An embed has no bar and is nobody's first visit to the application. */}
        {embed === null ? (
          <Orientation bottom={GUTTER + foot} onHeight={setOrientation} />
        ) : (
          <EmbedBar />
        )}
        <GuideCard
          left={guideAlongFoot ? GUTTER : left + GUTTER}
          bottom={GUTTER + foot}
          alongFoot={guideAlongFoot}
          onHeight={setGuide}
        />
        <Timeline />
      </div>

      <IntegrationsDialog />
      <SettingsDialog />
      <WorkspaceDialog />
      <ExperimentDialog />
      <AccessMatrixDialog />
      <PolicyEditorDialog />
      <SessionDialog />
      <ScenarioEditor />
      <HelpDialog />
      <CommandPalette />
    </div>
  );
}

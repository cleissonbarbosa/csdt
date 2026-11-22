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
import { TabMarker, tabClass } from '@/components/ui/TabMarker';
import { AccessMatrixDialog } from '@/features/authorization/AccessMatrixDialog';
import { AuthorizationExplorer } from '@/features/authorization/AuthorizationExplorer';
import { PolicyEditorDialog } from '@/features/authorization/PolicyEditorDialog';
import { CaptureBar } from '@/features/capture/CaptureBar';
import { CaptureCard } from '@/features/capture/CaptureCard';
import { CaptureDetails } from '@/features/capture/CaptureDetails';
import { CaptureDialog } from '@/features/capture/CaptureDialog';
import { CaptureList } from '@/features/capture/CaptureList';
import { CaptureTable } from '@/features/capture/CaptureTable';
import { CommandPalette } from '@/features/command/CommandPalette';
import { ExperimentDialog } from '@/features/experiments/ExperimentDialog';
import { LimitsDialog } from '@/features/experiments/LimitsDialog';
import { Explorer } from '@/features/explorer/Explorer';
import { GuideCard } from '@/features/guide/GuideCard';
import { Orientation } from '@/features/guide/Orientation';
import { HelpDialog } from '@/features/help/HelpDialog';
import { Inspector } from '@/features/inspector/Inspector';
import { IntegrationsDialog } from '@/features/integrations/IntegrationsDialog';
import { ScenarioConsole } from '@/features/scenarios/ScenarioConsole';
import { EditorCard } from '@/features/editor/EditorCard';
import { EditorOverlay } from '@/features/editor/EditorOverlay';
import { EditorTable } from '@/features/editor/EditorTable';
import { IncidentCard } from '@/features/editor/incident/IncidentCard';
import { IncidentOverlay } from '@/features/editor/incident/IncidentOverlay';
import { IncidentPalette } from '@/features/editor/incident/IncidentPalette';
import { PhaseStrip, STRIP_HEIGHT } from '@/features/editor/incident/PhaseStrip';
import { editorKey } from '@/features/editor/keys';
import { Palette } from '@/features/editor/Palette';
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
import type { SceneSelection } from '@/graphics/SceneController';
import {
  canRender3D,
  detectRenderingSupport,
  probeRenderingSupport,
  type RenderingSupport,
} from '@/graphics/renderer';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { selectOpen, useCapture } from '@/stores/capture';
import { selectEditing, useEditor } from '@/stores/editor';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { LAYOUT_MODES, prefersReducedMotion, useSettings, useUi } from '@/stores/ui';

const LEFT_WIDTH = 300;
const RIGHT_WIDTH = 332;
/** The editor's palette where the stage has no room for it beside the card: a column of glyphs. */
const RAIL_WIDTH = 64;
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
  testId,
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
  testId?: string;
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
      data-testid={testId}
    >
      {children}
    </aside>
  );
}

function ignore(): void {}

/** What the capture's card shows: a selection's card, or the capture's own. */
const DETAILS = 'details';
type CaptureContent = NonNullable<SceneSelection> | typeof DETAILS;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Whether a key pressed on this element belongs to that control rather than to the page. */
function ownsSpace(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('button, [role="slider"], [role="radio"], [role="tab"], summary') !== null
  );
}

/**
 * The keys while an incident capture is open. Nothing here reaches the
 * simulation: Space is the capture's own clock, the capture is drawn by
 * region only (`L` has nothing to cycle) and the palette's commands are the
 * simulation's (Ctrl K opens nothing). Returns whether the key was used.
 */
function captureKey(event: KeyboardEvent): boolean {
  const capture = useCapture.getState();
  const ui = useUi.getState();
  switch (event.key) {
    case ' ':
      if (ownsSpace(event.target)) return false;
      capture.toggle();
      return true;
    case 'f':
    case 'F':
      if (capture.selection?.kind === 'node') sceneHandle.current?.focusNode(capture.selection.id);
      else sceneHandle.current?.frameAll();
      return true;
    case '/':
      capture.setList(true, 'services');
      // As over the simulation, the keyboard goes where the list can be
      // used at once: the selected service's row, or the list's first tab.
      requestAnimationFrame(() => {
        const selected = useCapture.getState().selection;
        const row = selected?.kind === 'node' ? serviceRow(selected.id) : null;
        (
          row ?? document.querySelector<HTMLElement>('[data-testid="capture-tab-services"]')
        )?.focus();
      });
      return true;
    case 'Escape':
      // A dialog over the capture has this key. The tracer cannot be on
      // show here, whatever the simulation's panels were left at.
      if (ui.openPanel !== null && ui.openPanel !== 'authorization') return false;
      // Let go of the selection first, then put the panels away.
      if (capture.selection) capture.select(null);
      else if (capture.detailsOpen) capture.setDetails(false);
      else if (capture.listOpen) capture.setList(false);
      else return false;
      return true;
    default:
      // `L` among them: a capture has one arrangement.
      return false;
  }
}

/** The keys that work the same way over the simulation and over a capture. */
const SHARED_KEYS = new Set(['r', 'R', 't', 'T', 'p', 'P', '?']);

function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A dialog that has just closed itself on this key has dealt with it;
      // the same Escape must not go on to put a panel away as well.
      if (event.defaultPrevented) return;
      // While a platform is drawn the keys are the editor's; of the
      // simulation's only `?` still opens the help.
      if (useEditor.getState().draft !== null) {
        if (editorKey(event, isTyping(event.target))) event.preventDefault();
        else if (event.key === '?' && !isTyping(event.target)) useUi.getState().setPanel('help');
        return;
      }
      const captured = useCapture.getState().capture !== null;
      // The command palette opens from anywhere, including while typing;
      // over a capture there is nothing in it to reach.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (captured) return;
        const state = useUi.getState();
        state.setCommandOpen(!state.commandOpen);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (captured && !SHARED_KEYS.has(event.key)) {
        if (captureKey(event)) event.preventDefault();
        return;
      }
      const ui = useUi.getState();
      const settings = useSettings.getState();
      switch (event.key) {
        case ' ': {
          // Space on a button or a slider belongs to that control.
          if (ownsSpace(event.target)) return;
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

/** Where the keyboard is put once a capture has been opened: its clock. */
const CAPTURE_LANDING = '[data-testid="capture-toggle"]';
/**
 * Where it is put once the platform editor has been opened: the first
 * piece of its palette, which Enter adds, or the draft's card when the
 * palette is put away.
 */
const EDITOR_LANDING =
  '[data-testid="editor-palette"] button, [data-testid="incident-palette"] button, [data-testid="editor-card"] button';
/** The editor as a mode the keyboard follows; it has no file of its own to tell one from another. */
const EDITING = { mode: 'editor' } as const;
/**
 * Where it is put once the simulation is back: the stage, which the skip
 * link leads to too, where the simulation's keys work as they did.
 */
const SIMULATION_LANDING = '#main';

/** Whether the keyboard is nowhere: on the document itself, or in a part on its way out. */
function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active.closest('[inert]') !== null;
}

/** Whether an element the keyboard was on has gone, or is in a part on its way out. */
function gone(element: Element | null): boolean {
  return element !== null && (!element.isConnected || element.closest('[inert]') !== null);
}

/**
 * The element the keyboard was last on, as the page follows it. When what
 * the page shows changes, this says whether the keyboard was taken from the
 * viewer (the element went with the part it belonged to) or had never been
 * anywhere (a page arrived at by a link, which nobody has touched yet).
 */
function useLastFocused(): { readonly current: Element | null } {
  const last = useRef<Element | null>(null);
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element) last.current = event.target;
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);
  return last;
}

/**
 * Puts the keyboard somewhere when what the page shows is replaced under
 * it: a capture opened, another one opened in its place, the platform
 * editor opened, or the simulation back. The control the focus was on (a menu's item, the dialog's button,
 * "Back to the simulation") went with the part it belonged to, and the
 * browser would leave the focus at the top of the document without a word.
 * Only once no dialog is open, since a dialog holds the focus until it has
 * gone, and only where the focus was taken: a viewer who is somewhere else
 * on the page is left there, and a page arrived at by a link, where the
 * viewer has not touched anything yet, is left untouched too, with no mark
 * of the keyboard on it.
 */
function useFocusAcrossModes(
  shown: object | null,
  landing: string | null,
  dialogOpen: boolean,
  lastFocused: { readonly current: Element | null },
): void {
  const last = useRef(shown);
  const owed = useRef(false);
  useEffect(() => {
    if (last.current !== shown) {
      last.current = shown;
      owed.current = true;
    }
    if (!owed.current || dialogOpen) return;
    // A dialog that has just closed leaves the page a render later; by the
    // next task it has, and has let go of the focus.
    const timer = window.setTimeout(() => {
      owed.current = false;
      if (!focusLost()) return;
      // Nothing was ever focused, or what was is still on the page: the
      // change took nothing from the viewer.
      if (!gone(lastFocused.current)) return;
      const target =
        shown !== null && landing !== null ? document.querySelector<HTMLElement>(landing) : null;
      (target ?? document.querySelector<HTMLElement>(SIMULATION_LANDING))?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [shown, landing, dialogOpen, lastFocused]);
}

/** A capture's service's row in its list; ids are letters, digits, `.`, `_` and `-`. */
const serviceRow = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="capture-service-${id}"]`);

/**
 * Where the keyboard goes when one of a capture's sheets is put away with
 * it inside (the card's or the list's close button, Escape in the list):
 * back to what opens that sheet, the way a dialog gives it back. The list
 * goes back to "Services and events"; the details to the chip; a card to
 * its service's row in the list when the list is open, and to the stage
 * otherwise. Only once the sheet has let go of it, and only where the sheet
 * took it: a keyboard somewhere else, or a pointer that let go of the
 * selection on the model, is left where it is.
 */
function useFocusAfterCaptureSheets(lastFocused: { readonly current: Element | null }): void {
  useEffect(
    () =>
      useCapture.subscribe((state, previous) => {
        // Opening or closing a capture is `useFocusAcrossModes`'s.
        if (state.capture === null || state.capture !== previous.capture) return;
        let landing: () => HTMLElement | null;
        if (previous.listOpen && !state.listOpen) {
          landing = () => document.querySelector<HTMLElement>('[data-testid="capture-list"]');
        } else if (previous.selection !== null && state.selection === null) {
          const released = previous.selection;
          landing = () =>
            (state.listOpen && released.kind === 'node' ? serviceRow(released.id) : null) ??
            (state.detailsOpen
              ? document.querySelector<HTMLElement>('[data-testid="capture-chip"]')
              : null);
        } else if (previous.detailsOpen && !state.detailsOpen && state.selection === null) {
          landing = () => document.querySelector<HTMLElement>('[data-testid="capture-chip"]');
        } else return;
        // The sheet has left (or is leaving, out of reach) by the next task.
        window.setTimeout(() => {
          if (!focusLost() || !gone(lastFocused.current)) return;
          const target = landing();
          (target && !gone(target)
            ? target
            : document.querySelector<HTMLElement>(SIMULATION_LANDING)
          )?.focus({ preventScroll: true });
        }, 0);
      }),
    [lastFocused],
  );
}

/**
 * A capture that cannot be opened says so wherever it was asked for. The
 * dialog says it itself, in place; the bar's picker, a link and the
 * browser's Back or Forward have no place to, and the picker only went back
 * to the capture that stayed open.
 */
function useCaptureFailures(): void {
  useEffect(
    () =>
      useCapture.subscribe((state, previous) => {
        if (state.error === null || state.error === previous.error) return;
        if (useUi.getState().openPanel === 'capture') return;
        useNotices.getState().push('error', state.error);
      }),
    [],
  );
}

/** The engine in this tab could not start, or stopped. Only a reload brings it back. */
function EngineStopped({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6" role="alert">
      <div className="panel max-w-md p-6" data-testid="engine-stopped">
        <h2 className="text-base font-bold text-ink">
          {t('The simulation engine is not running')}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">{message}</p>
        <p className="caption mt-3">
          {t(
            'On this page the simulation runs in the browser, from a WebAssembly module. Nothing is shown in its place: AEGIS does not invent data.',
          )}
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          {t('Reload the page')}
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
        <h2 className="text-base font-bold text-ink">{t('The AEGIS server is not answering')}</h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">{message}</p>
        <p className="mt-3 text-xs text-ink-dim">{t('Start it with:')}</p>
        <p className="numeric mt-1 rounded-control border border-line bg-sunken px-2 py-1.5 text-xs text-ink">
          {/* not-interface-text: a command, the same in every language */}
          cargo run -p aegis-server
        </p>
        <p className="caption mt-3">
          {t(
            'The interface reconnects by itself as soon as the server is up. Nothing is shown in the meantime: AEGIS does not invent data.',
          )}
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          {t('Retry now')}
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
  // While an incident capture is open its parts take the place of the
  // simulation's; the simulation's panels keep their state for its return.
  const captureOpen = useCapture(selectOpen);
  // So do the editor's while a platform is drawn.
  const editorOpen = useEditor(selectEditing);
  // An incident written on the platform: its phases where the timeline is.
  const incidentOpen = useEditor((state) => state.draft !== null && state.tab === 'incident');
  const paletteOpen = useEditor((state) => state.paletteOpen);
  const modeOpen = captureOpen || editorOpen;
  const explorerOpen = useUi((state) => state.explorerOpen);
  const inspectorOpen = useUi((state) => state.inspectorOpen);
  const leftTab = useUi((state) => state.leftTab);
  const authorizationOpen = useUi((state) => state.openPanel === 'authorization');
  const selection = useUi((state) => state.selection);
  // Clearing the selection closes the inspector. While it slides away it
  // goes on showing what it showed, instead of flashing the overview.
  const [inspected, setInspected] = useState(selection);
  if (inspectorOpen && inspected !== selection) setInspected(selection);
  const captureListOpen = useCapture((state) => state.listOpen);
  const captureSelection = useCapture((state) => state.selection);
  const captureDetailsOpen = useCapture((state) => state.detailsOpen);
  const captureCardHeight = useCapture((state) => state.cardHeight);
  const captureCardOpen = captureSelection !== null || captureDetailsOpen;
  // The capture's card goes on showing what it showed while it slides away.
  const captureContent: CaptureContent | null =
    captureSelection ?? (captureDetailsOpen ? DETAILS : null);
  const [captureShown, setCaptureShown] = useState<CaptureContent | null>(captureContent);
  if (captureContent !== null && captureShown !== captureContent) setCaptureShown(captureContent);
  const capturePanelOpen = useUi((state) => state.openPanel === 'capture');
  const shownCapture = useCapture((state) => state.capture);
  // Every panel but the tracer is a dialog.
  const dialogOpen = useUi(
    (state) =>
      (state.openPanel !== null && state.openPanel !== 'authorization') || state.commandOpen,
  );
  const lastFocused = useLastFocused();
  useFocusAcrossModes(
    shownCapture ?? (editorOpen ? EDITING : null),
    shownCapture ? CAPTURE_LANDING : editorOpen ? EDITOR_LANDING : null,
    dialogOpen,
    lastFocused,
  );
  useFocusAfterCaptureSheets(lastFocused);
  useCaptureFailures();
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

  const simulationExplorer = !modeOpen && explorerOpen;
  const simulationInspector = !modeOpen && inspectorOpen;
  // Where the palette and the card would leave the model less than its room,
  // the palette is a column of glyphs, each still named.
  const paletteRail = !useMinWidth(LEFT_WIDTH + RIGHT_WIDTH + MODEL_ROOM + GUTTER * 4);
  const leftWidth = editorOpen && paletteRail ? RAIL_WIDTH : LEFT_WIDTH;
  const left = (captureOpen ? captureListOpen : editorOpen ? paletteOpen : explorerOpen)
    ? leftWidth + GUTTER
    : 0;
  const right = (captureOpen ? captureCardOpen : editorOpen || inspectorOpen)
    ? RIGHT_WIDTH + GUTTER
    : 0;
  // The timeline floats at the foot of the stage when there is one. A
  // capture's bar is there for as long as the capture is open.
  const timelineHeight = useTimelineHeight();
  const timelineVisible = useTimelineVisible();
  // The editor has no timeline: nothing has happened on a draft.
  const foot =
    captureOpen || (!editorOpen && timelineVisible)
      ? timelineHeight + GUTTER
      : incidentOpen
        ? STRIP_HEIGHT + GUTTER
        : 0;
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
  // Neither the guide nor the orientation is on the stage over a capture.
  const guideFoot = !modeOpen && guideAlongFoot && guide > 0 ? guide + GUTTER : 0;
  // Beside the panels the card stands on the model's side of them, and the
  // model moves over for it as it does for a panel. It used to stay where it
  // was, under the card: the first layer of the overview, and the edge's
  // lane with its name, could not be seen while a challenge was open.
  const guideBeside = !modeOpen && !guideAlongFoot && guide > 0 ? GUIDE_WIDTH + GUTTER : 0;
  // The toolbar and the notices move over for the panels where the stage
  // has room for them in between. Where it has not (a phone with a panel
  // open, a tablet with one on each side) they were squeezed into what was
  // left and cut at its edge, so there they keep the full width: the
  // notices over the panels and the toolbar under them.
  const roomBetween = useMinWidth(left + right + TOOLBAR_ROOM);
  const beside = roomBetween ? { left, right } : { left: 0, right: 0 };
  const orientationFoot = !modeOpen && orientation > 0 ? orientation + GUTTER : 0;
  const bottom = BOTTOM_INSET + foot + orientationFoot + guideFoot;
  // On a phone a card takes the width of the stage, so the model cannot move
  // over beside it. It used to be asked to, and went out of the picture the
  // moment a piece was selected. There the card keeps to the upper part of
  // the stage and the model is framed in what is left under it.
  const [card, setCard] = useState(0);
  const onCard = useCallback((height: number) => setCard(Math.ceil(height / 8) * 8), []);
  const onCaptureCard = useCallback(
    (height: number) => useCapture.getState().setCardHeight(Math.ceil(height / 8) * 8),
    [],
  );
  const cardOnTop = captureOpen
    ? captureCardOpen && captureCardHeight > 0
    : !editorOpen && inspectorOpen && card > 0;
  const under = narrow && cardOnTop;
  const sceneLeft = narrow ? 0 : left + guideBeside;
  const sceneRight = narrow ? 0 : right;
  const sceneTop = under ? GUTTER + (captureOpen ? captureCardHeight : card) : TOP_INSET;
  useEffect(() => {
    sceneHandle.current?.setViewInsets({
      left: sceneLeft,
      right: sceneRight,
      top: sceneTop,
      bottom,
    });
  }, [sceneLeft, sceneRight, sceneTop, bottom, showScene, hasTopology, captureOpen, editorOpen]);
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
      ? t('The 3D renderer could not start on this device. Showing the table view instead.')
      : support !== null && !canRender3D(support)
        ? t(
            'This browser offers neither WebGPU nor WebGL 2, so the 3D scene is unavailable. Showing the table view instead.',
          )
        : null;
  // With neither a capture nor the simulation's platform to draw, and the
  // simulation out of reach, the stage holds nothing: not even what a
  // capture closed in the meantime left on the model.
  const blank = !captureOpen && !hasTopology && loadError !== null;

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
        {t('Skip to the topology')}
      </a>
      {embed === null && <TopNav />}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <main
          id="main"
          tabIndex={-1}
          className="absolute inset-0"
          aria-label={t('Infrastructure topology')}
        >
          {probing ? null : showScene ? (
            blank ? null : (
              <SceneCanvas
                theme={theme}
                tooltip={tooltip}
                onRuntime={onRuntime}
                onUnavailable={(reason) => {
                  console.warn(`[aegis] 3D renderer unavailable: ${reason}`);
                  setSceneError(reason);
                }}
              />
            )
          ) : (
            <div
              className="h-full transition-[padding] duration-200 ease-arrive"
              style={{ paddingLeft: left, paddingRight: right, paddingBottom: foot }}
            >
              {captureOpen ? (
                <CaptureTable notice={viewMode === 'scene' ? unavailable : null} />
              ) : editorOpen ? (
                <EditorTable notice={viewMode === 'scene' ? unavailable : null} />
              ) : (
                <TopologyTable notice={viewMode === 'scene' ? unavailable : null} />
              )}
            </div>
          )}
        </main>
        {/* A capture needs neither the server nor the engine. */}
        {!captureOpen && !hasTopology && loadError && <Unreachable message={loadError} />}

        {/* Hover tooltip: the scene moves this element, React fills it. It
            goes with the scene: the table has no piece to point at, and the
            card of the last one pointed at stayed on show over it. */}
        {showScene && (
          <div
            ref={setTooltip}
            className="pointer-events-none invisible absolute left-0 top-0 z-10"
          >
            <HoverCard />
          </div>
        )}

        <div
          className="pointer-events-none absolute top-3 z-10 flex items-start justify-end gap-2 px-3 transition-[left,right] duration-200 ease-arrive"
          style={beside}
        >
          <div className="pointer-events-auto">{showScene && !editorOpen && <SceneToolbar />}</div>
        </div>
        <div
          className="pointer-events-none absolute top-3 z-30 flex justify-center px-3 transition-[left,right] duration-200 ease-arrive"
          style={beside}
        >
          <Notices />
        </div>

        {/* What a carry shows over the model: where a piece would go. */}
        {showScene && editorOpen && <EditorOverlay />}
        {showScene && incidentOpen && <IncidentOverlay />}

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
          open={simulationExplorer}
          width={LEFT_WIDTH}
          foot={foot + guideFoot}
          label={t('Services and incidents')}
        >
          <Tabs.Root
            value={leftTab}
            onValueChange={(value) => useUi.getState().setLeftTab(value as typeof leftTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center border-b border-line pr-1">
              <Tabs.List className="relative flex flex-1" aria-label={t('Left panel')}>
                <Tabs.Trigger value="explorer" className={tabClass} data-testid="tab-explorer">
                  {t('Services')}
                </Tabs.Trigger>
                <Tabs.Trigger value="incidents" className={tabClass} data-testid="tab-incidents">
                  {t('Incidents')}
                  {incidentActive && (
                    <span className="ml-1.5 inline-block size-[7px] bg-critical align-baseline">
                      <span className="sr-only">{t('(incident active)')}</span>
                    </span>
                  )}
                </Tabs.Trigger>
                <TabMarker index={leftTab === 'explorer' ? 0 : 1} count={2} />
              </Tabs.List>
              <IconButton
                label={t('Close this panel')}
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
          open={simulationInspector}
          width={RIGHT_WIDTH}
          foot={foot + guideFoot}
          compact
          share={narrow ? CARD_SHARE_WHEN_NARROW : undefined}
          onHeight={onCard}
          label={authorizationOpen ? t('Trace a request') : t('Inspector')}
          testId="inspector"
        >
          <div className={cn('min-h-0 flex-1 overflow-y-auto', authorizationOpen && 'hidden')}>
            <Inspector selection={inspectorOpen ? selection : inspected} />
          </div>
          <div className={cn('flex min-h-0 flex-1 flex-col', !authorizationOpen && 'hidden')}>
            <AuthorizationExplorer />
          </div>
        </Sheet>

        {/* An incident capture's parts, in the same places: its services and
            events on the left, the card of what is selected (or of the
            capture itself) on the right. */}
        {captureOpen && (
          <Sheet
            side="left"
            open={captureListOpen}
            width={LEFT_WIDTH}
            foot={foot}
            label={t('Services and events')}
          >
            <CaptureList />
          </Sheet>
        )}
        {captureOpen && (
          <Sheet
            side="right"
            open={captureCardOpen}
            width={RIGHT_WIDTH}
            foot={foot}
            compact
            share={narrow ? CARD_SHARE_WHEN_NARROW : undefined}
            onHeight={onCaptureCard}
            // Its own name, not the simulation's inspector's: the two are
            // never the same card.
            label={
              captureShown === DETAILS
                ? t('What the capture is')
                : captureShown?.kind === 'edge'
                  ? t('Connection in the capture')
                  : t('Service in the capture')
            }
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              {captureShown === DETAILS ? (
                <CaptureDetails />
              ) : captureShown !== null ? (
                <CaptureCard selection={captureShown} />
              ) : null}
            </div>
          </Sheet>
        )}

        {/* The editor's parts: the pieces to carry on the left, the card of
            what is selected (or of the platform) on the right. */}
        {editorOpen && (
          <Sheet
            side="left"
            open={paletteOpen}
            width={leftWidth}
            foot={foot}
            label={incidentOpen ? t('Effects to place') : t('Pieces to place')}
          >
            {incidentOpen ? <IncidentPalette rail={paletteRail} /> : <Palette rail={paletteRail} />}
          </Sheet>
        )}
        {editorOpen && (
          <Sheet
            side="right"
            open
            width={RIGHT_WIDTH}
            foot={foot}
            compact
            share={narrow ? CARD_SHARE_WHEN_NARROW : undefined}
            label={t('The draft')}
            testId="editor-card"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              {incidentOpen ? <IncidentCard /> : <EditorCard />}
            </div>
          </Sheet>
        )}

        {/* An embed has no bar and is nobody's first visit to the application.
            Neither is on the stage over a capture, nor is a challenge: both
            are about the simulation. */}
        {modeOpen ? null : embed === null ? (
          <Orientation bottom={GUTTER + foot} onHeight={setOrientation} />
        ) : (
          <EmbedBar />
        )}
        {/* Kept mounted over a capture, only out of sight: mounting it again
            would take up the address's challenge a second time. */}
        <div className={modeOpen ? 'hidden' : 'contents'}>
          <GuideCard
            left={guideAlongFoot ? GUTTER : left + GUTTER}
            bottom={GUTTER + foot}
            alongFoot={guideAlongFoot}
            onHeight={setGuide}
          />
        </div>
        {captureOpen ? <CaptureBar /> : editorOpen ? incidentOpen && <PhaseStrip /> : <Timeline />}
      </div>

      <IntegrationsDialog />
      <SettingsDialog />
      <WorkspaceDialog />
      <ExperimentDialog />
      <LimitsDialog />
      <AccessMatrixDialog />
      <PolicyEditorDialog />
      <SessionDialog />
      <HelpDialog />
      {/* An embed reaches no capture: it has no bar to say what one is. */}
      <CaptureDialog
        open={capturePanelOpen && embed === null}
        onOpenChange={(next) => useUi.getState().setPanel(next ? 'capture' : null)}
      />
      <CommandPalette />
    </div>
  );
}

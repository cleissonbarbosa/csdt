/** Interface state: selection, filters, panels and persisted settings. */
import type {
  AuthorizationDecision,
  EvaluateRequest,
  Health,
  ServiceType,
  WorkspaceFile,
} from '@aegis/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { LanguageSetting } from '@/i18n';

/**
 * What is selected. A `group` is a piece of the overview: every service of
 * one kind. A `node` or an `edge` is one service or one connection, and
 * belongs to the detailed arrangements.
 */
export type Selection =
  | { kind: 'group'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null;

/**
 * `layers` is the overview: the platform by kind of service, in the layers
 * a request crosses. The other two show every service, by region or by
 * dependency tier.
 */
export type LayoutMode = 'layers' | 'regions' | 'dependencies';
export type DetailMode = Exclude<LayoutMode, 'layers'>;
export const LAYOUT_MODES: readonly LayoutMode[] = ['layers', 'regions', 'dependencies'];

/**
 * The arrangement to open on. The overview, unless the address asks for
 * another with `?arrangement=regions`: a link can lead straight to the
 * detail, and the capture and benchmark scripts measure it that way.
 */
function initialLayout(): LayoutMode {
  if (typeof window === 'undefined') return 'layers';
  const asked = new URLSearchParams(window.location.search).get('arrangement');
  return LAYOUT_MODES.find((mode) => mode === asked) ?? 'layers';
}
export type ViewMode = 'scene' | 'table';
export type PanelId =
  | 'authorization'
  | 'integrations'
  | 'settings'
  | 'help'
  | 'workspace'
  /** The same incident twice, with one thing changed. */
  | 'experiment'
  /** Where the platform gives: how much demand it takes, what each service takes with it. */
  | 'limits'
  /** Saving, sharing and opening a session. */
  | 'session'
  /** Who may do what: every request of the catalogue, asked of Cedar. */
  | 'matrix'
  /** Editing the Cedar policies in the page. */
  | 'policies'
  /** Choosing an incident capture to open, bundled or from a file. */
  | 'capture';
export type LeftTab = 'explorer' | 'incidents';

export interface Filters {
  search: string;
  types: ServiceType[];
  health: Health[];
  regions: string[];
  /** Only nodes impacted by the active incident. */
  impactedOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  search: '',
  types: [],
  health: [],
  regions: [],
  impactedOnly: false,
};

export function filtersActive(filters: Filters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.types.length > 0 ||
    filters.health.length > 0 ||
    filters.regions.length > 0 ||
    filters.impactedOnly
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export interface UiState {
  selection: Selection;
  hoveredNodeId: string | null;
  filters: Filters;
  layoutMode: LayoutMode;
  /** The detailed arrangement last used; a service is opened in this one. */
  detailMode: DetailMode;
  viewMode: ViewMode;
  /** `authorization` is a tab of the right sidebar; the rest are dialogs. */
  openPanel: PanelId | null;
  leftTab: LeftTab;
  explorerOpen: boolean;
  inspectorOpen: boolean;
  /**
   * The decision whose path is drawn on the model, if any. It stays drawn
   * after the request has arrived, until something else is asked for.
   */
  tracedDecision: AuthorizationDecision | null;
  /** True while that request is still travelling. */
  tracing: boolean;
  /** Whether the viewer asked for the timeline; it also comes by itself. */
  timelineOpen: boolean;
  /** Event whose details are shown in the event inspector. */
  inspectedEventSeq: number | null;
  /** Incident whose summary is shown in the incidents tab. */
  inspectedIncidentId: string | null;
  /** A request for the tracer's form to take up, from a challenge or a link. */
  authorizationPreset: EvaluateRequest | null;
  /** The latest decision Cedar gave in this page, whatever is being traced. */
  lastDecision: AuthorizationDecision | null;
  /** The scenario a comparison is opened on. */
  experimentScenarioId: string | null;
  /**
   * Files written in the page for the import dialog to stage, with a line
   * saying where they came from. The dialog takes them up once; nothing is
   * applied until the viewer applies them there.
   */
  importOffer: { files: WorkspaceFile[]; notes: string[] } | null;
  /**
   * The services a trial of a fault reached, while its result is on show:
   * the model keeps them in front. Nothing about them is a state of the
   * timeline in use; it is the answer to a question the viewer asked.
   */
  reach: string[] | null;
  /** The incident the viewer has already looked at; newer ones ask for attention. */
  acknowledgedIncidentId: string | null;
  commandOpen: boolean;

  select: (selection: Selection) => void;
  selectNode: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setSearch: (search: string) => void;
  toggleType: (type: ServiceType) => void;
  toggleHealth: (health: Health) => void;
  toggleRegion: (region: string) => void;
  setImpactedOnly: (value: boolean) => void;
  clearFilters: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setViewMode: (mode: ViewMode) => void;
  setPanel: (panel: PanelId | null) => void;
  togglePanel: (panel: PanelId) => void;
  setLeftTab: (tab: LeftTab) => void;
  setExplorerOpen: (open: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
  traceDecision: (decision: AuthorizationDecision | null) => void;
  setTracing: (tracing: boolean) => void;
  setTimelineOpen: (open: boolean) => void;
  inspectEvent: (seq: number | null) => void;
  inspectIncident: (id: string | null) => void;
  presetAuthorization: (request: EvaluateRequest | null) => void;
  setLastDecision: (decision: AuthorizationDecision | null) => void;
  /** Opens the comparison of an intervention, on a scenario if one is named. */
  openExperiment: (scenarioId?: string) => void;
  /** Opens the import dialog on files written in the page, staged and not applied. */
  offerImport: (files: WorkspaceFile[], notes: string[]) => void;
  takeImportOffer: () => void;
  setReach: (nodeIds: string[] | null) => void;
  acknowledgeIncident: (id: string | null) => void;
  setCommandOpen: (open: boolean) => void;
  /** Clears state tied to a topology that is being replaced. */
  resetForTopology: () => void;
  /** Clears what was read off a timeline that has been replaced by another. */
  forgetTimeline: () => void;
}

/**
 * What goes with the tracer when something else takes its place in
 * `openPanel`: the path it drew on the model, and the sidebar it lived in
 * unless a selection still has something to show there. Left behind, the
 * path stood on the model with no card to say whose request it was, and the
 * sidebar fell back to an overview nobody had asked for.
 */
function leavingTracer(state: UiState, next: PanelId | null): Partial<UiState> {
  if (state.openPanel !== 'authorization' || next === 'authorization') return {};
  return { tracedDecision: null, tracing: false, inspectorOpen: state.selection !== null };
}

export const useUi = create<UiState>((set) => ({
  selection: null,
  hoveredNodeId: null,
  filters: EMPTY_FILTERS,
  // Overview first: a dozen pieces, whatever the size of the platform.
  layoutMode: initialLayout(),
  detailMode: initialLayout() === 'dependencies' ? 'dependencies' : 'regions',
  viewMode: 'scene',
  openPanel: null,
  leftTab: 'explorer',
  // Overview first: the model has the screen to itself until a panel is
  // asked for. Selecting something brings the inspector; letting go of the
  // selection puts it away again.
  explorerOpen: false,
  inspectorOpen: false,
  tracedDecision: null,
  tracing: false,
  timelineOpen: false,
  inspectedEventSeq: null,
  inspectedIncidentId: null,
  authorizationPreset: null,
  lastDecision: null,
  experimentScenarioId: null,
  importOffer: null,
  reach: null,
  acknowledgedIncidentId: null,
  commandOpen: false,

  // Selecting something brings the inspector forward, also from the
  // authorization tab that shares its sidebar. Clearing the selection puts
  // the inspector away, unless the authorization tab is what is being used.
  //
  // A service or a connection is a detail: selecting one from the overview
  // (by name, from a list) opens the detailed arrangement it lives in. And a
  // selection takes the stage from a traced request, whose path is put away.
  select: (selection) =>
    set((s) => ({
      selection,
      layoutMode:
        selection && selection.kind !== 'group' && s.layoutMode === 'layers'
          ? s.detailMode
          : s.layoutMode,
      inspectorOpen: selection ? true : s.openPanel === 'authorization',
      openPanel: selection && s.openPanel === 'authorization' ? null : s.openPanel,
      ...(selection ? { tracedDecision: null, tracing: false } : {}),
    })),
  selectNode: (id) =>
    set((s) => ({
      selection: id ? { kind: 'node', id } : null,
      layoutMode: id && s.layoutMode === 'layers' ? s.detailMode : s.layoutMode,
      inspectorOpen: id ? true : s.openPanel === 'authorization',
      openPanel: id && s.openPanel === 'authorization' ? null : s.openPanel,
      ...(id ? { tracedDecision: null, tracing: false } : {}),
    })),
  setHovered: (hoveredNodeId) => set({ hoveredNodeId }),
  setSearch: (search) => set((s) => ({ filters: { ...s.filters, search } })),
  toggleType: (type) =>
    set((s) => ({ filters: { ...s.filters, types: toggle(s.filters.types, type) } })),
  toggleHealth: (health) =>
    set((s) => ({ filters: { ...s.filters, health: toggle(s.filters.health, health) } })),
  toggleRegion: (region) =>
    set((s) => ({ filters: { ...s.filters, regions: toggle(s.filters.regions, region) } })),
  setImpactedOnly: (impactedOnly) => set((s) => ({ filters: { ...s.filters, impactedOnly } })),
  clearFilters: () => set({ filters: EMPTY_FILTERS }),
  // A selection belongs to the level it was made at: a kind of service in
  // the overview, a service in the detail. Changing level lets go of it.
  setLayoutMode: (layoutMode) =>
    set((s) => {
      const leaves = (layoutMode === 'layers') !== (s.layoutMode === 'layers');
      return {
        layoutMode,
        detailMode: layoutMode === 'layers' ? s.detailMode : layoutMode,
        ...(leaves && s.selection
          ? { selection: null, inspectorOpen: s.openPanel === 'authorization' }
          : {}),
      };
    }),
  setViewMode: (viewMode) => set({ viewMode }),
  // The tracer lives in the right sidebar: asking for it brings that forward.
  setPanel: (openPanel) =>
    set((s) => ({
      ...leavingTracer(s, openPanel),
      openPanel,
      ...(openPanel === 'authorization' ? { inspectorOpen: true } : {}),
    })),
  togglePanel: (panel) =>
    set((s) => {
      const openPanel = s.openPanel === panel ? null : panel;
      return {
        ...leavingTracer(s, openPanel),
        openPanel,
        ...(openPanel === 'authorization' ? { inspectorOpen: true } : {}),
      };
    }),
  setLeftTab: (leftTab) => set({ leftTab, explorerOpen: true }),
  setExplorerOpen: (explorerOpen) => set({ explorerOpen }),
  // Closing the sidebar also leaves the authorization tab that lives in it.
  setInspectorOpen: (inspectorOpen) =>
    set((s) => ({
      inspectorOpen,
      openPanel: !inspectorOpen && s.openPanel === 'authorization' ? null : s.openPanel,
      ...(inspectorOpen ? {} : { tracedDecision: null, tracing: false }),
    })),
  traceDecision: (tracedDecision) => set({ tracedDecision, tracing: tracedDecision !== null }),
  setTracing: (tracing) => set({ tracing }),
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
  // Event details live in the incidents tab; opening one reveals it.
  inspectEvent: (inspectedEventSeq) =>
    set(
      inspectedEventSeq === null
        ? { inspectedEventSeq }
        : { inspectedEventSeq, leftTab: 'incidents', explorerOpen: true },
    ),
  // An incident's summary lives there too, and takes the place of an event.
  inspectIncident: (inspectedIncidentId) =>
    set(
      inspectedIncidentId === null
        ? { inspectedIncidentId }
        : {
            inspectedIncidentId,
            inspectedEventSeq: null,
            leftTab: 'incidents',
            explorerOpen: true,
          },
    ),
  // The tracer shares the right sidebar: handing it a request brings it forward.
  presetAuthorization: (authorizationPreset) =>
    set(
      authorizationPreset === null
        ? { authorizationPreset }
        : {
            authorizationPreset,
            openPanel: 'authorization',
            inspectorOpen: true,
            selection: null,
          },
    ),
  setLastDecision: (lastDecision) => set({ lastDecision }),
  openExperiment: (scenarioId) =>
    set((s) => ({
      ...leavingTracer(s, 'experiment'),
      openPanel: 'experiment',
      experimentScenarioId: scenarioId ?? null,
    })),
  offerImport: (files, notes) =>
    set((s) => ({
      ...leavingTracer(s, 'workspace'),
      openPanel: 'workspace',
      importOffer: { files, notes },
    })),
  takeImportOffer: () => set({ importOffer: null }),
  setReach: (reach) => set({ reach }),
  acknowledgeIncident: (acknowledgedIncidentId) => set({ acknowledgedIncidentId }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  resetForTopology: () =>
    set({
      selection: null,
      hoveredNodeId: null,
      filters: EMPTY_FILTERS,
      tracedDecision: null,
      tracing: false,
      inspectedEventSeq: null,
      inspectedIncidentId: null,
      lastDecision: null,
      reach: null,
    }),
  // A decision was Cedar's answer at a moment of a timeline, and an event is
  // a line of one. With that timeline gone, the path would be drawn over a
  // simulation the request was never part of, and an event's number would
  // come to mean whichever event the new timeline gives it.
  forgetTimeline: () =>
    set({ tracedDecision: null, tracing: false, lastDecision: null, inspectedEventSeq: null }),
}));

// -- persisted settings ------------------------------------------------------

export type QualitySetting = 'auto' | 'ultra' | 'high' | 'medium' | 'low';
export type MotionSetting = 'system' | 'reduced' | 'full';
export type RendererSetting = 'auto' | 'webgl2';
export type ThemeSetting = 'system' | 'light' | 'night';

export interface SettingsState {
  theme: ThemeSetting;
  /** Read once, when the page loads (`i18n`); changing it reloads the page. */
  language: LanguageSetting;
  quality: QualitySetting;
  labels: boolean;
  autoRotate: boolean;
  devOverlay: boolean;
  motion: MotionSetting;
  renderer: RendererSetting;
  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
  reset: () => void;
}

type SettingsValues = Omit<SettingsState, 'set' | 'reset'>;

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: 'system',
  language: 'auto',
  quality: 'auto',
  labels: true,
  // Off by default: the scene only moves when the data or the viewer does.
  autoRotate: false,
  devOverlay: false,
  motion: 'system',
  renderer: 'auto',
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: 'aegis.settings.v1', version: 1 },
  ),
);

/** Whether motion should be reduced, combining the setting and the OS. */
export function prefersReducedMotion(setting: MotionSetting): boolean {
  if (setting === 'reduced') return true;
  if (setting === 'full') return false;
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The theme actually shown, combining the setting and the OS preference. */
export function resolveTheme(setting: ThemeSetting): 'light' | 'night' {
  if (setting !== 'system') return setting;
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'night'
    : 'light';
}

/** Interface state: selection, filters, panels and persisted settings. */
import type { AuthorizationDecision, Health, ServiceType } from '@aegis/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

export type LayoutMode = 'regions' | 'dependencies';
export type ViewMode = 'scene' | 'table';
export type PanelId = 'authorization' | 'integrations' | 'settings' | 'help';
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
  viewMode: ViewMode;
  /** `authorization` is a tab of the right sidebar; the rest are dialogs. */
  openPanel: PanelId | null;
  leftTab: LeftTab;
  explorerOpen: boolean;
  inspectorOpen: boolean;
  /** The decision currently traced through the scene, if any. */
  tracedDecision: AuthorizationDecision | null;
  /** Event whose details are shown in the event inspector. */
  inspectedEventSeq: number | null;
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
  inspectEvent: (seq: number | null) => void;
  acknowledgeIncident: (id: string | null) => void;
  setCommandOpen: (open: boolean) => void;
  /** Clears state tied to a topology that is being replaced. */
  resetForTopology: () => void;
}

export const useUi = create<UiState>((set) => ({
  selection: null,
  hoveredNodeId: null,
  filters: EMPTY_FILTERS,
  layoutMode: 'regions',
  viewMode: 'scene',
  openPanel: null,
  leftTab: 'explorer',
  // Overview first: the model has the screen to itself until a panel is
  // asked for. Selecting something brings the inspector; letting go of the
  // selection puts it away again.
  explorerOpen: false,
  inspectorOpen: false,
  tracedDecision: null,
  inspectedEventSeq: null,
  acknowledgedIncidentId: null,
  commandOpen: false,

  // Selecting something brings the inspector forward, also from the
  // authorization tab that shares its sidebar. Clearing the selection puts
  // the inspector away, unless the authorization tab is what is being used.
  select: (selection) =>
    set((s) => ({
      selection,
      inspectorOpen: selection ? true : s.openPanel === 'authorization',
      openPanel: selection && s.openPanel === 'authorization' ? null : s.openPanel,
    })),
  selectNode: (id) =>
    set((s) => ({
      selection: id ? { kind: 'node', id } : null,
      inspectorOpen: id ? true : s.openPanel === 'authorization',
      openPanel: id && s.openPanel === 'authorization' ? null : s.openPanel,
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
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setViewMode: (viewMode) => set({ viewMode }),
  setPanel: (openPanel) => set({ openPanel }),
  togglePanel: (panel) =>
    set((s) => ({
      openPanel: s.openPanel === panel ? null : panel,
      inspectorOpen: panel === 'authorization' && s.openPanel !== panel ? true : s.inspectorOpen,
    })),
  setLeftTab: (leftTab) => set({ leftTab, explorerOpen: true }),
  setExplorerOpen: (explorerOpen) => set({ explorerOpen }),
  // Closing the sidebar also leaves the authorization tab that lives in it.
  setInspectorOpen: (inspectorOpen) =>
    set((s) => ({
      inspectorOpen,
      openPanel: !inspectorOpen && s.openPanel === 'authorization' ? null : s.openPanel,
    })),
  traceDecision: (tracedDecision) => set({ tracedDecision }),
  // Event details live in the incidents tab; opening one reveals it.
  inspectEvent: (inspectedEventSeq) =>
    set(
      inspectedEventSeq === null
        ? { inspectedEventSeq }
        : { inspectedEventSeq, leftTab: 'incidents', explorerOpen: true },
    ),
  acknowledgeIncident: (acknowledgedIncidentId) => set({ acknowledgedIncidentId }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  resetForTopology: () =>
    set({
      selection: null,
      hoveredNodeId: null,
      filters: EMPTY_FILTERS,
      tracedDecision: null,
      inspectedEventSeq: null,
    }),
}));

// -- persisted settings ------------------------------------------------------

export type QualitySetting = 'auto' | 'ultra' | 'high' | 'medium' | 'low';
export type MotionSetting = 'system' | 'reduced' | 'full';
export type RendererSetting = 'auto' | 'webgl2';
export type ThemeSetting = 'system' | 'light' | 'night';

export interface SettingsState {
  theme: ThemeSetting;
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

import { beforeEach, describe, expect, it } from 'vitest';

import { decisionDeny } from '@/test/fixtures';

import { EMPTY_FILTERS, filtersActive, prefersReducedMotion, useSettings, useUi } from './ui';

beforeEach(() => {
  useUi.setState(useUi.getInitialState(), true);
  useSettings.getState().reset();
});

describe('selection', () => {
  it('opens the inspector and leaves the authorization tab', () => {
    useUi.setState({ inspectorOpen: false, openPanel: 'authorization' });
    useUi.getState().selectNode('use-gateway');
    const state = useUi.getState();
    expect(state.selection).toEqual({ kind: 'node', id: 'use-gateway' });
    expect(state.inspectorOpen).toBe(true);
    expect(state.openPanel).toBeNull();
  });

  it('clearing the selection leaves the panels alone', () => {
    useUi.setState({ inspectorOpen: false, openPanel: 'settings' });
    useUi.getState().select(null);
    expect(useUi.getState().inspectorOpen).toBe(false);
    expect(useUi.getState().openPanel).toBe('settings');
  });

  it('supports connections as well as services', () => {
    useUi.getState().select({ kind: 'edge', id: 'use-gateway->use-cedar' });
    expect(useUi.getState().selection?.kind).toBe('edge');
  });
});

describe('filters', () => {
  it('toggle membership and report whether anything is active', () => {
    const ui = useUi.getState();
    expect(filtersActive(useUi.getState().filters)).toBe(false);
    ui.toggleType('database');
    ui.toggleType('storage');
    ui.toggleHealth('critical');
    ui.toggleRegion('eu-west');
    expect(useUi.getState().filters).toMatchObject({
      types: ['database', 'storage'],
      health: ['critical'],
      regions: ['eu-west'],
    });
    ui.toggleType('database');
    expect(useUi.getState().filters.types).toEqual(['storage']);
    expect(filtersActive(useUi.getState().filters)).toBe(true);
    ui.clearFilters();
    expect(useUi.getState().filters).toEqual(EMPTY_FILTERS);
  });

  it('treats a blank search as no filter', () => {
    useUi.getState().setSearch('   ');
    expect(filtersActive(useUi.getState().filters)).toBe(false);
    useUi.getState().setSearch('cedar');
    expect(filtersActive(useUi.getState().filters)).toBe(true);
  });
});

describe('panels', () => {
  it('toggles a panel and reveals the sidebar that hosts the authorization tab', () => {
    useUi.setState({ inspectorOpen: false });
    useUi.getState().togglePanel('authorization');
    expect(useUi.getState()).toMatchObject({ openPanel: 'authorization', inspectorOpen: true });
    useUi.getState().togglePanel('authorization');
    expect(useUi.getState().openPanel).toBeNull();
  });

  it('inspecting an event reveals the incidents tab', () => {
    useUi.setState({ explorerOpen: false, leftTab: 'explorer' });
    useUi.getState().inspectEvent(42);
    expect(useUi.getState()).toMatchObject({
      inspectedEventSeq: 42,
      leftTab: 'incidents',
      explorerOpen: true,
    });
    useUi.getState().inspectEvent(null);
    expect(useUi.getState().leftTab).toBe('incidents');
  });

  it('forgets topology-bound state when the topology is replaced', () => {
    useUi.getState().selectNode('use-gateway');
    useUi.getState().toggleType('database');
    useUi.getState().traceDecision(decisionDeny());
    useUi.getState().resetForTopology();
    expect(useUi.getState()).toMatchObject({
      selection: null,
      filters: EMPTY_FILTERS,
      tracedDecision: null,
    });
  });
});

describe('settings', () => {
  it('persist to local storage and can be restored', () => {
    useSettings.getState().set('quality', 'low');
    useSettings.getState().set('bloom', false);
    expect(JSON.parse(localStorage.getItem('aegis.settings.v1')!).state).toMatchObject({
      quality: 'low',
      bloom: false,
    });
    useSettings.getState().reset();
    expect(useSettings.getState()).toMatchObject({
      quality: 'auto',
      bloom: true,
      renderer: 'auto',
    });
  });

  it('resolves the motion preference against the operating system', () => {
    expect(prefersReducedMotion('reduced')).toBe(true);
    expect(prefersReducedMotion('full')).toBe(false);
    expect(prefersReducedMotion('system')).toBe(false);
  });
});

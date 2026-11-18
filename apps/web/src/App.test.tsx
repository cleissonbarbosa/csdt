/**
 * Interface tests. The application runs against real server output (the
 * contract samples) with the network layer replaced, in jsdom — which has no
 * WebGPU or WebGL 2, so these also exercise the non-3D fallback.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '@/app/queryClient';
import { useGuide } from '@/stores/guide';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { useSettings, useUi } from '@/stores/ui';
import * as fixtures from '@/test/fixtures';

const api = vi.hoisted(() => ({
  health: vi.fn(),
  topology: vi.fn(),
  topologies: vi.fn(),
  metrics: vi.fn(),
  events: vi.fn(),
  incidents: vi.fn(),
  incidentReport: vi.fn(),
  session: vi.fn(),
  loadSession: vi.fn(),
  compareIntervention: vi.fn(),
  diffWorkspace: vi.fn(),
  scenarios: vi.fn(),
  recordings: vi.fn(),
  providers: vi.fn(),
  connectProvider: vi.fn(),
  disconnectProvider: vi.fn(),
  startScenario: vi.fn(),
  reset: vi.fn(),
  control: vi.fn(),
  injectFault: vi.fn(),
  clearFaults: vi.fn(),
  selectTopology: vi.fn(),
  loadRecording: vi.fn(),
  authorizationCatalog: vi.fn(),
  authorizationDecisions: vi.fn(),
  evaluate: vi.fn(),
  explain: vi.fn(),
  tryFault: vi.fn(),
  accessMatrix: vi.fn(),
  workspace: vi.fn(),
  exportWorkspace: vi.fn(),
  checkWorkspace: vi.fn(),
  importWorkspace: vi.fn(),
  resetWorkspace: vi.fn(),
}));

vi.mock('@/providers/api', async (original) => ({
  ...(await original<typeof import('@/providers/api')>()),
  api,
}));
// The stream is replaced by seeding the stores directly.
vi.mock('@/app/useAegisConnection', () => ({ useAegisConnection: () => undefined }));

const { App } = await import('./App');
const { CHALLENGES } = await import('@/features/guide/challenges');

function seed() {
  const telemetry = useTelemetry.getState();
  telemetry.setTopology(fixtures.topology());
  telemetry.applySnapshot(fixtures.snapshot());
  telemetry.replaceEvents(fixtures.events().events);
  telemetry.replaceHistory(fixtures.metrics().history);
  telemetry.setConnection('open');
}

function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

/**
 * The application starts with the model alone on the stage. Tests about what
 * a panel contains begin with both already open; how one gets there is
 * covered by "panels on demand".
 */
function renderOpen() {
  useUi.setState({ explorerOpen: true, inspectorOpen: true });
  return renderApp();
}

/** What is used now and then is in the menu at the end of the top bar. */
async function fromMenu(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(screen.getByRole('menuitem', { name }));
}

beforeEach(() => {
  window.innerWidth = 1600;
  localStorage.clear();
  // The address carries the view; one test's selection is not the next one's.
  window.history.replaceState(null, '', '/');
  queryClient.clear();
  // A first visit is its own subject; everywhere else it has been dealt with.
  useGuide.setState({ ...useGuide.getInitialState(), oriented: true }, true);
  useTelemetry.setState(useTelemetry.getInitialState(), true);
  useUi.setState(useUi.getInitialState(), true);
  useNotices.setState({ notices: [] });
  useSettings.getState().reset();
  const control = { playback: fixtures.snapshot().playback };
  for (const mock of Object.values(api)) mock.mockReset();
  api.topologies.mockResolvedValue(fixtures.topologies());
  api.scenarios.mockResolvedValue(fixtures.scenarios());
  api.incidents.mockResolvedValue(fixtures.incidents());
  api.incidentReport.mockResolvedValue(fixtures.incidentReport());
  api.session.mockResolvedValue(fixtures.session());
  api.compareIntervention.mockResolvedValue(fixtures.experiment());
  api.diffWorkspace.mockResolvedValue(fixtures.workspaceDiff());
  api.recordings.mockResolvedValue(fixtures.recordings());
  api.providers.mockResolvedValue(fixtures.providers());
  api.authorizationCatalog.mockResolvedValue(fixtures.catalog());
  api.authorizationDecisions.mockResolvedValue([]);
  api.evaluate.mockResolvedValue(fixtures.decisionDeny());
  api.explain.mockResolvedValue(fixtures.explanation());
  api.tryFault.mockResolvedValue(fixtures.trial());
  api.accessMatrix.mockResolvedValue(fixtures.accessMatrix());
  api.workspace.mockResolvedValue(fixtures.workspace());
  api.exportWorkspace.mockResolvedValue(fixtures.workspaceExport());
  api.checkWorkspace.mockResolvedValue(fixtures.workspaceCheck());
  api.importWorkspace.mockResolvedValue(fixtures.workspaceResponse());
  api.injectFault.mockResolvedValue(control);
  api.clearFaults.mockResolvedValue(control);
  api.resetWorkspace.mockResolvedValue({
    workspace: fixtures.workspace(),
    playback: fixtures.snapshot().playback,
  });
  for (const command of [
    api.control,
    api.startScenario,
    api.reset,
    api.selectTopology,
    api.loadRecording,
    api.loadSession,
  ]) {
    command.mockResolvedValue(control);
  }
  seed();
});

describe('loading and fallback rendering', () => {
  it('shows the topology as an accessible table when 3D is unavailable', async () => {
    renderApp();
    const table = screen.getByTestId('topology-table');
    expect(within(table).getByRole('status')).toHaveTextContent(/neither WebGPU nor WebGL 2/);
    // One table per region, each row a service with its live figures.
    expect(within(table).getAllByRole('table')).toHaveLength(4);
    const usEast = within(table).getByRole('table', { name: /US East/ });
    const row = within(usEast).getByRole('rowheader', { name: 'Identity Service' }).closest('tr')!;
    expect(within(row).getByText('Critical')).toBeInTheDocument();
    expect(row).toHaveTextContent('Authentication');
    expect(screen.queryByRole('img', { name: /Interactive 3D view/ })).not.toBeInTheDocument();
  });

  it('labels where the data comes from and how the stream is doing', async () => {
    renderApp();
    expect(screen.getByTestId('connection-health')).toHaveTextContent('Stream connected');
    // Provenance is a plain sentence, not a cluster of badges.
    expect(screen.getByText('Simulated, synthetic data')).toBeInTheDocument();
    expect(screen.getByTestId('mode-switch')).toHaveAttribute('data-mode', 'demo');
  });

  it('says so, and shows nothing invented, when the server cannot be reached', () => {
    useTelemetry.setState(useTelemetry.getInitialState(), true);
    useTelemetry.getState().setLoadError('The AEGIS server is unreachable.');
    renderApp();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The AEGIS server is not answering');
    expect(alert).toHaveTextContent('AEGIS does not invent data');
    expect(screen.queryByTestId('hud')).not.toBeInTheDocument();
  });

  it('renders platform metrics straight from the snapshot', () => {
    renderOpen();
    const g = fixtures.snapshot().global;
    expect(screen.getByTestId('hud-errors')).toHaveTextContent(
      `${(g.errorRate * 100).toFixed(2)}%`,
    );
    // The four signals, each on a scale with its normal range.
    for (const id of ['hud-rps', 'hud-p95', 'hud-errors', 'hud-saturation']) {
      expect(screen.getByTestId(id)).not.toBeEmptyDOMElement();
    }
    // Secondary figures live with the platform overview.
    expect(screen.getByTestId('platform-figures')).toHaveTextContent('Latency p99');
  });

  it('states the condition of the platform in one sentence', async () => {
    const user = userEvent.setup();
    renderApp();
    const g = fixtures.snapshot().global;
    const status = screen.getByTestId('platform-status');
    expect(status).toHaveAttribute('data-incidents', String(g.activeIncidents));
    // The fixture has an incident running: the sentence names it and says how
    // far it reaches, and leads to the incident when pressed.
    expect(status).not.toHaveAttribute('data-level', 'healthy');
    expect(status).toHaveTextContent(/\d+ services? affected/);
    await user.click(status);
    expect(await screen.findByTestId('active-incident')).toBeInTheDocument();
    expect(useUi.getState().acknowledgedIncidentId).toBe(fixtures.snapshot().incident?.id);
  });

  it('says nothing is wrong when nothing is', () => {
    const quiet = fixtures.snapshot();
    quiet.incident = null;
    quiet.global.activeIncidents = 0;
    quiet.global.health = { healthy: 51, degraded: 0, critical: 0, down: 0 };
    useTelemetry.getState().applySnapshot(quiet);
    renderApp();
    const status = screen.getByTestId('platform-status');
    expect(status).toHaveAttribute('data-level', 'healthy');
    expect(status).toHaveTextContent('51 services, all normal');
  });

  it('shows in the top bar only the signals that have left their normal range', () => {
    // A platform where every reading is where it was at the start.
    const baseline = fixtures.metrics().history[0]!;
    const calm = fixtures.snapshot();
    calm.global.rps = baseline.rps;
    calm.global.p95LatencyMs = baseline.p95LatencyMs;
    calm.global.errorRate = 0;
    calm.nodes.saturation = calm.nodes.saturation.map(() => 0.4);
    useTelemetry.getState().applySnapshot(calm);
    renderApp();
    // The dark cockpit: with nothing out of range, no instrument is on show.
    expect(screen.queryAllByTestId(/^deviation-/)).toHaveLength(0);

    const failing = structuredClone(calm);
    failing.global.errorRate = 0.2;
    act(() => useTelemetry.getState().applySnapshot(failing));
    expect(screen.getAllByTestId(/^deviation-/)).toHaveLength(1);
    expect(screen.getByTestId('deviation-errors')).toHaveTextContent('20.0%');
  });
});

describe('panels on demand', () => {
  it('starts with the model alone on the stage', () => {
    renderApp();
    expect(screen.getByTestId('topology-table')).toBeInTheDocument();
    expect(screen.queryByTestId('explorer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scenario-console')).not.toBeInTheDocument();
    // The four signals are not on show either; they are in the overview.
    expect(screen.queryByTestId('hud')).not.toBeInTheDocument();
  });

  it('brings the explorer and the overview when they are asked for', async () => {
    const user = userEvent.setup();
    renderApp();
    await fromMenu(user, /List every service/);
    expect(screen.getByTestId('explorer-count')).toHaveTextContent('51 of 51 services');
    await fromMenu(user, 'Platform signals');
    expect(screen.getByTestId('overview')).toHaveTextContent('Helios Commerce');

    await user.click(screen.getByRole('button', { name: 'Close the overview' }));
    await user.click(screen.getByRole('button', { name: 'Close this panel' }));
    await waitFor(() => {
      expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
      expect(screen.queryByTestId('explorer')).not.toBeInTheDocument();
    });
  });

  it('says which moment it speaks of while the cursor is in the history', () => {
    const past = fixtures.snapshot();
    past.incident = null;
    past.faults = [];
    past.global.activeIncidents = 0;
    past.global.health = { healthy: 51, degraded: 0, critical: 0, down: 0 };
    past.playback = { ...past.playback, mode: 'replay', virtualTimeMs: 76_400 };
    useTelemetry.getState().applySnapshot(past);
    renderApp();
    // "All normal" is true of 1:16, not of now, and the sentence says so.
    const status = screen.getByTestId('platform-status');
    expect(status).toHaveTextContent('At 1:16, in history: 51 services, all normal');
    act(() =>
      useTelemetry
        .getState()
        .setPlayback({ ...past.playback, mode: 'live', virtualTimeMs: 90_000 }),
    );
    expect(status).toHaveTextContent(/^51 services, all normal$/);
  });

  it('opens the overview from the status sentence while all is well', async () => {
    const quiet = fixtures.snapshot();
    quiet.incident = null;
    quiet.faults = [];
    quiet.global.activeIncidents = 0;
    quiet.global.health = { healthy: 51, degraded: 0, critical: 0, down: 0 };
    useTelemetry.getState().applySnapshot(quiet);
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByTestId('platform-status')).toHaveTextContent('51 services, all normal');
    await user.click(screen.getByTestId('platform-status'));
    expect(screen.getByTestId('overview')).toBeInTheDocument();
    expect(screen.getByTestId('hud-rps')).not.toBeEmptyDOMElement();
  });

  it('brings the inspector with a selection and puts it away without one', async () => {
    renderApp();
    act(() => useUi.getState().selectNode('use-gateway'));
    expect(screen.getByTestId('inspector-title')).toHaveTextContent('API Gateway');
    act(() => useUi.getState().select(null));
    // On its way out it goes on showing the service, never the overview.
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('node-inspector')).not.toBeInTheDocument());
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
  });

  it('keeps the authorization panel when the selection is cleared', async () => {
    const user = userEvent.setup();
    renderApp();
    await fromMenu(user, 'Trace a request through Cedar');
    act(() => useUi.getState().select(null));
    expect(screen.getByRole('complementary', { name: 'Trace a request' })).toBeInTheDocument();
    expect(useUi.getState().openPanel).toBe('authorization');
  });

  it('opens the incidents from the one command in the top bar', async () => {
    const quiet = fixtures.snapshot();
    quiet.incident = null;
    quiet.global.activeIncidents = 0;
    useTelemetry.getState().applySnapshot(quiet);
    const user = userEvent.setup();
    renderApp();
    const command = screen.getByTestId('explore-incident');
    expect(command).toHaveTextContent('Explore an incident');
    await user.click(command);
    expect(await screen.findByTestId('scenario-console')).toBeInTheDocument();
    expect(command).toHaveAttribute('aria-expanded', 'true');
    await user.click(command);
    await waitFor(() => expect(screen.queryByTestId('scenario-console')).not.toBeInTheDocument());
  });

  it('follows the incident under way instead of closing what shows it', async () => {
    const user = userEvent.setup();
    renderApp();
    const command = screen.getByTestId('explore-incident');
    expect(command).toHaveTextContent('Follow the incident');
    await user.click(command);
    expect(await screen.findByTestId('active-incident')).toBeInTheDocument();
    expect(useUi.getState().acknowledgedIncidentId).toBe(fixtures.snapshot().incident?.id);

    // Reading one of its events, then asking to follow it again: the panel
    // stays, and goes back to the incident's phases.
    act(() => useUi.getState().inspectEvent(fixtures.events().events[0]!.seq));
    expect(await screen.findByTestId('event-detail')).toBeInTheDocument();
    await user.click(command);
    expect(await screen.findByTestId('active-incident')).toBeInTheDocument();
    expect(useUi.getState()).toMatchObject({ explorerOpen: true, leftTab: 'incidents' });
    // It leads somewhere and never away, so it has nothing to collapse.
    expect(command).not.toHaveAttribute('aria-expanded');
  });

  it('keeps the timeline off the screen until there is something on it', async () => {
    const quiet = fixtures.snapshot();
    quiet.incident = null;
    quiet.global.activeIncidents = 0;
    useTelemetry.getState().applySnapshot(quiet);
    api.incidents.mockResolvedValue({ ...fixtures.incidents(), incidents: [] });
    const user = userEvent.setup();
    renderApp();
    expect(screen.queryByTestId('timeline')).not.toBeInTheDocument();
    // Asked for, it comes, and can be put away again.
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Timeline and playback/ }));
    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Put the timeline away' }));
    expect(screen.queryByTestId('timeline')).not.toBeInTheDocument();
    // Pausing makes time something to look at: it comes by itself.
    act(() =>
      useTelemetry.getState().setPlayback({ ...quiet.playback, status: 'paused' as const }),
    );
    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Put the timeline away' })).not.toBeInTheDocument();
  });
});

describe('the overview', () => {
  it('describes a kind of service from all of its instances', async () => {
    renderApp();
    act(() => useUi.getState().select({ kind: 'group', id: 'kind:api-gateway' }));
    const card = screen.getByTestId('group-card');
    expect(within(card).getByTestId('inspector-title')).toHaveTextContent('API gateways');
    expect(card).toHaveTextContent('3 API gateways in the entry layer');
    expect(within(card).getByTestId('inspector-metrics')).toHaveTextContent('req/s');
    // Its instances are listed with the region each is in.
    const members = within(card).getByTestId('group-members');
    expect(within(members).getAllByRole('button')).toHaveLength(3);
    expect(members).toHaveTextContent('EU West');
    // What it talks to is other kinds, not other services.
    expect(card).toHaveTextContent('Global Edge Router');
  });

  it('opens a service where it stands, in the detailed arrangement', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(useUi.getState().layoutMode).toBe('layers');
    act(() => useUi.getState().select({ kind: 'group', id: 'kind:cedar-authorizer' }));
    expect(screen.getByTestId('group-authorization')).toHaveTextContent('Denied');
    await user.click(screen.getByTestId('member-use-cedar'));
    expect(useUi.getState().layoutMode).toBe('regions');
    expect(useUi.getState().selection).toEqual({ kind: 'node', id: 'use-cedar' });
    expect(await screen.findByTestId('node-inspector')).toHaveAttribute(
      'data-node-id',
      'use-cedar',
    );
    // Going back to the overview lets go of the service.
    act(() => useUi.getState().setLayoutMode('layers'));
    expect(useUi.getState().selection).toBeNull();
  });
});

describe('explorer', () => {
  it('lists every service by region and filters them', async () => {
    const user = userEvent.setup();
    renderOpen();
    expect(screen.getByTestId('explorer-count')).toHaveTextContent('51 of 51 services');
    expect(screen.getByRole('region', { name: 'EU West' })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox'), 'cedar');
    expect(screen.getByTestId('explorer-count')).toHaveTextContent('3 of 51 services');
    expect(screen.queryByTestId('service-use-gateway')).not.toBeInTheDocument();
    // The table view honours the same filters.
    expect(
      within(screen.getByTestId('topology-table')).getAllByRole('row', {
        name: /Cedar Authorizer/,
      }),
    ).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: /Clear filters/ }));
    // Filters stay out of the way until asked for.
    expect(screen.queryByRole('button', { name: 'Critical', pressed: false })).toBeNull();
    await user.click(screen.getByTestId('explorer-filters-toggle'));
    await user.click(screen.getByRole('button', { name: 'Critical', pressed: false }));
    const critical = screen.getAllByTestId(/^service-/);
    expect(critical.length).toBeGreaterThan(0);
    for (const item of critical) expect(item).toHaveAttribute('data-health', 'critical');
  });

  it('explains an empty result', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByTestId('explorer-count')).toHaveTextContent('0 of 51 services');
    expect(screen.getAllByText('No services match').length).toBeGreaterThan(0);
  });
});

describe('command palette', () => {
  it('reaches a service by name from the keyboard', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByTestId('command-input');
    expect(input).toHaveFocus();
    // Before anything is typed it offers actions, not a wall of services.
    expect(screen.getByRole('option', { name: /Reset the camera/ })).toBeInTheDocument();

    await user.type(input, 'orders db');
    const first = screen.getAllByRole('option')[0]!;
    expect(first).toHaveTextContent('Orders DB');
    expect(first).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
    expect(useUi.getState().selection).toEqual({ kind: 'node', id: 'use-orders-db' });
    expect(screen.getByTestId('inspector-title')).toHaveTextContent('Orders DB');
  });

  it('moves through results with the arrow keys and says when nothing matches', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('open-command'));
    const input = await screen.findByTestId('command-input');
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.type(input, 'no such thing anywhere');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
  });
});

describe('inspector', () => {
  it('shows the platform overview when nothing is selected', () => {
    renderOpen();
    const overview = screen.getByTestId('overview');
    expect(overview).toHaveTextContent('Helios Commerce');
    expect(within(overview).getByText('Needs attention')).toBeInTheDocument();
    // The four signals live here, each against its normal range.
    expect(within(overview).getByTestId('hud')).toBeInTheDocument();
  });

  it('shows metrics, connections and history for the selected service', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByTestId('service-use-auth'));

    const inspector = screen.getByTestId('node-inspector');
    expect(within(inspector).getByTestId('inspector-title')).toHaveTextContent('Identity Service');
    expect(within(inspector).getByText('Critical')).toBeInTheDocument();
    const metrics = within(inspector).getByTestId('inspector-metrics');
    for (const label of ['Throughput', 'Latency', 'Error rate', 'Saturation']) {
      expect(within(metrics).getByText(label)).toBeInTheDocument();
    }
    // Connections in both directions, with the relationship spelled out.
    expect(inspector).toHaveTextContent('Session Cache');
    expect(inspector).toHaveTextContent('Reads / writes');
    expect(inspector).toHaveTextContent('Authenticates with');
    expect(within(inspector).getByTestId('inspector-events')).toHaveTextContent(
      /Identity Service is/,
    );
    expect(screen.getByTestId('service-use-auth')).toHaveAttribute('aria-current', 'true');

    // Follow a connection to the neighbouring service.
    await user.click(
      within(inspector).getByRole('button', { name: /Session Cache.*Reads \/ writes/ }),
    );
    expect(screen.getByTestId('inspector-title')).toHaveTextContent('Session Cache');

    // Letting go of the selection puts the inspector away.
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(useUi.getState().selection).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('node-inspector')).not.toBeInTheDocument());
  });

  it('inspects a connection', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByTestId('service-use-gateway'));
    await user.click(
      screen.getByRole('button', {
        name: 'Inspect connection to Identity Service, US East · Primary',
      }),
    );
    const edge = screen.getByTestId('edge-inspector');
    expect(edge).toHaveTextContent('Authenticates with');
    expect(edge).toHaveTextContent('Denied');
    expect(edge).toHaveTextContent('Rejected');
  });

  it('can be driven from the keyboard', async () => {
    const user = userEvent.setup();
    renderOpen();
    const service = screen.getByTestId('service-use-orders-db');
    service.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('inspector-title')).toHaveTextContent('Orders DB');
    // Escape lets go of the selection, then puts the explorer away too.
    await user.keyboard('{Escape}');
    expect(useUi.getState()).toMatchObject({ selection: null, inspectorOpen: false });
    await user.keyboard('{Escape}');
    expect(useUi.getState().explorerOpen).toBe(false);
  });
});

describe('incident console', () => {
  async function openConsole(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('tab', { name: /Incidents/ }));
    return screen.findByTestId('scenario-console');
  }

  it('lists the five scenarios and starts one', async () => {
    const user = userEvent.setup();
    renderOpen();
    const console_ = await openConsole(user);
    const cards = await within(console_).findAllByTestId(
      /^scenario-(?!start|console|compare|editor)/,
    );
    expect(cards).toHaveLength(5);
    await user.click(screen.getByTestId('scenario-start-ddos-surge'));
    expect(api.startScenario).toHaveBeenCalledWith('ddos-surge');
  });

  it('explains why a scenario cannot run on the active platform', async () => {
    const reason = 'unknown node `ledger`';
    const scenarios = fixtures.scenarios();
    api.scenarios.mockResolvedValue({
      ...scenarios,
      scenarios: scenarios.scenarios.map((scenario) =>
        scenario.id === 'ddos-surge'
          ? { ...scenario, available: false, unavailableReason: reason }
          : scenario,
      ),
    });
    const user = userEvent.setup();
    renderOpen();
    await openConsole(user);
    const start = await screen.findByTestId('scenario-start-ddos-surge');
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(`Cannot run: ${reason}`);
    expect(screen.getByText(`Cannot run: ${reason}`)).toBeVisible();
    await user.click(start);
    expect(api.startScenario).not.toHaveBeenCalled();
  });

  it('shows the active incident, its phase and what it impacted', async () => {
    const user = userEvent.setup();
    renderOpen();
    await openConsole(user);
    const active = await screen.findByTestId('active-incident');
    expect(active).toHaveAttribute('data-scenario', 'credential-stuffing');
    expect(await within(active).findByText('Credential Stuffing')).toBeInTheDocument();
    expect(within(active).getByRole('progressbar')).toHaveAttribute('aria-valuenow');
    expect(within(active).getByTestId('incident-phase')).not.toBeEmptyDOMElement();
    const impacted = within(active).getByTestId('impacted-services');
    // Three regions run an identity service; the list says which one this is.
    expect(
      within(impacted).getByRole('button', { name: 'Identity Service, US East · Primary' }),
    ).toBeInTheDocument();

    // The running scenario offers a restart, the others a start.
    expect(screen.getByTestId('scenario-start-credential-stuffing')).toHaveTextContent('Restart');
    await user.click(screen.getByTestId('scenario-start-credential-stuffing'));
    await waitFor(() => expect(api.startScenario).toHaveBeenCalledWith('credential-stuffing'));
    expect(api.reset).toHaveBeenCalledWith('simulation');
  });

  it('pauses, resumes and stops the scenario', async () => {
    const user = userEvent.setup();
    renderOpen();
    await openConsole(user);
    await user.click(await screen.findByTestId('incident-pause'));
    expect(api.control).toHaveBeenCalledWith({ action: 'pause' });
    await user.click(screen.getByTestId('incident-stop'));
    expect(api.reset).toHaveBeenCalledWith('scenario');
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Scenario speed' })).getByRole('radio', {
        name: '4×',
      }),
    );
    expect(api.control).toHaveBeenCalledWith({ action: 'setSpeed', speed: 4 });
  });

  it('asks before erasing history', async () => {
    const user = userEvent.setup();
    renderOpen();
    await openConsole(user);
    await user.click(screen.getByTestId('reset-simulation'));
    expect(api.reset).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('reset-confirm'));
    expect(api.reset).toHaveBeenCalledWith('simulation');
    expect(await screen.findByText('Simulation reset to a clean baseline.')).toBeInTheDocument();
  });

  it('inspects an event and jumps to its moment', async () => {
    const user = userEvent.setup();
    renderOpen();
    await openConsole(user);
    const alert = (await screen.findAllByTestId('event-row')).find(
      (row) => row.dataset.kind === 'alert',
    )!;
    await user.click(alert);
    const detail = screen.getByTestId('event-detail');
    expect(detail).toHaveTextContent('Alert');
    expect(detail).toHaveTextContent('Sequence');
    await user.click(within(detail).getByTestId('event-jump'));
    expect(api.control).toHaveBeenCalledWith(expect.objectContaining({ action: 'seek' }));
    await user.click(within(detail).getByRole('button', { name: /All events/ }));
    expect(screen.getByTestId('event-log')).toBeInTheDocument();
  });

  it('reports a failed command instead of failing silently', async () => {
    const { ApiError } = await import('@/providers/api');
    api.startScenario.mockRejectedValue(
      new ApiError(409, 'conflict', 'scenario `x` is not available'),
    );
    const user = userEvent.setup();
    renderOpen();
    await openConsole(user);
    await user.click(await screen.findByTestId('scenario-start-regional-outage'));
    expect(
      await screen.findByText(/The scenario did not start\. scenario `x` is not available/),
    ).toBeInTheDocument();
  });
});

describe('playback', () => {
  it('pauses, steps, replays and returns to live', async () => {
    const user = userEvent.setup();
    renderApp();
    const timeline = screen.getByTestId('timeline');
    expect(timeline).toHaveAttribute('data-status', 'playing');
    await user.click(screen.getByTestId('playback-toggle'));
    expect(api.control).toHaveBeenLastCalledWith({ action: 'pause' });
    await user.click(screen.getByTestId('playback-replay'));
    expect(api.control).toHaveBeenLastCalledWith({ action: 'replay' });
    await user.click(screen.getByTestId('playback-live'));
    expect(api.control).toHaveBeenLastCalledWith({ action: 'live' });
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Playback speed' })).getByRole('radio', {
        name: '0.5×',
      }),
    );
    expect(api.control).toHaveBeenLastCalledWith({ action: 'setSpeed', speed: 0.5 });
  });

  it('reflects the state the server reports', async () => {
    const paused = {
      ...fixtures.snapshot().playback,
      status: 'paused' as const,
      mode: 'replay' as const,
    };
    useTelemetry.getState().setPlayback(paused);
    renderApp();
    expect(screen.getByTestId('playback-toggle')).toHaveTextContent('Play');
    expect(screen.getByTestId('playback-mode')).toHaveTextContent('Paused in history');
    expect(screen.getByRole('button', { name: 'Step one tick forward' })).toBeEnabled();
  });

  it('seeks from the keyboard on the timeline', async () => {
    const user = userEvent.setup();
    renderApp();
    const track = screen.getByRole('slider', { name: 'Timeline position' });
    const now = fixtures.snapshot().playback.virtualTimeMs;
    expect(track).toHaveAttribute('aria-valuenow', String(Math.round(now / 1000)));
    track.focus();
    await user.keyboard('{ArrowLeft}');
    expect(api.control).toHaveBeenLastCalledWith({ action: 'seek', toMs: now - 5000 });
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(api.control).toHaveBeenLastCalledWith({ action: 'seek', toMs: now - 30_000 });
    await user.keyboard('{Home}');
    expect(api.control).toHaveBeenLastCalledWith({ action: 'seek', toMs: 0 });
    await user.keyboard('{End}');
    expect(api.control).toHaveBeenLastCalledWith({ action: 'live' });
  });

  it('toggles play with the space bar unless a control has focus', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.keyboard(' ');
    expect(api.control).toHaveBeenCalledWith({ action: 'pause' });
    api.control.mockClear();
    await user.type(screen.getByRole('searchbox'), 'a b');
    expect(api.control).not.toHaveBeenCalled();
  });

  it('loads a recorded incident', async () => {
    const user = userEvent.setup();
    renderOpen();
    // Recordings are loaded from the incidents panel, next to the scenarios.
    expect(screen.queryByTestId('recording-picker')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Incidents/ }));
    await user.selectOptions(await screen.findByTestId('recording-picker'), 'black-friday-flood');
    expect(api.loadRecording).toHaveBeenCalledWith('black-friday-flood');
  });
});

describe('authorization explorer', () => {
  it('evaluates a request with Cedar and shows the engine’s answer', async () => {
    const user = userEvent.setup();
    renderApp();
    // Nothing is open at the start: the menu brings the panel.
    expect(screen.queryByTestId('authz-form')).not.toBeInTheDocument();
    await fromMenu(user, 'Trace a request through Cedar');
    const form = await screen.findByTestId('authz-form');
    await user.selectOptions(within(form).getByTestId('authz-principal'), 'User::"mallory"');
    await user.selectOptions(within(form).getByTestId('authz-action'), 'Action::"exportLedger"');
    // Resources are narrowed to the kind the action applies to.
    const resources = within(form).getByTestId('authz-resource') as HTMLSelectElement;
    expect([...resources.options].every((option) => option.value.startsWith('Ledger::'))).toBe(
      true,
    );
    await user.click(
      within(within(form).getByRole('radiogroup', { name: 'Fresh MFA assertion' })).getByRole(
        'radio',
        { name: 'True' },
      ),
    );
    await user.click(screen.getByTestId('authz-evaluate'));

    expect(api.evaluate).toHaveBeenCalledWith({
      principal: 'User::"mallory"',
      action: 'Action::"exportLedger"',
      resource: 'Ledger::"acme-ledger-2026"',
      context: { mfa: true },
      engine: 'embedded',
    });
    const card = await screen.findByTestId('decision-card');
    expect(card).toHaveAttribute('data-decision', 'deny');
    expect(within(card).getByTestId('decision-result')).toHaveTextContent('Deny');
    expect(within(card).getByTestId('decision-policies')).toHaveTextContent('forbid-cross-tenant');
    expect(within(card).getByTestId('decision-engine')).toHaveTextContent(/Embedded Cedar 4\./);
    const path = within(card).getByTestId('decision-path');
    expect(path).toHaveTextContent('Cedar Authorizer');
    expect(within(path).getByText(/blocked here/)).toBeInTheDocument();
    // The decision is handed to the scene to be traced.
    expect(useUi.getState().tracedDecision?.decision).toBe('deny');
  });

  it('takes a denial by default policy by policy, and names the permit it came closest to', async () => {
    // Bob, a support agent, refunding an order above the limit: no policy
    // permits it and Cedar names none. Each policy is put to the request.
    const explanation = fixtures.explanation();
    api.evaluate.mockResolvedValue({
      ...fixtures.decisionDeny(),
      request: explanation.request,
      determiningPolicies: [],
    });
    const user = userEvent.setup();
    renderOpen();
    await fromMenu(user, 'Trace a request through Cedar');
    await user.click(await screen.findByTestId('authz-evaluate'));

    const card = await screen.findByTestId('decision-card');
    const standings = await within(card).findByTestId('policy-standings');
    expect(api.explain).toHaveBeenCalledWith({
      principal: 'User::"bob"',
      action: 'Action::"refundOrder"',
      resource: 'Order::"acme-ord-9000"',
      context: {},
      disabledPolicies: [],
    });
    expect(within(standings).getByTestId('policy-closest')).toHaveTextContent(
      'Closest: support-refund-limit is about this request, but its condition does not hold.',
    );
    const refund = within(standings).getByTestId('standing-support-refund-limit');
    expect(refund).toHaveAttribute('data-standing', 'near');
    // The policy can be read where it is named.
    await user.click(within(refund).getByRole('button'));
    expect(refund).toHaveTextContent('resource.amount <= 500');
    expect(refund).toHaveTextContent('its condition does not hold: it does not permit');
    // The ones that are not about the request are counted, not listed.
    expect(standings).toHaveTextContent('6 not about this request');
  });

  it('shows no standings that answer other policies than the decision did', async () => {
    // The explanation is a second question to the engine. If the policies
    // were replaced in between, its answer is not this decision's.
    api.explain.mockResolvedValue({ ...fixtures.explanation(), decision: 'allow' });
    const user = userEvent.setup();
    renderOpen();
    await fromMenu(user, 'Trace a request through Cedar');
    await user.click(await screen.findByTestId('authz-evaluate'));
    const card = await screen.findByTestId('decision-card');
    expect(await within(card).findByTestId('policy-standings-moved')).toBeInTheDocument();
    expect(within(card).queryByTestId('policy-standings')).not.toBeInTheDocument();
  });

  it('lets policies be switched off for an evaluation', async () => {
    const user = userEvent.setup();
    renderOpen();
    await fromMenu(user, 'Trace a request through Cedar');
    const policies = await screen.findByTestId('policy-list');
    expect(within(policies).getAllByRole('listitem')).toHaveLength(9);
    expect(policies).toHaveTextContent('forbid(principal, action, resource)');
    await user.click(within(policies).getByRole('switch', { name: /Hard tenant isolation/ }));
    await user.click(screen.getByTestId('authz-evaluate'));
    expect(api.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ disabledPolicies: ['forbid-cross-tenant'] }),
    );
  });

  it('shows validation errors from the server', async () => {
    const { ApiError } = await import('@/providers/api');
    api.evaluate.mockRejectedValue(new ApiError(400, 'invalid_request', 'invalid principal'));
    const user = userEvent.setup();
    renderOpen();
    await fromMenu(user, 'Trace a request through Cedar');
    await user.click(await screen.findByTestId('authz-evaluate'));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid principal');
    expect(screen.queryByTestId('decision-card')).not.toBeInTheDocument();
  });

  it('leaves out what a workspace’s catalogue and topology do not provide', async () => {
    // A catalogue written for another platform: no roles, no context keys,
    // and a topology that names no gateway, so the server returns no path.
    const catalog = fixtures.catalog();
    api.authorizationCatalog.mockResolvedValue({
      ...catalog,
      principals: catalog.principals.map((principal) => ({ ...principal, roles: [] })),
      contextKeys: [],
    });
    api.evaluate.mockResolvedValue({
      ...fixtures.decisionDeny(),
      path: [],
      hops: [],
      blockedAt: null,
    });
    const user = userEvent.setup();
    renderOpen();
    await fromMenu(user, 'Trace a request through Cedar');
    const form = await screen.findByTestId('authz-form');
    expect(form).toHaveTextContent(/has no role; the resource belongs to/);
    expect(within(form).queryByRole('group', { name: 'Context' })).not.toBeInTheDocument();

    await user.click(within(form).getByTestId('authz-evaluate'));
    const card = await screen.findByTestId('decision-card');
    // The decision is still Cedar's; there is only no path to draw.
    expect(within(card).getByTestId('decision-result')).toHaveTextContent('Deny');
    expect(within(card).getByTestId('decision-path-none')).toHaveTextContent(/None to draw/);
    expect(within(card).getByTestId('decision-path')).toBeEmptyDOMElement();
  });

  it('only offers cedar-agent once one is connected', async () => {
    const user = userEvent.setup();
    renderOpen();
    await fromMenu(user, 'Trace a request through Cedar');
    const engines = await screen.findByRole('radiogroup', { name: 'Policy engine' });
    expect(within(engines).getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByText(/Connect a local cedar-agent/)).toBeInTheDocument();
  });
});

describe('the model inside another page', () => {
  it('has no bar, says what it is in a line and leads to the whole application', () => {
    useGuide.setState({ ...useGuide.getInitialState(), oriented: false }, true);
    window.history.replaceState(null, '', '/?embed=1&scenario=ddos-surge&arrangement=regions');
    renderApp();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    // Nobody's first visit: the orientation is not spent on an embed.
    expect(screen.queryByRole('region', { name: 'Where to start' })).not.toBeInTheDocument();
    expect(useGuide.getState().oriented).toBe(false);
    const bar = screen.getByTestId('embed-bar');
    expect(bar).toHaveTextContent('Simulated, synthetic data');
    expect(within(bar).getByTestId('embed-status')).toBeInTheDocument();
    expect(within(bar).getByTestId('embed-open')).toHaveAttribute('href', '/?arrangement=regions');
    // The simulation is the server's here, and shared: the address starts nothing.
    expect(api.startScenario).not.toHaveBeenCalled();
  });

  it('is the whole application everywhere else', () => {
    renderApp();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.queryByTestId('embed-bar')).not.toBeInTheDocument();
  });
});

describe('who may do what', () => {
  it("counts Cedar's answers by principal and action, and opens one in the tracer", async () => {
    const user = userEvent.setup();
    renderApp();
    await fromMenu(user, 'Who may do what');
    const matrix = await screen.findByTestId('access-matrix');
    // Every request of the catalogue was asked, with nothing switched off.
    expect(api.accessMatrix).toHaveBeenCalledWith({ context: {}, disabledPolicies: [] });
    const cells = fixtures.accessMatrix().cells;
    const allowed = cells.filter((cell) => cell.decision === 'allow').length;
    expect(within(matrix).getByTestId('matrix-summary')).toHaveTextContent(
      `Cedar allows ${allowed} of ${cells.length} requests.`,
    );
    const catalog = fixtures.catalog();
    expect(within(matrix).getAllByRole('rowheader')).toHaveLength(catalog.principals.length);

    // Bob, a support agent, refunding orders: one answer per order.
    const bob = catalog.principals.findIndex((p) => p.uid === 'User::"bob"');
    const refund = catalog.actions.findIndex((a) => a.uid === 'Action::"refundOrder"');
    const cell = within(matrix).getByTestId(`matrix-cell-${bob}-${refund}`);
    expect(cell).toHaveAccessibleName('Bob, Refund order: 1 of 3');
    await user.click(cell);
    const answers = within(within(matrix).getByTestId('matrix-detail')).getAllByTestId(
      'matrix-answer',
    );
    expect(answers).toHaveLength(3);
    const denied = answers.find((answer) => answer.textContent?.includes('4,200'))!;
    expect(denied).toHaveAttribute('data-decision', 'deny');
    expect(denied).toHaveTextContent('no policy permits it');

    // Following it hands the request to the tracer, context and all.
    await user.click(within(denied).getByTestId('matrix-trace'));
    const form = await screen.findByTestId('authz-form');
    expect(within(form).getByTestId('authz-principal')).toHaveValue('User::"bob"');
    expect(within(form).getByTestId('authz-action')).toHaveValue('Action::"refundOrder"');
    expect(within(form).getByTestId('authz-resource')).toHaveValue('Order::"acme-ord-9000"');
    expect(screen.queryByTestId('access-matrix')).not.toBeInTheDocument();
  });

  it('asks again with a policy switched off, and says how many answers moved', async () => {
    // Under all policies; with one off, a single answer turns round.
    const all = fixtures.accessMatrix();
    const turned = {
      ...all,
      disabledPolicies: ['forbid-cross-tenant'],
      cells: all.cells.map((cell, i) => (i === 0 ? { ...cell, decision: 'deny' as const } : cell)),
    };
    expect(all.cells[0]!.decision).toBe('allow');
    api.accessMatrix.mockImplementation((question: { disabledPolicies?: string[] }) =>
      Promise.resolve((question.disabledPolicies ?? []).length > 0 ? turned : all),
    );
    const user = userEvent.setup();
    renderApp();
    await fromMenu(user, 'Who may do what');
    const matrix = await screen.findByTestId('access-matrix');
    await user.click(within(matrix).getByText(/Policies in force: 9 of 9/));
    await user.click(within(matrix).getByRole('switch', { name: /^forbid-cross-tenant/ }));
    await waitFor(() =>
      expect(api.accessMatrix).toHaveBeenCalledWith({
        context: {},
        disabledPolicies: ['forbid-cross-tenant'],
      }),
    );
    await waitFor(() =>
      expect(within(matrix).getByTestId('matrix-summary')).toHaveTextContent(
        '1 differs from all policies in force',
      ),
    );
    const moved = within(matrix).getByTestId('matrix-cell-0-0');
    expect(moved).toHaveAttribute('data-changed', '1');
    expect(moved).toHaveTextContent(/was /);
  });
});

describe('editing the policies in the page', () => {
  it('checks the text as files, shows what would change, and applies only when asked', async () => {
    api.exportWorkspace.mockResolvedValue(fixtures.workspaceExport());
    const user = userEvent.setup();
    renderApp();
    act(() => useUi.getState().setPanel('policies'));
    const editor = await screen.findByTestId('policy-editor');
    const text = within(editor).getByTestId('policy-text') as HTMLTextAreaElement;
    // The policies in force, each under its id.
    expect(text.value).toContain('@id("support-refund-limit")');
    expect(within(editor).getByTestId('policy-check')).toHaveTextContent(
      'These are the policies in use.',
    );
    expect(within(editor).getByTestId('policy-apply')).toBeDisabled();
    expect(api.checkWorkspace).not.toHaveBeenCalled();

    await user.type(text, '// a note');
    // The engine is asked about the files in use with the policies replaced.
    await waitFor(() => expect(api.checkWorkspace).toHaveBeenCalled());
    const files = api.checkWorkspace.mock.lastCall![0] as { path: string; text: string }[];
    expect(files.filter((file) => file.path.startsWith('cedar/polic'))).toEqual([
      { path: 'cedar/policies.cedar', text: text.value },
    ]);
    const kept = fixtures
      .workspaceExport()
      .files.filter((file) => file.path !== 'cedar/policies.json');
    expect(files.filter((file) => file.path !== 'cedar/policies.cedar')).toEqual(kept);
    await waitFor(() =>
      expect(within(editor).getByTestId('policy-check')).toHaveTextContent('Cedar accepts them'),
    );
    expect(api.importWorkspace).not.toHaveBeenCalled();

    await user.click(within(editor).getByTestId('policy-apply'));
    await waitFor(() => expect(api.importWorkspace).toHaveBeenCalledWith(files));
    // Out of the editor, to what the policies now decide.
    await waitFor(() => expect(useUi.getState().openPanel).toBe('matrix'));
  });

  it('says what the engine refuses, and applies nothing', async () => {
    api.exportWorkspace.mockResolvedValue(fixtures.workspaceExport());
    api.checkWorkspace.mockResolvedValue({
      valid: false,
      problem: { path: 'cedar/policies.cedar', message: 'unexpected token `permitt`' },
    });
    const user = userEvent.setup();
    renderApp();
    act(() => useUi.getState().setPanel('policies'));
    const editor = await screen.findByTestId('policy-editor');
    await user.type(within(editor).getByTestId('policy-text'), 'permitt');
    await waitFor(() =>
      expect(within(editor).getByTestId('policy-check')).toHaveTextContent(
        'Not valid. cedar/policies.cedar: unexpected token `permitt`',
      ),
    );
    expect(within(editor).getByTestId('policy-apply')).toBeDisabled();
    // Putting back what is in use asks nothing more.
    await user.click(within(editor).getByTestId('policy-revert'));
    expect(within(editor).getByTestId('policy-check')).toHaveTextContent(
      'These are the policies in use.',
    );
  });
});

describe('platform files', () => {
  const scenario = () =>
    new File(['{"id":"slow-door","phases":[]}'], 'slow-door.json', { type: 'application/json' });

  async function openFiles(user: ReturnType<typeof userEvent.setup>) {
    await fromMenu(user, 'Import or export files');
    return screen.findByRole('dialog', { name: 'Platform files' });
  }

  it('says what is in use and where it came from', async () => {
    const user = userEvent.setup();
    renderApp();
    // Nothing of it is on screen until it is asked for.
    expect(screen.queryByRole('dialog', { name: 'Platform files' })).not.toBeInTheDocument();
    const dialog = await openFiles(user);
    const inUse = await within(dialog).findByTestId('workspace-in-use');
    expect(inUse).toHaveTextContent('The platform that ships with AEGIS.');
    expect(inUse).toHaveTextContent('2 platforms');
    expect(inUse).toHaveTextContent('Helios Commerce (51 services)');
    expect(inUse).toHaveTextContent('5 scenarios');
    expect(inUse).toHaveTextContent('9 Cedar policies');
    expect(inUse).toHaveTextContent('Cedar denies 7.00% of ordinary requests');
    // Nothing was imported, so there is nothing to go back from.
    expect(within(dialog).queryByTestId('workspace-reset')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('workspace-apply')).not.toBeInTheDocument();
  });

  it('checks staged files before anything is applied, then applies them', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFiles(user);
    await user.upload(within(dialog).getByTestId('workspace-files'), scenario());

    const staged = await within(dialog).findByTestId('workspace-staged');
    expect(within(staged).getByText('slow-door.json')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.checkWorkspace).toHaveBeenCalledWith([
        { path: 'slow-door.json', text: '{"id":"slow-door","phases":[]}' },
      ]),
    );
    const check = within(dialog).getByTestId('workspace-check');
    await waitFor(() => expect(check).toHaveTextContent('These files are valid'));
    expect(check).toHaveTextContent('Front Desk (2 services)');
    expect(check).toHaveTextContent('1 scenario');
    expect(api.importWorkspace).not.toHaveBeenCalled();

    await user.click(within(dialog).getByTestId('workspace-apply'));
    expect(api.importWorkspace).toHaveBeenCalledWith([
      { path: 'slow-door.json', text: '{"id":"slow-door","phases":[]}' },
    ]);
    // The dialog gets out of the way of what changed, and says what happened.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Platform files' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Now showing the imported files.')).toBeInTheDocument();
  });

  it('names the file a mistake is in and will not apply it', async () => {
    api.checkWorkspace.mockResolvedValue(fixtures.workspaceCheckInvalid());
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFiles(user);
    await user.upload(within(dialog).getByTestId('workspace-files'), scenario());
    const problem = await within(dialog).findByTestId('workspace-problem');
    expect(problem).toHaveTextContent('scenarios/01-slow-door.json');
    expect(problem).toHaveTextContent('missing field `name`');
    expect(within(dialog).getByTestId('workspace-apply')).toBeDisabled();

    // Taking the file away takes the complaint with it.
    await user.click(within(dialog).getByRole('button', { name: 'Remove slow-door.json' }));
    expect(within(dialog).queryByTestId('workspace-problem')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('workspace-staged')).not.toBeInTheDocument();
  });

  it('leaves out what cannot be part of a workspace and says so', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp();
    const dialog = await openFiles(user);
    await user.upload(within(dialog).getByTestId('workspace-files'), [
      new File(['# notes'], 'README.md'),
      scenario(),
    ]);
    expect(await within(dialog).findByTestId('workspace-skipped')).toHaveTextContent(
      'README.md (not a .json, .cedar, .cedarschema or Compose (.yml) file)',
    );
    await waitFor(() =>
      expect(api.checkWorkspace).toHaveBeenCalledWith([
        expect.objectContaining({ path: 'slow-door.json' }),
      ]),
    );
  });

  it('adds to the files in use when asked to start from them', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFiles(user);
    await user.upload(within(dialog).getByTestId('workspace-files'), scenario());
    await user.click(within(dialog).getByTestId('workspace-start-from-current'));
    const staged = await within(dialog).findByTestId('workspace-staged');
    await waitFor(() => expect(within(staged).getAllByRole('listitem').length).toBeGreaterThan(2));
    expect(within(staged).getByText('cedar/policies.json')).toBeInTheDocument();
    expect(within(staged).getByText('slow-door.json')).toBeInTheDocument();
  });

  it('offers the way back once files were imported, and saves what is in use', async () => {
    api.workspace.mockResolvedValue(fixtures.workspaceResponse().workspace);
    const createObjectURL = vi.fn(() => 'blob:aegis');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFiles(user);
    const inUse = await within(dialog).findByTestId('workspace-in-use');
    expect(inUse).toHaveTextContent('Files imported since this server started');
    expect(inUse).toHaveTextContent('From them: topologies, scenarios.');

    await user.click(within(dialog).getByTestId('workspace-export'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(api.exportWorkspace).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:aegis');

    await user.click(within(dialog).getByTestId('workspace-reset'));
    expect(api.resetWorkspace).toHaveBeenCalled();
    expect(
      await screen.findByText('Back to the files the server started with.'),
    ).toBeInTheDocument();
  });

  it('says so when the server does not accept imports', async () => {
    api.workspace.mockResolvedValue({ ...fixtures.workspace(), importEnabled: false });
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFiles(user);
    expect(await within(dialog).findByTestId('workspace-import-off')).toHaveTextContent(
      'AEGIS_IMPORT=off',
    );
    expect(within(dialog).queryByTestId('workspace-files')).not.toBeInTheDocument();
    // What is in use can still be read and saved.
    expect(within(dialog).getByTestId('workspace-export')).toBeEnabled();
  });
});

describe('integrations and settings', () => {
  it('lists the remaining providers and can disconnect a live adapter', async () => {
    const providers = fixtures.providers();
    api.providers.mockResolvedValue(
      providers.map((provider) =>
        provider.id === 'rinha-backend' ? { ...provider, state: 'connected' } : provider,
      ),
    );
    api.disconnectProvider.mockResolvedValue(providers);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('open-integrations'));
    const dialog = await screen.findByRole('dialog', { name: 'Integrations' });
    const agent = within(dialog).getByTestId('provider-cedar-agent');
    expect(agent).toHaveAttribute('data-state', 'not-configured');
    expect(agent).toHaveTextContent('AEGIS_CEDAR_AGENT_URL');
    expect(within(agent).queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(within(agent).getByRole('link')).toHaveAttribute(
      'href',
      'https://github.com/cleissonbarbosa/cedar-agent',
    );

    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);
    expect(within(dialog).getByTestId('provider-demo-simulation')).toBeInTheDocument();
    const rinha = within(dialog).getByTestId('provider-rinha-backend');
    await user.click(within(rinha).getByRole('button', { name: 'Disconnect' }));
    expect(api.disconnectProvider).toHaveBeenCalledWith('rinha-backend');
  });

  it('persists settings and applies reduced motion', async () => {
    const user = userEvent.setup();
    renderApp();
    await fromMenu(user, 'Settings');
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await user.click(
      within(within(dialog).getByRole('radiogroup', { name: 'Motion' })).getByRole('radio', {
        name: 'Reduced',
      }),
    );
    expect(screen.getByTestId('app')).toHaveAttribute('data-reduced-motion', 'true');
    await user.click(
      within(within(dialog).getByRole('radiogroup', { name: 'Theme' })).getByRole('radio', {
        name: 'Night',
      }),
    );
    expect(useSettings.getState().theme).toBe('night');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('night'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('switches topology', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.selectOptions(await screen.findByTestId('topology-picker'), 'hyperscale-stress');
    expect(api.selectTopology).toHaveBeenCalledWith('hyperscale-stress');
  });

  it('explains the scene in the help dialog', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Help and legend' });
    expect(dialog).toHaveTextContent('A lighthouse above the edge; its lamp sweeps round');
    expect(dialog).toHaveTextContent('no real system is observed, scanned or attacked');
  });
});

describe('what a service is exposed to', () => {
  it('follows its connections, shows the way in from outside and what Cedar guards there', async () => {
    const user = userEvent.setup();
    renderOpen();
    // Requests for an order end at the orders service of the primary region.
    act(() => useUi.getState().selectNode('use-orders'));
    const exposure = within(screen.getByTestId('node-inspector')).getByTestId('node-exposure');
    await user.click(within(exposure).getByText('Exposure'));

    const reaches = within(exposure).getByTestId('exposure-reaches');
    expect(Number(reaches.getAttribute('data-count'))).toBeGreaterThan(3);
    expect(reaches).toHaveTextContent(/It reaches \d+ services, \d+ of them stores of data\./);
    expect(reaches).toHaveTextContent('Orders DB');
    // The way in starts outside the platform and ends here.
    const wayIn = within(exposure).getByTestId('exposure-way-in');
    expect(wayIn).toHaveTextContent(/The shortest way in from outside, 3 connections:/);
    expect(wayIn).toHaveTextContent('Global Edge Router');

    // What is kept in front on the model is this service and what it reaches.
    await user.click(within(exposure).getByTestId('exposure-show'));
    expect(useUi.getState().reach?.[0]).toBe('use-orders');
    expect(useUi.getState().reach).toContain('use-orders-db');

    // Cedar's answers about orders, counted from the engine's own matrix.
    const guarded = await within(exposure).findByTestId('exposure-guarded');
    const cells = fixtures
      .accessMatrix()
      .cells.filter((cell) => cell.resource.startsWith('Order::'));
    const allowed = cells.filter((cell) => cell.decision === 'allow').length;
    expect(guarded).toHaveTextContent(
      `Of the ${cells.length} the catalogue describes, Cedar allows ${allowed}`,
    );
    expect(api.accessMatrix).toHaveBeenCalledWith({ context: {}, disabledPolicies: [] });
    await user.click(within(guarded).getByTestId('exposure-matrix'));
    expect(useUi.getState().openPanel).toBe('matrix');
  });

  it('lets go of what it kept in front when another service is selected', async () => {
    const user = userEvent.setup();
    renderOpen();
    act(() => useUi.getState().selectNode('use-orders'));
    const exposure = within(screen.getByTestId('node-inspector')).getByTestId('node-exposure');
    await user.click(within(exposure).getByText('Exposure'));
    await user.click(within(exposure).getByTestId('exposure-show'));
    expect(useUi.getState().reach).not.toBeNull();
    act(() => useUi.getState().selectNode('use-gateway'));
    await waitFor(() => expect(useUi.getState().reach).toBeNull());
    // A gateway stands for no kind of resource: nothing is said of Cedar.
    expect(screen.queryByTestId('exposure-guarded')).not.toBeInTheDocument();
  });
});

describe('faults placed by hand', () => {
  /** The platform in range, with the one fault the sample was taken with. */
  function withAFault() {
    const quiet = fixtures.snapshot();
    quiet.incident = null;
    quiet.global.activeIncidents = 0;
    quiet.global.health = { healthy: 51, degraded: 0, critical: 0, down: 0 };
    useTelemetry.getState().applySnapshot(quiet);
    return quiet;
  }

  it('are said in the top bar even while everything is in range, and listed', async () => {
    withAFault();
    const user = userEvent.setup();
    renderApp();
    const status = screen.getByTestId('platform-status');
    expect(status).toHaveTextContent('51 services, all normal; 1 fault placed by hand');
    // Nothing is out of range, so the sentence carries no alarm.
    expect(status).toHaveAttribute('data-level', 'healthy');

    await user.click(status);
    const list = screen.getByTestId('faults-in-force');
    expect(within(list).getByText('Search')).toBeInTheDocument();
    expect(within(list).getByText('latency ×3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Lift this fault from Search' }));
    expect(api.clearFaults).toHaveBeenCalledWith({
      type: 'latency',
      nodes: 'node:use-search',
      factor: 3,
    });
    await user.click(screen.getByTestId('faults-lift-all'));
    expect(api.clearFaults).toHaveBeenLastCalledWith(undefined);
  });

  it('are not listed when there are none', () => {
    const quiet = withAFault();
    quiet.faults = [];
    useTelemetry.getState().applySnapshot(quiet);
    useUi.setState({ explorerOpen: true, leftTab: 'incidents' });
    renderApp();
    expect(screen.getByTestId('scenario-console')).toBeInTheDocument();
    expect(screen.queryByTestId('faults-in-force')).not.toBeInTheDocument();
  });

  it('can be tried first, on a timeline of their own, and placed from what was seen', async () => {
    withAFault();
    const user = userEvent.setup();
    renderOpen();
    act(() => useUi.getState().selectNode('use-orders-db'));
    const faults = within(screen.getByTestId('node-inspector')).getByTestId('faults');
    await user.click(within(faults).getByText('Faults'));
    await user.selectOptions(within(faults).getByTestId('fault-try'), 'Unreachable');
    // The engine is asked what it would do; nothing is placed.
    expect(api.tryFault).toHaveBeenCalledWith({
      effect: { type: 'down', nodes: 'node:use-orders-db' },
      rampMs: 1000,
    });
    expect(api.injectFault).not.toHaveBeenCalled();

    const trial = fixtures.trial();
    const result = await within(faults).findByTestId('fault-trial');
    expect(result).toHaveTextContent('Tried, not placed: unreachable');
    expect(result).toHaveTextContent(`${trial.affected.length} services leave normal within 1:00.`);
    expect(within(result).getByTestId('trial-errors')).toHaveTextContent('up to 5.22% from 0%');
    // In the order the engine recorded them: the faulted store first.
    const listed = within(within(result).getByTestId('trial-affected')).getAllByRole('listitem');
    expect(listed).toHaveLength(6);
    expect(listed[0]).toHaveTextContent('Orders DB');
    expect(listed[0]).toHaveTextContent('down');
    await user.click(within(result).getByText(`Show all ${trial.affected.length}`));
    expect(
      within(within(result).getByTestId('trial-affected')).getAllByRole('listitem'),
    ).toHaveLength(trial.affected.length);
    // The model keeps what the trial reached in front.
    expect(useUi.getState().reach).toEqual(trial.affected.map((effect) => effect.nodeId));

    // Placing it is the fault that was tried, on the timeline in use.
    await user.click(within(result).getByTestId('trial-place'));
    expect(api.injectFault).toHaveBeenCalledWith(
      { type: 'down', nodes: 'node:use-orders-db' },
      2000,
    );
    expect(within(faults).queryByTestId('fault-trial')).not.toBeInTheDocument();
    expect(useUi.getState().reach).toBeNull();
  });

  it('put a trial away with the card it was asked on', async () => {
    withAFault();
    const user = userEvent.setup();
    renderOpen();
    act(() => useUi.getState().selectNode('use-orders-db'));
    const faults = within(screen.getByTestId('node-inspector')).getByTestId('faults');
    await user.click(within(faults).getByText('Faults'));
    await user.selectOptions(within(faults).getByTestId('fault-try'), 'Unreachable');
    await within(faults).findByTestId('fault-trial');
    expect(useUi.getState().reach).not.toBeNull();
    // Another service is another question: nothing of the trial stays.
    act(() => useUi.getState().selectNode('use-gateway'));
    await waitFor(() => expect(useUi.getState().reach).toBeNull());
    expect(screen.queryByTestId('fault-trial')).not.toBeInTheDocument();
  });

  it('are placed and lifted from the card of a service', async () => {
    withAFault();
    const user = userEvent.setup();
    renderOpen();
    act(() => useUi.getState().selectNode('use-gateway'));
    const card = within(screen.getByTestId('node-inspector'));
    // Nothing is placed on the gateway: the section waits, folded.
    const faults = card.getByTestId('faults');
    expect(faults).not.toHaveAttribute('open');
    await user.click(within(faults).getByText('Faults'));
    const slow = within(faults).getByRole('button', { name: 'Latency ×4' });
    expect(slow).toHaveAttribute('aria-pressed', 'false');
    await user.click(slow);
    expect(api.injectFault).toHaveBeenCalledWith(
      { type: 'latency', nodes: 'node:use-gateway', factor: 4 },
      2000,
    );
    await user.click(within(faults).getByRole('button', { name: 'Unreachable' }));
    expect(api.injectFault).toHaveBeenLastCalledWith(
      { type: 'down', nodes: 'node:use-gateway' },
      2000,
    );

    // The service the sample slowed down shows it, at the figure it has.
    act(() => useUi.getState().selectNode('use-search'));
    const search = within(screen.getByTestId('node-inspector')).getByTestId('faults');
    expect(search).toHaveAttribute('open');
    const placed = within(search).getByRole('button', { name: 'Latency ×3' });
    expect(placed).toHaveAttribute('aria-pressed', 'true');
    await user.click(placed);
    expect(api.clearFaults).toHaveBeenCalledWith({
      type: 'latency',
      nodes: 'node:use-search',
      factor: 3,
    });
  });

  it('are placed on a connection by its two ends', async () => {
    withAFault();
    const edge = fixtures
      .topology()
      .edges.find((e) => e.source === 'use-gateway' && e.target === 'use-catalog');
    const user = userEvent.setup();
    renderOpen();
    act(() => useUi.getState().select({ kind: 'edge', id: edge!.id }));
    const faults = within(screen.getByTestId('edge-inspector')).getByTestId('faults');
    await user.click(within(faults).getByText('Faults'));
    await user.click(within(faults).getByRole('button', { name: 'Network latency ×4' }));
    expect(api.injectFault).toHaveBeenCalledWith(
      {
        type: 'edgeLatency',
        edges: { between: { from: 'node:use-gateway', to: 'node:use-catalog' } },
        factor: 4,
      },
      2000,
    );
  });

  it('say why when one cannot be placed', async () => {
    withAFault();
    const { ApiError } = await import('@/providers/api');
    api.injectFault.mockRejectedValue(
      new ApiError(409, 'too_many_faults', 'too many faults are in force; lift some first'),
    );
    const user = userEvent.setup();
    renderOpen();
    act(() => useUi.getState().selectNode('use-gateway'));
    const faults = within(screen.getByTestId('node-inspector')).getByTestId('faults');
    await user.click(within(faults).getByText('Faults'));
    await user.click(within(faults).getByRole('button', { name: 'Capacity ×0.5' }));
    expect(await screen.findByText(/The fault could not be placed. too many faults/)).toBeVisible();
  });
});

describe('a Cedar result and the form it answers', () => {
  /** Alice asking to export her tenant's ledger with fresh MFA: what `decision-allow` answers. */
  async function evaluateExport(user: ReturnType<typeof userEvent.setup>) {
    await fromMenu(user, 'Trace a request through Cedar');
    const form = await screen.findByTestId('authz-form');
    await user.selectOptions(within(form).getByTestId('authz-action'), 'Action::"exportLedger"');
    const mfa = within(form).getByRole('radiogroup', { name: 'Fresh MFA assertion' });
    await user.click(within(mfa).getByRole('radio', { name: 'True' }));
    await user.click(screen.getByTestId('authz-evaluate'));
    return { mfa, card: await screen.findByTestId('decision-card') };
  }

  beforeEach(() => api.evaluate.mockResolvedValue(fixtures.decisionAllow()));

  it('records what it was evaluated with', async () => {
    const user = userEvent.setup();
    renderApp();
    const { card } = await evaluateExport(user);
    expect(card).toHaveAttribute('data-stale', 'false');
    const inputs = within(card).getByTestId('decision-inputs');
    expect(within(inputs).getByTestId('decision-context-mfa')).toHaveTextContent('true');
    expect(within(inputs).getByTestId('decision-context-changeWindow')).toHaveTextContent('absent');
    expect(within(inputs).getByTestId('decision-policies-used')).toHaveTextContent('9 of 9 active');
  });

  it('is marked out of date the moment the context changes, and says what changed', async () => {
    const user = userEvent.setup();
    renderApp();
    const { mfa, card } = await evaluateExport(user);
    expect(within(card).getByTestId('decision-result')).toHaveTextContent(/^Allow$/);

    await user.click(within(mfa).getByRole('radio', { name: 'False' }));
    expect(card).toHaveAttribute('data-stale', 'true');
    const stale = within(card).getByTestId('decision-stale');
    expect(stale).toHaveTextContent('Configuration changed. Evaluate again.');
    expect(within(stale).getByTestId('decision-changes')).toHaveTextContent(
      'Fresh MFA assertion was true, now false.',
    );
    // The old answer is still there, as an old answer.
    expect(within(card).getByTestId('decision-result')).toHaveTextContent('Was Allow');
    expect(within(card).getByTestId('decision-context-mfa')).toHaveTextContent('true');
    expect(screen.getByTestId('authz-evaluate')).toHaveTextContent('Evaluate again');
    // Nothing was asked of Cedar in the meantime.
    expect(api.evaluate).toHaveBeenCalledTimes(1);

    // Back to what was evaluated, it is the answer again.
    await user.click(within(mfa).getByRole('radio', { name: 'True' }));
    expect(card).toHaveAttribute('data-stale', 'false');
    expect(within(card).queryByTestId('decision-stale')).not.toBeInTheDocument();
  });

  it('is marked out of date when a policy is switched or the policies are replaced', async () => {
    const user = userEvent.setup();
    renderApp();
    const { card } = await evaluateExport(user);
    const policies = screen.getByTestId('policy-list');
    await user.click(within(policies).getByRole('switch', { name: /Hard tenant isolation/ }));
    expect(within(card).getByTestId('decision-changes')).toHaveTextContent(
      'Policy forbid-cross-tenant switched off.',
    );
    await user.click(within(policies).getByRole('switch', { name: /Hard tenant isolation/ }));
    expect(card).toHaveAttribute('data-stale', 'false');

    // An import replaced the policies while the result was on screen.
    const catalog = fixtures.catalog();
    act(() => {
      queryClient.setQueryData(['authorization', 'catalog'], {
        ...catalog,
        policies: catalog.policies.map((policy, i) =>
          i === 0 ? { ...policy, content: 'permit(principal, action, resource);' } : policy,
        ),
      });
    });
    await waitFor(() => expect(card).toHaveAttribute('data-stale', 'true'));
    expect(within(card).getByTestId('decision-changes')).toHaveTextContent(
      'The policies in use were replaced.',
    );
  });

  it('keeps a result aside and sets the next one beside it', async () => {
    const allow = fixtures.decisionAllow();
    const user = userEvent.setup();
    renderApp();
    const { mfa } = await evaluateExport(user);
    await user.click(screen.getByTestId('decision-keep'));
    expect(screen.getByTestId('comparison-verdict')).toHaveTextContent(/^A is kept\./);
    expect(screen.getByTestId('comparison-b')).toHaveTextContent('not evaluated yet');

    // The same request without MFA: no permit applies, and Cedar denies.
    api.evaluate.mockResolvedValue({
      ...allow,
      id: 'dec-2',
      decision: 'deny',
      determiningPolicies: [],
      request: { ...allow.request, context: { mfa: false } },
    });
    await user.click(within(mfa).getByRole('radio', { name: 'False' }));
    // A result that is out of date is not what B is.
    expect(screen.getByTestId('comparison-b')).toHaveTextContent('not evaluated yet');
    await user.click(screen.getByTestId('authz-evaluate'));

    await waitFor(() =>
      expect(screen.getByTestId('comparison-verdict')).toHaveTextContent(
        'The decision changed from Allow to Deny.',
      ),
    );
    expect(screen.getByTestId('comparison-a')).toHaveTextContent('Allow');
    expect(screen.getByTestId('comparison-b')).toHaveTextContent('Deny');
    // The context is named in the form's words, not by a key cut short.
    const fresh = within(screen.getByTestId('comparison')).getByRole('rowheader', {
      name: 'Fresh MFA assertion',
    });
    expect(fresh.closest('tr')).toHaveTextContent('Fresh MFA assertiontruefalse');
    expect(screen.getByTestId('comparison-differences')).toHaveTextContent(
      'Fresh MFA assertion was true, now false.',
    );
    expect(screen.getByTestId('comparison-attribution')).toHaveTextContent(
      'Only A is decided by finance-export-ledger-mfa.',
    );
    await user.click(screen.getByTestId('comparison-clear'));
    expect(screen.queryByTestId('comparison')).not.toBeInTheDocument();
  });

  it('is one step away on the bar', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('open-tracer'));
    expect(await screen.findByTestId('authz-form')).toBeInTheDocument();
    expect(screen.getByTestId('open-tracer')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('where the cursor is, in words', () => {
  const playback = (over: Partial<ReturnType<typeof fixtures.snapshot>['playback']>) =>
    useTelemetry.getState().setPlayback({ ...fixtures.snapshot().playback, ...over });

  it('is the simulation’s now, or its history, and either may be paused', () => {
    renderApp();
    const mode = () => screen.getByTestId('playback-mode');
    act(() => playback({ mode: 'live', status: 'playing' }));
    expect(mode()).toHaveTextContent(/^Simulation now$/);
    act(() => playback({ mode: 'live', status: 'paused' }));
    expect(mode()).toHaveTextContent(/^Paused$/);
    act(() => playback({ mode: 'replay', status: 'playing', headTimeMs: 130_000 }));
    expect(mode()).toHaveTextContent(/^History$/);
    // In history, where the simulation's now is is said too.
    expect(screen.getByTestId('playback-head')).toHaveTextContent('now is 2:10');
    act(() => playback({ mode: 'replay', status: 'paused' }));
    expect(mode()).toHaveTextContent(/^Paused in history$/);
    // Nothing on the bar calls simulated time "live".
    expect(screen.getByTestId('timeline')).not.toHaveTextContent(/live/i);
  });

  it('goes to the simulation’s now', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /^Go to the simulation.s now$/ }));
    expect(api.control).toHaveBeenCalledWith({ action: 'live' });
  });
});

describe('a first visit', () => {
  beforeEach(() => useGuide.setState({ oriented: false }));

  it('says what this is for and offers three ways in', () => {
    renderApp();
    const card = screen.getByTestId('orientation');
    for (const name of [
      /Understand the platform/,
      /Investigate a failure/,
      /Test an authorization/,
    ]) {
      expect(within(card).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(card).toHaveTextContent('12 kinds of service');
  });

  it.each([
    ['orientation-platform', 'overview'],
    ['orientation-incident', 'scenario-console'],
    ['orientation-authorization', 'authz-form'],
  ])('%s leads there and the card is gone for good', async (path, destination) => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await user.click(screen.getByTestId(path));
    expect(await screen.findByTestId(destination)).toBeInTheDocument();
    expect(screen.queryByTestId('orientation')).not.toBeInTheDocument();
    // Remembered beyond this page.
    expect(localStorage.getItem('aegis.guide.v1')).toContain('"oriented":true');
    unmount();
    renderApp();
    expect(screen.queryByTestId('orientation')).not.toBeInTheDocument();
  });

  it('can be dismissed, and leaves the model alone on the stage', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('orientation-dismiss'));
    expect(screen.queryByTestId('orientation')).not.toBeInTheDocument();
    expect(useUi.getState().explorerOpen).toBe(false);
    expect(useUi.getState().inspectorOpen).toBe(false);
    expect(useGuide.getState().oriented).toBe(true);
  });

  it('is not shown before there is a platform to be oriented in', () => {
    useTelemetry.setState(useTelemetry.getInitialState(), true);
    renderApp();
    expect(screen.queryByTestId('orientation')).not.toBeInTheDocument();
  });
});

describe('an incident read back from its record', () => {
  async function openIncidents(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('tab', { name: /Incidents/ }));
    return screen.findByTestId('active-incident');
  }

  it('times phases from the start of the incident and explains one on request', async () => {
    const user = userEvent.setup();
    renderOpen();
    const active = await openIncidents(user);
    // The incident began at 0:08 on the simulation clock; phases count from there.
    await waitFor(() =>
      expect(within(active).getByTestId('phase-times')).toHaveTextContent(
        'timed from the start of the incident (0:08 on the simulation clock)',
      ),
    );
    expect(within(active).getByTestId('phase-1')).toHaveTextContent('Stuffing burst+0:10');
    // Nothing is explained until it is asked for.
    expect(within(active).queryByTestId('phase-explanation')).not.toBeInTheDocument();
    // A phase the incident has not reached has nothing to explain yet.
    expect(within(active).getByTestId('phase-2')).toBeDisabled();

    await user.click(within(active).getByTestId('phase-1'));
    const explained = await within(active).findByTestId('phase-explanation');
    expect(within(explained).getByTestId('phase-prescribed')).toHaveTextContent(
      /injected traffic “Replayed credentials” at 1320 req\/s on Global Edge Router/,
    );
    const followed = within(explained).getAllByTestId('report-transition');
    expect(followed[0]).toHaveTextContent('Identity Service, US East · Primary');
    expect(within(followed[0]!).getByTestId('report-cause')).toHaveTextContent(
      /^Degraded because the scenario acts on it/,
    );
    expect(followed[0]!.querySelector('[data-basis]')).toHaveAttribute('data-basis', 'prescribed');
    // What a detection rule raised is observed, not prescribed.
    expect(within(explained).getByTestId('phase-observed')).toHaveTextContent(
      'A detection rule raised “Error budget burning”',
    );
    expect(api.incidentReport).toHaveBeenCalledWith('inc-001');
  });

  it('is summarised with its origin, its spread, its peak and the moments to go back to', async () => {
    const user = userEvent.setup();
    renderOpen();
    await openIncidents(user);
    await user.click(await screen.findByTestId('incident-inc-001'));
    const summary = await screen.findByTestId('incident-summary');
    await waitFor(() => expect(summary).toHaveAttribute('data-incident', 'inc-001'));
    expect(within(summary).getByTestId('summary-outcome')).toHaveTextContent(
      'Still running: +0:23 recorded so far.',
    );
    expect(within(summary).getByTestId('summary-origin')).toHaveTextContent(
      'Identity Service, US East · Primary: the scenario names it as the root cause.',
    );
    expect(within(summary).getByTestId('summary-propagation')).toHaveTextContent('API Gateway');
    expect(within(summary).getByTestId('summary-peaks')).toHaveTextContent('7.39%');
    expect(within(summary).getByTestId('summary-decisions')).toHaveTextContent(
      'bob → exportLedger',
    );

    // A moment is a link into the history: a second of lead-in before it.
    await user.click(within(summary).getByTestId('moment-start'));
    expect(api.control).toHaveBeenCalledWith({ action: 'seek', toMs: 7200 });

    await user.click(within(summary).getByTestId('summary-copy'));
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain('Credential Stuffing: incident inc-001');
    expect(copied).toContain('none is measured from a real system');
    expect(await screen.findByText('Summary copied as text.')).toBeInTheDocument();

    await user.click(within(summary).getByRole('button', { name: /Incidents and scenarios/ }));
    expect(screen.getByTestId('scenario-console')).toBeInTheDocument();
  });

  it('is offered as a summary the moment the incident ends', async () => {
    // The connection hook is replaced in these tests; this is the part of it
    // that speaks when the engine says an incident is over.
    const { announceResolved } = await vi.importActual<typeof import('@/app/useAegisConnection')>(
      '@/app/useAegisConnection',
    );
    const user = userEvent.setup();
    renderApp();
    const started = fixtures.events().events.find((event) => event.kind === 'incident-started')!;
    act(() => {
      // Only the end of an incident is announced.
      announceResolved(started);
      announceResolved({
        ...started,
        kind: 'incident-resolved',
        title: 'Credential Stuffing resolved',
      });
    });
    expect(
      screen.getByText('Credential Stuffing resolved. Its summary is ready.'),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('notice-action')).toHaveLength(1);
    await user.click(screen.getByTestId('notice-action'));
    expect(await screen.findByTestId('incident-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('notice-action')).not.toBeInTheDocument();
  });

  it('is read again when a service changes state, not only when the incident does', async () => {
    const { growsReport } = await vi.importActual<typeof import('@/app/useAegisConnection')>(
      '@/app/useAegisConnection',
    );
    const events = fixtures.events().events;
    const started = events.find((event) => event.kind === 'incident-started')!;
    expect(growsReport(started)).toBe(true);
    // A service that has just changed is a line of the report: one read
    // before it could not say why.
    expect(growsReport({ ...started, kind: 'health-transition' })).toBe(true);
    // A decision or an alert adds no transition to explain.
    expect(growsReport({ ...started, kind: 'authz-decision' })).toBe(false);
    expect(growsReport({ ...started, kind: 'alert' })).toBe(false);
  });

  it('says so when the incident is no longer on the timeline', async () => {
    const { ApiError } = await import('@/providers/api');
    api.incidentReport.mockRejectedValue(new ApiError(404, 'not_found', 'unknown incident'));
    const user = userEvent.setup();
    renderOpen();
    await openIncidents(user);
    act(() => useUi.getState().inspectIncident('inc-009'));
    expect(await screen.findByText('No summary')).toBeInTheDocument();
  });

  it('shows an event on both clocks, and why a service changed', async () => {
    const user = userEvent.setup();
    renderOpen();
    await openIncidents(user);
    const transition = fixtures.incidentReport().propagation[0]!;
    act(() => useUi.getState().inspectEvent(transition.seq));
    const detail = await screen.findByTestId('event-detail');
    expect(within(detail).getByTestId('event-clock')).toHaveTextContent('0:21');
    await waitFor(() =>
      expect(within(detail).getByTestId('event-since-incident')).toHaveTextContent(
        '+0:13 (it began at 0:08)',
      ),
    );
    expect(await within(detail).findByTestId('event-why')).toHaveTextContent(
      'Because the scenario acts on it',
    );
  });
});

describe('comparing an intervention', () => {
  it('runs the same change at several figures and lines the runs up by figure', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole('tab', { name: /Incidents/ }));
    await user.click(await screen.findByTestId('scenario-compare-credential-stuffing'));
    const dialog = await screen.findByRole('dialog', { name: 'Compare an intervention' });
    const sweep = within(dialog).getByTestId('sweep-form');
    // It starts from a handful of multipliers; the viewer writes their own.
    const values = within(sweep).getByTestId('sweep-values');
    expect(values).toHaveValue('0.5, 1, 1.5, 2, 3');
    await user.clear(values);
    await user.type(values, '1, 4, nine');
    expect(within(sweep).getByTestId('sweep-run')).toBeDisabled();
    await user.clear(values);
    await user.type(values, '4, 1');

    await user.click(within(sweep).getByTestId('sweep-run'));
    await waitFor(() => expect(api.compareIntervention).toHaveBeenCalledTimes(2));
    // The same intervention, at each figure, in the order it was written.
    expect(
      api.compareIntervention.mock.calls.map(
        ([body]) =>
          (body as { intervention: { effect: { factor: number } } }).intervention.effect.factor,
      ),
    ).toEqual([4, 1]);
    const results = await within(dialog).findByTestId('sweep-results');
    const rows = within(within(results).getByTestId('sweep-table')).getAllByRole('row');
    // A heading, the incident as it is, and a row for each figure, in order.
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('as it is');
    expect(rows[2]).toHaveTextContent('×1');
    expect(rows[3]).toHaveTextContent('×4');
    expect(results).toHaveTextContent('The same change at 2 figures.');
    // Changing the form takes the answer away: it no longer answers it.
    await user.selectOptions(within(dialog).getByTestId('experiment-kind'), 'latency');
    expect(within(dialog).queryByTestId('sweep-results')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('sweep-values')).toHaveValue('0.5, 1, 1.5, 2, 3');
  });

  it('runs a scenario twice, says exactly what changed and lays the runs side by side', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole('tab', { name: /Incidents/ }));
    await user.click(await screen.findByTestId('scenario-compare-credential-stuffing'));
    const dialog = await screen.findByRole('dialog', { name: 'Compare an intervention' });
    const form = within(dialog).getByTestId('experiment-form');
    expect(within(form).getByTestId('experiment-scenario')).toHaveValue('credential-stuffing');
    // It starts from the service the scenario is about, not a crowd of clients.
    expect(within(form).getByTestId('experiment-node')).toHaveValue('use-auth');
    expect(api.compareIntervention).not.toHaveBeenCalled();

    await user.click(within(form).getByTestId('experiment-run'));
    expect(api.compareIntervention).toHaveBeenCalledWith({
      scenarioId: 'credential-stuffing',
      intervention: {
        effect: { type: 'capacity', nodes: 'node:use-auth', factor: 2 },
        atMs: 17_000,
        rampMs: 2000,
      },
    });

    const results = await within(dialog).findByTestId('experiment-results');
    // What the server says it changed, in full.
    expect(within(results).getByTestId('experiment-change')).toHaveTextContent(
      'In run B, capacity ×3 on Identity Service, US East · Primary, placed +0:12 into the incident',
    );
    expect(results).toHaveTextContent('with seed 42');
    expect(results).toHaveTextContent('identical, sample for sample');
    const experiment = fixtures.experiment();
    const affected = within(results).getByTestId('experiment-row-affected');
    expect(affected).toHaveTextContent(String(experiment.baseline.report.impactedNodeIds.length));
    expect(within(results).getByTestId('experiment-row-peak-error')).toHaveTextContent('pts');
    expect(within(results).getAllByRole('img')).toHaveLength(2);

    // Watching a run puts it on the timeline, as the recording it is.
    await user.click(within(results).getByTestId('experiment-watch-b'));
    expect(api.loadSession).toHaveBeenCalledWith(experiment.variant.recording, undefined);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Compare an intervention' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('lets another scenario be chosen after it was opened on one', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole('tab', { name: /Incidents/ }));
    await user.click(await screen.findByTestId('scenario-compare-credential-stuffing'));
    const dialog = await screen.findByRole('dialog', { name: 'Compare an intervention' });
    const scenario = within(dialog).getByTestId('experiment-scenario');
    expect(scenario).toHaveValue('credential-stuffing');

    // The scenario it was opened on does not take the choice back.
    await user.selectOptions(scenario, 'cascading-failure');
    expect(scenario).toHaveValue('cascading-failure');
    // The new scenario brings the service it is about with it.
    expect(within(dialog).getByTestId('experiment-node')).toHaveValue('use-orders-db');
    await user.click(within(dialog).getByTestId('experiment-run'));
    expect(api.compareIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 'cascading-failure' }),
    );
  });

  it('does not show the answer to a question the form no longer asks', async () => {
    // The comparison takes a moment; the form is changed while it runs.
    let answer: (value: ReturnType<typeof fixtures.experiment>) => void = () => {};
    api.compareIntervention.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const user = userEvent.setup();
    renderApp();
    await fromMenu(user, 'Compare an intervention');
    const dialog = await screen.findByRole('dialog', { name: 'Compare an intervention' });
    await user.click(await within(dialog).findByTestId('experiment-run'));
    await user.clear(within(dialog).getByTestId('experiment-value'));
    await user.type(within(dialog).getByTestId('experiment-value'), '5');
    await act(async () => {
      answer(fixtures.experiment());
      await Promise.resolve();
    });
    // What came back answers the earlier form, so it is not put beside this one.
    expect(within(dialog).queryByTestId('experiment-results')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('experiment-run')).toBeEnabled();
  });

  it('says why when the comparison cannot be run', async () => {
    const { ApiError } = await import('@/providers/api');
    api.compareIntervention.mockRejectedValue(
      new ApiError(422, 'invalid_experiment', 'the comparison cannot be run: nothing to touch'),
    );
    const user = userEvent.setup();
    renderApp();
    await fromMenu(user, 'Compare an intervention');
    const dialog = await screen.findByRole('dialog', { name: 'Compare an intervention' });
    await user.click(await within(dialog).findByTestId('experiment-run'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('nothing to touch');
    expect(within(dialog).queryByTestId('experiment-results')).not.toBeInTheDocument();
  });
});

describe('sessions', () => {
  async function openSessions(user: ReturnType<typeof userEvent.setup>) {
    await fromMenu(user, 'Save or share this session');
    return screen.findByRole('dialog', { name: 'Session' });
  }

  it('says what reproduces the timeline, and what a session does not carry', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openSessions(user);
    const contents = await within(dialog).findByTestId('session-contents');
    expect(contents).toHaveTextContent('helios-commerce, as bundled with AEGIS');
    expect(contents).toHaveTextContent('42');
    expect(contents).toHaveTextContent('0:08 starts Credential Stuffing');
    expect(contents).toHaveTextContent('0:30 places a fault by hand (latency)');
    expect(within(dialog).getByTestId('session-omitted')).toHaveTextContent(
      'This session omits 2 authorization decisions evaluated by hand.',
    );
  });

  it('copies a link that carries the session and the view', async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => useUi.getState().selectNode('use-auth'));
    const dialog = await openSessions(user);
    await user.click(await within(dialog).findByTestId('session-copy-link'));
    await screen.findByText('Link to this session copied.');
    const link = new URL(await navigator.clipboard.readText());
    const { sessionFromHash } = await import('@/app/session');
    expect(sessionFromHash(link.hash)).toEqual({
      session: {
        format: 'aegis-session',
        version: 1,
        recording: fixtures.session().recording,
        cursorMs: fixtures.session().cursorMs,
        view: { arrangement: 'regions', select: 'node:use-auth' },
      },
    });
  });

  it('opens a session from a file only once that is asked for', async () => {
    const { composeSession } = await import('@/app/session');
    const session = composeSession(fixtures.session(), { arrangement: 'dependencies' });
    const user = userEvent.setup();
    renderApp();
    const dialog = await openSessions(user);
    await user.upload(
      within(dialog).getByTestId('session-file'),
      new File([JSON.stringify(session)], 'aegis-session.json', { type: 'application/json' }),
    );
    const confirm = await within(dialog).findByTestId('session-open-confirm');
    expect(api.loadSession).not.toHaveBeenCalled();
    await user.click(confirm);
    expect(api.loadSession).toHaveBeenCalledWith(session.recording, session.cursorMs);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Session' })).not.toBeInTheDocument(),
    );
    // The view it was saved with comes back with it.
    expect(useUi.getState().layoutMode).toBe('dependencies');
    expect(await screen.findByText(/Session opened/)).toBeInTheDocument();
  });

  it('refuses a file that is not a session, and says so', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openSessions(user);
    await user.upload(
      within(dialog).getByTestId('session-file'),
      new File(['{"files":[]}'], 'workspace.json', { type: 'application/json' }),
    );
    expect(await within(dialog).findByTestId('session-problem')).toHaveTextContent(
      'This is not a session file',
    );
    expect(within(dialog).queryByTestId('session-open-confirm')).not.toBeInTheDocument();
  });

  it('shows the session a link carries and changes nothing until asked', async () => {
    const { composeSession, sessionLink } = await import('@/app/session');
    const link = sessionLink(composeSession(fixtures.session(), {}), 'http://localhost/');
    window.history.replaceState(null, '', new URL(link as string).hash);
    const user = userEvent.setup();
    renderApp();
    const dialog = await screen.findByRole('dialog', { name: 'Session' });
    expect(within(dialog).getByTestId('session-offered')).toHaveTextContent(
      'Nothing has been changed yet.',
    );
    expect(api.loadSession).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Session' })).not.toBeInTheDocument(),
    );
    // Declined, the link is not offered again on a reload.
    expect(window.location.hash).toBe('');
    expect(api.loadSession).not.toHaveBeenCalled();
  });

  it('keeps the view in the address as it changes', async () => {
    renderApp();
    act(() => useUi.getState().selectNode('use-orders-db'));
    expect(window.location.search).toBe('?arrangement=regions&select=node%3Ause-orders-db');
    act(() => useUi.getState().setLayoutMode('layers'));
    // Back at the overview with nothing selected, the address is plain again.
    expect(window.location.search).toBe('');
  });

  it('opens on the view an address asks for', () => {
    window.history.replaceState(null, '', '/?select=node:use-auth&view=table');
    renderApp();
    expect(useUi.getState().selection).toEqual({ kind: 'node', id: 'use-auth' });
    expect(useUi.getState().viewMode).toBe('table');
  });
});

describe('writing a scenario', () => {
  it('has the engine check the file with everything in use, then runs it', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole('tab', { name: /Incidents/ }));
    await user.click(await screen.findByTestId('open-scenario-editor'));
    const dialog = await screen.findByRole('dialog', { name: 'Write a scenario' });
    const editor = await within(dialog).findByTestId('scenario-editor');

    const name = within(editor).getByTestId('editor-name');
    await user.clear(name);
    await user.type(name, 'Slow ledger');
    // The id follows the name until it is set by hand.
    expect(within(editor).getByTestId('editor-id')).toHaveValue('slow-ledger');

    await within(editor).findByTestId('editor-valid');
    const inUse = fixtures.workspaceExport().files;
    const sent = api.checkWorkspace.mock.lastCall![0] as { path: string; text: string }[];
    // Everything in use goes with it: an import is laid over what the
    // server started with, and must not take the rest away.
    expect(sent.slice(0, inUse.length)).toEqual(inUse);
    expect(sent).toHaveLength(inUse.length + 1);
    const written = sent.at(-1)!;
    expect(written.path).toBe('scenarios/zz-slow-ledger.json');
    expect(JSON.parse(written.text)).toMatchObject({
      id: 'slow-ledger',
      name: 'Slow ledger',
      durationMs: 60_000,
      phases: [
        { name: 'Degradation', atMs: 0, status: 'active', effects: [{ type: 'latency' }] },
        { name: 'Recovery', atMs: 30_000, status: 'recovering', effects: [] },
      ],
    });
    // The file on show is the one that was checked.
    expect(within(editor).getByTestId('editor-file')).toHaveTextContent('"id": "slow-ledger"');
    expect(api.importWorkspace).not.toHaveBeenCalled();

    await user.click(within(editor).getByTestId('editor-run'));
    await waitFor(() => expect(api.startScenario).toHaveBeenCalledWith('slow-ledger'));
    expect(api.importWorkspace).toHaveBeenCalledWith(sent);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Write a scenario' })).not.toBeInTheDocument(),
    );
  });

  it('shows what the engine says is wrong and will not run it', async () => {
    api.checkWorkspace.mockResolvedValue({
      valid: false,
      problem: {
        path: 'scenarios/zz-my-scenario.json',
        message: 'factor must be between 0 and 1000',
      },
    });
    const user = userEvent.setup();
    renderApp();
    act(() => useUi.getState().setPanel('scenario-editor'));
    const editor = await screen.findByTestId('scenario-editor');
    expect(await within(editor).findByTestId('editor-problem')).toHaveTextContent(
      'factor must be between 0 and 1000',
    );
    expect(within(editor).getByTestId('editor-run')).toBeDisabled();
    // The file can be saved all the same.
    expect(within(editor).getByTestId('editor-download')).toBeEnabled();
    await user.click(within(editor).getByTestId('editor-add-phase'));
    expect(within(editor).getByTestId('phase-draft-2')).toBeInTheDocument();
  });

  it('takes a figure typed key by key, decimal point included', async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => useUi.getState().setPanel('scenario-editor'));
    const editor = await screen.findByTestId('scenario-editor');
    const factor = within(editor).getAllByRole('spinbutton', { name: 'Factor' })[0]!;
    await user.clear(factor);
    // "1." is not a number yet: the field must not take the point away.
    await user.type(factor, '1.75');
    expect(factor).toHaveValue(1.75);
    expect(within(editor).getByTestId('editor-file')).toHaveTextContent('"factor": 1.75');
    // The same for a time, which the file keeps in milliseconds.
    const starts = within(editor).getAllByTestId('phase-at')[1]!;
    await user.clear(starts);
    await user.type(starts, '12.5');
    expect(starts).toHaveValue(12.5);
    expect(within(editor).getByTestId('editor-file')).toHaveTextContent('"atMs": 12500');
    // Left empty, a field goes back to the figure the scenario still holds.
    await user.clear(starts);
    await user.tab();
    expect(starts).toHaveValue(12.5);
  });

  it('says what is missing before the engine is asked', async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => useUi.getState().setPanel('scenario-editor'));
    const editor = await screen.findByTestId('scenario-editor');
    await within(editor).findByTestId('editor-valid');
    api.checkWorkspace.mockClear();
    await user.clear(within(editor).getByTestId('editor-name'));
    expect(within(editor).getByTestId('editor-problem')).toHaveTextContent(
      'The scenario needs a name.',
    );
    expect(within(editor).getByTestId('editor-download')).toBeDisabled();
    expect(api.checkWorkspace).not.toHaveBeenCalled();
  });

  it('starts from a copy of a scenario in use, keeping what it cannot edit', async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => useUi.getState().setPanel('scenario-editor'));
    const editor = await screen.findByTestId('scenario-editor');
    const from = within(editor).getByTestId('editor-start-from') as HTMLSelectElement;
    await waitFor(() => expect(from.options.length).toBeGreaterThan(1));
    await user.selectOptions(from, from.options[1]!.value);
    // The tiny workspace of the samples has one scenario: a slow door.
    expect(within(editor).getByTestId('editor-id')).toHaveValue('slow-door-copy');
    expect(within(editor).getByTestId('editor-name')).toHaveValue('Slow door (copy)');
    expect(within(editor).getAllByTestId('effect-row')).toHaveLength(1);
  });
});

describe('guided challenges', () => {
  it('say how many are solved, and offer first the one a link names', async () => {
    useGuide.setState({ completed: ['flood-stopped'] });
    window.history.replaceState(null, '', '/?challenge=region-dark');
    renderApp();
    // The link opens the guide; nothing has been started by it.
    const guide = await screen.findByTestId('guide');
    expect(api.reset).not.toHaveBeenCalled();
    expect(api.startScenario).not.toHaveBeenCalled();
    expect(within(guide).getByTestId('guide-progress')).toHaveTextContent(
      `1 of ${CHALLENGES.length} solved`,
    );
    const items = within(guide).getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('data-invited', 'true');
    expect(items[0]).toHaveTextContent('The one you were sent');
    expect(items[0]).toHaveTextContent('Find the region that went dark');

    const user = userEvent.setup();
    await user.click(within(guide).getByTestId('guide-forget'));
    expect(within(guide).getByTestId('guide-progress')).toHaveTextContent(
      `0 of ${CHALLENGES.length} solved`,
    );
    expect(useGuide.getState().completed).toEqual([]);
  });

  it('ignore a link that names no challenge', () => {
    window.history.replaceState(null, '', '/?challenge=no-such-challenge');
    renderApp();
    expect(screen.queryByTestId('guide')).not.toBeInTheDocument();
  });

  /** The guide is a card that stays; its menu entry says whether it is there. */
  async function openGuide(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Guided challenges' }));
  }

  it('sets an incident going and checks the answer against its report', async () => {
    // The report on record is of the incident the challenge asks about.
    const incidents = fixtures.incidents();
    api.incidents.mockResolvedValue({
      ...incidents,
      incidents: incidents.incidents.map((incident) => ({
        ...incident,
        scenarioId: 'cascading-failure',
      })),
    });
    const user = userEvent.setup();
    renderApp();
    await openGuide(user);
    const guide = await screen.findByTestId('guide');
    expect(within(guide).getAllByRole('heading', { level: 4 })).toHaveLength(CHALLENGES.length);
    await user.click(within(guide).getByTestId('guide-start-cascade-origin'));
    await waitFor(() => expect(api.startScenario).toHaveBeenCalledWith('cascading-failure'));
    expect(api.reset).toHaveBeenCalledWith('simulation');
    // The answer is a service: the model goes to where services are.
    expect(useUi.getState().layoutMode).toBe('regions');
    await within(guide).findByTestId('guide-challenge');
    expect(within(guide).getByTestId('guide-waiting')).toHaveTextContent('Select a service');

    // A service that followed is told why it followed.
    act(() => useUi.getState().selectNode('use-gateway'));
    await user.click(within(guide).getByTestId('guide-answer'));
    const wrong = await within(guide).findByTestId('guide-feedback');
    expect(wrong).toHaveAttribute('data-correct', 'false');
    expect(wrong).toHaveTextContent('it is a consequence');
    expect(useGuide.getState().completed).toEqual([]);

    act(() => useUi.getState().selectNode('use-auth'));
    await user.click(within(guide).getByTestId('guide-answer'));
    await waitFor(() =>
      expect(within(guide).getByTestId('guide-feedback')).toHaveAttribute('data-correct', 'true'),
    );
    expect(within(guide).getByTestId('guide-feedback')).toHaveTextContent(
      'Yes: it begins at Identity Service, US East · Primary.',
    );
    expect(useGuide.getState().completed).toEqual(['cascade-origin']);
    expect(localStorage.getItem('aegis.guide.v1')).toContain('cascade-origin');

    await user.click(within(guide).getByTestId('guide-close'));
    expect(screen.queryByTestId('guide')).not.toBeInTheDocument();
  });

  it('hands the tracer a request and is solved by what Cedar then answers', async () => {
    const allow = fixtures.decisionAllow();
    const user = userEvent.setup();
    renderApp();
    await openGuide(user);
    const guide = await screen.findByTestId('guide');
    await user.click(within(guide).getByTestId('guide-start-export-denied'));
    const form = await screen.findByTestId('authz-form');
    // Alice, the export, the Acme ledger, and nothing in the context.
    expect(within(form).getByTestId('authz-principal')).toHaveValue('User::"alice"');
    expect(within(form).getByTestId('authz-action')).toHaveValue('Action::"exportLedger"');
    expect(within(guide).getByTestId('guide-waiting')).toHaveTextContent('Evaluate the request');

    api.evaluate.mockResolvedValue({
      ...allow,
      decision: 'deny',
      determiningPolicies: [],
      request: { ...allow.request, context: {} },
    });
    await user.click(screen.getByTestId('authz-evaluate'));
    await user.click(await within(guide).findByTestId('guide-answer'));
    expect(await within(guide).findByTestId('guide-feedback')).toHaveTextContent(
      /Still denied\..*no policy decided this/,
    );

    api.evaluate.mockResolvedValue(allow);
    await user.click(
      within(within(form).getByRole('radiogroup', { name: 'Fresh MFA assertion' })).getByRole(
        'radio',
        { name: 'True' },
      ),
    );
    await user.click(screen.getByTestId('authz-evaluate'));
    await waitFor(() => expect(useUi.getState().lastDecision?.decision).toBe('allow'));
    await user.click(within(guide).getByTestId('guide-answer'));
    await waitFor(() =>
      expect(within(guide).getByTestId('guide-feedback')).toHaveAttribute('data-correct', 'true'),
    );
    expect(within(guide).getByTestId('guide-feedback')).toHaveTextContent(
      'finance-export-ledger-mfa',
    );
  });

  it('does not offer a challenge the platform cannot run', async () => {
    const scenarios = fixtures.scenarios();
    api.scenarios.mockResolvedValue({
      ...scenarios,
      scenarios: scenarios.scenarios.filter((scenario) => scenario.id !== 'ddos-surge'),
    });
    const user = userEvent.setup();
    renderApp();
    await openGuide(user);
    const start = await screen.findByTestId('guide-start-flood-stopped');
    await waitFor(() => expect(start).toBeDisabled());
    expect(screen.getByTestId('guide-start-cascade-origin')).toBeEnabled();
  });
});

describe('what Cedar would decide differently', () => {
  it('compares staged files with the ones in use, on request, and applies nothing', async () => {
    const user = userEvent.setup();
    renderApp();
    await fromMenu(user, 'Import or export files');
    const dialog = await screen.findByRole('dialog', { name: 'Platform files' });
    const policies = new File(['[]'], 'policies.json', { type: 'application/json' });
    await user.upload(within(dialog).getByTestId('workspace-files'), policies);
    const diff = await within(dialog).findByTestId('policy-diff');
    // It evaluates every request twice: asked for, not done unasked.
    expect(api.diffWorkspace).not.toHaveBeenCalled();
    await user.click(within(diff).getByTestId('policy-diff-run'));
    expect(api.diffWorkspace).toHaveBeenCalledWith([{ path: 'policies.json', text: '[]' }]);

    const result = await within(diff).findByTestId('policy-diff-result');
    expect(result).toHaveAttribute('data-changed', 'true');
    expect(within(result).getByTestId('diff-policies')).toHaveTextContent(
      'Removed: finance-view-ledger',
    );
    expect(within(result).getByTestId('diff-at-rest')).toHaveTextContent('15.0%');
    expect(within(result).getByTestId('diff-at-rest')).toHaveTextContent('7.00%');
    expect(within(result).getByTestId('diff-requests')).toHaveTextContent('alice-view-ledger');
    expect(within(result).getByTestId('diff-flows')).toHaveTextContent(
      'would stop at the authorizer',
    );
    expect(within(result).getByTestId('diff-matrix')).toHaveTextContent(
      'Of 756 requests (6 principals, 6 actions, 7 resources, 9 contexts), 9 go from allow to deny and 0 from deny to allow.',
    );
    expect(within(result).getByTestId('diff-matrix-changes')).toHaveTextContent(
      'alice → viewLedger on acme-ledger-2026, in every context; now decided by finance-view-ledger',
    );
    expect(api.importWorkspace).not.toHaveBeenCalled();
  });
});

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
  queryClient.clear();
  useTelemetry.setState(useTelemetry.getInitialState(), true);
  useUi.setState(useUi.getInitialState(), true);
  useNotices.setState({ notices: [] });
  useSettings.getState().reset();
  const control = { playback: fixtures.snapshot().playback };
  for (const mock of Object.values(api)) mock.mockReset();
  api.topologies.mockResolvedValue(fixtures.topologies());
  api.scenarios.mockResolvedValue(fixtures.scenarios());
  api.incidents.mockResolvedValue(fixtures.incidents());
  api.recordings.mockResolvedValue(fixtures.recordings());
  api.providers.mockResolvedValue(fixtures.providers());
  api.authorizationCatalog.mockResolvedValue(fixtures.catalog());
  api.authorizationDecisions.mockResolvedValue([]);
  api.evaluate.mockResolvedValue(fixtures.decisionDeny());
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
    expect(screen.getByTestId('connection-health')).toHaveTextContent('Stream live');
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
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('explore-incident'));
    expect(await screen.findByTestId('scenario-console')).toBeInTheDocument();
    await user.click(screen.getByTestId('explore-incident'));
    await waitFor(() => expect(screen.queryByTestId('scenario-console')).not.toBeInTheDocument());
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
      screen.getByRole('button', { name: 'Inspect connection to Identity Service' }),
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
    const cards = await within(console_).findAllByTestId(/^scenario-(?!start|console)/);
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
    expect(within(impacted).getByRole('button', { name: 'Identity Service' })).toBeInTheDocument();

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
    expect(screen.getByTestId('playback-mode')).toHaveTextContent('Replay');
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
      'README.md (not a .json, .cedar or .cedarschema file)',
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
  it('lists providers with honest states and imports a fixture on request', async () => {
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

    const scanner = within(dialog).getByTestId('provider-network-scanner');
    expect(scanner).toHaveTextContent('Recording');
    api.disconnectProvider.mockResolvedValue(fixtures.providers());
    await user.click(within(scanner).getByRole('button', { name: 'Forget import' }));
    expect(api.disconnectProvider).toHaveBeenCalledWith('network-scanner');
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

/**
 * Interface tests. The application runs against real server output (the
 * contract samples) with the network layer replaced, in jsdom — which has no
 * WebGPU or WebGL 2, so these also exercise the non-3D fallback.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  selectTopology: vi.fn(),
  loadRecording: vi.fn(),
  authorizationCatalog: vi.fn(),
  authorizationDecisions: vi.fn(),
  evaluate: vi.fn(),
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
    expect(screen.getAllByText('Synthetic').length).toBeGreaterThan(0);
    expect(await screen.findByText('Demo mode')).toBeInTheDocument();
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
    renderApp();
    const g = fixtures.snapshot().global;
    expect(screen.getByTestId('hud-incidents')).toHaveTextContent(String(g.activeIncidents));
    expect(screen.getByTestId('hud-errors')).toHaveTextContent(
      `${(g.errorRate * 100).toFixed(2)}%`,
    );
    expect(screen.getByTestId('hud-health')).toHaveTextContent(
      new RegExp(`Healthy: ${g.health.healthy}.*Critical: ${g.health.critical}`),
    );
  });
});

describe('explorer', () => {
  it('lists every service by region and filters them', async () => {
    const user = userEvent.setup();
    renderApp();
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
    await user.click(screen.getByRole('button', { name: 'Critical', pressed: false }));
    const critical = screen.getAllByTestId(/^service-/);
    expect(critical.length).toBeGreaterThan(0);
    for (const item of critical) expect(item).toHaveAttribute('data-health', 'critical');
  });

  it('explains an empty result', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByTestId('explorer-count')).toHaveTextContent('0 of 51 services');
    expect(screen.getAllByText('No services match').length).toBeGreaterThan(0);
  });
});

describe('inspector', () => {
  it('starts with the platform overview', () => {
    renderApp();
    const overview = screen.getByTestId('overview');
    expect(overview).toHaveTextContent('Helios Commerce');
    expect(within(overview).getByText('Recent alerts')).toBeInTheDocument();
  });

  it('shows metrics, connections and history for the selected service', async () => {
    const user = userEvent.setup();
    renderApp();
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

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByTestId('overview')).toBeInTheDocument();
  });

  it('inspects a connection', async () => {
    const user = userEvent.setup();
    renderApp();
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
    renderApp();
    const service = screen.getByTestId('service-use-orders-db');
    service.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('inspector-title')).toHaveTextContent('Orders DB');
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('overview')).toBeInTheDocument();
  });
});

describe('incident console', () => {
  async function openConsole(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('tab', { name: /Incidents/ }));
    return screen.findByTestId('scenario-console');
  }

  it('lists the five scenarios and starts one', async () => {
    const user = userEvent.setup();
    renderApp();
    const console_ = await openConsole(user);
    const cards = await within(console_).findAllByTestId(/^scenario-(?!start|console)/);
    expect(cards).toHaveLength(5);
    await user.click(screen.getByTestId('scenario-start-ddos-surge'));
    expect(api.startScenario).toHaveBeenCalledWith('ddos-surge');
  });

  it('shows the active incident, its phase and what it impacted', async () => {
    const user = userEvent.setup();
    renderApp();
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
    renderApp();
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
    renderApp();
    await openConsole(user);
    await user.click(screen.getByTestId('reset-simulation'));
    expect(api.reset).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('reset-confirm'));
    expect(api.reset).toHaveBeenCalledWith('simulation');
    expect(await screen.findByText('Simulation reset to a clean baseline.')).toBeInTheDocument();
  });

  it('inspects an event and jumps to its moment', async () => {
    const user = userEvent.setup();
    renderApp();
    await openConsole(user);
    const alert = (await screen.findAllByTestId('event-row')).find(
      (row) => row.dataset.kind === 'alert',
    )!;
    await user.click(alert);
    const detail = screen.getByTestId('event-detail');
    expect(detail).toHaveTextContent('alert');
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
    renderApp();
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
    renderApp();
    await user.keyboard(' ');
    expect(api.control).toHaveBeenCalledWith({ action: 'pause' });
    api.control.mockClear();
    await user.type(screen.getByRole('searchbox'), 'a b');
    expect(api.control).not.toHaveBeenCalled();
  });

  it('loads a recorded incident', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.selectOptions(await screen.findByTestId('recording-picker'), 'black-friday-flood');
    expect(api.loadRecording).toHaveBeenCalledWith('black-friday-flood');
  });
});

describe('authorization explorer', () => {
  it('evaluates a request with Cedar and shows the engine’s answer', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('tab', { name: 'Authorization' }));
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
    renderApp();
    await user.click(screen.getByRole('tab', { name: 'Authorization' }));
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
    renderApp();
    await user.click(screen.getByRole('tab', { name: 'Authorization' }));
    await user.click(await screen.findByTestId('authz-evaluate'));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid principal');
    expect(screen.queryByTestId('decision-card')).not.toBeInTheDocument();
  });

  it('only offers cedar-agent once one is connected', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('tab', { name: 'Authorization' }));
    const engines = await screen.findByRole('radiogroup', { name: 'Policy engine' });
    expect(within(engines).getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByText(/Connect a local cedar-agent/)).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await user.click(
      within(within(dialog).getByRole('radiogroup', { name: 'Motion' })).getByRole('radio', {
        name: 'Reduced',
      }),
    );
    expect(screen.getByTestId('app')).toHaveAttribute('data-reduced-motion', 'true');
    await user.click(within(dialog).getByRole('switch', { name: /Bloom/ }));
    expect(useSettings.getState().bloom).toBe(false);
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
    expect(dialog).toHaveTextContent('A stylised cedar tree');
    expect(dialog).toHaveTextContent('no real system is observed, scanned or attacked');
  });
});

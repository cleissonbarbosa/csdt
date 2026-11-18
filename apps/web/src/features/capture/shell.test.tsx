/**
 * The application with an incident capture open: what takes the
 * simulation's place, what the keys do, how the browser's Back and "Back to
 * the simulation" leave it, and that nothing done there reaches the
 * simulation. The application runs as in `App.test.tsx`: the network layer
 * replaced, the stores seeded, and no 3D in jsdom, so the capture is shown
 * as its table.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followCaptureAddress } from '@/app/captureUrl';
import { queryClient } from '@/app/queryClient';
import { bundledCapture } from '@/features/capture/bundled';
import { sceneHandle } from '@/graphics/handle';
import type { SceneController } from '@/graphics/SceneController';
import { useCapture } from '@/stores/capture';
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
vi.mock('@/app/useAegisConnection', async (original) => ({
  ...(await original<typeof import('@/app/useAegisConnection')>()),
  useAegisConnection: () => undefined,
}));

const { App } = await import('@/App');
const { announceResolved } = await import('@/app/useAegisConnection');

const GOOGLE = 'google-cloud-2025-06-12';
const BOUTIQUE = 'online-boutique-rcaeval';

/** The camera, as the shortcuts command it; there is no scene in jsdom. */
const camera = {
  focusNode: vi.fn(),
  frameAll: vi.fn(),
  resetView: vi.fn(),
  setViewInsets: vi.fn(),
};

let stopFollowing: (() => void) | null = null;

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

async function fromMenu(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(screen.getByRole('menuitem', { name }));
}

/** Opens a bundled capture the way a viewer does: the menu, then the dialog. */
async function openFromMenu(user: ReturnType<typeof userEvent.setup>, id: string) {
  await fromMenu(user, 'Open an incident capture');
  const dialog = await screen.findByRole('dialog', { name: 'Open an incident capture' });
  await user.click(within(dialog).getByTestId(`capture-open-${id}`));
  await screen.findByTestId('capture-status');
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Open an incident capture' })).toBeNull(),
  );
}

/** The api functions called since the last clear, by name. */
function calledApi(): string[] {
  return Object.entries(api)
    .filter(([, mock]) => mock.mock.calls.length > 0)
    .map(([name]) => name);
}

beforeEach(() => {
  window.innerWidth = 1600;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  queryClient.clear();
  useGuide.setState({ ...useGuide.getInitialState(), oriented: true }, true);
  useTelemetry.setState(useTelemetry.getInitialState(), true);
  useUi.setState(useUi.getInitialState(), true);
  useCapture.getState().close();
  useNotices.setState({ notices: [] });
  useSettings.getState().reset();
  for (const mock of Object.values(api)) mock.mockReset();
  for (const mock of Object.values(camera)) mock.mockReset();
  sceneHandle.current = camera as unknown as SceneController;
  const control = { playback: fixtures.snapshot().playback };
  api.topologies.mockResolvedValue(fixtures.topologies());
  api.scenarios.mockResolvedValue(fixtures.scenarios());
  api.incidents.mockResolvedValue(fixtures.incidents());
  api.incidentReport.mockResolvedValue(fixtures.incidentReport());
  api.recordings.mockResolvedValue(fixtures.recordings());
  api.providers.mockResolvedValue(fixtures.providers());
  api.authorizationCatalog.mockResolvedValue(fixtures.catalog());
  api.authorizationDecisions.mockResolvedValue([]);
  api.workspace.mockResolvedValue(fixtures.workspace());
  api.control.mockResolvedValue(control);
  seed();
  // As the page does before it is drawn (`main.tsx`).
  stopFollowing = followCaptureAddress();
});

afterEach(() => {
  stopFollowing?.();
  stopFollowing = null;
  useCapture.getState().close();
  sceneHandle.current = null;
});

describe('an incident capture in the application', () => {
  it('takes the place of the simulation on the same page, and gives it back', async () => {
    useUi.setState({ explorerOpen: true, inspectorOpen: true });
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByTestId('explorer')).toBeInTheDocument();
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
    expect(screen.getByTestId('platform-status')).toBeInTheDocument();

    await openFromMenu(user, GOOGLE);

    // One timeline at the foot, and it is the capture's.
    const timelines = screen.getAllByTestId('timeline');
    expect(timelines).toHaveLength(1);
    expect(timelines[0]).toHaveAttribute('data-mode', 'capture');
    expect(screen.getByTestId('capture-time')).toHaveTextContent('UTC');
    // The bar is the capture's: its sentence, its chip, its way back.
    expect(screen.getByTestId('capture-chip')).toHaveAttribute('data-mode', 'capture');
    expect(screen.getByTestId('capture-chip')).toHaveAccessibleName(
      /^From the provider's report, not simulated: Google Cloud outage/,
    );
    expect(screen.getByTestId('capture-status')).toHaveTextContent(/^At 17:45 UTC: /);
    expect(screen.getByTestId('capture-back')).toHaveAccessibleName('Back to the simulation');
    expect(screen.getByTestId('capture-picker')).toHaveValue(GOOGLE);
    for (const id of [
      'platform-status',
      'mode-switch',
      'open-integrations',
      'connection-health',
      'open-command',
      'open-tracer',
      'explore-incident',
      'topology-picker',
      'topology-table',
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.getByTestId('capture-table')).toBeInTheDocument();
    // The simulation's panels leave; they were not closed, and come back.
    await waitFor(() => {
      expect(screen.queryByTestId('explorer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tab-explorer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('inspector')).not.toBeInTheDocument();
    });
    expect(useUi.getState()).toMatchObject({ explorerOpen: true, inspectorOpen: true });
    // A capture needs no other arrangement and no guide.
    expect(screen.queryByTestId('orientation')).not.toBeInTheDocument();
    expect(window.location.search).toBe(`?capture=${GOOGLE}`);

    await user.click(screen.getByTestId('capture-back'));
    expect(useCapture.getState().capture).toBeNull();
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(await screen.findByTestId('platform-status')).toBeInTheDocument();
    expect(screen.getByTestId('topology-table')).toBeInTheDocument();
    expect(await screen.findByTestId('explorer')).toBeInTheDocument();
    expect(await screen.findByTestId('inspector')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('capture-chip')).not.toBeInTheDocument();
    for (const timeline of screen.queryAllByTestId('timeline')) {
      expect(timeline).not.toHaveAttribute('data-mode', 'capture');
    }
  });

  it('acts on nothing of the simulation, whatever is done in it', async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromMenu(user, GOOGLE);
    const before = useTelemetry.getState();
    const ui = useUi.getState();
    for (const mock of Object.values(api)) mock.mockClear();

    // Space is the capture's clock, not the simulation's.
    await user.keyboard(' ');
    expect(useCapture.getState().playing).toBe(true);
    await user.keyboard(' ');
    expect(useCapture.getState().playing).toBe(false);
    await user.click(screen.getByTestId('capture-toggle'));
    await user.click(screen.getByTestId('capture-toggle'));
    await user.click(screen.getByTestId('capture-speed-3600'));
    expect(useCapture.getState().speed).toBe(3600);

    // A service from its table, the list, the events, the details.
    await user.click(screen.getByTestId('capture-table-service-iam'));
    expect(await screen.findByTestId('capture-card')).toHaveAttribute('data-id', 'iam');
    await user.click(screen.getByTestId('capture-list'));
    await user.click(await screen.findByTestId('capture-tab-events'));
    await user.click(screen.getAllByTestId('capture-event')[1]!);
    await user.click(screen.getByTestId('capture-chip'));
    expect(await screen.findByTestId('capture-details')).toBeInTheDocument();
    await user.click(screen.getByTestId('capture-status'));
    await user.keyboard('/');
    await user.keyboard('t');
    expect(await screen.findByTestId('capture-table')).toBeInTheDocument();
    await user.keyboard('{Escape}{Escape}{Escape}');

    expect(calledApi()).toEqual([]);
    const after = useTelemetry.getState();
    expect(after.topology).toBe(before.topology);
    expect(after.snapshot).toBe(before.snapshot);
    expect(after.events).toBe(before.events);
    expect(after.playback).toBe(before.playback);
    // Nor is the simulation's selection, arrangement or panel touched.
    expect(useUi.getState().selection).toBe(ui.selection);
    expect(useUi.getState().layoutMode).toBe(ui.layoutMode);
  });

  it('answers the keys in its own way', async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromMenu(user, BOUTIQUE);

    // L has nothing to cycle; Ctrl K opens nothing.
    const layout = useUi.getState().layoutMode;
    await user.keyboard('l');
    expect(useUi.getState().layoutMode).toBe(layout);
    await user.keyboard('{Control>}k{/Control}');
    expect(useUi.getState().commandOpen).toBe(false);
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();

    // F frames everything with nothing selected, and moves in on a service.
    await user.keyboard('f');
    expect(camera.frameAll).toHaveBeenCalledTimes(1);
    expect(camera.focusNode).not.toHaveBeenCalled();

    // / opens the capture's services, not the simulation's explorer.
    await user.keyboard('/');
    const list = await screen.findByTestId('capture-list-sheet');
    expect(within(list).getByTestId('capture-tab-services')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(useUi.getState().explorerOpen).toBe(false);
    await user.click(within(list).getByTestId('capture-service-checkoutservice'));
    expect(await screen.findByTestId('capture-card')).toHaveAttribute('data-id', 'checkoutservice');
    await user.keyboard('f');
    expect(camera.focusNode).toHaveBeenCalledWith('checkoutservice');

    // Escape lets go of the selection, then puts the panels away.
    await user.keyboard('{Escape}');
    expect(useCapture.getState().selection).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('capture-card')).not.toBeInTheDocument());
    expect(useCapture.getState().listOpen).toBe(true);
    await user.keyboard('{Escape}');
    expect(useCapture.getState().listOpen).toBe(false);
    await waitFor(() => expect(screen.queryByTestId('capture-list-sheet')).not.toBeInTheDocument());
    // The details card goes the same way.
    await user.click(screen.getByTestId('capture-chip'));
    expect(screen.getByTestId('capture-chip')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(useCapture.getState().detailsOpen).toBe(false);
    // Nothing is left to put away; the capture stays open.
    await user.keyboard('{Escape}');
    expect(useCapture.getState().capture).not.toBeNull();

    // Space plays the capture (on a button it is the button's), and the
    // help lists the capture's keys.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard(' ');
    expect(useCapture.getState().playing).toBe(true);
    await user.keyboard(' ');
    expect(api.control).not.toHaveBeenCalled();
    await user.keyboard('?');
    const help = await screen.findByRole('dialog', { name: 'Help and legend' });
    expect(within(help).getByTestId('help-keys')).toHaveTextContent('Play or pause the capture');
    expect(within(help).getByTestId('help-keys')).not.toHaveTextContent('Next arrangement');
  });

  it('is left by the browser, as by its own button, and found again going forward', async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromMenu(user, BOUTIQUE);
    expect(window.history.state).toMatchObject({ aegisCapture: BOUTIQUE });

    act(() => window.history.back());
    await waitFor(() => expect(useCapture.getState().capture).toBeNull());
    expect(window.location.search).toBe('');
    expect(await screen.findByTestId('platform-status')).toBeInTheDocument();

    act(() => window.history.forward());
    expect(await screen.findByTestId('capture-status')).toBeInTheDocument();
    expect(useCapture.getState().id).toBe(BOUTIQUE);
    expect(window.location.search).toBe(`?capture=${BOUTIQUE}`);

    // Another capture from the bar's picker takes the same entry, so one
    // step back is still the simulation.
    await user.selectOptions(screen.getByTestId('capture-picker'), GOOGLE);
    await waitFor(() => expect(useCapture.getState().id).toBe(GOOGLE));
    expect(window.location.search).toBe(`?capture=${GOOGLE}`);
    await user.click(screen.getByTestId('capture-back'));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(useCapture.getState().capture).toBeNull();
    expect(await screen.findByTestId('platform-status')).toBeInTheDocument();
  });

  it('opened by a link, leaves the address without it', async () => {
    stopFollowing?.();
    window.history.replaceState(null, '', `/?capture=${GOOGLE}&view=table`);
    stopFollowing = followCaptureAddress();
    await waitFor(() => expect(useCapture.getState().capture).not.toBeNull());
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByTestId('capture-status')).toBeInTheDocument();

    await fromMenu(user, 'Back to the simulation');
    expect(useCapture.getState().capture).toBeNull();
    expect(window.location.search).toBe('?view=table');
    expect(await screen.findByTestId('platform-status')).toBeInTheDocument();
  });

  it('holds what the simulation announces until it is left', async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromMenu(user, GOOGLE);
    const started = fixtures.events().events.find((event) => event.kind === 'incident-started')!;
    act(() =>
      announceResolved({
        ...started,
        kind: 'incident-resolved',
        title: 'Credential Stuffing resolved',
      }),
    );
    expect(screen.queryByText(/Its summary is ready/)).not.toBeInTheDocument();
    expect(useNotices.getState().notices).toEqual([]);

    await user.click(screen.getByTestId('capture-back'));
    expect(
      await screen.findByText('Credential Stuffing resolved. Its summary is ready.'),
    ).toBeInTheDocument();
  });

  it('keeps the keyboard on the page as it changes from one to the other', async () => {
    const user = userEvent.setup();
    renderApp();
    const press = async (element: HTMLElement) => {
      act(() => element.focus());
      await user.keyboard('{Enter}');
    };
    const openByKeyboard = async (item: string, id: string) => {
      await press(screen.getByRole('button', { name: 'More' }));
      await press(await screen.findByRole('menuitem', { name: item }));
      const dialog = await screen.findByRole('dialog', { name: 'Open an incident capture' });
      await press(within(dialog).getByTestId(`capture-open-${id}`));
      await waitFor(() => expect(useCapture.getState().id).toBe(id));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Open an incident capture' })).toBeNull(),
      );
    };
    const main = document.getElementById('main');

    // The menu and the dialog go, and the bar with them: the focus is on
    // the capture's clock, not at the top of the document.
    await openByKeyboard('Open an incident capture', GOOGLE);
    await waitFor(() => expect(screen.getByTestId('capture-toggle')).toHaveFocus());
    // Another capture in its place, from the capture's own menu: the same.
    await openByKeyboard('Open another capture', BOUTIQUE);
    await waitFor(() => expect(screen.getByTestId('capture-toggle')).toHaveFocus());

    // "Back to the simulation" goes with the capture's bar; the focus goes
    // to the stage, where the simulation's keys work.
    await press(screen.getByTestId('capture-back'));
    await screen.findByTestId('platform-status');
    await waitFor(() => expect(window.location.search).toBe(''));
    await waitFor(() => expect(main).toHaveFocus());
    // From the capture's menu, the same.
    await openByKeyboard('Open an incident capture', GOOGLE);
    await waitFor(() => expect(screen.getByTestId('capture-toggle')).toHaveFocus());
    await press(screen.getByRole('button', { name: 'More' }));
    await press(await screen.findByRole('menuitem', { name: 'Back to the simulation' }));
    await screen.findByTestId('platform-status');
    await waitFor(() => expect(window.location.search).toBe(''));
    await waitFor(() => expect(main).toHaveFocus());

    // Focus that was not lost stays where the viewer put it.
    await openFromMenu(user, BOUTIQUE);
    const skip = screen.getByRole('link', { name: 'Skip to the topology' });
    act(() => skip.focus());
    act(() => window.history.back());
    await waitFor(() => expect(useCapture.getState().capture).toBeNull());
    await screen.findByTestId('platform-status');
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(skip).toHaveFocus();
  });

  it('arrived at by a link, puts no mark of the keyboard anywhere', async () => {
    stopFollowing?.();
    window.history.replaceState(null, '', `/?capture=${GOOGLE}`);
    stopFollowing = followCaptureAddress();
    renderApp();
    // The capture arrives after the page is first drawn, as from the network.
    expect(await screen.findByTestId('capture-status')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByTestId('capture-toggle')).not.toHaveFocus();
  });

  it('gives the keyboard back to what opened a sheet once the sheet is put away', async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromMenu(user, BOUTIQUE);
    const press = async (element: HTMLElement, key = '{Enter}') => {
      act(() => element.focus());
      await user.keyboard(key);
    };

    // The list, put away by its own button: back to "Services and events".
    await user.click(screen.getByTestId('capture-list'));
    await press(await screen.findByTestId('capture-list-close'));
    await waitFor(() => expect(screen.getByTestId('capture-list')).toHaveFocus());

    // A card, put away by its button with the list open: back to its row.
    await user.click(screen.getByTestId('capture-list'));
    await user.click(await screen.findByTestId('capture-service-checkoutservice'));
    await press(await screen.findByTestId('capture-card-close'));
    expect(useCapture.getState().selection).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('capture-service-checkoutservice')).toHaveFocus(),
    );

    // The list, put away by Escape from one of its rows: the same as its button.
    await user.keyboard('{Escape}');
    expect(useCapture.getState().listOpen).toBe(false);
    await waitFor(() => expect(screen.getByTestId('capture-list')).toHaveFocus());

    // A card with no list open: to the stage, where the keys work.
    await user.click(screen.getByTestId('capture-table-service-checkoutservice'));
    await press(await screen.findByTestId('capture-card-close'));
    await waitFor(() => expect(document.getElementById('main')).toHaveFocus());

    // The details, put away by their button: back to the chip that opened them.
    await user.click(screen.getByTestId('capture-chip'));
    await press(await screen.findByTestId('capture-details-close'));
    await waitFor(() => expect(screen.getByTestId('capture-chip')).toHaveFocus());

    // A keyboard that was somewhere else when the card went stays there.
    await user.click(screen.getByTestId('capture-table-service-checkoutservice'));
    await screen.findByTestId('capture-card');
    const toggle = screen.getByTestId('capture-toggle');
    act(() => toggle.focus());
    await user.keyboard('{Escape}');
    expect(useCapture.getState().selection).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(toggle).toHaveFocus();
  });

  it('puts the keyboard in its list with /, on the selected service where there is one', async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromMenu(user, BOUTIQUE);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('/');
    await waitFor(() => expect(screen.getByTestId('capture-tab-services')).toHaveFocus());

    await user.click(screen.getByTestId('capture-list-close'));
    await user.click(screen.getByTestId('capture-table-service-checkoutservice'));
    await screen.findByTestId('capture-card');
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('/');
    await waitFor(() =>
      expect(screen.getByTestId('capture-service-checkoutservice')).toHaveFocus(),
    );
  });

  it('cannot be reached inside another page', async () => {
    stopFollowing?.();
    window.history.replaceState(null, '', '/?embed=1');
    stopFollowing = followCaptureAddress();
    const user = userEvent.setup();
    renderApp();
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: /command/i });
    await user.keyboard('capture');
    expect(within(palette).queryByText('Open an incident capture')).not.toBeInTheDocument();
    // Whatever asks for one: the dialog is not there either.
    act(() => useUi.getState().setPanel('capture'));
    expect(screen.queryByRole('dialog', { name: 'Open an incident capture' })).toBeNull();
    expect(useCapture.getState().capture).toBeNull();
  });

  it('names its card for what it shows, never as the simulation’s inspector', async () => {
    useUi.setState({ inspectorOpen: true });
    const user = userEvent.setup();
    renderApp();
    await openFromMenu(user, BOUTIQUE);

    await user.click(screen.getByTestId('capture-table-service-checkoutservice'));
    const service = await screen.findByRole('complementary', { name: 'Service in the capture' });
    expect(within(service).getByTestId('capture-card')).toHaveAttribute('data-kind', 'node');
    // Once the simulation's card has left, nothing on the page bears its name.
    await waitFor(() => expect(screen.queryByTestId('inspector')).not.toBeInTheDocument());
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();

    await user.click(screen.getByTestId('capture-list'));
    await user.click(await screen.findByTestId('capture-connection-frontend->checkoutservice'));
    const connection = await screen.findByRole('complementary', {
      name: 'Connection in the capture',
    });
    expect(within(connection).getByTestId('capture-card')).toHaveAttribute('data-kind', 'edge');

    await user.click(screen.getByTestId('capture-chip'));
    const details = await screen.findByRole('complementary', { name: 'What the capture is' });
    expect(within(details).getByTestId('capture-details')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  });

  it('says so when a capture cannot be opened, wherever it was asked for', async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromMenu(user, BOUTIQUE);
    // As a file the page did not load (a lazy chunk gone after a redeploy).
    const load = vi.spyOn(bundledCapture(GOOGLE)!, 'load');
    try {
      // From the bar's picker: the capture that was open stays open, and a
      // notice over the stage says why.
      load.mockRejectedValueOnce(new Error('chunk failed'));
      await user.selectOptions(screen.getByTestId('capture-picker'), GOOGLE);
      await waitFor(() => expect(useCapture.getState().error).not.toBeNull());
      expect(load).toHaveBeenCalledTimes(1);
      expect(useNotices.getState().notices).toEqual([
        expect.objectContaining({
          tone: 'error',
          message: '“Google Cloud outage · 12 June 2025” could not be read.',
        }),
      ]);
      expect(
        screen.getByText('“Google Cloud outage · 12 June 2025” could not be read.'),
      ).toBeInTheDocument();
      expect(useCapture.getState().id).toBe(BOUTIQUE);
      expect(screen.getByTestId('capture-picker')).toHaveValue(BOUTIQUE);
      expect(window.location.search).toBe(`?capture=${BOUTIQUE}`);

      // In the dialog it is said in place, and not a second time over the stage.
      act(() => useNotices.setState({ notices: [] }));
      load.mockRejectedValueOnce(new Error('chunk failed'));
      await fromMenu(user, 'Open another capture');
      const dialog = await screen.findByRole('dialog', { name: 'Open an incident capture' });
      await user.click(within(dialog).getByTestId(`capture-open-${GOOGLE}`));
      expect(await within(dialog).findByTestId('capture-problem')).toHaveTextContent(
        '“Google Cloud outage · 12 June 2025” could not be read.',
      );
      expect(useNotices.getState().notices).toEqual([]);
      expect(useCapture.getState().id).toBe(BOUTIQUE);
    } finally {
      load.mockRestore();
    }
  });
});

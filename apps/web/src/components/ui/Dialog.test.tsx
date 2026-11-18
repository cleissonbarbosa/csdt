/**
 * Where the keyboard goes when a dialog closes without having opened
 * anything: back to what opened it, or to the stage when that is gone; and
 * nowhere, when the page has put it somewhere in the meantime. First on the
 * dialog alone, then in the application, with its dialogs as a viewer
 * dismisses them, in the simulation and over an incident capture.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followCaptureAddress } from '@/app/captureUrl';
import { queryClient } from '@/app/queryClient';
import { sceneHandle } from '@/graphics/handle';
import type { SceneController } from '@/graphics/SceneController';
import { useCapture } from '@/stores/capture';
import { useGuide } from '@/stores/guide';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { useSettings, useUi } from '@/stores/ui';
import * as fixtures from '@/test/fixtures';

import { Dialog, openerOf } from './Dialog';
import { Menu } from './Menu';

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

/**
 * A page with a stage, and three ways to open one dialog. With `landing`,
 * it does what the application does when a dialog changed what it shows
 * (`useFocusAcrossModes`): in the task after the dialog has closed, it puts
 * a keyboard that was lost on a place of its own.
 */
function Page({ landing = false }: { landing?: boolean }) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState(true);
  const elsewhere = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!landing || open) return;
    const timer = window.setTimeout(() => {
      if (document.activeElement === document.body) elsewhere.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [landing, open]);
  return (
    <>
      <main id="main" tabIndex={-1}>
        Stage
      </main>
      {opener && (
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
      )}
      <button type="button" onClick={() => setOpener(false)}>
        Take the opener away
      </button>
      <Menu
        label="Things"
        icon={null}
        items={[{ id: 'open', label: 'Open it from the menu', onSelect: () => setOpen(true) }]}
      />
      <button type="button" ref={elsewhere}>
        Elsewhere
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="A dialog" description="Something to read">
        <button type="button" onClick={() => setOpener(false)}>
          Take the opener away from inside
        </button>
      </Dialog>
    </>
  );
}

describe('a dialog, as it closes', () => {
  it('gives the keyboard back to what opened it, by Escape and by its close button', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Open it' });

    await user.click(opener);
    expect(await screen.findByRole('dialog', { name: 'A dialog' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());

    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'A dialog' });
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('gives it to the menu’s button when an item of the menu opened it', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const button = screen.getByRole('button', { name: 'Things' });

    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Open it from the menu' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await screen.findByRole('dialog', { name: 'A dialog' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(button).toHaveFocus());

    // By the keyboard alone, the same.
    await user.keyboard('{Enter}');
    act(() => screen.getByRole('menuitem', { name: 'Open it from the menu' }).focus());
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'A dialog' });
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('gives it to the stage when what opened it is gone', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    const dialog = await screen.findByRole('dialog', { name: 'A dialog' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Take the opener away from inside' }),
    );
    expect(screen.queryByRole('button', { name: 'Open it' })).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.getElementById('main')).toHaveFocus());
  });

  it('gives it to the stage when it opened with the keyboard nowhere', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Dialog open={false} onOpenChange={() => {}} title="A dialog" description="Something">
        <p>Inside</p>
      </Dialog>,
    );
    const stage = document.createElement('main');
    stage.id = 'main';
    stage.tabIndex = -1;
    document.body.append(stage);
    try {
      expect(document.activeElement).toBe(document.body);
      rerender(
        <Dialog open onOpenChange={() => {}} title="A dialog" description="Something">
          <p>Inside</p>
        </Dialog>,
      );
      await screen.findByRole('dialog', { name: 'A dialog' });
      await user.keyboard('{Tab}');
      rerender(
        <Dialog open={false} onOpenChange={() => {}} title="A dialog" description="Something">
          <p>Inside</p>
        </Dialog>,
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(stage).toHaveFocus());
    } finally {
      stage.remove();
    }
  });

  it('leaves the keyboard where the page put it in the meantime', async () => {
    const user = userEvent.setup();
    render(<Page landing />);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    const opener = screen.getByRole('button', { name: 'Open it' });
    for (const how of ['Escape', 'close'] as const) {
      await user.click(opener);
      const dialog = await screen.findByRole('dialog', { name: 'A dialog' });
      if (how === 'Escape') await user.keyboard('{Escape}');
      else await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      // What opened the dialog is still there; the page's place is kept.
      expect(opener).toBeInTheDocument();
      expect(elsewhere).toHaveFocus();
    }
  });

  it('reads an item of a menu as the menu’s button, and nothing as nothing', () => {
    expect(openerOf(null)).toBeNull();
    expect(openerOf(document.body)).toBeNull();
    const button = document.createElement('button');
    button.setAttribute('aria-controls', 'the-menu');
    const menu = document.createElement('div');
    menu.id = 'the-menu';
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    item.setAttribute('role', 'menuitem');
    menu.append(item);
    document.body.append(button, menu);
    try {
      expect(openerOf(item)).toBe(button);
      expect(openerOf(button)).toBe(button);
    } finally {
      button.remove();
      menu.remove();
    }
  });
});

// The application, as `features/capture/shell.test.tsx` runs it.

const GOOGLE = 'google-cloud-2025-06-12';

let stopFollowing: (() => void) | null = null;

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

/** Dismisses the dialog by Escape or by its close button, and waits for it to go. */
async function dismiss(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  how: 'Escape' | 'close',
) {
  const dialog = await screen.findByRole('dialog', { name });
  if (how === 'Escape') await user.keyboard('{Escape}');
  else await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());
}

describe('the application’s dialogs, dismissed', () => {
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
    sceneHandle.current = {
      focusNode: vi.fn(),
      frameAll: vi.fn(),
      resetView: vi.fn(),
      setViewInsets: vi.fn(),
    } as unknown as SceneController;
    api.topologies.mockResolvedValue(fixtures.topologies());
    api.scenarios.mockResolvedValue(fixtures.scenarios());
    api.incidents.mockResolvedValue(fixtures.incidents());
    api.incidentReport.mockResolvedValue(fixtures.incidentReport());
    api.recordings.mockResolvedValue(fixtures.recordings());
    api.providers.mockResolvedValue(fixtures.providers());
    api.authorizationCatalog.mockResolvedValue(fixtures.catalog());
    api.authorizationDecisions.mockResolvedValue([]);
    api.workspace.mockResolvedValue(fixtures.workspace());
    api.control.mockResolvedValue({ playback: fixtures.snapshot().playback });
    const telemetry = useTelemetry.getState();
    telemetry.setTopology(fixtures.topology());
    telemetry.applySnapshot(fixtures.snapshot());
    telemetry.replaceEvents(fixtures.events().events);
    telemetry.replaceHistory(fixtures.metrics().history);
    telemetry.setConnection('open');
    stopFollowing = followCaptureAddress();
  });

  afterEach(() => {
    stopFollowing?.();
    stopFollowing = null;
    useCapture.getState().close();
    sceneHandle.current = null;
  });

  it('gives the keyboard back to the menu they were opened from, in the simulation', async () => {
    const user = userEvent.setup();
    renderApp();
    const more = screen.getByRole('button', { name: 'More' });
    for (const [item, name] of [
      ['Settings', 'Settings'],
      [/^Help and legend/, 'Help and legend'],
      ['Open an incident capture', 'Open an incident capture'],
    ] as const) {
      for (const how of ['Escape', 'close'] as const) {
        await fromMenu(user, item);
        await dismiss(user, name, how);
        await waitFor(() => expect(more).toHaveFocus());
      }
    }
    expect(useCapture.getState().capture).toBeNull();
  });

  it('gives it back to the stage when a key opened one there', async () => {
    const user = userEvent.setup();
    renderApp();
    const main = document.getElementById('main')!;
    for (const how of ['Escape', 'close'] as const) {
      act(() => main.focus());
      await user.keyboard('?');
      await dismiss(user, 'Help and legend', how);
      await waitFor(() => expect(main).toHaveFocus());
    }
  });

  it('does the same over a capture, and lands on its clock once one opens', async () => {
    const user = userEvent.setup();
    renderApp();
    // Opened from the dialog: the bar it was opened from has gone, and the
    // keyboard is on the capture's clock.
    await fromMenu(user, 'Open an incident capture');
    const dialog = await screen.findByRole('dialog', { name: 'Open an incident capture' });
    await user.click(within(dialog).getByTestId(`capture-open-${GOOGLE}`));
    await waitFor(() => expect(useCapture.getState().id).toBe(GOOGLE));
    await waitFor(() => expect(screen.getByTestId('capture-toggle')).toHaveFocus());
    // And it stays there: the dialog takes nothing back from it later.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.getByTestId('capture-toggle')).toHaveFocus();

    const more = screen.getByRole('button', { name: 'More' });
    for (const [item, name] of [
      ['Settings', 'Settings'],
      [/^Help and legend/, 'Help and legend'],
      ['Open another capture', 'Open an incident capture'],
    ] as const) {
      for (const how of ['Escape', 'close'] as const) {
        await fromMenu(user, item);
        await dismiss(user, name, how);
        await waitFor(() => expect(more).toHaveFocus());
      }
    }
    expect(useCapture.getState().id).toBe(GOOGLE);
  });
});

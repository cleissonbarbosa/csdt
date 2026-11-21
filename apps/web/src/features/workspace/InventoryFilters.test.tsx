/**
 * A cloud inventory in the import dialog: what the server says there is to
 * choose from, what a choice writes into the file, and the command that
 * writes such a file. The survey is real server output (a contract sample).
 */
import type { InventorySelection, InventorySurvey } from '@aegis/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '@/app/queryClient';
import { useNotices } from '@/stores/notices';
import { useUi } from '@/stores/ui';
import * as fixtures from '@/test/fixtures';

import { EVERYTHING } from './inventory';

const api = vi.hoisted(() => ({
  workspace: vi.fn(),
  checkWorkspace: vi.fn(),
  importWorkspace: vi.fn(),
  exportWorkspace: vi.fn(),
  diffWorkspace: vi.fn(),
  scenarios: vi.fn(),
}));
vi.mock('@/providers/api', async (original) => ({
  ...(await original<typeof import('@/providers/api')>()),
  api,
}));

const { CloudCommand } = await import('./CloudCommand');
const { InventoryFilters } = await import('./InventoryFilters');
const { WorkspaceDialog } = await import('./WorkspaceDialog');

function survey(): InventorySurvey {
  const [first] = fixtures.workspaceCheckInventory().inventories ?? [];
  if (!first) throw new Error('the sample surveys an inventory');
  return first;
}

function shown(change: Partial<InventorySurvey> = {}) {
  const onSelect = vi.fn<(selection: InventorySelection) => void>();
  render(<InventoryFilters survey={{ ...survey(), ...change }} onSelect={onSelect} />);
  return { onSelect, panel: screen.getByTestId('inventory-filters') };
}

beforeEach(() => {
  queryClient.clear();
  useUi.setState(useUi.getInitialState(), true);
  useNotices.setState({ notices: [] });
  for (const mock of Object.values(api)) mock.mockReset();
});

describe('what an inventory brings', () => {
  it('says what the file is and what its selection brings and leaves', () => {
    const { panel } = shown();
    expect(panel).toHaveAccessibleName('What to bring from front-desk-cloud.json');
    expect(panel).toHaveTextContent('front-desk-cloud.json');
    expect(panel).toHaveTextContent('Oracle Cloud');
    // When it was read, as the file wrote it.
    expect(panel).toHaveTextContent('2026-11-21T12:00:00Z');
    const kept = within(panel).getByTestId('inventory-kept');
    expect(kept).toHaveTextContent('Resources brought4 of 5');
    expect(kept).toHaveTextContent('Connections drawn3 of 4');
    expect(kept).toHaveTextContent('Where clients enter1 resource');
    expect(kept).toHaveTextContent('Not brought1 that the filters do not ask for');
    expect(kept).toHaveTextContent('Left out so that calls run one wayledger to desk');
    // The file's own notes, as written.
    expect(within(panel).getByTestId('inventory-notes')).toHaveTextContent(
      'Fictional inventory used for the contract samples.',
    );
  });

  it('offers only what there is to choose between', () => {
    const { panel } = shown();
    // One region: nothing to choose.
    expect(within(panel).queryByRole('group', { name: 'Regions' })).not.toBeInTheDocument();
    const networks = within(panel).getByRole('group', { name: 'Networks' });
    expect(
      within(networks)
        .getAllByRole('button')
        .map((chip) => [chip.textContent, chip.getAttribute('aria-pressed')]),
    ).toEqual([
      ['lobby-vcn4', 'true'],
      ['In no network1', 'true'],
    ]);
    // Nothing is asked of the kind: no chip is pressed, and every kind comes.
    const kinds = within(panel).getByRole('group', { name: 'Kinds of service' });
    expect(within(kinds).getByRole('button', { name: /Container/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('writes each choice as the selection it makes', async () => {
    const user = userEvent.setup();
    const { onSelect, panel } = shown();
    const asked = () => onSelect.mock.lastCall![0];

    await user.click(within(panel).getByRole('button', { name: /In no network/ }));
    expect(asked().networks).toEqual(['lobby-vcn']);
    await user.click(within(panel).getByRole('button', { name: /Database/ }));
    expect(asked().kinds).toEqual(['database']);
    // What was chosen before stays chosen.
    expect(asked().networks).toEqual(['lobby-vcn']);
    await user.click(within(panel).getByRole('button', { name: /Database/ }));
    expect(asked().kinds).toBeNull();

    await user.click(
      within(panel).getByRole('switch', {
        name: /Also what leads to them and what they lead to/,
      }),
    );
    expect(asked().alongPaths).toBe(false);
    await user.click(within(panel).getByRole('switch', { name: /Only what a connection touches/ }));
    expect(asked().connectedOnly).toBe(false);
    const rules = within(panel).getByRole('switch', {
      name: /Draw connections from network rules/,
    });
    expect(rules).toBeChecked();
    await user.click(rules);
    expect(asked().bases).toEqual(['routing', 'event', 'declared']);
    await user.click(rules);
    expect(asked().bases).toBeNull();
  });

  it('asks for a tag by its key and its values', async () => {
    const user = userEvent.setup();
    const { onSelect, panel } = shown();
    const asked = () => onSelect.mock.lastCall![0];
    const tags = within(panel).getByTestId('inventory-tags');
    // The tag the file already asks for is the one on show.
    const values = within(tags).getByRole('group', { name: 'Values of env' });
    expect(within(values).getByRole('button', { name: /prod/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(values).getByRole('button', { name: /test/ }));
    expect(asked().tags).toEqual([{ key: 'env', values: ['prod', 'test'] }]);
    await user.click(within(values).getByRole('button', { name: 'Any value' }));
    expect(asked().tags).toEqual([{ key: 'env', values: [] }]);
    await user.click(within(tags).getByRole('button', { name: 'Stop asking for the tag env' }));
    expect(asked().tags).toEqual([]);
  });

  it('asks for a name once the typing stops', async () => {
    const user = userEvent.setup();
    const { onSelect, panel } = shown();
    await user.type(within(panel).getByLabelText('Name has'), 'led');
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    // Not once for each letter.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.lastCall![0].name).toBe('led');
  });

  it('leaves one resource out by hand, and brings it back', async () => {
    const user = userEvent.setup();
    const excluded = survey();
    excluded.selection = { ...excluded.selection, exclude: ['archive'] };
    excluded.listed = excluded.listed.map((item) =>
      item.id === 'archive' ? { ...item, kept: false } : item,
    );
    const { onSelect, panel } = shown(excluded);
    const list = within(panel).getByTestId('inventory-resources');
    // Folded until asked for.
    await user.click(within(list).getByText('Resources, one by one'));
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    await user.click(within(list).getByRole('button', { name: 'Leave out Desk' }));
    expect(onSelect.mock.lastCall![0].exclude).toEqual(['archive', 'desk']);
    await user.click(within(list).getByRole('button', { name: 'Bring back Archive' }));
    expect(onSelect.mock.lastCall![0].exclude).toEqual(['desk']);

    // A long list is searched, not scrolled.
    await user.type(within(list).getByLabelText('Find a resource'), 'led');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByRole('listitem')).toHaveTextContent('Ledger');
  });

  it('goes back to everything when asked', async () => {
    const user = userEvent.setup();
    const { onSelect, panel } = shown();
    await user.click(within(panel).getByRole('button', { name: 'Bring everything' }));
    expect(onSelect).toHaveBeenLastCalledWith(EVERYTHING);
    // With nothing asked there is nothing to go back from.
    expect(within(panel).queryByRole('button', { name: 'Bring everything' })).toBeNull();
  });
});

describe('the command that writes an inventory', () => {
  it('stays out of the way until asked for, then writes the line to run', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CloudCommand />);
    expect(screen.queryByTestId('cloud-command')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('cloud-command-toggle'));
    const helper = screen.getByTestId('cloud-command');
    // It says who runs it and what it may do.
    expect(helper).toHaveTextContent('It runs on your machine');
    expect(helper).toHaveTextContent('only reads');

    // AWS cannot be read without a region.
    const copy = within(helper).getByTestId('cloud-command-copy');
    expect(copy).toBeDisabled();
    expect(helper).toHaveTextContent('Still needed: Regions');
    await user.type(within(helper).getByLabelText('Regions'), 'sa-east-1');
    await user.type(within(helper).getByLabelText('Profile'), 'readonly');
    await user.type(within(helper).getByLabelText('Only with these tags'), 'env=prod');
    expect(within(helper).getByTestId('cloud-command-text')).toHaveTextContent(
      'python3 scripts/export-cloud-inventory.py aws --profile readonly --region sa-east-1 --tag env=prod --output inventory.json',
    );
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(
      'python3 scripts/export-cloud-inventory.py aws --profile readonly --region sa-east-1 --tag env=prod --output inventory.json',
    );
    await waitFor(() =>
      expect(useNotices.getState().notices.at(-1)?.message).toBe('Command copied.'),
    );

    // Each provider is asked in its own terms.
    await user.click(within(helper).getByTestId('cloud-provider-oci'));
    expect(within(helper).getByLabelText('Compartment')).toBeInTheDocument();
    expect(helper).toHaveTextContent('Still needed: Compartment');
    await user.click(within(helper).getByTestId('cloud-provider-gcp'));
    expect(within(helper).getByLabelText('Project')).toBeInTheDocument();
    expect(within(helper).queryByLabelText('Profile')).not.toBeInTheDocument();
  });
});

describe('an inventory in the import dialog', () => {
  const INVENTORY = JSON.stringify({
    kind: 'aegis-cloud-inventory',
    version: 1,
    provider: 'oci',
    name: 'front-desk-cloud',
    resources: [{ id: 'door', name: 'Door', type: 'api-gateway', native: 'x', region: 'r' }],
  });

  it('is narrowed in the page, checked again, and applied as it was narrowed', async () => {
    api.workspace.mockResolvedValue(fixtures.workspace());
    api.checkWorkspace.mockResolvedValue(fixtures.workspaceCheckInventory());
    api.diffWorkspace.mockResolvedValue(fixtures.workspaceDiff());
    api.scenarios.mockResolvedValue(fixtures.scenarios());
    api.importWorkspace.mockResolvedValue(fixtures.workspaceResponse());
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceDialog />
      </QueryClientProvider>,
    );
    act(() => useUi.getState().setPanel('workspace'));
    const dialog = await screen.findByRole('dialog', { name: 'Platform files' });
    // No inventory among the files: no filters on show.
    expect(within(dialog).queryByTestId('inventory-filters')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('cloud-command-toggle')).toBeInTheDocument();

    await user.upload(
      within(dialog).getByTestId('workspace-files'),
      new File([INVENTORY], 'front-desk-cloud.json', { type: 'application/json' }),
    );
    const panel = await within(dialog).findByTestId('inventory-filters');
    expect(api.checkWorkspace).toHaveBeenCalledTimes(1);

    // A choice goes into the file, and the file is checked again.
    await user.click(within(panel).getByRole('button', { name: /Database/ }));
    await waitFor(() => expect(api.checkWorkspace).toHaveBeenCalledTimes(2));
    const [file] = api.checkWorkspace.mock.lastCall![0] as { path: string; text: string }[];
    expect(file!.path).toBe('front-desk-cloud.json');
    const written = JSON.parse(file!.text) as { selection: unknown; resources: unknown[] };
    expect(written.selection).toMatchObject({ kinds: ['database'], connectedOnly: true });
    expect(written.resources).toHaveLength(1);
    // The filters stay where they were while the answer comes.
    expect(within(dialog).getByTestId('inventory-filters')).toBe(panel);

    await waitFor(() => expect(within(dialog).getByTestId('workspace-apply')).toBeEnabled());
    await user.click(within(dialog).getByTestId('workspace-apply'));
    await waitFor(() =>
      expect(api.importWorkspace).toHaveBeenCalledWith([{ path: file!.path, text: file!.text }]),
    );
  });
});

/**
 * The capture's list keeps a service's name in front of what is said of it.
 * The list's panel is 300 px wide at most; a state such as "Não informado
 * neste momento" beside the name would leave the name a few letters, so the
 * state goes under the name, and the name has the row's whole width and as
 * many lines as it needs.
 */
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { leaveCapture } from '@/app/captureUrl';
import { useCapture } from '@/stores/capture';

import { CaptureList } from './CaptureList';
import google from './google-cloud-2025-06-12.json';
import boutique from './online-boutique-rcaeval.json';

async function openList(id: string, atMs?: number) {
  await act(() => useCapture.getState().openBundled(id));
  if (atMs !== undefined) act(() => useCapture.getState().seek(atMs));
  act(() => useCapture.getState().setList(true, 'services'));
  return render(<CaptureList />);
}

/** A service's row, taken apart: its mark, its name and what is said of it. */
function partsOf(id: string) {
  const row = screen.getByTestId(`capture-service-${id}`);
  const children = [...row.children] as HTMLElement[];
  const text = row.querySelector<HTMLElement>('[data-part="text"]')!;
  return {
    row,
    children,
    text,
    name: within(text).getByText((_, element) => element?.getAttribute('data-part') === 'name'),
    state: text.querySelector<HTMLElement>('[data-part="state"]'),
  };
}

afterEach(() => {
  act(() => leaveCapture());
  window.history.replaceState(null, '', '/');
});

describe('a row of the capture’s services', () => {
  it('says its state under its name, never beside it', async () => {
    await openList('google-cloud-2025-06-12');
    for (const node of google.nodes) {
      const { row, children, text, name, state } = partsOf(node.id);
      // The mark, then one column with everything that is said: nothing
      // beside the name takes its room.
      expect(children).toHaveLength(2);
      expect(children[1]).toBe(text);
      expect(text).toHaveClass('min-w-0', 'flex-1');
      expect(name).toHaveTextContent(node.name);
      // Said whole, on more lines if it needs them, never cut.
      expect(name).toHaveClass('block', 'break-words');
      expect(name).not.toHaveClass('truncate');
      // At the window's start the report has named no one.
      expect(row).toHaveAttribute('data-condition', 'not-stated');
      expect(state).not.toBeNull();
      expect(state).toHaveTextContent('Not stated at this time');
      expect(state).toHaveClass('block');
      expect(state).not.toHaveClass('shrink-0');
      // Under the name, in the same column.
      expect(name.compareDocumentPosition(state!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(state!.parentElement).toBe(text);
      // The row is laid out from the top, its mark beside the name's line.
      expect(row).toHaveClass('items-start');
      expect(children[0]).toHaveClass('h-4');
    }
  });

  it('keeps the file’s note after the state, and says nothing of a normal one', async () => {
    // 21:00 UTC: some services recovered, others still affected or not stated.
    await openList('google-cloud-2025-06-12', Date.UTC(2025, 5, 12, 21, 0));
    const dataflow = partsOf('dataflow');
    const note = within(dataflow.text).getByText(/the report does not say when its impact began/);
    expect(dataflow.state).not.toBeNull();
    expect(
      dataflow.state!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const recovered = google.nodes
      .map((node) => partsOf(node.id))
      .filter(({ row }) => row.getAttribute('data-condition') === 'recovered');
    expect(recovered.length).toBeGreaterThan(0);
    for (const { state, children } of recovered) {
      expect(state).toBeNull();
      expect(children).toHaveLength(2);
    }
  });

  it('is read name first, then what is said of it, and says it once', async () => {
    // 19:35 UTC: one service recovering, one recovered, others not stated.
    await openList('google-cloud-2025-06-12', Date.UTC(2025, 5, 12, 19, 35));
    for (const node of google.nodes) {
      const { row } = partsOf(node.id);
      const state = row.getAttribute('data-condition');
      const said = {
        'not-stated': 'Not stated at this time',
        affected: 'Reported affected',
        recovering: 'Reported recovering',
        recovered: 'Reported recovered',
      }[state!]!;
      // A note the file wrote, if there is one, comes after both; the state
      // is said once.
      const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(row).toHaveAccessibleName(
        new RegExp(`^${literal(node.name)} ${literal(said)}(?!.*${literal(said)})`),
      );
    }
  });

  it('words a measured service without an error count the same way', async () => {
    await openList('online-boutique-rcaeval');
    for (const node of boutique.nodes) {
      const { children, text, state } = partsOf(node.id);
      expect(children).toHaveLength(2);
      expect(state?.parentElement).toBe(text);
      expect(state).toHaveTextContent(/^(Error rate not measured|No data)$/);
    }
    expect(screen.getByTestId('capture-service-checkoutservice')).toHaveTextContent(
      'Error rate not measured',
    );
  });
});

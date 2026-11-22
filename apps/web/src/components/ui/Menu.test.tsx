/**
 * The menu at the end of a bar, cut into sections: each section is a group
 * named by its heading, the heading is not something to choose, the keys go
 * from item to item over the headings, and the columns keep the order the
 * keyboard follows.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu, type MenuLayout, type MenuSection } from './Menu';

function sections(chosen: (id: string) => void): MenuSection[] {
  const item = (id: string, extra: object = {}) => ({
    id,
    label: `Item ${id}`,
    onSelect: () => chosen(id),
    ...extra,
  });
  return [
    { id: 'first', label: 'First things', items: [item('a'), item('b', { hint: '/' })] },
    { id: 'second', label: 'Second things', items: [item('c', { checked: true })] },
    { id: 'third', label: 'Third things', items: [item('d'), item('e')] },
    { id: 'foot', items: [item('f'), item('g')] },
  ];
}

function renderMenu(layout?: MenuLayout) {
  const chosen = vi.fn();
  render(<Menu label="More" icon={null} sections={sections(chosen)} layout={layout} />);
  return { chosen, user: userEvent.setup() };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  return screen.getByRole('menu', { name: 'More' });
}

const focused = () => document.activeElement?.getAttribute('data-testid');

describe('a menu in sections', () => {
  it('names each section by its heading, and the heading is not an item', async () => {
    const { user } = renderMenu();
    const menu = await open(user);

    const first = within(menu).getByRole('group', { name: 'First things' });
    expect(
      within(first)
        .getAllByRole('menuitem')
        .map((entry) => entry.textContent),
    ).toEqual(['Item a', 'Item b/']);
    const second = within(menu).getByRole('group', { name: 'Second things' });
    expect(within(second).getByRole('menuitemcheckbox', { name: /Item c/ })).toBeChecked();
    // Seven things to choose, whatever the headings say.
    expect(menu.querySelectorAll('[role^="menuitem"]')).toHaveLength(7);
    expect(within(menu).queryByRole('menuitem', { name: /things/ })).not.toBeInTheDocument();
    // A section without a label is set apart by a line, and has no name.
    expect(screen.getByTestId('menu-section-foot')).not.toHaveAttribute('aria-labelledby');
    expect(within(menu).getAllByRole('separator')).toHaveLength(3);
  });

  it('starts on the first item and goes over the headings with the arrows', async () => {
    const { user } = renderMenu();
    await open(user);
    expect(focused()).toBe('menu-a');

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(focused()).toBe('menu-c');
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe('menu-b');
    // Past either end it comes round.
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(focused()).toBe('menu-g');
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('menu-a');
    await user.keyboard('{End}');
    expect(focused()).toBe('menu-g');
    await user.keyboard('{Home}');
    expect(focused()).toBe('menu-a');
  });

  it('does what an item says, closes, and gives the keyboard back on Escape', async () => {
    const { user, chosen } = renderMenu();
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Item d' }));
    expect(chosen).toHaveBeenCalledWith('d');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await open(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
  });

  it('in columns, puts the first half of the sections on the left and the rest at the foot', async () => {
    const { user } = renderMenu('columns');
    const menu = await open(user);
    expect(menu).toHaveAttribute('data-layout', 'columns');

    const columns = [...menu.querySelectorAll(':scope > [role="none"] > [role="none"]')];
    expect(columns).toHaveLength(2);
    const named = (column: Element) =>
      [...column.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute('data-testid'),
      );
    expect(named(columns[0]!)).toEqual(['menu-section-first', 'menu-section-second']);
    expect(named(columns[1]!)).toEqual(['menu-section-third']);
    // The foot runs under both columns, after them.
    expect(screen.getByTestId('menu-section-foot').parentElement).toBe(menu);

    // The keyboard reads the left column, the right, then the foot.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(focused()).toBe('menu-d');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(focused()).toBe('menu-f');
  });
});

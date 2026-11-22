import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { t } from '@/i18n';
import { cn } from '@/lib/cn';

export interface MenuItem {
  id: string;
  label: string;
  /** The key that does the same thing, shown beside the label. */
  hint?: string;
  icon?: ReactNode;
  /** For an item that switches something on and off. */
  checked?: boolean;
  onSelect: () => void;
}

/**
 * Items that belong together. Its label says what they are for, in the
 * viewer's words; a section without one is set apart by a line alone.
 */
export interface MenuSection {
  id: string;
  label?: string;
  items: MenuItem[];
}

/**
 * How the sections are laid out. A `list` is one column. `columns` puts the
 * labelled sections in two columns where the screen has room for both (the
 * first half of them on the left, in order, so the keyboard goes down the
 * left and then down the right, as the eye does), and the sections without
 * a label that end the list along its foot. Below that width it is a list.
 */
export type MenuLayout = 'list' | 'columns';

/**
 * A button that opens a short list of things to do. It holds what is used
 * now and then, so that the bar it sits in can show only what is used all
 * the time. A long list is cut into sections, so that what is there can be
 * found by what it is for rather than read from the top.
 */
export function Menu({
  label,
  icon,
  sections,
  layout = 'list',
  testId,
}: {
  label: string;
  icon: ReactNode;
  sections: MenuSection[];
  layout?: MenuLayout;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  // A section's heading is not an item, so the keys pass over it.
  const entries = () => [
    ...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
  ];
  const move = (step: number) => {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[(at + step + all.length) % all.length]?.focus();
  };

  const select = (item: MenuItem) => {
    setOpen(false);
    item.onSelect();
  };

  const section = (entry: MenuSection, rule: Rule, row = false) => (
    <Section key={entry.id} menuId={id} section={entry} rule={rule} row={row} onSelect={select} />
  );

  let body: ReactNode;
  if (layout === 'columns') {
    const end = sections.findLastIndex((entry) => entry.label !== undefined) + 1;
    const labelled = sections.slice(0, end);
    const half = Math.ceil(labelled.length / 2);
    body = (
      <>
        <div role="none" className="md:grid md:grid-cols-2 md:gap-x-3">
          {[labelled.slice(0, half), labelled.slice(half)].map((column, at) => (
            <div role="none" key={at} className="min-w-0">
              {/* The right column's first section has a line above it only
                  where it is drawn below the left one. */}
              {column.map((entry, index) =>
                section(entry, index > 0 ? 'always' : at > 0 ? 'narrow' : 'none'),
              )}
            </div>
          ))}
        </div>
        {sections.slice(end).map((entry) => section(entry, 'always', true))}
      </>
    );
  } else {
    body = sections.map((entry, index) => section(entry, index > 0 ? 'always' : 'none'));
  }

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === 'Escape') {
          setOpen(false);
          root.current?.querySelector<HTMLElement>('button')?.focus();
        } else if (event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowUp') move(-1);
        else if (event.key === 'Home') entries()[0]?.focus();
        else if (event.key === 'End') entries().at(-1)?.focus();
        else return;
        // The menu's keys are its own while it is open.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        data-testid={testId}
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-control border border-transparent text-ink-dim transition-colors hover:bg-raised hover:text-ink',
          open && 'bg-sunken text-ink',
        )}
      >
        {icon}
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          data-layout={layout}
          // As wide as its longest label, so that none of them breaks, and
          // never wider than the screen; as tall as it is, and where the
          // screen is shorter than that, it scrolls rather than run off it.
          className="panel floating absolute right-0 top-[calc(100%+6px)] z-40 max-h-[calc(100dvh-4.5rem)] w-max min-w-56 max-w-[calc(100vw-2rem)] animate-rise overflow-y-auto overscroll-contain p-1"
        >
          {body}
        </div>
      )}
    </div>
  );
}

/**
 * Whether a section has a line above it: never (the first), always, or only
 * where the columns are stacked into one.
 */
type Rule = 'none' | 'always' | 'narrow';

function Section({
  menuId,
  section,
  rule,
  row,
  onSelect,
}: {
  menuId: string;
  section: MenuSection;
  rule: Rule;
  /** Its items side by side where there is room, as at the foot of columns. */
  row: boolean;
  onSelect: (item: MenuItem) => void;
}) {
  const heading = `${menuId}-${section.id}`;
  return (
    <>
      {rule !== 'none' && (
        <div
          role="separator"
          className={cn('mx-2 my-1 border-t border-line', rule === 'narrow' && 'md:hidden')}
        />
      )}
      <div
        role="group"
        aria-labelledby={section.label === undefined ? undefined : heading}
        data-testid={`menu-section-${section.id}`}
        className={cn(row && 'md:flex md:gap-x-3')}
      >
        {section.label !== undefined && (
          <div id={heading} className="px-2 pb-1 pt-1.5 text-[11px] text-ink-faint">
            {section.label}
          </div>
        )}
        {section.items.map((item) => (
          <button
            key={item.id}
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            onClick={() => onSelect(item)}
            data-testid={`menu-${item.id}`}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-xs text-ink hover:bg-raised focus-visible:bg-raised',
              row && 'md:min-w-0 md:flex-1 md:basis-0',
            )}
          >
            <span className="flex w-4 shrink-0 justify-center text-ink-dim" aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">{item.label}</span>
            {item.checked && <span className="text-[11px] text-ink-faint">{t('On#state')}</span>}
            {item.hint && <kbd className="code text-[10px] text-ink-faint">{item.hint}</kbd>}
          </button>
        ))}
      </div>
    </>
  );
}

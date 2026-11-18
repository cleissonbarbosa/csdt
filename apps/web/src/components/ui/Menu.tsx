import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { t } from '@/i18n';
import { cn } from '@/lib/cn';

export type MenuItem = {
  id: string;
  label: string;
  /** The key that does the same thing, shown beside the label. */
  hint?: string;
  icon?: ReactNode;
  /** For an item that switches something on and off. */
  checked?: boolean;
} & ({ href: string; onSelect?: never } | { href?: never; onSelect: () => void });

/**
 * A button that opens a short list of things to do. It holds what is used
 * now and then, so that the bar it sits in can show only what is used all
 * the time.
 */
export function Menu({
  label,
  icon,
  items,
  testId,
}: {
  label: string;
  icon: ReactNode;
  items: MenuItem[];
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

  const move = (step: number) => {
    const entries = [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    entries[(at + step + entries.length) % entries.length]?.focus();
  };

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
          className="panel floating absolute right-0 top-[calc(100%+6px)] z-40 min-w-56 animate-rise p-1"
        >
          {items.map((item) => {
            const Item = item.href ? 'a' : 'button';
            return (
              <Item
                key={item.id}
                type={item.href ? undefined : 'button'}
                href={item.href}
                target={item.href ? '_blank' : undefined}
                rel={item.href ? 'noopener' : undefined}
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                data-testid={`menu-${item.id}`}
                className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-xs text-ink hover:bg-raised focus-visible:bg-raised"
              >
                <span className="flex w-4 shrink-0 justify-center text-ink-dim" aria-hidden>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.checked && (
                  <span className="text-[11px] text-ink-faint">{t('On#state')}</span>
                )}
                {item.hint && <kbd className="code text-[10px] text-ink-faint">{item.hint}</kbd>}
              </Item>
            );
          })}
        </div>
      )}
    </div>
  );
}

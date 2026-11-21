import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * One of several things that can each be asked for or not: a filter. It is
 * a toggle button, pressed while it is asked for. Pressed is ink, as every
 * choice of the viewer's own is; nothing about it is a state of the data.
 */
export function Chip({
  active,
  onClick,
  children,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** An accessible name, where what it shows does not say what it is. */
  label?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-control border px-1.5 text-[11px] transition-colors',
        active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

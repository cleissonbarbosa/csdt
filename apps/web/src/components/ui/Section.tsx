import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** A titled block inside a panel. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b border-line px-3 py-3 last:border-b-0', className)}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold text-ink">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/**
 * A block that stays folded until it is asked for: its title and how much is
 * inside are on show, the contents are one click away. What a card shows at
 * once is what answers the first question; the rest waits here.
 */
export function Fold({
  title,
  count,
  open,
  children,
  testId,
}: {
  title: string;
  count?: number;
  /** Whether it starts open. */
  open?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <details
      className="group border-b border-line last:border-b-0"
      open={open}
      data-testid={testId}
    >
      <summary className="flex list-none items-baseline justify-between gap-2 px-3 py-2.5 hover:bg-raised [&::-webkit-details-marker]:hidden">
        <h3 className="text-xs font-bold text-ink">{title}</h3>
        <span className="flex items-baseline gap-2 text-[11px] text-ink-faint">
          {count !== undefined && <span className="numeric">{count}</span>}
          <span aria-hidden className="group-open:hidden">
            Show
          </span>
          <span aria-hidden className="hidden group-open:inline">
            Hide
          </span>
        </span>
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

/** A labelled figure: the building block of every metric readout. */
export function Stat({
  label,
  value,
  unit,
  tone,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  /** Colour of the value, for figures that carry status. */
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="caption truncate">{label}</dt>
      <dd
        className="numeric mt-0.5 truncate text-sm text-ink"
        style={tone ? { color: tone } : undefined}
      >
        {value}
        {unit && <span className="ml-1 text-[11px] text-ink-faint">{unit}</span>}
      </dd>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-xs font-bold text-ink-dim">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-[30ch] text-xs text-ink-faint">{children}</p>}
    </div>
  );
}

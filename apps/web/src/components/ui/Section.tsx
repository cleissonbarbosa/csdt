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
    <section className={cn('border-b border-line/70 px-3 py-3 last:border-b-0', className)}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
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
      <dt className="eyebrow truncate">{label}</dt>
      <dd
        className="numeric mt-0.5 truncate text-sm font-medium text-ink"
        style={tone ? { color: tone } : undefined}
      >
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-ink-faint">{unit}</span>}
      </dd>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.12em] text-ink-dim">
        {title}
      </p>
      {children && <p className="mx-auto mt-2 max-w-[28ch] text-xs text-ink-faint">{children}</p>}
    </div>
  );
}

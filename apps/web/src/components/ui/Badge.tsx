import type { DataSource, Health, Severity } from '@aegis/contracts';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import {
  DATA_SOURCE_HINT,
  DATA_SOURCE_LABEL,
  HEALTH_COLOR,
  HEALTH_LABEL,
  SEVERITY_COLOR,
} from '@/lib/palette';

interface BadgeProps {
  color: string;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Draws a status dot before the label. */
  dot?: boolean;
  pulse?: boolean;
}

/** A small tinted label. The colour is always paired with text. */
export function Badge({ color, children, className, title, dot, pulse }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-[3px] border px-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.1em]',
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
      }}
    >
      {dot && (
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full', pulse && 'animate-pulse-soft')}
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
        />
      )}
      {children}
    </span>
  );
}

export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  return (
    <Badge color={HEALTH_COLOR[health]} dot pulse={health === 'critical'} className={className}>
      {HEALTH_LABEL[health]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge color={SEVERITY_COLOR[severity]}>{severity}</Badge>;
}

const SOURCE_COLOR: Record<DataSource, string> = {
  synthetic: '#9FB0CC',
  recording: '#FFBF69',
  live: '#45D6A0',
};

/** Says where a piece of data comes from. Shown wherever data is shown. */
export function SourceBadge({ source, className }: { source: DataSource; className?: string }) {
  return (
    <Badge color={SOURCE_COLOR[source]} title={DATA_SOURCE_HINT[source]} className={className}>
      {DATA_SOURCE_LABEL[source]}
    </Badge>
  );
}

/** A coloured dot for dense lists; pair it with a text alternative. */
export function StatusDot({
  color,
  pulse,
  label,
}: {
  color: string;
  pulse?: boolean;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-block size-2 shrink-0 rounded-full', pulse && 'animate-pulse-soft')}
      style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
    />
  );
}

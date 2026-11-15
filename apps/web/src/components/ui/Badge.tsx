import type { DataSource, Health, Severity } from '@aegis/contracts';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import {
  DATA_SOURCE_HINT,
  DATA_SOURCE_LABEL,
  HEALTH_COLOR,
  HEALTH_LABEL,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
} from '@/lib/palette';

interface BadgeProps {
  /** A signal colour. Omit it for anything that is not a deviation. */
  color?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** A short tag. Neutral unless it is given a signal colour to carry. */
export function Badge({ color, children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-control border border-line px-1.5 text-[11px] text-ink-dim',
        className,
      )}
      style={
        color ? { color, borderColor: `color-mix(in oklab, ${color} 55%, transparent)` } : undefined
      }
    >
      {children}
    </span>
  );
}

/**
 * The shape that goes with a health state, so status never rests on colour
 * alone: a triangle for degraded, a square for critical, a cross for down.
 * Healthy has no mark at all: normal is silent.
 */
export function HealthGlyph({ health, size = 9 }: { health: Health; size?: number }) {
  if (health === 'healthy') return null;
  const color = HEALTH_COLOR[health];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      aria-hidden
      className="shrink-0"
      style={{ color }}
    >
      {health === 'degraded' && <path d="M5 0.8 9.6 9.2H0.4Z" fill="currentColor" />}
      {health === 'critical' && (
        <rect x="0.8" y="0.8" width="8.4" height="8.4" fill="currentColor" />
      )}
      {health === 'down' && (
        <path d="M1.2 1.2 8.8 8.8M8.8 1.2 1.2 8.8" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

/**
 * Health for dense lists: the glyph when something is wrong, nothing when it
 * is not. The state is always available to assistive technology.
 */
export function HealthMark({ health, className }: { health: Health; className?: string }) {
  return (
    <span
      className={cn('inline-flex w-[9px] shrink-0 items-center justify-center', className)}
      title={health === 'healthy' ? undefined : HEALTH_LABEL[health]}
    >
      <HealthGlyph health={health} />
      <span className="sr-only">{HEALTH_LABEL[health]}</span>
    </span>
  );
}

/** Health spelled out: plain text when healthy, glyph and colour otherwise. */
export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  const abnormal = health !== 'healthy';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-[11px]', className)}
      style={{ color: abnormal ? HEALTH_COLOR[health] : undefined }}
    >
      <HealthGlyph health={health} />
      <span className={abnormal ? 'font-bold' : 'text-ink-dim'}>{HEALTH_LABEL[health]}</span>
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const loud = severity === 'warning' || severity === 'critical';
  return (
    <span
      className={cn('text-[11px]', loud ? 'font-bold' : 'text-ink-faint')}
      style={loud ? { color: SEVERITY_COLOR[severity] } : undefined}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/** Says where a piece of data comes from. Shown wherever data is shown. */
export function SourceBadge({ source, className }: { source: DataSource; className?: string }) {
  return (
    <Badge title={DATA_SOURCE_HINT[source]} className={className}>
      {DATA_SOURCE_LABEL[source]}
    </Badge>
  );
}

/**
 * A Cedar decision. A request that was stopped takes the incident colour and
 * the solid form; one that went through is an outline in ink. The two differ
 * in form and in word as well as in hue.
 */
export function DecisionTag({ decision }: { decision: 'allow' | 'deny' }) {
  const deny = decision === 'deny';
  return (
    <span
      className={cn(
        'inline-flex h-5 w-12 shrink-0 items-center justify-center rounded-control border text-[11px] font-bold',
        deny ? 'border-critical bg-critical text-on-accent' : 'border-line-strong text-ink',
      )}
    >
      {deny ? 'Deny' : 'Allow'}
    </span>
  );
}

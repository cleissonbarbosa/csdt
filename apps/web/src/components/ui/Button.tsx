import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary:
    'border-cyan/60 bg-cyan/15 text-cyan hover:bg-cyan/25 hover:border-cyan active:bg-cyan/30',
  outline:
    'border-line-bright bg-surface/60 text-ink-dim hover:text-ink hover:border-ink-faint active:bg-raised',
  ghost: 'border-transparent text-ink-dim hover:text-ink hover:bg-raised/80 active:bg-raised',
  danger:
    'border-critical/50 bg-critical/10 text-critical hover:bg-critical/20 hover:border-critical',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 gap-1.5 px-2 text-[11px]',
  md: 'h-8 gap-2 px-3 text-xs',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Marks a toggle button as pressed (sets `aria-pressed`). */
  pressed?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'outline',
  size = 'md',
  pressed,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[3px] border font-display font-semibold uppercase tracking-[0.08em] transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        pressed && 'border-cyan/70 bg-cyan/15 text-cyan',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also shown as the native tooltip. */
  label: string;
  pressed?: boolean;
  size?: Size;
}

export function IconButton({
  label,
  pressed,
  size = 'md',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[3px] border border-transparent text-ink-dim transition-colors duration-150',
        'hover:border-line-bright hover:bg-raised/80 hover:text-ink disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-7' : 'size-8',
        pressed && 'border-cyan/60 bg-cyan/15 text-cyan hover:border-cyan hover:text-cyan',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

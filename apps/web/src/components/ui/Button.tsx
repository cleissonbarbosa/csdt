import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'border-accent bg-accent text-on-accent hover:opacity-85 active:opacity-75',
  outline: 'border-line-strong bg-paper text-ink hover:bg-raised active:bg-sunken',
  ghost: 'border-transparent text-ink-dim hover:bg-raised hover:text-ink active:bg-sunken',
  danger: 'border-critical bg-paper text-critical hover:bg-critical/10 active:bg-critical/15',
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
        'inline-flex shrink-0 items-center justify-center rounded-[3px] border transition-[color,background-color,border-color,opacity,scale] duration-150',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        pressed && 'border-line-strong bg-sunken text-ink',
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
        'inline-flex shrink-0 items-center justify-center rounded-[3px] border border-transparent text-ink-dim transition-[color,background-color,border-color,scale] duration-150',
        'hover:bg-raised hover:text-ink active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-7' : 'size-8',
        pressed && 'border-line-strong bg-sunken text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

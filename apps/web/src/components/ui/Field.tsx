import * as RadixSwitch from '@radix-ui/react-switch';
import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <label htmlFor={id} className="min-w-0 text-xs text-ink">
        {label}
        {hint && <span className="mt-0.5 block text-[11px] text-ink-faint">{hint}</span>}
      </label>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="relative h-[18px] w-8 shrink-0 rounded-full border border-line-strong bg-sunken transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-40"
      >
        <RadixSwitch.Thumb className="block size-3 translate-x-[3px] rounded-full bg-ink-faint transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-on-accent" />
      </RadixSwitch.Root>
    </div>
  );
}

export function Select({
  label,
  className,
  children,
  hideLabel,
  quiet,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hideLabel?: boolean;
  /** Without a box until it is pointed at: for a choice that reads as text. */
  quiet?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className={cn('caption', hideLabel && 'sr-only')}>
        {label}
      </label>
      <select
        id={id}
        className={cn(
          'h-8 w-full min-w-0 rounded-control border px-2 text-xs text-ink transition-colors',
          quiet
            ? 'border-transparent bg-transparent hover:border-line hover:bg-paper'
            : 'border-line-strong bg-paper hover:border-ink-faint',
        )}
        {...rest}
      >
        {children}
      </select>
    </div>
  );
}

/** A row of mutually exclusive options (a radio group in button clothing). */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  testId,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** Gives each option the test id `<testId>-<value>`. */
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 overflow-hidden rounded-control border border-line-strong"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            className={cn(
              'numeric border-r border-line-strong px-2 transition-colors last:border-r-0',
              size === 'sm' ? 'h-6 text-[11px]' : 'h-7 text-[11px]',
              selected
                ? 'bg-accent text-on-accent'
                : 'bg-paper text-ink-dim hover:bg-raised hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

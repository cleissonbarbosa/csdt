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
        className="relative h-[18px] w-8 shrink-0 rounded-full border border-line-bright bg-abyss transition-colors data-[state=checked]:border-cyan data-[state=checked]:bg-cyan/25 disabled:opacity-40"
      >
        <RadixSwitch.Thumb className="block size-3 translate-x-[3px] rounded-full bg-ink-faint transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-cyan" />
      </RadixSwitch.Root>
    </div>
  );
}

export function Select({
  label,
  className,
  children,
  hideLabel,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hideLabel?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className={cn('eyebrow', hideLabel && 'sr-only')}>
        {label}
      </label>
      <select
        id={id}
        className="h-8 w-full min-w-0 rounded-[3px] border border-line-bright bg-abyss px-2 text-xs text-ink transition-colors hover:border-ink-faint"
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
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 overflow-hidden rounded-[3px] border border-line-bright"
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
            className={cn(
              'numeric border-r border-line-bright px-2 font-medium transition-colors last:border-r-0',
              size === 'sm' ? 'h-6 text-[10px]' : 'h-7 text-[11px]',
              selected ? 'bg-cyan/20 text-cyan' : 'text-ink-dim hover:bg-raised hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

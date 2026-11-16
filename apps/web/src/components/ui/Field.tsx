import * as RadixSwitch from '@radix-ui/react-switch';
import { useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';

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

/** A one-line text or number field with its label above it. */
export function TextField({
  label,
  hint,
  className,
  hideLabel,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label: string;
  hint?: string;
  hideLabel?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className={cn('caption', hideLabel && 'sr-only')}>
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(
          'h-8 w-full min-w-0 rounded-control border border-line-strong bg-paper px-2 text-xs text-ink transition-colors hover:border-ink-faint disabled:opacity-50',
          rest.type === 'number' && 'numeric',
        )}
        {...rest}
      />
      {hint && (
        <span id={`${id}-hint`} className="text-[11px] leading-snug text-ink-faint">
          {hint}
        </span>
      )}
    </div>
  );
}

/** A few lines of text with their label above them. */
export function TextArea({
  label,
  className,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="caption">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        className="w-full min-w-0 resize-y rounded-control border border-line-strong bg-paper px-2 py-1.5 text-xs leading-relaxed text-ink transition-colors hover:border-ink-faint"
        {...rest}
      />
    </div>
  );
}

/**
 * A figure being typed, for a value that is kept as a number.
 *
 * A number in the middle of being typed is not one yet: "1." has no value,
 * and neither has a field that was just emptied. Put straight back as the
 * number it parses to, the field takes the decimal point away as it is
 * pressed, so that "1.5" comes out as 5. This field keeps its own text for
 * as long as it is being edited and hands on a number whenever the text is
 * one; left with something that is not, it goes back to the figure it had.
 */
export function NumberField({
  value,
  onValue,
  ...rest
}: Omit<
  React.ComponentProps<typeof TextField>,
  'value' | 'onChange' | 'type' | 'onFocus' | 'onBlur'
> & {
  value: number;
  onValue: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <TextField
      {...rest}
      type="number"
      value={text ?? String(value)}
      onFocus={() => setText(String(value))}
      onBlur={() => setText(null)}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = Number(next);
        if (next.trim() !== '' && Number.isFinite(parsed)) onValue(parsed);
      }}
    />
  );
}

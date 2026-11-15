import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  /** Tailwind max-width class, e.g. `max-w-3xl`. */
  width?: string;
}

/** A modal dialog with focus trapping, Escape to close and labelled content. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 'max-w-2xl',
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade bg-black/40" />
        <RadixDialog.Content
          className={cn(
            'panel fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col animate-rise',
            width,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="text-base font-bold text-ink">
                {title}
              </RadixDialog.Title>
              <RadixDialog.Description className="mt-1 text-xs text-ink-dim">
                {description}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close dialog">
                <X size={16} />
              </IconButton>
            </RadixDialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

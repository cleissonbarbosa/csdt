import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { t } from '@/i18n';
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

/** Where the keyboard goes when what opened a dialog is gone: the stage, where the skip link leads. */
const STAGE = '#main';

/**
 * What the keyboard is to go back to once a dialog has closed, given what it
 * was on as the dialog opened. An item of a menu goes with its menu, so the
 * menu's button stands for it (`aria-controls` names the open menu), and
 * that button's own menu for it, a few levels up at most.
 */
export function openerOf(active: Element | null, depth = 0): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  const menu = depth < 4 ? active.closest<HTMLElement>('[role="menu"]') : null;
  if (menu?.id) {
    for (const control of document.querySelectorAll<HTMLElement>('[aria-controls]')) {
      if (control.getAttribute('aria-controls') === menu.id && !menu.contains(control)) {
        return openerOf(control, depth + 1);
      }
    }
  }
  return active;
}

/** Whether the keyboard is nowhere: on the document itself, as after what held it went. */
function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/** Puts the keyboard on an element if it can still take it, and says whether it did. */
function focusOn(element: HTMLElement | null): boolean {
  if (element === null || !element.isConnected) return false;
  if (element.closest('[inert]') !== null || element.matches(':disabled')) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

/**
 * Gives the keyboard back once a dialog has gone. The dialogs here are
 * opened from the stores, not by a Radix trigger, so Radix has nothing to
 * return to and the keyboard would be left on the document. It goes back to
 * what opened the dialog if that is still on the page, and to the stage if
 * it is not.
 *
 * Only a task later, and only if the keyboard is still nowhere by then: the
 * page has its turn first. When a dialog changed what the page shows (a
 * capture opened from it replaces the bar, and what opened the dialog with
 * it), `useFocusAcrossModes` in `App.tsx` puts the keyboard where the new
 * mode starts, in the task after the dialog left, and that is where it
 * stays. So does a keyboard another dialog took in this one's place.
 */
function giveBack(opener: HTMLElement | null): void {
  window.setTimeout(() => {
    if (!focusLost()) return;
    if (!focusOn(opener)) focusOn(document.querySelector<HTMLElement>(STAGE));
  }, 0);
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
  // What the keyboard was on as the dialog opened. It is read while the
  // dialog is first drawn open, before anything is committed: the page is
  // still as it was, so an item of a menu that the same change closes is
  // still there to be read.
  const [shown, setShown] = useState<{ open: boolean; opener: HTMLElement | null }>(() => ({
    open,
    opener: open ? openerOf(document.activeElement) : null,
  }));
  if (shown.open !== open) {
    setShown({ open, opener: open ? openerOf(document.activeElement) : shown.opener });
  }
  const opener = shown.opener;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade bg-black/40" />
        <RadixDialog.Content
          className={cn(
            'panel fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col animate-rise',
            width,
          )}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            giveBack(opener);
          }}
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
              <IconButton label={t('Close dialog')}>
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

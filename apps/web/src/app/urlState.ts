/**
 * The view, in the address.
 *
 * What is being looked at (the arrangement, the selection, the table in
 * place of the model) is kept in the query string as it changes, so the
 * address in the bar is always a link to this view. Opening such a link
 * changes nothing on the server: it only looks at the same place. A whole
 * experiment travels as a session instead (`app/session.ts`).
 */
import { useEffect } from 'react';

import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { applyView, currentView, SessionViewSchema, type SessionView } from './session';

const KEYS = ['arrangement', 'view', 'select'] as const;

/** The view a query string asks for. Anything it does not understand is left out. */
export function viewFromSearch(search: string): SessionView {
  const params = new URLSearchParams(search);
  const raw = Object.fromEntries(
    KEYS.flatMap((key) => {
      const value = params.get(key);
      return value === null ? [] : [[key, value]];
    }),
  );
  const view: SessionView = {};
  // Each part on its own, so one bad value does not discard the others.
  for (const key of KEYS) {
    const part = SessionViewSchema.pick({ [key]: true } as Record<typeof key, true>).safeParse(raw);
    if (part.success) Object.assign(view, part.data);
  }
  return view;
}

/** The query string that says `view`, keeping every parameter that is not ours. */
export function searchWithView(search: string, view: SessionView): string {
  const params = new URLSearchParams(search);
  for (const key of KEYS) {
    const value = view[key];
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** Keeps the address and the view in step, for the lifetime of the app. */
export function useUrlView(): void {
  useEffect(() => {
    // A link's selection waits for the platform it names something on.
    const asked = viewFromSearch(window.location.search);
    let pending = asked.select !== undefined || asked.view !== undefined;
    const apply = () => {
      if (!pending || !useTelemetry.getState().topology) return;
      pending = false;
      applyView(asked);
    };
    apply();
    const write = () => {
      if (pending) return;
      const search = searchWithView(window.location.search, currentView());
      if (search !== window.location.search) {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${search}${window.location.hash}`,
        );
      }
    };
    const stop = [
      useTelemetry.subscribe((state, previous) => {
        if (state.topology !== previous.topology) apply();
      }),
      useUi.subscribe((state, previous) => {
        if (
          state.layoutMode !== previous.layoutMode ||
          state.viewMode !== previous.viewMode ||
          state.selection !== previous.selection
        ) {
          write();
        }
      }),
    ];
    return () => {
      for (const off of stop) off();
    };
  }, []);
}

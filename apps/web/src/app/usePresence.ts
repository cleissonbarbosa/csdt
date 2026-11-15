import { useEffect, useState } from 'react';

export interface Presence {
  /** Whether the element should be in the document at all. */
  mounted: boolean;
  /** What its `data-state` should say; transitions hang on this. */
  state: 'open' | 'closed';
}

/**
 * Keeps something mounted long enough to leave.
 *
 * An element that is rendered only while `open` cannot animate out, and one
 * that mounts already in its open state cannot animate in. This mounts it
 * closed, opens it on the next frame, and on the way out holds it for
 * `exitMs` after it has been told to close.
 */
export function usePresence(open: boolean, exitMs = 240): Presence {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);

  return { mounted: mounted || open, state: open && shown ? 'open' : 'closed' };
}

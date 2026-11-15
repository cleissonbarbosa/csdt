import type { TelemetrySnapshot } from '@aegis/contracts';
import { useEffect, useRef, useState } from 'react';

import { useTelemetry } from '@/stores/telemetry';

/**
 * The latest snapshot, but re-rendering at most once per `intervalMs`.
 * Lists and tables do not need to repaint five times a second.
 */
export function useThrottledSnapshot(intervalMs = 1000): TelemetrySnapshot | null {
  const [snapshot, setSnapshot] = useState(() => useTelemetry.getState().snapshot);
  const last = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = () => {
      timer = null;
      last.current = performance.now();
      setSnapshot(useTelemetry.getState().snapshot);
    };
    const unsubscribe = useTelemetry.subscribe((state, previous) => {
      if (state.snapshot === previous.snapshot) return;
      // A different topology or a jump in time must show immediately.
      const jumped =
        state.snapshot?.topologyId !== previous.snapshot?.topologyId ||
        Math.abs((state.snapshot?.tick ?? 0) - (previous.snapshot?.tick ?? 0)) > 30;
      const wait = jumped ? 0 : intervalMs - (performance.now() - last.current);
      if (wait <= 0) {
        if (timer) clearTimeout(timer);
        publish();
      } else {
        timer ??= setTimeout(publish, wait);
      }
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);
  return snapshot;
}

/** True while the viewport is at least `minWidth` CSS pixels wide. */
export function useMinWidth(minWidth: number): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const [matches, setMatches] = useState(
    () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Connects the telemetry provider to the stores for the lifetime of the app.
 */
import type { TimelineReason } from '@aegis/contracts';
import { useEffect } from 'react';

import { api, ApiError } from '@/providers/api';
import { DemoSimulationProvider } from '@/providers/demoProvider';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { queryClient, queryKeys } from './queryClient';

let provider: DemoSimulationProvider | null = null;

/** The single provider instance; created on first use. */
export function getProvider(): DemoSimulationProvider {
  provider ??= new DemoSimulationProvider();
  return provider;
}

let topologyRequest: Promise<void> | null = null;

/**
 * Fetches the active topology. Concurrent callers share one request: while a
 * topology switch is in flight, every snapshot for the new topology asks.
 */
function loadTopology(): Promise<void> {
  topologyRequest ??= (async () => {
    const telemetry = useTelemetry.getState();
    try {
      const topology = await getProvider().getTopology();
      if (useTelemetry.getState().topology?.id !== topology.id) useUi.getState().resetForTopology();
      telemetry.setTopology(topology);
    } catch (error) {
      telemetry.setLoadError(
        error instanceof ApiError ? error.message : 'The topology could not be loaded.',
      );
      throw error;
    } finally {
      topologyRequest = null;
    }
  })();
  return topologyRequest;
}

async function loadTimeline(): Promise<void> {
  const telemetry = useTelemetry.getState();
  const [events, metrics] = await Promise.all([api.events(), api.metrics()]);
  telemetry.replaceEvents(events.events);
  telemetry.replaceHistory(metrics.history);
  telemetry.setPlayback(events.playback);
}

function invalidateTimelineQueries(): void {
  for (const key of [queryKeys.incidents, queryKeys.scenarios, queryKeys.decisions]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

export function useAegisConnection(): void {
  useEffect(() => {
    const source = getProvider();
    const telemetry = useTelemetry.getState();
    let cancelled = false;

    const loadAll = () =>
      loadTopology()
        .then(loadTimeline)
        .catch(() => undefined);

    const unsubscribe = [
      source.subscribeConnection((state) => {
        useTelemetry.getState().setConnection(state);
        // (Re)connected: whatever we hold may be stale.
        if (state === 'open' && !cancelled) {
          void loadAll();
          invalidateTimelineQueries();
        }
      }),
      source.subscribeSnapshots((snapshot) => {
        const state = useTelemetry.getState();
        if (state.topology && snapshot.topologyId !== state.topology.id) {
          void loadTopology().catch(() => undefined);
        }
        state.applySnapshot(snapshot);
      }),
      source.subscribeEvents((event) => {
        useTelemetry.getState().appendEvents([event]);
        if (event.kind.startsWith('incident-')) invalidateTimelineQueries();
        if (event.kind === 'authz-decision') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.decisions });
        }
      }),
      source.subscribeTimeline((reason: TimelineReason, playback) => {
        const state = useTelemetry.getState();
        state.setPlayback(playback);
        if (reason === 'reset' || reason === 'topology' || reason === 'recording') {
          state.clearTimeline();
        }
        const reload =
          reason === 'topology' || reason === 'recording' ? loadTopology() : Promise.resolve();
        void reload.then(loadTimeline).catch(() => undefined);
        invalidateTimelineQueries();
        void queryClient.invalidateQueries({ queryKey: queryKeys.topologies });
      }),
      source.subscribeLatency((ms) => useTelemetry.getState().setLatency(ms)),
    ];

    telemetry.setConnection('connecting');
    void source.connect();
    void loadAll();

    return () => {
      cancelled = true;
      for (const off of unsubscribe) off();
      void source.disconnect();
    };
  }, []);
}

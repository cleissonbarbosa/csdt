/**
 * Connects the telemetry provider to the stores for the lifetime of the app.
 */
import type { SecurityEvent, TimelineReason } from '@aegis/contracts';
import { useEffect } from 'react';

import { api, ApiError } from '@/providers/api';
import { DemoSimulationProvider } from '@/providers/demoProvider';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { invalidateWorkspaceQueries, queryClient, queryKeys } from './queryClient';

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

/**
 * Whether an event adds a line to an incident's report: the incident's own
 * events (its start, a phase, its end) and every change of a service's
 * state, which the report lists and explains. A report read before such an
 * event does not have it: asked why a service that has just changed did,
 * it would have nothing to say.
 */
export function growsReport(event: SecurityEvent): boolean {
  return event.kind.startsWith('incident-') || event.kind === 'health-transition';
}

/**
 * Offers the summary of an incident as it ends. The event is the engine's;
 * the summary it leads to is read from the same timeline.
 */
export function announceResolved(event: SecurityEvent): void {
  const incidentId = event.incidentId;
  if (event.kind !== 'incident-resolved' || incidentId === null) return;
  useNotices.getState().push('info', `${event.title}. Its summary is ready.`, {
    label: 'Open the summary',
    run: () => useUi.getState().inspectIncident(incidentId),
  });
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
        // While history is replayed no event is announced again, so the list
        // of incidents would stay as it was when the cursor was put there.
        // The snapshot says which incident is under way at its moment: when
        // that changes, so has the list.
        const before = state.snapshot?.incident;
        const now = snapshot.incident;
        if (before?.id !== now?.id || before?.status !== now?.status) invalidateTimelineQueries();
        state.applySnapshot(snapshot);
      }),
      source.subscribeEvents((event) => {
        useTelemetry.getState().appendEvents([event]);
        if (event.kind.startsWith('incident-')) invalidateTimelineQueries();
        // What is known of the incident has grown; so has its report.
        if (growsReport(event)) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.reports });
        }
        // An incident that has just ended can be read back in full: say so,
        // once, where it can be taken up or left.
        announceResolved(event);
        if (event.kind === 'authz-decision') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.decisions });
        }
      }),
      source.subscribeTimeline((reason: TimelineReason, playback) => {
        const state = useTelemetry.getState();
        state.setPlayback(playback);
        // The platform's own files were replaced: what was selected, filtered
        // or traced belongs to a platform that may no longer be there, even
        // when the new one has the same id.
        const replaced = reason === 'workspace';
        if (replaced) useUi.getState().resetForTopology();
        if (reason === 'reset' || reason === 'topology' || reason === 'recording' || replaced) {
          state.clearTimeline();
          // What was traced or opened was read off the timeline that went.
          useUi.getState().forgetTimeline();
        }
        if (reason !== 'seek') {
          // History changed shape: an incident that was on it may be gone,
          // and its report with it. Nothing is asked about it until the
          // snapshot that follows says what is running now.
          state.forgetIncident();
          queryClient.removeQueries({ queryKey: queryKeys.reports });
          // A branch keeps what came before it; anything else starts over,
          // and a summary that was being read is of a timeline that is gone.
          if (reason !== 'branch') useUi.getState().inspectIncident(null);
        }
        const reload =
          reason === 'topology' || reason === 'recording' || replaced
            ? loadTopology()
            : Promise.resolve();
        void reload.then(loadTimeline).catch(() => undefined);
        invalidateTimelineQueries();
        void queryClient.invalidateQueries({ queryKey: queryKeys.topologies });
        if (replaced) invalidateWorkspaceQueries();
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

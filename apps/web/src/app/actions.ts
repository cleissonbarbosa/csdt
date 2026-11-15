/**
 * Commands the interface can issue. Each one talks to the server, reflects
 * the result in the stores and reports failures as a notice; none throws.
 */
import type {
  AuthorizationDecision,
  ControlAction,
  ControlResponse,
  EvaluateRequest,
} from '@aegis/contracts';

import { api, ApiError } from '@/providers/api';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { queryClient, queryKeys } from './queryClient';

function describe(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong.';
}

async function run<T>(task: () => Promise<T>, failure: string): Promise<T | null> {
  try {
    return await task();
  } catch (error) {
    useNotices.getState().push('error', `${failure} ${describe(error)}`);
    return null;
  }
}

function adopt(response: ControlResponse | null): boolean {
  if (!response) return false;
  useTelemetry.getState().setPlayback(response.playback);
  return true;
}

export const actions = {
  control: async (action: ControlAction) =>
    adopt(await run(() => api.control(action), 'Playback could not be changed.')),

  startScenario: async (scenarioId: string) => {
    const ok = adopt(await run(() => api.startScenario(scenarioId), 'The scenario did not start.'));
    if (ok) void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios });
    return ok;
  },

  /** Stops the running scenario and lets the platform recover. History is kept. */
  stopScenario: async () =>
    adopt(await run(() => api.reset('scenario'), 'The scenario could not be stopped.')),

  /** Returns to tick 0 with a clean history. */
  resetSimulation: async () => {
    const ok = adopt(
      await run(() => api.reset('simulation'), 'The simulation could not be reset.'),
    );
    if (ok) useNotices.getState().push('info', 'Simulation reset to a clean baseline.');
    return ok;
  },

  /** Clean slate, then the same scenario again: reproduces it exactly. */
  restartScenario: async (scenarioId: string) => {
    if (!adopt(await run(() => api.reset('simulation'), 'The simulation could not be reset.'))) {
      return false;
    }
    return actions.startScenario(scenarioId);
  },

  selectTopology: async (topologyId: string) =>
    adopt(await run(() => api.selectTopology(topologyId), 'The topology could not be switched.')),

  loadRecording: async (recordingId: string) =>
    adopt(await run(() => api.loadRecording(recordingId), 'The recording could not be loaded.')),

  setProvider: async (id: string, connect: boolean) => {
    const statuses = await run(
      () => (connect ? api.connectProvider(id) : api.disconnectProvider(id)),
      connect
        ? 'The integration could not be connected.'
        : 'The integration could not be disconnected.',
    );
    // Refresh either way: a failed attempt changes the provider's state too.
    if (statuses) queryClient.setQueryData(queryKeys.providers, statuses);
    else void queryClient.invalidateQueries({ queryKey: queryKeys.providers });
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
    return statuses !== null;
  },

  evaluate: async (request: EvaluateRequest): Promise<AuthorizationDecision | ApiError> => {
    try {
      const decision = await api.evaluate(request);
      void queryClient.invalidateQueries({ queryKey: queryKeys.decisions });
      useUi.getState().traceDecision(decision);
      return decision;
    } catch (error) {
      return error instanceof ApiError ? error : new ApiError(0, 'unknown', describe(error));
    }
  },
};

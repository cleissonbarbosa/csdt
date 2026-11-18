/**
 * Commands the interface can issue. Each one talks to the server, reflects
 * the result in the stores and reports failures as a notice; none throws.
 */
import type {
  AuthorizationDecision,
  ControlAction,
  ControlResponse,
  EvaluateRequest,
  FaultEffect,
  Recording,
  WorkspaceFile,
  WorkspaceResponse,
  WorkspaceStatus,
} from '@aegis/contracts';

import { t } from '@/i18n';
import { api, ApiError } from '@/providers/api';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { HOST } from './host';
import { invalidateWorkspaceQueries, queryClient, queryKeys } from './queryClient';

/** How long a fault placed from the interface takes to ease in. */
const FAULT_RAMP_MS = 2000;

function describe(error: unknown): string {
  return error instanceof ApiError ? error.message : t('Something went wrong.');
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

/**
 * The platform's files were replaced. The stream says so too, but the answer
 * to the request is here first.
 */
function adoptWorkspace(response: WorkspaceResponse): WorkspaceStatus {
  useTelemetry.getState().setPlayback(response.playback);
  invalidateWorkspaceQueries();
  queryClient.setQueryData(queryKeys.workspace, response.workspace);
  return response.workspace;
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'unknown', describe(error));
}

export const actions = {
  control: async (action: ControlAction) =>
    adopt(await run(() => api.control(action), t('Playback could not be changed.'))),

  startScenario: async (scenarioId: string) => {
    const ok = adopt(
      await run(() => api.startScenario(scenarioId), t('The scenario did not start.')),
    );
    if (ok) void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios });
    return ok;
  },

  /** Places a fault by hand on a service or a connection. It holds until lifted. */
  placeFault: async (effect: FaultEffect) =>
    adopt(
      await run(() => api.injectFault(effect, FAULT_RAMP_MS), t('The fault could not be placed.')),
    ),

  /** Lifts one fault placed by hand, or with no effect named, all of them. */
  liftFault: async (effect?: FaultEffect) =>
    adopt(await run(() => api.clearFaults(effect), t('The fault could not be lifted.'))),

  /** Stops the running scenario and lets the platform recover. History is kept. */
  stopScenario: async () =>
    adopt(await run(() => api.reset('scenario'), t('The scenario could not be stopped.'))),

  /** Returns to tick 0 with a clean history. */
  resetSimulation: async () => {
    const ok = adopt(
      await run(() => api.reset('simulation'), t('The simulation could not be reset.')),
    );
    if (ok) useNotices.getState().push('info', t('Simulation reset to a clean baseline.'));
    return ok;
  },

  /** Clean slate, then the same scenario again: reproduces it exactly. */
  restartScenario: async (scenarioId: string) => {
    if (!adopt(await run(() => api.reset('simulation'), t('The simulation could not be reset.')))) {
      return false;
    }
    return actions.startScenario(scenarioId);
  },

  selectTopology: async (topologyId: string) =>
    adopt(
      await run(() => api.selectTopology(topologyId), t('The topology could not be switched.')),
    ),

  loadRecording: async (recordingId: string) =>
    adopt(await run(() => api.loadRecording(recordingId), t('The recording could not be loaded.'))),

  /**
   * Replaces the timeline with the one a recording describes: the engine
   * simulates it again from its seed and commands. With a cursor the
   * timeline waits there, paused.
   */
  loadSession: async (recording: Recording, cursorMs?: number) =>
    adopt(
      await run(() => api.loadSession(recording, cursorMs), t('The session could not be loaded.')),
    ),

  setProvider: async (id: string, connect: boolean) => {
    const statuses = await run(
      () => (connect ? api.connectProvider(id) : api.disconnectProvider(id)),
      connect
        ? t('The integration could not be connected.')
        : t('The integration could not be disconnected.'),
    );
    // Refresh either way: a failed attempt changes the provider's state too.
    if (statuses) queryClient.setQueryData(queryKeys.providers, statuses);
    else void queryClient.invalidateQueries({ queryKey: queryKeys.providers });
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
    return statuses !== null;
  },

  /**
   * Replaces the platform, its scenarios or its policies with these files.
   * What is wrong with them is returned, for the place that asked to show.
   */
  importWorkspace: async (files: WorkspaceFile[]): Promise<WorkspaceStatus | ApiError> => {
    try {
      const workspace = adoptWorkspace(await api.importWorkspace(files));
      useNotices.getState().push('info', t('Now showing the imported files.'));
      return workspace;
    } catch (error) {
      return asApiError(error);
    }
  },

  /** Back to the files the server was started with. */
  resetWorkspace: async (): Promise<WorkspaceStatus | ApiError> => {
    try {
      const workspace = adoptWorkspace(await api.resetWorkspace());
      useNotices.getState().push('info', HOST.backToStart);
      return workspace;
    } catch (error) {
      return asApiError(error);
    }
  },

  evaluate: async (request: EvaluateRequest): Promise<AuthorizationDecision | ApiError> => {
    try {
      const decision = await api.evaluate(request);
      void queryClient.invalidateQueries({ queryKey: queryKeys.decisions });
      useUi.getState().traceDecision(decision);
      useUi.getState().setLastDecision(decision);
      return decision;
    } catch (error) {
      return error instanceof ApiError ? error : new ApiError(0, 'unknown', describe(error));
    }
  },
};

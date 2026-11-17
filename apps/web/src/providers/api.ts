/**
 * Typed REST client for the AEGIS server. Every response is validated against
 * the shared contracts before it reaches the rest of the application.
 *
 * Requests leave through the transport the application was built with: the
 * server over HTTP, or the same engine running in this tab.
 */
import {
  AccessMatrixSchema,
  ApiErrorSchema,
  AuthorizationCatalogSchema,
  AuthorizationDecisionSchema,
  AuthorizationExplanationSchema,
  ControlResponseSchema,
  EventsResponseSchema,
  ExperimentSchema,
  HealthResponseSchema,
  IncidentReportSchema,
  IncidentsResponseSchema,
  IntegrationStatusSchema,
  MetricsReportSchema,
  RecordingSummarySchema,
  ScenariosResponseSchema,
  SessionExportSchema,
  TopologiesResponseSchema,
  TopologySchema,
  WorkspaceBundleSchema,
  WorkspaceCheckSchema,
  WorkspaceDiffSchema,
  WorkspaceResponseSchema,
  WorkspaceStatusSchema,
  type ControlAction,
  type EvaluateRequest,
  type ExperimentRequest,
  type FaultEffect,
  type Recording,
  type WorkspaceFile,
  TrialSchema,
  type TrialRequest,
} from '@aegis/contracts';
import { transport } from '@transport';
import { z } from 'zod';

/** Base URL of the API. Empty means "same origin" (the default). */
export const API_BASE: string = (import.meta.env.VITE_AEGIS_API_URL ?? '').replace(/\/+$/, '');
const PREFIX = '/api/v1';
const TIMEOUT_MS = 8000;
/** For the few requests that simulate or evaluate a great deal before answering. */
const LONG_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE}${PREFIX}${path}`;
}

/** `ws(s)://…/api/v1/stream`, derived from the API base or the page origin. */
export function streamUrl(): string {
  const base = API_BASE === '' ? window.location.origin : API_BASE;
  const url = new URL(`${PREFIX}/stream`, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

async function request<T>(
  schema: z.ZodType<T>,
  path: string,
  body?: unknown,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await transport.fetch(apiUrl(path), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === 'AbortError';
    throw new ApiError(
      0,
      timedOut ? 'timeout' : 'unreachable',
      transport.unanswered(timedOut, cause),
    );
  } finally {
    clearTimeout(timer);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, 'invalid_response', 'The server sent a non-JSON response.');
  }
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'http_error',
      parsed.success ? parsed.data.error.message : `Request failed with HTTP ${response.status}.`,
    );
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(
      response.status,
      'contract_violation',
      `The response for ${path} does not match contract v1.0.`,
    );
  }
  return result.data;
}

export const api = {
  health: () => request(HealthResponseSchema, '/health'),
  topology: () => request(TopologySchema, '/topology'),
  topologies: () => request(TopologiesResponseSchema, '/topologies'),
  metrics: () => request(MetricsReportSchema, '/metrics'),
  events: (afterSeq = 0, limit = 1000) =>
    request(EventsResponseSchema, `/events?afterSeq=${afterSeq}&limit=${limit}`),
  incidents: () => request(IncidentsResponseSchema, '/incidents'),
  /** One incident read back from the record of it: origin, phases, what followed. */
  incidentReport: (incidentId: string) =>
    request(IncidentReportSchema, `/incidents/${encodeURIComponent(incidentId)}/report`),
  scenarios: () => request(ScenariosResponseSchema, '/scenarios'),
  recordings: () => request(z.array(RecordingSummarySchema), '/recordings'),
  providers: () => request(z.array(IntegrationStatusSchema), '/providers'),
  connectProvider: (id: string) =>
    request(z.array(IntegrationStatusSchema), `/providers/${encodeURIComponent(id)}/connect`, {}),
  disconnectProvider: (id: string) =>
    request(
      z.array(IntegrationStatusSchema),
      `/providers/${encodeURIComponent(id)}/disconnect`,
      {},
    ),
  startScenario: (scenarioId: string) =>
    request(ControlResponseSchema, '/demo/scenarios/start', { scenarioId }),
  reset: (scope: 'simulation' | 'scenario') =>
    request(ControlResponseSchema, '/demo/scenarios/reset', { scope }),
  control: (action: ControlAction) =>
    request(ControlResponseSchema, '/demo/playback/control', action),
  /** Places a fault by hand: one scenario effect, outside any scenario. */
  injectFault: (effect: FaultEffect, rampMs: number) =>
    request(ControlResponseSchema, '/demo/faults/inject', { effect, rampMs }),
  /** Lifts what `effect` touches, or with none every fault placed by hand. */
  clearFaults: (effect?: FaultEffect) =>
    request(ControlResponseSchema, '/demo/faults/clear', effect ? { effect } : {}),
  selectTopology: (topologyId: string) =>
    request(ControlResponseSchema, '/demo/topology/select', { topologyId }),
  loadRecording: (recordingId: string) =>
    request(ControlResponseSchema, '/demo/recordings/load', { recordingId }),
  /** The timeline in use as a seed and a command list. */
  session: () => request(SessionExportSchema, '/session'),
  /** Replaces the timeline with the one a recording describes, simulated again. */
  loadSession: (recording: Recording, cursorMs?: number) =>
    request(
      ControlResponseSchema,
      '/demo/session/load',
      cursorMs === undefined ? { recording } : { recording, cursorMs },
      LONG_TIMEOUT_MS,
    ),
  /** Runs a scenario twice from the same seed, once with one fault placed. */
  compareIntervention: (body: ExperimentRequest) =>
    request(ExperimentSchema, '/demo/experiments/compare', body, LONG_TIMEOUT_MS),
  /** One fault tried on the platform at rest. The timeline in use is not touched. */
  tryFault: (body: TrialRequest) =>
    request(TrialSchema, '/demo/experiments/trial', body, LONG_TIMEOUT_MS),
  authorizationCatalog: () => request(AuthorizationCatalogSchema, '/demo/authorization/catalog'),
  authorizationDecisions: () =>
    request(z.array(AuthorizationDecisionSchema), '/demo/authorization/decisions'),
  evaluate: (body: EvaluateRequest) =>
    request(AuthorizationDecisionSchema, '/demo/authorization/evaluate', body),
  /** One request taken policy by policy. Nothing is recorded on the timeline. */
  explain: (body: Omit<EvaluateRequest, 'engine'>) =>
    request(AuthorizationExplanationSchema, '/demo/authorization/explain', body),
  /** Who may do what under one context: every request the catalogue describes. */
  accessMatrix: (body: { context?: Record<string, unknown>; disabledPolicies?: string[] }) =>
    request(AccessMatrixSchema, '/demo/authorization/matrix', body, LONG_TIMEOUT_MS),
  /** The files the platform, its scenarios and its policies come from. */
  workspace: () => request(WorkspaceStatusSchema, '/workspace'),
  exportWorkspace: () => request(WorkspaceBundleSchema, '/workspace/export'),
  /** Says what applying the files would give, without applying them. */
  checkWorkspace: (files: WorkspaceFile[]) =>
    request(WorkspaceCheckSchema, '/demo/workspace/check', { files }),
  /** What Cedar would decide differently under the files, against what is in use. */
  diffWorkspace: (files: WorkspaceFile[]) =>
    request(WorkspaceDiffSchema, '/demo/workspace/diff', { files }, LONG_TIMEOUT_MS),
  importWorkspace: (files: WorkspaceFile[]) =>
    request(WorkspaceResponseSchema, '/demo/workspace/import', { files }),
  /** Back to what the server was started with. */
  resetWorkspace: () => request(WorkspaceResponseSchema, '/demo/workspace/reset', {}),
};

export type AegisApi = typeof api;

/**
 * A session: an experiment someone can open again, or hand to someone else.
 *
 * The engine is deterministic, so what is on screen is described in full by
 * a few things: the platform's files, a seed, the commands issued, where
 * the cursor is and how the model is being looked at. The server writes the
 * timeline out as a seed and a command list (`GET /session`); this module
 * adds the view, and the files when the platform was imported, and reads
 * all of it back. Opening a session simulates it again. Nothing in it
 * states an outcome: a decision or a figure is always the engine's.
 */
import {
  RecordingSchema,
  WorkspaceBundleSchema,
  type Recording,
  type Scenario,
  type SessionExport,
  type WorkspaceBundle,
} from '@aegis/contracts';
import { z } from 'zod';

import { formatClock } from '@/lib/format';
import { api, ApiError } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { LAYOUT_MODES, useUi, type Selection } from '@/stores/ui';

import { actions } from './actions';

/** How the model is being looked at: what a link can carry by itself. */
export const SessionViewSchema = z.object({
  arrangement: z.enum(['layers', 'regions', 'dependencies']).optional(),
  view: z.enum(['scene', 'table']).optional(),
  /** `node:<id>`, `edge:<id>` or `group:<id>`. */
  select: z.string().max(300).optional(),
});
export type SessionView = z.infer<typeof SessionViewSchema>;

export const SessionFileSchema = z.object({
  format: z.literal('aegis-session'),
  version: z.literal(1),
  recording: RecordingSchema,
  /** Where the cursor was. */
  cursorMs: z.number().int().nonnegative().optional(),
  view: SessionViewSchema.optional(),
  /** The platform's files, when it is not the bundled one. */
  workspace: WorkspaceBundleSchema.optional(),
});
export type SessionFile = z.infer<typeof SessionFileSchema>;

/** A link longer than this is refused by some servers and chat tools. */
export const MAX_LINK_CHARS = 6000;
const HASH = '#session=';

export function selectionToText(selection: Selection): string | undefined {
  return selection ? `${selection.kind}:${selection.id}` : undefined;
}

export function selectionFromText(text: string | undefined): Selection {
  const match = /^(node|edge|group):(.+)$/.exec(text ?? '');
  return match ? { kind: match[1] as 'node' | 'edge' | 'group', id: match[2]! } : null;
}

/** The view as it stands. The overview and the 3D model are the defaults and are not written. */
export function currentView(): SessionView {
  const ui = useUi.getState();
  return {
    ...(ui.layoutMode !== 'layers' ? { arrangement: ui.layoutMode } : {}),
    ...(ui.viewMode !== 'scene' ? { view: ui.viewMode } : {}),
    ...(ui.selection ? { select: selectionToText(ui.selection) } : {}),
  };
}

/**
 * Applies a view. A selection names a service of one platform: it is made
 * only if the platform on screen has it.
 */
export function applyView(view: SessionView): void {
  const ui = useUi.getState();
  const { topology } = useTelemetry.getState();
  if (view.view) ui.setViewMode(view.view);
  const arrangement = LAYOUT_MODES.find((mode) => mode === view.arrangement);
  if (arrangement && arrangement !== ui.layoutMode) ui.setLayoutMode(arrangement);
  const selection = selectionFromText(view.select);
  if (!selection || !topology) return;
  const exists =
    selection.kind === 'edge'
      ? topology.edges.some((edge) => edge.id === selection.id)
      : selection.kind === 'node'
        ? topology.nodes.some((node) => node.id === selection.id)
        : // A kind of service: a piece of the overview.
          topology.nodes.some((node) => `kind:${node.serviceType}` === selection.id);
  if (exists) useUi.getState().select(selection);
}

/**
 * Puts the view as a session saved it. A view is written without what is
 * the default (the overview, the model, nothing selected), so what a
 * session does not say is set back to that: opening one shows what its
 * author was looking at, not what happened to be on this screen.
 */
export function restoreView(view: SessionView): void {
  const ui = useUi.getState();
  ui.setViewMode(view.view ?? 'scene');
  if (ui.selection) ui.select(null);
  applyView({ arrangement: 'layers', ...view });
}

export function composeSession(
  exported: SessionExport,
  view: SessionView,
  workspace?: WorkspaceBundle,
): SessionFile {
  return {
    format: 'aegis-session',
    version: 1,
    recording: exported.recording,
    cursorMs: exported.cursorMs,
    ...(Object.keys(view).length > 0 ? { view } : {}),
    ...(workspace ? { workspace } : {}),
  };
}

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/**
 * The session as the fragment of a link, or why it cannot be one. The
 * fragment is not sent to any server: it is read by the page that opens it.
 */
export function sessionLink(session: SessionFile, base: string): string | { reason: string } {
  if (session.workspace) {
    return { reason: 'This platform was imported; a link cannot carry its files. Save the file.' };
  }
  const url = `${base.replace(/#.*$/, '')}${HASH}${toBase64Url(JSON.stringify(session))}`;
  return url.length > MAX_LINK_CHARS
    ? { reason: 'This session holds too many commands for a link. Save the file.' }
    : url;
}

export type Parsed = { session: SessionFile } | { problem: string };

/** Reads a session from the text of a file. */
export function parseSession(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problem: 'This is not a session file: it is not JSON.' };
  }
  const result = SessionFileSchema.safeParse(raw);
  if (!result.success) {
    return {
      problem:
        typeof raw === 'object' &&
        raw !== null &&
        (raw as { format?: unknown }).format === 'aegis-session'
          ? `This session file is not in a format this version reads: ${z.prettifyError(result.error)}`
          : 'This is not a session file. One is saved from “Save or share this session”.',
    };
  }
  return { session: result.data };
}

/** Reads the session a link carries, if the address has one. */
export function sessionFromHash(hash: string): Parsed | null {
  if (!hash.startsWith(HASH)) return null;
  try {
    return parseSession(fromBase64Url(hash.slice(HASH.length)));
  } catch {
    return { problem: 'The session in this link is damaged and cannot be read.' };
  }
}

/** What a session holds, in lines someone can check before opening it. */
export function describeSession(recording: Recording, scenarios: Scenario[] = []): string[] {
  const name = (id: string) => scenarios.find((scenario) => scenario.id === id)?.name ?? id;
  const lines = recording.commands.map(({ atMs, command }) => {
    const at = formatClock(atMs);
    switch (command.type) {
      case 'startScenario':
        return `${at} starts ${name(command.scenarioId)}`;
      case 'abortScenario':
        return `${at} stops the running scenario`;
      case 'injectFault':
        return `${at} places a fault by hand (${String(command.effect.type)})`;
      case 'clearFaults':
        return `${at} lifts ${command.effect ? 'a fault' : 'every fault'} placed by hand`;
    }
  });
  return lines.length > 0 ? lines : ['No command: time simply passes.'];
}

/**
 * Opens a session: puts its files in place if it carries any, has the
 * engine simulate its timeline again, then restores the view. Returns what
 * went wrong, or `null`.
 */
export async function openSession(session: SessionFile): Promise<string | null> {
  if (session.workspace) {
    const imported = await actions.importWorkspace(session.workspace.files);
    if (imported instanceof ApiError)
      return `Its platform could not be imported. ${imported.message}`;
  }
  try {
    const { playback } = await api.loadSession(session.recording, session.cursorMs);
    useTelemetry.getState().setPlayback(playback);
  } catch (error) {
    return error instanceof ApiError ? error.message : 'The session could not be loaded.';
  }
  // The stream announces the new timeline and the topology is fetched
  // again; the view is put back on the platform the session names. A
  // session that says nothing of the view was saved on the default one.
  const view = session.view ?? {};
  const ready = () => useTelemetry.getState().topology?.id === session.recording.topologyId;
  if (ready()) restoreView(view);
  else {
    const stop = useTelemetry.subscribe(() => {
      if (!ready()) return;
      stop();
      restoreView(view);
    });
    setTimeout(stop, 10_000);
  }
  return null;
}

/**
 * Into the editor and out of it.
 *
 * The draft is one topology file among the files in use. It is asked about
 * and applied with all of them, the one it was drawn from replaced by it,
 * so what the engine says of it at rest is what applying it would give:
 * the same policies, the same catalogue, the same other platforms. The
 * files in use are read once, when the editor opens, and kept with it.
 */
import type { WorkspaceFile } from '@aegis/contracts';

import { actions } from '@/app/actions';
import { leaveCapture } from '@/app/captureUrl';
import { downloadJson } from '@/features/workspace/files';
import { t } from '@/i18n';
import {
  blankTopology,
  draftFromFile,
  draftText,
  draftToFile,
  uniqueId,
  type TopologyDraft,
} from '@/lib/topologyFile';
import { api, ApiError } from '@/providers/api';
import {
  blankScenario,
  draftFromFile as scenarioFromFile,
  draftToFile as scenarioToFile,
  type ScenarioDraft,
} from '@/lib/scenarioFile';
import { useCapture } from '@/stores/capture';
import { useEditor, type EditorTab, type Origin } from '@/stores/editor';
import { useIncident } from '@/stores/incident';
import { useNotices } from '@/stores/notices';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

/** The files in use when the editor opened, and which of them the draft replaces. */
let base: { files: WorkspaceFile[]; replaces: string | null } = { files: [], replaces: null };

const isTopologyPath = (path: string) => /(^|\/)topologies\/[^/]+$/.test(path);

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The topology id a file states, when it is a topology file written as JSON. */
function idOf(file: WorkspaceFile): string | null {
  const json = parsed(file.text);
  const read = json ? draftFromFile(json) : null;
  return read ? read.id : null;
}

/**
 * The files to ask about and to apply: those in use, with the one the
 * draft was drawn from replaced by it. A draft drawn from a Compose file or
 * an inventory is written as JSON in its place.
 */
export function withDraft(draft: TopologyDraft): WorkspaceFile[] {
  const text = draftText(draft);
  const from = base.replaces;
  let path = `${from?.replace(/\.[^./]+$/, '') ?? `topologies/${draft.id}`}.json`;
  // A new platform never takes the place of a file that is another one.
  if (from === null && base.files.some((file) => file.path === path)) {
    path = `topologies/${draft.id}-drawn.json`;
  }
  const kept = base.files.filter((file) => file.path !== from && file.path !== path);
  return [...kept, { path, text }];
}

/** Closes what the simulation has open over the stage, so the editor has it to itself. */
function clearStage(): void {
  const ui = useUi.getState();
  ui.setPanel(null);
  ui.select(null);
  ui.setExplorerOpen(false);
  ui.setInspectorOpen(false);
  if (useCapture.getState().capture) leaveCapture();
}

async function filesInUse(): Promise<WorkspaceFile[] | null> {
  try {
    return (await api.exportWorkspace()).files;
  } catch (error) {
    useNotices
      .getState()
      .push(
        'error',
        error instanceof ApiError ? error.message : t('The files in use could not be read.'),
      );
    return null;
  }
}

/** Opens the editor on a draft, with the files in use as what it is laid among. */
function begin(
  draft: TopologyDraft,
  origin: Origin,
  files: WorkspaceFile[],
  replaces: string | null,
  tab: EditorTab = 'platform',
) {
  base = { files, replaces };
  clearStage();
  useIncident.getState().close();
  useEditor.getState().open(draft, origin, tab);
  if (tab === 'incident') useIncident.getState().open(blankScenario(''), false);
}

/**
 * The platform on show, as its file says it. A platform read from a
 * Compose file or a cloud inventory is the topology the server read it as.
 */
export async function editPlatformInUse(tab: EditorTab = 'platform'): Promise<boolean> {
  const active = useTelemetry.getState().topology?.id;
  const files = await filesInUse();
  if (!files || !active) return false;
  const topologies = files.filter((file) => isTopologyPath(file.path));
  const own = topologies.find((file) => idOf(file) === active);
  if (own) {
    const draft = draftFromFile(parsed(own.text));
    if (draft) {
      begin(draft, { kind: 'in-use', name: draft.name }, files, own.path, tab);
      return true;
    }
  }
  // Not a topology file as such: ask the server what it read each of the others as.
  for (const file of topologies) {
    if (idOf(file) !== null) continue;
    try {
      const preview = await api.previewWorkspace([file]);
      const draft = draftFromFile(preview.spec);
      if (draft && draft.id === active) {
        begin(draft, { kind: 'in-use', name: draft.name }, files, file.path, tab);
        return true;
      }
    } catch {
      // A file that is not a platform on its own: not the one on show.
    }
  }
  // A platform no file in use describes (the generated stress platform):
  // what the server runs is still a topology it can write out.
  try {
    const preview = await api.previewWorkspace(files, active);
    const draft = draftFromFile(preview.spec);
    if (draft) {
      begin(draft, { kind: 'in-use', name: draft.name }, files, null, tab);
      return true;
    }
  } catch (error) {
    useNotices
      .getState()
      .push(
        'error',
        error instanceof ApiError ? error.message : t('The platform could not be read.'),
      );
  }
  return false;
}

/** A platform of one region and a client, to draw from nothing. */
export async function editBlankPlatform(): Promise<boolean> {
  const files = await filesInUse();
  if (!files) return false;
  const draft = blankTopology();
  const taken = files.flatMap((file) => (isTopologyPath(file.path) ? [idOf(file) ?? ''] : []));
  draft.id = uniqueId(draft.id, taken);
  begin(draft, { kind: 'blank', name: draft.name }, files, null);
  return true;
}

/**
 * A topology file to edit: a JSON topology as written, or any file the
 * server reads as one (a Compose file, a cloud inventory), as it reads it.
 */
export async function editFile(file: WorkspaceFile): Promise<boolean> {
  const files = await filesInUse();
  if (!files) return false;
  const name = file.path.split('/').pop() ?? file.path;
  let draft = (() => {
    const json = parsed(file.text);
    return json ? draftFromFile(json) : null;
  })();
  if (!draft) {
    try {
      draft = draftFromFile((await api.previewWorkspace([file])).spec);
    } catch (error) {
      useNotices
        .getState()
        .push(
          'error',
          error instanceof ApiError
            ? error.message
            : t('{name} is not a platform the editor can open.', { name }),
        );
      return false;
    }
  }
  if (!draft) return false;
  const replaced = files.find((entry) => isTopologyPath(entry.path) && idOf(entry) === draft.id);
  begin(draft, { kind: 'file', name }, files, replaced?.path ?? null);
  return true;
}

/** Saves the draft as a topology file. */
export function saveDraft(): void {
  const draft = useEditor.getState().draft;
  if (draft) downloadJson(draftToFile(draft), `${draft.id}.json`);
}

/** Hands the draft to the import dialog, where an incident can be run on it and on the platform in use. */
export function stageDraft(): void {
  const draft = useEditor.getState().draft;
  if (!draft) return;
  useUi.getState().offerImport(withDraft(draft), []);
}

/**
 * Puts the draft in use: the files in use with it in place, applied as an
 * import is, and the platform it describes put on show. The simulation
 * starts a new timeline, for everyone connected, as any import does.
 */
export async function applyDraft(): Promise<string | null> {
  const draft = useEditor.getState().draft;
  if (!draft) return null;
  const outcome = await actions.importWorkspace(withDraft(draft));
  if (outcome instanceof ApiError) return outcome.message;
  if (useTelemetry.getState().topology?.id !== draft.id) await actions.selectTopology(draft.id);
  leaveEditor();
  return null;
}

export function leaveEditor(): void {
  base = { files: [], replaces: null };
  useIncident.getState().close();
  useEditor.getState().close();
}

// ---------------------------------------------------------------------------
// The incident written on the platform
// ---------------------------------------------------------------------------

const isScenarioPath = (path: string) => /(^|\/)scenarios\/[^/]+\.json$/.test(path);

/** The scenarios in use, as files, to start a new one from a copy of. */
export function scenariosInUse(): WorkspaceFile[] {
  return base.files.filter((file) => isScenarioPath(file.path));
}

/**
 * Writes an incident on the platform in use: the editor opened on that
 * platform, on its incident, with a blank scenario in hand.
 */
export function writeIncident(): Promise<boolean> {
  return editPlatformInUse('incident');
}

/** Puts the incident in hand: the scenario already being written, or a blank one. */
export function openIncident(): void {
  if (!useIncident.getState().scenario) useIncident.getState().open(blankScenario(''), false);
  useEditor.getState().setTab('incident');
}

/** Starts again from a blank scenario, or from a copy of one in use (by its path). */
export function startIncidentFrom(path: string): string | null {
  if (path === '') {
    useIncident.getState().open(blankScenario(''), false);
    return null;
  }
  const file = scenariosInUse().find((entry) => entry.path === path);
  const read = file ? scenarioFromFile(parsed(file.text)) : null;
  if (!read) return t('That file could not be read as a scenario.');
  // A copy, so the scenario it was read from is not replaced by accident.
  useIncident.getState().open(
    {
      ...read,
      id: `${read.id}-copy`.slice(0, 64),
      name: t('{name} (copy)', { name: read.name }),
    },
    true,
  );
  return null;
}

/** The scenario as its file is written. */
export const scenarioText = (scenario: ScenarioDraft): string =>
  `${JSON.stringify(scenarioToFile(scenario), null, 2)}\n`;

/**
 * The files an incident is checked and run with: those in use, with the
 * platform as drawn in place of its file (the files in use as they are,
 * while the platform in use is unchanged), and the scenario added or put in
 * place of the one with its id. Scenarios are listed in file-name order: a
 * new one goes last.
 */
export function withIncident(scenario: ScenarioDraft): WorkspaceFile[] {
  const { draft, origin, past } = useEditor.getState();
  const platform =
    !draft || (origin?.kind === 'in-use' && past.length === 0) ? base.files : withDraft(draft);
  const text = scenarioText(scenario);
  const same = platform.find(
    (file) => isScenarioPath(file.path) && scenarioFromFile(parsed(file.text))?.id === scenario.id,
  );
  if (same) return platform.map((file) => (file === same ? { ...file, text } : file));
  return [...platform, { path: `scenarios/zz-${scenario.id}.json`, text }];
}

/** Saves the scenario as a file. */
export function saveIncident(): void {
  const scenario = useIncident.getState().scenario;
  if (scenario) downloadJson(scenarioToFile(scenario), `${scenario.id}.json`);
}

/**
 * Runs the incident: the files in use with the platform as drawn and the
 * scenario in, applied as an import is, the platform put on show and the
 * scenario started. The simulation starts a new timeline, for everyone
 * connected, as any import does.
 */
export async function runIncident(): Promise<string | null> {
  const draft = useEditor.getState().draft;
  const scenario = useIncident.getState().scenario;
  if (!draft || !scenario) return null;
  const outcome = await actions.importWorkspace(withIncident(scenario));
  if (outcome instanceof ApiError) return outcome.message;
  if (useTelemetry.getState().topology?.id !== draft.id) await actions.selectTopology(draft.id);
  // One that does not start has said so; the editor stays, with the incident in hand.
  if (!(await actions.startScenario(scenario.id))) return null;
  leaveEditor();
  useUi.getState().setLeftTab('incidents');
  return null;
}

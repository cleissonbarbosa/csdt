/**
 * One scenario on two platforms: what the answer states, counted and named.
 *
 * The server runs a scenario on the platform in use and on the one a set of
 * files describes (`/demo/experiments/platforms`) and lists what the two
 * descriptions state differently, as the files wrote it. Nothing about
 * either platform is worked out here: these helpers count that list, say
 * which name a service goes by on each side, and pick the platform and the
 * scenarios a comparison can be asked about.
 */
import type {
  PlatformChanges,
  PlatformComparison,
  Scenario,
  WorkspaceStatus,
} from '@aegis/contracts';

import { t } from '@/i18n';

/** A value as a file wrote it. A field the file left out is said to be so. */
export function written(value: unknown): string {
  if (value === null || value === undefined) return t('not stated');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** How many things the two descriptions state differently. */
export function statedDifferently(changes: PlatformChanges): number {
  return (
    changes.servicesAdded.length +
    changes.servicesRemoved.length +
    changes.servicesChanged.length +
    changes.connectionsAdded.length +
    changes.connectionsRemoved.length +
    changes.connectionsChanged.length +
    changes.regionsAdded.length +
    changes.regionsRemoved.length +
    changes.regionsChanged.length +
    changes.roles.length
  );
}

/**
 * Whether the two sides are one: the same platform, described the same,
 * with Cedar answering the same. Then the two runs can only be one run.
 */
export function sameOnBothSides(
  comparison: Pick<PlatformComparison, 'base' | 'candidate' | 'changes' | 'decisionsChanged'>,
): boolean {
  return (
    comparison.base.id === comparison.candidate.id &&
    comparison.base.name === comparison.candidate.name &&
    statedDifferently(comparison.changes) === 0 &&
    !comparison.decisionsChanged
  );
}

/**
 * The names the files give to services the platform in use does not have,
 * or has under another name: what a service of run B is called where the
 * topology in use cannot say.
 */
export function namesInFiles(changes: PlatformChanges): Map<string, string> {
  const names = new Map<string, string>();
  for (const service of changes.servicesAdded) names.set(service.id, service.name);
  for (const service of changes.servicesChanged) {
    const renamed = service.fields.find((entry) => entry.field === 'name');
    if (typeof renamed?.candidate === 'string') names.set(service.id, renamed.candidate);
  }
  return names;
}

/**
 * The platform of the files a comparison runs on when none is chosen: the
 * one with the id in use if the files have it, and the one they open on
 * otherwise. The server chooses the same way.
 */
export function platformOfFiles(files: WorkspaceStatus, inUse: string | undefined): string {
  return files.topologies.some((topology) => topology.id === inUse) && inUse !== undefined
    ? inUse
    : files.defaultTopologyId;
}

/**
 * The scenarios that can be run on both sides: able to run on the platform
 * in use, among the files, and able to run on the platform of the files.
 * Whether a scenario is written the same on both is the server's to say.
 */
export function runnableOnBoth(
  inUse: readonly Scenario[],
  files: WorkspaceStatus,
  platform: string,
): Scenario[] {
  return inUse.filter(
    (scenario) =>
      scenario.available &&
      files.scenarioIds.includes(scenario.id) &&
      !files.unavailable.some(
        (entry) => entry.scenarioId === scenario.id && entry.topologyId === platform,
      ),
  );
}

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
  FieldChange,
  PlatformChanges,
  PlatformComparison,
  Scenario,
  Topology,
  WorkspaceStatus,
} from '@aegis/contracts';

import { t } from '@/i18n';

import { onlyLines, provenanceLine, runsLines } from './experiment';
import { formatRate } from './format';
import { nodeLabel } from './names';

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

function fieldsText(fields: readonly FieldChange[]): string {
  return fields
    .map((entry) => `${entry.field} ${written(entry.base)} → ${written(entry.candidate)}`)
    .join('; ');
}

/**
 * A comparison of platforms as plain text, to paste into a review of the
 * incident: what the two descriptions state differently, what follows from
 * that without being stated, and the two runs figure by figure.
 */
export function platformsText(comparison: PlatformComparison, topology: Topology | null): string {
  const { changes, base, candidate } = comparison;
  const count = (n: number) => t(n === 1 ? '{n} service' : '{n} services', { n });
  const indent = (line: string) => `  ${line}`;
  const named = (entry: { id: string; name: string }) => `${entry.name} (${entry.id})`;
  const link = (entry: { source: string; target: string }) => `${entry.source} → ${entry.target}`;
  const lines = [
    t('{scenario}: one incident on two platforms', { scenario: comparison.scenarioName }),
    provenanceLine(base.name),
    '',
    t(
      'A is {base}, in use ({services}). B is {candidate}, as the files describe it ({others}). Both runs are {scenario} with seed {seed}.',
      {
        base: base.name,
        candidate: candidate.name,
        services: count(base.nodeCount),
        others: count(candidate.nodeCount),
        scenario: comparison.scenarioName,
        seed: comparison.seed,
      },
    ),
    '',
    t('What differs'),
  ];
  const listed: [string, string[]][] = [
    [t('Services added'), changes.servicesAdded.map(named)],
    [t('Services removed'), changes.servicesRemoved.map(named)],
    [
      t('Services described differently'),
      changes.servicesChanged.map((entry) => `${named(entry)}: ${fieldsText(entry.fields)}`),
    ],
    [t('Connections added'), changes.connectionsAdded.map(link)],
    [t('Connections removed'), changes.connectionsRemoved.map(link)],
    [
      t('Connections described differently'),
      changes.connectionsChanged.map((entry) => `${link(entry)}: ${fieldsText(entry.fields)}`),
    ],
    [t('Regions added'), changes.regionsAdded.map(named)],
    [t('Regions removed'), changes.regionsRemoved.map(named)],
    [
      t('Regions described differently'),
      changes.regionsChanged.map((entry) => `${named(entry)}: ${fieldsText(entry.fields)}`),
    ],
    [
      t('Roles'),
      changes.roles.map(
        (entry) =>
          `${entry.role}: ${entry.base ?? t('nothing')} → ${entry.candidate ?? t('nothing')}`,
      ),
    ],
  ];
  const stated = listed.filter(([, entries]) => entries.length > 0);
  if (stated.length === 0) {
    lines.push(indent(t('The files describe the platform in use as it is.')));
  }
  for (const [title, entries] of stated) {
    lines.push(indent(title));
    for (const entry of entries) lines.push(indent(indent(entry)));
  }
  if (comparison.decisionsChanged) {
    lines.push(indent(t('Cedar also answers the simulation differently under these files.')));
  }
  if (changes.derivedCapacity.length > 0 || comparison.prescribed.length > 0) {
    lines.push('', t('What follows without being stated'));
    if (changes.derivedCapacity.length > 0) {
      lines.push(indent(t('Capacity the model works with')));
      for (const entry of changes.derivedCapacity) {
        lines.push(
          indent(
            indent(
              t('{service}: {base} req/s in A, {candidate} req/s in B', {
                service: named(entry),
                base: formatRate(entry.base),
                candidate: formatRate(entry.candidate),
              }),
            ),
          ),
        );
      }
    }
    if (comparison.prescribed.length > 0) {
      lines.push(indent(t('What the scenario prescribes')));
      for (const entry of comparison.prescribed) {
        const said = (effects: typeof entry.base) =>
          effects.length === 0
            ? t('nothing')
            : effects.map((effect) => effect.description).join('; ');
        lines.push(indent(indent(entry.phase)));
        lines.push(indent(indent(indent(`A ${said(entry.base)}`))));
        lines.push(indent(indent(indent(`B ${said(entry.candidate)}`))));
      }
    }
  }
  if (!sameOnBothSides(comparison)) {
    lines.push(
      '',
      t(
        'Two runs do not say which of these differences an outcome follows from. To see what one of them does, change that one alone.',
      ),
    );
  }
  const ofFiles = namesInFiles(changes);
  lines.push(
    '',
    t('The two runs (A in use, B with these files)'),
    ...runsLines(comparison).map(indent),
    ...onlyLines(comparison, (id, run) =>
      run === 'b' && ofFiles.has(id) ? ofFiles.get(id)! : nodeLabel(topology, id),
    ).map(indent),
  );
  return lines.join('\n');
}

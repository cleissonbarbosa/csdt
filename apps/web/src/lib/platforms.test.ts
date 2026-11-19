import { describe, expect, it } from 'vitest';

import { platformComparison, scenarios, workspace } from '@/test/fixtures';

import {
  namesInFiles,
  platformOfFiles,
  runnableOnBoth,
  sameOnBothSides,
  statedDifferently,
  written,
} from './platforms';

const comparison = platformComparison();

describe('what two descriptions of a platform state differently', () => {
  it('is counted from the lists, leaving out what only follows', () => {
    // The exporter's file: one service changed and one added, one connection
    // changed and two added, one role added.
    expect(statedDifferently(comparison.changes)).toBe(6);
    expect(comparison.changes.derivedCapacity.length).toBeGreaterThan(0);
    const none = Object.fromEntries(
      Object.keys(comparison.changes).map((list) => [list, []]),
    ) as unknown as typeof comparison.changes;
    expect(statedDifferently(none)).toBe(0);
    // A capacity that only follows is not something a file states.
    expect(
      statedDifferently({ ...none, derivedCapacity: comparison.changes.derivedCapacity }),
    ).toBe(0);
  });

  it('is nothing only when the platform, its description and Cedar are the same', () => {
    expect(sameOnBothSides(comparison)).toBe(false);
    const none = Object.fromEntries(
      Object.keys(comparison.changes).map((list) => [list, []]),
    ) as unknown as typeof comparison.changes;
    const same = { ...comparison, candidate: comparison.base, changes: none };
    expect(sameOnBothSides(same)).toBe(true);
    expect(sameOnBothSides({ ...same, decisionsChanged: true })).toBe(false);
    expect(sameOnBothSides({ ...same, candidate: { ...comparison.base, id: 'another' } })).toBe(
      false,
    );
  });

  it('writes a value as the file did, and says when the file left it out', () => {
    expect(written(7300)).toBe('7300');
    expect(written(0.14)).toBe('0.14');
    expect(written('microservice')).toBe('microservice');
    expect(written(null)).toBe('not stated');
    expect(written(undefined)).toBe('not stated');
    expect(written({ a: 1 })).toBe('{"a":1}');
  });

  it('names a service of the files where the platform in use cannot', () => {
    const names = namesInFiles(comparison.changes);
    expect(names.get('use-loyalty')).toBe('Loyalty');
    // The gateway changed in capacity, not in name.
    expect(names.has('use-gateway')).toBe(false);
    const renamed = namesInFiles({
      ...comparison.changes,
      servicesChanged: [
        {
          id: 'use-gateway',
          name: 'API Gateway',
          fields: [{ field: 'name', base: 'API Gateway', candidate: 'Front door' }],
        },
      ],
    });
    expect(renamed.get('use-gateway')).toBe('Front door');
  });
});

describe('what a comparison can be asked about', () => {
  const files = workspace();

  it('runs on the platform with the id in use, or the one the files open on', () => {
    expect(files.topologies.map((topology) => topology.id)).toContain('hyperscale-stress');
    expect(platformOfFiles(files, 'hyperscale-stress')).toBe('hyperscale-stress');
    expect(platformOfFiles(files, 'elsewhere')).toBe(files.defaultTopologyId);
    expect(platformOfFiles(files, undefined)).toBe(files.defaultTopologyId);
  });

  it('offers a scenario only if it can run on both sides', () => {
    const inUse = scenarios().scenarios;
    const platform = files.defaultTopologyId;
    expect(runnableOnBoth(inUse, files, platform).map((entry) => entry.id)).toEqual(
      inUse.map((entry) => entry.id),
    );
    const [first, second] = inUse;
    if (!first || !second) throw new Error('the sample has fewer than two scenarios');
    // Not able to run in use.
    expect(
      runnableOnBoth([{ ...first, available: false }, second], files, platform).map(
        (entry) => entry.id,
      ),
    ).toEqual([second.id]);
    // Not among the files.
    expect(
      runnableOnBoth(inUse, { ...files, scenarioIds: [second.id] }, platform).map(
        (entry) => entry.id,
      ),
    ).toEqual([second.id]);
    // Among them, and not able to run on the platform chosen.
    const unable = {
      ...files,
      unavailable: [{ topologyId: platform, scenarioId: first.id, reason: 'no such role' }],
    };
    expect(runnableOnBoth(inUse, unable, platform).map((entry) => entry.id)).not.toContain(
      first.id,
    );
    expect(runnableOnBoth(inUse, unable, 'another').map((entry) => entry.id)).toContain(first.id);
  });
});

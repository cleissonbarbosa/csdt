import { describe, expect, it } from 'vitest';

import { platformComparison, scenarios, workspace } from '@/test/fixtures';

import {
  namesInFiles,
  platformOfFiles,
  platformsText,
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

describe('a comparison of platforms as text', () => {
  const text = platformsText(comparison, null);
  const lines = text.split('\n');

  it('says where its figures come from before anything else', () => {
    expect(lines[0]).toBe('DDoS Surge: one incident on two platforms');
    expect(lines[1]).toBe(
      'Simulated on Helios Commerce. Every figure comes from the AEGIS simulation engine; none is measured from a real system.',
    );
  });

  it('holds what differs as the files wrote it, and what follows from it', () => {
    expect(text).toContain('    API Gateway (use-gateway): capacityRps not stated → 7300');
    expect(text).toContain('    Loyalty (use-loyalty)');
    expect(text).toContain('    use-gateway → use-search: weight 0.14 → 0.1');
    expect(text).toContain('    resource:Loyalty: nothing → use-loyalty');
    expect(text).toContain('What follows without being stated');
    expect(text).toContain('      A injected traffic “Volumetric flood” at 5360 req/s');
    expect(text).toContain('      B injected traffic “Volumetric flood” at 16060 req/s');
    expect(text).toContain('Two runs do not say which of these differences');
  });

  it('holds the two runs figure by figure, each as the page shows it', () => {
    const start = lines.indexOf('The two runs (A in use, B with these files)');
    expect(start).toBeGreaterThan(0);
    const rows = lines.slice(start + 1).filter((line) => line.includes(': A '));
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows[0]).toMatch(
      /^ {2}Highest error rate: A [\d.]+%; B [\d.]+%; B against A \+[\d.]+ pts$/,
    );
    // A service only the files have goes by the name they give it.
    expect(lines.at(-1)).toMatch(/^ {2}Affected only in B: .*Loyalty\.$/);
  });

  it('says so when the files describe the platform in use', () => {
    const none = Object.fromEntries(
      Object.keys(comparison.changes).map((list) => [list, []]),
    ) as unknown as typeof comparison.changes;
    const same = platformsText(
      { ...comparison, candidate: comparison.base, changes: none, prescribed: [] },
      null,
    );
    expect(same).toContain('  The files describe the platform in use as it is.');
    expect(same).not.toContain('What follows without being stated');
    expect(same).not.toContain('Two runs do not say');
  });
});

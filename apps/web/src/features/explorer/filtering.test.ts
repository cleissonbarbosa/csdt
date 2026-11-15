import { describe, expect, it } from 'vitest';

import { EMPTY_FILTERS, type Filters } from '@/stores/ui';
import { snapshot, topology } from '@/test/fixtures';

import { computeVisibilityMask, matchesSearch, nodeHealth } from './filtering';

const helios = topology();
const live = snapshot();
const filters = (patch: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...patch });
const visibleIds = (f: Filters) => {
  const mask = computeVisibilityMask(helios, live, f);
  return helios.nodes.filter((_, i) => mask === null || mask[i] === 1).map((n) => n.id);
};

describe('explorer filtering', () => {
  it('returns no mask when nothing is filtered', () => {
    expect(computeVisibilityMask(helios, live, EMPTY_FILTERS)).toBeNull();
    expect(computeVisibilityMask(helios, live, filters({ search: '   ' }))).toBeNull();
  });

  it('searches name, id, region and type, requiring every term', () => {
    const gateway = helios.nodes.find((n) => n.id === 'use-gateway')!;
    expect(matchesSearch(gateway, 'gateway')).toBe(true);
    expect(matchesSearch(gateway, 'API us-east')).toBe(true);
    expect(matchesSearch(gateway, 'gateway eu-west')).toBe(false);
    expect(visibleIds(filters({ search: 'cedar' }))).toEqual([
      'use-cedar',
      'euw-cedar',
      'aps-cedar',
    ]);
    expect(visibleIds(filters({ search: 'no-such-thing' }))).toEqual([]);
  });

  it('filters by service type and region together', () => {
    const ids = visibleIds(filters({ types: ['database'], regions: ['eu-west'] }));
    expect(ids).toEqual(['euw-orders-db', 'euw-catalog-db', 'euw-sessions']);
  });

  it('filters by live health, not the health the topology was loaded with', () => {
    const critical = visibleIds(filters({ health: ['critical'] }));
    expect(critical).toContain('use-auth');
    for (const id of critical) {
      const index = helios.nodes.findIndex((n) => n.id === id);
      expect(nodeHealth(helios, live, index)).toBe('critical');
    }
    const healthy = visibleIds(filters({ health: ['healthy'] }));
    expect(healthy).not.toContain('use-auth');
    expect(healthy.length + critical.length).toBeLessThanOrEqual(helios.nodes.length);
  });

  it('can show only what the active incident touched', () => {
    const impacted = live.incident?.impactedNodeIds ?? [];
    expect(impacted.length).toBeGreaterThan(0);
    expect(visibleIds(filters({ impactedOnly: true })).sort()).toEqual([...impacted].sort());
    expect(
      computeVisibilityMask(helios, null, filters({ impactedOnly: true }))?.some((v) => v === 1),
    ).toBe(false);
  });
});

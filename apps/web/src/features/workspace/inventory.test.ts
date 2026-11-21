import { describe, expect, it } from 'vitest';

import {
  EVERYTHING,
  asksForEverything,
  drawsNetworkRules,
  toggled,
  withExcluded,
  withNetworkRules,
  withSelection,
  withTag,
} from './inventory';

const INVENTORY = {
  kind: 'aegis-cloud-inventory',
  version: 1,
  provider: 'aws',
  name: 'shop',
  resources: [
    { id: 'door', name: 'Door', type: 'api-gateway', native: 'x', region: 'sa-east-1' },
    { id: 'desk', name: 'Desk', type: 'container', native: 'x', region: 'sa-east-1' },
  ],
  relations: [{ from: 'door', to: 'desk', basis: 'routing', evidence: 'target group desk' }],
  notes: ['Fictional.'],
};
const FILE = JSON.stringify(INVENTORY);

describe('the selection an inventory file carries', () => {
  it('is written into the file, and nothing else of the file changes', () => {
    const text = withSelection(FILE, {
      ...EVERYTHING,
      regions: ['sa-east-1'],
      networks: ['shop', null],
      connectedOnly: true,
      exclude: ['desk'],
    });
    const { selection, ...rest } = JSON.parse(text) as Record<string, unknown>;
    // Only what was asked for is written: what asks for everything is left unsaid.
    expect(selection).toEqual({
      regions: ['sa-east-1'],
      networks: ['shop', null],
      connectedOnly: true,
      exclude: ['desk'],
    });
    expect(rest).toEqual(INVENTORY);
  });

  it('is taken out of the file when it asks for everything', () => {
    const narrowed = withSelection(FILE, { ...EVERYTHING, kinds: ['database'] });
    expect(JSON.parse(narrowed)).toHaveProperty('selection');
    const whole = withSelection(narrowed, EVERYTHING);
    expect(JSON.parse(whole)).toEqual(INVENTORY);
    expect(asksForEverything(EVERYTHING)).toBe(true);
    expect(asksForEverything({ ...EVERYTHING, name: 'db' })).toBe(false);
    expect(asksForEverything({ ...EVERYTHING, bases: ['routing'] })).toBe(false);
    // A name that is only spaces asks for nothing.
    expect(JSON.parse(withSelection(FILE, { ...EVERYTHING, name: '  ' }))).toEqual(INVENTORY);
  });

  it('leaves a file it cannot read as it found it', () => {
    for (const text of ['{ not json', '[1, 2]', '"words"', 'null']) {
      expect(withSelection(text, { ...EVERYTHING, connectedOnly: true })).toBe(text);
    }
  });
});

describe('choosing from what a survey lists', () => {
  it('starts from everything: the first chip chooses, the last one put back asks for all', () => {
    expect(toggled(null, 'sa-east-1')).toEqual(['sa-east-1']);
    expect(toggled(['sa-east-1'], 'us-east-1')).toEqual(['sa-east-1', 'us-east-1']);
    expect(toggled(['sa-east-1', 'us-east-1'], 'sa-east-1')).toEqual(['us-east-1']);
    expect(toggled(['us-east-1'], 'us-east-1')).toBeNull();
    // What is in no network is a choice like any other.
    expect(toggled<string | null>(['shop'], null)).toEqual(['shop', null]);
    expect(toggled<string | null>([null], null)).toBeNull();
  });

  it('asks for a tag by one of its values, or by the key alone', () => {
    const prod = withTag([], 'env', 'prod');
    expect(prod).toEqual([{ key: 'env', values: ['prod'] }]);
    const both = withTag(prod, 'env', 'staging');
    expect(both).toEqual([{ key: 'env', values: ['prod', 'staging'] }]);
    expect(withTag(both, 'env', 'prod')).toEqual([{ key: 'env', values: ['staging'] }]);
    // The last value put back takes the tag out of the question.
    expect(withTag(prod, 'env', 'prod')).toEqual([]);
    // The key alone: any value. Asked again, it is taken back.
    const any = withTag(both, 'env', null);
    expect(any).toEqual([{ key: 'env', values: [] }]);
    expect(withTag(any, 'env', null)).toEqual([]);
    expect(withTag(any, 'env', 'prod')).toEqual([{ key: 'env', values: ['prod'] }]);
    // Another key is another tag to carry.
    expect(withTag(prod, 'app', 'shop')).toEqual([
      { key: 'env', values: ['prod'] },
      { key: 'app', values: ['shop'] },
    ]);
  });

  it('draws connections from network rules, or leaves them out', () => {
    expect(drawsNetworkRules(null)).toBe(true);
    const without = withNetworkRules(null, false);
    expect(without).toEqual(['routing', 'event', 'declared']);
    expect(drawsNetworkRules(without)).toBe(false);
    expect(withNetworkRules(without, true)).toBeNull();
    // A file that already asks for some keeps the others as they were.
    expect(withNetworkRules(['routing'], true)).toEqual(['routing', 'network']);
    expect(withNetworkRules(['routing', 'network'], false)).toEqual(['routing']);
    expect(withNetworkRules(['routing'], false)).toEqual(['routing']);
  });

  it('leaves a resource out by hand once, and brings it back', () => {
    expect(withExcluded([], 'desk', true)).toEqual(['desk']);
    expect(withExcluded(['desk'], 'desk', true)).toEqual(['desk']);
    expect(withExcluded(['desk', 'door'], 'desk', false)).toEqual(['door']);
  });
});

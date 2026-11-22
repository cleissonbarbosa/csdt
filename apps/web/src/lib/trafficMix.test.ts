import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CATALOG_FILE, moveBoundary, readMix, sharesOf, writeMix, withCatalog } from './trafficMix';

// Vitest runs with the package directory as its working directory.
const text = readFileSync(resolve(process.cwd(), '../../fixtures/cedar/catalog.json'), 'utf8');

describe('the ordinary traffic of a platform', () => {
  it('shares the weights out in thousandths that add up to a thousand', () => {
    expect(sharesOf([1, 1, 1])).toEqual([334, 333, 333]);
    expect(sharesOf([0.38, 0.62])).toEqual([380, 620]);
    expect(sharesOf([0, 0])).toEqual([500, 500]);
    expect(sharesOf([2, 6])).toEqual([250, 750]);
  });

  it('reads the bundled mix, with what each shape asks', () => {
    const mix = readMix(text)!;
    expect(mix.shapes.length).toBeGreaterThan(5);
    expect(mix.shares.reduce((sum, share) => sum + share, 0)).toBe(1000);
    expect(mix.total).toBeCloseTo(1, 9);
    expect(mix.shapes[0]).toMatchObject({
      id: 'alice-view-order',
      principal: 'User::"alice"',
      action: 'Action::"viewOrder"',
    });
    expect(mix.shapes.find((shape) => shape.id === 'alice-export-ledger-mfa')?.context).toEqual([
      'mfa',
    ]);
    expect(readMix('{}')).toBeNull();
    expect(readMix('not json')).toBeNull();
  });

  it('moves a boundary on the step, what one gains the other gives', () => {
    expect(moveBoundary([380, 240, 380], 0, 23)).toEqual([405, 215, 380]);
    // Neither goes below nothing.
    expect(moveBoundary([380, 240, 380], 0, 999)).toEqual([620, 0, 380]);
    expect(moveBoundary([380, 240, 380], 1, -999)).toEqual([380, 0, 620]);
    expect(moveBoundary([500, 500], 1, 50)).toEqual([500, 500]);
  });

  it('writes the weights back keeping the total, and leaves an unmoved file alone', () => {
    const mix = readMix(text)!;
    expect(writeMix(text, mix, mix.shares)).toBe(text);
    const moved = moveBoundary(mix.shares, 0, 100);
    const written = writeMix(text, mix, moved);
    const json = JSON.parse(written) as { trafficMix: { weight: number }[]; principals: unknown };
    expect(json.trafficMix[0]!.weight).toBeCloseTo(0.48, 9);
    expect(json.trafficMix.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 6);
    // Nothing else of the catalogue changes.
    expect(json.principals).toEqual((JSON.parse(text) as { principals: unknown }).principals);
    expect(readMix(written)!.shares).toEqual(moved);

    const files = [
      { path: 'cedar/policies.json', text: '[]' },
      { path: CATALOG_FILE, text },
    ];
    expect(withCatalog(files, written)).toEqual([files[0], { path: CATALOG_FILE, text: written }]);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SERVICE_TYPES } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import { parsePieces } from './pieces';

function asset(): ArrayBuffer {
  const file = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pieces.glb'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

describe('service pieces', () => {
  const pieces = parsePieces(asset());

  it('has a model for every service type', () => {
    expect(Object.keys(pieces).sort()).toEqual([...SERVICE_TYPES].sort());
  });

  it.each(SERVICE_TYPES)('%s stands on the base plane and fits its footprint', (type) => {
    const box = pieces[type].boundingBox!;
    expect(box.min.y).toBeCloseTo(-1, 5);
    // The layout and the picking sphere assume a piece of about unit radius
    // that is no taller than two units.
    expect(box.max.y).toBeLessThanOrEqual(1.01);
    expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)).toBeLessThanOrEqual(1.1);
  });

  it.each(SERVICE_TYPES)('%s carries a part and an occlusion value per vertex', (type) => {
    const geometry = pieces[type];
    const count = geometry.getAttribute('position').count;
    const part = geometry.getAttribute('aPart');
    const occlusion = geometry.getAttribute('aAo');
    expect(part.count).toBe(count);
    expect(occlusion.count).toBe(count);
    expect(geometry.getAttribute('normal').count).toBe(count);
    for (let i = 0; i < count; i++) {
      expect([0, 1, 2]).toContain(part.getX(i));
      expect(occlusion.getX(i)).toBeGreaterThanOrEqual(0);
      expect(occlusion.getX(i)).toBeLessThanOrEqual(1);
    }
    // Triangles only, and every index points at a vertex.
    const index = geometry.getIndex()!;
    expect(index.count % 3).toBe(0);
    let highest = 0;
    for (let i = 0; i < index.count; i++) highest = Math.max(highest, index.getX(i));
    expect(highest).toBeLessThan(count);
  });

  it('keeps the whole set light enough to instance by the hundred', () => {
    const triangles = SERVICE_TYPES.map((type) => pieces[type].getIndex()!.count / 3);
    expect(Math.max(...triangles)).toBeLessThan(4000);
  });

  it('rejects a file that is not a GLB', () => {
    expect(() => parsePieces(new ArrayBuffer(64))).toThrow(/not a GLB/);
  });
});

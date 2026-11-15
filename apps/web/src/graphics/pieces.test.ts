import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SERVICE_TYPES } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import { MECHANISM_ROWS, MOTION, parsePieces, WORK_CYCLE } from './pieces';

function asset(): ArrayBuffer {
  const file = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pieces.glb'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

describe('service pieces', () => {
  const pieces = parsePieces(asset());

  it('has a model for every service type', () => {
    expect(Object.keys(pieces.shapes).sort()).toEqual([...SERVICE_TYPES].sort());
  });

  it.each(SERVICE_TYPES)('%s stands on the base plane and fits its footprint', (type) => {
    const box = pieces.shapes[type].boundingBox!;
    expect(box.min.y).toBeCloseTo(-1, 5);
    // The layout and the picking sphere assume a piece of about unit radius
    // that is no taller than two units.
    expect(box.max.y).toBeLessThanOrEqual(1.01);
    expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)).toBeLessThanOrEqual(1.1);
  });

  it.each(SERVICE_TYPES)('%s carries a part and an occlusion value per vertex', (type) => {
    const geometry = pieces.shapes[type];
    const count = geometry.getAttribute('position').count;
    const part = geometry.getAttribute('aPart');
    const occlusion = geometry.getAttribute('aAo');
    expect(part.count).toBe(count);
    expect(occlusion.count).toBe(count);
    expect(geometry.getAttribute('normal').count).toBe(count);
    for (let i = 0; i < count; i++) {
      expect([0, 1, 2]).toContain(part.getX(i));
      expect(Number.isInteger(part.getY(i))).toBe(true);
      expect(part.getY(i)).toBeGreaterThanOrEqual(0);
      expect(part.getY(i)).toBeLessThan(pieces.table.columns);
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
    const triangles = SERVICE_TYPES.map((type) => pieces.shapes[type].getIndex()!.count / 3);
    expect(Math.max(...triangles)).toBeLessThan(4000);
  });

  it.each(SERVICE_TYPES)('%s has a part that works, and only parts it declares', (type) => {
    const mechanisms = pieces.mechanisms[type];
    expect(mechanisms.length).toBeGreaterThan(0);
    // Every mechanism moves some of the piece, and nothing moves without one.
    const part = pieces.shapes[type].getAttribute('aPart');
    const used = new Set<number>();
    for (let i = 0; i < part.count; i++) used.add(part.getY(i));
    used.delete(0);
    expect(used.size).toBe(mechanisms.length);
  });

  it.each(SERVICE_TYPES)(
    '%s moves in a way the material knows and that never shows a seam',
    (type) => {
      for (const mechanism of pieces.mechanisms[type]) {
        expect(Object.values(MOTION)).toContain(mechanism.kind);
        expect(Math.hypot(...mechanism.axis)).toBeCloseTo(1, 4);
        expect(mechanism.offset).toBeGreaterThanOrEqual(0);
        expect(mechanism.offset).toBeLessThan(1);
        // Working time starts again every `WORK_CYCLE` seconds: a part has to
        // be back where it began by then, whole notches included.
        const cycles = WORK_CYCLE / mechanism.period;
        expect(cycles).toBeCloseTo(Math.round(cycles), 9);
        if (mechanism.kind === MOTION.index) {
          expect(Number.isInteger(mechanism.amount)).toBe(true);
          expect(Math.round(cycles) % Math.abs(mechanism.amount)).toBe(0);
          expect(mechanism.extra).toBeGreaterThan(0);
          expect(mechanism.extra).toBeLessThan(1);
        }
        if (mechanism.kind === MOTION.spin) expect(Math.abs(mechanism.amount)).toBe(1);
        // The way it hangs when down is a turn about a real axis.
        const [x, y, z, angle] = mechanism.slump;
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
        expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
      }
    },
  );

  it.each(SERVICE_TYPES)('%s shows that it is down by the way a part of it hangs', (type) => {
    const angles = pieces.mechanisms[type].map((mechanism) => Math.abs(mechanism.slump[3]));
    expect(Math.max(...angles)).toBeGreaterThan(0.1);
  });

  it('lays the mechanisms out as a table whose first column moves nothing', () => {
    const { data, columns } = pieces.table;
    const count = SERVICE_TYPES.reduce((sum, type) => sum + pieces.mechanisms[type].length, 0);
    expect(columns).toBe(count + 1);
    expect(data.length).toBe(columns * MECHANISM_ROWS * 4);
    for (let row = 0; row < MECHANISM_ROWS; row++) {
      expect([...data.subarray(row * columns * 4, row * columns * 4 + 4)]).toEqual([0, 0, 0, 0]);
    }
    // The pivot of a part follows the piece down to the base plane.
    const globe = pieces.mechanisms['network-gateway'][0]!;
    const sphere = pieces.shapes['network-gateway'].boundingBox!;
    expect(globe.pivot[1]).toBeGreaterThan(sphere.min.y);
    expect(globe.pivot[1]).toBeLessThan(sphere.max.y);
  });

  it('rejects a file that is not a GLB', () => {
    expect(() => parsePieces(new ArrayBuffer(64))).toThrow(/not a GLB/);
  });
});

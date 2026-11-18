import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SCENE_PALETTE } from '@/lib/palette';

import {
  aimPiece,
  FILTERED_PRESENCE,
  FOCUS_DIM,
  groundMarkOf,
  presenceOf,
  RECEDED_MIX,
  UNKNOWN,
  UNKNOWN_TONE,
  unknownRingTone,
  unknownTone,
  type PieceAim,
} from './sceneData';

const aim = (): PieceAim => ({ tone: 0, focus: 1, manner: 0, lamp: 0, open: 0, alarm: 0 });

type Triple = [number, number, number];

/** A palette colour in linear RGB, as the scene's tones are (`THREE.Color`). */
function linear(hex: string): Triple {
  return [0, 1, 2].map((i) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Triple;
}

/** A linear colour back in 0–255 sRGB, as it reaches the screen. */
function encoded(rgb: Triple): Triple {
  return rgb.map((c) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  }) as Triple;
}

/** Relative luminance (WCAG) of a linear colour. */
const luminance = ([r, g, b]: Triple) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a: Triple, b: Triple) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const scaled = (rgb: Triple, s: number) => rgb.map((c) => c * s) as Triple;
const mix = (from: Triple, to: Triple, k: number) =>
  from.map((c, i) => c + (to[i]! - c) * k) as Triple;
/**
 * How light falls on a piece in `createPieceMaterial`: from 0.6 × 0.4 in the
 * deepest occlusion to a face turned to the light, which shows the palette
 * colour.
 */
const LIGHT = [0.24, 0.4, 0.6, 0.8, 1];

describe('a piece whose state is unknown', () => {
  it('stays in front while something else is selected, where a normal piece recedes', () => {
    // Something is selected, and this piece is not in its neighbourhood.
    const unknown = aimPiece(aim(), 0, false, false, false, true, false);
    const receded = aimPiece(aim(), 0, true, false, false, true, false);
    expect(receded.focus).toBe(FOCUS_DIM);
    expect(unknown.focus).toBe(1);
    expect(presenceOf(1, unknown)).not.toBe(presenceOf(1, receded));
    expect(presenceOf(1, unknown)).toBe(1);
  });

  it('takes a tone of its own, not that of any state', () => {
    const unknown = aimPiece(aim(), 0, false, false, false, false, false);
    expect(unknown.tone).toBe(UNKNOWN);
    for (const code of [0, 1, 2, 3]) {
      expect(aimPiece(aim(), code, true, false, false, false, false).tone).toBe(code);
    }
    // Whatever code came with it, an unknown state is not drawn as one.
    expect(aimPiece(aim(), 2, false, false, false, false, false)).toEqual(unknown);
  });

  it('is not drawn as down: it stands upright, with no lamp and no alarm', () => {
    const unknown = aimPiece(aim(), 0, false, false, false, false, false);
    const down = aimPiece(aim(), 3, true, false, false, false, false);
    expect(unknown.manner).toBe(0);
    expect(down.manner).toBe(3);
    expect(unknown.lamp).toBe(0);
    expect(down.lamp).toBe(1);
    expect(unknown.alarm).toBe(0);
    expect(down.open).toBe(0);
  });

  it('stands on a dashed ring instead of a lamp, which fades with the piece', () => {
    const unknown = aimPiece(aim(), 2, false, false, true, false, false);
    expect(unknown.open).toBe(1);
    expect(groundMarkOf(unknown, 1)).toBe(-1);
    expect(groundMarkOf(unknown, 0.25)).toBe(-0.25);
    // Every known state keeps its lamp, or none, and no ring.
    for (const code of [0, 1, 2, 3]) {
      const known = aimPiece(aim(), code, true, false, false, false, false);
      expect(known.open).toBe(0);
      expect(groundMarkOf(known, 0.5)).toBe(known.lamp * 0.5);
      expect(groundMarkOf(known, 0.5)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is set against the shader’s own presence of a filtered-out piece, not a copy of it', () => {
    // The piece material mixes a filtered-out piece toward the plate by the
    // constant the unknown tone is measured against, by name.
    const material = readFileSync(join(import.meta.dirname, 'materials.ts'), 'utf8');
    expect(material).toContain('float(FILTERED_PRESENCE), float(1), visibility');
    expect(material).not.toMatch(/float\(0\.14\), float\(1\), visibility/);
  });

  it('is mixed toward the plate by an amount between a receded piece and a normal one', () => {
    expect(RECEDED_MIX).toBeCloseTo(FILTERED_PRESENCE + (1 - FILTERED_PRESENCE) * FOCUS_DIM);
    expect(UNKNOWN_TONE).toBeGreaterThan(RECEDED_MIX + 0.1);
    expect(UNKNOWN_TONE).toBeLessThan(1);
    const tone = unknownTone([1, 0.8, 0.6], [0, 0.2, 0.4]);
    tone.forEach((channel, k) => {
      const plate = [0, 0.2, 0.4][k]!;
      const piece = [1, 0.8, 0.6][k]!;
      expect(channel).toBeCloseTo(plate + (piece - plate) * UNKNOWN_TONE);
    });
  });

  it.each(Object.entries(SCENE_PALETTE))(
    'is never as faint as a receded piece, under any light, in the %s theme',
    (_, palette) => {
      const plate = linear(palette.plate);
      const piece = linear(palette.piece);
      const tone = unknownTone(piece, plate);
      for (const light of LIGHT) {
        // An unknown piece keeps its shading: its own tone is what is lit.
        const unknown = scaled(tone, light);
        // A receded piece is lit, then mixed back toward the plate.
        const receded = mix(plate, scaled(piece, light), RECEDED_MIX);
        const away = (rgb: Triple) => Math.abs(luminance(rgb) - luminance(plate));
        expect(away(unknown), `light ${light}`).toBeGreaterThan(away(receded));
      }
    },
  );

  it('is a shade fainter than a normal piece where the theme lets a tone show it', () => {
    // In the night theme the piece is far from its plate, and the tone shows.
    const night = SCENE_PALETTE.night;
    const plate = linear(night.plate);
    const piece = linear(night.piece);
    expect(contrast(piece, unknownTone(piece, plate))).toBeGreaterThan(1.2);
    // In the light theme it cannot: the dashed ring has to say it alone.
    const light = SCENE_PALETTE.light;
    expect(
      contrast(linear(light.piece), unknownTone(linear(light.piece), linear(light.plate))),
    ).toBeLessThan(1.1);
  });

  it.each(Object.entries(SCENE_PALETTE))(
    'has a ring without hue that stands clear of the plate in the %s theme',
    (_, palette) => {
      const ring = unknownRingTone(linear(palette.track), linear(palette.inkDim));
      // The least contrast WCAG asks of a mark that has to be seen.
      expect(contrast(ring, linear(palette.plate))).toBeGreaterThanOrEqual(3);
      // No more hue than the neutrals of the palette (`lib/palette.test.ts`).
      const rgb = encoded(ring);
      expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThan(16);
      // And it is not the tone of anything else under a piece.
      expect(encoded(ring)).not.toEqual(encoded(linear(palette.track)));
      expect(encoded(ring)).not.toEqual(encoded(linear(palette.ink)));
    },
  );
});

describe('a piece whose state is known', () => {
  it('keeps the rules it had: a deviation never recedes, a part of a group hesitates', () => {
    expect(aimPiece(aim(), 1, true, false, false, true, false).focus).toBe(1);
    expect(aimPiece(aim(), 0, true, false, true, true, false).focus).toBe(1);
    expect(aimPiece(aim(), 0, true, false, false, true, true).focus).toBe(1);
    expect(aimPiece(aim(), 0, true, false, false, false, false).focus).toBe(1);
    const partial = aimPiece(aim(), 2, true, true, false, false, false);
    expect(partial.tone).toBe(0);
    expect(partial.manner).toBe(1);
    expect(partial.lamp).toBe(1);
    expect(partial.alarm).toBe(3);
    expect(aimPiece(aim(), 0, true, false, true, false, false)).toMatchObject({
      lamp: 0.7,
      alarm: 1,
    });
  });
});

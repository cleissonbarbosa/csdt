import { HEALTH_BY_CODE, SERVICE_TYPES } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import {
  BEAD_SHAPE_ID,
  COLOR,
  HEALTH_COLOR,
  SCENE_PALETTE,
  SERVICE_TYPE,
  TRAFFIC_LEGEND,
} from './palette';

const HEX = /^#[0-9a-f]{6}$/i;

/** Relative luminance of an sRGB hex colour (WCAG definition). */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** How far a colour is from grey: 0 for neutral, larger for a real hue. */
function chroma(hex: string): number {
  const rgb = [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16));
  return Math.max(...rgb) - Math.min(...rgb);
}

/** Which of red, green and blue a colour has most of. */
function dominant(hex: string): number {
  const rgb = [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16));
  return rgb.indexOf(Math.max(...rgb));
}

describe('the palette', () => {
  it('keeps hue for answers: everything normal is neutral, in both themes', () => {
    for (const palette of Object.values(SCENE_PALETTE)) {
      for (const key of [
        'table',
        'plate',
        'plateSide',
        'plateLine',
        'piece',
        'pieceCore',
        'ghost',
        'ink',
        'inkDim',
        'track',
      ] as const) {
        expect(palette[key], key).toMatch(HEX);
        expect(chroma(palette[key]), key).toBeLessThan(16);
      }
      for (const key of ['warning', 'critical', 'hostile'] as const) {
        expect(chroma(palette[key]), key).toBeGreaterThan(120);
      }
      expect(chroma(palette.focus), 'focus').toBeGreaterThan(100);
    }
  });

  it('keeps the viewer’s colour apart from the data’s', () => {
    // Focus answers the viewer and the signals answer the data. Focus is
    // the only blue; no signal could be taken for it.
    for (const palette of Object.values(SCENE_PALETTE)) {
      expect(dominant(palette.focus), 'focus').toBe(2);
      for (const key of ['warning', 'critical', 'hostile'] as const) {
        expect(dominant(palette[key]), key).toBe(0);
      }
    }
  });

  it('makes an answer stand out from the plate it appears on', () => {
    for (const palette of Object.values(SCENE_PALETTE)) {
      for (const key of ['warning', 'critical', 'hostile', 'focus', 'ink'] as const) {
        expect(contrast(palette[key], palette.plate), key).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('draws a piece with light, not with a darker colour', () => {
    // A piece is the lightest thing on its plate; its shaded sides and its
    // shadow are what give it a shape. Its mark is the dark thing on it.
    for (const palette of Object.values(SCENE_PALETTE)) {
      expect(luminance(palette.piece)).toBeGreaterThan(luminance(palette.plate));
      expect(contrast(palette.pieceCore, palette.piece)).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives health a colour only when it is not healthy', () => {
    expect(HEALTH_COLOR.healthy).toBe(COLOR.inkDim);
    expect(HEALTH_COLOR.degraded).toBe(COLOR.warning);
    expect(HEALTH_COLOR.critical).toBe(COLOR.critical);
    expect(Object.keys(HEALTH_COLOR).sort()).toEqual([...HEALTH_BY_CODE].sort());
  });

  it('tells ordinary traffic apart by shape and troubled traffic by colour as well', () => {
    const ordinary = TRAFFIC_LEGEND.filter((kind) => kind.tone === null);
    expect(new Set(ordinary.map((kind) => kind.shape)).size).toBe(ordinary.length);
    const troubled = TRAFFIC_LEGEND.filter((kind) => kind.tone !== null);
    expect(new Set(troubled.map((kind) => kind.tone)).size).toBe(troubled.length);
    for (const kind of TRAFFIC_LEGEND) expect(BEAD_SHAPE_ID[kind.shape]).toBeTypeOf('number');
    expect(TRAFFIC_LEGEND).toHaveLength(8);
  });

  it('names every service type', () => {
    for (const type of SERVICE_TYPES) expect(SERVICE_TYPE[type].label.length).toBeGreaterThan(2);
  });
});

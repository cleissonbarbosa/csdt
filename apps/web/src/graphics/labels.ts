/**
 * Text atlas: every label is drawn once into a single canvas texture and
 * rendered as instanced billboards, so hundreds of labels cost one draw call
 * and no DOM.
 *
 * Each label is drawn twice, as a map does it: a wide halo first, the letters
 * on top. The red channel holds the letters and alpha holds letters plus
 * halo, so the shader can give the halo the colour of the plate and keep a
 * name readable whatever it happens to stand in front of.
 */
import * as THREE from 'three/webgpu';

export type LabelStyle = 'node' | 'region';

export interface LabelRect {
  /** Atlas rectangle in UV space: origin bottom-left, as WebGL samples it. */
  u: number;
  v: number;
  w: number;
  h: number;
  /** Width / height of the label in pixels. */
  aspect: number;
}

export interface LabelAtlas {
  texture: THREE.CanvasTexture;
  rect(text: string, style: LabelStyle): LabelRect | undefined;
  dispose(): void;
}

const WIDTH = 2048;
const PADDING = 6;
/** Width of the halo stroke, in atlas pixels (half of it lies outside the glyph). */
const HALO = 9;

const STYLE: Record<LabelStyle, { font: string; height: number; spacing: string }> = {
  node: { font: '400 28px "B612", sans-serif', height: 40, spacing: '0px' },
  region: { font: '700 44px "B612", sans-serif', height: 62, spacing: '0px' },
};

const key = (text: string, style: LabelStyle) => `${style}\u0000${text}`;

/** Fonts the atlas draws with; await these before building it. */
export async function loadLabelFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load(STYLE.node.font, 'AEGIS'),
    document.fonts.load(STYLE.region.font, 'AEGIS'),
  ]).catch(() => undefined);
}

export function buildLabelAtlas(labels: { text: string; style: LabelStyle }[]): LabelAtlas {
  const unique = new Map<string, { text: string; style: LabelStyle }>();
  for (const label of labels) unique.set(key(label.text, label.style), label);

  const measure = document.createElement('canvas').getContext('2d')!;
  const placed: { id: string; text: string; style: LabelStyle; x: number; y: number; w: number }[] =
    [];
  let x = PADDING;
  let y = PADDING;
  let rowHeight = 0;
  // Tall labels first: classic shelf packing.
  const ordered = [...unique.entries()].sort(
    (a, b) => STYLE[b[1].style].height - STYLE[a[1].style].height,
  );
  for (const [id, label] of ordered) {
    const style = STYLE[label.style];
    measure.font = style.font;
    measure.letterSpacing = style.spacing;
    const w = Math.min(
      WIDTH - 2 * PADDING,
      Math.ceil(measure.measureText(label.text).width) + 10 + HALO,
    );
    if (x + w + PADDING > WIDTH) {
      x = PADDING;
      y += rowHeight + PADDING;
      rowHeight = 0;
    }
    placed.push({ id, text: label.text, style: label.style, x, y, w });
    x += w + PADDING;
    rowHeight = Math.max(rowHeight, style.height);
  }
  const needed = y + rowHeight + PADDING;
  const height = Math.min(4096, 2 ** Math.ceil(Math.log2(Math.max(64, needed))));

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = HALO;
  ctx.strokeStyle = '#0000ff';
  ctx.fillStyle = '#ff0000';
  const rects = new Map<string, LabelRect>();
  for (const item of placed) {
    const style = STYLE[item.style];
    if (item.y + style.height > height) continue; // Atlas full: label is skipped.
    ctx.font = style.font;
    ctx.letterSpacing = style.spacing;
    const x = item.x + 4 + HALO / 2;
    const y = item.y + style.height / 2 + 1;
    ctx.strokeText(item.text, x, y);
    ctx.fillText(item.text, x, y);
    rects.set(item.id, {
      u: item.x / WIDTH,
      v: 1 - (item.y + style.height) / height,
      w: item.w / WIDTH,
      h: style.height / height,
      aspect: item.w / style.height,
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return {
    texture,
    rect: (text, style) => rects.get(key(text, style)),
    dispose: () => texture.dispose(),
  };
}

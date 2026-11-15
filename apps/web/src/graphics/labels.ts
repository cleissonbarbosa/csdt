/**
 * Text atlas: every label is drawn once into a single canvas texture and
 * rendered as instanced billboards, so hundreds of labels cost one draw call
 * and no DOM.
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

const STYLE: Record<LabelStyle, { font: string; height: number; spacing: string }> = {
  node: { font: '600 27px "Chakra Petch", sans-serif', height: 40, spacing: '1.5px' },
  region: { font: '600 46px "Chakra Petch", sans-serif', height: 66, spacing: '6px' },
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
    const w = Math.min(WIDTH - 2 * PADDING, Math.ceil(measure.measureText(label.text).width) + 10);
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
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  const rects = new Map<string, LabelRect>();
  for (const item of placed) {
    const style = STYLE[item.style];
    if (item.y + style.height > height) continue; // Atlas full: label is skipped.
    ctx.font = style.font;
    ctx.letterSpacing = style.spacing;
    ctx.fillText(item.text, item.x + 4, item.y + style.height / 2 + 1);
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

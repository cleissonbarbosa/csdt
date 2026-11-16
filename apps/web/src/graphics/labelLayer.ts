/**
 * Names over the model, drawn on a canvas of their own.
 *
 * The scene is rendered at whatever resolution the machine can hold, down
 * to three quarters of a CSS pixel; text drawn into it comes out soft, and
 * softest exactly where it matters, on small and slow screens. Names are
 * for reading, so they are not part of that picture: they are drawn here,
 * with the 2D canvas's own text rendering, at the full resolution of the
 * display whatever the scene's is.
 *
 * Being separate also makes them placeable. Each frame the scene says where
 * every name is anchored and how much it matters; this layer measures the
 * text, leaves out a name that would lie across a more important one
 * (`labelPlacement.ts`), shortens the headings together when they would
 * touch, and draws what is left. Nothing here is React: the scene controller
 * calls it from the frame loop and it redraws only when the picture changed.
 */
import { clearTier, placeLabels, type LabelBox, type LabelCandidate } from './labelPlacement';

export type LabelStyle = 'node' | 'region';

export interface LabelSpec {
  text: string;
  style: LabelStyle;
  /** What a heading is cut down to where the full text does not fit. */
  short?: string;
}

export interface LabelColours {
  ink: string;
  inkDim: string;
  critical: string;
  /** The halo behind the letters: the colour of what the model stands on. */
  halo: string;
}

/** How a name is drawn: 0 quiet, 1 in full ink, 2 in the alarm colour. */
export type LabelTone = 0 | 1 | 2;

const FAMILY = '"B612", system-ui, sans-serif';
/** Font size and line height on screen, in CSS pixels, by style. */
const TYPE: Record<LabelStyle, { weight: number; size: number; height: number }> = {
  node: { weight: 400, size: 13, height: 17 },
  region: { weight: 700, size: 19, height: 24 },
};
/**
 * How a heading may be written, best first: in full, in full a size down,
 * and cut to its short form. Every heading takes the same tier.
 */
const TIERS: readonly { scale: number; short: boolean }[] = [
  { scale: 1, short: false },
  { scale: 0.8, short: false },
  { scale: 0.8, short: true },
];
/** Width of the halo around the letters, in CSS pixels. */
const HALO = 3;
/** Seconds a name takes to come or go when the placement changes. */
const FADE_S = 0.14;
/** Device pixels kept clear around a rasterised name, for the halo's edge. */
const SPRITE_PAD = 2;

const font = (style: LabelStyle, scale = 1) =>
  `${TYPE[style].weight} ${(TYPE[style].size * scale).toFixed(2)}px ${FAMILY}`;

/** Fonts the layer draws with; names are measured once these are in. */
export async function loadLabelFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load(font('node'), 'AEGIS'),
    document.fonts.load(font('region'), 'AEGIS'),
  ]).catch(() => undefined);
}

export class LabelLayer {
  private readonly canvas: HTMLCanvasElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private specs: LabelSpec[] = [];
  /** Width of each name at each tier, in CSS pixels. */
  private widths: Float32Array = new Float32Array(0);
  private regions: number[] = [];

  // What the scene says about each name, every frame.
  private anchorX = new Float32Array(0);
  private anchorY = new Float32Array(0);
  private alignX = new Float32Array(0);
  private alignY = new Float32Array(0);
  private presence = new Float32Array(0);
  private rank = new Float32Array(0);
  private tone = new Uint8Array(0);
  private pinned = new Uint8Array(0);
  /** How shown each name is, eased toward whether it was placed. */
  private shown = new Float32Array(0);
  private placedLast = new Uint8Array(0);

  private tier = 0;
  private width = 0;
  private height = 0;
  private ratio = 0;
  private signature = Number.NaN;
  /**
   * Each name as it is drawn, rasterised once: halo and letters, at the
   * display's resolution. A frame then copies the ones it shows, which
   * costs far less than setting the text again while the camera moves.
   */
  private readonly sprites = new Map<number, HTMLCanvasElement>();
  private spritesFor = '';
  /** How many names the last frame drew, for whoever measures the scene. */
  drawn = 0;
  /**
   * Headings are cut to their short form whatever room they have among
   * themselves. Set where a heading stands beside its plate on a stage with
   * no width to spare: there the full text would not touch another heading,
   * it would run off the edge.
   */
  shortHeadings = false;

  /** `beside` is the scene's canvas; the names go in a canvas laid over it. */
  constructor(beside: HTMLElement) {
    const parent = beside.parentElement;
    if (!parent || typeof document === 'undefined') {
      this.canvas = null;
      this.ctx = null;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.aegisLabels = '';
    // Names are read, not pointed at: everything goes through to the model.
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block';
    parent.append(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  /** Replaces the names. Call once the fonts are in, so the widths are true. */
  setLabels(specs: readonly LabelSpec[]): void {
    const count = specs.length;
    this.specs = [...specs];
    this.regions = [];
    this.widths = new Float32Array(count * TIERS.length);
    this.anchorX = new Float32Array(count);
    this.anchorY = new Float32Array(count);
    this.alignX = new Float32Array(count);
    this.alignY = new Float32Array(count);
    this.presence = new Float32Array(count);
    this.rank = new Float32Array(count);
    this.tone = new Uint8Array(count);
    this.pinned = new Uint8Array(count);
    this.shown = new Float32Array(count);
    this.placedLast = new Uint8Array(count);
    this.tier = 0;
    this.signature = Number.NaN;
    this.sprites.clear();
    const ctx = this.ctx;
    specs.forEach((spec, i) => {
      if (spec.style === 'region') this.regions.push(i);
      for (let t = 0; t < TIERS.length; t++) {
        const tier = spec.style === 'region' ? TIERS[t]! : TIERS[0]!;
        const text = tier.short ? (spec.short ?? spec.text) : spec.text;
        let width = text.length * TYPE[spec.style].size * tier.scale * 0.58;
        if (ctx) {
          ctx.font = font(spec.style, tier.scale);
          width = ctx.measureText(text).width;
        }
        this.widths[i * TIERS.length + t] = width;
      }
    });
  }

  clear(): void {
    this.setLabels([]);
    this.paint(0, 0, 1, null);
  }

  get count(): number {
    return this.specs.length;
  }

  /** The size a name is drawn at this frame, in CSS pixels. */
  sizeOf(i: number): [number, number] {
    const spec = this.specs[i];
    if (!spec) return [0, 0];
    const t = spec.style === 'region' ? this.tier : 0;
    const scale = spec.style === 'region' ? TIERS[t]!.scale : 1;
    return [this.widths[i * TIERS.length + t] ?? 0, TYPE[spec.style].height * scale];
  }

  /**
   * One name for this frame: where its anchor is on the screen, where the
   * middle of the text goes from there in units of its own size, how present
   * it is (0 hides it), how much it matters, and how it is drawn.
   */
  set(
    i: number,
    x: number,
    y: number,
    alignX: number,
    alignY: number,
    presence: number,
    rank: number,
    tone: LabelTone,
    pinned: boolean,
  ): void {
    if (i < 0 || i >= this.specs.length) return;
    this.anchorX[i] = x;
    this.anchorY[i] = y;
    this.alignX[i] = alignX;
    this.alignY[i] = alignY;
    this.presence[i] = presence;
    this.rank[i] = rank;
    this.tone[i] = tone;
    this.pinned[i] = pinned ? 1 : 0;
  }

  private box(i: number, tier: number): LabelBox {
    const spec = this.specs[i]!;
    const t = spec.style === 'region' ? tier : 0;
    const scale = spec.style === 'region' ? TIERS[t]!.scale : 1;
    const w = this.widths[i * TIERS.length + t]! + HALO * 2;
    const h = TYPE[spec.style].height * scale;
    const cx = this.anchorX[i]! + this.alignX[i]! * w;
    // Screen y grows downward; "up" in units of the text's height is minus.
    const cy = this.anchorY[i]! - this.alignY[i]! * h;
    return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
  }

  /**
   * Places and draws the names for a view of `width` by `height` CSS pixels.
   * `dt` is the time since the last frame in seconds; with `instant` (reduced
   * motion) a name is there or not, with nothing in between.
   */
  draw(
    width: number,
    height: number,
    dt: number,
    instant: boolean,
    colours: LabelColours | null,
  ): void {
    const count = this.specs.length;
    if (count === 0 || !colours) {
      this.paint(width, height, 1, null);
      return;
    }
    // Headings first: the tier they all fit at, decided among themselves.
    const visibleRegions = this.regions.filter((i) => this.presence[i]! > 0.03);
    this.tier = this.shortHeadings
      ? TIERS.length - 1
      : clearTier(TIERS.map((_, t) => visibleRegions.map((i) => this.box(i, t))));

    // What was shown last frame is offered first, so that of two names of
    // equal weight the one already there stays.
    const candidates: LabelCandidate[] = [];
    for (let pass = 1; pass >= 0; pass--) {
      for (let i = 0; i < count; i++) {
        if (this.placedLast[i] !== pass || this.presence[i]! <= 0.03) continue;
        candidates.push({
          id: i,
          box: this.box(i, this.tier),
          rank: this.rank[i]!,
          pinned: this.pinned[i] === 1,
        });
      }
    }
    const placed = placeLabels(candidates, { width, height });
    this.placedLast.fill(0);
    for (const i of placed) this.placedLast[i] = 1;

    const step = instant || FADE_S <= 0 ? 1 : Math.min(1, dt / FADE_S);
    for (let i = 0; i < count; i++) {
      const target = this.placedLast[i] === 1 ? 1 : 0;
      const current = this.shown[i]!;
      this.shown[i] =
        current + Math.sign(target - current) * Math.min(step, Math.abs(target - current));
    }
    this.paint(width, height, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, colours);
  }

  private paint(width: number, height: number, ratio: number, colours: LabelColours | null): void {
    const { canvas, ctx } = this;
    if (!canvas || !ctx) return;
    const resized = width !== this.width || height !== this.height || ratio !== this.ratio;
    if (resized) {
      this.width = width;
      this.height = height;
      this.ratio = ratio;
      // The backing store has every pixel the display has, whatever the
      // scene's own resolution is.
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
    }

    // Everything the picture depends on, folded into one number: when it is
    // the one of the last frame, the canvas already shows this.
    let signature = this.tier + 1;
    let drawn = 0;
    const mix = (value: number) => {
      signature = (Math.imul(signature ^ (value | 0), 16777619) >>> 0) + 1;
    };
    if (colours) {
      // The colours themselves, in full: another theme is another picture,
      // whichever of its characters differ.
      for (const colour of [colours.ink, colours.inkDim, colours.critical, colours.halo]) {
        for (let c = 0; c < colour.length; c++) mix(colour.charCodeAt(c));
      }
      for (let i = 0; i < this.specs.length; i++) {
        const alpha = this.shown[i]! * this.presence[i]!;
        if (alpha <= 0.01) continue;
        drawn++;
        mix(i);
        mix(Math.round(this.anchorX[i]! * 2));
        mix(Math.round(this.anchorY[i]! * 2));
        mix(Math.round(this.alignX[i]! * 64));
        mix(Math.round(this.alignY[i]! * 64));
        mix(Math.round(alpha * 40));
        mix(this.tone[i]!);
      }
    }
    this.drawn = drawn;
    if (!resized && signature === this.signature) return;
    this.signature = signature;

    // In device pixels: a name is copied to whole pixels, never between two.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!colours || drawn === 0) return;
    const key = `${ratio}|${colours.ink}|${colours.inkDim}|${colours.critical}|${colours.halo}`;
    if (key !== this.spritesFor) {
      this.spritesFor = key;
      this.sprites.clear();
    }
    // The quiet names first, so the ones that matter lie on top.
    for (let tone = 0; tone <= 2; tone++) {
      for (let i = 0; i < this.specs.length; i++) {
        if (this.tone[i] !== tone) continue;
        const alpha = this.shown[i]! * this.presence[i]!;
        if (alpha <= 0.01) continue;
        const sprite = this.sprite(i, tone as LabelTone, colours, ratio);
        if (!sprite) continue;
        const box = this.box(i, this.tier);
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(
          sprite,
          Math.round(box.left * ratio) - SPRITE_PAD,
          Math.round(box.top * ratio) - SPRITE_PAD,
        );
      }
    }
    ctx.globalAlpha = 1;
  }

  /** One name at the current tier and in one tone, drawn once and kept. */
  private sprite(
    i: number,
    tone: LabelTone,
    colours: LabelColours,
    ratio: number,
  ): HTMLCanvasElement | null {
    const spec = this.specs[i]!;
    const tierIndex = spec.style === 'region' ? this.tier : 0;
    const id = (i * TIERS.length + tierIndex) * 3 + tone;
    const kept = this.sprites.get(id);
    if (kept) return kept;
    const tier = TIERS[tierIndex]!;
    const [textWidth, height] = this.sizeOf(i);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((textWidth + HALO * 2) * ratio) + SPRITE_PAD * 2;
    canvas.height = Math.ceil(height * ratio) + SPRITE_PAD * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(ratio, 0, 0, ratio, SPRITE_PAD, SPRITE_PAD);
    ctx.font = font(spec.style, tier.scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = HALO * 2;
    ctx.strokeStyle = colours.halo;
    ctx.fillStyle = tone === 2 ? colours.critical : tone === 1 ? colours.ink : colours.inkDim;
    const text = tier.short ? (spec.short ?? spec.text) : spec.text;
    const x = textWidth / 2 + HALO;
    const y = height / 2;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    this.sprites.set(id, canvas);
    return canvas;
  }

  /** The names being drawn, each with its box: for tests and measurements. */
  boxes(): { text: string; left: number; top: number; right: number; bottom: number }[] {
    const out = [];
    for (let i = 0; i < this.specs.length; i++) {
      if (this.placedLast[i] !== 1 || this.shown[i]! * this.presence[i]! <= 0.01) continue;
      const spec = this.specs[i]!;
      const tier = spec.style === 'region' ? TIERS[this.tier]! : TIERS[0]!;
      out.push({
        text: tier.short ? (spec.short ?? spec.text) : spec.text,
        ...this.box(i, this.tier),
      });
    }
    return out;
  }

  dispose(): void {
    this.canvas?.remove();
  }
}

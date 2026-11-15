/**
 * Rendering quality tiers and the controller that moves between them.
 *
 * The controller watches frame time and steps down when the scene cannot hold
 * roughly 45 fps, and back up when it has been comfortably at refresh rate
 * for a while. A tier that proved too expensive becomes the ceiling so the
 * scene does not oscillate.
 */
export type QualityLevel = 'ultra' | 'high' | 'medium' | 'low';

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export interface QualityProfile {
  /** Upper bound on the device pixel ratio. */
  maxDpr: number;
  /** Multiplier on traffic particle density. */
  particles: number;
  bloom: boolean;
  stars: boolean;
  /** Multiplier on the distance at which labels fade out. */
  labelRange: number;
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  ultra: { maxDpr: 2, particles: 1, bloom: true, stars: true, labelRange: 1.15 },
  high: { maxDpr: 1.5, particles: 0.72, bloom: true, stars: true, labelRange: 1 },
  medium: { maxDpr: 1, particles: 0.45, bloom: true, stars: true, labelRange: 0.85 },
  low: { maxDpr: 0.75, particles: 0.24, bloom: false, stars: false, labelRange: 0.7 },
};

/** Frame time above which the scene is considered to be struggling (~45 fps). */
export const SLOW_FRAME_MS = 22;
/** Frame time below which there is headroom to try a higher tier. */
export const FAST_FRAME_MS = 17.6;
const STEP_DOWN_AFTER_MS = 1800;
const STEP_UP_AFTER_MS = 8000;
const COOLDOWN_MS = 3000;
/** A step up that is undone within this window marks the tier as too costly. */
const REGRET_WINDOW_MS = 12_000;
const SMOOTHING = 0.08;

export class AdaptiveQuality {
  private current: QualityLevel;
  private ceiling: QualityLevel = 'ultra';
  private average = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private sinceChange = COOLDOWN_MS;
  private sinceStepUp = Infinity;

  constructor(initial: QualityLevel = 'high') {
    this.current = initial;
  }

  get level(): QualityLevel {
    return this.current;
  }

  get averageFrameMs(): number {
    return this.average;
  }

  /** Restarts measurement, e.g. after the tab was hidden or the scene rebuilt. */
  reset(level: QualityLevel = this.current): void {
    this.current = level;
    this.average = 16.7;
    this.slowFor = 0;
    this.fastFor = 0;
    this.sinceChange = 0;
    this.sinceStepUp = Infinity;
  }

  /**
   * Feeds one frame's duration. Returns the new level when it changes,
   * otherwise `null`.
   */
  sample(frameMs: number): QualityLevel | null {
    // A hidden tab or a breakpoint produces huge gaps that say nothing about
    // rendering cost.
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return null;
    this.average += (frameMs - this.average) * SMOOTHING;
    this.sinceChange += frameMs;
    this.sinceStepUp += frameMs;
    if (this.sinceChange < COOLDOWN_MS) {
      // Let the new tier settle: frames measured right after a change still
      // reflect the old one.
      this.slowFor = 0;
      this.fastFor = 0;
      return null;
    }
    this.slowFor = this.average > SLOW_FRAME_MS ? this.slowFor + frameMs : 0;
    this.fastFor = this.average < FAST_FRAME_MS ? this.fastFor + frameMs : 0;

    const index = QUALITY_ORDER.indexOf(this.current);
    if (this.slowFor >= STEP_DOWN_AFTER_MS && index > 0) {
      if (this.sinceStepUp < REGRET_WINDOW_MS) {
        // The tier we just tried is too expensive on this machine.
        this.ceiling = QUALITY_ORDER[index - 1]!;
      }
      return this.change(QUALITY_ORDER[index - 1]!);
    }
    if (this.fastFor >= STEP_UP_AFTER_MS && index < QUALITY_ORDER.indexOf(this.ceiling)) {
      this.sinceStepUp = 0;
      return this.change(QUALITY_ORDER[index + 1]!);
    }
    return null;
  }

  private change(level: QualityLevel): QualityLevel {
    this.current = level;
    this.slowFor = 0;
    this.fastFor = 0;
    this.sinceChange = 0;
    return level;
  }
}

/** Rolling frame-time statistics for the developer overlay. */
export class FrameStats {
  private readonly samples: Float32Array;
  private cursor = 0;
  private filled = 0;

  constructor(size = 180) {
    this.samples = new Float32Array(size);
  }

  push(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;
    this.samples[this.cursor] = frameMs;
    this.cursor = (this.cursor + 1) % this.samples.length;
    this.filled = Math.min(this.samples.length, this.filled + 1);
  }

  get count(): number {
    return this.filled;
  }

  average(): number {
    if (this.filled === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.filled; i++) sum += this.samples[i]!;
    return sum / this.filled;
  }

  percentile(q: number): number {
    if (this.filled === 0) return 0;
    const sorted = Array.from(this.samples.subarray(0, this.filled)).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q))]!;
  }

  fps(): number {
    const average = this.average();
    return average > 0 ? 1000 / average : 0;
  }
}

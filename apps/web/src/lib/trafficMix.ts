/**
 * The ordinary authorization traffic of a platform: the catalogue's
 * `trafficMix`, request shapes with weights.
 *
 * A weight is relative: the engine takes the denial rate at rest as the
 * weight Cedar denies over the weight there is (`DecisionTable::build`),
 * so what the bar changes is each shape's share. It is kept in thousandths
 * that always add up to a thousand, moved between two neighbours at a time,
 * and written back as weights that keep the file's own total. Nothing else
 * of the catalogue changes, and what the shares make of the denial rate is
 * the engine's to say, by the same check an imported file gets.
 */
import type { WorkspaceFile } from '@aegis/contracts';

/** Where the catalogue is among the files a workspace is saved as. */
export const CATALOG_FILE = 'cedar/catalog.json';

/** The smallest step a share moves by, in thousandths. */
export const SHARE_STEP = 5;
const WHOLE = 1000;

/** One request shape of the mix, as far as the bar shows it. */
export interface Shape {
  id: string;
  principal: string;
  action: string;
  resource: string;
  /** The context keys it sets to true. */
  context: string[];
}

export interface Mix {
  shapes: Shape[];
  /** Each shape's share, in thousandths; they add up to a thousand. */
  shares: number[];
  /** What the file's weights add up to, which the written weights keep. */
  total: number;
}

/**
 * Shares in thousandths that add up to a thousand, nearest to the weights
 * (largest remainder). All zero weights share alike.
 */
export function sharesOf(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0) return [];
  const exact =
    total > 0
      ? weights.map((weight) => (weight / total) * WHOLE)
      : weights.map(() => WHOLE / weights.length);
  const shares = exact.map(Math.floor);
  let left = WHOLE - shares.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((value, i) => ({ i, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

/** The mix a catalogue file holds; `null` when it holds none that can be read. */
export function readMix(text: string): Mix | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const mix = (json as { trafficMix?: unknown } | null)?.trafficMix;
  if (!Array.isArray(mix) || mix.length === 0) return null;
  const shapes: Shape[] = [];
  const weights: number[] = [];
  for (const raw of mix) {
    const entry = raw as Record<string, unknown> | null;
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      typeof entry.weight !== 'number' ||
      !Number.isFinite(entry.weight) ||
      entry.weight < 0
    ) {
      return null;
    }
    const context =
      typeof entry.context === 'object' && entry.context !== null
        ? Object.entries(entry.context as Record<string, unknown>)
            .filter(([, value]) => value === true)
            .map(([key]) => key)
        : [];
    shapes.push({
      id: entry.id,
      principal: String(entry.principal ?? ''),
      action: String(entry.action ?? ''),
      resource: String(entry.resource ?? ''),
      context,
    });
    weights.push(entry.weight);
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return { shapes, shares: sharesOf(weights), total: total > 0 ? total : 1 };
}

/**
 * Moves the boundary between shape `i` and the one after it by `delta`
 * thousandths, on the step: what one gains the other gives, and neither
 * goes below nothing.
 */
export function moveBoundary(shares: readonly number[], i: number, delta: number): number[] {
  const left = shares[i];
  const right = shares[i + 1];
  if (left === undefined || right === undefined) return [...shares];
  const stepped = Math.round(delta / SHARE_STEP) * SHARE_STEP;
  const moved = Math.max(-left, Math.min(right, stepped));
  const next = [...shares];
  next[i] = left + moved;
  next[i + 1] = right - moved;
  return next;
}

/**
 * The catalogue file with its weights set from `shares`, keeping the file's
 * total; everything else in the file as it was. The file as it was where
 * the shares are those it holds already.
 */
export function writeMix(text: string, mix: Mix, shares: readonly number[]): string {
  if (shares.every((share, i) => share === mix.shares[i])) return text;
  const json = JSON.parse(text) as { trafficMix: Record<string, unknown>[] };
  json.trafficMix = json.trafficMix.map((entry, i) => ({
    ...entry,
    weight: Number((((shares[i] ?? 0) / WHOLE) * mix.total).toFixed(6)),
  }));
  return `${JSON.stringify(json, null, 2)}\n`;
}

/** The files of a workspace with the catalogue's text replaced. */
export function withCatalog(files: readonly WorkspaceFile[], text: string): WorkspaceFile[] {
  return files.map((file) => (file.path === CATALOG_FILE ? { ...file, text } : file));
}

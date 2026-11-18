/**
 * Where the marks along a capture's strip are drawn.
 *
 * Two kinds lie along it. A tick where some service's sample is past the
 * simulation's levels is part of the strip's picture, so there are never
 * more of them than the strip has columns of pixels, whatever the file
 * holds: each column takes the worst level of the samples that fall in it.
 * An event is a mark of its own size, and two events at one moment, or a
 * few pixels apart, would be drawn over each other with only the last one's
 * shape to be seen; they are set side by side instead, around their moments.
 *
 * Both are pure functions of the capture and the strip's width, so neither
 * has to be worked out again as the cursor moves.
 */
import { levelMarks, type Capture } from './capture';

export interface LevelColumn {
  /** The column of pixels, from the strip's left edge. */
  column: number;
  level: 1 | 2;
}

/**
 * The ticks of the samples past the levels, one per column of pixels at
 * most: the worst level among the samples that fall in it, left to right.
 */
export function levelColumns(capture: Capture, width: number): LevelColumn[] {
  const { startMs, endMs } = capture.window;
  const span = Math.max(1, endMs - startMs);
  const columns = Math.max(1, Math.ceil(width));
  const worst = new Map<number, 1 | 2>();
  for (const mark of levelMarks(capture)) {
    const column = Math.min(
      columns - 1,
      Math.max(0, Math.floor(((mark.atMs - startMs) / span) * width)),
    );
    if ((worst.get(column) ?? 0) < mark.level) worst.set(column, mark.level);
  }
  return [...worst].sort(([a], [b]) => a - b).map(([column, level]) => ({ column, level }));
}

/**
 * Where marks of `size` pixels go along a strip `width` pixels wide, given
 * where each would stand (`wanted`, in order along the strip), so that no two
 * lie over each other and none is cut by an end of the strip: one with room
 * stays at its own place; a run of them too close together is set side by
 * side, `gap` apart, around the middle of the places they wanted. The same
 * places always give the same answer. Where the strip is too short to hold
 * them all side by side, each stays at its own place, inside the strip:
 * spread out, they would be pushed past its end and far from their moments.
 */
export function spreadMarks(
  wanted: readonly number[],
  size: number,
  width: number,
  gap = 1,
): number[] {
  const step = size + gap;
  if (wanted.length * step - gap > width) {
    return wanted.map((x) => Math.max(size / 2, Math.min(width - size / 2, x)));
  }
  /** A run of marks set side by side: the first and last of them, and the sum of their places. */
  const runs: { from: number; to: number; sum: number }[] = [];
  const firstOf = (run: { from: number; to: number; sum: number }) => {
    const count = run.to - run.from + 1;
    const middle = run.sum / count;
    const highest = width - size / 2 - (count - 1) * step;
    return Math.max(size / 2, Math.min(highest, middle - ((count - 1) * step) / 2));
  };
  wanted.forEach((x, i) => {
    runs.push({ from: i, to: i, sum: x });
    // A run that would lie over the one before it joins it, and the two are
    // set out again around their middle; that may reach the one before.
    while (runs.length > 1) {
      const last = runs[runs.length - 1]!;
      const before = runs[runs.length - 2]!;
      const beforeEnd = firstOf(before) + (before.to - before.from) * step;
      if (firstOf(last) - beforeEnd >= step) break;
      runs.pop();
      before.to = last.to;
      before.sum += last.sum;
    }
  });
  const placed = new Array<number>(wanted.length);
  for (const run of runs) {
    const first = firstOf(run);
    for (let i = run.from; i <= run.to; i++) placed[i] = first + (i - run.from) * step;
  }
  return placed;
}

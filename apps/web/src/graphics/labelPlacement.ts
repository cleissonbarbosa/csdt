/**
 * Which names are shown, when there is not room for all of them.
 *
 * Names are information, and two of them printed across each other are
 * none. So every frame the names are placed in order of importance, and one
 * that would lie over a name already placed is left out: it comes back when
 * the camera moves in and the two part, or when its piece is selected or
 * pointed at. A name cut by the edge of the picture, or by a card laid over
 * it, is none either, and is left out the same way. Pure functions of boxes
 * on the screen, with no randomness and no iteration to convergence, so the
 * same view always shows the same names.
 */

export interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LabelCandidate {
  id: number;
  box: LabelBox;
  /** Higher is placed first. */
  rank: number;
  /** Placed whatever it covers: the name of what the viewer has in hand. */
  pinned: boolean;
}

/** Whether two boxes come within `gap` pixels of each other. */
export function overlaps(a: LabelBox, b: LabelBox, gap = 0): boolean {
  return (
    a.left < b.right + gap &&
    b.left < a.right + gap &&
    a.top < b.bottom + gap &&
    b.top < a.bottom + gap
  );
}

/**
 * The part of the picture a name can be read in: the screen, less what the
 * interface lays over it (a card, the timeline).
 */
export type LabelBounds = { width: number; height: number } | LabelBox;

function frameOf(bounds: LabelBounds): LabelBox {
  return 'width' in bounds
    ? { left: 0, top: 0, right: bounds.width, bottom: bounds.height }
    : bounds;
}

/** Whether a box lies wholly inside another. */
export function inside(box: LabelBox, frame: LabelBox): boolean {
  return (
    box.left >= frame.left &&
    box.top >= frame.top &&
    box.right <= frame.right &&
    box.bottom <= frame.bottom
  );
}

/**
 * The ids of the candidates that are shown, most important first. Pinned
 * candidates always are. Any other name is shown only where it lies wholly
 * inside `bounds`: one that the edge or a card would cut is left out, as one
 * that would lie across another is. Among equals the earlier candidate wins,
 * so the caller's order (what was shown last frame first) decides, and two
 * names of the same weight do not take turns as the camera drifts.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  bounds: LabelBounds,
  gap = 3,
): number[] {
  const frame = frameOf(bounds);
  const order = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        Number(b.candidate.pinned) - Number(a.candidate.pinned) ||
        b.candidate.rank - a.candidate.rank ||
        a.index - b.index,
    );
  const placed: LabelBox[] = [];
  const shown: number[] = [];
  for (const { candidate } of order) {
    const { box } = candidate;
    // A name wholly off the screen takes no room and is not drawn.
    if (
      box.right < frame.left ||
      box.bottom < frame.top ||
      box.left > frame.right ||
      box.top > frame.bottom
    ) {
      continue;
    }
    if (!candidate.pinned) {
      // Part of a name is no name: one the edge or a card would cut is left out.
      if (!inside(box, frame)) continue;
      if (placed.some((other) => overlaps(box, other, gap))) continue;
    }
    placed.push(box);
    shown.push(candidate.id);
  }
  return shown;
}

/**
 * Headings are written in full where they fit and shortened where they do
 * not, all of them alike. `tiers[t]` holds the heading boxes as they would
 * be at tier `t`, widest first; the answer is the first tier in which no
 * two of them touch, or the last one when none is clear.
 */
export function clearTier(tiers: readonly (readonly LabelBox[])[], gap = 4): number {
  for (let t = 0; t < tiers.length; t++) {
    const boxes = tiers[t]!;
    let clear = true;
    for (let i = 0; i < boxes.length && clear; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (overlaps(boxes[i]!, boxes[j]!, gap)) {
          clear = false;
          break;
        }
      }
    }
    if (clear) return t;
  }
  return Math.max(0, tiers.length - 1);
}

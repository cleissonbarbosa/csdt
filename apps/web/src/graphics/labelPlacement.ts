/**
 * Which names are shown, when there is not room for all of them.
 *
 * Names are information, and two of them printed across each other are
 * none. So every frame the names are placed in order of importance, and one
 * that would lie over a name already placed is left out: it comes back when
 * the camera moves in and the two part, or when its piece is selected or
 * pointed at. Pure functions of boxes on the screen, with no randomness and
 * no iteration to convergence, so the same view always shows the same names.
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
 * The ids of the candidates that are shown, most important first. Pinned
 * candidates always are. Among equals the earlier candidate wins, so the
 * caller's order (what was shown last frame first) decides, and two names of
 * the same weight do not take turns as the camera drifts.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  bounds: { width: number; height: number },
  gap = 3,
): number[] {
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
    if (box.right < 0 || box.bottom < 0 || box.left > bounds.width || box.top > bounds.height) {
      continue;
    }
    if (!candidate.pinned && placed.some((other) => overlaps(box, other, gap))) continue;
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

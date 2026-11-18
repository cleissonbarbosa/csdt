import { describe, expect, it } from 'vitest';

import { clearTier, overlaps, placeLabels, type LabelCandidate } from './labelPlacement';

const box = (left: number, top: number, width = 80, height = 16) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
const candidate = (id: number, left: number, top: number, rank = 1, pinned = false) =>
  ({ id, box: box(left, top), rank, pinned }) satisfies LabelCandidate;
const SCREEN = { width: 800, height: 600 };

describe('placing names', () => {
  it('shows every name when none touches another', () => {
    const shown = placeLabels(
      [candidate(0, 10, 10), candidate(1, 200, 10), candidate(2, 10, 100)],
      SCREEN,
    );
    expect(shown.sort()).toEqual([0, 1, 2]);
  });

  it('leaves out the less important of two that would overlap', () => {
    const shown = placeLabels([candidate(0, 10, 10, 1), candidate(1, 40, 14, 5)], SCREEN);
    expect(shown).toEqual([1]);
  });

  it('never prints two shown names across each other', () => {
    // A crowd: forty names in a space that holds a handful.
    const crowd = Array.from({ length: 40 }, (_, i) =>
      candidate(i, 20 + ((i * 37) % 160), 20 + ((i * 23) % 60), (i * 7) % 5),
    );
    const shown = placeLabels(crowd, SCREEN);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.length).toBeLessThan(crowd.length);
    for (const a of shown) {
      for (const b of shown) {
        if (a !== b) expect(overlaps(crowd[a]!.box, crowd[b]!.box)).toBe(false);
      }
    }
  });

  it('always shows what the viewer has in hand, and makes room for it', () => {
    const shown = placeLabels(
      [candidate(0, 10, 10, 9), candidate(1, 30, 12, 1, true), candidate(2, 300, 10, 1)],
      SCREEN,
    );
    // The pinned name is there; the one it covers gives way, however important.
    expect(shown).toEqual([1, 2]);
  });

  it('lets the earlier of two equals keep its place', () => {
    const a = candidate(0, 10, 10, 3);
    const b = candidate(1, 30, 12, 3);
    expect(placeLabels([a, b], SCREEN)).toEqual([0]);
    expect(placeLabels([b, a], SCREEN)).toEqual([1]);
  });

  it('gives no room to a name that is off the screen', () => {
    const shown = placeLabels([candidate(0, -400, 10, 9), candidate(1, 10, 10, 1)], SCREEN);
    expect(shown).toEqual([1]);
  });

  it('never shows part of a name: one the edge of the picture would cut is left out', () => {
    // A heading hung off a plate at the left edge, one at the right, one
    // above the top and one under the foot: each is partly on the screen.
    const cut = [
      candidate(0, -60, 100, 9),
      candidate(1, 760, 100, 9),
      candidate(2, 300, -8, 9),
      candidate(3, 300, 590, 9),
    ];
    expect(placeLabels([...cut, candidate(4, 300, 300, 1)], SCREEN)).toEqual([4]);
    // Whole, at the very edges, a name is shown.
    const whole = [candidate(0, 0, 100), candidate(1, 720, 100), candidate(2, 300, 0)];
    expect(placeLabels(whole, SCREEN).sort()).toEqual([0, 1, 2]);
  });

  it('leaves out a name that a card over the picture would cut, and gives it no room', () => {
    // A list on the left up to 312 px, a card on the right from 470 px, a
    // timeline over the foot: the names are read between them.
    const free = { left: 312, top: 28, right: 470, bottom: 520 };
    const under = candidate(0, 280, 100, 9); // half under the list
    const covered = candidate(1, 100, 200, 9); // wholly under it
    const beside = candidate(2, 320, 100, 1); // where the one under the list would lie
    const below = candidate(3, 340, 510, 9); // half under the timeline
    expect(placeLabels([under, covered, beside, below], free)).toEqual([2]);
  });

  it('shows the name in hand even where it is cut', () => {
    const shown = placeLabels([candidate(0, 760, 100, 1, true), candidate(1, 10, 10)], SCREEN);
    expect(shown).toEqual([0, 1]);
  });

  it('is the same answer for the same view', () => {
    const crowd = Array.from({ length: 30 }, (_, i) =>
      candidate(i, (i * 53) % 300, (i * 29) % 120, i % 4),
    );
    expect(placeLabels(crowd, SCREEN)).toEqual(placeLabels(crowd, SCREEN));
  });
});

describe('headings', () => {
  it('are written in full where they fit', () => {
    const full = [box(0, 0, 100), box(140, 0, 100), box(280, 0, 100)];
    const short = [box(0, 0, 24), box(140, 0, 24), box(280, 0, 24)];
    expect(clearTier([full, short])).toBe(0);
  });

  it('are shortened, all of them, when in full they would touch', () => {
    const full = [box(0, 0, 100), box(60, 0, 100), box(120, 0, 100)];
    const smaller = [box(0, 0, 70), box(60, 0, 70), box(120, 0, 70)];
    const short = [box(0, 0, 24), box(60, 0, 24), box(120, 0, 24)];
    expect(clearTier([full, smaller, short])).toBe(2);
  });

  it('fall back to the shortest form when nothing is clear', () => {
    const cramped = [box(0, 0, 30), box(10, 0, 30)];
    expect(clearTier([cramped, cramped])).toBe(1);
  });
});

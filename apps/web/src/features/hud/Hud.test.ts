import { describe, expect, it } from 'vitest';

import { instrumentsShown } from './Hud';

describe('the instruments the top bar has room for', () => {
  it('shows them all while the width is not known', () => {
    expect(instrumentsShown(3, null)).toBe(3);
  });

  it('shows them all where they fit', () => {
    // Three instruments of 116 with two gaps of 16 between them.
    expect(instrumentsShown(3, 380)).toBe(3);
    expect(instrumentsShown(1, 116)).toBe(1);
  });

  it('keeps room for the count of the ones it leaves out', () => {
    // Two would fit in 260, but not beside the count of the third.
    expect(instrumentsShown(3, 379)).toBe(2);
    expect(instrumentsShown(3, 260)).toBe(1);
    // What the row asks of the bar: one instrument and the count.
    expect(instrumentsShown(3, 116 + 16 + 28)).toBe(1);
    expect(instrumentsShown(2, 116 + 16 + 28)).toBe(1);
  });

  it('shows none it cannot show whole', () => {
    expect(instrumentsShown(3, 150)).toBe(0);
    expect(instrumentsShown(0, 0)).toBe(0);
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sparkline } from './Sparkline';

const lines = (container: HTMLElement) => [...container.querySelectorAll('polyline')];

describe('a sparkline', () => {
  it('draws one line across every value, evenly spaced, as it always has', () => {
    const { container } = render(
      <Sparkline values={[0, 5, 10]} width={100} height={22} label="Throughput" />,
    );
    const [line, ...rest] = lines(container);
    expect(rest).toHaveLength(0);
    expect(line?.getAttribute('points')).toBe('0.0,21.0 50.0,11.0 100.0,1.0');
    expect(container.querySelector('[data-cursor]')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
  });

  it('says when there is not enough to draw', () => {
    render(<Sparkline values={[3]} label="Latency" />);
    expect(screen.getByRole('img', { name: 'Latency: not enough data' })).toBeInTheDocument();
  });

  it('breaks the line where a value is not known, instead of drawing across it', () => {
    const { container } = render(
      <Sparkline
        values={[1, 2, Number.NaN, 4, 5, Number.NaN, 2]}
        width={60}
        height={12}
        gaps
        label="Requests"
      />,
    );
    const drawn = lines(container);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]!.getAttribute('points')).toBe('0.0,9.0 10.0,7.0');
    expect(drawn[1]!.getAttribute('points')).toBe('30.0,3.0 40.0,1.0');
    // A value alone between two gaps is a point.
    const point = container.querySelector('circle');
    expect(point?.getAttribute('cx')).toBe('60.0');
  });

  it('places values where they stand and marks the cursor', () => {
    const { container } = render(
      <Sparkline
        values={[2, 2]}
        at={[1000, 1500]}
        span={[0, 2000]}
        cursor={1000}
        width={200}
        height={20}
        gaps
        label="Errors"
      />,
    );
    expect(lines(container)[0]!.getAttribute('points')).toBe('100.0,1.0 150.0,1.0');
    const cursor = container.querySelector('[data-cursor]');
    expect(cursor?.getAttribute('x1')).toBe('100');
    expect(cursor?.getAttribute('x2')).toBe('100');
  });

  it('leaves out a cursor outside the line, and says when nothing is known at all', () => {
    const { container } = render(
      <Sparkline values={[1, 2]} at={[0, 10]} cursor={20} gaps label="p95" />,
    );
    expect(container.querySelector('[data-cursor]')).toBeNull();
    render(<Sparkline values={[Number.NaN, Number.NaN]} gaps label="Memory" />);
    expect(screen.getByRole('img', { name: 'Memory: not enough data' })).toBeInTheDocument();
  });
});

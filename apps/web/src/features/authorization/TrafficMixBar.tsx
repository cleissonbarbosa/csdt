/**
 * The platform's ordinary authorization traffic, as one bar: each request
 * shape of the catalogue's `trafficMix` a segment as wide as its share.
 *
 * The boundary between two segments is carried sideways to move share
 * from one to the other, half a percent at a time (`lib/trafficMix.ts`);
 * for the keyboard each boundary is a slider the arrow keys move, five
 * times as far with Shift. The segments are in ink, one tone after the
 * other: a share is not a state, and what Cedar decides of each shape is
 * not read here. What the shares make of the denial rate at rest is the
 * engine's, said beside the bar once it has checked them.
 */
import type { AuthorizationCatalog } from '@aegis/contracts';
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/format';
import { moveBoundary, SHARE_STEP, type Mix, type Shape } from '@/lib/trafficMix';

/** A shape in words: who asks for what, on what, with which context. */
function shapeWords(catalog: AuthorizationCatalog, shape: Shape): { who: string; asks: string } {
  const principal = catalog.principals.find((entry) => entry.uid === shape.principal);
  const action = catalog.actions.find((entry) => entry.uid === shape.action);
  const resource = catalog.resources.find((entry) => entry.uid === shape.resource);
  const keys = shape.context.map(
    (key) => catalog.contextKeys.find((entry) => entry.key === key)?.label ?? key,
  );
  const asks = [action?.label ?? shape.action, resource?.label ?? shape.resource, ...keys].join(
    ', ',
  );
  return { who: principal?.label ?? shape.principal, asks };
}

export function TrafficMixBar({
  catalog,
  mix,
  shares,
  onShares,
}: {
  catalog: AuthorizationCatalog;
  mix: Mix;
  shares: readonly number[];
  onShares: (shares: number[]) => void;
}) {
  const bar = useRef<HTMLDivElement | null>(null);
  const starts: number[] = [];
  shares.reduce((at, share) => {
    starts.push(at);
    return at + share;
  }, 0);

  const carry = (event: ReactPointerEvent<HTMLElement>, i: number) => {
    if (event.button !== 0 || !bar.current) return;
    event.preventDefault();
    const element = event.currentTarget;
    const width = bar.current.clientWidth || 1;
    const from = [...shares];
    const start = event.clientX;
    element.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) =>
      onShares(moveBoundary(from, i, ((next.clientX - start) / width) * 1000));
    const up = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
  };
  const key = (event: KeyboardEvent, i: number) => {
    const size = event.shiftKey ? SHARE_STEP * 5 : SHARE_STEP;
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? size
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -size
          : null;
    if (delta === null) return;
    event.preventDefault();
    onShares(moveBoundary(shares, i, delta));
  };

  return (
    <div data-testid="traffic-mix">
      <div
        ref={bar}
        className="relative h-10 overflow-hidden rounded-control border border-line-strong"
      >
        {mix.shapes.map((shape, i) => {
          const words = shapeWords(catalog, shape);
          const share = shares[i] ?? 0;
          return (
            <div
              key={shape.id}
              className={cn(
                'absolute inset-y-0 overflow-hidden border-r border-line-strong px-1.5 py-1 last:border-r-0',
                i % 2 === 0 ? 'bg-sunken' : 'bg-paper',
              )}
              style={{ left: `${(starts[i] ?? 0) / 10}%`, width: `${share / 10}%` }}
              title={t('{who}: {asks}, {share} of requests', {
                who: words.who,
                asks: words.asks,
                share: formatPercent(share / 1000),
              })}
              data-testid={`traffic-shape-${i}`}
            >
              {share >= 60 && (
                <>
                  <span className="block truncate text-[10px] font-bold leading-tight text-ink">
                    {words.who}
                  </span>
                  <span className="block truncate text-[10px] leading-tight text-ink-dim">
                    {formatPercent(share / 1000)}
                  </span>
                </>
              )}
            </div>
          );
        })}
        {mix.shapes.slice(0, -1).map((shape, i) => (
          <span
            key={shape.id}
            role="slider"
            tabIndex={0}
            className="absolute inset-y-0 z-10 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-full focus-visible:bg-focus/40 hover:bg-ink/10"
            style={{ left: `${((starts[i + 1] ?? 0) / 10).toFixed(2)}%` }}
            aria-label={t('Between {a} and {b}', {
              a: shapeWords(catalog, shape).who,
              b: shapeWords(catalog, mix.shapes[i + 1]!).who,
            })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={(shares[i] ?? 0) / 10}
            aria-valuetext={formatPercent((shares[i] ?? 0) / 1000)}
            onPointerDown={(event) => carry(event, i)}
            onKeyDown={(event) => key(event, i)}
            data-testid={`traffic-boundary-${i}`}
          />
        ))}
      </div>
      <ol className="mt-2 grid gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-2">
        {mix.shapes.map((shape, i) => {
          const words = shapeWords(catalog, shape);
          const moved = (shares[i] ?? 0) !== (mix.shares[i] ?? 0);
          return (
            <li key={shape.id} className="flex min-w-0 items-baseline gap-2">
              <span
                className={cn(
                  'numeric w-12 shrink-0 text-right',
                  moved ? 'font-bold text-ink' : 'text-ink-dim',
                )}
              >
                {formatPercent((shares[i] ?? 0) / 1000)}
              </span>
              <span className="min-w-0 truncate text-ink" title={words.asks}>
                <span className="font-bold">{words.who}</span> {words.asks}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

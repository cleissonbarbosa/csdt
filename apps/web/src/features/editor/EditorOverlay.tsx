/**
 * What a carry shows over the model, drawn on the page rather than in the
 * scene: the part of the table a piece would take, the connection it would
 * make, and why a connection cannot be made.
 *
 * It is the viewer's blue, the colour of what the viewer is doing; a
 * connection that would be refused is drawn dashed in amber with the reason
 * beside it, so the answer does not rest on the hue. Nothing here is drawn
 * at rest: it comes with a carry and goes with it. The camera is held still
 * while something is carried, so what is projected here stays where it is.
 *
 * Each line here moves once, in answer to the hand: a refused connection
 * goes back to the piece it was drawn from, and the circle it would have
 * closed is drawn from its first service round to it again. With reduced
 * motion both are as they end: the circle drawn, the connection gone.
 */
import { useEffect, useRef, useState } from 'react';

import { sceneHandle } from '@/graphics/handle';
import type { GroundRect } from '@/graphics/layout';
import { t } from '@/i18n';
import { SERVICE_TYPE } from '@/lib/palette';
import { useEditor } from '@/stores/editor';

import { KIND_GLYPH } from './Palette';

/** How long a refused connection's circle stays drawn, in milliseconds. */
const REFUSAL_SHOWN_MS = 4000;
/** How long a refused connection takes to go back (`--animate-recoil`), with a margin. */
const RECOIL_MS = 450;
/** The widest a caption beside the pointer grows (`max-w-72`), in pixels. */
const CAPTION_WIDTH = 288;

type Point = { x: number; y: number };

function corners(rect: GroundRect): Point[] | null {
  const stage = sceneHandle.current;
  if (!stage) return null;
  const points = [
    stage.projectGround(rect.x0, rect.z0),
    stage.projectGround(rect.x1, rect.z0),
    stage.projectGround(rect.x1, rect.z1),
    stage.projectGround(rect.x0, rect.z1),
  ];
  return points.every((point) => point !== null) ? (points as Point[]) : null;
}

const path = (points: Point[]) =>
  points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/**
 * A path through `points`. With `bend`, each step bows to its left by that
 * share of its length, so that a circle of two services (there and back)
 * is a loop and not one line drawn twice.
 */
function track(points: Point[], bend: number): string {
  const [first, ...rest] = points;
  if (!first) return '';
  const at = (p: Point) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  let d = `M${at(first)}`;
  let from = first;
  for (const to of rest) {
    const control = {
      x: (from.x + to.x) / 2 + (to.y - from.y) * bend,
      y: (from.y + to.y) / 2 - (to.x - from.x) * bend,
    };
    d += ` Q${at(control)} ${at(to)}`;
    from = to;
  }
  return d;
}

/**
 * A dashed amber line that moves as a whole: drawn on, or drawn back, by a
 * solid stroke laid over it as a mask, so that its dashes stay its own.
 */
function MovingLine({
  id,
  points,
  bend = 0,
  motion,
  testId,
}: {
  id: string;
  points: Point[];
  bend?: number;
  motion: 'trace' | 'recoil';
  testId: string;
}) {
  const d = track(points, bend);
  return (
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
        <path
          d={d}
          fill="none"
          stroke="white"
          strokeWidth={8}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray="1 1"
          className={motion === 'trace' ? 'animate-trace' : 'animate-recoil'}
        />
      </mask>
      <path
        d={d}
        fill="none"
        stroke="var(--color-warning)"
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeLinecap="round"
        strokeLinejoin="round"
        mask={`url(#${id})`}
        data-testid={testId}
      />
    </>
  );
}

export function EditorOverlay() {
  const carrying = useEditor((state) => state.carrying);
  const drag = useEditor((state) => state.drag);
  const draft = useEditor((state) => state.draft);
  const refused = useEditor((state) => state.refused);
  const box = useRef<HTMLDivElement | null>(null);
  // Which refusal's circle is drawn (each is drawn on once), or null for none.
  const [circleKey, setCircleKey] = useState<number | null>(null);
  // The connection that was let go of and refused, going back to where it came from.
  const [recoil, setRecoil] = useState<{ key: number; points: Point[] } | null>(null);

  useEffect(() => {
    if (!refused || refused.circle.length === 0) {
      setCircleKey(null);
      return;
    }
    setCircleKey((last) => (last ?? 0) + 1);
    const timer = window.setTimeout(() => setCircleKey(null), REFUSAL_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [refused]);

  useEffect(() => {
    const link = refused?.link;
    const from = link ? sceneHandle.current?.projectNode(link.from) : null;
    const to = link ? sceneHandle.current?.projectNode(link.to) : null;
    if (!from || !to) {
      setRecoil(null);
      return;
    }
    setRecoil((last) => ({ key: (last?.key ?? 0) + 1, points: [from, to] }));
    const timer = window.setTimeout(() => setRecoil(null), RECOIL_MS);
    return () => window.clearTimeout(timer);
  }, [refused]);

  const origin = box.current?.getBoundingClientRect();
  const pointer = drag && origin ? { x: drag.x - origin.left, y: drag.y - origin.top } : null;
  // Where the stage stops being free on the right: the draft's card.
  const card = pointer ? document.querySelector('[data-testid="editor-card"]') : null;
  const freeRight =
    card && origin ? card.getBoundingClientRect().left - origin.left : (origin?.width ?? 0);
  const slot = drag?.slot ? corners(drag.slot.rect) : null;
  const from =
    carrying?.kind === 'move' && drag?.target
      ? sceneHandle.current?.projectNode(carrying.id)
      : null;
  const to = drag?.target ? sceneHandle.current?.projectNode(drag.target) : null;
  const circle =
    circleKey !== null && refused
      ? refused.circle
          .map((id) => sceneHandle.current?.projectNode(id) ?? null)
          .filter((point): point is Point => point !== null)
      : [];

  const regionName = (id: string | null) =>
    draft?.regions.find((region) => region.id === id)?.name ?? id ?? '';
  let caption: string | null = null;
  if (drag?.target && drag.refusal) caption = drag.refusal;
  else if (drag?.target && draft) {
    const name = draft.nodes.find((node) => node.id === drag.target)?.name ?? drag.target;
    caption = t('Connect to {name}', { name });
  } else if (drag?.slot) {
    const region = regionName(drag.slot.region);
    const where = drag.slot.newRegion
      ? t('a new region')
      : drag.slot.insert
        ? t('a new column of {region}', { region })
        : t('{region}, tier {tier}', { region, tier: drag.slot.tier });
    caption =
      carrying?.kind === 'new'
        ? t('{kind} in {where}', { kind: SERVICE_TYPE[carrying.type].label, where })
        : t('Move to {where}', { where });
  } else if (carrying?.kind === 'new') {
    caption = SERVICE_TYPE[carrying.type].label;
  }
  // What is carried, by its glyph: the kind taken from the palette, or the piece's own.
  const carriedType =
    carrying?.kind === 'new'
      ? carrying.type
      : carrying?.kind === 'move'
        ? draft?.nodes.find((node) => node.id === carrying.id)?.type
        : undefined;
  const Glyph = carriedType ? KIND_GLYPH[carriedType] : null;

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <svg className="absolute inset-0 size-full overflow-visible">
        {slot && (
          <polygon
            points={path(slot)}
            fill="var(--color-focus)"
            fillOpacity={0.08}
            stroke="var(--color-focus)"
            strokeWidth={1.5}
            strokeDasharray={drag?.slot?.newRegion || drag?.slot?.insert ? '6 4' : undefined}
            data-testid="editor-slot"
          />
        )}
        {from && to && (
          <line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={drag?.refusal ? 'var(--color-warning)' : 'var(--color-focus)'}
            strokeWidth={2}
            strokeDasharray={drag?.refusal ? '5 4' : undefined}
            strokeLinecap="round"
            data-testid="editor-link"
          />
        )}
        {circle.length > 1 && (
          <MovingLine
            key={`circle-${circleKey}`}
            id="editor-circle-mask"
            points={circle}
            bend={0.2}
            motion="trace"
            testId="editor-circle"
          />
        )}
        {recoil && (
          <MovingLine
            key={`recoil-${recoil.key}`}
            id="editor-recoil-mask"
            points={recoil.points}
            motion="recoil"
            testId="editor-recoil"
          />
        )}
      </svg>
      {pointer && caption && (
        <div
          className="absolute flex max-w-72 items-start gap-1.5 rounded-control border border-line bg-paper px-2 py-1 text-[11px] leading-snug text-ink shadow-sm"
          // Beside the pointer, on its left where the draft's card would
          // cover it on the right.
          style={
            pointer.x + 14 + CAPTION_WIDTH > freeRight
              ? { right: (origin?.width ?? 0) - pointer.x + 14, top: pointer.y + 14 }
              : { left: pointer.x + 14, top: pointer.y + 14 }
          }
          data-testid="editor-caption"
        >
          {Glyph && (
            <Glyph
              size={13}
              strokeWidth={1.6}
              aria-hidden
              className="mt-px shrink-0 text-ink-dim"
            />
          )}
          <span>{caption}</span>
        </div>
      )}
    </div>
  );
}

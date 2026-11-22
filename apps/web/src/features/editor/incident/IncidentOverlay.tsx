/**
 * What the phase in hand holds, written on the model: a chip under each
 * service (or connection, or the middle of a region) an effect is placed
 * on, saying what it does there with its figure, and the flow being drawn,
 * numbered in the order its services were clicked.
 *
 * Drawn on the page over the stage, so it adds no draw call; the chips
 * follow the camera from a frame loop that moves them by reference, and
 * nothing here renders again while the view turns. A chip is the viewer's,
 * like the blue the model keeps the same services in front with: nothing
 * has happened to them yet. One is opened in the card with a click.
 */
import { useEffect, useMemo, useRef } from 'react';

import type { SceneController } from '@/graphics/SceneController';
import { sceneHandle } from '@/graphics/handle';
import { t } from '@/i18n';
import { useEditor } from '@/stores/editor';
import { useIncident } from '@/stores/incident';

import { chipsOf, type Anchor } from './effects';

/** Where an anchor is on the stage, in its CSS pixels; null when off screen. */
function anchorPoint(stage: SceneController, at: Anchor): { x: number; y: number } | null {
  if ('node' in at) return stage.projectNode(at.node);
  if ('edge' in at) return stage.projectEdge(at.edge);
  const points = at.nodes
    .map((id) => stage.projectNode(id))
    .filter((point): point is { x: number; y: number } => point !== null);
  if (points.length === 0) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

/** How far below its anchor a chip hangs, and how far apart chips on one anchor are, in pixels. */
const HANG = 16;
const STACK = 24;

export function IncidentOverlay() {
  const platform = useEditor((state) => state.draft);
  const scenario = useIncident((state) => state.scenario);
  const phase = useIncident((state) => state.phase);
  const item = useIncident((state) => state.item);
  const drawing = useIncident((state) => state.drawing);
  const chips = useMemo(
    () => (platform && scenario ? chipsOf(platform, scenario, phase) : []),
    [platform, scenario, phase],
  );
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const markRefs = useRef(new Map<number, HTMLSpanElement>());
  const line = useRef<SVGPolylineElement | null>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const stage = sceneHandle.current;
      if (stage) {
        const stacked = new Map<string, number>();
        for (const chip of chips) {
          const element = chipRefs.current.get(chip.key);
          if (!element) continue;
          const at = anchorPoint(stage, chip.at);
          if (!at) {
            element.style.visibility = 'hidden';
            continue;
          }
          const where = JSON.stringify(chip.at);
          const k = stacked.get(where) ?? 0;
          stacked.set(where, k + 1);
          element.style.visibility = 'visible';
          element.style.transform = `translate(${at.x.toFixed(1)}px, ${(at.y + HANG + k * STACK).toFixed(1)}px) translateX(-50%)`;
        }
        const points: string[] = [];
        (drawing ?? []).forEach((id, k) => {
          const at = stage.projectNode(id);
          const mark = markRefs.current.get(k);
          if (!at) {
            if (mark) mark.style.visibility = 'hidden';
            return;
          }
          points.push(`${at.x.toFixed(1)},${at.y.toFixed(1)}`);
          if (mark) {
            mark.style.visibility = 'visible';
            mark.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -150%)`;
          }
        });
        line.current?.setAttribute('points', points.join(' '));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [chips, drawing]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-testid="incident-overlay">
      {drawing && drawing.length > 1 && (
        <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <polyline
            ref={line}
            fill="none"
            stroke="var(--color-focus)"
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            data-testid="flow-line"
          />
        </svg>
      )}
      {drawing?.map((id, k) => (
        <span
          key={`${id}-${k}`}
          ref={(element) => {
            if (element) markRefs.current.set(k, element);
            else markRefs.current.delete(k);
          }}
          className="numeric absolute left-0 top-0 grid size-5 place-items-center rounded-full border border-focus bg-paper text-[10px] font-bold text-ink"
          style={{ visibility: 'hidden' }}
          aria-hidden
        >
          {k + 1}
        </span>
      ))}
      {chips.map((chip) => {
        const Glyph = chip.glyph;
        const open = chip.key === item;
        return (
          <button
            key={chip.key}
            type="button"
            ref={(element) => {
              if (element) chipRefs.current.set(chip.key, element);
              else chipRefs.current.delete(chip.key);
            }}
            className={`pointer-events-auto absolute left-0 top-0 flex max-w-56 items-center gap-1 whitespace-nowrap rounded-full border bg-paper px-2 py-0.5 text-[11px] text-ink shadow-sm ${
              open ? 'border-focus' : 'border-line-strong'
            }`}
            style={{ visibility: 'hidden' }}
            onClick={() => useIncident.getState().selectItem(open ? null : chip.key)}
            aria-label={t('Open {effect} in the card', { effect: chip.text })}
            data-testid="effect-chip"
          >
            <Glyph size={12} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-dim" />
            <span className="truncate">{chip.text}</span>
          </button>
        );
      })}
    </div>
  );
}

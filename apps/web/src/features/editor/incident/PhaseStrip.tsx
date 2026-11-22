/**
 * The incident's phases on its timeline, at the foot of the stage where the
 * simulation's timeline is.
 *
 * Each phase is a block from where it starts to where the next one does,
 * named, with the incident's stage in words and the ramp its effects ease
 * in over drawn as a slope at its start. A block is selected with a click,
 * which puts its phase in hand; carried sideways it starts earlier or
 * later, on the engine's tick and at least a tick from its neighbours (the
 * first phase starts at zero and stays there). The grip at the top of a
 * slope carries the ramp. A double click cuts the phase there in two.
 *
 * Every one of those has a way without a pointer: a block is a button,
 * where a phase starts and how long it eases in are sliders that the arrow
 * keys move a tick at a time (a second with Shift), and "Add a phase" cuts
 * the phase in hand in two. Nothing here moves by itself; a block moves as
 * the hand does.
 */
import { Plus } from 'lucide-react';
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { NumberField } from '@/components/ui/Field';
import { t } from '@/i18n';
import { formatClock } from '@/lib/format';
import {
  inOrder,
  movePhase,
  phaseEnd,
  setDuration,
  setRamp,
  splitPhase,
  STATUS_LABEL,
  TICK_MS,
  type PhaseDraft,
  type ScenarioDraft,
} from '@/lib/scenarioFile';
import { useIncident } from '@/stores/incident';

/** How tall the strip is, for the stage to leave room for it. */
export const STRIP_HEIGHT = 108;

/** How far a press moves before it carries a block, in pixels. */
const CARRY_SLOP = 4;

/** Spacing of the time marks: the first of these, in seconds, that leaves room between them. */
const MARK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

let serial = 0;
/** One key per gesture, so that one carry is one step to undo. */
const gestureKey = (what: string) => {
  serial += 1;
  return `strip:${what}:${serial}`;
};

const change = (next: (scenario: ScenarioDraft) => ScenarioDraft, key?: string) =>
  useIncident.getState().change(next, key);

/** A slider's keys: a tick at a time, a second with Shift. */
function stepOf(event: KeyboardEvent): number | null {
  const size = event.shiftKey ? 1000 : TICK_MS;
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') return size;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') return -size;
  return null;
}

/**
 * Follows a press on the strip: `onMove` with how far it went, in
 * milliseconds of the scenario, once it moved past the slop; `onClick` when
 * it never did.
 */
function follow(
  event: ReactPointerEvent<HTMLElement>,
  msPerPx: number,
  onMove: (deltaMs: number, key: string) => void,
  onClick?: () => void,
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget;
  const start = event.clientX;
  const key = gestureKey('carry');
  let carried = false;
  element.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent) => {
    const dx = next.clientX - start;
    if (!carried && Math.abs(dx) < CARRY_SLOP) return;
    carried = true;
    onMove(dx * msPerPx, key);
  };
  const up = () => {
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', up);
    if (!carried) onClick?.();
  };
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', up);
}

function Block({
  scenario,
  phase,
  index,
  selected,
  msPerPx,
}: {
  scenario: ScenarioDraft;
  phase: PhaseDraft;
  index: number;
  selected: boolean;
  msPerPx: () => number;
}) {
  const end = phaseEnd(scenario, phase.key);
  const span = Math.max(1, end - phase.atMs);
  const left = (phase.atMs / scenario.durationMs) * 100;
  const width = (span / scenario.durationMs) * 100;
  const ramp = Math.min(1, phase.rampMs / span) * 100;
  const first = index === 0;
  const select = () => useIncident.getState().selectPhase(phase.key);
  return (
    <div
      className="absolute inset-y-0 px-px"
      style={{ left: `${left}%`, width: `${width}%` }}
      data-testid={`phase-block-${index}`}
    >
      <button
        type="button"
        className={`relative flex size-full min-w-0 flex-col items-start justify-center overflow-hidden rounded-control border bg-paper px-2 text-left transition-colors ${
          selected ? 'border-focus' : 'border-line hover:border-line-strong'
        } ${first ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
        aria-pressed={selected}
        aria-label={t('{phase}, from {start} to {end}', {
          phase: phase.name || t('Phase {n}', { n: index + 1 }),
          start: formatClock(phase.atMs),
          end: formatClock(end),
        })}
        onPointerDown={(event) =>
          first
            ? undefined
            : follow(
                event,
                msPerPx(),
                (delta, key) =>
                  change((current) => movePhase(current, phase.key, phase.atMs + delta), key),
                select,
              )
        }
        onClick={(event) => {
          // A pointer's click was a press, already dealt with; this is the keyboard's, or the first block's.
          if (event.detail === 0 || first) select();
        }}
        onDoubleClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const at = phase.atMs + ((event.clientX - box.left) / box.width) * span;
          const split = splitPhase(useIncident.getState().scenario ?? scenario, at);
          if (!split) return;
          change(() => split.draft);
          useIncident.getState().selectPhase(split.key);
        }}
      >
        {/* The ramp: the slope its effects ease in over. */}
        <svg
          className="pointer-events-none absolute inset-0 size-full text-ink-faint"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polygon points={`0,100 ${ramp},0 ${ramp},100`} fill="currentColor" opacity={0.1} />
          <line
            x1={0}
            y1={100}
            x2={ramp}
            y2={0}
            stroke="currentColor"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="relative w-full truncate text-[11px] font-bold leading-tight text-ink">
          {phase.name || t('Phase {n}', { n: index + 1 })}
        </span>
        <span className="relative w-full truncate text-[10px] leading-tight text-ink-dim">
          {STATUS_LABEL[phase.status]}
        </span>
      </button>
      {/* Where it starts, for the keyboard: the block itself carries it for the pointer. */}
      {!first && (
        <span
          role="slider"
          tabIndex={0}
          className="absolute -left-1 inset-y-1 w-2 cursor-ew-resize rounded-full focus-visible:bg-focus"
          aria-label={t('Where {phase} starts', { phase: phase.name })}
          aria-valuemin={0}
          aria-valuemax={scenario.durationMs / 1000}
          aria-valuenow={phase.atMs / 1000}
          aria-valuetext={formatClock(phase.atMs)}
          onKeyDown={(event) => {
            const step = stepOf(event);
            if (step === null) return;
            event.preventDefault();
            change(
              (current) => movePhase(current, phase.key, phase.atMs + step),
              `strip:at:${phase.key}`,
            );
          }}
          onPointerDown={(event) =>
            follow(event, msPerPx(), (delta, key) =>
              change((current) => movePhase(current, phase.key, phase.atMs + delta), key),
            )
          }
          data-testid={`phase-start-${index}`}
        />
      )}
      {/* The grip of the ramp, at the top of its slope. */}
      <span
        role="slider"
        tabIndex={0}
        className="absolute -top-1.5 size-3 -translate-x-1/2 cursor-ew-resize rounded-full border border-line-strong bg-paper focus-visible:border-focus"
        style={{ left: `${(Math.min(phase.rampMs, span) / span) * 100}%` }}
        aria-label={t('How long {phase} eases in over', { phase: phase.name })}
        aria-valuemin={0}
        aria-valuemax={span / 1000}
        aria-valuenow={phase.rampMs / 1000}
        aria-valuetext={t('{s} s', { s: phase.rampMs / 1000 })}
        onKeyDown={(event) => {
          const step = stepOf(event);
          if (step === null) return;
          event.preventDefault();
          change(
            (current) => setRamp(current, phase.key, phase.rampMs + step),
            `strip:ramp:${phase.key}`,
          );
        }}
        onPointerDown={(event) =>
          follow(event, msPerPx(), (delta, key) =>
            change((current) => setRamp(current, phase.key, phase.rampMs + delta), key),
          )
        }
        data-testid={`phase-ramp-${index}`}
      />
    </div>
  );
}

export function PhaseStrip() {
  const scenario = useIncident((state) => state.scenario);
  const selected = useIncident((state) => state.phase);
  const track = useRef<HTMLDivElement | null>(null);
  if (!scenario) return null;
  const phases = inOrder(scenario);
  const msPerPx = () => scenario.durationMs / Math.max(1, track.current?.clientWidth ?? 1);
  const width = track.current?.clientWidth ?? 800;
  const step =
    MARK_STEPS.find((seconds) => (seconds * 1000 * width) / scenario.durationMs >= 64) ?? 600;
  const marks: number[] = [];
  for (let ms = 0; ms <= scenario.durationMs; ms += step * 1000) marks.push(ms);
  const inHand = phases.find((phase) => phase.key === selected) ?? null;

  return (
    <section
      className="panel floating absolute inset-x-3 bottom-3 z-20 flex animate-rise flex-col gap-1 px-3 pb-1.5 pt-2"
      style={{ height: STRIP_HEIGHT }}
      aria-label={t('The phases of the incident')}
      data-testid="phase-strip"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-bold text-ink">{t('Phases')}</h2>
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={12} aria-hidden />}
          disabled={!inHand}
          onClick={() => {
            const current = useIncident.getState().scenario;
            if (!current || !inHand) return;
            const middle = (inHand.atMs + phaseEnd(current, inHand.key)) / 2;
            const split = splitPhase(current, middle);
            if (!split) return;
            change(() => split.draft);
            useIncident.getState().selectPhase(split.key);
          }}
          title={t('Cut the phase in hand in two')}
          data-testid="phase-add"
        >
          {t('Add a phase')}
        </Button>
        <span className="ml-auto text-[11px] text-ink-dim" aria-hidden>
          {t('Lasts, s')}
        </span>
        <div className="w-20">
          <NumberField
            label={t('Lasts, in seconds')}
            hideLabel
            min={1}
            max={1800}
            step="any"
            value={scenario.durationMs / 1000}
            onValue={(seconds) =>
              change((current) => setDuration(current, seconds * 1000), 'strip:duration')
            }
            title={t('How long the incident lasts, in seconds: up to 1800')}
            data-testid="incident-duration"
          />
        </div>
      </div>
      <div ref={track} className="relative h-11" data-testid="phase-track">
        {phases.map((phase, index) => (
          <Block
            key={phase.key}
            scenario={scenario}
            phase={phase}
            index={index}
            selected={phase.key === selected}
            msPerPx={msPerPx}
          />
        ))}
      </div>
      <div className="relative h-3.5" aria-hidden>
        {marks.map((ms) => (
          <span
            key={ms}
            className="numeric absolute top-0 -translate-x-1/2 text-[10px] text-ink-faint first:translate-x-0 last:-translate-x-full"
            style={{ left: `${(ms / scenario.durationMs) * 100}%` }}
          >
            {formatClock(ms)}
          </span>
        ))}
      </div>
    </section>
  );
}

/**
 * The effects an incident can hold, to carry onto the model.
 *
 * Grouped by what they are placed on: services (or every service of a
 * region), a client, and calls (every call into a service, or one
 * connection). Each is told by its name and a glyph, in ink. A chip is
 * carried with the pointer; pressed with the keyboard (or clicked without
 * moving), it is placed in the phase in hand on what is selected.
 *
 * A flow is drawn by clicking, one after another, the services it passes;
 * Done makes it a flow of the scenario, at a rate in the phase in hand.
 * Where the stage has no room for the palette beside the card it is a
 * `rail` of glyphs, each still named, as the platform's is.
 */
import { Check, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { t } from '@/i18n';
import {
  hopsThrough,
  newFlow,
  rowKey,
  type EffectKind,
  type ScenarioDraft,
} from '@/lib/scenarioFile';
import { useEditor } from '@/stores/editor';
import { useIncident } from '@/stores/incident';

import { addEffect, pressEffect } from '../interaction';

import { EFFECT_GLYPH, EFFECT_NAME, FLOW_GLYPH } from './effects';

const GROUPS: { title: string; kinds: EffectKind[] }[] = [
  { title: t('On services'), kinds: ['capacity', 'latency', 'errorInject', 'down'] },
  { title: t('On a client'), kinds: ['demand'] },
  { title: t('On calls'), kinds: ['edgeWeight', 'edgeLatency', 'edgeError'] },
];

function Chip({ kind, rail }: { kind: EffectKind; rail: boolean }) {
  const Glyph = EFFECT_GLYPH[kind];
  const label = EFFECT_NAME[kind];
  const carried = useEditor(
    (state) => state.carrying?.kind === 'effect' && state.carrying.effect === kind,
  );
  return (
    <button
      type="button"
      className={`group flex touch-none select-none items-center rounded-control border bg-paper text-left text-xs text-ink transition-[border-color,background-color,scale] duration-150 hover:border-line-strong hover:bg-raised active:scale-[0.98] cursor-grab active:cursor-grabbing ${
        rail ? 'size-10 justify-center' : 'min-h-9 gap-2 px-2 py-1.5'
      } ${carried ? 'border-focus bg-raised' : 'border-line'}`}
      onPointerDown={(event) => pressEffect(event.nativeEvent, event.currentTarget, kind)}
      onClick={(event) => {
        // A pointer's click was a press, already dealt with; this is the keyboard's.
        if (event.detail === 0) addEffect(kind);
      }}
      aria-label={t('Place: {effect}', { effect: label })}
      title={
        rail
          ? t('{effect}: drag onto the model, or press to place it on what is selected', {
              effect: label,
            })
          : t('Drag onto the model, or press to place it on what is selected')
      }
      data-testid={`effect-${kind}`}
      data-carried={carried || undefined}
    >
      <Glyph
        size={rail ? 17 : 15}
        strokeWidth={1.6}
        aria-hidden
        className={`shrink-0 group-hover:text-ink ${carried ? 'text-focus' : 'text-ink-dim'}`}
      />
      {!rail && <span className="min-w-0 leading-snug">{label}</span>}
    </button>
  );
}

/**
 * Makes the services clicked into a flow of the scenario, at a rate in the
 * phase in hand: as many requests as the first service it reaches takes at
 * rest, which the card lets be changed.
 */
export function finishFlow(): void {
  const incident = useIncident.getState();
  const draft = useEditor.getState().draft;
  const passed = incident.drawing;
  const phase = incident.phase;
  incident.draw(null);
  if (!draft || !passed || passed.length < 2 || phase === null) return;
  const hops = hopsThrough(draft, passed);
  let key = '';
  incident.change((scenario): ScenarioDraft => {
    const flow = newFlow(scenario, hops);
    key = flow.key;
    return {
      ...scenario,
      flows: [...scenario.flows, flow],
      phases: scenario.phases.map((entry) =>
        entry.key === phase
          ? {
              ...entry,
              effects: [
                ...entry.effects,
                {
                  key: rowKey(),
                  kind: 'flowRate',
                  flow: flow.id,
                  rate: { ofCapacity: { node: hops[0]!.to, factor: 1 } },
                },
              ],
            }
          : entry,
      ),
    };
  });
  if (key) useIncident.getState().selectItem(key);
}

function FlowTool({ rail }: { rail: boolean }) {
  const drawing = useIncident((state) => state.drawing);
  const Glyph = FLOW_GLYPH;
  if (drawing === null) {
    return (
      <button
        type="button"
        className={`group flex items-center rounded-control border border-line bg-paper text-left text-xs text-ink transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-raised ${
          rail ? 'size-10 justify-center' : 'min-h-9 gap-2 px-2 py-1.5'
        }`}
        onClick={() => useIncident.getState().draw([])}
        aria-label={t('Draw a flow')}
        title={t('Click, one after another, the services the flow passes')}
        data-testid="effect-flow"
      >
        <Glyph
          size={rail ? 17 : 15}
          strokeWidth={1.6}
          aria-hidden
          className="shrink-0 text-ink-dim group-hover:text-ink"
        />
        {!rail && <span className="min-w-0 leading-snug">{t('Draw a flow')}</span>}
      </button>
    );
  }
  return (
    <div className="grid gap-1.5" data-testid="flow-drawing">
      {!rail && (
        <p className="text-[11px] leading-snug text-ink-dim" role="status">
          {drawing.length === 0
            ? t('Click the service the flow starts at.')
            : t(
                drawing.length === 1
                  ? '{n} service so far. Click the next one it passes.'
                  : '{n} services so far. Click the next one, or finish.',
                { n: drawing.length },
              )}
        </p>
      )}
      <div className={rail ? 'grid gap-1.5' : 'flex gap-1.5'}>
        <Button
          size="sm"
          variant="primary"
          icon={<Check size={12} aria-hidden />}
          disabled={drawing.length < 2}
          onClick={finishFlow}
          aria-label={t('Finish the flow')}
          data-testid="flow-done"
        >
          {!rail && t('Done')}
        </Button>
        <Button
          size="sm"
          icon={<X size={12} aria-hidden />}
          onClick={() => useIncident.getState().draw(null)}
          aria-label={t('Stop drawing the flow')}
        >
          {!rail && t('Cancel')}
        </Button>
      </div>
    </div>
  );
}

export function IncidentPalette({ rail = false }: { rail?: boolean }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      data-testid="incident-palette"
      data-rail={rail || undefined}
    >
      {!rail && (
        <p className="border-b border-line px-3 py-2.5 text-[11px] leading-snug text-ink-dim">
          {t(
            'Carry an effect onto a service, a region or a connection: it holds during the phase in hand. Whatever a phase does not list eases back to normal.',
          )}
        </p>
      )}
      {GROUPS.map((group) => (
        <section
          key={group.title}
          className={`border-b border-line ${rail ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
          aria-label={rail ? group.title : undefined}
        >
          {!rail && <h3 className="mb-2 text-xs font-bold text-ink">{group.title}</h3>}
          <div className="grid grid-cols-1 gap-1.5">
            {group.kinds.map((kind) => (
              <Chip key={kind} kind={kind} rail={rail} />
            ))}
          </div>
        </section>
      ))}
      <section
        className={rail ? 'px-2.5 py-2' : 'px-3 py-2.5'}
        aria-label={rail ? t('Traffic of its own') : undefined}
      >
        {!rail && <h3 className="mb-2 text-xs font-bold text-ink">{t('Traffic of its own')}</h3>}
        <FlowTool rail={rail} />
      </section>
    </div>
  );
}

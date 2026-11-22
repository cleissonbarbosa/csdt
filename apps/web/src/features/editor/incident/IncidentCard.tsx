/**
 * The card of the incident being written: the scenario itself, the phase
 * in hand, what that phase holds, the flows the scenario injects and the
 * events the phase announces.
 *
 * Every field is a field of the file, under the name `docs/WORKSPACE.md`
 * gives it. An effect is placed by carrying it onto the model; here it is
 * opened to change its figure or what it is placed on, which the selects
 * offer by role first, then by region and by service, as a scenario that
 * runs on any platform with those roles is written. A time is typed in
 * seconds and kept as the file keeps it, in whole milliseconds.
 */
import { Plus, Trash2 } from 'lucide-react';

import { Button, IconButton } from '@/components/ui/Button';
import { NumberField, Select, Switch, TextArea, TextField } from '@/components/ui/Field';
import { Section } from '@/components/ui/Section';
import { EVENT_KIND_LABEL } from '@/features/scenarios/events';
import { t } from '@/i18n';
import { formatClock } from '@/lib/format';
import { SEVERITY_LABEL } from '@/lib/palette';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  draftProblems,
  EFFECT,
  EVENT_KINDS,
  inOrder,
  movePhase,
  PHASE_STATUSES,
  phaseEnd,
  removePhase,
  rowKey,
  selectorLabel,
  setRamp,
  SEVERITIES,
  slug,
  STATUS_LABEL,
  type EffectDraft,
  type EventDraft,
  type FlowDraft,
  type FlowRateEffect,
  type PhaseDraft,
  type PlacedEffect,
  type ScenarioDraft,
} from '@/lib/scenarioFile';
import type { TopologyDraft } from '@/lib/topologyFile';
import { useEditor } from '@/stores/editor';
import { useIncident } from '@/stores/incident';

import { scenariosInUse, startIncidentFrom } from '../open';

import {
  chipText,
  choicesOn,
  EFFECT_GLYPH,
  FLOW_GLYPH,
  placedOn,
  rateText,
  type Choice,
} from './effects';

/** The choice of "Start from" that starts nothing again. Not a path: paths have a slash. */
const KEEP = 'keep';

const change = (next: (scenario: ScenarioDraft) => ScenarioDraft, key?: string) =>
  useIncident.getState().change(next, key);

/** A time typed in seconds, as the file keeps it: whole milliseconds, never before zero. */
const millis = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

/** Changes one phase. */
const changePhase = (key: string, patch: (phase: PhaseDraft) => PhaseDraft, field: string) =>
  change(
    (scenario) => ({
      ...scenario,
      phases: scenario.phases.map((phase) => (phase.key === key ? patch(phase) : phase)),
    }),
    `phase:${key}:${field}`,
  );

/** Changes one effect of a phase, or takes it out (`null`). */
function changeEffect(
  phaseKey: string,
  effectKey: string,
  next: EffectDraft | null,
  field: string,
) {
  changePhase(
    phaseKey,
    (phase) => ({
      ...phase,
      effects: next
        ? phase.effects.map((effect) => (effect.key === effectKey ? next : effect))
        : phase.effects.filter((effect) => effect.key !== effectKey),
    }),
    `effect:${effectKey}:${field}`,
  );
}

function ChoiceSelect({
  label,
  value,
  choices,
  onChange,
  none,
  testId,
}: {
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  none?: string;
  testId?: string;
}) {
  const groups = [...new Set(choices.map((choice) => choice.group))];
  // A selector read from a file may name something this platform lacks; it
  // stays selectable so the file is not changed by being looked at.
  const known = value === '' || choices.some((choice) => choice.value === value);
  return (
    <Select
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      data-testid={testId}
    >
      {none !== undefined && <option value="">{none}</option>}
      {!known && <option value={value}>{t('{value} (not on this platform)', { value })}</option>}
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {choices
            .filter((choice) => choice.group === group)
            .map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

function PlacedRow({
  platform,
  phaseKey,
  effect,
  open,
}: {
  platform: TopologyDraft;
  phaseKey: string;
  effect: PlacedEffect;
  open: boolean;
}) {
  const shape = EFFECT[effect.kind];
  const Glyph = EFFECT_GLYPH[effect.kind];
  const set = (next: PlacedEffect, field: string) =>
    changeEffect(phaseKey, effect.key, next, field);
  return (
    <li
      className={`rounded-control border ${open ? 'border-focus' : 'border-line'}`}
      data-testid="effect-row"
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => useIncident.getState().selectItem(open ? null : effect.key)}
      >
        <Glyph size={14} strokeWidth={1.6} aria-hidden className="mt-0.5 shrink-0 text-ink-dim" />
        <span className="min-w-0">
          <span className="block text-xs text-ink">{chipText(effect)}</span>
          <span className="block text-[11px] leading-snug text-ink-faint">
            {t('on {what}', { what: placedOn(platform, effect) })}
          </span>
        </span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-line px-2 py-2">
          {!effect.between && (
            <ChoiceSelect
              label={shape.on === 'inbound' ? t('Every call into') : t('On#target')}
              value={effect.target}
              choices={choicesOn(platform, shape.on !== 'nodes')}
              none={t('Choose what it acts on…')}
              onChange={(target) => set({ ...effect, target }, 'target')}
              testId="effect-target"
            />
          )}
          {shape.figure !== 'none' && (
            <NumberField
              label={shape.figure === 'rate' ? t('Share, 0 to 1') : t('Factor')}
              min={0}
              max={shape.figure === 'rate' ? 1 : 1000}
              step="any"
              value={effect.value}
              onValue={(value) => set({ ...effect, value }, 'value')}
              hint={
                shape.figure === 'rate'
                  ? t('A share from 0 to 1')
                  : t('A factor: 1 leaves it as it is, 0.5 halves it, 2 doubles it')
              }
              data-testid="effect-value"
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={12} aria-hidden />}
            onClick={() => changeEffect(phaseKey, effect.key, null, 'remove')}
            data-testid="effect-remove"
          >
            {t('Remove this effect')}
          </Button>
        </div>
      )}
    </li>
  );
}

function RateRow({
  platform,
  scenario,
  phaseKey,
  effect,
  open,
}: {
  platform: TopologyDraft;
  scenario: ScenarioDraft;
  phaseKey: string;
  effect: FlowRateEffect;
  open: boolean;
}) {
  const flow = scenario.flows.find((entry) => entry.kind === 'flow' && entry.id === effect.flow);
  const Glyph = FLOW_GLYPH;
  const set = (next: FlowRateEffect, field: string) =>
    changeEffect(phaseKey, effect.key, next, field);
  const byCapacity = 'ofCapacity' in effect.rate;
  return (
    <li
      className={`rounded-control border ${open ? 'border-focus' : 'border-line'}`}
      data-testid="effect-row"
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => useIncident.getState().selectItem(open ? null : effect.key)}
      >
        <Glyph size={14} strokeWidth={1.6} aria-hidden className="mt-0.5 shrink-0 text-ink-dim" />
        <span className="min-w-0">
          <span className="block text-xs text-ink">
            {flow?.kind === 'flow' ? flow.label || flow.id : effect.flow}
          </span>
          <span className="block text-[11px] leading-snug text-ink-faint">
            {rateText(platform, effect.rate)}
          </span>
        </span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-line px-2 py-2">
          <Select
            label={t('Its rate')}
            value={byCapacity ? 'capacity' : 'rps'}
            onChange={(event) =>
              set(
                {
                  ...effect,
                  rate:
                    event.target.value === 'rps'
                      ? { rps: 100 }
                      : {
                          ofCapacity: {
                            node: choicesOn(platform, true)[0]?.value ?? '',
                            factor: 1,
                          },
                        },
                },
                'rate-kind',
              )
            }
          >
            <option value="capacity">{t('A multiple of a service’s capacity')}</option>
            <option value="rps">{t('Requests a second')}</option>
          </Select>
          {'ofCapacity' in effect.rate ? (
            <>
              <ChoiceSelect
                label={t('Of the capacity of')}
                value={effect.rate.ofCapacity.node}
                choices={choicesOn(platform, true)}
                onChange={(node) =>
                  'ofCapacity' in effect.rate &&
                  set(
                    { ...effect, rate: { ofCapacity: { ...effect.rate.ofCapacity, node } } },
                    'rate-node',
                  )
                }
              />
              <NumberField
                label={t('Factor')}
                min={0}
                max={1000}
                step="any"
                value={effect.rate.ofCapacity.factor}
                onValue={(factor) =>
                  'ofCapacity' in effect.rate &&
                  set(
                    { ...effect, rate: { ofCapacity: { ...effect.rate.ofCapacity, factor } } },
                    'rate-factor',
                  )
                }
                hint={t('So the same incident overloads a small platform and a large one alike.')}
              />
            </>
          ) : (
            <NumberField
              label={t('Requests a second')}
              min={0}
              step="any"
              value={effect.rate.rps}
              onValue={(rps) => set({ ...effect, rate: { rps } }, 'rate-rps')}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={12} aria-hidden />}
            onClick={() => changeEffect(phaseKey, effect.key, null, 'remove')}
          >
            {t('Remove this rate')}
          </Button>
        </div>
      )}
    </li>
  );
}

function FlowRow({
  platform,
  flow,
  open,
}: {
  platform: TopologyDraft;
  flow: FlowDraft;
  open: boolean;
}) {
  const set = (patch: Partial<FlowDraft>, field: string) =>
    change(
      (scenario) => ({
        ...scenario,
        flows: scenario.flows.map((entry) =>
          entry.key === flow.key ? { ...flow, ...patch } : entry,
        ),
      }),
      `flow:${flow.key}:${field}`,
    );
  const path = [flow.hops[0]?.from, ...flow.hops.map((hop) => hop.to)]
    .filter((entry): entry is string => entry !== undefined)
    .map((selector) => selectorLabel(platform, selector))
    .join(' → ');
  return (
    <li
      className={`rounded-control border ${open ? 'border-focus' : 'border-line'}`}
      data-testid="flow-row"
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => useIncident.getState().selectItem(open ? null : flow.key)}
      >
        <FLOW_GLYPH
          size={14}
          strokeWidth={1.6}
          aria-hidden
          className="mt-0.5 shrink-0 text-ink-dim"
        />
        <span className="min-w-0">
          <span className="block text-xs text-ink">{flow.label || flow.id}</span>
          <span className="block text-[11px] leading-snug text-ink-faint">{path}</span>
        </span>
      </button>
      {open && (
        <div className="grid gap-1.5 border-t border-line px-2 py-2">
          <TextField
            label={t('Name')}
            value={flow.label}
            onChange={(event) => set({ label: event.target.value }, 'label')}
          />
          <TextField
            label={t('Id')}
            value={flow.id}
            spellCheck={false}
            hint={t('What the phases name it by when they set its rate.')}
            onChange={(event) => {
              const id = event.target.value;
              // The phases that set its rate follow it.
              change(
                (scenario) => ({
                  ...scenario,
                  flows: scenario.flows.map((entry) =>
                    entry.key === flow.key ? { ...flow, id } : entry,
                  ),
                  phases: scenario.phases.map((phase) => ({
                    ...phase,
                    effects: phase.effects.map((effect) =>
                      effect.kind === 'flowRate' && effect.flow === flow.id
                        ? { ...effect, flow: id }
                        : effect,
                    ),
                  })),
                }),
                `flow:${flow.key}:id`,
              );
            }}
          />
          <Switch
            label={t('Hostile')}
            hint={t('Drawn as hostile traffic.')}
            checked={flow.suspicious}
            onCheckedChange={(suspicious) => set({ suspicious }, 'suspicious')}
          />
          <Switch
            label={t('Joins the traffic where it ends')}
            hint={t(
              'What survives the last hop goes on to what that service calls, as a flood does.',
            )}
            checked={flow.spill}
            onCheckedChange={(spill) => set({ spill }, 'spill')}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={12} aria-hidden />}
            onClick={() =>
              change((scenario) => ({
                ...scenario,
                flows: scenario.flows.filter((entry) => entry.key !== flow.key),
                // A rate of a flow that is gone sets nothing.
                phases: scenario.phases.map((phase) => ({
                  ...phase,
                  effects: phase.effects.filter(
                    (effect) => effect.kind !== 'flowRate' || effect.flow !== flow.id,
                  ),
                })),
              }))
            }
          >
            {t('Remove this flow')}
          </Button>
        </div>
      )}
    </li>
  );
}

function EventRow({ phaseKey, event }: { phaseKey: string; event: EventDraft }) {
  const set = (patch: Partial<EventDraft>, field: string) =>
    changePhase(
      phaseKey,
      (phase) => ({
        ...phase,
        events: phase.events.map((entry) =>
          entry.key === event.key ? { ...entry, ...patch } : entry,
        ),
      }),
      `event:${event.key}:${field}`,
    );
  return (
    <li className="grid gap-1.5 rounded-control border border-line p-2" data-testid="event-draft">
      <TextField
        label={t('What it says')}
        placeholder={t('What the event says')}
        value={event.title}
        onChange={(e) => set({ title: e.target.value }, 'title')}
      />
      <div className="grid grid-cols-3 gap-1.5">
        <NumberField
          label={t('After, s')}
          min={0}
          step="any"
          value={event.delayMs / 1000}
          onValue={(value) => set({ delayMs: millis(value) }, 'delay')}
          title={t('Seconds after the phase begins')}
        />
        <Select
          label={t('Severity')}
          value={event.severity}
          onChange={(e) => set({ severity: e.target.value as EventDraft['severity'] }, 'severity')}
        >
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_LABEL[severity]}
            </option>
          ))}
        </Select>
        <Select
          label={t('Kind')}
          value={event.kind}
          onChange={(e) => set({ kind: e.target.value as EventDraft['kind'] }, 'kind')}
        >
          {EVENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {EVENT_KIND_LABEL[kind]}
            </option>
          ))}
        </Select>
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon={<Trash2 size={12} aria-hidden />}
        onClick={() =>
          changePhase(
            phaseKey,
            (phase) => ({
              ...phase,
              events: phase.events.filter((entry) => entry.key !== event.key),
            }),
            'events',
          )
        }
      >
        {t('Remove this event')}
      </Button>
    </li>
  );
}

function ScenarioFields({
  platform,
  scenario,
}: {
  platform: TopologyDraft;
  scenario: ScenarioDraft;
}) {
  const idTouched = useIncident((state) => state.idTouched);
  const set = (patch: Partial<ScenarioDraft>, field: string) =>
    change((current) => ({ ...current, ...patch }), `scenario:${field}`);
  const inUse = scenariosInUse();
  return (
    <div className="grid gap-2">
      <Select
        label={t('Start from')}
        value={KEEP}
        onChange={(event) => {
          if (event.target.value === KEEP) return;
          const failure = startIncidentFrom(event.target.value);
          if (failure) useEditor.getState().refuse({ message: failure, circle: [] });
        }}
        data-testid="incident-start-from"
      >
        <option value={KEEP}>{t('This scenario, as it is')}</option>
        <option value="">{t('A blank scenario')}</option>
        {inUse.map((file) => (
          <option key={file.path} value={file.path}>
            {t('A copy of {name}', { name: file.path.split('/').pop() ?? file.path })}
          </option>
        ))}
      </Select>
      <TextField
        label={t('Name')}
        value={scenario.name}
        onChange={(event) =>
          set(
            { name: event.target.value, ...(idTouched ? {} : { id: slug(event.target.value) }) },
            'name',
          )
        }
        data-testid="incident-name"
      />
      <TextField
        label={t('Id, as the file and the API name it')}
        value={scenario.id}
        spellCheck={false}
        onChange={(event) => {
          useIncident.setState({ idTouched: true });
          set({ id: event.target.value }, 'id');
        }}
        data-testid="incident-id"
      />
      <TextArea
        label={t('Summary')}
        value={scenario.summary}
        onChange={(event) => set({ summary: event.target.value }, 'summary')}
      />
      <div className="grid grid-cols-2 gap-2">
        <Select
          label={t('Category')}
          value={scenario.category}
          onChange={(event) =>
            set({ category: event.target.value as ScenarioDraft['category'] }, 'category')
          }
        >
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABEL[category]}
            </option>
          ))}
        </Select>
        <Select
          label={t('Severity')}
          value={scenario.severity}
          onChange={(event) =>
            set({ severity: event.target.value as ScenarioDraft['severity'] }, 'severity')
          }
        >
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_LABEL[severity]}
            </option>
          ))}
        </Select>
      </div>
      <ChoiceSelect
        label={t('Root cause, if it names one')}
        value={scenario.rootCause}
        choices={choicesOn(platform, true)}
        none={t('None named')}
        onChange={(rootCause) => set({ rootCause }, 'root-cause')}
        testId="incident-root-cause"
      />
    </div>
  );
}

export function IncidentCard() {
  const platform = useEditor((state) => state.draft);
  const scenario = useIncident((state) => state.scenario);
  const phaseKey = useIncident((state) => state.phase);
  const item = useIncident((state) => state.item);
  if (!platform || !scenario) return null;
  const phases = inOrder(scenario);
  const index = phases.findIndex((phase) => phase.key === phaseKey);
  const phase = phases[index] ?? null;
  const problems = draftProblems(scenario);
  const flows = scenario.flows.filter((flow): flow is FlowDraft => flow.kind === 'flow');
  const kept = scenario.flows.length - flows.length;

  return (
    <div data-testid="incident-card">
      <header className="border-b border-line px-3 py-3">
        <h2 className="text-sm font-bold text-ink">{scenario.name || t('Untitled incident')}</h2>
        <p className="mt-0.5 text-[11px] text-ink-faint">
          {t('{n} phases, {length} long', {
            n: phases.length,
            length: formatClock(scenario.durationMs),
          })}
        </p>
      </header>
      {problems.length > 0 && (
        <Section title={t('Before the engine can check it')}>
          <ul
            className="grid gap-1 text-[11px] leading-snug text-warning"
            data-testid="incident-problems"
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Section>
      )}
      {phase && (
        <Section
          title={t('Phase {n}: {name}', { n: index + 1, name: phase.name })}
          aside={
            <IconButton
              label={t('Remove this phase')}
              size="sm"
              disabled={phases.length === 1}
              onClick={() => change((current) => removePhase(current, phase.key))}
              data-testid="phase-remove"
            >
              <Trash2 size={13} />
            </IconButton>
          }
        >
          <div className="grid gap-2" data-testid="phase-card">
            <TextField
              label={t('Name')}
              value={phase.name}
              onChange={(event) =>
                changePhase(phase.key, (p) => ({ ...p, name: event.target.value }), 'name')
              }
              data-testid="phase-name"
            />
            <div className="grid grid-cols-3 gap-1.5">
              <NumberField
                label={t('Starts at, s')}
                min={0}
                step="any"
                disabled={index === 0}
                value={phase.atMs / 1000}
                onValue={(value) =>
                  change(
                    (current) => movePhase(current, phase.key, millis(value)),
                    `phase:${phase.key}:at`,
                  )
                }
                title={t('Seconds after the incident starts')}
                data-testid="phase-at"
              />
              <NumberField
                label={t('Eases in, s')}
                min={0}
                step="any"
                value={phase.rampMs / 1000}
                onValue={(value) =>
                  change(
                    (current) => setRamp(current, phase.key, millis(value)),
                    `phase:${phase.key}:ramp`,
                  )
                }
                title={t('How long its effects take to ease in from what held before')}
              />
              <Select
                label={t('Incident is')}
                value={phase.status}
                onChange={(event) =>
                  changePhase(
                    phase.key,
                    (p) => ({ ...p, status: event.target.value as PhaseDraft['status'] }),
                    'status',
                  )
                }
              >
                {PHASE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-[11px] text-ink-faint">
              {t('Holds from {start} to {end}.', {
                start: formatClock(phase.atMs),
                end: formatClock(phaseEnd(scenario, phase.key)),
              })}
            </p>
            <TextArea
              label={t('What happens, in a sentence')}
              value={phase.description}
              onChange={(event) =>
                changePhase(
                  phase.key,
                  (p) => ({ ...p, description: event.target.value }),
                  'description',
                )
              }
            />
          </div>
        </Section>
      )}
      {phase && (
        <Section title={t('What it holds')}>
          {phase.effects.length === 0 ? (
            <p className="text-[11px] leading-snug text-ink-faint">
              {t(
                'Nothing: everything eases back to normal. Carry an effect from the palette onto the model.',
              )}
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {phase.effects.map((effect) =>
                effect.kind === 'raw' ? (
                  <li
                    key={effect.key}
                    className="flex items-center gap-2 text-[11px]"
                    data-testid="effect-raw"
                  >
                    <span className="code min-w-0 flex-1 truncate text-ink-dim">
                      {JSON.stringify(effect.json)}
                    </span>
                    <span className="shrink-0 text-ink-faint">{t('kept as written')}</span>
                  </li>
                ) : effect.kind === 'flowRate' ? (
                  <RateRow
                    key={effect.key}
                    platform={platform}
                    scenario={scenario}
                    phaseKey={phase.key}
                    effect={effect}
                    open={item === effect.key}
                  />
                ) : (
                  <PlacedRow
                    key={effect.key}
                    platform={platform}
                    phaseKey={phase.key}
                    effect={effect}
                    open={item === effect.key}
                  />
                ),
              )}
            </ul>
          )}
        </Section>
      )}
      {phase && (
        <Section
          title={t('Events it announces')}
          aside={
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus size={12} aria-hidden />}
              onClick={() =>
                changePhase(
                  phase.key,
                  (p) => ({
                    ...p,
                    events: [
                      ...p.events,
                      {
                        key: rowKey(),
                        delayMs: 4000,
                        severity: 'warning',
                        kind: 'alert',
                        title: '',
                        message: '',
                        nodes: [],
                      },
                    ],
                  }),
                  'events',
                )
              }
            >
              {t('Add an event')}
            </Button>
          }
        >
          {phase.events.length === 0 ? (
            <p className="text-[11px] text-ink-faint">{t('None.')}</p>
          ) : (
            <ul className="grid gap-1.5">
              {phase.events.map((event) => (
                <EventRow key={event.key} phaseKey={phase.key} event={event} />
              ))}
            </ul>
          )}
        </Section>
      )}
      <Section title={t('Flows it injects')}>
        {flows.length === 0 && kept === 0 ? (
          <p className="text-[11px] leading-snug text-ink-faint">
            {t('None. Draw one from the palette, through the services it passes.')}
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {flows.map((flow) => (
              <FlowRow key={flow.key} platform={platform} flow={flow} open={item === flow.key} />
            ))}
          </ul>
        )}
        {kept > 0 && (
          <p className="mt-1.5 text-[11px] text-ink-faint">
            {t(kept === 1 ? '{n} flow is kept as written.' : '{n} flows are kept as written.', {
              n: kept,
            })}
          </p>
        )}
      </Section>
      <Section title={t('The incident')}>
        <ScenarioFields platform={platform} scenario={scenario} />
      </Section>
    </div>
  );
}

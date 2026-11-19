/**
 * The same incident twice, with one thing changed.
 *
 * Because the engine is deterministic, a scenario run again from the same
 * seed is the same incident. This dialog asks the server to run it twice on
 * timelines of their own, the second time with one fault placed, and lays
 * the two side by side. What differs between them follows from that one
 * change, which is said in full. The timeline in use is left alone until
 * the viewer asks to watch one of the runs on it.
 */
import type { Experiment, MetricSample, Topology } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { SourceBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Select, TextField } from '@/components/ui/Field';
import { ServiceName } from '@/components/ui/ServiceName';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import {
  affectedOnlyIn,
  comparedRows,
  experimentText,
  INTERVENTIONS,
  interventionEffect,
  placedAtMs,
  sameUntilPlaced,
  type InterventionKind,
  lowestAt,
  MAX_SWEEP,
  parseSweep,
  SWEEP_VALUES,
  sweepOf,
  type Sweep,
} from '@/lib/experiment';
import { formatClock, formatMs, formatPercent } from '@/lib/format';
import { nodeLabel } from '@/lib/names';
import { api, ApiError } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { CopyText } from './CopyText';
import { RunsChart, RunStroke } from './RunsChart';

/** How long the fault takes to ease in, as one placed from a service's card does. */
const RAMP_MS = 2000;

/** The two figures drawn over the runs. */
const MEASURES: [string, (sample: MetricSample) => number, (value: number) => string][] = [
  [t('Error rate'), (sample) => sample.errorRate, formatPercent],
  [t('Latency p95'), (sample) => sample.p95LatencyMs, formatMs],
];

function Results({ experiment, onWatch }: { experiment: Experiment; onWatch: () => void }) {
  const topology = useTelemetry((state) => state.topology);
  const rows = comparedRows(experiment);
  const only = affectedOnlyIn(experiment);
  const { intervention } = experiment;
  const names = intervention.nodeIds.map((id) => nodeLabel(topology, id)).join(', ');
  const [busy, setBusy] = useState(false);
  const watch = async (run: 'baseline' | 'variant') => {
    setBusy(true);
    const ok = await actions.loadSession(experiment[run].recording);
    setBusy(false);
    if (ok) onWatch();
  };
  const list = (ids: string[]) =>
    ids.map((id, i) => (
      <span key={id}>
        {i > 0 && '; '}
        <ServiceName topology={topology} id={id} />
      </span>
    ));
  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4" data-testid="experiment-results">
      <section>
        <h3 className="text-xs font-bold text-ink">{t('What changed')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink" data-testid="experiment-change">
          {tr(
            'In run B, <b>{change}</b> on {services}, placed <n>+{at}</n> into the incident and eased in over <n>{ramp}</n>.',
            {
              b: (children) => <span className="font-bold">{children}</span>,
              n: (children) => <span className="numeric">{children}</span>,
              // What the server says it changed, as it wrote it.
              change: intervention.description,
              services: names,
              at: formatClock(intervention.atMs),
              ramp: formatMs(intervention.rampMs),
            },
          )}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
          {tr(
            'Nothing else differs: both runs are {scenario} on <c>{topology}</c> with seed <n>{seed}</n>.',
            {
              c: (children) => <span className="code">{children}</span>,
              n: (children) => <span className="numeric">{children}</span>,
              scenario: experiment.scenarioName,
              topology: experiment.topologyId,
              seed: experiment.seed,
            },
          )}{' '}
          {sameUntilPlaced(experiment)
            ? t('Until the change is placed the two runs are identical, sample for sample.')
            : t(
                'The two runs differ before the change was placed, which should not happen: do not rely on this comparison.',
              )}
        </p>
        <details className="mt-1.5">
          <summary className="text-[11px] text-ink-dim hover:text-ink">
            {t('The exact commands')}
          </summary>
          <pre className="code mt-1 max-h-48 overflow-auto rounded-control border border-line bg-sunken p-2 text-[11px] leading-relaxed text-ink-dim">
            {JSON.stringify(
              {
                seed: experiment.seed,
                topologyId: experiment.topologyId,
                runA: experiment.baseline.recording.commands,
                runB: experiment.variant.recording.commands,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </section>

      <section>
        <table className="w-full border-collapse text-xs" data-testid="experiment-table">
          <thead>
            <tr className="text-left">
              <th className="py-1 font-normal text-ink-faint" />
              <th className="px-2 py-1 font-bold text-ink">
                A <span className="font-normal text-ink-dim">{t('as it is')}</span>
              </th>
              <th className="px-2 py-1 font-bold text-ink">
                B <span className="font-normal text-ink-dim">{t('with the change')}</span>
              </th>
              <th className="px-2 py-1 font-normal text-ink-faint">{t('B against A')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-y border-line">
            {rows.map((row) => (
              <tr key={row.id} data-testid={`experiment-row-${row.id}`}>
                <th scope="row" className="py-1.5 text-left font-normal text-ink-dim">
                  {row.label}
                </th>
                <td className="numeric px-2 py-1.5 text-ink">{row.a}</td>
                <td className="numeric px-2 py-1.5 text-ink">{row.b}</td>
                <td className="numeric px-2 py-1.5 text-ink-dim">
                  {row.delta || <span className="text-ink-faint">{t('the same')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(only.a.length > 0 || only.b.length > 0) && (
          <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-ink-dim">
            {only.a.length > 0 && (
              <p>{tr('Affected only in A: {services}.', { services: list(only.a) })}</p>
            )}
            {only.b.length > 0 && (
              <p>{tr('Affected only in B: {services}.', { services: list(only.b) })}</p>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="grid gap-3 sm:grid-cols-2">
          {MEASURES.map(([label, value, format]) => (
            <RunsChart
              key={label}
              a={experiment.baseline.samples}
              b={experiment.variant.samples}
              durationMs={experiment.durationMs}
              startedAtMs={experiment.incidentStartedAtMs}
              placedAtMs={placedAtMs(experiment)}
              label={label}
              value={value}
              format={format}
              summary={(a, b) =>
                t('{measure} over both runs. As it is: up to {a}. With the change: up to {b}.', {
                  measure: label,
                  a,
                  b,
                })
              }
            />
          ))}
        </div>
        <p className="caption mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <RunStroke run="a" />
            {t('A, as it is')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <RunStroke run="b" />
            {t('B, with the change')}
          </span>
          <span>
            {tr(
              'The thin tick is where the incident begins, the thick one where the change is placed. Each run lasts <n>{duration}</n>.',
              {
                n: (children) => <span className="numeric">{children}</span>,
                duration: formatClock(experiment.durationMs),
              },
            )}
          </span>
          <SourceBadge source={experiment.dataSource} />
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={<Play size={12} aria-hidden />}
          disabled={busy}
          onClick={() => void watch('variant')}
          data-testid="experiment-watch-b"
          title={t('Replaces the timeline in use with run B, to play back and scrub')}
        >
          {t('Watch run B on the timeline')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void watch('baseline')}
          data-testid="experiment-watch-a"
          title={t('Replaces the timeline in use with run A')}
        >
          {t('Watch run A')}
        </Button>
        <span className="caption">{t('Watching a run replaces the timeline in use.')}</span>
        <CopyText text={() => experimentText(experiment, topology)} testId="experiment-copy" />
      </section>
    </div>
  );
}

/**
 * A service to start from: one the scenario targets that is part of the
 * platform, not a population of clients outside it. The last such target is
 * the deepest one the scenario reaches, which is usually what it is about.
 */
const SWEEP_W = 250;
const SWEEP_H = 72;

/**
 * One measure of a sweep against the figure it was run at. A dot is a run
 * the engine made; the line between two dots only joins them, and says
 * nothing of the figures in between. The hairline is the incident as it is.
 */
function SweepChart({
  sweep,
  label,
  measure,
  format,
  unit,
}: {
  sweep: Sweep;
  label: string;
  measure: (point: Sweep['baseline']) => number | null;
  format: (value: number) => string;
  unit: 'factor' | 'percent';
}) {
  const points = sweep.points.flatMap((point) => {
    const value = measure(point);
    return value === null ? [] : [{ at: point.value, value }];
  });
  const asItIs = measure(sweep.baseline);
  if (points.length === 0) return null;
  const low = Math.min(...points.map((point) => point.at));
  const high = Math.max(...points.map((point) => point.at));
  const top = Math.max(...points.map((point) => point.value), asItIs ?? 0, 1e-9);
  const x = (at: number) =>
    high === low ? SWEEP_W / 2 : 6 + ((at - low) / (high - low)) * (SWEEP_W - 12);
  const y = (value: number) => SWEEP_H - 4 - (value / top) * (SWEEP_H - 14);
  const figure = (at: number) => (unit === 'factor' ? `×${at}` : `${at}%`);
  const byFigure = points.map((point) => `${figure(point.at)} ${format(point.value)}`).join(', ');
  return (
    <figure className="min-w-0">
      <figcaption className="caption mb-1">
        {t('{measure}, up to {peak}', { measure: label, peak: format(top) })}
      </figcaption>
      <svg
        viewBox={`0 0 ${SWEEP_W} ${SWEEP_H}`}
        className="h-[72px] w-full"
        role="img"
        aria-label={
          asItIs === null
            ? t('{measure} by figure: {points}', { measure: label, points: byFigure })
            : t('{measure} by figure: {points}; as it is {baseline}', {
                measure: label,
                points: byFigure,
                baseline: format(asItIs),
              })
        }
      >
        {asItIs !== null && (
          <line
            x1={0}
            x2={SWEEP_W}
            y1={y(asItIs)}
            y2={y(asItIs)}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        <polyline
          points={points
            .map((point) => `${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`)
            .join(' ')}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={1.25}
        />
        {points.map((point) => (
          <circle
            key={point.at}
            cx={x(point.at)}
            cy={y(point.value)}
            r={2.5}
            fill="var(--color-ink)"
          />
        ))}
      </svg>
      <div className="numeric flex justify-between text-[10px] text-ink-faint">
        <span>{figure(low)}</span>
        {high !== low && <span>{figure(high)}</span>}
      </div>
    </figure>
  );
}

/** The same intervention at several figures: what each did, read from its run. */
function SweepResults({ sweep, unit }: { sweep: Sweep; unit: 'factor' | 'percent' }) {
  const figure = (value: number) => (unit === 'factor' ? `×${value}` : `${value}%`);
  const error = (point: Sweep['baseline']) => point.peakErrorRate;
  const latency = (point: Sweep['baseline']) => point.peakP95LatencyMs;
  const calmest = lowestAt(sweep, error);
  const rows = [
    { key: t('as it is'), point: sweep.baseline },
    ...sweep.points.map((point) => ({ key: figure(point.value), point })),
  ];
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4" data-testid="sweep-results">
      <p className="text-xs leading-relaxed text-ink">
        {tr(
          // One figure is written as English has always written it; the note
          // lets another language say it in the singular.
          sweep.points.length === 1
            ? '<b>The same change at {n} figures.</b> Each row is a run of its own from the same seed; the first is the incident as it is.#one'
            : '<b>The same change at {n} figures.</b> Each row is a run of its own from the same seed; the first is the incident as it is.',
          {
            b: (children) => <span className="font-bold">{children}</span>,
            n: sweep.points.length,
          },
        )}
        {calmest !== null && (
          <>
            {' '}
            {tr('The highest error rate was lowest at <n>{figure}</n>.', {
              n: (children) => <span className="numeric">{children}</span>,
              figure: figure(calmest),
            })}
          </>
        )}
      </p>
      <table className="w-full border-collapse text-xs" data-testid="sweep-table">
        <thead>
          <tr className="border-b border-line-strong text-left">
            <th scope="col" className="caption py-1 pr-2 font-normal">
              {t('Figure')}
            </th>
            <th scope="col" className="caption px-2 py-1 font-normal">
              {t('Highest error rate')}
            </th>
            <th scope="col" className="caption px-2 py-1 font-normal">
              {t('Highest latency p95')}
            </th>
            <th scope="col" className="caption px-2 py-1 font-normal">
              {t('Services affected')}
            </th>
            <th scope="col" className="caption py-1 pl-2 font-normal">
              {t('All back to normal')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, point }, i) => (
            <tr
              key={key}
              className="border-b border-line last:border-b-0"
              data-testid={`sweep-row-${i}`}
            >
              <th
                scope="row"
                className={
                  i === 0
                    ? 'py-1 pr-2 font-normal text-ink-dim'
                    : 'numeric py-1 pr-2 font-bold text-ink'
                }
              >
                {key}
              </th>
              <td className="numeric px-2 py-1 text-ink">
                {point.peakErrorRate === null ? t('n/a') : formatPercent(point.peakErrorRate)}
              </td>
              <td className="numeric px-2 py-1 text-ink">
                {point.peakP95LatencyMs === null ? t('n/a') : formatMs(point.peakP95LatencyMs)}
              </td>
              <td className="numeric px-2 py-1 text-ink">{point.affected}</td>
              <td className="numeric py-1 pl-2 text-ink">
                {point.affected === 0
                  ? t('nothing was affected')
                  : point.recoveredMs === null
                    ? t('not within the run')
                    : `+${formatClock(point.recoveredMs)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-4 sm:grid-cols-2">
        <SweepChart
          sweep={sweep}
          label={t('Highest error rate')}
          measure={error}
          format={formatPercent}
          unit={unit}
        />
        <SweepChart
          sweep={sweep}
          label={t('Highest latency p95')}
          measure={latency}
          format={formatMs}
          unit={unit}
        />
      </div>
      <p className="caption">
        {t('A dot is a run; the line only joins them. The dashed line is the incident as it is.')}
      </p>
    </div>
  );
}

function firstTarget(targets: string[], topology: Topology | null): string {
  const services = targets.filter(
    (id) => topology?.nodes.find((node) => node.id === id)?.serviceType !== 'external-client',
  );
  return services.at(-1) ?? targets[0] ?? topology?.nodes[0]?.id ?? '';
}

export function ExperimentDialog() {
  const open = useUi((state) => state.openPanel === 'experiment');
  const asked = useUi((state) => state.experimentScenarioId);
  const topology = useTelemetry((state) => state.topology);
  const { data: scenarios } = useQuery({
    queryKey: queryKeys.scenarios,
    queryFn: api.scenarios,
    enabled: open,
  });
  const available = useMemo(
    () => scenarios?.scenarios.filter((scenario) => scenario.available) ?? [],
    [scenarios],
  );

  const [scenarioId, setScenarioId] = useState('');
  const [kind, setKind] = useState<InterventionKind>('capacity');
  const [nodeId, setNodeId] = useState('');
  const [value, setValue] = useState('2');
  const [atSeconds, setAtSeconds] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Experiment | null>(null);
  // The same change at several figures, and how far the runs have got.
  const [range, setRange] = useState(SWEEP_VALUES.factor.join(', '));
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);

  const scenario = available.find((entry) => entry.id === scenarioId);
  // What the form asks, counted: an answer is shown only if the form is
  // still the one it was asked of.
  const question = useRef(0);
  const forget = () => {
    question.current += 1;
    setResult(null);
    setSweep(null);
  };
  // Opening on a scenario takes it up, with the service it targets and a
  // moment a fifth of the way in: something to run as it stands. It is
  // taken up once per opening; after that the choice is the viewer's.
  const takenUp = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!open) {
      takenUp.current = undefined;
      return;
    }
    if (available.length === 0) return;
    const current = available.find((entry) => entry.id === scenarioId);
    const first = takenUp.current !== asked;
    takenUp.current = asked;
    const chosen = (first ? available.find((entry) => entry.id === asked) : undefined) ?? current;
    // A scenario that went with its platform cannot stay chosen either.
    const next = chosen ?? available[0]!;
    if (next.id !== scenarioId) {
      setScenarioId(next.id);
      setNodeId(firstTarget(next.targetNodeIds, topology));
      setAtSeconds(String(Math.round(next.durationMs / 5000)));
      question.current += 1;
      setResult(null);
      setError(null);
    }
  }, [open, asked, available, scenarioId, topology]);
  // A service that is gone with its platform cannot stay chosen.
  useEffect(() => {
    if (topology && nodeId && !topology.nodes.some((node) => node.id === nodeId)) {
      setNodeId(topology.nodes[0]?.id ?? '');
      question.current += 1;
      setResult(null);
    }
  }, [topology, nodeId]);

  const choice = INTERVENTIONS.find((entry) => entry.kind === kind)!;
  const figure = Number(value);
  const at = Number(atSeconds);
  const lastSecond = scenario ? Math.max(0, Math.ceil(scenario.durationMs / 1000) - 1) : 0;
  const valid =
    scenario !== undefined &&
    nodeId !== '' &&
    Number.isFinite(at) &&
    at >= 0 &&
    at <= lastSecond &&
    (choice.unit === null ||
      (Number.isFinite(figure) && figure >= 0 && (choice.unit === 'factor' || figure <= 100)));

  const run = async () => {
    if (!scenario || !valid) return;
    setBusy(true);
    setError(null);
    question.current += 1;
    const asking = question.current;
    try {
      const answer = await api.compareIntervention({
        scenarioId: scenario.id,
        intervention: {
          effect: interventionEffect(kind, nodeId, figure),
          atMs: Math.round(at * 1000),
          rampMs: RAMP_MS,
        },
      });
      // The form moved on while both runs were simulated: this answers
      // what it asked before, and is not put beside what it asks now.
      if (asking === question.current) setResult(answer);
    } catch (cause) {
      if (asking === question.current) {
        setResult(null);
        setError(cause instanceof ApiError ? cause.message : t('The comparison could not be run.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const figures = choice.unit === null ? null : parseSweep(range, choice.unit);
  const runRange = async () => {
    if (!scenario || !valid || choice.unit === null || figures === null) return;
    setBusy(true);
    setError(null);
    question.current += 1;
    const asking = question.current;
    setResult(null);
    setSweep(null);
    const runs: { value: number; experiment: Experiment }[] = [];
    try {
      // One after another: each is two runs of the whole incident.
      for (const [i, value] of figures.entries()) {
        if (asking !== question.current) return;
        setProgress({ done: i, of: figures.length });
        const experiment = await api.compareIntervention({
          scenarioId: scenario.id,
          intervention: {
            effect: interventionEffect(kind, nodeId, value),
            atMs: Math.round(at * 1000),
            rampMs: RAMP_MS,
          },
        });
        runs.push({ value, experiment });
      }
      if (asking === question.current) setSweep(sweepOf(runs));
    } catch (cause) {
      if (asking === question.current) {
        setError(cause instanceof ApiError ? cause.message : t('The comparison could not be run.'));
      }
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const regions = topology?.regions ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'experiment' : null)}
      title={t('Compare an intervention')}
      description={t(
        'The same scenario, run twice from the same seed on timelines of their own. The second run has one change. The timeline in use is not touched.',
      )}
      width="max-w-3xl"
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        data-testid="experiment-form"
      >
        <Select
          label={t('Scenario')}
          value={scenarioId}
          onChange={(event) => {
            const next = available.find((entry) => entry.id === event.target.value);
            setScenarioId(event.target.value);
            if (next) {
              setNodeId(firstTarget(next.targetNodeIds, topology) || nodeId);
              setAtSeconds(String(Math.round(next.durationMs / 5000)));
            }
            forget();
          }}
          className="sm:col-span-2"
          data-testid="experiment-scenario"
        >
          {available.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({formatClock(entry.durationMs)})
            </option>
          ))}
        </Select>
        <Select
          label={t('The one change in run B')}
          value={kind}
          onChange={(event) => {
            const next = INTERVENTIONS.find((entry) => entry.kind === event.target.value)!;
            setKind(next.kind);
            setValue(String(next.value));
            setRange(next.unit === null ? '' : SWEEP_VALUES[next.unit].join(', '));
            forget();
          }}
          data-testid="experiment-kind"
        >
          {INTERVENTIONS.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {entry.label}
            </option>
          ))}
        </Select>
        <Select
          label={t('On this service')}
          value={nodeId}
          onChange={(event) => {
            setNodeId(event.target.value);
            forget();
          }}
          data-testid="experiment-node"
        >
          {regions.map((region) => (
            <optgroup key={region.id} label={region.name}>
              {topology?.nodes
                .filter((node) => node.region === region.id)
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        {choice.unit !== null && (
          <TextField
            label={
              choice.unit === 'factor' ? t('Multiplied by') : t('Share that fails, in percent')
            }
            type="number"
            inputMode="decimal"
            min={0}
            max={choice.unit === 'percent' ? 100 : 1000}
            step="any"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              forget();
            }}
            hint={choice.hint}
            data-testid="experiment-value"
          />
        )}
        <TextField
          label={t('Placed this many seconds into the incident')}
          type="number"
          inputMode="numeric"
          min={0}
          max={lastSecond}
          step={1}
          value={atSeconds}
          onChange={(event) => {
            setAtSeconds(event.target.value);
            forget();
          }}
          hint={
            scenario
              ? t('From 0 to {last}: the scenario lasts {duration}.', {
                  last: lastSecond,
                  duration: formatClock(scenario.durationMs),
                })
              : undefined
          }
          className={choice.unit === null ? 'sm:col-span-1' : undefined}
          data-testid="experiment-at"
        />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!valid || busy}
            data-testid="experiment-run"
          >
            {busy ? t('Running both…') : result ? t('Run both again') : t('Run both')}
          </Button>
          {available.length === 0 && scenarios && (
            <p className="text-xs text-ink-dim">{t('No scenario can run on this platform.')}</p>
          )}
          {error && (
            <p role="alert" className="text-xs text-critical">
              {error}
            </p>
          )}
        </div>
      </form>
      {choice.unit !== null && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runRange();
          }}
          data-testid="sweep-form"
        >
          <TextField
            label={
              choice.unit === 'factor'
                ? t('Or the same change at several figures (multipliers)')
                : t('Or the same change at several figures (percentages)')
            }
            value={range}
            onChange={(event) => {
              setRange(event.target.value);
              setSweep(null);
            }}
            hint={t(
              'Up to {max}, separated by commas. Each is run against the incident as it is.',
              { max: MAX_SWEEP },
            )}
            className="min-w-[16rem] flex-1"
            data-testid="sweep-values"
          />
          <Button
            type="submit"
            disabled={!valid || busy || figures === null}
            data-testid="sweep-run"
          >
            {progress
              ? t('Running {n} of {total}…', { n: progress.done + 1, total: progress.of })
              : t('Run them all')}
          </Button>
        </form>
      )}
      <p className="caption mt-3" data-testid="experiment-to-files">
        {tr(
          'A change this form cannot make, such as another service or another connection, is a change to the files: stage them under <a>Platform files</a> and the same incident is run on both platforms.',
          {
            a: (children) => (
              <button
                type="button"
                className="underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink"
                onClick={() => useUi.getState().setPanel('workspace')}
              >
                {children}
              </button>
            ),
          },
        )}
      </p>
      {result && <Results experiment={result} onWatch={() => useUi.getState().setPanel(null)} />}
      {sweep && choice.unit !== null && <SweepResults sweep={sweep} unit={choice.unit} />}
    </Dialog>
  );
}

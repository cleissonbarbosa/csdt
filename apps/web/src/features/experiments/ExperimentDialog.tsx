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
import {
  affectedOnlyIn,
  comparedRows,
  INTERVENTIONS,
  interventionEffect,
  placedAtMs,
  sameUntilPlaced,
  type InterventionKind,
} from '@/lib/experiment';
import { formatClock, formatMs, formatPercent } from '@/lib/format';
import { nodeLabel } from '@/lib/names';
import { COLOR } from '@/lib/palette';
import { api, ApiError } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

/** How long the fault takes to ease in, as one placed from a service's card does. */
const RAMP_MS = 2000;
const CHART_W = 560;
const CHART_H = 96;

/**
 * One figure over the two runs. The run as it is is the dashed line and the
 * run with the change the solid one: told apart by the stroke, so neither
 * needs a colour. The tick is where the change was placed.
 */
function RunsChart({
  experiment,
  label,
  value,
  format,
}: {
  experiment: Experiment;
  label: string;
  value: (sample: MetricSample) => number;
  format: (value: number) => string;
}) {
  const a = experiment.baseline.samples;
  const b = experiment.variant.samples;
  const end = Math.max(1, experiment.durationMs);
  let top = 0;
  for (const sample of a) top = Math.max(top, value(sample));
  for (const sample of b) top = Math.max(top, value(sample));
  const peak = top;
  // Headroom, so a line at its highest does not run along the frame.
  top = top > 0 ? top * 1.12 : 1;
  const x = (ms: number) => (ms / end) * CHART_W;
  const y = (v: number) => CHART_H - 3 - (v / top) * (CHART_H - 12);
  const line = (samples: MetricSample[]) =>
    samples.map((s) => `${x(s.virtualTimeMs).toFixed(1)},${y(value(s)).toFixed(1)}`).join(' ');
  const placed = x(placedAtMs(experiment));
  const started = x(experiment.incidentStartedAtMs);
  return (
    <figure className="min-w-0">
      <figcaption className="caption mb-1 flex items-baseline justify-between gap-2">
        <span>{label}</span>
        <span className="numeric">up to {format(peak)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="h-24 w-full rounded-control border border-line bg-sunken"
        role="img"
        aria-label={`${label} over both runs. As it is: up to ${format(Math.max(0, ...a.map(value)))}. With the change: up to ${format(Math.max(0, ...b.map(value)))}.`}
      >
        <rect x={started} y={0} width={1} height={CHART_H} fill={COLOR.inkFaint} />
        <rect x={placed - 0.75} y={0} width={1.5} height={CHART_H} fill={COLOR.ink} />
        <polyline
          points={line(a)}
          fill="none"
          stroke={COLOR.inkDim}
          strokeWidth={1.4}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line(b)}
          fill="none"
          stroke={COLOR.ink}
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

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
        <h3 className="text-xs font-bold text-ink">What changed</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink" data-testid="experiment-change">
          In run B, <span className="font-bold">{intervention.description}</span> on {names}, placed{' '}
          <span className="numeric">+{formatClock(intervention.atMs)}</span> into the incident and
          eased in over <span className="numeric">{formatMs(intervention.rampMs)}</span>.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
          Nothing else differs: both runs are {experiment.scenarioName} on{' '}
          <span className="code">{experiment.topologyId}</span> with seed{' '}
          <span className="numeric">{experiment.seed}</span>.{' '}
          {sameUntilPlaced(experiment)
            ? 'Until the change is placed the two runs are identical, sample for sample.'
            : 'The two runs differ before the change was placed, which should not happen: do not rely on this comparison.'}
        </p>
        <details className="mt-1.5">
          <summary className="text-[11px] text-ink-dim hover:text-ink">The exact commands</summary>
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
                A <span className="font-normal text-ink-dim">as it is</span>
              </th>
              <th className="px-2 py-1 font-bold text-ink">
                B <span className="font-normal text-ink-dim">with the change</span>
              </th>
              <th className="px-2 py-1 font-normal text-ink-faint">B against A</th>
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
                  {row.delta || <span className="text-ink-faint">the same</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(only.a.length > 0 || only.b.length > 0) && (
          <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-ink-dim">
            {only.a.length > 0 && <p>Affected only in A: {list(only.a)}.</p>}
            {only.b.length > 0 && <p>Affected only in B: {list(only.b)}.</p>}
          </div>
        )}
      </section>

      <section>
        <div className="grid gap-3 sm:grid-cols-2">
          <RunsChart
            experiment={experiment}
            label="Error rate"
            value={(sample) => sample.errorRate}
            format={formatPercent}
          />
          <RunsChart
            experiment={experiment}
            label="Latency p95"
            value={(sample) => sample.p95LatencyMs}
            format={formatMs}
          />
        </div>
        <p className="caption mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="22"
                y2="3"
                stroke={COLOR.inkDim}
                strokeWidth="1.4"
                strokeDasharray="5 4"
              />
            </svg>
            A, as it is
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden>
              <line x1="0" y1="3" x2="22" y2="3" stroke={COLOR.ink} strokeWidth="1.6" />
            </svg>
            B, with the change
          </span>
          <span>
            The thin tick is where the incident begins, the thick one where the change is placed.
            Each run lasts <span className="numeric">{formatClock(experiment.durationMs)}</span>.
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
          title="Replaces the timeline in use with run B, to play back and scrub"
        >
          Watch run B on the timeline
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void watch('baseline')}
          data-testid="experiment-watch-a"
          title="Replaces the timeline in use with run A"
        >
          Watch run A
        </Button>
        <span className="caption">Watching a run replaces the timeline in use.</span>
      </section>
    </div>
  );
}

/**
 * A service to start from: one the scenario targets that is part of the
 * platform, not a population of clients outside it. The last such target is
 * the deepest one the scenario reaches, which is usually what it is about.
 */
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

  const scenario = available.find((entry) => entry.id === scenarioId);
  // What the form asks, counted: an answer is shown only if the form is
  // still the one it was asked of.
  const question = useRef(0);
  const forget = () => {
    question.current += 1;
    setResult(null);
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
        setError(cause instanceof ApiError ? cause.message : 'The comparison could not be run.');
      }
    } finally {
      setBusy(false);
    }
  };

  const regions = topology?.regions ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'experiment' : null)}
      title="Compare an intervention"
      description="The same scenario, run twice from the same seed on timelines of their own. The second run has one change. The timeline in use is not touched."
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
          label="Scenario"
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
          label="The one change in run B"
          value={kind}
          onChange={(event) => {
            const next = INTERVENTIONS.find((entry) => entry.kind === event.target.value)!;
            setKind(next.kind);
            setValue(String(next.value));
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
          label="On this service"
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
            label={choice.unit === 'factor' ? 'Multiplied by' : 'Share that fails, in percent'}
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
          label="Placed this many seconds into the incident"
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
              ? `From 0 to ${lastSecond}: the scenario lasts ${formatClock(scenario.durationMs)}.`
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
            {busy ? 'Running both…' : result ? 'Run both again' : 'Run both'}
          </Button>
          {available.length === 0 && scenarios && (
            <p className="text-xs text-ink-dim">No scenario can run on this platform.</p>
          )}
          {error && (
            <p role="alert" className="text-xs text-critical">
              {error}
            </p>
          )}
        </div>
      </form>
      {result && <Results experiment={result} onWatch={() => useUi.getState().setPanel(null)} />}
    </Dialog>
  );
}

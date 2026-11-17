/**
 * Faults placed by hand, on the card of what they are placed on.
 *
 * A fault is one figure of a service or a connection held away from nominal,
 * outside any scenario, until it is lifted. The card offers a few; each is a
 * toggle, and what the server reports in force is what is shown as pressed.
 */
import type { ActiveFault, TelemetrySnapshot, Topology, Trial } from '@aegis/contracts';
import { useEffect, useState } from 'react';

import { actions } from '@/app/actions';
import { HealthGlyph } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Fold } from '@/components/ui/Section';
import { ServiceName } from '@/components/ui/ServiceName';
import { EDGE_FAULTS, faultEffect, faultLabel, NODE_FAULTS, type FaultChoice } from '@/lib/faults';
import { formatClock, formatMs, formatPercent } from '@/lib/format';
import { HEALTH_LABEL } from '@/lib/palette';
import { api, ApiError } from '@/providers/api';
import { useUi } from '@/stores/ui';

/** How long a fault eases in when it is tried, as when it is placed. */
const TRIAL_RAMP_MS = 1000;
/** How many of the services a trial reached are listed before the rest is folded. */
const SHOWN = 6;

/**
 * What a fault did when it was tried on a timeline of its own: what the
 * engine recorded, in the order it happened. While it is on show the model
 * keeps the services it reached in front.
 */
function TrialResult({
  trial,
  label,
  topology,
  busy,
  onPlace,
  onClose,
}: {
  trial: Trial;
  label: string;
  topology: Topology;
  busy: boolean;
  onPlace: () => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const held = trial.durationMs - trial.fault.atMs;
  const listed = all ? trial.affected : trial.affected.slice(0, SHOWN);
  const count = trial.affected.length;
  return (
    <div
      className="mt-2 rounded-control border border-line-strong p-2"
      role="status"
      data-testid="fault-trial"
      data-affected={count}
    >
      <p className="text-xs font-bold text-ink">Tried, not placed: {label.toLowerCase()}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink">
        {count === 0
          ? `No service leaves normal in ${formatClock(held)}.`
          : `${count} ${count === 1 ? 'service leaves' : 'services leave'} normal within ${formatClock(held)}.`}
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 text-[11px]">
        <div>
          <dt className="text-ink-faint">Error rate</dt>
          <dd className="numeric text-ink" data-testid="trial-errors">
            up to {formatPercent(trial.peak.errorRate)}{' '}
            <span className="text-ink-faint">from {formatPercent(trial.before.errorRate)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint">Latency p95</dt>
          <dd className="numeric text-ink">
            up to {formatMs(trial.peak.p95LatencyMs)}{' '}
            <span className="text-ink-faint">from {formatMs(trial.before.p95LatencyMs)}</span>
          </dd>
        </div>
      </dl>
      {count > 0 && (
        <ol className="mt-1.5 space-y-0.5" data-testid="trial-affected">
          {listed.map((effect) => (
            <li
              key={effect.nodeId}
              className="grid grid-cols-[0.75rem_1fr_auto] items-baseline gap-x-1.5 text-[11px]"
            >
              {/* The glyph says how bad it got; it takes no colour, because
                  on the timeline in use this service is as it was. */}
              <span className="self-center text-ink">
                <HealthGlyph health={effect.worst} size={8} plain />
              </span>
              <span className="min-w-0 truncate text-ink">
                <ServiceName topology={topology} id={effect.nodeId} />
                <span className="text-ink-faint">, {HEALTH_LABEL[effect.worst].toLowerCase()}</span>
              </span>
              <span className="numeric text-ink-faint">+{formatClock(effect.atMs)}</span>
            </li>
          ))}
        </ol>
      )}
      {count > SHOWN && (
        <button
          type="button"
          className="mt-1 text-[11px] text-ink-dim underline decoration-line-strong underline-offset-2 hover:text-ink"
          onClick={() => setAll(!all)}
        >
          {all ? 'Show fewer' : `Show all ${count}`}
        </button>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={onPlace}
          data-testid="trial-place"
        >
          Place it
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} data-testid="trial-close">
          Put this away
        </Button>
      </div>
      <p className="caption mt-1.5">
        Simulated from the platform at rest, on a timeline of its own. The one in use was not
        touched.
      </p>
    </div>
  );
}

type Position = { node: number } | { edge: number };

function on(fault: ActiveFault, position: Position): boolean {
  return 'node' in position
    ? fault.node === position.node
    : fault.edge === position.edge && fault.onto === null;
}

export function Faults({
  topology,
  snapshot,
  position,
}: {
  topology: Topology;
  snapshot: TelemetrySnapshot | null;
  position: Position;
}) {
  const [busy, setBusy] = useState(false);
  const subject = 'node' in position ? 'service' : 'connection';
  const choices: readonly FaultChoice[] = 'node' in position ? NODE_FAULTS : EDGE_FAULTS;
  const inForce = snapshot?.faults.filter((fault) => on(fault, position)) ?? [];
  // Placed some other way (a recording, the API): shown, and can be lifted.
  const others = inForce.filter((fault) => !choices.some((choice) => choice.kind === fault.kind));

  const effectOf = (fault: Pick<ActiveFault, 'kind' | 'value'>) =>
    faultEffect(topology, {
      kind: fault.kind,
      value: fault.value,
      node: 'node' in position ? position.node : null,
      edge: 'edge' in position ? position.edge : null,
      onto: null,
    });
  const run = async (fault: Pick<ActiveFault, 'kind' | 'value'>, lift: boolean) => {
    const effect = effectOf(fault);
    if (!effect) return;
    setBusy(true);
    await (lift ? actions.liftFault(effect) : actions.placeFault(effect));
    setBusy(false);
  };

  // A fault tried before it is placed: what the engine does with it on a
  // timeline of its own. The result belongs to this card and goes with it.
  const [tried, setTried] = useState<{ choice: FaultChoice; trial: Trial } | null>(null);
  const [trying, setTrying] = useState<FaultChoice | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const putAway = () => {
    setTried(null);
    setRefused(null);
    useUi.getState().setReach(null);
  };
  const where = 'node' in position ? `node:${position.node}` : `edge:${position.edge}`;
  useEffect(() => {
    setTried(null);
    setTrying(null);
    setRefused(null);
    return () => useUi.getState().setReach(null);
  }, [where, topology]);
  const tryOut = async (choice: FaultChoice) => {
    const effect = effectOf(choice);
    if (!effect) return;
    setTrying(choice);
    setRefused(null);
    try {
      const trial = await api.tryFault({ effect, rampMs: TRIAL_RAMP_MS });
      setTried({ choice, trial });
      useUi.getState().setReach(trial.affected.map((entry) => entry.nodeId));
    } catch (error) {
      setTried(null);
      useUi.getState().setReach(null);
      setRefused(error instanceof ApiError ? error.message : 'The trial could not be run.');
    }
    setTrying(null);
  };

  return (
    <Fold
      title="Faults"
      count={inForce.length > 0 ? inForce.length : undefined}
      open={inForce.length > 0}
      testId="faults"
    >
      <p className="caption mb-2">
        Hold this {subject} away from normal, outside any scenario. A fault stays until it is lifted
        or the simulation is reset.
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Faults on this ${subject}`}>
        {choices.map((choice) => {
          const placed = inForce.find((fault) => fault.kind === choice.kind);
          return (
            <Button
              key={choice.kind}
              size="sm"
              // In force reads as filled in, like the chosen arrangement.
              variant={placed ? 'primary' : 'outline'}
              aria-pressed={placed !== undefined}
              disabled={busy}
              onClick={() => void run(placed ?? choice, placed !== undefined)}
              data-testid={`fault-${choice.kind}`}
            >
              {faultLabel(choice.kind, placed?.value ?? choice.value)}
            </Button>
          );
        })}
      </div>
      <div className="mt-2">
        <Select
          label="Try one first, without placing it"
          value=""
          disabled={trying !== null}
          onChange={(event) => {
            const choice = choices.find((entry) => entry.kind === event.target.value);
            if (choice) void tryOut(choice);
          }}
          data-testid="fault-try"
        >
          <option value="">{trying ? 'Trying…' : 'Choose a fault to try…'}</option>
          {choices.map((choice) => (
            <option key={choice.kind} value={choice.kind}>
              {faultLabel(choice.kind, choice.value)}
            </option>
          ))}
        </Select>
      </div>
      {refused && (
        <p className="mt-1.5 text-[11px] text-ink" data-testid="fault-trial-refused">
          Not tried: {refused}
        </p>
      )}
      {tried && (
        <TrialResult
          trial={tried.trial}
          label={faultLabel(tried.choice.kind, tried.choice.value)}
          topology={topology}
          busy={busy}
          onPlace={() => {
            const { choice } = tried;
            putAway();
            void run(choice, false);
          }}
          onClose={putAway}
        />
      )}
      {others.length > 0 && (
        <ul className="mt-2 space-y-1" data-testid="faults-other">
          {others.map((fault) => (
            <li
              key={`${fault.kind}:${fault.onto ?? ''}`}
              className="flex items-center justify-between gap-2 text-xs text-ink"
            >
              <span>{faultLabel(fault.kind, fault.value)}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(fault, true)}
              >
                Lift
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Fold>
  );
}

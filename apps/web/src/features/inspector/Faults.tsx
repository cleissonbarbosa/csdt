/**
 * Faults placed by hand, on the card of what they are placed on.
 *
 * A fault is one figure of a service or a connection held away from nominal,
 * outside any scenario, until it is lifted. The card offers a few; each is a
 * toggle, and what the server reports in force is what is shown as pressed.
 */
import type { ActiveFault, TelemetrySnapshot, Topology } from '@aegis/contracts';
import { useState } from 'react';

import { actions } from '@/app/actions';
import { Button } from '@/components/ui/Button';
import { Fold } from '@/components/ui/Section';
import { EDGE_FAULTS, faultEffect, faultLabel, NODE_FAULTS, type FaultChoice } from '@/lib/faults';

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

  const run = async (fault: Pick<ActiveFault, 'kind' | 'value'>, lift: boolean) => {
    const effect = faultEffect(topology, {
      kind: fault.kind,
      value: fault.value,
      node: 'node' in position ? position.node : null,
      edge: 'edge' in position ? position.edge : null,
      onto: null,
    });
    if (!effect) return;
    setBusy(true);
    await (lift ? actions.liftFault(effect) : actions.placeFault(effect));
    setBusy(false);
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

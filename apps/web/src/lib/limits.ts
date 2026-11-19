/**
 * Where the platform gives: the server's two answers, put into words.
 *
 * `/demo/experiments/headroom` and `/demo/experiments/weak-points` are runs
 * of the engine on the platform at rest. These helpers word the figures
 * they hold and pick out the ones a sentence needs; nothing about the
 * platform is worked out here.
 */
import type { Headroom } from '@aegis/contracts';

import { t } from '@/i18n';

import { formatMs, formatPercent } from './format';

type Objective = Headroom['objectives'][number]['kind'];
type Step = Headroom['steps'][number];

/** A multiple of the ordinary demand, as it is written everywhere: ×2.04. */
export function timesDemand(factor: number): string {
  return `×${factor}`;
}

export function objectiveLabel(kind: Objective): string {
  return kind === 'error-rate' ? t('error rate') : t('latency p95');
}

/** The objectives that were missed, each with the figure it holds the platform under. */
export function objectivesMissed(
  answer: Pick<Headroom, 'objectives'>,
  kinds: readonly Objective[],
): string {
  return kinds
    .map((kind) => {
      const threshold = answer.objectives.find((entry) => entry.kind === kind)?.threshold;
      if (threshold === undefined) return objectiveLabel(kind);
      return kind === 'error-rate'
        ? t('error rate at {threshold} or over', { threshold: formatPercent(threshold) })
        : t('latency p95 at {threshold} or over', { threshold: formatMs(threshold) });
    })
    .join('; ');
}

/**
 * The lowest multiple tried at which a service left its normal state, and
 * that service. Objectives may still be met there: a service can degrade
 * before the platform's figures do.
 */
export function firstToLeave(
  headroom: Pick<Headroom, 'steps'>,
): { factor: number; effect: NonNullable<Step['first']> } | null {
  for (const step of headroom.steps) {
    if (step.first) return { factor: step.factor, effect: step.first };
  }
  return null;
}

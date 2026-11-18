/**
 * The error rates at which the simulation calls a service degraded or
 * critical.
 *
 * They are the error levels of the engine's node `classify`
 * (`apps/server/src/simulation/engine.rs`), copied here because the browser
 * reads an incident capture without the engine. They are not
 * `ERROR_OBJECTIVE`, the 5 % that the alert rules fire on and the interface
 * calls an objective. A capture is coloured by them, sample by sample, as a
 * reading aid: the source of a capture sets no threshold of its own.
 *
 * A test reads `engine.rs` and fails when `classify` stops using these two.
 */

import { formatPercent } from './format';

/** At or above this share of requests failing, the simulation calls a service degraded. */
export const ERROR_DEGRADED = 0.04;
/** At or above this share of requests failing, the simulation calls a service critical. */
export const ERROR_CRITICAL = 0.2;

/** The level an error rate reaches: 0 below both, 1 degraded, 2 critical. */
export function errorLevel(rate: number): 0 | 1 | 2 {
  if (rate >= ERROR_CRITICAL) return 2;
  if (rate >= ERROR_DEGRADED) return 1;
  return 0;
}

/**
 * An error rate as a percentage that never reads as a level it is under:
 * 3.996 % is not written "4.00%" beside a level of 4 %, drawn in ink. A
 * rate that rounding would carry up to a level is written as under it.
 */
export function formatErrorRate(rate: number): string {
  const shown = formatPercent(rate);
  for (const level of [ERROR_DEGRADED, ERROR_CRITICAL]) {
    const atLevel = formatPercent(level);
    if (rate < level && shown === atLevel) return `<${atLevel}`;
  }
  return shown;
}

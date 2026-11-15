/**
 * How fast a piece's mechanism runs.
 *
 * Every piece has one part that works: a door that turns, a line that
 * advances. It moves because requests pass through the service, as the beads
 * do, and at a pace that follows them: 1 while the service carries the
 * traffic it had when the model was laid out, faster under a surge, slower
 * when traffic thins, and not at all when nothing passes.
 *
 * Both functions are pure, so the rule can be tested without a scene.
 */

/** Below this share of its normal traffic a service counts as carrying none. */
const IDLE = 0.02;
/** A mechanism that runs at all is never slower than this, so it reads as running. */
export const PACE_MIN = 0.35;
/** Nor faster than this: past it a turning part stops reading as turning. */
export const PACE_MAX = 2.4;

/**
 * The pace for `throughput` requests per second against the service's own
 * `reference`. The square root keeps a tenfold surge on screen as a clearly
 * faster mechanism instead of a blur.
 */
export function paceOf(throughput: number, reference: number): number {
  if (!(throughput > 0) || !(reference > 0)) return 0;
  const share = throughput / reference;
  if (share < IDLE) return 0;
  return Math.min(PACE_MAX, Math.max(PACE_MIN, Math.sqrt(share)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * What counts as normal traffic for each service: the throughput it had when
 * the model was laid out. A service that carried nothing then (a client that
 * has not started sending, a service that was down) is measured against the
 * typical service of its own type, and failing that against the typical
 * service of the platform, so its mechanism still has a pace once traffic
 * reaches it.
 */
export function referenceThroughput(
  nodes: readonly { serviceType: string; metrics: { throughputRps: number } }[],
): Float32Array<ArrayBuffer> {
  const byType = new Map<string, number[]>();
  const all: number[] = [];
  for (const node of nodes) {
    const rate = node.metrics.throughputRps;
    if (!(rate > 0)) continue;
    all.push(rate);
    const list = byType.get(node.serviceType) ?? [];
    list.push(rate);
    byType.set(node.serviceType, list);
  }
  const typical = new Map([...byType].map(([type, rates]) => [type, median(rates)]));
  const overall = median(all) || 1;
  return Float32Array.from(nodes, (node) => {
    const rate = node.metrics.throughputRps;
    return rate > 0 ? rate : (typical.get(node.serviceType) ?? overall);
  });
}

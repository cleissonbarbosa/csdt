/**
 * An incident capture: a real incident, as a provider reported it or as a
 * system recorded it, read in this browser from a file. It is not simulated
 * and never reaches the server, a workspace or the simulation's timeline.
 *
 * Everything here is a pure function of the capture and a moment in it, so
 * the reading rules can be tested without a scene:
 *
 * - A metrics capture holds samples ("buckets"). The sample at a moment is
 *   the one whose period holds it (the window's last moment is held by the
 *   sample that ends there); an earlier sample never stands in for a
 *   missing one. Traffic is known where that sample counts requests. The
 *   state is known only where it also counts errors (or counts no requests
 *   at all: nothing passed, which is normal). Anything else is unknown, and
 *   unknown is not normal.
 * - A provider report holds statements. A service becomes known through the
 *   first event that states its condition and names it; a statement without
 *   a state changes nothing. Reported impact is drawn as critical and a
 *   reported recovery as degraded: the report does not grade severity.
 * - Colour comes from the simulation's own error levels (`lib/thresholds.ts`)
 *   applied to each sample as measured. Latency and memory never colour.
 */
import { ServiceTypeSchema } from '@aegis/contracts';
import { z } from 'zod';

import type { SceneFrame, SceneTopology } from '@/graphics/sceneData';
import { errorLevel } from '@/lib/thresholds';

export const CAPTURE_KIND = 'aegis-incident-capture';
/** Largest capture file the browser reads. */
export const MAX_CAPTURE_BYTES = 12 * 1024 * 1024;
/** Longest note a service may carry. */
export const MAX_NOTE = 320;

/**
 * The largest value a sample may hold for any measure. Far past anything a
 * service counts in one period, and small enough that a rate taken from it
 * stays a finite number in the scene's single-precision arrays.
 */
export const MAX_MEASURE = 1e15;

const id = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/);
const name = z.string().trim().min(1).max(320);
const milliseconds = z.number().int().min(0).max(8.64e15);
const measure = z.number().nonnegative().max(MAX_MEASURE).optional();
const windowSchema = z.object({ startMs: milliseconds, endMs: milliseconds });
const bucket = z.object({
  atMs: milliseconds,
  requests: measure,
  faults: measure,
  p95Ms: measure,
  memoryBytes: measure,
});
const buckets = z.array(bucket).max(1500).default([]);

/**
 * Where a service's kind comes from: `source`, mapped from a resource type
 * the platform reported; `declared`, named by the operator; `assumed`,
 * chosen by the exporter or the author by name or by default. A capture
 * that does not say is read as assumed.
 */
export const TYPE_SOURCES = ['source', 'declared', 'assumed'] as const;
export type TypeSource = (typeof TYPE_SOURCES)[number];

export const SOURCE_KINDS = [
  'cloudwatch',
  'provider-report',
  'tempo-prometheus',
  'prometheus-recording',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

const captureSchema = z.object({
  kind: z.literal(CAPTURE_KIND),
  version: z.literal(1),
  title: name,
  source: z.object({
    kind: z.enum(SOURCE_KINDS),
    label: name,
    url: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .optional(),
  }),
  window: windowSchema,
  topologyWindow: windowSchema.optional(),
  periodMs: z.number().int().min(1000).max(86_400_000).optional(),
  regions: z.array(z.object({ id, name })).min(1).max(64),
  nodes: z
    .array(
      z.object({
        id,
        name,
        region: id,
        type: ServiceTypeSchema,
        typeSource: z.enum(TYPE_SOURCES).optional(),
        note: z.string().max(MAX_NOTE).optional(),
        buckets,
      }),
    )
    .min(1)
    .max(384),
  edges: z.array(z.object({ source: id, target: id, buckets })).max(2048),
  events: z
    .array(
      z.object({
        atMs: milliseconds,
        title: name,
        detail: z.string().max(1280).optional(),
        nodes: z.array(id).max(384).default([]),
        state: z.enum(['affected', 'recovering', 'recovered']).optional(),
      }),
    )
    .max(1500)
    .default([]),
  notes: z.array(z.string().max(1280)).max(40).default([]),
});

export type Capture = z.infer<typeof captureSchema>;
export type CaptureNode = Capture['nodes'][number];
export type CaptureEdge = Capture['edges'][number];
export type CaptureEvent = Capture['events'][number];
export type Bucket = z.infer<typeof bucket>;
export type ReportedState = NonNullable<CaptureEvent['state']>;

export const connectionId = (edge: Pick<CaptureEdge, 'source' | 'target'>): string =>
  `${edge.source}->${edge.target}`;

/** Whether the capture is a provider's report (statements) rather than measurements. */
export const isReport = (capture: Capture): boolean => capture.source.kind === 'provider-report';

/** Where a service's kind comes from; a capture that does not say assumed it. */
export const typeSourceOf = (node: CaptureNode): TypeSource => node.typeSource ?? 'assumed';

/**
 * The capture a file holds, or null when it is not one this version reads.
 * Beyond the schema: the window runs forward, ids are unique, every event,
 * node and connection names what exists, samples start inside the window
 * (before its end, which is a moment no period starts at) and in order, and
 * events are put in time order (keeping the file's order at equal times).
 */
export function readCapture(input: unknown): Capture | null {
  const result = captureSchema.safeParse(input);
  if (!result.success) return null;
  const capture = result.data;
  const { startMs, endMs } = capture.window;
  if (startMs >= endMs) return null;
  const discovered = capture.topologyWindow;
  if (
    discovered &&
    (discovered.startMs > discovered.endMs ||
      discovered.endMs < startMs ||
      discovered.startMs > endMs)
  )
    return null;

  const regions = new Set(capture.regions.map((region) => region.id));
  const nodes = new Set(capture.nodes.map((node) => node.id));
  const edges = new Set(capture.edges.map(connectionId));
  if (
    regions.size !== capture.regions.length ||
    nodes.size !== capture.nodes.length ||
    edges.size !== capture.edges.length
  )
    return null;

  const inWindow = (atMs: number) => atMs >= startMs && atMs <= endMs;
  for (const event of capture.events) {
    if (!inWindow(event.atMs) || event.nodes.some((node) => !nodes.has(node))) return null;
  }
  for (const node of capture.nodes) {
    if (!regions.has(node.region)) return null;
  }
  for (const edge of capture.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target) || edge.source === edge.target)
      return null;
  }
  for (const item of [...capture.nodes, ...capture.edges]) {
    let previous = -1;
    for (const point of item.buckets) {
      // A sample at the window's end would measure only what came after it.
      const starts = point.atMs >= startMs && point.atMs < endMs;
      if (!capture.periodMs || !starts || point.atMs <= previous) return null;
      previous = point.atMs;
    }
  }
  capture.events.sort((a, b) => a.atMs - b.atMs);
  return capture;
}

// ---------------------------------------------------------------------------
// One moment
// ---------------------------------------------------------------------------

/**
 * The sample whose period holds `atMs`. A period runs from its start up to
 * the start of the next, so a moment belongs to one sample only; the one
 * exception is the window's end (`endMs`), the last moment there is, which
 * belongs to the sample whose period ends there: the end of a capture still
 * shows its last measurements. An empty period is unknown: an earlier sample
 * cannot stand in for it.
 */
export function bucketAt(
  samples: readonly Bucket[],
  atMs: number,
  periodMs: number | undefined,
  endMs?: number,
): Bucket | undefined {
  if (periodMs === undefined || samples.length === 0) return undefined;
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid]!.atMs <= atMs) low = mid + 1;
    else high = mid;
  }
  const point = samples[low - 1];
  if (!point) return undefined;
  const until = point.atMs + periodMs;
  return atMs < until || (atMs === until && until === endMs) ? point : undefined;
}

/** The sample of a service or connection at `atMs`, the window's end included. */
const sampleOf = (capture: Capture, item: CaptureNode | CaptureEdge, atMs: number) =>
  bucketAt(item.buckets, atMs, capture.periodMs, capture.window.endMs);

/** The condition each service has been stated in, by `atMs`. A service never stated is absent. */
export function reportedAt(capture: Capture, atMs: number): Map<string, ReportedState> {
  const states = new Map<string, ReportedState>();
  for (const event of capture.events) {
    if (event.atMs > atMs) break;
    if (!event.state) continue;
    for (const node of event.nodes) states.set(node, event.state);
  }
  return states;
}

/** How a reported condition is drawn: impact as critical (never down), recovery as degraded. */
export const REPORTED_LEVEL: Record<ReportedState, 0 | 1 | 2> = {
  affected: 2,
  recovering: 1,
  recovered: 0,
};

/**
 * What a capture says about one service or connection at a moment. A
 * metrics capture's condition is `unknown` or the level its error rate
 * reaches; a report's is the state last stated, or `not-stated`.
 */
export type Condition =
  | 'unknown'
  | 'normal'
  | 'degraded'
  | 'critical'
  | 'not-stated'
  | 'affected'
  | 'recovering'
  | 'recovered';

const MEASURED_CONDITION = ['normal', 'degraded', 'critical'] as const;

export interface Reading {
  condition: Condition;
  /** How it is drawn: 0 normal, 1 degraded, 2 critical; null while its state is unknown. */
  level: 0 | 1 | 2 | null;
  /** The sample at the moment, in a metrics capture. */
  sample: Bucket | undefined;
  /** Requests per second in that sample; null when it counts no requests. */
  requestsPerSecond: number | null;
  /** Errors over requests in that sample; null when errors or requests were not measured. */
  errorRate: number | null;
}

/** The state a sample shows: null when it does not show one. */
export function sampleHealth(
  sample: Bucket | undefined,
): { level: 0 | 1 | 2; errorRate: number | null } | null {
  if (!sample || sample.requests === undefined) return null;
  // Nothing passed: there was nothing to fail.
  if (sample.requests === 0) return { level: 0, errorRate: null };
  if (sample.faults === undefined) return null;
  const errorRate = Math.min(1, sample.faults / sample.requests);
  return { level: errorLevel(errorRate), errorRate };
}

function perSecond(sample: Bucket | undefined, periodMs: number | undefined): number | null {
  return periodMs && sample?.requests !== undefined ? (1000 * sample.requests) / periodMs : null;
}

function measuredReading(sample: Bucket | undefined, periodMs: number | undefined): Reading {
  const health = sampleHealth(sample);
  return {
    condition: health ? MEASURED_CONDITION[health.level] : 'unknown',
    level: health?.level ?? null,
    sample,
    requestsPerSecond: perSecond(sample, periodMs),
    errorRate: health?.errorRate ?? null,
  };
}

function statedReading(state: ReportedState | undefined): Reading {
  return {
    condition: state ?? 'not-stated',
    level: state ? REPORTED_LEVEL[state] : null,
    sample: undefined,
    requestsPerSecond: null,
    errorRate: null,
  };
}

/** What the capture says about every service at `atMs`, in the order of `capture.nodes`. */
export function nodeReadings(capture: Capture, atMs: number): Reading[] {
  if (isReport(capture)) {
    const reported = reportedAt(capture, atMs);
    return capture.nodes.map((node) => statedReading(reported.get(node.id)));
  }
  return capture.nodes.map((node) =>
    measuredReading(sampleOf(capture, node, atMs), capture.periodMs),
  );
}

/** What the capture says about every connection at `atMs`, in the order of `capture.edges`. A report states none. */
export function edgeReadings(capture: Capture, atMs: number): Reading[] {
  if (isReport(capture)) return capture.edges.map(() => statedReading(undefined));
  return capture.edges.map((edge) =>
    measuredReading(sampleOf(capture, edge, atMs), capture.periodMs),
  );
}

/** What the capture says about one service or connection at `atMs`. */
export function readingOf(
  capture: Capture,
  item: CaptureNode | CaptureEdge,
  atMs: number,
): Reading {
  if (isReport(capture)) {
    return 'source' in item
      ? statedReading(undefined)
      : statedReading(reportedAt(capture, atMs).get(item.id));
  }
  return measuredReading(sampleOf(capture, item, atMs), capture.periodMs);
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/** A scene frame that also says which states and which traffic are known. */
export interface CaptureFrame extends SceneFrame {
  nodes: SceneFrame['nodes'] & { known: Uint8Array; measured: Uint8Array };
}

/** The topology id of a bundled capture. */
export const bundledTopologyId = (id: string): string => `capture:${id}`;
/** The topology id of a capture read from a file: the SHA-256 of its bytes, never its title. */
export const fileTopologyId = (sha256: string): string => `capture:file:${sha256}`;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * The median requests per second over the samples that count requests: 0
 * with none. A service called now and then counts none in most of its
 * periods, which makes that median 0; its typical rate is then the median
 * of the periods in which it was called, its own still, so that its piece
 * works when requests pass and is never measured against another service.
 */
export function typicalRate(samples: readonly Bucket[], periodMs: number | undefined): number {
  if (!periodMs) return 0;
  const rates = samples.flatMap((point) =>
    point.requests === undefined ? [] : [(1000 * point.requests) / periodMs],
  );
  return median(rates) || median(rates.filter((rate) => rate > 0));
}

/**
 * The capture as the scene draws it: a plate per region, pieces in lines by
 * kind, no hub and no direction of travel. A piece's reference traffic is
 * its median measured rate, so a mechanism at pace 1 is typical for this
 * capture. `id` is the capture's topology id (`bundledTopologyId`,
 * `fileTopologyId`): the scene takes the same id for the same model.
 */
export function sceneTopologyOf(capture: Capture, id: string): SceneTopology {
  return {
    id,
    regions: capture.regions.map((region) => ({ id: region.id, name: region.name, kind: 'cloud' })),
    nodes: capture.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      serviceType: node.type,
      region: node.region,
      tier: 0,
      metrics: { health: 'healthy', throughputRps: typicalRate(node.buckets, capture.periodMs) },
    })),
    edges: capture.edges.map((edge) => ({
      id: connectionId(edge),
      source: edge.source,
      target: edge.target,
      relationship: 'call',
      metrics: { trafficRps: typicalRate(edge.buckets, capture.periodMs), errorRate: 0 },
    })),
  };
}

/**
 * The scene's frame at `atMs`. A service whose state is unknown is marked
 * so (`known` 0) and drawn as unknown, not as normal; one whose traffic was
 * not measured (`measured` 0, every service of a report) rests as modelled,
 * so its stillness claims nothing. A connection's error rate is 0 where it
 * was not measured; the card says so.
 */
export function frameAt(capture: Capture, atMs: number): CaptureFrame {
  const nodes = nodeReadings(capture, atMs);
  const edges = edgeReadings(capture, atMs);
  return {
    nodes: {
      health: nodes.map((reading) => reading.level ?? 0),
      throughputRps: nodes.map((reading) => reading.requestsPerSecond ?? 0),
      known: Uint8Array.from(nodes, (reading) => (reading.level === null ? 0 : 1)),
      measured: Uint8Array.from(nodes, (reading) => (reading.requestsPerSecond === null ? 0 : 1)),
    },
    edges: {
      trafficRps: edges.map((reading) => reading.requestsPerSecond ?? 0),
      errorRate: edges.map((reading) => reading.errorRate ?? 0),
      rejectedRps: edges.map(() => 0),
      suspiciousRps: edges.map(() => 0),
      securityStatus: edges.map(() => 0),
    },
    regions: [],
  };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const CHANGES = new WeakMap<Capture, Float64Array>();

/**
 * The moments at which anything the capture says can change: where a
 * sample begins or ends, and where an event is. Between two of them every
 * reading, the frame and the status are the same.
 */
export function changesOf(capture: Capture): Float64Array {
  const cached = CHANGES.get(capture);
  if (cached) return cached;
  const times = new Set<number>();
  for (const event of capture.events) times.add(event.atMs);
  const period = capture.periodMs ?? 0;
  for (const item of [...capture.nodes, ...capture.edges]) {
    for (const point of item.buckets) {
      times.add(point.atMs);
      times.add(point.atMs + period);
    }
  }
  const changes = Float64Array.from(times).sort();
  CHANGES.set(capture, changes);
  return changes;
}

/** How many of a sorted list's times are at or before `atMs`. */
function countUpTo(times: ArrayLike<number>, atMs: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid]! <= atMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Which stretch of the capture `atMs` is in: the number of changes at or
 * before it. What is shown changes only when this does, so a component
 * that reads it re-renders at a change, not at every tick of the clock.
 */
export function stepAt(capture: Capture, atMs: number): number {
  return countUpTo(changesOf(capture), atMs);
}

/** How many events are at or before `atMs`. */
export function eventsUpTo(capture: Capture, atMs: number): number {
  let low = 0;
  let high = capture.events.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (capture.events[mid]!.atMs <= atMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** One step of the cursor: a sampling period, or a hundredth of the window. */
export function stepMs(capture: Capture): number {
  return (
    capture.periodMs ??
    Math.max(1, Math.round((capture.window.endMs - capture.window.startMs) / 100))
  );
}

/** Playback speeds, in capture time per second of the viewer's. */
export const SPEEDS = [10, 60, 600, 3600] as const;
export type Speed = (typeof SPEEDS)[number];
/** The longest a capture takes to play at its default speed, when one is fast enough. */
export const PLAY_WITHIN_MS = 60_000;

/** The smallest speed that plays the whole window within a minute, or the fastest. */
export function defaultSpeed(capture: Capture): Speed {
  const span = capture.window.endMs - capture.window.startMs;
  return SPEEDS.find((speed) => span / speed <= PLAY_WITHIN_MS) ?? SPEEDS[SPEEDS.length - 1]!;
}

// ---------------------------------------------------------------------------
// The sentence in the bar
// ---------------------------------------------------------------------------

export type CaptureStatus =
  | {
      kind: 'measurements';
      /** Services whose sample is past the simulation's levels. */
      past: number;
      /** Services whose state the sample shows. */
      known: number;
      /** Services with a sample at this moment that does not show their state. */
      unknownMeasured: number;
      /** Whether any sample anywhere in the capture counts errors. */
      errorsInCapture: boolean;
      /** Whether any service or connection has a sample at this moment. */
      measuredNow: boolean;
      /** The worst level among the services whose state is known. */
      worst: 0 | 1 | 2;
    }
  | {
      kind: 'report';
      affected: number;
      recovering: number;
      /** Services the report has not given a condition for yet. */
      notStated: number;
      worst: 0 | 1 | 2;
    };

const ERRORS = new WeakMap<Capture, boolean>();

/** Whether any sample of the capture counts errors. */
export function errorsInCapture(capture: Capture): boolean {
  const cached = ERRORS.get(capture);
  if (cached !== undefined) return cached;
  const found = [...capture.nodes, ...capture.edges].some((item) =>
    item.buckets.some((point) => point.faults !== undefined),
  );
  ERRORS.set(capture, found);
  return found;
}

/**
 * The counts the bar's sentence is made from. A service whose state is
 * unknown is never counted among those whose state is known.
 */
export function statusAt(capture: Capture, atMs: number): CaptureStatus {
  const readings = nodeReadings(capture, atMs);
  const worst = readings.reduce<0 | 1 | 2>(
    (most, reading) => (reading.level !== null && reading.level > most ? reading.level : most),
    0,
  );
  if (isReport(capture)) {
    const count = (condition: Condition) =>
      readings.filter((reading) => reading.condition === condition).length;
    return {
      kind: 'report',
      affected: count('affected'),
      recovering: count('recovering'),
      notStated: count('not-stated'),
      worst,
    };
  }
  const known = readings.filter((reading) => reading.level !== null);
  return {
    kind: 'measurements',
    past: known.filter((reading) => reading.level! > 0).length,
    known: known.length,
    unknownMeasured: readings.filter((reading) => reading.level === null && reading.sample).length,
    errorsInCapture: errorsInCapture(capture),
    measuredNow:
      readings.some((reading) => reading.sample) ||
      edgeReadings(capture, atMs).some((reading) => reading.sample),
    worst,
  };
}

// ---------------------------------------------------------------------------
// Over the whole capture
// ---------------------------------------------------------------------------

/** Where a sample of some service is past the simulation's levels: 1 degraded, 2 critical. */
export function levelMarks(capture: Capture): { atMs: number; level: 1 | 2 }[] {
  const marks = new Map<number, 1 | 2>();
  for (const node of capture.nodes) {
    for (const point of node.buckets) {
      const level = sampleHealth(point)?.level ?? 0;
      if (level > 0) marks.set(point.atMs, Math.max(marks.get(point.atMs) ?? 0, level) as 1 | 2);
    }
  }
  return [...marks].sort(([a], [b]) => a - b).map(([atMs, level]) => ({ atMs, level }));
}

export type Measure = 'requests' | 'errors' | 'errorRate' | 'p95Ms' | 'memoryBytes';

/**
 * One measure of a service or connection over the capture, a value per
 * sample in time order. `NaN` is a gap: a sample that does not hold the
 * measure, and a period with no sample between two that are.
 */
export function seriesOf(
  capture: Capture,
  samples: readonly Bucket[],
  measure: Measure,
): { atMs: number[]; values: number[] } {
  const atMs: number[] = [];
  const values: number[] = [];
  const period = capture.periodMs ?? Infinity;
  let previous: number | null = null;
  for (const point of samples) {
    if (previous !== null && point.atMs > previous + period) {
      atMs.push(previous + period);
      values.push(Number.NaN);
    }
    atMs.push(point.atMs);
    values.push(valueOf(point, measure));
    previous = point.atMs;
  }
  return { atMs, values };
}

function valueOf(point: Bucket, measure: Measure): number {
  switch (measure) {
    case 'requests':
      return point.requests ?? Number.NaN;
    case 'errors':
      return point.faults ?? Number.NaN;
    case 'errorRate':
      return point.requests && point.faults !== undefined
        ? Math.min(1, point.faults / point.requests)
        : Number.NaN;
    case 'p95Ms':
      return point.p95Ms ?? Number.NaN;
    case 'memoryBytes':
      return point.memoryBytes ?? Number.NaN;
  }
}

/** The lowest and highest value a series holds, leaving out its gaps; null when it holds none. */
export function rangeOf(values: readonly number[]): { low: number; high: number } | null {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (Number.isNaN(value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return low <= high ? { low, high } : null;
}

// ---------------------------------------------------------------------------
// A file's identity
// ---------------------------------------------------------------------------

/** The SHA-256 of `bytes`, in lowercase hex: with Web Crypto where the page has it. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      return hex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
    } catch {
      // A context without Web Crypto's digest: the same sum, computed here.
    }
  }
  return sha256Fallback(bytes);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The first 32 bits of the fractional part of `x`. */
const fraction = (x: number) => ((x - Math.floor(x)) * 0x100000000) >>> 0;

function primes(count: number): number[] {
  const found: number[] = [];
  for (let n = 2; found.length < count; n++) {
    if (found.every((p) => n % p !== 0)) found.push(n);
  }
  return found;
}

let ROUND: Uint32Array | null = null;
let START: Uint32Array | null = null;

/**
 * SHA-256 (FIPS 180-4) for a page without Web Crypto, such as one served
 * over plain HTTP to another machine. A test holds it to Node's.
 */
export function sha256Fallback(bytes: Uint8Array): string {
  if (!ROUND || !START) {
    const p = primes(64);
    ROUND = Uint32Array.from(p, (n) => fraction(Math.cbrt(n)));
    START = Uint32Array.from(p.slice(0, 8), (n) => fraction(Math.sqrt(n)));
  }
  const k = ROUND;
  const length = bytes.length;
  const words = (((length + 8) >>> 6) + 1) << 4;
  const w = new Uint32Array(words);
  for (let i = 0; i < length; i++) w[i >>> 2]! |= bytes[i]! << (24 - (i & 3) * 8);
  w[length >>> 2]! |= 0x80 << (24 - (length & 3) * 8);
  const bits = length * 8;
  w[words - 2] = Math.floor(bits / 0x100000000);
  w[words - 1] = bits >>> 0;
  const h = START.slice();
  const m = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < words; offset += 16) {
    for (let t = 0; t < 16; t++) m[t] = w[offset + t]!;
    for (let t = 16; t < 64; t++) {
      const a = m[t - 15]!;
      const b = m[t - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      m[t] = (m[t - 16]! + s0 + m[t - 7]! + s1) | 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + choice + k[t]! + m[t]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + b;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
    h[4] = h[4]! + e;
    h[5] = h[5]! + f;
    h[6] = h[6]! + g;
    h[7] = h[7]! + hh;
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, '0')).join('');
}

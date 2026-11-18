import { ServiceTypeSchema } from '@aegis/contracts';
import { z } from 'zod';

import type { SceneFrame, SceneTopology } from '@/graphics/sceneData';

export const MAX_CAPTURE_BYTES = 12 * 1024 * 1024;

const id = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/);
const name = z.string().trim().min(1).max(320);
const milliseconds = z.number().int().min(0).max(8.64e15);
const windowSchema = z.object({ startMs: milliseconds, endMs: milliseconds });
const bucket = z.object({
  atMs: milliseconds,
  requests: z.number().nonnegative().optional(),
  faults: z.number().nonnegative().optional(),
  p95Ms: z.number().nonnegative().optional(),
});
const buckets = z.array(bucket).max(1500).default([]);

const captureSchema = z.object({
  kind: z.literal('aegis-cloud-replay'),
  version: z.literal(1),
  title: name,
  source: z.object({
    kind: z.enum(['cloudwatch', 'provider-report']),
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
    .array(z.object({ id, name, region: id, type: ServiceTypeSchema, buckets }))
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
export type Bucket = z.infer<typeof bucket>;
export type ReportedState = NonNullable<Capture['events'][number]['state']>;

export const connectionId = (edge: Capture['edges'][number]): string =>
  `${edge.source}->${edge.target}`;

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
      if (!capture.periodMs || !inWindow(point.atMs) || point.atMs <= previous) return null;
      previous = point.atMs;
    }
  }
  capture.events.sort((a, b) => a.atMs - b.atMs);
  return capture;
}

/** An empty interval is unknown. An earlier bucket cannot stand in for it. */
export function bucketAt(
  samples: readonly Bucket[],
  atMs: number,
  periodMs: number | undefined,
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
  return point && atMs < point.atMs + periodMs ? point : undefined;
}

export function reportedAt(capture: Capture, atMs: number): Map<string, ReportedState> {
  const states = new Map<string, ReportedState>();
  for (const event of capture.events) {
    if (event.atMs > atMs) break;
    if (!event.state) continue;
    for (const node of event.nodes) states.set(node, event.state);
  }
  return states;
}

export const hasFaults = (sample: Bucket | undefined) => (sample?.faults ?? 0) > 0;

function requestsPerSecond(sample: Bucket | undefined, periodMs: number | undefined): number {
  return periodMs && sample?.requests !== undefined ? (1000 * sample.requests) / periodMs : 0;
}

export function sceneTopology(capture: Capture): SceneTopology {
  // Physical placement uses stable region and type groups (layout.ts), never
  // the order of an AWS response or a topological sort of observed calls.
  return {
    id: 'incident-capture',
    regions: capture.regions.map((region) => ({ ...region, kind: 'cloud' })),
    nodes: capture.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      serviceType: node.type,
      region: node.region,
      tier: 0,
      metrics: {
        health: 'healthy',
        throughputRps: requestsPerSecond(node.buckets[0], capture.periodMs),
      },
    })),
    edges: capture.edges.map((edge) => ({
      id: connectionId(edge),
      source: edge.source,
      target: edge.target,
      relationship: 'call',
      metrics: { trafficRps: requestsPerSecond(edge.buckets[0], capture.periodMs), errorRate: 0 },
    })),
  };
}

export function sceneFrame(capture: Capture, atMs: number): SceneFrame {
  const reported = reportedAt(capture, atMs);
  const points = capture.nodes.map((node) => bucketAt(node.buckets, atMs, capture.periodMs));
  const links = capture.edges.map((edge) => bucketAt(edge.buckets, atMs, capture.periodMs));
  return {
    nodes: {
      // These are drawing signals only. Unknown stays neutral and is labelled
      // as such in the evidence panel. A report of impact never means down.
      health: capture.nodes.map((node, i) =>
        reported.get(node.id) === 'affected' || hasFaults(points[i])
          ? 2
          : reported.get(node.id) === 'recovering'
            ? 1
            : 0,
      ),
      throughputRps: points.map((point) => requestsPerSecond(point, capture.periodMs)),
    },
    edges: {
      trafficRps: links.map((point) => requestsPerSecond(point, capture.periodMs)),
      errorRate: links.map((point) =>
        point?.requests && point.faults !== undefined
          ? Math.min(1, point.faults / point.requests)
          : 0,
      ),
      rejectedRps: links.map(() => 0),
      suspiciousRps: links.map(() => 0),
      securityStatus: links.map(() => 0),
    },
    regions: [],
  };
}

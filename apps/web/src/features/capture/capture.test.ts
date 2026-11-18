import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { paceOf, referenceThroughput } from '@/graphics/pace';
import { ERROR_CRITICAL, ERROR_DEGRADED } from '@/lib/thresholds';

import {
  bucketAt,
  bundledTopologyId,
  changesOf,
  connectionId,
  defaultSpeed,
  edgeReadings,
  eventsUpTo,
  fileTopologyId,
  frameAt,
  levelMarks,
  MAX_MEASURE,
  MAX_NOTE,
  nodeReadings,
  rangeOf,
  readCapture,
  readingOf,
  sampleHealth,
  sceneTopologyOf,
  seriesOf,
  sha256Fallback,
  sha256Hex,
  statusAt,
  stepAt,
  stepMs,
  typeSourceOf,
  type Capture,
  type Condition,
} from './capture';
import google from './google-cloud-2025-06-12.json';
import boutique from './online-boutique-rcaeval.json';

const read = (input: unknown): Capture => {
  const capture = readCapture(input);
  if (!capture) throw new Error('not a capture');
  return capture;
};

const START = 1_700_000_000_000;
const PERIOD = 60_000;

/** A small metrics capture: two services, one connection, one-minute samples. */
function measured(overrides: Partial<Record<string, unknown>> = {}): Capture {
  return read({
    kind: 'aegis-incident-capture',
    version: 1,
    title: 'Test capture',
    source: { kind: 'tempo-prometheus', label: 'Tempo / Prometheus' },
    window: { startMs: START, endMs: START + 10 * PERIOD },
    periodMs: PERIOD,
    regions: [{ id: 'unreported', name: 'Location not reported' }],
    nodes: [
      {
        id: 'front',
        name: 'front',
        region: 'unreported',
        type: 'api-gateway',
        buckets: [
          { atMs: START, requests: 600 },
          { atMs: START + PERIOD, requests: 600, faults: 6 },
          { atMs: START + 2 * PERIOD, requests: 600, faults: 30 },
          { atMs: START + 3 * PERIOD, requests: 600, faults: 600, p95Ms: 9000 },
          { atMs: START + 5 * PERIOD, requests: 0 },
          { atMs: START + 6 * PERIOD, faults: 4, memoryBytes: 1e12 },
          { atMs: START + 7 * PERIOD, requests: 1200, faults: 0, p95Ms: 99999 },
        ],
      },
      {
        id: 'back',
        name: 'back',
        region: 'unreported',
        type: 'microservice',
        buckets: [{ atMs: START + 2 * PERIOD, requests: 120, faults: 120 }],
      },
    ],
    edges: [
      {
        source: 'front',
        target: 'back',
        buckets: [
          { atMs: START, requests: 60 },
          { atMs: START + PERIOD, requests: 60, faults: 15 },
        ],
      },
    ],
    ...overrides,
  });
}

const at = (minute: number) => START + minute * PERIOD + 1;

describe('reading a capture file', () => {
  it('reads both bundled captures', () => {
    expect(readCapture(google)).not.toBeNull();
    expect(readCapture(boutique)).not.toBeNull();
  });

  it('refuses the kind the format had before it was renamed', () => {
    expect(readCapture({ ...google, kind: 'aegis-cloud-replay' })).toBeNull();
  });

  it('takes where a kind comes from and a note, and reads a kind that does not say as assumed', () => {
    const capture = read(google);
    const dataflow = capture.nodes.find((node) => node.id === 'dataflow')!;
    expect(dataflow.note).toBe(
      'Listed among affected products; the report does not say when its impact began.',
    );
    expect(capture.nodes.every((node) => typeSourceOf(node) === 'assumed')).toBe(true);
    const bare = measured();
    expect(bare.nodes[0]!.typeSource).toBeUndefined();
    expect(typeSourceOf(bare.nodes[0]!)).toBe('assumed');
  });

  it('refuses a note that is too long, and a kind source it does not know', () => {
    const nodes = (extra: Record<string, unknown>) =>
      google.nodes.map((node, i) => (i === 0 ? { ...node, ...extra } : node));
    expect(readCapture({ ...google, nodes: nodes({ note: 'x'.repeat(MAX_NOTE) }) })).not.toBeNull();
    expect(readCapture({ ...google, nodes: nodes({ note: 'x'.repeat(MAX_NOTE + 1) }) })).toBeNull();
    expect(readCapture({ ...google, nodes: nodes({ typeSource: 'guessed' }) })).toBeNull();
    expect(readCapture({ ...google, nodes: nodes({ typeSource: 'declared' }) })).not.toBeNull();
  });

  it('refuses samples out of order, outside the window or without a period', () => {
    const node = (buckets: unknown[]) => ({
      nodes: [{ id: 'a', name: 'a', region: 'unreported', type: 'microservice', buckets }],
      edges: [],
    });
    expect(
      readCapture({ ...measured(), ...node([{ atMs: START + PERIOD }, { atMs: START }]) }),
    ).toBeNull();
    expect(readCapture({ ...measured(), ...node([{ atMs: START - 1 }]) })).toBeNull();
    expect(
      readCapture({ ...measured(), periodMs: undefined, ...node([{ atMs: START }]) }),
    ).toBeNull();
  });

  it('refuses a sample that starts at the window’s end, whose period lies after it', () => {
    const END = START + 10 * PERIOD;
    const node = (buckets: unknown[]) => ({
      nodes: [{ id: 'a', name: 'a', region: 'unreported', type: 'microservice', buckets }],
      edges: [],
    });
    expect(
      readCapture({ ...measured(), ...node([{ atMs: END - PERIOD, requests: 1, faults: 0 }]) }),
    ).not.toBeNull();
    expect(
      readCapture({
        ...measured(),
        ...node([
          { atMs: END - PERIOD, requests: 1, faults: 0 },
          { atMs: END, requests: 99, faults: 99 },
        ]),
      }),
    ).toBeNull();
    // An event may still be at the window's end: it is a moment, not a period.
    const last = { atMs: END, title: 'Window ends', nodes: [] };
    expect(readCapture({ ...measured(), events: [last] })).not.toBeNull();
  });

  it('refuses a measure too large to be drawn, and takes any count a service could make', () => {
    const node = (bucket: Record<string, number>) => ({
      nodes: [
        {
          id: 'a',
          name: 'a',
          region: 'unreported',
          type: 'microservice',
          buckets: [{ atMs: START, ...bucket }],
        },
      ],
      edges: [],
    });
    expect(readCapture({ ...measured(), ...node({ requests: MAX_MEASURE }) })).not.toBeNull();
    for (const field of ['requests', 'faults', 'p95Ms', 'memoryBytes']) {
      for (const value of [1e39, 1e308]) {
        expect(readCapture({ ...measured(), ...node({ [field]: value }) }), field).toBeNull();
      }
    }
    // What is taken stays a finite rate in single precision, as the scene holds it.
    expect(Number.isFinite(Math.fround((1000 * MAX_MEASURE) / 1000))).toBe(true);
  });
});

describe('a provider report', () => {
  const capture = read(google);
  const STATE: Record<string, Condition> = {
    u: 'not-stated',
    A: 'affected',
    Rg: 'recovering',
    Rd: 'recovered',
  };
  const conditionsAt = (atMs: number) => {
    const readings = nodeReadings(capture, atMs);
    return Object.fromEntries(capture.nodes.map((node, i) => [node.id, readings[i]!.condition]));
  };
  // The table the transcription was checked against (u = not stated).
  const TABLE: [number, Record<string, keyof typeof STATE>][] = [
    [
      Date.UTC(2025, 5, 12, 17, 47),
      {
        serving: 'u',
        control: 'u',
        policy: 'u',
        iam: 'u',
        storage: 'u',
        run: 'u',
        dataflow: 'u',
        vertex: 'u',
        'control-iowa': 'u',
        'policy-iowa': 'u',
        'vertex-belgium': 'u',
        'vertex-singapore': 'u',
      },
    ],
    [
      Date.UTC(2025, 5, 12, 19, 35),
      {
        serving: 'Rg',
        control: 'Rd',
        policy: 'u',
        iam: 'A',
        storage: 'A',
        run: 'A',
        dataflow: 'u',
        vertex: 'u',
        'control-iowa': 'Rg',
        'policy-iowa': 'A',
        'vertex-belgium': 'u',
        'vertex-singapore': 'u',
      },
    ],
    [
      Date.UTC(2025, 5, 12, 21, 0),
      {
        serving: 'Rd',
        control: 'Rd',
        policy: 'u',
        iam: 'Rg',
        storage: 'Rg',
        run: 'Rg',
        dataflow: 'u',
        vertex: 'u',
        'control-iowa': 'Rd',
        'policy-iowa': 'Rd',
        'vertex-belgium': 'u',
        'vertex-singapore': 'u',
      },
    ],
    [
      Date.UTC(2025, 5, 12, 23, 20),
      {
        serving: 'Rd',
        control: 'Rd',
        policy: 'u',
        iam: 'Rd',
        storage: 'Rd',
        run: 'Rd',
        dataflow: 'Rg',
        vertex: 'A',
        'control-iowa': 'Rd',
        'policy-iowa': 'Rd',
        'vertex-belgium': 'u',
        'vertex-singapore': 'u',
      },
    ],
    [
      Date.UTC(2025, 5, 13, 1, 20),
      {
        serving: 'Rd',
        control: 'Rd',
        policy: 'u',
        iam: 'Rd',
        storage: 'Rd',
        run: 'Rd',
        dataflow: 'Rd',
        vertex: 'Rd',
        'control-iowa': 'Rd',
        'policy-iowa': 'Rd',
        'vertex-belgium': 'Rd',
        'vertex-singapore': 'Rd',
      },
    ],
  ];

  it.each(TABLE)('states each service as the report does at %i', (atMs, expected) => {
    expect(conditionsAt(atMs)).toEqual(
      Object.fromEntries(Object.entries(expected).map(([id, code]) => [id, STATE[code]])),
    );
  });

  it('says where two of its updates time the same recovery differently', () => {
    // Placed at the status update that first says it; the mini incident
    // report's later time for the same mitigation is said beside it.
    const outside = capture.events.find(
      (event) => event.title === 'Recovered outside us-central1',
    )!;
    expect(outside.atMs).toBe(Date.UTC(2025, 5, 12, 19, 30));
    expect(outside.detail).toContain('Status update, 12:30 PDT');
    expect(outside.detail).toContain(
      'The mini incident report times the mitigation outside us-central1 at 12:48 PDT.',
    );
  });

  it('knows nothing before its first stated event', () => {
    const frame = frameAt(capture, Date.UTC(2025, 5, 12, 17, 47));
    expect([...frame.nodes.known]).toEqual(capture.nodes.map(() => 0));
    // A statement without a state names the policy tables and changes nothing.
    const first = capture.events[0]!;
    expect(first.state).toBeUndefined();
    expect(first.nodes).toEqual(['policy']);
    expect(nodeReadings(capture, first.atMs)[2]!.level).toBeNull();
  });

  it('draws impact as critical, recovery as degraded and a recovered service as normal, never down', () => {
    const atMs = Date.UTC(2025, 5, 12, 19, 35);
    const frame = frameAt(capture, atMs);
    const index = (id: string) => capture.nodes.findIndex((node) => node.id === id);
    expect(frame.nodes.health[index('iam')]).toBe(2);
    expect(frame.nodes.health[index('serving')]).toBe(1);
    expect(frame.nodes.health[index('control')]).toBe(0);
    expect(frame.nodes.known[index('control')]).toBe(1);
    expect(frame.nodes.known[index('policy')]).toBe(0);
    expect(Math.max(...frame.nodes.health)).toBeLessThan(3);
  });

  it('states no traffic: every piece rests, and no connection carries any', () => {
    const frame = frameAt(capture, Date.UTC(2025, 5, 12, 19, 35));
    expect([...frame.nodes.measured]).toEqual(capture.nodes.map(() => 0));
    expect(frame.nodes.throughputRps.every((rate) => rate === 0)).toBe(true);
    expect(frame.edges.trafficRps.every((rate) => rate === 0)).toBe(true);
    expect(edgeReadings(capture, Date.UTC(2025, 5, 12, 19, 35))[0]!.condition).toBe('not-stated');
  });

  it('counts the affected, the recovering and those not stated', () => {
    expect(statusAt(capture, Date.UTC(2025, 5, 12, 17, 47))).toEqual({
      kind: 'report',
      affected: 0,
      recovering: 0,
      notStated: 12,
      worst: 0,
    });
    expect(statusAt(capture, Date.UTC(2025, 5, 12, 19, 35))).toEqual({
      kind: 'report',
      affected: 4,
      recovering: 2,
      notStated: 5,
      worst: 2,
    });
    expect(statusAt(capture, Date.UTC(2025, 5, 13, 1, 20))).toEqual({
      kind: 'report',
      affected: 0,
      recovering: 0,
      notStated: 1,
      worst: 0,
    });
  });
});

describe('the Online Boutique benchmark', () => {
  const capture = read(boutique);
  const injected = capture.events.find((event) => event.title === 'Benchmark fault injected')!;

  it('knows no service’s state at the injection, because it counts no errors', () => {
    const readings = nodeReadings(capture, injected.atMs);
    expect(readings.filter((reading) => reading.level !== null)).toEqual([]);
    expect([...frameAt(capture, injected.atMs).nodes.known]).toEqual(capture.nodes.map(() => 0));
    const status = statusAt(capture, injected.atMs);
    expect(status).toMatchObject({
      kind: 'measurements',
      past: 0,
      known: 0,
      errorsInCapture: false,
      measuredNow: true,
    });
  });

  it('still works the pieces whose requests were measured', () => {
    const frame = frameAt(capture, injected.atMs);
    capture.nodes.forEach((node, i) => {
      const counts = node.buckets.some((point) => point.requests !== undefined);
      expect(frame.nodes.measured[i]).toBe(counts ? 1 : 0);
      if (counts) expect(frame.nodes.throughputRps[i]).toBeGreaterThan(0);
    });
    const status = statusAt(capture, injected.atMs);
    expect(status.kind === 'measurements' && status.unknownMeasured).toBe(
      capture.nodes.filter((node) => bucketAt(node.buckets, injected.atMs, capture.periodMs))
        .length,
    );
  });

  it('still shows its last measurements at the very end of its window', () => {
    const { endMs } = capture.window;
    // Every last sample of this capture ends exactly where the window does.
    expect(
      [...capture.nodes, ...capture.edges].some((item) =>
        item.buckets.some((point) => point.atMs + capture.periodMs! === endMs),
      ),
    ).toBe(true);
    expect(frameAt(capture, endMs)).toEqual(frameAt(capture, endMs - 1));
    expect(statusAt(capture, endMs)).toEqual(statusAt(capture, endMs - 1));
    expect(nodeReadings(capture, endMs)).toEqual(nodeReadings(capture, endMs - 1));
    expect(edgeReadings(capture, endMs)).toEqual(edgeReadings(capture, endMs - 1));
    const frame = frameAt(capture, endMs);
    expect(frame.nodes.measured.some((measured) => measured === 1)).toBe(true);
    expect(frame.edges.trafficRps.some((rate) => rate > 0)).toBe(true);
    expect(statusAt(capture, endMs)).toMatchObject({ measuredNow: true });
  });

  it('plays its ten minutes at 10×, within a minute', () => {
    expect(defaultSpeed(capture)).toBe(10);
    expect(defaultSpeed(read(google))).toBe(600);
  });
});

describe('a metrics capture', () => {
  it('knows the traffic of a first interval with requests but no errors, and not its state', () => {
    const capture = measured();
    const reading = nodeReadings(capture, at(0))[0]!;
    expect(reading.condition).toBe('unknown');
    expect(reading.level).toBeNull();
    expect(reading.requestsPerSecond).toBe(10);
    const frame = frameAt(capture, at(0));
    expect(frame.nodes.known[0]).toBe(0);
    expect(frame.nodes.measured[0]).toBe(1);
    expect(frame.nodes.throughputRps[0]).toBe(10);
  });

  it('colours by the simulation’s error levels, sample by sample', () => {
    const capture = measured();
    const conditions = [1, 2, 3].map((minute) => nodeReadings(capture, at(minute))[0]!);
    expect(conditions.map((reading) => reading.condition)).toEqual([
      'normal',
      'degraded',
      'critical',
    ]);
    expect(conditions.map((reading) => reading.errorRate)).toEqual([0.01, 0.05, 1]);
    expect(sampleHealth({ atMs: 0, requests: 100, faults: 100 * ERROR_DEGRADED })?.level).toBe(1);
    expect(sampleHealth({ atMs: 0, requests: 100, faults: 100 * ERROR_CRITICAL })?.level).toBe(2);
    // More errors than requests is still a rate of one.
    expect(sampleHealth({ atMs: 0, requests: 10, faults: 20 })?.errorRate).toBe(1);
  });

  it('never colours by latency or memory', () => {
    const capture = measured();
    expect(nodeReadings(capture, at(7))[0]!.condition).toBe('normal');
    expect(nodeReadings(capture, at(6))[0]!.condition).toBe('unknown');
  });

  it('calls a period without requests normal, and one without a sample unknown', () => {
    const capture = measured();
    const idle = nodeReadings(capture, at(5))[0]!;
    expect(idle).toMatchObject({ condition: 'normal', level: 0, requestsPerSecond: 0 });
    expect(idle.errorRate).toBeNull();
    // Minute 4 has no sample: the one before it does not stand in.
    const gap = nodeReadings(capture, at(4))[0]!;
    expect(gap).toMatchObject({ condition: 'unknown', level: null, sample: undefined });
    expect(frameAt(capture, at(4)).nodes.measured[0]).toBe(0);
    // Errors without requests give no rate.
    expect(nodeReadings(capture, at(6))[0]!.requestsPerSecond).toBeNull();
  });

  it('holds a moment in one sample only, except the window’s end, held by the sample ending there', () => {
    const samples = [
      { atMs: START + 8 * PERIOD, requests: 60, faults: 0 },
      { atMs: START + 9 * PERIOD, requests: 60, faults: 30 },
    ];
    const end = START + 10 * PERIOD;
    // Where one period ends and the next begins, the moment is the next one's.
    expect(bucketAt(samples, START + 9 * PERIOD, PERIOD, end)).toBe(samples[1]);
    // Inside the window, a period's end is not part of it.
    expect(bucketAt(samples.slice(0, 1), START + 9 * PERIOD, PERIOD, end)).toBeUndefined();
    // The window's end is the last moment there is: the last sample holds it.
    expect(bucketAt(samples, end, PERIOD, end)).toBe(samples[1]);
    expect(bucketAt(samples, end, PERIOD)).toBeUndefined();
    // A sample that ended before the window did still does not stand in.
    expect(bucketAt(samples.slice(0, 1), end, PERIOD, end)).toBeUndefined();

    const capture = measured({
      nodes: [
        {
          id: 'front',
          name: 'front',
          region: 'unreported',
          type: 'api-gateway',
          buckets: samples,
        },
      ],
      edges: [],
    });
    expect(nodeReadings(capture, end)[0]).toMatchObject({ condition: 'critical', level: 2 });
    expect(frameAt(capture, end)).toEqual(frameAt(capture, end - 1));
    expect(statusAt(capture, end)).toEqual(statusAt(capture, end - 1));
  });

  it('gives a connection its error rate where it was measured, and 0 where it was not', () => {
    const capture = measured();
    expect(frameAt(capture, at(0)).edges.errorRate[0]).toBe(0);
    expect(edgeReadings(capture, at(0))[0]!.condition).toBe('unknown');
    expect(frameAt(capture, at(1)).edges.errorRate[0]).toBe(0.25);
    expect(edgeReadings(capture, at(1))[0]!.condition).toBe('critical');
    expect(frameAt(capture, at(1)).edges.trafficRps[0]).toBe(1);
  });

  it('reads one service or connection as the lists do', () => {
    const capture = measured();
    expect(readingOf(capture, capture.nodes[1]!, at(2))).toEqual(nodeReadings(capture, at(2))[1]);
    expect(readingOf(capture, capture.edges[0]!, at(1))).toEqual(edgeReadings(capture, at(1))[0]);
    const report = read(google);
    const iam = report.nodes.find((node) => node.id === 'iam')!;
    expect(readingOf(report, iam, Date.UTC(2025, 5, 12, 19, 35)).condition).toBe('affected');
    expect(readingOf(report, report.edges[0]!, Date.UTC(2025, 5, 12, 19, 35)).condition).toBe(
      'not-stated',
    );
  });

  it('never counts a service whose state is unknown among the known', () => {
    const capture = measured();
    expect(statusAt(capture, at(2))).toEqual({
      kind: 'measurements',
      past: 2,
      known: 2,
      unknownMeasured: 0,
      errorsInCapture: true,
      measuredNow: true,
      worst: 2,
    });
    expect(statusAt(capture, at(0))).toMatchObject({ past: 0, known: 0, unknownMeasured: 1 });
    expect(statusAt(capture, at(9))).toMatchObject({ known: 0, measuredNow: false });
    const silent = measured({
      nodes: [
        {
          id: 'front',
          name: 'front',
          region: 'unreported',
          type: 'api-gateway',
          buckets: [{ atMs: START, requests: 5 }],
        },
      ],
      edges: [],
    });
    expect(statusAt(silent, at(0))).toMatchObject({ errorsInCapture: false, unknownMeasured: 1 });
  });

  it('measures a piece against the median of its own measured rates', () => {
    const capture = measured();
    const topology = sceneTopologyOf(capture, bundledTopologyId('test'));
    // front: 10, 10, 10, 10, 0, 20 requests per second; back: 2; never 0 for "none".
    expect(topology.nodes[0]!.metrics.throughputRps).toBe(10);
    expect(topology.nodes[1]!.metrics.throughputRps).toBe(2);
    expect(topology.edges[0]!.metrics.trafficRps).toBe(1);
    const report = sceneTopologyOf(read(google), bundledTopologyId('google'));
    expect(report.nodes.every((node) => node.metrics.throughputRps === 0)).toBe(true);
  });

  it('measures a service idle in most of its periods against the periods it was called in', () => {
    // `rare` counts no requests in three of its five minutes, then 30 and 6;
    // `busy` beside it counts 3000 a minute.
    const capture = measured({
      nodes: [
        {
          id: 'rare',
          name: 'rare',
          region: 'unreported',
          type: 'microservice',
          buckets: [0, 0, 0, 30, 6].map((requests, i) => ({ atMs: START + i * PERIOD, requests })),
        },
        {
          id: 'busy',
          name: 'busy',
          region: 'unreported',
          type: 'microservice',
          buckets: [{ atMs: START, requests: 3000 }],
        },
      ],
      edges: [],
    });
    const topology = sceneTopologyOf(capture, bundledTopologyId('test'));
    // Its own: the median of 0.5 and 0.1 requests per second, never busy's 50.
    expect(topology.nodes[0]!.metrics.throughputRps).toBeCloseTo(0.3);
    const reference = referenceThroughput(topology.nodes);
    expect(reference[0]).toBeCloseTo(0.3);
    // So its piece works in the minutes requests passed, and stands still in the others.
    const rare = (minute: number) => frameAt(capture, at(minute)).nodes.throughputRps[0]!;
    expect(paceOf(rare(3), reference[0]!)).toBeGreaterThan(0);
    expect(paceOf(rare(4), reference[0]!)).toBeGreaterThan(0);
    expect(paceOf(rare(0), reference[0]!)).toBe(0);
    // A service that never counted a request has no rate of its own: 0.
    const idle = measured({
      nodes: [
        {
          id: 'idle',
          name: 'idle',
          region: 'unreported',
          type: 'microservice',
          buckets: [{ atMs: START, requests: 0 }],
        },
      ],
      edges: [],
    });
    expect(sceneTopologyOf(idle, bundledTopologyId('idle')).nodes[0]!.metrics.throughputRps).toBe(
      0,
    );
  });

  it('marks the samples past the levels, the worse at a moment winning', () => {
    expect(levelMarks(measured())).toEqual([
      { atMs: START + 2 * PERIOD, level: 2 },
      { atMs: START + 3 * PERIOD, level: 2 },
    ]);
    expect(levelMarks(read(boutique))).toEqual([]);
  });
});

describe('the scene’s topology', () => {
  it('is named by the capture’s id, never by its title', () => {
    expect(bundledTopologyId('google-cloud-2025-06-12')).toBe('capture:google-cloud-2025-06-12');
    expect(fileTopologyId('ab'.repeat(32))).toBe(`capture:file:${'ab'.repeat(32)}`);
    const capture = read(google);
    const topology = sceneTopologyOf(capture, bundledTopologyId('google-cloud-2025-06-12'));
    expect(topology.id).toBe('capture:google-cloud-2025-06-12');
    expect(topology.id).not.toContain(capture.title);
  });

  it('puts every region on a plate of its own, with no hub and no direction of travel', () => {
    const topology = sceneTopologyOf(read(google), 'capture:x');
    expect(topology.regions.map((region) => region.kind)).toEqual([
      'cloud',
      'cloud',
      'cloud',
      'cloud',
    ]);
    expect(topology.nodes.every((node) => node.tier === 0)).toBe(true);
    expect(topology.edges.map((edge) => edge.id)).toContain(
      connectionId({ source: 'serving', target: 'control' }),
    );
  });
});

describe('time in a capture', () => {
  it('changes what is shown only where a sample begins or ends, or an event is', () => {
    const capture = measured();
    const changes = changesOf(capture);
    expect([...changes]).toEqual([...changes].sort((a, b) => a - b));
    expect(new Set(changes).size).toBe(changes.length);
    // Within a period nothing changes; across its end it does.
    expect(stepAt(capture, START + 1)).toBe(stepAt(capture, START + PERIOD - 1));
    expect(stepAt(capture, START + PERIOD)).toBe(stepAt(capture, START + PERIOD - 1) + 1);
    for (let k = 0; k + 1 < changes.length; k++) {
      const from = changes[k]!;
      const to = changes[k + 1]!;
      const middle = from + (to - from) / 2;
      expect(frameAt(capture, middle)).toEqual(frameAt(capture, from));
      expect(stepAt(capture, middle)).toBe(stepAt(capture, from));
    }
  });

  it('counts the events at or before the cursor', () => {
    const capture = read(google);
    expect(eventsUpTo(capture, capture.window.startMs - 1)).toBe(0);
    expect(eventsUpTo(capture, capture.events[0]!.atMs)).toBe(1);
    expect(eventsUpTo(capture, capture.window.endMs)).toBe(capture.events.length);
    expect(stepAt(capture, Date.UTC(2025, 5, 12, 19, 35))).toBe(
      stepAt(capture, Date.UTC(2025, 5, 12, 19, 36)),
    );
  });

  it('steps a period, or a hundredth of a window without one', () => {
    expect(stepMs(measured())).toBe(PERIOD);
    const report = read(google);
    expect(stepMs(report)).toBe(Math.round((report.window.endMs - report.window.startMs) / 100));
  });

  it('plays a long window at the fastest speed', () => {
    const long = measured({ window: { startMs: START, endMs: START + 1000 * 3600 * 1000 } });
    expect(defaultSpeed(long)).toBe(3600);
  });
});

describe('a measure over the capture', () => {
  it('leaves a gap where a sample does not hold it, and where no sample is', () => {
    const capture = measured();
    const series = seriesOf(capture, capture.nodes[0]!.buckets, 'errorRate');
    expect(series.atMs).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((m) => START + m * PERIOD));
    expect(series.values.map((value) => (Number.isNaN(value) ? null : value))).toEqual([
      null,
      0.01,
      0.05,
      1,
      null,
      null,
      null,
      0,
    ]);
    expect(rangeOf(series.values)).toEqual({ low: 0, high: 1 });
    expect(rangeOf(seriesOf(capture, capture.nodes[0]!.buckets, 'memoryBytes').values)).toEqual({
      low: 1e12,
      high: 1e12,
    });
    expect(rangeOf([Number.NaN])).toBeNull();
  });
});

describe('a file’s identity', () => {
  it('is the SHA-256 of its bytes, with or without Web Crypto', async () => {
    const sizes = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 70_001];
    for (const size of sizes) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 31 + size) & 0xff;
      const expected = createHash('sha256').update(bytes).digest('hex');
      expect(sha256Fallback(bytes)).toBe(expected);
      expect(await sha256Hex(bytes)).toBe(expected);
    }
  });
});

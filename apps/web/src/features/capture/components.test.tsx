/**
 * The parts of an incident capture on screen: what each shows of the
 * capture at the cursor, in what words, and what it does when it is used.
 * One file, so the parts share one page and their fixtures.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { leaveCapture } from '@/app/captureUrl';
import {
  CAPTURE_STATE_COLOR,
  CAPTURE_STATE_GLYPH,
  CAPTURE_STATE_LABEL,
  captureStateLabel,
  COLOR,
} from '@/lib/palette';
import { ERROR_CRITICAL, ERROR_DEGRADED } from '@/lib/thresholds';
import { useCapture } from '@/stores/capture';

import { BUNDLED } from './bundled';
import {
  changesOf,
  edgeReadings,
  eventsUpTo,
  levelMarks,
  nodeReadings,
  readCapture,
  SPEEDS,
  statusAt,
  type Capture,
  type CaptureStatus as Status,
  type Condition,
} from './capture';
import { CaptureBar } from './CaptureBar';
import { CaptureCard } from './CaptureCard';
import { CaptureDetails } from './CaptureDetails';
import { CaptureDialog } from './CaptureDialog';
import { CaptureHover } from './CaptureHover';
import { CaptureList, CONNECTIONS_LISTED } from './CaptureList';
import { captureSentence, CaptureStatus, sentenceLevel } from './CaptureStatus';
import { CaptureTable } from './CaptureTable';
import google from './google-cloud-2025-06-12.json';
import boutique from './online-boutique-rcaeval.json';
import {
  captureNames,
  colourNote,
  ConditionBadge,
  ConditionGlyph,
  ConditionMark,
  formatBytes,
  formatPeriod,
  isoOf,
  levelPercent,
  momentAt,
  sinceCaptureStart,
  utcDay,
  utcMoment,
  utcSpan,
  utcTime,
} from './present';

const GOOGLE = 'google-cloud-2025-06-12';
const BOUTIQUE = 'online-boutique-rcaeval';
const START = 1_700_000_000_000;
const PERIOD = 60_000;

const read = (input: unknown): Capture => {
  const capture = readCapture(input);
  if (!capture) throw new Error('not a capture');
  return capture;
};

const GOOGLE_CAPTURE = read(google);
const BOUTIQUE_CAPTURE = read(boutique);
const CONDITIONS: Condition[] = [
  'unknown',
  'normal',
  'degraded',
  'critical',
  'not-stated',
  'affected',
  'recovering',
  'recovered',
];

/** Three services, one minute apart: failing, well and measured without errors, in that order. */
function measured(): Capture {
  return read({
    kind: 'aegis-incident-capture',
    version: 1,
    title: 'Test capture',
    source: { kind: 'tempo-prometheus', label: 'Tempo / Prometheus' },
    window: { startMs: START, endMs: START + 4 * PERIOD },
    periodMs: PERIOD,
    regions: [{ id: 'r', name: 'Location not reported' }],
    nodes: [
      {
        id: 'failing',
        name: 'failing',
        region: 'r',
        type: 'microservice',
        buckets: [{ atMs: START, requests: 100, faults: 30 }],
      },
      {
        id: 'well',
        name: 'well',
        region: 'r',
        type: 'microservice',
        buckets: [{ atMs: START, requests: 100, faults: 1 }],
      },
      {
        id: 'counted',
        name: 'counted',
        region: 'r',
        type: 'microservice',
        buckets: [{ atMs: START, requests: 50 }],
      },
    ],
    edges: [],
  });
}

const measurements = (over: Partial<Extract<Status, { kind: 'measurements' }>>): Status => ({
  kind: 'measurements',
  past: 0,
  known: 0,
  unknownMeasured: 0,
  errorsInCapture: true,
  measuredNow: true,
  worst: 0,
  ...over,
});
const report = (over: Partial<Extract<Status, { kind: 'report' }>>): Status => ({
  kind: 'report',
  affected: 0,
  recovering: 0,
  notStated: 0,
  worst: 0,
  ...over,
});

/** A capture whose errors were counted: one service fails in its second minute. */
const COUNTED = {
  kind: 'aegis-incident-capture',
  version: 1,
  title: 'Checkout errors',
  source: { kind: 'cloudwatch', label: 'CloudWatch Application Signals' },
  window: { startMs: START, endMs: START + 3 * PERIOD },
  topologyWindow: { startMs: START, endMs: START + 3 * PERIOD },
  periodMs: PERIOD,
  regions: [{ id: 'east', name: 'us-east-1' }],
  nodes: [
    {
      id: 'checkout',
      name: 'checkout',
      region: 'east',
      type: 'microservice',
      typeSource: 'source',
      buckets: [
        { atMs: START, requests: 200, faults: 2, p95Ms: 120 },
        { atMs: START + PERIOD, requests: 200, faults: 60, p95Ms: 900 },
        // The third minute was not measured.
      ],
    },
    {
      id: 'payments',
      name: 'payments',
      region: 'east',
      type: 'microservice',
      typeSource: 'declared',
      buckets: [{ atMs: START, requests: 100, faults: 0 }],
    },
  ],
  edges: [
    {
      source: 'checkout',
      target: 'payments',
      buckets: [{ atMs: START, requests: 100 }],
    },
  ],
};

/** A file as the store reads one: its name, its size and its bytes. */
function fileOfValue(value: unknown): File {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    name: 'checkout.json',
    size: bytes.length,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
  } as unknown as File;
}

function fileNamed(text: string, name: string): File {
  return new File([text], name, { type: 'application/json' });
}

async function openBar(id: string) {
  await act(() => useCapture.getState().openBundled(id));
  return render(<CaptureBar />);
}

async function openList(id: string, tab: 'services' | 'events' = 'services') {
  await act(() => useCapture.getState().openBundled(id));
  act(() => useCapture.getState().setList(true, tab));
  return render(<CaptureList />);
}

afterEach(() => {
  // Closes whatever is open, and the history goes back to where it began.
  act(() => leaveCapture());
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
});

describe('the moment the cursor is read at', () => {
  it.each([
    ['a provider report', GOOGLE_CAPTURE],
    ['a metrics capture', BOUTIQUE_CAPTURE],
  ])('reads %s the same as the cursor itself, everywhere in it', (_, capture) => {
    const { startMs, endMs } = capture.window;
    const moments = [startMs, endMs, endMs - 1, ...changesOf(capture)];
    // Between the changes, and either side of each of them.
    for (const change of changesOf(capture)) moments.push(change - 1, change + 1);
    for (let i = 0; i <= 200; i++)
      moments.push(startMs + Math.round(((endMs - startMs) * i) / 200));
    for (const atMs of moments.filter((ms) => ms >= startMs && ms <= endMs)) {
      const moment = momentAt(capture, atMs);
      expect(moment).toBeLessThanOrEqual(atMs);
      expect(nodeReadings(capture, moment)).toEqual(nodeReadings(capture, atMs));
      expect(edgeReadings(capture, moment)).toEqual(edgeReadings(capture, atMs));
      expect(statusAt(capture, moment)).toEqual(statusAt(capture, atMs));
      expect(eventsUpTo(capture, moment)).toBe(eventsUpTo(capture, atMs));
    }
  });

  it('stays the same between two changes, so a part reading it is not drawn again', () => {
    const changes = changesOf(GOOGLE_CAPTURE);
    const [first, second] = [changes[1]!, changes[2]!];
    expect(momentAt(GOOGLE_CAPTURE, first)).toBe(first);
    expect(momentAt(GOOGLE_CAPTURE, first + 1)).toBe(first);
    expect(momentAt(GOOGLE_CAPTURE, second - 1)).toBe(first);
    expect(momentAt(GOOGLE_CAPTURE, second)).toBe(second);
  });
});

describe('a capture’s time', () => {
  // 17:49 UTC on 12 June 2025, when the mini report has the outage begin.
  const start = Date.UTC(2025, 5, 12, 17, 49);

  it('is written in UTC, with seconds only when it has them or is asked for them', () => {
    expect(utcTime(start)).toBe('17:49');
    expect(utcTime(start + 6_000)).toBe('17:49:06');
    expect(utcTime(start, true)).toBe('17:49:00');
    expect(utcDay(start)).toMatch(/2025/);
    expect(utcDay(start)).toMatch(/12/);
    expect(utcMoment(start)).toMatch(/17:49/);
    expect(isoOf(start)).toBe('2025-06-12T17:49:00.000Z');
  });

  it('is counted from the start of the capture’s window', () => {
    const { startMs } = GOOGLE_CAPTURE.window;
    expect(sinceCaptureStart(GOOGLE_CAPTURE, startMs)).toBe('+0:00');
    expect(sinceCaptureStart(GOOGLE_CAPTURE, startMs + 4 * 60_000)).toBe('+4:00');
    expect(sinceCaptureStart(GOOGLE_CAPTURE, startMs + 2 * 3_600_000)).toBe('+2:00:00');
  });

  it('says a stretch as two moments, in UTC', () => {
    const text = utcSpan(GOOGLE_CAPTURE.window);
    expect(text).toMatch(/^From .* to .*, UTC$/);
    expect(text).toMatch(/17:45/);
    expect(text).toMatch(/01:27/);
  });

  it('writes periods and sizes in their own units', () => {
    expect(formatPeriod(30_000)).toBe('30 s');
    expect(formatPeriod(300_000)).toBe('5 min');
    expect(formatPeriod(3_600_000)).toBe('1 h');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(43_581_440)).toBe('41.6 MiB');
    expect(formatBytes(111_681_536)).toBe('107 MiB');
    expect(formatBytes(Number.NaN)).toBe('–');
  });
});

describe('a captured service’s name', () => {
  it('is left alone when it is unique, and says its region when it is not', () => {
    const capture = read({
      ...boutique,
      regions: [
        { id: 'east', name: 'East' },
        { id: 'west', name: 'West' },
      ],
      nodes: [
        { id: 'a', name: 'cart', region: 'east', type: 'microservice' },
        { id: 'b', name: 'cart', region: 'west', type: 'microservice' },
        { id: 'c', name: 'redis', region: 'west', type: 'database' },
      ],
      edges: [],
      events: [],
    });
    const names = captureNames(capture);
    expect(names.get('a')).toBe('cart, East');
    expect(names.get('b')).toBe('cart, West');
    expect(names.get('c')).toBe('redis');
  });
});

describe('how a capture is coloured, in words', () => {
  it('names the simulation’s own levels, from the thresholds and never as a literal', () => {
    const note = colourNote(measured());
    expect(note).toContain(`degraded (${levelPercent(ERROR_DEGRADED)})`);
    expect(note).toContain(`critical (${levelPercent(ERROR_CRITICAL)})`);
    expect(levelPercent(ERROR_DEGRADED)).toBe('4%');
    expect(levelPercent(ERROR_CRITICAL)).toBe('20%');
    expect(note).toMatch(/The source sets no threshold/);
    expect(note).not.toMatch(/objective/i);
  });

  it('says of a report that it grades no severity', () => {
    expect(colourNote(GOOGLE_CAPTURE)).toMatch(/does not grade how severe/);
  });

  it('says of a capture that counts no errors that nothing in it is coloured', () => {
    expect(colourNote(BOUTIQUE_CAPTURE)).toBe(
      'This capture has no error counts, so no service in it is coloured.',
    );
  });
});

describe('a capture’s states, drawn', () => {
  it('take a signal colour only past normal, and never the viewer’s blue', () => {
    for (const condition of CONDITIONS) {
      const colour = CAPTURE_STATE_COLOR[condition];
      expect(colour, condition).not.toBe(COLOR.focus);
      const glyph = CAPTURE_STATE_GLYPH[condition];
      const signal = colour === COLOR.warning || colour === COLOR.critical;
      expect(signal, condition).toBe(glyph === 'degraded' || glyph === 'critical');
    }
  });

  it('draw a state that is not given as the dashed ring, and normal as nothing', () => {
    const shape = (condition: Condition) =>
      render(<ConditionGlyph condition={condition} />).container.querySelector('svg');
    expect(shape('unknown')?.getAttribute('data-glyph')).toBe('unknown');
    expect(shape('not-stated')?.getAttribute('data-glyph')).toBe('unknown');
    expect(shape('normal')).toBeNull();
    expect(shape('recovered')).toBeNull();
    expect(shape('affected')?.querySelector('rect')).not.toBeNull();
    expect(shape('recovering')?.querySelector('path')).not.toBeNull();
    const ring = render(<ConditionGlyph condition="unknown" />).container.querySelector('circle');
    expect(ring?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(ring?.getAttribute('fill')).toBe('none');
  });

  it('say the state in words, quietly unless it is past normal', () => {
    const badge = (condition: Condition) =>
      render(<ConditionBadge condition={condition} />).container.firstElementChild as HTMLElement;
    expect(badge('unknown')).toHaveTextContent('No data');
    expect(badge('unknown').style.color).toBe('');
    expect(badge('not-stated')).toHaveTextContent('Not stated at this time');
    expect(badge('affected')).toHaveTextContent('Reported affected');
    expect(badge('affected').style.color).toBe(COLOR.critical);
    expect(badge('recovering').style.color).toBe(COLOR.warning);
    expect(badge('normal').style.color).toBe('');
    const mark = render(<ConditionMark condition="unknown" />).container;
    expect(mark).toHaveTextContent('No data');
  });

  it('tell an error rate not measured from no data by whether there is a sample', () => {
    expect(captureStateLabel('unknown')).toBe('No data');
    expect(captureStateLabel('unknown', false)).toBe('No data');
    expect(captureStateLabel('unknown', true)).toBe('Error rate not measured');
    // A sample changes the words of no other state.
    for (const condition of CONDITIONS.filter((c) => c !== 'unknown')) {
      expect(captureStateLabel(condition, true), condition).toBe(CAPTURE_STATE_LABEL[condition]);
    }
    const badge = render(<ConditionBadge condition="unknown" sampled />).container;
    expect(badge).toHaveTextContent('Error rate not measured');
    expect(badge).not.toHaveTextContent('No data');
    const mark = render(<ConditionMark condition="unknown" sampled />).container;
    expect(mark).toHaveTextContent('Error rate not measured');
    expect(mark.firstElementChild).toHaveAttribute('title', 'Error rate not measured');
  });
});

describe('the sentence of a metrics capture', () => {
  it('counts the services past the levels among those whose errors were measured', () => {
    const capture = measured();
    const status = statusAt(capture, START + 1);
    expect(captureSentence(status, capture.nodes.length)).toBe(
      '1 of 2 services past the error levels; 1 without an error rate',
    );
    expect(sentenceLevel(status)).toBe(2);
  });

  it('says of one service whose state is known that it is the one past the levels', () => {
    expect(captureSentence(measurements({ past: 1, known: 1, worst: 2 }), 3)).toBe(
      '1 service, past the error levels',
    );
    expect(captureSentence(measurements({ past: 1, known: 1, unknownMeasured: 2 }), 3)).toBe(
      '1 service, past the error levels; 2 without an error rate',
    );
  });

  it('says of a sample with errors and no request count that it has no rate, not no count', () => {
    // `a` counts errors and no requests; `b` counts both.
    const capture = read({
      kind: 'aegis-incident-capture',
      version: 1,
      title: 'Errors without requests',
      source: { kind: 'tempo-prometheus', label: 'Tempo / Prometheus' },
      window: { startMs: START, endMs: START + PERIOD },
      periodMs: PERIOD,
      regions: [{ id: 'r', name: 'Location not reported' }],
      nodes: [
        {
          id: 'a',
          name: 'a',
          region: 'r',
          type: 'microservice',
          buckets: [{ atMs: START, faults: 12 }],
        },
        {
          id: 'b',
          name: 'b',
          region: 'r',
          type: 'microservice',
          buckets: [{ atMs: START, requests: 10, faults: 5 }],
        },
      ],
      edges: [],
    });
    const sentence = captureSentence(statusAt(capture, START), capture.nodes.length);
    expect(sentence).toBe('1 service, past the error levels; 1 without an error rate');
    expect(sentence).not.toMatch(/error count/);
    expect(sentence).not.toMatch(/1 of 1/);
  });

  it('never calls a service without an error count normal', () => {
    expect(captureSentence(measurements({ known: 3 }), 5)).toBe(
      '3 services, none past the error levels',
    );
    expect(captureSentence(measurements({ known: 1, unknownMeasured: 2 }), 5)).toBe(
      '1 service, not past the error levels; 2 without an error rate',
    );
    expect(captureSentence(measurements({ unknownMeasured: 4 }), 5)).toBe(
      '4 services measured, none with an error rate at this time',
    );
    expect(captureSentence(measurements({ unknownMeasured: 1 }), 5)).toBe(
      '1 service measured, without an error rate at this time',
    );
  });

  it('says so when the capture counts no errors at all, or nothing is measured', () => {
    expect(captureSentence(measurements({ errorsInCapture: false, unknownMeasured: 11 }), 11)).toBe(
      '11 services measured; error counts are not in this capture',
    );
    expect(captureSentence(measurements({ measuredNow: false }), 11)).toBe(
      'No measurements at this time',
    );
    expect(captureSentence(measurements({}), 11)).toBe('No service measured at this time');
  });

  it('is quiet while nothing is past the levels', () => {
    expect(sentenceLevel(measurements({ known: 3, worst: 0 }))).toBe(0);
    expect(sentenceLevel(measurements({ known: 3, past: 1, worst: 1 }))).toBe(1);
  });
});

describe('the sentence of a provider report', () => {
  it('follows the report through the Google outage', () => {
    const capture = readCapture(google)!;
    const at = (hour: number, minute: number, day = 12) =>
      statusAt(capture, Date.UTC(2025, 5, day, hour, minute));
    const total = capture.nodes.length;
    expect(captureSentence(at(17, 47), total)).toBe('12 services, none stated yet in the report');
    expect(sentenceLevel(at(17, 47))).toBe(0);
    expect(captureSentence(at(17, 50), total)).toBe('6 services reported affected; 6 not stated');
    expect(sentenceLevel(at(17, 50))).toBe(2);
    expect(captureSentence(at(19, 35), total)).toBe(
      '4 services reported affected, 2 recovering; 5 not stated',
    );
  });

  it('has a whole phrase for every combination', () => {
    expect(captureSentence(report({ recovering: 1, notStated: 2 }), 5)).toBe(
      '1 service reported recovering; 2 not stated',
    );
    expect(captureSentence(report({ affected: 1, recovering: 3 }), 4)).toBe(
      '1 service reported affected, 3 recovering',
    );
    expect(captureSentence(report({ notStated: 1 }), 4)).toBe(
      '3 services reported recovered; 1 not stated',
    );
    expect(captureSentence(report({}), 1)).toBe('1 service reported recovered');
    expect(captureSentence(report({ notStated: 1 }), 1)).toBe(
      '1 service, not stated yet in the report',
    );
    expect(sentenceLevel(report({ recovering: 1, worst: 1 }))).toBe(1);
  });
});

describe('the bar’s sentence', () => {
  it('says the time it speaks of and leads to the events', async () => {
    const user = userEvent.setup();
    await act(() => useCapture.getState().openBundled(GOOGLE));
    render(<CaptureStatus />);
    const status = screen.getByTestId('capture-status');
    expect(status).toHaveTextContent('At 17:45 UTC: 12 services, none stated yet in the report');
    expect(status).toHaveAttribute('data-level', '0');
    expect(status.style.color).toBe('');

    act(() => useCapture.getState().seek(Date.UTC(2025, 5, 12, 17, 50)));
    expect(status).toHaveTextContent('At 17:50 UTC: 6 services reported affected; 6 not stated');
    expect(status).toHaveAttribute('data-level', '2');
    expect(status.style.color).toBe(COLOR.critical);

    await user.click(status);
    expect(useCapture.getState().listOpen).toBe(true);
    expect(useCapture.getState().listTab).toBe('events');
  });

  it('is not there while no capture is open', () => {
    render(<CaptureStatus />);
    expect(screen.queryByTestId('capture-status')).not.toBeInTheDocument();
  });
});

describe('the capture’s bar', () => {
  it('stands in the timeline’s place, as a capture’s', async () => {
    await openBar(GOOGLE);
    const bar = screen.getByTestId('timeline');
    expect(bar).toHaveAttribute('data-mode', 'capture');
    expect(bar).toHaveAttribute('data-status', 'paused');
    expect(bar).toHaveAccessibleName('Capture timeline and playback');
    expect(bar).not.toHaveTextContent(/live/i);
    // One track, the same as the simulation's.
    expect(screen.getAllByRole('slider', { name: 'Timeline position' })).toHaveLength(1);
    expect(screen.getByTestId('timeline-track')).toBeInTheDocument();
  });

  it('shows the cursor’s date and time in UTC, and how far into the capture it is', async () => {
    await openBar(GOOGLE);
    const time = screen.getByTestId('capture-time');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2025-06-12T17:45:00.000Z');
    expect(time).toHaveTextContent('17:45:00 UTC');
    expect(time).toHaveTextContent(/2025/);
    expect(screen.getByTestId('capture-offset')).toHaveTextContent('+0:00 into the capture');

    act(() => useCapture.getState().seek(Date.UTC(2025, 5, 12, 17, 49)));
    expect(time).toHaveAttribute('datetime', '2025-06-12T17:49:00.000Z');
    expect(screen.getByTestId('capture-offset')).toHaveTextContent('+4:00 into the capture');
    expect(screen.getByRole('slider', { name: 'Timeline position' })).toHaveAttribute(
      'aria-valuetext',
      '17:49:00 UTC, +4:00 into the capture',
    );
  });

  it('plays and pauses the capture’s own clock', async () => {
    vi.useFakeTimers();
    await openBar(BOUTIQUE);
    const toggle = screen.getByTestId('capture-toggle');
    expect(toggle).toHaveTextContent('Play');
    act(() => toggle.click());
    expect(useCapture.getState().playing).toBe(true);
    expect(screen.getByTestId('timeline')).toHaveAttribute('data-status', 'playing');
    expect(toggle).toHaveTextContent('Pause');
    act(() => vi.advanceTimersByTime(1000));
    expect(useCapture.getState().atMs).toBeGreaterThan(boutique.window.startMs);
    act(() => toggle.click());
    expect(useCapture.getState().playing).toBe(false);
  });

  it('steps a sampling period with the arrows, ten with Shift, and goes to either end', async () => {
    const user = userEvent.setup();
    await openBar(BOUTIQUE);
    const track = screen.getByRole('slider', { name: 'Timeline position' });
    const { startMs, endMs } = boutique.window;
    track.focus();
    await user.keyboard('{ArrowRight}');
    expect(useCapture.getState().atMs).toBe(startMs + 30_000);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(useCapture.getState().atMs).toBe(startMs + 330_000);
    await user.keyboard('{ArrowLeft}');
    expect(useCapture.getState().atMs).toBe(startMs + 300_000);
    await user.keyboard('{End}');
    expect(useCapture.getState().atMs).toBe(endMs);
    await user.keyboard('{Home}');
    expect(useCapture.getState().atMs).toBe(startMs);
  });

  it('steps a hundredth of the window where the capture has no sampling period', async () => {
    const user = userEvent.setup();
    await openBar(GOOGLE);
    const { startMs, endMs } = google.window;
    screen.getByRole('slider', { name: 'Timeline position' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(useCapture.getState().atMs).toBe(startMs + Math.round((endMs - startMs) / 100));
  });

  it('sets the speed in capture time per second', async () => {
    const user = userEvent.setup();
    await openBar(GOOGLE);
    const speed = screen.getByRole('radiogroup', { name: 'Playback speed' });
    expect(speed.querySelectorAll('[role="radio"]')).toHaveLength(SPEEDS.length);
    expect(screen.getByRole('radio', { name: '600×' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: '3600×' }));
    expect(useCapture.getState().speed).toBe(3600);
  });

  it('marks each event by what it states, and every sample past the levels', async () => {
    const { container } = await openBar(GOOGLE);
    const marks = (kind: string) => container.querySelectorAll(`[data-mark="${kind}"]`).length;
    const events = google.events;
    expect(marks('event-affected')).toBe(events.filter((e) => e.state === 'affected').length);
    expect(marks('event-recovering')).toBe(events.filter((e) => e.state === 'recovering').length);
    expect(marks('event-recovered')).toBe(events.filter((e) => e.state === 'recovered').length);
    expect(marks('event-none')).toBe(events.filter((e) => !('state' in e)).length);
    // A report has no samples, so nothing on it is past a level.
    expect(marks('level-1') + marks('level-2')).toBe(0);
  });

  it('keeps each event’s shape when the track is pressed flat', async () => {
    const { container } = await openBar(GOOGLE);
    const { startMs, endMs } = google.window;
    const drawing = container.querySelector('[data-testid="timeline-track"] > svg');
    // The track's picture is stretched to its height, open or closed …
    expect(drawing).toHaveAttribute('preserveAspectRatio', 'none');
    const marks = [...container.querySelectorAll<HTMLElement>('[data-mark^="event-"]')];
    expect(marks).toHaveLength(google.events.length);
    for (const [i, mark] of marks.entries()) {
      // … and the events are not in it: each is laid over it at a fixed
      // size in pixels, square, wherever its moment falls across the track.
      expect(drawing?.contains(mark)).toBe(false);
      expect(mark.closest('svg')).toBeNull();
      expect(mark.style.width).toBe('9px');
      expect(mark.style.height).toBe('9px');
      const atMs = google.events[i]!.atMs;
      expect(Number.parseFloat(mark.style.left)).toBeCloseTo(
        ((atMs - startMs) / (endMs - startMs)) * 100,
        6,
      );
      const glyph = mark.querySelector('svg');
      if (google.events[i]!.state) {
        expect(glyph).toHaveAttribute('width', '9');
        expect(glyph).toHaveAttribute('height', '9');
        expect(glyph).not.toHaveAttribute('preserveAspectRatio');
      } else {
        expect(glyph).toBeNull();
      }
    }
    // The three states are three shapes, not three hues of one.
    const shape = (state: string) => {
      const glyph = container.querySelector(`[data-mark="event-${state}"] svg`);
      return glyph?.querySelector('rect, path, circle')?.tagName;
    };
    expect(new Set([shape('affected'), shape('recovering'), shape('recovered')]).size).toBe(3);
  });

  it('keeps every event of one moment in sight, side by side, each in its own shape', async () => {
    // jsdom lays nothing out: the strip is given the width of a desktop's.
    const width = 600;
    const laidOut = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    const { container } = await openBar(GOOGLE);
    laidOut.mockRestore();
    const { startMs, endMs } = google.window;
    const marks = [...container.querySelectorAll<HTMLElement>('[data-mark^="event-"]')];
    const centre = (mark: HTMLElement) =>
      (Number.parseFloat(mark.style.left) / 100) * width +
      (mark.style.marginLeft ? Number.parseFloat(mark.style.marginLeft) : 0);
    const centres = marks.map(centre);
    // No two lie over each other, and none is cut by an end of the strip.
    for (let i = 1; i < centres.length; i++) {
      expect(centres[i]! - centres[i - 1]!, `marks ${i - 1} and ${i}`).toBeGreaterThanOrEqual(9);
    }
    expect(Math.min(...centres)).toBeGreaterThanOrEqual(4.5);
    expect(Math.max(...centres)).toBeLessThanOrEqual(width - 4.5);
    // At 23:13 the report states three things at once: all three are there,
    // each near its moment.
    const at = Date.UTC(2025, 5, 12, 23, 13);
    const together = google.events
      .map((event, i) => ({ event, mark: marks[i]! }))
      .filter(({ event }) => event.atMs === at);
    expect(new Set(together.map(({ event }) => event.state))).toEqual(
      new Set(['recovered', 'recovering', 'affected']),
    );
    const moment = ((at - startMs) / (endMs - startMs)) * width;
    for (const { mark } of together) expect(Math.abs(centre(mark) - moment)).toBeLessThan(20);
  });

  it('draws events and ticks once for a capture, not again as the cursor moves', async () => {
    const { container } = await openBar(GOOGLE);
    const before = [...container.querySelectorAll('[data-mark]')];
    act(() => useCapture.getState().seek(Date.UTC(2025, 5, 12, 21, 0)));
    const after = [...container.querySelectorAll('[data-mark]')];
    expect(after).toEqual(before);
    // What is still to come is shaded by the track, not by each mark.
    for (const mark of after) {
      expect((mark as HTMLElement).style?.opacity ?? '').toBe('');
      expect(mark.getAttribute('opacity')).toBeNull();
    }
  });

  it('draws one tick per column at most, however many samples are past the levels', async () => {
    // Twenty services whose samples are a millisecond apart and all past a
    // level: 30 000 distinct moments in one file.
    const nodes = Array.from({ length: 20 }, (_, n) => ({
      id: `s${n}`,
      name: `s${n}`,
      region: 'east',
      type: 'microservice',
      buckets: Array.from({ length: 1500 }, (_, k) => ({
        atMs: START + k * 5000 + n,
        requests: 1,
        faults: 1,
      })),
    }));
    await act(() =>
      useCapture.getState().openFile(
        fileOfValue({
          ...COUNTED,
          window: { startMs: START, endMs: START + 1500 * 5000 },
          topologyWindow: undefined,
          periodMs: 5000,
          nodes,
          edges: [],
        }),
      ),
    );
    const { container } = render(<CaptureBar />);
    const ticks = container.querySelectorAll('[data-mark^="level-"]');
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(600);
  });

  it('keeps the times at the ends of a phone’s strip clear of the events’ marks', async () => {
    const { container } = await openBar(GOOGLE);
    // The report's first event is at the window's start and its last a few
    // minutes before the end: both ends have a mark in the times' place.
    const start = within(container).getByTestId('timeline-start');
    const end = within(container).getByTestId('timeline-end');
    expect(start).toHaveAttribute('data-crowded', 'true');
    expect(end).toHaveAttribute('data-crowded', 'true');
  });

  it('prints the times at the ends where no mark is in their place', async () => {
    await act(() => useCapture.getState().openFile(fileOfValue(COUNTED)));
    const { container } = render(<CaptureBar />);
    expect(COUNTED).not.toHaveProperty('events');
    expect(within(container).getByTestId('timeline-start')).not.toHaveAttribute('data-crowded');
    expect(within(container).getByTestId('timeline-end')).not.toHaveAttribute('data-crowded');
  });

  it('keeps its toggle’s icon and its time whole, in either language’s words', async () => {
    const { container } = await openBar(GOOGLE);
    const toggle = within(container).getByTestId('capture-toggle');
    // As wide as its word needs: a fixed width let "Reproduzir" push the icon out.
    expect(toggle).toHaveClass('min-w-[72px]');
    expect(toggle.className).not.toMatch(/(^|\s)w-\[72px\]/);
    expect(toggle.querySelector('svg')).not.toBeNull();
    // On a phone the date gives up its year, and the time stays whole.
    const time = within(container).getByTestId('capture-time');
    const short = within(time).getByTestId('capture-day-short');
    expect(short).toHaveClass('sm:hidden');
    expect(short).not.toHaveTextContent(/2025/);
    expect(short).toHaveTextContent(/12/);
    expect(time).toHaveTextContent(/2025/);
  });

  it('draws no samples past a level where the capture counts no errors', async () => {
    const { container } = await openBar(BOUTIQUE);
    expect(levelMarks(readCapture(boutique)!)).toHaveLength(0);
    expect(container.querySelectorAll('[data-mark^="level-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-mark^="event-"]')).toHaveLength(
      boutique.events.length,
    );
  });

  it('is not there while no capture is open', () => {
    render(<CaptureBar />);
    expect(screen.queryByTestId('timeline')).not.toBeInTheDocument();
  });
});

describe('the card of a service in a provider report', () => {
  it('says what the report states of it at the cursor, and where its kind comes from', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    act(() => useCapture.getState().select({ kind: 'node', id: 'dataflow' }));
    render(<CaptureCard />);
    const card = screen.getByTestId('capture-card');
    expect(card).toHaveAttribute('data-kind', 'node');
    expect(screen.getByTestId('capture-card-title')).toHaveTextContent('Cloud Dataflow');
    expect(screen.getByTestId('capture-type-source')).toHaveTextContent(
      'Kind assumed: the source does not say',
    );
    expect(screen.getByTestId('capture-card-state')).toHaveTextContent('Not stated at this time');
    // The file's note, as it wrote it.
    expect(screen.getByTestId('capture-note')).toHaveTextContent(
      'Listed among affected products; the report does not say when its impact began.',
    );
    expect(card).toHaveTextContent("From the provider's report, not simulated");
    expect(screen.getByTestId('capture-colour-note')).toHaveTextContent(
      /Reported impact is drawn as critical/,
    );
    // A report has no measurements, and the card does not pretend it has.
    expect(screen.queryByTestId('capture-figures')).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent(/fault/i);

    act(() => useCapture.getState().seek(Date.UTC(2025, 5, 12, 23, 20)));
    expect(screen.getByTestId('capture-card-state')).toHaveTextContent('Reported recovering');
  });

  it('lists the events that name the service, and one seeks to it', async () => {
    const user = userEvent.setup();
    await act(() => useCapture.getState().openBundled(GOOGLE));
    act(() => useCapture.getState().select({ kind: 'node', id: 'vertex' }));
    render(<CaptureCard />);
    const events = within(screen.getByTestId('capture-card-events')).getAllByRole('button');
    const naming = google.events.filter((event) => event.nodes?.includes('vertex'));
    expect(events).toHaveLength(naming.length);
    // Both clocks, on show: the UTC time of day and how far into the capture.
    for (const [i, event] of naming.entries()) {
      const row = events[i]!;
      expect(row).toHaveTextContent(`${utcTime(event.atMs)} UTC`);
      expect(row).toHaveTextContent(
        `${sinceCaptureStart(GOOGLE_CAPTURE, event.atMs)} into the capture`,
      );
      expect(row.querySelector('time')).toHaveAttribute('datetime', isoOf(event.atMs));
    }
    expect(events[0]).toHaveTextContent('23:13 UTC');
    expect(events[0]).toHaveTextContent('+5:28:00 into the capture');
    await user.click(events[0]!);
    expect(useCapture.getState().atMs).toBe(naming[0]!.atMs);
  });

  it('lets go of the selection, and moves to a connected service', async () => {
    const user = userEvent.setup();
    await act(() => useCapture.getState().openBundled(GOOGLE));
    act(() => useCapture.getState().select({ kind: 'node', id: 'serving' }));
    render(<CaptureCard />);
    await user.click(
      within(screen.getByTestId('capture-calls')).getByText('Service Control in Iowa'),
    );
    expect(useCapture.getState().selection).toEqual({ kind: 'node', id: 'control-iowa' });
    await user.click(screen.getByTestId('capture-card-close'));
    expect(useCapture.getState().selection).toBeNull();
  });
});

describe('the card of a service in a metrics capture', () => {
  it('shows each measure at the cursor against what it can be read against', async () => {
    await act(() => useCapture.getState().openFile(fileOfValue(COUNTED)));
    act(() => useCapture.getState().select({ kind: 'node', id: 'checkout' }));
    act(() => useCapture.getState().seek(START + PERIOD + 1));
    render(<CaptureCard />);
    expect(screen.getByTestId('capture-type-source')).toHaveTextContent(
      'Kind mapped from the resource type the source reported',
    );
    expect(screen.getByTestId('capture-card-state')).toHaveTextContent('Critical');
    expect(screen.getByTestId('capture-card')).toHaveTextContent('Captured, not simulated');

    const rate = screen.getByTestId('capture-figure-errorRate');
    expect(rate).toHaveTextContent('30.0%');
    expect(rate).toHaveTextContent('Normal below 4% (simulation threshold)');
    // Past the band, the rate takes the colour of its level.
    expect(within(rate).getByText('30.0%').style.color).toBe(COLOR.critical);

    const requests = screen.getByTestId('capture-figure-requests');
    expect(requests).toHaveTextContent('200');
    expect(requests).toHaveTextContent('in 1 min');
    expect(requests).toHaveTextContent(
      'No normal range: the source states none. Lowest–highest in this capture: 200–200.',
    );
    expect(within(requests).getByText('200').style.color).toBe('');
    expect(screen.getByTestId('capture-figure-p95Ms')).toHaveTextContent(
      'Lowest–highest in this capture: 120 ms–900 ms.',
    );
    // The figures' course over the capture, the cursor marked on each.
    expect(screen.getByRole('img', { name: 'Error rate over the capture' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Requests over the capture' }).querySelector('[data-cursor]'),
    ).not.toBeNull();
    expect(screen.getByTestId('capture-figures').parentElement).toHaveTextContent(
      "Errors are CloudWatch's “Fault” metric",
    );
  });

  it('pairs each figure’s name with what is said of it, in one list of terms', async () => {
    await act(() => useCapture.getState().openBundled(BOUTIQUE));
    act(() => useCapture.getState().select({ kind: 'node', id: 'checkoutservice' }));
    render(<CaptureCard />);
    const list = screen.getByTestId('capture-figures');
    expect(list.tagName).toBe('DL');
    const groups = [...list.children];
    expect(groups.length).toBe(5);
    for (const group of groups) {
      // A group of a list of terms: a div holding a term, then its descriptions.
      expect(group.tagName).toBe('DIV');
      const parts = [...group.children].map((child) => child.tagName);
      expect(parts[0]).toBe('DT');
      expect(parts.slice(1).length).toBeGreaterThan(0);
      expect(parts.slice(1).every((tag) => tag === 'DD')).toBe(true);
    }
    for (const term of list.querySelectorAll('dt, dd')) {
      expect(term.parentElement?.parentElement).toBe(list);
    }
  });

  it('says what was not measured, and never fills it in', async () => {
    await act(() => useCapture.getState().openFile(fileOfValue(COUNTED)));
    act(() => useCapture.getState().select({ kind: 'node', id: 'checkout' }));
    act(() => useCapture.getState().seek(START + 2 * PERIOD + 1));
    render(<CaptureCard />);
    expect(screen.getByTestId('capture-card-state')).toHaveTextContent('No data');
    expect(screen.getByTestId('capture-figure-requests')).toHaveTextContent('No data');
    expect(screen.getByTestId('capture-figure-errorRate')).toHaveTextContent('No data');
  });

  it('reads a capture without error counts as unknown, in its own words', async () => {
    await act(() => useCapture.getState().openBundled(BOUTIQUE));
    act(() => useCapture.getState().select({ kind: 'node', id: 'checkoutservice' }));
    render(<CaptureCard />);
    // A sample with its requests and no error count: the rate was not
    // measured, which is not the same as there being no data.
    const state = screen.getByTestId('capture-card-state');
    expect(state).toHaveTextContent('Error rate not measured');
    expect(state).not.toHaveTextContent('No data');
    expect(screen.getByTestId('capture-figure-requests')).toHaveTextContent('13');
    expect(screen.getByTestId('capture-figure-errors')).toHaveTextContent('Not measured');
    expect(screen.getByTestId('capture-figure-errorRate')).toHaveTextContent('Not measured');
    expect(screen.getByTestId('capture-figure-memoryBytes')).toHaveTextContent('MiB');
    expect(screen.getByTestId('capture-card')).not.toHaveTextContent(/fault/i);
    // It counted none, so it says nothing of how it counts them, nor of a
    // colour nothing in it can take.
    const card = screen.getByTestId('capture-card');
    expect(card).not.toHaveTextContent('Errors are as the source counted them');
    expect(card).not.toHaveTextContent(/Coloured by the error rates/);
    expect(screen.getByTestId('capture-colour-note')).toHaveTextContent(
      'This capture has no error counts, so no service in it is coloured.',
    );
  });

  it('says how the source counts errors where it counted some', async () => {
    await act(() => useCapture.getState().openFile(fileOfValue(COUNTED)));
    act(() => useCapture.getState().select({ kind: 'node', id: 'checkout' }));
    render(<CaptureCard />);
    expect(screen.getByTestId('capture-card')).toHaveTextContent(
      "Errors are CloudWatch's “Fault” metric",
    );
    expect(screen.getByTestId('capture-colour-note')).toHaveTextContent(
      'degraded (4%) or critical (20%)',
    );
  });

  it('never writes an error rate under a level as the level', async () => {
    await act(() =>
      useCapture.getState().openFile(
        fileOfValue({
          ...COUNTED,
          nodes: [
            {
              id: 'checkout',
              name: 'checkout',
              region: 'east',
              type: 'microservice',
              buckets: [{ atMs: START, requests: 100_000, faults: 3996 }],
            },
          ],
          edges: [],
        }),
      ),
    );
    act(() => useCapture.getState().select({ kind: 'node', id: 'checkout' }));
    render(<CaptureCard />);
    const rate = screen.getByTestId('capture-figure-errorRate');
    expect(rate).toHaveTextContent('<4.00%');
    expect(screen.getByTestId('capture-card-state')).not.toHaveTextContent('Degraded');
  });

  it('says of a service without connections that the capture has none, not that it calls nothing', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    act(() => useCapture.getState().select({ kind: 'node', id: 'iam' }));
    render(<CaptureCard />);
    const card = screen.getByTestId('capture-card');
    expect(card).not.toHaveTextContent('This service calls nothing.');
    expect(card).not.toHaveTextContent('Nothing calls this service.');
    expect(screen.getByTestId('capture-calls')).toHaveTextContent(
      'No connection from this service in the capture.',
    );
    expect(screen.getByTestId('capture-callers')).toHaveTextContent(
      'No connection to this service in the capture.',
    );
  });
});

describe('the card of a connection', () => {
  it('names both ends, its figures and when the source found it', async () => {
    const user = userEvent.setup();
    await act(() => useCapture.getState().openFile(fileOfValue(COUNTED)));
    act(() => useCapture.getState().select({ kind: 'edge', id: 'checkout->payments' }));
    render(<CaptureCard />);
    const card = screen.getByTestId('capture-card');
    expect(card).toHaveAttribute('data-kind', 'edge');
    expect(card).toHaveTextContent('checkout');
    expect(card).toHaveTextContent('payments');
    expect(screen.getByTestId('capture-discovered')).toHaveTextContent(/found its connections/);
    expect(screen.getByTestId('capture-figure-errors')).toHaveTextContent('Not measured');
    expect(screen.queryByTestId('capture-figure-memoryBytes')).not.toBeInTheDocument();
    await user.click(within(card).getByText('payments'));
    expect(useCapture.getState().selection).toEqual({ kind: 'node', id: 'payments' });
  });

  it('says a report states nothing about it', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    act(() => useCapture.getState().select({ kind: 'edge', id: 'serving->control' }));
    render(<CaptureCard />);
    expect(screen.getByTestId('capture-card-state')).toHaveTextContent('Not stated in the report');
  });

  it('keeps what it was given while it slides away', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    render(<CaptureCard selection={{ kind: 'node', id: 'iam' }} />);
    expect(screen.getByTestId('capture-card-title')).toHaveTextContent('Cloud IAM');
  });
});

describe('the details of a capture', () => {
  it('give its title and source as written, its window, counts and notes', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    render(<CaptureDetails />);
    const details = screen.getByTestId('capture-details');
    expect(screen.getByTestId('capture-details-title')).toHaveTextContent(google.title);
    const link = within(screen.getByTestId('capture-source')).getByRole('link');
    expect(link).toHaveAttribute('href', google.source.url);
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(link).toHaveTextContent(google.source.label);
    expect(details).toHaveTextContent(/From .*17:45.* to .*01:27.*, UTC/);
    expect(details).toHaveTextContent(String(google.nodes.length));
    expect(screen.getByTestId('capture-transcribed')).toHaveTextContent(
      /Transcribed by hand from the report/,
    );
    expect(details).toHaveTextContent(/the pieces rest because nothing was measured/);
    const notes = within(screen.getByTestId('capture-notes')).getAllByRole('listitem');
    expect(notes.map((note) => note.textContent)).toEqual(google.notes);
  });

  it('give a file’s name, and the levels a metrics capture is coloured by', async () => {
    const user = userEvent.setup();
    await act(() => useCapture.getState().openFile(fileOfValue(COUNTED)));
    act(() => useCapture.getState().setDetails(true));
    render(<CaptureDetails />);
    expect(screen.getByTestId('capture-file-name')).toHaveTextContent('checkout.json');
    expect(screen.getByTestId('capture-colour-note')).toHaveTextContent(
      'degraded (4%) or critical (20%)',
    );
    expect(screen.queryByTestId('capture-transcribed')).not.toBeInTheDocument();
    expect(screen.getByTestId('capture-details')).toHaveTextContent('Sampling period1 min');
    await user.click(screen.getByTestId('capture-details-close'));
    expect(useCapture.getState().detailsOpen).toBe(false);
  });
});

describe('the capture’s services', () => {
  it('lists every service by region with what the capture says of it at the cursor', async () => {
    await openList(GOOGLE);
    expect(screen.getByTestId('capture-list-sheet')).toBeInTheDocument();
    const services = screen.getByTestId('capture-services');
    for (const region of google.regions) {
      expect(within(services).getByRole('region', { name: region.name })).toBeInTheDocument();
    }
    expect(within(services).getAllByRole('button', { name: /./ }).length).toBeGreaterThanOrEqual(
      google.nodes.length,
    );
    // Before the report states anything, nothing is normal: it is not stated.
    const serving = screen.getByTestId('capture-service-serving');
    expect(serving).toHaveAttribute('data-condition', 'not-stated');
    expect(serving).toHaveTextContent('Not stated at this time');

    act(() => useCapture.getState().seek(Date.UTC(2025, 5, 12, 19, 35)));
    expect(serving).toHaveAttribute('data-condition', 'recovering');
    expect(screen.getByTestId('capture-service-control')).toHaveAttribute(
      'data-condition',
      'recovered',
    );
    // A recovered service carries no mark and no words on show: normal is
    // silent. Assistive technology is still told.
    const control = screen.getByTestId('capture-service-control');
    expect(control.querySelector('svg')).toBeNull();
    expect(within(control).getByText('Reported recovered')).toHaveClass('sr-only');
  });

  it('shows a service’s note as the capture wrote it', async () => {
    await openList(GOOGLE);
    expect(screen.getByTestId('capture-service-dataflow')).toHaveTextContent(
      'Listed among affected products; the report does not say when its impact began.',
    );
  });

  it('selects a service or a connection, and says a metrics capture’s unknown', async () => {
    const user = userEvent.setup();
    await openList(BOUTIQUE);
    const checkout = screen.getByTestId('capture-service-checkoutservice');
    expect(checkout).toHaveAttribute('data-condition', 'unknown');
    expect(checkout).toHaveTextContent('Error rate not measured');
    expect(checkout).not.toHaveTextContent('No data');
    await user.click(checkout);
    expect(useCapture.getState().selection).toEqual({ kind: 'node', id: 'checkoutservice' });
    expect(checkout).toHaveAttribute('aria-current', 'true');
    await user.click(screen.getByTestId('capture-connection-frontend->checkoutservice'));
    expect(useCapture.getState().selection).toEqual({
      kind: 'edge',
      id: 'frontend->checkoutservice',
    });
  });

  it('lists a great many connections only when they are asked for', async () => {
    const user = userEvent.setup();
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      name: `s${i}`,
      region: 'east',
      type: 'microservice',
      buckets: [{ atMs: START, requests: 10, faults: 0 }],
    }));
    const edges: { source: string; target: string; buckets: unknown[] }[] = [];
    for (const a of nodes) {
      for (const b of nodes) {
        if (a !== b && edges.length <= CONNECTIONS_LISTED) {
          edges.push({ source: a.id, target: b.id, buckets: [{ atMs: START, requests: 1 }] });
        }
      }
    }
    await act(() => useCapture.getState().openFile(fileOfValue({ ...COUNTED, nodes, edges })));
    act(() => useCapture.getState().setList(true, 'services'));
    render(<CaptureList />);
    expect(screen.queryByTestId('capture-connections')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show the connections' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Hide the connections');
    const rows = within(screen.getByTestId('capture-connections')).getAllByRole('button');
    expect(rows).toHaveLength(CONNECTIONS_LISTED + 1);
  });

  it('points at a service on the model while it is pointed at in the list', async () => {
    const user = userEvent.setup();
    await openList(GOOGLE);
    await user.hover(screen.getByTestId('capture-service-iam'));
    expect(useCapture.getState().hovered).toBe('iam');
    await user.unhover(screen.getByTestId('capture-service-iam'));
    expect(useCapture.getState().hovered).toBeNull();
  });
});

describe('the capture’s events', () => {
  it('lists them in time order with both clocks, dimming those still to come', async () => {
    await openList(GOOGLE, 'events');
    const rows = screen.getAllByTestId('capture-event');
    expect(rows).toHaveLength(google.events.length);
    expect(rows[1]).toHaveTextContent('Service Control starts failing');
    expect(rows[1]).toHaveTextContent('17:49 UTC');
    expect(rows[1]).toHaveTextContent('+4:00 into the capture');
    expect(rows[1]).toHaveAttribute('data-state', 'affected');
    // At the window's start only the first event has happened.
    expect(rows[0]).toHaveAttribute('aria-current', 'time');
    expect(rows[0]!.className).not.toMatch(/opacity-45/);
    expect(rows[1]!.className).toMatch(/opacity-45/);
  });

  it('seeks to an event, and selects the one service it names', async () => {
    const user = userEvent.setup();
    await openList(GOOGLE, 'events');
    const rows = screen.getAllByTestId('capture-event');
    const iowa = google.events.findIndex(
      (event) => event.title === 'Policy store overloaded in Iowa',
    );
    await user.click(rows[iowa]!);
    expect(useCapture.getState().atMs).toBe(google.events[iowa]!.atMs);
    expect(useCapture.getState().selection).toEqual({ kind: 'node', id: 'policy-iowa' });
    expect(rows[iowa]).toHaveAttribute('aria-current', 'time');
    // An event that names several services leaves the selection alone.
    await user.click(rows[1]!);
    expect(useCapture.getState().selection).toEqual({ kind: 'node', id: 'policy-iowa' });
  });

  it('switches tabs and is put away', async () => {
    const user = userEvent.setup();
    await openList(GOOGLE);
    await user.click(screen.getByTestId('capture-tab-events'));
    expect(useCapture.getState().listTab).toBe('events');
    await user.click(screen.getByTestId('capture-list-close'));
    expect(useCapture.getState().listOpen).toBe(false);
  });
});

describe('the capture as a table', () => {
  it('has a table per region, and no columns of measurements for a report', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    render(<CaptureTable />);
    expect(screen.getByTestId('capture-table')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(google.regions.length);
    const global = screen.getByTestId('capture-table-region-global');
    expect(
      within(global)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Service', 'Kind', 'State']);
    expect(screen.getByTestId('capture-table-state-iam')).toHaveTextContent(
      'Not stated at this time',
    );
    act(() => useCapture.getState().seek(Date.UTC(2025, 5, 12, 17, 50)));
    expect(screen.getByTestId('capture-table-state-iam')).toHaveTextContent('Reported affected');
  });

  it('gives a metrics capture its figures at the cursor, saying what was not measured', async () => {
    await act(() => useCapture.getState().openBundled(BOUTIQUE));
    render(<CaptureTable />);
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Service', 'Kind', 'State', 'Requests', 'Error rate', 'Latency p95']);
    expect(within(table).getAllByRole('row')).toHaveLength(boutique.nodes.length + 1);
    const row = screen.getByTestId('capture-table-service-checkoutservice').closest('tr')!;
    expect(screen.getByTestId('capture-table-state-checkoutservice')).toHaveTextContent(
      'Error rate not measured',
    );
    expect(row).not.toHaveTextContent('No data');
    expect(row).toHaveTextContent('/s');
    expect(row).toHaveTextContent('Not measured');
  });

  it('selects a service from its row, and marks it without a hue', async () => {
    const user = userEvent.setup();
    await act(() => useCapture.getState().openBundled(BOUTIQUE));
    render(<CaptureTable notice="The 3D view is unavailable." />);
    expect(screen.getByRole('status')).toHaveTextContent('The 3D view is unavailable.');
    await user.click(screen.getByTestId('capture-table-service-redis'));
    expect(useCapture.getState().selection).toEqual({ kind: 'node', id: 'redis' });
    const row = screen.getByTestId('capture-table-service-redis').closest('tr')!;
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row.className).toMatch(/bg-raised/);
    expect(row.className).not.toMatch(/focus/);
  });
});

describe('the card over a pointed-at piece', () => {
  it('names the service, its kind and region, and its state in words', async () => {
    await act(() => useCapture.getState().openBundled(GOOGLE));
    const { rerender } = render(<CaptureHover />);
    expect(screen.queryByTestId('capture-hover')).not.toBeInTheDocument();
    act(() => useCapture.getState().hover('policy-iowa'));
    rerender(<CaptureHover />);
    const card = screen.getByTestId('capture-hover');
    expect(card).toHaveTextContent('Spanner policy store in Iowa');
    expect(card).toHaveTextContent('Database in Iowa · us-central1');
    expect(card).toHaveTextContent('Not stated at this time');
    act(() => useCapture.getState().seek(Date.UTC(2025, 5, 12, 18, 30)));
    expect(screen.getByTestId('capture-hover')).toHaveTextContent('Reported affected');
  });

  it('says of a measured service without an error count that its rate was not measured', async () => {
    await act(() => useCapture.getState().openBundled(BOUTIQUE));
    act(() => useCapture.getState().hover('checkoutservice'));
    render(<CaptureHover />);
    const card = screen.getByTestId('capture-hover');
    expect(card).toHaveTextContent('Error rate not measured');
    expect(card).not.toHaveTextContent('No data');
  });
});

describe('opening a capture', () => {
  it('lists the bundled captures by title, source and window, as their files state them', () => {
    render(<CaptureDialog open onOpenChange={() => {}} />);
    const list = screen.getByTestId('capture-bundled');
    const entries = within(list).getAllByRole('button');
    expect(entries).toHaveLength(BUNDLED.length);
    const first = screen.getByTestId(`capture-open-${BUNDLED[0]!.id}`);
    expect(first).toHaveTextContent(google.title);
    expect(first).toHaveTextContent(google.source.label);
    expect(first).toHaveTextContent(/From .*17:45.* to .*01:27.*, UTC/);
  });

  it('opens one through the address, and closes on it', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CaptureDialog open onOpenChange={onOpenChange} />);
    await user.click(screen.getByTestId('capture-open-google-cloud-2025-06-12'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(useCapture.getState().id).toBe('google-cloud-2025-06-12');
    // Opened from the interface, it is named in the address and Back leaves it.
    expect(window.location.search).toBe('?capture=google-cloud-2025-06-12');
    expect((window.history.state as Record<string, unknown>).aegisCapture).toBe(
      'google-cloud-2025-06-12',
    );
  });

  it('reads a file in the tab, and says why one does not open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CaptureDialog open onOpenChange={onOpenChange} />);
    const input = screen.getByTestId('capture-file');
    await user.upload(input, fileNamed('{"kind": "aegis-cloud-replay"}', 'old.json'));
    expect(await screen.findByTestId('capture-problem')).toHaveTextContent(
      'The file is not an incident capture this version can read.',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(useCapture.getState().capture).toBeNull();

    await user.upload(input, fileNamed(JSON.stringify(google), 'outage.json'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(useCapture.getState().fileName).toBe('outage.json');
    expect(useCapture.getState().id).toBeNull();
  });

  it('forgets an old failure when it is opened again', () => {
    act(() => useCapture.setState({ error: 'The file is larger than 12 MiB.' }));
    render(<CaptureDialog open onOpenChange={() => {}} />);
    expect(screen.queryByTestId('capture-problem')).not.toBeInTheDocument();
  });
});

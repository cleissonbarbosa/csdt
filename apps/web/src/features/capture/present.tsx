/**
 * What the parts of an incident capture share: the glyphs its states are
 * drawn with, how its moments are written (in UTC, and from the capture's
 * start), what its services are called, the words that say how it is
 * coloured, and the moment the cursor's readings belong to.
 *
 * None of it decides what a capture says; `capture.ts` does. This is how it
 * is put on screen.
 */
import { HealthGlyph } from '@/components/ui/Badge';
import { language, t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import { CAPTURE_STATE_COLOR, CAPTURE_STATE_GLYPH, captureStateLabel, COLOR } from '@/lib/palette';
import { ERROR_CRITICAL, ERROR_DEGRADED } from '@/lib/thresholds';
import { useCapture } from '@/stores/capture';

import {
  changesOf,
  errorsInCapture,
  isReport,
  stepAt,
  type Capture,
  type Condition,
  type Reading,
  type ReportedState,
} from './capture';

// ---------------------------------------------------------------------------
// The moment
// ---------------------------------------------------------------------------

/**
 * The moment whose readings are those at `atMs`: the last change at or
 * before it (`changesOf`), or the window's start before the first. Between
 * two changes everything a capture says is the same, so a part that reads
 * the capture at this moment shows what it says at the cursor, and changes
 * only when that does.
 */
export function momentAt(capture: Capture, atMs: number): number {
  const step = stepAt(capture, atMs);
  return step > 0 ? changesOf(capture)[step - 1]! : capture.window.startMs;
}

/**
 * The moment the open capture's readings belong to (`momentAt`). A part
 * that reads it is drawn again when what it shows changes, not at every
 * tick of the clock. 0 while nothing is open.
 */
export function useMoment(): number {
  return useCapture((state) => (state.capture ? momentAt(state.capture, state.atMs) : 0));
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const DAY = new Intl.DateTimeFormat(language, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const DAY_SHORT = new Intl.DateTimeFormat(language, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const MINUTE = new Intl.DateTimeFormat(language, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});
const SECOND = new Intl.DateTimeFormat(language, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});
const DAY_AND_MINUTE = new Intl.DateTimeFormat(language, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** The date of a moment, in UTC, in the page's language. */
export const utcDay = (ms: number): string => DAY.format(ms);

/** The day and month of a moment, in UTC, without the year: where there is no room for it. */
export const utcDayShort = (ms: number): string => DAY_SHORT.format(ms);

/** The time of day of a moment, in UTC: with its seconds when it has any, or when asked. */
export const utcTime = (ms: number, seconds = ms % 60_000 !== 0): string =>
  (seconds ? SECOND : MINUTE).format(ms);

/** The date and the time of a moment, in UTC, in one. */
export const utcMoment = (ms: number): string => DAY_AND_MINUTE.format(ms);

/** A moment as a machine reads it, for `<time dateTime>`. */
export const isoOf = (ms: number): string => new Date(ms).toISOString();

/** How far into the capture a moment is: `+5:00`, counted from the start of its window. */
export function sinceCaptureStart(capture: Capture, ms: number): string {
  return `+${formatClock(ms - capture.window.startMs)}`;
}

/** A stretch of time, from one moment to another, in UTC. */
export function utcSpan(window: { startMs: number; endMs: number }): string {
  return t('From {start} to {end}, UTC', {
    start: utcMoment(window.startMs),
    end: utcMoment(window.endMs),
  });
}

/** How long a sampling period is: `30 s`, `5 min`, `1 h`. */
export function formatPeriod(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60 || seconds % 60 !== 0) return `${seconds} s`;
  const minutes = seconds / 60;
  if (minutes < 60 || minutes % 60 !== 0) return `${minutes} min`;
  return `${minutes / 60} h`;
}

/** A size in bytes, in binary units. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '–';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 || value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

const PERCENT = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });

/** One of the simulation's error levels, as a sentence names it: `4%`. */
export const levelPercent = (rate: number): string => PERCENT.format(rate);

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const NAMES = new WeakMap<Capture, Map<string, string>>();

/**
 * What to call each service where its place is not on show: its name, and
 * its region's after it when another service of the capture has the same
 * name. A name that is unique is left alone.
 */
export function captureNames(capture: Capture): Map<string, string> {
  const known = NAMES.get(capture);
  if (known) return known;
  const regions = new Map(capture.regions.map((region) => [region.id, region.name]));
  const uses = new Map<string, number>();
  for (const node of capture.nodes) uses.set(node.name, (uses.get(node.name) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const node of capture.nodes) {
    const repeated = (uses.get(node.name) ?? 0) > 1;
    names.set(
      node.id,
      repeated ? `${node.name}, ${regions.get(node.region) ?? node.region}` : node.name,
    );
  }
  NAMES.set(capture, names);
  return names;
}

/** A service's name where its place is not on show, or the id when the capture has none. */
export const nameOf = (capture: Capture, id: string): string => captureNames(capture).get(id) ?? id;

/** A region's name, as the capture wrote it. */
export function regionName(capture: Capture, id: string): string {
  return capture.regions.find((region) => region.id === id)?.name ?? id;
}

// ---------------------------------------------------------------------------
// How it is coloured
// ---------------------------------------------------------------------------

/**
 * How a capture's colours are to be read, in the words of its card and its
 * details. The levels are the simulation's (`lib/thresholds.ts`), never
 * written into the phrase. A capture that counts no errors anywhere has
 * nothing that can take a colour, and says so instead.
 */
export function colourNote(capture: Capture): string {
  if (isReport(capture)) {
    return t(
      'Reported impact is drawn as critical and a reported recovery as degraded; the report does not grade how severe the impact was.',
    );
  }
  if (!errorsInCapture(capture)) {
    return t('This capture has no error counts, so no service in it is coloured.');
  }
  return t(
    "Coloured by the error rates at which the simulation calls a service degraded ({degraded}) or critical ({critical}), applied to each sample as measured, without the simulation's smoothing or delay. The source sets no threshold.",
    { degraded: levelPercent(ERROR_DEGRADED), critical: levelPercent(ERROR_CRITICAL) },
  );
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

/**
 * A state that is not given: an open ring broken into dashes, without hue,
 * as the scene draws it under the piece and as the help's legend shows it.
 */
export function UnknownGlyph({ size = 9 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      aria-hidden
      className="shrink-0"
      data-glyph="unknown"
    >
      <circle
        cx="5"
        cy="5"
        r="3.9"
        fill="none"
        stroke={COLOR.inkFaint}
        strokeWidth="1.4"
        pathLength={20}
        strokeDasharray="1.5 1"
      />
    </svg>
  );
}

/**
 * The shape of what a capture says of a service: the health glyph of the
 * level it is drawn as, the dashed ring when the state is not given, and
 * nothing when it is normal.
 */
export function ConditionGlyph({ condition, size = 9 }: { condition: Condition; size?: number }) {
  const glyph = CAPTURE_STATE_GLYPH[condition];
  if (glyph === 'unknown') return <UnknownGlyph size={size} />;
  if (glyph === 'healthy') return null;
  return <HealthGlyph health={glyph} size={size} />;
}

/** Whether a condition is past normal: the only kind that takes a colour. */
export const isLoud = (condition: Condition): boolean => {
  const glyph = CAPTURE_STATE_GLYPH[condition];
  return glyph !== 'unknown' && glyph !== 'healthy';
};

/** Whether the source has a sample of a service or a connection at the moment read. */
export const sampledIn = (reading: Reading): boolean => reading.sample !== undefined;

/**
 * A condition spelled out: its glyph and its words, in its colour only when
 * it is past normal. `sampled` says whether the source has a sample at that
 * moment, which is what tells an error rate not measured from no data.
 */
export function ConditionBadge({
  condition,
  sampled = false,
  className,
}: {
  condition: Condition;
  sampled?: boolean;
  className?: string;
}) {
  const loud = isLoud(condition);
  const given = CAPTURE_STATE_GLYPH[condition] !== 'unknown';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-[11px]', className)}
      style={loud ? { color: CAPTURE_STATE_COLOR[condition] } : undefined}
      data-condition={condition}
    >
      <ConditionGlyph condition={condition} />
      <span className={loud ? 'font-bold' : given ? 'text-ink-dim' : 'text-ink-faint'}>
        {captureStateLabel(condition, sampled)}
      </span>
    </span>
  );
}

/**
 * A condition in a dense list: the glyph alone (none when normal), its words
 * for assistive technology. A row that says the condition after the name it
 * belongs to passes `announce={false}`, so the name is read first.
 */
export function ConditionMark({
  condition,
  sampled = false,
  announce = true,
}: {
  condition: Condition;
  sampled?: boolean;
  announce?: boolean;
}) {
  const glyph = CAPTURE_STATE_GLYPH[condition];
  const label = captureStateLabel(condition, sampled);
  return (
    <span
      className="inline-flex w-[9px] shrink-0 items-center justify-center"
      title={glyph === 'healthy' ? undefined : label}
      data-condition={condition}
    >
      <ConditionGlyph condition={condition} />
      {announce && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** The shape of an event by what it states: impact, recovery under way, recovery, or no state at all. */
export function EventGlyph({
  state,
  size = 8,
}: {
  state: ReportedState | undefined;
  size?: number;
}) {
  if (state === 'affected') return <HealthGlyph health="critical" size={size} />;
  if (state === 'recovering') return <HealthGlyph health="degraded" size={size} />;
  if (state === 'recovered') {
    return (
      <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden className="shrink-0">
        <circle cx="5" cy="5" r="3.6" fill={COLOR.inkDim} />
      </svg>
    );
  }
  return null;
}

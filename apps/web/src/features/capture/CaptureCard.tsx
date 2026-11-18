import { ArrowRight, Crosshair, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/ui/Button';
import { Fold, Section } from '@/components/ui/Section';
import { Sparkline } from '@/components/ui/Sparkline';
import type { SceneSelection } from '@/graphics/SceneController';
import { sceneHandle } from '@/graphics/handle';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatCount, formatMs, formatRate } from '@/lib/format';
import {
  CAPTURE_STATE_COLOR,
  RELATIONSHIP_LABEL,
  SERVICE_TYPE,
  TYPE_SOURCE_HINT,
} from '@/lib/palette';
import { ERROR_DEGRADED, formatErrorRate } from '@/lib/thresholds';
import { useCapture } from '@/stores/capture';

import {
  connectionId,
  errorsInCapture,
  isReport,
  rangeOf,
  readingOf,
  seriesOf,
  typeSourceOf,
  type Capture,
  type CaptureEdge,
  type CaptureNode,
  type Measure,
  type Reading,
  type SourceKind,
} from './capture';
import {
  colourNote,
  ConditionBadge,
  ConditionMark,
  EventGlyph,
  formatBytes,
  formatPeriod,
  isoOf,
  levelPercent,
  nameOf,
  regionName,
  sampledIn,
  sinceCaptureStart,
  useMoment,
  utcMoment,
  utcTime,
} from './present';

/** What a capture of each kind counts as an error, as the format defines it. */
const ERRORS_HINT: Record<SourceKind, string | null> = {
  cloudwatch: t(
    "Errors are CloudWatch's “Fault” metric; requests are the sample count of its “Latency”.",
  ),
  'tempo-prometheus': t("Errors are the Tempo service graph's failed-request counter."),
  'prometheus-recording': t('Errors are as the source counted them; its notes say which measure.'),
  'provider-report': null,
};

/** Where the figures on a card come from, said as a whole phrase. */
export function provenanceOf(capture: Capture): string {
  return isReport(capture)
    ? t("From the provider's report, not simulated")
    : t('Captured, not simulated');
}

/** The way out of a card, and the way to look at what it is about. */
function CardActions({ focus }: { focus?: string }) {
  return (
    <div className="flex shrink-0 gap-0.5">
      {focus !== undefined && (
        <IconButton
          label={t('Focus camera on this service')}
          onClick={() => sceneHandle.current?.focusNode(focus)}
        >
          <Crosshair size={15} />
        </IconButton>
      )}
      <IconButton
        label={t('Clear selection')}
        onClick={() => useCapture.getState().select(null)}
        data-testid="capture-card-close"
      >
        <X size={15} />
      </IconButton>
    </div>
  );
}

interface FigureSpec {
  measure: Measure;
  label: string;
  /** The value in the sample at the cursor, written out; null when the sample does not hold it. */
  value: string | null;
  unit?: string;
  /** Words for a value that is not there. */
  missing: string;
  format: (value: number) => string;
}

/**
 * One measure: its value at the cursor, its course over the whole capture
 * (broken where it is not known, the cursor marked on it), and what it is
 * to be read against. Only the error rate has a range to be read against,
 * the simulation's degraded level, and only it takes a colour, outside it.
 * The others have none: the source states no normal, and the lowest and
 * highest in the capture include the incident, so they are said as such.
 */
function Figure({
  capture,
  item,
  spec,
  reading,
  moment,
}: {
  capture: Capture;
  item: CaptureNode | CaptureEdge;
  spec: FigureSpec;
  reading: Reading;
  moment: number;
}) {
  const series = seriesOf(capture, item.buckets, spec.measure);
  const range = rangeOf(series.values);
  const rate = spec.measure === 'errorRate';
  const tone =
    rate && reading.level !== null && reading.level > 0
      ? CAPTURE_STATE_COLOR[reading.condition]
      : undefined;
  let caption: string;
  if (rate) {
    caption = t('Normal below {degraded} (simulation threshold)', {
      degraded: levelPercent(ERROR_DEGRADED),
    });
  } else if (range) {
    caption = t(
      'No normal range: the source states none. Lowest–highest in this capture: {low}–{high}.',
      { low: spec.format(range.low), high: spec.format(range.high) },
    );
  } else {
    caption = t('Not measured in this capture.');
  }
  const missing = spec.value === null;
  // One group of the list of figures: the term, then what is said of it (the
  // value, its course and what it is read against), each a `dd` of its own.
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3"
      data-testid={`capture-figure-${spec.measure}`}
    >
      <dt className="caption col-start-1 row-start-1 truncate">{spec.label}</dt>
      <dd
        className={cn(
          'numeric col-start-1 row-start-2 mt-0.5 truncate text-sm',
          missing ? 'text-ink-faint' : 'text-ink',
        )}
        style={!missing && tone ? { color: tone } : undefined}
      >
        {spec.value ?? spec.missing}
        {!missing && spec.unit && (
          <span className="ml-1 text-[11px] text-ink-faint">{spec.unit}</span>
        )}
      </dd>
      <dd className="col-start-2 row-span-2 row-start-1 self-end">
        <Sparkline
          values={series.values}
          at={series.atMs}
          span={[capture.window.startMs, capture.window.endMs]}
          gaps
          cursor={moment}
          color={tone}
          normal={rate ? [0, ERROR_DEGRADED] : undefined}
          max={rate ? Math.max(0.1, (range?.high ?? 0) * 1.15) : undefined}
          label={t('{measure} over the capture', { measure: spec.label })}
          width={150}
        />
      </dd>
      <dd className="caption col-span-2 mt-1 leading-snug">{caption}</dd>
    </div>
  );
}

/** The measures of a service or a connection in a metrics capture. */
function Figures({
  capture,
  item,
  reading,
  moment,
  memory,
}: {
  capture: Capture;
  item: CaptureNode | CaptureEdge;
  reading: Reading;
  moment: number;
  /** Whether peak memory is among them (a service's, not a connection's). */
  memory: boolean;
}) {
  const sample = reading.sample;
  const missing = sample ? t('Not measured') : t('No data');
  const specs: FigureSpec[] = [
    {
      measure: 'requests',
      label: t('Requests'),
      value: sample?.requests === undefined ? null : formatCount(sample.requests),
      unit: capture.periodMs
        ? t('in {period}', { period: formatPeriod(capture.periodMs) })
        : undefined,
      missing,
      format: formatCount,
    },
    {
      measure: 'errors',
      label: t('Errors'),
      value: sample?.faults === undefined ? null : formatCount(sample.faults),
      missing,
      format: formatCount,
    },
    {
      measure: 'errorRate',
      label: t('Error rate'),
      // Never rounded up to a level it is under (`formatErrorRate`).
      value: reading.errorRate === null ? null : formatErrorRate(reading.errorRate),
      // Nothing passed: there was no rate to take.
      missing: sample?.requests === 0 ? t('No requests') : missing,
      format: formatErrorRate,
    },
    {
      measure: 'p95Ms',
      label: t('Latency p95'),
      value: sample?.p95Ms === undefined ? null : formatMs(sample.p95Ms),
      missing,
      format: formatMs,
    },
  ];
  if (memory) {
    specs.push({
      measure: 'memoryBytes',
      label: t('Peak memory'),
      value: sample?.memoryBytes === undefined ? null : formatBytes(sample.memoryBytes),
      missing,
      format: formatBytes,
    });
  }
  // What the source counts as an error, said only where it counted some.
  const hint = errorsInCapture(capture) ? ERRORS_HINT[capture.source.kind] : null;
  return (
    <Section
      title={t('Measurements')}
      aside={
        <span className="caption numeric">
          {sample
            ? t('Sample from {time} UTC', { time: utcTime(sample.atMs) })
            : t('No sample at this time')}
        </span>
      }
    >
      <dl className="space-y-3" data-testid="capture-figures">
        {specs.map((spec) => (
          <Figure
            key={spec.measure}
            capture={capture}
            item={item}
            spec={spec}
            reading={reading}
            moment={moment}
          />
        ))}
      </dl>
      {hint && <p className="caption mt-3 leading-snug">{hint}</p>}
      <p className="caption mt-1.5 leading-snug" data-testid="capture-colour-note">
        {colourNote(capture)}
      </p>
    </Section>
  );
}

/**
 * Events that name a service, oldest first; one seeks the cursor to it. Each
 * shows both clocks, as the capture's list of events does: the UTC time of
 * day and how far into the capture it is.
 */
function Statements({ capture, id, moment }: { capture: Capture; id: string; moment: number }) {
  const events = capture.events.filter((event) => event.nodes.includes(id));
  if (events.length === 0) return null;
  const shown = events.slice(0, 20);
  return (
    <Fold title={t('Events')} count={events.length} open={events.length <= 6}>
      <ol className="-mx-1.5" data-testid="capture-card-events">
        {shown.map((event, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => useCapture.getState().seek(event.atMs)}
              className={cn(
                'grid w-full grid-cols-[0.75rem_1fr_auto] items-baseline gap-x-1.5 rounded-control px-1.5 py-1 text-left hover:bg-raised',
                event.atMs > moment && 'opacity-45',
              )}
            >
              <span className="self-center">
                <EventGlyph state={event.state} />
              </span>
              <span className="min-w-0 truncate text-xs text-ink">{event.title}</span>
              <time className="numeric text-[11px] text-ink-faint" dateTime={isoOf(event.atMs)}>
                {t('{time} UTC', { time: utcTime(event.atMs) })}
              </time>
              <span className="caption numeric col-span-2 col-start-2">
                {t('{offset} into the capture', {
                  offset: sinceCaptureStart(capture, event.atMs),
                })}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {events.length > shown.length && (
        <p className="caption mt-1">{t('and {n} more', { n: events.length - shown.length })}</p>
      )}
    </Fold>
  );
}

/**
 * What a service calls, or what calls it, in the capture. Where the capture
 * has no connection it says so of the capture, not of the service: a report's
 * connections are AEGIS's reading of its text, and a measured capture's are
 * what its source found in a window of its own.
 */
function Connections({
  capture,
  node,
  moment,
  outgoing,
}: {
  capture: Capture;
  node: CaptureNode;
  moment: number;
  outgoing: boolean;
}) {
  const edges = capture.edges.filter((edge) =>
    outgoing ? edge.source === node.id : edge.target === node.id,
  );
  const report = isReport(capture);
  return (
    <Fold
      title={outgoing ? t('Calls') : t('Called by')}
      count={edges.length}
      open={edges.length <= 3}
      testId={outgoing ? 'capture-calls' : 'capture-callers'}
    >
      {edges.length === 0 ? (
        <p className="text-xs text-ink-faint">
          {outgoing
            ? t('No connection from this service in the capture.')
            : t('No connection to this service in the capture.')}
        </p>
      ) : (
        <ul className="-mx-1.5">
          {edges.map((edge) => {
            const peer = outgoing ? edge.target : edge.source;
            const reading = readingOf(capture, edge, moment);
            return (
              <li key={connectionId(edge)} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => useCapture.getState().select({ kind: 'node', id: peer })}
                  onMouseEnter={() => useCapture.getState().hover(peer)}
                  onMouseLeave={() => useCapture.getState().hover(null)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 rounded-control px-1.5 py-1 text-left hover:bg-raised"
                >
                  {/* A report states nothing about a connection. */}
                  {!report && (
                    <ConditionMark condition={reading.condition} sampled={sampledIn(reading)} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">
                    {nameOf(capture, peer)}
                  </span>
                  {reading.requestsPerSecond !== null && (
                    <span className="numeric shrink-0 text-[11px] text-ink-faint">
                      {formatRate(reading.requestsPerSecond)}/s
                    </span>
                  )}
                </button>
                <IconButton
                  label={t('Inspect connection to {service}', {
                    service: nameOf(capture, peer),
                  })}
                  size="sm"
                  onClick={() =>
                    useCapture.getState().select({ kind: 'edge', id: connectionId(edge) })
                  }
                >
                  <ArrowRight size={13} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </Fold>
  );
}

function NodeCard({
  capture,
  node,
  moment,
}: {
  capture: Capture;
  node: CaptureNode;
  moment: number;
}) {
  const reading = readingOf(capture, node, moment);
  const report = isReport(capture);
  return (
    <div className="cascade" data-testid="capture-card" data-kind="node" data-id={node.id}>
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-ink" data-testid="capture-card-title">
              {node.name}
            </h2>
            <p className="caption mt-0.5 truncate">
              {t('{kind} in {region}', {
                kind: SERVICE_TYPE[node.type].label,
                region: regionName(capture, node.region),
              })}
            </p>
            <p className="caption mt-0.5" data-testid="capture-type-source">
              {TYPE_SOURCE_HINT[typeSourceOf(node)]}
            </p>
          </div>
          <CardActions focus={node.id} />
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-testid="capture-card-state">
            <ConditionBadge condition={reading.condition} sampled={sampledIn(reading)} />
          </span>
          <span className="caption">{provenanceOf(capture)}</span>
          <span className="code caption truncate">{node.id}</span>
        </p>
        {node.note && (
          <p className="mt-2 text-xs leading-relaxed text-ink-dim" data-testid="capture-note">
            {node.note}
          </p>
        )}
      </header>

      {report ? (
        <Section title={t('How to read it')}>
          <p className="caption leading-snug" data-testid="capture-colour-note">
            {colourNote(capture)}
          </p>
        </Section>
      ) : (
        <Figures capture={capture} item={node} reading={reading} moment={moment} memory />
      )}
      <Statements capture={capture} id={node.id} moment={moment} />
      <Connections capture={capture} node={node} moment={moment} outgoing />
      <Connections capture={capture} node={node} moment={moment} outgoing={false} />
    </div>
  );
}

function EdgeCard({
  capture,
  edge,
  moment,
}: {
  capture: Capture;
  edge: CaptureEdge;
  moment: number;
}) {
  const reading = readingOf(capture, edge, moment);
  const report = isReport(capture);
  const memory = edge.buckets.some((point) => point.memoryBytes !== undefined);
  const endpoint = (label: string, id: string): ReactNode => (
    <button
      type="button"
      onClick={() => useCapture.getState().select({ kind: 'node', id })}
      className="min-w-0 flex-1 rounded-control border border-line px-2 py-1.5 text-left hover:border-line-strong hover:bg-raised"
    >
      <span className="caption block">{label}</span>
      <span className="block truncate text-xs text-ink">{nameOf(capture, id)}</span>
    </button>
  );
  const discovered = capture.topologyWindow;
  return (
    <div
      className="cascade"
      data-testid="capture-card"
      data-kind="edge"
      data-id={connectionId(edge)}
    >
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink" data-testid="capture-card-title">
              {RELATIONSHIP_LABEL.call}
            </h2>
            <p className="caption mt-0.5">{provenanceOf(capture)}</p>
          </div>
          <CardActions />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {endpoint(t('From'), edge.source)}
          <ArrowRight size={14} aria-hidden className="shrink-0 text-ink-faint" />
          {endpoint(t('To'), edge.target)}
        </div>
        <p className="mt-2 text-[11px]" data-testid="capture-card-state">
          {report ? (
            <span className="text-ink-faint">{t('Not stated in the report')}</span>
          ) : (
            <ConditionBadge condition={reading.condition} sampled={sampledIn(reading)} />
          )}
        </p>
        {discovered && (
          <p className="caption mt-2 leading-snug" data-testid="capture-discovered">
            {t(
              'The source found its connections from {start} to {end}, UTC: one that was found may not have carried requests at every moment.',
              { start: utcMoment(discovered.startMs), end: utcMoment(discovered.endMs) },
            )}
          </p>
        )}
      </header>
      {report ? (
        <Section title={t('How to read it')}>
          <p className="caption leading-snug">
            {t(
              "The report states no condition for a connection: this one is part of AEGIS's reading of its text.",
            )}
          </p>
        </Section>
      ) : (
        <Figures capture={capture} item={edge} reading={reading} moment={moment} memory={memory} />
      )}
    </div>
  );
}

/**
 * The card of what is selected in an incident capture: a service or a
 * connection, what the capture says of it at the cursor and, for a metrics
 * capture, how each measure ran over the whole capture. It comes with a
 * selection and leaves with it. Nothing on it belongs to the simulation: no
 * faults to place, no exposure, no Cedar.
 *
 * `selection` keeps a card on screen while it slides away after the
 * selection was let go of; without it, the card shows the capture's own.
 */
export function CaptureCard({ selection: shown }: { selection?: SceneSelection }) {
  const capture = useCapture((state) => state.capture);
  const current = useCapture((state) => state.selection);
  const moment = useMoment();
  const selection = shown === undefined ? current : shown;
  if (!capture || !selection) return null;
  if (selection.kind === 'node') {
    const node = capture.nodes.find((n) => n.id === selection.id);
    return node ? <NodeCard capture={capture} node={node} moment={moment} /> : null;
  }
  const edge = capture.edges.find((e) => connectionId(e) === selection.id);
  return edge ? <EdgeCard capture={capture} edge={edge} moment={moment} /> : null;
}

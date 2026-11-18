import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { useId, useState } from 'react';

import { IconButton } from '@/components/ui/Button';
import { TabMarker, tabClass } from '@/components/ui/TabMarker';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatRate } from '@/lib/format';
import {
  CAPTURE_STATE_COLOR,
  CAPTURE_STATE_LABEL,
  captureStateLabel,
  SERVICE_TYPE,
} from '@/lib/palette';
import { selectEventCount, useCapture, type ListTab } from '@/stores/capture';

import {
  connectionId,
  edgeReadings,
  isReport,
  nodeReadings,
  type Capture,
  type CaptureEvent,
} from './capture';
import {
  ConditionMark,
  EventGlyph,
  isLoud,
  isoOf,
  nameOf,
  sampledIn,
  sinceCaptureStart,
  useMoment,
  utcTime,
} from './present';

const rowClass = (selected: boolean) =>
  cn(
    'flex min-h-7 w-full items-center gap-2 border-l-2 py-1 pl-2.5 pr-3 text-left transition-colors',
    selected ? 'border-ink bg-raised' : 'border-transparent hover:bg-raised',
  );

/**
 * A service's row. It may run to more than one line, its state under its
 * name, so it is laid out from the top: the mark stands beside the name's
 * line, and a row of one line is as tall as a connection's.
 */
const serviceRowClass = (selected: boolean) =>
  cn(
    'flex w-full items-start gap-2 border-l-2 py-1.5 pl-2.5 pr-3 text-left transition-colors',
    selected ? 'border-ink bg-raised' : 'border-transparent hover:bg-raised',
  );

/**
 * Past this many connections, they are listed only when asked for. Each row
 * says its connection's rate at the cursor, so each is drawn again wherever
 * the capture changes; a capture with thousands of them would hold up its
 * own playback while the list is open.
 */
export const CONNECTIONS_LISTED = 64;

/**
 * Every service of the capture, by region, with what the capture says of it
 * at the cursor, then its connections. A normal service carries no mark; one
 * whose state is not given says so. Choosing one selects it on the model.
 */
function Services({ capture }: { capture: Capture }) {
  const moment = useMoment();
  const selection = useCapture((state) => state.selection);
  const many = capture.edges.length > CONNECTIONS_LISTED;
  const [asked, setAsked] = useState(false);
  const listed = !many || asked;
  const connectionsId = useId();
  const readings = nodeReadings(capture, moment);
  const links = listed ? edgeReadings(capture, moment) : [];
  const report = isReport(capture);
  const store = useCapture.getState;

  return (
    <nav aria-label={t('Services of the capture, by region')} data-testid="capture-services">
      {capture.regions.map((region) => {
        const rows = capture.nodes
          .map((node, i) => ({ node, reading: readings[i]! }))
          .filter(({ node }) => node.region === region.id);
        if (rows.length === 0) return null;
        return (
          <section key={region.id} aria-label={region.name}>
            <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper py-1 pl-3 pr-3">
              <h3 className="min-w-0 flex-1 truncate text-xs font-bold text-ink">{region.name}</h3>
              <span className="caption">{rows.length}</span>
            </header>
            <ul>
              {rows.map(({ node, reading }) => {
                const selected = selection?.kind === 'node' && selection.id === node.id;
                const loud = isLoud(reading.condition);
                const quiet = reading.condition === 'normal' || reading.condition === 'recovered';
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      data-testid={`capture-service-${node.id}`}
                      data-condition={reading.condition}
                      onClick={() => store().select({ kind: 'node', id: node.id })}
                      onMouseEnter={() => store().hover(node.id)}
                      onMouseLeave={() => store().hover(null)}
                      onFocus={() => store().hover(node.id)}
                      onBlur={() => store().hover(null)}
                      title={SERVICE_TYPE[node.type].label}
                      className={serviceRowClass(selected)}
                    >
                      <span className="flex h-4 shrink-0 items-center">
                        {/* Said after the name, below: which service first, then its state. */}
                        <ConditionMark
                          condition={reading.condition}
                          sampled={sampledIn(reading)}
                          announce={false}
                        />
                      </span>
                      <span className="min-w-0 flex-1" data-part="text">
                        {/* The whole name, on more lines if it needs them: a
                            name the source wrote (an ARN, say) often differs
                            from the next only at its end. */}
                        <span
                          className={cn(
                            'block break-words text-xs leading-4 text-ink',
                            (selected || loud) && 'font-bold',
                          )}
                          data-part="name"
                        >
                          {node.name}
                        </span>
                        {/* For assistive technology, the state after the name,
                            whatever it is; the words on show are not read twice. */}{' '}
                        <span className="sr-only">
                          {captureStateLabel(reading.condition, sampledIn(reading))}
                        </span>
                        {/* Normal is silent; anything else is said, under the
                            name, so that a long state never takes its room. */}
                        {!quiet && (
                          <span
                            aria-hidden
                            className={cn(
                              'block text-[11px] leading-snug',
                              loud ? 'font-bold' : 'text-ink-faint',
                            )}
                            style={
                              loud ? { color: CAPTURE_STATE_COLOR[reading.condition] } : undefined
                            }
                            data-part="state"
                          >
                            {captureStateLabel(reading.condition, sampledIn(reading))}
                          </span>
                        )}
                        {node.note && (
                          <span className="block text-[11px] leading-snug text-ink-faint">
                            {node.note}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {capture.edges.length > 0 && (
        <section aria-label={t('Connections')}>
          <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper py-1 pl-3 pr-3">
            <h3 className="min-w-0 flex-1 truncate text-xs font-bold text-ink">
              {t('Connections')}
            </h3>
            <span className="caption">{capture.edges.length}</span>
            {many && (
              <button
                type="button"
                aria-expanded={asked}
                aria-controls={connectionsId}
                aria-label={asked ? t('Hide the connections') : t('Show the connections')}
                onClick={() => setAsked(!asked)}
                className="caption rounded-control px-1 hover:text-ink"
                data-testid="capture-connections-toggle"
              >
                {asked ? t('Hide') : t('Show')}
              </button>
            )}
          </header>
          {listed && (
            <ul id={connectionsId} data-testid="capture-connections">
              {capture.edges.map((edge, i) => {
                const id = connectionId(edge);
                const reading = links[i]!;
                const selected = selection?.kind === 'edge' && selection.id === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      data-testid={`capture-connection-${id}`}
                      onClick={() => store().select({ kind: 'edge', id })}
                      className={rowClass(selected)}
                    >
                      {/* A report states nothing about a connection. */}
                      {!report && (
                        <ConditionMark condition={reading.condition} sampled={sampledIn(reading)} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">
                        {t('{from} to {to}', {
                          from: nameOf(capture, edge.source),
                          to: nameOf(capture, edge.target),
                        })}
                      </span>
                      {reading.requestsPerSecond !== null && (
                        <span className="numeric shrink-0 text-[11px] text-ink-faint">
                          {formatRate(reading.requestsPerSecond)}/s
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </nav>
  );
}

/** One event: when (UTC, and into the capture), what it says, as written, and whom it names. */
function EventRow({
  capture,
  event,
  later,
  current,
}: {
  capture: Capture;
  event: CaptureEvent;
  later: boolean;
  current: boolean;
}) {
  const store = useCapture.getState;
  const loud = event.state === 'affected' || event.state === 'recovering';
  return (
    <button
      type="button"
      onClick={() => {
        store().seek(event.atMs);
        // An event about one service brings it forward too.
        const only = event.nodes.length === 1 ? event.nodes[0] : undefined;
        if (only !== undefined) store().select({ kind: 'node', id: only });
      }}
      aria-current={current ? 'time' : undefined}
      data-testid="capture-event"
      data-state={event.state ?? 'none'}
      className={cn(
        'grid w-full grid-cols-[0.75rem_1fr] gap-x-1.5 rounded-control px-1.5 py-1.5 text-left hover:bg-raised',
        // Events ahead of the cursor are still to come.
        later && 'opacity-45',
        current && 'bg-raised',
      )}
    >
      <span className="pt-1">
        <EventGlyph state={event.state} />
      </span>
      <span className="min-w-0">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('min-w-0 text-xs text-ink', loud && 'font-bold')}>
            {event.title}
            {event.state && <span className="sr-only">, {CAPTURE_STATE_LABEL[event.state]}</span>}
          </span>
          <time
            className="numeric shrink-0 text-[11px] text-ink-faint"
            dateTime={isoOf(event.atMs)}
          >
            {t('{time} UTC', { time: utcTime(event.atMs) })}
          </time>
        </span>
        <span className="caption numeric block">
          {t('{offset} into the capture', { offset: sinceCaptureStart(capture, event.atMs) })}
        </span>
        {event.detail && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-dim">
            {event.detail}
          </span>
        )}
        {event.nodes.length > 0 && (
          <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
            {event.nodes.map((id) => nameOf(capture, id)).join('; ')}
          </span>
        )}
      </span>
    </button>
  );
}

/** The capture's events in time order; those after the cursor are dimmed, one seeks to it. */
function Events({ capture }: { capture: Capture }) {
  const count = useCapture(selectEventCount);
  if (capture.events.length === 0) {
    return <p className="px-3 py-4 text-xs text-ink-faint">{t('This capture has no events.')}</p>;
  }
  return (
    <ol
      className="px-1.5 py-1.5"
      aria-label={t('Events, in time order')}
      data-testid="capture-events"
    >
      {capture.events.map((event, i) => (
        <li key={i}>
          <EventRow capture={capture} event={event} later={i >= count} current={i === count - 1} />
        </li>
      ))}
    </ol>
  );
}

/**
 * What goes in the left panel while a capture is open: its services and its
 * events, in two tabs, in place of the simulation's services and incidents.
 */
export function CaptureList() {
  const capture = useCapture((state) => state.capture);
  const tab = useCapture((state) => state.listTab);
  if (!capture) return null;
  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) => useCapture.getState().setList(true, value as ListTab)}
      className="flex min-h-0 flex-1 flex-col"
      data-testid="capture-list-sheet"
    >
      <div className="flex shrink-0 items-center border-b border-line pr-1">
        <Tabs.List className="relative flex flex-1" aria-label={t('Services and events')}>
          <Tabs.Trigger value="services" className={tabClass} data-testid="capture-tab-services">
            {t('Services')}
          </Tabs.Trigger>
          <Tabs.Trigger value="events" className={tabClass} data-testid="capture-tab-events">
            {t('Events')}
          </Tabs.Trigger>
          <TabMarker index={tab === 'services' ? 0 : 1} count={2} />
        </Tabs.List>
        <IconButton
          label={t('Close this panel')}
          size="sm"
          onClick={() => useCapture.getState().setList(false)}
          data-testid="capture-list-close"
        >
          <X size={14} />
        </IconButton>
      </div>
      <Tabs.Content
        value="services"
        className="min-h-0 flex-1 animate-fade overflow-y-auto data-[state=inactive]:hidden"
      >
        <Services capture={capture} />
      </Tabs.Content>
      <Tabs.Content
        value="events"
        className="min-h-0 flex-1 animate-fade overflow-y-auto data-[state=inactive]:hidden"
      >
        <Events capture={capture} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

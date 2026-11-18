import { ArrowLeft, FileUp, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import { useTheme } from '@/app/useTheme';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { Logo } from '@/features/topnav/Logo';
import { canRender3D } from '@/graphics/renderer';
import type { SceneSelection } from '@/graphics/SceneController';
import { language, t } from '@/i18n';
import { formatMs, formatPercent } from '@/lib/format';
import { prefersReducedMotion, useSettings } from '@/stores/ui';

import {
  bucketAt,
  connectionId,
  hasFaults,
  MAX_CAPTURE_BYTES,
  readCapture,
  reportedAt,
  sceneFrame,
  sceneTopology,
  type Bucket,
  type Capture,
  type ReportedState,
} from './capture';
import googleReport from './google-cloud-2025-06-12.json';
import { ReplayScene } from './ReplayScene';

const example = readCapture(googleReport)!;
const clock = new Intl.DateTimeFormat(language, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});
const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });

const VIEWS = [
  { value: 'scene', label: t('3D model') },
  { value: 'table', label: t('Table view') },
] as const;

const REPORTED: Record<ReportedState, string> = {
  affected: t('Impact reported'),
  recovering: t('Recovery reported in progress'),
  recovered: t('Recovery reported'),
};

function missing() {
  return <span className="text-ink-faint">{t('No data')}</span>;
}

function faultRate(point: Bucket | undefined): string | undefined {
  if (point?.requests && point.faults !== undefined) {
    return formatPercent(point.faults / point.requests);
  }
}

function ReplayViewer({ capture }: { capture: Capture }) {
  const { startMs, endMs } = capture.window;
  const duration = endMs - startMs;
  const [atMs, setAtMs] = useState(startMs);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<SceneSelection>(null);
  const [view, setView] = useState<'scene' | 'table'>('scene');
  const [can3D, setCan3D] = useState(canRender3D);
  const [backend, setBackend] = useState<string>();
  const theme = useTheme();
  const motion = useSettings((state) => state.motion);
  const topology = useMemo(() => sceneTopology(capture), [capture]);
  const frame = useMemo(() => sceneFrame(capture, atMs), [capture, atMs]);
  const nodes = useMemo(() => new Map(capture.nodes.map((node) => [node.id, node])), [capture]);
  const regions = useMemo(() => new Map(capture.regions.map((r) => [r.id, r.name])), [capture]);
  const faultTrack = useMemo(() => {
    let first = Infinity;
    const marks = new Set<number>();
    for (const node of capture.nodes) {
      for (const point of node.buckets) {
        if (!hasFaults(point)) continue;
        first = Math.min(first, point.atMs);
        marks.add(Math.min(99, Math.floor((100 * (point.atMs - startMs)) / duration)));
      }
    }
    return Number.isFinite(first) ? { first, marks: [...marks] } : null;
  }, [capture, startMs, duration]);
  const reported = reportedAt(capture, atMs);
  const report = capture.source.kind === 'provider-report';
  const selectedNode = selection?.kind === 'node' ? nodes.get(selection.id) : undefined;
  const selectedEdge =
    selection?.kind === 'edge'
      ? capture.edges.find((edge) => connectionId(edge) === selection.id)
      : undefined;
  const selected = selectedNode ?? selectedEdge;
  const sample = selected ? bucketAt(selected.buckets, atMs, capture.periodMs) : undefined;
  const regionOf = (node: Capture['nodes'][number]) => regions.get(node.region) ?? node.region;
  const nameOf = (id: string) => nodes.get(id)?.name ?? id;
  const edgeName = (edge: Capture['edges'][number]) =>
    `${nameOf(edge.source)} → ${nameOf(edge.target)}`;
  const connections = selectedNode
    ? capture.edges.filter(
        (edge) => edge.source === selectedNode.id || edge.target === selectedNode.id,
      )
    : [];
  const prior = [...capture.events].reverse().find((event) => event.atMs < atMs);
  const next = capture.events.find((event) => event.atMs > atMs);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      // The entire recorded interval takes thirty seconds to play.
      const elapsed = Math.round(((now - last) * duration) / 30_000);
      last = now;
      setAtMs((time) => Math.min(endMs, time + elapsed));
    }, 125);
    return () => clearInterval(timer);
  }, [duration, endMs, playing]);

  useEffect(() => {
    if (atMs === endMs) setPlaying(false);
  }, [atMs, endMs]);

  const seek = (time: number) => {
    setPlaying(false);
    setAtMs(time);
  };

  const statusOf = (node: Capture['nodes'][number]) => {
    const state = reported.get(node.id);
    if (state) return REPORTED[state];
    const point = bucketAt(node.buckets, atMs, capture.periodMs);
    if (hasFaults(point)) return t('Faults observed');
    if (point?.faults === 0) return t('No faults in this sample');
    return t('No data');
  };

  return (
    <main
      className="mx-auto w-full max-w-[112rem] p-3 sm:p-5"
      data-reduced-motion={prefersReducedMotion(motion)}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="caption font-bold">
            {report ? t('Provider report') : t('Observed capture')}
          </p>
          <h1 className="mt-1 break-words text-lg font-bold text-ink sm:text-xl">
            {capture.title}
          </h1>
        </div>
        {capture.source.url ? (
          <a
            className="text-xs text-focus underline underline-offset-2"
            href={capture.source.url}
            target="_blank"
            rel="noreferrer"
          >
            {capture.source.label}
          </a>
        ) : (
          <p className="caption break-all">{capture.source.label}</p>
        )}
      </header>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)]">
        <div className="min-w-0">
          <section className="panel overflow-hidden" aria-label={t('Infrastructure topology')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <p className="text-xs text-ink-dim">
                {report
                  ? t('Selected products and locations')
                  : t('Dependencies observed by CloudWatch')}
              </p>
              {can3D && (
                <Segmented
                  label={t('Topology view')}
                  options={VIEWS}
                  value={view}
                  onChange={setView}
                  size="sm"
                />
              )}
            </div>
            {can3D && view === 'scene' ? (
              <div
                className="h-[clamp(14rem,47vh,39rem)] bg-plate"
                data-testid="replay-scene"
                data-backend={backend}
              >
                <ReplayScene
                  theme={theme}
                  topology={topology}
                  frame={frame}
                  selection={selection}
                  onSelect={setSelection}
                  onRuntime={({ backend: active }) => setBackend(active)}
                  onUnavailable={() => setCan3D(false)}
                />
              </div>
            ) : (
              <div className="max-h-[47vh] overflow-auto">
                {!can3D && (
                  <p className="caption px-3 py-2">
                    {t('3D unavailable. Showing the table view.')}
                  </p>
                )}
                <table className="w-full text-left text-xs text-ink">
                  <thead className="sticky top-0 bg-plate">
                    <tr>
                      <th className="px-3 py-2" scope="col">
                        {t('Service')}
                      </th>
                      <th className="px-3 py-2" scope="col">
                        {t('Region')}
                      </th>
                      <th className="px-3 py-2" scope="col">
                        {t('Evidence at this time')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {capture.nodes.map((node) => (
                      <tr key={node.id} className="border-t border-line">
                        <th className="px-3 py-2" scope="row">
                          <button
                            type="button"
                            className="text-left text-focus underline underline-offset-2"
                            aria-pressed={selectedNode?.id === node.id}
                            onClick={() => setSelection({ kind: 'node', id: node.id })}
                          >
                            {node.name}
                          </button>
                        </th>
                        <td className="px-3 py-2">{regionOf(node)}</td>
                        <td className="px-3 py-2">{statusOf(node)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {can3D && view === 'scene' && (
              <p className="caption border-t border-line px-3 py-2">
                {report
                  ? t('Highlights follow the provider report.')
                  : t('Highlights mark fault samples. Select a piece to check its evidence.')}
              </p>
            )}
          </section>

          <section className="panel mt-3 p-3" aria-label={t('Recorded timeline')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  icon={playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                  onClick={() => {
                    if (playing) setPlaying(false);
                    else {
                      if (atMs === endMs) setAtMs(startMs);
                      setPlaying(true);
                    }
                  }}
                >
                  {playing ? t('Pause') : t('Play capture')}
                </Button>
                <Button icon={<RotateCcw size={13} aria-hidden />} onClick={() => seek(startMs)}>
                  {t('Go to start')}
                </Button>
              </div>
              <time
                className="numeric text-xs text-ink"
                dateTime={new Date(atMs).toISOString()}
                data-testid="replay-time"
              >
                {clock.format(atMs)}
              </time>
            </div>
            <input
              className="mt-3 w-full accent-focus"
              type="range"
              min={0}
              max={duration}
              step={Math.min(duration, 1000)}
              value={atMs - startMs}
              aria-label={t('Timeline position')}
              aria-valuetext={clock.format(atMs)}
              onChange={(event) => seek(startMs + event.currentTarget.valueAsNumber)}
            />
            <div className="caption flex flex-wrap justify-between gap-x-3 gap-y-1">
              <span>{clock.format(startMs)}</span>
              <span>{clock.format(endMs)}</span>
            </div>
            {faultTrack && (
              <div className="mt-3">
                <div className="relative h-1 bg-sunken" aria-hidden>
                  {faultTrack.marks.map((mark) => (
                    <span
                      key={mark}
                      className="absolute h-full w-0.5 bg-critical"
                      style={{ left: `${mark}%` }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="mt-2 text-xs text-focus underline underline-offset-2"
                  onClick={() => seek(faultTrack.first)}
                >
                  {t('Go to first sample with faults')}
                </button>
              </div>
            )}
            {capture.events.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={!prior} onClick={() => prior && seek(prior.atMs)}>
                  {t('Previous event')}
                </Button>
                <Button size="sm" disabled={!next} onClick={() => next && seek(next.atMs)}>
                  {t('Next event')}
                </Button>
              </div>
            )}
          </section>

          {capture.notes.length > 0 && (
            <details className="mt-3 px-1 text-xs text-ink-dim">
              <summary className="cursor-pointer text-ink">{t('Capture notes')}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {capture.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <aside className="min-w-0 space-y-3" aria-label={t('Incident evidence')}>
          <section className="panel p-3">
            <h2 className="mb-2 text-sm font-bold text-ink">{t('Inspect the topology')}</h2>
            <select
              className="w-full rounded-control border border-line-strong bg-paper p-2 text-xs text-ink"
              aria-label={t('Service or connection')}
              value={selection?.id ?? ''}
              onChange={(event) => {
                const id = event.currentTarget.value;
                setSelection(id ? { id, kind: nodes.has(id) ? 'node' : 'edge' } : null);
              }}
            >
              <option value="">{t('Select a service or connection')}</option>
              <optgroup label={t('Services')}>
                {capture.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name} · {regionOf(node)}
                  </option>
                ))}
              </optgroup>
              {capture.edges.length > 0 && (
                <optgroup label={t('Connections')}>
                  {capture.edges.map((edge) => (
                    <option key={connectionId(edge)} value={connectionId(edge)}>
                      {edgeName(edge)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {selected && (
              <div className="mt-3 text-xs text-ink" data-testid="replay-evidence">
                <h3 className="break-words font-bold">
                  {selectedNode?.name ?? (selectedEdge && edgeName(selectedEdge))}
                </h3>
                {selectedNode && (
                  <p className="mt-1 text-ink-dim">
                    {regionOf(selectedNode)} · {statusOf(selectedNode)}
                  </p>
                )}
                {selectedEdge && (
                  <p className="mt-1 text-ink-dim">
                    {report
                      ? t('Dependency described by the provider')
                      : t('Dependency observed in the discovery window')}
                  </p>
                )}
                {selectedEdge && capture.topologyWindow && (
                  <p className="caption mt-1">
                    {clock.format(capture.topologyWindow.startMs)} –{' '}
                    {clock.format(capture.topologyWindow.endMs)}
                  </p>
                )}
                {!report && (
                  <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
                    <dt>{t('Requests in sample')}</dt>
                    <dd>
                      {sample?.requests === undefined ? missing() : number.format(sample.requests)}
                    </dd>
                    <dt>{t('Faults in sample')}</dt>
                    <dd>
                      {sample?.faults === undefined ? missing() : number.format(sample.faults)}
                    </dd>
                    <dt>{t('Fault rate')}</dt>
                    <dd>{faultRate(sample) ?? missing()}</dd>
                    <dt>{t('Latency p95')}</dt>
                    <dd>{sample?.p95Ms === undefined ? missing() : formatMs(sample.p95Ms)}</dd>
                  </dl>
                )}
                {sample && capture.periodMs && (
                  <p className="caption mt-2">
                    {t('Sample from {time} · {seconds} s', {
                      time: clock.format(sample.atMs),
                      seconds: capture.periodMs / 1000,
                    })}
                  </p>
                )}
                {connections.length > 0 && (
                  <ul className="mt-3 max-h-36 space-y-1 overflow-auto border-t border-line pt-2">
                    {connections.map((edge) => (
                      <li key={connectionId(edge)}>
                        <button
                          type="button"
                          className="break-words text-left text-focus underline underline-offset-2"
                          onClick={() => setSelection({ kind: 'edge', id: connectionId(edge) })}
                        >
                          {edgeName(edge)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
          <section className="panel p-3">
            <h2 className="text-sm font-bold text-ink">{t('Recorded events')}</h2>
            {capture.events.length === 0 ? (
              <p className="caption mt-2">
                {t('This capture contains metrics and topology. No events were exported.')}
              </p>
            ) : (
              <ol className="mt-2 max-h-[50vh] divide-y divide-line overflow-auto">
                {capture.events.map((event, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      aria-current={atMs === event.atMs ? 'time' : undefined}
                      className="w-full rounded-control px-2 py-2 text-left text-xs text-ink hover:bg-raised aria-[current=time]:bg-sunken"
                      onClick={() => {
                        seek(event.atMs);
                        setSelection(
                          event.nodes.length === 1 ? { kind: 'node', id: event.nodes[0]! } : null,
                        );
                      }}
                    >
                      <time className="caption block" dateTime={new Date(event.atMs).toISOString()}>
                        {clock.format(event.atMs)}
                      </time>
                      <span className="block font-bold">{event.title}</span>
                      {event.detail && (
                        <span className="mt-1 block break-words text-ink-dim">{event.detail}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function CloudReplay() {
  const [capture, setCapture] = useState(example);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const attempt = ++generation.current;
    setError(undefined);
    if (file.size > MAX_CAPTURE_BYTES) {
      setError(t('The capture is larger than 12 MiB.'));
      return;
    }
    try {
      const result = readCapture(JSON.parse(await file.text()));
      if (attempt !== generation.current) return;
      if (!result) throw new Error();
      setCapture(result);
      setLoaded(attempt);
    } catch {
      if (attempt === generation.current) {
        setError(t('The file is not a valid cloud replay capture.'));
      }
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-plate">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2 sm:px-5">
        <a href="./" className="inline-flex items-center gap-2 text-xs text-focus">
          <ArrowLeft size={14} aria-hidden />
          {t('Back to simulation')}
        </a>
        <span className="order-3 flex basis-full items-center gap-2 text-sm font-bold text-ink sm:order-none sm:flex-1 sm:basis-auto">
          <Logo size={19} />
          {t('Cloud incident replay')}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {capture !== example && (
            <Button
              onClick={() => {
                setLoaded(++generation.current);
                setCapture(example);
                setError(undefined);
              }}
            >
              {t('Open public replay')}
            </Button>
          )}
          <Button
            variant="primary"
            icon={<FileUp size={14} aria-hidden />}
            onClick={() => input.current?.click()}
          >
            {t('Open capture')}
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".json,application/json"
            onChange={(event) => void choose(event)}
            data-testid="replay-file"
          />
        </div>
      </header>
      {error && (
        <p role="alert" className="mx-3 mt-3 text-xs text-critical sm:mx-5">
          {error}
        </p>
      )}
      <ReplayViewer key={loaded} capture={capture} />
    </div>
  );
}

/**
 * One scenario on the platform in use and on the one a set of files
 * describes.
 *
 * A change of architecture (another service, another connection, another
 * capacity) is a change to the files. Before they are applied, the server
 * runs a scenario on both platforms from the same seed, on timelines of
 * their own, and this lays the two runs side by side with what the two
 * descriptions state differently. Every figure is read from the answer.
 * Which difference an outcome follows from is not something two runs say,
 * and this does not say it either. Nothing is applied until the viewer asks
 * to watch the run on the files.
 */
import type {
  FieldChange,
  MetricSample,
  PlatformComparison,
  WorkspaceFile,
  WorkspaceStatus,
} from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { SourceBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { ServiceName } from '@/components/ui/ServiceName';
import { RunsChart, RunStroke } from '@/features/experiments/RunsChart';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { affectedOnlyIn, comparedRows } from '@/lib/experiment';
import { formatClock, formatMs, formatPercent, formatRate } from '@/lib/format';
import {
  namesInFiles,
  platformOfFiles,
  runnableOnBoth,
  sameOnBothSides,
  statedDifferently,
  written,
} from '@/lib/platforms';
import { api, ApiError } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';

/** Most entries of one list written out; the rest are counted. */
const SHOWN = 8;

/** The two figures drawn over the runs. */
const MEASURES: [string, (sample: MetricSample) => number, (value: number) => string][] = [
  [t('Error rate'), (sample) => sample.errorRate, formatPercent],
  [t('Latency p95'), (sample) => sample.p95LatencyMs, formatMs],
];

const code = (children: ReactNode) => <span className="code">{children}</span>;
const numeric = (children: ReactNode) => <span className="numeric text-ink">{children}</span>;
const strong = (children: ReactNode) => <span className="font-bold text-ink">{children}</span>;

function services(n: number): string {
  return t(n === 1 ? '{n} service' : '{n} services', { n });
}

/** A list of differences of one kind, cut to what fits with the rest counted. */
function Listed<T>({
  title,
  entries,
  children,
  testId,
}: {
  title: string;
  entries: readonly T[];
  children: (entry: T) => ReactNode;
  testId?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-bold text-ink">{title}</p>
      <ul
        className="mt-0.5 space-y-0.5 text-[11px] leading-relaxed text-ink-dim"
        data-testid={testId}
      >
        {entries.slice(0, SHOWN).map((entry, i) => (
          <li key={i}>{children(entry)}</li>
        ))}
        {entries.length > SHOWN && (
          <li className="text-ink-faint">{t('and {n} more', { n: entries.length - SHOWN })}</li>
        )}
      </ul>
    </div>
  );
}

/** The fields one thing is described differently in, each as the two files wrote it. */
function Fields({ fields }: { fields: FieldChange[] }) {
  return (
    <>
      {fields.map((entry, i) => (
        <span key={entry.field}>
          {i > 0 && '; '}
          <span className="code">{entry.field}</span>{' '}
          <span className="numeric">{written(entry.base)}</span> <span aria-hidden>→</span>
          <span className="sr-only">{t('becomes')}</span>{' '}
          <span className="numeric text-ink">{written(entry.candidate)}</span>
        </span>
      ))}
    </>
  );
}

function Named({ id, name }: { id: string; name: string }) {
  return (
    <>
      <span className="text-ink">{name}</span> (<span className="code">{id}</span>)
    </>
  );
}

function Results({
  comparison,
  busy,
  onWatch,
}: {
  comparison: PlatformComparison;
  busy: boolean;
  onWatch: (run: 'baseline' | 'variant') => void;
}) {
  const topology = useTelemetry((state) => state.topology);
  const { changes, base, candidate } = comparison;
  const rows = comparedRows(comparison);
  const only = affectedOnlyIn(comparison);
  const same = sameOnBothSides(comparison);
  const ofFiles = namesInFiles(changes);
  const list = (ids: string[], side: 'a' | 'b') =>
    ids.map((id, i) => (
      <span key={id}>
        {i > 0 && '; '}
        {/* A service only the files have, or have under another name, is called what they call it. */}
        {side === 'b' && ofFiles.has(id) ? (
          ofFiles.get(id)
        ) : (
          <ServiceName topology={topology} id={id} />
        )}
      </span>
    ));
  const connection = (entry: { source: string; target: string }) => (
    <span className="code">
      {entry.source} → {entry.target}
    </span>
  );
  return (
    <div
      className="mt-3 space-y-4 border-t border-line pt-3"
      role="status"
      data-testid="platform-runs-result"
      data-same={same}
    >
      <section>
        <h4 className="text-xs font-bold text-ink">{t('What differs')}</h4>
        <p
          className="mt-1 text-[11px] leading-relaxed text-ink-dim"
          data-testid="platform-runs-sides"
        >
          {tr(
            'A is <e>{base}</e>, in use ({services}). B is <e>{candidate}</e>, as these files describe it ({others}).',
            {
              e: strong,
              // The names of the two platforms, as their files wrote them.
              base: base.name,
              candidate: candidate.name,
              services: services(base.nodeCount),
              others: services(candidate.nodeCount),
            },
          )}{' '}
          {tr('Both runs are {scenario} with seed <n>{seed}</n>, begun at the same moment.', {
            n: numeric,
            scenario: comparison.scenarioName,
            seed: comparison.seed,
          })}
        </p>
        {same ? (
          <p className="mt-1 text-[11px] leading-relaxed text-ink">
            {t(
              'The files describe the platform in use as it is and Cedar answers the same, so the two runs are one run.',
            )}
          </p>
        ) : (
          <>
            {statedDifferently(changes) === 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
                {t('The files describe the platform in use as it is.')}
              </p>
            )}
            <Listed
              title={t('Services added')}
              entries={changes.servicesAdded}
              testId="platform-added"
            >
              {(entry) => <Named {...entry} />}
            </Listed>
            <Listed title={t('Services removed')} entries={changes.servicesRemoved}>
              {(entry) => <Named {...entry} />}
            </Listed>
            <Listed
              title={t('Services described differently')}
              entries={changes.servicesChanged}
              testId="platform-changed"
            >
              {(entry) => (
                <>
                  <Named id={entry.id} name={entry.name} />: <Fields fields={entry.fields} />
                </>
              )}
            </Listed>
            <Listed title={t('Connections added')} entries={changes.connectionsAdded}>
              {connection}
            </Listed>
            <Listed title={t('Connections removed')} entries={changes.connectionsRemoved}>
              {connection}
            </Listed>
            <Listed
              title={t('Connections described differently')}
              entries={changes.connectionsChanged}
            >
              {(entry) => (
                <>
                  {connection(entry)}: <Fields fields={entry.fields} />
                </>
              )}
            </Listed>
            <Listed title={t('Regions added')} entries={changes.regionsAdded}>
              {(entry) => <Named {...entry} />}
            </Listed>
            <Listed title={t('Regions removed')} entries={changes.regionsRemoved}>
              {(entry) => <Named {...entry} />}
            </Listed>
            <Listed title={t('Regions described differently')} entries={changes.regionsChanged}>
              {(entry) => (
                <>
                  <Named id={entry.id} name={entry.name} />: <Fields fields={entry.fields} />
                </>
              )}
            </Listed>
            <Listed title={t('Roles')} entries={changes.roles}>
              {(entry) =>
                entry.candidate === null
                  ? tr('<c>{role}</c> names nothing; in use it names <c>{other}</c>.', {
                      c: code,
                      role: entry.role,
                      other: entry.base,
                    })
                  : entry.base === null
                    ? tr('<c>{role}</c> names <c>{target}</c>; nothing has that role in use.', {
                        c: code,
                        role: entry.role,
                        target: entry.candidate,
                      })
                    : tr('<c>{role}</c> names <c>{target}</c>; in use it names <c>{other}</c>.', {
                        c: code,
                        role: entry.role,
                        target: entry.candidate,
                        other: entry.base,
                      })
              }
            </Listed>
            {comparison.decisionsChanged && (
              <p
                className="mt-2 text-[11px] leading-relaxed text-ink-dim"
                data-testid="platform-decisions"
              >
                {t(
                  'Cedar also answers the simulation differently under these files; the comparison of decisions above says where.',
                )}
              </p>
            )}
          </>
        )}
      </section>

      {(changes.derivedCapacity.length > 0 || comparison.prescribed.length > 0) && (
        <section data-testid="platform-follows">
          <h4 className="text-xs font-bold text-ink">{t('What follows without being stated')}</h4>
          {changes.derivedCapacity.length > 0 && (
            <>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
                {t(
                  'Where a file states no capacity, the model sizes the service from its load at rest, and that load is another on B.',
                )}
              </p>
              <Listed
                title={t('Capacity the model works with')}
                entries={changes.derivedCapacity}
                testId="platform-capacity"
              >
                {(entry) => (
                  <>
                    <Named id={entry.id} name={entry.name} />:{' '}
                    {tr('<n>{base}</n> req/s in A, <n>{candidate}</n> req/s in B', {
                      n: numeric,
                      base: formatRate(entry.base),
                      candidate: formatRate(entry.candidate),
                    })}
                  </>
                )}
              </Listed>
            </>
          )}
          {comparison.prescribed.length > 0 && (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
                {t(
                  'The scenario is one file, yet it prescribes something else on B: a role names another service there, or a rate is written as a share of a capacity that is another.',
                )}
              </p>
              <Listed
                title={t('What the scenario prescribes')}
                entries={comparison.prescribed}
                testId="platform-prescribed"
              >
                {(entry) => (
                  <>
                    <span className="text-ink">{entry.phase}</span>
                    {/* Each side as its own report worded it. */}
                    {(['base', 'candidate'] as const).map((side) => (
                      <span key={side} className="block pl-3">
                        <span className="font-bold text-ink">{side === 'base' ? 'A' : 'B'}</span>{' '}
                        {entry[side].length === 0
                          ? t('nothing')
                          : entry[side].map((effect) => effect.description).join('; ')}
                      </span>
                    ))}
                  </>
                )}
              </Listed>
            </>
          )}
        </section>
      )}

      {!same && (
        <p className="text-[11px] leading-relaxed text-ink-dim">
          {t(
            'Two runs do not say which of these differences an outcome follows from. To see what one of them does, change that one alone.',
          )}
        </p>
      )}

      <section>
        <table className="w-full border-collapse text-xs" data-testid="platform-runs-table">
          <thead>
            <tr className="text-left">
              <th className="py-1 font-normal text-ink-faint" />
              <th className="px-2 py-1 font-bold text-ink">
                A <span className="font-normal text-ink-dim">{t('in use')}</span>
              </th>
              <th className="px-2 py-1 font-bold text-ink">
                B <span className="font-normal text-ink-dim">{t('with these files')}</span>
              </th>
              <th className="px-2 py-1 font-normal text-ink-faint">{t('B against A')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-y border-line">
            {rows.map((row) => (
              <tr key={row.id} data-testid={`platform-row-${row.id}`}>
                <th scope="row" className="py-1.5 text-left font-normal text-ink-dim">
                  {row.label}
                </th>
                <td className="numeric px-2 py-1.5 text-ink">{row.a}</td>
                <td className="numeric px-2 py-1.5 text-ink">{row.b}</td>
                <td className="numeric px-2 py-1.5 text-ink-dim">
                  {row.delta || <span className="text-ink-faint">{t('the same')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(only.a.length > 0 || only.b.length > 0) && (
          <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-ink-dim">
            {only.a.length > 0 && (
              <p>{tr('Affected only in A: {services}.', { services: list(only.a, 'a') })}</p>
            )}
            {only.b.length > 0 && (
              <p>{tr('Affected only in B: {services}.', { services: list(only.b, 'b') })}</p>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="grid gap-3 sm:grid-cols-2">
          {MEASURES.map(([label, value, format]) => (
            <RunsChart
              key={label}
              a={comparison.baseline.samples}
              b={comparison.variant.samples}
              durationMs={comparison.durationMs}
              startedAtMs={comparison.incidentStartedAtMs}
              label={label}
              value={value}
              format={format}
              summary={(a, b) =>
                t('{measure} over both runs. In use: up to {a}. With these files: up to {b}.', {
                  measure: label,
                  a,
                  b,
                })
              }
            />
          ))}
        </div>
        <p className="caption mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <RunStroke run="a" />
            {t('A, in use')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <RunStroke run="b" />
            {t('B, with these files')}
          </span>
          <span>
            {tr('The tick is where the incident begins. Each run lasts <n>{duration}</n>.', {
              n: (children) => <span className="numeric">{children}</span>,
              duration: formatClock(comparison.durationMs),
            })}
          </span>
          <SourceBadge source={comparison.dataSource} />
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={<Play size={12} aria-hidden />}
          disabled={busy}
          onClick={() => onWatch('variant')}
          data-testid="platform-watch-b"
          title={t('Applies the files, then puts run B on the timeline, to play back and scrub')}
        >
          {t('Apply these files and watch run B')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onWatch('baseline')}
          data-testid="platform-watch-a"
          title={t('Replaces the timeline in use with run A')}
        >
          {t('Watch run A')}
        </Button>
        <span className="caption">
          {t('Either replaces the timeline in use, for everyone connected.')}
        </span>
      </section>
    </div>
  );
}

/** What the form asked, with what came back for it. */
interface Asked {
  files: WorkspaceFile[];
  scenarioId: string;
  platform: string;
  answer: PlatformComparison | string;
}

/**
 * The comparison for the staged files, asked for since it simulates two
 * whole incidents. `files` is what applying them would give, as the check
 * said; `onLeave` is called once a run has been put on the timeline.
 */
export function PlatformRuns({
  staged,
  files,
  onLeave,
}: {
  staged: WorkspaceFile[];
  files: WorkspaceStatus;
  onLeave: (applied: boolean) => void;
}) {
  const inUse = useTelemetry((state) => state.topology?.id);
  const { data: scenarios } = useQuery({ queryKey: queryKeys.scenarios, queryFn: api.scenarios });
  const [chosenPlatform, setChosenPlatform] = useState<string | null>(null);
  const [chosenScenario, setChosenScenario] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // What the form asks, counted: an answer is shown only for the question it answers.
  const question = useRef(0);

  // Other files are another question, and may hold other platforms.
  useEffect(() => {
    question.current += 1;
    setAsked(null);
    setFailure(null);
    setChosenPlatform(null);
  }, [staged]);

  const platform =
    chosenPlatform !== null && files.topologies.some((entry) => entry.id === chosenPlatform)
      ? chosenPlatform
      : platformOfFiles(files, inUse);
  const runnable = runnableOnBoth(scenarios?.scenarios ?? [], files, platform);
  const scenario = runnable.find((entry) => entry.id === chosenScenario) ?? runnable[0];
  const answer =
    asked !== null &&
    asked.files === staged &&
    asked.scenarioId === scenario?.id &&
    asked.platform === platform
      ? asked.answer
      : null;

  // Why there is no answer: the files could not be applied, or the server refused the question.
  const problem = failure ?? (typeof answer === 'string' ? answer : null);

  const run = async () => {
    if (!scenario) return;
    setBusy(true);
    setFailure(null);
    question.current += 1;
    const asking = question.current;
    const about = { files: staged, scenarioId: scenario.id, platform };
    let result: PlatformComparison | string;
    try {
      result = await api.comparePlatforms({
        files: staged,
        scenarioId: scenario.id,
        topologyId: platform,
      });
    } catch (cause) {
      result = cause instanceof ApiError ? cause.message : t('The comparison could not be run.');
    }
    // The form moved on while both runs were simulated: this answers what
    // it asked before, and is not put beside what it asks now.
    if (asking === question.current) setAsked({ ...about, answer: result });
    setBusy(false);
  };

  const watch = async (which: 'baseline' | 'variant') => {
    if (answer === null || typeof answer === 'string') return;
    setBusy(true);
    setFailure(null);
    if (which === 'variant') {
      // Run B is on a platform the server does not have until the files are applied.
      const applied = await actions.importWorkspace(staged);
      if (applied instanceof ApiError) {
        setBusy(false);
        setFailure(applied.message);
        return;
      }
    }
    const loaded = await actions.loadSession(answer[which].recording);
    setBusy(false);
    // Applied files stay applied whether or not the run could be loaded.
    if (loaded || which === 'variant') onLeave(which === 'variant');
  };

  return (
    <div
      className="mt-3 rounded-control border border-line px-2.5 py-2"
      data-testid="platform-runs"
    >
      <p className="text-[11px] leading-relaxed text-ink-dim">
        <span className="font-bold text-ink">{t('How would an incident go on each?')}</span>{' '}
        {t(
          'One scenario is run on the platform in use and on the one these files describe, from the same seed, on timelines of their own; nothing is applied.',
        )}
      </p>
      {scenario ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <Select
            label={t('Scenario')}
            value={scenario.id}
            onChange={(event) => setChosenScenario(event.target.value)}
            className="min-w-[12rem] flex-1"
            data-testid="platform-runs-scenario"
          >
            {runnable.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({formatClock(entry.durationMs)})
              </option>
            ))}
          </Select>
          {files.topologies.length > 1 && (
            <Select
              label={t('Platform of the files')}
              value={platform}
              onChange={(event) => setChosenPlatform(event.target.value)}
              className="min-w-[10rem] flex-1"
              data-testid="platform-runs-platform"
            >
              {files.topologies.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          )}
          <Button type="submit" size="sm" disabled={busy} data-testid="platform-runs-run">
            {busy ? t('Running both…') : answer ? t('Run both again') : t('Run both')}
          </Button>
        </form>
      ) : (
        scenarios && (
          <p
            className="mt-2 text-[11px] leading-relaxed text-ink-dim"
            data-testid="platform-runs-none"
          >
            {t(
              'No scenario can be run on both: it has to be in use and among these files, and able to run on each platform.',
            )}
          </p>
        )
      )}
      {problem && (
        <p
          role="alert"
          className="mt-2 text-[11px] text-critical"
          data-testid="platform-runs-error"
        >
          {problem}
        </p>
      )}
      {answer !== null && typeof answer !== 'string' && (
        <Results comparison={answer} busy={busy} onWatch={(which) => void watch(which)} />
      )}
    </div>
  );
}

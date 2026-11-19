/**
 * Where the platform gives, asked of the platform at rest.
 *
 * Two questions the server answers with runs of its own: how many times its
 * ordinary demand the platform takes before one of its objectives is missed,
 * and what each service takes with it when it is out. Each is asked for,
 * since it simulates many runs, and every figure on show is read from the
 * answer. Nothing here is a forecast: a multiple that was not run is not
 * spoken of, and a service is listed because the engine recorded it leaving
 * its normal state. The timeline in use is left alone until the viewer asks
 * to watch a run on it.
 */
import type { Headroom, WeakPoints } from '@aegis/contracts';
import { Play } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { actions } from '@/app/actions';
import { SourceBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ServiceName } from '@/components/ui/ServiceName';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { formatClock, formatMs, formatPercent } from '@/lib/format';
import { firstToLeave, objectiveLabel, objectivesMissed, timesDemand } from '@/lib/limits';
import { HEALTH_LABEL } from '@/lib/palette';
import { api, ApiError } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

/** Most services of the ranking written out before the rest are asked for. */
const SHOWN = 10;

const numeric = (children: ReactNode) => <span className="numeric text-ink">{children}</span>;
const strong = (children: ReactNode) => <span className="font-bold text-ink">{children}</span>;

type Answer<T> = { topologyId: string; result: T | string } | 'busy' | null;

function failure(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : t('The platform could not be tried.');
}

function HeadroomResult({ headroom, onWatch }: { headroom: Headroom; onWatch: () => void }) {
  const topology = useTelemetry((state) => state.topology);
  const [busy, setBusy] = useState(false);
  const first = firstToLeave(headroom);
  const gave = headroom.steps.find((step) => step.factor === headroom.givesAt);
  const highest = headroom.steps.at(-1)?.factor;
  const watch = async () => {
    if (!headroom.recording) return;
    setBusy(true);
    const ok = await actions.loadSession(headroom.recording);
    setBusy(false);
    if (ok) onWatch();
  };
  return (
    <div className="mt-3 space-y-3" role="status" data-testid="headroom-result">
      <p className="text-xs leading-relaxed text-ink" data-testid="headroom-answer">
        {headroom.givesAt === null
          ? tr(
              'Every objective is met up to <n>{holds}</n> the ordinary demand, the most that was tried.',
              { n: strong, holds: timesDemand(headroom.holdsAt ?? highest ?? 1) },
            )
          : headroom.holdsAt === null
            ? t('An objective is missed with the demand as it is: there is no room above it.')
            : tr(
                'Every objective is met at <n>{holds}</n> the ordinary demand. At <n>{gives}</n> one is missed: {missed}.',
                {
                  n: strong,
                  holds: timesDemand(headroom.holdsAt),
                  gives: timesDemand(headroom.givesAt),
                  missed: gave ? objectivesMissed(headroom, gave.missed) : '',
                },
              )}
      </p>
      {first && (
        <p className="text-[11px] leading-relaxed text-ink-dim" data-testid="headroom-first">
          {tr(
            'The first service to leave its normal state is {service}, at <n>{factor}</n>: it became {health} <n>{at}</n> after the demand began to rise.',
            {
              n: numeric,
              service: (
                <span className="text-ink">
                  <ServiceName topology={topology} id={first.effect.nodeId} />
                </span>
              ),
              factor: timesDemand(first.factor),
              health: HEALTH_LABEL[first.effect.health].toLowerCase(),
              at: formatClock(first.effect.atMs),
            },
          )}
        </p>
      )}
      <table className="w-full border-collapse text-xs" data-testid="headroom-table">
        <thead>
          <tr className="border-b border-line-strong text-left">
            <th scope="col" className="caption py-1 pr-2 font-normal">
              {t('Demand')}
            </th>
            <th scope="col" className="caption px-2 py-1 font-normal">
              {t('Highest error rate')}
            </th>
            <th scope="col" className="caption px-2 py-1 font-normal">
              {t('Highest latency p95')}
            </th>
            <th scope="col" className="caption px-2 py-1 font-normal">
              {t('Services not normal')}
            </th>
            <th scope="col" className="caption py-1 pl-2 font-normal">
              {t('Objectives')}
            </th>
          </tr>
        </thead>
        <tbody>
          {headroom.steps.map((step) => (
            <tr
              key={step.factor}
              className="border-b border-line last:border-b-0"
              data-testid={`headroom-step-${step.factor}`}
              data-gave={step.missed.length > 0}
            >
              <th scope="row" className="numeric py-1 pr-2 text-left font-bold text-ink">
                {timesDemand(step.factor)}
              </th>
              <td className="numeric px-2 py-1 text-ink">{formatPercent(step.peak.errorRate)}</td>
              <td className="numeric px-2 py-1 text-ink">{formatMs(step.peak.p95LatencyMs)}</td>
              <td className="numeric px-2 py-1 text-ink">{step.affected}</td>
              <td className="py-1 pl-2 text-ink-dim">
                {step.missed.length === 0
                  ? t('met throughout')
                  : t('missed: {objectives}', {
                      objectives: step.missed.map((kind) => objectiveLabel(kind)).join(', '),
                    })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {tr(
            headroom.clientIds.length === 1
              ? 'Each row is a run of <n>{duration}</n> from seed <n>{seed}</n>, with the demand of {clients} external client multiplied and held. Nothing is said of the multiples between two rows.'
              : 'Each row is a run of <n>{duration}</n> from seed <n>{seed}</n>, with the demand of {clients} external clients multiplied and held. Nothing is said of the multiples between two rows.',
            {
              n: (children) => <span className="numeric">{children}</span>,
              duration: formatClock(headroom.durationMs),
              seed: headroom.seed,
              clients: headroom.clientIds.length,
            },
          )}
        </span>
        <SourceBadge source={headroom.dataSource} />
      </p>
      {headroom.recording && headroom.givesAt !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={<Play size={12} aria-hidden />}
            disabled={busy}
            onClick={() => void watch()}
            data-testid="headroom-watch"
            title={t('Replaces the timeline in use with that run, to play back and scrub')}
          >
            {t('Watch the run at {factor} on the timeline', {
              factor: timesDemand(headroom.givesAt),
            })}
          </Button>
          <span className="caption">{t('Watching a run replaces the timeline in use.')}</span>
        </div>
      )}
    </div>
  );
}

function WeakPointsResult({
  points,
  onPick,
}: {
  points: WeakPoints;
  onPick: (id: string) => void;
}) {
  const topology = useTelemetry((state) => state.topology);
  const [all, setAll] = useState(false);
  const rows = all ? points.points : points.points.slice(0, SHOWN);
  const none = points.points.every((point) => point.affected.length === 0);
  return (
    <div className="mt-3 space-y-3" role="status" data-testid="weak-points-result">
      <p className="text-xs leading-relaxed text-ink">
        {none
          ? t('No service takes another out of its normal state when it is out.')
          : tr(
              points.points.length === 1
                ? '<e>{n} service</e> was taken out in turn, the platform otherwise at rest. The one that takes the most others with it is first.'
                : '<e>{n} services</e> were taken out in turn, the platform otherwise at rest. The one that takes the most others with it is first.',
              { e: strong, n: points.points.length },
            )}
      </p>
      <table className="w-full border-collapse text-xs" data-testid="weak-points-table">
        <thead>
          <tr className="border-b border-line-strong text-left">
            <th scope="col" className="caption py-1 pr-2 font-normal">
              {t('With this service out')}
            </th>
            <th scope="col" className="caption px-2 py-1 font-normal">
              {t('Others not normal')}
            </th>
            <th scope="col" className="caption px-2 py-1 font-normal">
              {t('Highest error rate')}
            </th>
            <th scope="col" className="caption py-1 pl-2 font-normal">
              {t('Objectives')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <tr
              key={point.nodeId}
              className="border-b border-line align-top last:border-b-0"
              data-testid={`weak-point-${point.nodeId}`}
            >
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                <button
                  type="button"
                  className="text-left text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                  onClick={() => onPick(point.nodeId)}
                  title={t('Show this service on the model')}
                >
                  <ServiceName topology={topology} id={point.nodeId} />
                </button>
                {point.affected.length > 0 && (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
                    {tr('first {service}, <n>{at}</n> later', {
                      n: (children) => <span className="numeric">{children}</span>,
                      service: <ServiceName topology={topology} id={point.affected[0]!.nodeId} />,
                      at: formatClock(point.affected[0]!.atMs),
                    })}
                  </span>
                )}
              </th>
              <td className="numeric px-2 py-1 text-ink">{point.affected.length}</td>
              <td className="numeric px-2 py-1 text-ink">{formatPercent(point.peak.errorRate)}</td>
              <td className="py-1 pl-2 text-ink-dim">
                {point.missed.length === 0
                  ? t('met throughout')
                  : t('missed: {objectives}', {
                      objectives: point.missed.map((kind) => objectiveLabel(kind)).join(', '),
                    })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {points.points.length > SHOWN && (
        <button
          type="button"
          className="text-[11px] text-ink-dim underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink"
          onClick={() => setAll(!all)}
          data-testid="weak-points-all"
        >
          {all
            ? t('Show the first {n} only', { n: SHOWN })
            : t('Show all {n}', { n: points.points.length })}
        </button>
      )}
      <p className="caption flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {tr(
            'Each row is what trying that one fault gives: a run of <n>{duration}</n> from seed <n>{seed}</n> with the service unreachable. A service is counted because the engine recorded it leaving its normal state.',
            {
              n: (children) => <span className="numeric">{children}</span>,
              duration: formatClock(points.durationMs),
              seed: points.seed,
            },
          )}
        </span>
        <SourceBadge source={points.dataSource} />
      </p>
    </div>
  );
}

/** One question: what it asks, the button that asks it, and what came back. */
function Question<T>({
  id,
  title,
  about,
  ask,
  asking,
  again,
  answer,
  onAsk,
  children,
}: {
  id: string;
  title: string;
  about: string;
  ask: string;
  asking: string;
  again: string;
  answer: Answer<T>;
  onAsk: () => void;
  children: (result: T) => ReactNode;
}) {
  const result = answer !== null && answer !== 'busy' ? answer.result : null;
  return (
    <section aria-labelledby={id} data-testid={id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={id} className="text-xs font-bold text-ink">
            {title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">{about}</p>
        </div>
        <Button size="sm" disabled={answer === 'busy'} onClick={onAsk} data-testid={`${id}-ask`}>
          {answer === 'busy' ? asking : result !== null ? again : ask}
        </Button>
      </div>
      {typeof result === 'string' && (
        <p role="alert" className="mt-2 text-xs text-critical">
          {result}
        </p>
      )}
      {result !== null && typeof result !== 'string' && children(result)}
    </section>
  );
}

export function LimitsDialog() {
  const open = useUi((state) => state.openPanel === 'limits');
  const topologyId = useTelemetry((state) => state.topology?.id);
  const [headroom, setHeadroom] = useState<Answer<Headroom>>(null);
  const [points, setPoints] = useState<Answer<WeakPoints>>(null);

  // An answer is about the platform it was asked of.
  useEffect(() => {
    setHeadroom((answer) =>
      answer !== null && answer !== 'busy' && answer.topologyId !== topologyId ? null : answer,
    );
    setPoints((answer) =>
      answer !== null && answer !== 'busy' && answer.topologyId !== topologyId ? null : answer,
    );
  }, [topologyId]);

  const ask = <T,>(question: () => Promise<T>, put: (answer: Answer<T>) => void) => {
    if (!topologyId) return;
    put('busy');
    question().then(
      (result) => put({ topologyId, result }),
      (cause: unknown) => put({ topologyId, result: failure(cause) }),
    );
  };
  const close = () => useUi.getState().setPanel(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'limits' : null)}
      title={t('Where the platform gives')}
      description={t(
        'Asked of the platform at rest, on timelines of their own. Every figure is a run of the engine; the timeline in use is not touched.',
      )}
      width="max-w-3xl"
    >
      <Question
        id="headroom"
        title={t('How much traffic it takes')}
        about={t(
          'The demand of every external client is multiplied by the same figure and held, at higher and higher figures until an objective is missed, then between the last that held and the first that did not.',
        )}
        ask={t('Find the limit')}
        asking={t('Running…')}
        again={t('Find it again')}
        answer={headroom}
        onAsk={() => ask(api.findHeadroom, setHeadroom)}
      >
        {(result) => <HeadroomResult headroom={result} onWatch={close} />}
      </Question>
      <div className="mt-4 border-t border-line pt-4">
        <Question
          id="weak-points"
          title={t('What each service takes with it')}
          about={t(
            'Every service is made unreachable in turn, as trying that fault on its card does, and the others that leave their normal state are counted.',
          )}
          ask={t('Try every service')}
          asking={t('Running…')}
          again={t('Try them again')}
          answer={points}
          onAsk={() => ask(api.findWeakPoints, setPoints)}
        >
          {(result) => (
            <WeakPointsResult
              points={result}
              onPick={(id) => {
                close();
                useUi.getState().selectNode(id);
              }}
            />
          )}
        </Question>
      </div>
    </Dialog>
  );
}

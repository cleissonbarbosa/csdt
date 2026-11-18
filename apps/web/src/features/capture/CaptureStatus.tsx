import { useMemo } from 'react';

import { HealthGlyph } from '@/components/ui/Badge';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { cn } from '@/lib/cn';
import { HEALTH_COLOR } from '@/lib/palette';
import { useCapture } from '@/stores/capture';

import { statusAt, type CaptureStatus as Status } from './capture';
import { useMoment, utcTime } from './present';

const LEVEL = { 1: 'degraded', 2: 'critical' } as const;

/**
 * What the capture says at the cursor, in one sentence for the bar. It
 * counts what colours the model, and never puts a service whose state is
 * not given among those whose state is: a metrics capture counts the
 * services past the simulation's error levels out of those whose errors were
 * measured, a report the services it states as affected or recovering, and
 * either says how many the source says nothing about.
 */
export function captureSentence(status: Status, total: number): string {
  if (status.kind === 'report') {
    const { affected, recovering, notStated } = status;
    const stated = total - notStated;
    if (affected > 0 && recovering > 0) {
      if (notStated > 0) {
        return t(
          affected === 1
            ? '{affected} service reported affected, {recovering} recovering; {notStated} not stated'
            : '{affected} services reported affected, {recovering} recovering; {notStated} not stated',
          { affected, recovering, notStated },
        );
      }
      return t(
        affected === 1
          ? '{affected} service reported affected, {recovering} recovering'
          : '{affected} services reported affected, {recovering} recovering',
        { affected, recovering },
      );
    }
    if (affected > 0) {
      if (notStated > 0) {
        return t(
          affected === 1
            ? '{affected} service reported affected; {notStated} not stated'
            : '{affected} services reported affected; {notStated} not stated',
          { affected, notStated },
        );
      }
      return t(
        affected === 1
          ? '{affected} service reported affected'
          : '{affected} services reported affected',
        { affected },
      );
    }
    if (recovering > 0) {
      if (notStated > 0) {
        return t(
          recovering === 1
            ? '{recovering} service reported recovering; {notStated} not stated'
            : '{recovering} services reported recovering; {notStated} not stated',
          { recovering, notStated },
        );
      }
      return t(
        recovering === 1
          ? '{recovering} service reported recovering'
          : '{recovering} services reported recovering',
        { recovering },
      );
    }
    if (stated === 0) {
      return t(
        total === 1
          ? '{n} service, not stated yet in the report'
          : '{n} services, none stated yet in the report',
        { n: total },
      );
    }
    // Nothing affected and nothing recovering: whatever was stated has recovered.
    if (notStated > 0) {
      return t(
        stated === 1
          ? '{n} service reported recovered; {notStated} not stated'
          : '{n} services reported recovered; {notStated} not stated',
        { n: stated, notStated },
      );
    }
    return t(stated === 1 ? '{n} service reported recovered' : '{n} services reported recovered', {
      n: stated,
    });
  }

  const { past, known, unknownMeasured: unknown } = status;
  if (!status.measuredNow) return t('No measurements at this time');
  const measured = known + unknown;
  if (measured === 0) return t('No service measured at this time');
  if (!status.errorsInCapture) {
    return t(
      measured === 1
        ? '{n} service measured; error counts are not in this capture'
        : '{n} services measured; error counts are not in this capture',
      { n: measured },
    );
  }
  // A service whose state the sample does not show has no error rate there:
  // its sample may count errors, but not the requests to take them against.
  if (known === 0) {
    return t(
      unknown === 1
        ? '{n} service measured, without an error rate at this time'
        : '{n} services measured, none with an error rate at this time',
      { n: unknown },
    );
  }
  if (past > 0) {
    // With one service whose state is known, it is the one past them.
    if (known === 1) {
      return unknown > 0
        ? t('{known} service, past the error levels; {unknown} without an error rate', {
            known,
            unknown,
          })
        : t('{known} service, past the error levels', { known });
    }
    return unknown > 0
      ? t('{past} of {known} services past the error levels; {unknown} without an error rate', {
          past,
          known,
          unknown,
        })
      : t('{past} of {known} services past the error levels', { past, known });
  }
  if (unknown > 0) {
    return t(
      known === 1
        ? '{known} service, not past the error levels; {unknown} without an error rate'
        : '{known} services, none past the error levels; {unknown} without an error rate',
      { known, unknown },
    );
  }
  return t(
    known === 1
      ? '{known} service, not past the error levels'
      : '{known} services, none past the error levels',
    { known },
  );
}

/** The level the sentence speaks in: past normal only when something colours the model. */
export function sentenceLevel(status: Status): 0 | 1 | 2 {
  const loud = status.kind === 'report' ? status.affected + status.recovering > 0 : status.past > 0;
  return loud ? status.worst : 0;
}

/**
 * The time the sentence speaks of, to the minute: the one part of it that
 * follows the capture's clock, and so the only part drawn again as it runs.
 */
function StatusClock() {
  const minute = useCapture((state) => Math.floor(state.atMs / 60_000));
  return <>{utcTime(minute * 60_000, false)}</>;
}

/**
 * The bar's sentence while a capture is open, in place of the platform's.
 * It says at what time it speaks (the date is on the capture's bar), is
 * quiet while nothing colours the model and takes the colour and glyph of
 * the worst state when something does, as the platform's sentence does. It
 * never blinks: nothing in a capture is waiting to be acknowledged. It leads
 * to the capture's events.
 *
 * What it says changes only where the capture does (`useMoment`), so it is
 * worked out and announced there and not at every tick of the clock; only
 * the minute in front of it follows the clock, and it is not announced.
 */
export function CaptureStatus() {
  const capture = useCapture((state) => state.capture);
  const moment = useMoment();
  const status = useMemo(() => (capture ? statusAt(capture, moment) : null), [capture, moment]);
  if (!capture || !status) return null;

  const level = sentenceLevel(status);
  const sentence = captureSentence(status, capture.nodes.length);
  const loud = level > 0;

  return (
    <div className="min-w-0">
      <button
        type="button"
        className={cn(
          'flex min-w-0 max-w-full items-center gap-2 rounded-control px-1.5 py-1 text-left text-xs transition-colors hover:bg-raised',
          loud ? 'font-bold' : 'text-ink-faint hover:text-ink',
        )}
        style={loud ? { color: HEALTH_COLOR[LEVEL[level as 1 | 2]] } : undefined}
        // The sentence is cut where the bar is short of room; pointing at it
        // says all of it, and then what the button does.
        title={`${sentence}. ${t('Show the events of the capture')}`}
        onClick={() => useCapture.getState().setList(true, 'events')}
        data-testid="capture-status"
        data-level={level}
        data-kind={status.kind}
      >
        {loud && <HealthGlyph health={LEVEL[level as 1 | 2]} size={10} />}
        <span className="truncate">
          {tr('At {time} UTC: {sentence}', { time: <StatusClock />, sentence })}
        </span>
      </button>
      {/* Read out when what the capture says changes, and only then: the
          minute moves with the clock and is not part of it. */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="capture-status-said"
      >
        {sentence}
      </span>
    </div>
  );
}

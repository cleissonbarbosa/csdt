/**
 * What a draft written from a capture holds, in the interface's words: the
 * lines the import dialog shows above the staged files, so that what was
 * measured and what is a default is read before anything is applied.
 */
import { formatRate } from '@/lib/format';

import { t } from '@/i18n';

import type { Capture } from './capture';
import { DEFAULT_DEMAND_RPS, DEFAULT_LATENCY_MS, type Draft, type DraftRefusal } from './draft';

export function draftNotes(capture: Capture, draft: Draft, demandRps: number | null): string[] {
  const notes = [
    t(
      'Drafted in this page from the capture “{title}”: {services} of its services and {connections} of the connections it saw. A starting point to edit; nothing is applied until you apply it.',
      { title: capture.title, services: draft.services, connections: draft.connections },
    ),
    t(
      'Connection weights: {measured} read from the capture (calls seen over requests the caller handled, at rest), {assumed} left at 1.',
      draft.weights,
    ),
    t(
      'Latency at rest: {measured} read from the capture (median p95 less that of what each service calls), {assumed} at a placeholder of {ms} ms.',
      { ...draft.latency, ms: DEFAULT_LATENCY_MS },
    ),
    draft.demand === 'measured' && demandRps !== null
      ? t(
          'Demand: {rate} req/s, the median the entry was seen to receive at rest, from one client added in front of it.',
          { rate: formatRate(demandRps) },
        )
      : draft.demand === 'convention' && demandRps !== null
        ? t(
            'Demand: {rate} req/s, by convention. The capture did not count the requests its entry handled, so the entry is taken to be as busy as its busiest call. The calls it makes downstream come out as measured; its own load rests on that convention.',
            { rate: formatRate(demandRps) },
          )
        : t('Demand: a default of {rate} req/s. The capture measured no requests at its entry.', {
            rate: DEFAULT_DEMAND_RPS,
          }),
  ];
  if (draft.unconnected > 0) {
    notes.push(
      t(
        draft.unconnected === 1
          ? '{n} service was seen in no call: it is in the platform, connected to nothing.'
          : '{n} services were seen in no call: they are in the platform, connected to nothing.',
        { n: draft.unconnected },
      ),
    );
  }
  if (draft.leftOut.length > 0) {
    notes.push(
      t('Left out so that calls run one way, as a topology has to: {connections}.', {
        connections: draft.leftOut.map((edge) => `${edge.source} → ${edge.target}`).join(', '),
      }),
    );
  }
  notes.push(
    t(
      'No capture states a capacity. Each service has the model’s default headroom over its load at rest: give capacityRps to the services whose limits you know before reading what breaks.',
    ),
  );
  if (draft.scenario) {
    notes.push(
      draft.scenario.compression > 1
        ? t(
            'A scenario repeats the load the capture measured, from ×{low} to ×{high} of its level at rest. It prescribes load and nothing else. One second of it is {n} seconds of the capture.',
            { low: draft.scenario.low, high: draft.scenario.high, n: draft.scenario.compression },
          )
        : t(
            'A scenario repeats the load the capture measured, from ×{low} to ×{high} of its level at rest. It prescribes load and nothing else.',
            { low: draft.scenario.low, high: draft.scenario.high },
          ),
    );
  }
  return notes;
}

export function draftRefusal(refusal: DraftRefusal): string {
  return refusal === 'id-too-long'
    ? t(
        'No draft can be written: a service of this capture has an id longer than a platform file takes (64 characters).',
      )
    : t('No draft can be written: this capture holds no service, only clients.');
}

/**
 * The transport to the engine running in this tab. A request is answered
 * with a real `Response`, so the REST client above reads it exactly as it
 * reads the server's.
 */
import { t } from '@/i18n';
import type { Transport } from '@/providers/transport';

import { EngineError } from './binding';
import { language } from '@/i18n';

import { EngineClient } from './client';
import type { WorkerLike } from './messages';

const client = new EngineClient(
  () =>
    new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      // The worker reads the page's language from its name (`i18n`).
      name: `aegis-engine:${language}`,
    }) as unknown as WorkerLike,
);

export const transport: Transport = {
  engine: 'browser',
  async fetch(url, request) {
    // Only the path means anything: there is no host to send it to.
    const { pathname, search } = new URL(url, 'http://engine.invalid');
    const answer = await client.request(
      request.method,
      `${pathname}${search}`,
      request.body,
      request.signal,
    );
    const status = answer.status >= 200 && answer.status <= 599 ? answer.status : 502;
    return new Response(answer.body, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  },
  socket: () => client.socket(),
  unanswered: (timedOut, cause) =>
    timedOut
      ? t('The simulation engine did not answer in time.')
      : cause instanceof EngineError
        ? cause.message
        : t('The simulation engine is not running.'),
};

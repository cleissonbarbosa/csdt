/**
 * Where the simulation runs, and the words the interface uses for it. The
 * application is built for one of two hosts (`providers/transport.ts`): the
 * AEGIS server, or the same engine compiled to WebAssembly and running in
 * this tab. What the interface shows is the same; what it calls the thing
 * that answers, and what it can offer around it, is not.
 */
import { transport } from '@transport';

import { t } from '@/i18n';

/** Whether the simulation runs in this tab rather than on a server. */
export const IN_BROWSER = transport.engine === 'browser';

export const HOST = IN_BROWSER
  ? {
      /** A request got no answer. */
      unreachable: t('The simulation engine is not running.'),
      asking: t('Asking the engine…'),
      /** While the stream is not open, in the top bar. */
      connecting: t('Loading the engine'),
      reconnecting: t('Engine stopped'),
      /** How synthetic data came to be. */
      synthetic: t('Produced by the simulation engine, which runs in this tab.'),
      /** The files everything started from, as the object of a sentence. */
      started: t('what this page opened with'),
      imported: t(
        'Files imported into this page. They are held in its memory and are gone when it is reloaded.',
      ),
      backToStart: t('Back to the files this page opened with.'),
      adapters: t(
        'This page runs the simulation in the browser. The live adapters (a local cedar-agent, a load-test target) need the AEGIS server.',
      ),
      agent: t(
        'Evaluating with a local cedar-agent needs the AEGIS server. This page has the embedded engine only.',
      ),
    }
  : {
      unreachable: t('The server could not be reached.'),
      asking: t('Asking the server…'),
      connecting: t('Connecting'),
      reconnecting: t('Reconnecting'),
      synthetic: t('Produced by the built-in simulation engine.'),
      started: t('what the server started with'),
      imported: t(
        'Files imported since this server started. They are held in its memory and are gone when it restarts.',
      ),
      backToStart: t('Back to the files the server started with.'),
      adapters: t(
        'Live adapters only accept loopback targets (or hosts explicitly allow-listed on the server), use short timeouts and never follow redirects.',
      ),
      agent: t('Connect a local cedar-agent under Integrations to evaluate with it instead.'),
    };

/**
 * How long Cedar took. The server times the evaluation; the engine in the
 * browser has no clock of its own to time it with, and a figure that was
 * not measured is not shown as one.
 */
export function evaluationTime(micros: number): string {
  return IN_BROWSER ? t('not timed in the browser') : t('{n} µs measured', { n: micros });
}

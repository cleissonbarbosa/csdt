/**
 * Where the simulation runs, and the words the interface uses for it. The
 * application is built for one of two hosts (`providers/transport.ts`): the
 * AEGIS server, or the same engine compiled to WebAssembly and running in
 * this tab. What the interface shows is the same; what it calls the thing
 * that answers, and what it can offer around it, is not.
 */
import { transport } from '@transport';

/** Whether the simulation runs in this tab rather than on a server. */
export const IN_BROWSER = transport.engine === 'browser';

export const HOST = IN_BROWSER
  ? {
      /** A request got no answer. */
      unreachable: 'The simulation engine is not running.',
      asking: 'Asking the engine…',
      /** While the stream is not open, in the top bar. */
      connecting: 'Loading the engine',
      reconnecting: 'Engine stopped',
      /** How synthetic data came to be. */
      synthetic: 'Produced by the simulation engine, which runs in this tab.',
      /** The files everything started from, as the object of a sentence. */
      started: 'what this page opened with',
      imported:
        'Files imported into this page. They are held in its memory and are gone when it is reloaded.',
      backToStart: 'Back to the files this page opened with.',
      adapters:
        'This page runs the simulation in the browser and connects to nothing. The live adapters (a local cedar-agent, a load-test target) need the AEGIS server. Fixtures are files parsed in the format of a public project; importing them contacts nothing.',
      agent:
        'Evaluating with a local cedar-agent needs the AEGIS server. This page has the embedded engine only.',
    }
  : {
      unreachable: 'The server could not be reached.',
      asking: 'Asking the server…',
      connecting: 'Connecting',
      reconnecting: 'Reconnecting',
      synthetic: 'Produced by the built-in simulation engine.',
      started: 'what the server started with',
      imported:
        'Files imported since this server started. They are held in its memory and are gone when it restarts.',
      backToStart: 'Back to the files the server started with.',
      adapters:
        'Live adapters only accept loopback targets (or hosts explicitly allow-listed on the server), use short timeouts and never follow redirects. Fixtures are local files parsed in the format of a public project; importing them contacts nothing.',
      agent: 'Connect a local cedar-agent under Integrations to evaluate with it instead.',
    };

/**
 * How long Cedar took. The server times the evaluation; the engine in the
 * browser has no clock of its own to time it with, and a figure that was
 * not measured is not shown as one.
 */
export function evaluationTime(micros: number): string {
  return IN_BROWSER ? 'not timed in the browser' : `${micros} µs measured`;
}

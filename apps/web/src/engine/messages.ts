/** What the page and the engine's worker say to each other. */

/** Seed of the simulation; the server's own default. */
export const DEFAULT_SEED = 42;

export type ToWorker =
  | { type: 'request'; id: number; method: string; path: string; body?: string }
  /** A subscriber opened the stream. */
  | { type: 'open' }
  /** The subscriber's own message, as it would be sent over the socket. */
  | { type: 'message'; text: string }
  /** The subscriber went away. */
  | { type: 'close' };

export type FromWorker =
  | { type: 'ready' }
  /** The engine could not start, or stopped. Nothing follows. */
  | { type: 'failed'; message: string }
  | { type: 'response'; id: number; status: number; body: string }
  /** Stream messages, each one JSON text. */
  | { type: 'stream'; messages: string[] };

/** The part of a `Worker` the page uses; lets tests supply a fake. */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  onmessage: ((event: { data: FromWorker }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

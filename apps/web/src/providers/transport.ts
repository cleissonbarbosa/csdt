/**
 * Where requests and the stream go. There are two answers, chosen when the
 * application is built: the AEGIS server, over HTTP and a WebSocket, or the
 * same engine compiled to WebAssembly and running in this tab. Everything
 * above this line (the REST client, the stream client, the contracts they
 * check) is the same code for both.
 *
 * The `@transport` import resolves to one of the two implementations; see
 * `vite.config.ts`.
 */

/** The subset of `WebSocket` the stream client needs. */
export interface SocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface TransportRequest {
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface Transport {
  /** Where the simulation runs. Decides the words the interface uses for it. */
  readonly engine: 'server' | 'browser';
  /** One request, answered as `fetch` answers. */
  fetch(url: string, request: TransportRequest): Promise<Response>;
  /** The stream, as a socket. */
  socket(url: string): SocketLike;
  /** What to say when a request got no answer at all. */
  unanswered(timedOut: boolean, cause: unknown): string;
}

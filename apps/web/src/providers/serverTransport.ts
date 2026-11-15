/** The transport to the AEGIS server: `fetch` and a WebSocket. */
import type { SocketLike, Transport } from './transport';

export const transport: Transport = {
  engine: 'server',
  // Looked up at the time of the call, so a test can put its own in place.
  fetch: (url, request) => fetch(url, request),
  socket: (url) => new WebSocket(url) as SocketLike,
  unanswered: (timedOut) =>
    timedOut ? 'The AEGIS server did not answer in time.' : 'The AEGIS server is unreachable.',
};

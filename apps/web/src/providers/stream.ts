/**
 * Resilient client for `WS /api/v1/stream`.
 *
 * - Validates every message against the shared contract.
 * - Reconnects with exponential backoff and jitter.
 * - Tracks the last event sequence number it saw and asks the server to
 *   replay what it missed after a reconnect or a `lagged` notice.
 * - Measures round-trip time with application-level pings.
 */
import {
  StreamMessageSchema,
  type ClientMessage,
  type ConnectionState,
  type StreamMessage,
} from '@aegis/contracts';
import { transport } from '@transport';

import type { SocketLike } from './transport';

export type { SocketLike };

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;
const PING_INTERVAL_MS = 5000;
/** A connection that stays silent this long is considered dead. */
const STALE_AFTER_MS = 12_000;

export interface StreamClientOptions {
  url: string;
  onMessage: (message: StreamMessage) => void;
  onState: (state: ConnectionState) => void;
  onLatency?: (milliseconds: number) => void;
  /** Called with a description when a message fails contract validation. */
  onViolation?: (reason: string) => void;
  /** Defaults to the transport's socket; tests supply a fake. */
  createSocket?: (url: string) => SocketLike;
  /** Injectable for tests. */
  now?: () => number;
  random?: () => number;
}

const OPEN = 1;

export class StreamClient {
  private socket: SocketLike | null = null;
  private state: ConnectionState = 'idle';
  private attempt = 0;
  private lastSeq = 0;
  private lastMessageAt = 0;
  private everConnected = false;
  private adoptSnapshotSequence = false;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: StreamClientOptions) {
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  /** Sequence number of the newest event received so far. */
  get lastSequence(): number {
    return this.lastSeq;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      socket.close();
    }
    this.setState('closed');
  }

  /** Forget the event cursor, e.g. after the timeline was reset. */
  resetSequence(seq = 0): void {
    this.lastSeq = seq;
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onState(state);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private open(): void {
    this.setState(this.everConnected ? 'reconnecting' : 'connecting');
    const create = this.options.createSocket ?? transport.socket;
    let socket: SocketLike;
    try {
      socket = create(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      const resumed = this.everConnected;
      this.everConnected = true;
      this.attempt = 0;
      this.lastMessageAt = this.now();
      this.setState('open');
      // Anything that happened while we were away is replayed.
      if (resumed && this.lastSeq > 0) this.send({ type: 'resync', afterSeq: this.lastSeq });
      this.pingTimer = setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
    };
    socket.onmessage = (event) => this.receive(event.data);
    socket.onerror = () => {
      // `onclose` always follows and handles reconnection.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private heartbeat(): void {
    if (this.now() - this.lastMessageAt > STALE_AFTER_MS) {
      // Half-open connection: force a reconnect.
      this.socket?.close();
      return;
    }
    this.send({ type: 'ping', t: this.now() });
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    const backoff = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** this.attempt);
    this.attempt += 1;
    // Full jitter keeps reconnecting clients from synchronising.
    const delay = backoff * (0.5 + this.random() * 0.5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private receive(data: unknown): void {
    this.lastMessageAt = this.now();
    if (typeof data !== 'string') return;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      this.options.onViolation?.('message is not JSON');
      return;
    }
    const parsed = StreamMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.options.onViolation?.('message does not match stream contract v1');
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case 'events': {
        // Replayed events may overlap with ones already delivered.
        const fresh = message.data.filter((event) => event.seq > this.lastSeq);
        if (fresh.length === 0) return;
        this.lastSeq = fresh[fresh.length - 1]!.seq;
        this.options.onMessage({ type: 'events', data: fresh });
        return;
      }
      case 'lagged':
        this.send({ type: 'resync', afterSeq: this.lastSeq });
        break;
      case 'pong':
        this.options.onLatency?.(Math.max(0, this.now() - message.t));
        return;
      case 'timeline':
        // History changed shape: the event cursor is re-read from the
        // snapshot the server sends right after this notice.
        this.adoptSnapshotSequence = true;
        break;
      case 'snapshot':
        if (this.adoptSnapshotSequence) {
          this.adoptSnapshotSequence = false;
          this.lastSeq = message.data.seq;
        }
        break;
      default:
        break;
    }
    this.options.onMessage(message);
  }
}

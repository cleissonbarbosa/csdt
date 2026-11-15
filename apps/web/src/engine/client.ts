/**
 * The page's side of the in-browser engine: one worker, requests matched to
 * their answers by id, and the stream handed to whoever opened it. It knows
 * nothing about what is asked; it only carries it.
 */
import type { SocketLike } from '@/providers/transport';

import { EngineError } from './binding';
import type { FromWorker, WorkerLike } from './messages';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

interface Pending {
  resolve: (answer: { status: number; body: string }) => void;
  reject: (reason: unknown) => void;
}

/** The stream of the engine, shaped like the socket the stream client expects. */
class EngineSocket implements SocketLike {
  readyState = CONNECTING;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(private readonly client: EngineClient) {}

  send(data: string): void {
    if (this.readyState === OPEN) this.client.say(this, data);
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.client.release(this);
    queueMicrotask(() => this.onclose?.({}));
  }
}

export class EngineClient {
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private ready = false;
  private failure: EngineError | null = null;
  /** The one subscriber. A newer socket takes the place of an older one. */
  private subscriber: EngineSocket | null = null;

  /** `spawn` starts the worker; it is called once, when first needed. */
  constructor(private readonly spawn: () => WorkerLike) {}

  /** Why the engine is not running, once it is not. */
  get stopped(): EngineError | null {
    return this.failure;
  }

  private start(): WorkerLike | null {
    if (this.worker || this.failure) return this.worker;
    try {
      const worker = this.spawn();
      worker.onmessage = (event) => this.receive(event.data);
      worker.onerror = () => this.fail('The simulation engine could not be loaded.');
      this.worker = worker;
    } catch {
      this.fail('This browser could not start the simulation engine.');
    }
    return this.worker;
  }

  private fail(message: string): void {
    if (this.failure) return;
    this.failure = new EngineError(message);
    this.worker?.terminate();
    this.worker = null;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const { reject } of waiting) reject(this.failure);
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (subscriber && subscriber.readyState !== CLOSED) {
      subscriber.readyState = CLOSED;
      subscriber.onclose?.({});
    }
  }

  private receive(message: FromWorker): void {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.connect();
        break;
      case 'failed':
        this.fail(message.message);
        break;
      case 'response': {
        const waiting = this.pending.get(message.id);
        this.pending.delete(message.id);
        waiting?.resolve({ status: message.status, body: message.body });
        break;
      }
      case 'stream': {
        const subscriber = this.subscriber;
        if (subscriber?.readyState !== OPEN) break;
        for (const data of message.messages) subscriber.onmessage?.({ data });
        break;
      }
    }
  }

  /** Opens the subscriber's stream once the engine is running. */
  private connect(): void {
    const subscriber = this.subscriber;
    if (!this.ready || !this.worker || subscriber?.readyState !== CONNECTING) return;
    subscriber.readyState = OPEN;
    subscriber.onopen?.({});
    this.worker.postMessage({ type: 'open' });
  }

  /**
   * One request. `signal` gives up on the answer of a running engine. While
   * the module is still being fetched and compiled a request waits for it
   * however long that takes: the time it is given starts when there is
   * something to answer.
   */
  request(
    method: string,
    path: string,
    body?: string,
    signal?: AbortSignal,
  ): Promise<{ status: number; body: string }> {
    const worker = this.start();
    if (!worker)
      return Promise.reject(this.failure ?? new EngineError('The engine is not running.'));
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      signal?.addEventListener(
        'abort',
        () => {
          // The answer, if it still comes, is dropped.
          if (this.ready && this.pending.delete(id)) {
            reject(new DOMException('Aborted', 'AbortError'));
          }
        },
        { once: true },
      );
      worker.postMessage({
        type: 'request',
        id,
        method,
        path,
        ...(body === undefined ? {} : { body }),
      });
    });
  }

  /** The stream, as a socket that opens when the engine is running. */
  socket(): SocketLike {
    const socket = new EngineSocket(this);
    const previous = this.subscriber;
    this.subscriber = socket;
    if (previous && previous.readyState !== CLOSED) {
      previous.readyState = CLOSED;
      queueMicrotask(() => previous.onclose?.({}));
    }
    // The caller attaches its handlers after this returns.
    queueMicrotask(() => {
      if (this.subscriber !== socket || socket.readyState !== CONNECTING) return;
      if (!this.start()) {
        socket.readyState = CLOSED;
        this.subscriber = null;
        socket.onclose?.({});
        return;
      }
      this.connect();
    });
    return socket;
  }

  /** A subscriber's own message, on its way to the engine. */
  say(socket: SocketLike, text: string): void {
    if (this.subscriber === socket) this.worker?.postMessage({ type: 'message', text });
  }

  /** The subscriber went away. */
  release(socket: SocketLike): void {
    if (this.subscriber !== socket) return;
    this.subscriber = null;
    this.worker?.postMessage({ type: 'close' });
  }
}

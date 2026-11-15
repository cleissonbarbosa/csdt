/**
 * `DemoSimulationProvider`: the production `TelemetryProvider`, backed by the
 * AEGIS server's REST API and telemetry stream. All data it yields is
 * produced by the server's simulation engine and is labelled synthetic.
 */
import type {
  ConnectionState,
  PlaybackState,
  SecurityEvent,
  StreamMessage,
  TelemetryProvider,
  TelemetrySnapshot,
  TimelineReason,
  Topology,
  Unsubscribe,
} from '@aegis/contracts';

import { api, streamUrl, type AegisApi } from './api';
import { StreamClient, type StreamClientOptions } from './stream';

type Listener<A extends unknown[]> = (...args: A) => void;

class Emitter<A extends unknown[]> {
  private readonly listeners = new Set<Listener<A>>();

  subscribe(listener: Listener<A>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(...args: A): void {
    for (const listener of this.listeners) listener(...args);
  }
}

export interface DemoProviderOptions {
  client?: AegisApi;
  url?: string;
  createStream?: (options: StreamClientOptions) => StreamClient;
}

export class DemoSimulationProvider implements TelemetryProvider {
  readonly dataSource = 'synthetic' as const;

  private readonly client: AegisApi;
  private readonly stream: StreamClient;
  private readonly snapshots = new Emitter<[TelemetrySnapshot]>();
  private readonly events = new Emitter<[SecurityEvent]>();
  private readonly timeline = new Emitter<[TimelineReason, PlaybackState]>();
  private readonly connection = new Emitter<[ConnectionState]>();
  private readonly latency = new Emitter<[number]>();
  private latest: TelemetrySnapshot | null = null;
  private waiters: ((snapshot: TelemetrySnapshot) => void)[] = [];

  constructor(options: DemoProviderOptions = {}) {
    this.client = options.client ?? api;
    const streamOptions: StreamClientOptions = {
      url: options.url ?? streamUrl(),
      onMessage: (message) => this.dispatch(message),
      onState: (state) => this.connection.emit(state),
      onLatency: (ms) => this.latency.emit(ms),
      onViolation: (reason) => console.warn(`[aegis] dropped stream message: ${reason}`),
    };
    this.stream = options.createStream?.(streamOptions) ?? new StreamClient(streamOptions);
  }

  private dispatch(message: StreamMessage): void {
    switch (message.type) {
      case 'snapshot': {
        this.latest = message.data;
        this.snapshots.emit(message.data);
        const waiting = this.waiters;
        this.waiters = [];
        for (const resolve of waiting) resolve(message.data);
        break;
      }
      case 'events':
        for (const event of message.data) this.events.emit(event);
        break;
      case 'timeline':
        this.timeline.emit(message.reason, message.playback);
        break;
      default:
        break;
    }
  }

  connect(): Promise<void> {
    this.stream.start();
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.stream.stop();
    return Promise.resolve();
  }

  getTopology(): Promise<Topology> {
    return this.client.topology();
  }

  /** The most recent snapshot, waiting for the first one if necessary. */
  getSnapshot(): Promise<TelemetrySnapshot> {
    if (this.latest) return Promise.resolve(this.latest);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  subscribeSnapshots(callback: (snapshot: TelemetrySnapshot) => void): Unsubscribe {
    return this.snapshots.subscribe(callback);
  }

  subscribeEvents(callback: (event: SecurityEvent) => void): Unsubscribe {
    return this.events.subscribe(callback);
  }

  subscribeTimeline(
    callback: (reason: TimelineReason, playback: PlaybackState) => void,
  ): Unsubscribe {
    return this.timeline.subscribe(callback);
  }

  subscribeConnection(callback: (state: ConnectionState) => void): Unsubscribe {
    return this.connection.subscribe(callback);
  }

  /** Round-trip time of application-level pings, in milliseconds. */
  subscribeLatency(callback: (milliseconds: number) => void): Unsubscribe {
    return this.latency.subscribe(callback);
  }
}

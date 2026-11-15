/**
 * The boundary of the in-browser engine (`apps/wasm`), from the JavaScript
 * side. The module imports nothing; text goes in through a buffer it owns and
 * comes out of another, as lines. This file knows that layout and nothing
 * about workers or the DOM, so the same code drives the module in a test.
 */

/** Version of the boundary this file was written for. */
export const ABI_VERSION = 1;

/** What the module exports. */
export interface EngineExports {
  memory: WebAssembly.Memory;
  aegis_abi(): number;
  aegis_period_ms(): number;
  aegis_input(length: number): number;
  aegis_output(): number;
  aegis_boot(seed: number, nowMs: number): number;
  aegis_request(length: number, nowMs: number): number;
  aegis_advance(elapsedMs: number, nowMs: number): number;
  aegis_open(nowMs: number): number;
  aegis_message(length: number, nowMs: number): number;
  aegis_panic(): number;
  aegis_panic_len(): number;
}

const FUNCTIONS = [
  'aegis_abi',
  'aegis_period_ms',
  'aegis_input',
  'aegis_output',
  'aegis_boot',
  'aegis_request',
  'aegis_advance',
  'aegis_open',
  'aegis_message',
  'aegis_panic',
  'aegis_panic_len',
] as const satisfies readonly (keyof EngineExports)[];

/** The engine could not start, or stopped. It does not come back. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** One response: what the server would have sent, and what it told the stream. */
export interface EngineAnswer {
  status: number;
  /** The response body as text (JSON). */
  body: string;
  /** Stream messages the request produced, each one JSON text. */
  stream: string[];
}

function split(lines: string): string[] {
  return lines === '' ? [] : lines.split('\n');
}

export class Engine {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private stopped: EngineError | null = null;

  private constructor(private readonly exports: EngineExports) {}

  /** Wraps an instantiated module, refusing one that is not this engine. */
  static from(exports: WebAssembly.Exports): Engine {
    const candidate = exports as Partial<Record<keyof EngineExports, unknown>>;
    const missing = FUNCTIONS.filter((name) => typeof candidate[name] !== 'function');
    if (missing.length > 0 || !(candidate.memory instanceof WebAssembly.Memory)) {
      throw new EngineError('The module is not the AEGIS engine.');
    }
    const engine = new Engine(exports as unknown as EngineExports);
    const version = engine.exports.aegis_abi();
    if (version !== ABI_VERSION) {
      throw new EngineError(
        `The engine module speaks version ${version} of its boundary and this page version ${ABI_VERSION}. Rebuild it.`,
      );
    }
    return engine;
  }

  /** How often `advance` should be called, in milliseconds. */
  get periodMs(): number {
    return this.exports.aegis_period_ms();
  }

  /** Why the engine stopped, once it has. */
  get failure(): EngineError | null {
    return this.stopped;
  }

  /**
   * Runs one call into the module. A trap is a panic on the other side: what
   * it said is read back and the engine is not called again.
   */
  private call(run: (exports: EngineExports) => number): string {
    if (this.stopped) throw this.stopped;
    const { exports } = this;
    try {
      const length = run(exports);
      // The memory may have grown during the call: look at it afresh.
      return this.decoder.decode(
        new Uint8Array(exports.memory.buffer, exports.aegis_output(), length),
      );
    } catch (cause) {
      let said = '';
      try {
        const length = exports.aegis_panic_len();
        if (length > 0) {
          said = this.decoder.decode(
            new Uint8Array(exports.memory.buffer, exports.aegis_panic(), length),
          );
        }
      } catch {
        // Nothing more can be learnt from a module in this state.
      }
      const reason = said || (cause instanceof Error ? cause.message : String(cause));
      this.stopped = new EngineError(`The simulation engine stopped: ${reason}`);
      throw this.stopped;
    }
  }

  /** Writes text into the module's input buffer and returns its length in bytes. */
  private write(exports: EngineExports, text: string): number {
    const bytes = this.encoder.encode(text);
    if (bytes.length === 0) return 0;
    const at = exports.aegis_input(bytes.length);
    if (at === 0) return -1;
    new Uint8Array(exports.memory.buffer, at, bytes.length).set(bytes);
    return bytes.length;
  }

  /** Starts the simulation. `nowMs` is the caller's clock, here and below. */
  boot(seed: number, nowMs: number): void {
    const said = this.call((exports) => exports.aegis_boot(seed, nowMs));
    if (said !== 'ok') {
      this.stopped = new EngineError(`The simulation engine could not start: ${said}`);
      throw this.stopped;
    }
  }

  /** One request, as `fetch` would send it. `body` is JSON text. */
  request(method: string, path: string, body: string | undefined, nowMs: number): EngineAnswer {
    let tooLarge = false;
    const said = this.call((exports) => {
      const length = this.write(
        exports,
        body === undefined ? `${method} ${path}` : `${method} ${path}\n${body}`,
      );
      if (length < 0) {
        tooLarge = true;
        return 0;
      }
      return exports.aegis_request(length, nowMs);
    });
    if (tooLarge) {
      // More than the boundary carries, which is more than any route accepts.
      return {
        status: 413,
        body: '{"error":{"code":"payload_too_large","message":"the request is larger than the engine accepts"}}',
        stream: [],
      };
    }
    const first = said.indexOf('\n');
    const second = said.indexOf('\n', first + 1);
    return {
      status: Number(said.slice(0, first)),
      body: second < 0 ? said.slice(first + 1) : said.slice(first + 1, second),
      stream: second < 0 ? [] : split(said.slice(second + 1)),
    };
  }

  /** Lets `elapsedMs` of wall-clock time pass; returns what the stream says. */
  advance(elapsedMs: number, nowMs: number): string[] {
    return split(this.call((exports) => exports.aegis_advance(elapsedMs, nowMs)));
  }

  /** Opens the stream: the greeting and a snapshot. */
  open(nowMs: number): string[] {
    return split(this.call((exports) => exports.aegis_open(nowMs)));
  }

  /** Hands over a subscriber's own message (`ping`, `resync`). */
  message(text: string, nowMs: number): string[] {
    return split(
      this.call((exports) => {
        const length = this.write(exports, text);
        return length < 0 ? 0 : exports.aegis_message(length, nowMs);
      }),
    );
  }
}

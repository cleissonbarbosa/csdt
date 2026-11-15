/**
 * The worker that holds the in-browser engine: it loads the module, starts
 * the simulation, lets wall-clock time pass and answers the page. Nothing in
 * it knows what a request means; that is the module's business.
 */
import wasmUrl from './aegis.wasm?url';
import { Engine, EngineError } from './binding';
import { DEFAULT_SEED, type FromWorker, type ToWorker } from './messages';

interface Scope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}

const scope = self as unknown as Scope;
const now = () => performance.now();

async function instantiate(): Promise<WebAssembly.Instance> {
  try {
    // The module imports nothing, so there is nothing to give it.
    return (await WebAssembly.instantiateStreaming(fetch(wasmUrl), {})).instance;
  } catch (cause) {
    if (cause instanceof WebAssembly.CompileError || cause instanceof WebAssembly.LinkError) {
      throw cause;
    }
  }
  // A host that does not serve the file as application/wasm: take the bytes.
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`the engine module answered ${response.status}`);
  return (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance;
}

async function load(): Promise<Engine> {
  const engine = Engine.from((await instantiate()).exports);
  engine.boot(DEFAULT_SEED, now());
  return engine;
}

function fail(cause: unknown): void {
  const reason = cause instanceof Error ? cause.message : String(cause);
  scope.postMessage({
    type: 'failed',
    message:
      cause instanceof EngineError
        ? reason
        : `The simulation engine could not be loaded: ${reason}`,
  });
}

const starting = load();
/** Whether somebody is listening to the stream. */
let subscribed = false;
let stopped = false;

function publish(messages: string[]): void {
  if (subscribed && messages.length > 0) scope.postMessage({ type: 'stream', messages });
}

function handle(engine: Engine, message: ToWorker): void {
  switch (message.type) {
    case 'request': {
      const answer = engine.request(message.method, message.path, message.body, now());
      scope.postMessage({
        type: 'response',
        id: message.id,
        status: answer.status,
        body: answer.body,
      });
      publish(answer.stream);
      break;
    }
    case 'open':
      subscribed = true;
      publish(engine.open(now()));
      break;
    case 'message':
      publish(engine.message(message.text, now()));
      break;
    case 'close':
      subscribed = false;
      break;
  }
}

function guarded(work: () => void): void {
  if (stopped) return;
  try {
    work();
  } catch (cause) {
    stopped = true;
    fail(cause);
  }
}

starting.then(
  (engine) => {
    scope.postMessage({ type: 'ready' });
    let last = now();
    setInterval(() => {
      guarded(() => {
        const at = now();
        publish(engine.advance(at - last, at));
        last = at;
      });
    }, engine.periodMs);
  },
  (cause: unknown) => {
    stopped = true;
    fail(cause);
  },
);

// Messages that arrive while the module is still loading wait for it, in order.
scope.onmessage = (event) => {
  void starting.then(
    (engine) => guarded(() => handle(engine, event.data)),
    () => undefined,
  );
};

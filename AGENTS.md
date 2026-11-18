# AGENTS.md

Guidance for AI coding agents working in this repository.

AEGIS is an interactive digital twin of a fictional cloud platform: a
deterministic Rust simulation with real Cedar policy decisions
(`apps/server`), a React + Three.js WebGPU client (`apps/web`) and the JSON
contract between them (`packages/contracts`). The same engine also builds as
a WebAssembly module (`apps/wasm`) so the client can run as a static site
with no server. Everything the simulation shows is synthetic; an incident
capture (a file the browser reads itself, `features/capture/`) is not, and is
labelled as not simulated (`recording`, in the contract's provenance
vocabulary). Docs and code comments are written in English.

## Toolchain

- Rust stable, selected by `rust-toolchain.toml` (MSRV 1.85).
- Node 24 (`.nvmrc`; `engines` requires ≥ 22.12) and pnpm 12.18.0
  (`packageManager`). An older default `node` fails in Vitest, so check
  `node -v` first.
- `pnpm install` once. Nothing needs credentials, tokens or a `.env`.
- The static site also needs the `wasm32-unknown-unknown` target:
  `rustup target add wasm32-unknown-unknown`.
- Python 3 runs the incident capture scripts in `scripts/` and their tests,
  with the standard library only.

## Commands

Run the stack (two processes):

```bash
cargo run -p aegis-server     # API on http://127.0.0.1:8787  (alias: pnpm dev:server)
pnpm dev:web                  # UI on http://localhost:5173, proxies /api and the WebSocket
docker compose up --build     # both, containerised, on http://localhost:8080
```

The server also runs on an operator's own files (`docs/WORKSPACE.md`):

```bash
cargo run -p aegis-server -- export-workspace <dir>   # the bundled files, to edit
cargo run -p aegis-server -- check-workspace <dir>    # validate one; try examples/corner-shop
cargo run -p aegis-server -- diff-workspace <base> <candidate>   # what Cedar decides differently; @bundled is the bundled set
AEGIS_WORKSPACE=<dir> cargo run -p aegis-server
```

`pnpm dev` starts Vite plus a typecheck watch on the contracts; it does not
start the server.

The version, which a release is made from (see "Project rules"):

```bash
./scripts/version.sh              # print it; fails if a manifest states another
./scripts/version.sh set 0.2.0    # write it everywhere; runs the exporter of contract samples
```

The static site, with the engine in the browser and no server:

```bash
pnpm engine:build     # apps/wasm → apps/web/src/engine/aegis.wasm (git-ignored)
pnpm dev:static       # Vite on http://localhost:5173, no proxy, engine in a worker
pnpm build:static     # engine:build, then apps/web/dist-static
pnpm --filter @aegis/web preview:static
```

Checks, exactly as CI runs them (`.github/workflows/ci.yml`):

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm format:check     # pnpm format to fix
pnpm typecheck
pnpm lint
pnpm test             # Vitest: contracts + web
python3 -B -m unittest discover -s scripts -p 'test_*.py'   # the capture scripts; standard library only
pnpm build
pnpm e2e              # Playwright against the real stack
# The static site (its own CI job; needs the wasm32 target):
cargo clippy -p aegis-wasm --target wasm32-unknown-unknown --locked -- -D warnings
pnpm engine:build
pnpm test:engine      # the built module against the contract samples, in Node
pnpm e2e:static       # Playwright against the static build, no server
```

A single test:

```bash
cargo test -p aegis-server --test simulation <name_substring>   # tests/{api,simulation,stream,integrations,workspace,diff,insight}.rs
cargo test -p aegis-server --lib <module::or::name>             # unit tests inside src/
pnpm --filter @aegis/web exec vitest run src/stores/ui.test.ts
pnpm --filter @aegis/web exec vitest run -t "part of the test name"
pnpm --filter @aegis/contracts test
pnpm --filter @aegis/web exec playwright test -g "part of the title" --project chromium
cargo test -p aegis-wasm <name_substring>                        # the engine's boundary, natively
pnpm --filter @aegis/web exec playwright test --config playwright.static.config.ts -g "part of the title"
python3 -B scripts/test_export_otel_capture.py -k token          # one Python test file, narrowed by name
```

End-to-end notes:

- Playwright starts its own release server and production web build and never
  reuses a running dev instance. The first run compiles the server in release
  mode. `pnpm --filter @aegis/web e2e:install` installs the browser.
- Every test shares one simulation, so the suite runs serially with one worker
  and each test begins with `openApp()` from `e2e/support.ts`, which resets it
  (the imported files as well as the timeline). It also arrives as a
  returning visitor; `openApp(page, { firstVisit: true })` is how the
  orientation card of a first visit is tested.
- Projects: `chromium` (software WebGL 2, what CI has), `no-3d` (every GPU API
  disabled, table-view fallback) and `chrome-webgpu`, which only exists with
  `AEGIS_E2E_GPU=1` and needs a locally installed Chrome on a real GPU.
- A failure stops the tests after it. `AEGIS_E2E_KEEP_GOING=1` runs them all
  regardless, to see every failure of a run at once.
- `window.__aegis` answers from the last frame drawn. `waitForScene` waits
  for the frame after a topology is handed over; read a position or a draw
  count only after it, or a fast machine reads the new arrangement from the
  old shot.
- An incident capture is opened by its link with `openCapture(page, id)`
  (`GOOGLE`, `BOUTIQUE` in `e2e/support.ts`): it applies the settings, goes
  to `./?capture=<id>` and calls `waitForCapture`, which waits for the
  capture's bar and for its file's count of pieces and connections, and
  checks that every name on the model is one the file wrote. The names are
  needed because the Google capture has twelve services, as many pieces as
  the overview, so the count alone cannot tell the two apart. It resets
  nothing: a server test that needs the shared simulation at its baseline
  calls `openApp` first.

Diagnostics that are not part of the normal test run:

```bash
# Per-scenario trace table. Narrow with TRACE_SCENARIO=<id>, TRACE_TOPOLOGY=<id>, TRACE_EVENTS=1.
cargo test -p aegis-server --test trace -- --ignored --nocapture
# Engine micro-benchmark; only meaningful with --release.
cargo test --release -p aegis-server --test trace engine_step_cost -- --ignored --nocapture
# Parity with a locally built cedar-agent; reports "skipped" when the variable is unset.
AEGIS_TEST_CEDAR_AGENT_BIN=/path/to/cedar-agent cargo test -p aegis-server --test integrations
```

Ports are deliberately separate so runs never share a simulation:

| Use                                               | Server | Web  |
| ------------------------------------------------- | ------ | ---- |
| Development                                       | 8787   | 5173 |
| `vite preview`                                    | 8787   | 4173 |
| Playwright                                        | 8797   | 4183 |
| Playwright, static site (`pnpm e2e:static`)       | none   | 4187 |
| `scripts/capture-docs.sh`, `scripts/benchmark.sh` | 8798   | 4184 |

## Architecture

### Server (`apps/server`, crate `aegis-server`)

Dependencies point inward: `api → application → simulation / authorization →
domain`.

- `domain`: the versioned contract types (serde, camelCase JSON), with
  `SCHEMA_VERSION` and the `DataSource` provenance enum. No I/O.
- `simulation`: `model` compiles a topology (a DAG) and runs the per-tick
  load/experience propagation; `channels` are ramped scalars that scenarios
  use to bend the model; `engine::step` is the pure step function; `timeline`
  wraps it with a command log, checkpoints, seek, replay and branching;
  `decisions` holds Cedar outcomes evaluated once at start-up; `report`
  reads one incident back from the timeline's events and samples. One tick
  is 200 ms of virtual time; a checkpoint is taken every 25 ticks.
- `incidents`: scenarios as data. `spec.rs` is the file format and the checks
  that need no topology; the five bundled scenarios are
  `fixtures/scenarios/*.json`, embedded by `catalog.rs`. They name topology
  roles (`primaryGateway`, `outageRegion`), not node ids, so the same
  definitions run on both bundled topologies; a scenario may also name a node
  by id. A recording is a seed plus a command list.
- `authorization`: the embedded `cedar-policy` decision point.
- `integrations`: opt-in adapters for local instances. Every outbound target
  goes through `guard.rs`.
- `workspace`: sorts files into the parts of a workspace, checks each and
  lays them over a set of sources. `workspace/compose.rs` reads a Compose
  file as a topology. `load` reads the directory (or bundle
  file) named by `AEGIS_WORKSPACE` once, before the server listens, and is
  the only file I/O in the server. `from_files` does the same for files
  already in memory and touches nothing; the import route calls it, so a file
  is accepted or refused identically whichever way it came.
- `application`: `Sources` is what everything is built from (the bundled
  fixtures, or those with parts replaced by a workspace). `Assets` is
  everything immutable, built from them once at start-up. `diff` compares two
  built `Assets` (policies, catalogued requests, scenario flows and the
  access matrix); it evaluates with each side's Cedar engine and decides
  nothing itself. `access` puts questions to Cedar that are recorded nowhere (one request
  policy by policy, every request of the catalogue). `experiment` runs one
  scenario twice on timelines of its own, the second time with one fault
  placed, and `trial` does the same to the platform at rest; `session` writes the timeline
  in use out as a recording. `Loaded` pairs a set of sources with the `Assets` built
  from it; `SimulationService` keeps the one it started with (what a reset
  returns to and an import is laid over) and the one in use.
  `SimulationService` owns the single mutable timeline behind one mutex, is
  the only place that advances it (a 50 ms scheduler), and fans messages out
  through a bounded broadcast channel, each serialised once.
- `api`: Axum routes under `/api/v1` and the `/stream` WebSocket. A thin shell
  for validation, limits and error mapping.

`build_state(config)` in `lib.rs` assembles the application without starting
the scheduler. Integration tests build state through `tests/common`, call the
router in-process and advance time themselves with `service.advance(..)`.

Things that are easy to break:

- **Determinism.** `engine::step` must never read a clock, use a global
  counter or iterate an unordered collection, and draws randomness only from
  the generator stored in `SimState`. Anything that changes over time has to
  live in `SimState`, otherwise checkpoints miss it and seek or replay
  diverge. Tests compare state digests bit for bit after arbitrary seeks.
- **Cedar outcomes are looked up, never invented.** A scenario flow is blocked
  at the authorizer only if Cedar denied its request shape in
  `DecisionTable::build`. A new request shape goes into
  `fixtures/cedar/catalog.json`. A file cannot state an outcome either:
  `spec.rs` refuses the event kinds, and `recordings.rs` the command, that
  would put a decision or an event of the engine's own on the timeline. An
  incident capture never reaches the timeline at all.
- **A report says what kind of statement each line is.**
  `simulation/report.rs` reads an incident back from events, metric samples,
  the topology and the resolved scenario; it steps nothing and estimates
  nothing. A cause is `prescribed` (the scenario's own channels),
  `dependency` or `load` (a relation the propagation model follows), `fault`
  (placed by hand) or `unattributed`. A new relation is added there with a
  test in `tests/insight.rs`; a cause is never chosen because it is
  plausible. The interface words it in `lib/report.ts` and adds nothing.
- **A policy's standing is Cedar's answer, not a reading of the policy.**
  `CedarEngine::standings` puts each policy to the request by itself, as it
  is and with its conditions left out, both made from Cedar's own JSON form
  of the policy. Nothing in the server or the client parses a policy to say
  why it did not apply. A test holds the standings of every catalogued
  request to the decision Cedar gave; keep it passing when Cedar is
  upgraded.
- **Asking is not recording.** `explain`, `matrix` and `trial` place nothing
  on the timeline: no command, no event, no decision. They are bounded
  (`MATRIX_LIMIT`, `MAX_DISABLED_POLICIES`, `TRIAL_MS`), and the matrix and
  the trial run through `off_the_workers`.
- **An objective is an alert rule's threshold.** `ERROR_OBJECTIVE` and
  `LATENCY_OBJECTIVE_FACTOR` in `simulation/engine.rs` are what the
  detection rules alert on and what `report::objectives_over` counts the
  samples against. They are one pair of constants on purpose; the
  interface calls them objectives, never an SLO.
- **A Compose file is text.** `workspace/compose.rs` reads services,
  `depends_on`, `links`, `ports` and the image name, and nothing else: it
  pulls, builds and resolves nothing. Every figure it writes is a default
  of its own and the topology's description says so. The YAML parser bounds
  neither nesting in the block style, which it follows by calling itself,
  nor what aliases expand to: `document()` checks both first
  (`MAX_YAML_DEPTH`, `MAX_YAML_VALUES`), and no YAML may reach the parser
  any other way. Without the first, one request ends the process.
- **A session, like a recording, cannot state an outcome.**
  `Recording::validate_session` refuses `recordDecision`, and
  `session::export` leaves decisions out and counts them. An experiment
  (`application/experiment.rs`) never touches the timeline in use: both runs
  are `Timeline::from_recording` on timelines of their own, from the
  service's seed.
- **What the server runs on can be replaced.** An import swaps `Loaded` and
  the timeline together inside `SimulationService::replace`, under the
  runtime lock. Nothing may hold on to `Assets` across a request: take
  `service.assets()` at the moment of use, and anything prepared outside the
  lock (a recording's timeline) checks that the assets are still the same
  before it is put in place. The cedar-agent adapter's sync store is updated
  with every swap. The browser never decides what a workspace file is:
  classification is `workspace::from_files`, on the server. An incident
  capture is the one file the browser reads itself
  (`features/capture/capture.ts`); it never reaches the server, a workspace
  or the simulation's timeline.
- **The library also builds for the browser.** `aegis-server` compiles for
  `wasm32-unknown-unknown` and `apps/wasm` serves `api::offline_router` from
  it. There, `std::time::Instant::now()`, threads, sockets and a Tokio
  runtime do not exist: reading the standard clock compiles and then panics
  in the tab. Shared code takes time from `crate::clock::Instant`, hands
  blocking work to `off_the_workers` in `routes.rs`, and keeps anything that
  needs the operating system behind `#[cfg(not(target_arch = "wasm32"))]`
  (the dependencies are split the same way in `Cargo.toml`). A new route
  goes into `route_table()` so both builds serve it, and into the list in
  `apps/web/src/engine/parity.spec.ts`, which calls every route in the
  built module. Anything the exporter of contract samples does, that test
  repeats: change one and change the other.
- **Fixtures are compiled in.** Everything under `fixtures/` is embedded with
  `include_str!`, so editing one means rebuilding the server and usually
  regenerating the contract samples.
- **The fixture formats are public.** `fixtures/` is laid out as a workspace
  and operators write files in the same formats. Changing a topology,
  scenario, recording or catalogue field means updating `docs/WORKSPACE.md`
  and `examples/corner-shop`, which a test loads. A new scenario
  effect is three things: a variant in `incidents/spec.rs` with its range
  check in `validate`, its resolution in `incidents/mod.rs`, and a row in the
  document. Scenario files are listed in file-name order. The JSON Schemas
  in `schemas/v1/` are generated from the same Rust types: after changing a
  type or a `#[schemars(...)]` bound run `pnpm workspace:schemas` and commit
  the result (a Rust test fails on a stale schema, and a contract test
  validates the fixtures and the example against them). A change that an
  existing file would not survive needs a new `FORMAT_VERSION` in
  `workspace.rs`, not an edit to version 1.
- **Floats are parsed exactly.** `serde_json` is built with `float_roundtrip`
  so a topology written out and read back is the same bits; a test compares
  the exported stress topology with the generated one.
- **History is bounded** (30 virtual minutes, 8 000 events), as is every
  buffer an outside party can fill.

### Engine for the browser (`apps/wasm`, crate `aegis-wasm`)

A thin crate around the server library: `Engine` owns the state from
`build_offline_state`, the offline router and a place in the broadcast
stream, and the exported `aegis_*` functions carry text across the boundary.
It decides nothing about the simulation or about a response.

- The module imports nothing from its host (a test reads the built file's
  import section). No `wasm-bindgen`, no `unsafe` block: the page writes into
  a buffer the module owns and reads another.
- Everything that crosses is lines of UTF-8: `METHOD path` and a JSON body
  in; status, body and stream messages out. `ABI_VERSION` is checked by the
  page; change the boundary and change it in `src/lib.rs` and in
  `apps/web/src/engine/binding.ts` together.
- The router is called with `oneshot` and polled without a runtime. A
  handler that awaited something real would never finish; it is reported as
  an error, not waited on.
- Wall-clock time is an argument of every call. `aegis_advance` is the
  scheduler, called by the page's worker, and caps a step at one second.
- A client's `ping` and `resync` are answered by `api::protocol::answer`,
  the same function the WebSocket handler calls.

### Contract (`packages/contracts`)

The Rust `domain` module is the source of truth; `src/index.ts` mirrors it as
zod schemas and exports the `TelemetryProvider` interface. The package is
consumed as TypeScript source and has no build output.

`samples/` holds real server output written by the `export-contract-samples`
binary, which drives the real router through a fixed scenario. The contract
tests parse every sample and require the parsed value to equal the input, so
drift fails in both directions, and CI fails if the committed samples differ
from what the server emits. After changing a domain type, a route's response
or a fixture:

```bash
pnpm contracts:samples    # then update src/index.ts to match and commit both
```

### Web client (`apps/web`)

Data flow: `DemoSimulationProvider` (REST client in `providers/api.ts` plus
the reconnecting `StreamClient`) → `app/useAegisConnection.ts` → Zustand
stores (`stores/telemetry.ts`, and `stores/ui.ts`, which also holds the
persisted `useSettings`) → features and the scene. TanStack Query holds
request/response data (scenarios, providers, policy catalogue) and is
invalidated from stream events. Every REST response and stream message is
parsed with the shared schemas before use.

Where requests go is decided when the client is built. `@transport`
resolves to `providers/serverTransport.ts` (`fetch` and a WebSocket) or, with
`--mode static`, to `engine/transport.ts`, which answers with a real
`Response` and a socket-shaped object fed by the engine's worker
(`engine/worker.ts` holds the module, `engine/binding.ts` knows its
boundary, `engine/client.ts` matches answers to requests). Nothing above
`providers/transport.ts` knows which one it has; copy that names the server
goes through `app/host.ts`. The static build writes its Content-Security-
Policy into the page (`vite.config.ts`), and no code may evaluate a string:
zod is set to `jitless` in `app/policy.ts` for that reason.

Rendering: React Three Fiber owns the canvas, its size and the frame loop.
One imperative `SceneController` (`graphics/SceneController.ts`) owns
everything drawn inside it and is fed through store subscriptions set up in
`features/scene/SceneCanvas.tsx`.

- Telemetry must never re-render a React component in the frame path.
- Draw calls follow object classes, not object counts: one instanced mesh per
  service type, one each for connections, beads and ground marks. An
  E2E test fails if switching to the 178-service topology adds more than six
  draw calls.
- Names are not in the scene. `graphics/labelLayer.ts` draws them on a 2D
  canvas laid over it, at the display's resolution whatever the scene's is;
  `SceneController.drawLabels` hands it every name's anchor, presence and
  rank each frame, and `graphics/labelPlacement.ts` (pure, tested) leaves
  out a name that would lie across a more important one, or that would not
  lie wholly inside the free part of the stage: `LabelLayer.draw` is given
  the scene's insets (the sheets, a card, the toolbar strip, the timeline),
  so a name half under a card or past an edge is left out, not cut. Only the
  selected and the pointed-at name are drawn regardless. Do not put text
  back into the WebGL pass, and do not show two names over each other: an
  E2E test reads `window.__aegis.labels()` and fails on an overlap.
- `captureFrame` (pixel read-back, nothing to do with an incident capture,
  whose frame is `frameAt`) reads the canvas's own drawing buffer on WebGL 2
  and an output render target on WebGPU. The second path, used on WebGL 2,
  left the renderer presenting nothing once the arrangement was switched
  after a read-back; do not route WebGL 2 through it again.
- The model has two levels. The application opens on the **overview**
  (`layoutMode: 'layers'`): the platform reduced to one piece per kind of
  service, in the four layers a request crosses. `lib/overview.ts` derives
  it, as a real `Topology` with columnar snapshots, as a pure function of the
  server's topology and snapshot; every figure is summed or traffic-weighted
  from the services it stands for, never invented. The two detailed
  arrangements (`regions`, `dependencies`) draw the server's topology as it
  is. `SceneController` draws whichever topology it is handed and does not
  know which; the bridge in `features/scene/SceneCanvas.tsx` translates ids
  both ways (selection, hover, incident route, traced request), and
  `window.__aegis.projectNode` accepts a service id at either level.
  `useTelemetry` always holds the server's own topology and snapshot.
- The service pieces are a built asset, not code. `apps/web/scripts/build-pieces.py`
  models all twelve in Blender and writes `src/graphics/pieces.glb`, which is
  committed and read by the small parser in `graphics/pieces.ts` (a general
  glTF loader is deliberately not in the bundle). After changing a piece,
  rebuild and commit the file; a test fails if a service type has no model
  or no working part:

  ```bash
  blender --background --python "$PWD/apps/web/scripts/build-pieces.py"   # absolute path
  ```

- A piece's working part is a _mechanism_: a kind of motion (spin, index,
  swing, slide, convey) about a pivot and an axis, declared in
  `build-pieces.py` where the part is modelled and carried in the GLB.
  `pieces.ts` lays the mechanisms out as a small table (one column each,
  `aPart.y` is a vertex's column) and `createPieceMaterial` moves the
  vertices from it, so there is still one material and one draw call per
  service type. The CPU only keeps two numbers per piece: the seconds its
  mechanism has worked, advanced at the pace `graphics/pace.ts` derives
  from throughput, and the state it works in, which travels toward the
  service's health code. Hesitating and jamming are the same arithmetic for
  every kind and live in the material; how a part hangs when down is its
  `slump`, declared with the mechanism. A new kind of motion has to be
  added in all three places, and a period has to divide `WORK_CYCLE`, which
  a test checks.
- Beads are stateless. The CPU updates one small per-edge data texture, and
  position, shape and colour are derived in the vertex shader.
- Materials are written in TSL only (`three/webgpu`, `three/tsl`) with no
  compute shaders or storage buffers, so WebGL 2 is the same code on another
  backend rather than a second implementation. With neither API available the
  app shows `TopologyTable`.
- Snapshots are columnar: per-node and per-edge arrays aligned index for index
  with the topology.
- `graphics/layout.ts` is a pure function of the topology, with no randomness
  and no iteration to convergence. It also says where each arrangement is
  seen from (`VIEW`). On a stage taller than wide the overview alone is seen
  along the path instead (`VIEW_UPRIGHT`, `viewOf`): `SceneController` turns
  the pieces to face that attitude and places the names for it
  (`placeNames`), so anything that depends on where the camera first stands
  has to hold for both. A piece with a side its traffic arrives at
  (`ARRIVAL`: gate, shield, container, queue) is turned toward what calls it
  (`layout.facing`); a gate and a shield no further than `MOST_ASKEW` from
  the line of sight, or they show their edge. The piece material is told
  each piece's turn (`aTurn`), because a mechanism is worked out in the
  piece's own frame: anything added to its vertex stage is turned with it.

What the viewer asked to see reaches the scene through `stores/ui.ts`: the
selection, the traced request, and `reach`, a set of service ids a card
wants kept in front (a fault tried before it is placed, a service's
exposure). `SceneController.setReached` treats it as a selection's path is
treated; it is the viewer's blue, never a state colour, because nothing has
happened to those services.

The address carries four things besides the view: `?challenge=<id>` opens
the guide on one challenge (`features/guide/GuideCard.tsx`), `?embed=1`
leaves out the bar (`app/embed.ts`, `features/topnav/EmbedBar.tsx`), with
it `&scenario=<id>` starts an incident, on the static site only: on a
server the simulation is shared and an address must start nothing; and
`?capture=<id>` opens a bundled incident capture (`app/captureUrl.ts`), on
either host because it only looks. It is read once, when the page loads,
and adds no history entry; an id that names no bundled capture is ignored.
An embed reaches no capture at all: it does not read the parameter,
`openCapture` and `openCaptureFile` refuse there, Back and Forward show the
simulation, the palette has no capture command and `CaptureDialog` never
opens.

An **incident capture** (`features/capture/`, `docs/CAPTURES.md`) is a real
incident, as a provider reported it or a system recorded it, read by the
browser itself from a file (two are bundled, loaded only when opened). It
is a mode of the same shell, not a page of its own: while
`useCapture.capture` is set, `App.tsx` and `TopNav.tsx` show the capture's
parts (`CaptureBar` in the timeline's place, `CaptureList` and
`CaptureCard`/`CaptureDetails` in the two sheets, `CaptureTable` for the
table view, a bar of its own) and the simulation's slide away untouched,
to come back as they were. Things that are easy to break:

- **The store owns the capture and its clock.** `stores/capture.ts` holds the
  file, the cursor, the selection and the sheets; `play()` ticks every
  200 ms and moves the cursor by `speed` × 200 ms of capture time (speeds
  10×, 60×, 600×, 3600×). Components read derived values (`selectStep`,
  `selectEventCount`, `useMoment` in `present.tsx`) that change only where
  what is shown changes; only the bar's clock and playhead follow `atMs`.
  Nothing of a capture enters `useTelemetry` or `useUi.selection`, and
  nothing in capture mode calls `actions.*` or an `api` mutation
  (`features/capture/shell.test.tsx` checks a whole session).
- **Open and leave only through `app/captureUrl.ts`.** The interface calls
  `openCapture`, `openCaptureFile` and `leaveCapture`, which mark
  `history.state` (`aegisCapture`, `aegisCaptureBase`) so Back, Forward and
  "Back to the simulation" agree; calling the store's `openBundled`,
  `openFile` or `close` directly breaks them. `followCaptureAddress()` is
  called once, in `main.tsx`. A file is never put in the address.
- **The keyboard moves only where what held it went away.**
  `useFocusAcrossModes` and `useFocusAfterCaptureSheets` in `App.tsx` act
  only when the element last focused is gone or inert: a mode change puts
  the focus on Play or `#main`, a sheet put away gives it back to what opens
  that sheet, and a page arrived at by a link keeps it on nothing.
  `features/capture/shell.test.tsx` holds each case.
- **The reading is pure and in one place.** `features/capture/capture.ts`
  validates the file (`readCapture`, which refuses rather than repairs) and
  says what it states at a moment (`nodeReadings`, `readingOf`, `frameAt`,
  `statusAt`, `stepAt`). Components use these and decide nothing
  themselves: a sample holds only its own period, a state is known only
  where a sample counts requests and errors (or no requests at all), a
  report's service only through a stated event, and unknown is never
  normal. The bar's sentence never counts an unknown service as known.
- **One scene bridge, one guard.** `SceneBridge` in
  `features/scene/SceneCanvas.tsx` asks `captured()` everywhere: while it
  holds, `applyCapture()` hands the controller the capture's topology in
  the `regions` arrangement (a capture has no overview) and clears the
  route, trace, reach, filters and partial groups; the telemetry and ui
  subscriptions return early; selection and hover go to `useCapture`;
  `summary()` is null. Closing calls `applyAll()`. Mounting takes either
  path, so a reload with `?capture=`, `T` and a renderer change keep the
  capture drawn. Do not add a second canvas or bridge for it.
- **Unknown is drawn, never left normal.** `SceneFrame.nodes` carries
  `known` and `measured` columns; `aimPiece` (`graphics/sceneData.ts`)
  stands an unknown piece upright a shade fainter (`UNKNOWN_TONE`), never
  receding, on a dashed ring without hue (`groundMarkOf`: a negative
  `aRing.y`, read by `createGroundMaterial`), and a piece whose traffic was
  not measured rests as modelled. No attribute or draw call was added, and
  `sceneData.test.ts` holds the tones to the real palette in both themes.
  `window.__aegis.stats().unknown` counts unknown pieces, and `projectNode`
  takes capture ids while one is open.
- **Its levels are the engine's.** `lib/thresholds.ts` (`ERROR_DEGRADED`
  0.04, `ERROR_CRITICAL` 0.2) copies the error levels of the engine's node
  `classify`, not `ERROR_OBJECTIVE`; `thresholds.test.ts` reads
  `engine.rs` and fails when they part. Change both together. Latency and
  memory never colour a capture.
- **A capture's topology id is never its title:** `capture:<id>`, or
  `capture:file:<SHA-256 of the bytes>`. `SceneController` takes an equal id
  and node count for the same model and keeps its arrays.
- **Words.** It is an _incident capture_ (pt-BR _captura de incidente_, in
  the glossary of `pt-BR/common.ts`), never a "replay" (the simulation's
  re-simulated history) nor "recorded"/"gravado" (the simulation's recorded
  incidents). `DataSource` `recording` is labelled "Capture" and the chip
  says "Captured, not simulated" or "From the provider's report, not
  simulated". A file's `faults` are shown as errors; its thresholds are
  never objectives; nothing in it is "live" or "observed". Times are UTC
  with the offset into the capture. What the file wrote is shown as
  written; the copies of a bundled capture's title and source in
  `bundled.ts` are marked `not-interface-text` and held equal to the file by
  `bundled.test.ts`.

The static build also writes a service worker and a link preview
(`vite.config.ts`: `offline()` from `src/engine/offline.sw.js`,
`linkPreview()` from `AEGIS_SITE_URL` and `docs/assets/overview.png`). The
worker keeps the build's own files and fetches nothing else; the static
Playwright suite blocks service workers except in the one test that is
about them, so a cached file never answers for a missing one.

The interface speaks English and Brazilian Portuguese (`src/i18n/`). A
phrase is written where it is used, in English, and passed through `t()`
(`t('{n} services, all normal', { n })`), or `tr()` when an element sits
inside the sentence. The English is the key; `pt-BR/` holds one dictionary
part per area, and `Phrase` is the set of their keys, so a phrase nobody
translated does not compile. Two tests keep it that way:
`i18n/coverage.test.ts` fails on interface text written without `t()` (a
literal that is not, such as a command or a sample of Cedar, is marked
`not-interface-text` where it stands), and `i18n/dictionary.test.ts` fails
on a translation that drops a placeholder or a tag, a phrase translated two
ways, or one nothing uses any more.

- One or many is two whole phrases chosen where they are used, never a
  word glued on; an enum value goes through its label table
  (`lib/palette.ts`). A word with two meanings takes a note, `t('Open#verb')`,
  which English does not show.
- The language is read once, when the page loads (the setting, or the
  browser's first language), so `t()` may be called in a table at the top
  of a module. Changing the setting reloads the page. The engine's worker
  has no storage and is told the page's language in its name.
- What the server or a file wrote (names, a scenario's text, an event, an
  error message) is shown as written. The glossary at the top of
  `pt-BR/common.ts` is the vocabulary every part keeps to, and the rules of
  "Words" in `docs/DESIGN.md` hold in both languages.
- The tests are written against English and ask for it: Playwright's
  `locale`, the `language` in `e2e/support.ts`, and the screenshot and
  benchmark scripts. A test of the Portuguese interface sets it itself.

`window.__aegis` (`stats`, `projectNode`, `captureFrame`, `labels`) is the handle the
E2E suite, `scripts/capture.mjs` and `scripts/benchmark.mjs` drive the scene
through. Those scripts and `scripts/capture-docs.sh` also select elements by
`data-testid` and `aria-label`, so renaming one means updating them.

`@/` resolves to `apps/web/src`. Vite proxies `/api` to `AEGIS_API_PROXY`
(default `http://127.0.0.1:8787`), so the browser only talks to its own
origin.

## Interface design rules

`docs/DESIGN.md` ("Signal Field") is the standard a UI change is judged
against. Read it before touching anything visual. In short:

1. **Hue is an answer.** Blue (focus) answers the viewer: the selection, the
   request being traced, keyboard focus, links. Amber, red and magenta answer
   the data: deviation, failure or a request that was stopped, hostile
   traffic. Nothing normal has a hue: no "healthy green", no brand colour, no
   coloured service types. Primary actions are ink, and blue is used for
   nothing but focus.
2. **Normal is silent.** No dot, badge or label on a healthy thing. The same
   goes for the interface: at rest the screen holds the top bar and the
   model. Cards come with a selection and leave with it, lists and the
   request tracer come when asked for, the timeline is on screen only while
   there is something on it, and a platform signal shows in the top bar only
   while it is out of range. The one exception is the orientation card of a
   first visit (`features/guide/Orientation.tsx`), shown once and remembered
   in `stores/guide.ts`.
3. **Overview first, then one path, then the detail.** The opening view is
   the twelve kinds of service; a selection, a traced request or an
   incident's route brings one path forward; opening a service goes to the
   detailed arrangements. A new element belongs to one of these levels and
   appears there, not before.
4. **Depth is distance along the path.** Nothing is raised for emphasis. The
   default view is nearly parallel (a 14° lens).
5. **A model, not a hologram.** Matte porcelain pieces read from shading and
   shadow. No glow, bloom, gradients, additive blending or grid floors.
6. **A number comes with its normal range.**
7. **Shape before colour.** Nothing depends on telling two hues apart.
8. **Motion means something.** Traffic moves because requests do: the beads,
   and the one working part of each piece (a door that turns, a line that
   advances), which runs at the pace of its service's throughput and stands
   still when nothing passes. How it moves is the service's state, the same
   way for every piece: evenly when healthy, hesitating when degraded,
   jammed and pushing when critical, hanging crooked and still when down.
   Everything else that moves answers an action
   or a change in the data, and does it once (the model assembling, pieces
   walking to a new arrangement, a selection's connections being redrawn,
   the camera moving in on a traced path, a card sliding in). A piece never
   spins, bobs or pulses as a whole, and nothing else repeats but the
   unacknowledged-alarm blink. The camera never moves by itself once the
   viewer has taken it. All of it respects reduced motion, which the E2E
   suite runs with and which leaves every mechanism as it was modelled.

An incident capture keeps to these, with the exceptions `docs/DESIGN.md`
states for it ("An incident capture"): it has no overview and opens on the
detail, its bar is on screen for as long as it is open, and requests,
errors, p95 and memory carry no normal range because the source states none
(the error rate is read against the simulation's levels). A service whose
state the source does not give is drawn as unknown, never as normal. A
report's pieces rest, so on the model its affected and recovering pieces
differ by colour alone; the hover card, list, card, table and bar give each
state a shape.

Words are part of the design (`docs/DESIGN.md`, "Words"). Simulated time is
never called "live": the cursor is at the _simulation's now_ or in its
_history_, and either may be _paused_ (`describePlayback` in
`features/timeline/Timeline.tsx`); the contract keeps `mode: 'live'`. A
phase is timed from the start of its incident (`+0:14`) and an event shows
both clocks. A Cedar result that no longer matches the form beside it is
marked stale (`lib/evaluation.ts`), never shown as current. Where a
service's place is not on show its name carries its region when the name
repeats (`lib/names.ts`, `<ServiceName>`); in the table view, which is laid
out by region, that is a call that leaves the row's region (`namedFrom`).

Tokens are CSS custom properties in `apps/web/src/index.css`, mirrored as
literals in `apps/web/src/lib/palette.ts` because the 3D scene cannot read
custom properties. Change both together, for both themes (light and night).
Controls use the `rounded-control` radius; a `.panel` takes the card radius
from its class, and one that floats over the model also takes `.floating`
for its shadow. Type is B612 in two weights; B612 Mono only for literal code;
sentence case throughout.

These rules are tested: `lib/palette.test.ts` holds the palette to them,
`lib/overview.test.ts` holds the overview to its arithmetic, and E2E tests
read the rendered frame back and assert that no sampled pixel has a hue while
the platform is healthy and nothing is selected, and that hue comes and goes
with a selection, a traced request and an incident.

Do not put `backdrop-filter` over the canvas. It was measured to cost several
times more than the scene itself (`docs/PERFORMANCE.md`).

## Project rules

- **Nothing is fabricated.** Figures in `docs/PERFORMANCE.md` come from
  `./scripts/benchmark.sh`, with the raw output committed under `docs/assets/`.
  Images in `docs/assets/` come from `./scripts/capture-docs.sh` against the
  running app. Both need `cargo build --release -p aegis-server && pnpm build`
  and Google Chrome; the screenshot run also uses ffmpeg. Do not hand-edit
  numbers or describe something unmeasured as measured. A bundled capture
  states nothing its source does not: each state of a provider report names
  the update it rests on, and measured values come only from an exporter or
  rebuild script, never from a hand edit.
- **Provenance is always labelled.** Data is `synthetic`, `recording` or
  `live` from where it is produced to the pixel. `recording` means an
  incident capture, read in the browser and labelled as not simulated
  ("Captured, not simulated"); nothing the simulation produces is labelled
  `recording` or `live`. A topology from a workspace must be `synthetic`:
  its figures are computed, whatever platform it describes.
- **Simulation only** (`docs/SECURITY.md`). `simulation` and `incidents`
  perform no I/O; files are read by `workspace::load` alone, at start-up, and
  the import route is handed file contents, never a path to open. No real
  attacks or scans; the server, the engine and the page hold no cloud SDK or
  cloud credential. The capture exporters in `scripts/` are operator tools that
  read with the operator's own credentials; nothing in AEGIS runs them. No
  outbound connection by default: integrations need server configuration and
  an explicit click, and accept loopback targets only unless allow-listed.
- **Integrations** adapt only public repositories owned by `cleissonbarbosa`,
  read without authentication, and copy no source from them
  (`docs/INTEGRATIONS.md`). The capture exporters are not integrations.
  Bundled captures are third-party public material (Google Cloud's public
  incident report; aggregates of the RCAEval 0.2.0 release), each naming its
  source.
- **The browser makes no third-party requests.** Fonts are bundled and the
  build inlines no assets, which is what lets the deployed CSP stay at
  `'self'`. The static site makes no request at all beyond its own files,
  and an E2E test fails if it does.
- **Publishing is a person's decision.** `.github/workflows/pages.yml`
  deploys the static site and runs only when started by hand.
  `.github/workflows/release.yml` pushes the two container images and
  creates a tagged GitHub release, but only for a version that has no tag
  yet: the decision is the commit that changes the version, and no other
  push publishes anything. `Cargo.toml` states the version (the server
  reports it), and three `package.json` files, `Cargo.lock` and the health
  sample repeat it. Change it with `./scripts/version.sh set <version>`,
  never in one of them by hand, and never as part of other work: on `main`
  that commit is a public release.
- **Rust lints.** `unsafe` is forbidden and `dbg!` / `todo!` are denied.
  `unwrap()` outside tests is a Clippy warning, which CI's `-D warnings`
  turns into a failure. Request bodies deserialise into types that reject
  unknown fields.
- **TypeScript** is strict with `noUncheckedIndexedAccess`, and
  `react-hooks/exhaustive-deps` is an error.
- Prettier skips `packages/contracts/samples`, `fixtures` and `docs/assets`.
  Do not reformat them by hand.

## Further reading

`docs/ARCHITECTURE.md` (model, API table, stream protocol),
`docs/WORKSPACE.md` (the file formats an operator writes), `docs/DESIGN.md`,
`docs/SECURITY.md`, `docs/INTEGRATIONS.md`, `docs/CAPTURES.md` (incident
captures: reading rules, format, exporters), `docs/PERFORMANCE.md`,
`docs/DEMO.md`.

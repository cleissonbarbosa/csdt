# AGENTS.md

Guidance for AI coding agents working in this repository.

AEGIS is an interactive digital twin of a fictional cloud platform: a
deterministic Rust simulation with real Cedar policy decisions
(`apps/server`), a React + Three.js WebGPU client (`apps/web`) and the JSON
contract between them (`packages/contracts`). Everything it shows is
synthetic. Docs and code comments are written in English.

## Toolchain

- Rust stable, selected by `rust-toolchain.toml` (MSRV 1.85).
- Node 24 (`.nvmrc`; `engines` requires ≥ 22.12) and pnpm 12.18.0
  (`packageManager`). An older default `node` fails in Vitest, so check
  `node -v` first.
- `pnpm install` once. Nothing needs credentials, tokens or a `.env`.

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

Checks, exactly as CI runs them (`.github/workflows/ci.yml`):

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm format:check     # pnpm format to fix
pnpm typecheck
pnpm lint
pnpm test             # Vitest: contracts + web
pnpm build
pnpm e2e              # Playwright against the real stack
```

A single test:

```bash
cargo test -p aegis-server --test simulation <name_substring>   # tests/{api,simulation,stream,integrations,workspace,diff}.rs
cargo test -p aegis-server --lib <module::or::name>             # unit tests inside src/
pnpm --filter @aegis/web exec vitest run src/stores/ui.test.ts
pnpm --filter @aegis/web exec vitest run -t "part of the test name"
pnpm --filter @aegis/contracts test
pnpm --filter @aegis/web exec playwright test -g "part of the title" --project chromium
```

End-to-end notes:

- Playwright starts its own release server and production web build and never
  reuses a running dev instance. The first run compiles the server in release
  mode. `pnpm --filter @aegis/web e2e:install` installs the browser.
- Every test shares one simulation, so the suite runs serially with one worker
  and each test begins with `openApp()` from `e2e/support.ts`, which resets it
  (the imported files as well as the timeline).
- Projects: `chromium` (software WebGL 2, what CI has), `no-3d` (every GPU API
  disabled, table-view fallback) and `chrome-webgpu`, which only exists with
  `AEGIS_E2E_GPU=1` and needs a locally installed Chrome on a real GPU.

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
  `decisions` holds Cedar outcomes evaluated once at start-up. One tick is
  200 ms of virtual time; a checkpoint is taken every 25 ticks.
- `incidents`: scenarios as data. `spec.rs` is the file format and the checks
  that need no topology; the five bundled scenarios are
  `fixtures/scenarios/*.json`, embedded by `catalog.rs`. They name topology
  roles (`primaryGateway`, `outageRegion`), not node ids, so the same
  definitions run on both bundled topologies; a scenario may also name a node
  by id. A recording is a seed plus a command list.
- `authorization`: the embedded `cedar-policy` decision point.
- `integrations`: opt-in adapters and fixture parsers. Every outbound target
  goes through `guard.rs`.
- `workspace`: sorts files into the parts of a workspace, checks each and
  lays them over a set of sources. `load` reads the directory (or bundle
  file) named by `AEGIS_WORKSPACE` once, before the server listens, and is
  the only file I/O in the server. `from_files` does the same for files
  already in memory and touches nothing; the import route calls it, so a file
  is accepted or refused identically whichever way it came.
- `application`: `Sources` is what everything is built from (the bundled
  fixtures, or those with parts replaced by a workspace). `Assets` is
  everything immutable, built from them once at start-up. `diff` compares two
  built `Assets` (policies, catalogued requests, scenario flows and the
  access matrix); it evaluates with each side's Cedar engine and decides
  nothing itself. `Loaded` pairs a set of sources with the `Assets` built
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
  `spec.rs` refuses the event kinds, and `recordings.rs` the commands, that
  would put a decision or an imported event on the timeline.
- **What the server runs on can be replaced.** An import swaps `Loaded` and
  the timeline together inside `SimulationService::replace`, under the
  runtime lock. Nothing may hold on to `Assets` across a request: take
  `service.assets()` at the moment of use, and anything prepared outside the
  lock (a recording's timeline) checks that the assets are still the same
  before it is put in place. The cedar-agent adapter's sync store is updated
  with every swap. The browser never decides what a file is: classification
  is `workspace::from_files`, on the server.
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

Rendering: React Three Fiber owns the canvas, its size and the frame loop.
One imperative `SceneController` (`graphics/SceneController.ts`) owns
everything drawn inside it and is fed through store subscriptions set up in
`features/scene/SceneCanvas.tsx`.

- Telemetry must never re-render a React component in the frame path.
- Draw calls follow object classes, not object counts: one instanced mesh per
  service type, one each for connections, beads, labels and ground marks. An
  E2E test fails if switching to the 178-service topology adds more than six
  draw calls.
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
  and no iteration to convergence.

`window.__aegis` (`stats`, `projectNode`, `captureFrame`) is the handle the
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
   while it is out of range.
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
  and Google Chrome; the capture also uses ffmpeg. Do not hand-edit numbers or
  describe something unmeasured as measured.
- **Provenance is always labelled.** Data is `synthetic`, `recording` or
  `live` from the server to the pixel, and a fixture is never labelled live.
  A topology from a workspace must be `synthetic`: its figures are computed,
  whatever platform it describes.
- **Simulation only** (`docs/SECURITY.md`). `simulation` and `incidents`
  perform no I/O; files are read by `workspace::load` alone, at start-up, and
  the import route is handed file contents, never a path to open. No real attacks, scans, cloud SDKs or credentials. No
  outbound connection by default: integrations need server configuration and
  an explicit click, and accept loopback targets only unless allow-listed.
- **Integrations** adapt only public repositories owned by `cleissonbarbosa`,
  read without authentication, and copy no source from them
  (`docs/INTEGRATIONS.md`).
- **The browser makes no third-party requests.** Fonts are bundled and the
  build inlines no assets, which is what lets the deployed CSP stay at
  `'self'`.
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
`docs/SECURITY.md`, `docs/INTEGRATIONS.md`, `docs/PERFORMANCE.md`,
`docs/DEMO.md`.

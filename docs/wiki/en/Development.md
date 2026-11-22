**English** · [Português](Desenvolvimento)

This page is for working on AEGIS itself: where the code is, the tools it
needs, how to run and test each part, and the rules a change keeps.
[`AGENTS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md)
is the complete guide, including the list of things that are easy to break.

## Repository layout

| Directory            | What it holds                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server`        | The Rust server, crate `aegis-server`: domain, simulation, incidents, authorization, integrations, workspace, application, API |
| `apps/wasm`          | The engine for the browser, crate `aegis-wasm`: the server's routes behind a function-call boundary, compiled to WebAssembly   |
| `apps/web`           | The React client: graphics, features, stores, providers and the engine's binding                                               |
| `packages/contracts` | The shared contract: zod schemas, and samples exported by the server                                                           |
| `fixtures`           | The bundled topology, scenarios, recordings and Cedar files, laid out as a workspace                                           |
| `examples`           | A small workspace to copy from, and cloud inventories as the collectors write them                                             |
| `schemas`            | The JSON Schemas of the workspace formats, generated from the Rust types                                                       |
| `docs`               | The reference documents, and the source of this wiki (`docs/wiki`)                                                             |
| `scripts`            | Screenshot and benchmark runners, the version, the incident capture scripts, the cloud inventory collectors                    |

Dependencies in the server point inward: `api → application → simulation /
authorization → domain`. [Architecture](Architecture) explains each part.

## Toolchain

| Tool   | Version                                                                        | Where it is stated                  |
| ------ | ------------------------------------------------------------------------------ | ----------------------------------- |
| Rust   | stable, with `rustfmt` and `clippy`; the minimum supported version is 1.85     | `rust-toolchain.toml`, `Cargo.toml` |
| Node   | 24; `engines` requires at least 22.12                                          | `.nvmrc`, `package.json`            |
| pnpm   | 12.18.0                                                                        | `packageManager` in `package.json`  |
| wasm32 | the `wasm32-unknown-unknown` target, for the static site only                  | `scripts/build-engine.sh`           |
| Python | Python 3, standard library only, for the scripts in `scripts/` and their tests |                                     |

An older default `node` fails in Vitest, so check `node -v` first. Run
`pnpm install` once. Nothing needs credentials, tokens or a `.env`.

```bash
rustup target add wasm32-unknown-unknown
```

## Run each part

### The server and the web client

```bash
cargo run -p aegis-server     # API on http://127.0.0.1:8787  (alias: pnpm dev:server)
pnpm dev:web                  # UI on http://localhost:5173, proxies /api and the WebSocket
docker compose up --build     # both, containerised, on http://localhost:8080
```

`pnpm dev` starts Vite plus a typecheck watch on the contracts; it does not
start the server.

### The server on your own files

```bash
cargo run -p aegis-server -- export-workspace <dir>   # the bundled files, to edit
cargo run -p aegis-server -- check-workspace <dir>    # validate one; try examples/corner-shop
cargo run -p aegis-server -- diff-workspace <base> <candidate>   # what Cedar decides differently; @bundled is the bundled set
cargo run -p aegis-server -- compare-incident <base> <candidate> <scenario>   # one scenario on each side's platform, side by side
AEGIS_WORKSPACE=<dir> cargo run -p aegis-server
```

The formats are on [Workspace files](Workspace-files).

### The static site

```bash
pnpm engine:build     # apps/wasm → apps/web/src/engine/aegis.wasm (git-ignored)
pnpm dev:static       # Vite on http://localhost:5173, no proxy, engine in a worker
pnpm build:static     # engine:build, then apps/web/dist-static
pnpm --filter @aegis/web preview:static
```

## Checks, as CI runs them

These are the commands of
[`.github/workflows/ci.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/.github/workflows/ci.yml),
in order:

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

CI runs them in five jobs on every push to `main` and every pull request:

| Job         | What it runs                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Rust        | `./scripts/version.sh` (one version in every manifest), format, Clippy, tests, and the contract samples regenerated and compared |
| Web         | Format, typecheck, lint, unit tests, the Python tests and the production build                                                   |
| End-to-end  | A release build of the server, then Playwright                                                                                   |
| Static site | Clippy for the browser target, the engine module, its test, and Playwright with no server                                        |
| Docker      | Both images built, started together and probed through the web container                                                         |

## Run a single test

```bash
cargo test -p aegis-server --test simulation <name_substring>   # one file of apps/server/tests/
cargo test -p aegis-server --lib <module::or::name>             # unit tests inside src/
pnpm --filter @aegis/web exec vitest run src/stores/ui.test.ts
pnpm --filter @aegis/web exec vitest run -t "part of the test name"
pnpm --filter @aegis/contracts test
pnpm --filter @aegis/web exec playwright test -g "part of the title" --project chromium
cargo test -p aegis-wasm <name_substring>                        # the engine's boundary, natively
pnpm --filter @aegis/web exec playwright test --config playwright.static.config.ts -g "part of the title"
python3 -B scripts/test_export_otel_capture.py -k token          # one Python test file, narrowed by name
```

The server's integration tests are the files of
[`apps/server/tests`](https://github.com/cleissonbarbosa/csdt/tree/main/apps/server/tests).
They build the application through `tests/common`, call the router in
process and advance time themselves.

## End-to-end tests

- Playwright starts its own release server and production web build, and
  never reuses a running development instance. The first run compiles the
  server in release mode. `pnpm --filter @aegis/web e2e:install` installs the
  browser.
- Every test shares one simulation, so the suite runs serially with one
  worker. Each test begins with `openApp()` from `e2e/support.ts`, which
  resets the simulation, imported files included.
- A failure stops the tests after it. `AEGIS_E2E_KEEP_GOING=1` runs them all,
  to see every failure of a run at once.
- `window.__aegis` answers from the last frame drawn: read a position or a
  draw count only after `waitForScene`.

| Project         | What it runs on                                                            |
| --------------- | -------------------------------------------------------------------------- |
| `chromium`      | Software WebGL 2, what CI has                                              |
| `no-3d`         | Every GPU API disabled: the table view                                     |
| `chrome-webgpu` | Only with `AEGIS_E2E_GPU=1`, on a locally installed Chrome with a real GPU |

## Diagnostics

These are not part of the normal test run:

```bash
# Per-scenario trace table. Narrow with TRACE_SCENARIO=<id>, TRACE_TOPOLOGY=<id>, TRACE_EVENTS=1.
cargo test -p aegis-server --test trace -- --ignored --nocapture
# Engine micro-benchmark; only meaningful with --release.
cargo test --release -p aegis-server --test trace engine_step_cost -- --ignored --nocapture
# Parity with a locally built cedar-agent; reports "skipped" when the variable is unset.
AEGIS_TEST_CEDAR_AGENT_BIN=/path/to/cedar-agent cargo test -p aegis-server --test integrations
```

## Ports

The ports are deliberately separate, so two runs never share a simulation.

| Use                                               | Server | Web  |
| ------------------------------------------------- | ------ | ---- |
| Development                                       | 8787   | 5173 |
| `vite preview`                                    | 8787   | 4173 |
| Playwright                                        | 8797   | 4183 |
| Playwright, static site (`pnpm e2e:static`)       | none   | 4187 |
| `scripts/capture-docs.sh`, `scripts/benchmark.sh` | 8798   | 4184 |

## Contract samples and JSON Schemas

The Rust `domain` module is the source of truth for the contract, and
`packages/contracts/src/index.ts` mirrors it as zod schemas.
`packages/contracts/samples/` holds real server output, written by the
`export-contract-samples` binary. The contract tests require every parsed
sample to equal its input, and CI fails if the committed samples differ from
what the server emits. After changing a domain type, a route's response or a
fixture:

```bash
pnpm contracts:samples    # then update src/index.ts to match and commit both
```

The JSON Schemas in `schemas/v1/` are generated from the same Rust types.
After changing a type or a `#[schemars(...)]` bound, regenerate them and
commit the result; a Rust test fails on a stale schema:

```bash
pnpm workspace:schemas
```

Everything under `fixtures/` is compiled into the server, so editing a
fixture means rebuilding it. A field change in a public format also means
updating `docs/WORKSPACE.md` and `examples/corner-shop`, and a change an
existing file would not survive needs a new `FORMAT_VERSION` in
`workspace.rs`.

## The version and releases

`Cargo.toml` states the version, the server reports it, and three
`package.json` files, `Cargo.lock` and the health sample repeat it.

```bash
./scripts/version.sh              # print it; fails if a manifest states another
./scripts/version.sh set 0.2.0    # write it everywhere; runs the exporter of contract samples
```

Publishing is a person's decision:

- **A release** is made by the commit that changes the version, and by
  nothing else. Once that commit passes CI on `main`, the release workflow
  builds the two images from the tested commit, starts them and asks the
  server for its version, pushes them to the GitHub Container Registry, tags
  the commit `v<version>` and publishes a GitHub release. A version with a
  suffix (`0.2.0-rc.1`) is a pre-release and moves neither `latest` nor
  `MAJOR.MINOR`. The version is changed with `version.sh`, never by hand.
- **The version follows the code.** A change to what the server, the
  engine, the page, the contract or a file format does raises it, in a
  commit of its own after that work: PATCH for a fix that changes nothing a
  client or a file relies on, MINOR for anything else. Documents, the wiki,
  tests and CI leave it alone. Pushing that commit to `main` is the
  decision to publish.
- **The static site** is deployed to GitHub Pages by
  `.github/workflows/pages.yml`, which runs only when started by hand.
- **The wiki** is published by a person too; see [The wiki](#the-wiki).

## Project rules

- **Nothing is fabricated.** Figures in `docs/PERFORMANCE.md` come from
  `./scripts/benchmark.sh`, and images in `docs/assets/` from
  `./scripts/capture-docs.sh`, both run against the application. Do not
  hand-edit a number or describe something unmeasured as measured.
- **Provenance is always labelled.** Data is `synthetic`, `recording` (an
  incident capture, labelled "Capture") or `live`, from where it is produced
  to the pixel.
- **Simulation only.** `simulation` and `incidents` perform no I/O; files
  are read by `workspace::load` alone, at start-up. The server, the engine
  and the page hold no cloud SDK or credential, and make no outbound
  connection by default.
- **Determinism.** `engine::step` never reads a clock, uses a global counter
  or iterates an unordered collection; anything that changes over time lives
  in `SimState`.
- **Rust.** `unsafe` is forbidden in the server crate; the engine crate
  denies it and allows the lint only on its exported `#[no_mangle]`
  functions, with no `unsafe` block. `dbg!` and `todo!` are denied, and
  `unwrap()` outside tests is a Clippy warning that CI turns into a failure.
  Request bodies reject unknown fields.
- **TypeScript** is strict with `noUncheckedIndexedAccess`, and
  `react-hooks/exhaustive-deps` is an error.
- **Words and languages.** Docs and code comments are in English. Interface
  text goes through `t()`, and each phrase needs its Portuguese translation
  in `apps/web/src/i18n/pt-BR/`, or the tests fail. A visual change is judged
  against [`docs/DESIGN.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md)
  ([Design principles](Design-principles)).
- **Formatting.** Prettier skips `packages/contracts/samples`, `fixtures`
  and `docs/assets`; do not reformat them by hand.

## Contributing a change

1. Read the part of `AGENTS.md` about the area you touch, and
   `docs/DESIGN.md` for anything visual.
2. Make the change with its tests, and run the checks above that it
   concerns.
3. Regenerate what the change affects: the contract samples, the JSON
   Schemas, a document or the example workspace.
4. Leave the version alone, and open a pull request. CI runs on it.

### The wiki

This wiki's source is
[`docs/wiki/`](https://github.com/cleissonbarbosa/csdt/tree/main/docs/wiki):
one file per page in `en/` and in `pt-BR/`, plus `_Sidebar.md` and
`_Footer.md`, which both languages share. A correction is a pull request
there, made in both languages. `scripts/test_wiki.py` holds the two
languages together, and CI runs it with the other Python tests:

- the first line of a page links to its translation, and is linked back;
- a page and its translation have the same headings, by level;
- code blocks are identical in both languages (only a `mermaid` block is
  translated);
- every link reaches a page of the same language, a heading of it, or a
  file of the repository on `main`, and every image is one of `docs/assets/`.

```bash
python3 -B scripts/test_wiki.py
```

`scripts/wiki.sh` lays the pages out flat in a checkout of the wiki's own
repository, as the GitHub wiki holds them, and prints `git status` there. It
refuses unless `scripts/test_wiki.py` passes, and commits and pushes
nothing: publishing the wiki is a person's decision. The wiki's repository
exists only once its first page has been saved on GitHub.

```bash
git clone https://github.com/cleissonbarbosa/csdt.wiki.git ../csdt.wiki
./scripts/wiki.sh ../csdt.wiki
```

## Reference

- [`AGENTS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md): toolchain, commands, ports, end-to-end notes and project rules
- [`README.md`](https://github.com/cleissonbarbosa/csdt/blob/main/README.md): tests, releases and project layout
- [`docs/ARCHITECTURE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/ARCHITECTURE.md): repository layout and contract testing
- [`package.json`](https://github.com/cleissonbarbosa/csdt/blob/main/package.json): the scripts
- [`.github/workflows/ci.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/.github/workflows/ci.yml), [`release.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/.github/workflows/release.yml), [`pages.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/.github/workflows/pages.yml)
- [`scripts/version.sh`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/version.sh), [`scripts/test_wiki.py`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/test_wiki.py), [`scripts/wiki.sh`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/wiki.sh)
- [`apps/web/playwright.config.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/playwright.config.ts)

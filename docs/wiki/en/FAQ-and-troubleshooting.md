**English** · [Português](Perguntas-frequentes)

Short answers to common questions, and the usual fix for each problem. Each
answer points to the page or document that has the whole story.

## Running it

### Vitest or pnpm fails with an older Node

AEGIS needs Node 24, the version `.nvmrc` names; `package.json` requires at
least 22.12, and an older default `node` fails in Vitest. Check the version
first, then switch to Node 24 and install again:

```bash
node -v
pnpm install
```

pnpm itself is pinned to 12.18.0 by `packageManager` in `package.json`.
[Development](Development#toolchain) lists the whole toolchain.

### `pnpm engine:build` says the wasm32 target is not installed

The static site needs the engine compiled to WebAssembly, and that needs a
Rust target that is not installed by default. The script stops with:

```text
build-engine: the wasm32-unknown-unknown target is not installed. Run: rustup target add wasm32-unknown-unknown
```

Add the target and build again:

```bash
rustup target add wasm32-unknown-unknown
pnpm engine:build
```

A static build started without the module stops with "The engine module is
not built". `pnpm build:static` runs `pnpm engine:build` first, so it does
not have this problem.

### Which port is which?

| Address                 | What answers there                                               |
| ----------------------- | ---------------------------------------------------------------- |
| `http://127.0.0.1:8787` | The server (`cargo run -p aegis-server`)                         |
| `http://localhost:5173` | The interface in development (`pnpm dev:web`, `pnpm dev:static`) |
| `http://localhost:4173` | `vite preview`, including `preview:static`                       |
| `http://localhost:8080` | Docker Compose: the web container, which passes the API on       |

The test runs and the screenshot and benchmark scripts use ports of their
own, so they never share a simulation with your development instance. They
are listed on [Development](Development#ports).

### A port is already in use

Vite does not move to another port when its own is taken: it stops. Free
the port, or move the other side:

- **The server** listens on `AEGIS_BIND` (by default `127.0.0.1:8787`). If
  you move it, tell Vite where it is with `AEGIS_API_PROXY`.
- **Docker** publishes the interface on `AEGIS_WEB_PORT` (by default
  `8080`). The browser's origin changes with the port, so add it to
  `AEGIS_ALLOWED_ORIGINS`, which the server checks for CORS and the stream.

```bash
AEGIS_BIND=127.0.0.1:<port> cargo run -p aegis-server
AEGIS_API_PROXY=http://127.0.0.1:<port> pnpm dev:web
AEGIS_WEB_PORT=<port> AEGIS_ALLOWED_ORIGINS=http://localhost:<port> docker compose up --build
```

### The published site does not have a recent change

The static site is deployed by a workflow that runs only when someone starts
it by hand, so it can be behind `main`. Build the current code yourself with
`pnpm build:static` ([Getting started](Getting-started)). The site's service
worker asks the network for the page first, so a visitor who is online gets
the build that is published.

## The 3D view

### My browser has no WebGPU

Nothing is lost. The scene's materials are written once and run on WebGPU or
on WebGL 2, so WebGL 2 draws the same model. The page asks the browser for a
WebGPU adapter rather than trusting that the API exists, because a blocked
GPU, a headless browser or a remote desktop can offer the API without an
adapter.

- To use WebGL 2 even where WebGPU works, open **⋯** → **Settings** and set
  **Graphics backend** to **WebGL 2**. The scene restarts.
- With neither API, the page says "This browser offers neither WebGPU nor
  WebGL 2, so the 3D scene is unavailable. Showing the table view instead."
  If the renderer fails to start, it says "The 3D renderer could not start
  on this device." Both show the table view.
- <kbd>T</kbd> switches to the table view at any time. It holds the whole
  topology without 3D, and can be used with a screen reader.

### The model is slow

With **Rendering quality** on **Auto** (in **⋯** → **Settings**), the scene
steps down through four tiers when frames stay slow, and back up when there
is room. Lower tiers reduce the resolution, the bead density and the
distance at which names are shown; names stay sharp at every tier. You can
also pin a tier.

Press <kbd>P</kbd> for the performance overlay: frame rate, frame time, draw
calls, bead count and backend. On software rendering the scene stays slow at
every tier: the quality controller lowers the cost of a frame, but it cannot
make a machine without a GPU fast. [Performance](Performance) has the
measurements.

### Why is almost nothing coloured?

Because colour is an answer. Blue answers you: the selection, the request
you trace, keyboard focus, links. Amber, red and magenta answer the data:
something deviating, failing or stopped, and hostile traffic. A healthy
service has no colour, no dot and no badge, and the top bar says "51
services, all normal". When something happens, the colour you see is the
problem. The night theme keeps the same rule, and every state also has a
shape, so nothing depends on telling two hues apart.
[Design principles](Design-principles) explains the rules.

## Data and safety

### Is anything in AEGIS real?

The simulation is not. Helios Commerce, its services, metrics, incidents,
principals and policies are all synthetic. A platform loaded from your own
files is synthetic too: its figures are computed. What is real:

- **Cedar's decisions.** Every Allow and Deny is the answer of a real Cedar
  evaluation of the policies on show: the embedded `cedar-policy` engine, or
  a local cedar-agent you connect.
- **Incident captures.** A capture is a real incident, as a provider
  reported it or a system recorded it, read in your browser from a file.
  Two are bundled: Google Cloud's public report on the incident of 12 June
  2025, and aggregates of the RCAEval 0.2.0 Online Boutique benchmark. A
  capture is labelled "Captured, not simulated" or "From the provider's
  report, not simulated", and is never mixed into the simulation.
- **Live data**, only from a local instance you connect under
  [Integrations](Integrations), labelled `live`.

[Incident captures](Incident-captures) and the [Glossary](Glossary) say more.

### Does AEGIS connect to my cloud account?

No. The server, the engine and the page contain no cloud SDK and hold no
cloud credential, and they make no outbound connection by default. A cloud
inventory is a file that a collector in `scripts/` writes, which you run on
your own machine with your own credentials. The collectors (AWS, Google
Cloud, Oracle Cloud) call read operations only and write nothing that names
the account. AEGIS never runs them: the interface only writes the command
for you to run. The capture exporters work the same way. See
[Cloud inventories](Cloud-inventories) and
[Security model](Security-model).

### Can I run it where other people reach it?

Only behind something that controls access. AEGIS has no authentication,
and there is one simulation: anyone who can reach the API can start
scenarios and reset the simulation for everyone connected, and, while
importing is on, replace the platform everyone sees. If you expose it:

- put it behind an authenticating reverse proxy;
- set `AEGIS_ALLOWED_ORIGINS` to the exact public origin;
- set `AEGIS_IMPORT=off` where nobody should replace what is on show.

The Docker setup binds the web port to `127.0.0.1` and does not publish the
API port. The static site is the other option: it is plain files with no
server, so publishing it shows the bundled fictional platform and nothing
else. [Security model](Security-model) has every boundary.

### What does the browser keep?

AEGIS collects no telemetry about you. The browser keeps, in
`localStorage`:

| Key                 | What it holds                                                                                                              | How to clear it                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `aegis.settings.v1` | Your **Settings**: language, theme, rendering quality, graphics backend, labels, camera drift, motion, performance overlay | **Restore defaults** in **Settings**                             |
| `aegis.guide.v1`    | Whether the first-visit card was used or dismissed, and which challenges you solved                                        | **Start over** in **Guided challenges** (solved challenges only) |

The static site also installs a service worker that keeps the site's own
files, so it opens with no network. It keeps one cache, named after the
build, which the next build replaces.

Some things are deliberately not kept. An incident capture file is held in
the page's memory and is gone on reload. Files imported on the static site
stay in the tab and are gone on reload; on a server, an import lives in the
server's memory until it restarts.

## Language

### How do I switch the language?

Open **⋯** → **Settings** and choose **Language**: **Browser** (the
browser's first language), **English** or **Português (Brasil)**. The
language is read when the page loads, so changing it reloads the page. On a
server the simulation goes on as it is; on the static site it starts again
in the tab. The choice is kept in this browser.

### Why are some texts in English in the Portuguese interface?

The interface is translated, but what the server or a file wrote is shown as
written: names, a scenario's text, events and error messages. The bundled
platform's files are in English, so their scenario names, events and the
labels of the request tracer are too.

## Reference

- [`AGENTS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md): toolchain, ports and the interface's rules
- [`docs/SECURITY.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/SECURITY.md): what AEGIS cannot do, and deploying beyond localhost
- [`docs/PERFORMANCE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/PERFORMANCE.md): graceful degradation
- [`docs/DESIGN.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md): why colour is an answer
- [`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): scale and fallbacks
- [`apps/web/vite.config.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/vite.config.ts), [`scripts/build-engine.sh`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/build-engine.sh), [`apps/server/src/config.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/config.rs)
- [`apps/web/src/stores/ui.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/stores/ui.ts), [`apps/web/src/stores/guide.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/stores/guide.ts): what the browser keeps

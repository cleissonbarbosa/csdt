**English** · [Português](Primeiros-passos)

AEGIS runs in the browser alone, in two containers, or from source. Every
way shows the same fictional platform, _Helios Commerce_, and none needs
credentials, an account, a token or a `.env` file. This page shows each way
to start it, how to load a small platform of your own, the keyboard
shortcuts, and a first tour.

## What you need

| To run it                    | You need                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ |
| On the published static site | A browser. WebGPU is used when the browser has it, and WebGL 2 otherwise |
| With Docker                  | Docker with Compose                                                      |
| From the released images     | Docker with Compose                                                      |
| From source                  | Rust stable, Node 24 (at least 22.12) and pnpm 12.18.0                   |
| As a static site you build   | The same as from source, plus the `wasm32-unknown-unknown` Rust target   |

If a browser has neither WebGPU nor WebGL 2, the application shows the
platform as a table instead of the 3D model. The exact toolchain is on
[Development](Development#toolchain).

## Run it

### In the browser, with nothing to install

Open the [static site](https://cleissonbarbosa.github.io/csdt/). The
simulation engine runs in the tab, compiled to WebAssembly, and the page
requests nothing but its own files. The site is published by hand, so it can
be behind `main`.

Everything works the same there except Connected mode (the
[Integrations](Integrations)), which needs the server. Files you import stay
in the tab and are gone when you reload it.

### With Docker

```bash
git clone https://github.com/cleissonbarbosa/csdt.git aegis
cd aegis
docker compose up --build
```

Open `http://localhost:8080`. The web container serves the interface and
passes the API on to the server container. The API port is not published,
and the web port is bound to `127.0.0.1`.

`docker-compose.yml` reads these variables from your environment (or from a
`.env` file next to it). Each is optional:

| Variable                | Default                                       | What it sets                                                            |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `AEGIS_WEB_PORT`        | `8080`                                        | The port on `127.0.0.1` that the interface is served on                 |
| `AEGIS_ALLOWED_ORIGINS` | `http://localhost:8080,http://127.0.0.1:8080` | The origins a browser may load the interface from (CORS and the stream) |
| `AEGIS_SEED`            | `42`                                          | The seed of the deterministic simulation                                |
| `AEGIS_IMPORT`          | `on`                                          | Whether the interface may replace the platform's files                  |
| `AEGIS_LOG`             | `info`                                        | The server's log filter                                                 |

The integration variables are described on [Integrations](Integrations).

### From the released images

A released version runs from its published images, with nothing to build:

```bash
export AEGIS_SERVER_IMAGE=ghcr.io/cleissonbarbosa/aegis-server:latest
export AEGIS_WEB_IMAGE=ghcr.io/cleissonbarbosa/aegis-web:latest
docker compose up --no-build
```

A release tags each image with its version, its `MAJOR.MINOR` and `latest`;
a pre-release (`0.2.0-rc.1`) only with its version. The
[GitHub release](https://github.com/cleissonbarbosa/csdt/releases) lists
each image's digest, so you can name `image@sha256:…` instead of a tag that
moves.

### From source: server and web

Run the two processes in two terminals:

```bash
cargo run --release -p aegis-server     # API on http://127.0.0.1:8787
pnpm install
pnpm dev:web                            # UI on http://localhost:5173
```

Open `http://localhost:5173`. Vite passes `/api` and the WebSocket on to
`http://127.0.0.1:8787`; set `AEGIS_API_PROXY` if the server listens
elsewhere. `pnpm dev:server` is the same server as a debug build.

### As a static site you build yourself

```bash
rustup target add wasm32-unknown-unknown
pnpm install
pnpm build:static                          # the engine as WebAssembly and the site around it
pnpm --filter @aegis/web preview:static    # http://localhost:4173
```

`apps/web/dist-static` is then plain files that run the simulation in the
browser. While you change the code, `pnpm engine:build` followed by
`pnpm dev:static` serves the same site on `http://localhost:5173`.

## Try a platform of your own

The repository ships
[`examples/corner-shop`](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop),
a fictional shop of six services that uses every part of the file format.

- **In the interface:** open **⋯** (**More**), choose **Import or export
  files**, then **Choose a folder**, pick `examples/corner-shop` and press
  **Apply**. Applying starts a new timeline for everyone connected.
  **Return to what the server started with**, in the same dialog, brings
  Helios Commerce back.
- **From a terminal:** check the folder, then start the server on it. The
  server reads it once, at start-up, every time it starts. An import made in
  the interface, by contrast, lives in the server's memory until a restart.

```bash
cargo run -p aegis-server -- check-workspace examples/corner-shop
AEGIS_WORKSPACE=examples/corner-shop cargo run --release -p aegis-server
```

- **With Docker:** `docker-compose.yml` has an `AEGIS_WORKSPACE: /workspace`
  line and a read-only volume, both commented out. Uncomment them and point
  the volume at your folder.

[Your own platform](Your-own-platform) covers the other ways: a Compose
file, a cloud inventory, or a platform drawn in the browser. The fields of
each file are on [Workspace files](Workspace-files).

## Keyboard shortcuts

**Help and legend**, in **⋯**, lists the same keys.

| Key                          | What it does                                               |
| ---------------------------- | ---------------------------------------------------------- |
| <kbd>Space</kbd>             | Play or pause the simulation                               |
| <kbd>R</kbd>                 | Reset the camera                                           |
| <kbd>F</kbd>                 | Move in on what is selected                                |
| <kbd>Esc</kbd>               | Let go of the selection, then put the panels away          |
| <kbd>Ctrl</kbd> <kbd>K</kbd> | Go to anything: a service, a region, a scenario, an action |
| <kbd>/</kbd>                 | Search services                                            |
| <kbd>L</kbd>                 | Next arrangement: overview, by region, by dependency       |
| <kbd>T</kbd>                 | Switch between the 3D view and the table                   |
| <kbd>P</kbd>                 | Toggle the performance overlay                             |
| <kbd>?</kbd>                 | Open this help                                             |
| <kbd>←</kbd> <kbd>→</kbd>    | On the timeline: step 5 s (hold Shift for 30 s)            |

While an incident capture is open, <kbd>Space</kbd> plays or pauses the
capture, <kbd>/</kbd> lists its services, <kbd>←</kbd> <kbd>→</kbd> step
through its own timeline, and <kbd>Home</kbd> / <kbd>End</kbd> go to its
start or end. A capture is drawn by region only and has no command
palette, so the help does not list <kbd>Ctrl</kbd> <kbd>K</kbd> or
<kbd>L</kbd> there.

## A five-minute tour

This is a condensed version of the tour in
[`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md).
Names that come from the platform's files (principals, actions, scenarios)
are shown as the files wrote them.

### 1. Read the overview

The page opens on the **overview**: Helios Commerce reduced to one piece per
kind of service, on four plates, one for each layer a request crosses
(entry, identity, compute, data). How far into the picture a piece stands is
how far along the path it is. Beads on the wires are requests.

Nothing is coloured, and the top bar says "51 services, all normal". Colour
is kept for answers. Drag to orbit, scroll to zoom, right-drag to pan;
<kbd>R</kbd> resets the camera.

### 2. From a kind to a service

Click the Cedar authorizers. A card shows the three of them together, each
figure with its normal range, and lists the instances by region. Click one
instance: the model changes to the arrangement by region with that service
selected. <kbd>Esc</kbd> lets it go. **Overview**, **Regions** and
**Dependencies** switch arrangements.

### 3. Follow a request through Cedar

Press **Test an authorization** in the top bar. Choose the principal
**Mallory**, the action **Export ledger** and the resource **Acme ledger
2026**, then press **Evaluate with Cedar**. The request crosses the model and
stops at the Cedar authorizers: **Deny**, determined by
`forbid-cross-tenant`. The red marks where the request you followed ended,
not a failure. Every decision is what the `cedar-policy` engine returned.
[Cedar policies](Cedar-policies) goes further.

### 4. Launch an incident

Press **Explore an incident** and **Start** next to **DDoS Surge**. The
timeline appears at the foot of the screen; set the speed to **2×**.
Suspicious traffic, drawn as magenta triangles, pours from the clients
through the edge router into the gateways, and the services it reaches
change state. The threat monitor raises "Volumetric attack detected", and
then the mitigation stops the flood at the edge router.

### 5. Travel in time

Press **Pause**. Drag the playhead back to before the incident: the model,
the signals and every card return to exactly that moment. Press **Play** to
re-simulate the history bit for bit; the bar says **History**. **Replay the
incident** goes back to where the latest one began, and **Now** returns to
the simulation's now. [Incidents and time travel](Incidents-and-time-travel)
explains what you see, and how to compare a change.

### Where to go next

| To                                        | Read                                               |
| ----------------------------------------- | -------------------------------------------------- |
| Learn every part of the screen            | [Using the interface](Using-the-interface)         |
| Run the simulation on your own files      | [Your own platform](Your-own-platform)             |
| Look at a real incident in the same model | [Incident captures](Incident-captures)             |
| Fix a problem with running AEGIS          | [FAQ and troubleshooting](FAQ-and-troubleshooting) |

## Reference

- [`README.md`](https://github.com/cleissonbarbosa/csdt/blob/main/README.md): quick start
- [`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): the full tour
- [`docker-compose.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/docker-compose.yml)
- [`.env.example`](https://github.com/cleissonbarbosa/csdt/blob/main/.env.example): every server variable
- [`examples/corner-shop/README.md`](https://github.com/cleissonbarbosa/csdt/blob/main/examples/corner-shop/README.md)
- [`apps/web/src/features/help/HelpDialog.tsx`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/help/HelpDialog.tsx): the keyboard shortcuts

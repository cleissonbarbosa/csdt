# Performance

Everything on this page was measured on the hardware and software listed
below, with the commands shown. Nothing is estimated. Where a figure does
**not** answer the question you might expect it to, that is said next to it.

## Test conditions

|          |                                                                                               |
| -------- | --------------------------------------------------------------------------------------------- |
| Date     | 2026-11-16 (UTC)                                                                              |
| CPU      | AMD Ryzen 5 5600G (6 cores / 12 threads)                                                      |
| GPU      | NVIDIA GeForce RTX 3050 8 GB, driver 580.178.04, Vulkan 1.4                                   |
| OS       | Ubuntu 24.04.5 LTS, Linux 7.0                                                                 |
| Browser  | Chrome 157.0.8103.78 (headless, offscreen), ANGLE on Vulkan                                   |
| Viewport | 1920 × 1080 at device pixel ratio 1                                                           |
| Build    | production (`vite build`) made 2026-11-16 05:25 UTC, served by `vite preview`; release server |
| Settings | quality **ultra**, light theme, camera drifting so every frame is a full redraw               |
| Method   | 4 s warm-up, then every `requestAnimationFrame` interval for 12 s                             |

Reproduce with:

```bash
cargo build --release -p aegis-server && pnpm build
./scripts/benchmark.sh --out results.json
```

The raw output of the run reported here is in
[`assets/benchmark-2026-11-16.json`](assets/benchmark-2026-11-16.json). The
run before it, on an earlier build, is kept as
[`assets/benchmark-2026-11-15.json`](assets/benchmark-2026-11-15.json).

> **What is measured is the arrangement that draws every service.** The
> application opens on an overview of at most twelve pieces; the benchmark
> opens it with `?arrangement=regions` instead, as a returning visitor (the
> card of a first visit is not on the stage). The overview has not been
> measured.

## Frame cost

Frames produced with the frame-rate limit and vsync disabled
(`--disable-frame-rate-limit --disable-gpu-vsync`), so the interval between
frames is the time it takes to produce one. The interface is on screen here
too.

| Scene                    | Services / connections | Backend | Mean frame |     p95 |     p99 | Frames/s | Draw calls | Triangles | Beads shown |
| ------------------------ | ---------------------: | ------- | ---------: | ------: | ------: | -------: | ---------: | --------: | ----------: |
| Helios · steady state    |                51 / 75 | WebGPU  |    2.30 ms |  3.0 ms |  3.4 ms |      434 |         28 |    78,973 |       2,330 |
| Helios · DDoS surge      |                51 / 75 | WebGPU  |    3.11 ms |  3.7 ms |  5.1 ms |      322 |         28 |    78,971 |       2,933 |
| Stress · steady state    |              178 / 648 | WebGPU  |    2.47 ms |  3.1 ms |  3.8 ms |      405 |         34 |   260,213 |       2,132 |
| Stress · regional outage |              178 / 648 | WebGPU  |    2.79 ms |  3.5 ms |  5.2 ms |      358 |         34 |   260,213 |       1,960 |
| Helios · steady state    |                51 / 75 | WebGL 2 |    9.04 ms |  9.9 ms | 10.5 ms |      111 |         28 |    78,971 |       2,348 |
| Helios · DDoS surge      |                51 / 75 | WebGL 2 |    9.67 ms | 11.2 ms | 11.8 ms |      103 |         28 |    78,971 |       2,939 |
| Stress · steady state    |              178 / 648 | WebGL 2 |    9.32 ms | 10.3 ms | 11.4 ms |      107 |         34 |   260,213 |       2,132 |
| Stress · regional outage |              178 / 648 | WebGL 2 |    9.69 ms | 11.4 ms | 12.3 ms |      103 |         34 |   260,213 |       1,960 |

**What this shows**

- **WebGPU:** 2.7 ms per frame on average, worst p99
  5.2 ms, across all four scenes (322–434 frames/s).
- **WebGL 2:** 9.4 ms per frame on average, worst p99 12.3 ms
  (103–111 frames/s), running the same TSL materials.
- A 60 Hz display allows 16.7 ms per frame. Both backends produce a 1080p
  frame inside that budget with room to spare on this GPU.
- **Scale barely matters.** Going from 51 services and 75 connections to 178
  and 648 adds 6 draw calls (28 → 34) and
  a few tenths of a millisecond, because every object class is one instanced
  draw.
- **Slower than the run before it.** On the build measured on 2026-11-15 the
  same four scenes took 1.7 to 1.9 ms on WebGPU and 7.0 to 8.1 ms on WebGL 2.
  The pieces have been remodelled since, each with a part that works, and
  the names are drawn differently; how much of the difference is the names
  is measured [below](#what-the-names-cost). The rest was not isolated.
- **There is one pass.** The scene has no post-processing: no bloom, no
  blur, no tone mapping. A frame is the scene drawn once to the canvas.

## Frame pacing with the whole interface

The same scenes with Chrome's default frame pacing: `requestAnimationFrame`
is throttled to the 60 Hz the compositor asks for, and every frame has to
composite the 3D canvas together with the interface drawn over it. The page
is in its default state: the model, the top bar and the timeline strip.

| Scene                    | Services / connections | Backend | Mean frame |     p95 |     p99 | Frames/s | Draw calls | Triangles | Beads shown |
| ------------------------ | ---------------------: | ------- | ---------: | ------: | ------: | -------: | ---------: | --------: | ----------: |
| Helios · steady state    |                51 / 75 | WebGPU  |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         28 |    78,971 |       2,332 |
| Helios · DDoS surge      |                51 / 75 | WebGPU  |   16.66 ms | 16.8 ms | 16.8 ms |       60 |         28 |    78,971 |       2,933 |
| Stress · steady state    |              178 / 648 | WebGPU  |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         34 |   260,213 |       2,132 |
| Stress · regional outage |              178 / 648 | WebGPU  |   16.66 ms | 16.7 ms | 16.8 ms |       60 |         34 |   260,213 |       1,960 |
| Helios · steady state    |                51 / 75 | WebGL 2 |   16.65 ms | 16.8 ms | 16.8 ms |       60 |         28 |    78,971 |       2,353 |
| Helios · DDoS surge      |                51 / 75 | WebGL 2 |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         28 |    78,971 |       2,934 |
| Stress · steady state    |              178 / 648 | WebGL 2 |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         34 |   260,213 |       2,137 |
| Stress · regional outage |              178 / 648 | WebGL 2 |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         34 |   260,213 |       1,960 |

Every scene held 60.0–60.1 frames/s on both backends, with a worst p95
interval of 16.8 ms.

**What this does not show**

All of this ran in **headless** Chrome, which has no display and cannot present
a WebGPU canvas to one. The first table is the cost of producing a frame; the
second shows the page keeping up with a 60 Hz compositor. Neither is a
measurement of a visible window on a monitor, and this project does not claim
one. To measure on your own display:

```bash
./scripts/benchmark.sh --headed          # opens a Chrome window for a few minutes
```

or press <kbd>P</kbd> in the running application for the live overlay (frame
rate, frame time, p95, draw calls, triangles, beads, backend, quality).

## What the names cost

Names used to be one more instanced draw in the scene. They are now drawn on
a canvas of their own over it, so that they stay sharp whatever resolution
the scene is rendered at and can be kept from lying across each other
([ARCHITECTURE.md](ARCHITECTURE.md#rendering)). That is one draw call fewer
and it is not free. The benchmark was run a second time on the same build
with names switched off (`--settings '{"labels":false}'`), frame-rate limit
off; its raw output is
[`assets/benchmark-2026-11-16-names-off.json`](assets/benchmark-2026-11-16-names-off.json).

| Scene                    | Backend | Names shown | Script per frame | Frame, names on | Frame, names off | Difference |
| ------------------------ | ------- | ----------: | ---------------: | --------------: | ---------------: | ---------: |
| Helios · steady state    | WebGPU  |           3 |          0.02 ms |         2.30 ms |          1.97 ms |    0.33 ms |
| Helios · DDoS surge      | WebGPU  |          35 |          0.15 ms |         3.11 ms |          2.21 ms |    0.90 ms |
| Stress · steady state    | WebGPU  |           7 |          0.06 ms |         2.47 ms |          2.12 ms |    0.35 ms |
| Stress · regional outage | WebGPU  |           7 |          0.05 ms |         2.79 ms |          2.38 ms |    0.41 ms |
| Helios · steady state    | WebGL 2 |           3 |          0.07 ms |         9.04 ms |          8.37 ms |    0.67 ms |
| Helios · DDoS surge      | WebGL 2 |          35 |          0.15 ms |         9.67 ms |          8.56 ms |    1.11 ms |
| Stress · steady state    | WebGL 2 |           7 |          0.08 ms |         9.32 ms |          8.42 ms |    0.90 ms |
| Stress · regional outage | WebGL 2 |           7 |          0.09 ms |         9.69 ms |          8.75 ms |    0.94 ms |

- **Placing and drawing the names is 0.02 to 0.15 ms of script per
  frame**, as timed by the scene itself around that step (the "Names" line of
  the overlay under <kbd>P</kbd>). Each name is rasterised once and copied
  after that, and the canvas is redrawn only when the picture changed.
- **A frame with names takes 0.33 to 1.11 ms longer than one without.**
  The script accounts for a fraction of that. The rest was not isolated; the
  likeliest part is the compositor blending a full-screen layer that changes
  while the camera moves, which this benchmark makes it do on every frame.
- With Chrome's default pacing the cost does not show: every scene holds
  60 frames/s with names on.
- Not measured: a display denser than one device pixel per CSS pixel, where
  the names' canvas has four times the pixels or more, and the overview,
  where every piece is named.

## A regression the benchmark caught

The first complete run of this benchmark, on an earlier visual design, did
not look like the table above. The scene rendered in about 3 ms, yet with
default pacing every scene reported only 19–24 frames/s. Three measurements
on that build, 1080p, quality ultra, isolated the cause:

| Variant                                   |        WebGPU |       WebGL 2 |
| ----------------------------------------- | ------------: | ------------: |
| Full interface, as shipped at the time    | 23.7 frames/s | 21.3 frames/s |
| Same page with `backdrop-filter` disabled | 60.1 frames/s | 60.1 frames/s |
| Interface hidden, canvas only             | 60.0 frames/s | 60.2 frames/s |

The panels were translucent with a `backdrop-filter: blur()`. Blurring what
lies behind a panel forces the compositor to re-sample the canvas under it on
every frame, and in this configuration that cost several times more than
rendering the scene. The blur was removed, and the design that followed has
none: panels are opaque paper ([DESIGN.md](DESIGN.md)).

Whether a visible window pays the same price was not measured. The raw output
of the earlier run is kept as
[`assets/benchmark-2026-11-15-backdrop-blur.json`](assets/benchmark-2026-11-15-backdrop-blur.json).

## Resource stability

One browser session, with a forced garbage collection before each sample.

**Scene rebuilds.** The topology was switched between the two bundled
topologies 12 times. Each switch disposes and rebuilds every
geometry, material and texture.

|                | Before | After each of the 12 rebuilds                             |
| -------------- | -----: | --------------------------------------------------------- |
| GPU geometries |     19 | 19 every time                                             |
| GPU textures   |      4 | 4 every time                                              |
| JS heap (MB)   |     16 | 16 · 15 · 16 · 18 · 16 · 18 · 17 · 18 · 17 · 18 · 17 · 18 |

GPU resource counts return to exactly the same values after every rebuild:
nothing is leaked on the GPU. The JS heap alternates with the size of the
loaded topology and, underneath that, rose from 15.8 to 18.3 MB over the
twelve rebuilds: about 0.2 MB per rebuild. The
application's own history buffers are bounded and still filling during a run
this short, and each name that has been shown is kept as a small bitmap
until the next rebuild, either of which would account for growth of that
size, but neither was isolated, and twelve rebuilds are too few to rule out
a slow leak.

**Repeated playback.** A recorded incident was loaded and the timeline was
sought to six different points per round, for six rounds (36 seeks),
at 4× speed.

|                | Start | After each round                      |
| -------------- | ----: | ------------------------------------- |
| JS heap (MB)   |  17.9 | 16.8 · 17 · 17.2 · 17.3 · 17.3 · 17.4 |
| GPU geometries |    19 | 20 every time                         |

The heap went from 17.9 MB (measured just after the rebuilds above) to
17.4 MB over the 36 seeks, rising by a little less each round after the
first. The same caveat applies.

## Simulation engine

Single-threaded, release build, measured with
`cargo test --release -p aegis-server --test trace engine_step_cost -- --ignored --nocapture`
while a cascading-failure scenario runs.

| Topology          | Services / connections | One tick | Snapshot (build + JSON) | Snapshot size | Random seek |
| ----------------- | ---------------------: | -------: | ----------------------: | ------------: | ----------: |
| Helios Commerce   |                51 / 75 |    26 µs |                   14 µs |       4.3 KiB |      0.3 ms |
| Hyperscale Stress |              178 / 648 |    41 µs |                   71 µs |      20.8 KiB |      0.5 ms |

At 1× the engine runs 5 ticks per second (20 at 4×), so the simulation uses a
fraction of a percent of one core. A seek restores the nearest checkpoint
(taken every 5 virtual seconds) and re-steps at most 24 ticks.

## Graceful degradation

`AdaptiveQuality` steps between four tiers when the smoothed frame time stays
above 22 ms, and back up after sustained headroom; a tier that proved too
expensive becomes the ceiling. Lower tiers reduce the pixel ratio, bead
density and the distance at which names are shown. They do not make names
softer: those are drawn on a canvas of their own, at the display's
resolution at every tier.

This was observed on the measured build with software rendering (SwiftShader
WebGL 2, 1280 × 720, quality on auto): the scene started on `high`, stepped to
`medium` after about 12 s and to `low` after about 20 s, and stayed there.
Software rasterisation remained slow at every tier, around 7 frames/s,
so the controller lowers the cost of a frame but cannot make a machine
without a GPU fast.

The end-to-end suite runs on software WebGL 2 (SwiftShader, the renderer CI
uses), pinned to the `low` tier, and passes there. With every GPU API
disabled the application falls back to its table view, which is also covered
by an end-to-end test.

## How the scene stays cheap

| Technique                                                                                                                                                                 | Where                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| GPU instancing: one draw per service type (modelled pieces, one shared geometry each), one for all connections, one for all beads, one for everything lying on the plates | `graphics/SceneController.ts`                    |
| Stateless beads: animation is a function of `time` and four seeds, evaluated in the vertex shader                                                                         | `graphics/materials.ts`                          |
| Per-connection data texture: the CPU updates one small float texture, never per-bead buffers                                                                              | `createParticleMaterial`                         |
| Names on a 2D canvas over the scene: measured once, placed by importance, and redrawn only when the picture changed                                                       | `graphics/labelLayer.ts`                         |
| No post-processing and no lights: materials shade themselves, one pass per frame                                                                                          | `graphics/materials.ts`                          |
| Level of detail: labels fade with distance; quality tiers scale bead density and resolution                                                                               | `graphics/quality.ts`                            |
| No React in the frame loop: stores are read through subscriptions, lists throttle to 1 Hz                                                                                 | `features/scene/SceneCanvas.tsx`, `app/hooks.ts` |
| Columnar snapshots: struct-of-arrays on the wire, copied straight into typed arrays                                                                                       | `domain/telemetry.rs`                            |
| Serialise once, fan out: each stream message is encoded one time for all subscribers                                                                                      | `application/service.rs`                         |

## Test suite timings

Wall-clock on the same machine, each from its command to its exit, with the
builds it needs already made (the end-to-end suites still start their own
server and preview).

| Suite                                                                                                     | Tests |       Time |
| --------------------------------------------------------------------------------------------------------- | ----: | ---------: |
| Rust: engine, timeline, Cedar, API, stream, adapters, reports, comparisons (`cargo test --workspace`)     |   208 |        6 s |
| Contracts and web: schemas, palette rules, layout, names, stores, stream client, components (`pnpm test`) |   454 |       30 s |
| The engine built for the browser, in Node (`pnpm test:engine`)                                            |    32 |        1 s |
| End to end on software WebGL 2, plus the no-GPU fallback (`pnpm e2e`)                                     |    25 | 7 min 52 s |
| End to end on WebGPU, real GPU (`AEGIS_E2E_GPU=1`, project `chrome-webgpu`)                               |    24 | 1 min 57 s |
| End to end on the static site, no server (`pnpm e2e:static`)                                              |     7 | 1 min 31 s |

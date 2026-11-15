# Performance

Everything on this page was measured on the hardware and software listed
below, with the commands shown. Nothing is estimated. Where a figure does
**not** answer the question you might expect it to, that is said next to it.

> **Which build.** These figures are from the production build made on
> 2026-11-15 at 03:45 UTC, when the service pieces were still generated
> procedurally. They have since been replaced by modelled pieces
> (`apps/web/src/graphics/pieces.glb`) with a different triangle count. The
> tables below have not been re-measured on that build yet.

## Test conditions

|          |                                                                                               |
| -------- | --------------------------------------------------------------------------------------------- |
| Date     | 2026-11-15 (UTC)                                                                              |
| CPU      | AMD Ryzen 5 5600G (6 cores / 12 threads)                                                      |
| GPU      | NVIDIA GeForce RTX 3050 8 GB, driver 580.178.04, Vulkan 1.4                                   |
| OS       | Ubuntu 24.04.5 LTS, Linux 7.0                                                                 |
| Browser  | Chrome 157.0.8103.78 (headless, offscreen), ANGLE on Vulkan                                   |
| Viewport | 1920 × 1080 at device pixel ratio 1                                                           |
| Build    | production (`vite build`) made 2026-11-15 03:45 UTC, served by `vite preview`; release server |
| Settings | quality **ultra**, light theme, camera drifting so every frame is a full redraw               |
| Method   | 4 s warm-up, then every `requestAnimationFrame` interval for 12 s                             |

Reproduce with:

```bash
cargo build --release -p aegis-server && pnpm build
./scripts/benchmark.sh --out results.json
```

The raw output of the run reported here is in
[`assets/benchmark-2026-11-15.json`](assets/benchmark-2026-11-15.json).

## Frame cost

Frames produced with the frame-rate limit and vsync disabled
(`--disable-frame-rate-limit --disable-gpu-vsync`), so the interval between
frames is the time it takes to produce one. The interface is on screen here
too.

| Scene                    | Services / connections | Backend | Mean frame |     p95 |     p99 | Frames/s | Draw calls | Triangles | Beads shown |
| ------------------------ | ---------------------: | ------- | ---------: | ------: | ------: | -------: | ---------: | --------: | ----------: |
| Helios · steady state    |                51 / 75 | WebGPU  |    1.90 ms |  2.6 ms |  4.1 ms |      527 |         29 |    54,525 |       2,372 |
| Helios · DDoS surge      |                51 / 75 | WebGPU  |    1.92 ms |  2.7 ms |  4.4 ms |      520 |         29 |    54,523 |       2,972 |
| Stress · steady state    |              178 / 648 | WebGPU  |    1.93 ms |  2.5 ms |  4.5 ms |      519 |         35 |   150,225 |       2,146 |
| Stress · regional outage |              178 / 648 | WebGPU  |    2.07 ms |  3.1 ms |  6.2 ms |      483 |         35 |   150,225 |       1,979 |
| Helios · steady state    |                51 / 75 | WebGL 2 |    6.98 ms |  8.3 ms |  9.4 ms |      143 |         29 |    54,523 |       2,383 |
| Helios · DDoS surge      |                51 / 75 | WebGL 2 |    6.98 ms |  8.3 ms | 10.0 ms |      143 |         29 |    54,523 |       2,972 |
| Stress · steady state    |              178 / 648 | WebGL 2 |    7.17 ms |  9.0 ms | 13.3 ms |      140 |         35 |   150,225 |       2,141 |
| Stress · regional outage |              178 / 648 | WebGL 2 |    7.36 ms | 10.4 ms | 14.7 ms |      136 |         35 |   150,225 |       1,979 |

**What this shows**

- **WebGPU:** 2.0 ms per frame on average, worst p99
  6.2 ms, across all four scenes (483–527 frames/s).
- **WebGL 2:** 7.1 ms per frame on average, worst p99 14.7 ms
  (136–143 frames/s), running the same TSL materials.
- A 60 Hz display allows 16.7 ms per frame. Both backends produce a 1080p
  frame inside that budget with room to spare on this GPU.
- **Scale barely matters.** Going from 51 services and 75 connections to 178
  and 648 adds 6 draw calls (29 → 35) and
  does not change frame time measurably, because every object class is one
  instanced draw.
- **There is one pass.** The scene has no post-processing: no bloom, no
  blur, no tone mapping. A frame is the scene drawn once to the canvas.

## Frame pacing with the whole interface

The same scenes with Chrome's default frame pacing: `requestAnimationFrame`
is throttled to the 60 Hz the compositor asks for, and every frame has to
composite the 3D canvas together with the panels, charts and timeline.

| Scene                    | Services / connections | Backend | Mean frame |     p95 |     p99 | Frames/s | Draw calls | Triangles | Beads shown |
| ------------------------ | ---------------------: | ------- | ---------: | ------: | ------: | -------: | ---------: | --------: | ----------: |
| Helios · steady state    |                51 / 75 | WebGPU  |   16.67 ms | 16.7 ms | 16.8 ms |       60 |         29 |    54,523 |       2,383 |
| Helios · DDoS surge      |                51 / 75 | WebGPU  |   16.66 ms | 16.7 ms | 16.8 ms |       60 |         29 |    54,523 |       2,972 |
| Stress · steady state    |              178 / 648 | WebGPU  |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         35 |   150,225 |       2,141 |
| Stress · regional outage |              178 / 648 | WebGPU  |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         35 |   150,225 |       1,979 |
| Helios · steady state    |                51 / 75 | WebGL 2 |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         29 |    54,523 |       2,383 |
| Helios · DDoS surge      |                51 / 75 | WebGL 2 |   16.65 ms | 16.8 ms | 16.8 ms |       60 |         29 |    54,523 |       2,972 |
| Stress · steady state    |              178 / 648 | WebGL 2 |   18.06 ms | 33.3 ms | 49.9 ms |       55 |         35 |   150,225 |       2,141 |
| Stress · regional outage |              178 / 648 | WebGL 2 |   16.65 ms | 16.7 ms | 16.8 ms |       60 |         35 |   150,225 |       1,979 |

7 of the 8 cases held 60.0–60.1 frames/s with a p95 interval of 16.8 ms or
less.

The exception was the stress topology at rest on WebGL 2: 55.4 frames/s, with
7.1 % of intervals longer than one refresh period and 1.5 % longer than two.
The same scene costs 7.2 ms a frame in the table above, well inside the
budget, so this was not the scene running out of time. In a second complete
run ([`assets/benchmark-2026-11-15-run2.json`](assets/benchmark-2026-11-15-run2.json))
the same case held 60.0 frames/s with a p95 of 16.7 ms. Other software was
running on the machine during both runs, more of it during the second, which
is why the first is the one tabulated; the dip is reported rather than
explained.

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
| GPU geometries |     20 | 20 every time                                             |
| GPU textures   |      4 | 4 every time                                              |
| JS heap (MB)   |     15 | 17 · 16 · 18 · 18 · 18 · 18 · 18 · 20 · 18 · 20 · 18 · 20 |

GPU resource counts return to exactly the same values after every rebuild:
nothing is leaked. The heap alternates with the size of the loaded topology
(15.3–20.2 MB) without trending upward.

**Repeated playback.** A recorded incident was loaded and the timeline was
sought to six different points per round, for six rounds (36 seeks),
at 4× speed.

|                | Start | After each round                        |
| -------------- | ----: | --------------------------------------- |
| JS heap (MB)   |  19.9 | 17.7 · 18.0 · 18.1 · 18.2 · 18.3 · 18.3 |
| GPU geometries |    20 | 20 every time                           |

The heap settles within about a megabyte of where it started.

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
density and the distance at which labels are shown.

This was observed on the measured build with software rendering (SwiftShader
WebGL 2, 1280 × 720, quality on auto): the scene started on `high`, stepped to
`medium` after about 16 s and to `low` after about 20 s, and stayed there.
Software rasterisation remained slow at every tier, around 7 to 8 frames/s,
so the controller lowers the cost of a frame but cannot make a machine
without a GPU fast.

The end-to-end suite runs on software WebGL 2 (SwiftShader, the renderer CI
uses), pinned to the `low` tier, and passes there. With every GPU API
disabled the application falls back to its table view, which is also covered
by an end-to-end test.

## How the scene stays cheap

| Technique                                                                                                                                         | Where                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| GPU instancing: one draw per service type, one for all connections, one for all beads, one for all labels, one for everything lying on the plates | `graphics/SceneController.ts`                    |
| Stateless beads: animation is a function of `time` and four seeds, evaluated in the vertex shader                                                 | `graphics/materials.ts`                          |
| Per-connection data texture: the CPU updates one small float texture, never per-bead buffers                                                      | `createParticleMaterial`                         |
| Text atlas: every label drawn once to a canvas, rendered as instanced billboards                                                                  | `graphics/labels.ts`                             |
| No post-processing and no lights: materials shade themselves, one pass per frame                                                                  | `graphics/materials.ts`                          |
| Level of detail: labels fade with distance; quality tiers scale bead density and resolution                                                       | `graphics/quality.ts`                            |
| No React in the frame loop: stores are read through subscriptions, lists throttle to 1 Hz                                                         | `features/scene/SceneCanvas.tsx`, `app/hooks.ts` |
| Columnar snapshots: struct-of-arrays on the wire, copied straight into typed arrays                                                               | `domain/telemetry.rs`                            |
| Serialise once, fan out: each stream message is encoded one time for all subscribers                                                              | `application/service.rs`                         |

## Test suite timings

Wall-clock on the same machine.

| Suite                                                                                              | Tests |       Time |
| -------------------------------------------------------------------------------------------------- | ----: | ---------: |
| Rust: engine, timeline, Cedar, API, stream, adapters (`cargo test --workspace`, warm build)        |   115 |        6 s |
| Contracts and web: schemas, palette rules, layout, stores, stream client, components (`pnpm test`) |   150 |       13 s |
| End to end on software WebGL 2, plus the no-GPU fallback (`pnpm e2e`)                              |    11 | 3 min 40 s |
| End to end on WebGPU, real GPU (`AEGIS_E2E_GPU=1`, project `chrome-webgpu`)                        |    10 |       34 s |

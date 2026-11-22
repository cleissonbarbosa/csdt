**English** · [Português](Desempenho)

Every figure on this page was measured on the machine and software listed
below, with the commands shown, and is copied from
[`docs/PERFORMANCE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/PERFORMANCE.md).
Nothing is estimated. Where a figure does not answer the question you might
expect it to, that is said next to it.

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

> **What is measured is the arrangement that draws every service.** The
> benchmark opens the application with `?arrangement=regions`, as a returning
> visitor. The overview, where the application opens, has not been measured.

The raw output of this run is
[`benchmark-2026-11-16.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-16.json).
The run before it, on an earlier build, is kept as
[`benchmark-2026-11-15.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-15.json).

## Frame cost

Frames were produced with the frame-rate limit and vsync disabled
(`--disable-frame-rate-limit --disable-gpu-vsync`), so the interval between
frames is the time it takes to produce one. The interface is on screen too.

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

- **WebGPU:** 2.7 ms per frame on average, worst p99 5.2 ms, across all four
  scenes (322–434 frames/s).
- **WebGL 2:** 9.4 ms per frame on average, worst p99 12.3 ms (103–111
  frames/s), running the same TSL materials.
- A 60 Hz display allows 16.7 ms per frame. Both backends produce a 1080p
  frame inside that budget with room to spare on this GPU.
- **Scale barely matters.** Going from 51 services and 75 connections to 178
  and 648 adds 6 draw calls (28 → 34) and a few tenths of a millisecond,
  because every object class is one instanced draw.
- **Slower than the run before it.** On the build measured on 2026-11-15 the
  same four scenes took 1.7 to 1.9 ms on WebGPU and 7.0 to 8.1 ms on WebGL 2.
  The pieces have been remodelled since, each with a part that works, and the
  names are drawn differently. How much of the difference is the names is
  measured [below](#what-the-names-cost); the rest was not isolated.
- **There is one pass.** No post-processing: no bloom, no blur, no tone
  mapping.

## Frame pacing

With Chrome's default frame pacing, `requestAnimationFrame` is throttled to
the 60 Hz the compositor asks for, and every frame composites the 3D canvas
with the interface over it (the model, the top bar and the timeline strip).
Every scene held 60.0–60.1 frames/s on both backends, with a worst p95
interval of 16.8 ms. The full table is in `docs/PERFORMANCE.md`.

**What this does not show.** All of it ran in headless Chrome, which has no
display. The frame cost table is the cost of producing a frame; the pacing
figures show the page keeping up with a 60 Hz compositor. Neither is a measurement of a
visible window on a monitor, and the project does not claim one. To measure
on your own display, run the benchmark with `--headed` (see [Measuring
again](#measuring-again)), or press <kbd>P</kbd> in the running application
for the **Performance overlay**.

## What the names cost

Names are drawn on a canvas of their own over the scene, so that they stay
sharp at any render resolution and never lie across each other
([Architecture](Architecture#rendering)). The benchmark was run a second
time on the same build with names switched off
(`--settings '{"labels":false}'`), frame-rate limit off; its raw output is
[`benchmark-2026-11-16-names-off.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-16-names-off.json).

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

- **Placing and drawing the names is 0.02 to 0.15 ms of script per frame**,
  as timed by the scene itself (the "Names" line of the overlay under
  <kbd>P</kbd>).
- **A frame with names takes 0.33 to 1.11 ms longer than one without.** The
  script accounts for a fraction of that; the rest was not isolated.
- With Chrome's default pacing the cost does not show: every scene holds
  60 frames/s with names on.
- **Not measured:** a display denser than one device pixel per CSS pixel,
  and the overview, where every piece is named.

## A regression the benchmark caught

The first complete run of the benchmark, on an earlier visual design,
rendered the scene in about 3 ms, yet with default pacing every scene
reported only 19–24 frames/s. Three measurements on that build, 1080p,
quality ultra, isolated the cause:

| Variant                                   |        WebGPU |       WebGL 2 |
| ----------------------------------------- | ------------: | ------------: |
| Full interface, as shipped at the time    | 23.7 frames/s | 21.3 frames/s |
| Same page with `backdrop-filter` disabled | 60.1 frames/s | 60.1 frames/s |
| Interface hidden, canvas only             | 60.0 frames/s | 60.2 frames/s |

The panels were translucent with a `backdrop-filter: blur()`, which forces
the compositor to re-sample the canvas under them on every frame; in this
configuration that cost several times more than rendering the scene. The
blur was removed, and the current design has none: panels are opaque paper
([Design principles](Design-principles)). Whether a visible window pays the
same price was not measured. The raw output is
[`benchmark-2026-11-15-backdrop-blur.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-15-backdrop-blur.json).

## Resource stability

One browser session, with a forced garbage collection before each sample.

**Scene rebuilds.** The topology was switched between the two bundled
topologies 12 times; each switch disposes and rebuilds every geometry,
material and texture. GPU geometries stayed at 19 and GPU textures at 4
after every rebuild: nothing is leaked on the GPU. The JS heap rose from
15.8 to 18.3 MB over the twelve rebuilds, about 0.2 MB per rebuild. Bounded
history buffers still filling, and the bitmaps kept for names already shown,
could each account for growth of that size, but neither was isolated, and
twelve rebuilds are too few to rule out a slow leak.

**Repeated playback.** A recorded incident was loaded and the timeline
sought to six points per round, for six rounds (36 seeks) at 4× speed. The
heap went from 17.9 MB to 17.4 MB, rising by a little less each round after
the first; GPU geometries were 19 at the start and 20 after every round. The
same caveat applies.

## Simulation engine

Single-threaded, release build, while a cascading-failure scenario runs:

```bash
cargo test --release -p aegis-server --test trace engine_step_cost -- --ignored --nocapture
```

| Topology          | Services / connections | One tick | Snapshot (build + JSON) | Snapshot size | Random seek |
| ----------------- | ---------------------: | -------: | ----------------------: | ------------: | ----------: |
| Helios Commerce   |                51 / 75 |    26 µs |                   14 µs |       4.3 KiB |      0.3 ms |
| Hyperscale Stress |              178 / 648 |    41 µs |                   71 µs |      20.8 KiB |      0.5 ms |

At 1× the engine runs 5 ticks per second (20 at 4×), so the simulation uses
a fraction of a percent of one core. A seek restores the nearest checkpoint,
taken every 5 virtual seconds, and re-steps at most 24 ticks.

## Graceful degradation

`AdaptiveQuality` steps between four tiers when the smoothed frame time
stays above 22 ms, and back up after sustained headroom; a tier that proved
too expensive becomes the ceiling. Lower tiers reduce the pixel ratio, bead
density and the distance at which names are shown. They do not make names
softer, since those are drawn at the display's resolution at every tier.

With software rendering (SwiftShader WebGL 2, 1280 × 720, quality on auto)
the scene started on `high`, stepped to `medium` after about 12 s and to
`low` after about 20 s, and stayed there, at around 7 frames/s: the
controller lowers the cost of a frame but cannot make a machine without a
GPU fast. The end-to-end suite runs on software WebGL 2, pinned to the `low`
tier, and passes there. With every GPU API disabled the application falls
back to its table view, which an end-to-end test also covers.

## How the scene stays cheap

| Technique                                                                                                               | Where                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| GPU instancing: one draw per service type, one for all connections, one for all beads, one for everything on the plates | `graphics/SceneController.ts`                    |
| Stateless beads: animation is a function of `time` and four seeds, evaluated in the vertex shader                       | `graphics/materials.ts`                          |
| Per-connection data texture: the CPU updates one small float texture, never per-bead buffers                            | `createParticleMaterial`                         |
| Names on a 2D canvas over the scene, placed by importance and redrawn only when the picture changed                     | `graphics/labelLayer.ts`                         |
| No post-processing and no lights: materials shade themselves, one pass per frame                                        | `graphics/materials.ts`                          |
| Level of detail: labels fade with distance; quality tiers scale bead density and resolution                             | `graphics/quality.ts`                            |
| No React in the frame loop: stores are read through subscriptions, lists throttle to 1 Hz                               | `features/scene/SceneCanvas.tsx`, `app/hooks.ts` |
| Columnar snapshots: struct-of-arrays on the wire, copied straight into typed arrays                                     | `domain/telemetry.rs`                            |
| Serialise once, fan out: each stream message is encoded one time for all subscribers                                    | `application/service.rs`                         |

## Test suite timings

Wall-clock on the same machine, each from its command to its exit, with the
builds it needs already made (the end-to-end suites still start their own
server and preview). The suites have grown since; the README counts the
tests as they are now.

| Suite                                                                       | Tests |       Time |
| --------------------------------------------------------------------------- | ----: | ---------: |
| Rust (`cargo test --workspace`)                                             |   208 |        6 s |
| Contracts and web (`pnpm test`)                                             |   454 |       30 s |
| The engine built for the browser, in Node (`pnpm test:engine`)              |    32 |        1 s |
| End to end on software WebGL 2, plus the no-GPU fallback (`pnpm e2e`)       |    25 | 7 min 52 s |
| End to end on WebGPU, real GPU (`AEGIS_E2E_GPU=1`, project `chrome-webgpu`) |    24 | 1 min 57 s |
| End to end on the static site, no server (`pnpm e2e:static`)                |     7 | 1 min 31 s |

## Measuring again

The benchmark starts its own release server on port 8798 and a production
build on port 4184, so nothing else touches the simulation while frames are
timed. It needs a release build of the server, a production build of the
web app, and Google Chrome.

```bash
cargo build --release -p aegis-server && pnpm build
./scripts/benchmark.sh --out results.json
./scripts/benchmark.sh --headed          # opens a Chrome window for a few minutes
```

| Option              | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `--out <file>`      | Writes the raw results as JSON                                                |
| `--seconds <n>`     | How long each case is measured (12 by default)                                |
| `--headed`          | Measures in a visible Chrome window on your display, with default pacing only |
| `--settings <json>` | Overrides settings for the run, such as `'{"labels":false}'`                  |

The figures in `docs/PERFORMANCE.md` come from these commands, with the
benchmark's raw output committed under `docs/assets/`; numbers are never
edited by hand.

## Reference

- [`docs/PERFORMANCE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/PERFORMANCE.md): every table above, in full, with its caveats
- Raw output:
  [`benchmark-2026-11-16.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-16.json),
  [`benchmark-2026-11-16-names-off.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-16-names-off.json),
  [`benchmark-2026-11-15.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-15.json),
  [`benchmark-2026-11-15-backdrop-blur.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-15-backdrop-blur.json)
- [`scripts/benchmark.sh`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/benchmark.sh) and
  [`apps/web/scripts/benchmark.mjs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/scripts/benchmark.mjs): the benchmark
- [`apps/server/tests/trace.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/tests/trace.rs): the engine micro-benchmark
- [`apps/web/src/graphics/quality.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/graphics/quality.ts): the quality tiers
- [`README.md`](https://github.com/cleissonbarbosa/csdt/blob/main/README.md): "Performance" and "Tests"

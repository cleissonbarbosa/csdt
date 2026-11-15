// Measures rendering performance of the running application in a locally
// installed Chrome on real GPU hardware.
//
//   node scripts/benchmark.mjs [--url http://127.0.0.1:4173] [--seconds 12]
//        [--headed] [--out results.json]
//
// Headless Chrome cannot present a WebGPU canvas, so frames are rendered
// offscreen: these numbers measure the cost of producing frames, not of
// showing them. Run with --headed on a desktop session for on-screen figures.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--')) {
      const next = all[i + 1];
      pairs.push([token.slice(2), next === undefined || next.startsWith('--') ? true : next]);
    }
    return pairs;
  }, []),
);
const url = args.url ?? 'http://127.0.0.1:4173';
const seconds = Number(args.seconds ?? 12);
const headed = Boolean(args.headed);
const GPU_FLAGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  '--use-angle=vulkan',
  '--ignore-gpu-blocklist',
  '--enable-precise-memory-info',
  '--js-flags=--expose-gc',
];
const UNCAPPED = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];

const api = (path, body) =>
  fetch(`${url}/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

const percentile = (sorted, q) =>
  sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q))];

async function open(browser, settings) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript((value) => {
    window.localStorage.setItem('aegis.settings.v1', JSON.stringify({ state: value, version: 1 }));
  }, settings);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('[page exception]', error.message));
  await page.goto(url);
  await page.waitForFunction(() => (window.__aegis?.stats().nodes ?? 0) > 0, null, {
    timeout: 60_000,
  });
  return { context, page };
}

/** Frame intervals observed by requestAnimationFrame over `duration` seconds. */
function measure(page, duration) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const deltas = [];
        let last = performance.now();
        const end = last + ms;
        const frame = (now) => {
          deltas.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(frame);
          else
            resolve({
              deltas,
              stats: window.__aegis.stats(),
              heap: performance.memory?.usedJSHeapSize ?? null,
            });
        };
        requestAnimationFrame(frame);
      }),
    duration * 1000,
  );
}

function summarise(label, result) {
  const sorted = [...result.deltas].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    case: label,
    backend: result.stats.backend,
    quality: result.stats.quality,
    nodes: result.stats.nodes,
    edges: result.stats.edges,
    frames: sorted.length,
    fps: +(1000 / mean).toFixed(1),
    frameMs: {
      mean: +mean.toFixed(2),
      p50: +percentile(sorted, 0.5).toFixed(2),
      p95: +percentile(sorted, 0.95).toFixed(2),
      p99: +percentile(sorted, 0.99).toFixed(2),
      max: +sorted.at(-1).toFixed(2),
    },
    over16ms: +((sorted.filter((v) => v > 17.5).length / sorted.length) * 100).toFixed(2),
    over33ms: +((sorted.filter((v) => v > 33.4).length / sorted.length) * 100).toFixed(2),
    drawCalls: result.stats.drawCalls,
    triangles: result.stats.triangles,
    particlesVisible: result.stats.particles,
    particleCapacity: result.stats.particleCapacity,
    heapMB: result.heap ? +(result.heap / 1048576).toFixed(1) : null,
  };
}

async function reset(topologyId) {
  await api('/demo/topology/select', { topologyId });
  await api('/demo/playback/control', { action: 'setSpeed', speed: 1 });
  await api('/demo/playback/control', { action: 'play' });
}

async function frameRuns(mode, extraFlags) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !headed,
    args: [...GPU_FLAGS, ...extraFlags],
  });
  const version = browser.version();
  const rows = [];
  for (const backend of ['webgpu', 'webgl2']) {
    const settings = {
      quality: 'ultra',
      theme: 'light',
      // Keep the picture changing, so every frame is a full redraw.
      autoRotate: true,
      ...(backend === 'webgl2' ? { renderer: 'webgl2' } : {}),
    };
    for (const [topologyId, scenario, settle] of [
      ['helios-commerce', null, 0],
      ['helios-commerce', 'ddos-surge', 22],
      ['hyperscale-stress', null, 0],
      ['hyperscale-stress', 'regional-outage', 16],
    ]) {
      await reset(topologyId);
      const { context, page } = await open(browser, settings);
      if (scenario) {
        await api('/demo/scenarios/start', { scenarioId: scenario });
        await page.waitForTimeout(settle * 1000);
      }
      await page.waitForTimeout(4000); // warm-up: shaders, intro camera move
      const label = `${topologyId}${scenario ? ` + ${scenario}` : ' idle'} [${mode}]`;
      const row = summarise(label, await measure(page, seconds));
      rows.push(row);
      console.error(
        `${label.padEnd(58)} ${row.backend.padEnd(6)} ${String(row.fps).padStart(7)} fps  p95 ${String(row.frameMs.p95).padStart(6)} ms  ${row.drawCalls} draws  ${row.particlesVisible} particles`,
      );
      await context.close();
    }
  }
  await browser.close();
  return { version, rows };
}

/** Rebuilds the scene repeatedly and replays a recording: do resources leak? */
async function stability() {
  const browser = await chromium.launch({ channel: 'chrome', headless: !headed, args: GPU_FLAGS });
  await reset('helios-commerce');
  const { context, page } = await open(browser, {
    quality: 'high',
    theme: 'light',
    autoRotate: true,
  });
  await page.waitForTimeout(3000);
  const sample = () =>
    page.evaluate(() => {
      window.gc?.();
      const s = window.__aegis.stats();
      return {
        heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
        geometries: s.geometries,
        textures: s.textures,
      };
    });
  const rebuilds = [await sample()];
  for (let i = 0; i < 12; i++) {
    await api('/demo/topology/select', {
      topologyId: i % 2 === 0 ? 'hyperscale-stress' : 'helios-commerce',
    });
    await page.waitForFunction((n) => window.__aegis.stats().nodes === n, i % 2 === 0 ? 178 : 51, {
      timeout: 30_000,
    });
    await page.waitForTimeout(1200);
    rebuilds.push(await sample());
  }
  await api('/demo/recordings/load', { recordingId: 'black-friday-flood' });
  await api('/demo/playback/control', { action: 'setSpeed', speed: 4 });
  await page.waitForTimeout(2000);
  const playback = [await sample()];
  for (let round = 0; round < 6; round++) {
    for (const toMs of [0, 60_000, 150_000, 30_000, 240_000, 100_000]) {
      await api('/demo/playback/control', { action: 'seek', toMs });
      await page.waitForTimeout(700);
    }
    playback.push(await sample());
  }
  await context.close();
  await browser.close();
  return { rebuilds, playback };
}

const capped = await frameRuns('vsync', []);
const uncapped = headed ? { rows: [] } : await frameRuns('uncapped', UNCAPPED);
const leaks = await stability();
const report = {
  measuredAt: new Date().toISOString(),
  browser: `Chrome ${capped.version}${headed ? '' : ' (headless, offscreen)'}`,
  viewport: '1920x1080 @ 1x device pixel ratio',
  secondsPerCase: seconds,
  frames: [...capped.rows, ...uncapped.rows],
  stability: leaks,
};
console.log(JSON.stringify(report, null, 2));
if (args.out) await writeFile(args.out, JSON.stringify(report, null, 2) + '\n');

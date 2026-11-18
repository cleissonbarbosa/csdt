// Captures the running application in a real, GPU-accelerated Chrome.
//
//   node scripts/capture.mjs --out shot.png [--url http://localhost:5173]
//        [--width 1920 --height 1080] [--wait 6] [--webgl2] [--readback]
//        [--arrangement regions|dependencies]  (the default is the overview)
//        [--settings '{"quality":"ultra"}'] [--reset] [--first-visit]
//        [--scenario ddos-surge --after 24] [--speed 2]
//        [--click tab-incidents,scenario-start-ddos-surge]
//        [--select authz-principal=User::"mallory"] [--then authz-evaluate]
//        [--node use-gateway] [--focus use-gateway]
//        [--eval "<js to run in the page before the capture>"] [--settle 2]
//        [--video demo.webm --duration 20]
//
// Steps run in the order listed above. `--video` records the page instead of
// taking a still.
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--')) {
      const next = all[i + 1];
      pairs.push([token.slice(2), next === undefined || next.startsWith('--') ? true : next]);
    }
    return pairs;
  }, []),
);
const url = args.url ?? 'http://localhost:5173';
const width = Number(args.width ?? 1920);
const height = Number(args.height ?? 1080);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,WebGPU',
    '--use-angle=vulkan',
    '--ignore-gpu-blocklist',
    // Present through an offscreen surface so headless captures see WebGPU frames.
    '--disable-vulkan-surface',
  ],
});
const post = (path, body) =>
  fetch(`${url}/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
if (args.reset) {
  await post('/demo/topology/select', {
    topologyId: typeof args.reset === 'string' ? args.reset : 'helios-commerce',
  });
  await post('/demo/playback/control', { action: 'setSpeed', speed: 1 });
  await post('/demo/playback/control', { action: 'play' });
}
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  ...(args.video ? { recordVideo: { dir: `${args.video}.parts`, size: { width, height } } } : {}),
});
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error' || (process.env.CAPTURE_VERBOSE && message.type() !== 'debug'))
    console.error(`[page ${message.type()}]`, message.text().slice(0, 600));
});
page.on('pageerror', (error) => console.error('[page exception]', error.message));

if (args.webgl2 || args.settings) {
  const settings = {
    // The pictures in the documents are of the English interface.
    language: 'en',
    ...(args.webgl2 ? { renderer: 'webgl2' } : {}),
    ...(args.settings ? JSON.parse(args.settings) : {}),
  };
  await context.addInitScript((value) => {
    window.localStorage.setItem('aegis.settings.v1', JSON.stringify({ state: value, version: 1 }));
  }, settings);
}
if (!args['first-visit']) {
  // A capture shows the application as a returning visitor sees it: without
  // the orientation card that is laid over the model on a first visit.
  await context.addInitScript(() => {
    window.localStorage.setItem(
      'aegis.guide.v1',
      JSON.stringify({ state: { oriented: true, completed: [] }, version: 1 }),
    );
  });
}
await page.goto(args.arrangement ? `${url}/?arrangement=${args.arrangement}` : url);
await page.waitForTimeout(Number(args.wait ?? 6) * 1000);
if (args.scenario) {
  await page.evaluate(async (scenarioId) => {
    await fetch('/api/v1/demo/scenarios/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId }),
    });
  }, args.scenario);
  await page.waitForTimeout(Number(args.after ?? 20) * 1000);
}
if (args.speed)
  await post('/demo/playback/control', { action: 'setSpeed', speed: Number(args.speed) });
for (const id of typeof args.click === 'string' ? args.click.split(',') : []) {
  await page.getByTestId(id).first().click();
  await page.waitForTimeout(450);
}
for (const pair of typeof args.select === 'string' ? args.select.split(',') : []) {
  const [id, ...value] = pair.split('=');
  await page.getByTestId(id).selectOption(value.join('='));
  await page.waitForTimeout(250);
}
for (const id of typeof args.then === 'string' ? args.then.split(',') : []) {
  await page.getByTestId(id).first().click();
  await page.waitForTimeout(450);
}
// The scene's own canvas: the names are drawn on a second one laid over it.
const scene = page.locator('canvas:not([data-aegis-labels])').first();
if (typeof args.node === 'string') {
  const at = await page.evaluate((id) => window.__aegis?.projectNode(id) ?? null, args.node);
  const box = await scene.boundingBox();
  if (at && box) await page.mouse.click(box.x + at.x, box.y + at.y);
  // Park the pointer so no hover card covers the subject.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(450);
}
if (typeof args.focus === 'string') {
  // Double-click a service: the camera moves in on it.
  const at = await page.evaluate((id) => window.__aegis?.projectNode(id) ?? null, args.focus);
  const box = await scene.boundingBox();
  if (at && box) await page.mouse.dblclick(box.x + at.x, box.y + at.y);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(1500);
}
if (args.eval) await page.evaluate(args.eval);
if (args.settle) await page.waitForTimeout(Number(args.settle) * 1000);
const stats = await page.evaluate(() => window.__aegis?.stats?.() ?? null);
if (stats) console.log(JSON.stringify(stats));
if (args.video) {
  await page.waitForTimeout(Number(args.duration ?? 15) * 1000);
  const video = page.video();
  await context.close();
  await video.saveAs(args.video);
  const { rm } = await import('node:fs/promises');
  await rm(`${args.video}.parts`, { recursive: true, force: true });
  await browser.close();
  process.exit(0);
}
if (args.readback) {
  // Headless Chrome cannot present a WebGPU canvas, so compositor screenshots
  // of it are blank. Rendering into an offscreen target and reading that back
  // shows what the GPU actually produced.
  const { writeFile } = await import('node:fs/promises');
  const dataUrl = await page.evaluate(async () => {
    const frame = await window.__aegis.captureFrame();
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(frame.width, frame.height);
    const row = frame.width * 4;
    for (let y = 0; y < frame.height; y++) {
      const from = (frame.flipY ? frame.height - 1 - y : y) * row;
      image.data.set(frame.pixels.subarray(from, from + row), y * row);
    }
    // The render target has no alpha to speak of; make the image opaque.
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
    ctx.putImageData(image, 0, 0);
    // Names are drawn on a canvas of their own over the scene; lay it on.
    const names = document.querySelector('canvas[data-aegis-labels]');
    if (names) ctx.drawImage(names, 0, 0, frame.width, frame.height);
    return canvas.toDataURL('image/png');
  });
  await writeFile(args.out ?? 'capture.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
} else {
  await page.screenshot({ path: args.out ?? 'capture.png' });
}
await browser.close();

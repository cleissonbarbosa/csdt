/**
 * The static site: the same application, with the engine in the tab.
 *
 * These tests repeat the heart of the main suite against a build that has
 * no server to talk to, and add what only this build has to prove: that
 * nothing is requested but its own files, that it runs under the policy it
 * ships with, and that it says so when the engine cannot start.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  BOUTIQUE,
  captureFile,
  type CaptureFile,
  clockSeconds,
  collectErrors,
  exampleWorkspace,
  frameSummary,
  fromMenu,
  GOOGLE,
  KINDS,
  namesOnModel,
  openCapture,
  openStatic,
  overlappingNames,
  setSpeed,
  waitForCapture,
  waitForScene,
} from './support';

/** Every request the page and its worker make, as URLs. */
function collectRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

/** Records what the page's own policy refused. */
async function watchPolicy(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const refused: string[] = [];
    (window as unknown as { __refused: string[] }).__refused = refused;
    document.addEventListener('securitypolicyviolation', (event) => {
      refused.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __refused: string[] }).__refused);
}

test('the whole application runs in the tab and asks for nothing but its own files', async ({
  page,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const requests = collectRequests(page);
  const refused = await watchPolicy(page);
  await openStatic(page);
  await waitForScene(page);

  await expect(page.getByTestId('platform-status')).toContainText('51 services, all normal');
  await expect(page.getByTestId('mode-switch')).toHaveAttribute('data-mode', 'demo');
  const backend = await page.evaluate(() => window.__aegis?.backend);
  expect(['webgpu', 'webgl2']).toContain(backend);
  if (test.info().project.name === 'static-webgpu') expect(backend).toBe('webgpu');
  await expect(page.getByTestId('open-integrations')).toHaveAttribute(
    'title',
    /simulation engine, which runs in this tab/,
  );
  // Time passes: the engine is being advanced by its worker.
  await fromMenu(page, 'timeline');
  await expect.poll(() => clockSeconds(page)).toBeGreaterThan(1);

  // No API, no socket, no other origin: the site's files and nothing else.
  expect(requests.length).toBeGreaterThan(5);
  expect(requests.filter((url) => !url.startsWith(baseURL!))).toEqual([]);
  expect(requests.filter((url) => new URL(url).pathname.includes('/api/'))).toEqual([]);
  expect(requests.filter((url) => url.endsWith('.wasm'))).toHaveLength(1);

  // It runs under the policy it carries: the deployed one, plus leave to
  // compile the engine module.
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toContain(" 'unsafe-eval'");
  expect(await refused()).toEqual([]);
  expect(errors).toEqual([]);
});

test('an incident runs on the engine in the tab', async ({ page }) => {
  const requests = collectRequests(page);
  await openStatic(page);
  await waitForScene(page);
  expect((await frameSummary(page)).chromatic).toBe(0);
  await setSpeed(page, 4);

  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-ddos-surge').click();
  const active = page.getByTestId('active-incident');
  await expect(active).toHaveAttribute('data-scenario', 'ddos-surge');
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '1');
  await expect(page.getByTestId('event-log')).toContainText('Volumetric attack detected', {
    timeout: 30_000,
  });
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBeGreaterThan(20);

  // The timeline is the engine's own: paused, rewound to before the
  // incident, and wiped clean.
  await page.getByTestId('playback-toggle').click();
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toHaveAttribute('data-status', 'paused');
  const frozen = await clockSeconds(page);
  await page.waitForTimeout(1200);
  expect(await clockSeconds(page)).toBe(frozen);
  await page.getByRole('slider', { name: 'Timeline position' }).focus();
  await page.keyboard.press('Home');
  await expect(timeline).toHaveAttribute('data-mode', 'replay');
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '0');
  await page.getByTestId('reset-simulation').click();
  await page.getByTestId('reset-confirm').click();
  await expect(active).toHaveCount(0);
  await expect.poll(() => clockSeconds(page)).toBeLessThan(frozen);
  expect(requests.filter((url) => new URL(url).pathname.includes('/api/'))).toEqual([]);
});

test('Cedar decides in the tab, and a time nobody measured is not shown', async ({ page }) => {
  await openStatic(page);
  await waitForScene(page);
  await fromMenu(page, 'trace');
  const form = page.getByTestId('authz-form');
  await form.getByTestId('authz-principal').selectOption('User::"mallory"');
  await form.getByTestId('authz-action').selectOption('Action::"exportLedger"');
  await page.getByTestId('authz-evaluate').click();

  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-decision', 'deny');
  await expect(card.getByTestId('decision-policies')).toContainText('forbid-cross-tenant');
  await expect(card.getByTestId('decision-engine')).toContainText(/Embedded Cedar 4\.\d+/);
  await expect(card.getByTestId('decision-time')).toHaveText('not timed in the browser');
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBeGreaterThan(5);

  await form.getByTestId('authz-principal').selectOption('User::"alice"');
  await form.getByTestId('authz-action').selectOption('Action::"viewLedger"');
  await page.getByTestId('authz-evaluate').click();
  await expect(card).toHaveAttribute('data-decision', 'allow');
  await expect(card.getByTestId('decision-policies')).toContainText('finance-view-ledger');
  // An agent cannot be reached from here, and the page says where it can.
  await expect(form).toContainText('needs the AEGIS server');
});

test('a platform is imported into the tab, and a reload returns to the bundled one', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openStatic(page);
  await waitForScene(page);

  await fromMenu(page, 'workspace');
  const dialog = page.getByRole('dialog', { name: 'Platform files' });
  await expect(dialog.getByTestId('workspace-in-use')).toContainText(
    'The platform that ships with AEGIS.',
  );
  // The same checks as on the server, by the same code, in the tab.
  await dialog.getByTestId('workspace-files').setInputFiles(exampleWorkspace());
  const check = dialog.getByTestId('workspace-check');
  await expect(check).toContainText('These files are valid');
  await expect(check).toContainText('Corner Shop (6 services)');
  await dialog.getByTestId('workspace-apply').click();
  await expect(dialog).toBeHidden();
  await waitForScene(page, 6);
  await expect(page.getByTestId('platform-status')).toContainText('6 services, all normal');

  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-receipt-snooping').click();
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '1');

  await fromMenu(page, 'workspace');
  await expect(dialog.getByTestId('workspace-in-use')).toContainText(
    'Files imported into this page',
  );
  await expect(dialog.getByTestId('workspace-reset')).toHaveText(
    'Return to what this page opened with',
  );
  await page.keyboard.press('Escape');

  // The files lived in the tab: a reload starts from what ships with it.
  await page.reload();
  await expect(page.getByTestId('connection-health')).toHaveAttribute('data-state', 'open');
  await waitForScene(page, KINDS);
  await expect(page.getByTestId('platform-status')).toContainText('51 services, all normal');
  expect(errors).toEqual([]);
});

test('the page lists the built-in simulation and explains how to use live adapters', async ({
  page,
}) => {
  await openStatic(page);
  await page.getByTestId('open-integrations').click();
  const dialog = page.getByRole('dialog', { name: 'Integrations' });
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByTestId('provider-demo-simulation')).toBeVisible();
  await expect(dialog.getByTestId('integrations-note')).toContainText('need the AEGIS server');
});

test('says so, and shows nothing, when the engine cannot be loaded', async ({ page }) => {
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto('./');
  const stopped = page.getByTestId('engine-stopped');
  await expect(stopped).toBeVisible();
  await expect(stopped).toContainText('The simulation engine is not running');
  await expect(stopped).toContainText('could not be loaded');
  await expect(stopped.getByRole('button', { name: 'Reload the page' })).toBeVisible();
  // Nothing stands in for the platform that could not be simulated.
  await expect(page.getByTestId('platform-status')).toHaveCount(0);
  await expect(page.getByTestId('active-incident')).toHaveCount(0);
});

test('an incident is compared with an intervention, and read back, in the tab', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const requests = collectRequests(page);
  await openStatic(page);
  await waitForScene(page);

  // Two runs of the same incident, simulated by the engine in this tab.
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-compare-cascading-failure').click();
  const dialog = page.getByRole('dialog', { name: 'Compare an intervention' });
  await dialog.getByTestId('experiment-value').fill('6');
  await dialog.getByTestId('experiment-run').click();
  const results = dialog.getByTestId('experiment-results');
  await expect(results.getByTestId('experiment-change')).toContainText('capacity ×6 on Orders DB', {
    timeout: 30_000,
  });
  await expect(results).toContainText('identical, sample for sample');

  // One of them, put on the timeline and read back from its record.
  await results.getByTestId('experiment-watch-b').click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('incident-inc-001').click();
  const summary = page.getByTestId('incident-summary');
  await expect(summary.getByTestId('summary-origin')).toContainText('Orders DB');
  await expect(summary.getByTestId('summary-outcome')).toContainText('The scenario ended at +1:44');
  await expect(summary.getByTestId('summary-propagation')).toContainText('because it calls');

  // The session that reproduces it is read from the engine too.
  await page.keyboard.press('Escape');
  await page.getByTestId('open-menu').click();
  await page.getByTestId('menu-session').click();
  await expect(page.getByTestId('session-contents')).toContainText('places a fault by hand');
  expect(requests.filter((url) => new URL(url).pathname.includes('/api/'))).toEqual([]);
});

test.describe('kept by the browser', () => {
  test.use({ serviceWorkers: 'allow' });

  test('opens again with no network, on the files it was built with', async ({ page, context }) => {
    const requests = collectRequests(page);
    await openStatic(page);
    await waitForScene(page);
    // The worker has every file of the build, and has taken the page.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);
    const kept = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names[0]!);
      return { names, files: (await cache.keys()).map((request) => new URL(request.url).pathname) };
    });
    expect(kept.names).toHaveLength(1);
    expect(kept.names[0]).toMatch(/^aegis-[0-9a-f]{16}$/);
    expect(kept.files.some((file) => file.endsWith('.wasm'))).toBe(true);
    expect(kept.files.some((file) => file.endsWith('.glb'))).toBe(true);
    // It kept nothing but the site's own files, and asked nobody else for any.
    const origin = new URL(page.url()).origin;
    expect(requests.filter((url) => !url.startsWith(origin) && !url.startsWith('blob:'))).toEqual(
      [],
    );

    // With no network at all the site opens, the engine starts and it runs.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('connection-health')).toHaveAttribute('data-state', 'open');
    await waitForScene(page);
    await expect(page.getByTestId('platform-status')).toContainText('services, all normal');
    await page.getByTestId('explore-incident').click();
    await page.getByTestId('scenario-start-ddos-surge').click();
    await expect(page.getByTestId('active-incident')).toHaveAttribute(
      'data-scenario',
      'ddos-surge',
    );
    await context.setOffline(false);
  });
});

test('the interface speaks Portuguese when asked, and English again when told', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openStatic(page, { language: 'pt-BR' });
  await waitForScene(page, KINDS);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('pt-BR');
  await expect(page.getByTestId('platform-status')).toContainText('51 serviços, todos normais');
  await expect(page.getByTestId('explore-incident')).toHaveText('Explorar um incidente');
  // The names on the model are the interface's too.
  await expect
    .poll(async () => (await page.evaluate(() => window.__aegis!.labels())).map((n) => n.text))
    .toEqual(expect.arrayContaining(['3 gateways de API']));
  // What a file wrote is shown as it was written: a scenario keeps its name.
  await page.getByTestId('explore-incident').click();
  await expect(page.getByTestId('scenario-start-ddos-surge')).toBeVisible();
  await expect(page.getByTestId('tab-incidents')).toContainText('Incidentes');
  await expect(page.getByText('DDoS Surge').first()).toBeVisible();

  // Back to English from the settings: the page reloads in it.
  await fromMenu(page, 'settings');
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByTestId('platform-status')).toContainText('51 services, all normal');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(errors).toEqual([]);
});

/*
 * Incident captures. A capture is a real incident read in the tab from a
 * file, drawn on the same stage in place of the simulation, which goes on
 * behind it untouched. These tests hold it to that: it opens in place and
 * in the history, it is drawn from its file and from nothing else, and the
 * model takes a hue only where the capture states one.
 */

/** What the simulation shows once a capture has been left: its own bar and its own model. */
async function backOnTheSimulation(page: Page): Promise<void> {
  await expect(page.getByTestId('capture-status')).toHaveCount(0);
  await expect(page.getByTestId('platform-status')).toBeVisible();
  await expect(page.locator('[data-testid="timeline"][data-mode="capture"]')).toHaveCount(0);
  await waitForScene(page, KINDS);
  // Twelve kinds of service are twelve pieces, as many as the Google
  // capture has: what tells them apart is that the simulation states every
  // service's state and names its layers.
  await expect.poll(() => page.evaluate(() => window.__aegis?.stats().unknown)).toBe(0);
  await expect.poll(() => namesOnModel(page)).toEqual(expect.arrayContaining(['01 Entry']));
}

/** What the scene says it draws, in the figures that tell one model from another. */
function drawn(page: Page) {
  return page.evaluate(() => {
    const stats = window.__aegis!.stats();
    const names = window.__aegis!.labels().map((name) => name.text);
    return { nodes: stats.nodes, edges: stats.edges, unknown: stats.unknown, names: names.sort() };
  });
}

/** A rectangle of the page, in CSS pixels. */
interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The names drawn on the model, each with its box on the page. */
async function namesOnPage(page: Page): Promise<(Area & { text: string })[]> {
  const stage = (await page
    .getByRole('img', { name: /Interactive 3D view|Vista 3D interativa/ })
    .boundingBox())!;
  const names = await page.evaluate(() => window.__aegis!.labels());
  return names.map((name) => ({
    text: name.text,
    left: stage.x + name.left,
    right: stage.x + name.right,
    top: stage.y + name.top,
    bottom: stage.y + name.bottom,
  }));
}

/**
 * The names not drawn wholly inside an area of the page. A pixel is allowed
 * for rounding: a cut name was a hundred and more off the screen.
 */
async function namesOutside(page: Page, area: Area): Promise<string[]> {
  return (await namesOnPage(page))
    .filter(
      (name) =>
        name.left < area.left - 1 ||
        name.right > area.right + 1 ||
        name.top < area.top - 1 ||
        name.bottom > area.bottom + 1,
    )
    .map((name) => name.text);
}

/**
 * The names drawn, even in part, under any of these parts of the page, but
 * those in hand (the selection's), which are drawn wherever they fall.
 */
async function namesUnder(page: Page, parts: Locator[], held: string[]): Promise<string[]> {
  const boxes = await Promise.all(parts.map((part) => part.boundingBox()));
  return (await namesOnPage(page))
    .filter((name) => !held.includes(name.text))
    .filter((name) =>
      boxes.some(
        (box) =>
          box !== null &&
          name.left < box.x + box.width - 1 &&
          box.x < name.right - 1 &&
          name.top < box.y + box.height - 1 &&
          box.y < name.bottom - 1,
      ),
    )
    .map((name) => name.text);
}

/** The sample of a capture's service that holds a moment, as the file writes it. */
function sampleAt(capture: CaptureFile, id: string, atMs: number) {
  const period = capture.periodMs!;
  const node = capture.nodes.find((candidate) => candidate.id === id)!;
  return node.buckets?.find((sample) => sample.atMs <= atMs && atMs < sample.atMs + period);
}

/** How many of a capture's services have a sample that holds a moment. */
function measuredAt(capture: CaptureFile, atMs: number): number {
  return capture.nodes.filter((node) => sampleAt(capture, node.id, atMs) !== undefined).length;
}

/** The brightness of the stage's background, from the frame drawn. */
async function brightness(page: Page): Promise<number> {
  const { background } = await frameSummary(page);
  return background[0] + background[1] + background[2];
}

test('an incident capture opens in place from the menu, and Back and Forward follow it', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const google = captureFile(GOOGLE);
  await openStatic(page);
  await waitForScene(page);
  // The simulation's panels are where the viewer left them on return.
  await fromMenu(page, 'services');
  await expect(page.getByTestId('explorer-count')).toHaveText('51 of 51 services');
  const entries = await page.evaluate(() => window.history.length);

  await fromMenu(page, 'capture');
  const dialog = page.getByRole('dialog', { name: 'Open an incident capture' });
  await expect(dialog.getByTestId(`capture-open-${GOOGLE}`)).toContainText(google.title);
  await expect(dialog.getByTestId(`capture-open-${BOUTIQUE}`)).toContainText(
    captureFile(BOUTIQUE).title,
  );
  await dialog.getByTestId(`capture-open-${GOOGLE}`).click();
  await expect(dialog).toHaveCount(0);

  // On the same page: the address names it and the history has one entry more.
  await expect(page).toHaveURL(new RegExp(`/aegis/\\?capture=${GOOGLE}$`));
  expect(await page.evaluate(() => window.history.length)).toBe(entries + 1);
  await waitForCapture(page, google);
  await expect(page.getByTestId('capture-chip')).toHaveAttribute('data-kind', 'provider-report');
  // The capture's bar in the timeline's place, and none of the simulation's parts.
  await expect(page.getByTestId('timeline')).toHaveCount(1);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-mode', 'capture');
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-status', 'paused');
  await expect(page.getByTestId('capture-time')).toHaveAttribute(
    'datetime',
    new Date(google.window.startMs).toISOString(),
  );
  for (const id of ['platform-status', 'explore-incident', 'open-tracer', 'explorer']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  // The keyboard is on the capture's clock.
  await expect(page.getByTestId('capture-toggle')).toBeFocused();

  // Back is the simulation, as it was; Forward the capture again.
  await page.goBack();
  await expect(page).not.toHaveURL(/capture=/);
  await backOnTheSimulation(page);
  await expect(page.getByTestId('explorer-count')).toHaveText('51 of 51 services');
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`\\?capture=${GOOGLE}$`));
  await waitForCapture(page, google);
  await page.goBack();
  await backOnTheSimulation(page);
  expect(errors).toEqual([]);
});

test('a capture is reached by its link, and kept by a reload and by the table view', async ({
  page,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const requests = collectRequests(page);
  const google = await openCapture(page, GOOGLE);
  const entries = await page.evaluate(() => window.history.length);
  // Everything the page fetched with a capture open from its first file:
  // its own files, the engine (which starts behind the capture) once, and
  // nothing else.
  expect(requests.length).toBeGreaterThan(5);
  expect(requests.filter((url) => !url.startsWith(baseURL!))).toEqual([]);
  expect(requests.filter((url) => new URL(url).pathname.includes('/api/'))).toEqual([]);
  expect(requests.filter((url) => url.endsWith('.wasm'))).toHaveLength(1);

  await page.reload();
  await waitForCapture(page, google);
  // The table and back: the capture's table, then its model again.
  await page.keyboard.press('t');
  const table = page.getByTestId('capture-table');
  await expect(table).toBeVisible();
  await expect(page.getByRole('img', { name: /Interactive 3D view/ })).toHaveCount(0);
  for (const node of google.nodes) {
    await expect(table.getByTestId(`capture-table-service-${node.id}`)).toContainText(node.name);
  }
  await expect(table.getByTestId('capture-table-state-iam')).toHaveText('Not stated at this time');
  await expect(page.getByTestId('topology-table')).toHaveCount(0);
  await page.keyboard.press('t');
  await waitForCapture(page, google);
  expect(requests.filter((url) => !url.startsWith(baseURL!))).toEqual([]);
  expect(requests.filter((url) => new URL(url).pathname.includes('/api/'))).toEqual([]);

  // Leaving an arrival rewrites its entry rather than adding one.
  await page.getByTestId('capture-back').click();
  await expect(page).not.toHaveURL(/capture=/);
  expect(await page.evaluate(() => window.history.length)).toBe(entries);
  await backOnTheSimulation(page);
  expect(errors).toEqual([]);
});

test('a capture file is read in the tab, and one that is not a capture is refused', async ({
  page,
  baseURL,
}) => {
  const errors = collectErrors(page);
  await openStatic(page);
  await waitForScene(page);

  const start = Date.UTC(2025, 5, 12, 18);
  const at = start + 60_000;
  const payload = {
    kind: 'aegis-incident-capture',
    version: 1,
    title: 'Checkout capture test',
    source: { kind: 'cloudwatch', label: 'CloudWatch test fixture' },
    window: { startMs: start, endMs: start + 180_000 },
    periodMs: 60_000,
    regions: [{ id: 'us-east-1', name: 'us-east-1' }],
    nodes: [
      {
        id: 'checkout',
        name: 'Checkout',
        region: 'us-east-1',
        type: 'microservice',
        buckets: [{ atMs: at, requests: 40, faults: 10, p95Ms: 450 }],
      },
      { id: 'payment', name: 'Payment', region: 'us-east-1', type: 'microservice' },
    ],
    edges: [
      { source: 'checkout', target: 'payment', buckets: [{ atMs: at, requests: 20, faults: 5 }] },
      { source: 'payment', target: 'checkout' },
    ],
  };
  await fromMenu(page, 'capture');
  const dialog = page.getByRole('dialog', { name: 'Open an incident capture' });
  await dialog.getByTestId('capture-file').setInputFiles({
    name: 'checkout.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await expect(dialog).toHaveCount(0);
  // A file cannot be reached by a link, so the address does not name it.
  await expect(page).toHaveURL(baseURL!);
  await waitForCapture(page, payload);
  await expect(page.getByTestId('capture-chip')).toHaveAttribute('data-kind', 'cloudwatch');
  await expect(page.getByTestId('capture-picker')).toHaveValue('file');
  await expect(page.getByTestId('capture-picker')).toContainText('checkout.json');

  // A connection with no sample at the window's start has no data there.
  await page.getByTestId('capture-list').click();
  await page.getByTestId('capture-connection-checkout->payment').click();
  const card = page.getByTestId('capture-card');
  await expect(
    page.getByRole('complementary', { name: 'Connection in the capture' }),
  ).toBeVisible();
  await expect(card).toHaveAttribute('data-kind', 'edge');
  await expect(card.getByTestId('capture-card-state')).toContainText('No data');
  // One sampling period on, it has one: 5 errors in 20 requests.
  await page.getByRole('slider', { name: 'Timeline position' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('capture-time')).toHaveAttribute(
    'datetime',
    new Date(at).toISOString(),
  );
  await expect(card.getByTestId('capture-figure-errorRate')).toContainText('25.0%');
  await expect(card.getByTestId('capture-card-state')).toContainText('Critical');
  await page.locator('#main').focus();
  await page.keyboard.press('t');
  await expect(page.getByTestId('capture-table-state-checkout')).toHaveText('Critical');
  await expect(page.getByTestId('capture-table-state-payment')).toHaveText('No data');
  await page.keyboard.press('t');
  await waitForCapture(page, payload);

  // A file that is not a capture is refused where it was offered, and
  // what was open stays open.
  await fromMenu(page, 'capture');
  await dialog.getByTestId('capture-file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(dialog.getByTestId('capture-problem')).toHaveText(
    '“bad.json” could not be opened. The file is not an incident capture this version can read.',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('capture-chip')).toHaveAttribute('data-kind', 'cloudwatch');
  await waitForCapture(page, payload);

  await page.getByTestId('capture-back').click();
  await backOnTheSimulation(page);
  expect(errors).toEqual([]);
});

test('the simulation goes on behind a capture and never reaches its model, which takes a hue only where the capture states one', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const requests = collectRequests(page);
  const google = captureFile(GOOGLE);
  await openStatic(page);
  await waitForScene(page);
  // An incident in the simulation, so it has hue to give the model.
  await setSpeed(page, 4);
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-ddos-surge').click();
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '1');
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBeGreaterThan(20);
  const clock = await clockSeconds(page);

  await fromMenu(page, 'capture');
  const asked = requests.length;
  await page.getByTestId(`capture-open-${GOOGLE}`).click();
  await waitForCapture(page, google);
  // The pointer leaves the model, so nothing is pointed at.
  await page.mouse.move(4, 4);

  // The start of the window: the report has stated nothing yet, so every
  // service is drawn unknown and nothing on the model has a hue.
  await expect(page.getByTestId('capture-status')).toHaveAttribute('data-level', '0');
  await expect(page.getByTestId('capture-status')).toContainText(
    '12 services, none stated yet in the report',
  );
  await expect.poll(() => page.evaluate(() => window.__aegis!.stats().unknown)).toBe(12);
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBe(0);
  // For seconds on end, while the simulation's incident runs on behind it,
  // the scene draws the capture and nothing of the simulation.
  const still = await drawn(page);
  expect(still).toMatchObject({ nodes: 12, edges: google.edges.length, unknown: 12 });
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(500);
    expect(await drawn(page)).toEqual(still);
    expect((await frameSummary(page)).chromatic).toBe(0);
  }

  // At 17:49 UTC six services are reported affected: there, and only there,
  // the model takes a hue.
  await page.getByTestId('capture-status').click();
  await page
    .getByTestId('capture-events')
    .getByRole('button', { name: /Service Control starts failing/ })
    .click();
  await expect(page.getByTestId('capture-time')).toHaveAttribute(
    'datetime',
    '2025-06-12T17:49:00.000Z',
  );
  await expect(page.getByTestId('capture-status')).toHaveAttribute('data-level', '2');
  await expect(page.getByTestId('capture-status')).toContainText(
    '6 services reported affected; 6 not stated',
  );
  await expect.poll(() => page.evaluate(() => window.__aegis!.stats().unknown)).toBe(6);
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBeGreaterThan(10);

  // While it was open the page fetched its own files and no engine, API or other origin.
  const meanwhile = requests.slice(asked);
  expect(meanwhile.filter((url) => !url.startsWith(baseURL!))).toEqual([]);
  expect(meanwhile.filter((url) => new URL(url).pathname.includes('/api/'))).toEqual([]);
  expect(meanwhile.filter((url) => url.endsWith('.wasm'))).toEqual([]);
  expect(requests.filter((url) => url.endsWith('.wasm'))).toHaveLength(1);

  // The simulation went on meanwhile, and its model is drawn again.
  await page.getByTestId('capture-back').click();
  await expect(page.getByTestId('capture-status')).toHaveCount(0);
  await expect(page.getByTestId('platform-status')).toBeVisible();
  await waitForScene(page, KINDS);
  await expect.poll(() => clockSeconds(page)).toBeGreaterThan(clock + 10);
});

test('on a phone a capture keeps its names apart and its model in the picture', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const google = await openCapture(page, GOOGLE);
  const canvas = page.getByRole('img', { name: /Interactive 3D view/ });

  await expect.poll(() => overlappingNames(page)).toBe(0);
  await expect.poll(async () => (await frameSummary(page)).drawn).toBeGreaterThan(10);
  // Every piece is drawn within the screen's width, under the top bar and
  // above the capture's bar.
  const box = (await canvas.boundingBox())!;
  const top = (await page.getByRole('banner').boundingBox())!;
  const foot = (await page.getByTestId('timeline').boundingBox())!.y;
  const pieces = await page.evaluate(
    (ids) => ids.map((id) => window.__aegis!.projectNode(id)),
    google.nodes.map((node) => node.id),
  );
  const xs: number[] = [];
  for (const [i, point] of pieces.entries()) {
    const name = google.nodes[i]!.name;
    expect(point, name).not.toBeNull();
    const x = box.x + point!.x;
    const y = box.y + point!.y;
    expect(x, name).toBeGreaterThan(0);
    expect(x, name).toBeLessThan(390);
    expect(y, name).toBeGreaterThan(top.y + top.height);
    expect(y, name).toBeLessThan(foot);
    xs.push(x);
  }
  // The region names are long for a phone. They are not allowed to push
  // the model back until it is a speck: it still spans much of the width.
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(390 * 0.4);
  // Nor is one drawn cut: a name the screen's edge, the top bar or the
  // capture's bar would cut is left out, and every name shown is whole.
  const picture = {
    left: Math.max(0, box.x),
    right: Math.min(390, box.x + box.width),
    top: Math.max(box.y, top.y + top.height),
    bottom: foot,
  };
  await expect.poll(async () => (await namesOnModel(page)).length).toBeGreaterThan(0);
  for (let i = 0; i < 4; i++) {
    expect(await namesOutside(page, picture)).toEqual([]);
    await page.waitForTimeout(250);
  }
  // The bar fits the phone: nothing makes the page scroll sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByTestId('capture-back')).toBeVisible();
  await expect(page.getByTestId('capture-chip')).toContainText(google.title);
});

test('one capture leads to another, by the picker and by the menu, and Back still leads to the simulation', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const google = captureFile(GOOGLE);
  const boutique = captureFile(BOUTIQUE);
  await openStatic(page);
  await waitForScene(page);
  const entries = await page.evaluate(() => window.history.length);
  const picker = page.getByTestId('capture-picker');
  const entriesNow = () => page.evaluate(() => window.history.length);

  await fromMenu(page, 'capture');
  await page.getByTestId(`capture-open-${GOOGLE}`).click();
  await waitForCapture(page, google);
  await expect(picker).toHaveValue(GOOGLE);
  expect(await entriesNow()).toBe(entries + 1);

  // The picker opens the other one in the same entry: the simulation stays
  // one step back.
  await picker.selectOption(BOUTIQUE);
  await expect(page).toHaveURL(new RegExp(`\\?capture=${BOUTIQUE}$`));
  await waitForCapture(page, boutique);
  await expect(picker).toHaveValue(BOUTIQUE);
  await expect(page.getByTestId('capture-chip')).toHaveAttribute(
    'data-kind',
    'prometheus-recording',
  );
  expect(await entriesNow()).toBe(entries + 1);

  // So does the menu's "Open another capture".
  await page.getByTestId('open-menu').click();
  await expect(page.getByTestId('menu-capture')).toContainText('Open another capture');
  await page.getByTestId('menu-capture').click();
  const dialog = page.getByRole('dialog', { name: 'Open an incident capture' });
  await expect(dialog.getByTestId(`capture-open-${BOUTIQUE}`)).toHaveAttribute(
    'aria-current',
    'true',
  );
  await dialog.getByTestId(`capture-open-${GOOGLE}`).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`\\?capture=${GOOGLE}$`));
  await waitForCapture(page, google);
  await expect(picker).toHaveValue(GOOGLE);
  await expect(page.getByTestId('capture-chip')).toHaveAttribute('data-kind', 'provider-report');
  expect(await entriesNow()).toBe(entries + 1);

  // Back is the simulation whichever capture was shown last, and Forward
  // that capture; after a switch made there, the same again.
  await page.goBack();
  await expect(page).not.toHaveURL(/capture=/);
  await backOnTheSimulation(page);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`\\?capture=${GOOGLE}$`));
  await waitForCapture(page, google);
  await picker.selectOption(BOUTIQUE);
  await waitForCapture(page, boutique);
  await page.goBack();
  await backOnTheSimulation(page);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`\\?capture=${BOUTIQUE}$`));
  await waitForCapture(page, boutique);
  await expect(picker).toHaveValue(BOUTIQUE);
  expect(await entriesNow()).toBe(entries + 1);
  expect(errors).toEqual([]);
});

test('the Online Boutique capture shows each measure as its file has it, and colours nothing it counted no errors for', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const boutique = await openCapture(page, BOUTIQUE);
  const events = boutique.events!;
  await page.mouse.move(4, 4);
  await expect(page.getByTestId('capture-chip')).toHaveAttribute(
    'data-kind',
    'prometheus-recording',
  );
  await expect(page.getByTestId('capture-chip')).toContainText('Captured, not simulated');

  // No sample in the file counts an error, and none has no requests: no
  // service's state is given at any moment, and nothing takes a hue.
  const samples = boutique.nodes.flatMap((node) => node.buckets ?? []);
  expect(samples.some((sample) => sample.faults !== undefined)).toBe(false);
  expect(samples.some((sample) => sample.requests === 0)).toBe(false);
  const status = page.getByTestId('capture-status');
  const atRest = async (atMs: number) => {
    await expect(status).toHaveAttribute('data-level', '0');
    await expect(status).toContainText(
      `${measuredAt(boutique, atMs)} services measured; error counts are not in this capture`,
    );
    await expect
      .poll(() => page.evaluate(() => window.__aegis!.stats().unknown))
      .toBe(boutique.nodes.length);
    await expect.poll(async () => (await frameSummary(page)).drawn).toBeGreaterThan(10);
    expect((await frameSummary(page)).chromatic).toBe(0);
  };
  await atRest(boutique.window.startMs);

  // The injection names no service: the cursor moves and nothing is selected.
  await status.click();
  const list = page.getByRole('complementary', { name: 'Services and events' });
  const injection = events.find((event) => event.title === 'Benchmark fault injected')!;
  await list
    .getByTestId('capture-events')
    .getByRole('button', { name: new RegExp(injection.title) })
    .click();
  await expect(page.getByTestId('capture-time')).toHaveAttribute(
    'datetime',
    new Date(injection.atMs).toISOString(),
  );
  await expect(page.getByRole('complementary', { name: 'Service in the capture' })).toHaveCount(0);
  await atRest(injection.atMs);

  // The memory peak names checkoutservice, which it brings forward.
  const peak = events.find((event) => event.title === 'Checkout memory peak after injection')!;
  expect(peak.nodes).toEqual(['checkoutservice']);
  await list
    .getByTestId('capture-events')
    .getByRole('button', { name: new RegExp(peak.title) })
    .click();
  await expect(page.getByTestId('capture-time')).toHaveAttribute(
    'datetime',
    new Date(peak.atMs).toISOString(),
  );
  const sheet = page.getByRole('complementary', { name: 'Service in the capture' });
  const card = sheet.getByTestId('capture-card');
  await expect(card).toHaveAttribute('data-id', 'checkoutservice');
  await expect(card.getByTestId('capture-card-title')).toHaveText('checkoutservice');
  await expect(card).toContainText('Microservice in Location not supplied');
  await expect(card.getByTestId('capture-type-source')).toHaveText(
    'Kind assumed: the source does not say',
  );
  await expect(card.getByTestId('capture-card-state')).toHaveText('Error rate not measured');

  // The sample at the cursor, as the file has it, and the figures written from it.
  const sample = sampleAt(boutique, 'checkoutservice', peak.atMs)!;
  expect(sample).toEqual({
    atMs: sample.atMs,
    memoryBytes: 16_846_848,
    requests: 17,
    p95Ms: 1031.376,
  });
  await expect(card).toContainText(
    `Sample from ${new Date(sample.atMs).toISOString().slice(11, 19)} UTC`,
  );
  const figure = (measure: string) => card.getByTestId(`capture-figure-${measure}`).locator('dd');
  await expect(figure('requests').first()).toHaveText(/^17\s*in 30 s$/);
  await expect(figure('errors').first()).toHaveText('Not measured');
  await expect(figure('errorRate').first()).toHaveText('Not measured');
  await expect(figure('p95Ms').first()).toHaveText('1.03 s');
  await expect(figure('memoryBytes').first()).toHaveText('16.1 MiB');
  // Only the error rate has a normal range, the simulation's; the others say
  // the lowest and highest the file has for the service, incident included.
  const checkout = boutique.nodes.find((node) => node.id === 'checkoutservice')!.buckets!;
  const span = (values: number[]) => [Math.min(...values), Math.max(...values)];
  expect(span(checkout.map((point) => point.requests!))).toEqual([8, 24]);
  expect(span(checkout.map((point) => point.p95Ms!))).toEqual([408.461, 1726.934]);
  expect(span(checkout.map((point) => point.memoryBytes!))).toEqual([11_628_544, 16_846_848]);
  const range = 'No normal range: the source states none. Lowest–highest in this capture:';
  await expect(figure('requests').last()).toHaveText(`${range} 8–24.`);
  await expect(figure('p95Ms').last()).toHaveText(`${range} 408 ms–1.73 s.`);
  await expect(figure('memoryBytes').last()).toHaveText(`${range} 11.1 MiB–16.1 MiB.`);
  await expect(figure('errors').last()).toHaveText('Not measured in this capture.');
  await expect(figure('errorRate').last()).toHaveText('Normal below 4% (simulation threshold)');
  await expect(card.getByTestId('capture-colour-note')).toHaveText(
    'This capture has no error counts, so no service in it is coloured.',
  );
  // What the source counts as an error is not said where it counted none.
  await expect(card).not.toContainText('Errors are as the source counted them');
  await expect(card.getByTestId('capture-card-events')).toContainText(peak.title);
  const calls = boutique.edges.filter((edge) => edge.source === 'checkoutservice');
  const callers = boutique.edges.filter((edge) => edge.target === 'checkoutservice');
  await expect(card.getByTestId('capture-calls').locator('summary')).toContainText(
    String(calls.length),
  );
  for (const edge of callers) {
    await expect(card.getByTestId('capture-callers')).toContainText(edge.source);
  }

  // With the list and the card open, no name but the selection's lies under either.
  await page.mouse.move(4, 4);
  await expect.poll(() => namesUnder(page, [list, sheet], ['checkoutservice'])).toEqual([]);
  expect((await namesOnModel(page)).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a capture speaks Portuguese with the interface, and keeps the words its file wrote', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const google = captureFile(GOOGLE);
  await openStatic(page, { language: 'pt-BR' });
  await waitForScene(page, KINDS);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('pt-BR');

  await fromMenu(page, 'capture');
  const dialog = page.getByRole('dialog', { name: 'Abrir uma captura de incidente' });
  await expect(dialog).toContainText('Capturas que vêm com o AEGIS');
  const entry = dialog.getByTestId(`capture-open-${GOOGLE}`);
  // The title is the file's; the window around it is the interface's.
  await expect(entry).toContainText(google.title);
  await expect(entry).toContainText(/De .+ a .+, UTC/);
  await entry.click();
  await waitForCapture(page, google);

  const status = page.getByTestId('capture-status');
  await expect(status).toContainText('Às 17:45 UTC');
  await expect(status).toContainText('12 serviços, nenhum informado ainda no relatório');
  const chip = page.getByTestId('capture-chip');
  await expect(chip).toContainText('Do relatório do provedor, não simulado');
  await expect(chip).toHaveAttribute(
    'aria-label',
    `Do relatório do provedor, não simulado: ${google.title}. Mostrar o que é a captura.`,
  );
  const back = page.getByTestId('capture-back');
  await expect(back).toHaveAccessibleName('Voltar à simulação');
  await expect(back.getByText('Voltar à simulação', { exact: true })).toBeVisible();
  await expect(page.getByTestId('capture-list')).toHaveAccessibleName('Serviços e eventos');
  await expect(page.getByTestId('capture-toggle')).toHaveText('Reproduzir');
  await expect(page.getByTestId('capture-offset')).toHaveText('+0:00 desde o início da captura');
  await expect(page.getByRole('radiogroup', { name: 'Velocidade de reprodução' })).toBeVisible();

  // The list and a card in Portuguese; the names in them as the file wrote them.
  await page.getByTestId('capture-list').click();
  const list = page.getByRole('complementary', { name: 'Serviços e eventos' });
  await expect(list.getByTestId('capture-tab-services')).toHaveText('Serviços');
  const iam = list.getByTestId('capture-service-iam');
  await expect(iam).toContainText('Cloud IAM');
  await expect(iam).toContainText('Não informado neste momento');
  await iam.click();
  const sheet = page.getByRole('complementary', { name: 'Serviço na captura' });
  const card = sheet.getByTestId('capture-card');
  await expect(card.getByTestId('capture-card-title')).toHaveText('Cloud IAM');
  await expect(card.getByTestId('capture-card-state')).toHaveText('Não informado neste momento');
  await expect(card.getByTestId('capture-type-source')).toHaveText(
    'Tipo presumido: a fonte não diz',
  );
  await expect(card.getByTestId('capture-colour-note')).toHaveText(
    'O impacto relatado é desenhado como crítico e uma recuperação relatada como degradada; o relatório não classifica a gravidade do impacto.',
  );

  // An event's title is the file's, in English; what it does to the
  // sentence and the card is said in Portuguese.
  await list.getByTestId('capture-tab-events').click();
  await expect(list.getByTestId('capture-tab-events')).toHaveText('Eventos');
  await list
    .getByTestId('capture-events')
    .getByRole('button', { name: /Service Control starts failing/ })
    .click();
  await expect(page.getByTestId('capture-time')).toHaveAttribute(
    'datetime',
    '2025-06-12T17:49:00.000Z',
  );
  await expect(status).toHaveAttribute('data-level', '2');
  await expect(status).toContainText('Às 17:49 UTC');
  await expect(status).toContainText('6 serviços relatados como afetados; 6 sem informação');
  await expect(card.getByTestId('capture-card-state')).toHaveText('Relatado como afetado');
  await expect(page.getByTestId('capture-offset')).toHaveText('+4:00 desde o início da captura');

  // The names on the model are the file's, whole, and none lies under a sheet.
  await page.mouse.move(4, 4);
  await expect.poll(() => namesUnder(page, [list, sheet], ['Cloud IAM'])).toEqual([]);
  await expect.poll(() => overlappingNames(page)).toBe(0);

  // The table, in Portuguese, with the regions as the file names them.
  await page.locator('#main').focus();
  await page.keyboard.press('t');
  const table = page.getByTestId('capture-table');
  await expect(table).toBeVisible();
  await expect(table.getByTestId('capture-table-state-iam')).toHaveText('Relatado como afetado');
  await expect(table.getByTestId('capture-table-state-dataflow')).toHaveText(
    'Não informado neste momento',
  );
  for (const region of google.regions) {
    await expect(table.getByTestId(`capture-table-region-${region.id}`)).toContainText(region.name);
  }
  expect(errors).toEqual([]);
});

test('a capture at rest has no hue in the light theme, nor at night', async ({ page }) => {
  const google = await openCapture(page, GOOGLE);
  await page.mouse.move(4, 4);
  const html = page.locator('html');
  const atRest = async () => {
    await expect(page.getByTestId('capture-status')).toHaveAttribute('data-level', '0');
    await expect
      .poll(() => page.evaluate(() => window.__aegis!.stats().unknown))
      .toBe(google.nodes.length);
    await expect.poll(async () => (await frameSummary(page)).drawn).toBeGreaterThan(10);
    expect((await frameSummary(page)).chromatic).toBe(0);
  };
  const setTheme = async (name: 'Light' | 'Night') => {
    await fromMenu(page, 'settings');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  };

  // The suite's browser asks for a light scheme, and the theme follows it.
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => brightness(page)).toBeGreaterThan(600);
  await atRest();

  // The capture's own menu changes the theme, and the capture stays.
  await setTheme('Night');
  await expect(html).toHaveAttribute('data-theme', 'night');
  await expect.poll(() => brightness(page)).toBeLessThan(140);
  await waitForCapture(page, google);
  await atRest();

  // The light theme chosen, not followed: the same.
  await setTheme('Light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => brightness(page)).toBeGreaterThan(600);
  await waitForCapture(page, google);
  await atRest();
});

test('a capture needs no engine, and leaves nothing behind when the engine is not there', async ({
  page,
}) => {
  await page.route('**/*.wasm', (route) => route.abort());
  const google = await openCapture(page, GOOGLE);
  expect(await page.evaluate(() => window.__aegis!.stats().unknown)).toBe(google.nodes.length);
  // The simulation's failure is not laid over the capture.
  await expect(page.getByTestId('engine-stopped')).toHaveCount(0);
  await page.getByTestId('capture-back').click();
  await expect(page.getByTestId('engine-stopped')).toBeVisible();
  // Nothing of the capture stays drawn under it: there is no model at all.
  await expect(page.getByRole('img', { name: /Interactive 3D view/ })).toHaveCount(0);
  await expect(page.getByTestId('platform-status')).toHaveCount(0);
  await expect(page.getByTestId('timeline')).toHaveCount(0);
  await expect(page.getByTestId('capture-chip')).toHaveCount(0);
});

/**
 * The static site: the same application, with the engine in the tab.
 *
 * These tests repeat the heart of the main suite against a build that has
 * no server to talk to, and add what only this build has to prove: that
 * nothing is requested but its own files, that it runs under the policy it
 * ships with, and that it says so when the engine cannot start.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  clockSeconds,
  collectErrors,
  exampleWorkspace,
  frameSummary,
  fromMenu,
  KINDS,
  openStatic,
  setSpeed,
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

test('replays a public outage and a local cloud capture without the simulation engine', async ({
  page,
  context,
  baseURL,
}) => {
  await openStatic(page);
  const opened = context.waitForEvent('page');
  await fromMenu(page, 'cloud-replay');
  const replay = await opened;
  const errors = collectErrors(replay);
  const requests = collectRequests(replay);
  // Reload the shareable URL so requests are observed from the first file.
  await replay.goto(baseURL + '?replay');
  await expect(replay.getByRole('heading', { name: /Google Cloud outage/ })).toBeVisible();
  await waitForScene(replay, 12);
  expect((await frameSummary(replay)).drawn).toBeGreaterThan(10);
  await replay.getByRole('button', { name: /Service Control starts failing/ }).click();
  await expect(replay.getByTestId('replay-time')).toHaveAttribute(
    'datetime',
    '2025-06-12T17:49:00.000Z',
  );
  await expect.poll(async () => (await frameSummary(replay)).chromatic).toBeGreaterThan(10);
  const inspector = replay.getByRole('combobox', { name: 'Service or connection' });
  await inspector.selectOption('control-iowa');
  await expect(replay.getByTestId('replay-evidence')).toContainText('Impact reported');
  await replay.getByRole('button', { name: /Core API serving recovered/ }).click();
  await inspector.selectOption('control-iowa');
  await expect(replay.getByTestId('replay-evidence')).toContainText('Recovery reported');

  const start = Date.UTC(2025, 5, 12, 18);
  const at = start + 60_000;
  const payload = {
    kind: 'aegis-cloud-replay',
    version: 1,
    title: 'CloudWatch replay test',
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
  const file = replay.getByTestId('replay-file');
  await file.setInputFiles({
    name: 'capture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await expect(replay.getByRole('heading', { name: payload.title })).toBeVisible();
  await waitForScene(replay, 2);
  expect(await replay.evaluate(() => window.__aegis?.stats().edges)).toBe(2);
  await inspector.selectOption('checkout->payment');
  await expect(replay.getByTestId('replay-evidence')).toContainText('No data');
  await replay.getByRole('button', { name: 'Go to first sample with faults' }).click();
  await expect(replay.getByTestId('replay-evidence')).toContainText('25.0%');
  await replay.getByRole('radio', { name: 'Table view' }).click();
  await expect(replay.getByRole('row', { name: /Checkout.*Faults observed/ })).toBeVisible();
  await file.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(replay.getByRole('alert')).toContainText('valid cloud replay capture');
  await expect(replay.getByRole('heading', { name: payload.title })).toBeVisible();
  await replay.getByRole('button', { name: 'Open public replay' }).click();
  await expect(replay.getByRole('heading', { name: /Google Cloud outage/ })).toBeVisible();
  // Long region names cannot push the geometry out of the frame on a phone.
  await replay.setViewportSize({ width: 390, height: 844 });
  await waitForScene(replay, 12);
  await expect.poll(async () => (await frameSummary(replay)).drawn).toBeGreaterThan(10);
  expect(requests.filter((url) => !url.startsWith(baseURL!))).toEqual([]);
  expect(
    requests.filter((url) => url.endsWith('.wasm') || new URL(url).pathname.includes('/api/')),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

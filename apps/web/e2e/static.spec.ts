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

test('the page offers the fixtures and says what only the server can do', async ({ page }) => {
  await openStatic(page);
  await page.getByTestId('open-integrations').click();
  const dialog = page.getByRole('dialog', { name: 'Integrations' });
  // The simulation and the two fixture parsers; no adapter that needs a network.
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expect(dialog).not.toContainText('Live adapter');
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

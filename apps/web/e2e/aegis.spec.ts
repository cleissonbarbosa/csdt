import { expect, test } from '@playwright/test';

import {
  clockSeconds,
  collectErrors,
  exampleWorkspace,
  frameSummary,
  fromMenu,
  KINDS,
  openApp,
  openExplorer,
  openOverview,
  percent,
  SERVICES,
  setSpeed,
  showEveryService,
  waitForScene,
} from './support';

test.describe.configure({ mode: 'serial' });

test('the application loads and reports its rendering backend', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await waitForScene(page);
  await expect(page).toHaveTitle(/AEGIS/);
  await expect(page.getByRole('heading', { name: 'AEGIS', level: 1 })).toBeVisible();
  await expect(page.getByTestId('mode-switch')).toHaveAttribute('data-mode', 'demo');
  // Overview first: no panel, no instrument and no timeline until there is
  // something to show or someone asks.
  await expect(page.getByTestId('explorer')).toHaveCount(0);
  await expect(page.getByTestId('hud')).toHaveCount(0);
  await expect(page.getByTestId('timeline')).toHaveCount(0);
  await openOverview(page);
  await expect(page.getByTestId('hud')).toBeVisible();

  const backend = await page.evaluate(() => window.__aegis?.backend);
  expect(['webgpu', 'webgl2']).toContain(backend);
  if (test.info().project.name === 'chrome-webgpu') expect(backend).toBe('webgpu');
  expect(errors).toEqual([]);
});

test('the overview shows the platform by kind, and every service one step away', async ({
  page,
}) => {
  await openApp(page);
  await waitForScene(page);
  // Fifty-one services are drawn as the twelve kinds they are.
  const overview = await page.evaluate(() => window.__aegis!.stats());
  expect(overview.nodes).toBe(KINDS);
  expect(overview.edges).toBeGreaterThan(12);
  expect(overview.edges).toBeLessThan(40);

  // The frame is not blank: read it back and look for what was drawn on the
  // field. With everything normal and nothing selected, none of it has a
  // hue: colour is an answer, and nothing has been asked.
  await expect
    .poll(async () => (await frameSummary(page)).drawn, { timeout: 30_000 })
    .toBeGreaterThan(60);
  expect((await frameSummary(page)).chromatic).toBe(0);
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-level', 'healthy');
  await expect(page.getByTestId('platform-status')).toHaveText('51 services, all normal');

  // The same platform with every service on its own.
  await showEveryService(page);
  const stats = await page.evaluate(() => window.__aegis!.stats());
  expect(stats.nodes).toBe(SERVICES);
  expect(stats.edges).toBe(75);
  expect(stats.particleCapacity).toBeGreaterThan(2_000);
  // Every region and its services are listed.
  await openExplorer(page);
  await openOverview(page);
  for (const region of ['Global Edge', 'US East · Primary', 'EU West', 'AP Southeast']) {
    await expect(page.getByRole('region', { name: region })).toBeVisible();
  }
  await expect(page.getByTestId('region-us-east')).toHaveAttribute('data-health', 'healthy');
  expect((await frameSummary(page)).chromatic).toBe(0);
  // A handful of draw calls regardless of how many services there are.
  expect(stats.drawCalls).toBeLessThan(80);
});

test('a kind of service can be selected, and a service opened from it', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const canvas = page.getByRole('img', { name: /Interactive 3D view/ });
  const box = (await canvas.boundingBox())!;
  const where = (id: string) => page.evaluate((node) => window.__aegis!.projectNode(node), id);

  // Click where the scene says the gateways are: this exercises real picking.
  // A service is drawn as the kind it belongs to, so its id finds that piece.
  await expect.poll(() => where('kind:api-gateway')).not.toBeNull();
  const at = (await where('kind:api-gateway'))!;
  expect(await where('use-gateway')).toEqual(at);
  await page.mouse.click(box.x + at.x, box.y + at.y);

  // Selecting brings a card about the kind as a whole.
  const card = page.getByTestId('group-card');
  await expect(card).toHaveAttribute('data-group-id', 'kind:api-gateway');
  await expect(card.getByTestId('inspector-title')).toHaveText('API gateways');
  await expect(card).toContainText('3 API gateways in the entry layer');
  await expect(card.getByTestId('inspector-metrics')).toContainText('req/s');
  // The selection is the one thing with a hue: the viewer asked for it.
  await page.mouse.move(box.x + 8, box.y + box.height - 8);
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBeGreaterThan(0);

  // One of its instances, opened: the model changes to the arrangement
  // where that service stands on its own.
  await card.getByTestId('member-use-gateway').click();
  await waitForScene(page, SERVICES);
  const inspector = page.getByTestId('node-inspector');
  await expect(inspector).toHaveAttribute('data-node-id', 'use-gateway');
  await expect(inspector.getByTestId('inspector-title')).toHaveText('API Gateway');
  await expect(inspector.getByText('Healthy')).toBeVisible();
  const metrics = inspector.getByTestId('inspector-metrics');
  await expect(metrics).toContainText('Throughput');
  await expect(metrics).toContainText('req/s');
  await expect(metrics).toContainText(/\d+(\.\d+)? ms/);
  // What it calls is folded until asked for: there are nine of them.
  await inspector.getByTestId('node-calls').locator('summary').click();
  await expect(inspector.getByTestId('node-calls')).toContainText('Cedar Authorizer');
  await openExplorer(page);
  await expect(page.getByTestId('service-use-gateway')).toHaveAttribute('aria-current', 'true');

  // Clicking empty space clears the selection, and the inspector goes away.
  await page.mouse.click(box.x + box.width / 2, box.y + 14);
  await expect(inspector).toHaveCount(0);
  await expect(page.getByTestId('overview')).toHaveCount(0);

  // The explorer selects too.
  await page.getByTestId('service-use-orders-db').click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Orders DB');

  // Back in the overview the selection is let go of: it belonged to the detail.
  await page
    .getByRole('toolbar', { name: 'Scene controls' })
    .getByRole('radio', { name: 'Overview' })
    .click();
  await waitForScene(page, KINDS);
  await expect(page.getByTestId('node-inspector')).toHaveCount(0);
});

test('an incident can be started and alerts and metrics update', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const status = page.getByTestId('platform-status');
  await expect(status).toHaveAttribute('data-incidents', '0');
  await openOverview(page);
  expect(await percent(page, 'hud-errors')).toBeLessThan(1);
  // The dark cockpit: with every reading in range, the top bar shows none.
  await expect(page.getByTestId('deviation-errors')).toHaveCount(0);
  await setSpeed(page, 4);

  // The one command in the top bar leads to the incidents.
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-ddos-surge').click();

  const active = page.getByTestId('active-incident');
  await expect(active).toHaveAttribute('data-scenario', 'ddos-surge');
  await expect(status).toHaveAttribute('data-incidents', '1');
  await expect(status).toContainText('DDoS Surge');
  await expect(active.getByTestId('incident-phase')).toBeVisible();
  // There is now something on the timeline, so it is on the screen.
  await expect(page.getByTestId('timeline')).toBeVisible();

  // The surge saturates the gateway: errors climb and alerts fire.
  await expect.poll(() => percent(page, 'hud-errors'), { timeout: 30_000 }).toBeGreaterThan(10);
  // Out of its range, the reading comes forward into the top bar.
  await expect(page.getByTestId('deviation-errors')).toBeVisible();
  await expect(page.getByTestId('region-us-east')).toHaveAttribute('data-health', 'critical');
  // Now, and only now, the model shows the colours of the data.
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBeGreaterThan(20);
  await expect(page.getByTestId('event-log')).toContainText('Volumetric attack detected');
  await expect(active.getByTestId('impacted-services')).toContainText('API Gateway');
  // The explorer shows the same health the scene does.
  await page.getByTestId('tab-explorer').click();
  await expect(page.getByTestId('service-use-gateway')).toHaveAttribute('data-health', 'critical');
  await page.getByTestId('tab-incidents').click();

  // Mitigation engages by itself and the platform recovers.
  await expect(active).toHaveAttribute('data-status', 'mitigating', { timeout: 30_000 });
  await expect.poll(() => percent(page, 'hud-errors'), { timeout: 30_000 }).toBeLessThan(1);
  await expect(page.getByTestId('deviation-errors')).toHaveCount(0);
});

test('playback can be paused, the timeline rewound and the scenario reset', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await setSpeed(page, 4);
  await openOverview(page);
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-regional-outage').click();
  await expect(page.getByTestId('region-eu-west')).toHaveAttribute('data-health', 'down', {
    timeout: 30_000,
  });
  // Let the outage run on, so a point 90% along the timeline is inside it
  // however quickly this machine got here.
  const downAt = await clockSeconds(page);
  await expect
    .poll(() => clockSeconds(page), { timeout: 30_000 })
    .toBeGreaterThan(downAt / 0.85 + 1);

  // Pause: virtual time stops.
  await page.getByTestId('playback-toggle').click();
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toHaveAttribute('data-status', 'paused');
  const frozen = await clockSeconds(page);
  await page.waitForTimeout(1200);
  expect(await clockSeconds(page)).toBe(frozen);

  // Rewind to the start of the window: the region is healthy again.
  const track = page.getByRole('slider', { name: 'Timeline position' });
  await track.focus();
  await page.keyboard.press('Home');
  await expect(timeline).toHaveAttribute('data-mode', 'replay');
  await expect.poll(() => clockSeconds(page)).toBeLessThan(3);
  await expect(page.getByTestId('region-eu-west')).toHaveAttribute('data-health', 'healthy');
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '0');

  // Scrub forward by clicking on the track, then return to the live head.
  const box = (await track.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  await expect.poll(() => clockSeconds(page)).toBeGreaterThan(frozen * 0.7);
  await expect(page.getByTestId('region-eu-west')).toHaveAttribute('data-health', 'down');
  await page.getByTestId('playback-live').click();
  await expect(timeline).toHaveAttribute('data-mode', 'live');
  await expect(timeline).toHaveAttribute('data-status', 'playing');

  // Reset: a clean slate.
  await page.getByTestId('reset-simulation').click();
  await page.getByTestId('reset-confirm').click();
  await expect(page.getByTestId('active-incident')).toHaveCount(0);
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '0');
  await expect.poll(() => clockSeconds(page)).toBeLessThan(frozen);
  await expect(page.getByTestId('region-eu-west')).toHaveAttribute('data-health', 'healthy');
  await expect(page.getByText('Simulation reset to a clean baseline.')).toBeVisible();
});

test('a Cedar decision is evaluated by the real engine and its path drawn', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  expect((await frameSummary(page)).chromatic).toBe(0);
  await fromMenu(page, 'trace');
  const form = page.getByTestId('authz-form');
  await form.getByTestId('authz-principal').selectOption('User::"mallory"');
  await form.getByTestId('authz-action').selectOption('Action::"exportLedger"');
  await page.getByTestId('authz-evaluate').click();

  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-decision', 'deny');
  await expect(card.getByTestId('decision-policies')).toContainText('forbid-cross-tenant');
  await expect(card.getByTestId('decision-engine')).toContainText(/Embedded Cedar 4\.\d+/);
  await expect(card.getByTestId('decision-path')).toContainText('Cedar Authorizer');
  // The request's path stays drawn on the model after it has been stopped:
  // the path in the colour of what is being followed, the stop in its own.
  await expect(card.getByTestId('decision-trace')).toHaveText('Trace again');
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBeGreaterThan(5);

  // The same principal's own tenant: Cedar permits it and names the policy.
  await form.getByTestId('authz-principal').selectOption('User::"alice"');
  await form.getByTestId('authz-action').selectOption('Action::"viewLedger"');
  await page.getByTestId('authz-evaluate').click();
  await expect(card).toHaveAttribute('data-decision', 'allow');
  await expect(card.getByTestId('decision-policies')).toContainText('finance-view-ledger');
  await expect(page.getByTestId('recent-decisions').getByRole('listitem')).toHaveCount(2);

  // Putting the panel away puts the path away with it.
  await page.getByRole('button', { name: 'Close and put the path away' }).click();
  await expect(page.getByTestId('authz-form')).toHaveCount(0);
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBe(0);
});

test('filters, the table view and keyboard shortcuts work together', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await page.keyboard.press('/');
  await expect(page.getByTestId('explorer-search')).toBeFocused();
  await page.keyboard.type('database eu-west');
  await expect(page.getByTestId('explorer-count')).toHaveText('3 of 51 services');

  await page.getByTestId('explorer-search').blur();
  await page.keyboard.press('t');
  const table = page.getByTestId('topology-table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(4); // header + 3 databases
  await table.getByTestId('table-service-euw-orders-db').click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Orders DB');

  // A service was opened, so the model comes back in a detailed arrangement.
  await page.keyboard.press('t');
  await waitForScene(page, SERVICES);
  await page
    .getByRole('button', { name: /Clear filters/ })
    .first()
    .click();
  await expect(page.getByTestId('explorer-count')).toHaveText('51 of 51 services');
  // Anything can be reached by name from the keyboard.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('command-input')).toBeFocused();
  await page.keyboard.type('cedar auth');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('command-palette')).toHaveCount(0);
  await expect(page.getByTestId('inspector-title')).toHaveText('Cedar Authorizer');
  await page.keyboard.press('Escape');

  await page.keyboard.press('p');
  await expect(page.getByTestId('dev-overlay')).toContainText('FPS');
  await expect(page.getByTestId('dev-overlay')).toContainText(/WebGL 2|WebGPU/);
});

test('scene controls move the camera and switch the arrangement', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await showEveryService(page);
  const where = (id: string) => page.evaluate((node) => window.__aegis!.projectNode(node), id);
  await expect.poll(() => where('use-orders-db')).not.toBeNull();
  const home = (await where('use-orders-db'))!;

  // Double-click focuses the camera on a service: it moves toward the centre.
  const canvas = page.getByRole('img', { name: /Interactive 3D view/ });
  const box = (await canvas.boundingBox())!;
  await page.mouse.dblclick(box.x + home.x, box.y + home.y);
  await expect
    .poll(async () => {
      const at = await where('use-orders-db');
      return at ? Math.hypot(at.x - home.x, at.y - home.y) : 0;
    })
    .toBeGreaterThan(40);

  // The double-click also selected the service, which brought the inspector
  // and moved the picture over for it. Let go, then reset: back to the
  // framing shot.
  await expect(page.getByTestId('inspector-title')).toHaveText('Orders DB');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('node-inspector')).toHaveCount(0);
  await page.getByTestId('scene-reset').click();
  await expect
    .poll(async () => {
      const at = await where('use-orders-db');
      return at ? Math.hypot(at.x - home.x, at.y - home.y) : Infinity;
    })
    .toBeLessThan(3);

  // The dependency layout places services by tier instead of by region.
  const toolbar = page.getByRole('toolbar', { name: 'Scene controls' });
  await toolbar.getByRole('radio', { name: 'Dependencies' }).click();
  await expect
    .poll(async () => {
      const [gateway, database] = await Promise.all([where('use-gateway'), where('use-orders-db')]);
      return gateway && database ? database.x - gateway.x : 0;
    })
    .toBeGreaterThan(150);
  // The key goes round the arrangements: after the last, the overview.
  await page.keyboard.press('l');
  await expect(toolbar.getByRole('radio', { name: 'Overview' })).toBeChecked();
  await waitForScene(page, KINDS);
  await page.keyboard.press('l');
  await expect(toolbar.getByRole('radio', { name: 'Regions' })).toBeChecked();
  await waitForScene(page, SERVICES);

  // Dragging orbits the camera; "frame everything" brings the whole topology back.
  const offset = async () => {
    const at = await where('use-orders-db');
    return at ? Math.hypot(at.x - home.x, at.y - home.y) : Infinity;
  };
  await expect.poll(offset).toBeLessThan(3);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(offset).toBeGreaterThan(20);
  await page.getByTestId('scene-frame').click();
  await expect.poll(offset).toBeLessThan(3);
});

test('the theme can be switched and the model follows', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const brightness = async () => {
    const { background } = await frameSummary(page);
    return background[0] + background[1] + background[2];
  };
  const setTheme = async (name: 'Light' | 'Night') => {
    await fromMenu(page, 'settings');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  };

  await setTheme('Night');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await expect.poll(brightness).toBeLessThan(140);
  // Same rule in the dark: nothing is wrong, so nothing has a hue.
  expect((await frameSummary(page)).chromatic).toBe(0);

  await setTheme('Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(brightness).toBeGreaterThan(600);
});

test('the stress topology renders 150+ services in the same few draw calls', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await showEveryService(page);
  const before = await page.evaluate(() => window.__aegis!.stats().drawCalls);
  await openExplorer(page);
  await page.getByTestId('topology-picker').selectOption('hyperscale-stress');
  await expect
    .poll(() => page.evaluate(() => window.__aegis?.stats().nodes ?? 0), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(150);
  const stats = await page.evaluate(() => window.__aegis!.stats());
  expect(stats.edges).toBeGreaterThanOrEqual(500);
  await expect(page.getByTestId('explorer-count')).toHaveText(
    new RegExp(`${stats.nodes} of ${stats.nodes} services`),
  );
  // Instancing: draw calls do not grow with the number of services.
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__aegis!.stats().drawCalls);
  expect(after).toBeLessThanOrEqual(before + 6);

  // And its overview is the same twelve pieces: the kinds do not multiply.
  await page
    .getByRole('toolbar', { name: 'Scene controls' })
    .getByRole('radio', { name: 'Overview' })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__aegis?.stats().nodes ?? 0), { timeout: 30_000 })
    .toBe(KINDS);
});

test('a platform is imported from its files, runs its own incident, and is put back', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openApp(page);
  await waitForScene(page);

  await fromMenu(page, 'workspace');
  const dialog = page.getByRole('dialog', { name: 'Platform files' });
  await expect(dialog.getByTestId('workspace-in-use')).toContainText(
    'The platform that ships with AEGIS.',
  );

  // Loose files: the server tells a topology from a scenario from a policy.
  await dialog.getByTestId('workspace-files').setInputFiles(exampleWorkspace());
  const check = dialog.getByTestId('workspace-check');
  await expect(check).toContainText('These files are valid');
  await expect(check).toContainText('Corner Shop (6 services)');
  await expect(check).toContainText('3 Cedar policies');
  // Checking changed nothing.
  await expect(page.getByTestId('platform-status')).toContainText('51 services');

  await dialog.getByTestId('workspace-apply').click();
  await expect(dialog).toBeHidden();
  // Six services of six kinds: the overview is six pieces.
  await waitForScene(page, 6);
  await expect(page.getByTestId('platform-status')).toContainText('6 services, all normal');
  await expect(page.getByTestId('topology-picker')).toHaveValue('corner-shop');

  // Its own scenario runs, and Cedar's answer under its own policies stops
  // the flow: there is an incident and something on the model has a hue.
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-receipt-snooping').click();
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '1');
  await expect
    .poll(async () => (await frameSummary(page)).chromatic, { timeout: 30_000 })
    .toBeGreaterThan(0);

  await fromMenu(page, 'workspace');
  await expect(dialog.getByTestId('workspace-in-use')).toContainText(
    'Files imported since this server started',
  );
  await dialog.getByTestId('workspace-reset').click();
  await expect(dialog.getByTestId('workspace-in-use')).toContainText(
    'The platform that ships with AEGIS.',
  );
  await page.keyboard.press('Escape');
  await waitForScene(page, KINDS);
  await expect(page.getByTestId('platform-status')).toContainText('51 services, all normal');
  expect(errors).toEqual([]);
});

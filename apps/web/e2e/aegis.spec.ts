import { expect, test } from '@playwright/test';

import {
  API,
  clockSeconds,
  collectErrors,
  exampleWorkspace,
  frameSummary,
  fromMenu,
  KINDS,
  namesOnModel,
  openApp,
  openExplorer,
  openOverview,
  overlappingNames,
  percent,
  SERVICES,
  setSpeed,
  showEveryService,
  waitForScene,
} from './support';

// One simulation is shared, so the tests run in order and a failure stops
// the ones after it. `AEGIS_E2E_KEEP_GOING=1` runs them all regardless, to
// see every failure of a run at once.
test.describe.configure({ mode: process.env.AEGIS_E2E_KEEP_GOING ? 'default' : 'serial' });

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
  // How far below its piece the gateways' name lies, before anything is
  // selected. Selecting moves the picture over for the card, at another
  // scale, so the distance is counted in that of a name nothing happens to.
  const hangs = async () => {
    const [gateways, authorizers, names] = await Promise.all([
      where('kind:api-gateway'),
      where('kind:cedar-authorizer'),
      page.evaluate(() => window.__aegis!.labels()),
    ]);
    const top = (text: string) => names.find((entry) => entry.text === text)?.top;
    const [name, other] = [top('3 API gateways'), top('3 Cedar authorizers')];
    if (!gateways || !authorizers || name === undefined || other === undefined) return null;
    return (name - gateways.y) / (other - authorizers.y);
  };
  await expect.poll(hangs).not.toBeNull();
  const resting = (await hangs())!;
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
  // The ring of the selection is drawn where the name lay. The name has
  // stepped out for it, so the ring does not run through the words.
  await expect.poll(async () => ((await hangs()) ?? resting) / resting).toBeGreaterThan(1.1);

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

test('a fault is placed by hand on a service, shows on the model and is lifted', async ({
  page,
}) => {
  await openApp(page);
  await waitForScene(page);
  expect((await frameSummary(page)).chromatic).toBe(0);
  await setSpeed(page, 4);
  await openExplorer(page);
  const status = page.getByTestId('platform-status');
  await expect(status).toHaveAttribute('data-faults', '0');

  // From the card of a service: the section waits folded until asked for.
  await page.getByTestId('service-use-search').click();
  const faults = page.getByTestId('node-inspector').getByTestId('faults');
  await faults.getByText('Faults').click();
  await faults.getByTestId('fault-down').click();
  await expect(faults.getByTestId('fault-down')).toHaveAttribute('aria-pressed', 'true');
  await expect(status).toHaveAttribute('data-faults', '1');
  await expect(page.getByTestId('service-use-search')).toHaveAttribute('data-health', 'down', {
    timeout: 30_000,
  });
  // It is not an incident: nothing was started, and no scenario is running.
  await expect(status).toHaveAttribute('data-incidents', '0');
  await expect(page.getByTestId('active-incident')).toHaveCount(0);

  // With the selection let go, the hue left on the model is the data's.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await frameSummary(page)).chromatic).toBeGreaterThan(0);

  // It is on the timeline and in the list of what was placed by hand.
  await page.getByTestId('tab-incidents').click();
  await expect(page.getByTestId('event-log')).toContainText('Fault placed by hand: unreachable');
  const placed = page.getByTestId('faults-in-force');
  await expect(placed).toContainText('Search');
  await expect(placed).toContainText('unreachable');

  // Before it was placed there was none: the past says so.
  await page.getByTestId('playback-toggle').click();
  await page.getByRole('slider', { name: 'Timeline position' }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-mode', 'replay');
  await expect(status).toHaveAttribute('data-faults', '0');
  await expect(placed).toHaveCount(0);
  await page.getByTestId('playback-live').click();
  await expect(status).toHaveAttribute('data-faults', '1');

  await page.getByTestId('faults-lift-all').click();
  await expect(status).toHaveAttribute('data-faults', '0');
  await expect(placed).toHaveCount(0);
  await page.getByTestId('tab-explorer').click();
  await expect(page.getByTestId('service-use-search')).toHaveAttribute('data-health', 'healthy', {
    timeout: 30_000,
  });
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

test('a first visit is oriented once, and the card does not come back', async ({ page }) => {
  await openApp(page, { firstVisit: true });
  await waitForScene(page);
  const card = page.getByTestId('orientation');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button')).toHaveCount(5);
  // The card is the interface's, not the model's: nothing on it has a hue.
  expect((await frameSummary(page)).chromatic).toBe(0);

  await card.getByTestId('orientation-authorization').click();
  await expect(page.getByTestId('authz-form')).toBeVisible();
  await expect(card).toHaveCount(0);
  // Not on the next visit either.
  await page.reload();
  await expect(page.getByTestId('connection-health')).toHaveAttribute('data-state', 'open');
  await waitForScene(page);
  await expect(page.getByTestId('orientation')).toHaveCount(0);
});

test('a Cedar result is flagged once the form moves on, and two are set side by side', async ({
  page,
}) => {
  await openApp(page);
  // The tracer is on the bar itself.
  await page.getByTestId('open-tracer').click();
  const form = page.getByTestId('authz-form');
  await form.getByTestId('authz-action').selectOption('Action::"exportLedger"');
  const mfa = form.getByRole('radiogroup', { name: 'Fresh MFA assertion' });
  await mfa.getByRole('radio', { name: 'True' }).click();
  await page.getByTestId('authz-evaluate').click();

  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-decision', 'allow');
  await expect(card).toHaveAttribute('data-stale', 'false');
  await expect(card.getByTestId('decision-context-mfa')).toHaveText('true');
  await expect(card.getByTestId('decision-policies-used')).toContainText('9 of 9');
  await page.getByTestId('decision-keep').click();

  // The form changes; the result on screen is the old one and says so.
  await mfa.getByRole('radio', { name: 'False' }).click();
  await expect(card).toHaveAttribute('data-stale', 'true');
  await expect(card.getByTestId('decision-stale')).toContainText(
    'Configuration changed. Evaluate again.',
  );
  await expect(card.getByTestId('decision-changes')).toContainText(
    'Fresh MFA assertion was true, now false.',
  );
  await expect(card.getByTestId('decision-result')).toHaveText('Was Allow');

  // Cedar is asked again, and the two answers stand next to each other.
  await page.getByTestId('authz-evaluate').click();
  await expect(card).toHaveAttribute('data-decision', 'deny');
  await expect(card).toHaveAttribute('data-stale', 'false');
  await expect(page.getByTestId('comparison-verdict')).toHaveText(
    'The decision changed from Allow to Deny.',
  );
  await expect(page.getByTestId('comparison-differences')).toContainText(
    'Fresh MFA assertion was true, now false.',
  );
  await expect(page.getByTestId('comparison-attribution')).toContainText(
    'Only A is decided by finance-export-ledger-mfa.',
  );
});

test('on a phone the playback controls stay within reach', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await openApp(page);
  await fromMenu(page, 'timeline');
  const timeline = page.getByTestId('timeline');
  await page.getByTestId('playback-toggle').click();
  await expect(timeline).toHaveAttribute('data-status', 'paused');
  await expect(page.getByTestId('playback-mode')).toHaveText('Paused');

  const inside = async () => {
    const boxes = [];
    for (const id of ['playback-toggle', 'playback-replay', 'playback-live', 'timeline-track']) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(390);
      expect(box.width, id).toBeGreaterThan(20);
      boxes.push(box);
    }
    return boxes;
  };
  const [toggle, , now, track] = await inside();
  // The strip of history has a row to itself, under the controls.
  expect(track!.y).toBeGreaterThanOrEqual(toggle!.y + toggle!.height);
  expect(track!.width).toBeGreaterThan(300);
  expect(Math.abs(now!.y - toggle!.y)).toBeLessThan(4);

  // The longest wording, with the cursor back in history, still fits.
  await page.getByRole('slider', { name: 'Timeline position' }).focus();
  await page.keyboard.press('Home');
  await expect(timeline).toHaveAttribute('data-mode', 'replay');
  await expect(page.getByTestId('playback-mode')).toHaveText('Paused in history');
  await inside();
  await page.getByTestId('playback-live').click();
  await expect(timeline).toHaveAttribute('data-mode', 'live');
});

test('on a phone Cedar is on the bar, and a challenge leaves its panel in reach', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await openApp(page);
  // The things to do first are on the bar itself, none of them cut off.
  for (const id of ['open-command', 'open-tracer', 'explore-incident', 'open-menu']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x, id).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(390);
  }

  // A challenge that is answered in the request tracer. On a phone the
  // tracer takes the width of the screen, so the card lies along the foot
  // and the tracer ends above it.
  await fromMenu(page, 'guide');
  await page.getByTestId('guide-start-export-denied').click();
  const guide = page.getByTestId('guide');
  const tracer = page.getByRole('complementary', { name: 'Trace a request' });
  await expect(tracer).toBeVisible();
  // Whether the card and a panel lie clear of each other.
  const apart = async (panel: typeof tracer) => {
    const [a, b] = await Promise.all([guide.boundingBox(), panel.boundingBox()]);
    if (!a || !b) return false;
    return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y >= b.y + b.height;
  };
  await expect.poll(() => apart(tracer)).toBe(true);
  const card = (await guide.boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(390);

  // So what the challenge asks for can be done, and its answer read.
  await page.getByTestId('authz-evaluate').click();
  await expect(page.getByTestId('decision-card')).toHaveAttribute('data-decision', 'deny');
  await page.getByTestId('guide-answer').click();
  await expect(page.getByTestId('guide-feedback')).toHaveAttribute('data-correct', 'false');
  await expect.poll(() => apart(tracer)).toBe(true);

  // The panel on the other side is kept clear of it the same way.
  await page.getByTestId('explore-incident').click();
  const incidents = page.getByRole('complementary', { name: 'Services and incidents' });
  await expect(incidents).toBeVisible();
  await expect.poll(() => apart(incidents)).toBe(true);

  // A tablet has room for the card beside one panel but not between two:
  // with a panel on each side it lies along the foot there as well.
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(tracer).toBeVisible();
  await expect.poll(() => apart(tracer)).toBe(true);
  await expect.poll(() => apart(incidents)).toBe(true);
  // With one of them closed the card stands beside the other.
  await page.getByTestId('close-explorer').click();
  await expect(incidents).toHaveCount(0);
  await expect.poll(() => apart(tracer)).toBe(true);
});

test('names on the model are sharp and never printed across each other', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  // With room, every kind is named and the headings are written in full.
  await expect.poll(async () => (await namesOnModel(page)).length).toBeGreaterThanOrEqual(14);
  const wide = await namesOnModel(page);
  expect(wide).toEqual(
    expect.arrayContaining(['01 Entry', '02 Identity', '03 Compute', '04 Data']),
  );
  expect(await overlappingNames(page)).toBe(0);

  // They are not part of the scene's picture: whatever resolution that is
  // rendered at, the names have every pixel the display has.
  const resolution = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-aegis-labels]')!;
    return {
      names: canvas.width / canvas.clientWidth,
      scene: window.__aegis!.stats().pixelRatio,
      display: window.devicePixelRatio,
    };
  });
  expect(resolution.scene).toBeLessThan(resolution.display);
  expect(resolution.names).toBeCloseTo(resolution.display, 1);

  // On a phone there is not room for all of them. Fewer are shown, none
  // across another, and the headings are cut to their numbers together.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole('button', { name: 'Frame everything' }).click();
  await expect
    .poll(async () => (await namesOnModel(page)).filter((name) => /^0\d$/.test(name)).length)
    .toBe(4);
  await expect.poll(() => overlappingNames(page)).toBe(0);
  const narrow = await namesOnModel(page);
  expect(narrow.length).toBeLessThan(wide.length);
  expect(narrow.length).toBeGreaterThan(5);

  // A piece that is pointed at is named, whatever its name has to cover.
  const hidden = wide.find((name) => !/^0\d /.test(name) && !narrow.includes(name));
  expect(hidden, 'a name left out for want of room').toBeDefined();
  const topology = (await (await page.request.get(`${API}/topology`)).json()) as {
    nodes: { serviceType: string }[];
  };
  const kinds = [...new Set(topology.nodes.map((node) => node.serviceType))];
  const canvas = page.getByRole('img', { name: /Interactive 3D view/ });
  const box = (await canvas.boundingBox())!;
  let named = false;
  for (const kind of kinds) {
    const at = await page.evaluate((id) => window.__aegis!.projectNode(id), `kind:${kind}`);
    if (!at) continue;
    await page.mouse.move(box.x + at.x, box.y + at.y);
    try {
      await expect.poll(() => namesOnModel(page), { timeout: 1500 }).toContain(hidden);
      named = true;
      break;
    } catch {
      // Not this piece's name; point at the next.
    }
  }
  expect(named, `pointing at its piece shows “${hidden}”`).toBe(true);
  // Even then, what is shown beside it does not lie across another name
  // unless it is the one in hand.
  const shown = await page.evaluate(() => window.__aegis!.labels());
  const others = shown.filter((name) => name.text !== hidden);
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const a = others[i]!;
      const b = others[j]!;
      const across = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(across, `${a.text} / ${b.text}`).toBe(false);
    }
  }
});

test('an incident is explained from its record and summarised when it ends', async ({ page }) => {
  test.setTimeout(150_000);
  await openApp(page);
  await waitForScene(page);
  await setSpeed(page, 4);
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-cascading-failure').click();
  const active = page.getByTestId('active-incident');
  await expect(active).toHaveAttribute('data-scenario', 'cascading-failure');
  await expect(active.getByTestId('phase-times')).toContainText(
    'timed from the start of the incident',
  );

  // The first phase, once the second has begun: what the scenario does by
  // itself, said as that.
  await expect(active.getByTestId('phase-1')).toBeEnabled({ timeout: 30_000 });
  await active.getByTestId('phase-0').click();
  const explained = active.getByTestId('phase-explanation');
  await expect(explained.getByTestId('phase-prescribed')).toContainText(
    'latency ×6 on Orders DB, US East · Primary',
  );
  await expect(explained.getByTestId('phase-prescribed')).toContainText(
    'Announces “Database latency above objective”',
  );

  // The summary so far: the origin on the scenario's word, and what
  // followed along the dependencies the model carries failures back on.
  await page.getByTestId('incident-summary-open').click();
  const summary = page.getByTestId('incident-summary');
  await expect(summary.getByTestId('summary-origin')).toHaveText(
    'Orders DB, US East · Primary: the scenario names it as the root cause.',
  );
  const propagation = summary.getByTestId('summary-propagation');
  await expect(propagation.locator('[data-basis="prescribed"]').first()).toBeVisible();
  await expect(propagation.locator('[data-basis="modelled"]').first()).toBeVisible({
    timeout: 40_000,
  });
  await expect(propagation).toContainText('because it calls Orders DB, US East · Primary');

  // When it is over the summary says how it ended, from the record.
  await expect(summary).toHaveAttribute('data-status', 'resolved', { timeout: 60_000 });
  await expect(summary.getByTestId('summary-outcome')).toContainText(
    'The scenario ended at +1:44 (The scenario ran to completion)',
  );
  await expect(summary.getByTestId('summary-peaks')).toContainText('%');

  // A moment is a link into history.
  await summary.getByTestId('moment-peak-errors').click();
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toHaveAttribute('data-mode', 'replay');
  await expect(page.getByTestId('playback-mode')).toHaveText('History');
  // Back in the panel, the incident is listed with the timeline's others.
  await summary.getByRole('button', { name: /Incidents and scenarios/ }).click();
  await expect(page.getByTestId('incident-inc-001')).toBeVisible();
});

test('an intervention is compared against the same incident without it', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-compare-cascading-failure').click();
  const dialog = page.getByRole('dialog', { name: 'Compare an intervention' });
  await expect(dialog.getByTestId('experiment-node')).toHaveValue('use-orders-db');
  await dialog.getByTestId('experiment-value').fill('6');
  await dialog.getByTestId('experiment-run').click();

  const results = dialog.getByTestId('experiment-results');
  await expect(results.getByTestId('experiment-change')).toContainText(
    'capacity ×6 on Orders DB, US East · Primary, placed +0:21 into the incident',
  );
  // One seed, one scenario, one command of difference.
  await expect(results).toContainText('identical, sample for sample');
  // Six times the capacity lowers the worst of the errors.
  await expect(results.getByTestId('experiment-row-peak-error')).toContainText('−');
  // Both runs were simulated aside: nothing happened to the platform in use.
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '0');
  await expect(page.getByTestId('active-incident')).toHaveCount(0);

  // A run can be put on the timeline to be watched.
  await results.getByTestId('experiment-watch-b').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-mode', 'replay');
  await expect(page.getByTestId('active-incident')).toHaveAttribute(
    'data-scenario',
    'cascading-failure',
    { timeout: 20_000 },
  );
});

test('a session saved to a file brings the experiment back', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await setSpeed(page, 4);
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-regional-outage').click();
  await expect.poll(() => clockSeconds(page), { timeout: 30_000 }).toBeGreaterThan(30);
  await page.getByTestId('playback-toggle').click();
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toHaveAttribute('data-status', 'paused');
  const saved = await clockSeconds(page);

  await fromMenu(page, 'session');
  const dialog = page.getByRole('dialog', { name: 'Session' });
  await expect(dialog.getByTestId('session-contents')).toContainText(/starts Regional/);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByTestId('session-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('aegis-session.json');
  const file = await download.path();
  await page.keyboard.press('Escape');

  // Everything is wiped…
  await page.getByTestId('reset-simulation').click();
  await page.getByTestId('reset-confirm').click();
  await expect(page.getByTestId('active-incident')).toHaveCount(0);
  await expect.poll(() => clockSeconds(page)).toBeLessThan(saved);

  // …and the file puts it back: the same incident, at the same moment.
  await fromMenu(page, 'session');
  await dialog.getByTestId('session-file').setInputFiles(file);
  await expect(dialog.getByTestId('session-open-confirm')).toBeVisible();
  await expect(page.getByTestId('active-incident')).toHaveCount(0);
  await dialog.getByTestId('session-open-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(timeline).toHaveAttribute('data-status', 'paused');
  await expect.poll(() => clockSeconds(page)).toBe(saved);
  await expect(page.getByTestId('active-incident')).toHaveAttribute(
    'data-scenario',
    'regional-outage',
  );
});

test('the address follows the view and brings it back', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await openExplorer(page);
  await page.getByTestId('service-use-orders-db').click();
  await expect(page).toHaveURL(/arrangement=regions/);
  await expect(page).toHaveURL(/select=node%3Ause-orders-db/);
  await page.reload();
  await expect(page.getByTestId('node-inspector')).toHaveAttribute('data-node-id', 'use-orders-db');
  await waitForScene(page, SERVICES);
  // Letting go of it takes it out of the address.
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page).not.toHaveURL(/select=/);
});

test('a scenario written in the editor is checked by the engine and runs', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('open-scenario-editor').click();
  const editor = page.getByTestId('scenario-editor');
  await editor.getByTestId('editor-name').fill('Slow ledger');
  await expect(editor.getByTestId('editor-id')).toHaveValue('slow-ledger');
  await editor.getByTestId('effect-target').first().selectOption('role:primaryDatabase');
  await expect(editor.getByTestId('editor-valid')).toContainText('can run it on Helios Commerce');

  // A figure out of range is refused by the engine, in the engine's words.
  const factor = editor.getByRole('spinbutton', { name: 'Factor' }).first();
  await factor.fill('5000');
  await expect(editor.getByTestId('editor-problem')).toContainText(
    'factor must be between 0 and 1000',
  );
  await expect(editor.getByTestId('editor-run')).toBeDisabled();
  await factor.fill('8');
  await expect(editor.getByTestId('editor-valid')).toBeVisible();
  await expect(editor.getByTestId('editor-file')).toContainText('"factor": 8');

  await editor.getByTestId('editor-run').click();
  await expect(page.getByTestId('active-incident')).toHaveAttribute('data-scenario', 'slow-ledger');
  // It is one of the platform's scenarios now, with the five it had.
  await expect(page.getByTestId('scenario-slow-ledger')).toBeVisible();
  await expect(page.getByTestId('scenario-ddos-surge')).toBeVisible();
  await expect(page.getByTestId('platform-status')).toContainText('Slow ledger');
});

test('a guided challenge checks an answer against the incident itself', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await waitForScene(page);
  await setSpeed(page, 4);
  await fromMenu(page, 'guide');
  const guide = page.getByTestId('guide');
  await guide.getByTestId('guide-start-cascade-origin').click();
  await expect(guide.getByTestId('guide-challenge')).toBeVisible();
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '1');
  // The answer is one service, so the model shows every service.
  await waitForScene(page, SERVICES);
  await expect(guide.getByTestId('guide-waiting')).toContainText('Select a service');

  await openExplorer(page);
  const orders = page.getByTestId('service-use-orders');
  await expect(orders).not.toHaveAttribute('data-health', 'healthy', { timeout: 40_000 });
  await orders.click();
  await guide.getByTestId('guide-answer').click();
  const feedback = guide.getByTestId('guide-feedback');
  await expect(feedback).toHaveAttribute('data-correct', 'false');
  // The run says why this one followed, and that is the hint.
  await expect(feedback).toContainText('because it calls Orders DB, US East · Primary');

  await page.getByTestId('service-use-orders-db').click();
  await guide.getByTestId('guide-answer').click();
  await expect(feedback).toHaveAttribute('data-correct', 'true');
  await expect(feedback).toContainText('the scenario names it as the root cause');
  await expect(guide.getByTestId('guide-next')).toBeVisible();
});

test('uploaded policies are compared with the ones in use before anything is applied', async ({
  page,
}) => {
  await openApp(page);
  const bundle = (await (await page.request.get(`${API}/workspace/export`)).json()) as {
    files: { path: string; text: string }[];
  };
  const inUse = JSON.parse(
    bundle.files.find((file) => file.path === 'cedar/policies.json')!.text,
  ) as { id: string }[];
  const without = inUse.filter((policy) => policy.id !== 'finance-view-ledger');

  await fromMenu(page, 'workspace');
  const dialog = page.getByRole('dialog', { name: 'Platform files' });
  await dialog.getByTestId('workspace-files').setInputFiles({
    name: 'policies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(without)),
  });
  await expect(dialog.getByTestId('workspace-check')).toContainText('These files are valid');
  await dialog.getByTestId('policy-diff-run').click();
  const result = dialog.getByTestId('policy-diff-result');
  await expect(result).toHaveAttribute('data-changed', 'true');
  await expect(result.getByTestId('diff-policies')).toHaveText('Removed: finance-view-ledger');
  await expect(result.getByTestId('diff-matrix')).toContainText(
    '9 go from allow to deny and 0 from deny to allow',
  );
  await expect(result.getByTestId('diff-flows')).toContainText('would stop at the authorizer');
  // Asking changed nothing: the bundled policies are still the ones in use.
  await expect(dialog.getByTestId('workspace-in-use').locator('[data-origin]')).toHaveAttribute(
    'data-origin',
    'bundled',
  );
});

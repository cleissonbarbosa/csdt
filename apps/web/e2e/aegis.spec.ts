import { expect, test } from '@playwright/test';

import { clockSeconds, collectErrors, openApp, percent, setSpeed, waitForScene } from './support';

test.describe.configure({ mode: 'serial' });

test('the application loads and reports its rendering backend', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await waitForScene(page);
  await expect(page).toHaveTitle(/AEGIS/);
  await expect(page.getByRole('heading', { name: 'AEGIS', level: 1 })).toBeVisible();
  await expect(page.getByTestId('mode-switch')).toHaveAttribute('data-mode', 'demo');
  await expect(page.getByTestId('hud')).toBeVisible();

  const backend = await page.evaluate(() => window.__aegis?.backend);
  expect(['webgpu', 'webgl2']).toContain(backend);
  if (test.info().project.name === 'chrome-webgpu') expect(backend).toBe('webgpu');
  expect(errors).toEqual([]);
});

test('the topology is displayed and actually rendered', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const stats = await page.evaluate(() => window.__aegis!.stats());
  expect(stats.nodes).toBe(51);
  expect(stats.edges).toBe(75);
  expect(stats.particleCapacity).toBeGreaterThan(10_000);

  // Every region and its services are listed.
  for (const region of ['Global Edge', 'US East · Primary', 'EU West', 'AP Southeast']) {
    await expect(page.getByRole('region', { name: region })).toBeVisible();
  }
  await expect(page.getByTestId('region-us-east')).toHaveAttribute('data-health', 'healthy');

  // The frame is not blank: read it back and look for lit pixels.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const frame = await window.__aegis!.captureFrame();
          let lit = 0;
          for (let i = 0; i < frame.pixels.length; i += 4 * 97) {
            if (frame.pixels[i]! + frame.pixels[i + 1]! + frame.pixels[i + 2]! > 160) lit++;
          }
          return lit;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(30);
  // A handful of draw calls regardless of how many services there are.
  expect(stats.drawCalls).toBeLessThan(80);
});

test('a service can be selected in the 3D scene and its metrics appear', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const canvas = page.getByRole('img', { name: /Interactive 3D view/ });
  const box = (await canvas.boundingBox())!;

  // Click where the scene says the gateway is: this exercises real picking.
  await expect
    .poll(() => page.evaluate(() => window.__aegis!.projectNode('use-gateway')))
    .not.toBeNull();
  const at = (await page.evaluate(() => window.__aegis!.projectNode('use-gateway')))!;
  await page.mouse.click(box.x + at.x, box.y + at.y);

  const inspector = page.getByTestId('node-inspector');
  await expect(inspector).toHaveAttribute('data-node-id', 'use-gateway');
  await expect(inspector.getByTestId('inspector-title')).toHaveText('API Gateway');
  await expect(inspector.getByText('Healthy')).toBeVisible();
  const metrics = inspector.getByTestId('inspector-metrics');
  await expect(metrics).toContainText('Throughput');
  await expect(metrics).toContainText('req/s');
  await expect(metrics).toContainText(/\d+(\.\d+)? ms/);
  await expect(inspector).toContainText('Cedar Authorizer');
  await expect(page.getByTestId('service-use-gateway')).toHaveAttribute('aria-current', 'true');

  // Clicking empty space clears the selection.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 70);
  await expect(page.getByTestId('overview')).toBeVisible();

  // The explorer selects too, and a connection can be followed.
  await page.getByTestId('service-use-orders-db').click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Orders DB');
});

test('an incident can be started and alerts and metrics update', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await expect(page.getByTestId('hud-incidents')).toHaveText('0');
  expect(await percent(page, 'hud-errors')).toBeLessThan(1);
  await setSpeed(page, 4);

  await page.getByTestId('tab-incidents').click();
  await page.getByTestId('scenario-start-ddos-surge').click();

  const active = page.getByTestId('active-incident');
  await expect(active).toHaveAttribute('data-scenario', 'ddos-surge');
  await expect(page.getByTestId('hud-incidents')).toHaveText('1');
  await expect(active.getByTestId('incident-phase')).toBeVisible();

  // The surge saturates the gateway: errors climb and alerts fire.
  await expect.poll(() => percent(page, 'hud-errors'), { timeout: 30_000 }).toBeGreaterThan(10);
  await expect(page.getByTestId('region-us-east')).toHaveAttribute('data-health', 'critical');
  await expect(page.getByTestId('event-log')).toContainText('Volumetric attack detected');
  await expect(active.getByTestId('impacted-services')).toContainText('API Gateway');
  // The explorer shows the same health the scene does.
  await page.getByTestId('tab-explorer').click();
  await expect(page.getByTestId('service-use-gateway')).toHaveAttribute('data-health', 'critical');
  await page.getByTestId('tab-incidents').click();

  // Mitigation engages by itself and the platform recovers.
  await expect(active).toHaveAttribute('data-status', 'mitigating', { timeout: 30_000 });
  await expect.poll(() => percent(page, 'hud-errors'), { timeout: 30_000 }).toBeLessThan(1);
});

test('playback can be paused, the timeline rewound and the scenario reset', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await setSpeed(page, 4);
  await page.getByTestId('tab-incidents').click();
  await page.getByTestId('scenario-start-regional-outage').click();
  await expect(page.getByTestId('region-eu-west')).toHaveAttribute('data-health', 'down', {
    timeout: 30_000,
  });

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
  await expect(page.getByTestId('hud-incidents')).toHaveText('0');

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
  await expect(page.getByTestId('hud-incidents')).toHaveText('0');
  await expect.poll(() => clockSeconds(page)).toBeLessThan(frozen);
  await expect(page.getByTestId('region-eu-west')).toHaveAttribute('data-health', 'healthy');
  await expect(page.getByText('Simulation reset to a clean baseline.')).toBeVisible();
});

test('a Cedar decision is evaluated by the real engine and traced', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  await page.getByTestId('tab-authorization').click();
  const form = page.getByTestId('authz-form');
  await form.getByTestId('authz-principal').selectOption('User::"mallory"');
  await form.getByTestId('authz-action').selectOption('Action::"exportLedger"');
  await page.getByTestId('authz-evaluate').click();

  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-decision', 'deny');
  await expect(card.getByTestId('decision-policies')).toContainText('forbid-cross-tenant');
  await expect(card.getByTestId('decision-engine')).toContainText(/Embedded Cedar 4\.\d+/);
  await expect(card.getByTestId('decision-path')).toContainText('Cedar Authorizer');

  // The same principal's own tenant: Cedar permits it and names the policy.
  await form.getByTestId('authz-principal').selectOption('User::"alice"');
  await form.getByTestId('authz-action').selectOption('Action::"viewLedger"');
  await page.getByTestId('authz-evaluate').click();
  await expect(card).toHaveAttribute('data-decision', 'allow');
  await expect(card.getByTestId('decision-policies')).toContainText('finance-view-ledger');
  await expect(page.getByTestId('recent-decisions').getByRole('listitem')).toHaveCount(2);
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

  await page.keyboard.press('t');
  await waitForScene(page);
  await page
    .getByRole('button', { name: /Clear filters/ })
    .first()
    .click();
  await expect(page.getByTestId('explorer-count')).toHaveText('51 of 51 services');
  await page.keyboard.press('p');
  await expect(page.getByTestId('dev-overlay')).toContainText('FPS');
  await expect(page.getByTestId('dev-overlay')).toContainText(/WebGL 2|WebGPU/);
});

test('scene controls move the camera and switch the layout', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
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

  // Reset returns to the framing shot.
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
  await page.keyboard.press('l');
  await expect(toolbar.getByRole('radio', { name: 'Regions' })).toBeChecked();

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

test('the stress topology renders 150+ services in the same few draw calls', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const before = await page.evaluate(() => window.__aegis!.stats().drawCalls);
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
});

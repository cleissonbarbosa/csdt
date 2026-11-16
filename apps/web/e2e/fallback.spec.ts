import { expect, test } from '@playwright/test';

import { openApp, openOverview } from './support';

test('without WebGPU or WebGL 2 the topology is shown as an accessible table', async ({ page }) => {
  await openApp(page);
  // The API object may exist, but there is no adapter behind it.
  expect(
    await page.evaluate(async () => (await navigator.gpu?.requestAdapter()) ?? null),
  ).toBeNull();
  expect(
    await page.evaluate(() => document.createElement('canvas').getContext('webgl2')),
  ).toBeNull();

  const table = page.getByTestId('topology-table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('status')).toContainText('neither WebGPU nor WebGL 2');
  await expect(page.getByRole('img', { name: /Interactive 3D view/ })).toHaveCount(0);
  await expect(table.getByRole('table')).toHaveCount(4);
  // Three gateways share a name: what calls them says which is where. A
  // call that stays in the table's own region needs no more than the name.
  await expect(table.getByTestId('table-calls-edge-router')).toHaveText(
    'API Gateway, US East · Primary; API Gateway, EU West; API Gateway, AP Southeast',
  );
  await expect(table.getByTestId('table-calls-use-inventory')).toHaveText('Orders DB');

  // Everything else still works: live metrics, selection, incidents.
  await openOverview(page);
  await expect(page.getByTestId('hud-rps')).not.toHaveText('0');
  await table.getByTestId('table-service-use-cedar').click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Cedar Authorizer');
  await page.getByTestId('explore-incident').click();
  await page.getByTestId('scenario-start-cedar-denial').click();
  await expect(page.getByTestId('active-incident')).toHaveAttribute(
    'data-scenario',
    'cedar-denial',
  );
});

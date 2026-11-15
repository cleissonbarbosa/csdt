import { expect, test } from '@playwright/test';

import { openApp } from './support';

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

  // Everything else still works: live metrics, selection, incidents.
  await expect(page.getByTestId('hud-rps')).not.toHaveText('0');
  await table.getByTestId('table-service-use-cedar').click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Cedar Authorizer');
  await page.getByTestId('tab-incidents').click();
  await page.getByTestId('scenario-start-cedar-denial').click();
  await expect(page.getByTestId('active-incident')).toHaveAttribute(
    'data-scenario',
    'cedar-denial',
  );
});

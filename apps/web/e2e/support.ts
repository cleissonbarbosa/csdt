import { expect, type Page } from '@playwright/test';

/** Settings that make the scene deterministic: no camera drift, no easing. */
const SETTINGS = { autoRotate: false, motion: 'reduced', quality: 'low' };

export const API = '/api/v1';

/** Returns the shared simulation to a clean baseline. */
export async function resetSimulation(page: Page): Promise<void> {
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`${API}${path}`, { data });
    expect(response.ok(), `${path} → ${response.status()}`).toBeTruthy();
  };
  await post('/demo/topology/select', { topologyId: 'helios-commerce' });
  await post('/demo/playback/control', { action: 'setSpeed', speed: 1 });
  await post('/demo/playback/control', { action: 'play' });
}

export async function openApp(page: Page): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem(
      'aegis.settings.v1',
      JSON.stringify({ state: settings, version: 1 }),
    );
  }, SETTINGS);
  await resetSimulation(page);
  await page.goto('/');
  await expect(page.getByTestId('connection-health')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('explorer-count')).toHaveText('51 of 51 services');
}

/** Waits until the 3D scene has been built for the loaded topology. */
export async function waitForScene(page: Page): Promise<void> {
  await expect(page.getByRole('img', { name: /Interactive 3D view/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__aegis?.stats().nodes ?? 0), { timeout: 30_000 })
    .toBe(51);
}

export async function setSpeed(page: Page, speed: 0.5 | 1 | 2 | 4): Promise<void> {
  await page
    .getByRole('radiogroup', { name: 'Playback speed' })
    .getByRole('radio', { name: `${speed}×` })
    .click();
}

/** The timeline clock as seconds of virtual time. */
export async function clockSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('playback-clock').textContent()) ?? '0:00';
  return text
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

/** A percentage readout such as `30.2%` or `<0.1%` as a number. */
export async function percent(page: Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).textContent()) ?? '0%';
  return Number.parseFloat(text.replace('<', '').replace('%', ''));
}

/** Console errors that are expected and harmless. */
const IGNORED = [/GPU stall due to ReadPixels/, /WebGL: INVALID_OPERATION/];

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!IGNORED.some((pattern) => pattern.test(text))) errors.push(text);
  });
  return errors;
}

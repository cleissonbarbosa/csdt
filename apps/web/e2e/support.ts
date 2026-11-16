import { expect, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Settings that make the scene deterministic: no camera drift, no easing. */
const SETTINGS = { autoRotate: false, motion: 'reduced', quality: 'low' };

export const API = '/api/v1';

/** Returns the shared simulation to a clean baseline. */
export async function resetSimulation(page: Page): Promise<void> {
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`${API}${path}`, { data });
    expect(response.ok(), `${path} → ${response.status()}`).toBeTruthy();
  };
  // A test may have imported another platform; the bundled one comes first.
  await post('/demo/workspace/reset', {});
  await post('/demo/topology/select', { topologyId: 'helios-commerce' });
  await post('/demo/playback/control', { action: 'setSpeed', speed: 1 });
  await post('/demo/playback/control', { action: 'play' });
}

export interface OpenOptions {
  /**
   * Arrive as someone who has never been here. Every other test arrives as
   * someone who has: the orientation shown on a first visit has been dealt
   * with and is not on the stage.
   */
  firstVisit?: boolean;
}

/** Puts the deterministic settings in place before the page loads. */
async function applySettings(page: Page, options: OpenOptions = {}): Promise<void> {
  await page.addInitScript(
    ({ settings, returning }) => {
      window.localStorage.setItem(
        'aegis.settings.v1',
        JSON.stringify({ state: settings, version: 1 }),
      );
      if (returning) {
        window.localStorage.setItem(
          'aegis.guide.v1',
          JSON.stringify({ state: { oriented: true, completed: [] }, version: 1 }),
        );
      }
    },
    { settings: SETTINGS, returning: !options.firstVisit },
  );
}

export async function openApp(page: Page, options: OpenOptions = {}): Promise<void> {
  await applySettings(page, options);
  await resetSimulation(page);
  await page.goto('/');
  await expect(page.getByTestId('connection-health')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '0');
}

/**
 * Opens the static site. There is no simulation to reset: every page load
 * starts an engine of its own, at its beginning.
 */
export async function openStatic(page: Page): Promise<void> {
  await applySettings(page);
  // Relative to the base URL, which is a path below the root.
  await page.goto('./');
  await expect(page.getByTestId('connection-health')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('platform-status')).toHaveAttribute('data-incidents', '0');
}

/** What is used now and then is in the menu at the end of the top bar. */
export async function fromMenu(page: Page, item: string): Promise<void> {
  await page.getByTestId('open-menu').click();
  await page.getByTestId(`menu-${item}`).click();
}

/**
 * The application opens with the model alone on the stage; panels come when
 * they are asked for. These bring the two that most tests read from.
 */
export async function openExplorer(page: Page): Promise<void> {
  await fromMenu(page, 'services');
  await expect(page.getByTestId('explorer-count')).toBeVisible();
}

/** The platform's own signals: the inspector with nothing selected. */
export async function openOverview(page: Page): Promise<void> {
  await fromMenu(page, 'overview');
  await expect(page.getByTestId('overview')).toBeVisible();
}

/** The files of the example workspace, as someone would pick them one by one. */
export function exampleWorkspace(): string[] {
  const root = join(process.cwd(), '../../examples/corner-shop');
  return ['', 'topologies', 'scenarios', 'recordings', 'cedar'].flatMap((part) =>
    readdirSync(join(root, part))
      .filter((name) => /\.(json|cedar|cedarschema)$/.test(name))
      .map((name) => join(root, part, name)),
  );
}

/** How many pieces the overview of the bundled topology has: one per kind of service. */
export const KINDS = 12;
/** How many services the bundled topology has. */
export const SERVICES = 51;

/**
 * Waits until the 3D scene has been built and drawn. The application opens
 * on the overview, which draws one piece per kind of service.
 */
export async function waitForScene(page: Page, nodes = KINDS): Promise<void> {
  await expect(page.getByRole('img', { name: /Interactive 3D view/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__aegis?.stats().nodes ?? 0), { timeout: 30_000 })
    .toBe(nodes);
  // The count changes the moment a topology is handed over; the camera and
  // the frame's own figures follow with the next frame drawn. Until then a
  // position is the new arrangement seen from the old shot, and the draw
  // calls are the previous scene's. A fast machine reads in between.
  await page.evaluate(
    () =>
      new Promise<void>((drawn) => {
        requestAnimationFrame(() => requestAnimationFrame(() => drawn()));
      }),
  );
}

/** Leaves the overview for an arrangement that shows every service. */
export async function showEveryService(
  page: Page,
  arrangement: 'Regions' | 'Dependencies' = 'Regions',
): Promise<void> {
  await page
    .getByRole('toolbar', { name: 'Scene controls' })
    .getByRole('radio', { name: arrangement })
    .click();
  await waitForScene(page, SERVICES);
}

/** The timeline is not on screen until there is something on it, or it is asked for. */
export async function setSpeed(page: Page, speed: 0.5 | 1 | 2 | 4): Promise<void> {
  if ((await page.getByTestId('timeline').count()) === 0) await fromMenu(page, 'timeline');
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

/** How many pairs of names on the model are drawn across each other. */
export async function overlappingNames(page: Page): Promise<number> {
  return page.evaluate(() => {
    const names = window.__aegis?.labels() ?? [];
    let pairs = 0;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i]!;
        const b = names[j]!;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) pairs++;
      }
    }
    return pairs;
  });
}

/** The names drawn over the model right now. */
export async function namesOnModel(page: Page): Promise<string[]> {
  return page.evaluate(() => (window.__aegis?.labels() ?? []).map((name) => name.text));
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

/**
 * Reads the rendered frame back and summarises it: the background colour,
 * how many sampled pixels differ from it (is anything drawn?) and how many
 * carry a real hue (is anything signalling?).
 */
export async function frameSummary(
  page: Page,
): Promise<{ background: [number, number, number]; drawn: number; chromatic: number }> {
  return page.evaluate(async () => {
    const frame = await window.__aegis!.captureFrame();
    const p = frame.pixels;
    const background: [number, number, number] = [p[0]!, p[1]!, p[2]!];
    let drawn = 0;
    let chromatic = 0;
    for (let i = 0; i < p.length; i += 4 * 53) {
      const r = p[i]!;
      const g = p[i + 1]!;
      const b = p[i + 2]!;
      if (
        Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) >
        36
      )
        drawn++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 70) chromatic++;
    }
    return { background, drawn, chromatic };
  });
}

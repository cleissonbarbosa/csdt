import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests of the static site: the application built around the
 * engine compiled to WebAssembly, served as plain files with no AEGIS server
 * anywhere. It is served below the root (`/aegis/`), as a project site on a
 * static host is, because the build must not care where it is put.
 *
 * Every page load starts an engine of its own, so unlike the suite that
 * shares one server these tests do not depend on each other.
 */
const WEB_PORT = 4187;
const BASE = '/aegis/';
const gpu = process.env.AEGIS_E2E_GPU === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: /static\.spec\.ts/,
  // Software rendering is slow enough with one browser at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // As in the main suite: software rendering makes a test long, by as much
  // as the runner's CPU decides (`playwright.config.ts`).
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}${BASE}`,
    // The interface follows the browser's language; the tests are in English.
    locale: 'en-US',
    viewport: { width: 1600, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The site registers a worker that keeps its files. These tests are of
    // the site as it is fetched; the one that is of the worker allows it.
    serviceWorkers: 'block',
  },
  projects: [
    {
      // Software WebGL 2 (SwiftShader): what CI has.
      name: 'static',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
    ...(gpu
      ? [
          {
            // Opt-in, as in the main suite: a local Chrome on a real GPU.
            name: 'static-webgpu',
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1600, height: 900 },
              channel: 'chrome',
              launchOptions: {
                args: [
                  '--enable-unsafe-webgpu',
                  '--enable-features=Vulkan,WebGPU',
                  '--use-angle=vulkan',
                  '--ignore-gpu-blocklist',
                ],
              },
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      // The engine module, the site around it, and a file server.
      command:
        '../../scripts/build-engine.sh && pnpm exec vite build --mode static && ' +
        `pnpm exec vite preview --mode static --base ${BASE} --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}${BASE}`,
      reuseExistingServer: false,
      timeout: 900_000,
    },
  ],
});

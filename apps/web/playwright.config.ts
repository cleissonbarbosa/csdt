import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real stack: the release Rust server and the
 * production build of the web app behind Vite's preview server.
 *
 * Ports are deliberately different from the development defaults so a test
 * run never touches a developer's running instance.
 */
const SERVER_PORT = 8797;
const WEB_PORT = 4183;
const gpu = process.env.AEGIS_E2E_GPU === '1';

export default defineConfig({
  testDir: './e2e',
  // One simulation is shared by every test, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1600, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Software WebGL 2 (SwiftShader): what CI has.
      name: 'chromium',
      testIgnore: /fallback\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
    {
      // No GPU APIs at all: the application must fall back to its table view.
      name: 'no-3d',
      testMatch: /fallback\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
        launchOptions: { args: ['--disable-3d-apis', '--disable-gpu'] },
      },
    },
    ...(gpu
      ? [
          {
            // Opt-in: a locally installed Chrome on a real GPU, using WebGPU.
            name: 'chrome-webgpu',
            testIgnore: /fallback\.spec\.ts/,
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
      command: 'cargo run --release -p aegis-server',
      cwd: '../..',
      url: `http://127.0.0.1:${SERVER_PORT}/api/v1/health`,
      env: {
        AEGIS_BIND: `127.0.0.1:${SERVER_PORT}`,
        AEGIS_ALLOWED_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`,
        AEGIS_LOG: 'warn',
      },
      reuseExistingServer: false,
      timeout: 600_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { AEGIS_API_PROXY: `http://127.0.0.1:${SERVER_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});

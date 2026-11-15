// Probes which graphics backends a locally installed Chrome exposes to pages.
import { chromium } from '@playwright/test';

const variants = {
  'headless + vulkan flags': {
    headless: true,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebGPU',
      '--use-angle=vulkan',
      '--ignore-gpu-blocklist',
    ],
  },
  'headless default': {
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  },
};

for (const [name, options] of Object.entries(variants)) {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', ...options });
    const page = await browser.newPage();
    await page.goto(process.env.PROBE_URL ?? 'http://localhost:5173/');
    const info = await page.evaluate(async () => {
      const out = { gpu: 'gpu' in navigator };
      try {
        const adapter = await navigator.gpu?.requestAdapter({
          powerPreference: 'high-performance',
        });
        out.adapter = adapter
          ? {
              ...(adapter.info
                ? {
                    vendor: adapter.info.vendor,
                    architecture: adapter.info.architecture,
                    device: adapter.info.device,
                    description: adapter.info.description,
                  }
                : {}),
              fallback: adapter.isFallbackAdapter ?? null,
            }
          : null;
      } catch (e) {
        out.adapterError = String(e);
      }
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      out.webgl2 = gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null;
      return out;
    });
    console.log(name, '=>', JSON.stringify(info));
  } catch (error) {
    console.log(name, '=> launch failed:', String(error).split('\n')[0]);
  } finally {
    await browser?.close();
  }
}

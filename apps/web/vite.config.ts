import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

// In development and preview the API is proxied so the browser only ever
// talks to its own origin. Point AEGIS_API_PROXY somewhere else if the server
// is not on its default address.
const apiTarget = process.env.AEGIS_API_PROXY ?? 'http://127.0.0.1:8787';
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false, ws: true },
};

/**
 * The static site has no server to set headers, so its policy travels in the
 * page. It is the deployed policy (`nginx.conf.template`) with one addition:
 * `'wasm-unsafe-eval'`, which lets the page compile the engine module and
 * nothing else. `frame-ancestors` cannot be given in a meta element.
 */
const STATIC_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const ENGINE_MODULE = path('./src/engine/aegis.wasm');

/** What only the static build needs: the engine module, and the policy. */
function staticSite(): Plugin {
  return {
    name: 'aegis-static-site',
    buildStart() {
      if (!existsSync(ENGINE_MODULE)) {
        this.error(
          'The engine module is not built. Run `pnpm engine:build` (it needs the ' +
            'wasm32-unknown-unknown Rust target) and try again.',
        );
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        // The development server injects inline scripts of its own.
        if (context.server) return [];
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: STATIC_CSP },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

/**
 * `--mode static` builds the application around the engine compiled to
 * WebAssembly (`apps/wasm`) instead of the server: no API, no proxy, and
 * relative URLs so the result can be served from any path of any static
 * host. Every other mode talks to the AEGIS server.
 */
export default defineConfig(({ mode }) => {
  const inBrowser = mode === 'static';
  return {
    plugins: [react(), tailwindcss(), ...(inBrowser ? [staticSite()] : [])],
    base: inBrowser ? './' : '/',
    resolve: {
      alias: {
        '@transport': path(
          inBrowser ? './src/engine/transport.ts' : './src/providers/serverTransport.ts',
        ),
        '@': path('./src'),
      },
    },
    server: { port: 5173, strictPort: true, proxy: inBrowser ? undefined : proxy },
    preview: { port: 4173, strictPort: true, proxy: inBrowser ? undefined : proxy },
    worker: { format: 'es' as const },
    build: {
      target: 'es2022',
      outDir: inBrowser ? 'dist-static' : 'dist',
      sourcemap: true,
      // Never inline assets as data: URIs, so the deployed Content-Security-
      // Policy can stay at `font-src 'self'` and `img-src 'self'`.
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/three/')) return 'three';
            if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
              return 'react';
            }
            return undefined;
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  };
});

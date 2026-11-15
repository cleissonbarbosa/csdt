import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Tests of the engine built for the browser. They load the real module
 * (`src/engine/aegis.wasm`, from `pnpm engine:build`) in Node, so they are
 * kept out of `pnpm test`, which needs no Rust toolchain.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/engine/**/*.spec.ts'],
  },
});

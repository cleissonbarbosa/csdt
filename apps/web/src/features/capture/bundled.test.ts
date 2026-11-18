import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BUNDLED, bundledCapture } from './bundled';
import { readCapture } from './capture';

describe('the bundled captures', () => {
  it('are every capture file in this folder, each named by its file', () => {
    const files = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
      .sort();
    expect(BUNDLED.map((entry) => entry.id).sort()).toEqual(files);
  });

  it.each(BUNDLED.map((entry) => [entry.id, entry] as const))(
    '%s says what its file says, as written',
    async (_, entry) => {
      const capture = readCapture(await entry.load());
      expect(capture).not.toBeNull();
      expect(entry.title).toBe(capture!.title);
      expect(entry.sourceLabel).toBe(capture!.source.label);
      expect(entry.window).toEqual(capture!.window);
    },
  );

  it('are found by id, and nothing else is', () => {
    expect(bundledCapture('google-cloud-2025-06-12')?.id).toBe('google-cloud-2025-06-12');
    expect(bundledCapture('Google Cloud outage · 12 June 2025')).toBeUndefined();
    expect(bundledCapture('../capture')).toBeUndefined();
  });
});

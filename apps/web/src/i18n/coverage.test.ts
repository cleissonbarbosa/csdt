import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isProse, scan } from './scan';

const SRC = join(import.meta.dirname, '..');

/** Every source of the application: no test, no dictionary, no declaration. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'i18n' || entry.name === 'test' ? [] : sources(path);
    }
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec|d)\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe('interface text', () => {
  it('tells a sentence from a list of class names', () => {
    expect(isProse('it calls ${via}, which was already not normal')).toBe(true);
    expect(isProse('The scenario ended at ${when}')).toBe(true);
    expect(isProse('flex w-full items-center gap-2 rounded-control px-1')).toBe(false);
    expect(isProse('aegis.settings.v1')).toBe(false);
    expect(isProse('Two words')).toBe(false);
  });

  it('is all written as phrases', () => {
    // AEGIS_I18N_ONLY=features/scenarios,lib/report.ts looks at one area.
    const only = process.env.AEGIS_I18N_ONLY?.split(',').filter(Boolean);
    const offenders = sources(SRC)
      .map((path) => ({ path, name: relative(SRC, path) }))
      .filter(({ name }) => !only || only.some((prefix) => name.startsWith(prefix)))
      .flatMap(({ path, name }) =>
        scan(path, readFileSync(path, 'utf8')).map(
          (found) => `${name}:${found.line} [${found.rule}] ${found.text}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});

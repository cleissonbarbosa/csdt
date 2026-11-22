/**
 * The AEGIS mark is drawn in three places: inline in the bar (`Logo.tsx`),
 * in the logo files of `docs/assets/identity/`, and in the favicon. The
 * files are written by `scripts/build-identity.py`; these tests hold them
 * to the mark in the bar, to the interface's own colours, and hold the page
 * to the icons it names.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GATES, LINE } from './Logo';

const WEB = join(import.meta.dirname, '../../..');
const IDENTITY = join(WEB, '../../docs/assets/identity');
const read = (path: string) => readFileSync(path, 'utf8');

/** Every stroked path of a file, in order: its outline and its weight. */
function strokes(svg: string): { d: string; width: number }[] {
  return [...svg.matchAll(/<path\b[^>]*?\bd="([^"]+)"[^>]*?\bstroke-width="([\d.]+)"/g)].map(
    (match) => ({ d: match[1]!, width: Number(match[2]) }),
  );
}

/** The colour tokens of one theme block of `index.css`, upper case. */
function tokens(css: string, opening: string): Map<string, string> {
  const start = css.indexOf(opening);
  const block = css.slice(start, css.indexOf('}', start));
  return new Map(
    [...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
      m[1]!,
      m[2]!.toUpperCase(),
    ]),
  );
}

const svgs = readdirSync(IDENTITY).filter((name) => name.endsWith('.svg'));

describe('the AEGIS mark', () => {
  it('has the same strokes in the bar as in every identity file', () => {
    expect(svgs.length).toBeGreaterThanOrEqual(9);
    const mark = [...GATES, LINE].map(({ d, width }) => ({ d, width }));
    for (const name of svgs) {
      expect(strokes(read(join(IDENTITY, name))), name).toEqual(mark);
    }
  });

  it('is the favicon the page names', () => {
    expect(read(join(WEB, 'public/favicon.svg'))).toBe(read(join(IDENTITY, 'aegis-favicon.svg')));
  });

  it('is drawn in the interface’s own colours and no others', () => {
    const css = read(join(WEB, 'src/index.css'));
    const light = tokens(css, '@theme {');
    const night = tokens(css, ":root[data-theme='night'] {");
    const allowed = new Set(
      ['plate', 'ink', 'ink-dim', 'logo-line'].flatMap((name) => [
        light.get(name),
        night.get(name),
      ]),
    );
    expect(allowed.has(undefined)).toBe(false);
    for (const name of svgs) {
      for (const [colour] of read(join(IDENTITY, name)).matchAll(/#[0-9a-f]{6}\b/gi)) {
        expect(allowed, `${name}: ${colour}`).toContain(colour.toUpperCase());
      }
    }
  });
});

describe('the icons the page names', () => {
  it('are all in public/', () => {
    const page = read(join(WEB, 'index.html'));
    const manifest = JSON.parse(read(join(WEB, 'public/manifest.webmanifest'))) as {
      icons: { src: string }[];
    };
    const named = [
      ...[...page.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="\/([^"]+)"/g)].map(
        (match) => match[1]!,
      ),
      ...manifest.icons.map((icon) => icon.src),
    ];
    expect(named).toEqual(
      expect.arrayContaining(['favicon.svg', 'apple-touch-icon.png', 'icon-512.png']),
    );
    for (const file of named) expect(existsSync(join(WEB, 'public', file)), file).toBe(true);
  });
});

/**
 * What the page says it is before it is opened: the description a link
 * preview and an installed app show. The simulation is synthetic; an
 * incident capture is not, and the description must not say that
 * everything is.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB = join(import.meta.dirname, '../..');

function descriptions(): string[] {
  const page = readFileSync(join(WEB, 'index.html'), 'utf8');
  const meta = [
    ...page.matchAll(/<meta\s+(?:name|property)="(?:og:)?description"\s+content="([^"]*)"/g),
  ];
  const manifest = JSON.parse(readFileSync(join(WEB, 'public/manifest.webmanifest'), 'utf8')) as {
    description: string;
  };
  return [...meta.map((match) => match[1]!), manifest.description];
}

describe('the page’s own description', () => {
  it('is given for the page, its link preview and the installed app', () => {
    expect(descriptions()).toHaveLength(3);
  });

  it('says the simulation is synthetic, and that a capture shows a real incident', () => {
    for (const text of descriptions()) {
      expect(text).not.toMatch(/Everything shown is synthetic/);
      expect(text).toContain('The simulation is synthetic');
      expect(text).toContain(
        'an incident capture shows a real incident, labelled as not simulated',
      );
    }
  });
});

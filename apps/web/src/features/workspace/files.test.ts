import { describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES, formatBytes, fromInput, stage } from './files';

function file(name: string, text: string, relativePath = ''): File {
  const made = new File([text], name, { type: 'application/json' });
  Object.defineProperty(made, 'webkitRelativePath', { value: relativePath });
  return made;
}

describe('staging files for an import', () => {
  it('keeps a file\u2019s place in the folder it was picked from', () => {
    const picked = fromInput([
      file('shop.json', '{}', 'my-platform/topologies/shop.json'),
      file('loose.cedar', 'permit(principal, action, resource);'),
    ]);
    expect(picked.map((entry) => entry.path)).toEqual([
      'my-platform/topologies/shop.json',
      'loose.cedar',
    ]);
  });

  it('reads what can be part of a workspace and says what it left out', async () => {
    const { files, skipped } = await stage(
      [],
      fromInput([
        file('shop.json', '{"nodes":[],"edges":[]}'),
        file('shop.cedar', 'permit(principal, action, resource);'),
        file('schema.cedarschema', 'entity User;'),
        file('docker-compose.yml', 'services: {}'),
        file('README.md', '# notes'),
        file('photo.PNG', 'binary'),
      ]),
    );
    expect(files).toEqual([
      { path: 'shop.json', text: '{"nodes":[],"edges":[]}' },
      { path: 'shop.cedar', text: 'permit(principal, action, resource);' },
      { path: 'schema.cedarschema', text: 'entity User;' },
      // A Compose file goes to the engine, which reads it as a topology.
      { path: 'docker-compose.yml', text: 'services: {}' },
    ]);
    expect(skipped.map((entry) => entry.path)).toEqual(['README.md', 'photo.PNG']);
    expect(skipped[0]?.reason).toMatch(/not a \.json/);
  });

  it('replaces a staged file that has the same path and keeps the others', async () => {
    const first = await stage(
      [],
      fromInput([file('a.json', '{"v":1}'), file('b.json', '{"v":1}')]),
    );
    const second = await stage(first.files, fromInput([file('a.json', '{"v":2}')]));
    expect(second.files).toEqual([
      { path: 'a.json', text: '{"v":2}' },
      { path: 'b.json', text: '{"v":1}' },
    ]);
    expect(second.skipped).toEqual([]);
  });

  it('does not read a file the server would refuse for its size', async () => {
    const huge = file('huge.json', '{}');
    Object.defineProperty(huge, 'size', { value: MAX_FILE_BYTES + 1 });
    const { files, skipped } = await stage([], fromInput([huge, file('ok.json', '{}')]));
    expect(files.map((entry) => entry.path)).toEqual(['ok.json']);
    expect(skipped).toEqual([{ path: 'huge.json', reason: 'larger than 4.0 MiB' }]);
  });

  it('writes sizes the way a person reads them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB');
  });
});

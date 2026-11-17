import { describe, expect, it } from 'vitest';

import * as fixtures from '@/test/fixtures';

import { isPolicyFile, policiesAsCedar, POLICY_FILE, withPolicies } from './policies';

describe('the policies as a file to edit', () => {
  it('writes each policy under its id and description, in the order they are in force', () => {
    const { policies } = fixtures.catalog();
    const text = policiesAsCedar(policies);
    const ids = [...text.matchAll(/@id\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(ids).toEqual(policies.map((policy) => policy.id));
    for (const policy of policies) {
      expect(text).toContain(policy.content.trim());
    }
    expect(text).toContain(
      '@id("support-refund-limit")\n@description("Support agents may refund orders of their own tenant up to 500.")\npermit',
    );
    expect(text.endsWith('\n')).toBe(true);
  });

  it('escapes what would end a Cedar string, and leaves a policy that names itself alone', () => {
    const text = policiesAsCedar([
      {
        id: 'a"b',
        description: 'back\\slash',
        content: 'permit(principal, action, resource);',
        effect: 'permit',
      },
      {
        id: 'ignored',
        description: 'ignored',
        content: '@id("own")\nforbid(principal, action, resource);',
        effect: 'forbid',
      },
    ]);
    expect(text).toContain('@id("a\\"b")\n@description("back\\\\slash")\npermit');
    expect(text).toContain('\n\n@id("own")\nforbid');
    expect(text).not.toContain('ignored');
  });

  it("replaces the policies among a workspace's files and keeps everything else", () => {
    const files = fixtures.workspaceExport().files;
    expect(files.some((file) => file.path === 'cedar/policies.json')).toBe(true);
    const next = withPolicies(files, 'permit(principal, action, resource);\n');
    expect(next.filter((file) => isPolicyFile(file.path))).toEqual([
      { path: POLICY_FILE, text: 'permit(principal, action, resource);\n' },
    ]);
    const rest = (list: typeof files) => list.filter((file) => !isPolicyFile(file.path));
    expect(rest(next)).toEqual(rest(files));
  });

  it('knows a policy file from the other Cedar files', () => {
    expect(isPolicyFile('cedar/policies.json')).toBe(true);
    expect(isPolicyFile('cedar/orders.cedar')).toBe(true);
    expect(isPolicyFile('cedar/schema.cedarschema')).toBe(false);
    expect(isPolicyFile('cedar/entities.json')).toBe(false);
    expect(isPolicyFile('scenarios/a.json')).toBe(false);
  });
});

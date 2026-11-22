import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  allHave,
  appendPolicy,
  blankSentence,
  groupsOf,
  parseUid,
  readEntities,
  sentenceAsCedar,
  suggestedId,
  typesOf,
  uidText,
} from './policySentence';

// Vitest runs with the package directory as its working directory.
const read = (path: string) => readFileSync(resolve(process.cwd(), '../..', path), 'utf8');
const entities = readEntities(read('fixtures/cedar/entities.json'));
const catalog = JSON.parse(read('fixtures/cedar/catalog.json')) as {
  principals: { uid: string }[];
  resources: { uid: string }[];
};
const principals = catalog.principals.map((principal) => principal.uid);
const resources = catalog.resources.map((resource) => resource.uid);

describe('a policy written as a sentence', () => {
  it('reads entity references both ways', () => {
    expect(parseUid('User::"alice"')).toEqual({ type: 'User', id: 'alice' });
    expect(parseUid('Ns::Doc::"a\\"b"')).toEqual({ type: 'Ns::Doc', id: 'a"b' });
    expect(parseUid('alice')).toBeNull();
    expect(uidText({ type: 'Role', id: 'support' })).toBe('Role::"support"');
  });

  it('offers the groups the entity store gives the principals, and nothing it does not', () => {
    const groups = groupsOf(entities, principals).map(uidText);
    expect(groups).toEqual(expect.arrayContaining(['Role::"support"', 'Role::"finance"']));
    expect(groupsOf(entities, ['User::"nobody"'])).toEqual([]);
    // Every principal and every resource of the bundled catalogue has a tenant.
    expect(allHave(entities, principals, 'tenant')).toBe(true);
    expect(allHave(entities, resources, 'tenant')).toBe(true);
    expect(allHave(entities, principals, 'nickname')).toBe(false);
    expect(typesOf(resources)).toEqual(expect.arrayContaining(['Order', 'Ledger', 'Customer']));
  });

  it('writes the head and the conditions in Cedar’s own syntax', () => {
    expect(sentenceAsCedar({ ...blankSentence(), id: 'open' })).toBe(
      '@id("open")\npermit(principal, action, resource);',
    );
    expect(
      sentenceAsCedar({
        ...blankSentence(),
        effect: 'forbid',
        who: { kind: 'member', uid: 'Role::"contractor"' },
        what: { kind: 'one', uid: 'Action::"exportLedger"' },
        on: { kind: 'type', type: 'Ledger' },
        ownTenant: true,
        context: ['mfa'],
        condition: 'unless',
        id: 'contractors-no-export',
        description: 'Contractors never export a "ledger".',
      }),
    ).toBe(
      [
        '@id("contractors-no-export")',
        '@description("Contractors never export a \\"ledger\\".")',
        'forbid(principal in Role::"contractor", action == Action::"exportLedger", resource is Ledger) unless { principal.tenant == resource.tenant && context has mfa && context.mfa == true };',
      ].join('\n'),
    );
    // A key that is not an identifier is named as a string.
    expect(
      sentenceAsCedar({
        ...blankSentence(),
        who: { kind: 'one', uid: 'User::"alice"' },
        on: { kind: 'one', uid: 'Order::"acme-ord-1001"' },
        context: ['change-window'],
        id: 'x',
      }),
    ).toContain(
      'permit(principal == User::"alice", action, resource == Order::"acme-ord-1001") when { context has "change-window" && context["change-window"] == true };',
    );
  });

  it('suggests an id no policy has, and adds the policy at the end', () => {
    const sentence = {
      ...blankSentence(),
      who: { kind: 'member' as const, uid: 'Role::"support"' },
      what: { kind: 'one' as const, uid: 'Action::"refundOrder"' },
    };
    expect(suggestedId(sentence, [])).toBe('permit-support-refundorder');
    expect(suggestedId(sentence, ['permit-support-refundorder'])).toBe(
      'permit-support-refundorder-2',
    );
    expect(appendPolicy('a;\n\n', 'b;')).toBe('a;\n\nb;\n');
    expect(appendPolicy('  ', 'b;')).toBe('b;\n');
  });
});

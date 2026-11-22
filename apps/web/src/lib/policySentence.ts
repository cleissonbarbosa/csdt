/**
 * A Cedar policy written as a sentence: who may (or may not) do what, on
 * what, and under which conditions.
 *
 * This module writes text and reads nothing back. A policy already written
 * is never parsed to fill a sentence in: what a policy means is Cedar's to
 * say (the editor's check and its comparison with what is in use), so the
 * sentence only ever adds a policy, and the text it adds is the policy.
 *
 * The choices come from the files in use, as they stand: who and what from
 * the catalogue, the groups a principal belongs to from the parents the
 * entity store gives it, and the condition "of their own tenant" only where
 * the entity store gives every principal and every resource of the
 * catalogue a `tenant` attribute. Nothing is offered that the files do not
 * state.
 */

/** An entity reference, as Cedar writes one in a policy's head: `Role::"support"`. */
export interface Uid {
  type: string;
  id: string;
}

/** A string as Cedar writes one: the two characters that end or escape it are escaped. */
export function quoted(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export const uidText = (uid: Uid): string => `${uid.type}::${quoted(uid.id)}`;

/** `User::"alice"` → `{ type: 'User', id: 'alice' }`; `null` for anything else. */
export function parseUid(text: string): Uid | null {
  const match = /^(.+)::"((?:[^"\\]|\\.)*)"$/.exec(text.trim());
  if (!match) return null;
  return { type: match[1] as string, id: (match[2] as string).replace(/\\(.)/g, '$1') };
}

/** One entity of an entity store, as far as the sentence reads it. */
interface Entity {
  uid: Uid;
  attrs: Record<string, unknown>;
  parents: Uid[];
}

function asUid(raw: unknown): Uid | null {
  if (typeof raw === 'string') return parseUid(raw);
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  // Cedar also writes a reference as `{ "__entity": { type, id } }`.
  const inner = (entry.__entity ?? entry) as Record<string, unknown>;
  return typeof inner.type === 'string' && typeof inner.id === 'string'
    ? { type: inner.type, id: inner.id }
    : null;
}

/** The entity store of a file, as far as it can be read; nothing for a file that is not one. */
export function readEntities(text: string): Entity[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  return json.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const entry = raw as Record<string, unknown>;
    const uid = asUid(entry.uid);
    if (!uid) return [];
    const attrs =
      typeof entry.attrs === 'object' && entry.attrs !== null
        ? (entry.attrs as Record<string, unknown>)
        : {};
    const parents = Array.isArray(entry.parents)
      ? entry.parents.flatMap((parent) => {
          const read = asUid(parent);
          return read ? [read] : [];
        })
      : [];
    return [{ uid, attrs, parents }];
  });
}

const same = (a: Uid, b: Uid) => a.type === b.type && a.id === b.id;

/** The groups the given principals belong to, as the entity store says: each once, in order. */
export function groupsOf(entities: readonly Entity[], principals: readonly string[]): Uid[] {
  const groups: Uid[] = [];
  for (const text of principals) {
    const uid = parseUid(text);
    const entity = uid ? entities.find((entry) => same(entry.uid, uid)) : undefined;
    for (const parent of entity?.parents ?? []) {
      if (!groups.some((group) => same(group, parent))) groups.push(parent);
    }
  }
  return groups;
}

/** Whether every one of the given entities has the attribute in the entity store. */
export function allHave(
  entities: readonly Entity[],
  uids: readonly string[],
  attr: string,
): boolean {
  return (
    uids.length > 0 &&
    uids.every((text) => {
      const uid = parseUid(text);
      const entity = uid ? entities.find((entry) => same(entry.uid, uid)) : undefined;
      return entity !== undefined && attr in entity.attrs;
    })
  );
}

/** The entity types of the given references, each once, in order. */
export function typesOf(uids: readonly string[]): string[] {
  const types: string[] = [];
  for (const text of uids) {
    const type = parseUid(text)?.type;
    if (type !== undefined && !types.includes(type)) types.push(type);
  }
  return types;
}

export type Who =
  { kind: 'anyone' } | { kind: 'one'; uid: string } | { kind: 'member'; uid: string };
export type What = { kind: 'anything' } | { kind: 'one'; uid: string };
export type On =
  { kind: 'anything' } | { kind: 'type'; type: string } | { kind: 'one'; uid: string };

export interface Sentence {
  effect: 'permit' | 'forbid';
  who: Who;
  what: What;
  on: On;
  /** Only where the principal's tenant is the resource's. */
  ownTenant: boolean;
  /** Context keys that have to be true. */
  context: string[];
  /** Whether the conditions are what makes it apply, or what keeps it from applying. */
  condition: 'when' | 'unless';
  id: string;
  description: string;
}

export const blankSentence = (): Sentence => ({
  effect: 'permit',
  who: { kind: 'anyone' },
  what: { kind: 'anything' },
  on: { kind: 'anything' },
  ownTenant: false,
  context: [],
  condition: 'when',
  id: '',
  description: '',
});

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A context key as a condition: present, and true. */
function contextTrue(key: string): string {
  return IDENTIFIER.test(key)
    ? `context has ${key} && context.${key} == true`
    : `context has ${quoted(key)} && context[${quoted(key)}] == true`;
}

/** The sentence's conditions joined, or `null` when it has none. */
function conditions(sentence: Sentence): string | null {
  const parts = [
    ...(sentence.ownTenant ? ['principal.tenant == resource.tenant'] : []),
    ...sentence.context.map(contextTrue),
  ];
  return parts.length === 0 ? null : parts.join(' && ');
}

/** The policy, in Cedar's own syntax, under its id and description. */
export function sentenceAsCedar(sentence: Sentence): string {
  const principal =
    sentence.who.kind === 'anyone'
      ? 'principal'
      : sentence.who.kind === 'one'
        ? `principal == ${sentence.who.uid}`
        : `principal in ${sentence.who.uid}`;
  const action = sentence.what.kind === 'anything' ? 'action' : `action == ${sentence.what.uid}`;
  const resource =
    sentence.on.kind === 'anything'
      ? 'resource'
      : sentence.on.kind === 'type'
        ? `resource is ${sentence.on.type}`
        : `resource == ${sentence.on.uid}`;
  const lines = [`@id(${quoted(sentence.id)})`];
  if (sentence.description.trim() !== '') {
    lines.push(`@description(${quoted(sentence.description.trim())})`);
  }
  const head = `${sentence.effect}(${principal}, ${action}, ${resource})`;
  const condition = conditions(sentence);
  lines.push(condition === null ? `${head};` : `${head} ${sentence.condition} { ${condition} };`);
  return lines.join('\n');
}

/** An id a policy can go by: letters, digits and dashes, from what the sentence names. */
export function suggestedId(sentence: Sentence, taken: readonly string[]): string {
  const name = (uid: string) => parseUid(uid)?.id ?? uid;
  const words = [
    sentence.effect,
    sentence.who.kind === 'anyone' ? 'anyone' : name(sentence.who.uid),
    sentence.what.kind === 'anything' ? 'anything' : name(sentence.what.uid),
    sentence.on.kind === 'type'
      ? sentence.on.type
      : sentence.on.kind === 'one'
        ? name(sentence.on.uid)
        : '',
  ];
  const base =
    words
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'policy';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** The policies' text with one more added at its end. */
export function appendPolicy(text: string, policy: string): string {
  const kept = text.trimEnd();
  return `${kept === '' ? '' : `${kept}\n\n`}${policy}\n`;
}

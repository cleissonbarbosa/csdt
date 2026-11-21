/**
 * The selection a cloud inventory file carries, rewritten in the page.
 *
 * The server reads an inventory and says what there is to choose from (a
 * survey); the page writes the choice back into the file's own `selection`
 * and hands the file over to be read again. Nothing here says what a file
 * is or what a selection brings: that is the server's reading.
 */
import type { InventoryBasis, InventorySelection } from '@aegis/contracts';

/** The selection that asks for everything: what a file without one means. */
export const EVERYTHING: InventorySelection = {
  regions: null,
  networks: null,
  kinds: null,
  tags: [],
  name: null,
  bases: null,
  alongPaths: false,
  connectedOnly: false,
  exclude: [],
  without: [],
};

/** Every way a connection can be stated, strongest first. */
const BASES: readonly InventoryBasis[] = ['routing', 'event', 'declared', 'network'];

/** A selection as it is written: only what it asks for, nothing left unsaid. */
function written(selection: InventorySelection): Record<string, unknown> {
  const asked: Record<string, unknown> = {};
  if (selection.regions) asked.regions = selection.regions;
  if (selection.networks) asked.networks = selection.networks;
  if (selection.kinds) asked.kinds = selection.kinds;
  if (selection.tags.length > 0) asked.tags = selection.tags;
  const name = selection.name?.trim();
  if (name) asked.name = name;
  if (selection.bases) asked.bases = selection.bases;
  if (selection.alongPaths) asked.alongPaths = true;
  if (selection.connectedOnly) asked.connectedOnly = true;
  if (selection.exclude.length > 0) asked.exclude = selection.exclude;
  if (selection.without.length > 0) asked.without = selection.without;
  return asked;
}

export function asksForEverything(selection: InventorySelection): boolean {
  return Object.keys(written(selection)).length === 0;
}

/**
 * The file with this selection in it and nothing else changed. A selection
 * that asks for everything is taken out. A text that is not a JSON object
 * is handed back as it is: the server says what is wrong with it.
 */
export function withSelection(text: string, selection: InventorySelection): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return text;
  const file = { ...(parsed as Record<string, unknown>) };
  delete file.selection;
  const asked = written(selection);
  if (Object.keys(asked).length > 0) file.selection = asked;
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * One value of a list chosen or put back. `null` is the list that asks for
 * everything: the first value chosen is then the only one, and the last one
 * put back asks for everything again.
 */
export function toggled<T>(chosen: T[] | null, value: T): T[] | null {
  if (!chosen) return [value];
  const next = chosen.includes(value) ? chosen.filter((one) => one !== value) : [...chosen, value];
  return next.length > 0 ? next : null;
}

/**
 * A tag asked for by one of its values, or by the key alone (`null`: any
 * value). Asking again for what is already asked takes it back.
 */
export function withTag(
  tags: InventorySelection['tags'],
  key: string,
  value: string | null,
): InventorySelection['tags'] {
  const current = tags.find((tag) => tag.key === key);
  if (!current) return [...tags, { key, values: value === null ? [] : [value] }];
  let values: string[] | null;
  if (value === null) {
    values = current.values.length === 0 ? null : [];
  } else if (current.values.includes(value)) {
    const left = current.values.filter((one) => one !== value);
    values = left.length > 0 ? left : null;
  } else {
    values = [...current.values, value];
  }
  return values === null
    ? tags.filter((tag) => tag.key !== key)
    : tags.map((tag) => (tag.key === key ? { key, values } : tag));
}

/** Whether connections stated by a network rule are drawn. */
export function drawsNetworkRules(bases: InventoryBasis[] | null): boolean {
  return bases === null || bases.includes('network');
}

/** The bases with network rules drawn or left out, the others as they were. */
export function withNetworkRules(
  bases: InventoryBasis[] | null,
  drawn: boolean,
): InventoryBasis[] | null {
  const current = bases ?? [...BASES];
  const next = drawn
    ? current.includes('network')
      ? current
      : [...current, 'network' as const]
    : current.filter((basis) => basis !== 'network');
  return BASES.every((basis) => next.includes(basis)) ? null : next;
}

/** The resources left out by hand, with one more or one fewer. */
export function withExcluded(exclude: string[], id: string, out: boolean): string[] {
  const others = exclude.filter((one) => one !== id);
  return out ? [...others, id] : others;
}

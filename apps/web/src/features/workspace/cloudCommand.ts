/**
 * The command that writes a cloud inventory, put together from what the
 * viewer typed. The page runs nothing and reaches no cloud: it writes a
 * line for the viewer to run on their own machine, with their own access.
 */

export type CloudProvider = 'aws' | 'gcp' | 'oci';

/** What each provider is called: a product's name, the same in every language. */
export const PROVIDER_NAME: Record<CloudProvider, string> = {
  aws: 'AWS', // not-interface-text: the name of a product
  gcp: 'Google Cloud', // not-interface-text: the name of a product
  oci: 'Oracle Cloud', // not-interface-text: the name of a product
};

/** What a provider is asked by. */
export type CloudField = 'profile' | 'project' | 'compartment' | 'regions';

export interface CloudAsk {
  provider: CloudProvider;
  profile: string;
  project: string;
  compartment: string;
  /** Region codes, separated by spaces or commas. */
  regions: string;
  /** `KEY` or `KEY=VALUE`, separated by spaces; in quotes where one has a space. */
  tags: string;
  name: string;
}

export const NOTHING_ASKED: CloudAsk = {
  provider: 'aws',
  profile: '',
  project: '',
  compartment: '',
  regions: '',
  tags: '',
  name: '',
};

/**
 * What each provider's collector takes, in the order it is written, and
 * whether it can be read without it. These are the arguments of
 * `scripts/export-cloud-inventory.py`; change one there and change it here.
 */
const ASKED: Record<CloudProvider, readonly { field: CloudField; needed: boolean }[]> = {
  aws: [
    { field: 'profile', needed: false },
    { field: 'regions', needed: true },
  ],
  gcp: [
    { field: 'project', needed: true },
    { field: 'regions', needed: false },
  ],
  oci: [
    { field: 'compartment', needed: true },
    { field: 'profile', needed: false },
    { field: 'regions', needed: true },
  ],
};

const FLAG: Record<CloudField, string> = {
  profile: '--profile',
  project: '--project',
  compartment: '--compartment',
  regions: '--region',
};

const SCRIPT = 'python3 scripts/export-cloud-inventory.py';
const OUTPUT = 'inventory.json';

/** The fields a provider is asked by, in order. */
export function fieldsOf(
  provider: CloudProvider,
): readonly { field: CloudField; needed: boolean }[] {
  return ASKED[provider];
}

/** One word as a shell reads it: as written when it is plain, in quotes otherwise. */
function quoted(word: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** An option and its value. A value that begins with a dash is tied to its option. */
function option(flag: string, value: string): string {
  return value.startsWith('-') ? `${flag}=${quoted(value)}` : `${flag} ${quoted(value)}`;
}

/** Words separated by spaces, with what is in double quotes kept as one. */
function words(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((word) => word !== '');
}

/**
 * The command, and what the provider cannot be read without that is still
 * missing. What is missing is left out of the command rather than stood in
 * for by a placeholder a shell would misread.
 */
export function cloudCommand(ask: CloudAsk): { command: string; missing: CloudField[] } {
  const parts = [SCRIPT, ask.provider];
  const missing: CloudField[] = [];
  for (const { field, needed } of ASKED[ask.provider]) {
    const values =
      field === 'regions'
        ? words(ask.regions.replaceAll(',', ' '))
        : words(`"${ask[field].trim()}"`);
    if (values.length === 0) {
      if (needed) missing.push(field);
      continue;
    }
    for (const value of values) parts.push(option(FLAG[field], value));
  }
  for (const tag of words(ask.tags)) parts.push(option('--tag', tag));
  const name = ask.name.trim();
  if (name) parts.push(option('--name', name));
  parts.push(option('--output', OUTPUT));
  return { command: parts.join(' '), missing };
}

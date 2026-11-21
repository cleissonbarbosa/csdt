/** Published editor schemas must accept the same authored files as the server. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv, type ValidateFunction } from 'ajv';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ajv = new Ajv({
  allErrors: true,
  // Schemars annotates Rust integer widths. Type and bounds are schema keywords.
  formats: { uint8: true, uint32: true, uint64: true, double: true },
});
const names = [
  'workspace',
  'bundle',
  'topology',
  'scenario',
  'recording',
  'catalog',
  'policies',
  'inventory',
] as const;
const validators = Object.fromEntries(
  names.map((name) => [
    name,
    ajv.compile(JSON.parse(readFileSync(join(ROOT, `schemas/v1/${name}.schema.json`), 'utf8'))),
  ]),
);

function validator(name: string): ValidateFunction {
  const validate = validators[name];
  if (!validate) throw new Error(`No published schema for ${name}`);
  return validate;
}

function read(path: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

const files: [string, string][] = [];
for (const workspace of ['fixtures', 'examples/corner-shop']) {
  files.push(
    ['workspace', `${workspace}/workspace.json`],
    ['catalog', `${workspace}/cedar/catalog.json`],
  );
  for (const [directory, schema] of [
    ['topologies', 'topology'],
    ['scenarios', 'scenario'],
    ['recordings', 'recording'],
  ] as const) {
    for (const file of readdirSync(join(ROOT, workspace, directory)).filter((f) =>
      f.endsWith('.json'),
    )) {
      files.push([schema, `${workspace}/${directory}/${file}`]);
    }
  }
}
files.push(['policies', 'fixtures/cedar/policies.json']);
// What the server exports through the API is a bundle.
files.push(['bundle', 'packages/contracts/samples/workspace-export.json']);
// A cloud inventory is read as a topology and has a schema of its own.
const INVENTORIES = 'examples/cloud-inventory/topologies';
for (const file of readdirSync(join(ROOT, INVENTORIES)).filter((f) => f.endsWith('.json'))) {
  files.push(['inventory', `${INVENTORIES}/${file}`]);
}

describe('workspace JSON Schemas', () => {
  it.each(files)('%s accepts %s', (schema, file) => {
    const validate = validator(schema);
    expect(validate(read(file)), ajv.errorsText(validate.errors)).toBe(true);
  });

  it('holds an inventory to its version, its kinds and its bounds', () => {
    const inventory = read(`${INVENTORIES}/aws-shop.json`) as Record<string, unknown> & {
      resources: Record<string, unknown>[];
    };
    const validate = validator('inventory');
    expect(validate(inventory)).toBe(true);
    const [first, ...rest] = inventory.resources;
    for (const broken of [
      { ...inventory, version: 2 },
      { ...inventory, kind: 'aegis-incident-capture' },
      { ...inventory, provider: 'azure' },
      { ...inventory, resources: [] },
      { ...inventory, resources: [{ ...first, arn: 'arn:aws:x' }, ...rest] },
      { ...inventory, resources: [{ ...first, id: 'arn:aws:x' }, ...rest] },
      { ...inventory, resources: [{ ...first, type: 'warehouse' }, ...rest] },
      { ...inventory, selection: { regions: 'sa-east-1' } },
      { ...inventory, selection: { bases: ['guess'] } },
    ]) {
      expect(validate(broken), JSON.stringify(broken).slice(0, 120)).toBe(false);
    }
    // A selection is part of the file, and so is asking for what is in no network.
    expect(
      validate({
        ...inventory,
        selection: { networks: ['shop', null], tags: [{ key: 'env' }], connectedOnly: true },
      }),
      ajv.errorsText(validate.errors),
    ).toBe(true);
  });

  it('rejects unsupported manifest versions and unknown fields', () => {
    for (const manifest of [{ formatVersion: 2 }, {}, { formatVersion: 1, typo: true }]) {
      expect(validator('workspace')(manifest)).toBe(false);
    }
  });

  it('holds the files of an exported bundle to their own schemas', () => {
    const bundle = read('packages/contracts/samples/workspace-export.json') as {
      files: { path: string; text: string }[];
    };
    const schemaOf: Record<string, string> = {
      'workspace.json': 'workspace',
      'cedar/policies.json': 'policies',
      'cedar/catalog.json': 'catalog',
    };
    const checked = bundle.files.flatMap((file) => {
      const schema =
        schemaOf[file.path] ??
        (file.path.startsWith('topologies/')
          ? 'topology'
          : file.path.startsWith('scenarios/')
            ? 'scenario'
            : undefined);
      if (!schema) return [];
      const validate = validator(schema);
      expect(
        validate(JSON.parse(file.text)),
        `${file.path}: ${ajv.errorsText(validate.errors)}`,
      ).toBe(true);
      return [file.path];
    });
    expect(checked).toHaveLength(5);
  });

  it('rejects a bundle of another version, with unknown fields or with too many files', () => {
    const file = { path: 'a.json', text: '{}' };
    for (const bundle of [
      { formatVersion: 2, files: [] },
      { formatVersion: 1 },
      { formatVersion: 1, files: [{ ...file, mode: '0777' }] },
      { formatVersion: 1, files: [{ path: '', text: '' }] },
      { formatVersion: 1, files: Array.from({ length: 257 }, () => file) },
    ]) {
      expect(validator('bundle')(bundle)).toBe(false);
    }
    expect(validator('bundle')({ formatVersion: 1, files: [file] })).toBe(true);
  });

  it('rejects a non-synthetic topology, invalid ids and impossible capacities', () => {
    const topology = read('fixtures/topologies/helios-commerce.json') as {
      id: string;
      dataSource: string;
      nodes: { capacityRps?: number }[];
    };
    expect(validator('topology')({ ...topology, dataSource: 'live' })).toBe(false);
    expect(validator('topology')({ ...topology, id: 'a/b' })).toBe(false);
    const [first] = topology.nodes;
    if (!first) throw new Error('The topology fixture has no nodes');
    first.capacityRps = 0;
    expect(validator('topology')(topology)).toBe(false);
  });

  it('rejects invalid selectors, effect bounds and engine-authored events', () => {
    const scenario = read('examples/corner-shop/scenarios/01-ledger-fire.json') as {
      targets: string[];
      phases: {
        effects: unknown[];
        events?: { kind: string; delayMs: number; title: string }[];
        status: string;
      }[];
    };
    expect(validator('scenario')({ ...scenario, targets: ['not-a-selector'] })).toBe(false);
    const [phase] = scenario.phases;
    if (!phase) throw new Error('The scenario fixture has no phases');
    const effects = phase.effects;
    phase.effects = [{ type: 'capacity', nodes: 'node:ledger', factor: -1 }];
    expect(validator('scenario')(scenario)).toBe(false);
    phase.effects = effects;
    phase.events = [{ kind: 'authz-decision', delayMs: 0, title: 'Forged' }];
    expect(validator('scenario')(scenario)).toBe(false);
    delete phase.events;
    phase.status = 'resolved';
    expect(validator('scenario')(scenario)).toBe(false);
  });

  it('rejects commands that cannot be authored in a recording', () => {
    const recording = read('fixtures/recordings/black-friday-flood.json') as object;
    const commands = [
      { type: 'recordDecision', decision: read('packages/contracts/samples/decision-allow.json') },
      { type: 'importEvents', providerId: 'fixture', events: [] },
      { type: 'exec' },
      // A command takes no field it does not define.
      { type: 'startScenario', scenarioId: 'ddos-surge', note: 'extra' },
      { type: 'abortScenario', decision: {} },
    ];
    for (const command of commands) {
      expect(validator('recording')({ ...recording, commands: [{ atMs: 0, command }] })).toBe(
        false,
      );
    }
  });
});

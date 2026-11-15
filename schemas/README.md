# Workspace JSON Schemas

These self-contained JSON Schema Draft 7 documents describe version 1 of the
AEGIS workspace formats. Associate them with files in your editor or validate
files with any Draft 7 validator:

- `workspace.json`: [workspace](v1/workspace.schema.json).
- A whole workspace saved as one file from the interface:
  [bundle](v1/bundle.schema.json).
- `topologies/*.json`: [topology](v1/topology.schema.json).
- `scenarios/*.json`: [scenario](v1/scenario.schema.json).
- `recordings/*.json`: [recording](v1/recording.schema.json).
- `cedar/catalog.json`: [catalogue](v1/catalog.schema.json).
- `cedar/policies.json`: [policy list](v1/policies.schema.json).

For example, in a checkout, VS Code's `json.schemas` setting can associate
local schemas without adding metadata to authored files:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["/fixtures/topologies/*.json", "/examples/*/topologies/*.json"],
      "url": "./schemas/v1/topology.schema.json"
    },
    {
      "fileMatch": ["/fixtures/scenarios/*.json", "/examples/*/scenarios/*.json"],
      "url": "./schemas/v1/scenario.schema.json"
    }
  ]
}
```

`workspace.json` declares `{"formatVersion": 1}` for the whole directory.
Omitting it selects version 1 for compatibility. Keep the manifest with the
directory when sharing files; unsupported versions fail before loading.
Cedar entities, schemas and native policy source keep Cedar's own formats.

Regenerate with `pnpm workspace:schemas`. Do not edit generated JSON by hand:
the Rust types and their schema annotations are the source. Rust tests
compare every generated schema with the published file, and contract tests
validate the fixtures and `examples/corner-shop` against them.

Schemas check individual files. Run `aegis-server check-workspace <dir>` for
graph structure, duplicate ids, cross-file references and Cedar validation.
See [the workspace guide](../docs/WORKSPACE.md) for the complete semantics.

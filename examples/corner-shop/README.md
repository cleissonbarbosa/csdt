# Corner shop

A complete AEGIS workspace in six services: the smallest one that uses every
part of the format. Everything in it is fictional.

```bash
cargo run -p aegis-server -- check-workspace examples/corner-shop
AEGIS_WORKSPACE=examples/corner-shop cargo run -p aegis-server
```

| File                                 | What it shows                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topologies/corner-shop.json`        | One region, six services, and the roles that let the request tracer draw a path.                                                                                |
| `scenarios/01-ledger-fire.json`      | A scenario written for this topology: it names services by id (`node:ledger`) and takes the database away.                                                      |
| `scenarios/02-receipt-snooping.json` | Two injected flows tied to Cedar requests. The one Cedar denies stops at the authorizer; nothing in the file says which one that is.                            |
| `recordings/a-bad-afternoon.json`    | A seed and two commands. Loading it replays both incidents.                                                                                                     |
| `cedar/shop.cedar`                   | Three policies in Cedar's own syntax, named by their `@id` annotations.                                                                                         |
| `cedar/schema.cedarschema`           | Optional. With it, Cedar validates the policies and the entities at start-up.                                                                                   |
| `cedar/entities.json`                | Three clerks and two receipts.                                                                                                                                  |
| `cedar/catalog.json`                 | What the request tracer offers, the mix of requests that makes up ordinary authorization traffic (a tenth of it is denied), and the two requests the flows use. |

Things to try:

- Start **Receipt snooping** and watch the flow for the other shop's receipts
  end at the Rulebook. Then delete the `other-shops-are-closed-books` policy
  from `cedar/shop.cedar`, restart, and run it again: Cedar now denies by
  default, and the decision names no policy.
- Change `principal.shop` to `principal.branch` in a policy. With the schema
  in place the server refuses to start and says which policy does not
  type-check; remove `schema.cedarschema` and the same mistake only shows as
  an evaluation error on a decision.
- Remove the `scenarios/` and `recordings/` directories and run
  `check-workspace`: the five bundled scenarios come back, and it lists the
  role or the request each of them misses on this topology.

The format is described in [docs/WORKSPACE.md](../../docs/WORKSPACE.md).

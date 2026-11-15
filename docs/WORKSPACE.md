# Workspace

AEGIS ships with one fictional platform, five incidents and nine Cedar
policies. A **workspace** is a directory that replaces any of them with your
own: a topology that describes a platform you care about, scenarios written
for it, and the Cedar policies you want to see evaluated. The server reads it
once at start-up; nothing is recompiled.

What it shows is still a simulation. A topology file describes a platform; the
load, latency, failures and authorization traffic on it are computed by the
engine and labelled `synthetic`, whatever the platform is. Nothing in a
workspace makes AEGIS observe a real system.

## Start from a copy

```bash
aegis-server export-workspace ./my-platform    # the bundled files, as a starting point
aegis-server check-workspace ./my-platform     # validate without starting anything
AEGIS_WORKSPACE=./my-platform aegis-server     # run with it
```

(From a checkout, `cargo run -p aegis-server -- export-workspace ./my-platform`.)

`check-workspace` loads and compiles the directory exactly as start-up does and
prints what it found, including every scenario that cannot run on a topology
and why:

```text
examples/corner-shop: valid
  from the workspace: topologies, scenarios, recordings, cedar/policies, cedar/entities, cedar/catalog, cedar/schema
  not read:
    examples/corner-shop/README.md
  topologies (1):
    corner-shop: 6 services, 5 connections, 1 region (opens at start-up)
  scenarios (2): ledger-fire, receipt-snooping
  recordings (1): a-bad-afternoon
  policies: 3; baseline traffic denied by Cedar: 10.0 %
```

[`examples/corner-shop`](../examples/corner-shop) is a complete workspace in
six services, small enough to read in one sitting. The bundled files in
[`fixtures/`](../fixtures) use the same layout and are the larger reference.

With Docker Compose, mount the directory and name it:

```yaml
services:
  server:
    environment:
      AEGIS_WORKSPACE: /workspace
    volumes:
      - ./my-platform:/workspace:ro
```

## Layout

```text
<workspace>/
  topologies/*.json         the platforms on offer
  scenarios/*.json          incident scenarios
  recordings/*.json         prerecorded incidents
  cedar/policies.json       policies as a JSON list …
  cedar/*.cedar             … or in Cedar's own syntax (one form, not both)
  cedar/entities.json       the entity store
  cedar/catalog.json        what the request tracer offers and what traffic is made of
  cedar/schema.cedarschema  optional: validate policies and entities against it
```

Every part is optional, and the rule is the same for each:

- **A part that is present replaces the bundled one.** A `topologies/`
  directory means only your topologies are offered; a `cedar/policies.json`
  means only your policies are evaluated.
- **A part that is absent comes from the bundled set.** A workspace holding
  nothing but `cedar/policies.json` is the Helios platform under different
  policies.
- Files are taken in file-name order. The first topology is the one that
  opens; scenarios are listed in that order, which is why the bundled ones are
  named `01-…`, `02-…`.
- With no `recordings/` directory, a bundled recording is kept only while the
  topology it was made on and the scenarios it starts are still there.
- Anything else in the directory is left unread, and `check-workspace` lists
  it.

A mistake stops the server from starting and names the file:

```text
my-platform/scenarios/02-brownout.json: phase `Slow`: factor must be between 0 and 1000, got -3
```

Limits: 4 MiB per file, 64 files per directory, 2 000 services and 20 000
connections per topology, 512 policies. They exist so a mistake fails at
start-up instead of exhausting memory. The renderer has been exercised at 178
services; nothing larger has been measured.

## Topology

The same format as
[`fixtures/topologies/helios-commerce.json`](../fixtures/topologies/helios-commerce.json).

```json
{
  "id": "corner-shop",
  "name": "Corner Shop",
  "description": "…",
  "dataSource": "synthetic",
  "regions": [
    { "id": "shop-floor", "name": "Shop floor", "kind": "cloud", "location": "Ground level" }
  ],
  "roles": { "primaryGateway": "front-door", "primaryDatabase": "ledger" },
  "nodes": [
    {
      "id": "shoppers",
      "name": "Shoppers",
      "type": "external-client",
      "region": "shop-floor",
      "tier": 0,
      "baseLatencyMs": 0,
      "baseRps": 120
    },
    {
      "id": "front-door",
      "name": "Front door",
      "type": "api-gateway",
      "region": "shop-floor",
      "tier": 1,
      "baseLatencyMs": 4
    }
  ],
  "edges": [
    {
      "source": "shoppers",
      "target": "front-door",
      "protocol": "https",
      "relationship": "route",
      "weight": 1.0
    }
  ]
}
```

| Field                             | Meaning                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataSource`                      | Must be `synthetic`. The figures come from the simulation, whatever the platform.                                                                                            |
| `regions[].kind`                  | `cloud`, or `edge` for a global edge drawn as the hub the regions stand around. A topology needs no edge region.                                                             |
| `nodes[].type`                    | One of the twelve kinds below. It decides the piece that is drawn and how the model treats the node.                                                                         |
| `nodes[].tier`                    | How far along a request's path the service is, from 0. Used by the layout only.                                                                                              |
| `nodes[].baseLatencyMs`           | The service's own latency when idle.                                                                                                                                         |
| `nodes[].baseRps`                 | For an `external-client`: the demand it generates. Everything else's load follows from the connections.                                                                      |
| `nodes[].capacityRps`, `headroom` | Optional. Without them capacity is the node's load at nominal demand times a headroom that depends on its kind.                                                              |
| `edges[].weight`                  | Calls made on the connection per request the source handles.                                                                                                                 |
| `edges[].relationship`            | `route` (each request takes exactly one), `call`, `auth`, `authz`, `data` (all synchronous: a failure reaches the caller), `publish`, `consume`, `replication`, `telemetry`. |
| `edges[].criticality`             | Optional, 0 to 1: how strongly a failure of the target fails the caller. Defaults by relationship.                                                                           |
| `edges[].latencyMs`               | Optional network latency of the hop. Defaults to 1.2 ms inside a region and 60 ms across regions.                                                                            |
| `edges[].protocol`                | `https`, `grpc`, `amqp`, `sql`, `redis`, `s3`, `tcp` or `otlp`. Shown, not simulated.                                                                                        |

Service kinds: `external-client`, `network-gateway`, `api-gateway`,
`auth-service`, `cedar-authorizer`, `security-monitor`, `microservice`,
`container`, `serverless`, `message-queue`, `database`, `storage`. There are
twelve because each has a modelled piece; a service of another kind has to be
filed under the nearest one.

Constraints, each reported with the id involved:

- **The graph is acyclic.** The model propagates load in one pass along the
  connections. Two services that call each other have to be described by the
  direction that carries the request.
- Ids are 1 to 64 letters, digits, `-`, `_` or `.`, and unique.
- Every connection joins two declared nodes; every node sits in a declared
  region; every role points at a node or a region.

### Roles

A role is a name for a place in a topology. The bundled scenarios and the
request tracer use roles, not ids, which is what lets them run on any topology
that declares them.

| Role                             | Points at                        | Used by                                                                                                    |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `primaryGateway`                 | an API gateway                   | request tracer, DDoS surge, credential stuffing, Cedar denial                                              |
| `primaryAuth`                    | an authentication service        | request tracer, credential stuffing, Cedar denial                                                          |
| `primaryAuthorizer`              | a Cedar authorizer               | request tracer, credential stuffing, Cedar denial                                                          |
| `partnerClient`                  | an external client               | request tracer (where the request starts; without it, the first client), Cedar denial                      |
| `resource:<EntityType>`          | a service or store               | request tracer: a request for `Order::"…"` ends at `resource:Order`; Cedar denial uses `resource:Customer` |
| `protectedResource`              | a service or store               | request tracer (when no `resource:` role matches), Cedar denial                                            |
| `edgeRouter`                     | the router of the global edge    | DDoS surge, credential stuffing, Cedar denial, regional outage                                             |
| `attackSource`                   | an external client               | DDoS surge, credential stuffing                                                                            |
| `primaryDatabase`                | a database                       | cascading failure                                                                                          |
| `securityMonitor`                | a threat monitor                 | the node named on alerts the engine raises; events of all five bundled scenarios                           |
| `outageRegion`, `failoverRegion` | regions with an API gateway each | regional outage                                                                                            |

A topology without `primaryGateway`, `primaryAuth` and `primaryAuthorizer`
still evaluates requests; the tracer just has no path to draw, and says so.

## Scenario

A scenario changes numbers inside the model and announces events. It cannot do
anything else: there is no effect that reaches outside the engine.

```json
{
  "id": "ledger-fire",
  "name": "Ledger fire",
  "summary": "The ledger becomes unreachable. The till fails with it until a copy is brought up.",
  "category": "resilience",
  "severity": "critical",
  "durationMs": 40000,
  "rootCause": "node:ledger",
  "targets": ["node:ledger", "node:till"],
  "phases": [
    {
      "name": "Dark",
      "atMs": 0,
      "rampMs": 1000,
      "status": "active",
      "description": "The ledger stops answering.",
      "effects": [{ "type": "down", "nodes": "node:ledger" }],
      "events": [
        {
          "delayMs": 2000,
          "severity": "critical",
          "kind": "alert",
          "title": "Ledger unreachable",
          "nodes": ["node:ledger"]
        }
      ]
    },
    { "name": "Recovery", "atMs": 20000, "rampMs": 4000, "status": "recovering" }
  ]
}
```

- `category`: `availability`, `identity`, `authorization` or `resilience`.
  `severity`: `info`, `notice`, `warning` or `critical`.
- `durationMs`: up to 30 minutes, the history the timeline keeps.
- A phase lists **the complete set of effects that hold during it**. Anything
  it leaves out eases back to nominal over `rampMs`, so a last phase with no
  effects is how a scenario ends with the platform restored.
- Phases start at `atMs` from the beginning of the scenario; the first at 0,
  each at least one tick (200 ms) after the one before. `status` is `active`,
  `mitigating` or `recovering`.
- `targets` are the services listed as directly affected; `rootCause` is the
  one named as the cause.

### Selectors

A scenario names services with a short string.

| Selector             | Picks                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| `role:<name>`        | the node a topology role points at; works on any topology with that role |
| `node:<id>`          | a node by id; ties the scenario to topologies that have it               |
| `gatewayOf:<region>` | the API gateway of a region                                              |
| `region:<region>`    | every node of a region (only where a set of nodes is accepted)           |

A region is named by a role that points at it (`outageRegion`) or by its own
id (`eu-west`).

A scenario that names a role, a node, a connection or a request a topology
does not have is not an error. It is listed as **unavailable** on that
topology, and `check-workspace` says which name was missing.

### Effects

| `type`        | Fields                             | What it does                                              |
| ------------- | ---------------------------------- | --------------------------------------------------------- |
| `demand`      | `node`, `factor`                   | multiplies the demand an external client generates        |
| `capacity`    | `nodes`, `factor`                  | multiplies capacity                                       |
| `latency`     | `nodes`, `factor`                  | multiplies the nodes' own latency                         |
| `errorInject` | `nodes`, `rate`                    | adds a failure rate at the nodes                          |
| `down`        | `nodes`                            | makes the nodes unreachable                               |
| `edgeWeight`  | `edges`, `factor`                  | multiplies the calls made on the connections              |
| `edgeLatency` | `edges`, `factor`                  | multiplies the network latency of the connections         |
| `edgeError`   | `edges`, `rate`                    | adds a failure rate on the connections                    |
| `routeShift`  | `edge`, `onto`, `fraction`         | moves a fraction of one connection's traffic onto another |
| `flowRate`    | `flow`, `rate`                     | sets the rate of an injected flow                         |
| `flowReject`  | `flow`, `at`, `fraction`, `reason` | rejects a fraction of a flow when it arrives at a node    |

A `factor` is between 0 and 1000; a `rate` or `fraction` between 0 and 1.
`nodes` takes any selector, `node` and `at` a single-node one. `edges` is
`{ "between": { "from": "…", "to": "…" } }` for one connection or
`{ "inboundSync": "…" }` for every synchronous connection into a node; `edge`
and `onto` are `{ "from": "…", "to": "…" }`. `reason` is `waf`, `rate-limit`,
`auth-failure`, `session-revoked` or `policy-deny`.

### Flows

A flow is a stream of requests injected along an explicit route, drawn as its
own traffic: an attack, a probe, one principal's requests.

```json
"flows": [
  {
    "id": "other-receipts",
    "label": "Ana · another shop",
    "suspicious": true,
    "hops": [
      { "from": "role:partnerClient", "to": "role:primaryGateway" },
      { "from": "role:primaryGateway", "to": "role:primaryAuthorizer" },
      { "from": "role:primaryGateway", "to": "role:resource:Receipt", "via": "path" }
    ],
    "authz": { "request": "ana-reads-south", "authorizer": "role:primaryAuthorizer" }
  }
]
```

- A hop is one existing connection, or with `"via": "path"` the shortest
  synchronous path between two nodes.
- `"spill": true` lets what survives the last hop join that node's ordinary
  traffic, which is how a flood saturates what lies behind a gateway.
- A flow's rate is set per phase by `flowRate`: `{ "rps": 14 }`, or
  `{ "ofCapacity": { "node": "role:primaryGateway", "factor": 2.2 } }` so the
  same scenario overloads a small platform and a large one alike.
- `authz` ties the flow to a request in the catalogue's `scenarioRequests`.
  **The flow is stopped at the authorizer if and only if Cedar denied that
  request** when the server started, and the events it raises carry the
  policies Cedar named. A scenario cannot declare a denial.

### Events

`events` are announced `delayMs` after their phase begins, with a `severity`,
a `title`, an optional `message` and the `nodes` they concern. `kind` is
`alert`, `auth-failure`, `mitigation` or `reroute`. The other kinds on the
timeline (a health change, an authorization decision, an imported advisory)
are produced by the engine or by an importer and cannot be written by a
scenario.

## Recording

A recording is a seed and the commands that were issued. Loading one
re-simulates it, identically every time.

```json
{
  "id": "a-bad-afternoon",
  "name": "A bad afternoon",
  "description": "…",
  "topologyId": "corner-shop",
  "seed": 1987,
  "durationMs": 110000,
  "commands": [
    { "atMs": 8000, "command": { "type": "startScenario", "scenarioId": "receipt-snooping" } },
    { "atMs": 56000, "command": { "type": "abortScenario" } }
  ]
}
```

It may only start and stop scenarios, on a topology and with scenarios the
workspace has. The timeline's other commands record an authorization decision
or an imported event; a file is not allowed to put either there by saying so.

## Cedar

The embedded engine is the `cedar-policy` crate. The workspace decides what it
evaluates.

**Policies**, in one of two forms:

- `cedar/policies.json`: a list of `{ "id", "description", "content" }`, the
  shape [cedar-agent](https://github.com/cleissonbarbosa/cedar-agent) accepts
  on `PUT /v1/policies` plus a description.
- `cedar/*.cedar`: files in Cedar's own syntax, read in file-name order. A
  policy's id is its `@id("…")` annotation, or `<file>-<n>` counting from one;
  its description is its `@description("…")` annotation. Policy templates are
  refused.

**`cedar/entities.json`** is the entity store in the JSON form Cedar reads.

**`cedar/schema.cedarschema`**, when present, is a schema in Cedar's schema
syntax. The policies are validated against it in strict mode and the entities
are checked against it; what the Cedar validator reports stops the server
from starting. Without the file nothing is validated ahead of time, and a
policy that reads an attribute nobody has only shows as an evaluation error
in the decision.

**`cedar/catalog.json`** is AEGIS' own file. It says what the request tracer
offers and what authorization traffic is made of:

| Field                                           | Meaning                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`, `principals`, `actions`, `resources` | the choices in the request tracer, with their labels. A resource is offered for an action when their `resourceType` matches.                   |
| `contextKeys`                                   | boolean context attributes the tracer lets you set.                                                                                            |
| `trafficMix`                                    | request shapes and their weights: the platform's ordinary authorization traffic. The denial rate at rest is the share of it that Cedar denies. |
| `scenarioRequests`                              | request shapes a scenario's flow can be tied to, by `id`.                                                                                      |

A decision made over a workspace's policies is still labelled `synthetic`. It
is Cedar's answer for the entities in the file, not an observation of a
running system.

Every request shape in the catalogue is evaluated by Cedar once, at start-up.
The simulation only looks the answers up, which is what keeps it deterministic
while every outcome stays Cedar's.

That makes a workspace a way to ask "what would this policy change do":
replace `cedar/policies.json`, and the denial rate at rest, the flows that
reach their resource and the policies named on every decision are the ones
the new set produces. Run `check-workspace` on both directories to compare the
share of traffic denied.

When a local cedar-agent is connected with `AEGIS_CEDAR_AGENT_SYNC=true`, what
is uploaded to it is the policies and entities the embedded engine was built
from, so the two engines hold the same set.

## What a workspace cannot do

- It is read once, before the server listens, from the one directory named in
  `AEGIS_WORKSPACE`. There is no route that uploads, lists or reloads files.
- It cannot make AEGIS contact anything. Scenarios have no effect that leaves
  the engine, and the `simulation` and `incidents` modules still perform no
  I/O.
- It cannot label anything `live` or `recording`, state a Cedar decision, or
  place an event that an engine or an importer did not produce.

How each of these is enforced is in [SECURITY.md](SECURITY.md).

What it does do is put its contents on the screen: the API returns the
topology, the scenario texts, the source of every policy and the catalogue to
whoever can reach it, and AEGIS has no authentication. If the files describe a
real system, keep the server on loopback or behind something that
authenticates.

## What is tested

`apps/server/tests/workspace.rs`:

- Exporting the bundled set and loading it back gives the same sources value
  for value, including every float of the generated 178-service topology, and
  a simulation whose state digest matches the bundled one.
- The repository's `fixtures/` directory loads as a workspace.
- `examples/corner-shop` builds; its two scenarios do what they describe, the
  flow Cedar denies stops at the authorizer with the policy Cedar named, and
  its recording replays both incidents.
- Replacing only the policies changes Cedar's answers, the denial rate at rest
  and whether a scenario's flow is stopped.
- A scenario with every effect at the edge of its range produces no figure
  that is not a number, on both bundled topologies.
- Each kind of mistake (malformed JSON, an unknown field, a number out of
  range, a cycle, a duplicate id, a forged recording, an oversized file, a
  policy that fails the schema) is refused with the file or the id it is in.

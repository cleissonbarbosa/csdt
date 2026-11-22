**English** · [Português](Arquivos-do-espaço-de-trabalho)

A workspace is a set of files in the formats below. The bundled platform in
[`fixtures/`](https://github.com/cleissonbarbosa/csdt/tree/main/fixtures)
uses the same layout, and so does
[`examples/corner-shop`](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop),
a complete workspace in six services that every example on this page is
taken from. How to bring the files in is on
[Your own platform](Your-own-platform).

## Layout

```text
<workspace>/
  workspace.json           optional format version; omitted means version 1
  topologies/*.json         the platforms on offer
  topologies/*.yml          … or a Compose file, read as one (see below)
                            (a .json that is a cloud inventory is read as one too)
  scenarios/*.json          incident scenarios
  recordings/*.json         prerecorded incidents
  cedar/policies.json       policies as a JSON list …
  cedar/*.cedar             … or in Cedar's own syntax (one form, not both)
  cedar/entities.json       the entity store
  cedar/catalog.json        what the request tracer offers and what traffic is made of
  cedar/schema.cedarschema  optional: validate policies and entities against it
```

- **A part that is present replaces the bundled one.** A `topologies/`
  directory means only your topologies are offered.
- **A part that is absent comes from the bundled set.**
- **Files are taken in file-name order.** The first topology is the one
  that opens, and scenarios are listed in that order, which is why the
  bundled ones are named `01-…`, `02-…`.
- Without a `recordings/` directory, a bundled recording is kept only while
  its topology and the scenarios it starts are still there.
- Anything else in the directory is left unread, and `check-workspace` lists
  it.

A Compose file (`.yml` or `.yaml`) and a cloud inventory are read as
topologies; see [Your own platform](Your-own-platform#a-compose-file) and
[Cloud inventories](Cloud-inventories). Limits: 4 MiB per file, 64 files of
one kind, 2 000 services and 20 000 connections per topology, 512 policies.

## Format version

New exports include `workspace.json`, which versions every format in the
directory together:

```json
{ "formatVersion": 1 }
```

A workspace without it is version 1. An unsupported version, a malformed
manifest or an unknown field in it is refused, with the file name, before
anything else is read. It is independent of the `schemaVersion` of the HTTP
contract.

## JSON Schemas for your editor

Self-contained JSON Schema Draft 7 documents in
[`schemas/v1/`](https://github.com/cleissonbarbosa/csdt/tree/main/schemas/v1)
describe version 1. They give your editor completion and structural checks,
including selectors, effect ranges and the commands and events a file may
declare, and validation needs no network.

| File                                   | Schema                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `workspace.json`                       | `workspace.schema.json`                                                  |
| a file saved with **Save as one file** | `bundle.schema.json`                                                     |
| `topologies/*.json`                    | `topology.schema.json`, or `inventory.schema.json` for a cloud inventory |
| `scenarios/*.json`                     | `scenario.schema.json`                                                   |
| `recordings/*.json`                    | `recording.schema.json`                                                  |
| `cedar/catalog.json`                   | `catalog.schema.json`                                                    |
| `cedar/policies.json`                  | `policies.schema.json`                                                   |

Associate them with your files in the editor's settings, so nothing is
added to the files themselves;
[schemas/README.md](https://github.com/cleissonbarbosa/csdt/blob/main/schemas/README.md)
shows how with VS Code's `json.schemas`. A schema checks one file: it does
not prove that the graph has no cycle, that ids are unique, that references
across files hold or that the Cedar files are valid. `check-workspace` does. The schemas are generated from the
Rust types with `pnpm workspace:schemas`, never edited by hand. Entities,
Cedar schemas and `.cedar` files keep Cedar's own formats.

## Topology

A topology describes a platform: its regions, its services (nodes) and the
connections between them (edges). This is
`examples/corner-shop/topologies/corner-shop.json`, trimmed to two of its
six services, one of its five connections and two of its roles:

```json
{
  "id": "corner-shop",
  "name": "Corner Shop",
  "description": "Fictional six-service platform: the smallest topology that uses every part of a workspace.",
  "dataSource": "synthetic",
  "regions": [
    { "id": "shop-floor", "name": "Shop floor", "kind": "cloud", "location": "Ground level" }
  ],
  "roles": { "partnerClient": "shoppers", "primaryGateway": "front-door" },
  "nodes": [
    {
      "id": "shoppers",
      "name": "Shoppers",
      "type": "external-client",
      "region": "shop-floor",
      "tier": 0,
      "baseLatencyMs": 0,
      "baseRps": 120,
      "description": "People at the counter."
    },
    {
      "id": "front-door",
      "name": "Front door",
      "type": "api-gateway",
      "region": "shop-floor",
      "tier": 1,
      "baseLatencyMs": 4,
      "description": "Everything comes in through here."
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

### Main fields

| Field                                                   | Meaning                                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataSource`                                            | Must be `synthetic`: the figures come from the simulation, whatever the platform.                                                                                            |
| `regions[].kind`                                        | `cloud`, or `edge` for a global edge drawn as the hub the regions stand around. A topology needs no edge region.                                                             |
| `nodes[].type`                                          | One of the seventeen kinds below. It decides the piece drawn and how the model treats the node.                                                                              |
| `nodes[].tier`                                          | How far along a request's path the service is, from 0. Used by the layout only.                                                                                              |
| `nodes[].baseLatencyMs`                                 | The service's own latency when idle.                                                                                                                                         |
| `nodes[].baseRps`                                       | For an `external-client`: the demand it generates. Every other load follows from the connections.                                                                            |
| `nodes[].capacityRps`, `headroom`                       | Optional. Without them, capacity is the node's load at nominal demand times a headroom that depends on its kind.                                                             |
| `nodes[].rateLimitRps`, `suspiciousFilter`, `autoscale` | Optional: [what a service does about load](Your-own-platform#what-a-service-does-about-load).                                                                                |
| `edges[].weight`                                        | Calls made on the connection per request the source handles.                                                                                                                 |
| `edges[].relationship`                                  | `route` (each request takes exactly one), `call`, `auth`, `authz`, `data` (all synchronous: a failure reaches the caller), `publish`, `consume`, `replication`, `telemetry`. |
| `edges[].criticality`                                   | Optional, 0 to 1: how strongly a failure of the target fails the caller. Defaults by relationship.                                                                           |
| `edges[].latencyMs`                                     | Optional network latency of the hop. Defaults to 1.2 ms inside a region and 60 ms across regions.                                                                            |
| `edges[].protocol`                                      | `https`, `grpc`, `amqp`, `sql`, `redis`, `s3`, `tcp` or `otlp`. Shown, not simulated.                                                                                        |

The constraints, each reported with the id involved: the graph is acyclic
(load is propagated in one pass, so two services that call each other are
described by the direction that carries the request); ids are 1 to 64
letters, digits, `-`, `_` or `.`, and unique; every connection joins two
declared nodes, every node sits in a declared region, and every role points
at a node or a region.

### Kinds of service

`external-client`, `network-gateway`, `load-balancer`, `api-gateway`,
`auth-service`, `cedar-authorizer`, `security-monitor`, `virtual-machine`,
`microservice`, `container`, `kubernetes-cluster`, `serverless`,
`message-queue`, `event-stream`, `database`, `cache`, `storage`. There are
seventeen because each has a modelled piece; a service of another kind is
filed under the nearest one.

### Roles

A role names a place in a topology. The bundled scenarios and the request
tracer use roles, not ids, which is what lets them run on any topology that
declares them.

| Role                             | Points at                                           | Used by                                                                |
| -------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `primaryGateway`                 | an API gateway                                      | request tracer, DDoS surge, credential stuffing, Cedar denial          |
| `primaryAuth`                    | an authentication service                           | request tracer, credential stuffing, Cedar denial                      |
| `primaryAuthorizer`              | a Cedar authorizer                                  | request tracer, credential stuffing, Cedar denial                      |
| `partnerClient`                  | an external client                                  | request tracer (where a request starts), Cedar denial                  |
| `resource:<EntityType>`          | a service or store                                  | request tracer: a request for `Order::"…"` ends at `resource:Order`    |
| `protectedResource`              | a service or store                                  | request tracer (when no `resource:` role matches), Cedar denial        |
| `edgeRouter`                     | the router of the global edge                       | DDoS surge, credential stuffing, Cedar denial, regional outage         |
| `attackSource`                   | an external client                                  | DDoS surge, credential stuffing                                        |
| `primaryDatabase`                | a database                                          | cascading failure                                                      |
| `securityMonitor`                | a threat monitor                                    | the node named on alerts the engine raises; all five bundled scenarios |
| `outageRegion`, `failoverRegion` | regions with an API gateway or a load balancer each | regional outage                                                        |

A topology without `primaryGateway`, `primaryAuth` and `primaryAuthorizer`
still evaluates requests; the tracer just has no path to draw, and says so.

## Scenario

A scenario changes numbers inside the model and announces events; no effect
reaches outside the engine. This is
`examples/corner-shop/scenarios/01-ledger-fire.json`, trimmed to the first
and last of its four phases:

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
      "name": "Smoke",
      "atMs": 0,
      "rampMs": 3000,
      "status": "active",
      "description": "Writes to the ledger slow down.",
      "effects": [{ "type": "latency", "nodes": "node:ledger", "factor": 8.0 }],
      "events": [
        {
          "delayMs": 2000,
          "severity": "warning",
          "kind": "alert",
          "title": "Ledger writes are slow",
          "message": "Sales take several times longer to record.",
          "nodes": ["node:ledger"]
        }
      ]
    },
    {
      "name": "Recovery",
      "atMs": 30000,
      "rampMs": 5000,
      "status": "recovering",
      "description": "The ledger is back to its usual size.",
      "effects": [],
      "events": []
    }
  ]
}
```

### Phases

- `category` is `availability`, `identity`, `authorization` or
  `resilience`; `severity` is `info`, `notice`, `warning` or `critical`.
  `durationMs` is at most 30 minutes, the history the timeline keeps.
- A phase lists **the complete set of effects that hold during it**.
  Anything it leaves out eases back to nominal over `rampMs`, so a last
  phase with no effects ends the scenario with the platform restored.
- Phases start at `atMs` from the beginning of the scenario: the first at 0,
  each at least one tick (200 ms) after the one before. `status` is
  `active`, `mitigating` or `recovering`.
- `targets` are the services listed as directly affected; `rootCause` is the
  one named as the cause.

### Selectors

| Selector             | Picks                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| `role:<name>`        | the node a topology role points at; works on any topology with that role |
| `node:<id>`          | a node by id; ties the scenario to topologies that have it               |
| `gatewayOf:<region>` | the API gateway of a region                                              |
| `region:<region>`    | every node of a region (only where a set of nodes is accepted)           |

A region is named by a role that points at it (`outageRegion`) or by its
own id. A scenario that names something a topology does not have is not an
error: it is listed as unavailable on that topology, and `check-workspace`
and the incident console say which name was missing.

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

A `factor` is between 0 and 1000; a `rate` or a `fraction` between 0 and 1.
`nodes` takes any selector, `node` and `at` a single-node one. `edges` is
`{ "between": { "from": "…", "to": "…" } }` for one connection or
`{ "inboundSync": "…" }` for every synchronous connection into a node; `edge`
and `onto` are `{ "from": "…", "to": "…" }`. `reason` is `waf`,
`rate-limit`, `auth-failure`, `session-revoked` or `policy-deny`.

### Flows

A flow is a stream of requests injected along an explicit route and drawn
as its own traffic: an attack, a probe, one principal's requests. This one
is from `examples/corner-shop/scenarios/02-receipt-snooping.json`:

```json
{
  "id": "other-receipts",
  "label": "Ana · another shop",
  "suspicious": true,
  "hops": [
    { "from": "role:partnerClient", "to": "role:primaryGateway" },
    { "from": "role:primaryGateway", "to": "role:primaryAuth" },
    { "from": "role:primaryGateway", "to": "role:primaryAuthorizer" },
    { "from": "role:primaryGateway", "to": "role:resource:Receipt", "via": "path" }
  ],
  "spill": false,
  "authz": { "request": "ana-reads-south", "authorizer": "role:primaryAuthorizer" }
}
```

- A hop is one existing connection or, with `"via": "path"`, the shortest
  synchronous path between two nodes.
- `"spill": true` lets what survives the last hop join that node's ordinary
  traffic, which is how a flood saturates what lies behind a gateway.
- A phase sets the flow's rate with `flowRate`: `{ "rps": 14 }`, or
  `{ "ofCapacity": { "node": "role:primaryGateway", "factor": 2.2 } }` so the
  same scenario overloads a small platform and a large one alike.
- `authz` ties the flow to a request of the catalogue's `scenarioRequests`.
  **The flow is stopped at the authorizer if and only if Cedar denied that
  request**, and the events it raises carry the policies Cedar named. A
  scenario cannot declare a denial.

### Events

An event is announced `delayMs` after its phase begins, with a `severity`, a
`title`, an optional `message` and the `nodes` it concerns. `kind` is
`alert`, `auth-failure`, `mitigation` or `reroute`; every other kind on the
timeline, such as a health change or an authorization decision, is the
engine's own.

A scenario can also be written in the interface, over the model: **Write a
scenario of your own**, under the scenarios in the incidents panel, opens
the platform editor on the platform in use at its **Incident** tab, beside
**Platform**. The phases lie on a strip where the timeline is: carry a phase
sideways to move its start, use the grip at the top of its slope to set
`rampMs`, and double-click one to cut it in two. An effect is carried from
the palette onto a service, a region's lane (every service of the region)
or a connection (`edges.between`), and is placed by role first, so the
scenario runs on any platform that has the role. A flow is drawn by
clicking the services it passes, one after another. The engine checks the
file as it is written; **Save the scenario** hands it over as it is, and
**Run it** imports it with the files in use and starts it. A `routeShift`,
a `flowReject` and a flow's `authz` have no control there: a scenario that
has them keeps those parts as written. See
[Incidents and time travel](Incidents-and-time-travel).

## Recording

A recording is a seed and the commands that were issued. Loading one
re-simulates it, identically every time. This is
`examples/corner-shop/recordings/a-bad-afternoon.json`:

```json
{
  "id": "a-bad-afternoon",
  "name": "A bad afternoon",
  "description": "Fictional recording: receipts are snooped on, and then the ledger catches fire.",
  "topologyId": "corner-shop",
  "seed": 1987,
  "durationMs": 110000,
  "commands": [
    { "atMs": 8000, "command": { "type": "startScenario", "scenarioId": "receipt-snooping" } },
    { "atMs": 56000, "command": { "type": "startScenario", "scenarioId": "ledger-fire" } }
  ]
}
```

A recording may start and stop scenarios (`startScenario`, `abortScenario`)
on a topology and with scenarios the workspace has. It may also place a
fault by hand with `injectFault`: one `effect`, written as in a phase, eased
in over `rampMs` (at most 60000). `clearFaults` lifts every fault or, with
an `effect`, only what that effect touches. Effects on a scenario's own flow
(`flowRate`, `flowReject`) are refused. A file cannot record an
authorization decision: every outcome is Cedar's. A session saved with
**Save or share this session** is a recording of the timeline in use, held
to the same rules, except that it may hold up to 512 commands, or none.

## Cedar

The embedded engine is the `cedar-policy` crate; the workspace decides what
it evaluates.

### Policies

Policies come in one of two forms, not both. **`cedar/policies.json`** is a
list of `{ "id", "description", "content" }`, the shape
[cedar-agent](https://github.com/cleissonbarbosa/cedar-agent) accepts on
`PUT /v1/policies` plus a description. This is the first entry of the
bundled list:

```json
[
  {
    "id": "tenant-view-orders",
    "description": "Any member of a tenant may view that tenant's orders.",
    "content": "permit(principal, action == Action::\"viewOrder\", resource) when { principal.tenant == resource.tenant };"
  }
]
```

**`cedar/*.cedar`** files are in Cedar's own syntax, read in file-name
order. A policy's id is its `@id("…")` annotation (or `<file>-<n>`, counting
from one) and its description its `@description("…")`. Policy templates are
refused. This is one of the three policies of
`examples/corner-shop/cedar/shop.cedar`:

```text
@id("same-shop")
@description("A clerk reads the receipts of their own shop.")
permit (principal, action == Action::"read", resource)
when { principal.shop == resource.shop };
```

### Entities, schema and catalogue

**`cedar/entities.json`** is the entity store, in the JSON form Cedar
reads. **`cedar/schema.cedarschema`**, when present, is a schema in Cedar's
schema syntax: the policies are validated against it in strict mode and the
entities are checked against it, and what the validator reports stops the
server from starting. Without it, a policy that reads an attribute nobody
has only shows as an evaluation error in a decision.

**`cedar/catalog.json`** is AEGIS' own file:

| Field                                           | Meaning                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`, `principals`, `actions`, `resources` | The choices in the request tracer, with their labels. A resource is offered for an action when their `resourceType` matches.                                                                                                                                                                                            |
| `contextKeys`                                   | Boolean context attributes the tracer lets you set.                                                                                                                                                                                                                                                                     |
| `trafficMix`                                    | Request shapes and their weights: the platform's ordinary authorization traffic. The denial rate at rest is the share Cedar denies. The policy editor draws it as a bar whose boundaries move share from one shape to the next, keeping the file's total ([Cedar policies](Cedar-policies#what-ordinary-traffic-asks)). |
| `scenarioRequests`                              | Request shapes a scenario's flow can be tied to, by `id`.                                                                                                                                                                                                                                                               |

Every request shape in the catalogue is evaluated by Cedar once, when the
files are loaded, and the simulation only looks the answers up: that keeps
it deterministic while every outcome stays Cedar's. A decision made over a
workspace's policies is still labelled `synthetic`. See
[Cedar policies](Cedar-policies).

## Reference

- [docs/WORKSPACE.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/WORKSPACE.md): every format, with its rules and what is tested
- [schemas/README.md](https://github.com/cleissonbarbosa/csdt/blob/main/schemas/README.md) and [schemas/v1/](https://github.com/cleissonbarbosa/csdt/tree/main/schemas/v1): the JSON Schemas
- [examples/corner-shop](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop): the example these excerpts come from
- [fixtures/](https://github.com/cleissonbarbosa/csdt/tree/main/fixtures): the bundled workspace
- [apps/server/src/workspace.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/workspace.rs), [apps/server/src/domain/topology.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/domain/topology.rs) and [apps/server/src/incidents/spec.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/incidents/spec.rs): the reader, the topology type and the scenario format

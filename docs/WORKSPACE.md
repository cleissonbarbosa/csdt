# Workspace

AEGIS ships with one fictional platform, five incidents and nine Cedar
policies. A **workspace** is a set of files that replaces any of them with
your own: a topology that describes a platform you care about, scenarios
written for it, and the Cedar policies you want to see evaluated. It is a
directory the server reads when it starts, or files you hand it
[from the interface](#from-the-interface) while it runs; nothing is
recompiled either way.

What it shows is still a simulation. A topology file describes a platform; the
load, latency, failures and authorization traffic on it are computed by the
engine and labelled `synthetic`, whatever the platform is. Nothing in a
workspace makes AEGIS observe a real system. An [incident
capture](CAPTURES.md), which shows a real incident, is not part of a
workspace: the browser reads it itself and never sends it to the server.

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

## From the interface

**Import or export files**, in the menu at the end of the top bar, does the
same without a restart.

- **Choose files**, **Choose a folder**, or drop either on the marked area.
  A folder is read as the layout below. A file on its own is recognised by
  what it
  holds: a topology by its `nodes` and `edges`, a scenario by its `phases`, a
  recording by its `commands`, a catalogue by its `trafficMix`, policies and
  entities by their first item, and `.cedar` and `.cedarschema` files by
  their extension.
- The files are checked as you add them. The dialog shows what applying them
  would give (the platforms, the scenarios, the share of ordinary requests
  Cedar would deny, any scenario that could not run and why) or the file a
  mistake is in and what it is. Nothing changes until **Apply**.
- Once the files are valid, **Compare with what is in use** asks what Cedar
  would decide differently under them: policies added, removed or changed
  in meaning, catalogued requests and scenario flows whose outcome changes,
  and every request the tracer can build that goes from allow to deny or
  back. It is [`diff-workspace`](#comparing-two-workspaces) with the files
  in use as the base, and applies nothing.
- Under it, **How would an incident go on each?** runs one scenario on the
  platform in use and on the one the files describe, and lays the two runs
  side by side. It is how a change of architecture is tried before it is
  applied: see [An incident on both platforms](#an-incident-on-both-platforms).
- An import is laid over **what the server was started with**, not over an
  earlier import: each kind of file you add replaces that part, and the rest
  stays. One scenario file is the whole list of scenarios. To add to what is
  on show instead, use **Start from the files in use**, which stages them
  for you to add to.
- **Save as one file** downloads everything in use as a single JSON document,
  a _bundle_. It can be dropped back on the dialog, and named wherever a
  directory is: `AEGIS_WORKSPACE=./aegis-workspace.json`, `check-workspace`,
  `diff-workspace`.
- An import lives in the server's memory. A restart, or **Return to what the
  server started with**, brings back the files it started with. To keep an
  import, save it and start the server with it.

There is one simulation, so applying an import starts a new timeline for
everyone connected. `AEGIS_IMPORT=off` switches importing off; the dialog then
only saves. The API behind it:

| Route                                     |                                                                |
| ----------------------------------------- | -------------------------------------------------------------- |
| `GET /api/v1/workspace`                   | where the files in use came from and what they amount to       |
| `GET /api/v1/workspace/export`            | the files in use, as a bundle                                  |
| `POST /api/v1/demo/workspace/check`       | what `{ "files": [{ "path", "text" }] }` would give; no change |
| `POST /api/v1/demo/workspace/diff`        | what Cedar would decide differently under them; no change      |
| `POST /api/v1/demo/experiments/platforms` | one scenario on the platform in use and on theirs; no change   |
| `POST /api/v1/demo/workspace/import`      | the same, applied; 422 with the file and reason if invalid     |
| `POST /api/v1/demo/workspace/reset`       | back to what the server started with                           |

## Layout

```text
<workspace>/
  workspace.json           optional format version; omitted means version 1
  topologies/*.json         the platforms on offer
  topologies/*.yml          … or a Compose file, read as one (see below)
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

## Format version and editor schemas

New exports include `workspace.json`:

```json
{ "formatVersion": 1 }
```

This versions all the file formats in the directory together. A workspace
without a manifest is version 1, so existing files still load. An unsupported
version, malformed manifest or unknown manifest field is rejected with the
file name before the contents are loaded. This version is independent of
the REST/WebSocket contract's `schemaVersion`.

The [published JSON Schemas](../schemas/README.md) cover the manifest,
the [bundle](../schemas/v1/bundle.schema.json),
[topology](../schemas/v1/topology.schema.json),
[scenario](../schemas/v1/scenario.schema.json),
[recording](../schemas/v1/recording.schema.json),
[authorization catalogue](../schemas/v1/catalog.schema.json) and
[policy list](../schemas/v1/policies.schema.json). They provide editor
completion and structural validation, including selectors, effect ranges and
the commands and events a file may declare. Entities and `.cedar` files
continue to use Cedar's own formats.

Schemas are generated from the Rust types with `pnpm workspace:schemas`.
Tests reject stale schemas and validate the bundled files and the example
against them. They are self-contained Draft 7 documents; validation needs no
network access. They do not prove graph acyclicity, uniqueness of ids,
cross-file references or Cedar validity: run `check-workspace` for those.

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
| `nodes[].rateLimitRps`            | Optional. The most requests a second the service admits; the rest are turned away at its door. See [What a service does about load](#what-a-service-does-about-load).        |
| `nodes[].suspiciousFilter`        | Optional, 0 to 1: the share of traffic a scenario marks as suspicious that the service turns away as it arrives.                                                             |
| `nodes[].autoscale`               | Optional `{ "maxFactor", "seconds" }`: capacity that follows the load.                                                                                                       |
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

### What a service does about load

Three optional fields say what a service does when more arrives than it was
built for. Each is a figure the file states and the model follows; none is
on unless the file gives it, and a platform that gives none runs exactly as
it did before these existed. An external client can have none of them.

```json
{ "id": "edge", "type": "network-gateway", "suspiciousFilter": 0.94, … },
{ "id": "gateway", "type": "api-gateway", "rateLimitRps": 2000,
  "autoscale": { "maxFactor": 3, "seconds": 20 }, … }
```

- **`rateLimitRps`** is a limit on everything that arrives, whoever sent it.
  Beyond it the service turns requests away at its door: they fail for the
  caller, fast, and use a twentieth of the capacity a request would. What
  it admits it handles as before, so it stays within its capacity and at
  its usual latency, and what is behind it is sent what it admits, not what
  arrives. It does not tell hostile traffic from ordinary traffic: under a
  flood it turns away callers in the same proportion. The connections into
  it are shown as throttled.
- **`suspiciousFilter`** is a filter that is always on: that share of any
  traffic a scenario injects and marks `suspicious` is turned away as it
  arrives, from the first request, with reason `waf`. It is the file saying
  how much of an attack the service recognises; the model does not work
  that share out. Ordinary traffic is not touched. The bundled DDoS surge
  begins to be filtered 36 seconds in, by the scenario's own phase; a
  platform that states the same filter takes it from the start, and
  comparing the two is how the cost of those 36 seconds is seen.
- **`autoscale`** lets capacity follow the load: the service aims at the
  capacity that would give its present load the headroom it has at rest,
  up to `maxFactor` times its capacity at rest (1 to 100), and closes about
  two thirds of the gap every `seconds` (1 to 3600). It shrinks back the
  same way. A load that rises faster than that is shed in the meantime,
  which is the point of stating the figure.

Where a service has more than one, traffic meets them in this order: the
filter, then the rate limit, then whatever a scenario's own phase rejects,
then capacity. A scenario's effects compose with them: `capacity ×0.5` on
an autoscaled service halves whatever size it has grown to.

### From a Compose file

A `docker-compose.yml` already says which services a platform has and which
of them need which. Put one in `topologies/` (or drop it on the import
dialog) and it is read as a topology:

| From the file                                   | In the topology                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| each service                                    | a node named after it                                                                                                                                    |
| its `image` (or, with none, its name)           | the node's type: `postgres`, `redis`… a database; `rabbitmq`, `kafka`… a queue; `nginx`, `traefik`… an API gateway; and so on. Anything else a container |
| `depends_on` and `links`, also through `<<: *x` | a connection from the service to what it needs                                                                                                           |
| `ports`                                         | a connection from `clients` to each service that publishes one; with none published, to each service nothing depends on                                  |
| the top-level `name`, or the file's name        | the platform's id and name                                                                                                                               |

What a Compose file does not say is how much traffic there is or how slow
anything is, and a topology has to. Those figures are the converter's own
defaults (100 requests a second from `clients`, a latency by type of
service) and the topology's description says so. Nothing is pulled, built or
run: the file is text. Treat the result as a first draft: import it, save it
as one file from the same dialog, and edit the figures and the roles.

The bundled scenarios ask for roles a Compose file may not have something
to be (`securityMonitor`, `primaryAuthorizer`…). The converter names the
ones it finds (the first API gateway, database, authentication service,
authorizer and monitor) and a scenario that still cannot run says which
role is missing. A file whose services depend on each other in a circle, or
on a service it does not declare, is refused with the reason; so is one
whose YAML nests more than 64 deep or whose aliases would write out to more
than 100 000 values.

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

A scenario can be written in a text editor, or in the interface: **Write a
scenario of your own**, under the scenarios in the incidents panel. The form
there writes this same file. Effects are placed by role first (so the
scenario runs on any platform that has the role), then by region or by
service; the engine checks the file as it is written, with everything else
in use, and says where it can run; **Save the file** hands it over as it is,
and **Add it and run it** imports it with the files in use and starts it.
Injected flows, and an effect between two named ends, are not in the form:
a scenario that has them is opened with those parts kept as written.

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
topology. Both `check-workspace` and the incident console say which name was
missing; the API carries the explanation in `unavailableReason`.

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
timeline, such as a health change or an authorization decision, are reserved
for the engine.

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
workspace has, and a command takes no field beyond the ones shown. Of the
timeline's other commands, one records an authorization decision; a file is
not allowed to put one there by saying so.

A recording may also place and lift faults by hand: one effect, written as
in a scenario phase, outside any scenario. Effects on a scenario's own flow
(`flowRate`, `flowReject`) are refused, and what a fault names must exist on
the recording's topology.

```json
{ "atMs": 4000, "command": { "type": "injectFault", "rampMs": 2000,
  "effect": { "type": "latency", "nodes": "node:till", "factor": 4 } } },
{ "atMs": 30000, "command": { "type": "clearFaults" } }
```

`clearFaults` lifts every fault, or with an `effect` only what that effect
touches. `rampMs` is at most 60000.

A **session** saved from the interface (**Save or share this session**) is a
recording of the timeline in use, with where the cursor was, how the model
was being looked at and, when the platform is not the bundled one, its files.
`GET /api/v1/session` writes the recording and `POST
/api/v1/demo/session/load` takes `{ "recording": …, "cursorMs": … }` back. It
is held to the rules above, with two differences: it may hold up to 512
commands, and it may hold none (time simply passed). The export omits
on-demand Cedar decisions and counts them. A comparison of an intervention (`POST
/api/v1/demo/experiments/compare`) returns its two runs as recordings too.

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
the new set produces. [Comparing two workspaces](#comparing-two-workspaces)
lists exactly what differs.

When a local cedar-agent is connected with `AEGIS_CEDAR_AGENT_SYNC=true`, what
is uploaded to it is the policies and entities the embedded engine was built
from, so the two engines hold the same set.

## Comparing two workspaces

`diff-workspace` builds two workspaces the way start-up would and reports what
Cedar decides differently under the second. It is the question to ask of a
policy change before merging it.

```bash
aegis-server diff-workspace <base> <candidate> [--json] [--exit-code]
```

Either side can be `@bundled`, the set compiled into the binary. This is the
bundled platform with the `finance-view-ledger` policy removed:

```text
base       @bundled
candidate  candidate

Policies
  removed  finance-view-ledger

Simulated traffic
  denied at rest  7.0 % -> 15.0 %
  15 catalogue requests compared, 2 decided differently
  allow -> deny  alice-view-ledger (traffic mix)  User::"alice" Action::"viewLedger" Ledger::"acme-ledger-2026"
                 was permitted by finance-view-ledger; now denied by default
  allow -> deny  alice-view-ledger (scenario request)  User::"alice" Action::"viewLedger" Ledger::"acme-ledger-2026"
                 was permitted by finance-view-ledger; now denied by default

Scenario flows
  cedar-denial / Alice · viewLedger on helios-commerce: reaches its resource -> stops at the authorizer
  cedar-denial / Alice · viewLedger on hyperscale-stress: reaches its resource -> stops at the authorizer

Access matrix
  6 principals, 6 actions, 7 resources, 9 contexts: 756 requests compared
  9 allow -> deny, 0 deny -> allow, 0 decided the same for a different reason
  allow -> deny  User::"alice" Action::"viewLedger" Ledger::"acme-ledger-2026"  in every context
                 was permitted by finance-view-ledger; now denied by default

Decisions differ.
```

- **Policies** are compared by meaning: Cedar's parsed form without
  annotations. Reformatting a policy, moving it from `policies.json` to a
  `.cedar` file or adding an `@description` is not a change.
- **Simulated traffic** is the catalogue's request shapes, with the share of
  ordinary traffic denied on each side. A request listed without an arrow kept
  its decision but is now determined by other policies.
- **Scenario flows** are the flows tied to a catalogue request: stopped at the
  authorizer on one side and let through on the other. A scenario that can run
  on only one side is listed with the reason.
- **Access matrix** is every principal, action and resource the candidate's
  catalogue lets the request tracer build, with every context key absent,
  false and true, evaluated by both engines. A change is described by the
  context keys it depends on (`with mfa absent; mfa=false`). At most 20 000
  requests are compared: beyond that only the empty context is tried, and the
  report says so.

Everything above is Cedar's answer on each side; the command only compares.
It covers what the catalogue names, so a request nobody listed is not
compared.

`--json` writes the full comparison, including every matrix change and the
contexts of each, for other tools. Exit status follows `diff`: 0 normally; 1
with `--exit-code` when a decision differs (a request, a flow or the share
denied at rest, not a policy rewritten to the same effect); 2 when a side
cannot be built. In a pipeline that makes "this refactor changes no decision"
a check:

```bash
aegis-server diff-workspace ./main-policies ./branch-policies --exit-code
```

## An incident on both platforms

A capacity, a service or a connection that would have made an incident go
differently is a change to a topology file. The interface tries one before
it is applied: stage the changed files in **Import or export files** (**Save
as one file** gives you the ones in use to edit), choose a scenario under
**How would an incident go on each?** and press **Run both**. The engine
runs the scenario twice, on timelines of its own and from the same seed:
once on the platform in use (run A) and once on the platform the files
describe (run B). Nothing is applied and the timeline in use is not touched.

The answer has four parts.

- **What differs** is what the two descriptions state differently, matched
  by id and written as each file wrote it: services, connections and regions
  added, removed or described differently (`capacityRps` not stated → 7300),
  and roles that name something else.
- **What follows without being stated** is the part to read before the
  figures. A service whose file states no `capacityRps` is sized from its
  load at rest, so adding a caller gives it more capacity without any file
  saying so; each such service is listed with both figures. And a scenario
  is one file, but it can prescribe something else on the other platform: a
  role may name another service there, and a rate written as a share of a
  service's capacity (`"rate": { "ofCapacity": … }`) is another rate where
  that capacity is another. The bundled DDoS surge is written as 2.2 times
  what the gateway can take, so a gateway three times the size is sent three
  times the flood, and the answer says so, phase by phase. To put the same
  attack to both platforms, write its rate in requests a second
  (`"rate": { "rps": 5400 }`).
- **The two runs**, figure by figure and over time: highest and mean error
  rate, highest latency, services affected, how long each objective was not
  met, when everything was back to normal, and the services only one run
  affected. The latency objective is a multiple of each platform's own
  latency at rest, so where the two differ each run states its own.
- **Watch run A** puts the run in use on the timeline. **Apply these files
  and watch run B** applies the files, as **Apply** does, and puts run B on
  the timeline of the platform they describe, to follow on the model.

Two runs do not say which difference an outcome follows from, and AEGIS does
not say it for them. To see what one change does, change that one alone.

The same comparison runs from a terminal, for a pipeline or a review:

```bash
aegis-server compare-incident <base> <candidate> <scenario> [--topology=<id>] [--seed=<n>] [--json]
```

Either side is a workspace directory, a bundle file or `@bundled`. It prints
what differs, what follows without being stated and the two runs side by
side, or the whole answer with `--json`; it exits 2 when the comparison
cannot be run.

The scenario has to be the same incident on both sides: in use, among the
files, written the same in both and able to run on each platform. Staging
only a topology keeps the scenarios the server was started with, so after an
import of scenarios of your own, start from **Start from the files in use**.
When the files describe several platforms, run B is on the one with the id
in use, or the one they open on, unless another is chosen.

```http
POST /api/v1/demo/experiments/platforms
{ "files": [{ "path": "topologies/shop.json", "text": "…" }], "scenarioId": "ddos-surge", "topologyId": "shop" }
```

`topologyId` is optional. The answer holds both runs, each with the
recording that reproduces it, `changes` (what differs), `prescribed` (the
phases the scenario resolves differently) and `decisionsChanged` (whether
Cedar answers the simulation differently under the files). The files are
built exactly as an import builds them and are bounded the same way; with
`AEGIS_IMPORT=off` the route answers 403.

## Where the platform gives

**⋯ → Find where the platform gives** asks two things of the platform in
use, at rest. Both are runs of the engine on timelines of their own, and the
timeline in use is not touched.

- **How much traffic it takes.** The demand of every external client is
  multiplied by the same figure and held for a minute, at ×1.25, ×1.5, ×2,
  ×3, ×4, ×6, ×8, ×12 and ×16, stopping at the first figure at which an
  objective is missed; the gap between that one and the last that held is
  then halved five times. The answer is those two figures, the objective
  that was missed, the first service to leave its normal state (which can
  be well before any objective is missed), and a row for every figure
  tried. Nothing is said of the figures between two rows.
- **What each service takes with it.** Every service is made unreachable in
  turn, exactly as **Try one first** on its card does, and the others that
  left their normal state are counted. The one that takes the most with it
  is first. A platform of more than 250 services is not ranked.

```http
POST /api/v1/demo/experiments/headroom      {}
POST /api/v1/demo/experiments/weak-points   {}
```

## What a workspace cannot do

- It cannot make the server open anything. A directory is read once, before
  the server listens, from the one place named in `AEGIS_WORKSPACE`. An import
  carries the text of its files; the paths in it only say which part each
  file belongs to, and nothing is written to disk.
- It cannot make AEGIS contact anything. Scenarios have no effect that leaves
  the engine, and the `simulation` and `incidents` modules still perform no
  I/O.
- It cannot label anything `live` or `recording`, state a Cedar decision, or
  place an event the engine did not produce.

How each of these is enforced is in [SECURITY.md](SECURITY.md).

What it does do is put its contents on the screen: the API returns the
topology, the scenario texts, the source of every policy and the catalogue to
whoever can reach it, and AEGIS has no authentication. The same people can
import, which replaces what everyone connected sees. If the files describe a
real system, or the server is shared, keep it on loopback or behind something
that authenticates, and set `AEGIS_IMPORT=off` where nobody should replace
what is on show.

## What is tested

`apps/server/tests/workspace.rs`:

- Exporting the bundled set and loading it back gives the same sources value
  for value, including every float of the generated 178-service topology, and
  a simulation whose state digest matches the bundled one.
- The repository's `fixtures/` directory loads as a workspace.
- Missing manifests remain compatible; unsupported versions are rejected.
- Published schemas match the Rust file types; the API exposes the specific
  resolution failure for each unavailable scenario.
- `examples/corner-shop` builds; its two scenarios do what they describe, the
  flow Cedar denies stops at the authorizer with the policy Cedar named, and
  its recording replays both incidents.
- Replacing only the policies changes Cedar's answers, the denial rate at rest
  and whether a scenario's flow is stopped.
- A scenario with every effect at the edge of its range produces no figure
  that is not a number, on both bundled topologies.
- Importing (`apps/server/tests/import.rs`): the files of a directory held in
  memory give what the directory gives, with or without their folders; what
  is exported reads back as the same sources, file by file and as one bundle;
  a check applies nothing and names the file a mistake is in; an import
  replaces what runs, decisions then come from the imported policies, and a
  reset brings back what the server started with; an import over a start-up
  workspace is laid over that workspace; the routes answer 403 when importing
  is off, and keep their size limits. An end-to-end test imports the example
  through the file chooser, runs its incident and puts the bundled platform
  back, and CI's container job imports a bundle of a few hundred kilobytes
  through the reverse proxy.
- Comparing (`apps/server/tests/diff.rs`): identical sources differ in
  nothing; removing a permit lists the request, the flows and the matrix
  entries it decided; a change that depends on context names the contexts;
  the bundled policies rewritten in Cedar syntax with annotations are no
  change; unrelated workspaces compare without a shared request; and the
  command's report, JSON and exit statuses are checked through the binary.
- What a service does about load (`apps/server/tests/mitigations.rs`): a
  rate limit keeps the gateway within its capacity and spares what is behind
  it while callers are turned away with the flood; a filter that is always
  on takes the flood from the first request and nothing at rest; an
  autoscaled service grows to what its load asks for, never past its limit,
  and shrinks back; a platform with all three seeks and replays to the same
  state digest; a figure out of range, or any of the three on a client, is
  refused with the service. The contract samples of the bundled platform do
  not change with any of it.
- Where the platform gives (`apps/server/tests/limits.rs`): the two figures
  of the headroom are among the runs listed and nothing tried lies between
  them; every service is taken out once and each row is what a trial of
  that service gives.
- An incident on both platforms (`apps/server/tests/platforms.rs`): the files
  in use compared with themselves give one run twice and no difference; a
  changed field is reported as the file wrote it, an added service with the
  capacities that follow from it, and a flood sized from capacity as another
  flood; the run on the files is the run seen once they are applied; what
  cannot be the same incident on both sides is refused with the reason; and
  nothing is applied or placed on the timeline. An end-to-end test stages a
  changed platform, runs both and watches run B.
- Each kind of mistake (malformed JSON, an unknown field, a number out of
  range, a cycle, a duplicate id, a forged recording, an oversized file, a
  policy that fails the schema) is refused with the file or the id it is in.

**English** · [Português](API-HTTP-e-stream)

The server answers JSON over HTTP under `/api/v1` and streams telemetry over
one WebSocket, `/api/v1/stream`. The interface uses nothing else, and the
engine in the browser serves the same routes. This page lists every route as
`route_table()` in
[`apps/server/src/api/mod.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/mod.rs)
declares it.

## Conventions

- **Base path** `/api/v1`. JSON throughout, with camelCase field names.
  Contract version `1.0` (`schemaVersion`), stream protocol version `1`
  (`protocolVersion`).
- **Methods** `GET` and `POST` only. A `POST` body is JSON sent with
  `Content-Type: application/json`, and it is read into a type that rejects
  unknown fields.
- **Identifiers** in a path, a query or an id field are 1 to 128 characters:
  letters, digits and `-`, `_`, `:`, `.`, `>`.
- **Unknown routes** answer 404 `not_found`.
- **Where it listens.** In development the server is on `127.0.0.1:8787`
  (`AEGIS_BIND`), and Vite proxies `/api` to it, so the browser only talks to
  its own origin.

```bash
curl -fsS http://127.0.0.1:8787/api/v1/health
curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"scenarioId":"ddos-surge"}' \
  http://127.0.0.1:8787/api/v1/demo/scenarios/start
```

The simulation is shared: a mutation changes what everyone connected sees.

## Routes

Paths are relative to `/api/v1`. A body field written with `?` may be left
out.

### Platform and history

| Method | Path                     | What it does                                                                                                                      |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                | Server version, schema and protocol versions, uptime, the active topology, the current tick and the authorization engine          |
| GET    | `/topology`              | The topology in use: its nodes and edges                                                                                          |
| GET    | `/topologies`            | The topologies on offer and the active one (`activeId`)                                                                           |
| GET    | `/metrics`               | The platform's current metrics and their history                                                                                  |
| GET    | `/events`                | Timeline events. Query: `afterSeq` (default 0), `limit` (default 200, clamped to 1–1000; the newest win), `nodeId`, `minSeverity` |
| GET    | `/incidents`             | The incidents of the timeline in use                                                                                              |
| GET    | `/incidents/{id}/report` | One incident read back from its record; 404 for an unknown one or one older than the history kept                                 |
| GET    | `/scenarios`             | The scenarios, with `unavailableReason` on one the topology in use cannot run, and the active scenario id                         |
| GET    | `/recordings`            | The recorded incidents that can be loaded                                                                                         |

### Simulation control

Each answers `{"playback": …}`, the playback state after the command.

| Method | Path                     | What it does                                                                                                                                                                                        |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/demo/scenarios/start`  | Starts a scenario: `{scenarioId}`. 409 when it is not available on the topology in use                                                                                                              |
| POST   | `/demo/scenarios/reset`  | With an empty body, starts the whole simulation over from tick 0; `{"scope":"scenario"}` only stops the running scenario and keeps history                                                          |
| POST   | `/demo/faults/inject`    | Places a fault by hand: `{effect, rampMs?}`, one effect in the format a scenario phase writes it                                                                                                    |
| POST   | `/demo/faults/clear`     | Lifts the faults `effect` touches, or every fault with `{}`                                                                                                                                         |
| POST   | `/demo/playback/control` | `{action}`: `play`, `pause`, `step`, `seek` (with `toMs`), `setSpeed` (with `speed`: `0.5`, `1`, `2` or `4`), `replay` (back to the start of the latest incident), `live` (to the simulation's now) |
| POST   | `/demo/topology/select`  | Switches the topology: `{topologyId}`                                                                                                                                                               |
| POST   | `/demo/recordings/load`  | Loads a recording and simulates it again: `{recordingId}`                                                                                                                                           |

Each playback action takes exactly the parameters it needs: `seek` with
anything but `toMs`, or `play` with a `speed`, is refused with 400. The name
`live` is the contract's; the interface calls that moment the simulation's
now.

### Sessions and experiments

None of the five experiments touches the timeline in use: each runs on
timelines of its own, from the server's seed.

| Method | Path                            | What it does                                                                                                                            |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/session`                      | The timeline in use as a seed and a command list: what reproduces it. Decisions are left out and counted                                |
| POST   | `/demo/session/load`            | Replaces the timeline with the one a session describes, simulated again: `{recording, cursorMs?}`. With a cursor it waits there, paused |
| POST   | `/demo/experiments/compare`     | One scenario twice, the second time with one fault placed: `{scenarioId, intervention: {effect, atMs, rampMs?}}`                        |
| POST   | `/demo/experiments/trial`       | One fault on the platform at rest: `{effect, rampMs?}`. Which services left normal, in order, and how far the figures went              |
| POST   | `/demo/experiments/headroom`    | How many times its ordinary demand the platform in use takes before an objective is missed. Body `{}`                                   |
| POST   | `/demo/experiments/weak-points` | Every service taken out in turn, with what left normal each time. Body `{}`                                                             |
| POST   | `/demo/experiments/platforms`   | One scenario on the platform in use and on the one uploaded files describe: `{files, scenarioId, topologyId?}`                          |

### Workspace

A file is `{"path", "text"}`; [Workspace files](Workspace-files) describes
the formats.

| Method | Path                      | What it does                                                                                                                                         |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/workspace`              | What is in use: the parts replaced, the topologies, scenario and recording ids, the number of policies, and whether importing is on                  |
| GET    | `/workspace/export`       | The files in use as one bundle, to save, edit and import again                                                                                       |
| POST   | `/demo/workspace/check`   | What applying `{files}` would give, or what is wrong with them, with a survey of each cloud inventory among them (`inventories`). Nothing is applied |
| POST   | `/demo/workspace/import`  | Replaces the topologies, scenarios and policies in use with `{files}`, held in memory only                                                           |
| POST   | `/demo/workspace/diff`    | What Cedar would decide differently under `{files}`: `decisionsChanged` and the `diff`. Nothing is applied                                           |
| POST   | `/demo/workspace/preview` | One platform of `{files, topologyId?}` at rest, on a timeline of its own. Nothing is applied                                                         |
| POST   | `/demo/workspace/reset`   | Returns to what the server was started with                                                                                                          |

### Authorization

| Method | Path                            | What it does                                                                                                                                                       |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/demo/authorization/catalog`   | The engines and their availability, the policies, tenants, principals, actions, resources and context keys, and the share of baseline traffic Cedar denies         |
| GET    | `/demo/authorization/decisions` | The decisions on the timeline                                                                                                                                      |
| POST   | `/demo/authorization/evaluate`  | Evaluates one request and records it: `{principal, action, resource, context?, disabledPolicies?, engine?}`; `engine` is `embedded` (the default) or `cedar-agent` |
| POST   | `/demo/authorization/explain`   | One request, policy by policy, asked of the embedded engine: `{principal, action, resource, context?, disabledPolicies?}`. Recorded nowhere                        |
| POST   | `/demo/authorization/matrix`    | Every request the catalogue describes, under one context: `{context?, disabledPolicies?}`. Recorded nowhere                                                        |

With `cedar-agent`, `disabledPolicies` is refused: the agent's own policy
store decides. See [Cedar policies](Cedar-policies) and
[Integrations](Integrations).

### Integrations and the stream

| Method | Path                         | What it does                                                    |
| ------ | ---------------------------- | --------------------------------------------------------------- |
| GET    | `/providers`                 | Each provider and its status                                    |
| POST   | `/providers/{id}/connect`    | Connects a configured integration; answers the list of statuses |
| POST   | `/providers/{id}/disconnect` | Disconnects it; answers the list of statuses                    |
| WS     | `/stream`                    | Telemetry and events (on the server only; see below)            |

## Limits

| What                                | Limit                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Request body                        | 16 KiB; 8 MiB for `check`, `import`, `diff`, `preview` and `platforms`; 256 KiB for a session |
| Rate of `GET` requests              | Per client: a burst of 240, refilling at 120 per second                                       |
| Rate of every other request         | Per client: a burst of 40, refilling at 8 per second                                          |
| Request time                        | 10 s, then 408                                                                                |
| Events per `GET /events`            | 1000                                                                                          |
| Policies switched off in a question | 32                                                                                            |
| Stream subscribers at once          | 64                                                                                            |

Over the rate, the answer is 429 `rate_limited` with a `Retry-After` header.
With `AEGIS_IMPORT=off`, the routes that take files or restore them (`check`,
`import`, `diff`, `preview`, `platforms` and `workspace/reset`) answer 403
`import_disabled`. The response headers and the rest of the hardening are on
[Security model](Security-model).

## Errors

Every handler answers an error in one shape:

```json
{ "error": { "code": "not_found", "message": "no such route" } }
```

| Status | Code                                                                                          | When                                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`                                                                             | A malformed body, query or path, an invalid id, a playback action with the wrong parameters, an unsupported speed, too many policies switched off, an invalid Cedar request |
| 413    | `invalid_request`                                                                             | A body over its limit                                                                                                                                                       |
| 415    | `invalid_request`                                                                             | A body that is not sent as JSON                                                                                                                                             |
| 403    | `import_disabled`, `origin_not_allowed`                                                       | Importing is switched off; the stream was opened from an origin not allowed                                                                                                 |
| 404    | `not_found`                                                                                   | An unknown route, scenario, topology, recording, incident or provider                                                                                                       |
| 409    | `conflict`                                                                                    | A scenario unavailable on the topology in use, no scenario running, or the files in use replaced meanwhile                                                                  |
| 409    | `too_many_faults`, `not_configured`, `unsupported`                                            | Too many faults in force; an integration not configured, or unable to do this                                                                                               |
| 422    | `invalid_workspace`                                                                           | The files are not a valid workspace; the message names the file                                                                                                             |
| 422    | `invalid_fault`, `invalid_session`, `invalid_experiment`, `invalid_preview`, `target_refused` | What was asked cannot be placed or run; an integration's target is refused                                                                                                  |
| 429    | `rate_limited`                                                                                | Over the per-client rate                                                                                                                                                    |
| 500    | `internal`                                                                                    | Work that could not complete                                                                                                                                                |
| 502    | `engine_error`, `target_unreachable`, `target_protocol`                                       | `cedar-agent` or an integration's target answered wrongly or not at all                                                                                                     |
| 503    | `engine_unavailable`, `too_many_streams`                                                      | The authorization engine asked for is not available; 64 subscribers already                                                                                                 |

## The stream

Open a WebSocket on `/api/v1/stream`. The server sends `hello`, then a
`snapshot`, and from then on every message is a JSON object tagged by `type`.

| Message    | Fields                                                       | Sent                                                                                                                |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `hello`    | `protocolVersion`, `schemaVersion`, `topologyId`, `playback` | First                                                                                                               |
| `snapshot` | `data`: the telemetry snapshot                               | After `hello`; whenever the simulation advanced; every 2 s while paused; after `timeline` and `lagged`              |
| `events`   | `data`: the new events                                       | When the simulation produces events, and in answer to `resync`                                                      |
| `timeline` | `reason`, `playback`                                         | History changed shape (`reset`, `branch`, `seek`, `topology`, `recording`, `workspace`): fetch the REST state again |
| `lagged`   | `dropped`                                                    | The subscriber fell behind; a fresh snapshot follows                                                                |
| `pong`     | `t`                                                          | In answer to `ping`                                                                                                 |

The client may send two messages:

| Message  | Shape                              | Answer                                                                        |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| `ping`   | `{"type":"ping","t":<number>}`     | `pong` with the same `t`, which must be a finite number                       |
| `resync` | `{"type":"resync","afterSeq":<n>}` | `events` after that sequence number, at most 500; nothing when there are none |

- **Columnar snapshots.** Per-node and per-edge metrics are arrays aligned
  index for index with the topology: compact on the wire, and copied straight
  into the typed arrays the renderer uses.
- **Backpressure.** Each message is serialised once and fanned out through
  one bounded buffer of 256 messages. A subscriber that falls behind does not
  slow the simulation: it receives `lagged` and a fresh snapshot, and can ask
  for the missed events with `resync`. Events carry gapless sequence numbers,
  so a client always knows what it has.
- **Bounds.** A client message is at most 1 KiB, and at most 20 arrive per
  second; more closes the socket, and so do more than 8 malformed messages
  (a binary frame counts as one). A socket blocked for 5 s on a send is
  disconnected.
- **Origin.** Browsers do not apply CORS to a WebSocket, so the handshake
  checks `Origin` against `AEGIS_ALLOWED_ORIGINS`. A client that sends no
  `Origin`, which is not a browser, is let in.

## In the static site

The engine compiled to WebAssembly serves `api::offline_router`: the same
`route_table()`, with the same body limits, and without the rate limits, the
origin check or a `/stream` route. A request is a function call
(`aegis_request`), and the stream is what each call hands back:
`aegis_open` gives `hello` and a snapshot, `aegis_advance` the messages time
produced, and `aegis_message` answers `ping` and `resync` with
`api::protocol::answer`, the same function the WebSocket handler calls. A
page that falls behind receives `lagged` and a fresh snapshot, as on the
server. Before the engine has started, a request is answered 503
`not_ready`.

The provider list is the one deliberate difference between the two. A new
route goes into `route_table()`, so both builds serve it, and into the list
in `apps/web/src/engine/parity.spec.ts`, which calls every route in the built
module. [Architecture](Architecture#the-engine-in-the-browser) describes the
boundary.

## Examples

`packages/contracts/samples/` holds real answers, written by the server as
it runs a fixed scenario; the contract tests hold the zod schemas to them.

| Route or message                     | Sample                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                        | [`health.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/health.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /topology`                      | [`topology.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/topology.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /events`                        | [`events.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/events.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /incidents/{id}/report`         | [`incident-report.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/incident-report.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /scenarios`                     | [`scenarios.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/scenarios.json), [`scenarios-unavailable.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/scenarios-unavailable.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /demo/scenarios/start`         | [`control-response.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/control-response.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /demo/authorization/evaluate`  | [`decision-allow.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/decision-allow.json), [`decision-deny.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/decision-deny.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /demo/authorization/explain`   | [`authorization-explanation.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/authorization-explanation.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /demo/authorization/matrix`    | [`access-matrix.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/access-matrix.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /session`                       | [`session.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/session.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /demo/experiments/compare`     | [`experiment.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/experiment.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /demo/experiments/trial`       | [`trial.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/trial.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /demo/experiments/headroom`    | [`headroom.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/headroom.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /demo/experiments/weak-points` | [`weak-points.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/weak-points.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /demo/experiments/platforms`   | [`platform-comparison.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/platform-comparison.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /demo/workspace/check`         | [`workspace-check.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-check.json), [`workspace-check-invalid.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-check-invalid.json), [`workspace-check-inventory.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-check-inventory.json)                                                                                                                                                                                                                                                                                                                              |
| `POST /demo/workspace/diff`          | [`workspace-diff.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-diff.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /demo/workspace/preview`       | [`workspace-preview.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-preview.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /demo/workspace/import`        | [`workspace-response.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-response.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Stream messages                      | [`stream-hello.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-hello.json), [`stream-snapshot.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-snapshot.json), [`stream-events.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-events.json), [`stream-timeline.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-timeline.json), [`stream-lagged.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-lagged.json), [`stream-pong.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-pong.json) |

The sample of a trial was produced by this body, which makes the bundled
platform's Orders DB unreachable (`down`), ramped in over 1000 ms:

```json
{ "effect": { "type": "down", "nodes": "node:use-orders-db" }, "rampMs": 1000 }
```

## Reference

- [`docs/ARCHITECTURE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/ARCHITECTURE.md): "The API", "Stream protocol", "The engine in the browser"
- [`docs/SECURITY.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/SECURITY.md): "Server", "Sessions, comparisons and reports"
- [`apps/server/src/api/mod.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/mod.rs): `route_table()`, body limits, rate limits, headers
- [`apps/server/src/api/routes.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/routes.rs): every handler and its body
- [`apps/server/src/api/error.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/error.rs): the error shape and codes
- [`apps/server/src/api/ws.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/ws.rs) and
  [`apps/server/src/api/protocol.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/protocol.rs): the stream
- [`apps/wasm/src/lib.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/wasm/src/lib.rs): the same routes in the browser
- [`packages/contracts/src/index.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/src/index.ts) and
  [`packages/contracts/samples/`](https://github.com/cleissonbarbosa/csdt/tree/main/packages/contracts/samples)

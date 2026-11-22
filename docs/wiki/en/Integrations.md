**English** · [Português](Integrações)

AEGIS runs complete without any integration: **Demo Mode** is the
deterministic simulation built into the server, and needs nothing else.
Integrations are optional adapters for public personal projects, each
written against an interface read in its repository, and each says plainly
what kind of data it contributes.

| Label       | Meaning                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `synthetic` | Produced by the AEGIS simulation engine                                                                                                   |
| `recording` | An [incident capture](Incident-captures), read in the browser. Not produced by the simulation, never labelled live, never on its timeline |
| `live`      | Measured from an explicitly connected **local** instance                                                                                  |

The label travels with the data (`dataSource` on topologies, events,
decisions and provider statuses) and is shown next to it in the interface.

## Scope

- **Only public repositories owned by the GitHub user `cleissonbarbosa`**
  were considered. They were listed with the unauthenticated public API;
  no token, `gh` session or SSH key was involved.
- **Each was checked before its source was read:** the owner is
  `cleissonbarbosa`, the repository is not private and its visibility is
  public. No private or organisation repository was listed, opened or
  cloned.
- **No source is copied.** The adapters were written from scratch against
  the interfaces described below.

| Repository                                                                                                                                              | What it exposes                                          | Decision                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| [`cedar-agent`](https://github.com/cleissonbarbosa/cedar-agent)                                                                                         | HTTP API: policy store, data store, `is_authorized`      | **Live adapter**, verified against a locally built agent |
| [`rinha-backend-2026`](https://github.com/cleissonbarbosa/rinha-backend-2026) and [`-rust`](https://github.com/cleissonbarbosa/rinha-backend-2026-rust) | `GET /ready`, `POST /fraud-score` behind a load balancer | **Live adapter**, read-only readiness probe              |
| [`ferrousDB`](https://github.com/cleissonbarbosa/ferrousDB)                                                                                             | Rust library, REPL and desktop GUI                       | **Not integrated**                                       |

Other public repositories of the account have no bearing on cloud security
observability and were not considered further.

## Connecting an integration

An integration is opt-in twice: it must be configured on the server, and you
must press **Connect** in the interface. Configuration alone contacts
nothing.

1. Set the adapter's variable on the server and restart it.
2. Open **Integrations** from the note in the top bar that says the data is
   simulated (**Simulated, synthetic data**, or **Simulated** on a narrower
   screen), or with the command **Open integrations** in the command
   palette.
3. Press **Connect** on the adapter's card. Each card shows its state, the
   repository, the interface it was verified against and its target without
   credentials. **Disconnect** stops it.

| Variable                          | What it does                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `AEGIS_CEDAR_AGENT_URL`           | A local cedar-agent, for example `http://127.0.0.1:8180`                                       |
| `AEGIS_CEDAR_AGENT_TOKEN`         | Optional: the token the agent was started with (`--authentication`); it stays on the server    |
| `AEGIS_CEDAR_AGENT_SYNC`          | `true` also uploads AEGIS's policies and entities on connect, **replacing** the agent's stores |
| `AEGIS_RINHA_URL`                 | A local rinha-backend stack, for example `http://127.0.0.1:9999`                               |
| `AEGIS_RINHA_PROBE_SECONDS`       | Optional: seconds between readiness probes; 2 by default, at least 1, at most 3600             |
| `AEGIS_INTEGRATION_ALLOWED_HOSTS` | Extra host names, separated by commas, allowed as targets (for example a Compose service name) |

`docker-compose.yml` passes these variables through to the server
container, all but `AEGIS_RINHA_PROBE_SECONDS`, and
[`.env.example`](https://github.com/cleissonbarbosa/csdt/blob/main/.env.example)
describes each.

## cedar-agent

`apps/server/src/integrations/cedar_agent.rs` evaluates authorization
requests with a local [cedar-agent](https://github.com/cleissonbarbosa/cedar-agent)
instead of the embedded engine.

| Request                  | Used by AEGIS for                     |
| ------------------------ | ------------------------------------- |
| `GET /v1/` → `204`       | Health check on connect               |
| `GET /v1/policies`       | Counting the policies the agent holds |
| `PUT /v1/policies`       | Optional sync of AEGIS's policies     |
| `PUT /v1/data`           | Optional sync of AEGIS's entities     |
| `POST /v1/is_authorized` | Evaluating a request                  |

### Enabling it

```bash
cedar-agent --port 8180                                   # terminal 1
AEGIS_CEDAR_AGENT_URL=http://127.0.0.1:8180 \
AEGIS_CEDAR_AGENT_SYNC=true cargo run --release -p aegis-server
```

Press **Connect** on the **Cedar Agent** card, then, in **Trace a request**,
choose `cedar-agent` as the **Engine**. With `AEGIS_CEDAR_AGENT_SYNC=true`
the agent receives the policies and entities the embedded engine holds (the
bundled ones, or those of a workspace) and loses whatever it held before.

- **Read-only by default.** Without the sync variable the agent's own store
  is used as it is.
- **Decisions are labelled `live`.** The engine is shown with "version
  not reported", because the agent does not expose one.
- **Leaving policies out is an embedded-engine feature.** With the agent the
  request is refused rather than evaluated differently, since the agent's
  store is authoritative.
- **A failed evaluation is an error**, never an invented decision, and there
  is no silent fallback to the embedded engine.
- **The simulation's own traffic still uses the embedded engine**, whose
  decisions are computed at start-up; the agent answers on-demand
  evaluations only.

### The parity test

A test in `apps/server/tests/integrations.rs` starts a real `cedar-agent`
binary, syncs the AEGIS fixtures into it and compares its answer with the
embedded engine's for every request shape AEGIS uses. It reports "skipped"
when the variable is unset.

```bash
AEGIS_TEST_CEDAR_AGENT_BIN=/path/to/cedar-agent cargo test -p aegis-server --test integrations real_cedar_agent
```

On the build tested, all 15 request shapes agreed on the decision and the
determining policies (the agent on `cedar-policy` 2.4.2, AEGIS on 4.14.1).
The rest of the adapter (timeouts, a wrong token, malformed answers, the
agent going away) is tested against an in-process double of the same
interface.

> **Building the agent.** Its `Cargo.lock` pins `time 0.3.22`, which does
> not compile on Rust 1.80 or later. For the verification, `time` was
> raised to 0.3.36 in a scratch copy (`cargo update -p time --precise
0.3.36`); the repository itself was not modified.

## rinha-backend-2026

`apps/server/src/integrations/rinha.rs` adapts a local stack of
[rinha-backend-2026](https://github.com/cleissonbarbosa/rinha-backend-2026):
a load balancer on port 9999 in front of two API instances, answering
`GET /ready` and `POST /fraud-score`. The stack has no metrics, Prometheus or
OpenTelemetry endpoint, and the repositories publish no benchmark results.

- **It only probes.** The adapter sends read-only `GET /ready` requests, at
  most one a second, backing off exponentially while the stack is
  unreachable. It never sends `POST /fraud-score` and never generates load.
- **It reports only what it measured itself:** probes sent, probes that
  succeeded and the round-trip time of the last 60 successful probes. It
  reports no throughput, because none can be observed from outside.
- **Its figures stay in the Integrations panel.** They are not merged into
  the 3D model.
- **How it was verified:** against an in-process double of the two
  endpoints, including the assertion that nothing but `GET /ready` is ever
  requested. It has not been run against a live stack, which needs a
  multi-gigabyte reference dataset at build time.

## ferrousDB, not integrated

[ferrousDB](https://github.com/cleissonbarbosa/ferrousDB) is an educational
storage engine (its README says not to use it in production), shipped as a
library, a REPL and a desktop GUI. It has no network interface to adapt to,
and linking it would pull a GUI toolkit into a headless server. Databases in
the bundled platform are therefore plain synthetic services. A connection
forced here would add an integration without adding anything a visitor
could verify.

## OpenTelemetry and cloud telemetry

There is no OpenTelemetry or cloud provider among the integrations: the
server reads no trace, metric or cloud API. A real incident can still be
looked at as an [incident capture](Incident-captures), a file the browser
reads itself.

The capture exporters in `scripts/` (CloudWatch Application Signals, and
Tempo with Prometheus) and the cloud inventory collectors are not
integrations either. You run them with your own access, and nothing in
AEGIS runs or calls them. See
[Incident captures](Incident-captures#writing-a-capture-of-your-own) and
[Cloud inventories](Cloud-inventories).

## Isolation rules

Every outbound request of a live adapter goes through
`apps/server/src/integrations/guard.rs`, with tests:

| Rule                   | What it means                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opt-in twice           | Server configuration _and_ an explicit **Connect**. Demo Mode makes no outbound connection                                                                     |
| Loopback only          | A target is `http` or `https` on a loopback address, unless its host is listed in `AEGIS_INTEGRATION_ALLOWED_HOSTS`                                            |
| No ambient credentials | A URL with credentials, a path, a query or a fragment is refused. The only secret is the optional agent token, never logged, serialised or sent to the browser |
| Bounded                | 2 s timeouts, no redirects, no proxy from the environment, 512 KiB response cap                                                                                |
| Schema validated       | Answers are parsed into typed structures; anything else is a protocol error                                                                                    |
| Visible state          | Every provider reports its state (`not-configured`, `available`, `connected`, `error`…), its target without credentials and its last error                     |

Transport errors are reduced to a category before they are logged or
returned, so a configured URL does not leak.

## The static site

The static site, with the engine compiled to WebAssembly in the tab, lists
the built-in simulation as its only provider. The code that makes outbound
requests is not compiled into the module, so neither live adapter exists
there, and asking for a decision from `cedar-agent` is refused, as on a
server with none connected. The Integrations panel says so: "This page runs
the simulation in the browser. The live adapters (a local cedar-agent, a
load-test target) need the AEGIS server."

An incident capture opens on the static site as it does on a server: the
browser reads it, and it is not a provider.

## Adding a provider

1. Implement `TelemetryProvider` in
   [`apps/server/src/integrations/mod.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/integrations/mod.rs):
   `id`, `status`, `connect` and `disconnect`.
2. Register it in `ProviderRegistry::new`.
3. State in `status()` which repository and interface it was verified
   against, and validate its target with `guard.rs`, as the other adapters
   do.

The web client needs no change: the Integrations panel shows whatever the
server lists at `GET /api/v1/providers`, and connects with
`POST /api/v1/providers/{id}/connect`. Keep to the scope above: a public
repository owned by `cleissonbarbosa`, read without authentication, with no
source copied.

## Reference

- [`docs/INTEGRATIONS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/INTEGRATIONS.md): the complete reference, with how each interface was verified
- [`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): section 9, Connected Mode step by step
- [`apps/server/src/integrations/`](https://github.com/cleissonbarbosa/csdt/tree/main/apps/server/src/integrations): `guard.rs`, `cedar_agent.rs`, `rinha.rs` and `mod.rs`
- [`apps/server/tests/integrations.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/tests/integrations.rs): the doubles and the parity test
- [`.env.example`](https://github.com/cleissonbarbosa/csdt/blob/main/.env.example): the server's variables, with a comment on each
- [Security model](Security-model#integrations): the same rules, among the others

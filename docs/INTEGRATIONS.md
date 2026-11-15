# Integrations

AEGIS runs complete without any integration: **Demo Mode** is a deterministic
simulation built into the server. Integrations are optional adapters for
public personal projects, and each one states plainly what kind of data it
contributes.

| Label       | Meaning                                                   |
| ----------- | --------------------------------------------------------- |
| `synthetic` | Produced by the AEGIS simulation engine.                  |
| `recording` | Parsed from a bundled fixture file. Never labelled live.  |
| `live`      | Measured from an explicitly connected **local** instance. |

The label travels with the data (`dataSource` on topologies, events, decisions
and provider statuses) and is rendered next to it in the interface.

## Scope and method

Only **public repositories owned by the GitHub user `cleissonbarbosa`** were
considered. Discovery used the unauthenticated public API
(`GET https://api.github.com/users/cleissonbarbosa/repos?type=owner`); no
token, `gh` session or SSH key was involved. For every repository inspected,
the listing was checked for `owner.login == "cleissonbarbosa"`,
`private == false` and `visibility == "public"` before its source was fetched
as an unauthenticated tarball from `codeload.github.com`. No private or
organisation repository was listed, opened or cloned.

No source code from any of these repositories is copied into AEGIS. Adapters
were written from scratch against the interfaces described below.

## Assessment

| Repository                                                                                                                                            | What it actually exposes                                 | Decision                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| [`cedar-agent`](https://github.com/cleissonbarbosa/cedar-agent)                                                                                       | HTTP API: policy store, data store, `is_authorized`      | **Live adapter**, verified against a locally built agent |
| [`rinha-backend-2026`](https://github.com/cleissonbarbosa/rinha-backend-2026) / [`-rust`](https://github.com/cleissonbarbosa/rinha-backend-2026-rust) | `GET /ready`, `POST /fraud-score` behind a load balancer | **Live adapter**, read-only readiness probe              |
| [`network-scanner`](https://github.com/cleissonbarbosa/network-scanner)                                                                               | CLI that writes a text `scan_report.txt`                 | **Fixture adapter** for the report format                |
| [`telegram-security-bot`](https://github.com/cleissonbarbosa/telegram-security-bot)                                                                   | Telegram client over the public NVD CVE API              | **Fixture adapter** for the data shape it consumes       |
| [`ferrousDB`](https://github.com/cleissonbarbosa/ferrousDB)                                                                                           | Rust library, REPL and desktop GUI                       | **Not integrated** (see below)                           |

Other public repositories in the account (interpreters, editor configuration,
a React Step Functions viewer, WordPress tooling…) have no bearing on cloud
security observability and were not considered further.

---

## cedar-agent — live adapter

`apps/server/src/integrations/cedar_agent.rs`

**Verified interface** (`src/main.rs`, `src/routes/*`, `src/schemas/*`,
`src/authn.rs`):

| Request                  | Used by AEGIS for                          |
| ------------------------ | ------------------------------------------ |
| `GET /v1/` → `204`       | health check on connect                    |
| `GET /v1/policies`       | counting the policies the agent holds      |
| `PUT /v1/policies`       | optional sync of AEGIS' synthetic policies |
| `PUT /v1/data`           | optional sync of AEGIS' synthetic entities |
| `POST /v1/is_authorized` | evaluating a request                       |

`is_authorized` takes `{principal, action, resource, context}` with Cedar
entity references as strings and answers
`{"decision": "Allow" | "Deny", "diagnostics": {"reason": [...], "errors": [...]}}`.
Unparsable requests get `400 {"reason", "description", "code"}`. When started
with `--authentication <token>` the agent expects that token verbatim in the
`Authorization` header.

**How it was verified.** The repository was built locally and exercised
end to end. `apps/server/tests/integrations.rs` contains a test that starts a
real `cedar-agent` binary, syncs the AEGIS fixtures into it and compares its
answer with the embedded engine for every request shape AEGIS uses:

```bash
AEGIS_TEST_CEDAR_AGENT_BIN=/path/to/cedar-agent cargo test -p aegis-server --test integrations real_cedar_agent
```

Result on the build tested: all 15 request shapes agree on decision and
determining policies (agent on `cedar-policy` 2.4.2, AEGIS on 4.14.1). The
rest of the adapter's behaviour (timeouts, wrong token, malformed answers,
agent going away) is tested against an in-process double that implements the
same interface.

> **Build note.** The repository's `Cargo.lock` pins `time 0.3.22`, which does
> not compile on Rust ≥ 1.80. For verification `time` was bumped to 0.3.36 in
> a scratch copy (`cargo update -p time --precise 0.3.36`); the repository
> itself was not modified.

**Behaviour**

- Opt-in twice: the server must be configured (`AEGIS_CEDAR_AGENT_URL`) _and_
  the operator must press **Connect**. Configuration alone contacts nothing.
- When connected, the Authorization Explorer offers `cedar-agent` as an engine.
  Decisions are labelled `live`; the engine version is shown as "not reported"
  because the agent does not expose one.
- Read-only by default. `AEGIS_CEDAR_AGENT_SYNC=true` additionally uploads the
  policies and entities the embedded engine holds on connect (the synthetic
  fixtures, or those of a [workspace](WORKSPACE.md)), which **replaces** the
  agent's stores.
- Per-policy toggling in the explorer is an embedded-engine feature: the
  agent's own store is authoritative, so the request is refused rather than
  silently evaluated differently.
- A failed evaluation is an error, never a fabricated decision, and there is
  no silent fallback to the embedded engine.

**Limitations.** The simulation's own traffic still uses decisions computed by
the embedded engine at start-up; the agent serves on-demand evaluations only.

## rinha-backend-2026 — live adapter

`apps/server/src/integrations/rinha.rs`

**Verified interface** (`src/server.nim`, `api/src/http.rs`,
`docker-compose.yml`): a load balancer on port 9999 in front of two API
instances, answering `GET /ready` (`{"ready":true}`) and `POST /fraud-score`.
There is **no** metrics, Prometheus or OpenTelemetry endpoint, and the
repositories publish no benchmark results.

**Decision.** The adapter issues read-only `GET /ready` probes at a fixed low
rate (at most one per second, exponential backoff while unreachable) and
reports only what it measured itself: probes sent, probes succeeded, and the
round-trip time of the last 60 successful probes. It never sends
`POST /fraud-score`, never generates load and reports no throughput figure,
because none can be observed from outside.

**How it was verified.** Against an in-process double of the two endpoints
(`apps/server/tests/integrations.rs`), including the assertion that nothing
but `GET /ready` is ever requested. It has **not** been run against a live
instance: the stack needs a multi-gigabyte reference dataset at build time.

**Limitations.** Availability and probe latency only. The probe figures appear
in the Integrations panel; they are not merged into the 3D topology.

## network-scanner — fixture adapter

`apps/server/src/integrations/network_scanner.rs`

**Verified interface** (`app/Main.hs`, `app/Scanner.hs`,
`app/OSFingerprint.hs`): a command-line tool with a hard-coded target
(`127.0.0.1`) that writes:

```text
Scan report generated at: <timestamp>

Port <n> is open (<service>)
No connection to port <n>

OS Fingerprint based on TTL (<ttl>): <guess>
```

**Decision.** A strict parser for that format plus a bundled,
**hand-authored** report (`fixtures/integrations/network-scanner/`). Importing
it places the findings on the timeline as `recording` events. Any line the
scanner could not have produced is a parse error.

AEGIS never runs the scanner and never opens a socket to scan anything.

## telegram-security-bot — fixture adapter

`apps/server/src/integrations/security_alerts.rs`

**Verified interface.** The bot exposes no service: it is a Telegram client
that queries the public NVD CVE API 2.0. Its handler
(`src/commands/handlers/recent_vulnerabilities.py`) reads `cve.id`,
`cve.descriptions[]` and `cve.metrics.cvssMetricV31[0].cvssData.baseScore`.

**Decision.** What can honestly be reused is the _shape of the data it
consumes_. The adapter parses those same fields from a bundled document in the
NVD response shape (`fixtures/integrations/security-alerts/nvd-recent.json`).
Every advisory in it is fictional (`CVE-2099-*`, invented products,
`*.invalid` URLs). A sidecar file maps each advisory to nodes of the synthetic
topology. Severity follows the CVSS v3.1 qualitative bands.

AEGIS never contacts NVD or Telegram.

## ferrousDB — not integrated

An educational storage engine (its README says not to use it in production)
shipped as a library, a REPL and a `druid` desktop GUI. It has no network
interface to adapt to, and linking it would pull a GUI toolkit into a headless
server. Databases in the demo topology are therefore plain synthetic nodes.
Forcing a connection here would add an integration to the count without adding
anything a visitor could verify.

## OpenTelemetry

There is no `OpenTelemetryProvider`. None of the inspected projects exports
OTLP, and AEGIS only implements providers backed by an interface that was
actually verified. It is on the roadmap as a generic adapter.

---

## Isolation rules for live adapters

Enforced in `apps/server/src/integrations/guard.rs` and `mod.rs`, with tests:

- **Loopback only.** Targets must be `http(s)://` on a loopback address.
  Other hosts are refused unless listed in `AEGIS_INTEGRATION_ALLOWED_HOSTS`
  (intended for compose service names).
- **No ambient credentials.** URLs carrying credentials, a path, a query or a
  fragment are refused. The only secret is an optional agent token read from
  the server's environment; it is never logged, serialised or sent to the
  browser.
- **Bounded.** 2 s timeouts, no redirects, no proxy from the environment,
  512 KiB response cap.
- **Schema validated.** Responses are parsed into typed structures; anything
  else is a protocol error.
- **Visible state.** Every provider reports its state (`not-configured`,
  `available`, `connected`, `error`…), its target without credentials, and its
  last error.

## Adding a provider

Implement `TelemetryProvider` (`apps/server/src/integrations/mod.rs`),
register it in `ProviderRegistry::new`, and state in `status()` which
repository and interface it was verified against. The web client needs no
change: the Integrations panel renders whatever the server lists.

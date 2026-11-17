# Security model

AEGIS is a simulator. It observes nothing real and can change nothing real.
This document states the boundaries that make that true and how each one is
enforced.

## What AEGIS cannot do

| Boundary                                      | How it is enforced                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **No real attacks.**                          | Scenarios are declarative data that change numbers inside the simulation engine. The `simulation` and `incidents` modules perform no I/O. |
| **No network scanning.**                      | The network-scanner integration is a parser for a bundled text file. No code in AEGIS opens a socket to probe a host or port.             |
| **No infrastructure changes.**                | There are no cloud SDKs or credentials in the dependency tree.                                                                            |
| **No outbound connections by default.**       | Demo Mode makes none. Integrations must be configured on the server _and_ switched on by the operator.                                    |
| **No remote targets.**                        | Live adapters accept loopback targets only, unless a host is explicitly allow-listed.                                                     |
| **No third-party requests from the browser.** | Fonts and scripts are bundled; the deployed CSP is `default-src 'self'`.                                                                  |

## Data

All bundled platform data is synthetic: services, metrics, incidents,
principals, policies and advisories. Advisories use the reserved-looking `CVE-2099-*` range
and `*.invalid` URLs so they cannot be mistaken for real ones.

Every piece of data carries a provenance label (`synthetic`, `recording`,
`live`) from the server to the pixel. A fixture is never labelled live.

AEGIS collects no telemetry about its users and stores nothing outside the
browser's `localStorage` (display preferences).

## Workspace

A workspace ([WORKSPACE.md](WORKSPACE.md)) is the one place AEGIS takes
topologies, scenarios and policies it was not built with. It arrives in two
ways, and both go through the same code and the same checks.

**From a directory, at start-up.** `AEGIS_WORKSPACE` is unset by default. The
directory (or bundle file) it names is read once, before the listener is
bound. This is the only place the server reads the file system, and it is
configuration: whoever can write the directory already controls how the server
starts.

**Through the API, while running.** The interface can check and import files
it holds in the browser. This is what the route can and cannot do:

- **It receives content, never a path to open.** The request carries each
  file's text. A file's declared path only says which part of the workspace it
  belongs to; nothing derived from a request is ever opened, listed or
  written. An import is held in memory and is gone when the server restarts.
- **It is checked before it is applied.** The files are parsed, validated and
  compiled exactly as a directory is at start-up. If anything is wrong the
  import is refused with the file and the reason, and what is running is not
  touched. `POST /demo/workspace/check` does the same without applying.
- **It is bounded.** These two routes accept 8 MiB instead of 16 KiB, at most
  256 files of at most 4 MiB each, under the same per-client limit as every
  other mutation. Parsing and compiling run off the async workers.
- **It replaces what everyone sees.** There is one simulation. Whoever can
  reach the API can already start an incident or reset the timeline for
  everyone connected; an import is in that class, and goes further: it
  replaces the platform, the scenarios and the policies on show. On a server
  that others share, switch it off with `AEGIS_IMPORT=off`. The three routes
  then answer 403, and the interface says so.
- **It can always be undone.** `POST /demo/workspace/reset` returns to what
  the server was started with, which an import never modifies.

Whichever way it arrives, a workspace is held to this:

- **Bounded.** 4 MiB per file, 64 files of a kind, 2 000 services and
  20 000 connections per topology, 512 policies, scenarios of at most 30
  virtual minutes. Files are parsed into typed structures that reject unknown
  fields, and numbers outside their range are refused before anything runs.
- **Data, not behaviour.** A scenario is a list of the eleven effects the
  engine understands, each a bounded number applied to a node or a connection
  of the model. No effect reads a file, opens a socket or runs anything, and
  the `simulation` and `incidents` modules perform no I/O with or without a
  workspace.
- **Provenance cannot be forged.** A topology must be labelled `synthetic`,
  because its figures are computed whatever platform it describes. A scenario
  may only announce alerts, authentication failures, mitigations and reroutes;
  a recording, and a session, may only start and stop scenarios and place
  and lift faults. An authorization decision, an
  advisory or a scan finding cannot be written into a file: they come from
  Cedar or from an importer.
- **Cedar still decides.** Policies from a workspace are parsed and evaluated
  by `cedar-policy`. A flow is stopped at the authorizer only if Cedar denied
  its request.

Files in a workspace may describe a real system, and two things follow.

- **They are served to whoever can reach the API.** The topology, the
  scenario texts, the source of every policy and the catalogue of principals
  and resources are what the interface displays, so the API returns them.
  AEGIS has no authentication (see [Deploying beyond
  localhost](#deploying-beyond-localhost)); keep a server with such a
  workspace on loopback or behind something that authenticates.
- **They are sent nowhere else**, with one exception that is opt-in twice: a
  connected cedar-agent started with `AEGIS_CEDAR_AGENT_SYNC=true` receives the
  policies and entities the embedded engine holds.

## Sessions, comparisons and reports

A few routes take or produce a timeline as data. None reads a file, none
takes an outcome, and what each can make the server do is bounded.

- **A session is a recording.** `GET /session` writes the timeline in use
  out as a topology id, a seed and the commands that were issued.
  `POST /demo/session/load` takes one and has the engine simulate it again.
  It is held to what a recording file is held to: it may start and stop
  scenarios and place and lift faults, with figures in range, on services
  and connections the topology has. A decision or an imported event in it is
  refused; those are left out, and counted, when a session is written, and
  can only come from Cedar or from an importer. At most 512 commands, 30
  virtual minutes and 256 KiB, simulated off the async workers. Loading one
  replaces the timeline for everyone connected, as loading a bundled
  recording does.
- **A comparison touches nothing.** `POST /demo/experiments/compare`
  simulates one scenario twice on timelines of its own, bounded the same
  way, and answers with both. The timeline in use is not changed.
- **A policy comparison applies nothing.** `POST /demo/workspace/diff`
  builds the uploaded files as a check does and has Cedar evaluate the
  catalogued requests, and every request the tracer can build (at most
  20 000), under both sets of policies. It is one of the import routes: the
  same 8 MiB, and 403 with `AEGIS_IMPORT=off`.
- **A report invents nothing.** `GET /incidents/{id}/report` is read from
  the events and samples already on the timeline. A relation it cannot find
  is reported as `unattributed`.
- **A link carries a session in its fragment.** The part of an address after
  `#` is not sent to a server. The page that opens such a link shows what
  the session holds and loads it only when asked: following a link never
  changes what is running. A session file that carries a platform's files is
  an import, with everything said above about imports.
- **The view is in the query string.** The arrangement and the selection are
  written into the address as they change
  (`?arrangement=regions&select=node:use-auth`). They are identifiers of the
  platform on show, which the API serves to anyone who can reach it, and
  opening such an address changes nothing on the server.

## Server

**Input validation.** Request bodies are deserialised into typed structures
that reject unknown fields. Identifiers are restricted to a conservative
character set and length; Cedar entity references and contexts are
length-bounded and parsed before use; bodies are capped at 16 KiB, except
those of a workspace check, comparison or import, which carry files and are
capped at 8 MiB, and that of a session, capped at 256 KiB.

**Rate limiting.** A per-client token bucket in front of every route, with a
small burst for mutations (40, refilling at 8/s) and a larger one for reads.
Concurrent stream subscribers are capped at 64.

**WebSocket.** Browsers do not apply CORS to WebSockets, so the handshake
checks `Origin` against the allow-list explicitly. Client messages are limited
in size (1 KiB) and rate (20/s); a client that keeps sending malformed
messages is disconnected. A slow consumer is dropped rather than buffered
without bound.

**CORS.** Only the origins in `AEGIS_ALLOWED_ORIGINS`; methods limited to
`GET` and `POST`.

**Response headers.** `X-Content-Type-Options: nosniff`, `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` on every
API response.

**Logging.** Request logs contain method and path only: no query strings,
headers or bodies. Transport errors from integrations are reduced to a
category before being logged or returned, so configured URLs do not leak.

**Memory safety.** `unsafe` is forbidden crate-wide. History is bounded
(30 minutes of virtual time, 8 000 events) and so is every buffer that an
external party can fill.

## Integrations

Rules enforced in `apps/server/src/integrations/guard.rs`:

- `http`/`https` only, loopback only unless allow-listed.
- No credentials, path, query or fragment in a configured URL.
- 2 s timeouts, no redirects, no proxy from the environment, 512 KiB response
  cap.
- The single secret (an optional cedar-agent token) is read from the server's
  environment, redacted from debug output, and never sent to the browser or
  written to a log. A test asserts it does not appear in provider statuses.
- cedar-agent is used read-only unless `AEGIS_CEDAR_AGENT_SYNC=true`.

AEGIS does not use ambient credentials of any kind (no `gh` session, no cloud
profile, no SSH agent).

## Web client

**Content Security Policy** (set by the bundled nginx configuration):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self';
worker-src 'self' blob:; object-src 'none'; base-uri 'self';
form-action 'none'; frame-ancestors 'none'
```

`style-src 'unsafe-inline'` is the one relaxation, needed for element styles
set by the interface. The build inlines no assets, so `font-src` and
`script-src` stay at `'self'`. The policy was verified by loading the
containerised application in a browser and checking for violations.

Nothing in the page evaluates a string as code. The schema library would
compile its parsers that way if the policy let it; it is configured not to
try, so the policy has nothing to refuse.

**Response validation.** Every REST response and stream message is parsed
against the shared schemas before use; a message that violates the contract is
dropped and logged. Event text is rendered as text, never as HTML.

## Static site

`pnpm build:static` builds the application around the engine compiled to
WebAssembly (`apps/wasm`) instead of the server. It is the same code behind
the same routes, so everything above about what a file can and cannot do
holds there unchanged. What is different is where it runs.

- **It talks to nothing.** There is no API and no socket. The page requests
  its own files (scripts, styles, fonts, the model file and the engine
  module) and nothing else, and a test fails if it requests anything more.
- **The module cannot reach out.** It is built with no imports at all: no
  network, no clock, no storage, no DOM. Text goes in, text comes out. This
  is checked on the built file, not assumed.
- **The live adapters do not exist in it.** The code that makes outbound
  requests is not compiled into the module, and the two adapters are not
  listed. Asking for a decision from `cedar-agent` is refused, as it is on a
  server with none connected.
- **An import stays in the tab.** Files are checked by the same code as on
  the server, held in the page's memory and gone on reload. Nobody else
  shares the simulation, so there is nothing to switch off.
- **The policy travels in the page.** A static host sets no headers for it,
  so the build writes the policy into the document:

  ```
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  font-src 'self'; connect-src 'self'; worker-src 'self' blob:;
  object-src 'none'; base-uri 'self'; form-action 'none'
  ```

  It is the policy above with one addition, `'wasm-unsafe-eval'`, which
  permits compiling a WebAssembly module and nothing else (`eval` stays
  refused). `frame-ancestors` cannot be given in a document; a host that can
  set headers should send it, and `X-Content-Type-Options: nosniff`.
  The end-to-end suite of the static site runs under this policy and fails
  on any violation.

The site is static files. Publishing it shows the bundled, fictional
platform to whoever opens it and nothing else: there is no state on a server
to reach, because there is no server.

## Containers

- Server: distroless image, non-root user, read-only root filesystem, all
  capabilities dropped, `no-new-privileges`.
- Web: unprivileged nginx, all capabilities dropped, `no-new-privileges`. It
  caps request bodies to the API at 32 KiB, and at 8 MiB on the two routes
  that carry files, which it passes through without buffering them to disk.
- The API port is not published; it is reachable only through the web
  container. The web port binds to `127.0.0.1` by default.

## Supply chain

- Lockfiles are committed and CI installs with `--locked` /
  `--frozen-lockfile`.
- Dependencies come from crates.io and npm only.
- No secrets are needed to build, test or run; none are in the repository.
  `.env` files are git-ignored and `.env.example` contains no values.
- A release (`.github/workflows/release.yml`) is built from the commit CI
  tested, and only when the version in `Cargo.toml` has no tag yet. The two
  jobs that hold a token that can write run no third-party action:
  `actions/checkout`, then the runner's own `docker` and `gh`. One may write
  packages and the other the tag and the release; neither holds the other's
  permission, and no job triggered by a pull request holds either.
- The images are started together and the server is asked for its version
  before anything is pushed. A release lists each image's digest, so a
  deployment can name `image@sha256:…` instead of a tag that moves.

## Deploying beyond localhost

AEGIS has **no authentication**. It is a demonstration meant to run on a
developer machine or behind something that provides access control. Anyone who
can reach the API can start scenarios and reset the simulation (they cannot
reach anything else through it). If you expose it, put it behind an
authenticating reverse proxy and set `AEGIS_ALLOWED_ORIGINS` to the exact
public origin.

## Reporting

Please open a GitHub issue for anything that looks wrong. There is no
production deployment and no user data, so public reports are fine.

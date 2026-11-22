**English** · [Português](Modelo-de-segurança)

The AEGIS simulator runs on synthetic data and can change nothing in an
external system. Besides what an explicitly connected local instance reports
(labelled `live`), the one thing it shows that is not synthetic is an
[incident capture](Incident-captures): a real incident read by the browser
from a file, which it sends nowhere. Capture files and
[cloud inventories](Cloud-inventories) are written beforehand by scripts an
operator runs on their own machine with their own access; those scripts
only read, and AEGIS never runs them. This page states each boundary and how
it is enforced.

## What AEGIS cannot do

| Boundary                                     | How it is enforced                                                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No real attacks**                          | Scenarios are declarative data that change numbers inside the engine. The `simulation` and `incidents` modules perform no I/O                                               |
| **No network scanning**                      | No code scans a host or a port. The two live adapters send fixed HTTP requests to the single target configured for each, through `guard.rs`                                 |
| **No infrastructure changes**                | The server, the engine and the page contain no cloud SDK and hold no cloud credential. The operator's scripts call read operations only and write no credential into a file |
| **No outbound connections by default**       | Demo Mode makes none. An integration must be configured on the server _and_ switched on by the operator                                                                     |
| **No remote targets**                        | Live adapters accept loopback targets only, unless a host is explicitly allow-listed                                                                                        |
| **No third-party requests from the browser** | Fonts and scripts are bundled, and the deployed Content-Security-Policy is `default-src 'self'`                                                                             |

## Data and provenance

All bundled simulation data is synthetic: services, metrics, incidents,
principals and policies. The web build also bundles two incident captures
that are not: a hand transcription of Google Cloud's public report on the
incident of 12 June 2025, and aggregates of the RCAEval 0.2.0 Online
Boutique benchmark. Each names its source.

Every piece of data carries a provenance label from where it is produced to
the pixel: `synthetic` (the simulation), `live` (a connected local instance)
or `recording` (an incident capture, labelled "Capture" and shown as not
simulated). Nothing the simulation produces is labelled `recording` or
`live`, and a topology from a workspace must be `synthetic`, because its
figures are computed whatever platform it describes.

AEGIS collects no telemetry about its users and stores nothing outside the
browser's `localStorage` (display preferences, and your progress in the
guide), which it sends nowhere. On the static site the service worker also
keeps the build's own files in Cache Storage.

### An incident capture stays in the tab

A capture file (at most 12 MiB) is read in the page, checked against the
capture format and held in memory. It is not uploaded, not written to
storage and gone on reload. It is not a workspace, and nothing of it is
placed on the simulation's timeline: while one is open, nothing in the
interface acts on the simulation. A capture's source link must be `https`,
and it is a link you follow, not a request the page makes. A capture can
name a real system (service names, and in a CloudWatch capture an ARN with
an account ID), so share it as you decide.

### A draft leaves a capture only when asked

**Draft a platform from this capture** writes a topology in the page from
the capture's service names, the calls between them and the rates it
measured, and stages the file in the import dialog. Staging sends it to the
server to be checked, and applying it shows it to everyone connected, as any
import does. Nothing else goes with it: no sample series, no event, no
note, no source link, no ARN. On a server other people reach, draft a
capture of a real system only if its service names may be seen there; the
static site keeps the draft in the tab.

## The workspace

A [workspace](Workspace-files) is the one place AEGIS takes topologies,
scenarios and policies it was not built with. Both ways it arrives go
through the same code and the same checks.

- **From a directory, at start-up.** `AEGIS_WORKSPACE` is unset by default.
  The directory (or bundle file) it names is read once, before the listener
  is bound. This is the only place the server reads the file system, and it
  is configuration: whoever can write the directory already controls how
  the server starts.
- **Through the API, while running.** The request carries each file's text,
  never a path to open: nothing derived from a request is opened, listed or
  written. The files are checked exactly as a directory is before anything
  is applied (`POST /demo/workspace/check` checks without applying), held in
  memory and gone when the server restarts. `POST /demo/workspace/reset`
  returns to what the server started with.
- **An import replaces what everyone sees.** There is one simulation, so on
  a server that others share, switch importing off with `AEGIS_IMPORT=off`.
  The routes that take files (check, preview, diff, import and the
  comparison of platforms) and the reset then answer 403, and the interface
  says so.

### What a file may and may not do

- **Data, not behaviour.** A scenario is a list of the eleven effects the
  engine understands, each a bounded number applied to a service or a
  connection of the model. No effect reads a file, opens a socket or runs
  anything.
- **A Compose file is read, not run.** A `docker-compose.yml` is parsed as
  text for its services, dependencies, published ports and image names. No
  image is pulled, nothing is built or started, no `env_file`, `extends` or
  `include` is followed, and no variable is substituted.
- **A cloud inventory is read, not fetched.** No provider is asked anything,
  by the server or by the page. After an import only the topology is kept;
  the file's tags, networks and notes are not, and the file is not stored.
- **Provenance cannot be forged.** A scenario may only announce alerts,
  authentication failures, mitigations and reroutes; a recording, and a
  session, may only start and stop scenarios and place and lift faults. An
  authorization decision cannot be written into a file.
- **Cedar still decides.** Policies from a workspace are parsed and
  evaluated by `cedar-policy`, and a flow is stopped at the authorizer only
  if Cedar denied its request.

### Bounds

Files are parsed into typed structures that reject unknown fields, and
numbers outside their range are refused before anything runs.

| What                           | Bound                                         |
| ------------------------------ | --------------------------------------------- |
| One file                       | 4 MiB                                         |
| Files of one kind              | 64                                            |
| One import                     | 256 files, in a request body of at most 8 MiB |
| A topology                     | 2 000 services and 20 000 connections         |
| Policies                       | 512                                           |
| A scenario                     | 30 virtual minutes                            |
| A cloud inventory              | 10 000 resources and 50 000 relations         |
| YAML nesting in a Compose file | 64 levels                                     |
| YAML aliases, once written out | 100 000 values                                |

The two YAML bounds cover what the YAML parser itself does not bound. It
follows each level of nesting by calling itself, so a file nested deeply
enough would end the process; and aliases can expand a small file into a
very large one. Both are checked before the parser is given the text, and
no YAML reaches the parser any other way.

### Files that describe a real system

- **They are served to whoever can reach the API.** The topology, the
  scenario texts, the source of every policy and the catalogue of
  principals and resources are what the interface displays, so the API
  returns them. AEGIS has no authentication: keep a server with such a
  workspace on loopback or behind something that authenticates.
- **They are sent nowhere else**, with one exception that is opt-in twice: a
  connected cedar-agent with `AEGIS_CEDAR_AGENT_SYNC=true` receives the
  policies and entities the embedded engine holds.

## Sessions, comparisons and reports

Some routes under `/api/v1` take or produce a timeline as data. None reads a
file, none takes an outcome, and each is bounded.

| Route                                                                 | What it can and cannot do                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /session`, `POST /demo/session/load`                             | A session is a recording: start and stop scenarios, place and lift faults. A decision in it is refused. At most 512 commands, 30 virtual minutes and 256 KiB; loading one replaces the timeline for everyone |
| `POST /demo/experiments/compare`                                      | Simulates one scenario twice on timelines of its own; the timeline in use is not changed                                                                                                                     |
| `POST /demo/experiments/trial`                                        | The platform at rest twice, sixty seconds each, once with one fault held to what a fault placed by hand is held to                                                                                           |
| `POST /demo/experiments/platforms`                                    | Takes files as an import does, under the same limits, and applies nothing; off where importing is                                                                                                            |
| `POST /demo/experiments/headroom`                                     | At most fifteen runs of 66 virtual seconds; takes no figure from the caller                                                                                                                                  |
| `POST /demo/experiments/weak-points`                                  | One run of 64 virtual seconds per service, on a platform of at most 250 services                                                                                                                             |
| `POST /demo/authorization/explain`, `POST /demo/authorization/matrix` | Ask Cedar and record nothing: no event, no decision, no path. The matrix asks at most 20 000 requests; both leave out at most 32 policies                                                                    |
| `POST /demo/workspace/preview`, `POST /demo/workspace/diff`           | Build the uploaded files as a check does and apply nothing; import routes, so 8 MiB and 403 with `AEGIS_IMPORT=off`                                                                                          |
| `GET /incidents/{id}/report`                                          | Read from the events and samples already on the timeline; a relation it cannot find is `unattributed`                                                                                                        |

Addresses change nothing on the server either. A link that carries a
session holds it in the fragment (after `#`), which is not sent to a
server, and the page loads it only when asked. The view
(`?arrangement=regions&select=node:use-auth`), `?challenge=<id>` and
`?capture=<id>` name things the page shows; `?capture=` can only name a
capture bundled with the build.

## The server

**Input.** Request bodies are deserialised into typed structures that
reject unknown fields. Identifiers are held to a conservative character set
and length, and Cedar entity references and contexts are bounded and parsed
before use. A body is capped at 16 KiB, except those that carry files
(8 MiB) and a session (256 KiB).

**Rate limits.** A per-client token bucket stands in front of every route,
with a small burst for mutations (40, refilling at 8 a second) and a larger
one for reads.

**The stream.** At most 64 concurrent subscribers. Browsers do not apply
CORS to WebSockets, so the handshake checks `Origin` against the allow-list
itself. Client messages are limited to 1 KiB and 20 a second; a client that
keeps sending malformed messages is disconnected, and a slow consumer is
dropped rather than buffered without bound.

**CORS** allows only the origins in `AEGIS_ALLOWED_ORIGINS`, and only `GET`
and `POST`.

**Headers** on every API response: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store` and
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.

**Logging.** Request logs hold the method and path only: no query string,
header or body.

**Memory.** `unsafe` is forbidden crate-wide. History is bounded (30 minutes
of virtual time, 8 000 events), and so is every buffer an outside party can
fill.

## Integrations

The rules of [Integrations](Integrations#isolation-rules), enforced in
`apps/server/src/integrations/guard.rs`:

- `http` or `https` only, loopback only unless allow-listed.
- No credentials, path, query or fragment in a configured URL.
- 2 s timeouts, no redirects, no proxy from the environment, 512 KiB
  response cap.
- The single secret, an optional cedar-agent token, is read from the
  server's environment, redacted from debug output, and never sent to the
  browser or written to a log; a test asserts it does not appear in provider
  statuses.
- cedar-agent is used read-only unless `AEGIS_CEDAR_AGENT_SYNC=true`.

The server, the engine and the page use no ambient credentials of any kind:
no `gh` session, no cloud profile, no SSH agent. A cloud profile is used
only by scripts you run: `scripts/export-cloudwatch-capture.py` through the
AWS CLI, and `scripts/export-cloud-inventory.py` through the AWS, Google
Cloud or Oracle Cloud CLI. Each hands the CLI a list of arguments, never a
line for a shell, and writes nothing of what the CLI is signed in as into
its file. `scripts/export-otel-capture.py` sends a token only to an
`https://` URL or a loopback host.

## The web client

The bundled nginx configuration sets this Content-Security-Policy:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self';
worker-src 'self' blob:; object-src 'none'; base-uri 'self';
form-action 'none'; frame-ancestors 'none'
```

`style-src 'unsafe-inline'` is the one relaxation, for element styles the
interface sets. The build inlines no assets, so `font-src` and `script-src`
stay at `'self'`. Nothing in the page evaluates a string as code: the
schema library would compile its parsers that way, and is configured not
to. The same configuration also sends `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and
`Cross-Origin-Opener-Policy`.

Every REST response and stream message is parsed against the shared schemas
before use; one that violates the contract is dropped and logged. Event text
is rendered as text, never as HTML.

## The static site

`pnpm build:static` builds the application around the engine compiled to
WebAssembly instead of the server. It is the same code behind the same
routes, so everything above about what a file can do holds there unchanged.

- **It talks to nothing.** There is no API and no socket. The page requests
  its own files and nothing else, and a test fails if it requests more.
- **The module cannot reach out.** It is built with no imports at all: no
  network, no clock, no storage, no DOM. This is checked on the built file.
- **The live adapters do not exist in it**, and an import stays in the tab:
  held in the page's memory and gone on reload.
- **The policy travels in the page.** A static host sets no headers for it,
  so the build writes the policy into the document. It adds
  `'wasm-unsafe-eval'`, which permits compiling a WebAssembly module and
  nothing else (`eval` stays refused). `frame-ancestors` cannot be given in
  a document: a host that can set headers should send it, and
  `X-Content-Type-Options: nosniff`.

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; worker-src 'self' blob:;
object-src 'none'; base-uri 'self'; form-action 'none'
```

- **It can be kept by the browser.** A service worker (`sw.js`) keeps the
  site's own files so it opens with no network. It answers only for requests
  to its own origin that it was built with a file for, fetches nothing from
  anywhere else, and keeps one cache named after the build, which the next
  build replaces. The page itself is asked of the network first.
- **It can be shown inside another page.** `?embed=1` leaves out the bar and
  reaches no incident capture; `&scenario=<id>` starts an incident there,
  and only on the static site, since on a server the simulation is shared.

## Containers

| Container | Hardening                                                                                                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server    | Distroless image, non-root user, read-only root filesystem, all capabilities dropped, `no-new-privileges`. Its port is not published: only the web container reaches it                                                                             |
| Web       | Unprivileged nginx, all capabilities dropped, `no-new-privileges`. Request bodies to the API are capped at 32 KiB, and at 8 MiB under `/api/v1/demo/workspace/`, passed through without buffering to disk. The port binds to `127.0.0.1` by default |

## Supply chain

- Lockfiles are committed, and CI installs with `--locked` and
  `--frozen-lockfile`. Dependencies come from crates.io and npm only.
- No secret is needed to build, test or run, and none is in the repository.
  `.env` files are git-ignored and `.env.example` holds no values.
- A release is built from the commit CI tested, only when the version in
  `Cargo.toml` has no tag yet. The two jobs that hold a token that can write
  run no third-party action, neither holds the other's permission, and no
  job triggered by a pull request holds either.
- The images are started together, and the server is asked for its version,
  before anything is pushed. A release lists each image's digest, so a
  deployment can name `image@sha256:…` instead of a tag that moves.

## Deploying beyond localhost

AEGIS has **no authentication**. It is a demonstration meant for a developer
machine or for running behind something that provides access control.
Anyone who can reach the API can start scenarios, reset the simulation and,
unless it is switched off, import files for everyone connected; they cannot
reach anything else through it.

| To expose it                              | Do this                                                      |
| ----------------------------------------- | ------------------------------------------------------------ |
| Control who reaches it                    | Put it behind an authenticating reverse proxy                |
| Accept the browser's origin               | Set `AEGIS_ALLOWED_ORIGINS` to the exact public origin       |
| Keep others from replacing the platform   | Set `AEGIS_IMPORT=off`                                       |
| Publish the web container beyond loopback | Change its port binding in `docker-compose.yml` deliberately |

## Reporting a vulnerability

Open a [GitHub issue](https://github.com/cleissonbarbosa/csdt/issues) for
anything that looks wrong. There is no production deployment and no user
data, so a public report is fine.

## Reference

- [`docs/SECURITY.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/SECURITY.md): the complete reference
- [`docs/INTEGRATIONS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/INTEGRATIONS.md) and [`docs/CAPTURES.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/CAPTURES.md): the live adapters, and what a capture is and holds
- [`apps/server/src/integrations/guard.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/integrations/guard.rs): the one check every outbound target passes
- [`apps/server/src/api/mod.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/mod.rs): body limits, rate limits and response headers
- [`apps/web/nginx.conf.template`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/nginx.conf.template) and [`apps/web/vite.config.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/vite.config.ts): the two Content-Security-Policies
- [`docker-compose.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/docker-compose.yml) and [`.env.example`](https://github.com/cleissonbarbosa/csdt/blob/main/.env.example): the containers, and the server's variables with a comment on each

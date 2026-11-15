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

All platform data is synthetic: services, metrics, incidents, principals,
policies and advisories. Advisories use the reserved-looking `CVE-2099-*` range
and `*.invalid` URLs so they cannot be mistaken for real ones.

Every piece of data carries a provenance label (`synthetic`, `recording`,
`live`) from the server to the pixel. A fixture is never labelled live.

AEGIS collects no telemetry about its users and stores nothing outside the
browser's `localStorage` (display preferences).

## Server

**Input validation.** Request bodies are deserialised into typed structures
that reject unknown fields. Identifiers are restricted to a conservative
character set and length; Cedar entity references and contexts are
length-bounded and parsed before use; bodies are capped at 16 KiB.

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

**Response validation.** Every REST response and stream message is parsed
against the shared schemas before use; a message that violates the contract is
dropped and logged. Event text is rendered as text, never as HTML.

## Containers

- Server: distroless image, non-root user, read-only root filesystem, all
  capabilities dropped, `no-new-privileges`.
- Web: unprivileged nginx, all capabilities dropped, `no-new-privileges`.
- The API port is not published; it is reachable only through the web
  container. The web port binds to `127.0.0.1` by default.

## Supply chain

- Lockfiles are committed and CI installs with `--locked` /
  `--frozen-lockfile`.
- Dependencies come from crates.io and npm only.
- No secrets are needed to build, test or run; none are in the repository.
  `.env` files are git-ignored and `.env.example` contains no values.

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

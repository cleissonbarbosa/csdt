# Demo guide

A five-minute tour that shows everything AEGIS does. Start it first:

```bash
docker compose up --build        # then open http://localhost:8080
```

or, without Docker:

```bash
cargo run --release -p aegis-server      # terminal 1 — API on 127.0.0.1:8787
pnpm install && pnpm dev:web             # terminal 2 — UI on http://localhost:5173
```

Demo Mode needs no credentials, accounts or network access.

## 1 · Read the scene (30 s)

You are looking at **Helios Commerce**, a fictional platform of 51 services in
three cloud regions around a global edge.

- The central pillar is the edge: clients on the ring above, the edge router
  below them, the threat monitor on top.
- Each platform is a region. Tiers step downward from the gateway to the data
  stores.
- Particles are requests. Density follows request rate; green ones are
  responses returning to the caller.
- Every service type has its own shape. Press <kbd>?</kbd> for the legend.

Drag to orbit, scroll to zoom, right-drag to pan. Click a service to inspect
it; double-click to fly to it. <kbd>R</kbd> resets the camera.

## 2 · Inspect a service (30 s)

Click the **API Gateway** in US East (or pick it in the explorer on the left).
The inspector shows live throughput, latency, error rate and saturation with
90 seconds of history, every connection in both directions, and the events
that involved it. Follow a connection to walk the dependency graph.

Type `database eu-west` in the search box: everything else dims in the scene.
Clear the filter.

## 3 · Launch an incident (90 s)

Open the **Incidents** tab and start **DDoS Surge**. Set the speed to **2×**.

Watch, in order:

1. A magenta stream leaves _Unattributed Sources_ and pours through the edge
   router into the US East gateway.
2. The gateway turns red and sends out a shockwave. p95 latency and the error
   rate on the HUD climb; services behind the gateway saturate.
3. The threat monitor raises **Volumetric attack detected**.
4. Mitigation engages by itself: the stream now stops at the edge router and
   flares (rejected), and the platform recovers.

The console lists the phase, the impacted services and every event.

## 4 · Travel in time (60 s)

- Press **Pause**. Virtual time stops.
- Drag the playhead on the timeline back to before the red band. The scene,
  the HUD and every inspector return to exactly that moment.
- Press **Play**: you are replaying recorded history, re-simulated bit for
  bit. The badge says _Replay_.
- Press **Live** to jump back to the head.
- Click any event in the inspector, then **Jump to this moment**.

Start a different scenario while in the past and the timeline _branches_: the
old future is discarded and a new one is made from there.

## 5 · Ask Cedar (60 s)

Open the **Authorization** tab (key icon).

1. Principal **Mallory**, action **Export ledger**, resource **Acme ledger
   2026**. Press **Evaluate with Cedar**.
2. A tracer runs client → edge → gateway → authentication → Cedar authorizer
   and stops there with a red burst. The card says **Deny**, determined by
   `forbid-cross-tenant`.
3. Switch the principal to **Alice** and the action to **View ledger**.
   **Allow**, determined by `finance-view-ledger`; the tracer continues to the
   ledger.
4. Choose **Export ledger** for Alice with _Fresh MFA assertion_ **Absent**.
   **Deny**, and Cedar's own diagnostic explains that the policy errored on a
   missing attribute. Set it to **True**: **Allow**.
5. Switch off `forbid-destructive-outside-change-window` and try **Carol**
   deleting a customer.

These decisions come from the `cedar-policy` engine evaluating the policies
shown in the panel. Nothing is scripted.

## 6 · The other four incidents

| Scenario                       | What to look for                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Credential Stuffing**        | The identity service saturates on failed logins; rate limiting at the gateway relieves it; the few valid credentials are still denied by Cedar for lacking MFA. |
| **Cedar Authorization Denial** | The denial rate on the HUD rises; the prohibited principal's traffic stops at the authorizer; after _Session revoked_ it stops at authentication instead.       |
| **Cascading Service Failure**  | The orders database degrades, its callers fail, the order queue backs up; circuit breakers stop the spread; the backlog drains after a replica is promoted.     |
| **Regional Outage**            | EU West goes dark; the edge router withdraws it; US East absorbs the traffic; the region is restored and traffic rebalances.                                    |

## 7 · Recorded incidents

The selector at the right of the timeline loads a prerecorded fictional
incident. Its whole history is available immediately: scrub anywhere.

- **Black Friday Flood** — a flood followed by a database cascade.
- **Insider Probe, Then Darkness** — a Cedar denial, credential stuffing and a
  regional outage.

A recording is only a seed and a list of commands; the engine re-simulates it
identically every time.

## 8 · Scale and fallbacks

- Switch the environment (top left) to **Hyperscale Stress**: 178 services and
  648 connections in six regions, rendered in the same handful of draw calls.
- Toggle **Regions / Dependencies** (bottom right) for a layered dependency
  view.
- Press <kbd>T</kbd> for the table view: the whole topology without 3D,
  usable with a screen reader.
- Press <kbd>P</kbd> for the performance overlay.
- **Settings** lets you force the WebGL 2 backend, change quality or reduce
  motion.

## 9 · Connected Mode (optional)

Open **Integrations**. The two fixture providers can be imported right away:
their events appear on the timeline labelled _Recording_.

To evaluate with a real [`cedar-agent`](https://github.com/cleissonbarbosa/cedar-agent):

```bash
cedar-agent --port 8180                                   # terminal 1
AEGIS_CEDAR_AGENT_URL=http://127.0.0.1:8180 \
AEGIS_CEDAR_AGENT_SYNC=true cargo run --release -p aegis-server
```

Press **Connect** on the Cedar Agent card, then choose `cedar-agent` as the
engine in the Authorization tab. `AEGIS_CEDAR_AGENT_SYNC=true` uploads the
synthetic policies and entities and replaces whatever the agent held. See
[INTEGRATIONS.md](INTEGRATIONS.md).

## Reproducing the screenshots

Every image in `docs/assets` comes from the running application:

```bash
cargo build --release -p aegis-server && pnpm build
./scripts/capture-docs.sh
```

# Demo guide

A five-minute tour that shows everything AEGIS does. Start it first:

```bash
docker compose up --build        # then open http://localhost:8080
```

or, without Docker:

```bash
cargo run --release -p aegis-server      # terminal 1: API on 127.0.0.1:8787
pnpm install && pnpm dev:web             # terminal 2: UI on http://localhost:5173
```

Demo Mode needs no credentials, accounts or network access.

## 1 · Read the model (30 s)

The page opens on the model and little else: a sentence at the top, a strip
of timeline at the bottom. You are looking at **Helios Commerce**, a
fictional platform of 51 services in three cloud regions around a global
edge, drawn as a scale model that assembles itself as it loads.

- The raised plate in the middle is the edge: clients (pawns) on its rim, the
  edge router (a desk globe) at the centre, the threat monitor (a lighthouse)
  on a mast above it.
- Each lower plate is a region. Tiers run outward from the gateway, an arch,
  to the data stores, stacks of platters.
- Beads are requests. How many there are follows the request rate; hollow
  ones are responses returning to the caller.
- Every kind of service has its own shape. Press <kbd>?</kbd> for the legend.
- Nothing has a colour, and the top bar says "51 services, all normal". That
  is the point: colour is kept for things that go wrong.

Drag to orbit, scroll to zoom, right-drag to pan. Point at a service and its
connections take ink. Double-click a service to move in on it, or a plate to
frame its region; names appear as you get closer. <kbd>R</kbd> resets the
camera.

## 2 · Inspect a service (30 s)

Click the **API Gateway** in US East. The piece lifts, its connections are
redrawn outward from it, the rest of the model recedes, and the inspector
slides in from the right. It shows throughput, latency, error rate and
saturation, each with 90 seconds of history drawn against its normal range,
every connection in both directions, and the events that involved it. Follow
a connection to walk the dependency graph. <kbd>Esc</kbd> lets go of the
selection and the inspector leaves with it.

Press <kbd>/</kbd>: the explorer opens with the search box focused. Type
`database eu-west` and everything else dims in the model. Clear the filter.
<kbd>Ctrl</kbd> <kbd>K</kbd> reaches any service, region, scenario or action
by name without opening anything.

Click the sentence "51 services, all normal" for the platform overview: the
four signals (traffic, latency, errors, saturation) on scales with their
normal ranges, the regions, and anything that needs attention.

## 3 · Launch an incident (90 s)

Open the explorer (the button at the top left) and its **Incidents** tab,
and start **DDoS Surge**. Set the speed to **2×**.

Watch, in order:

1. A stream of magenta triangles (suspicious traffic) leaves _Unattributed
   Sources_ and pours through the edge router into the US East gateway. It is
   the first colour to appear on the screen.
2. The gateway turns red with a jolt, a lamp lights on its plate and the
   plate itself takes a red outline. The sentence in the top bar names the
   incident and blinks until you press it. Next to it, the signals that have
   left their normal range appear, and only those. Services behind the
   gateway turn amber, then red.
3. The threat monitor raises **Volumetric attack detected**.
4. Mitigation engages by itself: the stream now stops at the edge router as
   amber bars (rejected), and the model returns to neutral.

The console lists the phases, the affected services and every event. Runs of
"this service changed state" are folded into one line so the cause stays
visible; press one to unfold it.

## 4 · Travel in time (60 s)

- Press **Pause**. Virtual time stops.
- Reach for the timeline strip at the bottom: it opens into a chart of
  traffic and errors with the incident marked. Drag the playhead back to
  before the red band. The model, the signals and every inspector return to
  exactly that moment.
- Press **Play**: you are replaying recorded history, re-simulated bit for
  bit. The bar says _Replay_.
- Press **Live** to jump back to the head.
- Click any event in the console, then **Jump to this moment**.

Start a different scenario while in the past and the timeline _branches_: the
old future is discarded and a new one is made from there.

## 5 · Ask Cedar (60 s)

Open the **Authorization** tab (key icon).

1. Principal **Mallory**, action **Export ledger**, resource **Acme ledger
   2026**. Press **Evaluate with Cedar**.
2. A tracer runs client → edge → gateway → authentication → Cedar authorizer
   and stops there with a ring. The card says **Deny**, determined by
   `forbid-cross-tenant`. Deny is solid ink, not red: the policy did its job.
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

| Scenario                       | What to look for                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Credential Stuffing**        | The identity service saturates on failed logins; rate limiting at the gateway relieves it; the few valid credentials are still denied by Cedar for lacking MFA.                              |
| **Cedar Authorization Denial** | The share of checks denied rises (platform figures in the overview); the prohibited principal's traffic stops at the authorizer; after _Session revoked_ it stops at authentication instead. |
| **Cascading Service Failure**  | The orders database degrades, its callers fail, the order queue backs up; circuit breakers stop the spread; the backlog drains after a replica is promoted.                                  |
| **Regional Outage**            | The EU West plate goes dark and its pieces pale; the edge router withdraws the region; US East absorbs the traffic; the region is restored and traffic rebalances.                           |

## 7 · Recorded incidents

The selector under the list of scenarios, in the **Incidents** tab, loads a
prerecorded fictional incident. Its whole history is available immediately:
scrub anywhere.

- **Black Friday Flood**: a flood followed by a database cascade.
- **Insider Probe, Then Darkness**: a Cedar denial, credential stuffing and a
  regional outage.

A recording is only a seed and a list of commands; the engine re-simulates it
identically every time.

## 8 · Scale and fallbacks

- Switch the environment (top left) to **Hyperscale Stress**: 178 services and
  648 connections in six regions, rendered in the same handful of draw calls.
- Toggle **Regions / Dependencies** (top right) for a layered dependency
  view on a single board. The pieces walk to their new places.
- **Settings** has a night theme. The rules do not change: in the dark, too,
  the only colour is a problem.
- Press <kbd>T</kbd> for the table view: the whole topology without 3D,
  usable with a screen reader.
- Press <kbd>P</kbd> for the performance overlay.
- **Settings** also lets you force the WebGL 2 backend, change quality or
  reduce motion, which switches every animation off.

## 9 · Connected Mode (optional)

Open **Integrations** (the plug in the top bar). The two fixture providers can be imported right away:
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

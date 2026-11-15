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

## 1 · Read the overview (30 s)

The page opens on the model and one bar above it. You are looking at
**Helios Commerce**, a fictional platform of 51 services in three cloud
regions, drawn as a scale model that assembles itself as it loads. It opens
on the **overview**: the platform reduced to its twelve kinds of service.

- The four plates are the layers a request crosses, in order: **entry**
  (clients, the edge router, the API gateways), **identity** (authentication,
  the Cedar authorizers, threat detection), **compute** and **data**. How far
  into the picture a piece stands is how far along the path it is.
- A piece stands for every service of its kind and says how many: "3 API
  gateways", "10 databases". Its figures are theirs, added up.
- Beads are requests. How many there are follows the request rate; hollow
  ones are responses returning to the caller.
- Every kind of service has its own shape. **⋯** in the top bar has the
  legend, or press <kbd>?</kbd>.
- Nothing has a colour, and the top bar says "51 services, all normal". That
  is the point: colour is kept for answers.

Drag to orbit, scroll to zoom, right-drag to pan. Point at a piece and its
connections turn blue: blue is always you. <kbd>R</kbd> resets the camera.

## 2 · From a kind to a service (45 s)

Click the **Cedar authorizers**. The piece lifts, its connections are redrawn
outward from it in blue, the rest of the model recedes, and a card arrives
on the right. It shows the three authorizers together: throughput, latency,
error rate and the fullest instance, each with 90 seconds of history against
its normal range, how many checks are being made and what share is denied.
Under it are the three instances, by region.

Click the one in **US East**. The model changes to the arrangement by region
(a hub, the global edge, with a round plate per region) and that authorizer
is selected in it. Its card lists what it calls and what calls it; follow a
connection to walk the dependency graph. <kbd>Esc</kbd> lets go of the
selection and the card leaves with it. **Overview**, at the top right, goes
back to the twelve pieces; **Dependencies** lays every service out by tier,
and the pieces walk there.

Press <kbd>/</kbd>: the list of services opens with the search box focused.
Type `database eu-west` and everything else dims in the model. Clear the
filter. <kbd>Ctrl</kbd> <kbd>K</kbd> reaches any service, region, scenario
or action by name without opening anything.

Click the sentence "51 services, all normal" for the platform's own signals
(traffic, latency, errors, saturation) on scales with their normal ranges,
the regions, and anything that needs attention.

## 3 · Follow a request (60 s)

Go back to the **Overview**, open **⋯** and choose **Trace a request through
Cedar**.

1. Principal **Mallory**, action **Export ledger**, resource **Acme ledger
   2026**. Press **Evaluate with Cedar**.
2. A blue request travels the path, and the camera goes a little of the way
   with it: clients, edge router, gateways, identity, and on to the Cedar
   authorizers, where it is stopped. A red badge with a cross lands on the piece, the path stays
   drawn, and everything off it recedes. The card says **Deny**, determined
   by `forbid-cross-tenant`. The red does not mean something broke: it marks
   where the request you chose to follow ended.
3. Switch the principal to **Alice** and the action to **View ledger**.
   **Allow**, determined by `finance-view-ledger`; the request continues to
   the data layer.
4. Choose **Export ledger** for Alice with _Fresh MFA assertion_ **Absent**.
   **Deny**, and Cedar's own diagnostic explains that the policy errored on a
   missing attribute. Set it to **True**: **Allow**.
5. Switch off `forbid-destructive-outside-change-window` and try **Carol**
   deleting a customer.

These decisions come from the `cedar-policy` engine evaluating the policies
shown in the card. Nothing is scripted. Close the card and the path is put
away with it.

## 4 · Launch an incident (90 s)

Press **Explore an incident** in the top bar and start **DDoS Surge**. The
timeline, which was not on the screen, rises at its foot; set the speed
there to **2×**.

Watch, in order:

1. A stream of magenta triangles (suspicious traffic) leaves the external
   clients and pours through the edge router into the gateways. It is the
   first colour to appear on the screen. That route stays in front and the
   rest of the model recedes.
2. A lamp lights under the gateways while their piece stays neutral: one of
   the three is in trouble, not all of them. The edge router, which is one
   service, turns red with a jolt. The sentence in the top bar names the
   incident and blinks until you press it; next to it, the signals that have
   left their normal range appear, and only those.
3. The threat monitor raises **Volumetric attack detected**.
4. Mitigation engages by itself: the stream now stops at the edge router as
   amber bars (rejected), a badge marks where it is being stopped, and the
   model returns to neutral.

The console lists the phases, the affected services and every event. Runs of
"this service changed state" are folded into one line so the cause stays
visible; press one to unfold it. Switch to **Regions** to see the same
incident by place: the camera moves in on the route, and the plate of the
region under attack takes a red outline.

## 5 · Travel in time (60 s)

- Press **Pause**. Virtual time stops.
- Reach for the strip in the timeline: it opens into a chart of traffic and
  errors with the incident marked. Drag the playhead back to before the red
  band. The model, the signals and every card return to exactly that moment.
- Press **Play**: you are replaying recorded history, re-simulated bit for
  bit. The bar says _Replay_.
- **Replay the incident** goes back to where the latest one began.
- Press **Live** to jump back to the head.
- Click any event in the console, then **Jump to this moment**.

Start a different scenario while in the past and the timeline _branches_: the
old future is discarded and a new one is made from there.

## 6 · The other four incidents

| Scenario                       | What to look for                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Credential Stuffing**        | The identity service saturates on failed logins; rate limiting at the gateway relieves it; the few valid credentials are still denied by Cedar for lacking MFA.                                                                                                            |
| **Cedar Authorization Denial** | The share of checks denied rises (platform figures in the overview); the prohibited principal's traffic stops at the authorizer; after _Session revoked_ it stops at authentication instead.                                                                               |
| **Cascading Service Failure**  | The orders database degrades, its callers fail, the order queue backs up; circuit breakers stop the spread; the backlog drains after a replica is promoted.                                                                                                                |
| **Regional Outage**            | Best watched by **Regions**: the EU West plate goes dark and its pieces pale; the edge router withdraws the region; US East absorbs the traffic; the region is restored and traffic rebalances. In the overview a lamp lights under every kind that has an instance there. |

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
  648 connections in six regions. Its overview is the same twelve pieces,
  with larger numbers on them. **Regions** and **Dependencies** show all 178,
  rendered in the same handful of draw calls.
- **Settings**, under **⋯**, has a night theme. The rules do not change: in
  the dark, too, a colour is an answer.
- Press <kbd>T</kbd> for the table view: the whole topology without 3D,
  usable with a screen reader.
- Press <kbd>P</kbd> for the performance overlay.
- **Settings** also lets you force the WebGL 2 backend, change quality or
  reduce motion, which switches every animation off.

## 9 · Connected Mode (optional)

Open **Integrations** (the note in the top bar that says the data is simulated). The two fixture providers can be imported right away:
their events appear on the timeline labelled _Recording_.

To evaluate with a real [`cedar-agent`](https://github.com/cleissonbarbosa/cedar-agent):

```bash
cedar-agent --port 8180                                   # terminal 1
AEGIS_CEDAR_AGENT_URL=http://127.0.0.1:8180 \
AEGIS_CEDAR_AGENT_SYNC=true cargo run --release -p aegis-server
```

Press **Connect** on the Cedar Agent card, then choose `cedar-agent` as the
engine in the request tracer. `AEGIS_CEDAR_AGENT_SYNC=true` uploads the
synthetic policies and entities and replaces whatever the agent held. See
[INTEGRATIONS.md](INTEGRATIONS.md).

## 10 · Your own platform (optional)

Stop the server and start it on the example workspace:

```bash
AEGIS_WORKSPACE=examples/corner-shop cargo run --release -p aegis-server
```

The model is now a six-service shop. **Explore an incident** offers the two
scenarios written for it; start **Receipt snooping** and the flow Cedar denies
ends at the Rulebook with a badge. In the request tracer, Ana reading a
receipt of the other shop is a **Deny** determined by
`other-shops-are-closed-books`, a policy from `cedar/shop.cedar`.

`aegis-server export-workspace ./my-platform` writes the bundled files out to
start from, and `check-workspace` validates a directory without starting
anything. The format is in [WORKSPACE.md](WORKSPACE.md).

## Reproducing the screenshots

Every image in `docs/assets` comes from the running application:

```bash
cargo build --release -p aegis-server && pnpm build
./scripts/capture-docs.sh
```

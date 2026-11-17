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

or with no server at all, the engine running in the browser tab:

```bash
pnpm build:static && pnpm --filter @aegis/web preview:static   # http://localhost:4173
```

Demo Mode needs no credentials, accounts or network access. Everything below
works the same on the static site except step 9, which needs the server.

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

Go back to the **Overview** and press **Test an authorization** in the top
bar (it is also in **⋯**, as **Trace a request through Cedar**).

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
5. With that **Allow** on screen, set _Fresh MFA assertion_ back to
   **False** and do not evaluate. The card says **Configuration changed.
   Evaluate again.**, shows the result as _Was Allow_ and lists what
   changed: a result is never shown as the answer to a form it was not
   asked.
6. Set it to **True** again, press **Keep to compare**, set it to **False**
   and evaluate. The two results stand side by side: Allow and Deny, the
   policy that decides each, and the one thing that differs.
7. Switch off `forbid-destructive-outside-change-window` and try **Carol**
   deleting a customer.

8. Look under any decision at **Policy by policy**. For Mallory's export it
   says which policy holds; for a denial by default, where Cedar names no
   policy, it says which permit came nearest and why it did not hold. Each
   line is Cedar asked about that one policy.

These decisions come from the `cedar-policy` engine evaluating the policies
shown in the card. Nothing is scripted. Close the card and the path is put
away with it.

**⋯ → Who may do what** asks Cedar every request the catalogue describes and
lays the answers out, principals down and actions across. Set the context or
switch a policy off and the cells that changed are marked; pick a cell and
**Trace it** to see that request cross the model. **Edit the policies** opens
the policies in force as Cedar text: change one, read what Cedar would decide
differently, and **Apply these policies** to come back to the matrix under
them. **Import or export files → Return to what the server started with**
undoes it.

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

Phases are timed from the start of the incident. Press one that has been
reached to see why: what the scenario _prescribed_ in it, what followed in
the _model_ (each service with the dependency it was traced along) and what
was _observed_. **Summary so far**, and afterwards the incident's entry
under **On this timeline**, give the whole of it: origin, propagation, peak
impact, recovery, and the moments to go back to. **Copy** takes it away as
text.

## 5 · Travel in time (60 s)

- Press **Pause**. Virtual time stops.
- Reach for the strip in the timeline: it opens into a chart of traffic and
  errors with the incident marked. Drag the playhead back to before the red
  band. The model, the signals and every card return to exactly that moment.
- Press **Play**: you are replaying recorded history, re-simulated bit for
  bit. The bar says _History_, and where the simulation's now is.
- **Replay the incident** goes back to where the latest one began.
- Press **Now** to jump back to the simulation's now.
- Click any event in the console, then **Jump to this moment**.

Start a different scenario while in the past and the timeline _branches_: the
old future is discarded and a new one is made from there.

## 5b · Change one thing (60 s)

Under **Cascading Service Failure**, press **Compare an intervention**. The
form starts on the service the scenario is about. Set the factor to **6**
and press **Run both**: the engine runs the incident twice from the same
seed, once as it is and once with six times the database's capacity placed
21 seconds in. The dialog says exactly what changed, lays errors, latency,
services affected and recovery side by side, and draws both runs. **Watch
run B on the timeline** puts it there to scrub. Below the form, **Run them
all** runs the same change at several figures and charts them.

To see what a fault would do before placing it, open a service, open
**Faults** on its card and choose one under **Try one first, without placing
it**. The card lists the services that would leave normal and when, and the
model brings them forward. Nothing has happened on the timeline. The same
card's **Exposure** says what the service could reach, how it is reached
from outside and how Cedar answers the requests that end at it.

## 5c · Take it with you

Open **⋯ → Save or share this session**. It lists what reproduces what is on
screen: the platform, the seed, each command with its time, the moment and
the view. **Copy a link** carries it in the address; **Save as a file**
carries the platform's files too when they are not the bundled ones. Opening
either shows the session first and simulates it again only when asked.

**⋯ → Guided challenges** asks six questions and checks the answers against
the model: where a cascade begins, where a flood is stopped, how to make
Cedar allow an export it denied, which rule stops a contractor, which region
goes dark, which deletion nobody may make. Each has a link that opens the
application on it.

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

Open **⋯**, choose **Import or export files**, then **Choose a folder** and
pick `examples/corner-shop`. The dialog lists what the files amount to; press
**Apply**. (Starting the server with
`AEGIS_WORKSPACE=examples/corner-shop` gives the same platform, and keeps it
across restarts.)

The model is now a six-service shop. **Explore an incident** offers the two
scenarios written for it; start **Receipt snooping** and the flow Cedar denies
ends at the Rulebook with a badge. In the request tracer, Ana reading a
receipt of the other shop is a **Deny** determined by
`other-shops-are-closed-books`, a policy from `cedar/shop.cedar`.

**Save as one file**, in the same dialog, downloads what is in use to edit
and import again, and **Return to what the server started with** brings
Helios back. From a terminal,
`aegis-server export-workspace ./my-platform` writes the bundled files out to
start from, `check-workspace` validates a directory without starting
anything, and `diff-workspace` lists what Cedar decides differently between
two of them. The format is in [WORKSPACE.md](WORKSPACE.md).

To write an incident of your own without leaving the page, press **Write a
scenario of your own** under the scenarios: name it, give each phase its
effects (by role, region or service) and the events it announces, and the
engine says whether it accepts the file and where it can run.

## Reproducing the screenshots

Every image in `docs/assets` comes from the running application:

```bash
cargo build --release -p aegis-server && pnpm build
./scripts/capture-docs.sh
```

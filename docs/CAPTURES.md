# Incident captures

An **incident capture** is a real incident, as a provider reported it or as
a system recorded it, read in the browser from a file. Apart from what a
connected local instance reports (labelled _live_), it is the one thing AEGIS
shows that is not simulated. It opens inside the application, in place of the
simulation, labelled _Captured, not simulated_ (or _From the
provider's report, not simulated_), and it never reaches the server or the
simulation's timeline. The simulation goes on untouched behind it, and
**Back to the simulation** returns to it as it was. A platform file can be
[drafted from a capture](#drafting-a-platform-from-a-capture) when you ask
for one; that file is the simulation's, not the capture's.

Two captures come with AEGIS:

| Capture                                         | What it is                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Cloud outage · 12 June 2025**          | A transcription by hand of Google Cloud's [public incident report](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW): twelve products and locations, and the state each update gives them. No measurements. |
| **Online Boutique · RCAEval · 15 January 2024** | Ten minutes of a public benchmark run around its injected fault, aggregated from the [RCAEval 0.2.0](#rcaeval-licence-and-attribution) archive: memory, calls and p95 durations every 30 seconds. No error counts.        |

Others are written by the three scripts in `scripts/` described below, from
CloudWatch Application Signals or from Tempo and Prometheus, on the
operator's own machine.

## Opening one

- **⋯ → Open an incident capture**, or the same command in the command
  palette (<kbd>Ctrl</kbd> <kbd>K</kbd>). The dialog lists the captures that
  come with AEGIS, each with its title, its source and its window in UTC, and
  **Open a capture file…**.
- **A link.** `?capture=google-cloud-2025-06-12` or
  `?capture=online-boutique-rcaeval` opens a bundled capture when the page
  loads, on the server build and on the static site alike. The address is
  read once and adds nothing to the history. An id that names no bundled
  capture is ignored, and the page shows the simulation.
- **A file** of at most 12 MiB, chosen in the dialog. It is read in the tab
  and sent nowhere. One that is larger, is not UTF-8 JSON, or is not a
  capture this version reads is refused in the dialog, which names the file
  and says why, and whatever was open stays open. A file is never named in
  the address.

Over a capture, the bar has a picker of the captures (the bundled ones and
the open file) on a screen at least 1280 pixels wide, and the chip carries
the capture's title on a narrower one. **⋯ → Open another capture** opens
the dialog again. A bundled capture that cannot be read when the picker, a
link or the browser's Back or Forward asks for it is reported, by name, in a
notice over the stage, and the one that was open stays open.

An embed (`?embed=1`) reaches no capture at all: it does not read
`?capture=`, its command palette has no capture command, the capture dialog
never opens in it, and Back and Forward show the simulation there.

Opening a capture from the interface adds one entry to the browser's history;
opening another one replaces it. So the browser's Back, **Back to the
simulation** (**Back** on a phone) and **⋯ → Back to the simulation** all
return to the simulation, and Forward opens the capture again. A file is
opened again by Forward only while the page that read it is still open.

## What is on screen

- **The bar.** The sentence of the capture at the cursor, prefixed by the
  time ("At 17:49 UTC: 6 services reported affected; 6 not stated"); it is
  faint while nothing is past the levels, affected or recovering, and bold in
  the colour and glyph of the worst state otherwise. Pressing it opens the
  events. The chip says where the figures come from (_Captured_ or
  _Reported_ on a narrow screen) and opens what the capture is: its title,
  source, window, sampling period, counts, how to read it and its notes, as
  written. **Services and events** opens the list. The menu holds the table
  view, another capture, the settings, the help and the way back. Nothing of
  the simulation is on it: no platform sentence, no instruments, no search,
  no tracer, no incidents.
- **The model**, in the arrangement by region only: a plate per region, the
  pieces in lines by kind, no hub and no direction of travel. Names on the
  model are the services' names as the file wrote them.
- **The capture's bar**, at the foot of the stage for as long as the capture
  is open: play, the UTC date and time with how far into the capture that is
  ("+5:00 into the capture"; on a phone, the day and month without the
  year, and no offset), the strip of the window, and the speed (10×, 60×,
  600× or 3600× of capture time per second; under a medium width the
  capture plays at its default). A capture opens paused at its start, at the
  smallest speed that plays its window within a minute. On the strip, a
  sample past the levels is a tick hanging from the top (short and amber at
  degraded, tall and red at critical), one per column of pixels at most,
  each the worst level of the samples in it; and an event is a mark shaped
  by what it states: a square for reported impact, a triangle for a recovery
  under way, a disc for a recovery, a short stroke for an update that states
  no condition. Events at one moment, or a few pixels apart, are set side by
  side around it where the strip has room for them all, each in its own
  shape; none is cut by an end of the strip. What is still to come lies
  under the strip's shade. On a phone, the time at an end of the strip is
  left out where a mark stands in its place.
- **The list**, in two tabs: the services by region with their state at the
  cursor, then the connections (past 64, listed only when asked for, with
  **Show** beside their heading); and the events in time order, with both
  clocks, dimmed after the cursor. Choosing an event moves the cursor to it,
  and selects its service when it names only one.
- **A card** comes with a selection and leaves with it: the service's name,
  its kind and region, where its kind comes from, its state at the cursor in
  words and glyph, the file's note on it, the events that name it and what
  it calls and is called by. On a measured capture it has each figure of the
  sample at the cursor with its course over the whole capture, broken where
  there was no measure.
- **The table view** (<kbd>T</kbd>, or with no GPU) lists the same by
  region: service, kind and state, and on a measured capture requests, error
  rate and p95.

| Key over a capture                                     | Action                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| <kbd>Space</kbd>                                       | Play or pause the capture                                                                           |
| <kbd>F</kbd>                                           | Move in on the selected service, or frame everything                                                |
| <kbd>/</kbd>                                           | The list of services, with the keyboard on the selected service's row (or on the Services tab)      |
| <kbd>Esc</kbd>                                         | Let go of the selection, then put the details away, then the list                                   |
| <kbd>← →</kbd>                                         | On the strip: one sampling period (a hundredth of the window without one); <kbd>Shift</kbd> for ten |
| <kbd>Home</kbd> <kbd>End</kbd>                         | On the strip: the start or the end of the capture                                                   |
| <kbd>R</kbd>, <kbd>T</kbd>, <kbd>P</kbd>, <kbd>?</kbd> | As in the simulation: reset the camera, table view, performance overlay, help                       |

<kbd>L</kbd> and <kbd>Ctrl</kbd> <kbd>K</kbd> do nothing over a capture: it
has one arrangement, and the palette's commands are the simulation's.

The keyboard is moved only where what held it went away. A page arrived at
by a link leaves it on nothing, with no mark of it on screen. Opening or
leaving a capture from a control that goes with the mode puts it on
**Play**, or on the stage once the simulation is back. Putting a sheet away
with the keyboard in it gives it back to what opens that sheet: **Services
and events** after the list, the chip after the details, and after a card
the service's row when the list is open, otherwise the chip where the
details take the card's place, or else the stage.

## Reading it

The rules are pure functions in
[`features/capture/capture.ts`](../apps/web/src/features/capture/capture.ts),
with their tests beside them. Everything the interface says of a capture is
read through them.

**A sample holds its own period.** In a measured capture the sample at a
moment is the one whose period, from its `atMs` up to the next period, holds
it; the last moment of the window belongs to the sample that ends there.
An earlier sample never stands in for a missing one.

**Unknown is not normal.** Traffic is known where that sample counts
requests. A state is known only where it also counts errors (the error rate
is errors over requests, at most 1), or where it counts no requests at all:
nothing passed, which is normal. Anywhere else the state is unknown, and is
said so: _No data_ where there is no sample, _Error rate not measured_ where
a sample has no error count, or no request count, to take a rate from. An
unknown service is drawn upright on a dashed ring without hue, a shade
fainter than a normal piece and never as faint as one that recedes, and it
never recedes. The bar's sentence never counts an unknown service among
those whose state is known.

**Colour is the simulation's error levels, applied as measured.** A known
state is degraded from an error rate of 4% and critical from 20%: the levels
at which the engine's node `classify` calls a service degraded or critical
([`lib/thresholds.ts`](../apps/web/src/lib/thresholds.ts), held to
`apps/server/src/simulation/engine.rs` by a test). They are not the 5%
objective the alert rules use. The card and the details say so in these
words: "Coloured by the error rates at which the simulation calls a service
degraded (4%) or critical (20%), applied to each sample as measured, without
the simulation's smoothing or delay. The source sets no threshold." A
measured capture with no error count anywhere colours nothing, and says that
instead: "This capture has no error counts, so no service in it is
coloured." Latency and memory never colour anything. A capture is never
shown as down.

**Only the error rate has a normal range.** On a card the error rate is
drawn against the band below 4% ("Normal below 4% (simulation
threshold)") and takes a colour only outside it. A rate just under a level
is never rounded up to it: it reads "<4.00%" or "<20.0%". Requests, errors,
p95 and peak memory have no band and no colour, because the source states none:
"No normal range: the source states none. Lowest–highest in this capture:
a–b." A connection is drawn with no errors where they were not measured,
and its card says _Not measured_ (or _No data_, where it has no sample).

**A pace is typical for this capture.** Each piece's working part runs at
its sample's requests per second against the median of its own measured
rates over the capture, so pace 1 is that service's usual traffic in this
window. For a service that carried nothing in most periods, that median is
taken over the periods in which it carried requests, so a piece that works
at all is measured against its own traffic, never another service's. Where
there is no request count at the cursor the piece rests as it was modelled,
and its stillness says nothing; where the sample's rate is under 2% of that
reference, no requests at all included, it stands still because next to
nothing passed.

**A provider report states, it does not measure.** A service becomes known
only through an event that has a `state` and names it, and stays as last
stated: _Reported affected_ is drawn as critical, _Reported recovering_ as
degraded and _Reported recovered_ as normal. "Reported impact is drawn as
critical and a reported recovery as degraded; the report does not grade how
severe the impact was." Before its first stated event a service reads _Not
stated at this time_; an event without a state changes nothing. A report has
no traffic, so every piece rests as modelled, and its connections are _Not
stated in the report_.

**The transcription says what it rests on.** In the Google capture a state
is placed at the time its statement says it held ("as of 17:10 PDT"); where
the statement gives no time for that product or location, at the
publication time of the update. Each event's detail opens with the update it
rests on, approximate times say "around", and the report's PDT times are
shown in UTC. The products shown, their connections and kinds, and the state
at each update are AEGIS's reading of the text, and the details card says
so. One service never receives a stated condition (Service Control's policy
tables outside us-central1), and Cloud Dataflow carries the note that the
report lists it among the affected products without saying when its impact
began.

**What the source counted is said.** A CloudWatch capture's errors are the
`Fault` metric and its requests the sample count of `Latency`; a Tempo
capture's errors are the service graph's failed-request counter. A card
says which under its measurements, in a capture that counts errors at all. A
CloudWatch capture's connections are those Application Signals found in its
discovery window, which the card states: a connection that was found may
not have carried requests at every moment.

## Drafting a platform from a capture

A capture shows what happened. To ask what would have happened with another
capacity, another connection or a filter in front, the incident has to be
on a platform the simulation computes. **⋯ → Draft a platform from this
capture** writes that platform's files in the page, leaves the capture and
stages them in **Import or export files**, with a list of what was measured
and what was not. Nothing is applied until you apply it, and the server
checks the draft as it checks any file.

The draft is a starting point to edit, labelled `synthetic` like every
platform: what it shows once applied is computed. Every rule it was written
by is in its own description:

| In the draft             | Where it comes from                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| services and their kinds | the capture's nodes, as written                                                                                                                                                                                            |
| connections              | the calls the capture saw, busiest first; one that would close a circle is left out and listed, since a topology runs one way                                                                                              |
| a connection's weight    | calls seen on it over the requests its caller handled, both as medians _at rest_ (before the capture's first event); 1 where the calls were not measured                                                                   |
| a service's own latency  | its median p95 at rest less that of what it calls, weighted by calls; a placeholder of 5 ms where p95 was not measured                                                                                                     |
| demand                   | one client added in front of every service nothing calls, sending the median those services handled at rest; 100 requests a second when the capture measured no calls                                                      |
| an entry's own rate      | where a service counted no requests of its own (traces begin there), it is taken to be as busy as its busiest call. A convention, said as one: the calls it makes downstream come out as measured whatever figure is taken |
| capacity                 | not given. No capture states one: each service has the model's default headroom over its load at rest                                                                                                                      |
| roles                    | the first API gateway, database, authentication service, authorizer and monitor, as the Compose reader names them                                                                                                          |

**Give `capacityRps` to the services whose limits you know before reading
what breaks.** Capacity decides what fails under load, and it is the one
figure a capture cannot give.

Where the capture measured traffic at its entry, the draft comes with a
scenario that repeats it: each period's demand as a multiple of its level at
rest, at most 32 phases, compressed in time when the capture is longer than
the 30 minutes a scenario may last (its summary says by how much). It
prescribes load and nothing else. What fails under that load is the model's
to compute, and comparing that with what the capture recorded is how the
draft's figures are judged.

A capture of a provider's report measures nothing, so its draft holds the
services and connections the report names and defaults for every figure.

## The format

A capture is one JSON file, version 1. `readCapture` refuses a file that
breaks any rule below rather than repairing it. Every time is Unix epoch
milliseconds.

| Field            | Meaning                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | `"aegis-incident-capture"`                                                                                                                                                |
| `version`        | `1`                                                                                                                                                                       |
| `title`          | 1–320 characters, shown as written                                                                                                                                        |
| `source`         | `kind` (`cloudwatch`, `tempo-prometheus`, `prometheus-recording` or `provider-report`), a `label`, and an optional `url`, which must be `https` (at most 2048 characters) |
| `window`         | `startMs` and `endMs`; the window must run forward                                                                                                                        |
| `topologyWindow` | Optional: where the source found the connections, same shape; it must overlap the window                                                                                  |
| `periodMs`       | The sampling period, 1 s to one day. Required as soon as anything has samples                                                                                             |
| `regions`        | 1–64 of `{ id, name }`                                                                                                                                                    |
| `nodes`          | 1–384 of `{ id, name, region, type, typeSource?, note?, buckets? }`                                                                                                       |
| `edges`          | Up to 2048 of `{ source, target, buckets? }`                                                                                                                              |
| `events`         | Up to 1500 of `{ atMs, title, detail?, nodes?, state? }`                                                                                                                  |
| `notes`          | Up to 40 strings of at most 1280 characters, shown as written                                                                                                             |

- **Ids** (of regions and nodes) are 1–80 letters, digits, `.`, `_` or `-`,
  unique, and everything that names one must name one that exists. A node's
  `type` is one of the seventeen service kinds of a topology
  ([WORKSPACE.md](WORKSPACE.md)).
- **`typeSource`** says where a node's kind comes from: `source`, mapped by
  the exporter from a resource type the platform reported; `declared`, named
  by the operator (`--type NAME=KIND`), which overrides the other two; or
  `assumed`, chosen by the exporter or the author by name or by default. A
  node without it is read as `assumed`. The card says which, in words.
- **`note`** is an optional string of at most 320 characters on a node,
  shown as written on its card.
- **Edges** go between two different nodes, one per direction: a pair may be
  connected both ways. They are calls seen, not a dependency graph, and need
  not be acyclic.
- **`buckets`** are samples, at most 1500 per node or edge, strictly
  ascending, each with an `atMs` that starts its period inside the window
  and before its end (`startMs` ≤ `atMs` < `endMs`), and any of `requests`,
  `faults`, `p95Ms` and `memoryBytes`, every value non-negative and at most
  10¹⁵ (`MAX_MEASURE`). Leave out what was not measured; an absent value is
  unknown, never zero. `faults` is a count of errors, shown as _errors_.
- **`events`** are inside the window, its end included, and are put in time
  order (the file's order at equal times). `detail` is at most 1280
  characters and `nodes` at most 384 ids (none, for an event about the
  whole capture). A provider report gives the named nodes a `state`:
  `affected`, `recovering` or `recovered`.

The two bundled files,
[`google-cloud-2025-06-12.json`](../apps/web/src/features/capture/google-cloud-2025-06-12.json)
and
[`online-boutique-rcaeval.json`](../apps/web/src/features/capture/online-boutique-rcaeval.json),
are an example of each kind of capture, a provider's report and
measurements. Every node in both is `assumed`.

## Writing one

The three scripts are tools for the operator, run on the operator's
machine. AEGIS never runs them, and they are not
[integrations](INTEGRATIONS.md): the server and the page never call them or
anything they read from. They use only Python 3's standard library. The two
exporters each write a new file and refuse to overwrite one, keep within the
limits above, and exit 0 when they wrote the file, 1 with `Capture failed:
…` when the export failed, and 2 for a usage error; `--help` lists their
options and the kinds.

**A capture can name your systems.** It holds service names, connections and
times from the account or the backends it was read from. A CloudWatch node
is named by Application Signals' `Name`, or else by its `Identifier`, which
can be an ARN with the account ID in it
(`arn:aws:dynamodb:eu-west-1:123456789012:table/orders`). Read a capture
before sharing it. Neither exporter writes a credential, a token, a profile
name or a backend address into it; a CloudWatch capture's source link is
the CloudWatch console of its region.

### CloudWatch Application Signals

`scripts/export-cloudwatch-capture.py` needs the AWS CLI v2 on the `PATH`,
and calls it with the profile the operator names (`--profile`) or, without
it, the CLI's default credential chain. The application must already send
telemetry to [CloudWatch Application
Signals](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Sections.html).
Copy the exact service and environment names from its service list, and
choose a past window that starts before the first symptom and ends after
recovery.

```bash
python3 scripts/export-cloudwatch-capture.py \
  --profile observability \
  --region us-east-1 \
  --environment staging \
  --service checkout \
  --start 2026-11-17T14:00:00Z \
  --end 2026-11-17T15:00:00Z \
  --output checkout-incident.json
```

```text
  --service payment                 # another root; repeatable
  --title "Checkout outage, 17 Nov" # 1–320 characters
  --cloudtrail-resource checkout    # repeatable; adds CloudTrail events
  --type orders-db=database         # repeatable; declares a kind
```

It walks the dependencies Application Signals discovered from each root
(each must match exactly one instrumented service in the environment), over
the window widened to whole hours, which it writes as `topologyWindow`. It
then reads a sample for every node and connection: errors are the `Fault`
metric, requests the sample count of `Latency`, and p95 is given only where
there is one latency series. The sampling period is 60 s for a window that
starts less than 15 days ago, 300 s for one less than 63 days ago and an
hour otherwise, made longer so that a series has at most 720 samples; a
window that would need more than a day is refused. A series is judged by
the status it ends on. One that ends on `PartialData`, a page that reports
a status other than `Complete` or `PartialData` (such as `InternalError` or
`Forbidden`), or a capture in which no service has a sample makes the
capture note that CloudWatch returned incomplete or empty series; a series
that continues on a later page and ends `Complete` does not.

- **Kinds.** A node is `source` where Application Signals reports a resource
  type in the exporter's table (API Gateway, ECS, EKS, Lambda, RDS,
  DynamoDB, S3, SNS, SQS), and an `assumed` microservice everywhere else,
  every instrumented service included.
- **Regions.** An instrumented service is in `--region`. A dependency is in
  the region its ARN names, or else in one called "Location not reported",
  never in its caller's.
- **CloudTrail**, only with `--cloudtrail-resource`: one lookup per distinct
  resource name, with that one name and exactly the capture's window. It
  keeps write management events only, each once, as event name, source and
  ID; the event payload and the user name are never copied. Without the
  flag nothing is looked up and the capture says that it does not show
  configuration changes. CloudTrail answers from 90 days of history, and the
  capture says so when its window starts earlier.

It makes read calls only, and a least-privilege policy for the profile is
these four actions. Application Signals' `ListServices` and
`ListServiceDependencies` and CloudTrail's `LookupEvents` take no resource
type, and `GetMetricData` names only an optional `dataset` type for OTLP
metric datasets, which the exporter does not read, so `Resource` is `"*"`
(AWS Service Authorization Reference, read 18 November 2026). Leave out the
second statement if you never pass `--cloudtrail-resource`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AegisCaptureRead",
      "Effect": "Allow",
      "Action": [
        "application-signals:ListServices",
        "application-signals:ListServiceDependencies",
        "cloudwatch:GetMetricData"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AegisCaptureCloudTrail",
      "Effect": "Allow",
      "Action": "cloudtrail:LookupEvents",
      "Resource": "*"
    }
  ]
}
```

### Tempo and Prometheus

`scripts/export-otel-capture.py` reads Tempo's
[service-graph metrics](https://grafana.com/docs/tempo/latest/metrics-from-traces/service_graphs/)
from a Prometheus-compatible backend, and a bounded sample of error traces
from Tempo's query frontend. Enable the service-graphs processor in Tempo or
Alloy and send its counters and its classic server-duration histogram to
that backend; choose a period that holds several scrapes and a window within
both backends' retention.

```bash
python3 scripts/export-otel-capture.py \
  --tempo-url http://localhost:3200 --prometheus-url http://localhost:9090 \
  --service checkout --start 2026-11-17T14:00:00Z --end 2026-11-17T15:00:00Z \
  --period 60 --output checkout-otel.json
```

```text
  --label cluster=staging                    # Prometheus scope label; repeatable
  --trace-resource k8s.cluster.name=staging  # Tempo resource attribute; repeatable
  --trace-limit 10                           # error traces to read, 1–100
  --type redis=database                      # repeatable; declares a kind
```

- **Tokens go only over HTTPS or to this machine.** `TEMPO_TOKEN` and
  `PROMETHEUS_TOKEN` are sent as bearer tokens, and `TEMPO_TENANT` and
  `PROMETHEUS_TENANT` as `X-Scope-OrgID`. With a token set, a URL that is
  not `https://` must be a loopback host (`localhost`, 127.0.0.0/8 or
  `::1`), or the exporter stops before any request, naming the variable and
  the host and never the token. Redirects are never followed, and a
  loopback backend is always asked directly, never through a proxy from the
  environment (`http_proxy`, `https_proxy`), so a token over plain HTTP
  reaches only this machine. Any other backend is reached through the
  environment's proxies, and a token goes to it only over HTTPS. A backend
  URL may carry no credentials, query or fragment.
- **Every request is a GET:** three range queries for the request, failed
  request and duration series, a trace search, and at most `--trace-limit`
  traces. Each answer is at most 16 MiB.
- **What it holds.** The graph is the named service and its connections one
  hop either way. Counts are increases per complete period (Prometheus
  extrapolates, so they can be fractional) and p95 is in milliseconds, given
  for a node only when one connection comes into it. A node sums a period
  only when every connection into it has it. A missing value, and a
  negative, NaN or infinite one, is left out; where a connection has no
  failed-request series in a period, its errors are not measured there, and
  the capture says so. Error spans give events with their operation, trace
  ID and start time; their sampling is not the counters'.
- **Kinds and places are not stated.** Every service is an `assumed`
  microservice unless `--type` declares it, and every one is in a region
  called "Location not reported".

### Declaring a kind

Both exporters take `--type NAME=KIND`, repeatable. NAME is everything before
the last `=` and must equal exactly one node's `name` as the capture writes
it (case included); KIND is one of `api-gateway`, `auth-service`,
`cedar-authorizer`, `microservice`, `container`, `serverless`,
`message-queue`, `database`, `storage`, `network-gateway`,
`security-monitor`, `external-client`, `load-balancer`, `virtual-machine`,
`kubernetes-cluster`, `cache`, `event-stream`, the list a test holds to
`schemas/v1/topology.schema.json`. A kind outside it is a usage error before
anything is read. A name no node has, or several have, or a name declared
twice stops the export before any metric is read (CloudWatch) or Tempo is
asked (Tempo and Prometheus). The node gets `typeSource: "declared"`.

### The Online Boutique capture

`scripts/capture-rcaeval.py` rebuilds the bundled Online Boutique capture
from `multi-source-data.zip`, the asset of RCAEval release 0.2.0, and
refuses any other archive (its SHA-256 is pinned). It writes the capture to
standard output:

```bash
python3 scripts/capture-rcaeval.py multi-source-data.zip \
  > apps/web/src/features/capture/online-boutique-rcaeval.json
pnpm exec prettier --write apps/web/src/features/capture/online-boutique-rcaeval.json
```

It takes the ten minutes around the timestamp in the archive's
`inject_time.txt`. Each 30-second sample of a service holds the highest
memory gauge the metrics file publishes in it; calls and p95 durations
(nearest rank) come from cross-service spans of the traces file whose parent
is known. It takes no error counts, so every measured service reads _Error
rate not measured_; it states no kinds, so redis is assumed a database and
every other service a microservice; and it is given no location. Its two
events are the injection time, which says when and nothing about a cause,
and the first sample at the checkout service's highest memory after it,
left out with a note when there is none. "Fault injection" and "Benchmark
fault injected" are RCAEval's words, shown as written: a capture's fault is
its source's, not one placed by hand in AEGIS.

`scripts/test_capture_rcaeval.py` runs the rebuild on a small synthetic
archive, and holds the committed file to everything the script writes
without the archive (kind, version, title, source, period, regions, notes,
the order of its keys, the event titles, the injection event's detail and
each node's kind and `typeSource`) and to the shape of its values (sample
times aligned and inside the window, the peak event equal to the memory
series). The values themselves can only be compared with a rebuild from the
archive, which is not in the repository; with it, this compares the two
whatever the formatting of either:

```bash
python3 scripts/capture-rcaeval.py multi-source-data.zip > rebuilt.json
diff <(jq -S . rebuilt.json) \
  <(jq -S . apps/web/src/features/capture/online-boutique-rcaeval.json)
```

### Tests

```bash
python3 -B -m unittest discover -s scripts -p 'test_*.py'   # as CI runs it
python3 -B scripts/test_export_otel_capture.py -k token     # one file, narrowed by name
```

The tests use fakes for the AWS CLI, Tempo and Prometheus, and a synthetic
archive for RCAEval; nothing is fetched. How the exporters behave against a
live AWS account, Tempo or Prometheus is not covered by them.

## RCAEval licence and attribution

The Online Boutique capture is derived from `multi-source-data.zip`, an asset
of [RCAEval release 0.2.0](https://github.com/phamquiluan/RCAEval/releases/tag/0.2.0)
by Luan Pham et al. RCAEval's README at that release distributes the
authors' code and datasets under the MIT License (Copyright (c) 2024 Luan
Pham; [LICENSE at 0.2.0](https://github.com/phamquiluan/RCAEval/blob/0.2.0/LICENSE)).
The capture holds aggregates computed from the archive by
`scripts/capture-rcaeval.py` (30-second memory maxima, call counts and p95
durations of cross-service spans), not the archive itself.

Cite: L. Pham, H. Zhang, H. Ha, F. Salim, X. Zhang, _RCAEval: A Benchmark for
Root Cause Analysis of Microservice Systems with Telemetry Data_, WWW '25
Companion, [doi:10.1145/3701716.3715290](https://doi.org/10.1145/3701716.3715290).

The Google Cloud capture is AEGIS's transcription of Google Cloud's public
[incident report](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW)
of 12 June 2025, its status updates and its mini and full incident reports;
each event names the update it rests on.

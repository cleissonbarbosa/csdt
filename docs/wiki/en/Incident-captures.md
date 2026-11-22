**English** · [Português](Capturas-de-incidente)

An **incident capture** is a real incident, as a provider reported it or as
a system recorded it, read by your browser from a file and shown in the same
model as the simulation. Apart from what a connected local instance reports
(labelled _live_), it is the one thing AEGIS shows that is not simulated.

> **A capture is not the simulation.** It never reaches the server or the
> simulation's timeline, and nothing in it is placed there. It is not a
> _replay_ (the simulation's re-simulated history) nor a _recorded_
> incident (the simulation's own): those words belong to the simulation.

## What a capture is

- **Labelled as not simulated.** The chip in the bar says **Captured, not
  simulated**, or **From the provider's report, not simulated** for a
  transcribed report (**Captured** or **Reported** on a narrow screen). Its
  provenance is `recording`, labelled "Capture".
- **Read in the tab.** A file is read in the page, checked against the
  capture format and held in memory. It is not uploaded, not written to
  storage, never named in the address, and gone on reload.
- **A mode of the same shell.** While a capture is open the simulation goes
  on untouched behind it, and nothing in the interface acts on it.
  **Back to the simulation** returns to it as you left it.
- **Shown as written.** Titles, names, notes and event texts are the file's,
  and times are UTC with the offset into the capture.

## Opening a capture

| Way                                                                                                         | What happens                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **⋯ → Open an incident capture**, or the same command in the command palette (<kbd>Ctrl</kbd> <kbd>K</kbd>) | A dialog lists the captures that come with AEGIS, each with its title, source and window in UTC, and **Open a capture file…**                                                                      |
| A link with `?capture=google-cloud-2025-06-12` or `?capture=online-boutique-rcaeval`                        | Opens that bundled capture when the page loads, on a server and on the static site alike. The address is read once and adds nothing to the history; an id that names no bundled capture is ignored |
| **Open a capture file…**, with a file of at most 12 MiB                                                     | The file is read in the tab and sent nowhere. One that is larger, is not UTF-8 JSON or is not a capture this version reads is refused in the dialog, which names the file and says why             |

Once a capture is open, **⋯ → Open another capture** opens the dialog
again, and on a screen at least 1280 pixels wide the bar has a picker of the
captures. Opening a capture adds one entry to the browser's history, so the
browser's Back, **Back to the simulation** (**Back** on a phone) and
**⋯ → Back to the simulation** all return to the simulation, and Forward
opens the capture again. A file opens again by Forward only while the page
that read it is still open.

An embed (`?embed=1`) reaches no capture at all: it ignores `?capture=`,
its command palette has no capture command and the dialog never opens.

## The two bundled captures

| Capture                                         | Source                                                                                                                          | What it holds                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Google Cloud outage · 12 June 2025**          | A hand transcription of Google Cloud's [public incident report](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) | Twelve products and locations, and the state each update of the report gives them. No measurements                                 |
| **Online Boutique · RCAEval · 15 January 2024** | Aggregates of the [RCAEval 0.2.0](#rcaeval-licence-and-attribution) archive                                                     | Ten minutes of a public benchmark run around its injected fault: memory, calls and p95 durations every 30 seconds. No error counts |

In both, the kind of every service is _assumed_: neither source states one.

## What is on screen

- **The bar** says what the capture states at the cursor, prefixed by the
  time ("At 17:49 UTC: 6 services reported affected; 6 not stated"). It is
  faint while nothing is past the levels, affected or recovering, and bold
  in the colour and glyph of the worst state otherwise; pressing it opens
  the events. The chip opens what the capture is: title, source, window,
  sampling period, counts, how to read it and its notes. **Services and
  events** opens the list. Nothing of the simulation is on the bar: no
  instruments, no search, no request tracer, no incidents.
- **The model** is in the arrangement by region only: a plate per region,
  the pieces in lines by kind. A capture has no overview.
- **The capture's bar**, at the foot of the stage, has **Play**, the UTC
  date and time with how far into the capture that is ("+5:00 into the
  capture"), the strip of the window and the speed. A capture opens paused
  at its start.
- **The list** has two tabs. **Services** lists them by region with their
  state at the cursor, then the connections (past 64 of them, listed only
  when you press **Show**). **Events** lists them in time order with both
  clocks, dimmed after the cursor; choosing one moves the cursor to it.
- **A card** comes with a selection: the service's name, kind and region,
  where its kind comes from, its state at the cursor in words and glyph, the
  file's note on it, the events that name it and its connections. On a
  measured capture it shows each figure of the sample at the cursor with its
  course over the whole capture.
- **The table view** (<kbd>T</kbd>, or with no GPU) lists the same by region.

### The strip and the speeds

The speed is 10×, 60×, 600× or 3600× of capture time per second; a capture
opens at the smallest speed that plays its window within a minute.

| Mark on the strip                            | What it means                      |
| -------------------------------------------- | ---------------------------------- |
| A tick hanging from the top, short and amber | A sample past the degraded level   |
| A tick hanging from the top, tall and red    | A sample past the critical level   |
| A square                                     | Reported impact                    |
| A triangle                                   | A recovery under way               |
| A disc                                       | A recovery                         |
| A short stroke                               | An update that states no condition |

### Keys over a capture

| Key                                                    | Action                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| <kbd>Space</kbd>                                       | Play or pause the capture                                           |
| <kbd>F</kbd>                                           | Move in on the selected service, or frame everything                |
| <kbd>/</kbd>                                           | The list of services                                                |
| <kbd>Esc</kbd>                                         | Let go of the selection, then put the details away, then the list   |
| <kbd>←</kbd> <kbd>→</kbd>                              | On the strip: one sampling period; <kbd>Shift</kbd> for ten         |
| <kbd>Home</kbd> <kbd>End</kbd>                         | On the strip: the start or the end of the capture                   |
| <kbd>R</kbd>, <kbd>T</kbd>, <kbd>P</kbd>, <kbd>?</kbd> | As in the simulation: camera, table view, performance overlay, help |

<kbd>L</kbd> and <kbd>Ctrl</kbd> <kbd>K</kbd> do nothing over a capture: it
has one arrangement, and the palette's commands are the simulation's.

### A service whose state is unknown

Unknown is never drawn as normal. A service whose state the source does not
give stands upright on a dashed ring without hue, a shade fainter than a
normal piece, and never recedes. Its state reads _No data_ where there is no
sample, _Error rate not measured_ where a sample lacks the counts to take a
rate from, and _Not stated at this time_ in a report, before the report
names it. The bar's sentence never counts an unknown service among those
whose state is known.

## Reading a capture

Every rule is a pure function in
[`features/capture/capture.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/capture/capture.ts),
and everything the interface says of a capture is read through them.

### How a state is known

- **A sample holds its own period.** The sample at a moment is the one whose
  period holds it. An earlier sample never stands in for a missing one.
- **In a measured capture**, a state is known only where the sample counts
  both requests and errors (the error rate is errors over requests), or
  counts no requests at all: nothing passed, which is normal.
- **In a provider's report**, a service becomes known only through an event
  that names it and states a condition, and stays as last stated. The report
  does not grade severity, so impact is drawn as critical:

| The report says     | Shown as                           |
| ------------------- | ---------------------------------- |
| Reported affected   | Critical                           |
| Reported recovering | Degraded                           |
| Reported recovered  | Normal                             |
| Nothing yet         | Unknown, _Not stated at this time_ |

A report measures no traffic, so its pieces rest as modelled and its
connections read _Not stated in the report_.

### The error levels

Colour is the simulation's error levels applied to each sample as measured:
degraded from an error rate of 4%, critical from 20%. These are the levels
at which the engine's node classification calls a service degraded or
critical, copied in
[`lib/thresholds.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/lib/thresholds.ts)
and held to the engine by a test. They are not the 5% objective the alert
rules use. The card says so: "Coloured by the error rates at which the
simulation calls a service degraded (4%) or critical (20%), applied to each
sample as measured, without the simulation's smoothing or delay. The source
sets no threshold."

- Only the error rate has a normal range: "Normal below 4% (simulation
  threshold)". A rate just under a level reads "<4.00%" or "<20.0%", never
  rounded up.
- Requests, errors, p95 and peak memory have no band and no colour: "No
  normal range: the source states none."
- A measured capture with no error counts colours nothing and says so:
  "This capture has no error counts, so no service in it is coloured."
- Latency and memory never colour anything, and a capture is never shown as
  down.

### Pace and what the source counted

Each piece's working part runs at its sample's requests per second against
the median of its own measured rates over the capture, so its usual pace is
its usual traffic in that window. Where there is no request count the piece
rests as modelled, and its stillness says nothing.

A CloudWatch capture's errors are the `Fault` metric and its requests the
sample count of `Latency`; a Tempo capture's errors are the service graph's
failed-request counter. The card says which.

## Drafting a platform from a capture

A capture shows what happened. To ask what would have happened with another
capacity, connection or filter, the incident has to be on a platform the
simulation computes. **⋯ → Draft a platform from this capture** writes that
platform's files in the page, leaves the capture and stages them in the
dialog that **Import or export files** opens, with a list of what was
measured and what was not. Nothing is applied until you press **Apply**, and
the server checks the draft as it checks any file. The draft is labelled
`synthetic`, like every platform.

| In the draft             | Where it comes from                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Services and their kinds | The capture's services, as written                                                                                      |
| Connections              | The calls the capture saw, busiest first; one that would close a circle is left out and listed                          |
| A connection's weight    | Calls on it over the requests its caller handled, both medians at rest (before the first event); 1 where not measured   |
| A service's own latency  | Its median p95 at rest less that of what it calls; a placeholder of 5 ms where p95 was not measured                     |
| Demand                   | One client in front of every service nothing calls, sending their median at rest; 100 requests a second otherwise       |
| An entry's own rate      | Where an entry counted no requests of its own, it is taken to be as busy as its busiest call: a convention, said as one |
| Capacity                 | Not given. No capture states one: each service has the model's default headroom over its load at rest                   |

**Give `capacityRps` to the services whose limits you know before reading
what breaks.** Capacity decides what fails under load, and it is the one
figure a capture cannot give.

Where the capture measured traffic at its entry, the draft also holds a
scenario that repeats it: each period's demand as a multiple of its level at
rest, in at most 32 phases, compressed in time when the capture is longer
than the 30 minutes a scenario may last. It prescribes load and nothing
else; what fails under it is the model's to compute. A report measures
nothing, so its draft holds the services and connections the report names
and defaults for every figure.

A draft is the one thing that leaves a capture, and only when you ask for
it. Staging it sends it to the server to be checked, and applying it shows
its service names to everyone connected, as any import does; on a server
other people reach, draft a capture of a real system only if its names may
be seen there. The static site keeps the draft in the tab. Nothing else of
the capture goes with it: no sample series, no event, no note, no source
link.

## Writing a capture of your own

Three scripts in `scripts/` write captures. They are tools you run on your
own machine with your own access, using only Python 3's standard library.
AEGIS never runs them, and they are not [integrations](Integrations). The
two exporters write a new file and refuse to overwrite one, and exit `0`
when they wrote it, `1` with `Capture failed: …` when the export failed and
`2` for a usage error. `--help` lists their options and the kinds.

> **A capture can name your systems.** It holds service names, connections
> and times from the account or backends it was read from; a CloudWatch
> node can be named by an ARN with the account ID in it. Read a capture
> before you share it. Neither exporter writes a credential, a token, a
> profile name or a backend address into it.

### From CloudWatch Application Signals

`scripts/export-cloudwatch-capture.py` needs the AWS CLI v2 on the `PATH`
and uses the profile you name with `--profile` or, without it, the CLI's
default credential chain. The application must already send telemetry to
Application Signals. Copy the exact service and environment names from its
service list, and choose a past window that starts before the first symptom
and ends after recovery.

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

| Option                       | Effect                                                                |
| ---------------------------- | --------------------------------------------------------------------- |
| `--service NAME`             | Another root service; repeatable                                      |
| `--title TEXT`               | The title shown when the capture opens, 1–320 characters              |
| `--cloudtrail-resource NAME` | Adds CloudTrail write management events for that resource; repeatable |
| `--type NAME=KIND`           | Declares a service's kind; repeatable (see below)                     |

It walks the dependencies Application Signals discovered from each root and
reads a sample for every service and connection: errors are the `Fault`
metric, requests the sample count of `Latency`. The sampling period is 60 s
for a window that starts less than 15 days ago, 300 s for one less than 63
days ago and an hour otherwise, lengthened so that a series has at most 720
samples. A service's kind is mapped (`typeSource` `source`) where
Application Signals reports a resource type the exporter knows (API
Gateway, ECS, EKS, Lambda, RDS, DynamoDB, S3, SNS, SQS), and is an assumed
`microservice` everywhere else. It makes read calls only; a least-privilege
policy is these four actions (leave out the second statement if you never
pass `--cloudtrail-resource`):

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

### From Tempo and Prometheus

`scripts/export-otel-capture.py` reads Tempo's service-graph metrics from a
Prometheus-compatible backend, and a bounded sample of error traces from
Tempo's query frontend. Enable the service-graphs processor in Tempo or
Alloy, and send its counters and its classic server-duration histogram to
that backend.

```bash
python3 scripts/export-otel-capture.py \
  --tempo-url http://localhost:3200 --prometheus-url http://localhost:9090 \
  --service checkout --start 2026-11-17T14:00:00Z --end 2026-11-17T15:00:00Z \
  --period 60 --output checkout-otel.json
```

| Option                       | Effect                                 |
| ---------------------------- | -------------------------------------- |
| `--label KEY=VALUE`          | A Prometheus scope label; repeatable   |
| `--trace-resource KEY=VALUE` | A Tempo resource attribute; repeatable |
| `--trace-limit N`            | Error traces to read, 1–100            |
| `--type NAME=KIND`           | Declares a service's kind; repeatable  |

- **Tokens go only over HTTPS or to this machine.** `TEMPO_TOKEN` and
  `PROMETHEUS_TOKEN` are sent as bearer tokens, `TEMPO_TENANT` and
  `PROMETHEUS_TENANT` as `X-Scope-OrgID`. With a token set, a URL that is
  not `https://` must be a loopback host, or the exporter stops before any
  request. Redirects are never followed, and a loopback backend is never
  reached through a proxy from the environment.
- **Every request is a GET**, and each answer is at most 16 MiB.
- **What it holds:** the named service and its connections one hop either
  way. Every service is an assumed `microservice` unless `--type` declares
  it, in a region called "Location not reported".

### Declaring a kind

Both exporters take `--type NAME=KIND`, repeatable. NAME must equal exactly
one service's name as the capture writes it, case included; KIND is one of
the seventeen service kinds of a topology (`api-gateway`, `auth-service`,
`cedar-authorizer`, `microservice`, `container`, `serverless`,
`message-queue`, `database`, `storage`, `network-gateway`,
`security-monitor`, `external-client`, `load-balancer`, `virtual-machine`,
`kubernetes-cluster`, `cache`, `event-stream`). A name no service has, or
several have, stops the export before anything is read. The service gets
`typeSource: "declared"`.

### Rebuilding the Online Boutique capture

`scripts/capture-rcaeval.py` rebuilds the bundled capture from
`multi-source-data.zip`, the asset of RCAEval release 0.2.0, and refuses any
other archive (its SHA-256 is pinned). It writes to standard output:

```bash
python3 scripts/capture-rcaeval.py multi-source-data.zip \
  > apps/web/src/features/capture/online-boutique-rcaeval.json
pnpm exec prettier --write apps/web/src/features/capture/online-boutique-rcaeval.json
```

The tests of the three scripts use fakes for the AWS CLI, Tempo and
Prometheus and a synthetic archive for RCAEval; nothing is fetched, so they
do not cover a live account or backend.

## The format in brief

A capture is one JSON file, version 1. Every time is Unix epoch
milliseconds, and a file that breaks any rule is refused, not repaired.

| Field            | Meaning                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | `"aegis-incident-capture"`                                                                                                      |
| `version`        | `1`                                                                                                                             |
| `title`          | 1–320 characters, shown as written                                                                                              |
| `source`         | `kind` (`cloudwatch`, `tempo-prometheus`, `prometheus-recording` or `provider-report`), a `label` and an optional `https` `url` |
| `window`         | `startMs` and `endMs`, running forward                                                                                          |
| `topologyWindow` | Optional: where the source found the connections; it must overlap the window                                                    |
| `periodMs`       | The sampling period, 1 s to one day; required as soon as anything has samples                                                   |
| `regions`        | 1–64 of `{ id, name }`                                                                                                          |
| `nodes`          | 1–384 of `{ id, name, region, type, typeSource?, note?, buckets? }`                                                             |
| `edges`          | Up to 2048 of `{ source, target, buckets? }`: calls seen, which need not be acyclic                                             |
| `events`         | Up to 1500 of `{ atMs, title, detail?, nodes?, state? }`; `state` is `affected`, `recovering` or `recovered`                    |
| `notes`          | Up to 40 strings, shown as written                                                                                              |

`buckets` are samples with any of `requests`, `faults` (shown as errors),
`p95Ms` and `memoryBytes`. Leave out what was not measured: an absent value
is unknown, never zero. `typeSource` is `source`, `declared` or `assumed`
(the default). The two bundled files,
[`google-cloud-2025-06-12.json`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/capture/google-cloud-2025-06-12.json)
and
[`online-boutique-rcaeval.json`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/capture/online-boutique-rcaeval.json),
are an example of a report and of measurements.

## RCAEval licence and attribution

The Online Boutique capture is derived from `multi-source-data.zip`, an
asset of
[RCAEval release 0.2.0](https://github.com/phamquiluan/RCAEval/releases/tag/0.2.0)
by Luan Pham et al., whose README at that release distributes the authors'
code and datasets under the MIT License (Copyright (c) 2024 Luan Pham;
[LICENSE at 0.2.0](https://github.com/phamquiluan/RCAEval/blob/0.2.0/LICENSE)).
The capture holds aggregates computed from the archive by
`scripts/capture-rcaeval.py`, not the archive itself.

Cite: L. Pham, H. Zhang, H. Ha, F. Salim, X. Zhang, _RCAEval: A Benchmark
for Root Cause Analysis of Microservice Systems with Telemetry Data_, WWW '25
Companion, [doi:10.1145/3701716.3715290](https://doi.org/10.1145/3701716.3715290).

The Google Cloud capture is AEGIS's transcription of Google Cloud's public
[incident report](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW)
of 12 June 2025; each event names the update it rests on.

## Reference

- [`docs/CAPTURES.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/CAPTURES.md): the complete reference, with every reading rule and exporter detail
- [`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): section 11, a tour of both bundled captures
- [`apps/web/src/features/capture/`](https://github.com/cleissonbarbosa/csdt/tree/main/apps/web/src/features/capture): the reading, the draft and the interface
- [`apps/web/src/app/captureUrl.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/app/captureUrl.ts): the address and the browser's history
- [`scripts/export-cloudwatch-capture.py`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/export-cloudwatch-capture.py), [`scripts/export-otel-capture.py`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/export-otel-capture.py) and [`scripts/capture-rcaeval.py`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/capture-rcaeval.py): the three scripts
- [Security model](Security-model) and [Glossary](Glossary#files-and-data): where a capture stays, and its words

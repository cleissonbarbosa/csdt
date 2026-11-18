# Replay a cloud incident

In the **More** menu, choose **Cloud incident replay**. The replay opens in a
new tab. You can also open the site with `?replay`, including its build on a
static host. The first view is a selection from the [Google Cloud incident
of 12 June 2025](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW).
Its events, affected products and recovery milestones come from the
provider's public report. The scene identifies those entries as reported
impact. It has no sampled request metrics.

## Capture application telemetry from AWS

Use Python 3.10 or newer and an authenticated AWS CLI v2 profile. The
application must already send telemetry to [CloudWatch Application
Signals](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Sections.html).
Copy the exact service and environment names from the Application Signals
service list. Pick a past incident window that includes time before the first
symptoms and after recovery.

```bash
python3 scripts/export-cloud-replay.py \
  --profile observability \
  --region us-east-1 \
  --environment staging \
  --service checkout \
  --start 2026-11-17T14:00:00Z \
  --end 2026-11-17T15:00:00Z \
  --output checkout-incident.json
```

The exporter walks dependencies reachable from the specified root service in
the selected region and environment. Repeat `--service` for more roots. It
queries `application-signals:ListServices`,
`application-signals:ListServiceDependencies`, and
`cloudwatch:GetMetricData`. To include write management events from AWS
CloudTrail, add `--cloudtrail-resource RESOURCE_NAME` for each relevant resource
and grant `cloudtrail:LookupEvents` to the profile. CloudTrail events are scoped
by the selected resource names and window, and include the event name, source
and ID. The full event payload stays in CloudTrail.

Open **Open capture** and choose the JSON file. The browser reads it into
memory. It can contain private service names and operational data, so store
and share it according to the workspace's access rules. The AWS credentials
stay with the CLI. The replay issues no API calls to AWS or the AEGIS server.

## Read the replay

- Scrub the timeline in UTC. Playback runs through the captured window in
  thirty seconds. A recorded event jumps to its own timestamp.
- Select a 3D piece or connection, or choose it in the evidence selector.
  The table view supports the same inspection when a GPU is unavailable.
- Red on the model marks an observed fault or provider-reported impact.
  Amber on the public example marks a reported recovery still in progress.
  Inspect the labels for the actual evidence. A neutral piece may have no data.
- The dependencies come from the hourly Application Signals discovery
  window. This graph describes what was observed in that window. A visible
  edge by itself does not prove requests crossed it at the cursor time.
- The count is `SampleCount(Latency)`. Faults are CloudWatch's `Fault`
  metric, which includes service-side errors and OpenTelemetry span errors.
  For a dependency with several underlying latency series, the viewer can
  show an aggregate count when all those series are present. It leaves p95
  empty because percentiles cannot be combined that way.
- A sample applies from its timestamp until the end of its measurement
  period. The viewer shows **No data** in other intervals. It assigns no
  throughput, latency or fault rate to such gaps.

## Capture file format

The browser validates the local JSON before displaying it. A version 1 file
uses `kind: "aegis-cloud-replay"`, `version: 1`, a `title`, and a `source`
(`kind` is `cloudwatch` or `provider-report`, with a `label` and optional
HTTPS `url`). Its `window` has `startMs` and `endMs`. An optional
`topologyWindow` uses the same shape for the discovery window. Every
timestamp is Unix epoch milliseconds.

- `regions` holds `id` and `name`. Each item in `nodes` has `id`, `name`,
  a region ID and a `type` from the workspace's service types.
- `edges` holds `source` and `target` node IDs. Calls in both directions
  are allowed. The replay has no dependency on the simulation's DAG.
- Nodes and edges may include `buckets`, in ascending order of `atMs`.
  A positive `periodMs` is required with buckets. Each bucket may include
  `requests`, `faults` and `p95Ms`. Omit unmeasured values.
- Optional `events` have `atMs`, `title`, optional `detail` and `nodes`.
  A provider report can attach a `state` of `affected`, `recovering` or
  `recovered` to the named nodes.
- The file can include `notes` explaining the capture or limits in coverage.

The [bundled report](../apps/web/src/features/replay/google-cloud-2025-06-12.json)
is an example that uses events and topology. The viewer accepts up to 12 MiB,
384 nodes, 2048 edges and 1500 buckets per series or events in a capture.

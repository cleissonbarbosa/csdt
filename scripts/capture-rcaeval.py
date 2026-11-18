#!/usr/bin/env python3
"""Rebuild the bundled Online Boutique capture from the published RCAEval archive.

The archive is `multi-source-data.zip` of RCAEval release 0.2.0, pinned by its
SHA-256; it is not in the repository. The capture is written as JSON to
standard output.

test_capture_rcaeval.py runs the rebuild on a small synthetic archive, and
holds the committed file to every field this script writes without the
archive (kind, version, title, source, period, regions, notes, the order of
its keys, the event titles, the injection event's detail and each node's
kind and typeSource) and to the shape of its values (sample times aligned
and inside the window, the peak event equal to the memory series). The
values themselves can be compared only with a rebuild from the archive,
whatever the formatting of either file:

    python3 scripts/capture-rcaeval.py multi-source-data.zip > rebuilt.json
    diff <(jq -S . rebuilt.json) \\
        <(jq -S . apps/web/src/features/capture/online-boutique-rcaeval.json)
"""

import argparse
import csv
import hashlib
import io
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

SOURCE = "https://github.com/phamquiluan/RCAEval/releases/tag/0.2.0"
SHA256 = "81d87640eb9e976325d9ef56d423455454d3cb49ca52041651f628a4d010c66a"
PERIOD = 30
PEAK_SERVICE = "checkoutservice"
NO_PEAK = f"No {PEAK_SERVICE} memory sample after the injection in this window."


def rows(archive, name):
    with archive.open("multi-source-data/" + name) as data:
        yield from csv.DictReader(io.TextIOWrapper(data, encoding="utf-8"))


def kind_of(name):
    """The archive states no kind of service: each one here is assumed by name."""
    return {
        "type": "database" if name == "redis" else "microservice",
        "typeSource": "assumed",
    }


def rebuild(data):
    """Build the capture from the bytes of the archive, or a binary file object."""
    if not isinstance(data, (bytes, bytearray)):
        data = data.read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError(
            "Expected RCAEval 0.2.0 multi-source-data.zip (see docs/CAPTURES.md)."
        )
    with ZipFile(io.BytesIO(data)) as archive:
        injection = int(archive.read("multi-source-data/inject_time.txt"))
        start, end = injection - 300, injection + 300
        services = defaultdict(lambda: defaultdict(dict))
        peak = None
        for row in rows(archive, "metrics.csv"):
            second = int(row["time"])
            if not start <= second < end:
                continue
            at = (start + (second - start) // PERIOD * PERIOD) * 1000
            for key, value in row.items():
                if not key.endswith("_mem") or not value:
                    continue
                name = key.removesuffix("_mem")
                size = int(float(value))
                bucket = services[name][at]
                bucket["memoryBytes"] = max(bucket.get("memoryBytes", 0), size)
                if (
                    name == PEAK_SERVICE
                    and second >= injection
                    and (peak is None or size > peak[0])
                ):
                    peak = (size, second)

        # Resolve a parent within the same trace even if it precedes the
        # selected window. Ambiguous, duplicate or missing spans supply no edge.
        owners = {}
        spans = {}
        for row in rows(archive, "traces.csv"):
            identity = (row["traceID"], row["spanID"])
            name = row["serviceName"]
            if name == "frontendservice":
                name = "frontend"  # 'frontend_mem' in this release's metrics file.
            if identity in owners:
                owners[identity] = None
                spans.pop(identity, None)
                continue
            owners[identity] = name
            ms = int(row["startTimeMillis"])
            if start * 1000 <= ms < end * 1000:
                spans[identity] = (row["parentSpanID"], name, ms, int(row["duration"]))
        calls = defaultdict(lambda: defaultdict(list))
        incoming = defaultdict(lambda: defaultdict(list))
        for (trace, _), (parent, name, ms, duration) in spans.items():
            caller = owners.get((trace, parent))
            if caller is None or caller == name:
                continue
            at = (ms - start * 1000) // (PERIOD * 1000) * PERIOD * 1000 + start * 1000
            calls[(caller, name)][at].append(duration)
            incoming[name][at].append(duration)
            services.setdefault(caller, {})

    def measurements(durations):
        # The Jaeger duration in the source table is in microseconds.
        p95 = sorted(durations)[math.ceil(0.95 * len(durations)) - 1]
        return {"requests": len(durations), "p95Ms": p95 / 1000}

    for name, times in incoming.items():
        for at, durations in times.items():
            services[name].setdefault(at, {}).update(measurements(durations))

    events = [
        {
            "atMs": injection * 1000,
            "title": "Benchmark fault injected",
            "detail": "Timestamp from the published inject_time.txt. This marker identifies the intervention time only.",
        }
    ]
    notes = [
        "Public benchmark execution by the RCAEval authors, from the multi-source-data.zip asset of release 0.2.0. Ten minutes around the fault injection. Deployment locations were not supplied.",
        "Each memory value is the maximum published Prometheus memory gauge in a 30-second interval.",
        "Calls count unique cross-service child spans with a resolved parent in the published Jaeger traces. p95 is the nearest-rank percentile of these child spans' durations.",
        "No error counts are taken from the archive, so this capture does not show whether a service was healthy.",
        "The archive states no kind of service. Every kind here is assumed by name: redis is drawn as a database and every other service as a microservice.",
    ]
    if peak is None:
        notes.append(NO_PEAK)
    else:
        events.append(
            {
                "atMs": peak[1] * 1000,
                "title": "Checkout memory peak after injection",
                "detail": f"First sample at the post-injection maximum in this window: {peak[0]:,} bytes in {PEAK_SERVICE}_mem.",
                "nodes": [PEAK_SERVICE],
            }
        )
    return {
        "kind": "aegis-incident-capture",
        "version": 1,
        "title": "Online Boutique · RCAEval · 15 January 2024",
        "source": {
            "kind": "prometheus-recording",
            "label": "RCAEval · Prometheus / Jaeger",
            "url": SOURCE,
        },
        "window": {"startMs": start * 1000, "endMs": end * 1000},
        "periodMs": PERIOD * 1000,
        "regions": [{"id": "benchmark", "name": "Location not supplied"}],
        "nodes": [
            {
                "id": name,
                "name": name,
                "region": "benchmark",
                **kind_of(name),
                "buckets": [{"atMs": t, **b} for t, b in sorted(points.items())],
            }
            for name, points in sorted(services.items())
        ],
        "edges": [
            {
                "source": client,
                "target": server,
                "buckets": [
                    {"atMs": t, **measurements(d)} for t, d in sorted(points.items())
                ],
            }
            for (client, server), points in sorted(calls.items())
        ],
        "events": events,
        "notes": notes,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("archive", type=Path, help="multi-source-data.zip")
    args = parser.parse_args(argv)
    try:
        capture = rebuild(args.archive.read_bytes())
    except (OSError, ValueError) as error:
        print(f"capture-rcaeval: {error}", file=sys.stderr)
        return 1
    print(json.dumps(capture, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

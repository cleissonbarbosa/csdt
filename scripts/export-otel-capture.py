#!/usr/bin/env python3
"""Write an AEGIS incident capture from Tempo service-graph metrics and error spans.

Reads the service-graph counters and the server-duration histogram from a
Prometheus-compatible backend, and a bounded sample of error traces from
Tempo's query frontend. Every request is a GET. A bearer token, when set, is
sent only over HTTPS or to a loopback host, and never to a redirect. A
loopback host is asked directly, never through a proxy from the environment.
"""

import argparse
import hashlib
import ipaddress
import json
import math
import os
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

# The ServiceType enum of schemas/v1/topology.schema.json, in its order. A
# test holds this copy to the schema.
SERVICE_TYPES = (
    "api-gateway",
    "auth-service",
    "cedar-authorizer",
    "microservice",
    "container",
    "serverless",
    "message-queue",
    "database",
    "storage",
    "network-gateway",
    "security-monitor",
    "external-client",
)
# The service graph states no kind: each node not declared with --type is
# assumed to be this kind.
ASSUMED_TYPE = "microservice"
# The service graph states no location either.
REGION = {"id": "unreported", "name": "Location not reported"}


def kind_pair(value):
    """Parse one --type NAME=KIND. The name is everything before the last '='."""
    name, sep, kind = value.rpartition("=")
    if not sep or not name:
        raise argparse.ArgumentTypeError(
            f"expected NAME=KIND, such as orders-db=database; got {value!r}"
        )
    if kind not in SERVICE_TYPES:
        raise argparse.ArgumentTypeError(
            f"unknown kind {kind!r} for {name!r}; expected one of: {', '.join(SERVICE_TYPES)}"
        )
    return name, kind


def declare_kinds(nodes, declarations):
    """Give the one node named exactly NAME the declared KIND."""
    declared = set()
    for name, kind in declarations:
        if name in declared:
            raise ValueError(f"--type declares {name!r} more than once.")
        declared.add(name)
        matches = [node for node in nodes if node["name"] == name]
        if len(matches) != 1:
            raise ValueError(
                f"--type {name}={kind}: expected exactly one node named {name!r}, "
                f"found {len(matches)}. A name must match the node's name exactly, "
                "and a name that repeats cannot be declared."
            )
        matches[0]["type"] = kind
        matches[0]["typeSource"] = "declared"


def loopback(host):
    """Whether a URL's host is this machine: localhost or a loopback address."""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class NoRedirect(HTTPRedirectHandler):
    """Keep backend credentials on the configured endpoint."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def reader(url, token, tenant, token_name="The token"):
    parsed = urlsplit(url)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "Use an HTTP(S) backend URL without credentials, query or fragment."
        )
    if token and parsed.scheme != "https" and not loopback(parsed.hostname):
        # A bearer token over plain HTTP can be read by anything on the path.
        raise ValueError(
            f"{token_name} is set, so {parsed.hostname} must be reached over https:// "
            "or be a loopback host (localhost, 127.0.0.0/8 or ::1)."
        )
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if tenant:
        headers["X-Scope-OrgID"] = tenant
    handlers = [NoRedirect]
    if loopback(parsed.hostname):
        # A proxy from the environment may be another host: it would read a plain
        # HTTP request, token included, and its loopback is not this one.
        # Any other backend keeps the environment's proxies.
        handlers.insert(0, ProxyHandler({}))
    opener = build_opener(*handlers)

    def get(path, params=None):
        target = url.rstrip("/") + path
        if params:
            target += "?" + urlencode(params)
        with opener.open(Request(target, headers=headers), timeout=30) as response:
            data = response.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024:
            raise ValueError(
                "Backend response too large. Select a shorter window or a smaller scope."
            )
        return json.loads(data)

    return get


def epoch(value):
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.tzinfo is None or instant.microsecond:
        raise ValueError("Use whole-second timestamps with a timezone.")
    return int(instant.timestamp())


def service_id(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24]


def graph_query(metric, service, labels, period, histogram=False):
    # Match both incoming and outgoing edges. PromQL 'or' deduplicates the
    # overlap at the series level before aggregation.
    filters = [
        f"{key}={json.dumps(value, ensure_ascii=False)}" for key, value in labels
    ]
    sides = []
    for side in ("client", "server"):
        selector = ",".join(
            [*filters, f"{side}={json.dumps(service, ensure_ascii=False)}"]
        )
        sides.append(f"increase({metric}{{{selector}}}[{period}s])")
    groups = "client,server,le" if histogram else "client,server"
    expr = f"sum by ({groups}) ({' or '.join(sides)})"
    return f"1000 * histogram_quantile(0.95, {expr})" if histogram else expr


def graph(prom, args, start, end):
    samples = defaultdict(lambda: defaultdict(dict))
    notes = []
    for field, metric in [
        ("requests", "traces_service_graph_request_total"),
        ("faults", "traces_service_graph_request_failed_total"),
        ("p95Ms", "traces_service_graph_request_server_seconds_bucket"),
    ]:
        expr = graph_query(
            metric, args.service, args.label, args.period, field == "p95Ms"
        )
        reply = prom(
            "/api/v1/query_range",
            {
                "query": expr,
                "start": start + args.period,
                "end": end,
                "step": args.period,
            },
        )
        if (
            reply.get("status") != "success"
            or reply.get("data", {}).get("resultType") != "matrix"
        ):
            raise ValueError(f"Prometheus could not supply {field}.")
        if reply.get("warnings"):
            notes.append(
                f"Prometheus returned query warnings for {field}. Coverage may be incomplete."
            )
        for series in reply["data"]["result"]:
            client = series["metric"].get("client")
            server = series["metric"].get("server")
            if (
                not client
                or not server
                or client == server
                or args.service not in (client, server)
            ):
                continue
            if max(len(client), len(server)) > 320:
                raise ValueError("Service name exceeds capture limit.")
            for timestamp, raw in series["values"]:
                # PromQL increase looks backwards. Store the beginning of
                # the measurement interval, not the query evaluation time.
                at = round(float(timestamp) * 1000) - args.period * 1000
                value = float(raw)
                if (
                    start * 1000 <= at
                    and at + args.period * 1000 <= end * 1000
                    and math.isfinite(value)
                    and value >= 0
                ):
                    samples[(client, server)][at][field] = value
            if len(samples) > 2048:
                raise ValueError("More than 2048 graph edges. Narrow the query.")
    if not samples:
        raise ValueError(
            "No service-graph samples. Check the service, labels, window and Tempo service-graphs processor."
        )
    names = sorted({name for pair in samples for name in pair})
    if len(names) > 384:
        raise ValueError("More than 384 services. Narrow the query.")
    edges = []
    incoming = defaultdict(list)
    for (client, server), buckets in sorted(samples.items()):
        edges.append(
            {
                "source": service_id(client),
                "target": service_id(server),
                "buckets": [{"atMs": t, **b} for t, b in sorted(buckets.items())],
            }
        )
        incoming[server].append(buckets)
    nodes = []
    for name in names:
        streams = incoming[name]
        points = []
        for at in sorted({t for stream in streams for t in stream}):
            point = {}
            for field in ("requests", "faults"):
                if all(field in stream.get(at, {}) for stream in streams):
                    point[field] = sum(stream[at][field] for stream in streams)
            if len(streams) == 1 and "p95Ms" in streams[0][at]:
                point["p95Ms"] = streams[0][at]["p95Ms"]
            if point:
                points.append({"atMs": at, **point})
        nodes.append(
            {
                "id": service_id(name),
                "name": name,
                "region": REGION["id"],
                "type": ASSUMED_TYPE,
                "typeSource": "assumed",
                "buckets": points,
            }
        )
    return nodes, edges, notes


def error_events(tempo, args, start, end):
    predicates = [
        f"resource.service.name = {json.dumps(args.service, ensure_ascii=False)}",
        "status = error",
    ]
    for key, value in args.trace_resource:
        predicates.append(f"resource.{key} = {json.dumps(value, ensure_ascii=False)}")
    result = tempo(
        "/api/search",
        {
            "q": "{ " + " && ".join(predicates) + " }",
            "start": start,
            "end": end,
            "limit": args.trace_limit,
        },
    )
    events = []
    ids = set()
    for hit in result.get("traces", [])[: args.trace_limit]:
        trace_id = hit["traceID"]
        if not re.fullmatch(r"[a-fA-F0-9]{16,32}", trace_id):
            raise ValueError("Tempo returned an invalid trace ID.")
        if trace_id in ids:
            continue
        ids.add(trace_id)
        trace = tempo(f"/api/traces/{trace_id}")
        groups = trace.get("batches", trace.get("resourceSpans"))
        if not isinstance(groups, list):
            raise TypeError("Tempo returned an unsupported trace format.")
        for group in groups:
            attrs = {
                a["key"]: a.get("value", {}).get("stringValue")
                for a in group["resource"].get("attributes", [])
            }
            if attrs.get("service.name") != args.service or any(
                attrs.get(k) != v for k, v in args.trace_resource
            ):
                continue
            for scope in group.get(
                "scopeSpans", group.get("instrumentationLibrarySpans", [])
            ):
                for span in scope.get("spans", []):
                    if span.get("status", {}).get("code") not in (
                        2,
                        "STATUS_CODE_ERROR",
                    ):
                        continue
                    at = int(span["startTimeUnixNano"]) // 1_000_000
                    if start * 1000 <= at < end * 1000:
                        events.append(
                            {
                                "atMs": at,
                                "title": (span.get("name") or "Error span")[:320],
                                "detail": f"Tempo · error span · trace {trace_id}",
                                "nodes": [service_id(args.service)],
                            }
                        )
                        if len(events) > 1500:
                            raise ValueError(
                                "Too many error spans. Reduce --trace-limit or the time window."
                            )
    return sorted(events, key=lambda e: (e["atMs"], e["detail"], e["title"]))


def capture(args, prom, tempo):
    start, end = epoch(args.start), epoch(args.end)
    if (
        start < 0
        or not 1 <= args.period <= 86400
        or not 1 <= (end - start) // args.period <= 1500
    ):
        raise ValueError(
            "Choose a positive window containing 1–1500 complete measurement intervals."
        )
    if not 1 <= args.trace_limit <= 100 or not 1 <= len(args.service.strip()) <= 300:
        raise ValueError(
            "Specify a service (1–300 characters) and a trace limit (1–100)."
        )
    nodes, edges, notes = graph(prom, args, start, end)
    # Before Tempo is asked anything: a declaration that names no node stops
    # the export here.
    declare_kinds(nodes, args.types)
    events = error_events(tempo, args, start, end)
    return {
        "kind": "aegis-incident-capture",
        "version": 1,
        "title": f"Telemetry · {args.service}",
        "source": {"kind": "tempo-prometheus", "label": "Grafana Tempo / Prometheus"},
        "window": {"startMs": start * 1000, "endMs": end * 1000},
        "periodMs": args.period * 1000,
        "regions": [dict(REGION)],
        "nodes": nodes,
        "edges": edges,
        "events": events,
        "notes": [
            "Connections are one hop from the selected service. Counts are extrapolated counter increases over complete intervals. Trace sampling and scrape coverage affect these measurements.",
            "Node counts summarize captured incoming connections. A node percentile is shown only for a single incoming connection.",
            "Errors are the service graph's failed-request counter. Where a connection has no such series in an interval (typically before its first failure), its errors are not measured there, rather than zero.",
            f"Events show error spans from up to {args.trace_limit} matching Tempo traces. The graph and the trace sample can have different coverage.",
            "The service graph states no kind or location of service. Every kind is assumed to be a microservice, unless the operator declared it.",
            *notes,
        ],
    }


def label_pair(value):
    key, sep, val = value.partition("=")
    if (
        not sep
        or not re.fullmatch(r"[a-zA-Z_][a-zA-Z_0-9]*", key)
        or key in {"client", "server", "le", "__name__"}
    ):
        raise argparse.ArgumentTypeError("Expected a scope label, e.g. cluster=staging")
    return key, val


def resource_pair(value):
    key, sep, val = value.partition("=")
    if not sep or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.]*", key):
        raise argparse.ArgumentTypeError(
            "Expected a resource attribute, e.g. k8s.cluster.name=staging"
        )
    return key, val


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        epilog="Environment: TEMPO_TOKEN and PROMETHEUS_TOKEN (bearer tokens, sent only "
        "over HTTPS or to a loopback host, which is never reached through a proxy), "
        "TEMPO_TENANT and PROMETHEUS_TENANT "
        f"(X-Scope-OrgID). Kinds: {', '.join(SERVICE_TYPES)}.",
    )
    for option in ("tempo-url", "prometheus-url", "service", "start", "end"):
        parser.add_argument("--" + option, required=True)
    parser.add_argument(
        "--period", type=int, default=60, help="Measurement period in seconds"
    )
    parser.add_argument(
        "--label",
        action="append",
        type=label_pair,
        default=[],
        help="Prometheus scope label (repeatable)",
    )
    parser.add_argument(
        "--trace-resource",
        action="append",
        type=resource_pair,
        default=[],
        help="Tempo string resource attribute (repeatable)",
    )
    parser.add_argument("--trace-limit", type=int, default=10)
    parser.add_argument(
        "--type",
        dest="types",
        action="append",
        type=kind_pair,
        default=[],
        metavar="NAME=KIND",
        help="Declare the kind of the service with exactly this name (repeatable)",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        prom = reader(
            args.prometheus_url,
            os.getenv("PROMETHEUS_TOKEN"),
            os.getenv("PROMETHEUS_TENANT"),
            "PROMETHEUS_TOKEN",
        )
        tempo = reader(
            args.tempo_url,
            os.getenv("TEMPO_TOKEN"),
            os.getenv("TEMPO_TENANT"),
            "TEMPO_TOKEN",
        )
        data = json.dumps(
            capture(args, prom, tempo), ensure_ascii=False, allow_nan=False
        ).encode()
        if len(data) > 12 * 1024 * 1024:
            raise ValueError("Capture exceeds 12 MiB. Select a smaller window.")
        with args.output.open("xb") as file:
            file.write(data + b"\n")
        print(f"Wrote {args.output}")
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f"Capture failed: {error}\n")


if __name__ == "__main__":
    main()

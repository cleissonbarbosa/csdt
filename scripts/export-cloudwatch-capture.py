#!/usr/bin/env python3
"""Write an AEGIS incident capture from Application Signals and CloudWatch.

Reads the dependency graph Application Signals discovered around the root
services, CloudWatch samples for every node and connection in it, and
optionally the write management events CloudTrail holds for named resources.
Every call is a read, made through the AWS CLI with the operator's profile.
"""

import argparse
import hashlib
import json
import math
import re
import subprocess
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

MAX_NODES = 384
MAX_EDGES = 2048
MAX_EVENTS = 1500
MAX_BYTES = 12 * 1024 * 1024
NAMESPACE = "ApplicationSignals"
# CloudTrail's LookupEvents answers from the last 90 days of event history.
TRAIL_HISTORY_MS = 90 * 86_400_000

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
    "load-balancer",
    "virtual-machine",
    "kubernetes-cluster",
    "cache",
    "event-stream",
)
# Each node whose kind is not mapped from a reported resource type, nor
# declared with --type, is assumed to be this kind.
ASSUMED_TYPE = "microservice"

RESOURCE_TYPES = {
    "AWS::ApiGateway::RestApi": "api-gateway",
    "AWS::ApiGatewayV2::Api": "api-gateway",
    "AWS::ECS::Service": "container",
    "AWS::EKS::Cluster": "kubernetes-cluster",
    "AWS::Lambda::Function": "serverless",
    "AWS::RDS::DBInstance": "database",
    "AWS::RDS::DBCluster": "database",
    "AWS::DynamoDB::Table": "database",
    "AWS::S3::Bucket": "storage",
    "AWS::SNS::Topic": "event-stream",
    "AWS::SQS::Queue": "message-queue",
}


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


def timestamp(value):
    if isinstance(value, (float, int)):
        return round(value * 1000)
    when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if when.tzinfo is None:
        raise ValueError(
            "Use a timestamp with a timezone, such as 2026-11-17T14:00:00Z."
        )
    return round(when.timestamp() * 1000)


def iso(ms):
    return (
        datetime.fromtimestamp(ms / 1000, timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def aws_client(region, profile):
    options = [
        "--region",
        region,
        "--no-cli-pager",
        "--output",
        "json",
        "--no-paginate",
    ]
    if profile:
        options.extend(["--profile", profile])

    def call(service, operation, params):
        with TemporaryDirectory() as directory:
            request = Path(directory) / "request.json"
            request.write_text(json.dumps(params), encoding="utf-8")
            result = subprocess.run(
                [
                    "aws",
                    service,
                    operation,
                    *options,
                    "--cli-input-json",
                    f"file://{request}",
                ],
                capture_output=True,
                encoding="utf-8",
                check=False,
                timeout=90,
            )
        if result.returncode:
            raise ValueError(
                f"aws {service} {operation} failed: {result.stderr.strip()}"
            )
        return json.loads(result.stdout)

    return call


def pages(call, service, operation, params):
    cursor = None
    seen = set()
    while True:
        page = call(
            service, operation, {**params, **({"NextToken": cursor} if cursor else {})}
        )
        yield page
        cursor = page.get("NextToken")
        if not cursor:
            return
        if cursor in seen:
            raise ValueError(f"Repeated pagination token from {service} {operation}.")
        seen.add(cursor)


def key_of(attributes):
    return tuple(sorted(attributes.items()))


def aws_node(region, attributes, instrumented):
    identity = json.dumps([region, key_of(attributes)], separators=(",", ":")).encode()
    # A resource's ARN, when reported, identifies its region. A remote
    # dependency without a location must not inherit the caller's region.
    resource = attributes.get("Identifier", "")
    arn = resource.split(":", 5)
    location = "unknown-region"
    if instrumented:
        location = region
    elif (
        len(arn) == 6
        and arn[0] == "arn"
        and re.fullmatch(r"[a-z][a-z0-9-]{1,63}", arn[3])
    ):
        location = arn[3]
    # A kind is mapped only from a resource type the platform reported.
    mapped = RESOURCE_TYPES.get(attributes.get("ResourceType"))
    return {
        "id": hashlib.sha256(identity).hexdigest()[:24],
        "name": (
            attributes.get("Name") or resource or attributes.get("Type", "Dependency")
        )[:320],
        "region": location,
        "type": mapped or ASSUMED_TYPE,
        "typeSource": "source" if mapped else "assumed",
    }


def read_graph(call, region, environment, roots, discover_window):
    summaries = {}
    returned_window = None
    for page in pages(call, "application-signals", "list-services", discover_window):
        returned_window = (
            timestamp(page.get("StartTime", discover_window["StartTime"])),
            timestamp(page.get("EndTime", discover_window["EndTime"])),
        )
        for summary in page["ServiceSummaries"]:
            attributes = summary["KeyAttributes"]
            if attributes.get("Environment") == environment:
                summaries[key_of(attributes)] = summary

    by_name = defaultdict(list)
    for key, summary in summaries.items():
        attributes = summary["KeyAttributes"]
        by_name[attributes.get("Name")].append(key)

    def resolve(attributes):
        key = key_of(attributes)
        if key in summaries:
            return key
        # Only a remote service with a matching reported environment can
        # share a discovered service's identity.
        matches = by_name.get(attributes.get("Name"), [])
        if (
            attributes.get("Type") == "RemoteService"
            and attributes.get("Environment") == environment
            and len(matches) == 1
        ):
            return matches[0]
        return key

    queue = deque()
    for root in roots:
        matches = by_name.get(root, [])
        if len(matches) != 1:
            raise ValueError(
                f"Expected one instrumented service named {root!r} in {environment!r}; found {len(matches)}."
            )
        queue.append(matches[0])

    nodes = {}
    edges = {}
    edge_refs = defaultdict(list)
    node_refs = {}
    discovered = set()
    while queue:
        source_key = queue.popleft()
        if source_key in discovered:
            continue
        discovered.add(source_key)
        summary = summaries[source_key]
        source = nodes.setdefault(
            source_key, aws_node(region, summary["KeyAttributes"], True)
        )
        node_refs[source["id"]] = service_refs(summary)
        for page in pages(
            call,
            "application-signals",
            "list-service-dependencies",
            {**discover_window, "KeyAttributes": summary["KeyAttributes"]},
        ):
            for dependency in page["ServiceDependencies"]:
                attributes = dependency["DependencyKeyAttributes"]
                target_key = resolve(attributes)
                if target_key == source_key:
                    continue
                instrumented = target_key in summaries
                canonical = (
                    summaries[target_key]["KeyAttributes"]
                    if instrumented
                    else attributes
                )
                target = nodes.setdefault(
                    target_key, aws_node(region, canonical, instrumented)
                )
                edge_key = (source["id"], target["id"])
                edges[edge_key] = {"source": edge_key[0], "target": edge_key[1]}
                edge_refs[edge_key].extend(dependency.get("MetricReferences", []))
                if instrumented and target_key not in discovered:
                    queue.append(target_key)
                if len(nodes) > MAX_NODES or len(edges) > MAX_EDGES:
                    raise ValueError(
                        "The selected graph is too large. Narrow the environment or root services."
                    )

    return (
        list(nodes.values()),
        list(edges.values()),
        node_refs,
        edge_refs,
        returned_window,
    )


def service_refs(summary):
    """Use the service aggregate, regardless of the operations it exposes."""
    key = summary["KeyAttributes"]
    dimensions = {"Service": key["Name"], "Environment": key["Environment"]}
    return [
        {
            "Namespace": NAMESPACE,
            "MetricName": name,
            "Dimensions": [{"Name": k, "Value": v} for k, v in dimensions.items()],
        }
        for name in ("Latency", "Fault")
    ]


def reference_key(ref):
    dimensions = tuple(sorted((dim["Name"], dim["Value"]) for dim in ref["Dimensions"]))
    return (ref.get("AccountId", ""), ref["Namespace"], ref["MetricName"], dimensions)


def narrowest_refs(refs, metric):
    found = {
        reference_key(ref): ref
        for ref in refs
        if ref["Namespace"] == NAMESPACE and ref["MetricName"] == metric
    }
    if not found:
        return []
    # Aggregate and operation-level references can overlap. A single
    # dimension shape at the least granular level can be safely summed.
    width = min(len(key[3]) for key in found)
    wanted = [key for key in sorted(found) if len(key[3]) == width]
    shapes = {(key[0], tuple(name for name, _ in key[3])) for key in wanted}
    return [found[key] for key in wanted] if len(shapes) == 1 else []


def collect_samples(call, targets, start, end, period):
    queries = {}
    identifier = {}

    def query(ref, stat):
        signature = (reference_key(ref), stat)
        if signature not in identifier:
            index = f"m{len(queries)}"
            item = {
                "Id": index,
                "MetricStat": {
                    "Metric": {
                        k: ref[k] for k in ("Namespace", "MetricName", "Dimensions")
                    },
                    "Period": period,
                    "Stat": stat,
                },
                "ReturnData": True,
            }
            if ref.get("AccountId"):
                item["AccountId"] = ref["AccountId"]
            queries[index] = item
            identifier[signature] = index
        return identifier[signature]

    fields_by_target = {}

    def scope(refs):
        return {key[:2] + key[3:] for key in map(reference_key, refs)}

    for target, refs in targets.items():
        latency = narrowest_refs(refs, "Latency")
        faults = narrowest_refs(refs, "Fault")
        if latency and faults and scope(latency) != scope(faults):
            # Comparing a subset of fault series with a larger denominator
            # would produce a made-up fault rate.
            faults = []
        fields_by_target[target] = {
            "requests": [query(ref, "SampleCount") for ref in latency],
            "faults": [query(ref, "Sum") for ref in faults],
            # Percentiles of multiple operations cannot be added or averaged.
            "p95Ms": [query(latency[0], "p95")] if len(latency) == 1 else [],
        }

    seen = defaultdict(dict)
    # PartialData means more points follow on the next page, so a series is
    # judged by the status it ends on. An error on any page loses points.
    ended = {}
    failed = False
    items = list(queries.values())
    for offset in range(0, len(items), 200):
        params = {
            "MetricDataQueries": items[offset : offset + 200],
            "StartTime": iso(start),
            "EndTime": iso(end),
            "ScanBy": "TimestampAscending",
        }
        for page in pages(call, "cloudwatch", "get-metric-data", params):
            for result in page["MetricDataResults"]:
                status = result.get("StatusCode")
                failed |= status not in ("Complete", "PartialData", None)
                ended[result["Id"]] = status
                for when, value in zip(
                    result["Timestamps"], result["Values"], strict=True
                ):
                    at = timestamp(when)
                    if start <= at < end and math.isfinite(value) and value >= 0:
                        seen[result["Id"]][at] = value
    incomplete = failed or "PartialData" in ended.values()

    by_target = {}
    for target, fields in fields_by_target.items():
        buckets = defaultdict(dict)
        for field, keys in fields.items():
            if not keys:
                continue
            times = seen[keys[0]].keys()
            for key in keys[1:]:
                times = times & seen[key].keys()
            for at in times:
                buckets[at][field] = sum(seen[key][at] for key in keys)
        by_target[target] = [{"atMs": at, **buckets[at]} for at in sorted(buckets)]
    return by_target, incomplete


def trail_events(call, resources, start, end):
    events = {}
    for resource in sorted(set(resources)):
        params = {
            "LookupAttributes": [
                {"AttributeKey": "ResourceName", "AttributeValue": resource}
            ],
            "StartTime": iso(start),
            "EndTime": iso(end),
        }
        for page in pages(call, "cloudtrail", "lookup-events", params):
            for entry in page["Events"]:
                if str(entry.get("ReadOnly", "")).lower() != "false":
                    continue
                at = timestamp(entry["EventTime"])
                if start <= at <= end:
                    events[entry["EventId"]] = {
                        "atMs": at,
                        "title": entry["EventName"][:320],
                        "detail": f"CloudTrail · {entry['EventSource']} · {entry['EventId']}",
                    }
                if len(events) > MAX_EVENTS:
                    raise ValueError(
                        "Too many CloudTrail events. Select fewer resources or a shorter window."
                    )
    return sorted(events.values(), key=lambda event: (event["atMs"], event["detail"]))


def capture(args, call):
    start, end = timestamp(args.start), timestamp(args.end)
    now = round(datetime.now(timezone.utc).timestamp() * 1000)
    if not 0 <= start < end <= now:
        raise ValueError("Specify a positive time window ending in the past.")
    # CloudWatch retains one-minute data for 15 days, then five-minute data
    # for 63 days and hourly data thereafter. Keep exported samples bounded.
    age_days = (now - start) / 86_400_000
    base = 60 if age_days < 15 else 300 if age_days < 63 else 3600
    period = base * max(1, math.ceil((end - start) / (1000 * base * 720)))
    if period > 86_400:
        raise ValueError("Choose a shorter time window.")
    floor_hour = start // 3_600_000 * 3_600_000
    ceil_hour = (end + 3_599_999) // 3_600_000 * 3_600_000
    discover_window = {"StartTime": iso(floor_hour), "EndTime": iso(ceil_hour)}
    nodes, edges, node_refs, edge_refs, topology_window = read_graph(
        call,
        args.region,
        args.environment,
        args.service,
        discover_window,
    )
    # Before any metric is read: a declaration that names no node, or
    # several, stops the export here.
    declare_kinds(nodes, args.types)
    samples, incomplete = collect_samples(
        call, {**node_refs, **edge_refs}, start, end, period
    )
    events = trail_events(call, args.cloudtrail_resource, start, end)
    for node in nodes:
        node["buckets"] = samples.get(node["id"], [])
    for edge in edges:
        edge["buckets"] = samples[(edge["source"], edge["target"])]
    region_ids = sorted({node["region"] for node in nodes})
    if len(region_ids) > 64:
        raise ValueError(
            "The selected graph has too many regions. Select fewer root services."
        )
    notes = [
        "The graph lists dependencies discovered in the Application Signals window. A link does not establish that traffic passed at every instant.",
        "Errors are CloudWatch's “Fault” metric, which counts server errors and OpenTelemetry span errors. Requests are the SampleCount of “Latency”.",
        "A kind is mapped from the AWS resource type where Application Signals reports one. Every other kind is assumed to be a microservice, unless the operator declared it.",
    ]
    if args.cloudtrail_resource:
        notes.append(
            "Events are the write management events CloudTrail holds for the resource names given to the exporter "
            f"({len(set(args.cloudtrail_resource))}), as event name, source and ID. Read-only events, other resources "
            "and the event payloads are left out."
        )
        if now - start > TRAIL_HISTORY_MS:
            notes.append(
                "The window starts more than 90 days ago. CloudTrail's event history covers 90 days, so earlier events cannot appear."
            )
    else:
        notes.append(
            "No CloudTrail events were requested, so this capture does not show configuration changes."
        )
    if start % (period * 1000):
        notes.append(
            "The first sample may start after the requested start, at a CloudWatch aggregation boundary."
        )
    if incomplete or not any(node["buckets"] for node in nodes):
        notes.append(
            "CloudWatch returned incomplete or empty service series. Missing samples are unknown."
        )
    return {
        "kind": "aegis-incident-capture",
        "version": 1,
        "title": args.title or f"{', '.join(args.service)} · {args.environment}"[:320],
        "source": {
            "kind": "cloudwatch",
            "label": "Amazon CloudWatch Application Signals",
            "url": f"https://console.aws.amazon.com/cloudwatch/home?region={args.region}",
        },
        "window": {"startMs": start, "endMs": end},
        "topologyWindow": {"startMs": topology_window[0], "endMs": topology_window[1]},
        "periodMs": period * 1000,
        "regions": [
            {
                "id": region,
                "name": "Location not reported"
                if region == "unknown-region"
                else region,
            }
            for region in region_ids
        ],
        "nodes": nodes,
        "edges": edges,
        "events": events,
        "notes": notes,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        epilog=f"Kinds: {', '.join(SERVICE_TYPES)}.",
    )
    parser.add_argument("--profile", help="AWS CLI profile to use")
    parser.add_argument(
        "--region", required=True, help="Region containing the instrumented services"
    )
    parser.add_argument(
        "--environment",
        required=True,
        help="Exact Application Signals environment name",
    )
    parser.add_argument(
        "--service",
        action="append",
        required=True,
        help="Root service name; repeat to include another root",
    )
    parser.add_argument(
        "--start", required=True, help="Start timestamp in ISO 8601 with timezone"
    )
    parser.add_argument(
        "--end", required=True, help="End timestamp in ISO 8601 with timezone"
    )
    parser.add_argument("--title", help="Title shown when the capture opens")
    parser.add_argument(
        "--cloudtrail-resource",
        action="append",
        default=[],
        help="Resource name for optional CloudTrail events; repeat for several",
    )
    parser.add_argument(
        "--type",
        dest="types",
        action="append",
        type=kind_pair,
        default=[],
        metavar="NAME=KIND",
        help="Declare the kind of the one node with exactly this name; repeat for several",
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Path to a new JSON file"
    )
    args = parser.parse_args(argv)
    try:
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", args.region):
            raise ValueError("Expected an AWS region code.")
        if args.title is not None and not 0 < len(args.title.strip()) <= 320:
            raise ValueError("The title must contain between 1 and 320 characters.")
        if args.output.exists():
            raise ValueError(f"Output already exists: {args.output}")
        result = capture(args, aws_client(args.region, args.profile))
        data = (
            json.dumps(
                result, ensure_ascii=False, allow_nan=False, separators=(",", ":")
            )
            + "\n"
        ).encode()
        if len(data) > MAX_BYTES:
            raise ValueError(
                "The capture exceeds 12 MiB. Select fewer services or a shorter window."
            )
        with args.output.open("xb") as file:
            file.write(data)
        print(
            f"Wrote {args.output} ({len(result['nodes'])} nodes, {len(result['edges'])} connections)."
        )
    except (
        OSError,
        subprocess.SubprocessError,
        ValueError,
        KeyError,
        TypeError,
    ) as error:
        parser.exit(1, f"Capture failed: {error}\n")


if __name__ == "__main__":
    main()

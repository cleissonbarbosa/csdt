"""Offline checks for the CloudWatch capture exporter.

The AWS CLI is never run: each test hands the exporter a fake `call`, or
patches `aws_client` to return one.
"""

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from argparse import ArgumentTypeError, Namespace
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

SPEC = importlib.util.spec_from_file_location(
    "export_cloudwatch_capture", HERE / "export-cloudwatch-capture.py"
)
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)

START = "2025-06-12T17:00:00Z"
GAP = "2025-06-12T18:00:00Z"
END = "2025-06-12T19:00:00Z"


def key(name, kind="Service"):
    return {"Name": name, "Type": kind, "Environment": "staging"}


def reference(metric, operation):
    return {
        "Namespace": "ApplicationSignals",
        "MetricName": metric,
        "Dimensions": [{"Name": "Operation", "Value": operation}],
    }


def arguments(**overrides):
    values = {
        "start": START,
        "end": END,
        "region": "us-east-1",
        "environment": "staging",
        "title": None,
        "service": ["checkout"],
        "cloudtrail_resource": [],
        "types": [],
    }
    values.update(overrides)
    return Namespace(**values)


def fake_aws(test, calls, events=()):
    """Two instrumented services that call each other, over two operations."""

    def aws(service, operation, params):
        calls.append((service, operation, params))
        if operation == "list-services":
            if "NextToken" in params:
                return {"ServiceSummaries": [{"KeyAttributes": key("payment")}]}
            return {
                "ServiceSummaries": [{"KeyAttributes": key("checkout")}],
                "NextToken": "second-page",
            }
        if operation == "list-service-dependencies":
            name = params["KeyAttributes"]["Name"]
            target = "payment" if name == "checkout" else "checkout"
            refs = [
                reference(m, op)
                for m in ("Fault", "Latency")
                for op in ("first", "second")
            ]
            return {
                "ServiceDependencies": [
                    {
                        "DependencyKeyAttributes": key(target, "RemoteService"),
                        "MetricReferences": refs,
                    }
                ]
            }
        if operation == "get-metric-data":
            results = []
            for query in params["MetricDataQueries"]:
                metric = query["MetricStat"]
                dimensions = {
                    d["Name"]: d["Value"] for d in metric["Metric"]["Dimensions"]
                }
                test.assertFalse(
                    dimensions.get("Operation") and metric["Stat"] == "p95"
                )
                first = 3 if metric["Stat"] == "Sum" else 12
                times = (
                    [START] if dimensions.get("Operation") == "second" else [START, GAP]
                )
                results.append(
                    {
                        "Id": query["Id"],
                        "Timestamps": times,
                        "Values": [first] * len(times),
                        "StatusCode": "Complete",
                    }
                )
            return {"MetricDataResults": results}
        if operation == "lookup-events":
            return {"Events": list(events)}
        test.fail(f"Unexpected AWS call: {operation}")

    return aws


def operations(calls):
    return [(service, operation) for service, operation, _ in calls]


class CaptureTest(unittest.TestCase):
    def test_capture_walks_cycles_and_uses_only_covered_samples(self):
        calls = []
        events = [
            {
                "EventId": "change",
                "EventName": "UpdateService",
                "EventSource": "ecs.amazonaws.com",
                "ReadOnly": "false",
                "EventTime": GAP,
                "CloudTrailEvent": "private payload",
            },
            {
                "EventId": "read",
                "EventName": "DescribeServices",
                "ReadOnly": "true",
                "EventTime": GAP,
            },
        ]
        result = exporter.capture(
            arguments(cloudtrail_resource=["checkout"]),
            fake_aws(self, calls, events),
        )
        self.assertEqual(result["kind"], "aegis-incident-capture")
        self.assertEqual(result["version"], 1)
        self.assertEqual(len(result["nodes"]), 2)
        self.assertEqual(len(result["edges"]), 2)
        edge = result["edges"][0]
        self.assertEqual(edge["target"], result["edges"][1]["source"])
        self.assertEqual(edge["source"], result["edges"][1]["target"])
        self.assertEqual(
            edge["buckets"],
            [{"atMs": exporter.timestamp(START), "requests": 24, "faults": 6}],
        )
        self.assertEqual(result["nodes"][0]["buckets"][0]["p95Ms"], 12)
        self.assertEqual(
            [event["title"] for event in result["events"]], ["UpdateService"]
        )
        self.assertNotIn("private payload", json.dumps(result))
        self.assertEqual(
            operations(calls).count(
                ("application-signals", "list-service-dependencies")
            ),
            2,
        )
        # Application Signals reports no resource type for a service.
        for node in result["nodes"]:
            self.assertEqual(
                (node["type"], node["typeSource"]), ("microservice", "assumed")
            )
            self.assertEqual(node["region"], "us-east-1")
        self.assertEqual(result["regions"], [{"id": "us-east-1", "name": "us-east-1"}])
        notes = " ".join(result["notes"])
        self.assertIn("for the resource names given to the exporter (1)", notes)
        # The window lies more than 90 days before the real clock.
        self.assertIn("CloudTrail's event history covers 90 days", notes)

    def test_without_resources_no_event_is_looked_up_and_the_capture_says_so(self):
        calls = []
        result = exporter.capture(arguments(), fake_aws(self, calls))
        self.assertNotIn(("cloudtrail", "lookup-events"), operations(calls))
        self.assertEqual(result["events"], [])
        self.assertIn(
            "No CloudTrail events were requested, so this capture does not show configuration changes.",
            result["notes"],
        )

    def test_a_recent_window_has_no_history_note(self):
        class Now(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2025, 6, 13, tzinfo=timezone.utc)

        with mock.patch.object(exporter, "datetime", Now):
            result = exporter.capture(
                arguments(cloudtrail_resource=["checkout"]), fake_aws(self, [])
            )
        self.assertNotIn("90 days", " ".join(result["notes"]))
        # One-minute data is still kept for a window this recent.
        self.assertEqual(result["periodMs"], 60_000)

    def test_kinds_are_the_service_type_enum_of_the_topology_schema(self):
        schema = json.loads(
            (ROOT / "schemas" / "v1" / "topology.schema.json").read_text("utf-8")
        )
        self.assertEqual(
            list(exporter.SERVICE_TYPES), schema["definitions"]["ServiceType"]["enum"]
        )
        self.assertIn(exporter.ASSUMED_TYPE, exporter.SERVICE_TYPES)
        for resource, kind in exporter.RESOURCE_TYPES.items():
            self.assertIn(kind, exporter.SERVICE_TYPES, resource)


INCOMPLETE = (
    "CloudWatch returned incomplete or empty service series. Missing samples are unknown."
)


def paged(test, calls, statuses):
    """fake_aws, with GetMetricData's answer split into one page per status:
    page n holds the n-th point of each series and says that status. Every
    page but the last hands a NextToken, as CloudWatch does with more to come."""
    whole = fake_aws(test, calls)

    def aws(service, operation, params):
        if operation != "get-metric-data":
            return whole(service, operation, params)
        token = params.get("NextToken")
        page = int(token) if token else 0
        reply = whole(
            service, operation, {k: v for k, v in params.items() if k != "NextToken"}
        )
        for result in reply["MetricDataResults"]:
            result["Timestamps"] = result["Timestamps"][page : page + 1]
            result["Values"] = result["Values"][page : page + 1]
            result["StatusCode"] = statuses[page]
        if page + 1 < len(statuses):
            reply["NextToken"] = str(page + 1)
        return reply

    return aws


class StatusTest(unittest.TestCase):
    """CloudWatch says PartialData on every page that has more to come; only
    the status a series ends on says whether it is incomplete."""

    def test_a_series_completed_on_a_later_page_is_complete(self):
        calls = []
        result = exporter.capture(
            arguments(), paged(self, calls, ["PartialData", "Complete"])
        )
        whole = exporter.capture(arguments(), fake_aws(self, []))
        self.assertEqual(operations(calls).count(("cloudwatch", "get-metric-data")), 2)
        self.assertEqual(
            [node["buckets"] for node in result["nodes"]],
            [node["buckets"] for node in whole["nodes"]],
        )
        self.assertEqual(result["edges"], whole["edges"])
        self.assertNotIn(INCOMPLETE, result["notes"])

    def test_a_series_that_ends_partial_is_incomplete(self):
        result = exporter.capture(arguments(), paged(self, [], ["PartialData"]))
        self.assertIn(INCOMPLETE, result["notes"])

    def test_an_error_on_any_page_is_incomplete(self):
        for status in ("InternalError", "Forbidden"):
            with self.subTest(status=status):
                result = exporter.capture(
                    arguments(), paged(self, [], [status, "Complete"])
                )
                self.assertIn(INCOMPLETE, result["notes"])

    def test_one_complete_page_is_complete(self):
        result = exporter.capture(arguments(), fake_aws(self, []))
        self.assertNotIn(INCOMPLETE, result["notes"])


class KindTest(unittest.TestCase):
    def test_a_reported_resource_type_is_mapped(self):
        arn = "arn:aws:dynamodb:eu-west-1:123456789012:table/orders"
        node = exporter.aws_node(
            "us-east-1",
            {
                "Type": "AWS::Resource",
                "ResourceType": "AWS::DynamoDB::Table",
                "Identifier": arn,
            },
            False,
        )
        self.assertEqual(node["type"], "database")
        self.assertEqual(node["typeSource"], "source")
        # The region comes from the ARN, never from the caller.
        self.assertEqual(node["region"], "eu-west-1")
        # The name is the identifier, account ID included (see docs/CAPTURES.md).
        self.assertEqual(node["name"], arn)

    def test_an_unreported_or_unmapped_resource_type_is_assumed(self):
        service = exporter.aws_node("us-east-1", key("checkout"), True)
        stream = exporter.aws_node(
            "us-east-1",
            {
                "Type": "AWS::Resource",
                "ResourceType": "AWS::Kinesis::Stream",
                "Identifier": "arn:aws:kinesis:us-west-2:123456789012:stream/clicks",
            },
            False,
        )
        remote = exporter.aws_node(
            "us-east-1", {"Type": "RemoteService", "Name": "partner-api"}, False
        )
        for node in (service, stream, remote):
            self.assertEqual(
                (node["type"], node["typeSource"]), ("microservice", "assumed")
            )
        self.assertEqual(service["region"], "us-east-1")
        self.assertEqual(stream["region"], "us-west-2")
        # A remote dependency without a location does not take the caller's.
        self.assertEqual(remote["region"], "unknown-region")

    def test_a_declared_kind_overrides_a_mapped_or_assumed_one(self):
        nodes = [
            exporter.aws_node("us-east-1", key("checkout"), True),
            exporter.aws_node(
                "us-east-1",
                {
                    "Type": "AWS::Resource",
                    "ResourceType": "AWS::SQS::Queue",
                    "Identifier": "orders",
                },
                False,
            ),
            exporter.aws_node("us-east-1", key("payment"), True),
        ]
        exporter.declare_kinds(
            nodes, [("checkout", "container"), ("orders", "database")]
        )
        self.assertEqual(
            [(node["name"], node["type"], node["typeSource"]) for node in nodes],
            [
                ("checkout", "container", "declared"),
                ("orders", "database", "declared"),
                ("payment", "microservice", "assumed"),
            ],
        )

    def test_a_declaration_names_exactly_one_node(self):
        nodes = [
            exporter.aws_node("us-east-1", key("checkout"), True),
            exporter.aws_node(
                "us-east-1", {"Type": "RemoteService", "Name": "checkout"}, False
            ),
            exporter.aws_node("us-east-1", key("payment"), True),
        ]
        with self.assertRaisesRegex(ValueError, r"named 'missing', found 0"):
            exporter.declare_kinds(nodes, [("missing", "database")])
        with self.assertRaisesRegex(ValueError, r"named 'checkout', found 2"):
            exporter.declare_kinds(nodes, [("checkout", "database")])
        # Matching is exact: no case folding, no prefix.
        with self.assertRaisesRegex(ValueError, r"named 'Payment', found 0"):
            exporter.declare_kinds(nodes, [("Payment", "database")])
        with self.assertRaisesRegex(ValueError, r"declares 'payment' more than once"):
            exporter.declare_kinds(
                nodes, [("payment", "database"), ("payment", "storage")]
            )

    def test_a_declaration_reads_name_and_kind(self):
        self.assertEqual(
            exporter.kind_pair("checkout=container"), ("checkout", "container")
        )
        # Only the last '=' separates: a kind never contains one.
        self.assertEqual(exporter.kind_pair("a=b=storage"), ("a=b", "storage"))
        with self.assertRaisesRegex(
            ArgumentTypeError, r"unknown kind 'widget' for 'checkout'"
        ):
            exporter.kind_pair("checkout=widget")
        for value in ("checkout", "=database"):
            with self.assertRaisesRegex(ArgumentTypeError, "expected NAME=KIND"):
                exporter.kind_pair(value)


class TrailTest(unittest.TestCase):
    def test_lookup_is_scoped_to_each_named_resource_and_the_window(self):
        start, end = exporter.timestamp(START), exporter.timestamp(END)
        calls = []
        before = "2025-06-12T16:59:59Z"
        after = "2025-06-12T19:00:01Z"

        def aws(service, operation, params):
            calls.append(params)
            self.assertEqual((service, operation), ("cloudtrail", "lookup-events"))
            resource = params["LookupAttributes"][0]["AttributeValue"]
            shared = {
                "EventId": "shared",
                "EventName": "PutBucketPolicy",
                "EventSource": "s3.amazonaws.com",
                "ReadOnly": "false",
                "EventTime": GAP,
            }
            if resource == "assets":
                return {
                    "Events": [
                        shared,
                        {
                            "EventId": "late",
                            "EventName": "DeleteBucket",
                            "EventSource": "s3.amazonaws.com",
                            "ReadOnly": "false",
                            "EventTime": after,
                        },
                        {
                            "EventId": "unstated",
                            "EventName": "Unknown",
                            "EventSource": "s3.amazonaws.com",
                            "EventTime": GAP,
                        },
                    ]
                }
            if "NextToken" not in params:
                return {
                    "Events": [
                        {
                            "EventId": "early",
                            "EventName": "CreateFunction",
                            "EventSource": "lambda.amazonaws.com",
                            "ReadOnly": "false",
                            "EventTime": before,
                        },
                        {
                            "EventId": "first",
                            "EventName": "UpdateFunctionCode",
                            "EventSource": "lambda.amazonaws.com",
                            "ReadOnly": False,
                            "EventTime": START,
                            "Username": "someone",
                            "CloudTrailEvent": '{"requestParameters": "private"}',
                        },
                    ],
                    "NextToken": "next",
                }
            return {"Events": [shared]}

        events = exporter.trail_events(aws, ["worker", "assets", "worker"], start, end)
        self.assertEqual(
            [
                (
                    params["LookupAttributes"],
                    params["StartTime"],
                    params["EndTime"],
                    params.get("NextToken"),
                )
                for params in calls
            ],
            [
                (
                    [{"AttributeKey": "ResourceName", "AttributeValue": "assets"}],
                    "2025-06-12T17:00:00Z",
                    "2025-06-12T19:00:00Z",
                    None,
                ),
                (
                    [{"AttributeKey": "ResourceName", "AttributeValue": "worker"}],
                    "2025-06-12T17:00:00Z",
                    "2025-06-12T19:00:00Z",
                    None,
                ),
                (
                    [{"AttributeKey": "ResourceName", "AttributeValue": "worker"}],
                    "2025-06-12T17:00:00Z",
                    "2025-06-12T19:00:00Z",
                    "next",
                ),
            ],
        )
        # Writes only, inside the window, each event once, in time order.
        self.assertEqual(
            events,
            [
                {
                    "atMs": start,
                    "title": "UpdateFunctionCode",
                    "detail": "CloudTrail · lambda.amazonaws.com · first",
                },
                {
                    "atMs": exporter.timestamp(GAP),
                    "title": "PutBucketPolicy",
                    "detail": "CloudTrail · s3.amazonaws.com · shared",
                },
            ],
        )
        self.assertNotIn("private", json.dumps(events))
        self.assertNotIn("someone", json.dumps(events))

    def test_too_many_events_stop_the_export(self):
        start, end = exporter.timestamp(START), exporter.timestamp(END)

        def aws(service, operation, params):
            return {
                "Events": [
                    {
                        "EventId": f"e{index}",
                        "EventName": "UpdateService",
                        "EventSource": "ecs.amazonaws.com",
                        "ReadOnly": "false",
                        "EventTime": GAP,
                    }
                    for index in range(4)
                ]
            }

        with (
            mock.patch.object(exporter, "MAX_EVENTS", 3),
            self.assertRaisesRegex(ValueError, "Too many CloudTrail events"),
        ):
            exporter.trail_events(aws, ["checkout"], start, end)

    def test_a_repeated_page_token_stops_the_export(self):
        def aws(service, operation, params):
            return {"Events": [], "NextToken": "same"}

        with self.assertRaisesRegex(ValueError, "Repeated pagination token"):
            exporter.trail_events(aws, ["checkout"], 0, 1000)


class MainTest(unittest.TestCase):
    def run_main(self, argv):
        error = io.StringIO()
        with (
            contextlib.redirect_stderr(error),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            try:
                exporter.main(argv)
            except SystemExit as stop:
                return stop.code, error.getvalue()
        return 0, error.getvalue()

    def argv(self, output, *extra):
        return [
            "--region",
            "us-east-1",
            "--environment",
            "staging",
            "--service",
            "checkout",
            "--start",
            START,
            "--end",
            END,
            "--output",
            str(output),
            *extra,
        ]

    def test_an_unknown_kind_is_refused_before_any_call(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "capture.json"
            with mock.patch.object(
                exporter, "aws_client", side_effect=AssertionError("called AWS")
            ):
                code, error = self.run_main(
                    self.argv(output, "--type", "checkout=widget")
                )
            self.assertEqual(code, 2)
            self.assertIn("unknown kind 'widget' for 'checkout'", error)
            self.assertFalse(output.exists())

    def test_a_name_no_node_has_stops_before_any_metric_is_read(self):
        calls = []
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "capture.json"
            with mock.patch.object(
                exporter, "aws_client", return_value=fake_aws(self, calls)
            ):
                code, error = self.run_main(
                    self.argv(output, "--type", "inventory=database")
                )
            self.assertEqual(code, 1)
            self.assertIn("named 'inventory', found 0", error)
            self.assertNotIn(("cloudwatch", "get-metric-data"), operations(calls))
            self.assertFalse(output.exists())

    def test_the_capture_is_written_with_the_declared_kind(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "capture.json"
            with mock.patch.object(
                exporter, "aws_client", return_value=fake_aws(self, [])
            ):
                code, error = self.run_main(
                    self.argv(output, "--type", "payment=serverless")
                )
                self.assertEqual((code, error), (0, ""))
                result = json.loads(output.read_text("utf-8"))
                # The exporter never overwrites a file.
                code, error = self.run_main(self.argv(output))
                self.assertEqual(code, 1)
                self.assertIn("Output already exists", error)
        self.assertEqual(result["kind"], "aegis-incident-capture")
        self.assertEqual(
            {
                node["name"]: (node["type"], node["typeSource"])
                for node in result["nodes"]
            },
            {
                "checkout": ("microservice", "assumed"),
                "payment": ("serverless", "declared"),
            },
        )


if __name__ == "__main__":
    unittest.main()

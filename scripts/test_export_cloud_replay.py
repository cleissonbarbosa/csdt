"""Offline contract checks for the CloudWatch replay exporter."""

import importlib.util
import unittest
from argparse import Namespace
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "export_cloud_replay", Path(__file__).with_name("export-cloud-replay.py")
)
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


def key(name, kind="Service"):
    return {"Name": name, "Type": kind, "Environment": "staging"}


def reference(metric, operation):
    return {
        "Namespace": "ApplicationSignals",
        "MetricName": metric,
        "Dimensions": [{"Name": "Operation", "Value": operation}],
    }


class CloudReplayTest(unittest.TestCase):
    def test_capture_walks_cycles_and_uses_only_covered_samples(self):
        start = "2025-06-12T17:00:00Z"
        gap = "2025-06-12T18:00:00Z"
        end = "2025-06-12T19:00:00Z"
        calls = []

        def aws(service, operation, params):
            calls.append((service, operation))
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
                    self.assertFalse(
                        dimensions.get("Operation") and metric["Stat"] == "p95"
                    )
                    first = 3 if metric["Stat"] == "Sum" else 12
                    times = (
                        [start]
                        if dimensions.get("Operation") == "second"
                        else [start, gap]
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
                return {
                    "Events": [
                        {
                            "EventId": "change",
                            "EventName": "UpdateService",
                            "EventSource": "ecs.amazonaws.com",
                            "ReadOnly": "false",
                            "EventTime": gap,
                            "CloudTrailEvent": "private payload",
                        },
                        {
                            "EventId": "read",
                            "EventName": "DescribeServices",
                            "ReadOnly": "true",
                            "EventTime": gap,
                        },
                    ]
                }
            self.fail(f"Unexpected AWS call: {operation}")

        result = exporter.capture(
            Namespace(
                start=start,
                end=end,
                region="us-east-1",
                environment="staging",
                title=None,
                service=["checkout"],
                cloudtrail_resource=["checkout"],
            ),
            aws,
        )
        self.assertEqual(result["kind"], "aegis-cloud-replay")
        self.assertEqual(len(result["nodes"]), 2)
        self.assertEqual(len(result["edges"]), 2)
        edge = result["edges"][0]
        self.assertEqual(edge["target"], result["edges"][1]["source"])
        self.assertEqual(edge["source"], result["edges"][1]["target"])
        self.assertEqual(
            edge["buckets"],
            [
                {
                    "atMs": exporter.timestamp(start),
                    "requests": 24,
                    "faults": 6,
                }
            ],
        )
        self.assertEqual(result["nodes"][0]["buckets"][0]["p95Ms"], 12)
        self.assertEqual(
            [event["title"] for event in result["events"]], ["UpdateService"]
        )
        self.assertNotIn("private payload", str(result))
        self.assertEqual(
            calls.count(("application-signals", "list-service-dependencies")), 2
        )


if __name__ == "__main__":
    unittest.main()

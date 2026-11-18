"""Check the RCAEval rebuild on a small archive made here, and that the
committed Online Boutique capture still has the shape the script gives it.

The real archive is not in the repository, so the script's SHA-256 pin is
patched to the synthetic archive's own hash for the duration of a test.
"""

import contextlib
import csv
import hashlib
import importlib.util
import io
import json
import math
import re
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

spec = importlib.util.spec_from_file_location("rcaeval", HERE / "capture-rcaeval.py")
rcaeval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rcaeval)

INJECTION = 1_700_000_000
START = INJECTION - 300
END = INJECTION + 300
TRACE_FIELDS = [
    "traceID",
    "spanID",
    "parentSpanID",
    "serviceName",
    "startTimeMillis",
    "duration",
]


def table(fields, records):
    text = io.StringIO()
    writer = csv.DictWriter(text, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(records)
    return text.getvalue()


def archive(metrics, traces):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as folder:
        folder.writestr("multi-source-data/inject_time.txt", f"{INJECTION}\n")
        folder.writestr(
            "multi-source-data/metrics.csv",
            table(
                [
                    "time",
                    "checkoutservice_mem",
                    "frontend_mem",
                    "redis_mem",
                    "cartservice_mem",
                ],
                metrics,
            ),
        )
        folder.writestr("multi-source-data/traces.csv", table(TRACE_FIELDS, traces))
    return data.getvalue()


def metric(second, checkout="", frontend="", redis=""):
    return {
        "time": str(second),
        "checkoutservice_mem": checkout,
        "frontend_mem": frontend,
        "redis_mem": redis,
        "cartservice_mem": "",
    }


def span(trace, identity, parent, service, ms, duration):
    return dict(
        zip(TRACE_FIELDS, [trace, identity, parent, service, str(ms), str(duration)])
    )


AT_START = START * 1000
AT_INJECTION = INJECTION * 1000

METRICS = [
    metric(START - 100, checkout="999999999"),  # before the window
    metric(START, checkout="100", frontend="200", redis="50"),
    metric(START + 10, checkout="150", frontend="180"),
    metric(INJECTION, checkout="300"),
    metric(INJECTION + 45, checkout="1234567.0"),
    metric(
        INJECTION + 60, checkout="1234567"
    ),  # equal: the first sample stays the peak
    metric(END, checkout="999999999"),  # the window's end is excluded
]

TRACES = [
    # The root precedes the window; its child inside the window still has a caller.
    span("t1", "a", "", "frontendservice", (START - 100) * 1000, 9000),
    span("t1", "b", "a", "checkoutservice", AT_START + 1000, 2000),
    span("t1", "c", "b", "redis", AT_START + 2000, 500),
    span("t1", "d", "b", "checkoutservice", AT_START + 3000, 700),  # same service
    # A duplicated span identity is ambiguous: its child supplies no edge.
    span("t2", "a", "", "frontendservice", AT_START, 100),
    span("t2", "a", "", "frontendservice", AT_START, 100),
    span("t2", "b", "a", "checkoutservice", AT_START + 1, 100),
    # A parent that is not in the table supplies no edge either.
    span("t3", "x", "missing", "redis", AT_START + 1, 100),
    # Twenty calls in one interval, for the nearest-rank p95.
    span("t4", "r", "", "frontendservice", AT_INJECTION, 50_000),
    *[
        span("t4", f"c{i}", "r", "checkoutservice", AT_INJECTION + i, i * 1000)
        for i in range(1, 21)
    ],
    span("t4", "late", "r", "checkoutservice", END * 1000, 1000),  # after the window
    # A caller with no memory series is still a service of the capture.
    span("t5", "g", "", "loadgenerator", AT_START, 100),
    span("t5", "h", "g", "frontendservice", AT_START + 5, 4000),
]


def committed():
    found = sorted(
        (ROOT / "apps/web/src/features").glob("*/online-boutique-rcaeval.json")
    )
    if len(found) != 1:
        raise AssertionError(
            f"Expected one committed Online Boutique capture, found {found}"
        )
    return json.loads(found[0].read_text(encoding="utf-8"))


class RebuildTest(unittest.TestCase):
    def rebuild(self, metrics=METRICS, traces=TRACES):
        data = archive(metrics, traces)
        with mock.patch.object(rcaeval, "SHA256", hashlib.sha256(data).hexdigest()):
            return rcaeval.rebuild(data)

    def test_refuses_any_other_archive(self):
        with self.assertRaisesRegex(ValueError, "Expected RCAEval 0.2.0"):
            rcaeval.rebuild(archive(METRICS, TRACES))

    def test_accepts_bytes_or_a_binary_file(self):
        data = archive(METRICS, TRACES)
        with mock.patch.object(rcaeval, "SHA256", hashlib.sha256(data).hexdigest()):
            self.assertEqual(rcaeval.rebuild(data), rcaeval.rebuild(io.BytesIO(data)))

    def test_window_buckets_and_calls(self):
        capture = self.rebuild()
        self.assertEqual(capture["window"], {"startMs": AT_START, "endMs": END * 1000})
        self.assertEqual(capture["periodMs"], 30_000)
        nodes = {node["id"]: node for node in capture["nodes"]}
        # cartservice has an empty series and no calls, so it is not a service here.
        self.assertEqual(
            list(nodes), ["checkoutservice", "frontend", "loadgenerator", "redis"]
        )
        self.assertEqual(
            nodes["checkoutservice"]["buckets"],
            [
                {"atMs": AT_START, "memoryBytes": 150, "requests": 1, "p95Ms": 2.0},
                {
                    "atMs": AT_INJECTION,
                    "memoryBytes": 300,
                    "requests": 20,
                    "p95Ms": 19.0,
                },
                {"atMs": AT_INJECTION + 30_000, "memoryBytes": 1234567},
                {"atMs": AT_INJECTION + 60_000, "memoryBytes": 1234567},
            ],
        )
        self.assertEqual(
            nodes["frontend"]["buckets"],
            [{"atMs": AT_START, "memoryBytes": 200, "requests": 1, "p95Ms": 4.0}],
        )
        self.assertEqual(nodes["loadgenerator"]["buckets"], [])
        self.assertEqual(
            [(edge["source"], edge["target"]) for edge in capture["edges"]],
            [
                ("checkoutservice", "redis"),
                ("frontend", "checkoutservice"),
                ("loadgenerator", "frontend"),
            ],
        )
        calls = {
            (edge["source"], edge["target"]): edge["buckets"]
            for edge in capture["edges"]
        }
        self.assertEqual(
            calls[("frontend", "checkoutservice")],
            [
                {"atMs": AT_START, "requests": 1, "p95Ms": 2.0},
                {"atMs": AT_INJECTION, "requests": 20, "p95Ms": 19.0},
            ],
        )
        for item in [*capture["nodes"], *capture["edges"]]:
            for bucket in item["buckets"]:
                self.assertNotIn("faults", bucket)

    def test_events_with_a_peak_after_the_injection(self):
        capture = self.rebuild()
        self.assertEqual(
            capture["events"],
            [
                {
                    "atMs": AT_INJECTION,
                    "title": "Benchmark fault injected",
                    "detail": "Timestamp from the published inject_time.txt. This marker identifies the intervention time only.",
                },
                {
                    "atMs": (INJECTION + 45) * 1000,
                    "title": "Checkout memory peak after injection",
                    "detail": "First sample at the post-injection maximum in this window: 1,234,567 bytes in checkoutservice_mem.",
                    "nodes": ["checkoutservice"],
                },
            ],
        )
        self.assertNotIn(rcaeval.NO_PEAK, capture["notes"])

    def test_no_peak_event_without_a_sample_after_the_injection(self):
        before = [row for row in METRICS if int(row["time"]) < INJECTION]
        capture = self.rebuild(metrics=before)
        self.assertEqual(
            [event["title"] for event in capture["events"]],
            ["Benchmark fault injected"],
        )
        self.assertEqual(capture["notes"][-1], rcaeval.NO_PEAK)
        self.assertEqual(
            rcaeval.NO_PEAK,
            "No checkoutservice memory sample after the injection in this window.",
        )

    def test_every_kind_is_assumed(self):
        for node in self.rebuild()["nodes"]:
            self.assertEqual(
                (node["type"], node["typeSource"]),
                ("database" if node["name"] == "redis" else "microservice", "assumed"),
            )

    def test_command_line(self):
        data = archive(METRICS, TRACES)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "multi-source-data.zip"
            path.write_bytes(data)
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                self.assertEqual(rcaeval.main([str(path)]), 1)
            self.assertIn("Expected RCAEval 0.2.0", err.getvalue())
            self.assertEqual(out.getvalue(), "")
            out = io.StringIO()
            with mock.patch.object(rcaeval, "SHA256", hashlib.sha256(data).hexdigest()):
                with contextlib.redirect_stdout(out):
                    self.assertEqual(rcaeval.main([str(path)]), 0)
                self.assertEqual(json.loads(out.getvalue()), rcaeval.rebuild(data))


class CommittedCaptureTest(unittest.TestCase):
    """The archive is not in the repository, so the committed file's values
    cannot be rebuilt here, and nothing here shows that they are a rebuild's.
    What this holds: every field the script writes without reading the archive
    is what the script writes now, and the values have the shape the script
    gives them. Only a rebuild from the archive can compare the values (the
    script's docstring says how)."""

    def setUp(self):
        self.capture = committed()
        data = archive(METRICS, TRACES)
        with mock.patch.object(rcaeval, "SHA256", hashlib.sha256(data).hexdigest()):
            self.rebuilt = rcaeval.rebuild(data)

    def test_fields_the_script_states(self):
        for key in [
            "kind",
            "version",
            "title",
            "source",
            "periodMs",
            "regions",
            "notes",
        ]:
            self.assertEqual(self.capture[key], self.rebuilt[key], key)
        self.assertEqual(list(self.capture), list(self.rebuilt))
        self.assertEqual(
            [event["title"] for event in self.capture["events"]],
            [event["title"] for event in self.rebuilt["events"]],
        )
        self.assertEqual(
            self.capture["events"][0]["detail"], self.rebuilt["events"][0]["detail"]
        )

    def test_kinds_follow_the_scripts_rule(self):
        region = self.capture["regions"][0]["id"]
        self.assertEqual(len(self.capture["nodes"]), 11)
        for node in self.capture["nodes"]:
            self.assertEqual(
                list(node), ["id", "name", "region", "type", "typeSource", "buckets"]
            )
            self.assertEqual(node["id"], node["name"])
            self.assertEqual(node["region"], region)
            self.assertEqual(
                {"type": node["type"], "typeSource": node["typeSource"]},
                rcaeval.kind_of(node["name"]),
            )

    def test_values_have_the_scripts_shape(self):
        window = self.capture["window"]
        injection = self.capture["events"][0]["atMs"]
        self.assertEqual(window["endMs"] - window["startMs"], 600_000)
        self.assertEqual(injection - window["startMs"], 300_000)
        for node in self.capture["nodes"]:
            for bucket in node["buckets"]:
                self.assertLessEqual(
                    set(bucket), {"atMs", "memoryBytes", "requests", "p95Ms"}
                )
        for edge in self.capture["edges"]:
            self.assertEqual(list(edge), ["source", "target", "buckets"])
            for bucket in edge["buckets"]:
                self.assertEqual(list(bucket), ["atMs", "requests", "p95Ms"])
        for item in [*self.capture["nodes"], *self.capture["edges"]]:
            times = [bucket["atMs"] for bucket in item["buckets"]]
            self.assertEqual(times, sorted(set(times)))
            for at in times:
                self.assertTrue(window["startMs"] <= at < window["endMs"])
                self.assertEqual((at - window["startMs"]) % self.capture["periodMs"], 0)

    def test_peak_event_matches_the_memory_series(self):
        peak = self.capture["events"][1]
        match = re.fullmatch(
            r"First sample at the post-injection maximum in this window: ([0-9,]+) bytes in checkoutservice_mem\.",
            peak["detail"],
        )
        self.assertIsNotNone(match, peak["detail"])
        size = int(match.group(1).replace(",", ""))
        injection = self.capture["events"][0]["atMs"]
        period = self.capture["periodMs"]
        (checkout,) = [
            node for node in self.capture["nodes"] if node["id"] == "checkoutservice"
        ]
        after = [
            bucket for bucket in checkout["buckets"] if bucket["atMs"] >= injection
        ]
        self.assertEqual(max(bucket["memoryBytes"] for bucket in after), size)
        (holding,) = [
            bucket
            for bucket in after
            if bucket["atMs"] <= peak["atMs"] < bucket["atMs"] + period
        ]
        self.assertEqual(holding["memoryBytes"], size)
        self.assertEqual(peak["nodes"], ["checkoutservice"])
        self.assertEqual(math.floor(peak["atMs"] / 1000) * 1000, peak["atMs"])


if __name__ == "__main__":
    unittest.main()

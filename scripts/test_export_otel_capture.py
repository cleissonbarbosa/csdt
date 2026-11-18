"""Offline checks for the Tempo / Prometheus capture exporter.

No backend is reached: each test hands the exporter fake `prom` and `tempo`
readers, or replaces the URL opener. The proxy tests start their own
listeners on 127.0.0.1 and nothing else.
"""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import threading
import unittest
from argparse import ArgumentTypeError, Namespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

spec = importlib.util.spec_from_file_location("otel", HERE / "export-otel-capture.py")
otel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(otel)

PERIOD = 60
T0 = otel.epoch("2025-01-01T00:00:00Z")


def arguments(**overrides):
    values = {
        "service": "cart",
        "start": "2025-01-01T00:00:00Z",
        "end": "2025-01-01T00:02:00Z",
        "period": PERIOD,
        "label": [],
        "trace_limit": 10,
        "trace_resource": [],
        "types": [],
    }
    values.update(overrides)
    return Namespace(**values)


def matrix(*series, warnings=None):
    reply = {
        "status": "success",
        "data": {
            "resultType": "matrix",
            "result": [
                {"metric": labels, "values": values} for labels, values in series
            ],
        },
    }
    if warnings:
        reply["warnings"] = warnings
    return reply


def field_of(query):
    if "histogram_quantile" in query:
        return "p95Ms"
    return "faults" if "failed_total" in query else "requests"


def no_tempo(test):
    def tempo(path, params=None):
        test.fail(f"Tempo was asked {path}")

    return tempo


def empty_tempo(path, params=None):
    return {"traces": []}


class ExportTest(unittest.TestCase):
    def test_interval_start_missing_series_and_error_span_time(self):
        args = arguments(
            label=[("cluster", "lab")], trace_resource=[("k8s.cluster.name", "lab")]
        )
        start = otel.epoch(args.start)

        def prom(path, params):
            self.assertEqual(path, "/api/v1/query_range")
            self.assertEqual(params["start"], start + 60)
            q = params["query"]
            self.assertIn('cluster="lab"', q)
            values = [[start + 60, "10.5"], [start + 120, "12"]]
            if "failed_total" in q:
                values = [[start + 120, "2"]]
            if "histogram_quantile" in q:
                values = [[start + 60, "NaN"], [start + 120, "85"]]
            return matrix(({"client": "web", "server": "cart"}, values))

        def tempo(path, params=None):
            if path == "/api/search":
                self.assertIn("status = error", params["q"])
                return {
                    "traces": [
                        {"traceID": "aa" * 16, "startTimeUnixNano": str(start * 10**9)}
                    ]
                }
            self.assertEqual(path, "/api/traces/" + "aa" * 16)
            return {
                "batches": [
                    {
                        "resource": {
                            "attributes": [
                                {"key": k, "value": {"stringValue": v}}
                                for k, v in [
                                    ("service.name", "cart"),
                                    ("k8s.cluster.name", "lab"),
                                ]
                            ]
                        },
                        "scopeSpans": [
                            {
                                "spans": [
                                    {
                                        "name": "GetCart",
                                        "status": {"code": "STATUS_CODE_ERROR"},
                                        "startTimeUnixNano": str((start + 71) * 10**9),
                                    }
                                ]
                            }
                        ],
                    }
                ]
            }

        result = otel.capture(args, prom, tempo)
        samples = result["edges"][0]["buckets"]
        self.assertEqual(samples[0], {"atMs": start * 1000, "requests": 10.5})
        self.assertEqual(samples[1]["p95Ms"], 85)
        self.assertEqual(result["events"][0]["atMs"], (start + 71) * 1000)
        self.assertEqual(result["kind"], "aegis-incident-capture")
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["source"]["kind"], "tempo-prometheus")
        # The backend's address never enters the capture.
        self.assertNotIn("url", result["source"])
        self.assertEqual(
            result["regions"], [{"id": "unreported", "name": "Location not reported"}]
        )
        self.assertIn(
            "its errors are not measured there, rather than zero",
            " ".join(result["notes"]),
        )
        for node in result["nodes"]:
            self.assertEqual(node["region"], "unreported")
            self.assertEqual(
                (node["type"], node["typeSource"]), ("microservice", "assumed")
            )

    def test_empty_graph_is_actionable(self):
        reply = matrix()
        with self.assertRaisesRegex(ValueError, "No service-graph samples"):
            otel.graph(
                lambda *args: reply,
                Namespace(service="cart", label=[], period=60),
                0,
                120,
            )

    def test_kinds_are_the_service_type_enum_of_the_topology_schema(self):
        schema = json.loads(
            (ROOT / "schemas" / "v1" / "topology.schema.json").read_text("utf-8")
        )
        self.assertEqual(
            list(otel.SERVICE_TYPES), schema["definitions"]["ServiceType"]["enum"]
        )
        self.assertIn(otel.ASSUMED_TYPE, otel.SERVICE_TYPES)


class GapTest(unittest.TestCase):
    """A missing Prometheus value is no measurement, never a zero."""

    def capture(self):
        t1, t2, t3, t4 = (T0 + PERIOD * n for n in (1, 2, 3, 4))
        replies = {
            "requests": [
                # An interval missing (t2) stays missing.
                ({"client": "web", "server": "cart"}, [[t1, "6"], [t3, "9"]]),
                (
                    {"client": "api", "server": "cart"},
                    [[t1, "4"], [t2, "5"], [t3, "1"]],
                ),
                (
                    {"client": "cart", "server": "db"},
                    # t0 would measure the interval before the window, t4 one
                    # past its end; a negative or infinite value is no count.
                    [[T0, "1"], [t1, "3"], [t2, "-1"], [t3, "+Inf"], [t4, "2"]],
                ),
                # One hop only: a pair without the service is not read.
                ({"client": "web", "server": "db"}, [[t1, "50"]]),
                ({"client": "cart", "server": "cart"}, [[t1, "50"]]),
                ({"server": "cart"}, [[t1, "50"]]),
            ],
            # The failed counter appears only once something failed.
            "faults": [({"client": "web", "server": "cart"}, [[t3, "2"]])],
            "p95Ms": [
                ({"client": "web", "server": "cart"}, [[t1, "NaN"], [t3, "40"]]),
                # Percentiles of two streams cannot be combined into one.
                ({"client": "api", "server": "cart"}, [[t1, "30"]]),
                ({"client": "cart", "server": "db"}, [[t1, "12"]]),
            ],
        }

        def prom(path, params):
            self.assertEqual(
                (params["start"], params["end"], params["step"]),
                (T0 + PERIOD, T0 + PERIOD * 3, PERIOD),
            )
            return matrix(*replies[field_of(params["query"])])

        return otel.capture(arguments(end="2025-01-01T00:03:00Z"), prom, empty_tempo)

    def test_edges_keep_only_measured_intervals(self):
        result = self.capture()
        names = {node["id"]: node["name"] for node in result["nodes"]}
        edges = {
            (names[edge["source"]], names[edge["target"]]): edge["buckets"]
            for edge in result["edges"]
        }
        ms = 1000
        self.assertEqual(
            edges,
            {
                ("api", "cart"): [
                    {"atMs": T0 * ms, "requests": 4, "p95Ms": 30},
                    {"atMs": (T0 + 60) * ms, "requests": 5},
                    {"atMs": (T0 + 120) * ms, "requests": 1},
                ],
                ("cart", "db"): [{"atMs": T0 * ms, "requests": 3, "p95Ms": 12}],
                ("web", "cart"): [
                    {"atMs": T0 * ms, "requests": 6},
                    {"atMs": (T0 + 120) * ms, "requests": 9, "faults": 2, "p95Ms": 40},
                ],
            },
        )

    def test_a_node_sums_an_interval_only_when_every_incoming_stream_has_it(self):
        result = self.capture()
        nodes = {node["name"]: node["buckets"] for node in result["nodes"]}
        ms = 1000
        self.assertEqual(sorted(nodes), ["api", "cart", "db", "web"])
        # cart has two incoming streams: no sum while one is missing, never
        # a fault count unless both have one, and no percentile at all.
        self.assertEqual(
            nodes["cart"],
            [
                {"atMs": T0 * ms, "requests": 10},
                {"atMs": (T0 + 120) * ms, "requests": 10},
            ],
        )
        # One incoming stream: its own figures, and errors absent, not zero.
        self.assertEqual(nodes["db"], [{"atMs": T0 * ms, "requests": 3, "p95Ms": 12}])
        # A service seen only as a caller has no measurement of its own.
        self.assertEqual(nodes["web"], [])
        self.assertEqual(nodes["api"], [])
        self.assertNotIn("faults", json.dumps([nodes["db"], nodes["cart"]]))

    def test_query_warnings_are_noted(self):
        def prom(path, params):
            warnings = (
                ["partial response"] if field_of(params["query"]) == "faults" else None
            )
            return matrix(
                ({"client": "web", "server": "cart"}, [[T0 + 60, "1"]]),
                warnings=warnings,
            )

        result = otel.capture(arguments(), prom, empty_tempo)
        self.assertIn(
            "Prometheus returned query warnings for faults. Coverage may be incomplete.",
            result["notes"],
        )


class KindTest(unittest.TestCase):
    @staticmethod
    def prom(path, params):
        return matrix(
            ({"client": "web", "server": "cart"}, [[T0 + 60, "1"]]),
            ({"client": "cart", "server": "redis"}, [[T0 + 60, "1"]]),
        )

    def test_a_declared_kind_replaces_the_assumed_one(self):
        result = otel.capture(
            arguments(types=[("redis", "database"), ("web", "external-client")]),
            self.prom,
            empty_tempo,
        )
        self.assertEqual(
            {
                node["name"]: (node["type"], node["typeSource"])
                for node in result["nodes"]
            },
            {
                "cart": ("microservice", "assumed"),
                "redis": ("database", "declared"),
                "web": ("external-client", "declared"),
            },
        )

    def test_a_name_no_service_has_stops_before_tempo_is_asked(self):
        with self.assertRaisesRegex(ValueError, r"named 'Redis', found 0"):
            otel.capture(
                arguments(types=[("Redis", "database")]), self.prom, no_tempo(self)
            )
        with self.assertRaisesRegex(ValueError, r"declares 'redis' more than once"):
            otel.capture(
                arguments(types=[("redis", "database"), ("redis", "storage")]),
                self.prom,
                no_tempo(self),
            )

    def test_a_declaration_reads_name_and_kind(self):
        self.assertEqual(otel.kind_pair("redis=database"), ("redis", "database"))
        with self.assertRaisesRegex(
            ArgumentTypeError, r"unknown kind 'cache' for 'redis'"
        ):
            otel.kind_pair("redis=cache")
        with self.assertRaisesRegex(ArgumentTypeError, "expected NAME=KIND"):
            otel.kind_pair("redis")


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Opener:
    def __init__(self):
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        return Response(b'{"traces": []}')


class TokenTest(unittest.TestCase):
    def test_a_token_is_refused_over_plain_http_to_another_host(self):
        for url in (
            "http://tempo.example.com:3200",
            "http://10.0.0.7:9090",
            "http://localhost.example.com",
            "http://127.0.0.1.nip.io",
        ):
            with self.subTest(url=url):
                with self.assertRaises(ValueError) as refused:
                    otel.reader(url, "s3cret", None, "TEMPO_TOKEN")
                message = str(refused.exception)
                self.assertIn("TEMPO_TOKEN is set", message)
                self.assertIn(otel.urlsplit(url).hostname, message)
                self.assertNotIn("s3cret", message)

    def test_a_token_goes_over_https_or_to_a_loopback_host(self):
        for url in (
            "https://tempo.example.com",
            "http://localhost:3200",
            "http://LOCALHOST:3200",
            "http://127.0.0.1:9090",
            "http://127.8.9.10:9090",
            "http://[::1]:9090",
        ):
            with self.subTest(url=url):
                opener = Opener()
                with mock.patch.object(otel, "build_opener", return_value=opener):
                    get = otel.reader(url, "s3cret", "team-a", "TEMPO_TOKEN")
                    self.assertEqual(get("/api/search", {"q": "{}"}), {"traces": []})
                (request,) = opener.requests
                self.assertEqual(request.get_header("Authorization"), "Bearer s3cret")
                self.assertEqual(request.get_header("X-scope-orgid"), "team-a")
                self.assertEqual(request.get_method(), "GET")

    def test_without_a_token_plain_http_carries_no_authorization(self):
        opener = Opener()
        with mock.patch.object(otel, "build_opener", return_value=opener):
            otel.reader("http://tempo.example.com:3200", None, None, "TEMPO_TOKEN")(
                "/api/search"
            )
        (request,) = opener.requests
        self.assertIsNone(request.get_header("Authorization"))

    def test_a_redirect_is_never_followed(self):
        self.assertIsNone(
            otel.NoRedirect().redirect_request(None, None, 302, "Found", {}, "http://x")
        )

    def test_main_refuses_before_any_request(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "capture.json"
            error = io.StringIO()
            with (
                mock.patch.dict(os.environ, {"PROMETHEUS_TOKEN": "s3cret"}),
                mock.patch.object(
                    otel, "build_opener", side_effect=AssertionError("opened")
                ),
                contextlib.redirect_stderr(error),
                self.assertRaises(SystemExit) as stop,
            ):
                otel.main(
                    [
                        "--tempo-url",
                        "http://localhost:3200",
                        "--prometheus-url",
                        "http://prometheus.example.com:9090",
                        "--service",
                        "cart",
                        "--start",
                        "2025-01-01T00:00:00Z",
                        "--end",
                        "2025-01-01T00:02:00Z",
                        "--output",
                        str(output),
                    ]
                )
            self.assertEqual(stop.exception.code, 1)
            self.assertIn("PROMETHEUS_TOKEN is set", error.getvalue())
            self.assertNotIn("s3cret", error.getvalue())
            self.assertFalse(output.exists())

    def test_main_refuses_an_unknown_kind(self):
        error = io.StringIO()
        with contextlib.redirect_stderr(error), self.assertRaises(SystemExit) as stop:
            otel.main(
                [
                    "--tempo-url",
                    "http://localhost:3200",
                    "--prometheus-url",
                    "http://localhost:9090",
                    "--service",
                    "cart",
                    "--start",
                    "2025-01-01T00:00:00Z",
                    "--end",
                    "2025-01-01T00:02:00Z",
                    "--output",
                    "unused.json",
                    "--type",
                    "cart=widget",
                ]
            )
        self.assertEqual(stop.exception.code, 2)
        self.assertIn("unknown kind 'widget' for 'cart'", error.getvalue())


class Recorder(BaseHTTPRequestHandler):
    """Answers every GET with an empty trace search and keeps what it was sent."""

    def do_GET(self):
        self.server.seen.append(
            (self.requestline, self.headers.get("Authorization"))
        )
        body = b'{"traces": []}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@contextlib.contextmanager
def listening():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Recorder)
    server.seen = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class ProxyTest(unittest.TestCase):
    """A proxy named by the environment, which may be on another host, never
    receives a request for a loopback backend, so it never reads a token sent
    there over plain HTTP. Any other backend is still reached through it."""

    @contextlib.contextmanager
    def proxied(self):
        with listening() as proxy, mock.patch.dict(os.environ):
            address = f"http://127.0.0.1:{proxy.server_port}"
            for name in ("no_proxy", "NO_PROXY", "REQUEST_METHOD"):
                os.environ.pop(name, None)
            for name in ("http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"):
                os.environ[name] = address
            yield proxy

    def test_a_loopback_backend_is_asked_directly(self):
        with self.proxied() as proxy, listening() as backend:
            for host in ("127.0.0.1", "localhost"):
                with self.subTest(host=host):
                    url = f"http://{host}:{backend.server_port}"
                    get = otel.reader(url, "s3cret", None, "TEMPO_TOKEN")
                    self.assertEqual(get("/api/search", {"q": "x"}), {"traces": []})
            self.assertEqual(proxy.seen, [])
            self.assertEqual(
                backend.seen,
                [("GET /api/search?q=x HTTP/1.1", "Bearer s3cret")] * 2,
            )

    def test_another_backend_still_goes_through_the_proxy(self):
        with self.proxied() as proxy:
            get = otel.reader("http://tempo.invalid:3200", None, None, "TEMPO_TOKEN")
            self.assertEqual(get("/api/search"), {"traces": []})
        self.assertEqual(
            proxy.seen, [("GET http://tempo.invalid:3200/api/search HTTP/1.1", None)]
        )


if __name__ == "__main__":
    unittest.main()

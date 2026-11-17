//! HTTP contract tests against the in-process router.
#![allow(clippy::unwrap_used)]

mod common;

use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use common::{get, post, raw, state, state_with};
use serde_json::{json, Value};

const BASE: &str = "/api/v1";

fn path(suffix: &str) -> String {
    format!("{BASE}{suffix}")
}

/// Advances virtual time by `seconds` at 1x.
fn advance(state: &aegis_server::api::AppState, seconds: u64) {
    for _ in 0..seconds * 5 {
        state.service.advance(Duration::from_millis(200));
    }
}

#[tokio::test]
async fn health_reports_versions_and_sets_security_headers() {
    let state = state();
    let reply = get(&state, &path("/health")).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["status"], "ok");
    assert_eq!(reply.body["schemaVersion"], "1.0");
    assert_eq!(reply.body["protocolVersion"], 1);
    assert_eq!(reply.body["mode"], "demo");
    assert_eq!(reply.body["topologyId"], "helios-commerce");
    assert_eq!(reply.body["authorizationEngine"]["kind"], "embedded-cedar");
    assert!(reply.body["authorizationEngine"]["version"]
        .as_str()
        .unwrap()
        .starts_with("4."));

    let header = |name: &str| reply.headers.get(name).and_then(|v| v.to_str().ok());
    assert_eq!(header("x-content-type-options"), Some("nosniff"));
    assert_eq!(header("x-frame-options"), Some("DENY"));
    assert_eq!(header("referrer-policy"), Some("no-referrer"));
    assert_eq!(header("cache-control"), Some("no-store"));
    assert_eq!(
        header("content-security-policy"),
        Some("default-src 'none'; frame-ancestors 'none'")
    );
}

#[tokio::test]
async fn topology_exposes_typed_nodes_and_edges_with_live_metrics() {
    let state = state();
    advance(&state, 2);
    let reply = get(&state, &path("/topology")).await;
    assert_eq!(reply.status, StatusCode::OK);
    let topology = &reply.body;
    assert_eq!(topology["schemaVersion"], "1.0");
    assert_eq!(topology["dataSource"], "synthetic");
    assert_eq!(topology["regions"].as_array().unwrap().len(), 4);

    let nodes = topology["nodes"].as_array().unwrap();
    assert!(nodes.len() >= 45);
    let gateway = nodes.iter().find(|n| n["id"] == "use-gateway").unwrap();
    for field in [
        "id",
        "name",
        "serviceType",
        "region",
        "environment",
        "tier",
        "dataSource",
        "capacityRps",
        "connectedServices",
        "metrics",
    ] {
        assert!(gateway.get(field).is_some(), "node field `{field}`");
    }
    assert_eq!(gateway["serviceType"], "api-gateway");
    assert_eq!(gateway["metrics"]["health"], "healthy");
    assert!(gateway["metrics"]["throughputRps"].as_f64().unwrap() > 500.0);
    assert!(gateway["metrics"]["latencyMs"].as_f64().unwrap() > 0.0);
    assert!(gateway["connectedServices"]
        .as_array()
        .unwrap()
        .contains(&json!("use-cedar")));

    let service_types: std::collections::BTreeSet<&str> = nodes
        .iter()
        .map(|n| n["serviceType"].as_str().unwrap())
        .collect();
    assert_eq!(service_types.len(), 12, "every service type is represented");

    let edges = topology["edges"].as_array().unwrap();
    let edge = edges
        .iter()
        .find(|e| e["id"] == "use-gateway->use-cedar")
        .unwrap();
    assert_eq!(edge["relationship"], "authz");
    assert_eq!(edge["protocol"], "grpc");
    assert_eq!(edge["metrics"]["securityStatus"], "authorized");
    assert!(edge["metrics"]["trafficRps"].as_f64().unwrap() > 100.0);
    assert!(
        edge["metrics"]["rejectedRps"].as_f64().unwrap() > 0.0,
        "baseline Cedar denials are visible on the authorization edge"
    );
}

#[tokio::test]
async fn read_endpoints_return_their_contracts() {
    let state = state();
    advance(&state, 6);

    let metrics = get(&state, &path("/metrics")).await;
    assert_eq!(metrics.status, StatusCode::OK);
    for field in [
        "rps",
        "avgLatencyMs",
        "p50LatencyMs",
        "p95LatencyMs",
        "p99LatencyMs",
        "errorRate",
        "authzDenialRate",
        "activeIncidents",
        "health",
    ] {
        assert!(
            metrics.body["current"].get(field).is_some(),
            "metric `{field}`"
        );
    }
    assert!(metrics.body["history"].as_array().unwrap().len() >= 6);

    let scenarios = get(&state, &path("/scenarios")).await;
    let list = scenarios.body["scenarios"].as_array().unwrap();
    assert_eq!(list.len(), 5);
    assert!(list.iter().all(|s| s["available"] == true));
    assert_eq!(scenarios.body["activeScenarioId"], Value::Null);

    let topologies = get(&state, &path("/topologies")).await;
    assert_eq!(topologies.body["activeId"], "helios-commerce");
    let stress = topologies.body["topologies"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == "hyperscale-stress")
        .unwrap();
    assert!(stress["nodeCount"].as_u64().unwrap() >= 150);
    assert!(stress["edgeCount"].as_u64().unwrap() >= 500);

    let recordings = get(&state, &path("/recordings")).await;
    assert_eq!(recordings.body.as_array().unwrap().len(), 2);

    let incidents = get(&state, &path("/incidents")).await;
    assert_eq!(incidents.body["incidents"], json!([]));

    let unknown = get(&state, "/api/v1/nope").await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    assert_eq!(unknown.body["error"]["code"], "not_found");
    let outside = get(&state, "/").await;
    assert_eq!(outside.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn providers_are_listed_with_honest_provenance_and_nothing_is_connected() {
    let state = state();
    let reply = get(&state, &path("/providers")).await;
    let providers = reply.body.as_array().unwrap();
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();

    let demo = by_id("demo-simulation");
    assert_eq!(demo["state"], "active");
    assert_eq!(demo["dataSource"], "synthetic");
    assert_eq!(demo["repository"], Value::Null);

    for id in ["cedar-agent", "rinha-backend"] {
        let live = by_id(id);
        assert_eq!(live["kind"], "live-adapter");
        assert_eq!(live["state"], "not-configured", "{id} is opt-in");
        assert_eq!(live["dataSource"], "live");
        assert_eq!(live["endpoint"], Value::Null);
        assert!(live["repository"]
            .as_str()
            .unwrap()
            .starts_with("https://github.com/cleissonbarbosa/"));
    }
    for id in ["network-scanner", "security-alerts"] {
        let fixture = by_id(id);
        assert_eq!(fixture["kind"], "fixture");
        assert_eq!(fixture["state"], "available");
        assert_eq!(
            fixture["dataSource"], "recording",
            "{id} is never labelled live"
        );
    }

    // Live adapters cannot be connected unless the server was configured.
    let refused = post(&state, &path("/providers/cedar-agent/connect"), json!({})).await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    assert_eq!(refused.body["error"]["code"], "not_configured");
    let missing = post(&state, &path("/providers/nope/connect"), json!({})).await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn importing_a_fixture_places_labelled_events_on_the_timeline() {
    let state = state();
    advance(&state, 1);
    let reply = post(
        &state,
        &path("/providers/security-alerts/connect"),
        json!({}),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    let status = reply
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "security-alerts")
        .unwrap();
    assert_eq!(status["state"], "imported");
    advance(&state, 1);

    let events = get(
        &state,
        &path("/events?nodeId=use-gateway&minSeverity=critical"),
    )
    .await;
    let advisories: Vec<&Value> = events.body["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "cve-advisory")
        .collect();
    assert_eq!(advisories.len(), 1);
    assert_eq!(advisories[0]["dataSource"], "recording");
    assert!(advisories[0]["title"]
        .as_str()
        .unwrap()
        .starts_with("CVE-2099-"));
    assert_eq!(advisories[0]["details"]["payload"]["fictional"], true);

    let scan = post(
        &state,
        &path("/providers/network-scanner/connect"),
        json!({}),
    )
    .await;
    assert_eq!(scan.status, StatusCode::OK);
    advance(&state, 1);
    let all = get(&state, &path("/events?limit=1000")).await;
    let findings = all.body["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "scan-finding")
        .count();
    assert_eq!(findings, 3);

    let off = post(
        &state,
        &path("/providers/network-scanner/disconnect"),
        json!({}),
    )
    .await;
    let status = off
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "network-scanner")
        .unwrap();
    assert_eq!(status["state"], "available");
}

#[tokio::test]
async fn scenario_lifecycle_start_observe_reset() {
    let state = state();
    advance(&state, 2);

    let started = post(
        &state,
        &path("/demo/scenarios/start"),
        json!({ "scenarioId": "ddos-surge" }),
    )
    .await;
    assert_eq!(started.status, StatusCode::OK);
    assert_eq!(started.body["playback"]["status"], "playing");
    advance(&state, 24);

    let scenarios = get(&state, &path("/scenarios")).await;
    assert_eq!(scenarios.body["activeScenarioId"], "ddos-surge");
    let incidents = get(&state, &path("/incidents")).await;
    let incident = &incidents.body["incidents"][0];
    assert_eq!(incident["scenarioId"], "ddos-surge");
    assert_eq!(incident["status"], "active");
    assert_eq!(incident["rootCauseNodeId"], "use-gateway");
    assert!(!incident["impactedNodeIds"].as_array().unwrap().is_empty());

    let metrics = get(&state, &path("/metrics")).await;
    assert_eq!(metrics.body["current"]["activeIncidents"], 1);
    assert!(metrics.body["current"]["errorRate"].as_f64().unwrap() > 0.1);

    let alerts = get(&state, &path("/events?minSeverity=critical")).await;
    assert!(alerts.body["events"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["kind"] == "alert"));

    // Reset only the scenario: history survives, the incident resolves.
    let stopped = post(
        &state,
        &path("/demo/scenarios/reset"),
        json!({ "scope": "scenario" }),
    )
    .await;
    assert_eq!(stopped.status, StatusCode::OK);
    advance(&state, 1);
    let incidents = get(&state, &path("/incidents")).await;
    assert_eq!(incidents.body["incidents"][0]["status"], "resolved");
    let again = post(
        &state,
        &path("/demo/scenarios/reset"),
        json!({ "scope": "scenario" }),
    )
    .await;
    assert_eq!(again.status, StatusCode::CONFLICT);

    // Full reset (empty body): a clean slate.
    let request = Request::builder()
        .method(Method::POST)
        .uri(path("/demo/scenarios/reset"))
        .body(Body::empty())
        .unwrap();
    let reset = raw(&state, request).await;
    assert_eq!(reset.status, StatusCode::OK);
    assert_eq!(reset.body["playback"]["tick"], 0);
    assert_eq!(reset.body["playback"]["headTick"], 0);
    let incidents = get(&state, &path("/incidents")).await;
    assert_eq!(incidents.body["incidents"], json!([]));
    let events = get(&state, &path("/events")).await;
    assert_eq!(events.body["events"], json!([]));
}

#[tokio::test]
async fn scenario_start_validates_its_input() {
    let state = state();
    let unknown = post(
        &state,
        &path("/demo/scenarios/start"),
        json!({ "scenarioId": "nope" }),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);

    for body in [
        json!({}),
        json!({ "scenarioId": 7 }),
        json!({ "scenarioId": "ddos-surge", "extra": true }),
        json!({ "scenarioId": "../../etc/passwd" }),
        json!({ "scenarioId": "x".repeat(500) }),
    ] {
        let reply = post(&state, &path("/demo/scenarios/start"), body.clone()).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(reply.body["error"]["code"], "invalid_request");
    }

    let not_json = Request::builder()
        .method(Method::POST)
        .uri(path("/demo/scenarios/start"))
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Body::from("scenarioId=ddos-surge"))
        .unwrap();
    assert_eq!(
        raw(&state, not_json).await.status,
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );

    let oversized = Request::builder()
        .method(Method::POST)
        .uri(path("/demo/scenarios/start"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!(
            "{{\"scenarioId\":\"{}\"}}",
            "a".repeat(64 * 1024)
        )))
        .unwrap();
    assert_eq!(
        raw(&state, oversized).await.status,
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn playback_can_be_paused_sought_sped_up_and_returned_to_live() {
    let state = state();
    post(
        &state,
        &path("/demo/scenarios/start"),
        json!({ "scenarioId": "regional-outage" }),
    )
    .await;
    advance(&state, 30);
    let control = |body: Value| {
        let state = state.clone();
        async move { post(&state, &path("/demo/playback/control"), body).await }
    };

    let paused = control(json!({ "action": "pause" })).await;
    assert_eq!(paused.body["playback"]["status"], "paused");
    let tick = paused.body["playback"]["tick"].as_u64().unwrap();
    assert_eq!(tick, 150);
    advance(&state, 5);
    assert_eq!(
        state.service.playback().tick,
        tick,
        "paused time does not advance"
    );

    let stepped = control(json!({ "action": "step" })).await;
    assert_eq!(stepped.body["playback"]["tick"], tick + 1);

    // Rewind to 4 s: the region was still up then.
    let rewound = control(json!({ "action": "seek", "toMs": 4000 })).await;
    assert_eq!(rewound.body["playback"]["tick"], 20);
    assert_eq!(rewound.body["playback"]["mode"], "replay");
    assert_eq!(rewound.body["playback"]["headTick"], tick + 1);
    let topology = get(&state, &path("/topology")).await;
    let gateway = topology.body["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "euw-gateway")
        .unwrap();
    assert_eq!(gateway["metrics"]["health"], "healthy");

    // Seeking past the head clamps to it.
    let clamped = control(json!({ "action": "seek", "toMs": 99_999_999u64 })).await;
    assert_eq!(clamped.body["playback"]["tick"], tick + 1);
    assert_eq!(clamped.body["playback"]["mode"], "live");

    let replay = control(json!({ "action": "replay" })).await;
    assert_eq!(replay.body["playback"]["status"], "playing");
    assert_eq!(replay.body["playback"]["mode"], "replay");
    assert_eq!(
        replay.body["playback"]["tick"], 0,
        "replay returns to just before the incident"
    );

    for speed in [0.5, 1.0, 2.0, 4.0] {
        let reply = control(json!({ "action": "setSpeed", "speed": speed })).await;
        assert_eq!(reply.status, StatusCode::OK);
        assert_eq!(reply.body["playback"]["speed"], speed);
    }
    let before = state.service.playback().tick;
    state.service.advance(Duration::from_millis(200));
    assert_eq!(
        state.service.playback().tick,
        before + 4,
        "4x runs four ticks per tick period"
    );

    for bad in [
        json!({ "action": "setSpeed", "speed": 3 }),
        json!({ "action": "setSpeed", "speed": -1 }),
        json!({ "action": "setSpeed" }),
        json!({ "action": "warp" }),
        json!({ "action": "seek", "toMs": -5 }),
        json!({ "action": "play", "extra": 1 }),
    ] {
        let reply = control(bad.clone()).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{bad}");
    }

    let live = control(json!({ "action": "live" })).await;
    assert_eq!(live.body["playback"]["mode"], "live");
    assert_eq!(live.body["playback"]["status"], "playing");
}

#[tokio::test]
async fn authorization_catalog_lists_the_synthetic_domain_and_real_policies() {
    let state = state();
    let reply = get(&state, &path("/demo/authorization/catalog")).await;
    assert_eq!(reply.status, StatusCode::OK);
    let body = &reply.body;
    assert_eq!(body["policies"].as_array().unwrap().len(), 9);
    assert_eq!(body["tenants"].as_array().unwrap().len(), 2);
    assert!(body["principals"].as_array().unwrap().len() >= 5);
    let forbid = body["policies"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "forbid-cross-tenant")
        .unwrap();
    assert_eq!(forbid["effect"], "forbid");
    assert!(forbid["content"].as_str().unwrap().starts_with("forbid("));
    assert_eq!(body["engines"][0]["kind"], "embedded-cedar");
    assert_eq!(body["engines"][0]["available"], true);
    assert_eq!(body["engines"][1]["kind"], "cedar-agent");
    assert_eq!(body["engines"][1]["available"], false);
    assert!((body["baselineDenyFraction"].as_f64().unwrap() - 0.07).abs() < 1e-9);
}

#[tokio::test]
async fn authorization_evaluate_returns_real_decisions_placed_on_the_topology() {
    let state = state();
    advance(&state, 1);
    let evaluate = |body: Value| {
        let state = state.clone();
        async move { post(&state, &path("/demo/authorization/evaluate"), body).await }
    };

    let allowed = evaluate(json!({
        "principal": "User::\"alice\"",
        "action": "Action::\"viewLedger\"",
        "resource": "Ledger::\"acme-ledger-2026\"",
    }))
    .await;
    assert_eq!(allowed.status, StatusCode::OK);
    let d = &allowed.body;
    assert_eq!(d["decision"], "allow");
    assert_eq!(d["determiningPolicies"], json!(["finance-view-ledger"]));
    assert_eq!(d["engine"]["kind"], "embedded-cedar");
    assert_eq!(d["dataSource"], "synthetic");
    assert_eq!(d["blockedAt"], Value::Null);
    let stages: Vec<(&str, &str, bool)> = d["path"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["nodeId"].as_str().unwrap(),
                s["kind"].as_str().unwrap(),
                s["reached"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        stages,
        [
            ("partner-api", "client", true),
            ("edge-router", "edge", true),
            ("use-gateway", "gateway", true),
            ("use-auth", "authentication", true),
            ("use-cedar", "authorization", true),
            ("use-ledger", "resource", true),
            ("use-ledger-db", "resource", true),
        ]
    );
    assert_eq!(
        d["hops"],
        json!([
            "partner-api->edge-router",
            "edge-router->use-gateway",
            "use-gateway->use-auth",
            "use-gateway->use-cedar",
            "use-gateway->use-ledger",
            "use-ledger->use-ledger-db"
        ])
    );

    let denied = evaluate(json!({
        "principal": "User::\"mallory\"",
        "action": "Action::\"exportLedger\"",
        "resource": "Ledger::\"acme-ledger-2026\"",
        "context": { "mfa": true },
    }))
    .await;
    let d = &denied.body;
    assert_eq!(d["decision"], "deny");
    assert_eq!(d["determiningPolicies"], json!(["forbid-cross-tenant"]));
    assert_eq!(d["blockedAt"], "use-cedar");
    assert_eq!(
        d["hops"].as_array().unwrap().len(),
        4,
        "stops at the authorizer"
    );
    assert!(d["path"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["kind"] == "resource")
        .all(|s| s["reached"] == false));

    // Diagnostics: a missing context attribute is reported by Cedar itself.
    let errored = evaluate(json!({
        "principal": "User::\"alice\"",
        "action": "Action::\"exportLedger\"",
        "resource": "Ledger::\"acme-ledger-2026\"",
    }))
    .await;
    assert_eq!(errored.body["decision"], "deny");
    assert_eq!(errored.body["errors"].as_array().unwrap().len(), 1);

    // Switching a policy off changes the outcome.
    let relaxed = evaluate(json!({
        "principal": "User::\"carol\"",
        "action": "Action::\"deleteCustomer\"",
        "resource": "Customer::\"acme-cust-77\"",
        "disabledPolicies": ["forbid-destructive-outside-change-window"],
    }))
    .await;
    assert_eq!(relaxed.body["decision"], "allow");
    assert_eq!(
        relaxed.body["disabledPolicies"],
        json!(["forbid-destructive-outside-change-window"])
    );
    assert_eq!(relaxed.body["path"][5]["nodeId"], "use-customers");

    // Every evaluation is recorded on the timeline and listed.
    advance(&state, 1);
    let decisions = get(&state, &path("/demo/authorization/decisions")).await;
    assert_eq!(decisions.body.as_array().unwrap().len(), 4);
    let events = get(&state, &path("/events?nodeId=use-cedar")).await;
    let recorded = events.body["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["details"]["origin"] == "explorer")
        .count();
    assert_eq!(recorded, 4);
}

#[tokio::test]
async fn authorization_evaluate_rejects_malformed_input() {
    let state = state();
    let base = json!({
        "principal": "User::\"alice\"",
        "action": "Action::\"viewLedger\"",
        "resource": "Ledger::\"acme-ledger-2026\"",
    });
    let with = |key: &str, value: Value| {
        let mut body = base.clone();
        body[key] = value;
        body
    };
    let cases = [
        with("principal", json!("alice")),
        with("principal", json!("User::\"a\"; drop")),
        with("action", json!("")),
        with(
            "resource",
            json!(format!("Ledger::\"{}\"", "x".repeat(300))),
        ),
        with("context", json!("not an object")),
        with("context", json!({ "blob": "y".repeat(5000) })),
        with("disabledPolicies", json!(["no-such-policy"])),
        with("engine", json!("opa")),
        with("unexpected", json!(true)),
    ];
    for body in cases {
        let reply = post(&state, &path("/demo/authorization/evaluate"), body.clone()).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{body}");
    }
    assert_eq!(
        get(&state, &path("/demo/authorization/decisions"))
            .await
            .body,
        json!([]),
        "rejected requests are never recorded"
    );

    // The agent engine is unavailable until an agent is connected.
    let agent = post(
        &state,
        &path("/demo/authorization/evaluate"),
        with("engine", json!("cedar-agent")),
    )
    .await;
    assert_eq!(agent.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(agent.body["error"]["code"], "engine_unavailable");
}

#[tokio::test]
async fn a_request_is_explained_policy_by_policy_and_nothing_is_recorded() {
    let state = state();
    advance(&state, 1);
    let explained = post(
        &state,
        &path("/demo/authorization/explain"),
        json!({
            "principal": "User::\"bob\"",
            "action": "Action::\"refundOrder\"",
            "resource": "Order::\"acme-ord-9000\"",
        }),
    )
    .await;
    assert_eq!(explained.status, StatusCode::OK);
    let body = &explained.body;
    assert_eq!(body["decision"], "deny");
    assert_eq!(body["determiningPolicies"], json!([]));
    assert_eq!(body["engine"]["kind"], "embedded-cedar");
    assert_eq!(body["dataSource"], "synthetic");
    let standing = |id: &str| {
        body["policies"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["policyId"] == id)
            .unwrap_or_else(|| panic!("no standing for {id}"))
            .clone()
    };
    // The permit that was about this request, and why it is not the answer.
    let refund = standing("support-refund-limit");
    assert_eq!(refund["effect"], "permit");
    assert_eq!(refund["inScope"], true);
    assert_eq!(refund["holds"], false);
    assert_eq!(standing("admin-own-tenant")["inScope"], false);
    assert_eq!(body["policies"].as_array().unwrap().len(), 9);

    // A policy that is switched off has no standing.
    let without = post(
        &state,
        &path("/demo/authorization/explain"),
        json!({
            "principal": "User::\"bob\"",
            "action": "Action::\"refundOrder\"",
            "resource": "Order::\"acme-ord-9000\"",
            "disabledPolicies": ["support-refund-limit"],
        }),
    )
    .await;
    assert_eq!(without.body["policies"].as_array().unwrap().len(), 8);
    assert_eq!(
        without.body["disabledPolicies"],
        json!(["support-refund-limit"])
    );

    // An explanation is a question, not an event: nothing is on the timeline.
    assert_eq!(
        get(&state, &path("/demo/authorization/decisions"))
            .await
            .body,
        json!([])
    );
    let events = get(&state, &path("/events?limit=1000")).await;
    assert!(events.body["events"]
        .as_array()
        .unwrap()
        .iter()
        .all(|event| event["details"]["origin"] != "explorer"));

    for body in [
        json!({ "principal": "alice", "action": "Action::\"viewOrder\"", "resource": "Order::\"acme-ord-1001\"" }),
        json!({ "principal": "User::\"bob\"", "action": "Action::\"refundOrder\"", "resource": "Order::\"acme-ord-9000\"", "disabledPolicies": ["no-such-policy"] }),
        json!({ "principal": "User::\"bob\"", "action": "Action::\"refundOrder\"", "resource": "Order::\"acme-ord-9000\"", "engine": "embedded" }),
    ] {
        let reply = post(&state, &path("/demo/authorization/explain"), body.clone()).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{body}");
    }
}

#[tokio::test]
async fn the_access_matrix_asks_cedar_every_request_of_the_catalogue() {
    let state = state();
    advance(&state, 1);
    let catalog = get(&state, &path("/demo/authorization/catalog")).await.body;
    let count = |key: &str| catalog[key].as_array().unwrap().len();

    let matrix = post(&state, &path("/demo/authorization/matrix"), json!({})).await;
    assert_eq!(matrix.status, StatusCode::OK);
    let cells = matrix.body["cells"].as_array().unwrap();
    assert_eq!(matrix.body["note"], Value::Null);
    assert_eq!(matrix.body["dataSource"], "synthetic");
    // Every principal with every action, on each resource of the action's type.
    let per_principal: usize = catalog["actions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|action| {
            catalog["resources"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|resource| resource["resourceType"] == action["resourceType"])
                .count()
        })
        .sum();
    assert_eq!(cells.len(), count("principals") * per_principal);

    let cell = |principal: &str, action: &str, resource: &str, cells: &[Value]| {
        cells
            .iter()
            .find(|c| {
                c["principal"] == principal && c["action"] == action && c["resource"] == resource
            })
            .unwrap_or_else(|| panic!("no cell for {principal} {action} {resource}"))
            .clone()
    };
    // Each cell is what an evaluation of the same request gives.
    let ask = cell(
        "User::\"alice\"",
        "Action::\"exportLedger\"",
        "Ledger::\"acme-ledger-2026\"",
        cells,
    );
    assert_eq!(ask["decision"], "deny");
    let asked = post(
        &state,
        &path("/demo/authorization/evaluate"),
        json!({
            "principal": "User::\"alice\"",
            "action": "Action::\"exportLedger\"",
            "resource": "Ledger::\"acme-ledger-2026\"",
        }),
    )
    .await;
    assert_eq!(asked.body["decision"], ask["decision"]);
    assert_eq!(
        asked.body["determiningPolicies"],
        ask["determiningPolicies"]
    );

    // The context is part of the question: with a fresh MFA assertion the
    // same cell is allowed, by the policy that asks for one.
    let with_mfa = post(
        &state,
        &path("/demo/authorization/matrix"),
        json!({ "context": { "mfa": true } }),
    )
    .await;
    let ask = cell(
        "User::\"alice\"",
        "Action::\"exportLedger\"",
        "Ledger::\"acme-ledger-2026\"",
        with_mfa.body["cells"].as_array().unwrap(),
    );
    assert_eq!(ask["decision"], "allow");
    assert_eq!(
        ask["determiningPolicies"],
        json!(["finance-export-ledger-mfa"])
    );

    // So is the set of policies in force.
    let without = post(
        &state,
        &path("/demo/authorization/matrix"),
        json!({ "context": { "mfa": true }, "disabledPolicies": ["finance-export-ledger-mfa"] }),
    )
    .await;
    let ask = cell(
        "User::\"alice\"",
        "Action::\"exportLedger\"",
        "Ledger::\"acme-ledger-2026\"",
        without.body["cells"].as_array().unwrap(),
    );
    assert_eq!(ask["decision"], "deny");

    // Only the one evaluation that was asked for is on the timeline.
    let decisions = get(&state, &path("/demo/authorization/decisions")).await;
    assert_eq!(decisions.body.as_array().unwrap().len(), 1);

    for body in [
        json!({ "disabledPolicies": ["no-such-policy"] }),
        json!({ "context": { "blob": "y".repeat(5000) } }),
        json!({ "unexpected": true }),
    ] {
        let reply = post(&state, &path("/demo/authorization/matrix"), body.clone()).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{body}");
    }
}

#[tokio::test]
async fn events_can_be_paged_and_filtered() {
    let state = state();
    post(
        &state,
        &path("/demo/scenarios/start"),
        json!({ "scenarioId": "cascading-failure" }),
    )
    .await;
    advance(&state, 50);

    let all = get(&state, &path("/events?limit=1000")).await;
    let events = all.body["events"].as_array().unwrap();
    assert!(events.len() > 15);
    let seqs: Vec<u64> = events.iter().map(|e| e["seq"].as_u64().unwrap()).collect();
    assert!(seqs.windows(2).all(|w| w[0] < w[1]), "oldest first");
    assert_eq!(all.body["playback"]["tick"], 250);

    let cursor = seqs[seqs.len() - 4];
    let tail = get(&state, &path(&format!("/events?afterSeq={cursor}"))).await;
    assert_eq!(tail.body["events"].as_array().unwrap().len(), 3);

    let limited = get(&state, &path("/events?limit=2")).await;
    let newest: Vec<u64> = limited.body["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(newest, seqs[seqs.len() - 2..], "the newest events win");

    let db = get(
        &state,
        &path("/events?nodeId=use-orders-db&minSeverity=warning"),
    )
    .await;
    let db_events = db.body["events"].as_array().unwrap();
    assert!(!db_events.is_empty());
    assert!(db_events.iter().all(|e| {
        e["nodeIds"]
            .as_array()
            .unwrap()
            .contains(&json!("use-orders-db"))
            && matches!(e["severity"].as_str(), Some("warning" | "critical"))
    }));

    for bad in [
        "/events?minSeverity=loud",
        "/events?limit=abc",
        "/events?afterSeq=-1",
        "/events?nodeId=%3Cscript%3E",
        "/events?unknown=1",
    ] {
        assert_eq!(
            get(&state, &path(bad)).await.status,
            StatusCode::BAD_REQUEST,
            "{bad}"
        );
    }
}

#[tokio::test]
async fn topology_can_be_switched_and_recordings_loaded() {
    let state = state();
    let switched = post(
        &state,
        &path("/demo/topology/select"),
        json!({ "topologyId": "hyperscale-stress" }),
    )
    .await;
    assert_eq!(switched.status, StatusCode::OK);
    let topology = get(&state, &path("/topology")).await;
    assert_eq!(topology.body["id"], "hyperscale-stress");
    assert!(topology.body["nodes"].as_array().unwrap().len() >= 150);
    assert!(topology.body["edges"].as_array().unwrap().len() >= 500);
    assert_eq!(
        post(
            &state,
            &path("/demo/topology/select"),
            json!({ "topologyId": "nope" })
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );

    let loaded = post(
        &state,
        &path("/demo/recordings/load"),
        json!({ "recordingId": "black-friday-flood" }),
    )
    .await;
    assert_eq!(loaded.status, StatusCode::OK);
    let playback = &loaded.body["playback"];
    assert_eq!(playback["recordingId"], "black-friday-flood");
    assert_eq!(playback["tick"], 0);
    assert_eq!(playback["mode"], "replay");
    assert_eq!(playback["headTimeMs"], 260_000);
    assert_eq!(
        get(&state, &path("/topology")).await.body["id"],
        "helios-commerce"
    );
    // The whole recorded history is available for scrubbing immediately.
    let events = get(&state, &path("/events?limit=1000&minSeverity=critical")).await;
    assert!(events.body["events"].as_array().unwrap().len() > 10);
    assert_eq!(
        post(
            &state,
            &path("/demo/recordings/load"),
            json!({ "recordingId": "nope" })
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn mutations_are_rate_limited_per_client() {
    let state = state();
    let mut accepted = 0;
    let mut limited = None;
    for _ in 0..80 {
        let reply = post(
            &state,
            &path("/demo/playback/control"),
            json!({ "action": "pause" }),
        )
        .await;
        if reply.status == StatusCode::TOO_MANY_REQUESTS {
            limited = Some(reply);
            break;
        }
        assert_eq!(reply.status, StatusCode::OK);
        accepted += 1;
    }
    let limited = limited.expect("the burst must be cut off");
    assert!((40..=45).contains(&accepted), "burst of {accepted}");
    assert_eq!(limited.body["error"]["code"], "rate_limited");
    assert!(limited.headers.get(header::RETRY_AFTER).is_some());
    // Reads have their own, larger budget.
    assert_eq!(get(&state, &path("/health")).await.status, StatusCode::OK);
}

#[tokio::test]
async fn cors_admits_configured_origins_only() {
    let state = state_with(&[("AEGIS_ALLOWED_ORIGINS", "https://aegis.example")]);
    let preflight = |origin: &'static str| {
        Request::builder()
            .method(Method::OPTIONS)
            .uri(path("/demo/scenarios/start"))
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
            .body(Body::empty())
            .unwrap()
    };
    let allowed = raw(&state, preflight("https://aegis.example")).await;
    assert_eq!(
        allowed
            .headers
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .and_then(|v| v.to_str().ok()),
        Some("https://aegis.example")
    );
    let denied = raw(&state, preflight("https://evil.example")).await;
    assert!(denied
        .headers
        .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
        .is_none());
}

#[tokio::test]
async fn a_fault_is_tried_on_a_timeline_of_its_own_before_it_is_placed() {
    let state = state();
    advance(&state, 5);
    let before = get(&state, &path("/events?limit=1000")).await.body;
    let clock = get(&state, &path("/health")).await.body["playback"].clone();

    let trial = post(
        &state,
        &path("/demo/experiments/trial"),
        json!({ "effect": { "type": "down", "nodes": "node:use-orders-db" } }),
    )
    .await;
    assert_eq!(trial.status, StatusCode::OK);
    let body = &trial.body;
    assert_eq!(body["dataSource"], "synthetic");
    assert_eq!(body["topologyId"], "helios-commerce");
    assert_eq!(body["fault"]["nodeIds"], json!(["use-orders-db"]));
    let affected = body["affected"].as_array().unwrap();
    // The faulted service is the first to leave normal, and it is down.
    assert_eq!(affected[0]["nodeId"], "use-orders-db");
    assert_eq!(affected[0]["worst"], "down");
    // What calls it follows: the orders service reads and writes this store.
    let ids: Vec<&str> = affected
        .iter()
        .map(|effect| effect["nodeId"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"use-orders"), "{ids:?}");
    assert!(affected.len() > 2, "{ids:?}");
    // Listed in the order they left normal.
    let times: Vec<u64> = affected
        .iter()
        .map(|effect| effect["atMs"].as_u64().unwrap())
        .collect();
    assert!(times.windows(2).all(|pair| pair[0] <= pair[1]), "{times:?}");
    assert!(
        body["peak"]["errorRate"].as_f64().unwrap() > body["before"]["errorRate"].as_f64().unwrap()
    );
    // What reproduces it is a seed and one command, and states no outcome.
    assert_eq!(body["recording"]["commands"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["recording"]["commands"][0]["command"]["type"],
        "injectFault"
    );

    // The same trial again is the same trial: the engine is deterministic.
    let again = post(
        &state,
        &path("/demo/experiments/trial"),
        json!({ "effect": { "type": "down", "nodes": "node:use-orders-db" } }),
    )
    .await;
    assert_eq!(again.body, trial.body);

    // The timeline in use was not touched: same events, same clock, no fault.
    assert_eq!(get(&state, &path("/events?limit=1000")).await.body, before);
    assert_eq!(get(&state, &path("/health")).await.body["playback"], clock);

    // A fault that cannot be placed cannot be tried either.
    for body in [
        json!({ "effect": { "type": "down", "nodes": "node:no-such-service" } }),
        json!({ "effect": { "type": "latency", "nodes": "node:use-orders-db", "factor": -1.0 } }),
        json!({ "effect": { "type": "down", "nodes": "node:use-orders-db" }, "rampMs": 10_000_000 }),
        json!({ "effect": { "type": "down", "nodes": "node:use-orders-db" }, "scenarioId": "ddos-surge" }),
    ] {
        let reply = post(&state, &path("/demo/experiments/trial"), body.clone()).await;
        assert!(reply.status.is_client_error(), "{body}: {}", reply.status);
    }
}

//! What the server says about a run: the incident report, the comparison of
//! an intervention, the session that reproduces a timeline and the policy
//! comparison against uploaded files. All of it is read from the engine or
//! from Cedar; these tests hold it to that.
#![allow(clippy::unwrap_used)]

mod common;

use std::time::Duration;

use aegis_server::api::AppState;
use aegis_server::application::Sources;
use axum::http::StatusCode;
use common::{get, post, state, state_with};
use serde_json::{json, Value};

fn path(suffix: &str) -> String {
    format!("/api/v1{suffix}")
}

/// Advances virtual time by `seconds` at 1x.
fn advance(state: &AppState, seconds: u64) {
    for _ in 0..seconds * 5 {
        state.service.advance(Duration::from_millis(200));
    }
}

async fn start(state: &AppState, scenario: &str) {
    let reply = post(
        state,
        &path("/demo/scenarios/start"),
        json!({ "scenarioId": scenario }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
}

fn strings(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect()
}

// -- incident report ----------------------------------------------------------

#[tokio::test]
async fn a_cascade_is_read_back_with_its_origin_and_what_followed() {
    let state = state();
    advance(&state, 6);
    start(&state, "cascading-failure").await;
    // The scenario lasts 104 s; the tail lets the platform settle.
    advance(&state, 170);

    let reply = get(&state, &path("/incidents/inc-001/report")).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let report = &reply.body;
    assert_eq!(report["schemaVersion"], "1.0");
    assert_eq!(report["dataSource"], "synthetic");
    assert_eq!(report["scenarioId"], "cascading-failure");
    assert_eq!(report["status"], "resolved");
    // A command takes effect in the tick after the one it was issued at.
    assert_eq!(report["startedAtMs"], 6_200);
    assert_eq!(
        report["resolution"], "The scenario ran to completion.",
        "the engine's own words"
    );

    // The scenario names its root cause; the report says that is the basis.
    assert_eq!(report["origin"]["nodeId"], "use-orders-db");
    assert_eq!(report["origin"]["basis"], "declared");

    // Every phase of the file, when it was entered, and what it prescribes.
    let phases = report["phases"].as_array().unwrap();
    assert!(phases.len() >= 5, "{} phases", phases.len());
    assert_eq!(phases[0]["name"], "Latency creep");
    assert_eq!(phases[0]["sinceStartMs"], 0);
    assert_eq!(phases[1]["sinceStartMs"], 14_000);
    assert_eq!(phases[1]["atMs"], 20_200);
    assert_eq!(phases[0]["endedAtMs"], phases[1]["atMs"]);
    let first: Vec<&str> = phases[0]["prescribed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|effect| effect["description"].as_str().unwrap())
        .collect();
    assert_eq!(first, ["latency ×6"]);
    assert_eq!(
        strings(&phases[0]["prescribed"][0]["nodeIds"]),
        ["use-orders-db"]
    );
    let second: Vec<&str> = phases[1]["prescribed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|effect| effect["description"].as_str().unwrap())
        .collect();
    assert_eq!(
        second,
        ["capacity ×0.3", "latency ×14", "20% of requests fail"]
    );

    // The scripted alert is told from the ones detection rules raised.
    let announced: Vec<&Value> = phases
        .iter()
        .flat_map(|phase| phase["events"].as_array().unwrap())
        .collect();
    assert!(announced
        .iter()
        .any(|e| e["title"] == "Database latency above objective" && e["scripted"] == true));
    assert!(announced
        .iter()
        .any(|e| e["title"] == "Latency objective breached" && e["scripted"] == false));

    // The database is the scenario's doing; what calls it follows in the
    // model, and each of those names the dependency it was traced along.
    let propagation = report["propagation"].as_array().unwrap();
    assert!(propagation.len() >= 3, "{propagation:?}");
    let database = propagation
        .iter()
        .find(|t| t["nodeId"] == "use-orders-db")
        .expect("the database is affected");
    assert_eq!(database["cause"]["kind"], "prescribed");
    assert!(database["cause"]["effect"].is_string());
    let topology = get(&state, &path("/topology")).await.body;
    let edges = topology["edges"].as_array().unwrap();
    let mut followed = 0;
    for transition in propagation {
        let cause = &transition["cause"];
        if cause["kind"] != "dependency" {
            continue;
        }
        followed += 1;
        // The connection it names exists, and runs from the service to the
        // one it is said to depend on.
        let edge = edges
            .iter()
            .find(|e| e["id"] == cause["edgeId"])
            .expect("the edge exists");
        assert_eq!(edge["source"], transition["nodeId"]);
        assert_eq!(edge["target"], cause["viaNodeId"]);
        // That one was unwell no later than this one.
        let upstream = propagation
            .iter()
            .find(|t| t["nodeId"] == cause["viaNodeId"])
            .expect("the dependency is itself in the propagation");
        assert!(upstream["atMs"].as_u64() <= transition["atMs"].as_u64());
    }
    assert!(followed >= 2, "services that call the database follow it");
    assert!(
        propagation.iter().all(|t| t["cause"]["kind"] != "load"),
        "nothing in this scenario adds traffic from outside"
    );

    // Figures are the engine's samples, and the peak is above the baseline.
    let peak = report["peakErrorRate"]["value"].as_f64().unwrap();
    assert!(peak > report["baseline"]["errorRate"].as_f64().unwrap());
    assert!(peak > 0.03, "{peak}");
    let at = report["peakErrorRate"]["atMs"].as_u64().unwrap();
    let metrics = get(&state, &path("/metrics")).await.body;
    assert!(metrics["history"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["virtualTimeMs"] == at && s["errorRate"] == peak));

    // It ended, and afterwards every affected service came back.
    let resolved = report["resolvedAtMs"].as_u64().unwrap();
    assert_eq!(resolved, 6_200 + 104_000);
    let recovered = report["recoveredAtMs"].as_u64().expect("it recovered");
    // The last service was back while the final phase ran out, which is the
    // moment of its own return to healthy.
    assert!(recovered > 6_200 && recovered <= resolved, "{recovered}");
    let last = report["recovery"]
        .as_array()
        .unwrap()
        .iter()
        .rfind(|t| t["to"] == "healthy")
        .expect("something recovered");
    assert_eq!(last["atMs"], recovered);
    assert_eq!(report["observedUntilMs"], resolved);
    assert!(report["stillUnhealthyNodeIds"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(strings(&report["impactedNodeIds"]).contains(&"use-orders-db"));
    assert_eq!(report["truncated"], false);
}

#[tokio::test]
async fn the_report_covers_the_whole_record_wherever_the_cursor_is() {
    let state = state();
    advance(&state, 4);
    start(&state, "cascading-failure").await;
    advance(&state, 160);
    let at_head = get(&state, &path("/incidents/inc-001/report")).await.body;

    let reply = post(
        &state,
        &path("/demo/playback/control"),
        json!({ "action": "seek", "toMs": 20_000 }),
    )
    .await;
    assert_eq!(reply.body["playback"]["mode"], "replay");
    // Mid-incident the list of incidents shows it unresolved…
    let incidents = get(&state, &path("/incidents")).await.body;
    assert_ne!(incidents["incidents"][0]["status"], "resolved");
    // …and the report is still that of the whole run.
    let in_history = get(&state, &path("/incidents/inc-001/report")).await.body;
    assert_eq!(in_history, at_head);
}

#[tokio::test]
async fn a_running_incident_is_reported_as_far_as_it_has_got() {
    let state = state();
    advance(&state, 3);
    start(&state, "cascading-failure").await;
    advance(&state, 20);
    let report = get(&state, &path("/incidents/inc-001/report")).await.body;
    assert_eq!(report["status"], "active");
    assert!(report["resolvedAtMs"].is_null() && report["recoveredAtMs"].is_null());
    assert_eq!(report["observedUntilMs"], 23_000);
    let phases = report["phases"].as_array().unwrap();
    assert_eq!(phases.len(), 2);
    assert!(phases[1]["endedAtMs"].is_null(), "the phase still lasts");
}

#[tokio::test]
async fn injected_traffic_is_prescribed_where_it_passes_and_load_downstream() {
    let state = state();
    advance(&state, 3);
    start(&state, "ddos-surge").await;
    advance(&state, 60);
    let report = get(&state, &path("/incidents/inc-001/report")).await.body;
    let prescribed: Vec<&str> = report["phases"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|phase| phase["prescribed"].as_array().unwrap())
        .map(|effect| effect["description"].as_str().unwrap())
        .collect();
    assert!(
        prescribed.iter().any(|d| d.starts_with("injected traffic")),
        "{prescribed:?}"
    );
    // Whatever was affected is explained by a relation the report knows, or
    // is said not to be: there is no other kind.
    for transition in report["propagation"].as_array().unwrap() {
        let kind = transition["cause"]["kind"].as_str().unwrap();
        assert!(
            ["prescribed", "dependency", "load", "fault", "unattributed"].contains(&kind),
            "{kind}"
        );
        if kind == "load" {
            assert!(transition["cause"]["viaNodeId"].is_string());
        }
    }
}

#[tokio::test]
async fn cedar_outcomes_of_an_incident_are_counted_not_invented() {
    let state = state();
    advance(&state, 3);
    start(&state, "cedar-denial").await;
    advance(&state, 100);
    let report = get(&state, &path("/incidents/inc-001/report")).await.body;
    // Nothing breaks in this scenario: the story is what Cedar decided.
    assert!(report["impactedNodeIds"].as_array().unwrap().is_empty());
    assert!(report["recoveredAtMs"].is_null(), "nothing had to recover");
    let decisions = report["decisions"].as_array().unwrap();
    assert!(decisions.len() >= 2, "{decisions:?}");
    let events = get(&state, &path("/events?limit=1000")).await.body;
    let events = events["events"].as_array().unwrap();
    for decision in decisions {
        // Each line is a request shape Cedar evaluated, with the events of
        // this incident that carry it counted.
        let matching: Vec<&Value> = events
            .iter()
            .filter(|e| {
                e["kind"] == "authz-decision"
                    && e["incidentId"] == "inc-001"
                    && e["details"]["requestId"] == decision["requestId"]
            })
            .collect();
        assert_eq!(matching.len() as u64, decision["count"].as_u64().unwrap());
        assert_eq!(matching[0]["seq"], decision["firstSeq"]);
        assert_eq!(matching[0]["details"]["decision"], decision["decision"]);
        assert_eq!(
            matching[0]["details"]["determiningPolicies"],
            decision["determiningPolicies"]
        );
    }
    let export = decisions
        .iter()
        .find(|d| d["requestId"] == "mallory-export-ledger")
        .expect("the prohibited export was evaluated");
    assert_eq!(export["decision"], "deny");
    assert_eq!(
        strings(&export["determiningPolicies"]),
        ["forbid-cross-tenant"]
    );
    assert!(decisions.iter().any(|d| d["decision"] == "allow"));
}

#[tokio::test]
async fn an_unknown_incident_has_no_report() {
    let state = state();
    let reply = get(&state, &path("/incidents/inc-001/report")).await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_eq!(reply.body["error"]["code"], "not_found");
    let reply = get(&state, &path("/incidents/..%2Fx/report")).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
}

// -- A/B comparison -----------------------------------------------------------

fn compare_body(effect: Value, at_ms: u64) -> Value {
    json!({
        "scenarioId": "cascading-failure",
        "intervention": { "effect": effect, "atMs": at_ms, "rampMs": 1000 },
    })
}

#[tokio::test]
async fn a_comparison_runs_the_same_incident_twice_and_changes_one_thing() {
    let state = state();
    advance(&state, 5);
    let before = get(&state, &path("/health")).await.body["tick"].clone();
    let effect = json!({ "type": "capacity", "nodes": "node:use-orders-db", "factor": 6.0 });
    let reply = post(
        &state,
        &path("/demo/experiments/compare"),
        compare_body(effect.clone(), 20_000),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let experiment = &reply.body;
    assert_eq!(experiment["scenarioId"], "cascading-failure");
    assert_eq!(experiment["topologyId"], "helios-commerce");
    assert_eq!(experiment["dataSource"], "synthetic");
    assert_eq!(
        experiment["incidentStartedAtMs"],
        experiment["baseline"]["report"]["startedAtMs"]
    );

    // What changed is said in words, in services and as the effect itself.
    let intervention = &experiment["intervention"];
    assert_eq!(intervention["description"], "capacity ×6");
    assert_eq!(strings(&intervention["nodeIds"]), ["use-orders-db"]);
    assert_eq!(intervention["atMs"], 20_000);
    assert_eq!(intervention["effect"], effect);

    // The two runs share topology and seed, and differ by one command.
    let (a, b) = (
        &experiment["baseline"]["recording"],
        &experiment["variant"]["recording"],
    );
    assert_eq!(a["seed"], b["seed"]);
    assert_eq!(a["seed"], experiment["seed"]);
    assert_eq!(a["topologyId"], b["topologyId"]);
    assert_eq!(a["durationMs"], b["durationMs"]);
    let (a, b) = (
        a["commands"].as_array().unwrap(),
        b["commands"].as_array().unwrap(),
    );
    assert_eq!(a.len(), 1);
    assert_eq!(b.len(), 2);
    assert_eq!(a[0], b[0]);
    assert_eq!(b[1]["atMs"], 24_000);
    assert_eq!(b[1]["command"]["type"], "injectFault");
    assert_eq!(b[1]["command"]["effect"], effect);

    // Until the intervention the two runs are the same run.
    let samples = |run: &str| experiment[run]["samples"].as_array().unwrap().clone();
    let (base, variant) = (samples("baseline"), samples("variant"));
    assert_eq!(base.len(), variant.len());
    let shared = base
        .iter()
        .zip(&variant)
        .take_while(|(x, y)| x == y)
        .count();
    assert!(
        (24..=26).contains(&shared),
        "the runs part ways at 24 s, not at sample {shared}"
    );
    // Six times the capacity is enough to matter in the storm that follows.
    let peak = |run: &str| {
        experiment[run]["report"]["peakErrorRate"]["value"]
            .as_f64()
            .unwrap()
    };
    assert!(peak("variant") < peak("baseline"));
    assert_eq!(
        experiment["baseline"]["report"]["origin"],
        experiment["variant"]["report"]["origin"]
    );

    // The timeline in use was not touched.
    assert_eq!(get(&state, &path("/health")).await.body["tick"], before);
    let incidents = get(&state, &path("/incidents")).await.body;
    assert!(incidents["incidents"].as_array().unwrap().is_empty());

    // Asked again, the same answer: the runs are reproduced, not sampled.
    let again = post(
        &state,
        &path("/demo/experiments/compare"),
        compare_body(effect, 20_000),
    )
    .await;
    assert_eq!(again.body, reply.body);
}

#[tokio::test]
async fn a_comparison_refuses_what_it_cannot_run() {
    let state = state();
    let down = json!({ "type": "down", "nodes": "node:use-search" });
    for (body, status, code) in [
        (
            json!({ "scenarioId": "nope", "intervention": { "effect": down, "atMs": 0 } }),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            compare_body(down.clone(), 104_000),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_experiment",
        ),
        (
            compare_body(json!({ "type": "down", "nodes": "node:ghost" }), 0),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_experiment",
        ),
        (
            compare_body(
                json!({ "type": "latency", "nodes": "node:use-search", "factor": -1.0 }),
                0,
            ),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_fault",
        ),
        (
            compare_body(
                json!({ "type": "flowRate", "flow": "x", "rate": { "rps": 5.0 } }),
                0,
            ),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_experiment",
        ),
        (
            json!({ "scenarioId": "cascading-failure", "intervention": { "effect": down, "atMs": 0 }, "seed": 7 }),
            StatusCode::BAD_REQUEST,
            "invalid_request",
        ),
    ] {
        let reply = post(&state, &path("/demo/experiments/compare"), body.clone()).await;
        assert_eq!(reply.status, status, "{body}: {}", reply.body);
        assert_eq!(reply.body["error"]["code"], code, "{body}");
    }
}

// -- sessions -----------------------------------------------------------------

#[tokio::test]
async fn a_session_reproduces_the_timeline_it_was_saved_from() {
    let original = state();
    advance(&original, 5);
    start(&original, "credential-stuffing").await;
    advance(&original, 12);
    let reply = post(
        &original,
        &path("/demo/faults/inject"),
        json!({
            "effect": { "type": "latency", "nodes": "node:use-search", "factor": 3.0 },
            "rampMs": 1000,
        }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    advance(&original, 15);
    post(
        &original,
        &path("/demo/playback/control"),
        json!({ "action": "pause" }),
    )
    .await;

    let session = get(&original, &path("/session")).await.body;
    assert_eq!(session["reproducible"], true);
    assert!(session["note"].is_null());
    assert_eq!(session["workspaceOrigin"], "bundled");
    assert_eq!(session["cursorMs"], 32_000);
    assert_eq!(
        session["omitted"],
        json!({ "decisions": 0, "importedEvents": 0 })
    );
    let recording = &session["recording"];
    assert_eq!(recording["topologyId"], "helios-commerce");
    assert_eq!(recording["durationMs"], 32_000);
    let kinds: Vec<&str> = recording["commands"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["command"]["type"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["startScenario", "injectFault"]);

    // Loaded on another server, it is the same history at the same moment.
    let copy = state();
    advance(&copy, 90);
    let reply = post(
        &copy,
        &path("/demo/session/load"),
        json!({ "recording": recording, "cursorMs": session["cursorMs"] }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    assert_eq!(reply.body["playback"]["status"], "paused");
    assert_eq!(reply.body["playback"]["virtualTimeMs"], 32_000);
    assert_eq!(reply.body["playback"]["recordingId"], "session");
    for route in ["/topology", "/incidents", "/metrics", "/events?limit=1000"] {
        let mut a = get(&original, &path(route)).await.body;
        let mut b = get(&copy, &path(route)).await.body;
        // Where each timeline came from is the one thing that differs.
        for body in [&mut a, &mut b] {
            if let Some(playback) = body.get_mut("playback") {
                playback["recordingId"] = Value::Null;
            }
        }
        assert_eq!(a, b, "{route}");
    }
    assert_eq!(
        original.service.snapshot().nodes,
        copy.service.snapshot().nodes
    );

    // Without a cursor it plays from the start.
    let reply = post(
        &copy,
        &path("/demo/session/load"),
        json!({ "recording": recording }),
    )
    .await;
    assert_eq!(reply.body["playback"]["status"], "playing");
    assert_eq!(reply.body["playback"]["virtualTimeMs"], 0);
}

#[tokio::test]
async fn a_session_leaves_out_what_a_file_may_not_state_and_says_so() {
    let state = state();
    advance(&state, 2);
    let reply = post(
        &state,
        &path("/demo/authorization/evaluate"),
        json!({
            "principal": "User::\"alice\"",
            "action": "Action::\"viewLedger\"",
            "resource": "Ledger::\"acme-ledger-2026\"",
        }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    advance(&state, 2);
    let session = get(&state, &path("/session")).await.body;
    assert_eq!(session["omitted"]["decisions"], 1);
    assert!(session["recording"]["commands"]
        .as_array()
        .unwrap()
        .is_empty());
    // An idle stretch is still a session, and loads.
    let reply = post(
        &state,
        &path("/demo/session/load"),
        json!({ "recording": session["recording"], "cursorMs": 1000 }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
}

#[tokio::test]
async fn a_long_session_fits_and_one_past_the_bound_is_refused() {
    let state = state();
    let session = |commands: usize| {
        let commands: Vec<Value> = (0..commands)
            .map(|i| {
                json!({
                    "atMs": (i as u64) * 200,
                    "command": {
                        "type": "injectFault",
                        "rampMs": 0,
                        "effect": { "type": "latency", "nodes": "node:use-search", "factor": 1.5 },
                    },
                })
            })
            .collect();
        json!({
            "recording": {
                "id": "session",
                "name": "Session",
                "description": "",
                "topologyId": "helios-commerce",
                "seed": 3,
                "durationMs": 120_000,
                "commands": commands,
            },
            "cursorMs": 60_000,
        })
    };
    // More than the 16 KiB every other route accepts, and within the bound.
    let long = session(512);
    assert!(long.to_string().len() > aegis_server::api::MAX_BODY_BYTES);
    let reply = post(&state, &path("/demo/session/load"), long).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    assert_eq!(reply.body["playback"]["virtualTimeMs"], 60_000);

    let reply = post(&state, &path("/demo/session/load"), session(513)).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.body["error"]["code"], "invalid_session");
}

#[tokio::test]
async fn a_session_cannot_put_an_outcome_on_the_timeline() {
    let state = state();
    let decision = post(
        &state,
        &path("/demo/authorization/evaluate"),
        json!({
            "principal": "User::\"mallory\"",
            "action": "Action::\"exportLedger\"",
            "resource": "Ledger::\"acme-ledger-2026\"",
        }),
    )
    .await
    .body;
    assert_eq!(decision["decision"], "deny");
    let mut forged = decision.clone();
    forged["decision"] = json!("allow");
    let session = |commands: Value, topology: &str| {
        json!({
            "recording": {
                "id": "session",
                "name": "Session",
                "description": "",
                "topologyId": topology,
                "seed": 1,
                "durationMs": 4000,
                "commands": commands,
            }
        })
    };
    for (body, status, code) in [
        (
            session(
                json!([{ "atMs": 0, "command": { "type": "recordDecision", "decision": forged } }]),
                "helios-commerce",
            ),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_session",
        ),
        (
            session(
                json!([{ "atMs": 0, "command": { "type": "importEvents", "providerId": "x", "events": [] } }]),
                "helios-commerce",
            ),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_session",
        ),
        (
            session(json!([]), "nowhere"),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            session(
                json!([{ "atMs": 0, "command": { "type": "startScenario", "scenarioId": "ghost" } }]),
                "helios-commerce",
            ),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            session(
                json!([{ "atMs": 0, "command": { "type": "injectFault", "effect": { "type": "down", "nodes": "node:ghost" } } }]),
                "helios-commerce",
            ),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_session",
        ),
        (
            session(
                json!([{ "atMs": 9000, "command": { "type": "abortScenario" } }]),
                "helios-commerce",
            ),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_session",
        ),
    ] {
        let before = get(&state, &path("/health")).await.body["tick"].clone();
        let reply = post(&state, &path("/demo/session/load"), body.clone()).await;
        assert_eq!(reply.status, status, "{body}: {}", reply.body);
        assert_eq!(reply.body["error"]["code"], code, "{body}");
        assert_eq!(
            get(&state, &path("/health")).await.body["tick"],
            before,
            "a refused session changes nothing"
        );
    }
}

// -- policy comparison ----------------------------------------------------------

/// The bundled policies as an uploaded file, after an edit.
fn policies_file(edit: impl FnOnce(&mut Vec<Value>)) -> Value {
    let mut policies: Vec<Value> = Sources::bundled()
        .unwrap()
        .policies
        .iter()
        .map(|policy| json!({ "id": policy.id, "content": policy.content }))
        .collect();
    edit(&mut policies);
    json!({ "files": [{ "path": "cedar/policies.json", "text": Value::Array(policies).to_string() }] })
}

#[tokio::test]
async fn uploaded_policies_are_compared_with_the_ones_in_use() {
    let state = state();
    advance(&state, 3);
    let before = get(&state, &path("/workspace")).await.body;

    let same = post(&state, &path("/demo/workspace/diff"), policies_file(|_| {})).await;
    assert_eq!(same.status, StatusCode::OK, "{}", same.body);
    assert_eq!(same.body["decisionsChanged"], false);
    assert_eq!(same.body["diff"]["matrix"]["changes"], json!([]));

    let reply = post(
        &state,
        &path("/demo/workspace/diff"),
        policies_file(|policies| policies.retain(|p| p["id"] != "finance-view-ledger")),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    assert_eq!(reply.body["decisionsChanged"], true);
    let diff = &reply.body["diff"];
    assert_eq!(
        strings(&diff["policies"]["removed"]),
        ["finance-view-ledger"]
    );
    assert!(diff["matrix"]["allowToDeny"].as_u64().unwrap() > 0);
    assert_eq!(diff["matrix"]["denyToAllow"], 0);
    let change = &diff["matrix"]["changes"][0];
    assert_eq!(change["base"], "allow");
    assert_eq!(change["candidate"], "deny");
    assert_eq!(strings(&change["basePolicies"]), ["finance-view-ledger"]);

    // Comparing applies nothing.
    assert_eq!(get(&state, &path("/workspace")).await.body, before);
    let catalog = get(&state, &path("/demo/authorization/catalog")).await.body;
    assert_eq!(catalog["policies"].as_array().unwrap().len(), 9);
}

#[tokio::test]
async fn the_comparison_refuses_broken_files_and_respects_the_import_switch() {
    let state = state();
    let reply = post(
        &state,
        &path("/demo/workspace/diff"),
        json!({ "files": [{ "path": "cedar/policies.json", "text": "[{\"id\":\"p\",\"content\":\"permit(\"}]" }] }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.body["error"]["code"], "invalid_workspace");

    let off = state_with(&[("AEGIS_IMPORT", "off")]);
    let reply = post(&off, &path("/demo/workspace/diff"), policies_file(|_| {})).await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    assert_eq!(reply.body["error"]["code"], "import_disabled");
}

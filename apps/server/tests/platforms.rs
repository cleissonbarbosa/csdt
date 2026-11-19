//! One scenario on the platform in use and on the one a set of files
//! describes. Both runs are the engine's and what differs between the two
//! descriptions is read from the files; these tests hold the answer to that.
#![allow(clippy::unwrap_used)]

mod common;

use std::time::Duration;

use aegis_server::api::AppState;
use aegis_server::application::{Assets, Sources};
use axum::http::StatusCode;
use common::{get, post, state, state_with};
use serde_json::{json, Value};

const HELIOS: &str = "helios-commerce";
const SCENARIO: &str = "cascading-failure";

fn path(suffix: &str) -> String {
    format!("/api/v1{suffix}")
}

fn advance(state: &AppState, seconds: u64) {
    for _ in 0..seconds * 5 {
        state.service.advance(Duration::from_millis(200));
    }
}

/// The bundled platform as a file, after `change` has been made to it.
fn helios_with(change: impl FnOnce(&mut Value)) -> Value {
    let mut topology = serde_json::to_value(&Sources::bundled().unwrap().topologies[0]).unwrap();
    change(&mut topology);
    json!({ "path": "topologies/helios.json", "text": topology.to_string() })
}

fn node<'a>(topology: &'a mut Value, id: &str) -> &'a mut Value {
    topology["nodes"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|node| node["id"] == id)
        .unwrap()
}

/// The capacity the model works with for a service of the bundled platform.
fn capacity_in_use(id: &str) -> f64 {
    let assets = Assets::bundled().unwrap();
    let topo = &assets.world(HELIOS).unwrap().topo;
    topo.capacity[topo.node(id).unwrap()]
}

async fn compare(state: &AppState, files: Value, scenario: &str) -> common::Reply {
    post(
        state,
        &path("/demo/experiments/platforms"),
        json!({ "files": files, "scenarioId": scenario }),
    )
    .await
}

fn peak_error(comparison: &Value, run: &str) -> f64 {
    comparison[run]["report"]["peakErrorRate"]["value"]
        .as_f64()
        .unwrap()
}

fn ids(list: &Value) -> Vec<&str> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn the_files_in_use_give_the_run_in_use() {
    let state = state();
    let bundle = get(&state, &path("/workspace/export")).await.body;
    let reply = compare(&state, bundle["files"].clone(), SCENARIO).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let comparison = &reply.body;

    // Nothing differs, and nothing is said to.
    for (list, entries) in comparison["changes"].as_object().unwrap() {
        assert_eq!(entries, &json!([]), "{list}");
    }
    assert_eq!(comparison["decisionsChanged"], false);
    assert_eq!(comparison["base"], comparison["candidate"]);
    assert_eq!(comparison["base"]["id"], HELIOS);

    // So the two runs are one run: the comparison adds nothing of its own.
    assert_eq!(
        comparison["baseline"]["samples"],
        comparison["variant"]["samples"]
    );
    assert_eq!(
        comparison["baseline"]["report"],
        comparison["variant"]["report"]
    );
    assert_eq!(
        comparison["baseline"]["recording"]["commands"],
        comparison["variant"]["recording"]["commands"]
    );
}

#[tokio::test]
async fn a_database_given_more_capacity_weathers_the_same_incident_better() {
    let state = state();
    advance(&state, 5);
    let before = get(&state, &path("/health")).await.body["tick"].clone();
    let sized = capacity_in_use("use-orders-db") * 6.0;
    let files = json!([helios_with(
        |topology| node(topology, "use-orders-db")["capacityRps"] = json!(sized)
    )]);

    let reply = compare(&state, files.clone(), SCENARIO).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let comparison = &reply.body;
    assert_eq!(comparison["schemaVersion"], "1.0");
    assert_eq!(comparison["dataSource"], "synthetic");
    assert_eq!(comparison["scenarioId"], SCENARIO);
    assert_eq!(comparison["base"]["id"], HELIOS);
    assert_eq!(comparison["candidate"]["id"], HELIOS);

    // The one thing the file changed, as the file wrote it.
    let changes = &comparison["changes"];
    assert_eq!(
        changes["servicesChanged"],
        json!([{
            "id": "use-orders-db",
            "name": "Orders DB",
            "fields": [{ "field": "capacityRps", "base": null, "candidate": sized }],
        }])
    );
    for (list, entries) in changes.as_object().unwrap() {
        if list != "servicesChanged" {
            assert_eq!(entries, &json!([]), "{list}");
        }
    }
    assert_eq!(comparison["decisionsChanged"], false);
    // The scenario's own figures are multipliers: the same on both.
    assert_eq!(comparison["prescribed"], json!([]));

    // The same incident, from the same seed, started at the same moment.
    let (a, b) = (
        &comparison["baseline"]["recording"],
        &comparison["variant"]["recording"],
    );
    assert_eq!(a["seed"], comparison["seed"]);
    assert_eq!(a["seed"], b["seed"]);
    assert_eq!(a["commands"], b["commands"]);
    assert_eq!(a["commands"].as_array().unwrap().len(), 1);
    assert_eq!(a["commands"][0]["command"]["scenarioId"], SCENARIO);
    assert_eq!(a["durationMs"], comparison["durationMs"]);
    assert_eq!(
        comparison["incidentStartedAtMs"],
        comparison["variant"]["report"]["startedAtMs"]
    );
    assert!(peak_error(comparison, "variant") < peak_error(comparison, "baseline"));

    // Nothing was applied and the timeline in use was not touched.
    assert_eq!(get(&state, &path("/health")).await.body["tick"], before);
    assert_eq!(
        get(&state, &path("/workspace")).await.body["origin"],
        "bundled"
    );
    let incidents = get(&state, &path("/incidents")).await.body;
    assert!(incidents["incidents"].as_array().unwrap().is_empty());

    // Asked again, the same answer: the runs are reproduced, not sampled.
    assert_eq!(compare(&state, files, SCENARIO).await.body, reply.body);
}

#[tokio::test]
async fn the_run_on_the_files_is_the_run_seen_once_they_are_applied() {
    let state = state();
    let sized = capacity_in_use("use-orders-db") * 6.0;
    let files = json!([helios_with(
        |topology| node(topology, "use-orders-db")["capacityRps"] = json!(sized)
    )]);
    let comparison = compare(&state, files.clone(), SCENARIO).await.body;

    let imported = post(
        &state,
        &path("/demo/workspace/import"),
        json!({ "files": files }),
    )
    .await;
    assert_eq!(imported.status, StatusCode::OK, "{}", imported.body);
    let loaded = post(
        &state,
        &path("/demo/session/load"),
        json!({ "recording": comparison["variant"]["recording"] }),
    )
    .await;
    assert_eq!(loaded.status, StatusCode::OK, "{}", loaded.body);
    let report = get(&state, &path("/incidents/inc-001/report")).await.body;
    assert_eq!(report, comparison["variant"]["report"]);
}

#[tokio::test]
async fn a_service_added_is_listed_with_the_capacity_that_follows_from_it() {
    let state = state();
    let files = json!([helios_with(|topology| {
        topology["nodes"].as_array_mut().unwrap().push(json!({
            "id": "use-loyalty",
            "name": "Loyalty",
            "type": "microservice",
            "region": "us-east",
            "tier": 3,
            "baseLatencyMs": 6.0,
        }));
        let edges = topology["edges"].as_array_mut().unwrap();
        edges.push(json!({
            "source": "use-gateway", "target": "use-loyalty",
            "protocol": "grpc", "relationship": "call", "weight": 0.5,
        }));
        edges.push(json!({
            "source": "use-loyalty", "target": "use-orders-db",
            "protocol": "sql", "relationship": "data", "weight": 1.0,
        }));
    })]);
    let reply = compare(&state, files, SCENARIO).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let comparison = &reply.body;
    let changes = &comparison["changes"];

    assert_eq!(
        changes["servicesAdded"],
        json!([{ "id": "use-loyalty", "name": "Loyalty" }])
    );
    assert_eq!(
        changes["connectionsAdded"],
        json!([
            { "source": "use-gateway", "target": "use-loyalty" },
            { "source": "use-loyalty", "target": "use-orders-db" },
        ])
    );
    assert_eq!(changes["servicesChanged"], json!([]));
    assert_eq!(changes["servicesRemoved"], json!([]));
    assert_eq!(
        comparison["candidate"]["nodeCount"].as_u64().unwrap(),
        comparison["base"]["nodeCount"].as_u64().unwrap() + 1
    );

    // The database states no capacity, so more callers size it larger: the
    // file did not say so, and the answer does.
    let resized = changes["derivedCapacity"].as_array().unwrap();
    let database = resized
        .iter()
        .find(|entry| entry["id"] == "use-orders-db")
        .expect("the database is called more at rest");
    assert_eq!(database["base"], capacity_in_use("use-orders-db"));
    assert!(database["candidate"].as_f64().unwrap() > database["base"].as_f64().unwrap());
    assert!(!ids(&changes["derivedCapacity"]).contains(&"use-loyalty"));
}

#[tokio::test]
async fn a_flood_sized_from_capacity_is_said_to_be_another_flood() {
    // The bundled surge is written as 2.2 times what the gateway can take.
    // A gateway three times the size is sent three times the flood, and the
    // answer has to say so or the two runs would be read as one attack.
    let state = state();
    let was = capacity_in_use("use-gateway");
    let files = json!([helios_with(|topology| {
        node(topology, "use-gateway")["capacityRps"] = json!(was * 3.0);
    })]);
    let reply = compare(&state, files, "ddos-surge").await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let comparison = &reply.body;

    let prescribed = comparison["prescribed"].as_array().unwrap();
    let surge = prescribed
        .iter()
        .find(|change| change["phase"] == "Volumetric surge")
        .expect("the surge is sized from the gateway");
    let rate = |side: &str| {
        let description = surge[side][0]["description"].as_str().unwrap();
        let figure = description
            .rsplit_once(" at ")
            .and_then(|(_, rate)| rate.strip_suffix(" req/s"))
            .unwrap_or_else(|| panic!("no rate in `{description}`"));
        figure.parse::<f64>().unwrap()
    };
    assert_eq!(rate("base"), (was * 2.2).round());
    assert_eq!(rate("candidate"), (was * 3.0 * 2.2).round());
    // Each side is what its own report says of that phase.
    for (side, run) in [("base", "baseline"), ("candidate", "variant")] {
        let phases = comparison[run]["report"]["phases"].as_array().unwrap();
        let phase = phases
            .iter()
            .find(|phase| phase["name"] == "Volumetric surge")
            .unwrap();
        assert_eq!(surge[side], phase["prescribed"], "{side}");
    }
    // A phase that prescribes nothing is not listed.
    assert!(prescribed
        .iter()
        .all(|change| change["phase"] != "Recovery"));
}

#[tokio::test]
async fn the_platform_of_the_files_is_the_one_named_or_the_one_with_the_id_in_use() {
    let state = state();
    let renamed = |id: &str, capacity: f64| {
        let mut file = helios_with(|topology| {
            topology["id"] = json!(id);
            node(topology, "use-orders-db")["capacityRps"] = json!(capacity);
        });
        file["path"] = json!(format!("topologies/{id}.json"));
        file
    };
    let two = json!([helios_with(|_| {}), renamed("helios-b", 9_000.0)]);

    // With the id in use among the files, that platform is the other side.
    let same = compare(&state, two.clone(), SCENARIO).await.body;
    assert_eq!(same["candidate"]["id"], HELIOS);
    assert_eq!(same["changes"]["servicesChanged"], json!([]));

    // Another one is named.
    let named = post(
        &state,
        &path("/demo/experiments/platforms"),
        json!({ "files": two, "scenarioId": SCENARIO, "topologyId": "helios-b" }),
    )
    .await;
    assert_eq!(named.status, StatusCode::OK, "{}", named.body);
    assert_eq!(named.body["candidate"]["id"], "helios-b");
    assert_eq!(named.body["variant"]["recording"]["topologyId"], "helios-b");
    assert_eq!(
        ids(&named.body["changes"]["servicesChanged"]),
        ["use-orders-db"]
    );

    // Without the id in use among them, the one the files open on.
    let only = compare(&state, json!([renamed("helios-c", 9_000.0)]), SCENARIO).await;
    assert_eq!(only.status, StatusCode::OK, "{}", only.body);
    assert_eq!(only.body["candidate"]["id"], "helios-c");
    assert_eq!(only.body["baseline"]["recording"]["topologyId"], HELIOS);
}

#[tokio::test]
async fn policies_among_the_files_are_said_to_change_what_cedar_answers() {
    let state = state();
    let policies: Vec<Value> = Sources::bundled()
        .unwrap()
        .policies
        .iter()
        .filter(|policy| policy.id != "finance-view-ledger")
        .map(|policy| json!({ "id": policy.id, "content": policy.content }))
        .collect();
    let files =
        json!([{ "path": "cedar/policies.json", "text": Value::Array(policies).to_string() }]);
    let reply = compare(&state, files, "cedar-denial").await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    // The platform is the same one; what Cedar answers is not.
    for (list, entries) in reply.body["changes"].as_object().unwrap() {
        assert_eq!(entries, &json!([]), "{list}");
    }
    assert_eq!(reply.body["decisionsChanged"], true);
}

#[tokio::test]
async fn a_comparison_of_platforms_refuses_what_it_cannot_run() {
    let state = state();
    let helios = || json!([helios_with(|_| {})]);
    let mut scenarios = Sources::bundled().unwrap().scenarios;
    let rewritten: Vec<Value> = scenarios
        .iter_mut()
        .map(|scenario| {
            if scenario.id == SCENARIO {
                scenario.duration_ms += 2_000;
            }
            json!({
                "path": format!("scenarios/{}.json", scenario.id),
                "text": serde_json::to_string(scenario).unwrap(),
            })
        })
        .collect();
    let one_scenario = json!([{
        "path": "scenarios/only.json",
        "text": serde_json::to_string(&Sources::bundled().unwrap().scenarios[0]).unwrap(),
    }]);
    let without_database = json!([helios_with(|topology| {
        topology["roles"]
            .as_object_mut()
            .unwrap()
            .remove("primaryDatabase");
    })]);

    let body = |files: Value, scenario: &str| json!({ "files": files, "scenarioId": scenario });
    for (sent, status, code, says) in [
        (
            body(helios(), "nope"),
            StatusCode::NOT_FOUND,
            "not_found",
            "unknown scenario",
        ),
        (
            body(one_scenario, SCENARIO),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_experiment",
            "the files have no scenario",
        ),
        (
            body(Value::Array(rewritten), SCENARIO),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_experiment",
            "written differently",
        ),
        (
            body(without_database, SCENARIO),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_experiment",
            "primaryDatabase",
        ),
        (
            json!({ "files": helios(), "scenarioId": SCENARIO, "topologyId": "elsewhere" }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_experiment",
            "the files have no topology `elsewhere`",
        ),
        (
            body(
                json!([{ "path": "topologies/broken.json", "text": "{ \"id\": \"x\" }" }]),
                SCENARIO,
            ),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_workspace",
            "topologies/broken.json",
        ),
        (
            body(json!([]), SCENARIO),
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "no files",
        ),
        (
            body(helios(), "not an id"),
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "scenarioId",
        ),
        (
            json!({ "files": helios(), "scenarioId": SCENARIO, "seed": 7 }),
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "",
        ),
    ] {
        let reply = post(&state, &path("/demo/experiments/platforms"), sent).await;
        assert_eq!(reply.status, status, "{says}: {}", reply.body);
        assert_eq!(reply.body["error"]["code"], code, "{says}");
        let message = reply.body["error"]["message"].as_str().unwrap();
        assert!(message.contains(says), "`{message}` does not say `{says}`");
    }
    // None of it changed what is in use.
    assert_eq!(
        get(&state, &path("/workspace")).await.body["origin"],
        "bundled"
    );
}

#[tokio::test]
async fn a_comparison_of_platforms_is_off_where_importing_is() {
    let state = state_with(&[("AEGIS_IMPORT", "off")]);
    let reply = compare(&state, json!([helios_with(|_| {})]), SCENARIO).await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    assert_eq!(reply.body["error"]["code"], "import_disabled");
}

// -- from a terminal ----------------------------------------------------------

fn command(args: &[&str]) -> (Option<i32>, String, String) {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_aegis-server"))
        .args(args)
        .output()
        .unwrap();
    (
        output.status.code(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

#[tokio::test]
async fn the_command_runs_the_same_comparison_the_route_does() {
    // A filter that is always on at the edge, written into the bundled platform.
    let filtered =
        helios_with(|topology| node(topology, "edge-router")["suspiciousFilter"] = json!(0.94));
    let dir = common::TempDir::new();
    dir.write("topologies/helios.json", filtered["text"].as_str().unwrap());
    let candidate = dir.path().to_str().unwrap();

    let (status, report, _) = command(&["compare-incident", "@bundled", candidate, "ddos-surge"]);
    assert_eq!(status, Some(0), "{report}");
    assert!(report.contains("service changed  edge-router  suspiciousFilter: not stated -> 0.94"));
    assert!(report.contains("The two runs"));
    assert!(
        !report.contains("What follows without being stated"),
        "{report}"
    );

    // As JSON it is the answer the route gives for the same files and seed.
    let (status, text, _) = command(&[
        "compare-incident",
        "@bundled",
        candidate,
        "ddos-surge",
        "--json",
    ]);
    assert_eq!(status, Some(0));
    let printed: Value = serde_json::from_str(&text).unwrap();
    let state = state();
    let served = compare(&state, json!([filtered]), "ddos-surge").await.body;
    assert_eq!(printed, served);
    // The filter spares callers: that is the run's figure, not a claim.
    assert!(peak_error(&printed, "variant") < peak_error(&printed, "baseline") / 10.0);

    // Another seed is another run of the same comparison.
    let (_, other, _) = command(&[
        "compare-incident",
        "@bundled",
        candidate,
        "ddos-surge",
        "--json",
        "--seed=7",
    ]);
    let other: Value = serde_json::from_str(&other).unwrap();
    assert_eq!(other["seed"], 7);
    assert_eq!(other["changes"], printed["changes"]);

    // What cannot be run says why and exits 2.
    for (args, says) in [
        (
            vec!["compare-incident", "@bundled", candidate, "nope"],
            "unknown scenario `nope`",
        ),
        (
            vec![
                "compare-incident",
                "@bundled",
                "/nonexistent/workspace",
                "ddos-surge",
            ],
            "/nonexistent/workspace",
        ),
        (
            vec!["compare-incident", "@bundled", candidate],
            "expected <base> <candidate> <scenario>",
        ),
        (
            vec![
                "compare-incident",
                "@bundled",
                candidate,
                "ddos-surge",
                "--seed=x",
            ],
            "expected",
        ),
        (
            vec![
                "compare-incident",
                "@bundled",
                candidate,
                "ddos-surge",
                "--topology=elsewhere",
            ],
            "the files have no topology `elsewhere`",
        ),
    ] {
        let (status, _, stderr) = command(&args);
        assert_eq!(status, Some(2), "{args:?}");
        assert!(stderr.contains(says), "{args:?}: {stderr}");
    }
}

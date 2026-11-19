//! Where the platform gives: how much demand it takes, and what each
//! service takes with it. Every figure is a run of the engine; these tests
//! hold the answers to the runs.
#![allow(clippy::unwrap_used)]

mod common;

use std::time::Duration;

use aegis_server::api::AppState;
use aegis_server::application::limits::{HEADROOM_LADDER, HEADROOM_REFINEMENTS};
use axum::http::StatusCode;
use common::{get, post, state};
use serde_json::{json, Value};

fn path(suffix: &str) -> String {
    format!("/api/v1{suffix}")
}

fn advance(state: &AppState, seconds: u64) {
    for _ in 0..seconds * 5 {
        state.service.advance(Duration::from_millis(200));
    }
}

fn number(value: &Value) -> f64 {
    value.as_f64().unwrap()
}

#[tokio::test]
async fn headroom_is_the_last_multiple_that_held_and_the_first_that_did_not() {
    let state = state();
    advance(&state, 5);
    let before = get(&state, &path("/health")).await.body["tick"].clone();
    let reply = post(&state, &path("/demo/experiments/headroom"), json!({})).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let headroom = &reply.body;
    assert_eq!(headroom["topologyId"], "helios-commerce");
    assert_eq!(headroom["dataSource"], "synthetic");
    // Every population with demand is raised; the origin of hostile traffic has none.
    let clients: Vec<&str> = headroom["clientIds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap())
        .collect();
    assert!(clients.contains(&"clients-na") && !clients.contains(&"unknown-sources"));

    let (holds, gives) = (number(&headroom["holdsAt"]), number(&headroom["givesAt"]));
    assert!(
        holds >= 1.0 && gives > holds,
        "holds at ×{holds}, gives at ×{gives}"
    );
    // Narrowed as far as the answer says it is.
    let rung = HEADROOM_LADDER
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .fold(HEADROOM_LADDER[0] - 1.0, f64::max);
    assert!(gives - holds <= rung / 2f64.powi(HEADROOM_REFINEMENTS as i32) + 0.011);

    // Both are among the multiples tried, and say what a run at each gave.
    let steps = headroom["steps"].as_array().unwrap();
    let step = |factor: f64| {
        steps
            .iter()
            .find(|step| number(&step["factor"]) == factor)
            .unwrap_or_else(|| panic!("×{factor} is not among the multiples tried"))
    };
    assert!(!step(gives)["missed"].as_array().unwrap().is_empty());
    if holds > 1.0 {
        assert_eq!(step(holds)["missed"], json!([]));
    }
    let factors: Vec<f64> = steps.iter().map(|step| number(&step["factor"])).collect();
    assert!(
        factors.windows(2).all(|pair| pair[0] < pair[1]),
        "lowest first"
    );
    for step in steps {
        let gave = !step["missed"].as_array().unwrap().is_empty();
        assert_eq!(gave, number(&step["factor"]) >= gives, "{step}");
        // More demand is never easier on the platform than less.
        assert!(number(&step["peak"]["errorRate"]) >= number(&headroom["atRest"]["errorRate"]));
    }
    // Something gave first, and it is a service of the platform.
    let first = &step(gives)["first"];
    assert!(first["nodeId"].is_string(), "{first}");
    assert!(number(&step(gives)["affected"]) >= 1.0);

    // The objectives are the ones a report counts.
    assert_eq!(
        headroom["objectives"][0],
        json!({ "kind": "error-rate", "threshold": 0.05 })
    );
    assert_eq!(headroom["objectives"][1]["kind"], "latency-p95");

    // The run that gave can be put on the timeline, and is the run it says.
    let recording = &headroom["recording"];
    assert_eq!(
        recording["commands"].as_array().unwrap().len(),
        clients.len()
    );
    assert_eq!(
        recording["commands"][0]["command"]["effect"]["factor"],
        gives
    );

    // Nothing was placed on the timeline in use, and asking again gives the same.
    assert_eq!(get(&state, &path("/health")).await.body["tick"], before);
    let again = post(&state, &path("/demo/experiments/headroom"), json!({})).await;
    assert_eq!(again.body, reply.body);
}

#[tokio::test]
async fn every_service_is_taken_out_in_turn_and_ranked_by_what_it_takes_with_it() {
    let state = state();
    advance(&state, 5);
    let before = get(&state, &path("/health")).await.body["tick"].clone();
    let reply = post(&state, &path("/demo/experiments/weak-points"), json!({})).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let points = reply.body["points"].as_array().unwrap();

    // Every service once, and no client population.
    let topology = get(&state, &path("/topology")).await.body;
    let services: Vec<&str> = topology["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|node| node["serviceType"] != "external-client")
        .map(|node| node["id"].as_str().unwrap())
        .collect();
    let mut tried: Vec<&str> = points
        .iter()
        .map(|point| point["nodeId"].as_str().unwrap())
        .collect();
    let ranked = tried.clone();
    tried.sort_unstable();
    let mut expected = services.clone();
    expected.sort_unstable();
    assert_eq!(tried, expected);

    // The one that takes the most with it first.
    let taken = |point: &Value| point["affected"].as_array().unwrap().len();
    assert!(points
        .windows(2)
        .all(|pair| taken(&pair[0]) >= taken(&pair[1])));
    assert!(
        taken(&points[0]) >= 3,
        "{} takes {}",
        ranked[0],
        taken(&points[0])
    );
    // A service is not listed among what it takes with it.
    for point in points {
        assert!(point["affected"]
            .as_array()
            .unwrap()
            .iter()
            .all(|effect| effect["nodeId"] != point["nodeId"]));
    }

    // Each row is exactly what a trial of that service out gives.
    for point in [&points[0], &points[points.len() / 2]] {
        let id = point["nodeId"].as_str().unwrap();
        let trial = post(
            &state,
            &path("/demo/experiments/trial"),
            json!({ "effect": { "type": "down", "nodes": format!("node:{id}") } }),
        )
        .await
        .body;
        let others: Vec<&Value> = trial["affected"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|effect| effect["nodeId"] != id)
            .collect();
        assert_eq!(
            others,
            point["affected"]
                .as_array()
                .unwrap()
                .iter()
                .collect::<Vec<_>>(),
            "{id}"
        );
        assert_eq!(trial["peak"], point["peak"], "{id}");
        assert_eq!(trial["before"], reply.body["atRest"]);
    }

    assert_eq!(get(&state, &path("/health")).await.body["tick"], before);
    let incidents = get(&state, &path("/incidents")).await.body;
    assert!(incidents["incidents"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn the_questions_take_no_figures() {
    let state = state();
    for route in [
        "/demo/experiments/headroom",
        "/demo/experiments/weak-points",
    ] {
        let reply = post(&state, &path(route), json!({ "seed": 7 })).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{route}");
        assert_eq!(reply.body["error"]["code"], "invalid_request");
    }
}

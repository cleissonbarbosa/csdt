//! Faults placed by hand: one scenario effect on a service or a connection,
//! outside any scenario.
#![allow(clippy::unwrap_used)]

mod common;

use std::sync::Arc;
use std::time::Duration;

use aegis_server::application::{Assets, BootstrapError, Sources};
use aegis_server::domain::{ActiveFault, EventKind, FaultKind, Health, PlaybackStatus};
use aegis_server::incidents::catalog::DDOS_SURGE;
use aegis_server::incidents::recordings::Recording;
use aegis_server::incidents::Effect;
use aegis_server::simulation::engine::MAX_FAULT_CHANNELS;
use aegis_server::simulation::topologies::{HELIOS_ID, STRESS_ID};
use aegis_server::simulation::{Command, Timeline, TICK_MS};
use axum::http::StatusCode;
use serde_json::{json, Value};

use common::{post, state};

fn assets() -> Assets {
    Assets::bundled().expect("bundled assets load")
}

fn timeline_on(assets: &Assets, topology: &str) -> Timeline {
    let world = assets.world(topology).expect("topology exists");
    Timeline::new(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(&assets.decisions),
        42,
    )
}

fn effect(value: Value) -> Effect {
    serde_json::from_value(value).expect("a valid effect")
}

fn inject(value: Value) -> Command {
    Command::InjectFault {
        effect: effect(value),
        ramp_ms: 1000,
    }
}

fn run(t: &mut Timeline, ticks: u64) {
    for _ in 0..ticks {
        t.step();
    }
}

fn secs(seconds: u64) -> u64 {
    seconds * 1000 / TICK_MS
}

fn faults(t: &Timeline) -> Vec<ActiveFault> {
    t.telemetry(PlaybackStatus::Playing, 1.0).faults
}

fn node(t: &Timeline, id: &str) -> usize {
    t.topology().node(id).expect("node exists")
}

#[test]
fn a_fault_bends_the_model_and_lifting_it_gives_the_platform_back() {
    let assets = assets();
    let mut t = timeline_on(&assets, HELIOS_ID);
    run(&mut t, secs(10));
    let gateway = node(&t, "use-gateway");
    let before = t.state().node_latency[gateway];
    assert!(faults(&t).is_empty());

    t.issue(inject(
        json!({ "type": "latency", "nodes": "node:use-gateway", "factor": 8.0 }),
    ));
    let events: Vec<_> = (0..secs(20)).flat_map(|_| t.step().events).collect();
    let placed = events
        .iter()
        .find(|event| event.title.starts_with("Fault placed by hand"))
        .expect("placing a fault is on the timeline");
    assert_eq!(placed.kind, EventKind::System);
    assert_eq!(placed.title, "Fault placed by hand: latency ×8");
    assert_eq!(placed.node_ids, ["use-gateway"]);
    assert_eq!(placed.details["fault"]["nodes"], "node:use-gateway");

    assert_eq!(
        faults(&t),
        [ActiveFault {
            kind: FaultKind::Latency,
            node: Some(gateway as u32),
            edge: None,
            onto: None,
            value: 8.0,
        }]
    );
    // The figure is what a caller waits, the services below included, so
    // eight times the gateway's own share is well short of eight times it.
    let slowed = t.state().node_latency[gateway];
    assert!(
        slowed > before * 1.5,
        "the gateway answers in {slowed} ms, {before} ms before"
    );
    // Nothing was started: this is not an incident.
    assert!(t.state().scenario.is_none());
    assert!(t.incidents().is_empty());

    t.issue(Command::ClearFaults { effect: None });
    let events: Vec<_> = (0..secs(30)).flat_map(|_| t.step().events).collect();
    assert!(events.iter().any(|event| event.title == "Faults lifted"));
    assert!(faults(&t).is_empty());
    assert!(t.state().faults.is_empty(), "the channels settled and left");
    let after = t.state().node_latency[gateway];
    assert!((after - before).abs() < before * 0.2, "{after} ms after");
    assert!(t.state().health.iter().all(|h| *h == Health::Healthy));
}

#[test]
fn a_fault_composes_with_a_scenario_and_outlives_it() {
    let assets = assets();
    let mut t = timeline_on(&assets, HELIOS_ID);
    run(&mut t, secs(5));
    let search = node(&t, "use-search");
    t.issue(inject(
        json!({ "type": "down", "nodes": "node:use-search" }),
    ));
    t.issue(Command::StartScenario {
        scenario_id: DDOS_SURGE.to_string(),
    });
    run(&mut t, secs(20));
    assert!(t.state().scenario.is_some());
    assert!(!t.state().channels.is_empty(), "the scenario holds its own");
    assert_eq!(t.state().health[search], Health::Down);

    // The scenario changes phase and is then stopped: neither lifts what
    // was placed by hand.
    t.issue(Command::AbortScenario {});
    run(&mut t, secs(20));
    assert!(t.state().scenario.is_none());
    assert!(t.state().channels.is_empty());
    assert_eq!(t.state().health[search], Health::Down);
    assert_eq!(faults(&t).len(), 1);
    assert_eq!(faults(&t)[0].kind, FaultKind::Down);

    // Lifting it by naming it brings the service back.
    t.issue(Command::ClearFaults {
        effect: Some(effect(
            json!({ "type": "down", "nodes": "node:use-search" }),
        )),
    });
    run(&mut t, secs(30));
    assert_eq!(t.state().health[search], Health::Healthy);
    assert!(faults(&t).is_empty());
}

#[test]
fn lifting_one_fault_leaves_the_others_in_force() {
    let assets = assets();
    let mut t = timeline_on(&assets, HELIOS_ID);
    t.issue(inject(
        json!({ "type": "capacity", "nodes": "node:use-orders", "factor": 0.5 }),
    ));
    t.issue(inject(
        json!({ "type": "errorInject", "nodes": "node:use-payments", "rate": 0.2 }),
    ));
    t.issue(inject(json!({
        "type": "edgeLatency",
        "edges": { "between": { "from": "node:use-gateway", "to": "node:use-catalog" } },
        "factor": 5.0
    })));
    run(&mut t, secs(5));
    let kinds = |t: &Timeline| faults(t).iter().map(|f| f.kind).collect::<Vec<_>>();
    assert_eq!(
        kinds(&t),
        [
            FaultKind::Capacity,
            FaultKind::ErrorInject,
            FaultKind::EdgeLatency
        ]
    );
    let on_edge = faults(&t)[2];
    assert_eq!(on_edge.node, None);
    let edge = on_edge.edge.expect("an edge fault names its connection") as usize;
    assert_eq!(t.topology().edge_src[edge], node(&t, "use-gateway"));
    assert_eq!(t.topology().edge_dst[edge], node(&t, "use-catalog"));

    // The figures of the effect that names what to lift are not read.
    t.issue(Command::ClearFaults {
        effect: Some(effect(
            json!({ "type": "errorInject", "nodes": "node:use-payments", "rate": 0.9 }),
        )),
    });
    run(&mut t, secs(5));
    assert_eq!(kinds(&t), [FaultKind::Capacity, FaultKind::EdgeLatency]);

    // Placing the same fault again replaces its figure, it does not stack.
    t.issue(inject(
        json!({ "type": "capacity", "nodes": "node:use-orders", "factor": 0.25 }),
    ));
    run(&mut t, secs(5));
    assert_eq!(kinds(&t), [FaultKind::Capacity, FaultKind::EdgeLatency]);
    assert_eq!(faults(&t)[0].value, 0.25);
}

#[test]
fn faults_are_rewound_and_replayed_with_the_rest_of_history() {
    let assets = assets();
    let mut t = timeline_on(&assets, HELIOS_ID);
    run(&mut t, secs(10));
    t.issue(inject(
        json!({ "type": "latency", "nodes": "region:us-east", "factor": 3.0 }),
    ));
    let mut digests = Vec::new();
    for _ in 0..secs(30) {
        t.step();
        digests.push((t.tick(), t.state().digest()));
    }
    let region = t
        .topology()
        .nodes_in_region(t.topology().region_index["us-east"]);
    assert_eq!(
        faults(&t).len(),
        region.len(),
        "one per service of the region"
    );

    // Before the fault was placed there is none; the snapshot of that
    // moment says so.
    t.seek(secs(8));
    assert!(faults(&t).is_empty());
    assert!(t.state().faults.is_empty());

    // Stepping through history again reproduces it bit for bit.
    t.seek(secs(10));
    for (tick, digest) in &digests {
        t.step();
        assert_eq!(t.tick(), *tick);
        assert_eq!(t.state().digest(), *digest, "tick {tick}");
    }
    assert_eq!(faults(&t).len(), region.len());
}

#[test]
fn the_engine_holds_faults_to_their_bound_whoever_issues_them() {
    let assets = assets();
    let mut t = timeline_on(&assets, STRESS_ID);
    let regions: Vec<String> = t.topology().region_index.keys().cloned().collect();
    // Five kinds of fault on every service of every region is far more
    // figures than may be held at once.
    for region in &regions {
        for kind in ["capacity", "latency"] {
            t.issue(inject(
                json!({ "type": kind, "nodes": format!("region:{region}"), "factor": 0.5 }),
            ));
        }
        t.issue(inject(
            json!({ "type": "errorInject", "nodes": format!("region:{region}"), "rate": 0.1 }),
        ));
        t.issue(inject(
            json!({ "type": "down", "nodes": format!("region:{region}") }),
        ));
    }
    run(&mut t, secs(2));
    let held = t.state().faults.len();
    assert!(held > 0);
    assert!(held <= MAX_FAULT_CHANNELS, "{held} figures held");
    assert!(
        t.topology().node_count() * 4 > MAX_FAULT_CHANNELS,
        "the test asks for more than the bound"
    );
}

fn recording(commands: Value) -> Recording {
    serde_json::from_value(json!({
        "id": "by-hand",
        "name": "By hand",
        "description": "A recording that places faults.",
        "topologyId": HELIOS_ID,
        "seed": 7,
        "durationMs": 60000,
        "commands": commands,
    }))
    .expect("the recording parses")
}

#[test]
fn a_recording_may_place_and_lift_faults_and_is_held_to_the_same_checks() {
    let good = recording(json!([
        { "atMs": 2000, "command": {
            "type": "injectFault",
            "effect": { "type": "latency", "nodes": "node:use-gateway", "factor": 6.0 },
            "rampMs": 2000
        } },
        { "atMs": 4000, "command": {
            "type": "injectFault",
            "effect": { "type": "down", "nodes": "node:use-search" }
        } },
        { "atMs": 20000, "command": {
            "type": "clearFaults",
            "effect": { "type": "down", "nodes": "node:use-search" }
        } },
        { "atMs": 30000, "command": { "type": "clearFaults" } }
    ]));
    good.validate().expect("a recording may place faults");
    assert_eq!(good.faults().count(), 3);

    // It plays: the gateway is slowed, the search service goes and comes back.
    let assets = assets();
    let world = assets.world(HELIOS_ID).unwrap();
    let mut t = Timeline::from_recording(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(&assets.decisions),
        &good,
    );
    t.seek(secs(10));
    assert_eq!(faults(&t).len(), 2);
    assert_eq!(t.state().health[node(&t, "use-search")], Health::Down);
    t.seek(secs(28));
    assert_eq!(faults(&t).len(), 1);
    t.seek(secs(45));
    assert!(faults(&t).is_empty());
    assert!(t.state().health.iter().all(|h| *h == Health::Healthy));

    for (commands, why) in [
        (
            json!([{ "atMs": 0, "command": {
                "type": "injectFault",
                "effect": { "type": "latency", "nodes": "node:use-gateway", "factor": -2.0 }
            } }]),
            "factor must be between",
        ),
        (
            json!([{ "atMs": 0, "command": {
                "type": "injectFault",
                "effect": { "type": "flowRate", "flow": "attack", "rate": { "rps": 10.0 } }
            } }]),
            "scenario's own flow",
        ),
        (
            json!([{ "atMs": 0, "command": {
                "type": "injectFault",
                "effect": { "type": "down", "nodes": "node:use-search" },
                "rampMs": 600000
            } }]),
            "rampMs must be at most",
        ),
    ] {
        let error = recording(commands).validate().unwrap_err();
        assert!(error.contains(why), "{error}");
    }
    // A command takes no field it does not define.
    assert!(serde_json::from_value::<Recording>(json!({
        "id": "x", "name": "X", "description": "", "topologyId": HELIOS_ID, "seed": 1,
        "durationMs": 1000,
        "commands": [{ "atMs": 0, "command": { "type": "clearFaults", "all": true } }]
    }))
    .is_err());

    // What a fault names has to exist on the recording's own topology.
    let mut sources = Sources::bundled().unwrap();
    sources
        .recordings
        .push(recording(json!([{ "atMs": 0, "command": {
        "type": "injectFault",
        "effect": { "type": "down", "nodes": "node:no-such-service" }
    } }])));
    match Assets::build(sources) {
        Err(BootstrapError::RecordingFault { recording, message }) => {
            assert_eq!(recording, "by-hand");
            assert!(message.contains("no-such-service"), "{message}");
        }
        other => panic!(
            "expected the recording to be refused, got {:?}",
            other.err()
        ),
    }
}

// ---------------------------------------------------------------------------
// Through the API
// ---------------------------------------------------------------------------

const INJECT: &str = "/api/v1/demo/faults/inject";
const CLEAR: &str = "/api/v1/demo/faults/clear";

fn advance(state: &aegis_server::api::AppState, seconds: u64) {
    for _ in 0..seconds * 5 {
        state.service.advance(Duration::from_millis(200));
    }
}

#[tokio::test]
async fn faults_are_placed_and_lifted_through_the_api() {
    let state = state();
    advance(&state, 5);
    let placed = post(
        &state,
        INJECT,
        json!({
            "effect": { "type": "errorInject", "nodes": "node:use-payments", "rate": 0.3 },
            "rampMs": 1000
        }),
    )
    .await;
    assert_eq!(placed.status, StatusCode::OK, "{}", placed.body);
    assert_eq!(placed.body["playback"]["status"], "playing");
    // With no ramp given it is placed at once.
    let down = post(
        &state,
        INJECT,
        json!({ "effect": { "type": "down", "nodes": "node:use-search" } }),
    )
    .await;
    assert_eq!(down.status, StatusCode::OK, "{}", down.body);
    advance(&state, 10);

    let snapshot = state.service.snapshot();
    assert_eq!(snapshot.faults.len(), 2);
    assert_eq!(snapshot.faults[0].kind, FaultKind::ErrorInject);
    assert_eq!(snapshot.faults[0].value, 0.3);
    let topology = state.service.topology();
    let payments = &topology.nodes[snapshot.faults[0].node.unwrap() as usize];
    assert_eq!(payments.id, "use-payments");
    assert!(
        payments.metrics.error_rate > 0.2,
        "{}",
        payments.metrics.error_rate
    );
    let events = state.service.events(0, 1000, None, None);
    assert_eq!(
        events
            .iter()
            .filter(|event| event.title.starts_with("Fault placed by hand"))
            .count(),
        2
    );

    // One by name, then whatever is left.
    let one = post(
        &state,
        CLEAR,
        json!({ "effect": { "type": "down", "nodes": "node:use-search" } }),
    )
    .await;
    assert_eq!(one.status, StatusCode::OK);
    advance(&state, 5);
    assert_eq!(state.service.snapshot().faults.len(), 1);
    assert_eq!(post(&state, CLEAR, json!({})).await.status, StatusCode::OK);
    advance(&state, 5);
    assert!(state.service.snapshot().faults.is_empty());
    // Lifting when nothing is placed is not an error, and says nothing.
    let before = state.service.events(0, 1000, None, None).len();
    assert_eq!(post(&state, CLEAR, json!({})).await.status, StatusCode::OK);
    advance(&state, 1);
    assert_eq!(state.service.events(0, 1000, None, None).len(), before);

    // A reset is a clean slate for faults too.
    post(
        &state,
        INJECT,
        json!({ "effect": { "type": "down", "nodes": "node:use-search" } }),
    )
    .await;
    advance(&state, 2);
    assert_eq!(state.service.snapshot().faults.len(), 1);
    post(&state, "/api/v1/demo/scenarios/reset", json!({})).await;
    assert!(state.service.snapshot().faults.is_empty());
}

#[tokio::test]
async fn a_fault_that_cannot_be_placed_is_refused_with_the_reason() {
    let state = state();
    for (body, why) in [
        (
            json!({ "effect": { "type": "down", "nodes": "node:no-such-service" } }),
            "no node `no-such-service`",
        ),
        (
            json!({ "effect": { "type": "latency", "nodes": "node:use-gateway", "factor": 5000.0 } }),
            "factor must be between",
        ),
        (
            json!({ "effect": { "type": "errorInject", "nodes": "node:use-gateway", "rate": 1.5 } }),
            "rate must be between",
        ),
        (
            json!({ "effect": { "type": "flowRate", "flow": "attack", "rate": { "rps": 5.0 } } }),
            "scenario's flow",
        ),
        (
            json!({
                "effect": { "type": "edgeError", "rate": 0.5,
                    "edges": { "between": { "from": "node:use-search", "to": "node:use-ledger" } } }
            }),
            "no edge between",
        ),
        (
            json!({ "effect": { "type": "down", "nodes": "node:use-search" }, "rampMs": 600000 }),
            "rampMs must be at most",
        ),
    ] {
        let reply = post(&state, INJECT, body.clone()).await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(reply.body["error"]["code"], "invalid_fault", "{body}");
        let message = reply.body["error"]["message"].as_str().unwrap();
        assert!(message.contains(why), "{message}");
    }
    // What is not a fault at all never reaches the simulation.
    for body in [
        json!({}),
        json!({ "effect": { "type": "meltdown", "nodes": "node:use-gateway" } }),
        json!({ "effect": { "type": "down", "nodes": "use-gateway" } }),
        json!({ "effect": { "type": "down", "nodes": "node:use-gateway", "factor": 2.0 } }),
        json!({ "effect": { "type": "down", "nodes": "node:use-gateway" }, "forever": true }),
    ] {
        let reply = post(&state, INJECT, body.clone()).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{body}");
    }
    let unknown = post(
        &state,
        CLEAR,
        json!({ "effect": { "type": "down", "nodes": "node:no-such-service" } }),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::UNPROCESSABLE_ENTITY);
    advance(&state, 2);
    assert!(state.service.snapshot().faults.is_empty());
    assert!(state.service.events(0, 1000, None, None).is_empty());
}

#[tokio::test]
async fn placing_a_fault_in_the_past_branches_the_timeline_like_any_command() {
    let state = state();
    advance(&state, 20);
    post(
        &state,
        "/api/v1/demo/playback/control",
        json!({ "action": "seek", "toMs": 5000 }),
    )
    .await;
    let mut updates = state.service.subscribe();
    let placed = post(
        &state,
        INJECT,
        json!({ "effect": { "type": "latency", "nodes": "node:use-gateway", "factor": 4.0 } }),
    )
    .await;
    assert_eq!(placed.status, StatusCode::OK);
    assert_eq!(
        placed.body["playback"]["mode"], "live",
        "the future was discarded"
    );
    assert_eq!(placed.body["playback"]["headTimeMs"], 5000);
    let notice: Value = serde_json::from_str(&updates.try_recv().unwrap()).unwrap();
    assert_eq!(notice["type"], "timeline");
    assert_eq!(notice["reason"], "branch");
}

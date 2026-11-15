//! Behavioural tests of the simulation engine and its timeline.
#![allow(clippy::unwrap_used)]

use std::sync::Arc;

use aegis_server::application::Assets;
use aegis_server::domain::{
    Decision, EventKind, Health, IncidentStatus, PlaybackMode, PlaybackStatus, RejectReason,
    SecurityEvent, SecurityStatus, Severity, TelemetrySnapshot,
};
use aegis_server::incidents::catalog::{
    CASCADING_FAILURE, CEDAR_DENIAL, CREDENTIAL_STUFFING, DDOS_SURGE, REGIONAL_OUTAGE,
};
use aegis_server::simulation::timeline::{CHECKPOINT_INTERVAL, MAX_EVENTS, MAX_HISTORY_TICKS};
use aegis_server::simulation::topologies::{HELIOS_ID, STRESS_ID};
use aegis_server::simulation::{Command, Timeline, TICK_MS};

fn assets() -> Assets {
    Assets::bundled().expect("bundled assets load")
}

fn timeline_on(assets: &Assets, topology: &str, seed: u64) -> Timeline {
    let world = assets.world(topology).expect("topology exists");
    Timeline::new(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(&assets.decisions),
        seed,
    )
}

fn timeline(assets: &Assets, seed: u64) -> Timeline {
    timeline_on(assets, HELIOS_ID, seed)
}

fn start(scenario: &str) -> Command {
    Command::StartScenario {
        scenario_id: scenario.to_string(),
    }
}

fn run(t: &mut Timeline, ticks: u64) -> Vec<SecurityEvent> {
    let mut events = Vec::new();
    for _ in 0..ticks {
        events.extend(t.step().events);
    }
    events
}

fn snapshot(t: &Timeline) -> TelemetrySnapshot {
    t.telemetry(PlaybackStatus::Playing, 1.0)
}

fn secs(seconds: u64) -> u64 {
    seconds * 1000 / TICK_MS
}

fn health_of(t: &Timeline, node: &str) -> Health {
    let index = t.topology().node(node).expect("node exists");
    t.state().health[index]
}

fn all_healthy(t: &Timeline) -> bool {
    t.state().health.iter().all(|h| *h == Health::Healthy)
}

// ---------------------------------------------------------------------------
// Determinism and event ordering
// ---------------------------------------------------------------------------

#[test]
fn same_seed_and_commands_produce_identical_history() {
    let assets = assets();
    let run_once = |seed: u64| {
        let mut t = timeline(&assets, seed);
        let mut digests = Vec::new();
        let mut events = Vec::new();
        for tick in 0..600 {
            if tick == 40 {
                t.issue(start(DDOS_SURGE));
            }
            if tick == 300 {
                t.issue(start(CASCADING_FAILURE));
            }
            events.extend(t.step().events);
            digests.push(t.state().digest());
        }
        (digests, events)
    };
    let (digests_a, events_a) = run_once(42);
    let (digests_b, events_b) = run_once(42);
    assert_eq!(
        digests_a, digests_b,
        "state diverged between identical runs"
    );
    assert_eq!(events_a, events_b, "events diverged between identical runs");

    let (digests_c, _) = run_once(43);
    assert_ne!(digests_a, digests_c, "a different seed must change the run");
}

#[test]
fn events_carry_strictly_increasing_sequence_numbers_and_ordered_time() {
    let assets = assets();
    let mut t = timeline(&assets, 7);
    t.issue(start(REGIONAL_OUTAGE));
    let events = run(&mut t, 700);
    assert!(
        events.len() > 20,
        "expected a busy timeline, got {}",
        events.len()
    );
    for pair in events.windows(2) {
        assert_eq!(pair[1].seq, pair[0].seq + 1, "sequence numbers are gapless");
        assert!(pair[1].tick >= pair[0].tick, "events are ordered in time");
    }
    for event in &events {
        assert_eq!(event.virtual_time_ms, event.tick * TICK_MS);
        assert_eq!(event.id, format!("evt-{}", event.seq));
    }
    assert_eq!(events.first().map(|e| e.seq), Some(1));
}

#[test]
fn baseline_is_steady_and_internally_consistent() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    for _ in 0..300 {
        let out = t.step();
        assert!(
            out.events
                .iter()
                .all(|e| e.kind == EventKind::AuthzDecision && e.severity <= Severity::Notice),
            "the baseline only samples authorization decisions: {:?}",
            out.events
        );
        let s = snapshot(&t);
        let g = s.global;
        assert!(all_healthy(&t));
        assert!(g.error_rate < 0.001);
        assert!(g.p50_latency_ms < g.p95_latency_ms && g.p95_latency_ms < g.p99_latency_ms);
        assert!(
            g.p50_latency_ms < g.avg_latency_ms,
            "log-normal mean exceeds its median"
        );
        // Demand breathes ±~15 % around the nominal 2160 rps.
        assert!((1700.0..2700.0).contains(&g.rps), "rps {}", g.rps);
        assert!(
            (g.authz_denial_rate - assets.decisions.baseline_deny_fraction).abs() < 0.005,
            "baseline denial rate {} should match the evaluated request mix",
            g.authz_denial_rate
        );
        assert_eq!(g.active_incidents, 0);
        assert_eq!(g.suspicious_rps, 0.0);
        assert_eq!(
            g.health.healthy as usize,
            t.topology().node_count(),
            "every node healthy"
        );
    }
}

#[test]
fn snapshot_columns_align_with_the_topology() {
    let assets = assets();
    for id in [HELIOS_ID, STRESS_ID] {
        let mut t = timeline_on(&assets, id, 1);
        run(&mut t, 10);
        let s = snapshot(&t);
        let view = t.topology_view();
        let (n, m) = (view.nodes.len(), view.edges.len());
        assert_eq!(s.nodes.health.len(), n);
        assert_eq!(s.nodes.latency_ms.len(), n);
        assert_eq!(s.nodes.throughput_rps.len(), n);
        assert_eq!(s.nodes.error_rate.len(), n);
        assert_eq!(s.nodes.saturation.len(), n);
        assert_eq!(s.nodes.queue_depth.len(), n);
        assert_eq!(s.edges.traffic_rps.len(), m);
        assert_eq!(s.edges.security_status.len(), m);
        assert_eq!(s.regions.len(), view.regions.len());
        // The REST view and the stream describe the same instant.
        for (i, node) in view.nodes.iter().enumerate() {
            assert_eq!(node.metrics.throughput_rps, s.nodes.throughput_rps[i]);
            assert_eq!(node.metrics.health.code(), s.nodes.health[i]);
            assert!(
                !node.connected_services.is_empty(),
                "{} is connected",
                node.id
            );
        }
        // Flow conservation: edge-router load equals what clients send to it.
        let router = view
            .nodes
            .iter()
            .position(|x| x.id == "edge-router")
            .unwrap();
        let inbound: f64 = view
            .edges
            .iter()
            .enumerate()
            .filter(|(_, e)| e.target == "edge-router")
            .map(|(i, _)| s.edges.traffic_rps[i])
            .sum();
        assert!(
            (inbound - s.nodes.throughput_rps[router]).abs() < 2.0,
            "{id}: inbound {inbound} vs load {}",
            s.nodes.throughput_rps[router]
        );
    }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/// Starts a scenario after a short lead-in and returns the events of the run.
fn play(t: &mut Timeline, scenario: &str, seconds: u64) -> Vec<SecurityEvent> {
    run(t, 25);
    t.issue(start(scenario));
    run(t, secs(seconds))
}

fn kinds(events: &[SecurityEvent], kind: EventKind) -> Vec<&SecurityEvent> {
    events.iter().filter(|e| e.kind == kind).collect()
}

#[test]
fn every_scenario_is_available_on_both_topologies_and_runs_to_resolution() {
    let assets = assets();
    for topology in [HELIOS_ID, STRESS_ID] {
        for scenario in [
            DDOS_SURGE,
            CREDENTIAL_STUFFING,
            CEDAR_DENIAL,
            CASCADING_FAILURE,
            REGIONAL_OUTAGE,
        ] {
            let mut t = timeline_on(&assets, topology, 42);
            let info = t
                .scenarios()
                .into_iter()
                .find(|s| s.id == scenario)
                .expect("listed");
            assert!(info.available, "{scenario} available on {topology}");
            let events = play(&mut t, scenario, info.duration_ms / 1000 + 45);

            assert_eq!(kinds(&events, EventKind::IncidentStarted).len(), 1);
            assert_eq!(
                kinds(&events, EventKind::IncidentPhase).len(),
                info.phases.len(),
                "{scenario}: one event per phase"
            );
            assert_eq!(kinds(&events, EventKind::IncidentResolved).len(), 1);

            let incident = t.incidents().last().expect("incident recorded");
            assert_eq!(incident.scenario_id, scenario);
            assert_eq!(incident.status, IncidentStatus::Resolved);
            assert!(incident.resolved_at_ms.is_some());
            assert!(snapshot(&t).incident.is_none());
            assert_eq!(snapshot(&t).global.active_incidents, 0);
            assert!(
                all_healthy(&t),
                "{scenario} on {topology}: platform recovers after the scenario"
            );
            assert!(
                t.state().channels.is_empty(),
                "{scenario}: every effect channel returns to neutral"
            );
        }
    }
}

#[test]
fn ddos_surge_saturates_the_gateway_until_the_edge_filters_it() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    let baseline_rps = {
        run(&mut t, 25);
        snapshot(&t).global.rps
    };
    t.issue(start(DDOS_SURGE));

    // Volumetric surge (8 s → 36 s).
    run(&mut t, secs(30));
    let surge = snapshot(&t);
    assert!(surge.global.rps > baseline_rps * 2.5, "traffic multiplies");
    assert!(surge.global.suspicious_rps > 3000.0);
    assert!(
        surge.global.error_rate > 0.15,
        "legitimate requests are shed"
    );
    assert!(surge.global.p95_latency_ms > t.topology().baseline_p95 * 2.0);
    assert_eq!(health_of(&t, "use-gateway"), Health::Critical);
    assert_eq!(
        health_of(&t, "unknown-sources"),
        Health::Healthy,
        "the attack source is not a casualty"
    );
    let flood = &surge.flows[0];
    assert_eq!(flood.id, "flood");
    assert_eq!(
        flood.hops,
        ["unknown-sources->edge-router", "edge-router->use-gateway"]
    );
    assert!(flood.blocked_at.is_none());
    let incident = surge.incident.as_ref().expect("incident active");
    assert_eq!(incident.phase_name, "Volumetric surge");
    assert!(incident
        .impacted_node_ids
        .contains(&"use-gateway".to_string()));

    // Edge mitigation (36 s → 62 s).
    run(&mut t, secs(20));
    let mitigated = snapshot(&t);
    assert!(
        mitigated.global.error_rate < 0.01,
        "mitigation restores service"
    );
    assert!(
        mitigated.global.rejected_rps > 3000.0,
        "the flood is rejected"
    );
    assert_eq!(health_of(&t, "use-gateway"), Health::Healthy);
    let flood = &mitigated.flows[0];
    assert_eq!(flood.blocked_at.as_deref(), Some("edge-router"));
    assert_eq!(flood.blocked_reason, Some(RejectReason::Waf));
    let ingress = t.topology().edge_index["unknown-sources->edge-router"];
    assert_eq!(
        mitigated.edges.security_status[ingress],
        SecurityStatus::Throttled.code()
    );
    assert_eq!(
        mitigated.incident.unwrap().status,
        IncidentStatus::Mitigating
    );
}

#[test]
fn credential_stuffing_overloads_authentication_and_is_rate_limited() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    let events = play(&mut t, CREDENTIAL_STUFFING, 26);
    assert_eq!(health_of(&t, "use-auth"), Health::Critical);
    let burst = snapshot(&t);
    let auth_edge = t.topology().edge_index["use-gateway->use-auth"];
    assert!(
        burst.edges.rejected_rps[auth_edge] > 1000.0,
        "failed logins are rejected at the identity service"
    );
    assert_eq!(
        burst.edges.security_status[auth_edge],
        SecurityStatus::Denied.code()
    );
    assert!(kinds(&events, EventKind::AuthFailure).len() >= 2);
    // The few stolen-but-valid credentials are stopped by a real Cedar denial.
    let decision = events
        .iter()
        .find(|e| {
            e.kind == EventKind::AuthzDecision && e.details["requestId"] == "stolen-session-export"
        })
        .expect("a Cedar decision for the replayed session");
    assert_eq!(decision.details["decision"], "deny");

    run(&mut t, secs(12)); // into "Adaptive rate limiting"
    assert_eq!(health_of(&t, "use-auth"), Health::Healthy);
    let limited = snapshot(&t);
    assert_eq!(limited.flows[0].blocked_at.as_deref(), Some("use-gateway"));
    assert_eq!(
        limited.flows[0].blocked_reason,
        Some(RejectReason::RateLimit)
    );
}

#[test]
fn cedar_denial_blocks_the_prohibited_principal_at_the_authorizer() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    let baseline = assets.decisions.baseline_deny_fraction;

    // Permitted access: the request flows through to the protected resource.
    let mut events = play(&mut t, CEDAR_DENIAL, 8);
    let permitted = snapshot(&t);
    let alice = &permitted.flows[0];
    assert_eq!(alice.id, "alice-view-ledger");
    assert!(
        alice.delivered_rps > 10.0,
        "allowed traffic reaches the ledger"
    );
    assert!(alice.blocked_at.is_none());
    assert_eq!(
        alice.hops.last().map(String::as_str),
        Some("use-ledger->use-ledger-db")
    );

    // Prohibited export, then escalation.
    events.extend(run(&mut t, secs(30)));
    let denied = snapshot(&t);
    assert!(
        denied.global.authz_denial_rate > baseline + 0.15,
        "denial rate {} rises well above the {} baseline",
        denied.global.authz_denial_rate,
        baseline
    );
    for flow in denied.flows.iter().filter(|f| f.id.starts_with("mallory")) {
        assert_eq!(
            flow.delivered_rps, 0.0,
            "{} never reaches a resource",
            flow.id
        );
        assert_eq!(flow.blocked_at.as_deref(), Some("use-cedar"));
        assert_eq!(flow.blocked_reason, Some(RejectReason::PolicyDeny));
    }
    let cedar_edge = t.topology().edge_index["use-gateway->use-cedar"];
    assert_eq!(
        denied.edges.security_status[cedar_edge],
        SecurityStatus::Denied.code()
    );
    assert_eq!(health_of(&t, "use-ledger-db"), Health::Healthy);

    // The decisions on the timeline are the real Cedar outcomes.
    let decision = events
        .iter()
        .find(|e| {
            e.kind == EventKind::AuthzDecision && e.details["requestId"] == "mallory-export-ledger"
        })
        .expect("decision event for the prohibited export");
    assert_eq!(decision.severity, Severity::Warning);
    assert_eq!(decision.details["decision"], "deny");
    assert_eq!(
        decision.details["determiningPolicies"],
        serde_json::json!(["forbid-cross-tenant"])
    );
    assert_eq!(decision.details["engine"]["kind"], "embedded-cedar");
    assert_eq!(
        assets.decisions.scenario["mallory-export-ledger"]
            .outcome
            .decision,
        Decision::Deny
    );
    assert!(events
        .iter()
        .any(|e| e.kind == EventKind::Alert && e.title == "Authorization denial spike"));

    // Session revoked: requests now stop at authentication, before Cedar.
    events.extend(run(&mut t, secs(14)));
    let revoked = snapshot(&t);
    assert!((revoked.global.authz_denial_rate - baseline).abs() < 0.02);
    let mallory = revoked
        .flows
        .iter()
        .find(|f| f.id == "mallory-export-ledger")
        .unwrap();
    assert_eq!(mallory.blocked_at.as_deref(), Some("use-auth"));
    assert_eq!(mallory.blocked_reason, Some(RejectReason::SessionRevoked));
}

#[test]
fn cascading_failure_spreads_from_the_database_and_backs_up_the_queue() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    play(&mut t, CASCADING_FAILURE, 10);
    assert_ne!(health_of(&t, "use-orders-db"), Health::Healthy);
    assert_eq!(
        health_of(&t, "use-orders"),
        Health::Healthy,
        "not spread yet"
    );

    run(&mut t, secs(38)); // deep into the retry storm
    assert_eq!(health_of(&t, "use-orders-db"), Health::Critical);
    for dependent in ["use-orders", "use-inventory", "use-order-worker"] {
        assert_eq!(health_of(&t, dependent), Health::Critical, "{dependent}");
    }
    assert_ne!(
        health_of(&t, "use-gateway"),
        Health::Healthy,
        "reaches the edge"
    );
    assert_eq!(
        health_of(&t, "use-catalog"),
        Health::Healthy,
        "services that do not depend on the database are unaffected"
    );
    let queue = t.topology().node("use-order-events").unwrap();
    let storm_depth = t.state().queue_depth[queue];
    assert!(storm_depth > 300.0, "queue backlog {storm_depth}");
    assert!(snapshot(&t).global.error_rate > 0.03);

    run(&mut t, secs(18)); // circuit breakers open
    let breakers = snapshot(&t);
    assert!(
        breakers.global.p95_latency_ms < t.topology().baseline_p95 * 1.2,
        "failing fast restores latency"
    );
    let db = t.topology().node("use-orders-db").unwrap();
    assert!(
        breakers.nodes.throughput_rps[db] < t.topology().nominal_load[db] * 0.5,
        "breakers shed load from the database"
    );
    assert!(
        t.state().queue_depth[queue] > storm_depth,
        "backlog keeps growing"
    );

    run(&mut t, secs(70));
    assert!(all_healthy(&t));
    assert!(t.state().queue_depth[queue] < 1.0, "backlog drained");
}

#[test]
fn regional_outage_fails_over_and_restores() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    play(&mut t, REGIONAL_OUTAGE, 18);
    let dark = snapshot(&t);
    let region = dark.regions.iter().find(|r| r.id == "eu-west").unwrap();
    assert_eq!(region.health, Health::Down);
    assert_eq!(region.nodes_unhealthy, region.nodes_total);
    for node in t
        .topology()
        .nodes_in_region(t.topology().region_index["eu-west"])
    {
        assert_eq!(t.state().health[node], Health::Down);
    }
    assert!(dark.global.error_rate > 0.25, "a third of traffic is lost");
    let us_gateway = t.topology().node("use-gateway").unwrap();
    let before = dark.nodes.throughput_rps[us_gateway];

    run(&mut t, secs(22)); // failover complete
    let failover = snapshot(&t);
    assert!(
        failover.global.error_rate < 0.01,
        "failover restores service"
    );
    assert!(
        failover.nodes.throughput_rps[us_gateway] > before * 1.5,
        "the failover region absorbs the traffic"
    );
    let ingress = t.topology().edge_index["edge-router->euw-gateway"];
    assert!(
        failover.edges.traffic_rps[ingress] < 1.0,
        "nothing is routed to the dark region"
    );
    assert_eq!(health_of(&t, "euw-gateway"), Health::Down);

    run(&mut t, secs(75));
    assert!(all_healthy(&t));
    let restored = snapshot(&t);
    assert!(
        restored.edges.traffic_rps[ingress] > 500.0,
        "traffic returns"
    );
}

#[test]
fn starting_a_scenario_supersedes_the_running_one_and_abort_recovers() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    play(&mut t, DDOS_SURGE, 20);
    t.issue(start(REGIONAL_OUTAGE));
    let events = run(&mut t, 5);
    assert!(events
        .iter()
        .any(|e| e.kind == EventKind::IncidentResolved && e.message.contains("Superseded")));
    assert_eq!(t.incidents().len(), 2);
    assert_eq!(t.incidents()[0].status, IncidentStatus::Resolved);
    assert_eq!(snapshot(&t).global.active_incidents, 1);

    t.issue(Command::AbortScenario);
    let events = run(&mut t, secs(30));
    assert!(events
        .iter()
        .any(|e| e.kind == EventKind::IncidentResolved && e.message.contains("operator")));
    assert!(all_healthy(&t), "aborting releases every effect");
    assert!(snapshot(&t).incident.is_none());
}

#[test]
fn unknown_scenarios_do_not_disturb_the_simulation() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    t.issue(start("does-not-exist"));
    let events = run(&mut t, 10);
    assert!(events
        .iter()
        .any(|e| e.kind == EventKind::System && e.title == "Scenario unavailable"));
    assert!(t.incidents().is_empty());
}

// ---------------------------------------------------------------------------
// Time travel
// ---------------------------------------------------------------------------

#[test]
fn seeking_restores_exactly_the_state_that_was_recorded() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    let mut digests = vec![t.state().digest()];
    let mut snapshots = vec![snapshot(&t)];
    for tick in 0..520u64 {
        if tick == 30 {
            t.issue(start(CASCADING_FAILURE));
        }
        t.step();
        digests.push(t.state().digest());
        snapshots.push(snapshot(&t));
    }
    let head = t.head_tick();
    assert_eq!(head, 520);
    let recorded: Vec<SecurityEvent> = t.events().cloned().collect();

    // Hop around: on checkpoints, between them, backwards and forwards.
    for target in [0, 1, 24, 25, 26, 199, 200, 333, 519, 520, 77, 410, 3] {
        assert_eq!(t.seek(target), target);
        assert_eq!(t.tick(), target);
        assert_eq!(
            t.state().digest(),
            digests[target as usize],
            "state at tick {target} differs after seeking"
        );
        let now = snapshot(&t);
        let then = &snapshots[target as usize];
        assert_eq!(now.global, then.global, "metrics at tick {target}");
        assert_eq!(
            now.nodes, then.nodes,
            "node health and metrics at tick {target}"
        );
        assert_eq!(now.edges, then.edges);
        assert_eq!(
            now.incident, then.incident,
            "incident status at tick {target}"
        );
        assert_eq!(now.seq, then.seq);
        assert_eq!(t.head_tick(), head, "seeking never changes the head");
    }
    // History is untouched by all that seeking.
    assert_eq!(t.events().cloned().collect::<Vec<_>>(), recorded);
}

#[test]
fn replaying_from_the_past_reproduces_history_and_then_goes_live() {
    let assets = assets();
    let mut t = timeline(&assets, 9);
    let mut digests = vec![t.state().digest()];
    t.issue(start(DDOS_SURGE));
    for _ in 0..300 {
        t.step();
        digests.push(t.state().digest());
    }
    let recorded: Vec<SecurityEvent> = t.events().cloned().collect();

    t.seek(40);
    assert_eq!(
        t.playback(PlaybackStatus::Playing, 1.0).mode,
        PlaybackMode::Replay
    );
    for (tick, recorded_digest) in digests.iter().enumerate().skip(41) {
        let out = t.step();
        assert!(!out.live);
        assert!(out.events.is_empty(), "replay must not re-announce history");
        assert_eq!(
            t.state().digest(),
            *recorded_digest,
            "replay diverged at {tick}"
        );
    }
    assert_eq!(t.events().cloned().collect::<Vec<_>>(), recorded);
    assert_eq!(
        t.playback(PlaybackStatus::Playing, 1.0).mode,
        PlaybackMode::Live
    );

    // The next step extends history again.
    let out = t.step();
    assert!(out.live);
    assert_eq!(t.head_tick(), 301);
}

#[test]
fn issuing_a_command_in_the_past_branches_the_timeline() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    run(&mut t, 20);
    t.issue(start(DDOS_SURGE));
    run(&mut t, 400);
    assert_eq!(t.incidents().len(), 1);

    t.seek(10); // before the DDoS started
    assert!(
        t.incidents().is_empty(),
        "seeking back restores incident status"
    );
    let branched = t.issue(start(CEDAR_DENIAL));
    assert!(branched);
    assert_eq!(
        t.head_tick(),
        10,
        "the future beyond the cursor is discarded"
    );
    assert!(t.events().all(|e| e.tick <= 10));
    assert!(t.metrics().history.iter().all(|s| s.tick <= 10));

    let events = run(&mut t, 50);
    assert!(events.iter().any(|e| e.kind == EventKind::IncidentStarted));
    let incidents = t.incidents();
    assert_eq!(incidents.len(), 1);
    assert_eq!(
        incidents[0].scenario_id, CEDAR_DENIAL,
        "the old future is gone"
    );
    for pair in t.events().collect::<Vec<_>>().windows(2) {
        assert_eq!(
            pair[1].seq,
            pair[0].seq + 1,
            "sequence stays gapless after a branch"
        );
    }
}

#[test]
fn reset_returns_to_a_pristine_timeline_that_replays_identically() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    let pristine = t.state().digest();
    t.issue(start(REGIONAL_OUTAGE));
    run(&mut t, 200);
    let first_run = t.state().digest();

    t.reset();
    assert_eq!(t.tick(), 0);
    assert_eq!(t.head_tick(), 0);
    assert_eq!(t.state().digest(), pristine);
    assert_eq!(t.events().count(), 0);
    assert!(t.incidents().is_empty());

    t.issue(start(REGIONAL_OUTAGE));
    run(&mut t, 200);
    assert_eq!(
        t.state().digest(),
        first_run,
        "restart reproduces the first run"
    );
}

#[test]
fn history_is_bounded() {
    let assets = assets();
    let mut t = timeline(&assets, 42);
    let total = MAX_HISTORY_TICKS + 4 * CHECKPOINT_INTERVAL + 7;
    run(&mut t, total);
    let window = t.head_tick() - t.window_start_tick();
    assert!(
        window <= MAX_HISTORY_TICKS + CHECKPOINT_INTERVAL,
        "window is {window} ticks"
    );
    assert!(t.window_start_tick() > 0, "old history was dropped");
    assert!(t.events().count() <= MAX_EVENTS);
    assert!(t.events().all(|e| e.tick >= t.window_start_tick()));
    assert!(t
        .metrics()
        .history
        .iter()
        .all(|s| s.tick >= t.window_start_tick()));

    // Seeking before the window clamps to its start.
    let start = t.window_start_tick();
    assert_eq!(t.seek(0), start);
    assert_eq!(t.tick(), start);
    // ... and the state there is still exactly reproducible.
    let digest = t.state().digest();
    t.seek(t.head_tick());
    t.seek(start);
    assert_eq!(t.state().digest(), digest);
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

#[test]
fn recordings_load_deterministically_and_are_fully_seekable() {
    let assets = assets();
    for recording in &assets.recordings {
        let world = assets.world(&recording.topology_id).unwrap();
        let load = || {
            Timeline::from_recording(
                Arc::clone(&world.topo),
                Arc::clone(&world.scenarios),
                Arc::clone(&assets.decisions),
                recording,
            )
        };
        let mut a = load();
        let b = load();
        assert_eq!(a.tick(), 0, "playback starts at the beginning");
        assert_eq!(a.head_tick(), recording.duration_ms / TICK_MS);
        assert_eq!(a.recording_id(), Some(recording.id.as_str()));
        assert_eq!(
            a.events().cloned().collect::<Vec<_>>(),
            b.events().cloned().collect::<Vec<_>>(),
            "{}: loading twice yields the same history",
            recording.id
        );
        let started = a
            .events()
            .filter(|e| e.kind == EventKind::IncidentStarted)
            .count();
        assert_eq!(started, recording.commands.len());
        assert!(a.events().any(|e| e.severity == Severity::Critical));

        a.seek(a.head_tick());
        assert_eq!(a.incidents().len(), recording.commands.len());
        assert!(
            a.incidents()
                .iter()
                .all(|i| i.status == IncidentStatus::Resolved),
            "{}: every incident resolves within the recording",
            recording.id
        );
        assert!(a.state().health.iter().all(|h| *h == Health::Healthy));
    }
}

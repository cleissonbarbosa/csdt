//! What a topology file may state a service does about load: a rate limit,
//! a filter that is always on, capacity that follows the load. Each is a
//! figure the file gives and the model follows; these tests hold the model
//! to what each one says, and the engine to its determinism with them.
#![allow(clippy::unwrap_used)]

use std::sync::Arc;

use aegis_server::application::{Assets, Sources};
use aegis_server::domain::{
    Autoscale, Health, NodeSpec, PlaybackStatus, RejectReason, SecurityStatus, TelemetrySnapshot,
    TopologySpec,
};
use aegis_server::incidents::catalog::DDOS_SURGE;
use aegis_server::simulation::topologies::HELIOS_ID;
use aegis_server::simulation::{Command, Timeline, TICK_MS};
use serde_json::json;

const GATEWAY: &str = "use-gateway";
const EDGE: &str = "edge-router";

/// The bundled platform after `change`, built the way a workspace is.
fn platform(change: impl FnOnce(&mut TopologySpec)) -> Result<Assets, String> {
    let mut sources = Sources::bundled().unwrap();
    sources.topologies.truncate(1);
    // The bundled recordings name both bundled platforms.
    sources.recordings.clear();
    change(&mut sources.topologies[0]);
    Assets::build(sources).map_err(|error| error.to_string())
}

fn node<'a>(topology: &'a mut TopologySpec, id: &str) -> &'a mut NodeSpec {
    topology
        .nodes
        .iter_mut()
        .find(|node| node.id == id)
        .unwrap()
}

fn timeline(assets: &Assets) -> Timeline {
    let world = assets.world(HELIOS_ID).unwrap();
    Timeline::new(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(&assets.decisions),
        42,
    )
}

fn secs(seconds: u64) -> u64 {
    seconds * 1000 / TICK_MS
}

fn run(t: &mut Timeline, ticks: u64) {
    for _ in 0..ticks {
        t.step();
    }
}

fn snapshot(t: &Timeline) -> TelemetrySnapshot {
    t.telemetry(PlaybackStatus::Playing, 1.0)
}

fn index(t: &Timeline, id: &str) -> usize {
    t.topology().node(id).unwrap()
}

fn surge() -> Command {
    Command::StartScenario {
        scenario_id: DDOS_SURGE.to_string(),
    }
}

/// The surge on a platform, sampled thirty seconds in: the flood at full
/// rate, before the scenario's own mitigation.
fn mid_surge(assets: &Assets) -> Timeline {
    let mut t = timeline(assets);
    run(&mut t, secs(5));
    t.issue(surge());
    run(&mut t, secs(30));
    t
}

fn capacity(assets: &Assets, id: &str) -> f64 {
    let topo = &assets.world(HELIOS_ID).unwrap().topo;
    topo.capacity[topo.node(id).unwrap()]
}

#[test]
fn a_rate_limit_holds_traffic_at_the_door_and_spares_what_is_behind() {
    let plain = platform(|_| {}).unwrap();
    // A little over what the gateway takes at rest, well under its capacity.
    let limit = capacity(&plain, GATEWAY) * 0.55;
    let limited =
        platform(|topology| node(topology, GATEWAY).rate_limit_rps = Some(limit)).unwrap();
    // Stating a limit does not resize anything.
    assert_eq!(capacity(&limited, GATEWAY), capacity(&plain, GATEWAY));

    let (without, with) = (mid_surge(&plain), mid_surge(&limited));
    let gateway = index(&with, GATEWAY);

    // Without it the gateway is asked for more than twice what it can do.
    assert!(without.state().node_rho[gateway] > 1.5);
    assert_eq!(without.state().health[gateway], Health::Critical);
    // With it the gateway works within its capacity and at its usual pace,
    assert!(with.state().node_rho[gateway] < 0.75);
    let usual = with.topology().baseline_latency[gateway];
    assert!(with.state().node_latency[gateway] < usual * 1.5);
    assert!(without.state().node_latency[gateway] > usual * 2.0);
    // and admits what the file says, to within the cost of turning away.
    let admitted = with.state().node_load[gateway];
    assert!(
        admitted > limit * 0.95 && admitted < limit * 1.25,
        "{admitted} of {limit}"
    );

    // Whoever sent it: the flood is held at the gateway, and so are callers.
    let now = snapshot(&with);
    let flood = &now.flows[0];
    assert_eq!(flood.blocked_at.as_deref(), Some(GATEWAY));
    assert_eq!(flood.blocked_reason, Some(RejectReason::RateLimit));
    assert!(flood.delivered_rps < flood.rps * 0.5);
    assert!(
        with.state().node_error[gateway] > 0.5,
        "callers are turned away too"
    );
    let door = with.topology().edge_index[&format!("{EDGE}->{GATEWAY}")];
    assert_eq!(with.state().edge_security[door], SecurityStatus::Throttled);
    assert!(with.state().edge_rejected[door] > 1000.0);

    // What is behind the gateway is sent what it admits, not what arrives.
    let behind = index(&with, "use-catalog");
    assert!(with.state().node_load[behind] < without.state().node_load[behind] * 0.8);
    let unwell = |t: &Timeline| {
        t.state()
            .health
            .iter()
            .filter(|health| **health != Health::Healthy)
            .count()
    };
    assert!(unwell(&with) < unwell(&without));

    // At rest the limit is not reached and nothing is turned away.
    let mut rest = timeline(&limited);
    run(&mut rest, secs(20));
    assert_eq!(rest.state().admit[gateway], 1.0);
    assert_eq!(rest.state().edge_rejected[door], 0.0);
    assert!(rest.state().health.iter().all(|h| *h == Health::Healthy));
}

#[test]
fn a_filter_that_is_always_on_takes_the_flood_from_the_first_request() {
    let plain = platform(|_| {}).unwrap();
    let filtered =
        platform(|topology| node(topology, EDGE).suspicious_filter = Some(0.94)).unwrap();
    let (without, with) = (mid_surge(&plain), mid_surge(&filtered));
    let gateway = index(&with, GATEWAY);

    // The scenario's own filtering has not begun; the platform's has.
    let flood = &snapshot(&with).flows[0];
    assert_eq!(flood.blocked_at.as_deref(), Some(EDGE));
    assert_eq!(flood.blocked_reason, Some(RejectReason::Waf));
    // Six in a hundred get through, to the precision a snapshot is written at.
    assert!((flood.delivered_rps / flood.rps - 0.06).abs() < 1e-3);
    assert_eq!(snapshot(&without).flows[0].blocked_at, None);

    // So the gateway never sees the surge, and callers are not turned away.
    assert_eq!(without.state().health[gateway], Health::Critical);
    assert_eq!(with.state().health[gateway], Health::Healthy);
    assert!(snapshot(&with).global.error_rate < 0.01);
    assert!(snapshot(&without).global.error_rate > 0.15);

    // It takes only what a scenario marks as suspicious: at rest, nothing.
    let mut rest = timeline(&filtered);
    run(&mut rest, secs(20));
    assert_eq!(
        snapshot(&rest).global.rejected_rps,
        snapshot(&{
            let mut t = timeline(&plain);
            run(&mut t, secs(20));
            t
        })
        .global
        .rejected_rps
    );
}

#[test]
fn an_autoscaled_service_grows_with_its_load_up_to_its_limit_and_shrinks_back() {
    let scaled = platform(|topology| {
        node(topology, GATEWAY).autoscale = Some(Autoscale {
            max_factor: 2.0,
            seconds: 10.0,
        });
    })
    .unwrap();
    let plain = platform(|_| {}).unwrap();
    // Three times the traffic of the Americas, held for two minutes.
    let more = Command::InjectFault {
        effect: serde_json::from_value(
            json!({ "type": "demand", "node": "node:clients-na", "factor": 3.0 }),
        )
        .unwrap(),
        ramp_ms: 2_000,
    };
    let loaded = |assets: &Assets| {
        let mut t = timeline(assets);
        run(&mut t, secs(5));
        t.issue(more.clone());
        run(&mut t, secs(120));
        t
    };
    let (without, mut with) = (loaded(&plain), loaded(&scaled));
    let gateway = index(&with, GATEWAY);

    // It grew by what the load asks for, which is under its limit here,
    let grown = with.state().scale[gateway];
    assert!(grown > 1.3 && grown <= 2.0, "grew to ×{grown}");
    let asked = with.state().node_load[gateway] / with.topology().nominal_load[gateway];
    assert!(
        (grown - asked).abs() < 0.15,
        "×{grown} for a load of ×{asked}"
    );
    // which gives the load the headroom the gateway has at rest.
    assert!(with.state().node_rho[gateway] < without.state().node_rho[gateway] * 0.8);
    // A service that does not scale stays the size it is.
    assert!(without.state().scale.iter().all(|scale| *scale == 1.0));
    assert!(with
        .state()
        .scale
        .iter()
        .enumerate()
        .all(|(node, scale)| node == gateway || *scale == 1.0));

    // When the load goes, so does the capacity.
    with.issue(Command::ClearFaults { effect: None });
    run(&mut with, secs(120));
    assert!(with.state().scale[gateway] < 1.15);

    // And it never grows past what the file allows.
    let capped = platform(|topology| {
        node(topology, GATEWAY).autoscale = Some(Autoscale {
            max_factor: 1.2,
            seconds: 5.0,
        });
    })
    .unwrap();
    let held = loaded(&capped);
    assert!((held.state().scale[gateway] - 1.2).abs() < 1e-6);
}

#[test]
fn a_platform_with_all_three_seeks_and_replays_to_the_same_state() {
    let assets = platform(|topology| {
        node(topology, EDGE).suspicious_filter = Some(0.5);
        node(topology, GATEWAY).rate_limit_rps = Some(1_600.0);
        node(topology, GATEWAY).autoscale = Some(Autoscale {
            max_factor: 3.0,
            seconds: 15.0,
        });
        node(topology, "use-auth").autoscale = Some(Autoscale {
            max_factor: 2.0,
            seconds: 30.0,
        });
    })
    .unwrap();
    let gateway = assets.world(HELIOS_ID).unwrap().topo.node(GATEWAY).unwrap();
    let record = || {
        let mut t = timeline(&assets);
        let mut digests = vec![t.state().digest()];
        let (mut grown, mut held) = (1.0_f64, 1.0_f64);
        for tick in 0..520u64 {
            if tick == 30 {
                t.issue(surge());
            }
            t.step();
            digests.push(t.state().digest());
            grown = grown.max(t.state().scale[gateway]);
            held = held.min(t.state().admit[gateway]);
        }
        (t, digests, grown, held)
    };
    let (mut t, digests, grown, held) = record();
    // The run exercises both: the gateway grew and its limit was reached.
    // What scales and what is admitted is state, so it has to be in every
    // checkpoint, or a seek lands on another run.
    assert!(grown > 1.2, "the gateway grew to ×{grown}");
    assert!(held < 0.9, "the limit admitted {held} at its lowest");
    for target in [0, 1, 24, 25, 26, 150, 199, 200, 333, 519, 520, 77, 410, 3] {
        assert_eq!(t.seek(target), target);
        assert_eq!(
            t.state().digest(),
            digests[target as usize],
            "state at tick {target} differs after seeking"
        );
    }
    // The same seed and commands give the same run again.
    assert_eq!(record().1, digests);
}

#[test]
fn a_figure_out_of_range_or_on_a_client_is_refused_with_the_service() {
    let auto = |max_factor, seconds| {
        Some(Autoscale {
            max_factor,
            seconds,
        })
    };
    type Change = Box<dyn Fn(&mut TopologySpec)>;
    let cases: [(&str, Change); 7] = [
        (
            "use-gateway",
            Box::new(|t| node(t, GATEWAY).rate_limit_rps = Some(0.0)),
        ),
        (
            "use-gateway",
            Box::new(|t| node(t, GATEWAY).rate_limit_rps = Some(f64::NAN)),
        ),
        (
            "edge-router",
            Box::new(|t| node(t, EDGE).suspicious_filter = Some(1.5)),
        ),
        (
            "use-gateway",
            Box::new(move |t| node(t, GATEWAY).autoscale = auto(0.5, 10.0)),
        ),
        (
            "use-gateway",
            Box::new(move |t| node(t, GATEWAY).autoscale = auto(2.0, 0.0)),
        ),
        (
            "use-gateway",
            Box::new(move |t| node(t, GATEWAY).autoscale = auto(2.0, 1.0e9)),
        ),
        (
            "clients-na",
            Box::new(|t| node(t, "clients-na").rate_limit_rps = Some(100.0)),
        ),
    ];
    for (service, change) in cases {
        let error = platform(|topology| change(topology)).unwrap_err();
        assert!(error.contains(service), "`{error}` does not name {service}");
    }
    let client = platform(|t| node(t, "clients-na").rate_limit_rps = Some(100.0)).unwrap_err();
    assert!(client.contains("external client"), "{client}");
}

#[test]
fn what_a_file_states_is_shown_with_the_service_and_left_out_where_it_states_none() {
    let assets = platform(|topology| {
        node(topology, GATEWAY).rate_limit_rps = Some(1_600.0);
        node(topology, GATEWAY).autoscale = Some(Autoscale {
            max_factor: 3.0,
            seconds: 15.0,
        });
        node(topology, EDGE).suspicious_filter = Some(0.9);
    })
    .unwrap();
    let view = serde_json::to_value(timeline(&assets).topology_view()).unwrap();
    let service = |id: &str| {
        view["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == id)
            .unwrap()
            .clone()
    };
    assert_eq!(service(GATEWAY)["rateLimitRps"], 1_600.0);
    assert_eq!(
        service(GATEWAY)["autoscale"],
        json!({ "maxFactor": 3.0, "seconds": 15.0 })
    );
    assert_eq!(service(EDGE)["suspiciousFilter"], 0.9);
    let plain = service("use-catalog");
    for field in ["rateLimitRps", "suspiciousFilter", "autoscale"] {
        assert!(
            plain.get(field).is_none(),
            "{field} on a service that states none"
        );
    }
    // The file reads back as it was written.
    let spec = &assets.world(HELIOS_ID).unwrap().topo.spec;
    let again: TopologySpec = serde_json::from_str(&serde_json::to_string(spec).unwrap()).unwrap();
    assert_eq!(&again, spec);
}

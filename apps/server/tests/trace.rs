//! Diagnostic trace of every scenario. Run with:
//! `cargo test -p aegis-server --test trace -- --ignored --nocapture`
#![allow(clippy::unwrap_used)]
use std::sync::Arc;

use aegis_server::application::Assets;
use aegis_server::domain::{Health, PlaybackStatus};
use aegis_server::simulation::{Command, Timeline};

#[test]
#[ignore = "prints a table for humans"]
fn trace_scenarios() {
    let assets = Assets::bundled().expect("assets");
    let only = std::env::var("TRACE_SCENARIO").ok();
    let topo_id = std::env::var("TRACE_TOPOLOGY").unwrap_or_else(|_| "helios-commerce".into());
    let world = assets.world(&topo_id).expect("world");
    println!(
        "baseline deny fraction {:.3}  baseline p95 {:.1}",
        assets.decisions.baseline_deny_fraction, world.topo.baseline_p95
    );
    for scenario in world.scenarios.iter() {
        if only.as_deref().is_some_and(|o| o != scenario.info.id) {
            continue;
        }
        println!(
            "\n=== {} (available={}, {} ticks)",
            scenario.info.id, scenario.info.available, scenario.duration_ticks
        );
        let mut t = Timeline::new(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(&assets.decisions),
            42,
        );
        for _ in 0..50 {
            t.step();
        }
        t.issue(Command::StartScenario {
            scenario_id: scenario.info.id.clone(),
        });
        println!(
            "{:>5} {:>7} {:>7} {:>7} {:>7} {:>6} {:>6} {:>7} {:>7}  H/D/C/X  phase / unhealthy",
            "t", "rps", "avg", "p95", "p99", "err%", "deny%", "susp", "rej"
        );
        let total = scenario.duration_ticks + 200;
        for i in 0..total {
            let out = t.step();
            for e in &out.events {
                if std::env::var("TRACE_EVENTS").is_ok() {
                    println!(
                        "        [{:?}/{:?}] {} — {}",
                        e.severity,
                        e.kind,
                        e.title,
                        e.node_ids.join(",")
                    );
                }
            }
            if i % 25 == 24 {
                let s = t.telemetry(PlaybackStatus::Playing, 1.0);
                let g = s.global;
                let bad: Vec<String> = t
                    .state()
                    .health
                    .iter()
                    .enumerate()
                    .filter(|(_, h)| **h != Health::Healthy)
                    .map(|(n, h)| format!("{}:{}", world.topo.node_id(n), &h.label()[..2]))
                    .collect();
                println!("{:>5.0} {:>7.0} {:>7.1} {:>7.1} {:>7.1} {:>6.2} {:>6.2} {:>7.0} {:>7.0}  {}/{}/{}/{}  {} | {}",
                    s.virtual_time_ms as f64 / 1000.0 - 10.0, g.rps, g.avg_latency_ms, g.p95_latency_ms, g.p99_latency_ms, g.error_rate * 100.0, g.authz_denial_rate * 100.0, g.suspicious_rps, g.rejected_rps,
                    g.health.healthy, g.health.degraded, g.health.critical, g.health.down,
                    s.incident.as_ref().map(|i| i.phase_name.clone()).unwrap_or_else(|| "-".into()),
                    if bad.len() > 9 { format!("{} nodes: {} ...", bad.len(), bad[..9].join(" ")) } else { bad.join(" ") });
            }
        }
        let qmax = t.state().queue_depth.iter().cloned().fold(0.0, f64::max);
        println!(
            "final: all healthy = {}, max queue depth {:.0}, incidents {:?}",
            t.state().health.iter().all(|h| *h == Health::Healthy),
            qmax,
            t.incidents()
                .iter()
                .map(|i| (i.id.clone(), i.status, i.impacted_node_ids.len()))
                .collect::<Vec<_>>()
        );
    }
}

/// Cost of the engine itself. Run with:
/// `cargo test --release -p aegis-server --test trace engine_step_cost -- --ignored --nocapture`
#[test]
#[ignore = "micro-benchmark; meaningful only with --release"]
fn engine_step_cost() {
    use std::time::Instant;

    let assets = Assets::bundled().expect("assets");
    for id in ["helios-commerce", "hyperscale-stress"] {
        let world = assets.world(id).expect("world");
        let mut t = Timeline::new(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(&assets.decisions),
            42,
        );
        t.issue(Command::StartScenario {
            scenario_id: "cascading-failure".into(),
        });
        let steps = 5_000u32;
        let started = Instant::now();
        for _ in 0..steps {
            t.step();
        }
        let step_us = started.elapsed().as_secs_f64() * 1e6 / f64::from(steps);

        let started = Instant::now();
        let mut bytes = 0;
        for _ in 0..500 {
            let snapshot = t.telemetry(PlaybackStatus::Playing, 1.0);
            bytes = serde_json::to_vec(&snapshot).expect("serialises").len();
        }
        let snapshot_us = started.elapsed().as_secs_f64() * 1e6 / 500.0;

        let started = Instant::now();
        for round in 0..200u64 {
            t.seek((round * 37) % 5_000);
        }
        let seek_us = started.elapsed().as_secs_f64() * 1e6 / 200.0;

        println!(
            "{id}: {} nodes, {} edges | step {step_us:.1} µs | snapshot build+serialise {snapshot_us:.1} µs, {bytes} bytes | random seek {seek_us:.0} µs",
            world.topo.node_count(),
            world.topo.edge_count(),
        );
    }
}

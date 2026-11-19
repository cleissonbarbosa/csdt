//! Where a platform gives, asked of the platform at rest.
//!
//! Two questions, each put to the engine as runs on timelines of their own
//! from one seed, with nothing estimated between them:
//!
//! * [`headroom`]: how many times its ordinary traffic the platform takes
//!   before one of its objectives is missed. Every external client's demand
//!   is multiplied by the same figure and held; the figure is raised along a
//!   fixed ladder until an objective is missed, then narrowed between the
//!   last that held and the first that did not. Every figure tried is in the
//!   answer, so what is said is only what was run.
//! * [`weak_points`]: what each service takes with it. Every service is
//!   taken out in turn, exactly as a trial of `down` does it, and the others
//!   that left their normal state are listed.
//!
//! Neither touches the timeline in use. Both are bounded: the ladder and its
//! narrowing are fixed, and a platform with more services than
//! [`WEAK_POINTS_MAX`] is not ranked.

use std::sync::Arc;

use serde::Serialize;

use crate::domain::{DataSource, MetricSample, ObjectiveKind, SCHEMA_VERSION};
use crate::incidents::recordings::{RecordedCommand, Recording};
use crate::incidents::spec::{NodeSel, NodeSet};
use crate::incidents::Effect;
use crate::simulation::engine::MAX_FAULT_CHANNELS;
use crate::simulation::report::objectives_over;
use crate::simulation::{Command, DecisionTable, Timeline};

use super::experiment::{left_normal, TrialEffect, TrialFigures, LEAD_IN_MS, TRIAL_MS};
use super::World;

/// The multiples of ordinary demand tried first, lowest to highest.
pub const HEADROOM_LADDER: [f64; 9] = [1.25, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 16.0];
/// How many times the gap between the last multiple that held and the first
/// that did not is halved.
pub const HEADROOM_REFINEMENTS: usize = 5;
/// How long the demand takes to reach its multiple.
pub const HEADROOM_RAMP_MS: u64 = 2_000;
/// Most services a ranking takes out in turn: each is a run of its own.
pub const WEAK_POINTS_MAX: usize = 250;

/// One of the platform's objectives and the figure it holds the platform
/// under: the same ones an incident's report counts.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Objective {
    pub kind: ObjectiveKind,
    pub threshold: f64,
}

/// The platform under one multiple of its ordinary demand.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadroomStep {
    pub factor: f64,
    /// The worst each figure got once the demand was raised.
    pub peak: TrialFigures,
    /// The objectives that were missed at any sample after it was.
    pub missed: Vec<ObjectiveKind>,
    /// The first service to leave its normal state, if any did.
    pub first: Option<TrialEffect>,
    /// How many services left their normal state.
    pub affected: usize,
}

/// How much more than its ordinary traffic the platform takes. See the
/// module.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Headroom {
    pub schema_version: &'static str,
    pub data_source: DataSource,
    pub topology_id: String,
    pub seed: u64,
    /// How long each run lasts.
    pub duration_ms: u64,
    /// The external clients whose demand was multiplied.
    pub client_ids: Vec<String>,
    pub objectives: Vec<Objective>,
    /// The platform before the demand was raised.
    pub at_rest: TrialFigures,
    /// Every multiple tried, lowest first.
    pub steps: Vec<HeadroomStep>,
    /// The highest multiple tried at which every objective was met, below
    /// the first at which one was not. Absent when one is missed at rest.
    pub holds_at: Option<f64>,
    /// The lowest multiple tried at which an objective was missed. Absent
    /// when none was, up to the highest multiple tried.
    pub gives_at: Option<f64>,
    /// What reproduces the run at `gives_at`.
    pub recording: Option<Recording>,
}

fn figures(sample: &MetricSample) -> TrialFigures {
    TrialFigures {
        error_rate: sample.error_rate,
        p95_latency_ms: sample.p95_latency_ms,
    }
}

/// The last figures at or before `at_ms`, and the worst after it.
fn before_and_peak(samples: &[MetricSample], at_ms: u64) -> Option<(TrialFigures, TrialFigures)> {
    let before = samples
        .iter()
        .rev()
        .find(|sample| sample.virtual_time_ms <= at_ms)
        .or(samples.first())
        .map(figures)?;
    let peak = samples
        .iter()
        .filter(|sample| sample.virtual_time_ms > at_ms)
        .fold(before, |peak, sample| TrialFigures {
            error_rate: peak.error_rate.max(sample.error_rate),
            p95_latency_ms: peak.p95_latency_ms.max(sample.p95_latency_ms),
        });
    Some((before, peak))
}

fn missed(world: &World, samples: &[MetricSample], since_ms: u64) -> Vec<ObjectiveKind> {
    let after: Vec<MetricSample> = samples
        .iter()
        .filter(|sample| sample.virtual_time_ms > since_ms)
        .copied()
        .collect();
    objectives_over(&world.topo, &after)
        .into_iter()
        .filter(|objective| objective.breached_ms > 0)
        .map(|objective| objective.kind)
        .collect()
}

fn run(world: &World, decisions: &Arc<DecisionTable>, recording: &Recording) -> Timeline {
    Timeline::from_recording(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(decisions),
        recording,
    )
}

/// Finds how many times its ordinary demand the platform takes. See
/// [`Headroom`].
pub fn headroom(
    world: &World,
    decisions: &Arc<DecisionTable>,
    seed: u64,
) -> Result<Headroom, String> {
    let topo = &world.topo;
    let topology_id = topo.spec.id.clone();
    let client_ids: Vec<String> = topo
        .clients
        .iter()
        .filter(|client| topo.base_demand[**client] > 0.0)
        .map(|client| topo.node_id(*client).to_string())
        .collect();
    if client_ids.is_empty() {
        return Err("the platform has no external client with any demand to raise".into());
    }
    if client_ids.len() > MAX_FAULT_CHANNELS {
        return Err(format!(
            "the platform has {} external clients; demand can be raised on at most {MAX_FAULT_CHANNELS} at once",
            client_ids.len()
        ));
    }
    let duration_ms = LEAD_IN_MS + HEADROOM_RAMP_MS + TRIAL_MS;
    let recording = |factor: f64| Recording {
        id: "headroom".to_string(),
        name: format!("The platform under ×{factor} its ordinary demand"),
        description: format!(
            "Every external client of {topology_id} at ×{factor} its demand, with seed {seed}."
        ),
        topology_id: topology_id.clone(),
        seed,
        duration_ms,
        commands: client_ids
            .iter()
            .map(|client| RecordedCommand {
                at_ms: LEAD_IN_MS,
                command: Command::InjectFault {
                    effect: Effect::Demand {
                        node: NodeSel::Node(client.clone()),
                        factor,
                    },
                    ramp_ms: HEADROOM_RAMP_MS,
                },
            })
            .collect(),
    };

    // What also happens with nothing raised is not the demand's doing.
    let quiet = run(
        world,
        decisions,
        &Recording {
            commands: Vec::new(),
            ..recording(1.0)
        },
    );
    let quiet_samples = quiet.samples();
    let (at_rest, _) =
        before_and_peak(&quiet_samples, LEAD_IN_MS).ok_or("the run recorded no samples")?;
    let anyway: Vec<String> = left_normal(&quiet, LEAD_IN_MS)
        .into_iter()
        .map(|effect| effect.node_id)
        .collect();
    let missed_at_rest = missed(world, &quiet_samples, LEAD_IN_MS);

    let try_at = |factor: f64| -> Result<HeadroomStep, String> {
        let timeline = run(world, decisions, &recording(factor));
        let samples = timeline.samples();
        let (_, peak) =
            before_and_peak(&samples, LEAD_IN_MS).ok_or("the run recorded no samples")?;
        let left: Vec<TrialEffect> = left_normal(&timeline, LEAD_IN_MS)
            .into_iter()
            .filter(|effect| !anyway.contains(&effect.node_id))
            .collect();
        Ok(HeadroomStep {
            factor,
            peak,
            missed: missed(world, &samples, LEAD_IN_MS),
            affected: left.len(),
            first: left.into_iter().next(),
        })
    };

    let mut steps: Vec<HeadroomStep> = Vec::new();
    let mut holds_at = None;
    let mut gives_at = None;
    if missed_at_rest.is_empty() {
        holds_at = Some(1.0);
        for factor in HEADROOM_LADDER {
            let step = try_at(factor)?;
            let gave = !step.missed.is_empty();
            steps.push(step);
            if gave {
                gives_at = Some(factor);
                break;
            }
            holds_at = Some(factor);
        }
        // Narrow between the last that held and the first that did not.
        if let (Some(mut low), Some(mut high)) = (holds_at, gives_at) {
            for _ in 0..HEADROOM_REFINEMENTS {
                let middle = ((low + high) / 2.0 * 100.0).round() / 100.0;
                if middle <= low || middle >= high {
                    break;
                }
                let step = try_at(middle)?;
                if step.missed.is_empty() {
                    low = middle;
                } else {
                    high = middle;
                }
                steps.push(step);
            }
            holds_at = Some(low);
            gives_at = Some(high);
        }
    } else {
        gives_at = Some(1.0);
    }
    steps.sort_by(|a, b| a.factor.total_cmp(&b.factor));

    let objectives = objectives_over(topo, &[])
        .into_iter()
        .map(|objective| Objective {
            kind: objective.kind,
            threshold: objective.threshold,
        })
        .collect();
    Ok(Headroom {
        schema_version: SCHEMA_VERSION,
        data_source: topo.spec.data_source,
        topology_id: topology_id.clone(),
        seed,
        duration_ms,
        client_ids: client_ids.clone(),
        objectives,
        at_rest,
        steps,
        holds_at,
        recording: gives_at.filter(|factor| *factor > 1.0).map(recording),
        gives_at,
    })
}

/// One service taken out of the platform at rest, and what left normal with
/// it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeakPoint {
    pub node_id: String,
    /// The other services that left their normal state, in the order they
    /// did, each timed from the moment this one was taken out.
    pub affected: Vec<TrialEffect>,
    /// The worst each of the platform's figures got with it out.
    pub peak: TrialFigures,
    /// The objectives that were missed with it out.
    pub missed: Vec<ObjectiveKind>,
}

/// Every service of the platform taken out in turn. See the module.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeakPoints {
    pub schema_version: &'static str,
    pub data_source: DataSource,
    pub topology_id: String,
    pub seed: u64,
    /// How long each run lasts.
    pub duration_ms: u64,
    pub objectives: Vec<Objective>,
    /// The platform with nothing taken out.
    pub at_rest: TrialFigures,
    /// Every service tried: the one that takes the most others with it
    /// first, then by the highest error rate, then by id.
    pub points: Vec<WeakPoint>,
}

/// Takes every service out in turn. See [`WeakPoints`].
pub fn weak_points(
    world: &World,
    decisions: &Arc<DecisionTable>,
    seed: u64,
) -> Result<WeakPoints, String> {
    let topo = &world.topo;
    let topology_id = topo.spec.id.clone();
    let services: Vec<&str> = topo
        .spec
        .nodes
        .iter()
        .filter(|node| !node.service_type.is_client())
        .map(|node| node.id.as_str())
        .collect();
    if services.len() > WEAK_POINTS_MAX {
        return Err(format!(
            "the platform has {} services; at most {WEAK_POINTS_MAX} are taken out in turn",
            services.len()
        ));
    }
    let duration_ms = LEAD_IN_MS + TRIAL_MS;
    let recording = |commands: Vec<RecordedCommand>| Recording {
        id: "weak-point".to_string(),
        name: "One service taken out of the platform at rest".to_string(),
        description: format!("Trial of one service out on {topology_id}, with seed {seed}."),
        topology_id: topology_id.clone(),
        seed,
        duration_ms,
        commands,
    };
    let quiet = run(world, decisions, &recording(Vec::new()));
    let (at_rest, _) =
        before_and_peak(&quiet.samples(), LEAD_IN_MS).ok_or("the run recorded no samples")?;
    let anyway: Vec<String> = left_normal(&quiet, LEAD_IN_MS)
        .into_iter()
        .map(|effect| effect.node_id)
        .collect();

    let mut points = Vec::with_capacity(services.len());
    for service in services {
        let timeline = run(
            world,
            decisions,
            &recording(vec![RecordedCommand {
                at_ms: LEAD_IN_MS,
                command: Command::InjectFault {
                    effect: Effect::Down {
                        nodes: NodeSet::One(NodeSel::Node(service.to_string())),
                    },
                    ramp_ms: 0,
                },
            }]),
        );
        let samples = timeline.samples();
        let (_, peak) =
            before_and_peak(&samples, LEAD_IN_MS).ok_or("the run recorded no samples")?;
        points.push(WeakPoint {
            node_id: service.to_string(),
            affected: left_normal(&timeline, LEAD_IN_MS)
                .into_iter()
                .filter(|effect| effect.node_id != service && !anyway.contains(&effect.node_id))
                .collect(),
            peak,
            missed: missed(world, &samples, LEAD_IN_MS),
        });
    }
    points.sort_by(|a, b| {
        b.affected
            .len()
            .cmp(&a.affected.len())
            .then(b.peak.error_rate.total_cmp(&a.peak.error_rate))
            .then(a.node_id.cmp(&b.node_id))
    });
    let objectives = objectives_over(topo, &[])
        .into_iter()
        .map(|objective| Objective {
            kind: objective.kind,
            threshold: objective.threshold,
        })
        .collect();
    Ok(WeakPoints {
        schema_version: SCHEMA_VERSION,
        data_source: topo.spec.data_source,
        topology_id,
        seed,
        duration_ms,
        objectives,
        at_rest,
        points,
    })
}

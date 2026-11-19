//! The same incident twice, with one thing changed.
//!
//! The engine is deterministic, so a scenario run again on the same
//! topology with the same seed gives the same history bit for bit. An
//! experiment runs it twice on timelines of its own: once as it is, once
//! with one fault placed at a chosen moment, and reports both. Whatever
//! differs between the two runs follows from that one fault, and the answer
//! says exactly what it was. The timeline in use is not touched.

use std::sync::Arc;

use serde::Serialize;

use crate::domain::{DataSource, EventKind, Health, IncidentReport, MetricSample, SCHEMA_VERSION};
use crate::incidents::recordings::{RecordedCommand, Recording};
use crate::incidents::spec::MAX_DURATION_MS;
use crate::incidents::{resolve_fault, Effect, ResolvedScenario};
use crate::simulation::channels::ChannelKey;
use crate::simulation::engine::touched;
use crate::simulation::{Command, DecisionTable, Timeline, TICK_MS};

use super::World;

/// Quiet time simulated before the scenario starts, so both runs show the
/// platform at rest first.
pub const LEAD_IN_MS: u64 = 4_000;
/// Time simulated after the scenario ends, to see the platform recover.
pub const TAIL_MS: u64 = 40_000;

/// The one thing the second run does that the first does not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Intervention {
    /// The effect in a few words: `capacity ×2`.
    pub description: String,
    /// Services it acts on.
    pub node_ids: Vec<String>,
    /// When it is placed, counted from the start of the incident.
    pub at_ms: u64,
    /// How long it takes to ease in.
    pub ramp_ms: u64,
    /// The effect as it was asked for, in the format a scenario writes it.
    pub effect: Effect,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRun {
    /// The seed and the commands of this run: loading it replays the run.
    pub recording: Recording,
    pub report: IncidentReport,
    /// Platform figures, one sample per virtual second.
    pub samples: Vec<MetricSample>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Experiment {
    pub schema_version: &'static str,
    pub data_source: DataSource,
    pub topology_id: String,
    pub seed: u64,
    pub scenario_id: String,
    pub scenario_name: String,
    /// When the incident starts in both runs.
    pub incident_started_at_ms: u64,
    /// How long each run lasts.
    pub duration_ms: u64,
    pub intervention: Intervention,
    /// The scenario as it is.
    pub baseline: ExperimentRun,
    /// The scenario with the intervention.
    pub variant: ExperimentRun,
}

/// When the scenario starts in a run, and how long the run lasts. A run can
/// be no longer than the history a timeline keeps: a scenario that nearly
/// fills it gives up the quiet lead-in before it gives up its own end.
pub(super) fn frame(scenario_ms: u64) -> (u64, u64) {
    let lead_in_ms = LEAD_IN_MS.min(MAX_DURATION_MS.saturating_sub(scenario_ms));
    let duration_ms = (lead_in_ms + scenario_ms + TAIL_MS).min(MAX_DURATION_MS);
    (lead_in_ms, duration_ms)
}

pub(super) fn simulate(
    world: &World,
    decisions: &Arc<DecisionTable>,
    recording: Recording,
) -> Result<ExperimentRun, String> {
    let timeline = Timeline::from_recording(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(decisions),
        &recording,
    );
    // The first incident of a fresh timeline.
    let report = timeline
        .incident_report("inc-001")
        .ok_or("the scenario did not start")?;
    Ok(ExperimentRun {
        recording,
        report,
        samples: timeline.samples(),
    })
}

/// Runs `scenario` twice on `world` with `seed`: as it is, and with `effect`
/// placed `at_ms` after it starts.
pub fn run(
    world: &World,
    decisions: &Arc<DecisionTable>,
    seed: u64,
    scenario: &ResolvedScenario,
    effect: Effect,
    at_ms: u64,
    ramp_ms: u64,
) -> Result<Experiment, String> {
    let targets = resolve_fault(&world.topo, &effect)?;
    let scenario_ms = scenario.duration_ticks * TICK_MS;
    if at_ms >= scenario_ms {
        return Err(format!(
            "atMs must fall inside the scenario, which lasts {scenario_ms} ms; got {at_ms}"
        ));
    }
    let (lead_in_ms, duration_ms) = frame(scenario_ms);
    let topology_id = world.topo.spec.id.clone();
    let start = RecordedCommand {
        at_ms: lead_in_ms,
        command: Command::StartScenario {
            scenario_id: scenario.info.id.clone(),
        },
    };
    let recording = |id: &str, name: String, commands: Vec<RecordedCommand>| Recording {
        id: id.to_string(),
        name,
        description: format!("Run of an A/B comparison on {topology_id} with seed {seed}."),
        topology_id: topology_id.clone(),
        seed,
        duration_ms,
        commands,
    };
    let keys: Vec<ChannelKey> = targets.iter().map(|target| target.0).collect();
    let intervention = Intervention {
        description: effect.describe(),
        node_ids: touched(&world.topo, &keys)
            .into_iter()
            .map(|node| world.topo.node_id(node).to_string())
            .collect(),
        at_ms,
        ramp_ms,
        effect: effect.clone(),
    };
    let baseline = simulate(
        world,
        decisions,
        recording(
            "experiment-baseline",
            format!("{}, as it is", scenario.info.name),
            vec![start.clone()],
        ),
    )?;
    let variant = simulate(
        world,
        decisions,
        recording(
            "experiment-variant",
            format!("{}, with {}", scenario.info.name, intervention.description),
            vec![
                start,
                RecordedCommand {
                    at_ms: lead_in_ms + at_ms,
                    command: Command::InjectFault { effect, ramp_ms },
                },
            ],
        ),
    )?;
    Ok(Experiment {
        schema_version: SCHEMA_VERSION,
        data_source: world.topo.spec.data_source,
        topology_id,
        seed,
        scenario_id: scenario.info.id.clone(),
        scenario_name: scenario.info.name.clone(),
        incident_started_at_ms: baseline.report.started_at_ms,
        duration_ms,
        intervention,
        baseline,
        variant,
    })
}

/// How long a fault is held in a trial, after it is placed.
pub const TRIAL_MS: u64 = 60_000;

/// One service a trial reached: when it first left its normal state, counted
/// from the moment the fault was placed, what it became then, and the worst
/// it was at any time after.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialEffect {
    pub node_id: String,
    pub at_ms: u64,
    pub health: Health,
    pub worst: Health,
}

/// Two of the platform's figures at one moment of a trial, or at their worst.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialFigures {
    pub error_rate: f64,
    pub p95_latency_ms: f64,
}

/// What one fault does to the platform at rest, tried on timelines of its
/// own: the same quiet run twice from one seed, the second time with the
/// fault placed. Nothing in it is estimated. A service is listed because
/// the engine recorded it leaving its normal state in the run with the
/// fault and did not in the run without, and the figures are its samples.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trial {
    pub schema_version: &'static str,
    pub data_source: DataSource,
    pub topology_id: String,
    pub seed: u64,
    /// The fault, with `at_ms` on the trial's own clock.
    pub fault: Intervention,
    pub duration_ms: u64,
    /// In the order they first left normal; the faulted services among them.
    pub affected: Vec<TrialEffect>,
    /// The platform just before the fault was placed.
    pub before: TrialFigures,
    /// The worst each figure got afterwards.
    pub peak: TrialFigures,
    /// What reproduces the run with the fault.
    pub recording: Recording,
}

fn health_named(details: &serde_json::Value, field: &str) -> Option<Health> {
    serde_json::from_value(details.get(field)?.clone()).ok()
}

fn rank(health: Health) -> u8 {
    match health {
        Health::Healthy => 0,
        Health::Degraded => 1,
        Health::Critical => 2,
        Health::Down => 3,
    }
}

/// The services that left their normal state on a timeline, from `since`.
fn left_normal(timeline: &Timeline, since: u64) -> Vec<TrialEffect> {
    let mut effects: Vec<TrialEffect> = Vec::new();
    for event in timeline.events() {
        if event.kind != EventKind::HealthTransition || event.virtual_time_ms < since {
            continue;
        }
        let (Some(node_id), Some(to)) =
            (event.node_ids.first(), health_named(&event.details, "to"))
        else {
            continue;
        };
        match effects.iter_mut().find(|effect| &effect.node_id == node_id) {
            Some(effect) => {
                if rank(to) > rank(effect.worst) {
                    effect.worst = to;
                }
            }
            None if to != Health::Healthy => effects.push(TrialEffect {
                node_id: node_id.clone(),
                at_ms: event.virtual_time_ms - since,
                health: to,
                worst: to,
            }),
            None => {}
        }
    }
    effects
}

/// Tries one fault on the platform at rest. See [`Trial`].
pub fn trial(
    world: &World,
    decisions: &Arc<DecisionTable>,
    seed: u64,
    effect: Effect,
    ramp_ms: u64,
) -> Result<Trial, String> {
    let targets = resolve_fault(&world.topo, &effect)?;
    let topology_id = world.topo.spec.id.clone();
    let duration_ms = LEAD_IN_MS + TRIAL_MS;
    let recording = |id: &str, name: String, commands: Vec<RecordedCommand>| Recording {
        id: id.to_string(),
        name,
        description: format!("Trial of one fault on {topology_id} at rest, with seed {seed}."),
        topology_id: topology_id.clone(),
        seed,
        duration_ms,
        commands,
    };
    let keys: Vec<ChannelKey> = targets.iter().map(|target| target.0).collect();
    let fault = Intervention {
        description: effect.describe(),
        node_ids: touched(&world.topo, &keys)
            .into_iter()
            .map(|node| world.topo.node_id(node).to_string())
            .collect(),
        at_ms: LEAD_IN_MS,
        ramp_ms,
        effect: effect.clone(),
    };
    let run = |recording: &Recording| {
        Timeline::from_recording(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(decisions),
            recording,
        )
    };
    let quiet = run(&recording(
        "trial-at-rest",
        "The platform at rest".to_string(),
        Vec::new(),
    ));
    let tried = recording(
        "trial",
        format!("The platform at rest, with {}", fault.description),
        vec![RecordedCommand {
            at_ms: LEAD_IN_MS,
            command: Command::InjectFault { effect, ramp_ms },
        }],
    );
    let timeline = run(&tried);

    // What also happens with nothing placed is not the fault's doing.
    let anyway: Vec<String> = left_normal(&quiet, LEAD_IN_MS)
        .into_iter()
        .map(|effect| effect.node_id)
        .collect();
    let affected: Vec<TrialEffect> = left_normal(&timeline, LEAD_IN_MS)
        .into_iter()
        .filter(|effect| !anyway.contains(&effect.node_id))
        .collect();

    let samples = timeline.samples();
    let figures = |sample: &MetricSample| TrialFigures {
        error_rate: sample.error_rate,
        p95_latency_ms: sample.p95_latency_ms,
    };
    let before = samples
        .iter()
        .rev()
        .find(|sample| sample.virtual_time_ms <= LEAD_IN_MS)
        .or(samples.first())
        .map(figures)
        .ok_or("the trial recorded no samples")?;
    let peak = samples
        .iter()
        .filter(|sample| sample.virtual_time_ms > LEAD_IN_MS)
        .fold(before, |peak, sample| TrialFigures {
            error_rate: peak.error_rate.max(sample.error_rate),
            p95_latency_ms: peak.p95_latency_ms.max(sample.p95_latency_ms),
        });
    Ok(Trial {
        schema_version: SCHEMA_VERSION,
        data_source: world.topo.spec.data_source,
        topology_id,
        seed,
        fault,
        duration_ms,
        affected,
        before,
        peak,
        recording: tried,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_shows_the_platform_at_rest_before_and_after_the_scenario() {
        let scenario_ms = 104_000;
        assert_eq!(
            frame(scenario_ms),
            (LEAD_IN_MS, LEAD_IN_MS + scenario_ms + TAIL_MS)
        );
    }

    #[test]
    fn a_scenario_that_fills_the_history_keeps_its_end_before_its_lead_in() {
        // Room for the scenario and two of the four quiet seconds.
        let scenario_ms = MAX_DURATION_MS - 2_000;
        assert_eq!(frame(scenario_ms), (2_000, MAX_DURATION_MS));
        // No room at all: it starts at once and the run is the history.
        assert_eq!(frame(MAX_DURATION_MS), (0, MAX_DURATION_MS));
    }
}

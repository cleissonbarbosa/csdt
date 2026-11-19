//! The same incident on two platforms.
//!
//! A set of files that is not in use describes a platform of its own. This
//! runs one scenario on the platform in use and on that one, each on a
//! timeline of its own from the same seed, and reports both, together with
//! what the two descriptions state differently.
//!
//! Nothing here is estimated. Both runs are the engine's, the same way an
//! experiment's are. A difference is listed because the two descriptions
//! differ, never because it would explain the outcome: which of them an
//! outcome follows from is not something this says. Neither the timeline in
//! use nor the files in use are touched.

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;

use crate::domain::{
    DataSource, IncidentReport, PrescribedEffect, TopologySpec, TopologySummary, SCHEMA_VERSION,
};
use crate::incidents::recordings::{RecordedCommand, Recording};
use crate::incidents::ResolvedScenario;
use crate::simulation::{Command, DecisionTable, SimTopology, TICK_MS};

use super::experiment::{frame, simulate, ExperimentRun};
use super::{Loaded, World};

/// One field two descriptions of the same thing state differently, as each
/// file wrote it. `null` is a field the file left out.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldChange {
    pub field: String,
    pub base: Value,
    pub candidate: Value,
}

/// A service or a region one side has and the other does not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Named {
    pub id: String,
    pub name: String,
}

/// A service or a region both sides have, described differently.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemChange {
    pub id: String,
    /// Its name on the platform in use.
    pub name: String,
    pub fields: Vec<FieldChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionChange {
    pub source: String,
    pub target: String,
    pub fields: Vec<FieldChange>,
}

/// A role that names something else, or exists on one side only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleChange {
    pub role: String,
    pub base: Option<String>,
    pub candidate: Option<String>,
}

/// A service whose capacity neither file changed and the model nonetheless
/// works with another figure for: a capacity that is not stated is sized
/// from the service's load at rest, and that load follows from everything
/// that calls it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityChange {
    pub id: String,
    pub name: String,
    pub base: f64,
    pub candidate: f64,
}

/// What two descriptions of a platform state differently, and the one thing
/// that follows from them without being stated: capacities sized from load.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformChanges {
    pub services_added: Vec<Named>,
    pub services_removed: Vec<Named>,
    pub services_changed: Vec<ItemChange>,
    pub connections_added: Vec<Connection>,
    pub connections_removed: Vec<Connection>,
    pub connections_changed: Vec<ConnectionChange>,
    pub regions_added: Vec<Named>,
    pub regions_removed: Vec<Named>,
    pub regions_changed: Vec<ItemChange>,
    pub roles: Vec<RoleChange>,
    pub derived_capacity: Vec<CapacityChange>,
}

/// The fields two values of one type state differently. Both are written
/// out the way a file holds them, so a field added to the format is compared
/// without being named here.
fn fields<T: Serialize>(base: &T, candidate: &T) -> Vec<FieldChange> {
    let object = |value: &T| match serde_json::to_value(value) {
        Ok(Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    let (base, candidate) = (object(base), object(candidate));
    let mut changes = Vec::new();
    for (field, before) in &base {
        let after = candidate.get(field).cloned().unwrap_or(Value::Null);
        if *before != after {
            changes.push(FieldChange {
                field: field.clone(),
                base: before.clone(),
                candidate: after,
            });
        }
    }
    for (field, after) in &candidate {
        if !base.contains_key(field) && !after.is_null() {
            changes.push(FieldChange {
                field: field.clone(),
                base: Value::Null,
                candidate: after.clone(),
            });
        }
    }
    changes
}

impl PlatformChanges {
    /// Compares two compiled topologies. Services, regions and connections
    /// are matched by id; a connection's id is its two ends.
    pub fn between(base: &SimTopology, candidate: &SimTopology) -> Self {
        let (before, after): (&TopologySpec, &TopologySpec) = (&base.spec, &candidate.spec);
        let mut changes = Self::default();

        for region in &after.regions {
            if !base.region_index.contains_key(&region.id) {
                changes.regions_added.push(Named {
                    id: region.id.clone(),
                    name: region.name.clone(),
                });
            }
        }
        for region in &before.regions {
            match candidate.region_index.get(&region.id) {
                None => changes.regions_removed.push(Named {
                    id: region.id.clone(),
                    name: region.name.clone(),
                }),
                Some(&other) => {
                    let fields = fields(region, &after.regions[other]);
                    if !fields.is_empty() {
                        changes.regions_changed.push(ItemChange {
                            id: region.id.clone(),
                            name: region.name.clone(),
                            fields,
                        });
                    }
                }
            }
        }

        for node in &after.nodes {
            if base.node(&node.id).is_none() {
                changes.services_added.push(Named {
                    id: node.id.clone(),
                    name: node.name.clone(),
                });
            }
        }
        for (i, node) in before.nodes.iter().enumerate() {
            let Some(other) = candidate.node(&node.id) else {
                changes.services_removed.push(Named {
                    id: node.id.clone(),
                    name: node.name.clone(),
                });
                continue;
            };
            let described = &after.nodes[other];
            let fields = fields(node, described);
            if !fields.is_empty() {
                changes.services_changed.push(ItemChange {
                    id: node.id.clone(),
                    name: node.name.clone(),
                    fields,
                });
            }
            // A capacity both files leave as it was, and the model still
            // sizes differently.
            let (was, is) = (base.capacity[i], candidate.capacity[other]);
            let stated_alike =
                node.capacity_rps == described.capacity_rps && node.headroom == described.headroom;
            if stated_alike && was.is_finite() && is.is_finite() && was != is {
                changes.derived_capacity.push(CapacityChange {
                    id: node.id.clone(),
                    name: node.name.clone(),
                    base: was,
                    candidate: is,
                });
            }
        }

        let ends = |topo: &SimTopology, edge: usize| Connection {
            source: topo.spec.edges[edge].source.clone(),
            target: topo.spec.edges[edge].target.clone(),
        };
        for (i, edge) in after.edges.iter().enumerate() {
            if !base.edge_index.contains_key(&edge.id()) {
                changes.connections_added.push(ends(candidate, i));
            }
        }
        for (i, edge) in before.edges.iter().enumerate() {
            match candidate.edge_index.get(&edge.id()) {
                None => changes.connections_removed.push(ends(base, i)),
                Some(&other) => {
                    let fields = fields(edge, &after.edges[other]);
                    if !fields.is_empty() {
                        changes.connections_changed.push(ConnectionChange {
                            source: edge.source.clone(),
                            target: edge.target.clone(),
                            fields,
                        });
                    }
                }
            }
        }

        for (role, target) in &before.roles {
            let other = after.roles.get(role);
            if other != Some(target) {
                changes.roles.push(RoleChange {
                    role: role.clone(),
                    base: Some(target.clone()),
                    candidate: other.cloned(),
                });
            }
        }
        for (role, target) in &after.roles {
            if !before.roles.contains_key(role) {
                changes.roles.push(RoleChange {
                    role: role.clone(),
                    base: None,
                    candidate: Some(target.clone()),
                });
            }
        }
        changes
    }

    /// Whether the two descriptions state the same platform.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// A phase of the scenario that prescribes something else on each platform.
/// The scenario is one file, but a role may name another service on the
/// other platform, and a rate written as a share of a service's capacity is
/// another rate where that capacity is another.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescribedChange {
    pub phase: String,
    pub base: Vec<PrescribedEffect>,
    pub candidate: Vec<PrescribedEffect>,
}

/// The phases two reports of one scenario give different prescriptions for,
/// each as its report states it.
fn prescribed_differently(
    base: &IncidentReport,
    candidate: &IncidentReport,
) -> Vec<PrescribedChange> {
    base.phases
        .iter()
        .zip(&candidate.phases)
        .filter(|(before, after)| before.prescribed != after.prescribed)
        .map(|(before, after)| PrescribedChange {
            phase: before.name.clone(),
            base: before.prescribed.clone(),
            candidate: after.prescribed.clone(),
        })
        .collect()
}

/// One scenario run on the platform in use and on the one a set of files
/// describes. See the module.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformComparison {
    pub schema_version: &'static str,
    pub data_source: DataSource,
    pub seed: u64,
    pub scenario_id: String,
    pub scenario_name: String,
    /// When the incident starts in both runs.
    pub incident_started_at_ms: u64,
    /// How long each run lasts.
    pub duration_ms: u64,
    /// The platform in use.
    pub base: TopologySummary,
    /// The platform the files describe.
    pub candidate: TopologySummary,
    /// What the two descriptions state differently.
    pub changes: PlatformChanges,
    /// Whether Cedar answers the simulation differently under the files:
    /// the requests of ordinary traffic and the ones scenarios inject.
    pub decisions_changed: bool,
    /// Phases in which the same scenario prescribes something else on each
    /// platform, as the two reports state it.
    pub prescribed: Vec<PrescribedChange>,
    /// The scenario on the platform in use.
    pub baseline: ExperimentRun,
    /// The scenario on the platform the files describe.
    pub variant: ExperimentRun,
}

/// One side of a comparison: a platform, what Cedar decided for it, and the
/// scenario as it resolves there.
pub struct Side<'a> {
    pub world: &'a World,
    pub decisions: &'a Arc<DecisionTable>,
    pub scenario: &'a ResolvedScenario,
}

/// Runs the scenario on both sides with `seed`. The caller has checked that
/// it is the same scenario on both and that it can run on each.
pub fn compare(
    base: &Side<'_>,
    candidate: &Side<'_>,
    seed: u64,
) -> Result<PlatformComparison, String> {
    let scenario_ms = base.scenario.duration_ticks * TICK_MS;
    let (lead_in_ms, duration_ms) = frame(scenario_ms);
    let run = |side: &Side<'_>, id: &str| {
        let spec = &side.world.topo.spec;
        simulate(
            side.world,
            side.decisions,
            Recording {
                id: id.to_string(),
                name: format!("{}, on {}", side.scenario.info.name, spec.name),
                description: format!(
                    "Run of a comparison of platforms on {} with seed {seed}.",
                    spec.id
                ),
                topology_id: spec.id.clone(),
                seed,
                duration_ms,
                commands: vec![RecordedCommand {
                    at_ms: lead_in_ms,
                    command: Command::StartScenario {
                        scenario_id: side.scenario.info.id.clone(),
                    },
                }],
            },
        )
    };
    let baseline = run(base, "platforms-in-use")?;
    let variant = run(candidate, "platforms-with-the-files")?;
    Ok(PlatformComparison {
        schema_version: SCHEMA_VERSION,
        data_source: base.world.topo.spec.data_source,
        seed,
        scenario_id: base.scenario.info.id.clone(),
        scenario_name: base.scenario.info.name.clone(),
        incident_started_at_ms: baseline.report.started_at_ms,
        duration_ms,
        base: base.world.summary(),
        candidate: candidate.world.summary(),
        changes: PlatformChanges::between(&base.world.topo, &candidate.world.topo),
        decisions_changed: **base.decisions != **candidate.decisions,
        prescribed: prescribed_differently(&baseline.report, &variant.report),
        baseline,
        variant,
    })
}

/// Why a comparison was not run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// The base has no such topology.
    UnknownTopology(String),
    /// The base has no such scenario.
    UnknownScenario(String),
    /// The scenario cannot run on the base's topology.
    Unavailable(String),
    /// The two sides cannot be put to the same incident; the reason says why.
    Invalid(String),
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownTopology(id) => write!(f, "unknown topology `{id}`"),
            Self::UnknownScenario(id) => write!(f, "unknown scenario `{id}`"),
            Self::Unavailable(id) => {
                write!(f, "scenario `{id}` cannot run on the base's topology")
            }
            Self::Invalid(why) => f.write_str(why),
        }
    }
}

/// Runs `scenario_id` on `in_use`, a topology of `base`, and on a topology
/// of `candidate`: the one named, or the one with the same id, or the one
/// the candidate opens on. The scenario has to be the same incident on both
/// sides: in both, written the same, and able to run on each topology.
pub fn across(
    base: &Loaded,
    in_use: &str,
    candidate: &Loaded,
    scenario_id: &str,
    topology_id: Option<&str>,
    seed: u64,
) -> Result<PlatformComparison, Refusal> {
    let world = base
        .assets
        .world(in_use)
        .ok_or_else(|| Refusal::UnknownTopology(in_use.to_string()))?;
    let scenario = world
        .scenarios
        .iter()
        .find(|scenario| scenario.info.id == scenario_id)
        .ok_or_else(|| Refusal::UnknownScenario(scenario_id.to_string()))?;
    if !scenario.info.available {
        return Err(Refusal::Unavailable(scenario_id.to_string()));
    }

    let files = &candidate.assets;
    let other_id = match topology_id {
        Some(id) => id,
        None if files.world(in_use).is_some() => in_use,
        None => &files.default_topology,
    };
    let other_world = files
        .world(other_id)
        .ok_or_else(|| Refusal::Invalid(format!("the files have no topology `{other_id}`")))?;
    let other = other_world
        .scenarios
        .iter()
        .find(|scenario| scenario.info.id == scenario_id)
        .ok_or_else(|| {
            Refusal::Invalid(format!(
                "the files have no scenario `{scenario_id}`; a comparison needs the incident on both sides"
            ))
        })?;
    if !other.info.available {
        return Err(Refusal::Invalid(format!(
            "scenario `{scenario_id}` cannot run on `{other_id}` as the files describe it: {}",
            other
                .info
                .unavailable_reason
                .as_deref()
                .unwrap_or("not available")
        )));
    }
    // The same incident on both sides, or the comparison is of two things
    // at once.
    let written = |loaded: &Loaded| {
        loaded
            .sources
            .scenarios
            .iter()
            .find(|def| def.id == scenario_id)
            .cloned()
    };
    if written(base) != written(candidate) {
        return Err(Refusal::Invalid(format!(
            "scenario `{scenario_id}` is written differently in the files than in use; a comparison needs the same incident on both sides"
        )));
    }
    compare(
        &Side {
            world,
            decisions: &base.assets.decisions,
            scenario,
        },
        &Side {
            world: other_world,
            decisions: &files.decisions,
            scenario: other,
        },
        seed,
    )
    .map_err(Refusal::Invalid)
}

fn seconds(ms: u64) -> String {
    format!("{} s", ms as f64 / 1000.0)
}

fn percent(fraction: f64) -> String {
    format!("{:.1} %", fraction * 100.0)
}

impl PlatformComparison {
    /// The comparison as text, for a terminal: what differs, what follows
    /// without being stated, and the two runs figure by figure.
    pub fn render(&self, base: &str, candidate: &str) -> String {
        use std::fmt::Write as _;
        let mut out = String::new();
        let side = |summary: &TopologySummary| {
            format!("{} ({} services)", summary.name, summary.node_count)
        };
        // Writing to a String cannot fail.
        let _ = writeln!(out, "base       {base}  {}", side(&self.base));
        let _ = writeln!(out, "candidate  {candidate}  {}", side(&self.candidate));
        let _ = writeln!(
            out,
            "scenario   {} ({}), seed {}",
            self.scenario_id, self.scenario_name, self.seed
        );

        let changes = &self.changes;
        let value = |value: &Value| match value {
            Value::Null => "not stated".to_string(),
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        let fields = |fields: &[FieldChange]| {
            fields
                .iter()
                .map(|f| format!("{}: {} -> {}", f.field, value(&f.base), value(&f.candidate)))
                .collect::<Vec<_>>()
                .join("; ")
        };
        let mut lines: Vec<String> = Vec::new();
        for (what, list) in [
            ("service added", &changes.services_added),
            ("service removed", &changes.services_removed),
            ("region added", &changes.regions_added),
            ("region removed", &changes.regions_removed),
        ] {
            for entry in list {
                lines.push(format!("{what}  {}  {}", entry.id, entry.name));
            }
        }
        for (what, list) in [
            ("service changed", &changes.services_changed),
            ("region changed", &changes.regions_changed),
        ] {
            for entry in list {
                lines.push(format!("{what}  {}  {}", entry.id, fields(&entry.fields)));
            }
        }
        for (what, list) in [
            ("connection added", &changes.connections_added),
            ("connection removed", &changes.connections_removed),
        ] {
            for entry in list {
                lines.push(format!("{what}  {} -> {}", entry.source, entry.target));
            }
        }
        for entry in &changes.connections_changed {
            lines.push(format!(
                "connection changed  {} -> {}  {}",
                entry.source,
                entry.target,
                fields(&entry.fields)
            ));
        }
        for entry in &changes.roles {
            let names =
                |target: &Option<String>| target.clone().unwrap_or_else(|| "nothing".into());
            lines.push(format!(
                "role  {}  {} -> {}",
                entry.role,
                names(&entry.base),
                names(&entry.candidate)
            ));
        }
        let _ = writeln!(out, "\nWhat differs");
        if lines.is_empty() {
            let _ = writeln!(out, "  the two files describe the same platform");
        }
        for line in lines {
            let _ = writeln!(out, "  {line}");
        }
        if self.decisions_changed {
            let _ = writeln!(out, "  Cedar answers the simulation differently");
        }

        if !changes.derived_capacity.is_empty() || !self.prescribed.is_empty() {
            let _ = writeln!(out, "\nWhat follows without being stated");
            for entry in &changes.derived_capacity {
                let _ = writeln!(
                    out,
                    "  capacity sized from load  {}  {:.1} -> {:.1} req/s",
                    entry.id, entry.base, entry.candidate
                );
            }
            for change in &self.prescribed {
                let _ = writeln!(out, "  the scenario prescribes, in {}", change.phase);
                for (label, effects) in [("base", &change.base), ("candidate", &change.candidate)] {
                    let said = if effects.is_empty() {
                        "nothing".to_string()
                    } else {
                        effects
                            .iter()
                            .map(|effect| effect.description.as_str())
                            .collect::<Vec<_>>()
                            .join("; ")
                    };
                    let _ = writeln!(out, "    {label:<9}  {said}");
                }
            }
        }

        let (a, b) = (&self.baseline.report, &self.variant.report);
        let mut rows: Vec<(String, String, String)> = Vec::new();
        let peak = |peak: &Option<crate::domain::Peak>, text: fn(f64) -> String| {
            peak.map_or_else(|| "n/a".to_string(), |peak| text(peak.value))
        };
        rows.push((
            "highest error rate".into(),
            peak(&a.peak_error_rate, percent),
            peak(&b.peak_error_rate, percent),
        ));
        let mean = |mean: Option<f64>| mean.map_or_else(|| "n/a".to_string(), percent);
        rows.push((
            "mean error rate".into(),
            mean(a.mean_error_rate),
            mean(b.mean_error_rate),
        ));
        let latency = |ms: f64| format!("{ms:.0} ms");
        rows.push((
            "highest latency p95".into(),
            peak(&a.peak_p95_latency_ms, latency),
            peak(&b.peak_p95_latency_ms, latency),
        ));
        rows.push((
            "services affected".into(),
            a.impacted_node_ids.len().to_string(),
            b.impacted_node_ids.len().to_string(),
        ));
        for objective in &a.objectives {
            let Some(other) = b.objectives.iter().find(|o| o.kind == objective.kind) else {
                continue;
            };
            let (name, figure): (&str, fn(f64) -> String) = match objective.kind {
                crate::domain::ObjectiveKind::ErrorRate => ("error rate", percent),
                crate::domain::ObjectiveKind::LatencyP95 => ("latency p95", latency),
            };
            let cell = |o: &crate::domain::ReportObjective| {
                format!(
                    "{} (objective {})",
                    seconds(o.breached_ms),
                    figure(o.threshold)
                )
            };
            rows.push((
                format!("{name} at its objective or over for"),
                cell(objective),
                cell(other),
            ));
        }
        let back = |report: &IncidentReport| {
            if report.impacted_node_ids.is_empty() {
                "nothing was affected".to_string()
            } else {
                report.recovered_at_ms.map_or_else(
                    || "not within the run".to_string(),
                    |at| format!("+{}", seconds(at.saturating_sub(report.started_at_ms))),
                )
            }
        };
        rows.push(("all back to normal".into(), back(a), back(b)));
        let wide = rows.iter().map(|row| row.0.len()).max().unwrap_or(0);
        let middle = rows.iter().map(|row| row.1.len()).max().unwrap_or(0).max(4);
        let _ = writeln!(out, "\nThe two runs");
        let _ = writeln!(out, "  {:<wide$}  {:<middle$}  candidate", "", "base");
        for (label, base, candidate) in rows {
            let _ = writeln!(out, "  {label:<wide$}  {base:<middle$}  {candidate}");
        }
        out
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use serde_json::json;

    use super::*;
    use crate::simulation::topologies;

    fn compiled(spec: TopologySpec) -> SimTopology {
        SimTopology::compile(spec).unwrap()
    }

    fn helios() -> TopologySpec {
        topologies::helios().unwrap()
    }

    #[test]
    fn a_platform_compared_with_itself_differs_in_nothing() {
        let topo = compiled(helios());
        assert!(PlatformChanges::between(&topo, &topo).is_empty());
    }

    #[test]
    fn a_field_is_reported_as_each_file_wrote_it() {
        let base = helios();
        let mut candidate = base.clone();
        let node = candidate
            .nodes
            .iter_mut()
            .find(|node| node.id == "use-orders-db")
            .unwrap();
        node.capacity_rps = Some(9_000.0);
        node.base_latency_ms = 2.5;
        let was = base
            .nodes
            .iter()
            .find(|node| node.id == "use-orders-db")
            .unwrap()
            .base_latency_ms;

        let changes = PlatformChanges::between(&compiled(base), &compiled(candidate));
        assert_eq!(changes.services_changed.len(), 1);
        let change = &changes.services_changed[0];
        assert_eq!(change.id, "use-orders-db");
        assert_eq!(
            change.fields,
            [
                FieldChange {
                    field: "baseLatencyMs".to_string(),
                    base: json!(was),
                    candidate: json!(2.5),
                },
                FieldChange {
                    field: "capacityRps".to_string(),
                    base: Value::Null,
                    candidate: json!(9_000.0),
                },
            ]
        );
        // A capacity a file states is a field, not something that follows.
        assert!(changes
            .derived_capacity
            .iter()
            .all(|entry| entry.id != "use-orders-db"));
        assert!(changes.services_added.is_empty() && changes.services_removed.is_empty());
        assert!(changes.connections_changed.is_empty() && changes.roles.is_empty());
    }

    #[test]
    fn more_traffic_resizes_what_states_no_capacity() {
        let base = helios();
        let mut candidate = base.clone();
        let client = candidate
            .nodes
            .iter_mut()
            .find(|node| node.base_rps.is_some_and(|rps| rps > 0.0))
            .unwrap();
        let id = client.id.clone();
        client.base_rps = client.base_rps.map(|rps| rps * 2.0);

        let (base, candidate) = (compiled(base), compiled(candidate));
        let changes = PlatformChanges::between(&base, &candidate);
        // The one thing the file changed.
        assert_eq!(changes.services_changed.len(), 1);
        assert_eq!(changes.services_changed[0].id, id);
        assert_eq!(changes.services_changed[0].fields[0].field, "baseRps");
        // What follows from it: every figure is the compiled one.
        assert!(!changes.derived_capacity.is_empty());
        for entry in &changes.derived_capacity {
            let (i, j) = (
                base.node(&entry.id).unwrap(),
                candidate.node(&entry.id).unwrap(),
            );
            assert_eq!(entry.base, base.capacity[i]);
            assert_eq!(entry.candidate, candidate.capacity[j]);
            assert!(entry.candidate > entry.base, "{} was not resized", entry.id);
            assert_eq!(base.spec.nodes[i].capacity_rps, None);
        }
    }

    #[test]
    fn services_connections_and_roles_are_matched_by_id() {
        let base = helios();
        let mut candidate = base.clone();
        let removed = candidate.edges.pop().unwrap();
        let mut spare = candidate.nodes[1].clone();
        spare.id = "spare".to_string();
        spare.name = "Spare".to_string();
        let caller = candidate.edges[0].source.clone();
        let mut link = candidate.edges[0].clone();
        link.target = "spare".to_string();
        candidate.nodes.push(spare);
        candidate.edges.push(link);
        candidate.edges[0].weight *= 0.5;
        candidate
            .roles
            .insert("spareGateway".to_string(), "spare".to_string());

        let changes = PlatformChanges::between(&compiled(base.clone()), &compiled(candidate));
        assert_eq!(
            changes.services_added,
            [Named {
                id: "spare".to_string(),
                name: "Spare".to_string()
            }]
        );
        assert_eq!(
            changes.connections_added,
            [Connection {
                source: caller,
                target: "spare".to_string()
            }]
        );
        assert_eq!(
            changes.connections_removed,
            [Connection {
                source: removed.source,
                target: removed.target
            }]
        );
        assert_eq!(changes.connections_changed.len(), 1);
        assert_eq!(changes.connections_changed[0].source, base.edges[0].source);
        assert_eq!(changes.connections_changed[0].fields[0].field, "weight");
        assert_eq!(
            changes.roles,
            [RoleChange {
                role: "spareGateway".to_string(),
                base: None,
                candidate: Some("spare".to_string()),
            }]
        );
    }
}

use serde::{Deserialize, Serialize};

use super::{DataSource, Severity};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum IncidentStatus {
    Active,
    Mitigating,
    Recovering,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub id: String,
    pub scenario_id: String,
    pub title: String,
    pub severity: Severity,
    pub status: IncidentStatus,
    pub started_at_ms: u64,
    pub resolved_at_ms: Option<u64>,
    pub phase_index: u32,
    pub phase_name: String,
    pub root_cause_node_id: Option<String>,
    pub impacted_node_ids: Vec<String>,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ScenarioCategory {
    Availability,
    Identity,
    Authorization,
    Resilience,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioPhase {
    pub name: String,
    pub at_ms: u64,
    pub status: IncidentStatus,
    pub description: String,
}

/// A launchable incident scenario as exposed to clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub category: ScenarioCategory,
    pub severity: Severity,
    pub duration_ms: u64,
    pub phases: Vec<ScenarioPhase>,
    /// Nodes the scenario targets directly on the active topology.
    pub target_node_ids: Vec<String>,
    /// False when the active topology lacks a role the scenario needs.
    pub available: bool,
    /// Specific resolution failure on the active topology; absent when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

/// A prerecorded fictional incident that can be loaded onto the timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub topology_id: String,
    pub duration_ms: u64,
    pub scenario_ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// Incident report: what a run of an incident shows, read back from it
// ---------------------------------------------------------------------------

/// Something the scenario holds the model to during a phase. It is written
/// in the scenario file: the model did not arrive at it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescribedEffect {
    /// The effect in a few words: `latency ×6`.
    pub description: String,
    /// Services it acts on.
    pub node_ids: Vec<String>,
    /// Connections it acts on.
    pub edge_ids: Vec<String>,
}

/// Why a service left its normal state, as far as the run itself shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CauseKind {
    /// The scenario acts on the service directly.
    Prescribed,
    /// A service it calls synchronously, or a queue's consumer, was already
    /// unwell: the model carries failures and latency back to callers.
    Dependency,
    /// It receives the traffic of a service the scenario loads.
    Load,
    /// A fault placed by hand was in force on it.
    Fault,
    /// Nothing above holds; the report does not guess.
    Unattributed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cause {
    pub kind: CauseKind,
    /// The effect that acts on it, when the scenario or a fault does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect: Option<String>,
    /// The service the relation leads to, for `dependency` and `load`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_node_id: Option<String>,
    /// The connection that relation is, in the topology.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_id: Option<String>,
}

/// One change of health the engine recorded during the incident.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportTransition {
    /// Sequence number of the event it was read from.
    pub seq: u64,
    pub node_id: String,
    pub at_ms: u64,
    pub from: super::Health,
    pub to: super::Health,
    /// Present when the service got worse.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<Cause>,
}

/// An event on the timeline that belongs to the incident.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEvent {
    pub seq: u64,
    pub at_ms: u64,
    pub severity: Severity,
    pub title: String,
    /// True when the scenario announces it; false when a detection rule
    /// raised it from the model's own figures.
    pub scripted: bool,
}

/// A request shape Cedar decided during the incident, and how often the
/// timeline shows it. The decision is the one in the events: Cedar's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDecision {
    /// Id of the request in the authorization catalogue.
    pub request_id: String,
    pub principal: String,
    pub action: String,
    pub resource: String,
    pub decision: super::Decision,
    pub determining_policies: Vec<String>,
    /// Decision events of the incident that carry this request.
    pub count: u32,
    pub first_at_ms: u64,
    pub first_seq: u64,
}

/// What an objective of the platform holds it to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ObjectiveKind {
    /// The share of client requests that fail.
    ErrorRate,
    /// The 95th percentile of latency, against what it is at rest.
    LatencyP95,
}

/// One of the platform's objectives over an incident: the figure it holds
/// the platform under, and how long it was not met. The objectives are the
/// ones the engine's own detection rules raise an alert on; how long is
/// counted from the samples it recorded, one a second, and nothing is
/// estimated between two of them.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportObjective {
    pub kind: ObjectiveKind,
    /// A share of requests for the error rate; milliseconds for latency.
    pub threshold: f64,
    /// How long the figure was at or over the threshold, over what the
    /// report covers of the incident.
    pub breached_ms: u64,
    /// When it first was, on the simulation clock.
    pub first_breached_at_ms: Option<u64>,
}

/// A figure and the moment it was reached.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peak {
    pub value: f64,
    pub at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPhase {
    pub index: u32,
    pub name: String,
    pub status: IncidentStatus,
    pub description: String,
    /// When the phase was entered, on the simulation clock.
    pub at_ms: u64,
    /// The same moment, counted from the start of the incident.
    pub since_start_ms: u64,
    /// When the next phase, or the end, took over. Absent while it lasts.
    pub ended_at_ms: Option<u64>,
    pub prescribed: Vec<PrescribedEffect>,
    /// Services that got worse during the phase, in order.
    pub transitions: Vec<ReportTransition>,
    pub events: Vec<ReportEvent>,
    /// Highest share of failing client requests sampled during the phase.
    pub peak_error_rate: Option<Peak>,
    pub peak_p95_latency_ms: Option<Peak>,
}

/// Where the incident began, and on what grounds that is said.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportOrigin {
    pub node_id: String,
    pub basis: OriginBasis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OriginBasis {
    /// The scenario names its root cause.
    Declared,
    /// The first service the scenario acts on.
    FirstPrescribed,
    /// The first service seen to leave its normal state.
    FirstObserved,
}

/// The platform's figures just before the incident began.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportBaseline {
    pub error_rate: f64,
    pub p95_latency_ms: f64,
}

/// What a run of an incident shows, read back from its events, its metric
/// samples, the topology and the scenario. Every figure is the engine's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentReport {
    pub schema_version: String,
    pub data_source: DataSource,
    pub incident_id: String,
    pub scenario_id: String,
    pub title: String,
    pub severity: Severity,
    pub status: IncidentStatus,
    pub started_at_ms: u64,
    /// When the scenario ended or was stopped.
    pub resolved_at_ms: Option<u64>,
    /// How the scenario ended, in the engine's words.
    pub resolution: Option<String>,
    /// When the last affected service was back to normal, once the scenario
    /// has ended and if that is on record. It can come before the end or
    /// after it.
    pub recovered_at_ms: Option<u64>,
    /// The last moment the report covers.
    pub observed_until_ms: u64,
    pub origin: Option<ReportOrigin>,
    pub baseline: Option<ReportBaseline>,
    pub phases: Vec<ReportPhase>,
    /// The first time each affected service left its normal state, in order.
    pub propagation: Vec<ReportTransition>,
    /// Changes of health after the scenario's last phase began to recover.
    pub recovery: Vec<ReportTransition>,
    /// What Cedar decided for the scenario's own requests, by request.
    pub decisions: Vec<ReportDecision>,
    pub impacted_node_ids: Vec<String>,
    /// Services still not normal at the end of what the report covers.
    pub still_unhealthy_node_ids: Vec<String>,
    pub peak_error_rate: Option<Peak>,
    pub peak_p95_latency_ms: Option<Peak>,
    /// Most services not normal at the same time.
    pub peak_unhealthy: Option<Peak>,
    /// Mean share of failing client requests over the incident.
    pub mean_error_rate: Option<f64>,
    /// The platform's objectives, and how long each was not met.
    pub objectives: Vec<ReportObjective>,
    /// Set when lists were cut to their bound.
    pub truncated: bool,
}

use serde::{Deserialize, Serialize};

use super::Severity;

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

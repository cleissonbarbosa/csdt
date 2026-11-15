use serde::{Deserialize, Serialize};

use super::DataSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Notice,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EventKind {
    /// A node changed health.
    HealthTransition,
    IncidentStarted,
    IncidentPhase,
    IncidentResolved,
    /// A Cedar authorization decision.
    AuthzDecision,
    AuthFailure,
    /// A mitigation control engaged (rate limit, WAF rule, circuit breaker…).
    Mitigation,
    /// Traffic was re-routed.
    Reroute,
    /// An alert raised by the threat-detection rules.
    Alert,
    /// A vulnerability advisory imported from a fixture.
    CveAdvisory,
    /// A port-scan finding imported from a fixture.
    ScanFinding,
    /// Operator or system action (reset, timeline branch, import…).
    System,
}

/// An entry on the security timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityEvent {
    /// Monotonic sequence number, unique within a timeline.
    pub seq: u64,
    pub id: String,
    pub tick: u64,
    pub virtual_time_ms: u64,
    pub severity: Severity,
    pub kind: EventKind,
    pub title: String,
    pub message: String,
    pub node_ids: Vec<String>,
    pub edge_ids: Vec<String>,
    pub incident_id: Option<String>,
    pub data_source: DataSource,
    /// Kind-specific structured payload.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub details: serde_json::Value,
}

/// An event prepared outside the simulation (fixture import) that the engine
/// stamps with sequence number and time when it is applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedEvent {
    pub severity: Severity,
    pub kind: EventKind,
    pub title: String,
    pub message: String,
    pub node_ids: Vec<String>,
    pub data_source: DataSource,
    pub details: serde_json::Value,
}

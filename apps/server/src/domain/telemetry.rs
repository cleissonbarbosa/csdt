use serde::{Deserialize, Serialize};

use super::{DataSource, Health, IncidentStatus, PlaybackState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCounts {
    pub healthy: u32,
    pub degraded: u32,
    pub critical: u32,
    pub down: u32,
}

/// Platform-wide metrics. All values are derived from the simulation state of
/// the same tick; see `docs/ARCHITECTURE.md` for the exact definitions.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMetrics {
    /// Requests per second arriving at the edge (legitimate + injected).
    pub rps: f64,
    pub avg_latency_ms: f64,
    pub p50_latency_ms: f64,
    pub p95_latency_ms: f64,
    pub p99_latency_ms: f64,
    /// Share of legitimate client requests that fail.
    pub error_rate: f64,
    /// Authorization checks per second across all authorizers.
    pub authz_checks_rps: f64,
    /// Share of authorization checks that end in `Deny`.
    pub authz_denial_rate: f64,
    /// Requests per second rejected by filtering, rate limiting, auth or policy.
    pub rejected_rps: f64,
    /// Requests per second flagged as suspicious.
    pub suspicious_rps: f64,
    pub active_incidents: u32,
    pub health: HealthCounts,
}

/// Per-node metrics in struct-of-arrays form. Index `i` refers to
/// `topology.nodes[i]`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeColumns {
    /// `Health` codes: 0 healthy, 1 degraded, 2 critical, 3 down.
    pub health: Vec<u8>,
    pub latency_ms: Vec<f64>,
    pub throughput_rps: Vec<f64>,
    pub error_rate: Vec<f64>,
    pub saturation: Vec<f64>,
    pub queue_depth: Vec<f64>,
}

/// Per-edge metrics in struct-of-arrays form. Index `i` refers to
/// `topology.edges[i]`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeColumns {
    pub traffic_rps: Vec<f64>,
    pub latency_ms: Vec<f64>,
    pub error_rate: Vec<f64>,
    pub rejected_rps: Vec<f64>,
    pub suspicious_rps: Vec<f64>,
    /// `SecurityStatus` codes: 0 secure, 1 authorized, 2 throttled, 3 denied, 4 suspicious.
    pub security_status: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionStatus {
    pub id: String,
    pub health: Health,
    pub rps: f64,
    pub error_rate: f64,
    pub nodes_total: u32,
    pub nodes_unhealthy: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrafficCategory {
    Request,
    Response,
    Authentication,
    Authorization,
    QueueMessage,
    Error,
    Rejected,
    Suspicious,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RejectReason {
    Waf,
    RateLimit,
    AuthFailure,
    SessionRevoked,
    PolicyDeny,
}

/// A directed, scenario-injected traffic flow currently active in the
/// simulation (for example a credential-stuffing stream). Baseline traffic is
/// carried by the edge columns instead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficEvent {
    pub id: String,
    pub label: String,
    pub category: TrafficCategory,
    /// Edge ids the flow traverses, in order.
    pub hops: Vec<String>,
    /// Rate at which the flow enters its first hop.
    pub rps: f64,
    /// Rate that survives every hop.
    pub delivered_rps: f64,
    pub blocked_at: Option<String>,
    pub blocked_reason: Option<RejectReason>,
}

/// Compact view of the active incident carried on every snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentPulse {
    pub id: String,
    pub scenario_id: String,
    pub status: IncidentStatus,
    pub phase_index: u32,
    pub phase_count: u32,
    pub phase_name: String,
    /// Progress through the whole scenario, 0..1.
    pub progress: f64,
    pub impacted_node_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySnapshot {
    pub schema_version: String,
    pub topology_id: String,
    pub data_source: DataSource,
    pub tick: u64,
    pub virtual_time_ms: u64,
    /// Sequence number of the newest event visible at this point in time.
    pub seq: u64,
    pub global: GlobalMetrics,
    pub nodes: NodeColumns,
    pub edges: EdgeColumns,
    pub regions: Vec<RegionStatus>,
    pub flows: Vec<TrafficEvent>,
    pub incident: Option<IncidentPulse>,
    pub playback: PlaybackState,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSample {
    pub tick: u64,
    pub virtual_time_ms: u64,
    pub rps: f64,
    pub avg_latency_ms: f64,
    pub p95_latency_ms: f64,
    pub p99_latency_ms: f64,
    pub error_rate: f64,
    pub authz_denial_rate: f64,
    pub suspicious_rps: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsReport {
    pub schema_version: String,
    pub data_source: DataSource,
    pub current: GlobalMetrics,
    pub history: Vec<MetricSample>,
}

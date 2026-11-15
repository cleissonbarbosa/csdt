use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::DataSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceType {
    ApiGateway,
    AuthService,
    CedarAuthorizer,
    Microservice,
    Container,
    Serverless,
    MessageQueue,
    Database,
    Storage,
    NetworkGateway,
    SecurityMonitor,
    ExternalClient,
}

impl ServiceType {
    /// Default capacity headroom over nominal load when a fixture does not
    /// specify an explicit capacity.
    pub fn default_headroom(self) -> f64 {
        match self {
            Self::ApiGateway => 2.4,
            Self::AuthService => 2.6,
            Self::CedarAuthorizer => 3.0,
            Self::Microservice | Self::Container => 2.2,
            Self::Serverless => 3.0,
            Self::MessageQueue => 4.0,
            Self::Database => 2.5,
            Self::Storage => 4.0,
            Self::NetworkGateway => 3.6,
            Self::SecurityMonitor => 6.0,
            Self::ExternalClient => f64::INFINITY,
        }
    }

    pub fn is_client(self) -> bool {
        matches!(self, Self::ExternalClient)
    }

    pub fn is_queue(self) -> bool {
        matches!(self, Self::MessageQueue)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Environment {
    Production,
    Staging,
    #[default]
    Demo,
}

/// Health of a node. The numeric code is what columnar snapshots carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Health {
    Healthy = 0,
    Degraded = 1,
    Critical = 2,
    Down = 3,
}

impl Health {
    pub fn code(self) -> u8 {
        self as u8
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Critical => "critical",
            Self::Down => "down",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Https,
    Grpc,
    Amqp,
    Sql,
    Redis,
    S3,
    Tcp,
    Otlp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Relationship {
    /// Load-balanced routing: each request goes to exactly one target.
    Route,
    /// Synchronous service dependency.
    Call,
    /// Authentication check.
    Auth,
    /// Authorization (policy decision) check.
    Authz,
    /// Synchronous read/write against a data store.
    Data,
    /// Asynchronous publish into a queue.
    Publish,
    /// Asynchronous consumption from a queue.
    Consume,
    /// Asynchronous replication between stores.
    Replication,
    /// Asynchronous telemetry export.
    Telemetry,
}

impl Relationship {
    /// Synchronous relationships propagate latency and failures upstream.
    pub fn is_sync(self) -> bool {
        matches!(
            self,
            Self::Route | Self::Call | Self::Auth | Self::Authz | Self::Data
        )
    }

    pub fn default_criticality(self) -> f64 {
        match self {
            Self::Route | Self::Auth | Self::Authz => 1.0,
            Self::Data => 0.9,
            Self::Call => 0.8,
            Self::Publish | Self::Consume | Self::Replication | Self::Telemetry => 0.0,
        }
    }
}

/// Security posture of an edge. Numeric codes are carried in snapshots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SecurityStatus {
    /// Mutually authenticated, nothing unusual.
    Secure = 0,
    /// Traffic is being authorized normally.
    Authorized = 1,
    /// A meaningful share of traffic is rate limited or filtered.
    Throttled = 2,
    /// A meaningful share of traffic is denied by authentication or policy.
    Denied = 3,
    /// A meaningful share of traffic is flagged as suspicious.
    Suspicious = 4,
}

impl SecurityStatus {
    pub fn code(self) -> u8 {
        self as u8
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RegionKind {
    Edge,
    Cloud,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Region {
    pub id: String,
    pub name: String,
    pub kind: RegionKind,
    pub location: String,
}

/// Static description of a node as authored in a topology fixture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeSpec {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub service_type: ServiceType,
    pub region: String,
    pub tier: u8,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub environment: Environment,
    pub base_latency_ms: f64,
    /// Explicit capacity. When absent it is derived from `headroom`.
    #[serde(default)]
    pub capacity_rps: Option<f64>,
    #[serde(default)]
    pub headroom: Option<f64>,
    /// Demand generated by an external client at nominal load.
    #[serde(default)]
    pub base_rps: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EdgeSpec {
    pub source: String,
    pub target: String,
    pub protocol: Protocol,
    pub relationship: Relationship,
    /// Calls issued on this edge per request handled by the source.
    pub weight: f64,
    /// How strongly a failure of the target fails the caller (0..1).
    #[serde(default)]
    pub criticality: Option<f64>,
    /// Network latency of the hop. Derived from region placement when absent.
    #[serde(default)]
    pub latency_ms: Option<f64>,
}

impl EdgeSpec {
    pub fn id(&self) -> String {
        format!("{}->{}", self.source, self.target)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TopologySpec {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub data_source: DataSource,
    pub regions: Vec<Region>,
    /// Named anchors scenarios use to stay topology independent.
    #[serde(default)]
    pub roles: BTreeMap<String, String>,
    pub nodes: Vec<NodeSpec>,
    pub edges: Vec<EdgeSpec>,
}

// ---------------------------------------------------------------------------
// API-facing topology (static description merged with current metrics)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeMetrics {
    pub health: Health,
    pub latency_ms: f64,
    pub throughput_rps: f64,
    pub error_rate: f64,
    pub saturation: f64,
    pub queue_depth: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfrastructureNode {
    pub id: String,
    pub name: String,
    pub service_type: ServiceType,
    pub region: String,
    pub environment: Environment,
    pub tier: u8,
    pub description: String,
    pub data_source: DataSource,
    pub capacity_rps: f64,
    pub baseline_latency_ms: f64,
    pub connected_services: Vec<String>,
    pub metrics: NodeMetrics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeMetrics {
    pub traffic_rps: f64,
    pub latency_ms: f64,
    pub error_rate: f64,
    pub rejected_rps: f64,
    pub suspicious_rps: f64,
    pub security_status: SecurityStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfrastructureEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub protocol: Protocol,
    pub relationship: Relationship,
    pub weight: f64,
    pub cross_region: bool,
    pub metrics: EdgeMetrics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topology {
    pub schema_version: String,
    pub id: String,
    pub name: String,
    pub description: String,
    pub data_source: DataSource,
    pub regions: Vec<Region>,
    pub roles: BTreeMap<String, String>,
    pub nodes: Vec<InfrastructureNode>,
    pub edges: Vec<InfrastructureEdge>,
}

/// Lightweight descriptor used when listing selectable topologies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologySummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub node_count: usize,
    pub edge_count: usize,
    pub region_count: usize,
    pub data_source: DataSource,
}

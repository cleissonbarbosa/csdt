use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::DataSource;

/// File-format limits; compilation and editor schemas use the same bounds.
pub const MAX_NODES: usize = 2_000;
pub const MAX_EDGES: usize = 20_000;

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    schemars::JsonSchema,
)]
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
    // Spreads what it is sent over the services behind it.
    LoadBalancer,
    // A virtual machine, or a group of them that scales as one.
    VirtualMachine,
    // A Kubernetes cluster, drawn as one piece for the containers it runs.
    KubernetesCluster,
    // An in-memory store of what is asked for often.
    Cache,
    // A topic or a stream: events written in order, read by whoever subscribes.
    EventStream,
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
            Self::LoadBalancer => 3.0,
            Self::VirtualMachine => 2.2,
            Self::KubernetesCluster => 2.4,
            Self::Cache => 3.0,
            Self::EventStream => 4.0,
        }
    }

    pub fn is_client(self) -> bool {
        matches!(self, Self::ExternalClient)
    }

    /// What buffers what it is sent: a queue, and a topic or stream, which
    /// keeps events until they are read.
    pub fn is_queue(self) -> bool {
        matches!(self, Self::MessageQueue | Self::EventStream)
    }

    /// What a region's traffic enters by: an API gateway or a load balancer.
    pub fn is_gateway(self) -> bool {
        matches!(self, Self::ApiGateway | Self::LoadBalancer)
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default, schemars::JsonSchema,
)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, schemars::JsonSchema)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, schemars::JsonSchema)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RegionKind {
    Edge,
    Cloud,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Region {
    #[schemars(length(min = 1, max = super::MAX_ID_LEN), regex(pattern = "^[A-Za-z0-9_.-]+$"))]
    pub id: String,
    pub name: String,
    pub kind: RegionKind,
    pub location: String,
}

/// A service that adds capacity when its load asks for it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Autoscale {
    /// The most it grows to, in times its capacity at rest.
    #[schemars(range(min = 1, max = MAX_SCALE_FACTOR))]
    pub max_factor: f64,
    /// How fast it follows: the time, in seconds, in which it closes about
    /// two thirds of the gap between the capacity it has and the one the
    /// load asks for.
    #[schemars(range(min = 1, max = MAX_SCALE_SECONDS))]
    pub seconds: f64,
}

/// Most times its capacity at rest a service may be told to scale to.
pub const MAX_SCALE_FACTOR: f64 = 100.0;
/// Slowest an autoscaler may be told to follow.
pub const MAX_SCALE_SECONDS: f64 = 3600.0;

/// Static description of a node as authored in a topology fixture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeSpec {
    #[schemars(length(min = 1, max = super::MAX_ID_LEN), regex(pattern = "^[A-Za-z0-9_.-]+$"))]
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
    #[schemars(range(min = 0))]
    pub base_latency_ms: f64,
    /// Explicit capacity. When absent it is derived from `headroom`.
    #[serde(default)]
    #[schemars(extend("exclusiveMinimum" = 0))]
    pub capacity_rps: Option<f64>,
    #[serde(default)]
    #[schemars(extend("exclusiveMinimum" = 1))]
    pub headroom: Option<f64>,
    /// Demand generated by an external client at nominal load.
    #[serde(default)]
    #[schemars(range(min = 0))]
    pub base_rps: Option<f64>,
    /// The most requests a second the service admits. The rest are turned
    /// away at its door, whoever sent them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(extend("exclusiveMinimum" = 0))]
    pub rate_limit_rps: Option<f64>,
    /// The share of traffic a scenario marks as suspicious that the service
    /// turns away as it arrives, from the first request (0..1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 0, max = 1))]
    pub suspicious_filter: Option<f64>,
    /// Capacity that follows the load. Absent: the capacity is fixed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autoscale: Option<Autoscale>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EdgeSpec {
    pub source: String,
    pub target: String,
    pub protocol: Protocol,
    pub relationship: Relationship,
    /// Calls issued on this edge per request handled by the source.
    #[schemars(range(min = 0))]
    pub weight: f64,
    /// How strongly a failure of the target fails the caller (0..1).
    #[serde(default)]
    #[schemars(range(min = 0, max = 1))]
    pub criticality: Option<f64>,
    /// Network latency of the hop. Derived from region placement when absent.
    #[serde(default)]
    #[schemars(range(min = 0))]
    pub latency_ms: Option<f64>,
}

impl EdgeSpec {
    pub fn id(&self) -> String {
        format!("{}->{}", self.source, self.target)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TopologySpec {
    #[schemars(length(min = 1, max = super::MAX_ID_LEN), regex(pattern = "^[A-Za-z0-9_.-]+$"))]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[schemars(extend("enum" = ["synthetic"]))]
    pub data_source: DataSource,
    pub regions: Vec<Region>,
    /// Named anchors scenarios use to stay topology independent.
    #[serde(default)]
    pub roles: BTreeMap<String, String>,
    #[schemars(length(min = 1, max = MAX_NODES))]
    pub nodes: Vec<NodeSpec>,
    #[schemars(length(max = MAX_EDGES))]
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
    /// What the topology file states the service does about load, each
    /// absent when the file states none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_limit_rps: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suspicious_filter: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autoscale: Option<Autoscale>,
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

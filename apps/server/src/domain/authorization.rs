use serde::{Deserialize, Serialize};

use super::DataSource;

/// A Cedar authorization request. Entity references use Cedar's textual
/// form, e.g. `User::"alice"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationRequest {
    pub principal: String,
    pub action: String,
    pub resource: String,
    #[serde(default)]
    pub context: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EngineKind {
    /// The `cedar-policy` crate linked into the AEGIS server.
    EmbeddedCedar,
    /// A connected local instance of the public `cedar-agent` project.
    CedarAgent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub kind: EngineKind,
    /// Version of the evaluator when it is known, otherwise `None`.
    pub version: Option<String>,
}

/// The raw outcome of a policy evaluation, exactly as the engine reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    pub decision: Decision,
    /// Ids of the policies that determined the decision (Cedar's `reason`).
    pub determining_policies: Vec<String>,
    /// Evaluation errors reported by the engine (Cedar's `errors`).
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PathStageKind {
    Client,
    Edge,
    Gateway,
    Authentication,
    Authorization,
    Resource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStage {
    pub node_id: String,
    pub kind: PathStageKind,
    /// Whether the request reached this stage.
    pub reached: bool,
}

/// A fully described authorization decision placed on the topology.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationDecision {
    pub id: String,
    pub virtual_time_ms: u64,
    pub request: AuthorizationRequest,
    pub decision: Decision,
    pub determining_policies: Vec<String>,
    pub errors: Vec<String>,
    pub engine: EngineInfo,
    /// Wall-clock time the evaluation took, measured by the server.
    pub evaluation_micros: u64,
    /// Ordered stages the request moves through on the active topology.
    pub path: Vec<PathStage>,
    /// Edge ids to animate, in order.
    pub hops: Vec<String>,
    pub blocked_at: Option<String>,
    /// Policies excluded from the evaluation on the caller's request.
    pub disabled_policies: Vec<String>,
    pub data_source: DataSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyInfo {
    pub id: String,
    pub description: String,
    pub content: String,
    pub effect: PolicyEffect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PolicyEffect {
    Permit,
    Forbid,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum AuthzError {
    #[error("invalid {field}: {message}")]
    InvalidRequest {
        field: &'static str,
        message: String,
    },
    #[error("unknown policy id `{0}`")]
    UnknownPolicy(String),
    #[error("authorization engine unavailable: {0}")]
    EngineUnavailable(String),
    #[error("authorization engine returned an unexpected response: {0}")]
    Protocol(String),
}

/// Port implemented by every policy decision point AEGIS can talk to.
pub trait PolicyDecisionPoint: Send + Sync {
    fn engine(&self) -> EngineInfo;

    fn evaluate(
        &self,
        request: &AuthorizationRequest,
        disabled_policies: &[String],
    ) -> Result<PolicyDecision, AuthzError>;
}

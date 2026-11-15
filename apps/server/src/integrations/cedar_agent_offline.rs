//! Stand-in for the cedar-agent adapter where there is no network to reach
//! an agent through: the engine built for the browser. It has the adapter's
//! surface and never connects, so the rest of the server needs no second
//! code path and can never present an answer as an agent's.

use crate::authorization::PolicyDocument;
use crate::domain::{AuthorizationRequest, AuthzError, EngineInfo, EngineKind, PolicyDecision};

pub const PROVIDER_ID: &str = "cedar-agent";

#[derive(Debug, Default)]
pub struct CedarAgentProvider;

impl CedarAgentProvider {
    pub fn is_connected(&self) -> bool {
        false
    }

    pub fn engine(&self) -> EngineInfo {
        EngineInfo {
            kind: EngineKind::CedarAgent,
            version: None,
        }
    }

    /// Nothing is ever synced: there is no agent.
    pub fn set_store(&self, _policies: Vec<PolicyDocument>, _entities: serde_json::Value) {}

    pub async fn is_authorized(
        &self,
        _request: &AuthorizationRequest,
    ) -> Result<(PolicyDecision, u64), AuthzError> {
        Err(AuthzError::EngineUnavailable(
            "cedar-agent cannot be reached from the in-browser engine".into(),
        ))
    }
}

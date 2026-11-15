//! Precomputed authorization outcomes the engine consumes.
//!
//! The simulation never guesses whether a request is allowed. Every request
//! shape that appears in traffic is evaluated once by a real policy decision
//! point when the table is built; the engine then only looks results up. This
//! keeps the engine pure and deterministic while the outcomes stay genuine.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::domain::{
    AuthorizationRequest, AuthzError, Decision, EngineInfo, EngineKind, PolicyDecision,
    PolicyDecisionPoint,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestTemplate {
    pub id: String,
    #[serde(default)]
    #[schemars(range(min = 0))]
    pub weight: f64,
    pub principal: String,
    pub action: String,
    pub resource: String,
    #[serde(default)]
    pub context: serde_json::Map<String, serde_json::Value>,
}

impl RequestTemplate {
    pub fn request(&self) -> AuthorizationRequest {
        AuthorizationRequest {
            principal: self.principal.clone(),
            action: self.action.clone(),
            resource: self.resource.clone(),
            context: self.context.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvaluatedRequest {
    pub id: String,
    pub weight: f64,
    pub request: AuthorizationRequest,
    pub outcome: PolicyDecision,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionTable {
    pub engine: EngineInfo,
    /// Request shapes making up baseline authorization traffic.
    pub mix: Vec<EvaluatedRequest>,
    /// Request shapes scenarios inject, by id.
    pub scenario: BTreeMap<String, EvaluatedRequest>,
    /// Share of baseline authorization traffic that is denied.
    pub baseline_deny_fraction: f64,
}

impl DecisionTable {
    pub fn build(
        pdp: &dyn PolicyDecisionPoint,
        mix: &[RequestTemplate],
        scenario: &[RequestTemplate],
    ) -> Result<Self, AuthzError> {
        let evaluate = |template: &RequestTemplate| -> Result<EvaluatedRequest, AuthzError> {
            let request = template.request();
            let outcome = pdp.evaluate(&request, &[])?;
            Ok(EvaluatedRequest {
                id: template.id.clone(),
                weight: template.weight.max(0.0),
                request,
                outcome,
            })
        };
        let mix = mix.iter().map(evaluate).collect::<Result<Vec<_>, _>>()?;
        let scenario = scenario
            .iter()
            .map(|t| evaluate(t).map(|e| (e.id.clone(), e)))
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let total: f64 = mix.iter().map(|e| e.weight).sum();
        let denied: f64 = mix
            .iter()
            .filter(|e| e.outcome.decision == Decision::Deny)
            .map(|e| e.weight)
            .sum();
        Ok(Self {
            engine: pdp.engine(),
            mix,
            scenario,
            baseline_deny_fraction: if total > 0.0 { denied / total } else { 0.0 },
        })
    }

    /// A table with no authorization traffic. Useful for model-only tests.
    pub fn empty() -> Self {
        Self {
            engine: EngineInfo {
                kind: EngineKind::EmbeddedCedar,
                version: None,
            },
            mix: Vec::new(),
            scenario: BTreeMap::new(),
            baseline_deny_fraction: 0.0,
        }
    }
}

//! Cedar authorization.
//!
//! [`CedarEngine`] is a policy decision point backed by the official
//! `cedar-policy` crate. It evaluates real Cedar policies against a synthetic
//! entity store; AEGIS never fabricates a decision, a determining policy id
//! or a diagnostic.
//!
//! Policies and entities are stored in the same JSON shapes the public
//! `cedar-agent` project accepts on `PUT /v1/policies` and `PUT /v1/data`,
//! so the exact same fixtures can be pushed to a connected agent.

use std::str::FromStr;

use cedar_policy::{
    Authorizer, Context, Decision as CedarDecision, Effect, Entities, EntityUid, Policy, PolicyId,
    PolicySet, Request, Schema, ValidationMode, Validator,
};
use serde::{Deserialize, Serialize};

use crate::domain::{
    AuthorizationRequest, AuthzError, Decision, EngineInfo, EngineKind, PolicyDecision,
    PolicyDecisionPoint, PolicyEffect, PolicyInfo,
};
use crate::simulation::RequestTemplate;

const POLICIES_JSON: &str = include_str!("../../../../fixtures/cedar/policies.json");
const ENTITIES_JSON: &str = include_str!("../../../../fixtures/cedar/entities.json");
const CATALOG_JSON: &str = include_str!("../../../../fixtures/cedar/catalog.json");

/// File name and contents of the bundled authorization fixtures.
pub const BUNDLED_FILES: [(&str, &str); 3] = [
    ("policies.json", POLICIES_JSON),
    ("entities.json", ENTITIES_JSON),
    ("catalog.json", CATALOG_JSON),
];

/// Longest entity reference accepted from clients.
pub const MAX_ENTITY_REF_LEN: usize = 256;
/// Longest policy id accepted from a policy file.
pub const MAX_POLICY_ID_LEN: usize = 128;
/// Most policies one engine holds.
pub const MAX_POLICIES: usize = 512;
/// Largest serialised context accepted from clients.
pub const MAX_CONTEXT_BYTES: usize = 4096;

#[derive(Debug, thiserror::Error)]
pub enum CedarSetupError {
    #[error("invalid fixture JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("policy `{id}` does not parse: {message}")]
    Policy { id: String, message: String },
    #[error("duplicate policy id `{0}`")]
    DuplicatePolicy(String),
    #[error("policy id `{0}` must be 1 to {MAX_POLICY_ID_LEN} printable characters")]
    InvalidPolicyId(String),
    #[error("at most {MAX_POLICIES} policies are allowed, found {0}")]
    TooManyPolicies(usize),
    #[error("policy file `{file}`: {message}")]
    PolicyFile { file: String, message: String },
    #[error("entity store is invalid: {0}")]
    Entities(String),
    #[error("schema does not parse: {0}")]
    Schema(String),
    #[error("policies do not validate against the schema: {0}")]
    Validation(String),
}

/// A policy as stored in `fixtures/cedar/policies.json`. `id` and `content`
/// match cedar-agent's policy schema; `description` is AEGIS metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyDocument {
    pub id: String,
    #[serde(default)]
    pub description: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogTenant {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogPrincipal {
    pub uid: String,
    pub label: String,
    pub tenant: String,
    pub roles: Vec<String>,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogAction {
    pub uid: String,
    pub label: String,
    pub resource_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogResource {
    pub uid: String,
    pub label: String,
    pub tenant: String,
    pub resource_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogContextKey {
    pub key: String,
    pub label: String,
    pub description: String,
}

/// The synthetic authorization domain: who exists, what they can attempt and
/// which request shapes make up simulated traffic.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthzCatalog {
    pub tenants: Vec<CatalogTenant>,
    pub principals: Vec<CatalogPrincipal>,
    pub actions: Vec<CatalogAction>,
    pub resources: Vec<CatalogResource>,
    pub context_keys: Vec<CatalogContextKey>,
    pub traffic_mix: Vec<RequestTemplate>,
    pub scenario_requests: Vec<RequestTemplate>,
}

impl AuthzCatalog {
    pub fn bundled() -> Result<Self, serde_json::Error> {
        serde_json::from_str(CATALOG_JSON)
    }

    /// Checks that every entity reference parses and that request ids are
    /// unique, so a mistake in a catalogue file is reported where it is
    /// rather than as a request that never matches.
    pub fn validate(&self) -> Result<(), String> {
        let uid = |what: &str, raw: &str| {
            parse_uid("uid", raw)
                .map(|_| ())
                .map_err(|_| format!("{what} `{raw}` is not a Cedar entity reference"))
        };
        for principal in &self.principals {
            uid("principal", &principal.uid)?;
        }
        for action in &self.actions {
            uid("action", &action.uid)?;
        }
        for resource in &self.resources {
            uid("resource", &resource.uid)?;
        }
        // The two lists are looked up separately, so an id only has to be
        // unique within its own.
        for (list, templates) in [
            ("trafficMix", &self.traffic_mix),
            ("scenarioRequests", &self.scenario_requests),
        ] {
            for (i, template) in templates.iter().enumerate() {
                if template.id.trim().is_empty() {
                    return Err(format!("{list} has a request with an empty id"));
                }
                if templates[..i].iter().any(|other| other.id == template.id) {
                    return Err(format!("{list} has two requests with id `{}`", template.id));
                }
                if !(template.weight.is_finite() && template.weight >= 0.0) {
                    return Err(format!(
                        "request `{}` has an invalid weight {}",
                        template.id, template.weight
                    ));
                }
                validate_request(&template.request())
                    .map_err(|e| format!("request `{}`: {e}", template.id))?;
            }
        }
        Ok(())
    }
}

/// Splits a file in Cedar's own policy syntax into policy documents.
///
/// A policy's id is its `@id("…")` annotation, or `<file>-<n>` counting from
/// one in source order; its description is its `@description("…")`
/// annotation. Templates are refused: AEGIS evaluates static policies only.
pub fn policy_documents_from_cedar(
    file: &str,
    text: &str,
) -> Result<Vec<PolicyDocument>, CedarSetupError> {
    let fail = |message: String| CedarSetupError::PolicyFile {
        file: file.to_string(),
        message,
    };
    let set = PolicySet::from_str(text).map_err(|e| fail(e.to_string()))?;
    if set.num_of_templates() > 0 {
        return Err(fail(
            "policy templates are not supported; write static policies".into(),
        ));
    }
    // The parser names policies `policy0`, `policy1`… in source order, and
    // the set does not keep that order.
    let mut policies: Vec<(usize, &Policy)> = Vec::new();
    for policy in set.policies() {
        let id = policy.id().to_string();
        let position = id
            .strip_prefix("policy")
            .and_then(|n| n.parse::<usize>().ok())
            .ok_or_else(|| fail(format!("unexpected policy id `{id}`")))?;
        policies.push((position, policy));
    }
    policies.sort_by_key(|(position, _)| *position);
    let stem = file.strip_suffix(".cedar").unwrap_or(file);
    Ok(policies
        .into_iter()
        .map(|(position, policy)| PolicyDocument {
            id: policy
                .annotation("id")
                .map_or_else(|| format!("{stem}-{}", position + 1), str::to_string),
            description: policy
                .annotation("description")
                .unwrap_or_default()
                .to_string(),
            content: policy.to_string(),
        })
        .collect())
}

/// The bundled policy documents, in cedar-agent's `PUT /v1/policies` shape.
pub fn bundled_policy_documents() -> Result<Vec<PolicyDocument>, serde_json::Error> {
    serde_json::from_str(POLICIES_JSON)
}

/// The bundled entity store, in cedar-agent's `PUT /v1/data` shape.
pub fn bundled_entities_json() -> Result<serde_json::Value, serde_json::Error> {
    serde_json::from_str(ENTITIES_JSON)
}

struct LoadedPolicy {
    info: PolicyInfo,
    policy: Policy,
}

/// Embedded Cedar policy decision point.
pub struct CedarEngine {
    policies: Vec<LoadedPolicy>,
    entities: Entities,
    /// The entity store as it was given, for a connected agent to be synced.
    entities_json: serde_json::Value,
    authorizer: Authorizer,
}

impl std::fmt::Debug for CedarEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CedarEngine")
            .field("policies", &self.policies.len())
            .finish_non_exhaustive()
    }
}

fn parse_uid(field: &'static str, raw: &str) -> Result<EntityUid, AuthzError> {
    if raw.len() > MAX_ENTITY_REF_LEN {
        return Err(AuthzError::InvalidRequest {
            field,
            message: format!("longer than {MAX_ENTITY_REF_LEN} characters"),
        });
    }
    EntityUid::from_str(raw).map_err(|_| AuthzError::InvalidRequest {
        field,
        message: format!("`{raw}` is not a Cedar entity reference such as User::\"alice\""),
    })
}

/// Checks that a request is well formed without evaluating it.
pub fn validate_request(request: &AuthorizationRequest) -> Result<(), AuthzError> {
    parse_uid("principal", &request.principal)?;
    parse_uid("action", &request.action)?;
    parse_uid("resource", &request.resource)?;
    let context_bytes = serde_json::to_vec(&request.context).map_or(usize::MAX, |v| v.len());
    if context_bytes > MAX_CONTEXT_BYTES {
        return Err(AuthzError::InvalidRequest {
            field: "context",
            message: format!("larger than {MAX_CONTEXT_BYTES} bytes"),
        });
    }
    Ok(())
}

impl CedarEngine {
    /// Engine loaded with the synthetic fixtures in `fixtures/cedar/`.
    pub fn bundled() -> Result<Self, CedarSetupError> {
        Self::new(bundled_policy_documents()?, bundled_entities_json()?)
    }

    pub fn new(
        documents: Vec<PolicyDocument>,
        entities: serde_json::Value,
    ) -> Result<Self, CedarSetupError> {
        Self::with_schema(documents, entities, None)
    }

    /// Like [`CedarEngine::new`]. When a schema (in Cedar's schema syntax)
    /// is given, the policies and the entity store must validate against it:
    /// what the Cedar validator reports is returned as the error.
    pub fn with_schema(
        documents: Vec<PolicyDocument>,
        entities: serde_json::Value,
        schema: Option<&str>,
    ) -> Result<Self, CedarSetupError> {
        if documents.len() > MAX_POLICIES {
            return Err(CedarSetupError::TooManyPolicies(documents.len()));
        }
        let mut policies: Vec<LoadedPolicy> = Vec::with_capacity(documents.len());
        for document in documents {
            let id_ok = !document.id.trim().is_empty()
                && document.id.len() <= MAX_POLICY_ID_LEN
                && !document.id.chars().any(char::is_control);
            if !id_ok {
                return Err(CedarSetupError::InvalidPolicyId(document.id));
            }
            if policies.iter().any(|p| p.info.id == document.id) {
                return Err(CedarSetupError::DuplicatePolicy(document.id));
            }
            let policy = Policy::parse(Some(PolicyId::new(&document.id)), &document.content)
                .map_err(|e| CedarSetupError::Policy {
                    id: document.id.clone(),
                    message: e.to_string(),
                })?;
            let effect = match policy.effect() {
                Effect::Permit => PolicyEffect::Permit,
                Effect::Forbid => PolicyEffect::Forbid,
            };
            policies.push(LoadedPolicy {
                info: PolicyInfo {
                    id: document.id,
                    description: document.description,
                    content: document.content,
                    effect,
                },
                policy,
            });
        }

        let schema = match schema {
            Some(text) => {
                let (schema, _warnings) = Schema::from_cedarschema_str(text)
                    .map_err(|e| CedarSetupError::Schema(e.to_string()))?;
                Some(schema)
            }
            None => None,
        };
        if let Some(schema) = &schema {
            let mut set = PolicySet::new();
            for loaded in &policies {
                set.add(loaded.policy.clone())
                    .map_err(|e| CedarSetupError::Validation(e.to_string()))?;
            }
            let result = Validator::new(schema.clone()).validate(&set, ValidationMode::Strict);
            if !result.validation_passed() {
                // Cedar's message already names the policy.
                let mut errors: Vec<String> = result
                    .validation_errors()
                    .map(ToString::to_string)
                    .collect();
                errors.sort();
                return Err(CedarSetupError::Validation(errors.join("; ")));
            }
        }
        let entities_json = entities.clone();
        let entities = Entities::from_json_value(entities, schema.as_ref())
            .map_err(|e| CedarSetupError::Entities(e.to_string()))?;
        Ok(Self {
            policies,
            entities,
            entities_json,
            authorizer: Authorizer::new(),
        })
    }

    /// The policies as documents, in cedar-agent's `PUT /v1/policies` shape.
    pub fn documents(&self) -> Vec<PolicyDocument> {
        self.policies
            .iter()
            .map(|p| PolicyDocument {
                id: p.info.id.clone(),
                description: p.info.description.clone(),
                content: p.info.content.clone(),
            })
            .collect()
    }

    /// The entity store, in cedar-agent's `PUT /v1/data` shape.
    pub fn entities_json(&self) -> &serde_json::Value {
        &self.entities_json
    }

    pub fn policies(&self) -> Vec<PolicyInfo> {
        self.policies.iter().map(|p| p.info.clone()).collect()
    }

    fn policy_set(&self, disabled: &[String]) -> Result<PolicySet, AuthzError> {
        for id in disabled {
            if !self.policies.iter().any(|p| &p.info.id == id) {
                return Err(AuthzError::UnknownPolicy(id.clone()));
            }
        }
        let mut set = PolicySet::new();
        for loaded in &self.policies {
            if disabled.contains(&loaded.info.id) {
                continue;
            }
            set.add(loaded.policy.clone())
                .map_err(|e| AuthzError::Protocol(e.to_string()))?;
        }
        Ok(set)
    }
}

impl PolicyDecisionPoint for CedarEngine {
    fn engine(&self) -> EngineInfo {
        EngineInfo {
            kind: EngineKind::EmbeddedCedar,
            version: Some(cedar_policy::get_sdk_version().to_string()),
        }
    }

    fn evaluate(
        &self,
        request: &AuthorizationRequest,
        disabled_policies: &[String],
    ) -> Result<PolicyDecision, AuthzError> {
        validate_request(request)?;
        let principal = parse_uid("principal", &request.principal)?;
        let action = parse_uid("action", &request.action)?;
        let resource = parse_uid("resource", &request.resource)?;
        let context =
            Context::from_json_value(serde_json::Value::Object(request.context.clone()), None)
                .map_err(|e| AuthzError::InvalidRequest {
                    field: "context",
                    message: e.to_string(),
                })?;
        let cedar_request =
            Request::new(principal, action, resource, context, None).map_err(|e| {
                AuthzError::InvalidRequest {
                    field: "request",
                    message: e.to_string(),
                }
            })?;
        let policies = self.policy_set(disabled_policies)?;
        let response = self
            .authorizer
            .is_authorized(&cedar_request, &policies, &self.entities);

        // Cedar reports both as unordered sets; sort for stable output.
        let mut determining: Vec<String> = response
            .diagnostics()
            .reason()
            .map(ToString::to_string)
            .collect();
        determining.sort();
        let mut errors: Vec<String> = response
            .diagnostics()
            .errors()
            .map(ToString::to_string)
            .collect();
        errors.sort();
        Ok(PolicyDecision {
            decision: match response.decision() {
                CedarDecision::Allow => Decision::Allow,
                CedarDecision::Deny => Decision::Deny,
            },
            determining_policies: determining,
            errors,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        principal: &str,
        action: &str,
        resource: &str,
        context: serde_json::Value,
    ) -> AuthorizationRequest {
        AuthorizationRequest {
            principal: format!("User::\"{principal}\""),
            action: format!("Action::\"{action}\""),
            resource: resource.to_string(),
            context: context.as_object().cloned().unwrap_or_default(),
        }
    }

    fn engine() -> CedarEngine {
        CedarEngine::bundled().expect("bundled fixtures load")
    }

    const ACME_LEDGER: &str = "Ledger::\"acme-ledger-2026\"";
    const ACME_ORDER: &str = "Order::\"acme-ord-1001\"";
    const BIG_ORDER: &str = "Order::\"acme-ord-9000\"";
    const ACME_CUSTOMER: &str = "Customer::\"acme-cust-77\"";

    #[test]
    fn reports_the_real_cedar_sdk_version() {
        let info = engine().engine();
        assert_eq!(info.kind, EngineKind::EmbeddedCedar);
        let version = info.version.expect("version known");
        assert!(version.starts_with("4."), "unexpected version {version}");
    }

    #[test]
    fn permit_is_attributed_to_the_determining_policy() {
        let decision = engine()
            .evaluate(
                &request("alice", "viewLedger", ACME_LEDGER, serde_json::json!({})),
                &[],
            )
            .expect("evaluates");
        assert_eq!(decision.decision, Decision::Allow);
        assert_eq!(decision.determining_policies, ["finance-view-ledger"]);
        assert!(decision.errors.is_empty());
    }

    #[test]
    fn default_deny_has_no_determining_policy() {
        let decision = engine()
            .evaluate(
                &request("bob", "viewLedger", ACME_LEDGER, serde_json::json!({})),
                &[],
            )
            .expect("evaluates");
        assert_eq!(decision.decision, Decision::Deny);
        assert!(decision.determining_policies.is_empty());
    }

    #[test]
    fn cross_tenant_access_is_forbidden_explicitly() {
        let decision = engine()
            .evaluate(
                &request(
                    "mallory",
                    "exportLedger",
                    ACME_LEDGER,
                    serde_json::json!({ "mfa": true }),
                ),
                &[],
            )
            .expect("evaluates");
        assert_eq!(decision.decision, Decision::Deny);
        assert_eq!(decision.determining_policies, ["forbid-cross-tenant"]);
    }

    #[test]
    fn forbid_overrides_permit_even_for_admins_of_another_tenant() {
        let decision = engine()
            .evaluate(
                &request("dave", "viewLedger", ACME_LEDGER, serde_json::json!({})),
                &[],
            )
            .expect("evaluates");
        assert_eq!(decision.decision, Decision::Deny);
        assert_eq!(decision.determining_policies, ["forbid-cross-tenant"]);
    }

    #[test]
    fn context_drives_the_decision() {
        let engine = engine();
        let with_mfa = engine
            .evaluate(
                &request(
                    "alice",
                    "exportLedger",
                    ACME_LEDGER,
                    serde_json::json!({ "mfa": true }),
                ),
                &[],
            )
            .expect("evaluates");
        assert_eq!(with_mfa.decision, Decision::Allow);
        assert_eq!(with_mfa.determining_policies, ["finance-export-ledger-mfa"]);

        let without = engine
            .evaluate(
                &request(
                    "alice",
                    "exportLedger",
                    ACME_LEDGER,
                    serde_json::json!({ "mfa": false }),
                ),
                &[],
            )
            .expect("evaluates");
        assert_eq!(without.decision, Decision::Deny);
    }

    #[test]
    fn evaluation_errors_surface_as_diagnostics() {
        // `context.mfa` is missing, so the permit policy errors while evaluating.
        let decision = engine()
            .evaluate(
                &request("alice", "exportLedger", ACME_LEDGER, serde_json::json!({})),
                &[],
            )
            .expect("evaluates");
        assert_eq!(decision.decision, Decision::Deny);
        assert_eq!(decision.errors.len(), 1);
        assert!(
            decision.errors[0].contains("finance-export-ledger-mfa"),
            "error names the policy: {}",
            decision.errors[0]
        );
    }

    #[test]
    fn attribute_conditions_are_evaluated() {
        let engine = engine();
        let small = engine
            .evaluate(
                &request("bob", "refundOrder", ACME_ORDER, serde_json::json!({})),
                &[],
            )
            .expect("evaluates");
        assert_eq!(small.decision, Decision::Allow);
        let large = engine
            .evaluate(
                &request("bob", "refundOrder", BIG_ORDER, serde_json::json!({})),
                &[],
            )
            .expect("evaluates");
        assert_eq!(large.decision, Decision::Deny);
    }

    #[test]
    fn suspended_principals_are_forbidden() {
        let decision = engine()
            .evaluate(
                &request("erin", "viewLedger", ACME_LEDGER, serde_json::json!({})),
                &[],
            )
            .expect("evaluates");
        assert_eq!(decision.decision, Decision::Deny);
        assert_eq!(decision.determining_policies, ["forbid-suspended"]);
    }

    #[test]
    fn change_window_guards_destructive_actions() {
        let engine = engine();
        let outside = engine
            .evaluate(
                &request(
                    "carol",
                    "deleteCustomer",
                    ACME_CUSTOMER,
                    serde_json::json!({}),
                ),
                &[],
            )
            .expect("evaluates");
        assert_eq!(outside.decision, Decision::Deny);
        assert_eq!(
            outside.determining_policies,
            ["forbid-destructive-outside-change-window"]
        );
        let inside = engine
            .evaluate(
                &request(
                    "carol",
                    "deleteCustomer",
                    ACME_CUSTOMER,
                    serde_json::json!({ "changeWindow": true }),
                ),
                &[],
            )
            .expect("evaluates");
        assert_eq!(inside.decision, Decision::Allow);
        assert_eq!(inside.determining_policies, ["admin-own-tenant"]);
    }

    #[test]
    fn disabling_a_policy_changes_the_outcome() {
        let engine = engine();
        let req = request("dave", "viewLedger", ACME_LEDGER, serde_json::json!({}));
        let disabled = vec!["forbid-cross-tenant".to_string()];
        let decision = engine.evaluate(&req, &disabled).expect("evaluates");
        // With tenant isolation off nothing permits it either: default deny.
        assert_eq!(decision.decision, Decision::Deny);
        assert!(decision.determining_policies.is_empty());

        assert_eq!(
            engine.evaluate(&req, &["nope".to_string()]),
            Err(AuthzError::UnknownPolicy("nope".into()))
        );
    }

    #[test]
    fn malformed_requests_are_rejected_before_evaluation() {
        let engine = engine();
        let mut bad = request("alice", "viewLedger", ACME_LEDGER, serde_json::json!({}));
        bad.principal = "not a uid".into();
        assert!(matches!(
            engine.evaluate(&bad, &[]),
            Err(AuthzError::InvalidRequest {
                field: "principal",
                ..
            })
        ));

        let mut long = request("alice", "viewLedger", ACME_LEDGER, serde_json::json!({}));
        long.resource = format!("Ledger::\"{}\"", "x".repeat(400));
        assert!(matches!(
            engine.evaluate(&long, &[]),
            Err(AuthzError::InvalidRequest {
                field: "resource",
                ..
            })
        ));
    }

    #[test]
    fn unknown_principals_are_denied() {
        let decision = engine()
            .evaluate(
                &request("nobody", "viewOrder", ACME_ORDER, serde_json::json!({})),
                &[],
            )
            .expect("evaluates");
        assert_eq!(decision.decision, Decision::Deny);
    }

    #[test]
    fn catalogue_references_only_known_policies_and_parses() {
        let catalog = AuthzCatalog::bundled().expect("catalog parses");
        assert!(catalog.principals.len() >= 5);
        let total: f64 = catalog.traffic_mix.iter().map(|t| t.weight).sum();
        assert!((total - 1.0).abs() < 1e-9, "traffic mix sums to {total}");
        let engine = engine();
        for template in catalog.traffic_mix.iter().chain(&catalog.scenario_requests) {
            engine
                .evaluate(&template.request(), &[])
                .unwrap_or_else(|e| panic!("{} evaluates: {e}", template.id));
        }
    }
}

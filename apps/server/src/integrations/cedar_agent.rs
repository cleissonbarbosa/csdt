//! Adapter for a local instance of the public `cedar-agent` project
//! (<https://github.com/cleissonbarbosa/cedar-agent>).
//!
//! Interface verified in that repository (`src/main.rs`, `src/routes/*`,
//! `src/schemas/*`, `src/authn.rs`) and against a locally built agent:
//!
//! | Request                     | Used for                                   |
//! |-----------------------------|--------------------------------------------|
//! | `GET  /v1/`                 | health check, answers `204 No Content`     |
//! | `GET  /v1/policies`         | counting the policies the agent holds      |
//! | `PUT  /v1/policies`         | optional sync of AEGIS' synthetic policies |
//! | `PUT  /v1/data`             | optional sync of AEGIS' synthetic entities |
//! | `POST /v1/is_authorized`    | evaluating an authorization request        |
//!
//! When the agent was started with `--authentication <token>` it expects the
//! token verbatim in the `Authorization` header.
//!
//! The adapter is read-only unless `AEGIS_CEDAR_AGENT_SYNC=true`, in which
//! case connecting replaces the agent's policy and data stores with the
//! synthetic AEGIS fixtures.

use std::sync::Mutex;
use std::time::Instant;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::authorization::{bundled_entities_json, bundled_policy_documents};
use crate::domain::{
    AuthorizationRequest, AuthzError, DataSource, Decision, EngineInfo, EngineKind,
    IntegrationKind, IntegrationMetric, IntegrationState, IntegrationStatus, PolicyDecision,
};

use super::guard::{validate_target, Target};
use super::{read_limited, sanitize, ConnectOutcome, ProviderError, TelemetryProvider};

pub const PROVIDER_ID: &str = "cedar-agent";
const REPOSITORY: &str = "https://github.com/cleissonbarbosa/cedar-agent";

#[derive(Clone)]
pub struct CedarAgentConfig {
    pub base_url: String,
    pub token: Option<String>,
    /// Upload AEGIS' synthetic policies and entities on connect.
    pub sync: bool,
}

impl std::fmt::Debug for CedarAgentConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print the token.
        f.debug_struct("CedarAgentConfig")
            .field("base_url", &self.base_url)
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .field("sync", &self.sync)
            .finish()
    }
}

/// Body of `POST /v1/is_authorized` (cedar-agent's `AuthorizationCall`).
#[derive(Debug, Serialize)]
struct AuthorizationCall<'a> {
    principal: &'a str,
    action: &'a str,
    resource: &'a str,
    context: &'a serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
enum AgentDecision {
    Allow,
    Deny,
}

#[derive(Debug, Deserialize)]
struct AgentDiagnostics {
    reason: Vec<String>,
    errors: Vec<String>,
}

/// Response of `POST /v1/is_authorized` (cedar-agent's `AuthorizationAnswer`).
#[derive(Debug, Deserialize)]
struct AuthorizationAnswer {
    decision: AgentDecision,
    diagnostics: AgentDiagnostics,
}

/// Entry of `PUT /v1/policies` (cedar-agent's `Policy`).
#[derive(Debug, Serialize)]
struct AgentPolicy {
    id: String,
    content: String,
}

#[derive(Debug, Default)]
struct AgentState {
    state: Option<IntegrationState>,
    last_error: Option<String>,
    policy_count: Option<usize>,
    evaluations: u64,
    last_latency_ms: Option<f64>,
    synced: bool,
}

pub struct CedarAgentProvider {
    target: Result<Option<(Target, CedarAgentConfig)>, ProviderError>,
    client: reqwest::Client,
    state: Mutex<AgentState>,
}

impl CedarAgentProvider {
    pub fn new(
        config: Option<CedarAgentConfig>,
        allowed_hosts: &[String],
        client: reqwest::Client,
    ) -> Self {
        let target = match config {
            None => Ok(None),
            Some(config) => validate_target(&config.base_url, allowed_hosts)
                .map(|target| Some((target, config))),
        };
        Self {
            target,
            client,
            state: Mutex::new(AgentState::default()),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, AgentState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn configured(&self) -> Result<&(Target, CedarAgentConfig), ProviderError> {
        match &self.target {
            Ok(Some(pair)) => Ok(pair),
            Ok(None) => Err(ProviderError::NotConfigured),
            Err(error) => Err(error.clone()),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.state().state == Some(IntegrationState::Connected)
    }

    pub fn engine(&self) -> EngineInfo {
        EngineInfo {
            kind: EngineKind::CedarAgent,
            // The agent does not report its Cedar version over HTTP.
            version: None,
        }
    }

    fn request(
        &self,
        method: reqwest::Method,
        url: String,
        token: Option<&str>,
    ) -> reqwest::RequestBuilder {
        let mut builder = self.client.request(method, url);
        if let Some(token) = token {
            builder = builder.header(reqwest::header::AUTHORIZATION, token);
        }
        builder
    }

    fn fail(&self, error: &ProviderError) {
        let mut state = self.state();
        state.state = Some(IntegrationState::Error);
        state.last_error = Some(error.to_string());
    }

    async fn try_connect(&self) -> Result<(), ProviderError> {
        let (target, config) = self.configured()?;
        let token = config.token.as_deref();

        let health = self
            .request(reqwest::Method::GET, target.url("/v1/"), token)
            .send()
            .await
            .map_err(|e| ProviderError::Unreachable(sanitize(&e)))?;
        match health.status().as_u16() {
            200..=299 => {}
            401 | 403 => {
                return Err(ProviderError::Refused(
                    "the agent rejected the configured token".into(),
                ))
            }
            other => {
                return Err(ProviderError::Protocol(format!(
                    "health check answered HTTP {other}"
                )))
            }
        }

        if config.sync {
            let policies: Vec<AgentPolicy> = bundled_policy_documents()
                .map_err(|e| ProviderError::Protocol(e.to_string()))?
                .into_iter()
                .map(|p| AgentPolicy {
                    id: p.id,
                    content: p.content,
                })
                .collect();
            let entities =
                bundled_entities_json().map_err(|e| ProviderError::Protocol(e.to_string()))?;
            for (path, body) in [
                ("/v1/policies", serde_json::json!(policies)),
                ("/v1/data", entities),
            ] {
                let response = self
                    .request(reqwest::Method::PUT, target.url(path), token)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| ProviderError::Unreachable(sanitize(&e)))?;
                if !response.status().is_success() {
                    return Err(ProviderError::Protocol(format!(
                        "PUT {path} answered HTTP {}",
                        response.status().as_u16()
                    )));
                }
            }
        }

        let response = self
            .request(reqwest::Method::GET, target.url("/v1/policies"), token)
            .send()
            .await
            .map_err(|e| ProviderError::Unreachable(sanitize(&e)))?;
        if !response.status().is_success() {
            return Err(ProviderError::Protocol(format!(
                "GET /v1/policies answered HTTP {}",
                response.status().as_u16()
            )));
        }
        let body = read_limited(response).await?;
        let policies: Vec<serde_json::Value> = serde_json::from_slice(&body)
            .map_err(|_| ProviderError::Protocol("policy list is not a JSON array".into()))?;

        let mut state = self.state();
        state.state = Some(IntegrationState::Connected);
        state.last_error = None;
        state.policy_count = Some(policies.len());
        state.synced = config.sync;
        Ok(())
    }

    /// Evaluates a request with the connected agent.
    pub async fn is_authorized(
        &self,
        request: &AuthorizationRequest,
    ) -> Result<(PolicyDecision, u64), AuthzError> {
        if !self.is_connected() {
            return Err(AuthzError::EngineUnavailable(
                "cedar-agent is not connected".into(),
            ));
        }
        let (target, config) = self
            .configured()
            .map_err(|e| AuthzError::EngineUnavailable(e.to_string()))?;
        let call = AuthorizationCall {
            principal: &request.principal,
            action: &request.action,
            resource: &request.resource,
            context: &request.context,
        };
        let started = Instant::now();
        let response = self
            .request(
                reqwest::Method::POST,
                target.url("/v1/is_authorized"),
                config.token.as_deref(),
            )
            .json(&call)
            .send()
            .await
            .map_err(|e| {
                let error = ProviderError::Unreachable(sanitize(&e));
                self.fail(&error);
                AuthzError::EngineUnavailable(error.to_string())
            })?;
        let status = response.status();
        let body = read_limited(response)
            .await
            .map_err(|e| AuthzError::Protocol(e.to_string()))?;
        let micros = started.elapsed().as_micros() as u64;
        if status.as_u16() == 400 {
            // cedar-agent answers 400 `{reason, description, code}` for
            // requests it cannot parse.
            let description = serde_json::from_slice::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| {
                    v.get("description")
                        .and_then(|d| d.as_str().map(str::to_owned))
                })
                .unwrap_or_else(|| "the agent rejected the request".into());
            return Err(AuthzError::InvalidRequest {
                field: "request",
                message: description.chars().take(300).collect(),
            });
        }
        if !status.is_success() {
            return Err(AuthzError::Protocol(format!(
                "is_authorized answered HTTP {}",
                status.as_u16()
            )));
        }
        let answer: AuthorizationAnswer = serde_json::from_slice(&body).map_err(|_| {
            AuthzError::Protocol("response does not match cedar-agent's AuthorizationAnswer".into())
        })?;
        let mut determining = answer.diagnostics.reason;
        determining.sort();
        let mut errors = answer.diagnostics.errors;
        errors.sort();

        let mut state = self.state();
        state.evaluations += 1;
        state.last_latency_ms = Some(micros as f64 / 1000.0);
        Ok((
            PolicyDecision {
                decision: match answer.decision {
                    AgentDecision::Allow => Decision::Allow,
                    AgentDecision::Deny => Decision::Deny,
                },
                determining_policies: determining,
                errors,
            },
            micros,
        ))
    }
}

#[async_trait]
impl TelemetryProvider for CedarAgentProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    async fn status(&self) -> IntegrationStatus {
        let state = self.state();
        let (derived_state, endpoint, config_error) = match &self.target {
            Ok(Some((target, _))) => (
                state.state.unwrap_or(IntegrationState::Available),
                Some(target.display()),
                None,
            ),
            Ok(None) => (IntegrationState::NotConfigured, None, None),
            Err(error) => (IntegrationState::Error, None, Some(error.to_string())),
        };
        let mut metrics = Vec::new();
        if let Some(count) = state.policy_count {
            metrics.push(IntegrationMetric {
                label: "Policies in agent".into(),
                value: count.to_string(),
            });
        }
        if state.evaluations > 0 {
            metrics.push(IntegrationMetric {
                label: "Evaluations".into(),
                value: state.evaluations.to_string(),
            });
        }
        if let Some(latency) = state.last_latency_ms {
            metrics.push(IntegrationMetric {
                label: "Last round trip".into(),
                value: format!("{latency:.2} ms"),
            });
        }
        if derived_state == IntegrationState::Connected {
            metrics.push(IntegrationMetric {
                label: "Store sync".into(),
                value: if state.synced {
                    "AEGIS fixtures uploaded".into()
                } else {
                    "read-only".into()
                },
            });
        }
        IntegrationStatus {
            id: PROVIDER_ID.into(),
            name: "Cedar Agent".into(),
            kind: IntegrationKind::LiveAdapter,
            state: derived_state,
            data_source: DataSource::Live,
            description: "Evaluates authorization requests with a local cedar-agent instance instead of the embedded engine.".into(),
            repository: Some(REPOSITORY.into()),
            verified_interface: Some(
                "GET /v1/ · GET|PUT /v1/policies · PUT /v1/data · POST /v1/is_authorized".into(),
            ),
            endpoint,
            capabilities: vec!["authorization decisions".into()],
            metrics,
            last_error: config_error.or_else(|| state.last_error.clone()),
        }
    }

    async fn connect(&self) -> Result<ConnectOutcome, ProviderError> {
        self.configured()?;
        self.state().state = Some(IntegrationState::Connecting);
        match self.try_connect().await {
            Ok(()) => Ok(ConnectOutcome::default()),
            Err(error) => {
                self.fail(&error);
                Err(error)
            }
        }
    }

    async fn disconnect(&self) -> Result<(), ProviderError> {
        self.configured()?;
        let mut state = self.state();
        *state = AgentState::default();
        Ok(())
    }
}

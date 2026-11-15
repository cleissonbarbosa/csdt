//! Adapter tests.
//!
//! The live adapters are exercised against in-process doubles that implement
//! exactly the interface verified in the public repositories, and (when
//! `AEGIS_TEST_CEDAR_AGENT_BIN` points at a locally built binary) against the
//! real `cedar-agent`.
#![allow(clippy::unwrap_used)]

mod common;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aegis_server::authorization::{
    bundled_entities_json, bundled_policy_documents, AuthzCatalog, CedarEngine, PolicyDocument,
};
use aegis_server::domain::{
    AuthorizationRequest, AuthzError, Decision, IntegrationState, PolicyDecisionPoint,
};
use aegis_server::integrations::{
    http_client, CedarAgentConfig, CedarAgentProvider, ProviderError, RinhaConfig,
    RinhaProbeProvider, TelemetryProvider,
};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use common::{dead_port, get as http_get, post as http_post, serve_router, state_with};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// A double of cedar-agent's HTTP interface
// ---------------------------------------------------------------------------

#[derive(Default)]
struct AgentDouble {
    token: Option<String>,
    policies: Mutex<Vec<PolicyDocument>>,
    entities: Mutex<Value>,
    writes: AtomicU64,
    checks: AtomicU64,
    /// When set, `is_authorized` answers with this body instead.
    canned_answer: Mutex<Option<(StatusCode, String)>>,
    delay: Mutex<Duration>,
}

type Agent = Arc<AgentDouble>;

fn authorised(agent: &AgentDouble, headers: &HeaderMap) -> bool {
    // cedar-agent compares the Authorization header with the token verbatim.
    match &agent.token {
        None => true,
        Some(token) => headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v == token),
    }
}

async fn agent_health(State(agent): State<Agent>, headers: HeaderMap) -> StatusCode {
    if authorised(&agent, &headers) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::UNAUTHORIZED
    }
}

async fn agent_get_policies(State(agent): State<Agent>, headers: HeaderMap) -> impl IntoResponse {
    if !authorised(&agent, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let policies: Vec<Value> = agent
        .policies
        .lock()
        .unwrap()
        .iter()
        .map(|p| json!({ "id": p.id, "content": p.content }))
        .collect();
    Json(policies).into_response()
}

async fn agent_put_policies(
    State(agent): State<Agent>,
    headers: HeaderMap,
    Json(body): Json<Vec<Value>>,
) -> impl IntoResponse {
    if !authorised(&agent, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    agent.writes.fetch_add(1, Ordering::SeqCst);
    let policies = body
        .iter()
        .map(|p| PolicyDocument {
            id: p["id"].as_str().unwrap_or_default().to_string(),
            description: String::new(),
            content: p["content"].as_str().unwrap_or_default().to_string(),
        })
        .collect();
    *agent.policies.lock().unwrap() = policies;
    Json(body).into_response()
}

async fn agent_put_data(
    State(agent): State<Agent>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if !authorised(&agent, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    agent.writes.fetch_add(1, Ordering::SeqCst);
    *agent.entities.lock().unwrap() = body.clone();
    Json(body).into_response()
}

async fn agent_is_authorized(
    State(agent): State<Agent>,
    headers: HeaderMap,
    Json(call): Json<Value>,
) -> impl IntoResponse {
    if !authorised(&agent, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    agent.checks.fetch_add(1, Ordering::SeqCst);
    let delay = *agent.delay.lock().unwrap();
    if !delay.is_zero() {
        tokio::time::sleep(delay).await;
    }
    if let Some((status, body)) = agent.canned_answer.lock().unwrap().clone() {
        return (status, body).into_response();
    }
    // Evaluate with a real Cedar engine over whatever was stored, like the agent.
    let engine = match CedarEngine::new(
        agent.policies.lock().unwrap().clone(),
        agent.entities.lock().unwrap().clone(),
    ) {
        Ok(engine) => engine,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let request = AuthorizationRequest {
        principal: call["principal"].as_str().unwrap_or_default().to_string(),
        action: call["action"].as_str().unwrap_or_default().to_string(),
        resource: call["resource"].as_str().unwrap_or_default().to_string(),
        context: call["context"].as_object().cloned().unwrap_or_default(),
    };
    match engine.evaluate(&request, &[]) {
        Ok(decision) => Json(json!({
            "decision": if decision.decision == Decision::Allow { "Allow" } else { "Deny" },
            "diagnostics": {
                "reason": decision.determining_policies,
                "errors": decision.errors,
            },
        }))
        .into_response(),
        // The shape cedar-agent answers with for unparsable requests.
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "reason": "You have malformed a bad request",
                "description": format!("The content in the request does not match the specifications: {error}"),
                "code": 400,
            })),
        )
            .into_response(),
    }
}

async fn spawn_agent(agent: Agent) -> String {
    let router = Router::new()
        .route("/v1/", get(agent_health))
        .route(
            "/v1/policies",
            get(agent_get_policies).put(agent_put_policies),
        )
        .route("/v1/data", put(agent_put_data))
        .route("/v1/is_authorized", post(agent_is_authorized))
        .with_state(agent);
    format!("http://{}", serve_router(router).await)
}

fn preloaded_agent(token: Option<&str>) -> Agent {
    Arc::new(AgentDouble {
        token: token.map(str::to_string),
        policies: Mutex::new(bundled_policy_documents().unwrap()),
        entities: Mutex::new(bundled_entities_json().unwrap()),
        ..AgentDouble::default()
    })
}

fn provider(base_url: &str, token: Option<&str>, sync: bool) -> CedarAgentProvider {
    CedarAgentProvider::new(
        Some(CedarAgentConfig {
            base_url: base_url.to_string(),
            token: token.map(str::to_string),
            sync,
        }),
        &[],
        http_client().unwrap(),
    )
}

fn ledger_request(principal: &str, action: &str) -> AuthorizationRequest {
    AuthorizationRequest {
        principal: format!("User::\"{principal}\""),
        action: format!("Action::\"{action}\""),
        resource: "Ledger::\"acme-ledger-2026\"".to_string(),
        context: serde_json::Map::new(),
    }
}

// ---------------------------------------------------------------------------
// cedar-agent adapter
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cedar_agent_is_opt_in_and_refuses_non_local_targets() {
    let unconfigured = CedarAgentProvider::new(None, &[], http_client().unwrap());
    assert_eq!(
        unconfigured.status().await.state,
        IntegrationState::NotConfigured
    );
    assert_eq!(
        unconfigured.connect().await,
        Err(ProviderError::NotConfigured)
    );
    assert!(!unconfigured.is_connected());

    for target in [
        "http://example.com:8180",
        "http://10.1.2.3:8180",
        "http://169.254.169.254",
        "http://token@127.0.0.1:8180",
    ] {
        let remote = provider(target, None, false);
        let status = remote.status().await;
        assert_eq!(status.state, IntegrationState::Error, "{target}");
        assert_eq!(
            status.endpoint, None,
            "a refused target is never echoed as an endpoint"
        );
        assert!(matches!(
            remote.connect().await,
            Err(ProviderError::Refused(_))
        ));
    }
}

#[tokio::test]
async fn cedar_agent_connects_read_only_by_default() {
    let agent = preloaded_agent(None);
    let base = spawn_agent(Arc::clone(&agent)).await;
    let provider = provider(&base, None, false);
    assert_eq!(provider.status().await.state, IntegrationState::Available);

    provider.connect().await.expect("connects");
    assert!(provider.is_connected());
    assert_eq!(
        agent.writes.load(Ordering::SeqCst),
        0,
        "no store was modified"
    );
    let status = provider.status().await;
    assert_eq!(status.state, IntegrationState::Connected);
    assert_eq!(status.endpoint.as_deref(), Some(base.as_str()));
    assert!(status
        .metrics
        .iter()
        .any(|m| m.label == "Policies in agent" && m.value == "9"));
    assert!(status
        .metrics
        .iter()
        .any(|m| m.label == "Store sync" && m.value == "read-only"));

    provider.disconnect().await.expect("disconnects");
    assert!(!provider.is_connected());
    assert!(matches!(
        provider
            .is_authorized(&ledger_request("alice", "viewLedger"))
            .await,
        Err(AuthzError::EngineUnavailable(_))
    ));
}

#[tokio::test]
async fn cedar_agent_sync_uploads_the_synthetic_fixtures() {
    let agent = Arc::new(AgentDouble::default());
    let base = spawn_agent(Arc::clone(&agent)).await;
    let provider = provider(&base, None, true);
    provider.connect().await.expect("connects");
    assert_eq!(agent.writes.load(Ordering::SeqCst), 2, "policies and data");
    assert_eq!(agent.policies.lock().unwrap().len(), 9);
    assert!(agent.entities.lock().unwrap().as_array().unwrap().len() > 20);
}

#[tokio::test]
async fn cedar_agent_decisions_match_the_embedded_engine_for_every_request_shape() {
    let agent = preloaded_agent(None);
    let base = spawn_agent(Arc::clone(&agent)).await;
    let provider = provider(&base, None, false);
    provider.connect().await.expect("connects");

    let embedded = CedarEngine::bundled().unwrap();
    let catalog = AuthzCatalog::bundled().unwrap();
    let mut allowed = 0;
    for template in catalog.traffic_mix.iter().chain(&catalog.scenario_requests) {
        let request = template.request();
        let (remote, micros) = provider.is_authorized(&request).await.expect("evaluates");
        let local = embedded.evaluate(&request, &[]).unwrap();
        assert_eq!(remote, local, "request `{}`", template.id);
        assert!(micros > 0);
        allowed += usize::from(remote.decision == Decision::Allow);
    }
    assert!(allowed > 0, "the mix contains permitted requests");
    assert_eq!(
        agent.checks.load(Ordering::SeqCst) as usize,
        catalog.traffic_mix.len() + catalog.scenario_requests.len()
    );
    assert!(provider
        .status()
        .await
        .metrics
        .iter()
        .any(|m| m.label == "Evaluations"));
}

#[tokio::test]
async fn cedar_agent_token_is_sent_verbatim_and_wrong_tokens_are_reported() {
    let agent = preloaded_agent(Some("s3cret-token"));
    let base = spawn_agent(Arc::clone(&agent)).await;

    let wrong = provider(&base, Some("nope"), false);
    assert!(matches!(
        wrong.connect().await,
        Err(ProviderError::Refused(_))
    ));
    let status = wrong.status().await;
    assert_eq!(status.state, IntegrationState::Error);
    let rendered = serde_json::to_string(&status).unwrap();
    assert!(
        !rendered.contains("nope"),
        "tokens never appear in a status"
    );

    let right = provider(&base, Some("s3cret-token"), false);
    right
        .connect()
        .await
        .expect("connects with the right token");
    let (decision, _) = right
        .is_authorized(&ledger_request("alice", "viewLedger"))
        .await
        .expect("evaluates");
    assert_eq!(decision.decision, Decision::Allow);
    assert!(!serde_json::to_string(&right.status().await)
        .unwrap()
        .contains("s3cret-token"));
}

#[tokio::test]
async fn cedar_agent_failures_are_typed_and_never_fabricate_a_decision() {
    // Nothing listening.
    let dead = provider(
        &format!("http://127.0.0.1:{}", dead_port().await),
        None,
        false,
    );
    assert!(matches!(
        dead.connect().await,
        Err(ProviderError::Unreachable(_))
    ));
    assert_eq!(dead.status().await.state, IntegrationState::Error);
    assert!(dead.status().await.last_error.is_some());

    let agent = preloaded_agent(None);
    let base = spawn_agent(Arc::clone(&agent)).await;
    let provider = provider(&base, None, false);
    provider.connect().await.expect("connects");
    let request = ledger_request("alice", "viewLedger");

    // A response that is not an AuthorizationAnswer.
    for body in [
        "not json",
        "{}",
        r#"{"decision":"Maybe","diagnostics":{"reason":[],"errors":[]}}"#,
        r#"{"decision":"Allow"}"#,
    ] {
        *agent.canned_answer.lock().unwrap() = Some((StatusCode::OK, body.to_string()));
        assert!(
            matches!(
                provider.is_authorized(&request).await,
                Err(AuthzError::Protocol(_))
            ),
            "{body}"
        );
    }
    // A server error.
    *agent.canned_answer.lock().unwrap() =
        Some((StatusCode::INTERNAL_SERVER_ERROR, "boom".to_string()));
    assert!(matches!(
        provider.is_authorized(&request).await,
        Err(AuthzError::Protocol(_))
    ));
    // The agent's own 400 for an unparsable request.
    *agent.canned_answer.lock().unwrap() = None;
    let mut malformed = request.clone();
    malformed.principal = "not a uid".to_string();
    assert!(matches!(
        provider.is_authorized(&malformed).await,
        Err(AuthzError::InvalidRequest { .. })
    ));

    // A response slower than the adapter timeout.
    *agent.delay.lock().unwrap() = Duration::from_millis(2600);
    let started = std::time::Instant::now();
    let timed_out = provider.is_authorized(&request).await;
    assert!(matches!(timed_out, Err(AuthzError::EngineUnavailable(_))));
    assert!(
        started.elapsed() < Duration::from_millis(2500),
        "timeout is enforced"
    );
    assert_eq!(provider.status().await.state, IntegrationState::Error);
    assert!(
        !provider.is_connected(),
        "a failed agent is no longer offered"
    );
}

#[tokio::test]
async fn cedar_agent_can_be_selected_as_the_engine_through_the_api() {
    let agent = preloaded_agent(None);
    let base = spawn_agent(Arc::clone(&agent)).await;
    let state = state_with(&[("AEGIS_CEDAR_AGENT_URL", &base)]);
    let body = json!({
        "principal": "User::\"mallory\"",
        "action": "Action::\"exportLedger\"",
        "resource": "Ledger::\"acme-ledger-2026\"",
        "context": { "mfa": true },
        "engine": "cedar-agent",
    });

    // Configured is not connected: nothing has been contacted yet.
    let early = http_post(&state, "/api/v1/demo/authorization/evaluate", body.clone()).await;
    assert_eq!(early.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(agent.checks.load(Ordering::SeqCst), 0);

    let connected = http_post(&state, "/api/v1/providers/cedar-agent/connect", json!({})).await;
    assert_eq!(connected.status, StatusCode::OK);
    let catalog = http_get(&state, "/api/v1/demo/authorization/catalog").await;
    assert_eq!(catalog.body["engines"][1]["available"], true);

    let decided = http_post(&state, "/api/v1/demo/authorization/evaluate", body.clone()).await;
    assert_eq!(decided.status, StatusCode::OK);
    assert_eq!(decided.body["decision"], "deny");
    assert_eq!(
        decided.body["determiningPolicies"],
        json!(["forbid-cross-tenant"])
    );
    assert_eq!(decided.body["engine"]["kind"], "cedar-agent");
    assert_eq!(decided.body["engine"]["version"], Value::Null);
    assert_eq!(decided.body["dataSource"], "live");
    assert_eq!(decided.body["blockedAt"], "use-cedar");
    assert_eq!(agent.checks.load(Ordering::SeqCst), 1);

    // Policy toggling is an embedded-engine feature only.
    let mut toggled = body;
    toggled["disabledPolicies"] = json!(["forbid-cross-tenant"]);
    let refused = http_post(&state, "/api/v1/demo/authorization/evaluate", toggled).await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST);
    assert_eq!(agent.checks.load(Ordering::SeqCst), 1);
}

/// Runs only when a locally built `cedar-agent` binary is supplied:
/// `AEGIS_TEST_CEDAR_AGENT_BIN=/path/to/cedar-agent cargo test --test integrations`.
#[tokio::test]
async fn real_cedar_agent_agrees_with_the_embedded_engine() {
    let Ok(binary) = std::env::var("AEGIS_TEST_CEDAR_AGENT_BIN") else {
        eprintln!("skipped: AEGIS_TEST_CEDAR_AGENT_BIN is not set");
        return;
    };
    let port = dead_port().await;
    let mut child = tokio::process::Command::new(binary)
        .args(["--port", &port.to_string(), "--addr", "127.0.0.1"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("cedar-agent starts");
    let provider = provider(&format!("http://127.0.0.1:{port}"), None, true);
    let mut connected = false;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if provider.connect().await.is_ok() {
            connected = true;
            break;
        }
    }
    assert!(
        connected,
        "connected to the real agent and synced the fixtures"
    );

    let embedded = CedarEngine::bundled().unwrap();
    let catalog = AuthzCatalog::bundled().unwrap();
    for template in catalog.traffic_mix.iter().chain(&catalog.scenario_requests) {
        let request = template.request();
        let (remote, _) = provider.is_authorized(&request).await.expect("evaluates");
        let local = embedded.evaluate(&request, &[]).unwrap();
        assert_eq!(
            remote.decision, local.decision,
            "decision for `{}`",
            template.id
        );
        assert_eq!(
            remote.determining_policies, local.determining_policies,
            "determining policies for `{}`",
            template.id
        );
        // Error *text* legitimately differs between Cedar releases; the
        // presence of an evaluation error must not.
        assert_eq!(
            remote.errors.is_empty(),
            local.errors.is_empty(),
            "errors for `{}`",
            template.id
        );
    }
    let _ = child.kill().await;
}

// ---------------------------------------------------------------------------
// rinha-backend adapter
// ---------------------------------------------------------------------------

#[derive(Default)]
struct RinhaDouble {
    ready: Mutex<Option<Value>>,
    probes: AtomicU64,
    other_requests: AtomicU64,
}

async fn spawn_rinha(double: Arc<RinhaDouble>) -> String {
    async fn ready(State(double): State<Arc<RinhaDouble>>) -> impl IntoResponse {
        double.probes.fetch_add(1, Ordering::SeqCst);
        match double.ready.lock().unwrap().clone() {
            Some(body) => Json(body).into_response(),
            None => StatusCode::SERVICE_UNAVAILABLE.into_response(),
        }
    }
    async fn anything_else(State(double): State<Arc<RinhaDouble>>) -> StatusCode {
        double.other_requests.fetch_add(1, Ordering::SeqCst);
        StatusCode::OK
    }
    let router = Router::new()
        .route("/ready", get(ready))
        .fallback(anything_else)
        .with_state(double);
    format!("http://{}", serve_router(router).await)
}

fn rinha(base_url: &str) -> RinhaProbeProvider {
    RinhaProbeProvider::new(
        Some(RinhaConfig {
            base_url: base_url.to_string(),
            probe_interval: Duration::from_secs(1),
        }),
        &[],
        http_client().unwrap(),
    )
}

#[tokio::test]
async fn rinha_probe_reports_only_what_it_measures_and_never_sends_load() {
    let unconfigured = RinhaProbeProvider::new(None, &[], http_client().unwrap());
    assert_eq!(
        unconfigured.connect().await,
        Err(ProviderError::NotConfigured)
    );

    let double = Arc::new(RinhaDouble::default());
    *double.ready.lock().unwrap() = Some(json!({ "ready": true }));
    let base = spawn_rinha(Arc::clone(&double)).await;
    let provider = rinha(&base);
    assert!(
        provider.status().await.metrics.is_empty(),
        "no figures before measuring"
    );

    provider.connect().await.expect("ready instance connects");
    let status = provider.status().await;
    assert_eq!(status.state, IntegrationState::Connected);
    assert_eq!(status.data_source, aegis_server::domain::DataSource::Live);
    let probes = status
        .metrics
        .iter()
        .find(|m| m.label == "Readiness probes")
        .expect("probe count");
    assert_eq!(probes.value, "1 of 1 succeeded");
    assert!(status
        .metrics
        .iter()
        .all(|m| !m.label.to_lowercase().contains("throughput")));

    // The background probe respects the one-second floor.
    tokio::time::sleep(Duration::from_millis(1300)).await;
    let seen = double.probes.load(Ordering::SeqCst);
    assert!((2..=3).contains(&seen), "{seen} probes in 1.3 s");
    assert_eq!(
        double.other_requests.load(Ordering::SeqCst),
        0,
        "only GET /ready is ever requested"
    );

    provider.disconnect().await.expect("disconnects");
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert_eq!(
        double.probes.load(Ordering::SeqCst),
        seen,
        "probing stops on disconnect"
    );
    assert_eq!(provider.status().await.state, IntegrationState::Available);
}

#[tokio::test]
async fn rinha_probe_surfaces_unready_and_unreachable_instances() {
    let double = Arc::new(RinhaDouble::default());
    let base = spawn_rinha(Arc::clone(&double)).await;

    // 503 until the dataset is loaded.
    let provider = rinha(&base);
    assert!(matches!(
        provider.connect().await,
        Err(ProviderError::Protocol(_))
    ));
    assert_eq!(provider.status().await.state, IntegrationState::Error);

    // `{"ready": false}` and unexpected bodies are not treated as ready.
    for body in [
        json!({ "ready": false }),
        json!({ "status": "ok" }),
        json!("ready"),
    ] {
        *double.ready.lock().unwrap() = Some(body.clone());
        let provider = rinha(&base);
        assert!(
            matches!(provider.connect().await, Err(ProviderError::Protocol(_))),
            "{body}"
        );
        provider.disconnect().await.unwrap();
    }

    // The instance comes up later: the background probe notices by itself.
    *double.ready.lock().unwrap() = Some(json!({ "ready": true }));
    let mut recovered = false;
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if provider.status().await.state == IntegrationState::Connected {
            recovered = true;
            break;
        }
    }
    assert!(recovered, "reconnects without operator action");
    provider.disconnect().await.unwrap();

    let dead = rinha(&format!("http://127.0.0.1:{}", dead_port().await));
    assert!(matches!(
        dead.connect().await,
        Err(ProviderError::Unreachable(_))
    ));
    dead.disconnect().await.unwrap();
}

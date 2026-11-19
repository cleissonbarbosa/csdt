use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use std::sync::Arc;

use crate::application::access;
use crate::application::diff::{compare, Diff};
use crate::application::experiment::{Experiment, Trial};
use crate::application::platforms::PlatformComparison;
use crate::application::session::SessionExport;
use crate::application::{ControlAction, EvaluateEngine, EvaluateInput, Loaded, ResetScope};
use crate::authorization::{
    CatalogAction, CatalogContextKey, CatalogPrincipal, CatalogResource, CatalogTenant,
};
use crate::domain::{
    AccessMatrix, AuthorizationDecision, AuthorizationExplanation, AuthorizationRequest,
    AuthzError, DataSource, EngineInfo, EngineKind, Incident, IncidentReport, IntegrationStatus,
    MetricsReport, PlaybackState, PolicyDecisionPoint, PolicyInfo, RecordingSummary, Scenario,
    SecurityEvent, Severity, Topology, TopologySummary, WorkspaceCheck, WorkspaceOrigin,
    WorkspaceProblem, WorkspaceStatus, SCHEMA_VERSION,
};
use crate::incidents::recordings::Recording;
use crate::incidents::Effect;
use crate::workspace::{bundle_of, from_files, Bundle, SourceFile};

use super::error::ApiError;
use super::AppState;
use crate::application::PROTOCOL_VERSION;

type ApiResult<T> = Result<Json<T>, ApiError>;

/// Longest identifier accepted in a path or query parameter.
const MAX_ID_LEN: usize = 128;
const DEFAULT_EVENT_LIMIT: usize = 200;
const MAX_EVENT_LIMIT: usize = 1000;

/// Runs CPU-bound work where it does not hold up other requests: on the
/// blocking pool of the server. The in-browser engine has one thread and one
/// caller, so there it simply runs, as it does when the same engine is driven
/// natively without a runtime (its tests).
#[cfg(not(target_arch = "wasm32"))]
async fn off_the_workers<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, ()> {
    match tokio::runtime::Handle::try_current() {
        Ok(runtime) => runtime.spawn_blocking(work).await.map_err(|_| ()),
        Err(_) => Ok(work()),
    }
}

#[cfg(target_arch = "wasm32")]
async fn off_the_workers<T>(work: impl FnOnce() -> T) -> Result<T, ()> {
    Ok(work())
}

fn check_id(kind: &str, id: &str) -> Result<(), ApiError> {
    let valid = !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.' | b'>'));
    if valid {
        Ok(())
    } else {
        Err(ApiError::bad_request(format!("invalid {kind}")))
    }
}

// -- reads ------------------------------------------------------------------

pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let playback = state.service.playback();
    Json(json!({
        "status": "ok",
        "service": "aegis-server",
        "version": env!("CARGO_PKG_VERSION"),
        "schemaVersion": SCHEMA_VERSION,
        "protocolVersion": PROTOCOL_VERSION,
        "mode": "demo",
        "uptimeSeconds": state.started.elapsed().as_secs(),
        "topologyId": state.service.topology_id(),
        "tick": playback.tick,
        "authorizationEngine": state.service.assets().cedar.engine(),
    }))
}

pub async fn topology(State(state): State<AppState>) -> Json<Topology> {
    Json(state.service.topology())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologiesResponse {
    active_id: String,
    topologies: Vec<TopologySummary>,
}

pub async fn topologies(State(state): State<AppState>) -> Json<TopologiesResponse> {
    Json(TopologiesResponse {
        active_id: state.service.topology_id(),
        topologies: state.service.topologies(),
    })
}

pub async fn metrics(State(state): State<AppState>) -> Json<MetricsReport> {
    Json(state.service.metrics())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventsQuery {
    #[serde(default)]
    after_seq: u64,
    limit: Option<usize>,
    node_id: Option<String>,
    min_severity: Option<Severity>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsResponse {
    schema_version: &'static str,
    events: Vec<SecurityEvent>,
    playback: PlaybackState,
}

pub async fn events(
    State(state): State<AppState>,
    query: Result<Query<EventsQuery>, QueryRejection>,
) -> ApiResult<EventsResponse> {
    let Query(query) = query?;
    if let Some(node_id) = &query.node_id {
        check_id("nodeId", node_id)?;
    }
    let limit = query
        .limit
        .unwrap_or(DEFAULT_EVENT_LIMIT)
        .clamp(1, MAX_EVENT_LIMIT);
    Ok(Json(EventsResponse {
        schema_version: SCHEMA_VERSION,
        events: state.service.events(
            query.after_seq,
            limit,
            query.node_id.as_deref(),
            query.min_severity,
        ),
        playback: state.service.playback(),
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentsResponse {
    schema_version: &'static str,
    incidents: Vec<Incident>,
}

pub async fn incidents(State(state): State<AppState>) -> Json<IncidentsResponse> {
    Json(IncidentsResponse {
        schema_version: SCHEMA_VERSION,
        incidents: state.service.incidents(),
    })
}

/// One incident of the timeline in use, read back from its record: where it
/// began, what the scenario prescribed, what followed in the model and how
/// it ended.
pub async fn incident_report(
    State(state): State<AppState>,
    id: Result<Path<String>, PathRejection>,
) -> ApiResult<IncidentReport> {
    let Path(id) = id?;
    check_id("incident id", &id)?;
    Ok(Json(state.service.incident_report(&id)?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenariosResponse {
    scenarios: Vec<Scenario>,
    active_scenario_id: Option<String>,
}

pub async fn scenarios(State(state): State<AppState>) -> Json<ScenariosResponse> {
    let snapshot = state.service.snapshot();
    Json(ScenariosResponse {
        scenarios: state.service.scenarios(),
        active_scenario_id: snapshot.incident.map(|i| i.scenario_id),
    })
}

pub async fn recordings(State(state): State<AppState>) -> Json<Vec<RecordingSummary>> {
    Json(state.service.recordings())
}

pub async fn providers(State(state): State<AppState>) -> Json<Vec<IntegrationStatus>> {
    Json(state.providers.statuses().await)
}

// -- providers --------------------------------------------------------------

pub async fn provider_connect(
    State(state): State<AppState>,
    id: Result<Path<String>, PathRejection>,
) -> ApiResult<Vec<IntegrationStatus>> {
    let Path(id) = id?;
    check_id("provider id", &id)?;
    state.providers.get(&id)?.connect().await?;
    Ok(Json(state.providers.statuses().await))
}

pub async fn provider_disconnect(
    State(state): State<AppState>,
    id: Result<Path<String>, PathRejection>,
) -> ApiResult<Vec<IntegrationStatus>> {
    let Path(id) = id?;
    check_id("provider id", &id)?;
    state.providers.get(&id)?.disconnect().await?;
    Ok(Json(state.providers.statuses().await))
}

// -- simulation control -----------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartScenarioBody {
    scenario_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResponse {
    playback: PlaybackState,
}

pub async fn scenario_start(
    State(state): State<AppState>,
    body: Result<Json<StartScenarioBody>, JsonRejection>,
) -> ApiResult<ControlResponse> {
    let Json(body) = body?;
    check_id("scenarioId", &body.scenario_id)?;
    let playback = state.service.start_scenario(&body.scenario_id)?;
    Ok(Json(ControlResponse { playback }))
}

/// A fault to place by hand: one effect, in the format a scenario phase
/// writes it in.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InjectFaultBody {
    effect: Effect,
    #[serde(default)]
    ramp_ms: u64,
}

pub async fn fault_inject(
    State(state): State<AppState>,
    body: Result<Json<InjectFaultBody>, JsonRejection>,
) -> ApiResult<ControlResponse> {
    let Json(body) = body?;
    let playback = state.service.inject_fault(body.effect, body.ramp_ms)?;
    Ok(Json(ControlResponse { playback }))
}

/// Which faults to lift: what `effect` touches, or with none, all of them.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearFaultsBody {
    #[serde(default)]
    effect: Option<Effect>,
}

pub async fn fault_clear(
    State(state): State<AppState>,
    body: Result<Json<ClearFaultsBody>, JsonRejection>,
) -> ApiResult<ControlResponse> {
    let Json(body) = body?;
    let playback = state.service.clear_faults(body.effect)?;
    Ok(Json(ControlResponse { playback }))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResetBody {
    #[serde(default)]
    scope: ResetScope,
}

pub async fn scenario_reset(
    State(state): State<AppState>,
    body: axum::body::Bytes,
) -> ApiResult<ControlResponse> {
    // The body is optional: an empty request resets the whole simulation.
    let scope = if body.iter().all(u8::is_ascii_whitespace) {
        ResetScope::default()
    } else {
        serde_json::from_slice::<ResetBody>(&body)
            .map_err(|e| ApiError::bad_request(format!("invalid reset request: {e}")))?
            .scope
    };
    let playback = state.service.reset(scope)?;
    Ok(Json(ControlResponse { playback }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlKind {
    Play,
    Pause,
    Step,
    Seek,
    SetSpeed,
    Replay,
    Live,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlBody {
    action: ControlKind,
    to_ms: Option<u64>,
    speed: Option<f64>,
}

impl ControlBody {
    /// Each action accepts exactly the parameters it needs and no others.
    fn into_action(self) -> Result<ControlAction, ApiError> {
        let plain = |action: ControlAction| {
            if self.to_ms.is_some() || self.speed.is_some() {
                Err(ApiError::bad_request("this action takes no parameters"))
            } else {
                Ok(action)
            }
        };
        match self.action {
            ControlKind::Play => plain(ControlAction::Play),
            ControlKind::Pause => plain(ControlAction::Pause),
            ControlKind::Step => plain(ControlAction::Step),
            ControlKind::Replay => plain(ControlAction::Replay),
            ControlKind::Live => plain(ControlAction::Live),
            ControlKind::Seek => match (self.to_ms, self.speed) {
                (Some(to_ms), None) => Ok(ControlAction::Seek { to_ms }),
                _ => Err(ApiError::bad_request(
                    "seek requires `toMs` and nothing else",
                )),
            },
            ControlKind::SetSpeed => match (self.speed, self.to_ms) {
                (Some(speed), None) if speed.is_finite() => Ok(ControlAction::SetSpeed { speed }),
                _ => Err(ApiError::bad_request(
                    "setSpeed requires a finite `speed` and nothing else",
                )),
            },
        }
    }
}

pub async fn playback_control(
    State(state): State<AppState>,
    body: Result<Json<ControlBody>, JsonRejection>,
) -> ApiResult<ControlResponse> {
    let Json(body) = body?;
    let playback = state.service.control(body.into_action()?)?;
    Ok(Json(ControlResponse { playback }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectTopologyBody {
    topology_id: String,
}

pub async fn topology_select(
    State(state): State<AppState>,
    body: Result<Json<SelectTopologyBody>, JsonRejection>,
) -> ApiResult<ControlResponse> {
    let Json(body) = body?;
    check_id("topologyId", &body.topology_id)?;
    let playback = state.service.select_topology(&body.topology_id)?;
    Ok(Json(ControlResponse { playback }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadRecordingBody {
    recording_id: String,
}

pub async fn recording_load(
    State(state): State<AppState>,
    body: Result<Json<LoadRecordingBody>, JsonRejection>,
) -> ApiResult<ControlResponse> {
    let Json(body) = body?;
    check_id("recordingId", &body.recording_id)?;
    let service = state.service.clone();
    // Re-simulating a recording is CPU work; keep it off the async workers.
    let playback = off_the_workers(move || service.load_recording(&body.recording_id))
        .await
        .map_err(|()| internal("recording could not be loaded"))??;
    Ok(Json(ControlResponse { playback }))
}

// -- sessions and experiments -----------------------------------------------

/// The timeline in use as a seed and a command list: what reproduces it.
pub async fn session(State(state): State<AppState>) -> Json<SessionExport> {
    Json(state.service.session())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadSessionBody {
    recording: Recording,
    /// Where to put the cursor. With one, the timeline waits there, paused.
    cursor_ms: Option<u64>,
}

/// Replaces the timeline with the one a session describes. It is simulated
/// again from its seed and commands: nothing in the body states an outcome.
pub async fn session_load(
    State(state): State<AppState>,
    body: Result<Json<LoadSessionBody>, JsonRejection>,
) -> ApiResult<ControlResponse> {
    let Json(body) = body?;
    let service = state.service.clone();
    let playback = off_the_workers(move || service.load_session(&body.recording, body.cursor_ms))
        .await
        .map_err(|()| internal("the session could not be loaded"))??;
    Ok(Json(ControlResponse { playback }))
}

/// The one thing the second run of a comparison does differently.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InterventionBody {
    effect: Effect,
    /// When to place it, counted from the start of the incident.
    at_ms: u64,
    #[serde(default)]
    ramp_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompareBody {
    scenario_id: String,
    intervention: InterventionBody,
}

/// Runs a scenario twice with the same seed, once as it is and once with
/// one fault placed, and reports both. The timeline in use is not touched.
pub async fn experiment_compare(
    State(state): State<AppState>,
    body: Result<Json<CompareBody>, JsonRejection>,
) -> ApiResult<Experiment> {
    let Json(body) = body?;
    check_id("scenarioId", &body.scenario_id)?;
    let service = state.service.clone();
    let experiment = off_the_workers(move || {
        service.compare_intervention(
            &body.scenario_id,
            body.intervention.effect,
            body.intervention.at_ms,
            body.intervention.ramp_ms,
        )
    })
    .await
    .map_err(|()| internal("the comparison could not be run"))??;
    Ok(Json(experiment))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrialBody {
    effect: Effect,
    #[serde(default)]
    ramp_ms: u64,
}

/// Tries one fault on the platform at rest and reports what the engine
/// recorded: which services left normal, in what order, and how far the
/// platform's figures went. The timeline in use is not touched.
pub async fn experiment_trial(
    State(state): State<AppState>,
    body: Result<Json<TrialBody>, JsonRejection>,
) -> ApiResult<Trial> {
    let Json(body) = body?;
    let service = state.service.clone();
    let trial = off_the_workers(move || service.try_fault(body.effect, body.ramp_ms))
        .await
        .map_err(|()| internal("the trial could not be run"))??;
    Ok(Json(trial))
}

// -- workspace --------------------------------------------------------------

pub async fn workspace(State(state): State<AppState>) -> Json<WorkspaceStatus> {
    Json(state.service.loaded().status(state.config.import_enabled))
}

/// The files in use as one bundle, to save, edit and import again.
pub async fn workspace_export(State(state): State<AppState>) -> ApiResult<Bundle> {
    bundle_of(&state.service.loaded().sources)
        .map(Json)
        .map_err(|_| internal("the files in use could not be written out"))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportBody {
    files: Vec<SourceFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResponse {
    workspace: WorkspaceStatus,
    playback: PlaybackState,
}

fn internal(message: &'static str) -> ApiError {
    ApiError::new(
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal",
        message,
    )
}

fn import_allowed(state: &AppState) -> Result<(), ApiError> {
    if state.config.import_enabled {
        Ok(())
    } else {
        Err(ApiError::new(
            axum::http::StatusCode::FORBIDDEN,
            "import_disabled",
            "importing is switched off on this server (AEGIS_IMPORT)",
        ))
    }
}

/// Why uploaded files were not turned into something to run on.
enum ImportFailure {
    /// The files are not a valid workspace; the problem is theirs.
    Invalid(WorkspaceProblem),
    Api(ApiError),
}

impl From<ImportFailure> for ApiError {
    fn from(failure: ImportFailure) -> Self {
        match failure {
            ImportFailure::Api(error) => error,
            ImportFailure::Invalid(problem) => Self::new(
                axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_workspace",
                match problem.path {
                    Some(path) => format!("{path}: {}", problem.message),
                    None => problem.message,
                },
            ),
        }
    }
}

/// Sorts, parses and compiles uploaded files over what the server started
/// with, exactly as start-up does with a directory. Nothing is applied.
async fn build_import(state: &AppState, files: Vec<SourceFile>) -> Result<Loaded, ImportFailure> {
    if files.is_empty() {
        return Err(ImportFailure::Api(ApiError::bad_request(
            "no files were sent",
        )));
    }
    let base = Arc::clone(&state.service.initial().sources);
    // Parsing policies and compiling topologies is CPU work; keep it off the
    // async workers.
    off_the_workers(move || {
        let read = from_files(files, base.as_ref().clone()).map_err(|error| WorkspaceProblem {
            // A problem with the import as a whole is in no one file.
            path: (error.path != std::path::Path::new("import"))
                .then(|| error.path.display().to_string()),
            message: error.message,
        })?;
        read.build(WorkspaceOrigin::Imported)
            .map_err(|error| WorkspaceProblem {
                path: None,
                message: error.to_string(),
            })
    })
    .await
    .map_err(|()| ImportFailure::Api(internal("the files could not be checked")))?
    .map_err(ImportFailure::Invalid)
}

/// Says what applying the files would give, or what is wrong with them.
pub async fn workspace_check(
    State(state): State<AppState>,
    body: Result<Json<ImportBody>, JsonRejection>,
) -> ApiResult<WorkspaceCheck> {
    import_allowed(&state)?;
    let Json(body) = body?;
    match build_import(&state, body.files).await {
        Ok(loaded) => Ok(Json(WorkspaceCheck {
            valid: true,
            workspace: Some(loaded.status(true)),
            problem: None,
        })),
        Err(ImportFailure::Invalid(problem)) => Ok(Json(WorkspaceCheck {
            valid: false,
            workspace: None,
            problem: Some(problem),
        })),
        Err(ImportFailure::Api(error)) => Err(error),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiffResponse {
    /// Whether Cedar decides anything differently: a catalogued request, a
    /// scenario flow or a cell of the access matrix.
    decisions_changed: bool,
    diff: Diff,
}

/// What Cedar would decide differently under the uploaded files, compared
/// with what is in use. Both sides are built the way start-up builds them
/// and every answer on either is Cedar's. Nothing is applied.
pub async fn workspace_diff(
    State(state): State<AppState>,
    body: Result<Json<ImportBody>, JsonRejection>,
) -> ApiResult<WorkspaceDiffResponse> {
    import_allowed(&state)?;
    let Json(body) = body?;
    let candidate = build_import(&state, body.files).await?;
    let base = state.service.assets();
    let diff = off_the_workers(move || compare(&base, &candidate.assets))
        .await
        .map_err(|()| internal("the files could not be compared"))??;
    Ok(Json(WorkspaceDiffResponse {
        decisions_changed: diff.decisions_changed(),
        diff,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformsBody {
    files: Vec<SourceFile>,
    scenario_id: String,
    /// Which platform of the files to run on, when they describe several.
    #[serde(default)]
    topology_id: Option<String>,
}

/// Runs one scenario on the platform in use and on the one the uploaded
/// files describe, from the same seed, and reports both with what the two
/// descriptions state differently. The files are built the way an import
/// builds them; nothing is applied and the timeline in use is not touched.
pub async fn experiment_platforms(
    State(state): State<AppState>,
    body: Result<Json<PlatformsBody>, JsonRejection>,
) -> ApiResult<PlatformComparison> {
    import_allowed(&state)?;
    let Json(body) = body?;
    check_id("scenarioId", &body.scenario_id)?;
    if let Some(id) = &body.topology_id {
        check_id("topologyId", id)?;
    }
    let candidate = build_import(&state, body.files).await?;
    let service = state.service.clone();
    let comparison = off_the_workers(move || {
        service.compare_platforms(&candidate, &body.scenario_id, body.topology_id.as_deref())
    })
    .await
    .map_err(|()| internal("the comparison could not be run"))??;
    Ok(Json(comparison))
}

fn apply(state: &AppState, loaded: Loaded) -> Json<WorkspaceResponse> {
    // A later sync to a connected agent uploads what the engine now holds.
    state.providers.cedar_agent().set_store(
        loaded.assets.cedar.documents(),
        loaded.assets.cedar.entities_json().clone(),
    );
    let workspace = loaded.status(state.config.import_enabled);
    let playback = state.service.replace(loaded);
    Json(WorkspaceResponse {
        workspace,
        playback,
    })
}

/// Replaces the topologies, scenarios and policies in use with the uploaded
/// files. They are held in memory only: a restart returns to what the server
/// was started with.
pub async fn workspace_import(
    State(state): State<AppState>,
    body: Result<Json<ImportBody>, JsonRejection>,
) -> ApiResult<WorkspaceResponse> {
    import_allowed(&state)?;
    let Json(body) = body?;
    let loaded = build_import(&state, body.files).await?;
    tracing::info!(
        replaced = ?loaded.replaced,
        topologies = loaded.assets.worlds.len(),
        "workspace imported"
    );
    Ok(apply(&state, loaded))
}

/// Returns to what the server was started with.
pub async fn workspace_reset(State(state): State<AppState>) -> ApiResult<WorkspaceResponse> {
    import_allowed(&state)?;
    Ok(apply(&state, state.service.initial().clone()))
}

// -- authorization ----------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineAvailability {
    #[serde(flatten)]
    engine: EngineInfo,
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationCatalogResponse {
    engines: Vec<EngineAvailability>,
    policies: Vec<PolicyInfo>,
    tenants: Vec<CatalogTenant>,
    principals: Vec<CatalogPrincipal>,
    actions: Vec<CatalogAction>,
    resources: Vec<CatalogResource>,
    context_keys: Vec<CatalogContextKey>,
    /// Share of simulated baseline authorization traffic Cedar denies.
    baseline_deny_fraction: f64,
    data_source: DataSource,
}

pub async fn authorization_catalog(
    State(state): State<AppState>,
) -> Json<AuthorizationCatalogResponse> {
    let assets = state.service.assets();
    let catalog = &assets.catalog;
    Json(AuthorizationCatalogResponse {
        engines: vec![
            EngineAvailability {
                engine: assets.cedar.engine(),
                available: true,
            },
            EngineAvailability {
                engine: state.providers.cedar_agent().engine(),
                available: state.providers.cedar_agent().is_connected(),
            },
        ],
        policies: assets.cedar.policies(),
        tenants: catalog.tenants.clone(),
        principals: catalog.principals.clone(),
        actions: catalog.actions.clone(),
        resources: catalog.resources.clone(),
        context_keys: catalog.context_keys.clone(),
        baseline_deny_fraction: assets.decisions.baseline_deny_fraction,
        data_source: DataSource::Synthetic,
    })
}

pub async fn authorization_decisions(
    State(state): State<AppState>,
) -> Json<Vec<AuthorizationDecision>> {
    Json(state.service.decisions())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvaluateBody {
    principal: String,
    action: String,
    resource: String,
    #[serde(default)]
    context: serde_json::Map<String, Value>,
    #[serde(default)]
    disabled_policies: Vec<String>,
    #[serde(default)]
    engine: EvaluateEngine,
}

pub async fn authorization_evaluate(
    State(state): State<AppState>,
    body: Result<Json<EvaluateBody>, JsonRejection>,
) -> ApiResult<AuthorizationDecision> {
    let Json(body) = body?;
    if body.disabled_policies.len() > MAX_DISABLED_POLICIES {
        return Err(ApiError::bad_request("too many disabled policies"));
    }
    let input = EvaluateInput {
        request: AuthorizationRequest {
            principal: body.principal,
            action: body.action,
            resource: body.resource,
            context: body.context,
        },
        disabled_policies: body.disabled_policies,
    };
    match body.engine {
        EvaluateEngine::Embedded => Ok(Json(state.service.evaluate_embedded(input)?)),
        EvaluateEngine::CedarAgent => {
            state.service.validate_evaluation(&input)?;
            if !input.disabled_policies.is_empty() {
                // The agent's own policy store is authoritative; AEGIS cannot
                // switch individual policies off inside it.
                return Err(AuthzError::InvalidRequest {
                    field: "disabledPolicies",
                    message: "not supported when evaluating with cedar-agent".into(),
                }
                .into());
            }
            let agent = state.providers.cedar_agent();
            let (outcome, micros) = agent.is_authorized(&input.request).await?;
            debug_assert_eq!(agent.engine().kind, EngineKind::CedarAgent);
            Ok(Json(state.service.record_decision(
                input,
                outcome,
                agent.engine(),
                micros,
                DataSource::Live,
            )))
        }
    }
}

/// Most policies a caller may switch off for one question.
const MAX_DISABLED_POLICIES: usize = 32;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExplainBody {
    principal: String,
    action: String,
    resource: String,
    #[serde(default)]
    context: serde_json::Map<String, Value>,
    #[serde(default)]
    disabled_policies: Vec<String>,
}

/// One request taken policy by policy. It is the embedded engine that is
/// asked, and nothing is recorded: no event, no decision in the list, no
/// path on the model.
pub async fn authorization_explain(
    State(state): State<AppState>,
    body: Result<Json<ExplainBody>, JsonRejection>,
) -> ApiResult<AuthorizationExplanation> {
    let Json(body) = body?;
    if body.disabled_policies.len() > MAX_DISABLED_POLICIES {
        return Err(ApiError::bad_request("too many disabled policies"));
    }
    let input = EvaluateInput {
        request: AuthorizationRequest {
            principal: body.principal,
            action: body.action,
            resource: body.resource,
            context: body.context,
        },
        disabled_policies: body.disabled_policies,
    };
    state.service.validate_evaluation(&input)?;
    let assets = state.service.assets();
    Ok(Json(access::explain(&assets, &input)?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatrixBody {
    #[serde(default)]
    context: serde_json::Map<String, Value>,
    #[serde(default)]
    disabled_policies: Vec<String>,
}

/// Who may do what under one context: every request the catalogue describes,
/// asked of the embedded engine. Nothing is recorded.
pub async fn authorization_matrix(
    State(state): State<AppState>,
    body: Result<Json<MatrixBody>, JsonRejection>,
) -> ApiResult<AccessMatrix> {
    let Json(body) = body?;
    if body.disabled_policies.len() > MAX_DISABLED_POLICIES {
        return Err(ApiError::bad_request("too many disabled policies"));
    }
    let assets = state.service.assets();
    // Up to a few thousand evaluations: CPU work, kept off the async workers.
    let matrix =
        off_the_workers(move || access::matrix(&assets, body.context, body.disabled_policies))
            .await
            .map_err(|()| internal("the access matrix could not be worked out"))??;
    Ok(Json(matrix))
}

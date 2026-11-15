use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::authorization::validate_request;
use crate::domain::{
    AuthorizationDecision, AuthorizationRequest, AuthzError, DataSource, Decision, EngineInfo,
    ImportedEvent, Incident, MetricsReport, PathStage, PathStageKind, PlaybackState,
    PlaybackStatus, PolicyDecision, PolicyDecisionPoint, RecordingSummary, Scenario,
    SecurityEvent, Severity, TelemetrySnapshot, Topology, TopologySummary, PLAYBACK_SPEEDS,
    SCHEMA_VERSION,
};
use crate::simulation::model::SimTopology;
use crate::simulation::{Command, Timeline, TICK_MS};

use super::Assets;

/// Version of the WebSocket message protocol.
pub const PROTOCOL_VERSION: u32 = 1;

/// Wall-clock period of the scheduler.
const SCHEDULER_PERIOD: Duration = Duration::from_millis(50);
/// Most ticks simulated per scheduler wake-up; the rest is dropped so a
/// stalled process cannot spiral trying to catch up.
const MAX_STEPS_PER_WAKE: u32 = 8;
/// Capacity of the broadcast buffer. Slow consumers that fall further behind
/// are told how many messages they missed instead of blocking the simulation.
const STREAM_BUFFER: usize = 256;
/// Snapshots are re-sent at this interval while paused, as a keep-alive.
const PAUSED_HEARTBEAT: Duration = Duration::from_secs(2);

#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error("unknown scenario `{0}`")]
    UnknownScenario(String),
    #[error("scenario `{0}` is not available on the active topology")]
    ScenarioUnavailable(String),
    #[error("unknown topology `{0}`")]
    UnknownTopology(String),
    #[error("unknown recording `{0}`")]
    UnknownRecording(String),
    #[error("unsupported playback speed {0}; allowed: 0.5, 1, 2, 4")]
    InvalidSpeed(f64),
    #[error("no scenario is running")]
    NoActiveScenario,
    #[error(transparent)]
    Authz(#[from] AuthzError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimelineReason {
    Reset,
    Branch,
    Seek,
    Topology,
    Recording,
}

/// Messages sent to stream subscribers.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamMessage<'a> {
    #[serde(rename_all = "camelCase")]
    Hello {
        protocol_version: u32,
        schema_version: &'a str,
        topology_id: &'a str,
        playback: PlaybackState,
    },
    Snapshot {
        data: &'a TelemetrySnapshot,
    },
    Events {
        data: &'a [SecurityEvent],
    },
    /// History changed shape; clients should refetch REST state.
    Timeline {
        reason: TimelineReason,
        playback: PlaybackState,
    },
    Lagged {
        dropped: u64,
    },
    Pong {
        t: f64,
    },
}

impl StreamMessage<'_> {
    pub fn encode(&self) -> Arc<str> {
        // These types contain nothing that can fail to serialise.
        Arc::from(serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum ControlAction {
    Play,
    Pause,
    /// Advance exactly one tick (only meaningful while paused).
    Step,
    #[serde(rename_all = "camelCase")]
    Seek {
        to_ms: u64,
    },
    SetSpeed {
        speed: f64,
    },
    /// Jump back to the start of the latest incident (or of the window) and play.
    Replay,
    /// Jump to the head of the timeline and play.
    Live,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResetScope {
    /// Start over from tick 0 with a clean history.
    #[default]
    Simulation,
    /// Only stop the running scenario; history is kept.
    Scenario,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EvaluateEngine {
    #[default]
    Embedded,
    CedarAgent,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvaluateInput {
    pub request: AuthorizationRequest,
    pub disabled_policies: Vec<String>,
}

struct Runtime {
    timeline: Timeline,
    status: PlaybackStatus,
    speed: f64,
    /// Virtual milliseconds owed to the simulation.
    accumulator_ms: f64,
    decision_counter: u64,
    last_broadcast: Instant,
}

pub struct SimulationService {
    assets: Arc<Assets>,
    seed: u64,
    runtime: Mutex<Runtime>,
    tx: broadcast::Sender<Arc<str>>,
}

impl std::fmt::Debug for SimulationService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SimulationService")
            .field("seed", &self.seed)
            .finish_non_exhaustive()
    }
}

fn entity_type(uid: &str) -> &str {
    uid.rsplit_once("::").map_or(uid, |(ty, _)| ty)
}

impl SimulationService {
    pub fn new(assets: Arc<Assets>, seed: u64) -> Arc<Self> {
        let world = assets.default_world();
        let timeline = Timeline::new(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(&assets.decisions),
            seed,
        );
        let (tx, _) = broadcast::channel(STREAM_BUFFER);
        Arc::new(Self {
            assets,
            seed,
            runtime: Mutex::new(Runtime {
                timeline,
                status: PlaybackStatus::Playing,
                speed: 1.0,
                accumulator_ms: 0.0,
                decision_counter: 0,
                last_broadcast: Instant::now(),
            }),
            tx,
        })
    }

    pub fn assets(&self) -> &Arc<Assets> {
        &self.assets
    }

    fn lock(&self) -> MutexGuard<'_, Runtime> {
        // The runtime holds no invariants a panic could leave half-applied in
        // a dangerous way; recover the guard rather than poisoning forever.
        self.runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn send(&self, message: &StreamMessage<'_>) {
        // An error only means nobody is subscribed.
        let _ = self.tx.send(message.encode());
    }

    fn broadcast_snapshot(&self, rt: &mut Runtime) {
        let snapshot = rt.timeline.telemetry(rt.status, rt.speed);
        self.send(&StreamMessage::Snapshot { data: &snapshot });
        rt.last_broadcast = Instant::now();
    }

    fn broadcast_timeline(&self, rt: &mut Runtime, reason: TimelineReason) {
        self.send(&StreamMessage::Timeline {
            reason,
            playback: rt.timeline.playback(rt.status, rt.speed),
        });
        self.broadcast_snapshot(rt);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<str>> {
        self.tx.subscribe()
    }

    /// Spawns the scheduler that advances virtual time.
    pub fn spawn(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let service = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(SCHEDULER_PERIOD);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut last = Instant::now();
            loop {
                interval.tick().await;
                let now = Instant::now();
                service.advance(now.duration_since(last));
                last = now;
            }
        })
    }

    /// Advances the simulation by `elapsed` wall-clock time at the current
    /// speed. Exposed so tests can drive time without a scheduler.
    pub fn advance(&self, elapsed: Duration) {
        let mut rt = self.lock();
        if rt.status == PlaybackStatus::Paused {
            if rt.last_broadcast.elapsed() >= PAUSED_HEARTBEAT {
                self.broadcast_snapshot(&mut rt);
            }
            return;
        }
        rt.accumulator_ms += elapsed.as_secs_f64() * 1000.0 * rt.speed;
        let mut steps = 0;
        let mut events = Vec::new();
        while rt.accumulator_ms >= TICK_MS as f64 && steps < MAX_STEPS_PER_WAKE {
            rt.accumulator_ms -= TICK_MS as f64;
            events.extend(rt.timeline.step().events);
            steps += 1;
        }
        if steps == MAX_STEPS_PER_WAKE {
            rt.accumulator_ms = rt.accumulator_ms.min(TICK_MS as f64);
        }
        if steps > 0 {
            if !events.is_empty() {
                self.send(&StreamMessage::Events { data: &events });
            }
            self.broadcast_snapshot(&mut rt);
        }
    }

    // -- commands -----------------------------------------------------------

    pub fn start_scenario(&self, scenario_id: &str) -> Result<PlaybackState, ServiceError> {
        let mut rt = self.lock();
        let scenario = rt
            .timeline
            .scenarios()
            .into_iter()
            .find(|s| s.id == scenario_id)
            .ok_or_else(|| ServiceError::UnknownScenario(scenario_id.to_string()))?;
        if !scenario.available {
            return Err(ServiceError::ScenarioUnavailable(scenario_id.to_string()));
        }
        let branched = rt.timeline.issue(Command::StartScenario {
            scenario_id: scenario_id.to_string(),
        });
        rt.status = PlaybackStatus::Playing;
        if branched {
            self.broadcast_timeline(&mut rt, TimelineReason::Branch);
        }
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    pub fn reset(&self, scope: ResetScope) -> Result<PlaybackState, ServiceError> {
        let mut rt = self.lock();
        match scope {
            ResetScope::Simulation => {
                rt.timeline.reset();
                rt.status = PlaybackStatus::Playing;
                rt.accumulator_ms = 0.0;
                self.broadcast_timeline(&mut rt, TimelineReason::Reset);
            }
            ResetScope::Scenario => {
                if rt.timeline.state().scenario.is_none() {
                    return Err(ServiceError::NoActiveScenario);
                }
                let branched = rt.timeline.issue(Command::AbortScenario);
                rt.status = PlaybackStatus::Playing;
                if branched {
                    self.broadcast_timeline(&mut rt, TimelineReason::Branch);
                }
            }
        }
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    pub fn control(&self, action: ControlAction) -> Result<PlaybackState, ServiceError> {
        let mut rt = self.lock();
        match action {
            ControlAction::Play => rt.status = PlaybackStatus::Playing,
            ControlAction::Pause => {
                rt.status = PlaybackStatus::Paused;
                rt.accumulator_ms = 0.0;
            }
            ControlAction::Step => {
                rt.status = PlaybackStatus::Paused;
                let events = rt.timeline.step().events;
                if !events.is_empty() {
                    self.send(&StreamMessage::Events { data: &events });
                }
            }
            ControlAction::SetSpeed { speed } => {
                if !PLAYBACK_SPEEDS.iter().any(|s| (s - speed).abs() < 1e-9) {
                    return Err(ServiceError::InvalidSpeed(speed));
                }
                rt.speed = speed;
            }
            ControlAction::Seek { to_ms } => {
                rt.timeline.seek(to_ms / TICK_MS);
                rt.accumulator_ms = 0.0;
                self.broadcast_timeline(&mut rt, TimelineReason::Seek);
                return Ok(rt.timeline.playback(rt.status, rt.speed));
            }
            ControlAction::Replay => {
                let window = rt.timeline.window_start_tick();
                let cursor_ms = rt.timeline.state().virtual_time_ms();
                // Start of the latest incident that began at or before the
                // cursor; two seconds of lead-in make the onset visible.
                let target = rt
                    .timeline
                    .incidents()
                    .iter()
                    .filter(|i| i.started_at_ms <= cursor_ms)
                    .map(|i| i.started_at_ms)
                    .max()
                    .map_or(window, |ms| (ms / TICK_MS).saturating_sub(10).max(window));
                rt.timeline.seek(target);
                rt.status = PlaybackStatus::Playing;
                rt.accumulator_ms = 0.0;
                self.broadcast_timeline(&mut rt, TimelineReason::Seek);
                return Ok(rt.timeline.playback(rt.status, rt.speed));
            }
            ControlAction::Live => {
                let head = rt.timeline.head_tick();
                rt.timeline.seek(head);
                rt.status = PlaybackStatus::Playing;
                rt.accumulator_ms = 0.0;
                self.broadcast_timeline(&mut rt, TimelineReason::Seek);
                return Ok(rt.timeline.playback(rt.status, rt.speed));
            }
        }
        self.broadcast_snapshot(&mut rt);
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    pub fn select_topology(&self, topology_id: &str) -> Result<PlaybackState, ServiceError> {
        let world = self
            .assets
            .world(topology_id)
            .ok_or_else(|| ServiceError::UnknownTopology(topology_id.to_string()))?;
        let mut rt = self.lock();
        rt.timeline = Timeline::new(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(&self.assets.decisions),
            self.seed,
        );
        rt.status = PlaybackStatus::Playing;
        rt.accumulator_ms = 0.0;
        self.broadcast_timeline(&mut rt, TimelineReason::Topology);
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    pub fn load_recording(&self, recording_id: &str) -> Result<PlaybackState, ServiceError> {
        let recording = self
            .assets
            .recordings
            .iter()
            .find(|r| r.id == recording_id)
            .ok_or_else(|| ServiceError::UnknownRecording(recording_id.to_string()))?;
        let world = self
            .assets
            .world(&recording.topology_id)
            .ok_or_else(|| ServiceError::UnknownTopology(recording.topology_id.clone()))?;
        // Simulating the recording takes a few milliseconds; do it before
        // taking the lock so readers are not held up.
        let timeline = Timeline::from_recording(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(&self.assets.decisions),
            recording,
        );
        let mut rt = self.lock();
        rt.timeline = timeline;
        rt.status = PlaybackStatus::Playing;
        rt.accumulator_ms = 0.0;
        self.broadcast_timeline(&mut rt, TimelineReason::Recording);
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    /// Places fixture-derived events on the timeline at the cursor.
    pub fn import_events(&self, provider_id: &str, events: Vec<ImportedEvent>) {
        if events.is_empty() {
            return;
        }
        let mut rt = self.lock();
        // Keep only node references that exist on the active topology.
        let topo = Arc::clone(rt.timeline.topology());
        let events = events
            .into_iter()
            .map(|mut event| {
                event.node_ids.retain(|id| topo.node(id).is_some());
                event
            })
            .collect();
        let branched = rt.timeline.issue(Command::ImportEvents {
            provider_id: provider_id.to_string(),
            events,
        });
        if branched {
            self.broadcast_timeline(&mut rt, TimelineReason::Branch);
        }
    }

    // -- authorization ------------------------------------------------------

    /// Validates a request and checks the policy filter before any engine runs.
    pub fn validate_evaluation(&self, input: &EvaluateInput) -> Result<(), ServiceError> {
        validate_request(&input.request)?;
        let known = self.assets.cedar.policies();
        for id in &input.disabled_policies {
            if !known.iter().any(|p| &p.id == id) {
                return Err(AuthzError::UnknownPolicy(id.clone()).into());
            }
        }
        Ok(())
    }

    /// Evaluates with the embedded Cedar engine and records the decision.
    pub fn evaluate_embedded(
        &self,
        input: EvaluateInput,
    ) -> Result<AuthorizationDecision, ServiceError> {
        self.validate_evaluation(&input)?;
        let started = Instant::now();
        let outcome = self
            .assets
            .cedar
            .evaluate(&input.request, &input.disabled_policies)?;
        let micros = started.elapsed().as_micros() as u64;
        Ok(self.record_decision(input, outcome, self.assets.cedar.engine(), micros))
    }

    /// Records a decision produced by any engine and places it on the topology.
    pub fn record_decision(
        &self,
        input: EvaluateInput,
        outcome: PolicyDecision,
        engine: EngineInfo,
        evaluation_micros: u64,
    ) -> AuthorizationDecision {
        let mut rt = self.lock();
        rt.decision_counter += 1;
        let topo = Arc::clone(rt.timeline.topology());
        let allowed = outcome.decision == Decision::Allow;
        let (path, hops, blocked_at) = decision_path(&topo, &input.request.resource, allowed);
        let decision = AuthorizationDecision {
            id: format!("dec-{}", rt.decision_counter),
            virtual_time_ms: rt.timeline.state().virtual_time_ms(),
            request: input.request,
            decision: outcome.decision,
            determining_policies: outcome.determining_policies,
            errors: outcome.errors,
            engine,
            evaluation_micros,
            path,
            hops,
            blocked_at,
            disabled_policies: input.disabled_policies,
            data_source: DataSource::Synthetic,
        };
        let branched = rt.timeline.issue(Command::RecordDecision {
            decision: Box::new(decision.clone()),
        });
        if branched {
            self.broadcast_timeline(&mut rt, TimelineReason::Branch);
        }
        decision
    }

    // -- queries ------------------------------------------------------------

    pub fn topology(&self) -> Topology {
        self.lock().timeline.topology_view()
    }

    pub fn topology_id(&self) -> String {
        self.lock().timeline.topology().spec.id.clone()
    }

    pub fn topologies(&self) -> Vec<TopologySummary> {
        self.assets.worlds.values().map(|w| w.summary()).collect()
    }

    pub fn snapshot(&self) -> TelemetrySnapshot {
        let rt = self.lock();
        rt.timeline.telemetry(rt.status, rt.speed)
    }

    pub fn playback(&self) -> PlaybackState {
        let rt = self.lock();
        rt.timeline.playback(rt.status, rt.speed)
    }

    pub fn metrics(&self) -> MetricsReport {
        self.lock().timeline.metrics()
    }

    pub fn incidents(&self) -> Vec<Incident> {
        self.lock().timeline.incidents().to_vec()
    }

    pub fn scenarios(&self) -> Vec<Scenario> {
        self.lock().timeline.scenarios()
    }

    pub fn recordings(&self) -> Vec<RecordingSummary> {
        self.assets.recordings.iter().map(|r| r.summary()).collect()
    }

    pub fn decisions(&self) -> Vec<AuthorizationDecision> {
        self.lock().timeline.decisions()
    }

    /// Newest-last slice of events after `after_seq`, at most `limit` long
    /// (the newest ones win when there are more).
    pub fn events(
        &self,
        after_seq: u64,
        limit: usize,
        node_id: Option<&str>,
        min_severity: Option<Severity>,
    ) -> Vec<SecurityEvent> {
        let rt = self.lock();
        let mut selected: Vec<SecurityEvent> = rt
            .timeline
            .events()
            .rev()
            .filter(|e| e.seq > after_seq)
            .filter(|e| node_id.is_none_or(|id| e.node_ids.iter().any(|n| n == id)))
            .filter(|e| min_severity.is_none_or(|min| e.severity >= min))
            .take(limit)
            .cloned()
            .collect();
        selected.reverse();
        selected
    }

    pub fn hello(&self) -> Arc<str> {
        let rt = self.lock();
        StreamMessage::Hello {
            protocol_version: PROTOCOL_VERSION,
            schema_version: SCHEMA_VERSION,
            topology_id: &rt.timeline.topology().spec.id,
            playback: rt.timeline.playback(rt.status, rt.speed),
        }
        .encode()
    }

    pub fn snapshot_message(&self) -> Arc<str> {
        let rt = self.lock();
        let snapshot = rt.timeline.telemetry(rt.status, rt.speed);
        StreamMessage::Snapshot { data: &snapshot }.encode()
    }
}

/// Stages and hops of an authorization request on a topology:
/// client → edge → gateway → authentication → authorization → resource.
fn decision_path(
    topo: &SimTopology,
    resource: &str,
    allowed: bool,
) -> (Vec<PathStage>, Vec<String>, Option<String>) {
    let role = |name: &str| topo.role_node(name);
    let (Some(client), Some(gateway), Some(auth), Some(authorizer)) = (
        role("partnerClient").or_else(|| topo.clients.first().copied()),
        role("primaryGateway"),
        role("primaryAuth"),
        role("primaryAuthorizer"),
    ) else {
        return (Vec::new(), Vec::new(), None);
    };
    let resource_node = role(&format!("resource:{}", entity_type(resource)))
        .or_else(|| role("protectedResource"));

    let mut stages = Vec::new();
    let mut hops = Vec::new();
    let stage = |node: usize, kind: PathStageKind, reached: bool| PathStage {
        node_id: topo.node_id(node).to_string(),
        kind,
        reached,
    };
    stages.push(stage(client, PathStageKind::Client, true));
    if let Some(path) = topo.sync_path(client, gateway) {
        for (i, edge) in path.iter().enumerate() {
            hops.push(topo.edge_ids[*edge].clone());
            if i + 1 < path.len() {
                stages.push(stage(topo.edge_dst[*edge], PathStageKind::Edge, true));
            }
        }
    }
    stages.push(stage(gateway, PathStageKind::Gateway, true));
    if let Some(edge) = topo.edge_between(gateway, auth) {
        hops.push(topo.edge_ids[edge].clone());
    }
    stages.push(stage(auth, PathStageKind::Authentication, true));
    if let Some(edge) = topo.edge_between(gateway, authorizer) {
        hops.push(topo.edge_ids[edge].clone());
    }
    stages.push(stage(authorizer, PathStageKind::Authorization, true));
    if let Some(target) = resource_node {
        if let Some(path) = topo.sync_path(gateway, target) {
            for edge in &path {
                if allowed {
                    hops.push(topo.edge_ids[*edge].clone());
                }
                stages.push(stage(topo.edge_dst[*edge], PathStageKind::Resource, allowed));
            }
        }
    }
    let blocked_at = (!allowed).then(|| topo.node_id(authorizer).to_string());
    (stages, hops, blocked_at)
}

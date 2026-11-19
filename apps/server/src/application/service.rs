use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::authorization::validate_request;
use crate::clock::Instant;
use crate::domain::{
    AuthorizationDecision, AuthorizationRequest, AuthzError, DataSource, Decision, EngineInfo,
    Incident, IncidentReport, MetricsReport, PathStage, PathStageKind, PlaybackState,
    PlaybackStatus, PolicyDecision, PolicyDecisionPoint, RecordingSummary, Scenario, SecurityEvent,
    Severity, TelemetrySnapshot, Topology, TopologySummary, PLAYBACK_SPEEDS, SCHEMA_VERSION,
};
use crate::incidents::recordings::Recording;
use crate::incidents::{resolve_fault, Effect};
use crate::simulation::engine::{fault_fits, MAX_FAULT_RAMP_MS};
use crate::simulation::model::SimTopology;
use crate::simulation::{Command, Timeline, TICK_MS};

use super::experiment::{self, Experiment, Trial};
use super::platforms::{self, PlatformComparison, Side};
use super::session::{self, SessionExport};
use super::{Assets, Loaded};

/// Version of the WebSocket message protocol.
pub const PROTOCOL_VERSION: u32 = 1;

/// Wall-clock period of the scheduler: how often time is advanced, by the
/// server's own task or by the page that holds the in-browser engine.
pub const SCHEDULER_PERIOD: Duration = Duration::from_millis(50);
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
    #[error("the fault cannot be placed: {0}")]
    InvalidFault(String),
    #[error("too many faults are in force; lift some first")]
    TooManyFaults,
    #[error("unknown incident `{0}`, or one older than the history that is kept")]
    UnknownIncident(String),
    #[error("the session cannot be loaded: {0}")]
    InvalidSession(String),
    #[error("the comparison cannot be run: {0}")]
    InvalidExperiment(String),
    #[error("the platform's files were replaced while this was being prepared; try again")]
    WorkspaceChanged,
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
    /// The topologies, scenarios or policies themselves were replaced.
    Workspace,
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ControlAction {
    Play,
    Pause,
    /// Advance exactly one tick (only meaningful while paused).
    Step,
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
    /// What the timeline runs on. Replaced together with the timeline, under
    /// the same lock, so the two never disagree.
    loaded: Loaded,
    timeline: Timeline,
    status: PlaybackStatus,
    speed: f64,
    /// Virtual milliseconds owed to the simulation.
    accumulator_ms: f64,
    decision_counter: u64,
    last_broadcast: Instant,
}

pub struct SimulationService {
    /// What the server started with: what a reset returns to, and what an
    /// import is laid over.
    initial: Loaded,
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

/// A fresh timeline on the topology that opens.
fn opening_timeline(assets: &Assets, seed: u64) -> Timeline {
    let world = assets.default_world();
    Timeline::new(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(&assets.decisions),
        seed,
    )
}

fn entity_type(uid: &str) -> &str {
    uid.rsplit_once("::").map_or(uid, |(ty, _)| ty)
}

impl SimulationService {
    pub fn new(loaded: Loaded, seed: u64) -> Arc<Self> {
        let timeline = opening_timeline(&loaded.assets, seed);
        let (tx, _) = broadcast::channel(STREAM_BUFFER);
        Arc::new(Self {
            initial: loaded.clone(),
            seed,
            runtime: Mutex::new(Runtime {
                loaded,
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

    /// What is in use right now.
    pub fn assets(&self) -> Arc<Assets> {
        Arc::clone(&self.lock().loaded.assets)
    }

    pub fn loaded(&self) -> Loaded {
        self.lock().loaded.clone()
    }

    /// What the server started with.
    pub fn initial(&self) -> &Loaded {
        &self.initial
    }

    /// Replaces the topologies, scenarios and policies in use and starts a
    /// new timeline on the topology that opens. Subscribers are told to
    /// refetch everything.
    pub fn replace(&self, loaded: Loaded) -> PlaybackState {
        let timeline = opening_timeline(&loaded.assets, self.seed);
        let mut rt = self.lock();
        rt.loaded = loaded;
        rt.timeline = timeline;
        rt.status = PlaybackStatus::Playing;
        rt.accumulator_ms = 0.0;
        self.broadcast_timeline(&mut rt, TimelineReason::Workspace);
        rt.timeline.playback(rt.status, rt.speed)
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

    /// Spawns the scheduler that advances virtual time. In the browser the
    /// page calls [`SimulationService::advance`] from a timer of its own.
    #[cfg(not(target_arch = "wasm32"))]
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

    /// Places a fault by hand on the active topology: one scenario effect,
    /// outside any scenario. It is a command on the timeline like any
    /// other, so it is replayed, rewound and branched with the rest.
    pub fn inject_fault(
        &self,
        effect: Effect,
        ramp_ms: u64,
    ) -> Result<PlaybackState, ServiceError> {
        effect.validate().map_err(ServiceError::InvalidFault)?;
        if ramp_ms > MAX_FAULT_RAMP_MS {
            return Err(ServiceError::InvalidFault(format!(
                "rampMs must be at most {MAX_FAULT_RAMP_MS}, got {ramp_ms}"
            )));
        }
        let mut rt = self.lock();
        let targets =
            resolve_fault(rt.timeline.topology(), &effect).map_err(ServiceError::InvalidFault)?;
        if !fault_fits(&rt.timeline.state().faults, &targets) {
            return Err(ServiceError::TooManyFaults);
        }
        let branched = rt.timeline.issue(Command::InjectFault { effect, ramp_ms });
        if branched {
            self.broadcast_timeline(&mut rt, TimelineReason::Branch);
        }
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    /// Lifts the faults placed by hand: all of them, or only what `effect`
    /// touches.
    pub fn clear_faults(&self, effect: Option<Effect>) -> Result<PlaybackState, ServiceError> {
        let mut rt = self.lock();
        if let Some(effect) = &effect {
            resolve_fault(rt.timeline.topology(), effect).map_err(ServiceError::InvalidFault)?;
        }
        let branched = rt.timeline.issue(Command::ClearFaults { effect });
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
                let branched = rt.timeline.issue(Command::AbortScenario {});
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
        let mut rt = self.lock();
        let assets = Arc::clone(&rt.loaded.assets);
        let world = assets
            .world(topology_id)
            .ok_or_else(|| ServiceError::UnknownTopology(topology_id.to_string()))?;
        rt.timeline = Timeline::new(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(&assets.decisions),
            self.seed,
        );
        rt.status = PlaybackStatus::Playing;
        rt.accumulator_ms = 0.0;
        self.broadcast_timeline(&mut rt, TimelineReason::Topology);
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    pub fn load_recording(&self, recording_id: &str) -> Result<PlaybackState, ServiceError> {
        let assets = self.assets();
        let recording = assets
            .recordings
            .iter()
            .find(|r| r.id == recording_id)
            .ok_or_else(|| ServiceError::UnknownRecording(recording_id.to_string()))?;
        let world = assets
            .world(&recording.topology_id)
            .ok_or_else(|| ServiceError::UnknownTopology(recording.topology_id.clone()))?;
        // Simulating the recording takes a few milliseconds; do it before
        // taking the lock so readers are not held up.
        let timeline = Timeline::from_recording(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(&assets.decisions),
            recording,
        );
        let mut rt = self.lock();
        // An import may have replaced everything in the meantime; a timeline
        // of what is no longer loaded must not be put in its place.
        if !Arc::ptr_eq(&rt.loaded.assets, &assets) {
            return Err(ServiceError::WorkspaceChanged);
        }
        rt.timeline = timeline;
        rt.status = PlaybackStatus::Playing;
        rt.accumulator_ms = 0.0;
        self.broadcast_timeline(&mut rt, TimelineReason::Recording);
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    /// The timeline in use as a session: what reproduces it.
    pub fn session(&self) -> SessionExport {
        let rt = self.lock();
        session::export(&rt.timeline, rt.loaded.origin)
    }

    /// Replaces the timeline with the one a session describes, re-simulated
    /// from its seed and commands, and puts the cursor where it was saved.
    /// With a cursor the timeline waits there, paused; without one it plays
    /// from the start.
    pub fn load_session(
        &self,
        recording: &Recording,
        cursor_ms: Option<u64>,
    ) -> Result<PlaybackState, ServiceError> {
        recording
            .validate_session()
            .map_err(ServiceError::InvalidSession)?;
        let assets = self.assets();
        let world = assets
            .world(&recording.topology_id)
            .ok_or_else(|| ServiceError::UnknownTopology(recording.topology_id.clone()))?;
        // The same questions start-up asks of a recording file.
        for id in recording.scenario_ids() {
            let scenario = world
                .scenarios
                .iter()
                .find(|scenario| scenario.info.id == id)
                .ok_or_else(|| ServiceError::UnknownScenario(id.clone()))?;
            if !scenario.info.available {
                return Err(ServiceError::ScenarioUnavailable(id));
            }
        }
        for effect in recording.faults() {
            resolve_fault(&world.topo, effect).map_err(ServiceError::InvalidSession)?;
        }
        let mut timeline = Timeline::from_recording(
            Arc::clone(&world.topo),
            Arc::clone(&world.scenarios),
            Arc::clone(&assets.decisions),
            recording,
        );
        if let Some(cursor_ms) = cursor_ms {
            timeline.seek(cursor_ms / TICK_MS);
        }
        let mut rt = self.lock();
        if !Arc::ptr_eq(&rt.loaded.assets, &assets) {
            return Err(ServiceError::WorkspaceChanged);
        }
        rt.timeline = timeline;
        rt.status = if cursor_ms.is_some() {
            PlaybackStatus::Paused
        } else {
            PlaybackStatus::Playing
        };
        rt.accumulator_ms = 0.0;
        self.broadcast_timeline(&mut rt, TimelineReason::Recording);
        Ok(rt.timeline.playback(rt.status, rt.speed))
    }

    /// Tries one fault on the platform at rest, on timelines of its own, on
    /// the topology in use and with the server's seed. The timeline in use
    /// is not touched: this is how a fault is looked at before it is placed.
    pub fn try_fault(&self, effect: Effect, ramp_ms: u64) -> Result<Trial, ServiceError> {
        effect.validate().map_err(ServiceError::InvalidFault)?;
        if ramp_ms > MAX_FAULT_RAMP_MS {
            return Err(ServiceError::InvalidFault(format!(
                "rampMs must be at most {MAX_FAULT_RAMP_MS}, got {ramp_ms}"
            )));
        }
        let (assets, topology_id) = {
            let rt = self.lock();
            (
                Arc::clone(&rt.loaded.assets),
                rt.timeline.topology().spec.id.clone(),
            )
        };
        let world = assets
            .world(&topology_id)
            .ok_or(ServiceError::UnknownTopology(topology_id))?;
        experiment::trial(world, &assets.decisions, self.seed, effect, ramp_ms)
            .map_err(ServiceError::InvalidFault)
    }

    /// Runs a scenario twice on timelines of its own, on the topology in
    /// use and with the server's seed: as it is, and with one fault placed
    /// `at_ms` after it starts. The timeline in use is not touched.
    pub fn compare_intervention(
        &self,
        scenario_id: &str,
        effect: Effect,
        at_ms: u64,
        ramp_ms: u64,
    ) -> Result<Experiment, ServiceError> {
        effect.validate().map_err(ServiceError::InvalidFault)?;
        if ramp_ms > MAX_FAULT_RAMP_MS {
            return Err(ServiceError::InvalidFault(format!(
                "rampMs must be at most {MAX_FAULT_RAMP_MS}, got {ramp_ms}"
            )));
        }
        let (assets, topology_id) = {
            let rt = self.lock();
            (
                Arc::clone(&rt.loaded.assets),
                rt.timeline.topology().spec.id.clone(),
            )
        };
        let world = assets
            .world(&topology_id)
            .ok_or(ServiceError::UnknownTopology(topology_id))?;
        let scenario = world
            .scenarios
            .iter()
            .find(|scenario| scenario.info.id == scenario_id)
            .ok_or_else(|| ServiceError::UnknownScenario(scenario_id.to_string()))?;
        if !scenario.info.available {
            return Err(ServiceError::ScenarioUnavailable(scenario_id.to_string()));
        }
        experiment::run(
            world,
            &assets.decisions,
            self.seed,
            scenario,
            effect,
            at_ms,
            ramp_ms,
        )
        .map_err(ServiceError::InvalidExperiment)
    }

    /// Runs a scenario on the topology in use and on a topology of
    /// `candidate`, a set of files that is not in use, each on a timeline of
    /// its own with the server's seed. The candidate's topology is the one
    /// named, or the one with the id in use, or the one its files open on.
    /// Neither the timeline nor the files in use are touched.
    pub fn compare_platforms(
        &self,
        candidate: &Loaded,
        scenario_id: &str,
        topology_id: Option<&str>,
    ) -> Result<PlatformComparison, ServiceError> {
        let (base, in_use) = {
            let rt = self.lock();
            (rt.loaded.clone(), rt.timeline.topology().spec.id.clone())
        };
        let world = base
            .assets
            .world(&in_use)
            .ok_or_else(|| ServiceError::UnknownTopology(in_use.clone()))?;
        let scenario = world
            .scenarios
            .iter()
            .find(|scenario| scenario.info.id == scenario_id)
            .ok_or_else(|| ServiceError::UnknownScenario(scenario_id.to_string()))?;
        if !scenario.info.available {
            return Err(ServiceError::ScenarioUnavailable(scenario_id.to_string()));
        }

        let files = &candidate.assets;
        let other_id = match topology_id {
            Some(id) => id,
            None if files.world(&in_use).is_some() => &in_use,
            None => &files.default_topology,
        };
        let other_world = files.world(other_id).ok_or_else(|| {
            ServiceError::InvalidExperiment(format!("the files have no topology `{other_id}`"))
        })?;
        let other = other_world
            .scenarios
            .iter()
            .find(|scenario| scenario.info.id == scenario_id)
            .ok_or_else(|| {
                ServiceError::InvalidExperiment(format!(
                    "the files have no scenario `{scenario_id}`; a comparison needs the incident on both sides"
                ))
            })?;
        if !other.info.available {
            return Err(ServiceError::InvalidExperiment(format!(
                "scenario `{scenario_id}` cannot run on `{other_id}` as the files describe it: {}",
                other
                    .info
                    .unavailable_reason
                    .as_deref()
                    .unwrap_or("not available")
            )));
        }
        // The same incident on both sides, or the comparison is of two
        // things at once.
        let written = |loaded: &Loaded| {
            loaded
                .sources
                .scenarios
                .iter()
                .find(|def| def.id == scenario_id)
                .cloned()
        };
        if written(&base) != written(candidate) {
            return Err(ServiceError::InvalidExperiment(format!(
                "scenario `{scenario_id}` is written differently in the files than in use; a comparison needs the same incident on both sides"
            )));
        }
        platforms::compare(
            &Side {
                world,
                decisions: &base.assets.decisions,
                scenario,
            },
            &Side {
                world: other_world,
                decisions: &files.decisions,
                scenario: other,
            },
            self.seed,
        )
        .map_err(ServiceError::InvalidExperiment)
    }

    // -- authorization ------------------------------------------------------

    /// Validates a request and checks the policy filter before any engine runs.
    pub fn validate_evaluation(&self, input: &EvaluateInput) -> Result<(), ServiceError> {
        validate_request(&input.request)?;
        let known = self.assets().cedar.policies();
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
        // One set of assets for the evaluation and for what it reports.
        let assets = self.assets();
        let started = Instant::now();
        let outcome = assets
            .cedar
            .evaluate(&input.request, &input.disabled_policies)?;
        let micros = started.elapsed().as_micros() as u64;
        let mut rt = self.lock();
        // An import may have replaced the policies while Cedar was working.
        // A decision made under the old ones has no place on a timeline of
        // the new: it would be shown as an answer the loaded policies gave.
        if !Arc::ptr_eq(&rt.loaded.assets, &assets) {
            return Err(ServiceError::WorkspaceChanged);
        }
        Ok(self.record_locked(
            &mut rt,
            input,
            outcome,
            assets.cedar.engine(),
            micros,
            DataSource::Synthetic,
        ))
    }

    /// Records a decision produced by any engine and places it on the topology.
    pub fn record_decision(
        &self,
        input: EvaluateInput,
        outcome: PolicyDecision,
        engine: EngineInfo,
        evaluation_micros: u64,
        data_source: DataSource,
    ) -> AuthorizationDecision {
        let mut rt = self.lock();
        self.record_locked(
            &mut rt,
            input,
            outcome,
            engine,
            evaluation_micros,
            data_source,
        )
    }

    fn record_locked(
        &self,
        rt: &mut Runtime,
        input: EvaluateInput,
        outcome: PolicyDecision,
        engine: EngineInfo,
        evaluation_micros: u64,
        data_source: DataSource,
    ) -> AuthorizationDecision {
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
            data_source,
        };
        let branched = rt.timeline.issue(Command::RecordDecision {
            decision: Box::new(decision.clone()),
        });
        if branched {
            self.broadcast_timeline(rt, TimelineReason::Branch);
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
        self.assets().worlds.values().map(|w| w.summary()).collect()
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

    /// An incident of the timeline in use, read back from its record.
    pub fn incident_report(&self, incident_id: &str) -> Result<IncidentReport, ServiceError> {
        self.lock()
            .timeline
            .incident_report(incident_id)
            .ok_or_else(|| ServiceError::UnknownIncident(incident_id.to_string()))
    }

    pub fn scenarios(&self) -> Vec<Scenario> {
        self.lock().timeline.scenarios()
    }

    pub fn recordings(&self) -> Vec<RecordingSummary> {
        self.assets()
            .recordings
            .iter()
            .map(|r| r.summary())
            .collect()
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
    let resource_node =
        role(&format!("resource:{}", entity_type(resource))).or_else(|| role("protectedResource"));

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
                stages.push(stage(
                    topo.edge_dst[*edge],
                    PathStageKind::Resource,
                    allowed,
                ));
            }
        }
    }
    let blocked_at = (!allowed).then(|| topo.node_id(authorizer).to_string());
    (stages, hops, blocked_at)
}

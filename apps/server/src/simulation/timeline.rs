//! Event-sourced timeline around the engine.
//!
//! The timeline owns the cursor state plus everything needed to revisit the
//! past: the command log (the only non-derivable input), periodic checkpoints
//! of the full state, the events the engine emitted and a metric history.
//!
//! * **Live**: the cursor sits at the head; stepping extends history.
//! * **Replay**: the cursor sits inside history; stepping re-simulates it from
//!   the nearest checkpoint, re-applying recorded commands at their ticks.
//! * **Branch**: issuing a command while in replay discards the future beyond
//!   the cursor and continues live from there.
//!
//! History is bounded: the oldest checkpoints, events, samples and commands
//! are dropped once the window exceeds [`MAX_HISTORY_TICKS`].

use std::collections::VecDeque;
use std::sync::Arc;

use crate::domain::{
    AuthorizationDecision, DataSource, EdgeColumns, EdgeMetrics, Health, Incident, IncidentPulse,
    InfrastructureEdge, InfrastructureNode, MetricSample, MetricsReport, NodeColumns, NodeMetrics,
    PlaybackMode, PlaybackState, PlaybackStatus, RegionStatus, Scenario, SecurityEvent,
    TelemetrySnapshot, Topology, SCHEMA_VERSION,
};
use crate::incidents::recordings::Recording;
use crate::incidents::ResolvedScenario;

use super::decisions::DecisionTable;
use super::engine::{self, is_ingress, Command, SimState, StepContext};
use super::math::round_to;
use super::model::{SimTopology, TICK_MS};

/// Ticks between checkpoints (5 virtual seconds).
pub const CHECKPOINT_INTERVAL: u64 = 25;
/// Ticks between metric samples (1 virtual second).
pub const METRIC_INTERVAL: u64 = 5;
/// Length of the seekable window (30 virtual minutes).
pub const MAX_HISTORY_TICKS: u64 = 9_000;
/// Upper bound on retained events regardless of the window.
pub const MAX_EVENTS: usize = 8_000;

#[derive(Debug, Clone)]
struct Checkpoint {
    tick: u64,
    state: SimState,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct StepOutcome {
    /// Events produced by this step. Empty while replaying known history.
    pub events: Vec<SecurityEvent>,
    pub live: bool,
}

#[derive(Debug, Clone)]
pub struct Timeline {
    topo: Arc<SimTopology>,
    scenarios: Arc<Vec<ResolvedScenario>>,
    decisions: Arc<DecisionTable>,
    seed: u64,
    state: SimState,
    head_tick: u64,
    commands: Vec<(u64, Command)>,
    events: VecDeque<SecurityEvent>,
    metrics: VecDeque<MetricSample>,
    checkpoints: VecDeque<Checkpoint>,
    recording_id: Option<String>,
}

impl Timeline {
    pub fn new(
        topo: Arc<SimTopology>,
        scenarios: Arc<Vec<ResolvedScenario>>,
        decisions: Arc<DecisionTable>,
        seed: u64,
    ) -> Self {
        let state = SimState::initial(&topo, &decisions, seed);
        let mut timeline = Self {
            topo,
            scenarios,
            decisions,
            seed,
            state: state.clone(),
            head_tick: 0,
            commands: Vec::new(),
            events: VecDeque::new(),
            metrics: VecDeque::new(),
            checkpoints: VecDeque::from([Checkpoint { tick: 0, state }]),
            recording_id: None,
        };
        timeline.metrics.push_back(timeline.sample());
        timeline
    }

    /// Builds a timeline from a prerecorded incident: the recording's commands
    /// are simulated to its end, then the cursor returns to the start so it
    /// can be played back and scrubbed.
    pub fn from_recording(
        topo: Arc<SimTopology>,
        scenarios: Arc<Vec<ResolvedScenario>>,
        decisions: Arc<DecisionTable>,
        recording: &Recording,
    ) -> Self {
        let mut timeline = Self::new(topo, scenarios, decisions, recording.seed);
        timeline.commands = recording
            .commands
            .iter()
            .map(|c| (c.at_ms / TICK_MS, c.command.clone()))
            .collect();
        timeline.commands.sort_by_key(|(tick, _)| *tick);
        let end = (recording.duration_ms / TICK_MS).min(MAX_HISTORY_TICKS);
        while timeline.state.tick < end {
            timeline.step();
        }
        timeline.seek(0);
        timeline.recording_id = Some(recording.id.clone());
        timeline
    }

    pub fn topology(&self) -> &Arc<SimTopology> {
        &self.topo
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn state(&self) -> &SimState {
        &self.state
    }

    pub fn tick(&self) -> u64 {
        self.state.tick
    }

    pub fn head_tick(&self) -> u64 {
        self.head_tick
    }

    pub fn window_start_tick(&self) -> u64 {
        self.checkpoints.front().map_or(0, |c| c.tick)
    }

    pub fn is_live(&self) -> bool {
        self.state.tick == self.head_tick
    }

    pub fn recording_id(&self) -> Option<&str> {
        self.recording_id.as_deref()
    }

    fn sample(&self) -> MetricSample {
        let g = &self.state.global;
        MetricSample {
            tick: self.state.tick,
            virtual_time_ms: self.state.virtual_time_ms(),
            rps: round_to(g.rps, 1),
            avg_latency_ms: round_to(g.avg_latency_ms, 1),
            p95_latency_ms: round_to(g.p95_latency_ms, 1),
            p99_latency_ms: round_to(g.p99_latency_ms, 1),
            error_rate: round_to(g.error_rate, 4),
            authz_denial_rate: round_to(g.authz_denial_rate, 4),
            suspicious_rps: round_to(g.suspicious_rps, 1),
        }
    }

    /// Advances the cursor by one tick.
    pub fn step(&mut self) -> StepOutcome {
        let live = self.is_live();
        let cursor = self.state.tick;
        let commands: Vec<Command> = self
            .commands
            .iter()
            .filter(|(tick, _)| *tick == cursor)
            .map(|(_, command)| command.clone())
            .collect();
        let ctx = StepContext {
            topo: &self.topo,
            scenarios: &self.scenarios,
            decisions: &self.decisions,
        };
        let events = engine::step(&ctx, &mut self.state, &commands);
        if !live {
            return StepOutcome {
                events: Vec::new(),
                live: false,
            };
        }
        self.head_tick = self.state.tick;
        self.events.extend(events.iter().cloned());
        if self.state.tick % METRIC_INTERVAL == 0 {
            self.metrics.push_back(self.sample());
        }
        if self.state.tick % CHECKPOINT_INTERVAL == 0 {
            self.checkpoints.push_back(Checkpoint {
                tick: self.state.tick,
                state: self.state.clone(),
            });
        }
        self.enforce_window();
        StepOutcome { events, live: true }
    }

    fn enforce_window(&mut self) {
        let floor = self.head_tick.saturating_sub(MAX_HISTORY_TICKS);
        while self.checkpoints.len() > 1 && self.checkpoints[1].tick <= floor {
            self.checkpoints.pop_front();
        }
        let start = self.window_start_tick();
        while self.events.front().is_some_and(|e| e.tick < start) || self.events.len() > MAX_EVENTS
        {
            self.events.pop_front();
        }
        while self.metrics.front().is_some_and(|s| s.tick < start) {
            self.metrics.pop_front();
        }
        // The checkpoint at `start` already contains the effect of earlier commands.
        self.commands.retain(|(tick, _)| *tick >= start);
    }

    /// Moves the cursor to `tick` (clamped to the seekable window) by
    /// restoring the nearest earlier checkpoint and re-simulating forward.
    pub fn seek(&mut self, tick: u64) -> u64 {
        let target = tick.clamp(self.window_start_tick(), self.head_tick);
        if target == self.state.tick {
            return target;
        }
        // Stepping forward from the cursor is cheaper when it is close enough.
        let restore = target < self.state.tick
            || self
                .checkpoints
                .iter()
                .any(|c| c.tick > self.state.tick && c.tick <= target);
        if restore {
            if let Some(checkpoint) = self.checkpoints.iter().rev().find(|c| c.tick <= target) {
                self.state = checkpoint.state.clone();
            }
        }
        while self.state.tick < target {
            self.step();
        }
        target
    }

    /// Records a command at the cursor. If the cursor is inside history the
    /// future beyond it is discarded first; returns whether that happened.
    pub fn issue(&mut self, command: Command) -> bool {
        let cursor = self.state.tick;
        let branched = cursor < self.head_tick;
        if branched {
            self.head_tick = cursor;
            self.events.retain(|e| e.tick <= cursor);
            self.metrics.retain(|s| s.tick <= cursor);
            self.checkpoints.retain(|c| c.tick <= cursor);
            // Commands recorded at `cursor` belonged to the discarded future.
            self.commands.retain(|(tick, _)| *tick < cursor);
            self.recording_id = None;
        }
        self.commands.push((cursor, command));
        branched
    }

    /// Discards all history and returns to tick 0 with the same seed.
    pub fn reset(&mut self) {
        *self = Self::new(
            Arc::clone(&self.topo),
            Arc::clone(&self.scenarios),
            Arc::clone(&self.decisions),
            self.seed,
        );
    }

    // -- read models --------------------------------------------------------

    pub fn playback(&self, status: PlaybackStatus, speed: f64) -> PlaybackState {
        PlaybackState {
            status,
            mode: if self.is_live() {
                PlaybackMode::Live
            } else {
                PlaybackMode::Replay
            },
            speed,
            tick: self.state.tick,
            virtual_time_ms: self.state.virtual_time_ms(),
            head_tick: self.head_tick,
            head_time_ms: self.head_tick * TICK_MS,
            window_start_ms: self.window_start_tick() * TICK_MS,
            tick_ms: TICK_MS,
            recording_id: self.recording_id.clone(),
        }
    }

    pub fn scenarios(&self) -> Vec<Scenario> {
        self.scenarios.iter().map(|s| s.info.clone()).collect()
    }

    /// Events inside the retained window. In replay mode this includes events
    /// that lie in the cursor's future; clients tell them apart by tick.
    pub fn events(&self) -> impl DoubleEndedIterator<Item = &SecurityEvent> {
        self.events.iter()
    }

    pub fn incidents(&self) -> &[Incident] {
        &self.state.incidents
    }

    /// Decisions evaluated on demand, up to the cursor.
    pub fn decisions(&self) -> Vec<AuthorizationDecision> {
        let cursor = self.state.tick;
        self.commands
            .iter()
            .filter(|(tick, _)| *tick <= cursor)
            .filter_map(|(_, command)| match command {
                Command::RecordDecision { decision } => Some((**decision).clone()),
                _ => None,
            })
            .collect()
    }

    pub fn metrics(&self) -> MetricsReport {
        MetricsReport {
            schema_version: SCHEMA_VERSION.to_string(),
            data_source: self.topo.spec.data_source,
            current: self.state.global,
            history: self.metrics.iter().copied().collect(),
        }
    }

    fn region_statuses(&self) -> Vec<RegionStatus> {
        let topo = &self.topo;
        topo.spec
            .regions
            .iter()
            .enumerate()
            .map(|(index, region)| {
                let nodes = topo.nodes_in_region(index);
                let unhealthy = nodes
                    .iter()
                    .filter(|n| self.state.health[**n] != Health::Healthy)
                    .count();
                let down = nodes
                    .iter()
                    .filter(|n| self.state.health[**n] == Health::Down)
                    .count();
                let worst = nodes
                    .iter()
                    .map(|n| self.state.health[*n])
                    .max()
                    .unwrap_or(Health::Healthy);
                let health = if !nodes.is_empty() && down * 2 >= nodes.len() {
                    Health::Down
                } else if worst == Health::Down {
                    Health::Critical
                } else {
                    worst
                };
                let ingress: Vec<usize> = nodes
                    .iter()
                    .copied()
                    .filter(|n| is_ingress(topo.node_type[*n]))
                    .collect();
                let rps: f64 = ingress.iter().map(|n| self.state.node_load[*n]).sum();
                let error_rate = if ingress.is_empty() {
                    0.0
                } else {
                    ingress.iter().map(|n| self.state.node_error[*n]).sum::<f64>()
                        / ingress.len() as f64
                };
                RegionStatus {
                    id: region.id.clone(),
                    health,
                    rps: round_to(rps, 1),
                    error_rate: round_to(error_rate, 4),
                    nodes_total: nodes.len() as u32,
                    nodes_unhealthy: unhealthy as u32,
                }
            })
            .collect()
    }

    pub fn telemetry(&self, status: PlaybackStatus, speed: f64) -> TelemetrySnapshot {
        let s = &self.state;
        let column = |values: &[f64], decimals: u32| -> Vec<f64> {
            values.iter().map(|v| round_to(*v, decimals)).collect()
        };
        let mut global = s.global;
        global.rps = round_to(global.rps, 1);
        global.avg_latency_ms = round_to(global.avg_latency_ms, 1);
        global.p50_latency_ms = round_to(global.p50_latency_ms, 1);
        global.p95_latency_ms = round_to(global.p95_latency_ms, 1);
        global.p99_latency_ms = round_to(global.p99_latency_ms, 1);
        global.error_rate = round_to(global.error_rate, 4);
        global.authz_checks_rps = round_to(global.authz_checks_rps, 1);
        global.authz_denial_rate = round_to(global.authz_denial_rate, 4);
        global.rejected_rps = round_to(global.rejected_rps, 1);
        global.suspicious_rps = round_to(global.suspicious_rps, 1);

        let incident = s.scenario.as_ref().map(|rt| {
            let scenario = &self.scenarios[rt.scenario];
            let incident = &s.incidents[rt.incident];
            IncidentPulse {
                id: incident.id.clone(),
                scenario_id: incident.scenario_id.clone(),
                status: incident.status,
                phase_index: incident.phase_index,
                phase_count: scenario.phases.len() as u32,
                phase_name: incident.phase_name.clone(),
                progress: round_to(
                    (s.tick - rt.start_tick) as f64 / scenario.duration_ticks.max(1) as f64,
                    3,
                )
                .clamp(0.0, 1.0),
                impacted_node_ids: incident.impacted_node_ids.clone(),
            }
        });

        TelemetrySnapshot {
            schema_version: SCHEMA_VERSION.to_string(),
            topology_id: self.topo.spec.id.clone(),
            data_source: self.topo.spec.data_source,
            tick: s.tick,
            virtual_time_ms: s.virtual_time_ms(),
            seq: s.seq,
            global,
            nodes: NodeColumns {
                health: s.health.iter().map(|h| h.code()).collect(),
                latency_ms: column(&s.node_latency, 1),
                throughput_rps: column(&s.node_load, 1),
                error_rate: column(&s.node_error, 4),
                saturation: column(&s.node_rho, 3),
                queue_depth: column(&s.queue_depth, 0),
            },
            edges: EdgeColumns {
                traffic_rps: column(&s.edge_traffic, 1),
                latency_ms: column(&s.edge_latency, 1),
                error_rate: column(&s.edge_error, 4),
                rejected_rps: column(&s.edge_rejected, 1),
                suspicious_rps: column(&s.edge_suspicious, 1),
                security_status: s.edge_security.iter().map(|x| x.code()).collect(),
            },
            regions: self.region_statuses(),
            flows: s
                .flows
                .iter()
                .map(|f| {
                    let mut flow = f.clone();
                    flow.rps = round_to(flow.rps, 1);
                    flow.delivered_rps = round_to(flow.delivered_rps, 1);
                    flow
                })
                .collect(),
            incident,
            playback: self.playback(status, speed),
        }
    }

    /// The topology with current metrics merged in.
    pub fn topology_view(&self) -> Topology {
        let topo = &self.topo;
        let s = &self.state;
        let nodes = topo
            .spec
            .nodes
            .iter()
            .enumerate()
            .map(|(i, node)| {
                let mut connected: Vec<String> = topo.out_edges[i]
                    .iter()
                    .map(|e| topo.node_id(topo.edge_dst[*e]).to_string())
                    .chain(
                        topo.in_edges[i]
                            .iter()
                            .map(|e| topo.node_id(topo.edge_src[*e]).to_string()),
                    )
                    .collect();
                connected.sort();
                connected.dedup();
                InfrastructureNode {
                    id: node.id.clone(),
                    name: node.name.clone(),
                    service_type: node.service_type,
                    region: node.region.clone(),
                    environment: node.environment,
                    tier: node.tier,
                    description: node.description.clone(),
                    data_source: topo.spec.data_source,
                    capacity_rps: if topo.capacity[i].is_finite() {
                        round_to(topo.capacity[i], 1)
                    } else {
                        0.0
                    },
                    baseline_latency_ms: round_to(topo.baseline_latency[i], 1),
                    connected_services: connected,
                    metrics: NodeMetrics {
                        health: s.health[i],
                        latency_ms: round_to(s.node_latency[i], 1),
                        throughput_rps: round_to(s.node_load[i], 1),
                        error_rate: round_to(s.node_error[i], 4),
                        saturation: round_to(s.node_rho[i], 3),
                        queue_depth: round_to(s.queue_depth[i], 0),
                    },
                }
            })
            .collect();
        let edges = topo
            .spec
            .edges
            .iter()
            .enumerate()
            .map(|(i, edge)| InfrastructureEdge {
                id: topo.edge_ids[i].clone(),
                source: edge.source.clone(),
                target: edge.target.clone(),
                protocol: edge.protocol,
                relationship: edge.relationship,
                weight: edge.weight,
                cross_region: topo.edge_cross_region[i],
                metrics: EdgeMetrics {
                    traffic_rps: round_to(s.edge_traffic[i], 1),
                    latency_ms: round_to(s.edge_latency[i], 1),
                    error_rate: round_to(s.edge_error[i], 4),
                    rejected_rps: round_to(s.edge_rejected[i], 1),
                    suspicious_rps: round_to(s.edge_suspicious[i], 1),
                    security_status: s.edge_security[i],
                },
            })
            .collect();
        Topology {
            schema_version: SCHEMA_VERSION.to_string(),
            id: topo.spec.id.clone(),
            name: topo.spec.name.clone(),
            description: topo.spec.description.clone(),
            data_source: topo.spec.data_source,
            regions: topo.spec.regions.clone(),
            roles: topo.spec.roles.clone(),
            nodes,
            edges,
        }
    }

    pub fn data_source(&self) -> DataSource {
        self.topo.spec.data_source
    }
}

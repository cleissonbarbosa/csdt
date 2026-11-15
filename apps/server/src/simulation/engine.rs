//! The deterministic simulation step.
//!
//! [`step`] is a pure function of `(topology, scenarios, decisions, state,
//! commands)`: it never reads a clock, never allocates ids from global
//! counters and draws randomness only from the generator stored in the state.
//! Re-running it from a checkpoint with the same commands therefore
//! reproduces history bit for bit, which is what time travel relies on.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::domain::{
    AuthorizationDecision, DataSource, Decision, EventKind, GlobalMetrics, Health, HealthCounts,
    ImportedEvent, Incident, IncidentStatus, RejectReason, Relationship, SecurityEvent,
    SecurityStatus, ServiceType, Severity, TrafficCategory, TrafficEvent,
};
use crate::incidents::ResolvedScenario;

use super::channels::{ChannelKey, ChannelSet};
use super::decisions::{DecisionTable, EvaluatedRequest};
use super::math::fnv1a;
use super::model::{combine_failures, propagate, Flow, Modifiers, SimTopology, DT, TICK_MS};
use super::rng::Rng;

/// Exponential smoothing applied to displayed metrics, per tick.
const SMOOTHING: f64 = 0.35;
/// Ticks a worse health must persist before the node transitions.
const DWELL_WORSEN: u8 = 2;
/// Ticks a better health must persist before the node transitions.
const DWELL_IMPROVE: u8 = 6;
/// Ticks between sampled baseline authorization decision events.
const AUTHZ_SAMPLE_TICKS: u64 = 20;
/// Ticks between decision events of an active scenario flow.
const AUTHZ_FLOW_TICKS: u64 = 12;
/// Ramp used when a scenario ends or is aborted.
const RELEASE_RAMP_TICKS: u32 = 10;

const ALERT_ERROR_RATE: usize = 0;
const ALERT_DENIALS: usize = 1;
const ALERT_SUSPICIOUS: usize = 2;
const ALERT_LATENCY: usize = 3;

/// An input to the simulation, recorded on the timeline with the tick at
/// which it was issued.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    #[serde(rename_all = "camelCase")]
    StartScenario { scenario_id: String },
    AbortScenario,
    /// An authorization decision evaluated on demand by an operator.
    RecordDecision { decision: Box<AuthorizationDecision> },
    /// Events imported from a fixture-backed provider.
    #[serde(rename_all = "camelCase")]
    ImportEvents {
        provider_id: String,
        events: Vec<ImportedEvent>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScenarioRuntime {
    pub scenario: usize,
    pub incident: usize,
    pub start_tick: u64,
    pub phase: usize,
    pub phase_entered_tick: u64,
}

/// The complete dynamic state of a simulation. Cloning it is a checkpoint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SimState {
    pub tick: u64,
    pub seq: u64,
    pub rng: Rng,
    pub queue_depth: Vec<f64>,
    pub prev_err_eff: Vec<f64>,
    // Displayed (smoothed) node metrics.
    pub node_latency: Vec<f64>,
    pub node_error: Vec<f64>,
    pub node_load: Vec<f64>,
    pub node_rho: Vec<f64>,
    pub health: Vec<Health>,
    pub pending_health: Vec<(Health, u8)>,
    // Displayed (smoothed) edge metrics.
    pub edge_traffic: Vec<f64>,
    pub edge_latency: Vec<f64>,
    pub edge_error: Vec<f64>,
    pub edge_rejected: Vec<f64>,
    pub edge_suspicious: Vec<f64>,
    pub edge_security: Vec<SecurityStatus>,
    pub global: GlobalMetrics,
    pub flows: Vec<TrafficEvent>,
    pub channels: ChannelSet,
    pub scenario: Option<ScenarioRuntime>,
    pub incidents: Vec<Incident>,
    pub alerts: [bool; 4],
}

impl SimState {
    /// State at tick 0: the platform at nominal load.
    pub fn initial(topo: &SimTopology, decisions: &DecisionTable, seed: u64) -> Self {
        let n = topo.node_count();
        let m = topo.edge_count();
        let neutral = Modifiers::neutral(topo);
        let mut queue_depth = vec![0.0; n];
        let zero = vec![0.0; n];
        let flow = propagate(topo, &neutral, &mut queue_depth, &zero, DT);
        let mut state = Self {
            tick: 0,
            seq: 0,
            rng: Rng::seeded(seed),
            queue_depth,
            prev_err_eff: flow.err_eff.clone(),
            node_latency: flow.lat_eff.clone(),
            node_error: flow.err_eff.clone(),
            node_load: flow.load.clone(),
            node_rho: flow.rho.clone(),
            health: vec![Health::Healthy; n],
            pending_health: vec![(Health::Healthy, 0); n],
            edge_traffic: flow.edge_flow.clone(),
            edge_latency: topo.edge_latency.clone(),
            edge_error: vec![0.0; m],
            edge_rejected: vec![0.0; m],
            edge_suspicious: vec![0.0; m],
            edge_security: vec![SecurityStatus::Secure; m],
            global: GlobalMetrics::default(),
            flows: Vec::new(),
            channels: ChannelSet::default(),
            scenario: None,
            incidents: Vec::new(),
            alerts: [false; 4],
        };
        // Populate edge and global figures so tick 0 is already consistent.
        let traffic = EdgeTraffic::baseline(topo, decisions, &flow);
        for e in 0..m {
            state.edge_error[e] = traffic.error[e];
            state.edge_rejected[e] = traffic.rejected[e];
            state.edge_security[e] = traffic.security[e];
        }
        state.global = global_metrics(topo, &neutral, &flow, &traffic, &state.health, 0);
        state
    }

    /// Cheap fingerprint of the entire state, used to verify determinism.
    pub fn digest(&self) -> u64 {
        // Serialising to JSON is deterministic here: only vectors and structs.
        fnv1a(&serde_json::to_vec(self).unwrap_or_default())
    }

    pub fn virtual_time_ms(&self) -> u64 {
        self.tick * TICK_MS
    }

    pub fn active_incident(&self) -> Option<&Incident> {
        self.scenario
            .as_ref()
            .and_then(|rt| self.incidents.get(rt.incident))
    }
}

pub struct StepContext<'a> {
    pub topo: &'a SimTopology,
    pub scenarios: &'a [ResolvedScenario],
    pub decisions: &'a DecisionTable,
}

/// Collects events and assigns their sequence numbers.
struct Emitter {
    seq: u64,
    tick: u64,
    out: Vec<SecurityEvent>,
}

struct Emit {
    severity: Severity,
    kind: EventKind,
    title: String,
    message: String,
    node_ids: Vec<String>,
    edge_ids: Vec<String>,
    incident_id: Option<String>,
    data_source: DataSource,
    details: serde_json::Value,
}

impl Emit {
    fn new(severity: Severity, kind: EventKind, title: impl Into<String>) -> Self {
        Self {
            severity,
            kind,
            title: title.into(),
            message: String::new(),
            node_ids: Vec::new(),
            edge_ids: Vec::new(),
            incident_id: None,
            data_source: DataSource::Synthetic,
            details: serde_json::Value::Null,
        }
    }

    fn message(mut self, message: impl Into<String>) -> Self {
        self.message = message.into();
        self
    }

    fn nodes(mut self, node_ids: Vec<String>) -> Self {
        self.node_ids = node_ids;
        self
    }

    fn incident(mut self, incident_id: Option<String>) -> Self {
        self.incident_id = incident_id;
        self
    }

    fn details(mut self, details: serde_json::Value) -> Self {
        self.details = details;
        self
    }

    fn source(mut self, data_source: DataSource) -> Self {
        self.data_source = data_source;
        self
    }
}

impl Emitter {
    fn push(&mut self, emit: Emit) {
        self.seq += 1;
        self.out.push(SecurityEvent {
            seq: self.seq,
            id: format!("evt-{}", self.seq),
            tick: self.tick,
            virtual_time_ms: self.tick * TICK_MS,
            severity: emit.severity,
            kind: emit.kind,
            title: emit.title,
            message: emit.message,
            node_ids: emit.node_ids,
            edge_ids: emit.edge_ids,
            incident_id: emit.incident_id,
            data_source: emit.data_source,
            details: emit.details,
        });
    }
}

fn ids(topo: &SimTopology, nodes: &[usize]) -> Vec<String> {
    nodes.iter().map(|n| topo.node_id(*n).to_string()).collect()
}

/// Per-edge figures derived from one propagation pass.
struct EdgeTraffic {
    traffic: Vec<f64>,
    latency: Vec<f64>,
    error: Vec<f64>,
    rejected: Vec<f64>,
    suspicious: Vec<f64>,
    security: Vec<SecurityStatus>,
    authz_checks: f64,
    authz_denials: f64,
}

/// What injected path flows add on top of ordinary traffic.
#[derive(Default)]
struct Injected {
    traffic: Vec<f64>,
    rejected: Vec<f64>,
    suspicious: Vec<f64>,
    reason: Vec<Option<RejectReason>>,
    authz_checks: f64,
    authz_denials: f64,
    total_rps: f64,
    suspicious_rps: f64,
    flows: Vec<TrafficEvent>,
}

impl Injected {
    fn none(topo: &SimTopology) -> Self {
        let m = topo.edge_count();
        Self {
            traffic: vec![0.0; m],
            rejected: vec![0.0; m],
            suspicious: vec![0.0; m],
            reason: vec![None; m],
            ..Self::default()
        }
    }
}

/// How much of a node's capacity a rejected request still consumes.
fn rejection_cost(reason: RejectReason) -> f64 {
    match reason {
        RejectReason::Waf | RejectReason::RateLimit => 0.05,
        RejectReason::SessionRevoked => 0.3,
        // A failed login still costs a password hash; a denied request still
        // costs a full policy evaluation.
        RejectReason::AuthFailure | RejectReason::PolicyDeny => 1.0,
    }
}

impl EdgeTraffic {
    fn baseline(topo: &SimTopology, decisions: &DecisionTable, flow: &Flow) -> Self {
        Self::derive(
            topo,
            decisions,
            &Modifiers::neutral(topo),
            flow,
            &Injected::none(topo),
        )
    }

    fn derive(
        topo: &SimTopology,
        decisions: &DecisionTable,
        m: &Modifiers,
        flow: &Flow,
        injected: &Injected,
    ) -> Self {
        let count = topo.edge_count();
        let mut out = Self {
            traffic: vec![0.0; count],
            latency: vec![0.0; count],
            error: vec![0.0; count],
            rejected: vec![0.0; count],
            suspicious: injected.suspicious.clone(),
            security: vec![SecurityStatus::Secure; count],
            authz_checks: injected.authz_checks,
            authz_denials: injected.authz_denials,
        };
        for e in 0..count {
            let rel = topo.edge_rel[e];
            let dst = topo.edge_dst[e];
            let ordinary = flow.edge_flow[e];
            let mut rejected = injected.rejected[e];
            if rel == Relationship::Authz {
                // Baseline authorization traffic: denied at the real Cedar
                // deny fraction of the evaluated request mix.
                let denied = ordinary * decisions.baseline_deny_fraction;
                rejected += denied;
                out.authz_checks += ordinary;
                out.authz_denials += denied;
            }
            let total = ordinary + injected.traffic[e];
            out.traffic[e] = total;
            out.latency[e] = topo.edge_latency[e] * m.edge_lat_factor[e].max(0.0);
            out.error[e] = if rel.is_sync() {
                combine_failures(flow.err_eff[dst], m.edge_err_inject[e])
            } else {
                flow.own_err[dst]
            };
            out.rejected[e] = rejected;

            let share = |x: f64| if total > 1e-9 { x / total } else { 0.0 };
            out.security[e] = if share(injected.rejected[e]) > 0.25 {
                match injected.reason[e] {
                    Some(RejectReason::Waf | RejectReason::RateLimit) => SecurityStatus::Throttled,
                    _ => SecurityStatus::Denied,
                }
            } else if share(injected.suspicious[e]) > 0.2 {
                SecurityStatus::Suspicious
            } else if matches!(rel, Relationship::Auth | Relationship::Authz) {
                SecurityStatus::Authorized
            } else {
                SecurityStatus::Secure
            };
        }
        out
    }
}

fn global_metrics(
    topo: &SimTopology,
    m: &Modifiers,
    flow: &Flow,
    traffic: &EdgeTraffic,
    health: &[Health],
    active_incidents: u32,
) -> GlobalMetrics {
    let legit: f64 = topo.clients.iter().map(|c| m.demand[*c]).sum();
    let failed: f64 = topo
        .clients
        .iter()
        .map(|c| m.demand[*c] * flow.err_eff[*c])
        .sum();
    let mixture = topo.latency_mixture(&m.demand, &flow.lat_eff);
    let mut counts = HealthCounts::default();
    for h in health {
        match h {
            Health::Healthy => counts.healthy += 1,
            Health::Degraded => counts.degraded += 1,
            Health::Critical => counts.critical += 1,
            Health::Down => counts.down += 1,
        }
    }
    GlobalMetrics {
        rps: legit,
        avg_latency_ms: mixture.mean(),
        p50_latency_ms: mixture.quantile(0.5),
        p95_latency_ms: mixture.quantile(0.95),
        p99_latency_ms: mixture.quantile(0.99),
        error_rate: if legit > 1e-9 { failed / legit } else { 0.0 },
        authz_checks_rps: traffic.authz_checks,
        authz_denial_rate: if traffic.authz_checks > 1e-9 {
            traffic.authz_denials / traffic.authz_checks
        } else {
            0.0
        },
        rejected_rps: traffic.rejected.iter().sum(),
        suspicious_rps: 0.0,
        active_incidents,
        health: counts,
    }
}

fn classify(topo: &SimTopology, state: &SimState, node: usize, down: bool) -> Health {
    if down {
        return Health::Down;
    }
    let error = state.node_error[node];
    let rho = state.node_rho[node];
    if topo.node_type[node].is_queue() {
        let fill = state.queue_depth[node] / topo.queue_capacity[node].max(1.0);
        return if fill >= 0.7 || error >= 0.2 {
            Health::Critical
        } else if fill >= 0.2 || error >= 0.04 {
            Health::Degraded
        } else {
            Health::Healthy
        };
    }
    let baseline = topo.baseline_latency[node].max(1.0);
    let ratio = state.node_latency[node] / baseline;
    if error >= 0.2 || ratio >= 6.0 || rho >= 1.2 {
        Health::Critical
    } else if error >= 0.04 || ratio >= 2.2 || rho >= 0.88 {
        Health::Degraded
    } else {
        Health::Healthy
    }
}

fn enter_phase(ctx: &StepContext, state: &mut SimState, index: usize, em: &mut Emitter) {
    let Some(rt) = state.scenario.as_mut() else {
        return;
    };
    let scenario = &ctx.scenarios[rt.scenario];
    let phase = &scenario.phases[index];
    rt.phase = index;
    rt.phase_entered_tick = em.tick;
    state
        .channels
        .retarget(&phase.targets, em.tick, phase.ramp_ticks);
    let incident = &mut state.incidents[rt.incident];
    incident.phase_index = index as u32;
    incident.phase_name = phase.name.clone();
    incident.status = phase.status;
    let severity = match phase.status {
        IncidentStatus::Active => scenario.info.severity,
        IncidentStatus::Mitigating => Severity::Notice,
        IncidentStatus::Recovering | IncidentStatus::Resolved => Severity::Info,
    };
    em.push(
        Emit::new(
            severity,
            EventKind::IncidentPhase,
            format!("{} · {}", scenario.info.name, phase.name),
        )
        .message(phase.description.clone())
        .nodes(ids(ctx.topo, &scenario.targets))
        .incident(Some(incident.id.clone()))
        .details(json!({
            "scenarioId": scenario.info.id,
            "phaseIndex": index,
            "phaseName": phase.name,
            "status": phase.status,
        })),
    );
}

fn close_scenario(ctx: &StepContext, state: &mut SimState, em: &mut Emitter, reason: &str) {
    let Some(rt) = state.scenario.take() else {
        return;
    };
    let scenario = &ctx.scenarios[rt.scenario];
    state.channels.retarget(&[], em.tick, RELEASE_RAMP_TICKS);
    let incident = &mut state.incidents[rt.incident];
    incident.status = IncidentStatus::Resolved;
    incident.resolved_at_ms = Some(em.tick * TICK_MS);
    em.push(
        Emit::new(
            Severity::Info,
            EventKind::IncidentResolved,
            format!("{} resolved", scenario.info.name),
        )
        .message(reason.to_string())
        .nodes(ids(ctx.topo, &scenario.targets))
        .incident(Some(incident.id.clone()))
        .details(json!({
            "scenarioId": scenario.info.id,
            "impactedNodeIds": incident.impacted_node_ids,
        })),
    );
}

fn start_scenario(ctx: &StepContext, state: &mut SimState, scenario_id: &str, em: &mut Emitter) {
    let Some(index) = ctx
        .scenarios
        .iter()
        .position(|s| s.info.id == scenario_id && s.info.available)
    else {
        em.push(
            Emit::new(Severity::Warning, EventKind::System, "Scenario unavailable").message(
                format!("`{scenario_id}` cannot run on the active topology."),
            ),
        );
        return;
    };
    close_scenario(ctx, state, em, "Superseded by a new scenario.");
    let scenario = &ctx.scenarios[index];
    let incident_id = format!("inc-{:03}", state.incidents.len() + 1);
    state.incidents.push(Incident {
        id: incident_id.clone(),
        scenario_id: scenario.info.id.clone(),
        title: scenario.info.name.clone(),
        severity: scenario.info.severity,
        status: IncidentStatus::Active,
        started_at_ms: em.tick * TICK_MS,
        resolved_at_ms: None,
        phase_index: 0,
        phase_name: String::new(),
        root_cause_node_id: scenario
            .root_cause
            .map(|n| ctx.topo.node_id(n).to_string()),
        impacted_node_ids: Vec::new(),
        summary: scenario.info.summary.clone(),
    });
    state.scenario = Some(ScenarioRuntime {
        scenario: index,
        incident: state.incidents.len() - 1,
        start_tick: em.tick,
        phase: 0,
        phase_entered_tick: em.tick,
    });
    em.push(
        Emit::new(
            scenario.info.severity,
            EventKind::IncidentStarted,
            format!("{} started", scenario.info.name),
        )
        .message(scenario.info.summary.clone())
        .nodes(ids(ctx.topo, &scenario.targets))
        .incident(Some(incident_id))
        .details(json!({ "scenarioId": scenario.info.id })),
    );
    enter_phase(ctx, state, 0, em);
}

fn apply_command(ctx: &StepContext, state: &mut SimState, command: &Command, em: &mut Emitter) {
    match command {
        Command::StartScenario { scenario_id } => start_scenario(ctx, state, scenario_id, em),
        Command::AbortScenario => close_scenario(ctx, state, em, "Stopped by the operator."),
        Command::RecordDecision { decision } => {
            let denied = decision.decision == Decision::Deny;
            let node_ids = decision
                .path
                .iter()
                .filter(|stage| stage.reached)
                .map(|stage| stage.node_id.clone())
                .collect();
            em.push(
                Emit::new(
                    if denied {
                        Severity::Warning
                    } else {
                        Severity::Notice
                    },
                    EventKind::AuthzDecision,
                    format!(
                        "{} · {} → {}",
                        if denied { "Deny" } else { "Allow" },
                        decision.request.principal,
                        decision.request.action
                    ),
                )
                .message(format!(
                    "Evaluated on demand against {}.",
                    decision.request.resource
                ))
                .nodes(node_ids)
                .details(json!({ "origin": "explorer", "decision": decision })),
            );
        }
        Command::ImportEvents {
            provider_id,
            events,
        } => {
            for event in events {
                em.push(
                    Emit::new(event.severity, event.kind, event.title.clone())
                        .message(event.message.clone())
                        .nodes(event.node_ids.clone())
                        .source(event.data_source)
                        .details(json!({ "providerId": provider_id, "payload": event.details })),
                );
            }
        }
    }
}

fn advance_scenario(ctx: &StepContext, state: &mut SimState, em: &mut Emitter) {
    let Some(rt) = state.scenario.clone() else {
        return;
    };
    let scenario = &ctx.scenarios[rt.scenario];
    let elapsed = em.tick - rt.start_tick;
    if elapsed >= scenario.duration_ticks {
        close_scenario(ctx, state, em, "The scenario ran to completion.");
        return;
    }
    let mut phase = rt.phase;
    while phase + 1 < scenario.phases.len() && elapsed >= scenario.phases[phase + 1].at_tick {
        phase += 1;
        enter_phase(ctx, state, phase, em);
    }
    let Some(rt) = state.scenario.as_ref() else {
        return;
    };
    let in_phase = em.tick - rt.phase_entered_tick;
    let incident_id = state.incidents[rt.incident].id.clone();
    for event in &scenario.phases[rt.phase].events {
        if event.delay_ticks == in_phase {
            em.push(
                Emit::new(event.severity, event.kind, event.title.clone())
                    .message(event.message.clone())
                    .nodes(ids(ctx.topo, &event.nodes))
                    .incident(Some(incident_id.clone())),
            );
        }
    }
}

fn build_modifiers(topo: &SimTopology, state: &mut SimState) -> Modifiers {
    let mut m = Modifiers::neutral(topo);
    let t = state.tick as f64 * DT;
    for (i, &client) in topo.clients.iter().enumerate() {
        let phase = i as f64 * 1.7;
        let wave = 1.0
            + 0.10 * (std::f64::consts::TAU * t / 97.0 + phase).sin()
            + 0.04 * (std::f64::consts::TAU * t / 23.0 + phase * 2.0).sin();
        // Always draw, so the random stream does not depend on demand.
        let noise = 1.0 + 0.03 * state.rng.next_signed();
        m.demand[client] = topo.base_demand[client] * wave * noise;
    }
    let mut shifts = Vec::new();
    for channel in state.channels.iter() {
        let v = channel.current;
        match channel.key {
            ChannelKey::Demand(n) => m.demand[n as usize] *= v.max(0.0),
            ChannelKey::Capacity(n) => m.cap_factor[n as usize] *= v.max(0.0),
            ChannelKey::Latency(n) => m.lat_factor[n as usize] *= v.max(0.0),
            ChannelKey::ErrorInject(n) => {
                m.err_inject[n as usize] = combine_failures(m.err_inject[n as usize], v);
            }
            ChannelKey::Down(n) => m.down[n as usize] = v > 0.5,
            ChannelKey::EdgeWeight(e) => m.edge_weight[e as usize] *= v.max(0.0),
            ChannelKey::EdgeLatency(e) => m.edge_lat_factor[e as usize] *= v.max(0.0),
            ChannelKey::EdgeError(e) => {
                m.edge_err_inject[e as usize] = combine_failures(m.edge_err_inject[e as usize], v);
            }
            ChannelKey::RouteShift(from, to) => shifts.push((from as usize, to as usize, v)),
            ChannelKey::FlowRate(_) | ChannelKey::FlowReject(..) => {}
        }
    }
    // Shifts apply after weight factors so they move effective weight.
    for (from, to, fraction) in shifts {
        let moved = m.edge_weight[from] * fraction.clamp(0.0, 1.0);
        m.edge_weight[from] -= moved;
        m.edge_weight[to] += moved;
    }
    m
}

fn inject_flows(ctx: &StepContext, state: &SimState, m: &mut Modifiers) -> Injected {
    let topo = ctx.topo;
    let mut injected = Injected::none(topo);
    let Some(rt) = state.scenario.as_ref() else {
        return injected;
    };
    let scenario = &ctx.scenarios[rt.scenario];
    for (index, flow) in scenario.flows.iter().enumerate() {
        let rate = state.channels.value(ChannelKey::FlowRate(index as u16));
        if rate <= 0.01 {
            continue;
        }
        let mut remaining = rate;
        let mut blocked: Option<(usize, RejectReason, f64)> = None;
        for (position, &edge) in flow.hops.iter().enumerate() {
            let dst = topo.edge_dst[edge];
            injected.traffic[edge] += remaining;
            if flow.suspicious {
                injected.suspicious[edge] += remaining;
            }
            let mut reject = state
                .channels
                .value(ChannelKey::FlowReject(index as u16, dst as u32))
                .clamp(0.0, 1.0);
            let mut reason = flow.reject_reason(dst).filter(|_| reject > 0.0);
            if let Some(binding) = flow.authz.as_ref().filter(|b| b.node == dst) {
                injected.authz_checks += remaining * (1.0 - reject);
                if binding.deny {
                    injected.authz_denials += remaining * (1.0 - reject);
                    reject = 1.0;
                    reason = Some(RejectReason::PolicyDeny);
                }
            }
            let rejected = remaining * reject;
            let survivors = remaining - rejected;
            if let Some(reason) = reason.filter(|_| rejected > 0.0) {
                injected.rejected[edge] += rejected;
                let strongest = injected.reason[edge].is_none_or(|current| {
                    rejection_cost(reason) >= rejection_cost(current)
                });
                if strongest {
                    injected.reason[edge] = Some(reason);
                }
                if blocked.is_none_or(|(_, _, share)| reject > share) {
                    blocked = Some((dst, reason, reject));
                }
                m.path_load[dst] += rejected * rejection_cost(reason);
            }
            let last = position + 1 == flow.hops.len();
            if last && flow.spill {
                m.spill_in[dst] += survivors;
            } else {
                m.path_load[dst] += survivors;
            }
            remaining = survivors;
        }
        injected.total_rps += rate;
        if flow.suspicious {
            injected.suspicious_rps += rate;
        }
        injected.flows.push(TrafficEvent {
            id: flow.id.clone(),
            label: flow.label.clone(),
            category: if flow.suspicious {
                TrafficCategory::Suspicious
            } else if flow.authz.is_some() {
                TrafficCategory::Authorization
            } else {
                TrafficCategory::Request
            },
            hops: flow
                .hops
                .iter()
                .map(|e| topo.edge_ids[*e].clone())
                .collect(),
            rps: rate,
            delivered_rps: remaining,
            blocked_at: blocked
                .filter(|(_, _, share)| *share > 0.5)
                .map(|(node, _, _)| topo.node_id(node).to_string()),
            blocked_reason: blocked
                .filter(|(_, _, share)| *share > 0.5)
                .map(|(_, reason, _)| reason),
        });
    }
    injected
}

fn smooth(current: &mut [f64], target: &[f64]) {
    for (value, goal) in current.iter_mut().zip(target) {
        *value += SMOOTHING * (goal - *value);
    }
}

fn decision_details(evaluated: &EvaluatedRequest, decisions: &DecisionTable) -> serde_json::Value {
    json!({
        "origin": "traffic",
        "requestId": evaluated.id,
        "request": evaluated.request,
        "decision": evaluated.outcome.decision,
        "determiningPolicies": evaluated.outcome.determining_policies,
        "errors": evaluated.outcome.errors,
        "engine": decisions.engine,
    })
}

fn decision_title(evaluated: &EvaluatedRequest) -> String {
    format!(
        "{} · {} → {}",
        if evaluated.outcome.decision == Decision::Deny {
            "Deny"
        } else {
            "Allow"
        },
        evaluated.request.principal,
        evaluated.request.action
    )
}

fn emit_authz_samples(ctx: &StepContext, state: &mut SimState, em: &mut Emitter) {
    let topo = ctx.topo;
    let tick = state.tick;
    if tick % AUTHZ_SAMPLE_TICKS == 0 {
        // Draw unconditionally to keep the stream independent of the table.
        let roll_request = state.rng.next_f64();
        let roll_node = state.rng.next_f64();
        if !ctx.decisions.mix.is_empty() && !topo.authorizers.is_empty() {
            let total: f64 = ctx.decisions.mix.iter().map(|e| e.weight).sum();
            let mut cursor = roll_request * total;
            let mut picked = &ctx.decisions.mix[ctx.decisions.mix.len() - 1];
            for entry in &ctx.decisions.mix {
                if cursor < entry.weight {
                    picked = entry;
                    break;
                }
                cursor -= entry.weight;
            }
            let node = topo.authorizers
                [((roll_node * topo.authorizers.len() as f64) as usize).min(topo.authorizers.len() - 1)];
            let denied = picked.outcome.decision == Decision::Deny;
            em.push(
                Emit::new(
                    if denied {
                        Severity::Notice
                    } else {
                        Severity::Info
                    },
                    EventKind::AuthzDecision,
                    decision_title(picked),
                )
                .message(format!("Sampled from baseline traffic on {}.", picked.request.resource))
                .nodes(vec![topo.node_id(node).to_string()])
                .details(decision_details(picked, ctx.decisions)),
            );
        }
    }

    let Some(rt) = state.scenario.as_ref() else {
        return;
    };
    let scenario = &ctx.scenarios[rt.scenario];
    let incident_id = state.incidents[rt.incident].id.clone();
    for (index, flow) in scenario.flows.iter().enumerate() {
        let Some(binding) = flow.authz.as_ref() else {
            continue;
        };
        // Stagger flows so their decisions do not all land on one tick.
        if (tick + index as u64 * 3) % AUTHZ_FLOW_TICKS != 0 {
            continue;
        }
        let rate = state.channels.value(ChannelKey::FlowRate(index as u16));
        let reaches_authorizer = flow
            .hops
            .iter()
            .take_while(|e| topo.edge_dst[**e] != binding.node)
            .all(|e| {
                state
                    .channels
                    .value(ChannelKey::FlowReject(index as u16, topo.edge_dst[*e] as u32))
                    < 0.999
            });
        if rate <= 1.0 || !reaches_authorizer {
            continue;
        }
        let Some(evaluated) = ctx.decisions.scenario.get(&binding.request_id) else {
            continue;
        };
        let denied = evaluated.outcome.decision == Decision::Deny;
        let mut nodes = vec![topo.node_id(binding.node).to_string()];
        if let Some(last) = flow.hops.last() {
            let resource = topo.node_id(topo.edge_dst[*last]).to_string();
            if !denied && !nodes.contains(&resource) {
                nodes.push(resource);
            }
        }
        em.push(
            Emit::new(
                if denied {
                    Severity::Warning
                } else {
                    Severity::Notice
                },
                EventKind::AuthzDecision,
                decision_title(evaluated),
            )
            .message(format!(
                "{} on {}.",
                if denied {
                    "Request blocked at the authorizer"
                } else {
                    "Request permitted"
                },
                evaluated.request.resource
            ))
            .nodes(nodes)
            .incident(Some(incident_id.clone()))
            .details(decision_details(evaluated, ctx.decisions)),
        );
    }
}

fn evaluate_alerts(ctx: &StepContext, state: &mut SimState, em: &mut Emitter) {
    let topo = ctx.topo;
    let monitor = topo
        .role_node("securityMonitor")
        .map(|n| vec![topo.node_id(n).to_string()])
        .unwrap_or_default();
    let incident_id = state.active_incident().map(|i| i.id.clone());
    let g = state.global;
    let deny_base = ctx.decisions.baseline_deny_fraction;
    let suspicious_share = if g.rps > 1e-9 {
        g.suspicious_rps / (g.rps + g.suspicious_rps)
    } else {
        0.0
    };
    let latency_ratio = g.p95_latency_ms / topo.baseline_p95.max(1.0);

    // (slot, value, raise at, clear below, raised title, cleared title, detail)
    let rules: [(usize, f64, f64, f64, &str, &str, String); 4] = [
        (
            ALERT_ERROR_RATE,
            g.error_rate,
            0.05,
            0.02,
            "Error budget burning",
            "Error rate back within objective",
            format!("{:.1} % of client requests are failing.", g.error_rate * 100.0),
        ),
        (
            ALERT_DENIALS,
            g.authz_denial_rate,
            deny_base + 0.10,
            deny_base + 0.04,
            "Authorization denial spike",
            "Authorization denials back to baseline",
            format!(
                "{:.1} % of authorization checks are denied (baseline {:.1} %).",
                g.authz_denial_rate * 100.0,
                deny_base * 100.0
            ),
        ),
        (
            ALERT_SUSPICIOUS,
            suspicious_share,
            0.15,
            0.05,
            "Suspicious traffic surge",
            "Suspicious traffic subsided",
            format!(
                "{:.0} % of inbound requests come from flagged sources.",
                suspicious_share * 100.0
            ),
        ),
        (
            ALERT_LATENCY,
            latency_ratio,
            2.5,
            1.5,
            "Latency objective breached",
            "Latency back within objective",
            format!("p95 latency is {:.0} ms.", g.p95_latency_ms),
        ),
    ];
    for (slot, value, raise, clear, raised, cleared, detail) in rules {
        if !state.alerts[slot] && value >= raise {
            state.alerts[slot] = true;
            em.push(
                Emit::new(
                    if slot == ALERT_ERROR_RATE && value >= 0.15 {
                        Severity::Critical
                    } else {
                        Severity::Warning
                    },
                    EventKind::Alert,
                    raised,
                )
                .message(detail)
                .nodes(monitor.clone())
                .incident(incident_id.clone())
                .details(json!({ "rule": slot, "value": value, "threshold": raise })),
            );
        } else if state.alerts[slot] && value < clear {
            state.alerts[slot] = false;
            em.push(
                Emit::new(Severity::Info, EventKind::Alert, cleared)
                    .message(detail)
                    .nodes(monitor.clone())
                    .incident(incident_id.clone())
                    .details(json!({ "rule": slot, "value": value, "threshold": clear })),
            );
        }
    }
}

/// Advances the simulation by one tick and returns the events it produced.
pub fn step(ctx: &StepContext, state: &mut SimState, commands: &[Command]) -> Vec<SecurityEvent> {
    let topo = ctx.topo;
    let mut em = Emitter {
        seq: state.seq,
        tick: state.tick + 1,
        out: Vec::new(),
    };

    for command in commands {
        apply_command(ctx, state, command, &mut em);
    }
    state.tick += 1;
    advance_scenario(ctx, state, &mut em);
    state.channels.advance(state.tick);

    let mut modifiers = build_modifiers(topo, state);
    let injected = inject_flows(ctx, state, &mut modifiers);
    let flow = propagate(
        topo,
        &modifiers,
        &mut state.queue_depth,
        &state.prev_err_eff,
        DT,
    );
    state.prev_err_eff.clone_from(&flow.err_eff);
    let traffic = EdgeTraffic::derive(topo, ctx.decisions, &modifiers, &flow, &injected);

    smooth(&mut state.node_latency, &flow.lat_eff);
    smooth(&mut state.node_error, &flow.err_eff);
    smooth(&mut state.node_load, &flow.load);
    smooth(&mut state.node_rho, &flow.rho);
    smooth(&mut state.edge_traffic, &traffic.traffic);
    smooth(&mut state.edge_latency, &traffic.latency);
    smooth(&mut state.edge_error, &traffic.error);
    smooth(&mut state.edge_rejected, &traffic.rejected);
    smooth(&mut state.edge_suspicious, &traffic.suspicious);
    state.edge_security.clone_from(&traffic.security);
    state.flows = injected.flows;

    // Health transitions, with dwell so brief blips do not flap.
    let incident_id = state.active_incident().map(|i| i.id.clone());
    for node in 0..topo.node_count() {
        let candidate = classify(topo, state, node, modifiers.down[node]);
        let current = state.health[node];
        if candidate == current {
            state.pending_health[node] = (current, 0);
            continue;
        }
        let (pending, count) = state.pending_health[node];
        let count = if pending == candidate { count + 1 } else { 1 };
        state.pending_health[node] = (candidate, count);
        let needed = if candidate == Health::Down || current == Health::Down {
            1
        } else if candidate > current {
            DWELL_WORSEN
        } else {
            DWELL_IMPROVE
        };
        if count < needed {
            continue;
        }
        state.health[node] = candidate;
        state.pending_health[node] = (candidate, 0);
        let spec = &topo.spec.nodes[node];
        let severity = match candidate {
            Health::Healthy => Severity::Info,
            Health::Degraded => {
                if current > candidate {
                    Severity::Info
                } else {
                    Severity::Warning
                }
            }
            Health::Critical | Health::Down => Severity::Critical,
        };
        em.push(
            Emit::new(
                severity,
                EventKind::HealthTransition,
                format!("{} is {}", spec.name, candidate.label()),
            )
            .message(format!(
                "{} in {} went from {} to {}.",
                spec.name,
                spec.region,
                current.label(),
                candidate.label()
            ))
            .nodes(vec![spec.id.clone()])
            .incident(incident_id.clone())
            .details(json!({
                "from": current,
                "to": candidate,
                "errorRate": super::math::round_to(state.node_error[node], 4),
                "latencyMs": super::math::round_to(state.node_latency[node], 1),
                "saturation": super::math::round_to(state.node_rho[node], 3),
            })),
        );
    }

    // Everything unhealthy while an incident is active counts as impacted.
    if let Some(rt) = state.scenario.as_ref() {
        let incident = &mut state.incidents[rt.incident];
        for node in 0..topo.node_count() {
            if state.health[node] == Health::Healthy {
                continue;
            }
            let id = topo.node_id(node);
            if let Err(position) = incident
                .impacted_node_ids
                .binary_search_by(|x| x.as_str().cmp(id))
            {
                incident.impacted_node_ids.insert(position, id.to_string());
            }
        }
    }

    let active = state
        .incidents
        .iter()
        .filter(|i| i.status != IncidentStatus::Resolved)
        .count() as u32;
    let mut target = global_metrics(topo, &modifiers, &flow, &traffic, &state.health, active);
    target.rps += injected.total_rps;
    target.suspicious_rps = injected.suspicious_rps;
    let g = &mut state.global;
    let blend = |current: &mut f64, goal: f64| *current += 0.5 * (goal - *current);
    blend(&mut g.rps, target.rps);
    blend(&mut g.avg_latency_ms, target.avg_latency_ms);
    blend(&mut g.p50_latency_ms, target.p50_latency_ms);
    blend(&mut g.p95_latency_ms, target.p95_latency_ms);
    blend(&mut g.p99_latency_ms, target.p99_latency_ms);
    blend(&mut g.error_rate, target.error_rate);
    blend(&mut g.authz_checks_rps, target.authz_checks_rps);
    blend(&mut g.authz_denial_rate, target.authz_denial_rate);
    blend(&mut g.rejected_rps, target.rejected_rps);
    blend(&mut g.suspicious_rps, target.suspicious_rps);
    g.active_incidents = target.active_incidents;
    g.health = target.health;

    emit_authz_samples(ctx, state, &mut em);
    evaluate_alerts(ctx, state, &mut em);

    state.seq = em.seq;
    em.out
}

/// True for node types whose load is reported as regional ingress.
pub fn is_ingress(service_type: ServiceType) -> bool {
    matches!(
        service_type,
        ServiceType::ApiGateway | ServiceType::NetworkGateway
    )
}

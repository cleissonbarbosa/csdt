//! Incident scenarios.
//!
//! A scenario is declarative data: phases on a virtual timeline, each with a
//! set of effects and scripted events. Scenarios refer to topology *roles*
//! (`primaryGateway`, `outageRegion`…) instead of node ids, so the same
//! definitions run on any topology that declares those roles. [`resolve`]
//! binds a definition to a concrete topology and turns effects into effect
//! channels the engine understands.
//!
//! Scenarios only ever describe changes to the internal model. Nothing here
//! can open a socket or touch a real system.

pub mod catalog;
pub mod recordings;

use crate::domain::{
    Decision, EventKind, IncidentStatus, RejectReason, Relationship, Scenario, ScenarioCategory,
    ScenarioPhase, Severity,
};
use crate::simulation::channels::ChannelKey;
use crate::simulation::decisions::DecisionTable;
use crate::simulation::model::{SimTopology, TICK_MS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeSel {
    /// The node a topology role points at.
    Role(&'static str),
    /// The API gateway of the region a region role points at.
    GatewayOf(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeSet {
    One(NodeSel),
    /// Every node in the region a region role points at.
    Region(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeSet {
    Between(NodeSel, NodeSel),
    /// Every synchronous edge pointing at the node.
    InboundSync(NodeSel),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Rate {
    Absolute(f64),
    /// A multiple of a node's capacity on the active topology.
    OfCapacity(NodeSel, f64),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    Demand(NodeSel, f64),
    Capacity(NodeSet, f64),
    Latency(NodeSet, f64),
    ErrorInject(NodeSet, f64),
    Down(NodeSet),
    EdgeWeight(EdgeSet, f64),
    EdgeLatency(EdgeSet, f64),
    EdgeError(EdgeSet, f64),
    RouteShift {
        from: (NodeSel, NodeSel),
        to: (NodeSel, NodeSel),
        fraction: f64,
    },
    FlowRate(usize, Rate),
    FlowReject(usize, NodeSel, f64, RejectReason),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptedEvent {
    pub delay_ms: u64,
    pub severity: Severity,
    pub kind: EventKind,
    pub title: &'static str,
    pub message: &'static str,
    pub nodes: Vec<NodeSel>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PhaseDef {
    pub name: &'static str,
    pub at_ms: u64,
    pub ramp_ms: u64,
    pub status: IncidentStatus,
    pub description: &'static str,
    pub effects: Vec<Effect>,
    pub events: Vec<ScriptedEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hop {
    /// A single existing edge.
    Direct(NodeSel, NodeSel),
    /// The shortest synchronous path between two nodes.
    Path(NodeSel, NodeSel),
}

/// A stream of synthetic requests injected along explicit hops.
#[derive(Debug, Clone, PartialEq)]
pub struct FlowDef {
    pub id: &'static str,
    pub label: &'static str,
    pub suspicious: bool,
    pub hops: Vec<Hop>,
    /// When set, traffic surviving the last hop joins that node's ordinary
    /// fan-out instead of terminating there.
    pub spill: bool,
    /// Scenario request id evaluated by Cedar, and the authorizer enforcing it.
    pub authz: Option<(&'static str, NodeSel)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScenarioDef {
    pub id: &'static str,
    pub name: &'static str,
    pub summary: &'static str,
    pub category: ScenarioCategory,
    pub severity: Severity,
    pub duration_ms: u64,
    pub root_cause: Option<NodeSel>,
    pub targets: Vec<NodeSet>,
    pub flows: Vec<FlowDef>,
    pub phases: Vec<PhaseDef>,
}

// ---------------------------------------------------------------------------
// Resolved form
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedEvent {
    pub delay_ticks: u64,
    pub severity: Severity,
    pub kind: EventKind,
    pub title: String,
    pub message: String,
    pub nodes: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedPhase {
    pub name: String,
    pub at_tick: u64,
    pub ramp_ticks: u32,
    pub status: IncidentStatus,
    pub description: String,
    pub targets: Vec<(ChannelKey, f64)>,
    pub events: Vec<ResolvedEvent>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthzBinding {
    pub node: usize,
    pub request_id: String,
    pub deny: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedFlow {
    pub id: String,
    pub label: String,
    pub suspicious: bool,
    pub hops: Vec<usize>,
    pub spill: bool,
    pub authz: Option<AuthzBinding>,
    /// Why traffic is rejected at a given node, for display.
    pub reject_reasons: Vec<(usize, RejectReason)>,
}

impl ResolvedFlow {
    pub fn reject_reason(&self, node: usize) -> Option<RejectReason> {
        self.reject_reasons
            .iter()
            .find(|(n, _)| *n == node)
            .map(|(_, reason)| *reason)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedScenario {
    pub info: Scenario,
    pub duration_ticks: u64,
    pub root_cause: Option<usize>,
    pub targets: Vec<usize>,
    pub flows: Vec<ResolvedFlow>,
    pub phases: Vec<ResolvedPhase>,
}

fn ms_to_ticks(ms: u64) -> u64 {
    ms / TICK_MS
}

struct Resolver<'a> {
    topo: &'a SimTopology,
}

impl Resolver<'_> {
    fn node(&self, sel: NodeSel) -> Result<usize, String> {
        match sel {
            NodeSel::Role(role) => self
                .topo
                .role_node(role)
                .ok_or_else(|| format!("topology does not define the `{role}` role")),
            NodeSel::GatewayOf(role) => self
                .topo
                .role_region(role)
                .and_then(|region| self.topo.gateway_of_region(region))
                .ok_or_else(|| format!("no API gateway found for region role `{role}`")),
        }
    }

    fn nodes(&self, set: NodeSet) -> Result<Vec<usize>, String> {
        match set {
            NodeSet::One(sel) => Ok(vec![self.node(sel)?]),
            NodeSet::Region(role) => {
                let region = self
                    .topo
                    .role_region(role)
                    .ok_or_else(|| format!("topology does not define the `{role}` region role"))?;
                Ok(self.topo.nodes_in_region(region))
            }
        }
    }

    fn edge(&self, from: NodeSel, to: NodeSel) -> Result<usize, String> {
        let (a, b) = (self.node(from)?, self.node(to)?);
        self.topo.edge_between(a, b).ok_or_else(|| {
            format!(
                "no edge between `{}` and `{}`",
                self.topo.node_id(a),
                self.topo.node_id(b)
            )
        })
    }

    fn edges(&self, set: EdgeSet) -> Result<Vec<usize>, String> {
        match set {
            EdgeSet::Between(a, b) => Ok(vec![self.edge(a, b)?]),
            EdgeSet::InboundSync(sel) => {
                let node = self.node(sel)?;
                Ok(self.topo.in_edges[node]
                    .iter()
                    .copied()
                    .filter(|e| self.topo.edge_rel[*e].is_sync())
                    .collect())
            }
        }
    }

    fn hops(&self, hops: &[Hop]) -> Result<Vec<usize>, String> {
        let mut out = Vec::new();
        for hop in hops {
            match *hop {
                Hop::Direct(a, b) => out.push(self.edge(a, b)?),
                Hop::Path(a, b) => {
                    let (from, to) = (self.node(a)?, self.node(b)?);
                    let path = self.topo.sync_path(from, to).ok_or_else(|| {
                        format!(
                            "no synchronous path from `{}` to `{}`",
                            self.topo.node_id(from),
                            self.topo.node_id(to)
                        )
                    })?;
                    out.extend(path);
                }
            }
        }
        if out.is_empty() {
            return Err("flow has no hops".into());
        }
        Ok(out)
    }

    fn rate(&self, rate: Rate) -> Result<f64, String> {
        match rate {
            Rate::Absolute(rps) => Ok(rps),
            Rate::OfCapacity(sel, factor) => {
                let capacity = self.topo.capacity[self.node(sel)?];
                if capacity.is_finite() {
                    Ok(capacity * factor)
                } else {
                    Err("capacity-relative rate against an unbounded node".into())
                }
            }
        }
    }
}

fn try_resolve(
    def: &ScenarioDef,
    topo: &SimTopology,
    decisions: &DecisionTable,
) -> Result<ResolvedScenario, String> {
    let r = Resolver { topo };

    let mut flows = Vec::with_capacity(def.flows.len());
    for flow in &def.flows {
        let authz = match flow.authz {
            Some((request_id, authorizer)) => {
                let evaluated = decisions
                    .scenario
                    .get(request_id)
                    .ok_or_else(|| format!("no evaluated request `{request_id}`"))?;
                Some(AuthzBinding {
                    node: r.node(authorizer)?,
                    request_id: request_id.to_string(),
                    deny: evaluated.outcome.decision == Decision::Deny,
                })
            }
            None => None,
        };
        let mut reject_reasons = Vec::new();
        if let Some(binding) = &authz {
            reject_reasons.push((binding.node, RejectReason::PolicyDeny));
        }
        flows.push(ResolvedFlow {
            id: flow.id.to_string(),
            label: flow.label.to_string(),
            suspicious: flow.suspicious,
            hops: r.hops(&flow.hops)?,
            spill: flow.spill,
            authz,
            reject_reasons,
        });
    }

    let mut phases = Vec::with_capacity(def.phases.len());
    for phase in &def.phases {
        let mut targets: Vec<(ChannelKey, f64)> = Vec::new();
        for effect in &phase.effects {
            match effect {
                Effect::Demand(sel, f) => {
                    targets.push((ChannelKey::Demand(r.node(*sel)? as u32), *f));
                }
                Effect::Capacity(set, f) => {
                    for n in r.nodes(*set)? {
                        targets.push((ChannelKey::Capacity(n as u32), *f));
                    }
                }
                Effect::Latency(set, f) => {
                    for n in r.nodes(*set)? {
                        targets.push((ChannelKey::Latency(n as u32), *f));
                    }
                }
                Effect::ErrorInject(set, rate) => {
                    for n in r.nodes(*set)? {
                        targets.push((ChannelKey::ErrorInject(n as u32), *rate));
                    }
                }
                Effect::Down(set) => {
                    for n in r.nodes(*set)? {
                        targets.push((ChannelKey::Down(n as u32), 1.0));
                    }
                }
                Effect::EdgeWeight(set, f) => {
                    for e in r.edges(*set)? {
                        targets.push((ChannelKey::EdgeWeight(e as u32), *f));
                    }
                }
                Effect::EdgeLatency(set, f) => {
                    for e in r.edges(*set)? {
                        targets.push((ChannelKey::EdgeLatency(e as u32), *f));
                    }
                }
                Effect::EdgeError(set, rate) => {
                    for e in r.edges(*set)? {
                        targets.push((ChannelKey::EdgeError(e as u32), *rate));
                    }
                }
                Effect::RouteShift { from, to, fraction } => {
                    let a = r.edge(from.0, from.1)?;
                    let b = r.edge(to.0, to.1)?;
                    targets.push((ChannelKey::RouteShift(a as u32, b as u32), *fraction));
                }
                Effect::FlowRate(flow, rate) => {
                    if *flow >= flows.len() {
                        return Err(format!("phase refers to unknown flow #{flow}"));
                    }
                    targets.push((ChannelKey::FlowRate(*flow as u16), r.rate(*rate)?));
                }
                Effect::FlowReject(flow, sel, fraction, reason) => {
                    let node = r.node(*sel)?;
                    let resolved = flows
                        .get_mut(*flow)
                        .ok_or_else(|| format!("phase refers to unknown flow #{flow}"))?;
                    if resolved.reject_reason(node).is_none() {
                        resolved.reject_reasons.push((node, *reason));
                    }
                    targets.push((ChannelKey::FlowReject(*flow as u16, node as u32), *fraction));
                }
            }
        }
        targets.sort_by(|a, b| a.0.cmp(&b.0));
        targets.dedup_by(|a, b| a.0 == b.0);

        let mut events = Vec::with_capacity(phase.events.len());
        for event in &phase.events {
            let nodes = event
                .nodes
                .iter()
                .map(|sel| r.node(*sel))
                .collect::<Result<Vec<_>, _>>()?;
            events.push(ResolvedEvent {
                delay_ticks: ms_to_ticks(event.delay_ms),
                severity: event.severity,
                kind: event.kind,
                title: event.title.to_string(),
                message: event.message.to_string(),
                nodes,
            });
        }
        phases.push(ResolvedPhase {
            name: phase.name.to_string(),
            at_tick: ms_to_ticks(phase.at_ms),
            ramp_ticks: ms_to_ticks(phase.ramp_ms).max(1) as u32,
            status: phase.status,
            description: phase.description.to_string(),
            targets,
            events,
        });
    }
    if phases.first().is_none_or(|p| p.at_tick != 0) {
        return Err("the first phase must start at 0 ms".into());
    }
    if phases.windows(2).any(|w| w[0].at_tick >= w[1].at_tick) {
        return Err("phases must be strictly ordered in time".into());
    }

    let mut targets = Vec::new();
    for set in &def.targets {
        targets.extend(r.nodes(*set)?);
    }
    targets.sort_unstable();
    targets.dedup();
    let root_cause = def.root_cause.map(|sel| r.node(sel)).transpose()?;

    Ok(ResolvedScenario {
        info: describe(def, topo, &targets, true),
        duration_ticks: ms_to_ticks(def.duration_ms),
        root_cause,
        targets,
        flows,
        phases,
    })
}

fn describe(def: &ScenarioDef, topo: &SimTopology, targets: &[usize], available: bool) -> Scenario {
    Scenario {
        id: def.id.to_string(),
        name: def.name.to_string(),
        summary: def.summary.to_string(),
        category: def.category,
        severity: def.severity,
        duration_ms: def.duration_ms,
        phases: def
            .phases
            .iter()
            .map(|p| ScenarioPhase {
                name: p.name.to_string(),
                at_ms: p.at_ms,
                status: p.status,
                description: p.description.to_string(),
            })
            .collect(),
        target_node_ids: targets
            .iter()
            .map(|n| topo.node_id(*n).to_string())
            .collect(),
        available,
    }
}

/// Binds a scenario to a topology. A scenario whose roles the topology does
/// not provide is returned as unavailable instead of failing the catalogue.
pub fn resolve(
    def: &ScenarioDef,
    topo: &SimTopology,
    decisions: &DecisionTable,
) -> ResolvedScenario {
    match try_resolve(def, topo, decisions) {
        Ok(resolved) => resolved,
        Err(reason) => {
            tracing::warn!(scenario = def.id, topology = %topo.spec.id, %reason, "scenario unavailable");
            ResolvedScenario {
                info: describe(def, topo, &[], false),
                duration_ticks: 0,
                root_cause: None,
                targets: Vec::new(),
                flows: Vec::new(),
                phases: Vec::new(),
            }
        }
    }
}

pub fn resolve_all(topo: &SimTopology, decisions: &DecisionTable) -> Vec<ResolvedScenario> {
    catalog::all()
        .iter()
        .map(|def| resolve(def, topo, decisions))
        .collect()
}

/// Edges on which an injected flow is treated as an authorization check.
pub fn is_authz_edge(topo: &SimTopology, edge: usize) -> bool {
    topo.edge_rel[edge] == Relationship::Authz
}

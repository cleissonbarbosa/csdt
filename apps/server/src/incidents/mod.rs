//! Incident scenarios.
//!
//! A scenario is declarative data: phases on a virtual timeline, each with a
//! set of effects and scripted events. The format is in [`spec`]; the bundled
//! scenarios are files in `fixtures/scenarios/` ([`catalog`]) and an operator
//! can supply their own through a workspace directory.
//!
//! Scenarios usually refer to topology *roles* (`primaryGateway`,
//! `outageRegion`…) instead of node ids, so the same definitions run on any
//! topology that declares those roles. [`resolve`] binds a definition to a
//! concrete topology and turns effects into effect channels the engine
//! understands.
//!
//! Scenarios only ever describe changes to the internal model. Nothing here
//! reads a file, opens a socket or touches a real system.

pub mod catalog;
pub mod recordings;
pub mod spec;

use crate::domain::{
    Decision, EventKind, IncidentStatus, RejectReason, Relationship, Scenario, ScenarioPhase,
    Severity,
};
use crate::simulation::channels::ChannelKey;
use crate::simulation::decisions::DecisionTable;
use crate::simulation::model::{SimTopology, TICK_MS};

pub use spec::{
    EdgeRef, EdgeSet, Effect, FlowAuthz, FlowDef, Hop, HopVia, NodeSel, NodeSet, PhaseDef, Rate,
    ScenarioDef, ScriptedEvent,
};

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
    /// A region named by a role that points at it, or by its own id.
    fn region(&self, name: &str) -> Result<usize, String> {
        self.topo
            .role_region(name)
            .or_else(|| self.topo.region_index.get(name).copied())
            .ok_or_else(|| format!("topology has no region role or region `{name}`"))
    }

    fn node(&self, sel: &NodeSel) -> Result<usize, String> {
        match sel {
            NodeSel::Role(role) => self
                .topo
                .role_node(role)
                .ok_or_else(|| format!("topology does not define the `{role}` role")),
            NodeSel::Node(id) => self
                .topo
                .node(id)
                .ok_or_else(|| format!("topology has no node `{id}`")),
            NodeSel::GatewayOf(name) => self
                .region(name)
                .ok()
                .and_then(|region| self.topo.gateway_of_region(region))
                .ok_or_else(|| format!("no API gateway found for region `{name}`")),
        }
    }

    fn nodes(&self, set: &NodeSet) -> Result<Vec<usize>, String> {
        match set {
            NodeSet::One(sel) => Ok(vec![self.node(sel)?]),
            NodeSet::Region(name) => Ok(self.topo.nodes_in_region(self.region(name)?)),
        }
    }

    fn edge(&self, from: &NodeSel, to: &NodeSel) -> Result<usize, String> {
        let (a, b) = (self.node(from)?, self.node(to)?);
        self.topo.edge_between(a, b).ok_or_else(|| {
            format!(
                "no edge between `{}` and `{}`",
                self.topo.node_id(a),
                self.topo.node_id(b)
            )
        })
    }

    fn edges(&self, set: &EdgeSet) -> Result<Vec<usize>, String> {
        match set {
            EdgeSet::Between(edge) => Ok(vec![self.edge(&edge.from, &edge.to)?]),
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
            match hop.via {
                HopVia::Edge => out.push(self.edge(&hop.from, &hop.to)?),
                HopVia::Path => {
                    let (from, to) = (self.node(&hop.from)?, self.node(&hop.to)?);
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

    fn rate(&self, rate: &Rate) -> Result<f64, String> {
        match rate {
            Rate::Rps(rps) => Ok(*rps),
            Rate::OfCapacity { node, factor } => {
                let capacity = self.topo.capacity[self.node(node)?];
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
    let flow_index = |id: &str| {
        def.flows
            .iter()
            .position(|flow| flow.id == id)
            .ok_or_else(|| format!("phase refers to unknown flow `{id}`"))
    };

    let mut flows = Vec::with_capacity(def.flows.len());
    for flow in &def.flows {
        let authz = match &flow.authz {
            Some(authz) => {
                let evaluated = decisions.scenario.get(&authz.request).ok_or_else(|| {
                    format!(
                        "no evaluated request `{}` in the authorization catalogue",
                        authz.request
                    )
                })?;
                Some(AuthzBinding {
                    node: r.node(&authz.authorizer)?,
                    request_id: authz.request.clone(),
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
            id: flow.id.clone(),
            label: flow.label.clone(),
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
                Effect::Demand { node, factor } => {
                    targets.push((ChannelKey::Demand(r.node(node)? as u32), *factor));
                }
                Effect::Capacity { nodes, factor } => {
                    for n in r.nodes(nodes)? {
                        targets.push((ChannelKey::Capacity(n as u32), *factor));
                    }
                }
                Effect::Latency { nodes, factor } => {
                    for n in r.nodes(nodes)? {
                        targets.push((ChannelKey::Latency(n as u32), *factor));
                    }
                }
                Effect::ErrorInject { nodes, rate } => {
                    for n in r.nodes(nodes)? {
                        targets.push((ChannelKey::ErrorInject(n as u32), *rate));
                    }
                }
                Effect::Down { nodes } => {
                    for n in r.nodes(nodes)? {
                        targets.push((ChannelKey::Down(n as u32), 1.0));
                    }
                }
                Effect::EdgeWeight { edges, factor } => {
                    for e in r.edges(edges)? {
                        targets.push((ChannelKey::EdgeWeight(e as u32), *factor));
                    }
                }
                Effect::EdgeLatency { edges, factor } => {
                    for e in r.edges(edges)? {
                        targets.push((ChannelKey::EdgeLatency(e as u32), *factor));
                    }
                }
                Effect::EdgeError { edges, rate } => {
                    for e in r.edges(edges)? {
                        targets.push((ChannelKey::EdgeError(e as u32), *rate));
                    }
                }
                Effect::RouteShift {
                    edge,
                    onto,
                    fraction,
                } => {
                    let a = r.edge(&edge.from, &edge.to)?;
                    let b = r.edge(&onto.from, &onto.to)?;
                    targets.push((ChannelKey::RouteShift(a as u32, b as u32), *fraction));
                }
                Effect::FlowRate { flow, rate } => {
                    let index = flow_index(flow)?;
                    targets.push((ChannelKey::FlowRate(index as u16), r.rate(rate)?));
                }
                Effect::FlowReject {
                    flow,
                    at,
                    fraction,
                    reason,
                } => {
                    let index = flow_index(flow)?;
                    let node = r.node(at)?;
                    let resolved = &mut flows[index];
                    if resolved.reject_reason(node).is_none() {
                        resolved.reject_reasons.push((node, *reason));
                    }
                    targets.push((ChannelKey::FlowReject(index as u16, node as u32), *fraction));
                }
            }
        }
        targets.sort_by_key(|target| target.0);
        targets.dedup_by(|a, b| a.0 == b.0);

        let mut events = Vec::with_capacity(phase.events.len());
        for event in &phase.events {
            let nodes = event
                .nodes
                .iter()
                .map(|sel| r.node(sel))
                .collect::<Result<Vec<_>, _>>()?;
            events.push(ResolvedEvent {
                delay_ticks: ms_to_ticks(event.delay_ms),
                severity: event.severity,
                kind: event.kind,
                title: event.title.clone(),
                message: event.message.clone(),
                nodes,
            });
        }
        phases.push(ResolvedPhase {
            name: phase.name.clone(),
            at_tick: ms_to_ticks(phase.at_ms),
            ramp_ticks: ms_to_ticks(phase.ramp_ms).max(1) as u32,
            status: phase.status,
            description: phase.description.clone(),
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
        targets.extend(r.nodes(set)?);
    }
    targets.sort_unstable();
    targets.dedup();
    let root_cause = def.root_cause.as_ref().map(|sel| r.node(sel)).transpose()?;

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
        id: def.id.clone(),
        name: def.name.clone(),
        summary: def.summary.clone(),
        category: def.category,
        severity: def.severity,
        duration_ms: def.duration_ms,
        phases: def
            .phases
            .iter()
            .map(|p| ScenarioPhase {
                name: p.name.clone(),
                at_ms: p.at_ms,
                status: p.status,
                description: p.description.clone(),
            })
            .collect(),
        target_node_ids: targets
            .iter()
            .map(|n| topo.node_id(*n).to_string())
            .collect(),
        available,
        unavailable_reason: None,
    }
}

/// Says why a scenario cannot run on a topology, or `Ok` when it can.
pub fn check(
    def: &ScenarioDef,
    topo: &SimTopology,
    decisions: &DecisionTable,
) -> Result<(), String> {
    try_resolve(def, topo, decisions).map(|_| ())
}

/// Binds a scenario to a topology. A scenario that names a role, a node or a
/// request the topology or the catalogue does not provide is returned as
/// unavailable instead of failing the catalogue.
pub fn resolve(
    def: &ScenarioDef,
    topo: &SimTopology,
    decisions: &DecisionTable,
) -> ResolvedScenario {
    match try_resolve(def, topo, decisions) {
        Ok(resolved) => resolved,
        Err(reason) => {
            tracing::warn!(scenario = %def.id, topology = %topo.spec.id, %reason, "scenario unavailable");
            let mut info = describe(def, topo, &[], false);
            info.unavailable_reason = Some(reason);
            ResolvedScenario {
                info,
                duration_ticks: 0,
                root_cause: None,
                targets: Vec::new(),
                flows: Vec::new(),
                phases: Vec::new(),
            }
        }
    }
}

pub fn resolve_all(
    defs: &[ScenarioDef],
    topo: &SimTopology,
    decisions: &DecisionTable,
) -> Vec<ResolvedScenario> {
    defs.iter()
        .map(|def| resolve(def, topo, decisions))
        .collect()
}

/// Edges on which an injected flow is treated as an authorization check.
pub fn is_authz_edge(topo: &SimTopology, edge: usize) -> bool {
    topo.edge_rel[edge] == Relationship::Authz
}

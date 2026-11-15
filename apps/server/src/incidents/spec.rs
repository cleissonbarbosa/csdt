//! The scenario file format.
//!
//! A scenario is plain data: phases on a virtual timeline, each with the
//! complete set of effects that hold during it and the events it announces.
//! The same types are deserialised from the bundled files in
//! `fixtures/scenarios/` and from a workspace directory, so a scenario
//! written by an operator can do exactly what a bundled one can and nothing
//! more: it changes numbers inside the model.
//!
//! This module is the format and the checks that do not need a topology.
//! [`super::resolve`] binds a definition to one.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::domain::{
    is_valid_id, EventKind, IncidentStatus, RejectReason, ScenarioCategory, Severity, MAX_ID_LEN,
};
use crate::simulation::model::TICK_MS;

/// Longest scenario: the history the timeline keeps (30 virtual minutes).
pub const MAX_DURATION_MS: u64 = 30 * 60 * 1000;
pub const MAX_PHASES: usize = 32;
pub const MAX_FLOWS: usize = 16;
/// Most effects, events, hops or targets one list may hold.
pub const MAX_LIST: usize = 64;
/// Largest multiplier an effect may apply.
pub const MAX_FACTOR: f64 = 1000.0;
/// Largest absolute flow rate, in requests per second.
pub const MAX_RPS: f64 = 1.0e9;

/// Picks one node of the active topology.
///
/// Written as a string: `role:primaryGateway`, `node:use-gateway` or
/// `gatewayOf:outageRegion`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(try_from = "String", into = "String")]
#[schemars(extend("pattern" = "^(role|node|gatewayOf):[\\s\\S]+$"))]
pub enum NodeSel {
    /// The node a topology role points at. Keeps a scenario independent of
    /// any one topology.
    Role(String),
    /// A node by its id. Ties the scenario to topologies that have it.
    Node(String),
    /// The API gateway of a region, named by a role or by its id.
    GatewayOf(String),
}

/// Picks one or more nodes: any [`NodeSel`], or `region:outageRegion` for
/// every node of a region named by a role or by its id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(try_from = "String", into = "String")]
#[schemars(extend("pattern" = "^(role|node|gatewayOf|region):[\\s\\S]+$"))]
pub enum NodeSet {
    One(NodeSel),
    Region(String),
}

fn split_selector(raw: &str) -> Option<(&str, &str)> {
    raw.split_once(':').filter(|(_, name)| !name.is_empty())
}

impl TryFrom<String> for NodeSel {
    type Error = String;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        match split_selector(&raw) {
            Some(("role", name)) => Ok(Self::Role(name.to_string())),
            Some(("node", name)) => Ok(Self::Node(name.to_string())),
            Some(("gatewayOf", name)) => Ok(Self::GatewayOf(name.to_string())),
            _ => Err(format!(
                "`{raw}` is not a node selector; expected `role:<name>`, `node:<id>` or `gatewayOf:<region>`"
            )),
        }
    }
}

impl fmt::Display for NodeSel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Role(name) => write!(f, "role:{name}"),
            Self::Node(name) => write!(f, "node:{name}"),
            Self::GatewayOf(name) => write!(f, "gatewayOf:{name}"),
        }
    }
}

impl From<NodeSel> for String {
    fn from(sel: NodeSel) -> Self {
        sel.to_string()
    }
}

impl TryFrom<String> for NodeSet {
    type Error = String;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        match split_selector(&raw) {
            Some(("region", name)) => Ok(Self::Region(name.to_string())),
            Some(("role" | "node" | "gatewayOf", _)) => NodeSel::try_from(raw).map(Self::One),
            _ => Err(format!(
                "`{raw}` is not a node selector; expected `role:<name>`, `node:<id>`, `gatewayOf:<region>` or `region:<region>`"
            )),
        }
    }
}

impl fmt::Display for NodeSet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::One(sel) => sel.fmt(f),
            Self::Region(name) => write!(f, "region:{name}"),
        }
    }
}

impl From<NodeSet> for String {
    fn from(set: NodeSet) -> Self {
        set.to_string()
    }
}

impl From<NodeSel> for NodeSet {
    fn from(sel: NodeSel) -> Self {
        Self::One(sel)
    }
}

/// One existing connection, by its two ends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EdgeRef {
    pub from: NodeSel,
    pub to: NodeSel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EdgeSet {
    /// One connection.
    Between(EdgeRef),
    /// Every synchronous connection pointing at the node.
    InboundSync(NodeSel),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Rate {
    /// Requests per second.
    Rps(#[schemars(range(min = 0, max = MAX_RPS))] f64),
    /// A multiple of a node's capacity on the active topology, so the same
    /// scenario overloads a small platform and a large one alike.
    OfCapacity {
        node: NodeSel,
        #[schemars(range(min = 0, max = MAX_FACTOR))]
        factor: f64,
    },
}

/// What a phase holds the model to. Anything a phase does not list ramps
/// back to nominal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Effect {
    /// Multiplies the demand an external client generates.
    Demand {
        node: NodeSel,
        #[schemars(range(min = 0, max = MAX_FACTOR))]
        factor: f64,
    },
    /// Multiplies capacity.
    Capacity {
        nodes: NodeSet,
        #[schemars(range(min = 0, max = MAX_FACTOR))]
        factor: f64,
    },
    /// Multiplies a node's own latency.
    Latency {
        nodes: NodeSet,
        #[schemars(range(min = 0, max = MAX_FACTOR))]
        factor: f64,
    },
    /// Adds a failure rate (0 to 1) at the nodes.
    ErrorInject {
        nodes: NodeSet,
        #[schemars(range(min = 0, max = 1))]
        rate: f64,
    },
    /// Makes the nodes unreachable.
    Down { nodes: NodeSet },
    /// Multiplies the calls made on the connections.
    EdgeWeight {
        edges: EdgeSet,
        #[schemars(range(min = 0, max = MAX_FACTOR))]
        factor: f64,
    },
    /// Multiplies the network latency of the connections.
    EdgeLatency {
        edges: EdgeSet,
        #[schemars(range(min = 0, max = MAX_FACTOR))]
        factor: f64,
    },
    /// Adds a failure rate (0 to 1) on the connections.
    EdgeError {
        edges: EdgeSet,
        #[schemars(range(min = 0, max = 1))]
        rate: f64,
    },
    /// Moves a fraction of one connection's traffic onto another.
    RouteShift {
        edge: EdgeRef,
        onto: EdgeRef,
        #[schemars(range(min = 0, max = 1))]
        fraction: f64,
    },
    /// Sets the rate of an injected flow.
    FlowRate { flow: String, rate: Rate },
    /// Rejects a fraction of an injected flow when it arrives at a node.
    FlowReject {
        flow: String,
        at: NodeSel,
        #[schemars(range(min = 0, max = 1))]
        fraction: f64,
        reason: RejectReason,
    },
}

/// An event a phase announces, `delayMs` after the phase begins.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptedEvent {
    pub delay_ms: u64,
    pub severity: Severity,
    #[schemars(extend("enum" = ["alert", "auth-failure", "mitigation", "reroute"]))]
    pub kind: EventKind,
    pub title: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    #[schemars(length(max = MAX_LIST))]
    pub nodes: Vec<NodeSel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhaseDef {
    pub name: String,
    pub at_ms: u64,
    /// How long the effects take to ease in from what held before.
    pub ramp_ms: u64,
    #[schemars(extend("enum" = ["active", "mitigating", "recovering"]))]
    pub status: IncidentStatus,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    #[schemars(length(max = MAX_LIST))]
    pub effects: Vec<Effect>,
    #[serde(default)]
    #[schemars(length(max = MAX_LIST))]
    pub events: Vec<ScriptedEvent>,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum HopVia {
    /// The single connection between the two nodes.
    #[default]
    Edge,
    /// The shortest synchronous path between them.
    Path,
}

impl HopVia {
    fn is_edge(&self) -> bool {
        *self == Self::Edge
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hop {
    pub from: NodeSel,
    pub to: NodeSel,
    #[serde(default, skip_serializing_if = "HopVia::is_edge")]
    pub via: HopVia,
}

/// Ties a flow to a request shape Cedar evaluated at start-up, and names the
/// authorizer that enforces the answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlowAuthz {
    /// Id of an entry in the authorization catalogue's `scenarioRequests`.
    pub request: String,
    pub authorizer: NodeSel,
}

/// A stream of synthetic requests injected along explicit hops.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlowDef {
    #[schemars(length(min = 1, max = MAX_ID_LEN), regex(pattern = "^[A-Za-z0-9_.-]+$"))]
    pub id: String,
    pub label: String,
    /// Drawn as hostile traffic.
    #[serde(default)]
    pub suspicious: bool,
    #[schemars(length(min = 1, max = MAX_LIST))]
    pub hops: Vec<Hop>,
    /// When set, traffic surviving the last hop joins that node's ordinary
    /// fan-out instead of terminating there.
    #[serde(default)]
    pub spill: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authz: Option<FlowAuthz>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioDef {
    #[schemars(length(min = 1, max = MAX_ID_LEN), regex(pattern = "^[A-Za-z0-9_.-]+$"))]
    pub id: String,
    pub name: String,
    pub summary: String,
    pub category: ScenarioCategory,
    pub severity: Severity,
    #[schemars(range(min = TICK_MS, max = MAX_DURATION_MS))]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_cause: Option<NodeSel>,
    #[serde(default)]
    #[schemars(length(max = MAX_LIST))]
    pub targets: Vec<NodeSet>,
    #[serde(default)]
    #[schemars(length(max = MAX_FLOWS))]
    pub flows: Vec<FlowDef>,
    #[schemars(length(min = 1, max = MAX_PHASES))]
    pub phases: Vec<PhaseDef>,
}

fn in_range(what: &str, value: f64, max: f64) -> Result<(), String> {
    if value.is_finite() && (0.0..=max).contains(&value) {
        Ok(())
    } else {
        Err(format!("{what} must be between 0 and {max}, got {value}"))
    }
}

fn at_most(what: &str, len: usize, max: usize) -> Result<(), String> {
    if len <= max {
        Ok(())
    } else {
        Err(format!("at most {max} {what} are allowed, found {len}"))
    }
}

impl Effect {
    /// Checks the figures of one effect against their ranges. Whether what it
    /// names exists is a question for a topology, answered when it is
    /// resolved.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Effect::Demand { factor, .. }
            | Effect::Capacity { factor, .. }
            | Effect::Latency { factor, .. }
            | Effect::EdgeWeight { factor, .. }
            | Effect::EdgeLatency { factor, .. } => in_range("factor", *factor, MAX_FACTOR),
            Effect::ErrorInject { rate, .. } | Effect::EdgeError { rate, .. } => {
                in_range("rate", *rate, 1.0)
            }
            Effect::Down { .. } => Ok(()),
            Effect::RouteShift { fraction, .. } | Effect::FlowReject { fraction, .. } => {
                in_range("fraction", *fraction, 1.0)
            }
            Effect::FlowRate { rate, .. } => match rate {
                Rate::Rps(rps) => in_range("rps", *rps, MAX_RPS),
                Rate::OfCapacity { factor, .. } => in_range("factor", *factor, MAX_FACTOR),
            },
        }
    }

    /// Whether the effect can be placed by hand, outside a scenario: it
    /// bends services or connections. The two that act on a scenario's own
    /// injected flow mean nothing without the scenario.
    pub fn is_fault(&self) -> bool {
        !matches!(self, Effect::FlowRate { .. } | Effect::FlowReject { .. })
    }

    /// The effect in a few words, for the timeline: `latency ×4`.
    pub fn describe(&self) -> String {
        match self {
            Effect::Demand { factor, .. } => format!("demand ×{factor}"),
            Effect::Capacity { factor, .. } => format!("capacity ×{factor}"),
            Effect::Latency { factor, .. } => format!("latency ×{factor}"),
            Effect::ErrorInject { rate, .. } => format!("{}% of requests fail", rate * 100.0),
            Effect::Down { .. } => "unreachable".into(),
            Effect::EdgeWeight { factor, .. } => format!("calls ×{factor}"),
            Effect::EdgeLatency { factor, .. } => format!("network latency ×{factor}"),
            Effect::EdgeError { rate, .. } => format!("{}% of calls fail", rate * 100.0),
            Effect::RouteShift { fraction, .. } => {
                format!("{}% of traffic moved", fraction * 100.0)
            }
            Effect::FlowRate { .. } => "flow rate".into(),
            Effect::FlowReject { .. } => "flow rejection".into(),
        }
    }
}

impl ScenarioDef {
    /// Checks everything that does not depend on a topology. A definition
    /// that passes can still be unavailable on a topology that lacks a role
    /// or a node it names; that is reported by [`super::check`].
    pub fn validate(&self) -> Result<(), String> {
        if !is_valid_id(&self.id) {
            return Err(format!(
                "id `{}` must be 1 to {MAX_ID_LEN} letters, digits, `-`, `_` or `.`",
                self.id
            ));
        }
        if self.name.trim().is_empty() {
            return Err("name is empty".into());
        }
        if self.duration_ms < TICK_MS || self.duration_ms > MAX_DURATION_MS {
            return Err(format!(
                "durationMs must be between {TICK_MS} and {MAX_DURATION_MS}, got {}",
                self.duration_ms
            ));
        }
        at_most("targets", self.targets.len(), MAX_LIST)?;
        at_most("flows", self.flows.len(), MAX_FLOWS)?;
        at_most("phases", self.phases.len(), MAX_PHASES)?;

        for (i, flow) in self.flows.iter().enumerate() {
            if !is_valid_id(&flow.id) {
                return Err(format!("flow #{i} has an invalid id `{}`", flow.id));
            }
            if self.flows[..i].iter().any(|other| other.id == flow.id) {
                return Err(format!("duplicate flow id `{}`", flow.id));
            }
            if flow.hops.is_empty() {
                return Err(format!("flow `{}` has no hops", flow.id));
            }
            at_most("hops", flow.hops.len(), MAX_LIST)
                .map_err(|e| format!("flow `{}`: {e}", flow.id))?;
        }

        let Some(first) = self.phases.first() else {
            return Err("a scenario needs at least one phase".into());
        };
        if first.at_ms != 0 {
            return Err("the first phase must start at 0 ms".into());
        }
        // Phases are entered on tick boundaries, so they have to differ by
        // at least one tick.
        if self
            .phases
            .windows(2)
            .any(|w| w[0].at_ms / TICK_MS >= w[1].at_ms / TICK_MS)
        {
            return Err(format!(
                "phases must be strictly ordered in time, at least {TICK_MS} ms apart"
            ));
        }
        if self
            .phases
            .last()
            .is_some_and(|last| last.at_ms >= self.duration_ms)
        {
            return Err("the last phase starts after the scenario ends".into());
        }
        for phase in &self.phases {
            self.validate_phase(phase)
                .map_err(|e| format!("phase `{}`: {e}", phase.name))?;
        }
        Ok(())
    }

    fn validate_phase(&self, phase: &PhaseDef) -> Result<(), String> {
        if phase.name.trim().is_empty() {
            return Err("name is empty".into());
        }
        if phase.status == IncidentStatus::Resolved {
            return Err(
                "status `resolved` is set by the engine when the scenario ends; use `recovering`"
                    .into(),
            );
        }
        at_most("effects", phase.effects.len(), MAX_LIST)?;
        at_most("events", phase.events.len(), MAX_LIST)?;
        let known_flow = |flow: &str| {
            if self.flows.iter().any(|f| f.id == flow) {
                Ok(())
            } else {
                Err(format!("unknown flow `{flow}`"))
            }
        };
        for effect in &phase.effects {
            if let Effect::FlowRate { flow, .. } | Effect::FlowReject { flow, .. } = effect {
                known_flow(flow)?;
            }
            effect.validate()?;
        }
        for event in &phase.events {
            if event.title.trim().is_empty() {
                return Err("an event has no title".into());
            }
            // Every other kind is produced by the engine or by an importer
            // and carries a payload a scenario cannot supply.
            if !matches!(
                event.kind,
                EventKind::Alert
                    | EventKind::AuthFailure
                    | EventKind::Mitigation
                    | EventKind::Reroute
            ) {
                return Err(format!(
                    "event `{}`: a scenario may only announce `alert`, `auth-failure`, `mitigation` or `reroute`",
                    event.title
                ));
            }
            at_most("nodes", event.nodes.len(), MAX_LIST)
                .map_err(|e| format!("event `{}`: {e}", event.title))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal() -> serde_json::Value {
        serde_json::json!({
            "id": "brownout",
            "name": "Brownout",
            "summary": "One service slows down.",
            "category": "resilience",
            "severity": "warning",
            "durationMs": 20_000,
            "phases": [
                {
                    "name": "Slow",
                    "atMs": 0,
                    "rampMs": 2_000,
                    "status": "active",
                    "effects": [{ "type": "latency", "nodes": "node:api", "factor": 4.0 }]
                },
                { "name": "Recovery", "atMs": 10_000, "rampMs": 2_000, "status": "recovering" }
            ]
        })
    }

    fn parse(value: serde_json::Value) -> Result<ScenarioDef, String> {
        let def: ScenarioDef = serde_json::from_value(value).map_err(|e| e.to_string())?;
        def.validate()?;
        Ok(def)
    }

    #[test]
    fn selectors_are_written_as_strings_and_round_trip() {
        for raw in [
            "role:primaryGateway",
            "role:resource:Order",
            "node:use-gateway",
            "gatewayOf:outageRegion",
        ] {
            let sel = NodeSel::try_from(raw.to_string()).expect("parses");
            assert_eq!(sel.to_string(), raw);
            assert_eq!(
                NodeSet::try_from(raw.to_string()),
                Ok(NodeSet::One(sel)),
                "{raw} is also a set"
            );
        }
        assert_eq!(
            NodeSet::try_from("region:eu-west".to_string()),
            Ok(NodeSet::Region("eu-west".into()))
        );
        for bad in [
            "",
            "use-gateway",
            "role:",
            "region:eu-west",
            "host:10.0.0.1",
        ] {
            assert!(NodeSel::try_from(bad.to_string()).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_minimal_scenario_parses_with_defaults() {
        let def = parse(minimal()).expect("valid");
        assert!(def.flows.is_empty() && def.targets.is_empty());
        assert_eq!(def.root_cause, None);
        assert!(def.phases[1].effects.is_empty());
        // What is written back is what was read.
        let again: ScenarioDef =
            serde_json::from_value(serde_json::to_value(&def).expect("serialises"))
                .expect("parses again");
        assert_eq!(again, def);
    }

    #[test]
    fn unknown_fields_and_effect_types_are_rejected() {
        let mut typo = minimal();
        typo["phases"][0]["rampMS"] = 5.into();
        assert!(parse(typo).unwrap_err().contains("rampMS"));

        let mut effect = minimal();
        effect["phases"][0]["effects"][0]["type"] = "exec".into();
        assert!(parse(effect).unwrap_err().contains("exec"));

        let mut extra = minimal();
        extra["phases"][0]["effects"][0]["command"] = "rm".into();
        assert!(parse(extra).unwrap_err().contains("command"));
    }

    #[test]
    fn numbers_outside_their_range_are_rejected() {
        for (pointer, value) in [
            ("factor", serde_json::json!(-1.0)),
            ("factor", serde_json::json!(1.0e9)),
        ] {
            let mut def = minimal();
            def["phases"][0]["effects"][0][pointer] = value;
            let error = parse(def).unwrap_err();
            assert!(error.contains("phase `Slow`"), "{error}");
        }
        let mut rate = minimal();
        rate["phases"][0]["effects"] =
            serde_json::json!([{ "type": "errorInject", "nodes": "node:api", "rate": 1.5 }]);
        assert!(parse(rate).unwrap_err().contains("rate must be between"));
    }

    #[test]
    fn structure_is_checked_without_a_topology() {
        let mut late = minimal();
        late["phases"][0]["atMs"] = 400.into();
        assert!(parse(late).unwrap_err().contains("start at 0"));

        let mut same_tick = minimal();
        same_tick["phases"][1]["atMs"] = 100.into();
        assert!(parse(same_tick).unwrap_err().contains("strictly ordered"));

        let mut beyond = minimal();
        beyond["phases"][1]["atMs"] = 20_000.into();
        assert!(parse(beyond)
            .unwrap_err()
            .contains("after the scenario ends"));

        let mut long = minimal();
        long["durationMs"] = (MAX_DURATION_MS + 1).into();
        assert!(parse(long).unwrap_err().contains("durationMs"));

        let mut id = minimal();
        id["id"] = "a b".into();
        assert!(parse(id).unwrap_err().contains("id `a b`"));

        let mut flow = minimal();
        flow["phases"][0]["effects"] =
            serde_json::json!([{ "type": "flowRate", "flow": "ghost", "rate": { "rps": 5.0 } }]);
        assert!(parse(flow).unwrap_err().contains("unknown flow `ghost`"));

        let mut resolved = minimal();
        resolved["phases"][1]["status"] = "resolved".into();
        assert!(parse(resolved).unwrap_err().contains("recovering"));
    }

    #[test]
    fn a_scenario_cannot_announce_engine_events() {
        for kind in [
            "authz-decision",
            "cve-advisory",
            "incident-resolved",
            "system",
        ] {
            let mut def = minimal();
            def["phases"][0]["events"] = serde_json::json!([
                { "delayMs": 0, "severity": "info", "kind": kind, "title": "Forged" }
            ]);
            assert!(
                parse(def).unwrap_err().contains("may only announce"),
                "{kind}"
            );
        }
    }
}

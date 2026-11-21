//! Compiled topology and the flow-propagation model.
//!
//! A [`TopologySpec`] is validated and compiled into a [`SimTopology`]: an
//! index-based DAG with derived capacities and baselines. [`propagate`] then
//! turns demand and modifiers into load, latency and failure figures.
//!
//! The model in one paragraph: demand enters at external clients and fans out
//! along edges (`weight` = calls per handled request). A node handles at most
//! its capacity and sheds the rest. Its own latency follows an M/M/1-shaped
//! congestion curve. Failures and latency of synchronous dependencies
//! propagate to callers; queues decouple them and accumulate backlog instead.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::domain::{
    is_valid_id, Autoscale, Relationship, ServiceType, TopologySpec, MAX_SCALE_FACTOR,
    MAX_SCALE_SECONDS,
};

use super::math::LogNormalMixture;

/// Virtual milliseconds per simulation tick.
pub const TICK_MS: u64 = 200;
/// Largest topology accepted. The engine is linear in both; the limits are
/// there so a mistake in a file fails at start-up instead of exhausting
/// memory. The renderer has been exercised at 178 services.
pub use crate::domain::{MAX_EDGES, MAX_NODES};
/// Virtual seconds per simulation tick.
pub const DT: f64 = TICK_MS as f64 / 1000.0;

/// How much of a service's capacity a request turned away at its door still
/// uses: the same small share a scenario's own rate limit costs.
pub const TURNED_AWAY_COST: f64 = 0.05;
/// Latency ceiling of a single service (a caller-side timeout).
pub const TIMEOUT_MS: f64 = 2500.0;
/// Latency a caller observes against an unreachable node (fast failure).
pub const DOWN_LATENCY_MS: f64 = 1200.0;
/// Ceiling for accumulated end-to-end latency.
pub const MAX_LATENCY_MS: f64 = 6000.0;

const QUEUE_DRAIN_TAU_S: f64 = 1.5;
const QUEUE_RETENTION_S: f64 = 25.0;
const MIN_CAPACITY_RPS: f64 = 40.0;
const SAME_REGION_LATENCY_MS: f64 = 1.2;
const CROSS_REGION_LATENCY_MS: f64 = 60.0;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum TopologyError {
    #[error("topology has no nodes")]
    Empty,
    #[error("{kind} id `{id}` must be 1 to 64 letters, digits, `-`, `_` or `.`")]
    InvalidId { kind: &'static str, id: String },
    #[error("topology has {nodes} nodes and {edges} edges; at most {MAX_NODES} and {MAX_EDGES} are allowed")]
    TooLarge { nodes: usize, edges: usize },
    #[error("duplicate node id `{0}`")]
    DuplicateNode(String),
    #[error("duplicate edge `{0}`")]
    DuplicateEdge(String),
    #[error("duplicate region id `{0}`")]
    DuplicateRegion(String),
    #[error("edge `{edge}` references unknown node `{node}`")]
    UnknownNode { edge: String, node: String },
    #[error("node `{node}` references unknown region `{region}`")]
    UnknownRegion { node: String, region: String },
    #[error("role `{role}` points at `{target}`, which is neither a node nor a region")]
    UnknownRole { role: String, target: String },
    #[error("edge `{0}` has an invalid weight or criticality")]
    InvalidEdge(String),
    #[error("node `{0}` has invalid numeric parameters")]
    InvalidNode(String),
    #[error(
        "node `{0}` is an external client: it cannot have a rate limit, a filter or autoscaling"
    )]
    ClientMitigation(String),
    #[error("dependency cycle detected involving `{0}`")]
    Cycle(String),
}

/// A topology compiled for simulation. Immutable once built.
#[derive(Debug, Clone)]
pub struct SimTopology {
    pub spec: TopologySpec,
    pub node_index: BTreeMap<String, usize>,
    pub region_index: BTreeMap<String, usize>,
    pub edge_index: BTreeMap<String, usize>,
    pub edge_ids: Vec<String>,
    pub edge_src: Vec<usize>,
    pub edge_dst: Vec<usize>,
    pub edge_rel: Vec<Relationship>,
    pub edge_weight: Vec<f64>,
    pub edge_crit: Vec<f64>,
    pub edge_latency: Vec<f64>,
    pub edge_cross_region: Vec<bool>,
    pub out_edges: Vec<Vec<usize>>,
    pub in_edges: Vec<Vec<usize>>,
    /// Nodes in topological order (callers before callees).
    pub order: Vec<usize>,
    pub node_type: Vec<ServiceType>,
    pub node_region: Vec<usize>,
    pub base_latency: Vec<f64>,
    pub base_demand: Vec<f64>,
    pub capacity: Vec<f64>,
    pub queue_capacity: Vec<f64>,
    pub nominal_load: Vec<f64>,
    /// The most each node admits a second; infinite where none is stated.
    pub rate_limit: Vec<f64>,
    /// Share of suspicious traffic each node turns away as it arrives.
    pub filter: Vec<f64>,
    /// How each node's capacity follows its load, where it does.
    pub autoscale: Vec<Option<Autoscale>>,
    /// Effective latency of every node at nominal load.
    pub baseline_latency: Vec<f64>,
    pub baseline_p95: f64,
    pub clients: Vec<usize>,
    pub authorizers: Vec<usize>,
}

impl SimTopology {
    pub fn compile(spec: TopologySpec) -> Result<Self, TopologyError> {
        if spec.nodes.is_empty() {
            return Err(TopologyError::Empty);
        }
        if spec.nodes.len() > MAX_NODES || spec.edges.len() > MAX_EDGES {
            return Err(TopologyError::TooLarge {
                nodes: spec.nodes.len(),
                edges: spec.edges.len(),
            });
        }
        let invalid_id = |kind: &'static str, id: &str| TopologyError::InvalidId {
            kind,
            id: id.to_string(),
        };
        if !is_valid_id(&spec.id) {
            return Err(invalid_id("topology", &spec.id));
        }
        let mut region_index = BTreeMap::new();
        for (i, region) in spec.regions.iter().enumerate() {
            if !is_valid_id(&region.id) {
                return Err(invalid_id("region", &region.id));
            }
            if region_index.insert(region.id.clone(), i).is_some() {
                return Err(TopologyError::DuplicateRegion(region.id.clone()));
            }
        }
        let mut node_index = BTreeMap::new();
        for (i, node) in spec.nodes.iter().enumerate() {
            if !is_valid_id(&node.id) {
                return Err(invalid_id("node", &node.id));
            }
            if node_index.insert(node.id.clone(), i).is_some() {
                return Err(TopologyError::DuplicateNode(node.id.clone()));
            }
            let numeric_ok = node.base_latency_ms.is_finite()
                && node.base_latency_ms >= 0.0
                && node.capacity_rps.is_none_or(|c| c.is_finite() && c > 0.0)
                && node.headroom.is_none_or(|h| h.is_finite() && h > 1.0)
                && node.base_rps.is_none_or(|r| r.is_finite() && r >= 0.0)
                && node.rate_limit_rps.is_none_or(|l| l.is_finite() && l > 0.0)
                && node
                    .suspicious_filter
                    .is_none_or(|f| (0.0..=1.0).contains(&f))
                && node.autoscale.is_none_or(|auto| {
                    (1.0..=MAX_SCALE_FACTOR).contains(&auto.max_factor)
                        && (1.0..=MAX_SCALE_SECONDS).contains(&auto.seconds)
                });
            if !numeric_ok {
                return Err(TopologyError::InvalidNode(node.id.clone()));
            }
            // A client is where traffic comes from: it has no door to hold
            // traffic at and no capacity to grow.
            let mitigates = node.rate_limit_rps.is_some()
                || node.suspicious_filter.is_some()
                || node.autoscale.is_some();
            if node.service_type.is_client() && mitigates {
                return Err(TopologyError::ClientMitigation(node.id.clone()));
            }
        }
        let n = spec.nodes.len();
        let mut node_region = Vec::with_capacity(n);
        for node in &spec.nodes {
            let region = region_index.get(&node.region).copied().ok_or_else(|| {
                TopologyError::UnknownRegion {
                    node: node.id.clone(),
                    region: node.region.clone(),
                }
            })?;
            node_region.push(region);
        }
        for (role, target) in &spec.roles {
            if !node_index.contains_key(target) && !region_index.contains_key(target) {
                return Err(TopologyError::UnknownRole {
                    role: role.clone(),
                    target: target.clone(),
                });
            }
        }

        let m = spec.edges.len();
        let mut edge_index = BTreeMap::new();
        let mut edge_ids = Vec::with_capacity(m);
        let mut edge_src = Vec::with_capacity(m);
        let mut edge_dst = Vec::with_capacity(m);
        let mut edge_rel = Vec::with_capacity(m);
        let mut edge_weight = Vec::with_capacity(m);
        let mut edge_crit = Vec::with_capacity(m);
        let mut edge_latency = Vec::with_capacity(m);
        let mut edge_cross_region = Vec::with_capacity(m);
        let mut out_edges = vec![Vec::new(); n];
        let mut in_edges = vec![Vec::new(); n];
        for (i, edge) in spec.edges.iter().enumerate() {
            let id = edge.id();
            let lookup = |node: &String| {
                node_index
                    .get(node)
                    .copied()
                    .ok_or_else(|| TopologyError::UnknownNode {
                        edge: id.clone(),
                        node: node.clone(),
                    })
            };
            let src = lookup(&edge.source)?;
            let dst = lookup(&edge.target)?;
            let crit = edge
                .criticality
                .unwrap_or_else(|| edge.relationship.default_criticality());
            let valid = edge.weight.is_finite()
                && edge.weight >= 0.0
                && (0.0..=1.0).contains(&crit)
                && edge.latency_ms.is_none_or(|l| l.is_finite() && l >= 0.0)
                && src != dst;
            if !valid {
                return Err(TopologyError::InvalidEdge(id));
            }
            if edge_index.insert(id.clone(), i).is_some() {
                return Err(TopologyError::DuplicateEdge(id));
            }
            let cross = node_region[src] != node_region[dst];
            edge_latency.push(edge.latency_ms.unwrap_or(if cross {
                CROSS_REGION_LATENCY_MS
            } else {
                SAME_REGION_LATENCY_MS
            }));
            edge_cross_region.push(cross);
            edge_ids.push(id);
            edge_src.push(src);
            edge_dst.push(dst);
            edge_rel.push(edge.relationship);
            edge_weight.push(edge.weight);
            edge_crit.push(crit);
            out_edges[src].push(i);
            in_edges[dst].push(i);
        }

        // Kahn's algorithm with an ordered frontier so the order is stable.
        let mut indegree: Vec<usize> = in_edges.iter().map(Vec::len).collect();
        let mut frontier: BTreeSet<usize> = (0..n).filter(|i| indegree[*i] == 0).collect();
        let mut order = Vec::with_capacity(n);
        while let Some(node) = frontier.pop_first() {
            order.push(node);
            for &e in &out_edges[node] {
                let dst = edge_dst[e];
                indegree[dst] -= 1;
                if indegree[dst] == 0 {
                    frontier.insert(dst);
                }
            }
        }
        if order.len() != n {
            let stuck = (0..n).find(|i| indegree[*i] > 0).unwrap_or(0);
            return Err(TopologyError::Cycle(spec.nodes[stuck].id.clone()));
        }

        let node_type: Vec<ServiceType> = spec.nodes.iter().map(|x| x.service_type).collect();
        let base_latency: Vec<f64> = spec.nodes.iter().map(|x| x.base_latency_ms).collect();
        let base_demand: Vec<f64> = spec
            .nodes
            .iter()
            .map(|x| {
                if x.service_type.is_client() {
                    x.base_rps.unwrap_or(0.0)
                } else {
                    0.0
                }
            })
            .collect();
        let clients = (0..n).filter(|i| node_type[*i].is_client()).collect();
        let rate_limit = spec
            .nodes
            .iter()
            .map(|x| x.rate_limit_rps.unwrap_or(f64::INFINITY))
            .collect();
        let filter = spec
            .nodes
            .iter()
            .map(|x| x.suspicious_filter.unwrap_or(0.0))
            .collect();
        let autoscale = spec.nodes.iter().map(|x| x.autoscale).collect();
        let authorizers = (0..n)
            .filter(|i| node_type[*i] == ServiceType::CedarAuthorizer)
            .collect();

        let mut topo = Self {
            spec,
            node_index,
            region_index,
            edge_index,
            edge_ids,
            edge_src,
            edge_dst,
            edge_rel,
            edge_weight,
            edge_crit,
            edge_latency,
            edge_cross_region,
            out_edges,
            in_edges,
            order,
            node_type,
            node_region,
            base_latency,
            base_demand,
            capacity: vec![f64::INFINITY; n],
            queue_capacity: vec![f64::INFINITY; n],
            nominal_load: vec![0.0; n],
            rate_limit,
            filter,
            autoscale,
            baseline_latency: vec![0.0; n],
            baseline_p95: 0.0,
            clients,
            authorizers,
        };

        // Pass 1: nominal load with unlimited capacity → derive capacities.
        let neutral = Modifiers::neutral(&topo);
        let mut depth = vec![0.0; n];
        let zero = vec![0.0; n];
        // At rest nothing has scaled: every service is the size it was given.
        let mut scale = vec![1.0; n];
        let unlimited = propagate(&topo, &neutral, &mut depth, &mut scale, &zero, DT);
        topo.nominal_load = unlimited.load.clone();
        for i in 0..n {
            let node = &topo.spec.nodes[i];
            if node.service_type.is_client() {
                continue;
            }
            let headroom = node
                .headroom
                .unwrap_or_else(|| node.service_type.default_headroom());
            topo.capacity[i] = node
                .capacity_rps
                .unwrap_or_else(|| (topo.nominal_load[i] * headroom).max(MIN_CAPACITY_RPS));
            if node.service_type.is_queue() {
                topo.queue_capacity[i] = (topo.nominal_load[i] * QUEUE_RETENTION_S).max(400.0);
            }
        }

        // Pass 2: baselines at nominal load with real capacities.
        let mut depth = vec![0.0; n];
        let mut scale = vec![1.0; n];
        let nominal = propagate(&topo, &neutral, &mut depth, &mut scale, &zero, DT);
        topo.baseline_latency = nominal.lat_eff.clone();
        topo.baseline_p95 = topo
            .latency_mixture(&neutral.demand, &nominal.lat_eff)
            .quantile(0.95);
        Ok(topo)
    }

    pub fn node_count(&self) -> usize {
        self.spec.nodes.len()
    }

    pub fn edge_count(&self) -> usize {
        self.spec.edges.len()
    }

    pub fn node(&self, id: &str) -> Option<usize> {
        self.node_index.get(id).copied()
    }

    pub fn node_id(&self, index: usize) -> &str {
        &self.spec.nodes[index].id
    }

    /// Node a role points at, if the role exists and names a node.
    pub fn role_node(&self, role: &str) -> Option<usize> {
        self.spec.roles.get(role).and_then(|id| self.node(id))
    }

    /// Region a role points at, if the role exists and names a region.
    pub fn role_region(&self, role: &str) -> Option<usize> {
        self.spec
            .roles
            .get(role)
            .and_then(|id| self.region_index.get(id).copied())
    }

    pub fn edge_between(&self, src: usize, dst: usize) -> Option<usize> {
        self.out_edges[src]
            .iter()
            .copied()
            .find(|e| self.edge_dst[*e] == dst)
    }

    pub fn nodes_in_region(&self, region: usize) -> Vec<usize> {
        (0..self.node_count())
            .filter(|i| self.node_region[*i] == region)
            .collect()
    }

    pub fn gateway_of_region(&self, region: usize) -> Option<usize> {
        (0..self.node_count())
            .find(|i| self.node_region[*i] == region && self.node_type[*i].is_gateway())
    }

    /// Shortest path (as edge indices) over synchronous edges.
    pub fn sync_path(&self, from: usize, to: usize) -> Option<Vec<usize>> {
        if from == to {
            return Some(Vec::new());
        }
        let mut via: Vec<Option<usize>> = vec![None; self.node_count()];
        let mut seen = vec![false; self.node_count()];
        let mut queue = VecDeque::from([from]);
        seen[from] = true;
        while let Some(node) = queue.pop_front() {
            for &e in &self.out_edges[node] {
                let dst = self.edge_dst[e];
                if seen[dst] || !self.edge_rel[e].is_sync() {
                    continue;
                }
                seen[dst] = true;
                via[dst] = Some(e);
                if dst == to {
                    let mut path = Vec::new();
                    let mut cursor = to;
                    while let Some(edge) = via[cursor] {
                        path.push(edge);
                        cursor = self.edge_src[edge];
                    }
                    path.reverse();
                    return Some(path);
                }
                queue.push_back(dst);
            }
        }
        None
    }

    /// End-to-end latency distribution experienced by clients.
    pub fn latency_mixture(&self, demand: &[f64], lat_eff: &[f64]) -> LogNormalMixture {
        let mut mixture = LogNormalMixture::default();
        for &c in &self.clients {
            let baseline = self.baseline_latency[c].max(1.0);
            let strain = ((lat_eff[c] / baseline - 1.0) / 5.0).clamp(0.0, 1.0);
            mixture.push(demand[c], lat_eff[c].max(1.0), 0.36 + 0.4 * strain);
        }
        mixture
    }
}

/// Everything that can bend the model away from nominal for one tick.
#[derive(Debug, Clone)]
pub struct Modifiers {
    /// Demand generated at each node (non-zero for external clients only).
    pub demand: Vec<f64>,
    pub cap_factor: Vec<f64>,
    pub lat_factor: Vec<f64>,
    pub err_inject: Vec<f64>,
    pub down: Vec<bool>,
    /// Effective edge weights (already including factors and route shifts).
    pub edge_weight: Vec<f64>,
    pub edge_lat_factor: Vec<f64>,
    pub edge_err_inject: Vec<f64>,
    /// Load from injected path flows that terminates at or passes a node.
    pub path_load: Vec<f64>,
    /// Injected load that joins a node's ordinary fan-out.
    pub spill_in: Vec<f64>,
    /// Injected load that arrived at a node's door, before its rate limit.
    pub arriving: Vec<f64>,
}

impl Modifiers {
    pub fn neutral(topo: &SimTopology) -> Self {
        let n = topo.node_count();
        let m = topo.edge_count();
        Self {
            demand: topo.base_demand.clone(),
            cap_factor: vec![1.0; n],
            lat_factor: vec![1.0; n],
            err_inject: vec![0.0; n],
            down: vec![false; n],
            edge_weight: topo.edge_weight.clone(),
            edge_lat_factor: vec![1.0; m],
            edge_err_inject: vec![0.0; m],
            path_load: vec![0.0; n],
            spill_in: vec![0.0; n],
            arriving: vec![0.0; n],
        }
    }
}

/// Result of one propagation pass.
#[derive(Debug, Clone, Default)]
pub struct Flow {
    /// Total load arriving at each node (requests per second).
    pub load: Vec<f64>,
    /// Utilisation: load / effective capacity.
    pub rho: Vec<f64>,
    /// Failure rate caused by the node itself (shedding, injected faults).
    pub own_err: Vec<f64>,
    /// Failure rate callers observe, including synchronous dependencies.
    pub err_eff: Vec<f64>,
    /// Latency callers observe, including synchronous dependencies.
    pub lat_eff: Vec<f64>,
    /// Ordinary (non-injected) traffic on each edge.
    pub edge_flow: Vec<f64>,
    /// Share of what arrived at each node that its rate limit let in: 1
    /// where there is no limit or the limit was not reached.
    pub admit: Vec<f64>,
}

/// Combines two independent failure probabilities.
pub fn combine_failures(a: f64, b: f64) -> f64 {
    1.0 - (1.0 - a.clamp(0.0, 1.0)) * (1.0 - b.clamp(0.0, 1.0))
}

/// One pass of the model. `queue_depth` and `scale` are what carries over
/// from one tick to the next: the backlog of every queue, and how far every
/// autoscaled service has grown (1 where it has not, or cannot).
pub fn propagate(
    topo: &SimTopology,
    m: &Modifiers,
    queue_depth: &mut [f64],
    scale: &mut [f64],
    prev_err_eff: &[f64],
    dt: f64,
) -> Flow {
    let n = topo.node_count();
    let mut flow = Flow {
        load: vec![0.0; n],
        rho: vec![0.0; n],
        own_err: vec![0.0; n],
        err_eff: vec![0.0; n],
        lat_eff: vec![0.0; n],
        edge_flow: vec![0.0; topo.edge_count()],
        admit: vec![1.0; n],
    };
    let mut queue_latency = vec![0.0; n];

    // Forward pass: load and traffic.
    for &node in &topo.order {
        let ordinary_in: f64 = m.demand[node]
            + topo.in_edges[node]
                .iter()
                .map(|e| flow.edge_flow[*e])
                .sum::<f64>();
        // A rate limit holds traffic at the door: what arrives beyond it is
        // turned away before it uses capacity or reaches anything behind.
        // Injected traffic was already held to the share admitted a tick
        // ago (`engine::inject_flows`); ordinary traffic is held to this
        // tick's. A node with no limit takes the path it always took.
        let limit = topo.rate_limit[node];
        let (admitted_in, load) = if limit.is_finite() {
            let arriving = ordinary_in + m.arriving[node];
            let admit = if arriving > limit {
                limit / arriving
            } else {
                1.0
            };
            flow.admit[node] = admit;
            let admitted = ordinary_in * admit;
            let turned = ordinary_in - admitted;
            (
                admitted,
                admitted + turned * TURNED_AWAY_COST + m.path_load[node] + m.spill_in[node],
            )
        } else {
            (
                ordinary_in,
                ordinary_in + m.path_load[node] + m.spill_in[node],
            )
        };
        let mut capacity = topo.capacity[node] * m.cap_factor[node].max(0.0);
        if let Some(auto) = topo.autoscale[node] {
            capacity *= scale[node];
            // Next tick's size: toward the capacity that would give this
            // load the headroom the service has at rest.
            let nominal = topo.nominal_load[node];
            let wanted = if nominal > f64::EPSILON {
                (load / nominal).clamp(1.0, auto.max_factor)
            } else {
                1.0
            };
            scale[node] += (wanted - scale[node]) * (dt / auto.seconds).min(1.0);
        }
        let down = m.down[node];
        let (handled, rho) = if down {
            (0.0, if load > 0.0 { 2.0 } else { 0.0 })
        } else if load <= f64::EPSILON || capacity.is_infinite() {
            (1.0, 0.0)
        } else if capacity <= f64::EPSILON {
            (0.0, 2.0)
        } else {
            ((capacity / load).min(1.0), load / capacity)
        };
        let mut shed = if limit.is_finite() && ordinary_in > f64::EPSILON {
            // Of what callers sent: turned away at the door, or not handled.
            1.0 - admitted_in / ordinary_in * handled
        } else {
            1.0 - handled
        };
        let mut through = (admitted_in + m.spill_in[node]) * handled;

        if topo.node_type[node].is_queue() && !down {
            // Consumers pull from the queue: how fast can they drain it?
            let drain: f64 = topo.out_edges[node]
                .iter()
                .filter(|e| topo.edge_rel[**e] == Relationship::Consume)
                .map(|e| {
                    let consumer = topo.edge_dst[*e];
                    if m.down[consumer] {
                        0.0
                    } else {
                        // A consumer's size a tick ago, since consumers
                        // come later in the pass; 1 unless it scales.
                        let size = if topo.autoscale[consumer].is_some() {
                            scale[consumer]
                        } else {
                            1.0
                        };
                        topo.capacity[consumer]
                            * m.cap_factor[consumer].max(0.0)
                            * size
                            * (1.0 - prev_err_eff[consumer]).clamp(0.0, 1.0)
                    }
                })
                .sum();
            let inflow = through;
            let outflow = (inflow + queue_depth[node] / QUEUE_DRAIN_TAU_S).min(drain);
            let limit = topo.queue_capacity[node];
            let depth = queue_depth[node] + (inflow - outflow) * dt;
            let overflow = (depth - limit).max(0.0);
            queue_depth[node] = depth.clamp(0.0, limit);
            if inflow > f64::EPSILON {
                shed = combine_failures(shed, (overflow / dt / inflow).min(1.0));
            }
            queue_latency[node] = if outflow > 1.0 {
                (queue_depth[node] / outflow * 1000.0).min(30_000.0)
            } else if queue_depth[node] > 1.0 {
                30_000.0
            } else {
                0.0
            };
            through = outflow;
        }

        flow.load[node] = load;
        flow.rho[node] = rho;
        flow.own_err[node] = if down {
            1.0
        } else {
            combine_failures(shed, m.err_inject[node])
        };
        for &e in &topo.out_edges[node] {
            flow.edge_flow[e] = through * m.edge_weight[e].max(0.0);
        }
    }

    // Reverse pass: effective failure rate and latency.
    for &node in topo.order.iter().rev() {
        let down = m.down[node];
        let rho = flow.rho[node];
        let own_latency = if down {
            DOWN_LATENCY_MS
        } else {
            let congestion = 0.8 + 0.2 / (1.0 - rho.min(0.96));
            let overload = if rho > 1.0 {
                1.0 + 2.5 * (rho - 1.0).min(2.0)
            } else {
                1.0
            };
            (topo.base_latency[node] * congestion * overload * m.lat_factor[node].max(0.0)
                + queue_latency[node])
                .min(if topo.node_type[node].is_queue() {
                    30_000.0
                } else {
                    TIMEOUT_MS
                })
        };

        let mut success = 1.0 - flow.own_err[node];
        let mut latency = own_latency;
        if !down {
            // Routing edges: each request takes exactly one of them.
            let route_weight: f64 = topo.out_edges[node]
                .iter()
                .filter(|e| topo.edge_rel[**e] == Relationship::Route)
                .map(|e| m.edge_weight[*e].max(0.0))
                .sum();
            for &e in &topo.out_edges[node] {
                let rel = topo.edge_rel[e];
                if !rel.is_sync() {
                    continue;
                }
                let dst = topo.edge_dst[e];
                let failure = combine_failures(flow.err_eff[dst], m.edge_err_inject[e]);
                let hop_latency = topo.edge_latency[e] * m.edge_lat_factor[e].max(0.0)
                    + flow.lat_eff[dst].min(TIMEOUT_MS);
                if rel == Relationship::Route {
                    if route_weight > f64::EPSILON {
                        let share = m.edge_weight[e].max(0.0) / route_weight;
                        success *= 1.0 - share * failure;
                        latency += share * hop_latency;
                    }
                } else {
                    // Whether a request depends on this hop is a property of
                    // the caller, so the nominal weight is used: a circuit
                    // breaker that cuts traffic on the edge (a weight factor)
                    // makes calls fail fast, it does not make them succeed.
                    let probability = topo.edge_weight[e].min(1.0);
                    success *= 1.0 - probability * topo.edge_crit[e] * failure;
                    latency += probability * hop_latency;
                }
            }
        }
        flow.err_eff[node] = if down {
            1.0
        } else {
            (1.0 - success).clamp(0.0, 1.0)
        };
        flow.lat_eff[node] = latency.min(if topo.node_type[node].is_queue() {
            30_000.0
        } else {
            MAX_LATENCY_MS
        });
    }
    flow
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{DataSource, EdgeSpec, NodeSpec, Protocol, Region, RegionKind};

    fn node(id: &str, ty: ServiceType, latency: f64) -> NodeSpec {
        NodeSpec {
            id: id.into(),
            name: id.into(),
            service_type: ty,
            region: "r".into(),
            tier: 0,
            description: String::new(),
            environment: Default::default(),
            base_latency_ms: latency,
            capacity_rps: None,
            headroom: None,
            base_rps: if ty.is_client() { Some(100.0) } else { None },
            rate_limit_rps: None,
            suspicious_filter: None,
            autoscale: None,
        }
    }

    fn edge(src: &str, dst: &str, rel: Relationship, weight: f64) -> EdgeSpec {
        EdgeSpec {
            source: src.into(),
            target: dst.into(),
            protocol: Protocol::Grpc,
            relationship: rel,
            weight,
            criticality: None,
            latency_ms: Some(1.0),
        }
    }

    fn spec(nodes: Vec<NodeSpec>, edges: Vec<EdgeSpec>) -> TopologySpec {
        TopologySpec {
            id: "t".into(),
            name: "t".into(),
            description: String::new(),
            data_source: DataSource::Synthetic,
            regions: vec![Region {
                id: "r".into(),
                name: "R".into(),
                kind: RegionKind::Cloud,
                location: "x".into(),
            }],
            roles: BTreeMap::new(),
            nodes,
            edges,
        }
    }

    fn chain() -> SimTopology {
        SimTopology::compile(spec(
            vec![
                node("client", ServiceType::ExternalClient, 0.0),
                node("gw", ServiceType::ApiGateway, 5.0),
                node("svc", ServiceType::Microservice, 20.0),
                node("db", ServiceType::Database, 4.0),
            ],
            vec![
                edge("client", "gw", Relationship::Route, 1.0),
                edge("gw", "svc", Relationship::Call, 0.5),
                edge("svc", "db", Relationship::Data, 1.0),
            ],
        ))
        .expect("valid chain")
    }

    #[test]
    fn nominal_load_follows_edge_weights() {
        let topo = chain();
        let gw = topo.node("gw").unwrap();
        let svc = topo.node("svc").unwrap();
        let db = topo.node("db").unwrap();
        assert!((topo.nominal_load[gw] - 100.0).abs() < 1e-9);
        assert!((topo.nominal_load[svc] - 50.0).abs() < 1e-9);
        assert!((topo.nominal_load[db] - 50.0).abs() < 1e-9);
        // Capacity = nominal load × default headroom.
        assert!((topo.capacity[gw] - 240.0).abs() < 1e-9);
    }

    #[test]
    fn rejects_cycles_and_dangling_references() {
        let cyclic = spec(
            vec![
                node("a", ServiceType::Microservice, 1.0),
                node("b", ServiceType::Microservice, 1.0),
            ],
            vec![
                edge("a", "b", Relationship::Call, 1.0),
                edge("b", "a", Relationship::Call, 1.0),
            ],
        );
        assert!(matches!(
            SimTopology::compile(cyclic),
            Err(TopologyError::Cycle(_))
        ));

        let dangling = spec(
            vec![node("a", ServiceType::Microservice, 1.0)],
            vec![edge("a", "ghost", Relationship::Call, 1.0)],
        );
        assert!(matches!(
            SimTopology::compile(dangling),
            Err(TopologyError::UnknownNode { .. })
        ));
    }

    #[test]
    fn saturation_sheds_load_and_raises_latency() {
        let topo = chain();
        let gw = topo.node("gw").unwrap();
        let client = topo.node("client").unwrap();
        let mut m = Modifiers::neutral(&topo);
        m.demand[client] = 600.0; // 2.5× the gateway capacity of 240 rps.
        let mut depth = vec![0.0; topo.node_count()];
        let zero = vec![0.0; topo.node_count()];
        let flow = propagate(
            &topo,
            &m,
            &mut depth,
            &mut vec![1.0; topo.node_count()],
            &zero,
            DT,
        );
        assert!((flow.rho[gw] - 2.5).abs() < 1e-9);
        assert!((flow.own_err[gw] - 0.6).abs() < 1e-9, "sheds 60 %");
        assert!(flow.lat_eff[gw] > topo.baseline_latency[gw] * 3.0);
        // Clients observe the gateway's failures.
        assert!(flow.err_eff[client] >= 0.6);
    }

    #[test]
    fn dependency_failure_propagates_by_criticality_and_call_probability() {
        let topo = chain();
        let (gw, svc, db) = (
            topo.node("gw").unwrap(),
            topo.node("svc").unwrap(),
            topo.node("db").unwrap(),
        );
        let mut m = Modifiers::neutral(&topo);
        m.err_inject[db] = 0.5;
        let mut depth = vec![0.0; topo.node_count()];
        let zero = vec![0.0; topo.node_count()];
        let flow = propagate(
            &topo,
            &m,
            &mut depth,
            &mut vec![1.0; topo.node_count()],
            &zero,
            DT,
        );
        // svc → db is a data edge: criticality 0.9, called on every request.
        assert!((flow.err_eff[svc] - 0.45).abs() < 1e-9);
        // gw → svc is a call edge: criticality 0.8, probability 0.5.
        assert!((flow.err_eff[gw] - 0.5 * 0.8 * 0.45).abs() < 1e-9);
    }

    #[test]
    fn down_node_fails_everything_and_forwards_nothing() {
        let topo = chain();
        let (svc, db) = (topo.node("svc").unwrap(), topo.node("db").unwrap());
        let mut m = Modifiers::neutral(&topo);
        m.down[svc] = true;
        let mut depth = vec![0.0; topo.node_count()];
        let zero = vec![0.0; topo.node_count()];
        let flow = propagate(
            &topo,
            &m,
            &mut depth,
            &mut vec![1.0; topo.node_count()],
            &zero,
            DT,
        );
        assert_eq!(flow.err_eff[svc], 1.0);
        assert_eq!(flow.load[db], 0.0);
    }

    #[test]
    fn queue_accumulates_backlog_when_consumer_is_slow_and_drains_after() {
        let topo = SimTopology::compile(spec(
            vec![
                node("client", ServiceType::ExternalClient, 0.0),
                node("svc", ServiceType::Microservice, 10.0),
                node("queue", ServiceType::MessageQueue, 1.0),
                node("worker", ServiceType::Container, 10.0),
            ],
            vec![
                edge("client", "svc", Relationship::Route, 1.0),
                edge("svc", "queue", Relationship::Publish, 1.0),
                edge("queue", "worker", Relationship::Consume, 1.0),
            ],
        ))
        .expect("valid");
        let (queue, worker, svc) = (
            topo.node("queue").unwrap(),
            topo.node("worker").unwrap(),
            topo.node("svc").unwrap(),
        );
        let mut depth = vec![0.0; topo.node_count()];
        let zero = vec![0.0; topo.node_count()];

        let mut slow = Modifiers::neutral(&topo);
        slow.cap_factor[worker] = 0.1;
        let mut last = Flow::default();
        for _ in 0..50 {
            last = propagate(
                &topo,
                &slow,
                &mut depth,
                &mut vec![1.0; topo.node_count()],
                &zero,
                DT,
            );
        }
        assert!(depth[queue] > 500.0, "backlog grew to {}", depth[queue]);
        // Publishing is asynchronous: the producer is unaffected.
        assert!(last.err_eff[svc] < 1e-9);

        let healthy = Modifiers::neutral(&topo);
        for _ in 0..400 {
            propagate(
                &topo,
                &healthy,
                &mut depth,
                &mut vec![1.0; topo.node_count()],
                &zero,
                DT,
            );
        }
        assert!(depth[queue] < 1.0, "backlog drained to {}", depth[queue]);
    }

    #[test]
    fn sync_path_skips_asynchronous_edges() {
        let topo = chain();
        let path = topo
            .sync_path(topo.node("client").unwrap(), topo.node("db").unwrap())
            .expect("path exists");
        let ids: Vec<&str> = path.iter().map(|e| topo.edge_ids[*e].as_str()).collect();
        assert_eq!(ids, ["client->gw", "gw->svc", "svc->db"]);
    }
}

//! Reads an incident back from the timeline it ran on.
//!
//! The report answers what someone who watched the incident has to piece
//! together: where it began, what the scenario did by itself, what followed
//! in the model, how bad it got and when it was over. Nothing here is
//! simulated again and nothing is estimated. Each line is one of three
//! things, and says which:
//!
//! * **prescribed**: written in the scenario file (a phase's effects, the
//!   events it announces);
//! * **modelled**: a relation of the topology the propagation model follows
//!   (a synchronous dependency carries failures back to its callers, added
//!   traffic flows on to what is called);
//! * **observed**: an event or a metric sample the engine recorded.
//!
//! When none of the relations the report knows explains a change, it says
//! `unattributed` instead of choosing one.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::Value;

use crate::domain::{
    Cause, CauseKind, Decision, EventKind, Health, IncidentReport, IncidentStatus, MetricSample,
    ObjectiveKind, OriginBasis, Peak, PrescribedEffect, Relationship, ReportBaseline,
    ReportDecision, ReportEvent, ReportObjective, ReportOrigin, ReportPhase, ReportTransition,
    SecurityEvent, Severity, SCHEMA_VERSION,
};
use crate::incidents::{ResolvedPhase, ResolvedScenario};

use super::channels::ChannelKey;
use super::engine::{ERROR_OBJECTIVE, LATENCY_OBJECTIVE_FACTOR};
use super::math::round_to;
use super::model::SimTopology;
use super::timeline::METRIC_INTERVAL;
use super::TICK_MS;

/// Most transitions a phase, the propagation or the recovery lists.
pub const MAX_LISTED: usize = 240;
/// Utilisation above which a service is degraded by its own load.
const SATURATED: f64 = 0.88;

pub struct ReportInput<'a> {
    pub topo: &'a SimTopology,
    pub scenarios: &'a [ResolvedScenario],
    pub events: &'a VecDeque<SecurityEvent>,
    pub metrics: &'a VecDeque<MetricSample>,
    pub head_ms: u64,
}

fn percent(fraction: f64) -> f64 {
    round_to(fraction * 100.0, 1)
}

/// One channel a phase holds, in a few words.
fn describe(key: ChannelKey, value: f64, scenario: &ResolvedScenario) -> String {
    let flow = |index: u16| {
        scenario
            .flows
            .get(index as usize)
            .map_or("injected traffic", |flow| flow.label.as_str())
    };
    match key {
        ChannelKey::Demand(_) => format!("demand ×{value}"),
        ChannelKey::Capacity(_) => format!("capacity ×{value}"),
        ChannelKey::Latency(_) => format!("latency ×{value}"),
        ChannelKey::ErrorInject(_) => format!("{}% of requests fail", percent(value)),
        ChannelKey::Down(_) => "unreachable".into(),
        ChannelKey::EdgeWeight(_) => format!("calls ×{value}"),
        ChannelKey::EdgeLatency(_) => format!("network latency ×{value}"),
        ChannelKey::EdgeError(_) => format!("{}% of calls fail", percent(value)),
        ChannelKey::RouteShift(..) => {
            format!("{}% of traffic moved to another connection", percent(value))
        }
        ChannelKey::FlowRate(index) => format!(
            "injected traffic “{}” at {} req/s",
            flow(index),
            round_to(value, 0)
        ),
        ChannelKey::FlowReject(index, _) => {
            format!("{}% of “{}” turned away", percent(value), flow(index))
        }
    }
}

/// What a phase's channels act on: the services a caller of this module
/// would say the scenario touches directly, and the connections.
struct Touch {
    nodes: Vec<usize>,
    edges: Vec<usize>,
    /// Services from which added traffic flows on to whatever they call.
    sources: Vec<usize>,
}

fn touch(topo: &SimTopology, scenario: &ResolvedScenario, key: ChannelKey, value: f64) -> Touch {
    let mut out = Touch {
        nodes: Vec::new(),
        edges: Vec::new(),
        sources: Vec::new(),
    };
    match key {
        ChannelKey::Demand(n) => {
            out.nodes.push(n as usize);
            if value > 1.0 {
                out.sources.push(n as usize);
            }
        }
        ChannelKey::Capacity(n)
        | ChannelKey::Latency(n)
        | ChannelKey::ErrorInject(n)
        | ChannelKey::Down(n) => out.nodes.push(n as usize),
        ChannelKey::EdgeWeight(e) => {
            let dst = topo.edge_dst[e as usize];
            out.edges.push(e as usize);
            out.nodes.push(dst);
            if value > 1.0 {
                out.sources.push(dst);
            }
        }
        // The caller is the one that sees a slow or failing connection.
        ChannelKey::EdgeLatency(e) | ChannelKey::EdgeError(e) => {
            out.edges.push(e as usize);
            out.nodes.push(topo.edge_src[e as usize]);
        }
        ChannelKey::RouteShift(from, onto) => {
            let dst = topo.edge_dst[onto as usize];
            out.edges.push(from as usize);
            out.edges.push(onto as usize);
            out.nodes.push(dst);
            out.sources.push(dst);
        }
        ChannelKey::FlowRate(index) => {
            if let Some(flow) = scenario.flows.get(index as usize) {
                for edge in &flow.hops {
                    out.edges.push(*edge);
                    out.nodes.push(topo.edge_dst[*edge]);
                }
                if let Some(last) = flow.hops.last().filter(|_| flow.spill) {
                    out.sources.push(topo.edge_dst[*last]);
                }
            }
        }
        ChannelKey::FlowReject(_, n) => out.nodes.push(n as usize),
    }
    out
}

/// A phase as the report reads it: what it prescribes, in words and as the
/// services it acts on.
struct PhaseView {
    prescribed: Vec<PrescribedEffect>,
    /// The first effect that acts on each service.
    direct: BTreeMap<usize, String>,
    /// Services reached by traffic the phase adds, and where it is added.
    loaded: BTreeMap<usize, usize>,
}

fn phase_view(topo: &SimTopology, scenario: &ResolvedScenario, phase: &ResolvedPhase) -> PhaseView {
    let mut prescribed: Vec<(String, BTreeSet<usize>, BTreeSet<usize>)> = Vec::new();
    let mut direct = BTreeMap::new();
    let mut sources = Vec::new();
    for (key, value) in &phase.targets {
        if (*value - key.neutral()).abs() < 1e-12 {
            continue;
        }
        let description = describe(*key, *value, scenario);
        let touched = touch(topo, scenario, *key, *value);
        for node in &touched.nodes {
            direct.entry(*node).or_insert_with(|| description.clone());
        }
        sources.extend(touched.sources);
        let entry = match prescribed.iter_mut().find(|(d, ..)| *d == description) {
            Some(entry) => entry,
            None => {
                prescribed.push((description, BTreeSet::new(), BTreeSet::new()));
                // Just pushed.
                let last = prescribed.len() - 1;
                &mut prescribed[last]
            }
        };
        entry.1.extend(touched.nodes);
        entry.2.extend(touched.edges);
    }
    // Added traffic flows on along every connection, synchronous or not.
    let mut loaded = BTreeMap::new();
    for source in sources {
        let mut queue = VecDeque::from([source]);
        while let Some(node) = queue.pop_front() {
            for edge in &topo.out_edges[node] {
                let next = topo.edge_dst[*edge];
                if next != source && !loaded.contains_key(&next) {
                    loaded.insert(next, source);
                    queue.push_back(next);
                }
            }
        }
    }
    PhaseView {
        prescribed: prescribed
            .into_iter()
            .map(|(description, nodes, edges)| PrescribedEffect {
                description,
                node_ids: nodes
                    .into_iter()
                    .map(|n| topo.node_id(n).to_string())
                    .collect(),
                edge_ids: edges
                    .into_iter()
                    .map(|e| topo.edge_ids[e].clone())
                    .collect(),
            })
            .collect(),
        direct,
        loaded,
    }
}

fn health_of(details: &Value, field: &str) -> Option<Health> {
    serde_json::from_value(details.get(field)?.clone()).ok()
}

/// The unwell service a node depends on, if any: one it calls
/// synchronously, or for a queue the consumer that drains it. The worst one
/// is named; among equals, the first connection.
fn failing_dependency(topo: &SimTopology, health: &[Health], node: usize) -> Option<usize> {
    let queue = topo.node_type[node].is_queue();
    topo.out_edges[node]
        .iter()
        .copied()
        .filter(|edge| {
            let relation = topo.edge_rel[*edge];
            relation.is_sync() || (queue && relation == Relationship::Consume)
        })
        .filter(|edge| health[topo.edge_dst[*edge]] != Health::Healthy)
        // `max_by_key` keeps the last of equals; walk backwards for the first.
        .rev()
        .max_by_key(|edge| health[topo.edge_dst[*edge]])
}

struct Attribution<'a> {
    topo: &'a SimTopology,
    phase: Option<&'a PhaseView>,
    faults: &'a BTreeMap<usize, String>,
    health: &'a [Health],
}

impl Attribution<'_> {
    fn cause(&self, node: usize, saturation: f64) -> Cause {
        let plain = |kind| Cause {
            kind,
            effect: None,
            via_node_id: None,
            edge_id: None,
        };
        if let Some(effect) = self.phase.and_then(|phase| phase.direct.get(&node)) {
            return Cause {
                effect: Some(effect.clone()),
                ..plain(CauseKind::Prescribed)
            };
        }
        if let Some(effect) = self.faults.get(&node) {
            return Cause {
                effect: Some(effect.clone()),
                ..plain(CauseKind::Fault)
            };
        }
        let load = self
            .phase
            .and_then(|phase| phase.loaded.get(&node))
            .map(|source| Cause {
                via_node_id: Some(self.topo.node_id(*source).to_string()),
                edge_id: self
                    .topo
                    .edge_between(*source, node)
                    .map(|edge| self.topo.edge_ids[edge].clone()),
                ..plain(CauseKind::Load)
            });
        // A service that is itself saturated by added traffic is explained
        // by that traffic before by whatever it calls.
        if saturation >= SATURATED {
            if let Some(load) = load.clone() {
                return load;
            }
        }
        if let Some(edge) = failing_dependency(self.topo, self.health, node) {
            return Cause {
                via_node_id: Some(self.topo.node_id(self.topo.edge_dst[edge]).to_string()),
                edge_id: Some(self.topo.edge_ids[edge].clone()),
                ..plain(CauseKind::Dependency)
            };
        }
        load.unwrap_or_else(|| plain(CauseKind::Unattributed))
    }
}

fn peak_of(
    samples: impl Iterator<Item = MetricSample>,
    value: impl Fn(&MetricSample) -> f64,
) -> Option<Peak> {
    let mut best: Option<Peak> = None;
    for sample in samples {
        let candidate = value(&sample);
        if best.is_none_or(|peak| candidate > peak.value) {
            best = Some(Peak {
                value: candidate,
                at_ms: sample.virtual_time_ms,
            });
        }
    }
    best
}

fn belongs(event: &SecurityEvent, incident_id: &str) -> bool {
    event.incident_id.as_deref() == Some(incident_id)
}

/// What Cedar decided for the requests of the incident's own traffic, as
/// the decision events on the timeline carry it.
fn decisions_of(events: &VecDeque<SecurityEvent>, incident_id: &str) -> Vec<ReportDecision> {
    let mut out: Vec<ReportDecision> = Vec::new();
    for event in events
        .iter()
        .filter(|e| e.kind == EventKind::AuthzDecision && belongs(e, incident_id))
    {
        let details = &event.details;
        let text = |value: &Value, field: &str| {
            value
                .get(field)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let request_id = text(details, "requestId");
        if let Some(known) = out.iter_mut().find(|d| d.request_id == request_id) {
            known.count += 1;
            continue;
        }
        let Some(decision) = details
            .get("decision")
            .and_then(|d| serde_json::from_value::<Decision>(d.clone()).ok())
        else {
            continue;
        };
        let request = details.get("request").unwrap_or(&Value::Null);
        out.push(ReportDecision {
            request_id,
            principal: text(request, "principal"),
            action: text(request, "action"),
            resource: text(request, "resource"),
            decision,
            determining_policies: details
                .get("determiningPolicies")
                .and_then(|p| serde_json::from_value(p.clone()).ok())
                .unwrap_or_default(),
            count: 1,
            first_at_ms: event.virtual_time_ms,
            first_seq: event.seq,
        });
    }
    out
}

/// The report of one incident, or `None` when its start is not (or no
/// longer) among the events the timeline keeps.
pub fn build(input: &ReportInput<'_>, incident_id: &str) -> Option<IncidentReport> {
    let ReportInput {
        topo,
        scenarios,
        events,
        metrics,
        head_ms,
    } = *input;
    let started = events
        .iter()
        .find(|e| e.kind == EventKind::IncidentStarted && belongs(e, incident_id))?;
    let start_ms = started.virtual_time_ms;
    let scenario_id = started
        .details
        .get("scenarioId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let scenario = scenarios
        .iter()
        .find(|s| s.info.id == scenario_id && s.info.available);
    let resolved = events
        .iter()
        .find(|e| e.kind == EventKind::IncidentResolved && belongs(e, incident_id));
    let resolved_at_ms = resolved.map(|e| e.virtual_time_ms);
    // Another incident starting ends what can be said about this one.
    let next_start = events
        .iter()
        .filter(|e| e.kind == EventKind::IncidentStarted && e.virtual_time_ms > start_ms)
        .map(|e| e.virtual_time_ms)
        .min();
    let until_ms = next_start.map_or(head_ms, |next| next.min(head_ms));

    // Phases as they were entered, with what each prescribes.
    let entered: Vec<(&SecurityEvent, u32)> = events
        .iter()
        .filter(|e| e.kind == EventKind::IncidentPhase && belongs(e, incident_id))
        .map(|e| {
            let index = e
                .details
                .get("phaseIndex")
                .and_then(Value::as_u64)
                .unwrap_or_default() as u32;
            (e, index)
        })
        .collect();
    let views: Vec<Option<PhaseView>> = entered
        .iter()
        .map(|(_, index)| {
            scenario.and_then(|scenario| {
                scenario
                    .phases
                    .get(*index as usize)
                    .map(|phase| phase_view(topo, scenario, phase))
            })
        })
        .collect();
    // The phase in force at a moment; none once the scenario has ended.
    let phase_at = |at_ms: u64| -> Option<usize> {
        if resolved_at_ms.is_some_and(|end| at_ms >= end) {
            return None;
        }
        entered
            .iter()
            .rposition(|(event, _)| event.virtual_time_ms <= at_ms)
    };

    // One pass over the health transitions the timeline keeps, in order.
    // Those before the incident only bring the picture up to its start.
    let mut health = vec![Health::Healthy; topo.node_count()];
    let mut faults: BTreeMap<usize, String> = BTreeMap::new();
    let mut transitions: Vec<(ReportTransition, usize)> = Vec::new();
    // How many services were not normal after each tick that changed one.
    let mut unwell: Vec<Peak> = Vec::new();
    let ordered: Vec<&SecurityEvent> = events
        .iter()
        .filter(|e| e.virtual_time_ms <= until_ms)
        .collect();
    let mut at = 0;
    while at < ordered.len() {
        // Everything of one tick is applied before any of it is explained:
        // within a tick the model has already carried a failure to callers.
        let tick = ordered[at].tick;
        let end = ordered[at..]
            .iter()
            .position(|e| e.tick != tick)
            .map_or(ordered.len(), |offset| at + offset);
        let batch = &ordered[at..end];
        at = end;
        let mut changed: Vec<(&SecurityEvent, usize, Health, Health)> = Vec::new();
        for event in batch {
            match event.kind {
                EventKind::HealthTransition => {
                    let node = event.node_ids.first().and_then(|id| topo.node(id));
                    let from = health_of(&event.details, "from");
                    let to = health_of(&event.details, "to");
                    if let (Some(node), Some(from), Some(to)) = (node, from, to) {
                        health[node] = to;
                        changed.push((event, node, from, to));
                    }
                }
                EventKind::System if event.details.get("fault").is_some() => {
                    let effect = event
                        .title
                        .strip_prefix("Fault placed by hand: ")
                        .unwrap_or(&event.title);
                    for node in event.node_ids.iter().filter_map(|id| topo.node(id)) {
                        faults.insert(node, effect.to_string());
                    }
                }
                EventKind::System if event.details.get("lifted").is_some() => {
                    for node in event.node_ids.iter().filter_map(|id| topo.node(id)) {
                        faults.remove(&node);
                    }
                }
                _ => {}
            }
        }
        let now_ms = batch[0].virtual_time_ms;
        if now_ms < start_ms {
            continue;
        }
        let view = phase_at(now_ms).and_then(|index| views[index].as_ref());
        let attribution = Attribution {
            topo,
            phase: view,
            faults: &faults,
            health: &health,
        };
        for (event, node, from, to) in changed {
            let saturation = event
                .details
                .get("saturation")
                .and_then(Value::as_f64)
                .unwrap_or_default();
            transitions.push((
                ReportTransition {
                    seq: event.seq,
                    node_id: topo.node_id(node).to_string(),
                    at_ms: now_ms,
                    from,
                    to,
                    cause: (to > from).then(|| attribution.cause(node, saturation)),
                },
                node,
            ));
        }
        unwell.push(Peak {
            value: health.iter().filter(|h| **h != Health::Healthy).count() as f64,
            at_ms: now_ms,
        });
    }

    // Affected: every service that got worse while the scenario ran. What
    // gets worse after it has ended is listed, but is not counted as its.
    let impacted: BTreeSet<usize> = transitions
        .iter()
        .filter(|(t, _)| t.to > t.from && resolved_at_ms.is_none_or(|end| t.at_ms <= end))
        .map(|(_, node)| *node)
        .collect();

    // Recovered: once the scenario has ended, the moment none of the
    // affected services was unwell any more. That can be before the end
    // (they were all back while the last phase ran out) or after it.
    let recovered_at_ms = resolved_at_ms.and_then(|end| {
        let mut state: BTreeMap<usize, Health> = BTreeMap::new();
        // With nothing affected there was nothing to recover from.
        let mut clear_since = None;
        for (transition, node) in &transitions {
            if !impacted.contains(node) {
                continue;
            }
            // A service that got worse in the very tick the scenario ended
            // is counted as affected (see `impacted`), so it is heard here
            // too: only what comes after the end is left out.
            if transition.at_ms > end && clear_since.is_some() {
                break;
            }
            state.insert(*node, transition.to);
            let clear = state.values().all(|h| *h == Health::Healthy);
            clear_since = clear.then(|| clear_since.unwrap_or(transition.at_ms));
        }
        clear_since
    });
    let observed_until_ms = match (recovered_at_ms, resolved_at_ms) {
        (Some(recovered), Some(end)) => recovered.max(end),
        _ => until_ms,
    };
    transitions.retain(|(t, _)| t.at_ms <= observed_until_ms);

    let mut last_state: BTreeMap<usize, Health> = BTreeMap::new();
    for (transition, node) in &transitions {
        last_state.insert(*node, transition.to);
    }
    let still_unhealthy: Vec<String> = impacted
        .iter()
        .filter(|node| last_state.get(node).is_some_and(|h| *h != Health::Healthy))
        .map(|node| topo.node_id(*node).to_string())
        .collect();
    let peak_unhealthy = unwell
        .iter()
        .filter(|point| point.at_ms <= observed_until_ms && point.value > 0.0)
        .copied()
        // The first moment the highest count was reached.
        .rev()
        .max_by(|a, b| a.value.total_cmp(&b.value));

    let mut truncated = false;
    let mut bounded = |mut list: Vec<ReportTransition>| {
        if list.len() > MAX_LISTED {
            list.truncate(MAX_LISTED);
            truncated = true;
        }
        list
    };

    let mut seen = BTreeSet::new();
    let propagation = bounded(
        transitions
            .iter()
            .filter(|(t, node)| t.to > t.from && impacted.contains(node) && seen.insert(*node))
            .map(|(t, _)| t.clone())
            .collect(),
    );
    // Recovery is counted from the first phase that is not `active`, or
    // from the end when the scenario was stopped before one.
    let recovering_from = entered
        .iter()
        .find(|(event, _)| {
            event
                .details
                .get("status")
                .and_then(|status| serde_json::from_value::<IncidentStatus>(status.clone()).ok())
                .is_some_and(|status| status != IncidentStatus::Active)
        })
        .map(|(event, _)| event.virtual_time_ms)
        .or(resolved_at_ms);
    let recovery = bounded(match recovering_from {
        Some(from) => transitions
            .iter()
            .filter(|(t, _)| t.to < t.from && t.at_ms >= from)
            .map(|(t, _)| t.clone())
            .collect(),
        None => Vec::new(),
    });

    let in_range = |from: u64, to: u64| {
        metrics
            .iter()
            .copied()
            .filter(move |s| s.virtual_time_ms >= from && s.virtual_time_ms <= to)
    };
    let figures_until = observed_until_ms;

    let phases: Vec<ReportPhase> = entered
        .iter()
        .enumerate()
        .map(|(position, (event, index))| {
            let at_ms = event.virtual_time_ms;
            let ended_at_ms = entered
                .get(position + 1)
                .map(|(next, _)| next.virtual_time_ms)
                .or(resolved_at_ms);
            let last_ms = ended_at_ms.map_or(until_ms, |end| end.saturating_sub(1));
            let status = event
                .details
                .get("status")
                .and_then(|status| serde_json::from_value(status.clone()).ok())
                .unwrap_or(IncidentStatus::Active);
            let name = event
                .details
                .get("phaseName")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            ReportPhase {
                index: *index,
                name,
                status,
                description: event.message.clone(),
                at_ms,
                since_start_ms: at_ms.saturating_sub(start_ms),
                ended_at_ms,
                prescribed: views[position]
                    .as_ref()
                    .map(|view| view.prescribed.clone())
                    .unwrap_or_default(),
                transitions: bounded(
                    transitions
                        .iter()
                        .filter(|(t, _)| t.to > t.from && t.at_ms >= at_ms && t.at_ms <= last_ms)
                        .map(|(t, _)| t.clone())
                        .collect(),
                ),
                events: events
                    .iter()
                    .filter(|e| {
                        belongs(e, incident_id)
                            && matches!(
                                e.kind,
                                EventKind::Alert
                                    | EventKind::AuthFailure
                                    | EventKind::Mitigation
                                    | EventKind::Reroute
                            )
                            && e.virtual_time_ms >= at_ms
                            && e.virtual_time_ms <= last_ms
                    })
                    .take(MAX_LISTED)
                    .map(|e| ReportEvent {
                        seq: e.seq,
                        at_ms: e.virtual_time_ms,
                        severity: e.severity,
                        title: e.title.clone(),
                        // A detection rule says which rule fired; an event
                        // the scenario announces carries nothing.
                        scripted: e.details.is_null(),
                    })
                    .collect(),
                peak_error_rate: peak_of(in_range(at_ms, last_ms), |s| s.error_rate),
                peak_p95_latency_ms: peak_of(in_range(at_ms, last_ms), |s| s.p95_latency_ms),
            }
        })
        .collect();

    let origin = scenario
        .and_then(|s| s.root_cause)
        .map(|node| (node, OriginBasis::Declared))
        .or_else(|| {
            views
                .first()
                .and_then(Option::as_ref)
                .and_then(|view| view.direct.keys().next().copied())
                .map(|node| (node, OriginBasis::FirstPrescribed))
        })
        .map(|(node, basis)| ReportOrigin {
            node_id: topo.node_id(node).to_string(),
            basis,
        })
        .or_else(|| {
            propagation.first().map(|first| ReportOrigin {
                node_id: first.node_id.clone(),
                basis: OriginBasis::FirstObserved,
            })
        });

    let status = if resolved.is_some() {
        IncidentStatus::Resolved
    } else {
        phases
            .last()
            .map_or(IncidentStatus::Active, |phase| phase.status)
    };
    let during: Vec<MetricSample> = in_range(start_ms, figures_until).collect();
    let mean_error_rate = (!during.is_empty()).then(|| {
        round_to(
            during.iter().map(|s| s.error_rate).sum::<f64>() / during.len() as f64,
            4,
        )
    });

    Some(IncidentReport {
        schema_version: SCHEMA_VERSION.to_string(),
        data_source: topo.spec.data_source,
        incident_id: incident_id.to_string(),
        scenario_id,
        title: scenario.map_or_else(
            || {
                started
                    .title
                    .strip_suffix(" started")
                    .unwrap_or(&started.title)
                    .to_string()
            },
            |s| s.info.name.clone(),
        ),
        severity: scenario.map_or(Severity::Warning, |s| s.info.severity),
        status,
        started_at_ms: start_ms,
        resolved_at_ms,
        resolution: resolved.map(|e| e.message.clone()),
        recovered_at_ms,
        observed_until_ms,
        origin,
        baseline: metrics
            .iter()
            .rev()
            .find(|s| s.virtual_time_ms <= start_ms)
            .or_else(|| metrics.front())
            .map(|s| ReportBaseline {
                error_rate: s.error_rate,
                p95_latency_ms: s.p95_latency_ms,
            }),
        phases,
        propagation,
        recovery,
        decisions: decisions_of(events, incident_id),
        impacted_node_ids: impacted
            .iter()
            .map(|node| topo.node_id(*node).to_string())
            .collect(),
        still_unhealthy_node_ids: still_unhealthy,
        peak_error_rate: peak_of(during.iter().copied(), |s| s.error_rate),
        peak_p95_latency_ms: peak_of(during.iter().copied(), |s| s.p95_latency_ms),
        peak_unhealthy,
        mean_error_rate,
        objectives: objectives_over(topo, &during),
        truncated,
    })
}

/// How long each of the platform's objectives was not met over the samples
/// of an incident. A sample is a second of the simulation; one at or over
/// the threshold is a second the objective was not met.
pub fn objectives_over(topo: &SimTopology, during: &[MetricSample]) -> Vec<ReportObjective> {
    let second = METRIC_INTERVAL * TICK_MS;
    let over = |kind: ObjectiveKind, threshold: f64, figure: fn(&MetricSample) -> f64| {
        let mut breached = during.iter().filter(|sample| figure(sample) >= threshold);
        let first = breached.next();
        ReportObjective {
            kind,
            threshold,
            breached_ms: first.map_or(0, |_| (breached.count() as u64 + 1) * second),
            first_breached_at_ms: first.map(|sample| sample.virtual_time_ms),
        }
    };
    vec![
        over(ObjectiveKind::ErrorRate, ERROR_OBJECTIVE, |sample| {
            sample.error_rate
        }),
        over(
            ObjectiveKind::LatencyP95,
            round_to(topo.baseline_p95 * LATENCY_OBJECTIVE_FACTOR, 1),
            |sample| sample.p95_latency_ms,
        ),
    ]
}

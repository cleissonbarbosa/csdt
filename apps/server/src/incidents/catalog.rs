//! The five fictional incident scenarios.
//!
//! Timings are virtual milliseconds from scenario start. Every phase lists the
//! complete set of effects that hold during it; anything omitted ramps back to
//! nominal.

use crate::domain::{EventKind, IncidentStatus, RejectReason, ScenarioCategory, Severity};

use super::{
    EdgeSet, Effect, FlowDef, Hop, NodeSel, NodeSet, PhaseDef, Rate, ScenarioDef, ScriptedEvent,
};

const EDGE: NodeSel = NodeSel::Role("edgeRouter");
const SOURCE: NodeSel = NodeSel::Role("attackSource");
const PARTNER: NodeSel = NodeSel::Role("partnerClient");
const GATEWAY: NodeSel = NodeSel::Role("primaryGateway");
const AUTH: NodeSel = NodeSel::Role("primaryAuth");
const AUTHORIZER: NodeSel = NodeSel::Role("primaryAuthorizer");
const DATABASE: NodeSel = NodeSel::Role("primaryDatabase");
const LEDGER: NodeSel = NodeSel::Role("protectedResource");
const CUSTOMERS: NodeSel = NodeSel::Role("resource:Customer");
const MONITOR: NodeSel = NodeSel::Role("securityMonitor");
const OUTAGE_GATEWAY: NodeSel = NodeSel::GatewayOf("outageRegion");
const FAILOVER_GATEWAY: NodeSel = NodeSel::GatewayOf("failoverRegion");
const OUTAGE_REGION: NodeSet = NodeSet::Region("outageRegion");

pub const DDOS_SURGE: &str = "ddos-surge";
pub const CREDENTIAL_STUFFING: &str = "credential-stuffing";
pub const CEDAR_DENIAL: &str = "cedar-denial";
pub const CASCADING_FAILURE: &str = "cascading-failure";
pub const REGIONAL_OUTAGE: &str = "regional-outage";

fn event(
    delay_ms: u64,
    severity: Severity,
    kind: EventKind,
    title: &'static str,
    message: &'static str,
    nodes: &[NodeSel],
) -> ScriptedEvent {
    ScriptedEvent {
        delay_ms,
        severity,
        kind,
        title,
        message,
        nodes: nodes.to_vec(),
    }
}

pub fn all() -> Vec<ScenarioDef> {
    vec![
        ddos_surge(),
        credential_stuffing(),
        cedar_denial(),
        cascading_failure(),
        regional_outage(),
    ]
}

/// Scenario 1 — volumetric flood against the primary API gateway.
fn ddos_surge() -> ScenarioDef {
    const FLOOD: usize = 0;
    ScenarioDef {
        id: DDOS_SURGE,
        name: "DDoS Surge",
        summary: "A volumetric flood from unattributed sources overwhelms the primary API gateway until edge filtering absorbs it.",
        category: ScenarioCategory::Availability,
        severity: Severity::Critical,
        duration_ms: 96_000,
        root_cause: Some(GATEWAY),
        targets: vec![NodeSet::One(GATEWAY), NodeSet::One(EDGE), NodeSet::One(SOURCE)],
        flows: vec![FlowDef {
            id: "flood",
            label: "Volumetric flood",
            suspicious: true,
            hops: vec![Hop::Direct(SOURCE, EDGE), Hop::Direct(EDGE, GATEWAY)],
            spill: true,
            authz: None,
        }],
        phases: vec![
            PhaseDef {
                name: "Probing",
                at_ms: 0,
                ramp_ms: 4_000,
                status: IncidentStatus::Active,
                description: "Low-rate probes map the public API surface.",
                effects: vec![Effect::FlowRate(FLOOD, Rate::OfCapacity(GATEWAY, 0.12))],
                events: vec![event(
                    2_000,
                    Severity::Notice,
                    EventKind::Alert,
                    "Unusual request pattern at the edge",
                    "Requests from sources with no reputation are enumerating API routes.",
                    &[EDGE, SOURCE],
                )],
            },
            PhaseDef {
                name: "Volumetric surge",
                at_ms: 8_000,
                ramp_ms: 8_000,
                status: IncidentStatus::Active,
                description: "Request volume climbs to several times the gateway's capacity. Latency rises and requests are shed.",
                effects: vec![Effect::FlowRate(FLOOD, Rate::OfCapacity(GATEWAY, 2.2))],
                events: vec![
                    event(
                        7_000,
                        Severity::Critical,
                        EventKind::Alert,
                        "Volumetric attack detected",
                        "Inbound request rate exceeds the gateway's provisioned capacity; legitimate requests are being shed.",
                        &[MONITOR, GATEWAY],
                    ),
                    event(
                        14_000,
                        Severity::Warning,
                        EventKind::Alert,
                        "Downstream services saturating",
                        "Traffic that passes the gateway is exhausting service capacity behind it.",
                        &[GATEWAY],
                    ),
                ],
            },
            PhaseDef {
                name: "Edge mitigation",
                at_ms: 36_000,
                ramp_ms: 6_000,
                status: IncidentStatus::Mitigating,
                description: "Rate-based rules at the edge router drop traffic from the offending sources before it reaches the gateway.",
                effects: vec![
                    Effect::FlowRate(FLOOD, Rate::OfCapacity(GATEWAY, 2.2)),
                    Effect::FlowReject(FLOOD, EDGE, 0.94, RejectReason::Waf),
                ],
                events: vec![event(
                    0,
                    Severity::Notice,
                    EventKind::Mitigation,
                    "Edge filtering engaged",
                    "Web application firewall rules now reject the flood at the edge router.",
                    &[EDGE],
                )],
            },
            PhaseDef {
                name: "Attack subsides",
                at_ms: 62_000,
                ramp_ms: 10_000,
                status: IncidentStatus::Recovering,
                description: "The flood loses intensity while filtering stays in place.",
                effects: vec![
                    Effect::FlowRate(FLOOD, Rate::OfCapacity(GATEWAY, 0.25)),
                    Effect::FlowReject(FLOOD, EDGE, 0.94, RejectReason::Waf),
                ],
                events: vec![],
            },
            PhaseDef {
                name: "Recovery",
                at_ms: 80_000,
                ramp_ms: 8_000,
                status: IncidentStatus::Recovering,
                description: "Traffic returns to its normal shape and services recover.",
                effects: vec![],
                events: vec![event(
                    6_000,
                    Severity::Info,
                    EventKind::Mitigation,
                    "Traffic back to baseline",
                    "Request volume at the edge has returned to its normal range.",
                    &[EDGE],
                )],
            },
        ],
    }
}

/// Scenario 2 — credential stuffing against the identity service.
fn credential_stuffing() -> ScenarioDef {
    const STUFFING: usize = 0;
    ScenarioDef {
        id: CREDENTIAL_STUFFING,
        name: "Credential Stuffing",
        summary: "Leaked credential pairs are replayed against the login endpoint. Almost all fail; the few that succeed are stopped by policy.",
        category: ScenarioCategory::Identity,
        severity: Severity::Warning,
        duration_ms: 84_000,
        root_cause: Some(AUTH),
        targets: vec![NodeSet::One(AUTH), NodeSet::One(GATEWAY), NodeSet::One(SOURCE)],
        flows: vec![FlowDef {
            id: "stuffing",
            label: "Replayed credentials",
            suspicious: true,
            hops: vec![
                Hop::Direct(SOURCE, EDGE),
                Hop::Direct(EDGE, GATEWAY),
                Hop::Direct(GATEWAY, AUTH),
                Hop::Direct(GATEWAY, AUTHORIZER),
            ],
            spill: false,
            // The rare successful login still lacks MFA: Cedar decides its fate.
            authz: Some(("stolen-session-export", AUTHORIZER)),
        }],
        phases: vec![
            PhaseDef {
                name: "Low and slow",
                at_ms: 0,
                ramp_ms: 3_000,
                status: IncidentStatus::Active,
                description: "A trickle of login attempts tests which leaked credentials are still valid.",
                effects: vec![
                    Effect::FlowRate(STUFFING, Rate::OfCapacity(AUTH, 0.06)),
                    Effect::FlowReject(STUFFING, AUTH, 0.985, RejectReason::AuthFailure),
                ],
                events: vec![event(
                    3_000,
                    Severity::Notice,
                    EventKind::AuthFailure,
                    "Authentication failures rising",
                    "Failed logins are spread thinly across many accounts.",
                    &[AUTH],
                )],
            },
            PhaseDef {
                name: "Stuffing burst",
                at_ms: 10_000,
                ramp_ms: 6_000,
                status: IncidentStatus::Active,
                description: "Login attempts surge past the identity service's capacity. Legitimate sign-ins start to fail.",
                effects: vec![
                    Effect::FlowRate(STUFFING, Rate::OfCapacity(AUTH, 1.25)),
                    Effect::FlowReject(STUFFING, AUTH, 0.985, RejectReason::AuthFailure),
                ],
                events: vec![
                    event(
                        6_000,
                        Severity::Critical,
                        EventKind::Alert,
                        "Credential stuffing pattern detected",
                        "More than 98 % of login attempts from unattributed sources fail, across thousands of distinct accounts.",
                        &[MONITOR, AUTH],
                    ),
                    event(
                        10_000,
                        Severity::Warning,
                        EventKind::AuthFailure,
                        "Valid credentials replayed without MFA",
                        "A small share of attempts authenticate, but the sessions carry no MFA assertion.",
                        &[AUTH, AUTHORIZER],
                    ),
                ],
            },
            PhaseDef {
                name: "Adaptive rate limiting",
                at_ms: 30_000,
                ramp_ms: 5_000,
                status: IncidentStatus::Mitigating,
                description: "The gateway throttles login attempts per source, relieving the identity service.",
                effects: vec![
                    Effect::FlowRate(STUFFING, Rate::OfCapacity(AUTH, 1.25)),
                    Effect::FlowReject(STUFFING, GATEWAY, 0.92, RejectReason::RateLimit),
                    Effect::FlowReject(STUFFING, AUTH, 0.985, RejectReason::AuthFailure),
                ],
                events: vec![event(
                    0,
                    Severity::Notice,
                    EventKind::Mitigation,
                    "Login rate limiting engaged",
                    "The API gateway now answers excess login attempts with HTTP 429.",
                    &[GATEWAY],
                )],
            },
            PhaseDef {
                name: "Source blocked",
                at_ms: 50_000,
                ramp_ms: 4_000,
                status: IncidentStatus::Mitigating,
                description: "The offending sources are blocked at the edge.",
                effects: vec![
                    Effect::FlowRate(STUFFING, Rate::OfCapacity(AUTH, 0.9)),
                    Effect::FlowReject(STUFFING, EDGE, 0.99, RejectReason::Waf),
                    Effect::FlowReject(STUFFING, GATEWAY, 0.92, RejectReason::RateLimit),
                    Effect::FlowReject(STUFFING, AUTH, 0.985, RejectReason::AuthFailure),
                ],
                events: vec![event(
                    0,
                    Severity::Notice,
                    EventKind::Mitigation,
                    "Sources blocked at the edge",
                    "Reputation rules reject the attacking sources at the edge router.",
                    &[EDGE],
                )],
            },
            PhaseDef {
                name: "Recovery",
                at_ms: 68_000,
                ramp_ms: 6_000,
                status: IncidentStatus::Recovering,
                description: "Attempts stop and authentication returns to normal.",
                effects: vec![],
                events: vec![event(
                    8_000,
                    Severity::Info,
                    EventKind::Mitigation,
                    "Authentication back to baseline",
                    "Login failure rate is back in its normal range.",
                    &[AUTH],
                )],
            },
        ],
    }
}

/// Scenario 3 — a principal attempts actions Cedar policies prohibit.
fn cedar_denial() -> ScenarioDef {
    const ALLOWED: usize = 0;
    const EXPORT: usize = 1;
    const READ: usize = 2;
    const DELETE: usize = 3;

    let through_gateway = |last: Hop| {
        vec![
            Hop::Direct(PARTNER, EDGE),
            Hop::Direct(EDGE, GATEWAY),
            Hop::Direct(GATEWAY, AUTH),
            Hop::Direct(GATEWAY, AUTHORIZER),
            last,
        ]
    };
    let probes = |rate: f64| {
        vec![
            Effect::FlowRate(ALLOWED, Rate::OfCapacity(AUTHORIZER, 0.03)),
            Effect::FlowRate(EXPORT, Rate::OfCapacity(AUTHORIZER, rate)),
            Effect::FlowRate(READ, Rate::OfCapacity(AUTHORIZER, rate)),
            Effect::FlowRate(DELETE, Rate::OfCapacity(AUTHORIZER, rate * 0.6)),
        ]
    };

    ScenarioDef {
        id: CEDAR_DENIAL,
        name: "Cedar Authorization Denial",
        summary: "An authenticated contractor from another tenant repeatedly attempts prohibited actions. Cedar denies every one of them.",
        category: ScenarioCategory::Authorization,
        severity: Severity::Warning,
        duration_ms: 70_000,
        root_cause: Some(AUTHORIZER),
        targets: vec![
            NodeSet::One(PARTNER),
            NodeSet::One(GATEWAY),
            NodeSet::One(AUTH),
            NodeSet::One(AUTHORIZER),
            NodeSet::One(LEDGER),
        ],
        flows: vec![
            FlowDef {
                id: "alice-view-ledger",
                label: "Alice · viewLedger",
                suspicious: false,
                hops: through_gateway(Hop::Path(GATEWAY, LEDGER)),
                spill: false,
                authz: Some(("alice-view-ledger", AUTHORIZER)),
            },
            FlowDef {
                id: "mallory-export-ledger",
                label: "Mallory · exportLedger",
                suspicious: true,
                hops: through_gateway(Hop::Path(GATEWAY, LEDGER)),
                spill: false,
                authz: Some(("mallory-export-ledger", AUTHORIZER)),
            },
            FlowDef {
                id: "mallory-view-ledger",
                label: "Mallory · viewLedger",
                suspicious: true,
                hops: through_gateway(Hop::Path(GATEWAY, LEDGER)),
                spill: false,
                authz: Some(("mallory-view-ledger", AUTHORIZER)),
            },
            FlowDef {
                id: "mallory-delete-customer",
                label: "Mallory · deleteCustomer",
                suspicious: true,
                hops: through_gateway(Hop::Path(GATEWAY, CUSTOMERS)),
                spill: false,
                authz: Some(("mallory-delete-customer", AUTHORIZER)),
            },
        ],
        phases: vec![
            PhaseDef {
                name: "Permitted access",
                at_ms: 0,
                ramp_ms: 3_000,
                status: IncidentStatus::Active,
                description: "A finance analyst reads her own tenant's ledger. Cedar permits it and the request reaches the resource.",
                effects: vec![Effect::FlowRate(ALLOWED, Rate::OfCapacity(AUTHORIZER, 0.05))],
                events: vec![],
            },
            PhaseDef {
                name: "Prohibited export",
                at_ms: 10_000,
                ramp_ms: 4_000,
                status: IncidentStatus::Active,
                description: "A contractor of another tenant requests an export of the ledger. Authentication succeeds; Cedar denies the action.",
                effects: vec![
                    Effect::FlowRate(ALLOWED, Rate::OfCapacity(AUTHORIZER, 0.03)),
                    Effect::FlowRate(EXPORT, Rate::OfCapacity(AUTHORIZER, 0.1)),
                ],
                events: vec![event(
                    4_000,
                    Severity::Warning,
                    EventKind::Alert,
                    "Cross-tenant access attempt",
                    "An authenticated principal is requesting another tenant's ledger.",
                    &[AUTHORIZER, LEDGER],
                )],
            },
            PhaseDef {
                name: "Escalation attempts",
                at_ms: 26_000,
                ramp_ms: 5_000,
                status: IncidentStatus::Active,
                description: "The principal cycles through other actions and resources. Every request is denied.",
                effects: probes(0.11),
                events: vec![event(
                    8_000,
                    Severity::Critical,
                    EventKind::Alert,
                    "Repeated authorization denials for one principal",
                    "The same principal has been denied across several actions and resource types.",
                    &[MONITOR, AUTHORIZER],
                )],
            },
            PhaseDef {
                name: "Session revoked",
                at_ms: 46_000,
                ramp_ms: 3_000,
                status: IncidentStatus::Mitigating,
                description: "The identity service revokes the principal's sessions; requests now stop at authentication.",
                effects: {
                    let mut effects = probes(0.11);
                    for flow in [EXPORT, READ, DELETE] {
                        effects.push(Effect::FlowReject(
                            flow,
                            AUTH,
                            1.0,
                            RejectReason::SessionRevoked,
                        ));
                    }
                    effects
                },
                events: vec![event(
                    0,
                    Severity::Notice,
                    EventKind::Mitigation,
                    "Sessions revoked",
                    "All sessions of the offending principal were revoked by the identity service.",
                    &[AUTH],
                )],
            },
            PhaseDef {
                name: "Recovery",
                at_ms: 58_000,
                ramp_ms: 5_000,
                status: IncidentStatus::Recovering,
                description: "The attempts stop.",
                effects: vec![],
                events: vec![],
            },
        ],
    }
}

/// Scenario 4 — database degradation cascading through dependents and queues.
fn cascading_failure() -> ScenarioDef {
    let db = NodeSet::One(DATABASE);
    ScenarioDef {
        id: CASCADING_FAILURE,
        name: "Cascading Service Failure",
        summary: "The primary orders database degrades. Dependent services fail, queues back up, and circuit breakers finally stop the spread.",
        category: ScenarioCategory::Resilience,
        severity: Severity::Critical,
        duration_ms: 104_000,
        root_cause: Some(DATABASE),
        targets: vec![db],
        flows: vec![],
        phases: vec![
            PhaseDef {
                name: "Latency creep",
                at_ms: 0,
                ramp_ms: 8_000,
                status: IncidentStatus::Active,
                description: "Storage latency on the primary database climbs steadily.",
                effects: vec![Effect::Latency(db, 6.0)],
                events: vec![event(
                    6_000,
                    Severity::Warning,
                    EventKind::Alert,
                    "Database latency above objective",
                    "Query latency on the primary orders database is several times its baseline.",
                    &[DATABASE],
                )],
            },
            PhaseDef {
                name: "Connection exhaustion",
                at_ms: 14_000,
                ramp_ms: 8_000,
                status: IncidentStatus::Active,
                description: "Slow queries exhaust connection pools. The database serves a fraction of its normal load and callers start timing out.",
                effects: vec![
                    Effect::Latency(db, 14.0),
                    Effect::Capacity(db, 0.3),
                    Effect::ErrorInject(db, 0.2),
                ],
                events: vec![event(
                    8_000,
                    Severity::Critical,
                    EventKind::Alert,
                    "Dependent services failing",
                    "Services that read or write orders are returning errors; queue consumers are falling behind.",
                    &[MONITOR, DATABASE],
                )],
            },
            PhaseDef {
                name: "Retry storm",
                at_ms: 34_000,
                ramp_ms: 6_000,
                status: IncidentStatus::Active,
                description: "Callers retry failed queries, multiplying the load on an already degraded database.",
                effects: vec![
                    Effect::Latency(db, 20.0),
                    Effect::Capacity(db, 0.12),
                    Effect::ErrorInject(db, 0.55),
                    Effect::EdgeWeight(EdgeSet::InboundSync(DATABASE), 1.8),
                ],
                events: vec![],
            },
            PhaseDef {
                name: "Circuit breakers open",
                at_ms: 52_000,
                ramp_ms: 4_000,
                status: IncidentStatus::Mitigating,
                description: "Callers stop sending queries and fail fast, giving the database room to recover.",
                effects: vec![
                    Effect::Latency(db, 4.0),
                    Effect::Capacity(db, 0.35),
                    Effect::ErrorInject(db, 0.25),
                    Effect::EdgeWeight(EdgeSet::InboundSync(DATABASE), 0.2),
                    Effect::EdgeError(EdgeSet::InboundSync(DATABASE), 0.6),
                ],
                events: vec![event(
                    0,
                    Severity::Notice,
                    EventKind::Mitigation,
                    "Circuit breakers opened",
                    "Callers of the orders database are failing fast instead of queueing requests.",
                    &[DATABASE],
                )],
            },
            PhaseDef {
                name: "Replica promoted",
                at_ms: 66_000,
                ramp_ms: 8_000,
                status: IncidentStatus::Recovering,
                description: "A healthy replica takes over as primary; breakers close gradually.",
                effects: vec![Effect::Latency(db, 1.3), Effect::Capacity(db, 0.85)],
                events: vec![event(
                    0,
                    Severity::Notice,
                    EventKind::Mitigation,
                    "Replica promoted to primary",
                    "A replica of the orders database was promoted and is serving traffic.",
                    &[DATABASE],
                )],
            },
            PhaseDef {
                name: "Backlog drain",
                at_ms: 84_000,
                ramp_ms: 6_000,
                status: IncidentStatus::Recovering,
                description: "Queue consumers work through the accumulated backlog.",
                effects: vec![],
                events: vec![],
            },
        ],
    }
}

/// Scenario 5 — a whole region becomes unavailable and traffic fails over.
fn regional_outage() -> ScenarioDef {
    let ingress = EdgeSet::Between(EDGE, OUTAGE_GATEWAY);
    let shift = |fraction: f64| Effect::RouteShift {
        from: (EDGE, OUTAGE_GATEWAY),
        to: (EDGE, FAILOVER_GATEWAY),
        fraction,
    };
    ScenarioDef {
        id: REGIONAL_OUTAGE,
        name: "Regional Outage",
        summary: "An entire cloud region becomes unreachable. Health checks fail, traffic is re-routed to the failover region, and the region is later restored.",
        category: ScenarioCategory::Resilience,
        severity: Severity::Critical,
        duration_ms: 100_000,
        root_cause: Some(OUTAGE_GATEWAY),
        targets: vec![OUTAGE_REGION, NodeSet::One(EDGE), NodeSet::One(FAILOVER_GATEWAY)],
        flows: vec![],
        phases: vec![
            PhaseDef {
                name: "Network partition",
                at_ms: 0,
                ramp_ms: 5_000,
                status: IncidentStatus::Active,
                description: "Connectivity into the region degrades: packets are lost and latency spikes.",
                effects: vec![
                    Effect::EdgeLatency(ingress, 6.0),
                    Effect::EdgeError(ingress, 0.35),
                ],
                events: vec![event(
                    3_000,
                    Severity::Warning,
                    EventKind::Alert,
                    "Packet loss into region",
                    "Health probes into the region are intermittently failing.",
                    &[EDGE, OUTAGE_GATEWAY],
                )],
            },
            PhaseDef {
                name: "Region dark",
                at_ms: 9_000,
                ramp_ms: 2_000,
                status: IncidentStatus::Active,
                description: "Every service in the region is unreachable. Requests routed there fail.",
                effects: vec![Effect::Down(OUTAGE_REGION), Effect::EdgeError(ingress, 1.0)],
                events: vec![event(
                    3_000,
                    Severity::Critical,
                    EventKind::Alert,
                    "Region unavailable",
                    "All health checks for the region are failing.",
                    &[MONITOR, OUTAGE_GATEWAY],
                )],
            },
            PhaseDef {
                name: "Failover",
                at_ms: 24_000,
                ramp_ms: 6_000,
                status: IncidentStatus::Mitigating,
                description: "The edge router withdraws the region and sends its traffic to the failover region, which absorbs the extra load.",
                effects: vec![
                    Effect::Down(OUTAGE_REGION),
                    Effect::EdgeError(ingress, 1.0),
                    shift(1.0),
                ],
                events: vec![event(
                    0,
                    Severity::Notice,
                    EventKind::Reroute,
                    "Traffic re-routed",
                    "The edge router is steering the region's traffic to the failover region.",
                    &[EDGE, FAILOVER_GATEWAY],
                )],
            },
            PhaseDef {
                name: "Region restored",
                at_ms: 56_000,
                ramp_ms: 6_000,
                status: IncidentStatus::Recovering,
                description: "Services in the region come back with reduced capacity while caches warm up. Traffic stays on the failover region.",
                effects: vec![Effect::Capacity(OUTAGE_REGION, 0.5), shift(1.0)],
                events: vec![event(
                    4_000,
                    Severity::Info,
                    EventKind::Mitigation,
                    "Region reachable again",
                    "Health checks for the region are passing; capacity is still warming up.",
                    &[OUTAGE_GATEWAY],
                )],
            },
            PhaseDef {
                name: "Rebalancing",
                at_ms: 72_000,
                ramp_ms: 14_000,
                status: IncidentStatus::Recovering,
                description: "Traffic shifts back to the restored region gradually.",
                effects: vec![],
                events: vec![event(
                    0,
                    Severity::Notice,
                    EventKind::Reroute,
                    "Traffic rebalancing",
                    "The edge router is returning traffic to the restored region.",
                    &[EDGE, OUTAGE_GATEWAY],
                )],
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_has_five_unique_well_formed_scenarios() {
        let scenarios = all();
        assert_eq!(scenarios.len(), 5);
        let mut ids: Vec<&str> = scenarios.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 5);
        for scenario in &scenarios {
            assert_eq!(scenario.phases[0].at_ms, 0, "{} starts at 0", scenario.id);
            assert!(
                scenario.phases.windows(2).all(|w| w[0].at_ms < w[1].at_ms),
                "{} phases are ordered",
                scenario.id
            );
            let last = scenario.phases.last().expect("has phases");
            assert!(
                last.at_ms + last.ramp_ms <= scenario.duration_ms,
                "{} finishes its last ramp before it ends",
                scenario.id
            );
            assert!(
                last.effects.is_empty(),
                "{} ends with everything back to nominal",
                scenario.id
            );
        }
    }
}

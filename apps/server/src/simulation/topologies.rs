//! Bundled synthetic topologies.

use std::collections::BTreeMap;

use crate::domain::{
    DataSource, EdgeSpec, Environment, NodeSpec, Protocol, Region, RegionKind, Relationship,
    ServiceType, TopologySpec,
};

use super::rng::Rng;

pub const HELIOS_ID: &str = "helios-commerce";
pub const STRESS_ID: &str = "hyperscale-stress";

/// Seed of the bundled stress topology.
pub const STRESS_SEED: u64 = 0xAE615;

/// File name and contents of the default demo topology, authored in
/// `fixtures/topologies/`.
pub const HELIOS_FILE: (&str, &str) = (
    "helios-commerce.json",
    include_str!("../../../../fixtures/topologies/helios-commerce.json"),
);

pub fn helios() -> Result<TopologySpec, serde_json::Error> {
    serde_json::from_str(HELIOS_FILE.1)
}

const STRESS_REGIONS: [(&str, &str, &str); 6] = [
    ("us-east", "US East", "Virginia"),
    ("us-west", "US West", "Oregon"),
    ("eu-west", "EU West", "Dublin"),
    ("eu-central", "EU Central", "Frankfurt"),
    ("ap-southeast", "AP Southeast", "Singapore"),
    ("sa-east", "SA East", "São Paulo"),
];

const SERVICES: [(&str, &str, ServiceType, f64); 12] = [
    ("catalog", "Catalog", ServiceType::Microservice, 18.0),
    ("search", "Search", ServiceType::Container, 34.0),
    ("cart", "Cart", ServiceType::Microservice, 12.0),
    ("orders", "Orders", ServiceType::Microservice, 28.0),
    ("payments", "Payments", ServiceType::Microservice, 44.0),
    (
        "customers",
        "Customer Profiles",
        ServiceType::Microservice,
        16.0,
    ),
    ("inventory", "Inventory", ServiceType::Container, 14.0),
    ("pricing", "Pricing", ServiceType::Serverless, 11.0),
    ("shipping", "Shipping", ServiceType::Container, 26.0),
    ("reviews", "Reviews", ServiceType::Microservice, 15.0),
    ("recs", "Recommendations", ServiceType::Serverless, 38.0),
    ("media", "Media Renderer", ServiceType::Container, 31.0),
];

const STORES: [(&str, &str, f64); 5] = [
    ("orders-db", "Orders DB", 5.0),
    ("ledger-db", "Finance Ledger", 7.0),
    ("catalog-db", "Catalog DB", 4.0),
    ("customer-db", "Customer DB", 5.0),
    ("sessions", "Session Cache", 1.0),
];

const QUEUES: [(&str, &str); 3] = [
    ("order-events", "Order Events"),
    ("billing-events", "Billing Events"),
    ("notify-queue", "Notification Queue"),
];

const BUCKETS: [(&str, &str); 2] = [("assets", "Media Assets"), ("archive", "Audit Archive")];

struct Builder {
    nodes: Vec<NodeSpec>,
    edges: Vec<EdgeSpec>,
}

impl Builder {
    #[allow(clippy::too_many_arguments)]
    fn node(
        &mut self,
        id: String,
        name: &str,
        service_type: ServiceType,
        region: &str,
        tier: u8,
        latency: f64,
        base_rps: Option<f64>,
    ) -> String {
        self.nodes.push(NodeSpec {
            id: id.clone(),
            name: name.to_string(),
            service_type,
            region: region.to_string(),
            tier,
            description: String::new(),
            environment: Environment::Demo,
            base_latency_ms: latency,
            capacity_rps: None,
            headroom: None,
            base_rps,
        });
        id
    }

    fn edge(&mut self, source: &str, target: &str, protocol: Protocol, rel: Relationship, w: f64) {
        self.edges.push(EdgeSpec {
            source: source.to_string(),
            target: target.to_string(),
            protocol,
            relationship: rel,
            weight: (w * 1000.0).round() / 1000.0,
            criticality: None,
            latency_ms: None,
        });
    }
}

/// A procedurally generated topology (≥150 nodes, ≥500 edges) used to
/// exercise layout, rendering and the engine at scale. Deterministic for a
/// given seed.
pub fn stress(seed: u64) -> TopologySpec {
    let mut rng = Rng::seeded(seed);
    let mut b = Builder {
        nodes: Vec::new(),
        edges: Vec::new(),
    };
    let mut regions = vec![Region {
        id: "global".into(),
        name: "Global Edge".into(),
        kind: RegionKind::Edge,
        location: "Anycast".into(),
    }];
    regions.extend(STRESS_REGIONS.iter().map(|(id, name, location)| Region {
        id: (*id).into(),
        name: (*name).into(),
        kind: RegionKind::Cloud,
        location: (*location).into(),
    }));

    let router = b.node(
        "edge-router".into(),
        "Global Edge Router",
        ServiceType::NetworkGateway,
        "global",
        1,
        4.0,
        None,
    );
    let monitor = b.node(
        "threat-monitor".into(),
        "Threat Detection",
        ServiceType::SecurityMonitor,
        "global",
        2,
        12.0,
        None,
    );
    let partner = b.node(
        "partner-api".into(),
        "Partner Integrations",
        ServiceType::ExternalClient,
        "global",
        0,
        0.0,
        Some(160.0),
    );
    let unknown = b.node(
        "unknown-sources".into(),
        "Unattributed Sources",
        ServiceType::ExternalClient,
        "global",
        0,
        0.0,
        Some(0.0),
    );
    b.edge(&partner, &router, Protocol::Https, Relationship::Route, 1.0);
    b.edge(&unknown, &router, Protocol::Https, Relationship::Route, 1.0);

    let mut demands = Vec::new();
    for (region, name, _) in STRESS_REGIONS {
        let demand = (320.0 + rng.next_f64() * 560.0).round();
        demands.push(demand);
        let client = b.node(
            format!("clients-{region}"),
            &format!("Clients · {name}"),
            ServiceType::ExternalClient,
            "global",
            0,
            0.0,
            Some(demand),
        );
        b.edge(&client, &router, Protocol::Https, Relationship::Route, 1.0);
    }
    let total_demand: f64 = demands.iter().sum();

    let mut roles = BTreeMap::new();
    let mut primary_stores: Vec<String> = Vec::new();
    for (r, (region, _, _)) in STRESS_REGIONS.iter().enumerate() {
        let id = |slug: &str| format!("{region}-{slug}");
        let gateway = b.node(
            id("gateway"),
            "API Gateway",
            ServiceType::ApiGateway,
            region,
            2,
            6.0,
            None,
        );
        let auth = b.node(
            id("auth"),
            "Identity Service",
            ServiceType::AuthService,
            region,
            3,
            14.0,
            None,
        );
        let cedar = b.node(
            id("cedar"),
            "Cedar Authorizer",
            ServiceType::CedarAuthorizer,
            region,
            3,
            3.0,
            None,
        );
        b.edge(
            &router,
            &gateway,
            Protocol::Https,
            Relationship::Route,
            demands[r] / total_demand,
        );
        b.edge(&gateway, &auth, Protocol::Grpc, Relationship::Auth, 0.4);
        b.edge(&gateway, &cedar, Protocol::Grpc, Relationship::Authz, 0.6);
        b.edge(
            &gateway,
            &monitor,
            Protocol::Otlp,
            Relationship::Telemetry,
            0.03,
        );
        b.edge(
            &auth,
            &monitor,
            Protocol::Otlp,
            Relationship::Telemetry,
            0.05,
        );
        b.edge(
            &cedar,
            &monitor,
            Protocol::Otlp,
            Relationship::Telemetry,
            0.05,
        );

        let stores: Vec<String> = STORES
            .iter()
            .map(|(slug, name, latency)| {
                b.node(
                    id(slug),
                    name,
                    ServiceType::Database,
                    region,
                    6,
                    *latency,
                    None,
                )
            })
            .collect();
        let buckets: Vec<String> = BUCKETS
            .iter()
            .map(|(slug, name)| b.node(id(slug), name, ServiceType::Storage, region, 6, 26.0, None))
            .collect();
        let queues: Vec<String> = QUEUES
            .iter()
            .map(|(slug, name)| {
                b.node(
                    id(slug),
                    name,
                    ServiceType::MessageQueue,
                    region,
                    5,
                    2.0,
                    None,
                )
            })
            .collect();
        let workers: Vec<String> = QUEUES
            .iter()
            .map(|(slug, name)| {
                b.node(
                    id(&format!("{slug}-worker")),
                    &format!("{name} Worker"),
                    ServiceType::Container,
                    region,
                    5,
                    30.0,
                    None,
                )
            })
            .collect();
        let services: Vec<String> = SERVICES
            .iter()
            .map(|(slug, name, ty, latency)| b.node(id(slug), name, *ty, region, 4, *latency, None))
            .collect();

        b.edge(&auth, &stores[4], Protocol::Redis, Relationship::Data, 0.9);
        b.edge(&auth, &stores[3], Protocol::Sql, Relationship::Data, 0.25);
        b.edge(
            &cedar,
            &buckets[1],
            Protocol::S3,
            Relationship::Telemetry,
            0.5,
        );

        // Gateway fan-out follows a Zipf-like popularity curve.
        let popularity: Vec<f64> = (0..services.len())
            .map(|j| 1.0 / (1.0 + j as f64 * 0.35))
            .collect();
        let total_popularity: f64 = popularity.iter().sum();
        for (j, service) in services.iter().enumerate() {
            b.edge(
                &gateway,
                service,
                Protocol::Grpc,
                Relationship::Call,
                1.5 * popularity[j] / total_popularity,
            );
            // Every service talks to three stores and one bucket.
            for k in 0..3 {
                let store = &stores[(j + k) % stores.len()];
                let protocol = if store.ends_with("sessions") {
                    Protocol::Redis
                } else {
                    Protocol::Sql
                };
                b.edge(
                    service,
                    store,
                    protocol,
                    Relationship::Data,
                    0.35 + rng.next_f64() * 0.6,
                );
            }
            b.edge(
                service,
                &buckets[j % 2],
                Protocol::S3,
                Relationship::Data,
                0.1 + rng.next_f64() * 0.2,
            );
            // Calls only ever point at later services, which keeps the graph acyclic.
            if j + 1 < services.len() {
                let first = j + 1 + rng.below(services.len() - j - 1);
                b.edge(
                    service,
                    &services[first],
                    Protocol::Grpc,
                    Relationship::Call,
                    0.2 + rng.next_f64() * 0.4,
                );
                if j + 2 < services.len() && j % 3 != 2 {
                    let mut second = j + 1 + rng.below(services.len() - j - 1);
                    if second == first {
                        second = if first + 1 < services.len() {
                            first + 1
                        } else {
                            j + 1
                        };
                    }
                    if second != first {
                        b.edge(
                            service,
                            &services[second],
                            Protocol::Grpc,
                            Relationship::Call,
                            0.15 + rng.next_f64() * 0.3,
                        );
                    }
                }
            }
            if j % 2 == 1 {
                b.edge(
                    service,
                    &queues[(j / 2) % queues.len()],
                    Protocol::Amqp,
                    Relationship::Publish,
                    0.5 + rng.next_f64() * 0.5,
                );
            }
        }
        for (q, queue) in queues.iter().enumerate() {
            b.edge(
                queue,
                &workers[q],
                Protocol::Amqp,
                Relationship::Consume,
                1.0,
            );
            b.edge(
                &workers[q],
                &stores[q],
                Protocol::Sql,
                Relationship::Data,
                0.8,
            );
            b.edge(
                &workers[q],
                &stores[(q + 2) % stores.len()],
                Protocol::Sql,
                Relationship::Data,
                0.4,
            );
            b.edge(
                &workers[q],
                &buckets[q % 2],
                Protocol::S3,
                Relationship::Data,
                0.3,
            );
        }

        if r == 0 {
            primary_stores = stores.clone();
            roles.insert("primaryGateway".to_string(), gateway.clone());
            roles.insert("primaryAuth".to_string(), auth.clone());
            roles.insert("primaryAuthorizer".to_string(), cedar.clone());
            roles.insert("primaryDatabase".to_string(), stores[0].clone());
            roles.insert("protectedResource".to_string(), stores[1].clone());
            roles.insert("resource:Order".to_string(), services[3].clone());
            roles.insert("resource:Ledger".to_string(), stores[1].clone());
            roles.insert("resource:Customer".to_string(), services[5].clone());
            roles.insert("failoverRegion".to_string(), (*region).to_string());
        } else {
            // Replication from the primary region.
            b.edge(
                &primary_stores[0],
                &stores[0],
                Protocol::Tcp,
                Relationship::Replication,
                0.15,
            );
            b.edge(
                &primary_stores[2],
                &stores[2],
                Protocol::Tcp,
                Relationship::Replication,
                0.1,
            );
        }
        if r == 2 {
            roles.insert("outageRegion".to_string(), (*region).to_string());
        }
    }
    roles.insert("edgeRouter".to_string(), router);
    roles.insert("attackSource".to_string(), unknown);
    roles.insert("partnerClient".to_string(), partner);
    roles.insert("securityMonitor".to_string(), monitor);

    TopologySpec {
        id: STRESS_ID.into(),
        name: "Hyperscale Stress".into(),
        description: "Procedurally generated six-region platform used to exercise the renderer and engine at scale. Entirely synthetic.".into(),
        data_source: DataSource::Synthetic,
        regions,
        roles,
        nodes: b.nodes,
        edges: b.edges,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::simulation::model::SimTopology;

    #[test]
    fn helios_fixture_compiles_with_sane_utilisation() {
        let topo = SimTopology::compile(helios().expect("fixture parses")).expect("compiles");
        assert!(topo.node_count() >= 45);
        assert!(topo.edge_count() >= 70);
        for (i, node) in topo.spec.nodes.iter().enumerate() {
            if node.service_type.is_client() {
                continue;
            }
            let rho = topo.nominal_load[i] / topo.capacity[i];
            assert!(
                rho < 0.7,
                "{} runs at {:.0} % at nominal load",
                node.id,
                rho * 100.0
            );
        }
    }

    #[test]
    fn stress_topology_meets_the_scale_target_and_is_deterministic() {
        let a = stress(7);
        let b = stress(7);
        assert_eq!(a, b);
        assert!(a.nodes.len() >= 150, "{} nodes", a.nodes.len());
        assert!(a.edges.len() >= 500, "{} edges", a.edges.len());
        let topo = SimTopology::compile(a).expect("stress topology compiles");
        for role in [
            "edgeRouter",
            "attackSource",
            "partnerClient",
            "primaryGateway",
            "primaryAuth",
            "primaryAuthorizer",
            "primaryDatabase",
            "protectedResource",
            "securityMonitor",
        ] {
            assert!(topo.role_node(role).is_some(), "role {role}");
        }
        assert!(topo.role_region("outageRegion").is_some());
        assert!(topo.role_region("failoverRegion").is_some());
    }
}

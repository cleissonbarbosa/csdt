//! A cloud inventory: what a provider lists of an account, written to a file
//! by a script the operator runs, and read here as a topology.
#![allow(clippy::unwrap_used)]

mod common;

use common::TempDir;

use std::path::Path;
use std::sync::Arc;

use aegis_server::application::{Assets, Sources};
use aegis_server::domain::TopologySpec;
use aegis_server::simulation::Timeline;
use aegis_server::workspace::inventory::{self, survey, topology_from_inventory};
use aegis_server::workspace::{self, from_files, SourceFile};
use axum::http::StatusCode;
use serde_json::{json, Value};

const FILE: &str = "aws-shop.json";

/// A small shop as a collector would write it: a distribution in front of a
/// load balancer, two services, a store, a queue and what reads it, beside a
/// staging pair, a forgotten bucket and a monitor nothing calls.
fn shop() -> Value {
    json!({
        "kind": "aegis-cloud-inventory",
        "version": 1,
        "provider": "aws",
        "name": "shop-prod",
        "collectedAt": "2026-11-21T12:00:00Z",
        "resources": [
            { "id": "cdn", "name": "shop.example", "type": "network-gateway", "native": "AWS::CloudFront::Distribution", "region": "global", "public": true },
            { "id": "shop-alb", "name": "shop-alb", "type": "api-gateway", "native": "AWS::ElasticLoadBalancingV2::LoadBalancer", "region": "sa-east-1", "network": "vpc-shop", "public": true, "tags": { "env": "prod" } },
            { "id": "storefront", "name": "storefront", "type": "container", "native": "AWS::ECS::Service", "region": "sa-east-1", "network": "vpc-shop", "members": 4, "tags": { "env": "prod", "app": "shop" } },
            { "id": "checkout", "name": "checkout", "type": "container", "native": "AWS::ECS::Service", "region": "sa-east-1", "network": "vpc-shop", "members": 2, "tags": { "env": "prod", "app": "shop" } },
            { "id": "orders-db", "name": "orders-db", "type": "database", "native": "AWS::RDS::DBCluster", "region": "sa-east-1", "network": "vpc-shop", "tags": { "env": "prod" } },
            { "id": "order-events", "name": "order-events", "type": "message-queue", "native": "AWS::SQS::Queue", "region": "sa-east-1", "tags": { "env": "prod" } },
            { "id": "fulfil", "name": "fulfil", "type": "serverless", "native": "AWS::Lambda::Function", "region": "sa-east-1", "tags": { "env": "prod" } },
            { "id": "assets", "name": "shop-assets", "type": "storage", "native": "AWS::S3::Bucket", "region": "sa-east-1", "tags": { "env": "prod" } },
            { "id": "staging-api", "name": "staging-api", "type": "container", "native": "AWS::ECS::Service", "region": "sa-east-1", "network": "vpc-staging", "tags": { "env": "staging" } },
            { "id": "staging-db", "name": "staging-db", "type": "database", "native": "AWS::RDS::DBInstance", "region": "sa-east-1", "network": "vpc-staging", "tags": { "env": "staging" } },
            { "id": "old-reports", "name": "old-reports", "type": "storage", "native": "AWS::S3::Bucket", "region": "us-east-1" },
            { "id": "guardduty", "name": "GuardDuty", "type": "security-monitor", "native": "AWS::GuardDuty::Detector", "region": "sa-east-1" }
        ],
        "relations": [
            { "from": "cdn", "to": "shop-alb", "basis": "routing", "evidence": "origin shop-alb" },
            { "from": "cdn", "to": "assets", "basis": "routing", "evidence": "origin shop-assets" },
            { "from": "shop-alb", "to": "storefront", "basis": "routing", "evidence": "target group storefront" },
            { "from": "shop-alb", "to": "checkout", "basis": "routing", "evidence": "target group checkout" },
            { "from": "storefront", "to": "orders-db", "basis": "network", "evidence": "security group rule tcp/5432" },
            { "from": "checkout", "to": "orders-db", "basis": "network", "evidence": "security group rule tcp/5432" },
            { "from": "checkout", "to": "order-events", "basis": "declared", "evidence": "declared by the operator" },
            { "from": "order-events", "to": "fulfil", "basis": "event", "evidence": "event source mapping" },
            { "from": "fulfil", "to": "orders-db", "basis": "network", "evidence": "security group rule tcp/5432" },
            { "from": "staging-api", "to": "staging-db", "basis": "network", "evidence": "security group rule tcp/5432" }
        ],
        "notes": ["Lambda function URLs were not read."]
    })
}

fn with_selection(selection: Value) -> Value {
    let mut inventory = shop();
    inventory["selection"] = selection;
    inventory
}

fn read(inventory: &Value) -> Result<TopologySpec, String> {
    topology_from_inventory(FILE, &inventory.to_string())
}

fn ids(spec: &TopologySpec) -> Vec<&str> {
    spec.nodes.iter().map(|node| node.id.as_str()).collect()
}

/// Every connection as `a -> b (relationship)`, sorted.
fn edges(spec: &TopologySpec) -> Vec<String> {
    let mut edges: Vec<String> = spec
        .edges
        .iter()
        .map(|edge| {
            format!(
                "{} -> {} ({})",
                edge.source,
                edge.target,
                serde_json::to_value(edge.relationship)
                    .unwrap()
                    .as_str()
                    .unwrap()
            )
        })
        .collect();
    edges.sort();
    edges
}

fn weight(spec: &TopologySpec, source: &str, target: &str) -> f64 {
    spec.edges
        .iter()
        .find(|edge| edge.source == source && edge.target == target)
        .unwrap_or_else(|| panic!("no connection {source} -> {target}"))
        .weight
}

fn timeline(assets: &Assets, topology: &str) -> Timeline {
    let world = assets.world(topology).expect("topology exists");
    Timeline::new(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(&assets.decisions),
        11,
    )
}

#[test]
fn a_cloud_inventory_is_read_as_a_topology_the_engine_can_run() {
    let dir = TempDir::new();
    dir.write_json(&format!("topologies/{FILE}"), &shop());
    let sources = workspace::load(dir.path())
        .expect("workspace loads")
        .sources;
    let spec = sources
        .topologies
        .iter()
        .find(|topology| topology.id == "shop-prod")
        .expect("the inventory's name is the platform's");
    assert_eq!(spec.name, "shop-prod");

    // Its resources, each the kind the file gives it, and two stand-ins for
    // whoever is outside: the file lists neither.
    assert_eq!(spec.nodes.len(), 14, "twelve resources and two stand-ins");
    let node = |id: &str| {
        spec.nodes
            .iter()
            .find(|node| node.id == id)
            .unwrap_or_else(|| panic!("no node {id}"))
    };
    let kind = |id: &str| serde_json::to_value(node(id).service_type).unwrap();
    assert_eq!(kind("clients"), "external-client");
    assert_eq!(kind("unknown-sources"), "external-client");
    assert_eq!(kind("cdn"), "network-gateway");
    assert_eq!(kind("shop-alb"), "api-gateway");
    assert_eq!(kind("fulfil"), "serverless");
    assert_eq!(kind("guardduty"), "security-monitor");
    // Demand at rest comes from the one stand-in; the other is idle until a
    // scenario sends something through it.
    assert_eq!(node("clients").base_rps, Some(100.0));
    assert_eq!(node("unknown-sources").base_rps, Some(0.0));
    // A node says what the provider calls it and how many it stands for.
    assert!(
        node("storefront").description.contains("AWS::ECS::Service")
            && node("storefront").description.contains('4'),
        "{}",
        node("storefront").description
    );

    // Each connection is one the file states, as what it states.
    assert_eq!(
        edges(spec),
        [
            "cdn -> assets (route)",
            "cdn -> shop-alb (route)",
            "checkout -> order-events (publish)",
            "checkout -> orders-db (data)",
            // The balancer is public too, but it is behind the distribution:
            // clients enter where nothing else routes to.
            "clients -> cdn (route)",
            "fulfil -> orders-db (data)",
            "order-events -> fulfil (consume)",
            "shop-alb -> checkout (route)",
            "shop-alb -> storefront (route)",
            "staging-api -> staging-db (data)",
            "storefront -> orders-db (data)",
            "unknown-sources -> cdn (route)",
        ]
    );
    // What a router sends on is split evenly: the file states no shares.
    assert_eq!(weight(spec, "shop-alb", "storefront"), 0.5);
    assert_eq!(weight(spec, "cdn", "assets"), 0.5);
    assert_eq!(weight(spec, "clients", "cdn"), 1.0);
    assert_eq!(weight(spec, "checkout", "orders-db"), 1.0);

    // A tier is how far from the outside a resource is, by the longest way.
    let tier = |id: &str| node(id).tier;
    assert_eq!(
        (
            tier("clients"),
            tier("cdn"),
            tier("shop-alb"),
            tier("checkout"),
            tier("order-events"),
            tier("fulfil"),
            tier("orders-db")
        ),
        (0, 1, 2, 3, 4, 5, 6)
    );

    // Where each stands: the provider's regions, and its edge for what is in none.
    let regions: Vec<(&str, Value)> = spec
        .regions
        .iter()
        .map(|region| {
            (
                region.id.as_str(),
                serde_json::to_value(region.kind).unwrap(),
            )
        })
        .collect();
    assert_eq!(
        regions,
        [
            ("global", json!("edge")),
            ("sa-east-1", json!("cloud")),
            ("us-east-1", json!("cloud")),
        ]
    );
    assert_eq!(node("clients").region, "global");
    assert_eq!(node("cdn").region, "global");

    // It says of itself what was read and what was assumed, and is synthetic.
    assert_eq!(serde_json::to_value(spec.data_source).unwrap(), "synthetic");
    for said in [FILE, "not measurements", "permission", "12 of its 12"] {
        assert!(
            spec.description.contains(said),
            "{said}: {}",
            spec.description
        );
    }

    // The anchors the bundled scenarios look for, where the file has one.
    let role = |name: &str| spec.roles.get(name).map(String::as_str);
    assert_eq!(role("partnerClient"), Some("clients"));
    assert_eq!(role("attackSource"), Some("unknown-sources"));
    assert_eq!(role("edgeRouter"), Some("cdn"));
    assert_eq!(role("primaryGateway"), Some("shop-alb"));
    assert_eq!(role("primaryDatabase"), Some("orders-db"));
    assert_eq!(role("securityMonitor"), Some("guardduty"));
    assert_eq!(role("primaryAuthorizer"), None);

    // The engine takes it: it compiles, runs, and carries traffic to the store.
    let assets = Assets::build(sources).expect("the topology compiles");
    let mut timeline = timeline(&assets, "shop-prod");
    for _ in 0..50 {
        timeline.step();
    }
    let view = timeline.topology_view();
    let throughput = |id: &str| {
        view.nodes
            .iter()
            .find(|node| node.id == id)
            .unwrap()
            .metrics
            .throughput_rps
    };
    assert!(throughput("cdn") > 50.0, "{}", throughput("cdn"));
    assert!(
        throughput("orders-db") > 10.0,
        "{}",
        throughput("orders-db")
    );
    assert_eq!(throughput("staging-db"), 0.0, "nothing leads to staging");

    // A flood and a store going dark can be tried on it as it is; what asks
    // for something the account does not have says which.
    let scenario = |id: &str| {
        timeline
            .scenarios()
            .into_iter()
            .find(|scenario| scenario.id == id)
            .expect("bundled scenario")
    };
    assert!(
        scenario("ddos-surge").available,
        "{:?}",
        scenario("ddos-surge").unavailable_reason
    );
    assert!(
        scenario("cascading-failure").available,
        "{:?}",
        scenario("cascading-failure").unavailable_reason
    );
    assert!(!scenario("credential-stuffing").available);
    assert!(
        scenario("credential-stuffing")
            .unavailable_reason
            .as_deref()
            .is_some_and(|reason| reason.starts_with("topology does not define the `primaryAuth")),
        "{:?}",
        scenario("credential-stuffing").unavailable_reason
    );
}

#[test]
fn a_file_dropped_on_its_own_is_recognised_by_what_it_holds() {
    let files = vec![SourceFile {
        path: "whatever-the-name.json".to_string(),
        text: shop().to_string(),
    }];
    let sources = from_files(files, Sources::bundled().unwrap())
        .expect("recognised")
        .sources;
    assert_eq!(
        sources
            .topologies
            .iter()
            .map(|topology| topology.id.as_str())
            .collect::<Vec<_>>(),
        ["shop-prod"]
    );
    assert!(inventory::is_inventory(&shop().to_string()));
    // A topology is not one, nor is something that is no JSON at all.
    assert!(!inventory::is_inventory(r#"{"nodes": [], "edges": []}"#));
    assert!(!inventory::is_inventory("services:\n  web: {}\n"));
}

#[test]
fn the_same_file_always_gives_the_same_topology() {
    let first = read(&shop()).unwrap();
    let second = read(&shop()).unwrap();
    assert_eq!(
        serde_json::to_string(&first).unwrap(),
        serde_json::to_string(&second).unwrap()
    );
    // And the topology is a file like any other: written out and read back.
    let written = serde_json::to_string(&first).unwrap();
    let back: TopologySpec = serde_json::from_str(&written).unwrap();
    assert_eq!(first, back);
}

#[test]
fn a_selection_brings_part_of_an_inventory_and_says_what_it_left() {
    // By tag: what is marked as production, and nothing else.
    let prod = read(&with_selection(json!({
        "tags": [{ "key": "env", "values": ["prod"] }]
    })))
    .unwrap();
    assert_eq!(
        ids(&prod),
        [
            "clients",
            "unknown-sources",
            "shop-alb",
            "storefront",
            "checkout",
            "orders-db",
            "order-events",
            "fulfil",
            "assets"
        ]
    );
    // The distribution carries no tag and is left; the balancer is where
    // clients enter what remains.
    assert!(edges(&prod).contains(&"clients -> shop-alb (route)".to_string()));
    assert!(
        prod.description.contains("7 of its 12"),
        "{}",
        prod.description
    );

    // The same, with what leads to those resources and what they lead to.
    let along = read(&with_selection(json!({
        "tags": [{ "key": "app", "values": ["shop"] }],
        "alongPaths": true
    })))
    .unwrap();
    assert_eq!(
        ids(&along),
        [
            "clients",
            "unknown-sources",
            "cdn",
            "shop-alb",
            "storefront",
            "checkout",
            "orders-db",
            "order-events",
            "fulfil"
        ],
        "assets is on no path through the two services"
    );

    // By region, network, kind and name.
    let region = read(&with_selection(json!({ "regions": ["us-east-1"] }))).unwrap();
    assert_eq!(ids(&region), ["clients", "unknown-sources", "old-reports"]);
    let network = read(&with_selection(json!({ "networks": ["vpc-staging"] }))).unwrap();
    assert_eq!(
        ids(&network),
        ["clients", "unknown-sources", "staging-api", "staging-db"]
    );
    let unplaced = read(&with_selection(json!({
        "networks": [null],
        "regions": ["sa-east-1"]
    })))
    .unwrap();
    assert_eq!(
        ids(&unplaced),
        [
            "clients",
            "unknown-sources",
            "order-events",
            "fulfil",
            "assets",
            "guardduty"
        ]
    );
    let kinds = read(&with_selection(json!({ "kinds": ["database"] }))).unwrap();
    assert_eq!(
        ids(&kinds),
        ["clients", "unknown-sources", "orders-db", "staging-db"]
    );
    let named = read(&with_selection(json!({ "name": "STAGING" }))).unwrap();
    assert_eq!(
        ids(&named),
        ["clients", "unknown-sources", "staging-api", "staging-db"]
    );

    // A tag filter with no values asks only that the key be there.
    let tagged = read(&with_selection(json!({
        "tags": [{ "key": "app", "values": [] }]
    })))
    .unwrap();
    assert_eq!(
        ids(&tagged),
        ["clients", "unknown-sources", "storefront", "checkout"]
    );

    // Left out by hand, whatever else is asked.
    let without = read(&with_selection(json!({
        "exclude": ["staging-api", "staging-db", "old-reports"]
    })))
    .unwrap();
    assert!(!ids(&without).contains(&"staging-db"));
    assert_eq!(without.nodes.len(), 11);
}

#[test]
fn connections_are_drawn_from_what_the_selection_asks_for() {
    // Without the network rules, nothing says who reaches the store.
    let routed = read(&with_selection(json!({
        "bases": ["routing", "event", "declared"]
    })))
    .unwrap();
    assert!(!edges(&routed).iter().any(|edge| edge.contains("orders-db")));
    assert!(
        routed.description.contains("4 network rules"),
        "{}",
        routed.description
    );
    assert!(
        !routed.description.contains("permission"),
        "{}",
        routed.description
    );

    // What no connection touches can be left out. A monitor stays: it
    // watches, and nothing calls it.
    let connected = read(&with_selection(json!({ "connectedOnly": true }))).unwrap();
    assert!(!ids(&connected).contains(&"old-reports"));
    assert!(ids(&connected).contains(&"guardduty"));
    assert!(ids(&connected).contains(&"staging-db"));

    // One connection left out by hand.
    let cut = read(&with_selection(json!({
        "without": [{ "from": "cdn", "to": "assets" }]
    })))
    .unwrap();
    assert!(!edges(&cut).contains(&"cdn -> assets (route)".to_string()));
    assert_eq!(
        weight(&cut, "cdn", "shop-alb"),
        1.0,
        "the balancer is all the distribution routes to"
    );
}

#[test]
fn connections_that_would_run_in_a_circle_are_left_out_and_named() {
    let mut inventory = shop();
    // The store's group also admits the services' group back, and a rule
    // repeats what the balancer already routes.
    inventory["relations"].as_array_mut().unwrap().extend([
        json!({ "from": "orders-db", "to": "checkout", "basis": "network", "evidence": "security group rule tcp/8080" }),
        json!({ "from": "shop-alb", "to": "storefront", "basis": "network", "evidence": "security group rule tcp/8080" }),
    ]);
    let spec = read(&inventory).expect("still a topology");
    let drawn = edges(&spec);
    assert!(drawn.contains(&"checkout -> orders-db (data)".to_string()));
    assert!(!drawn.iter().any(|edge| edge.starts_with("orders-db -> ")));
    assert!(
        spec.description.contains("orders-db to checkout"),
        "{}",
        spec.description
    );
    // Two statements of one connection are one connection, read as the
    // stronger says: routing, not a permission.
    assert_eq!(
        drawn
            .iter()
            .filter(|edge| edge.starts_with("shop-alb -> storefront"))
            .collect::<Vec<_>>(),
        ["shop-alb -> storefront (route)"]
    );
    // The survey names it too, for whoever would rather choose.
    let surveyed = serde_json::to_value(survey(FILE, &inventory.to_string()).unwrap()).unwrap();
    assert_eq!(
        surveyed["leftOut"]["circular"],
        json!([{ "from": "orders-db", "to": "checkout" }])
    );
    // The engine takes what is left.
    let files = vec![SourceFile {
        path: FILE.to_string(),
        text: inventory.to_string(),
    }];
    let sources = from_files(files, Sources::bundled().unwrap())
        .expect("read")
        .sources;
    Assets::build(sources).expect("no circle is left");
}

#[test]
fn with_nothing_public_clients_enter_where_nothing_leads() {
    let mut inventory = shop();
    for resource in inventory["resources"].as_array_mut().unwrap() {
        resource.as_object_mut().unwrap().remove("public");
    }
    let spec = read(&inventory).unwrap();
    let entries: Vec<String> = edges(&spec)
        .into_iter()
        .filter(|edge| edge.starts_with("clients -> "))
        .collect();
    assert_eq!(
        entries,
        ["clients -> cdn (route)", "clients -> staging-api (route)"],
        "what leads somewhere and is led to by nothing"
    );
    assert_eq!(weight(&spec, "clients", "cdn"), 0.5);
    assert!(
        spec.description.contains("states none as public"),
        "{}",
        spec.description
    );
}

#[test]
fn an_inventory_that_cannot_be_a_topology_says_why() {
    let refused = |inventory: Value| {
        let dir = TempDir::new();
        dir.write_json(&format!("topologies/{FILE}"), &inventory);
        workspace::load(dir.path())
            .expect_err("refused")
            .to_string()
    };
    let change = |edit: &dyn Fn(&mut Value)| {
        let mut inventory = shop();
        edit(&mut inventory);
        inventory
    };

    let version = refused(change(&|inventory| inventory["version"] = json!(2)));
    assert!(
        version.contains(FILE) && version.contains("version 2"),
        "{version}"
    );
    let unknown = refused(change(&|inventory| {
        inventory["relations"][0]["to"] = json!("nowhere");
    }));
    assert!(unknown.contains("`nowhere`"), "{unknown}");
    let twice = refused(change(&|inventory| {
        inventory["resources"][1]["id"] = json!("cdn");
    }));
    assert!(
        twice.contains("two resources") && twice.contains("`cdn`"),
        "{twice}"
    );
    let itself = refused(change(&|inventory| {
        inventory["relations"][0]["to"] = json!("cdn");
    }));
    assert!(itself.contains("to itself"), "{itself}");
    let id = refused(change(&|inventory| {
        inventory["resources"][0]["id"] = json!("arn:aws:cloudfront::123456789012:distribution/E1");
    }));
    assert!(id.contains("letters, digits"), "{id}");
    let reserved = refused(change(&|inventory| {
        inventory["resources"][0]["id"] = json!("clients");
    }));
    assert!(reserved.contains("`clients`"), "{reserved}");
    let client = refused(change(&|inventory| {
        inventory["resources"][0]["type"] = json!("external-client");
    }));
    assert!(client.contains("external-client"), "{client}");
    let field = refused(change(&|inventory| {
        inventory["resources"][0]["arn"] = json!("x");
    }));
    assert!(field.contains("unknown field"), "{field}");

    // A selection that leaves nothing is no platform, and one that names
    // what the file does not have is a mistake, not an empty answer.
    let nothing = refused(with_selection(json!({ "regions": ["eu-west-1"] })));
    assert!(nothing.contains("leaves no resource"), "{nothing}");
    let stranger = refused(with_selection(json!({ "exclude": ["never-listed"] })));
    assert!(stranger.contains("`never-listed`"), "{stranger}");
}

#[test]
fn a_survey_says_what_the_file_holds_and_what_the_selection_brings() {
    let whole = survey(FILE, &shop().to_string()).expect("a survey");
    let whole = serde_json::to_value(whole).unwrap();
    assert_eq!(whole["path"], FILE);
    assert_eq!(whole["provider"], "aws");
    assert_eq!(whole["name"], "shop-prod");
    assert_eq!(whole["collectedAt"], "2026-11-21T12:00:00Z");
    assert_eq!(whole["resources"], 12);
    assert_eq!(whole["relations"], 10);
    assert_eq!(
        whole["notes"],
        json!(["Lambda function URLs were not read."])
    );
    // What there is to choose from, each with how many resources have it.
    assert_eq!(
        whole["regions"],
        json!([
            { "value": "sa-east-1", "count": 10 },
            { "value": "global", "count": 1 },
            { "value": "us-east-1", "count": 1 }
        ])
    );
    assert_eq!(
        whole["networks"],
        json!([
            { "value": null, "count": 6 },
            { "value": "vpc-shop", "count": 4 },
            { "value": "vpc-staging", "count": 2 }
        ])
    );
    assert_eq!(
        whole["kinds"][0],
        json!({ "value": "container", "count": 3 })
    );
    assert_eq!(
        whole["tags"],
        json!([
            { "key": "env", "count": 9, "values": [
                { "value": "prod", "count": 7 },
                { "value": "staging", "count": 2 }
            ] },
            { "key": "app", "count": 2, "values": [{ "value": "shop", "count": 2 }] }
        ])
    );
    assert_eq!(
        whole["bases"],
        json!([
            { "value": "routing", "count": 4 },
            { "value": "event", "count": 1 },
            { "value": "declared", "count": 1 },
            { "value": "network", "count": 4 }
        ])
    );
    // With no selection everything is brought.
    assert_eq!(
        whole["kept"],
        json!({ "resources": 12, "relations": 10, "entries": 1 })
    );
    assert_eq!(
        whole["leftOut"],
        json!({ "unselected": 0, "excluded": 0, "unconnected": 0, "circular": [] })
    );
    assert_eq!(whole["problem"], Value::Null);
    assert_eq!(whole["listed"].as_array().unwrap().len(), 12);
    assert_eq!(
        whole["listed"][0],
        json!({ "id": "cdn", "name": "shop.example", "type": "network-gateway", "region": "global", "kept": true })
    );

    // With one, what it brings and what it leaves, by why.
    let narrowed = survey(
        FILE,
        &with_selection(json!({
            "tags": [{ "key": "env", "values": ["prod"] }],
            "bases": ["routing", "event"],
            "connectedOnly": true,
            "exclude": ["fulfil"]
        }))
        .to_string(),
    )
    .unwrap();
    let narrowed = serde_json::to_value(narrowed).unwrap();
    // The balancer and its two services, and nothing else: the queue's only
    // connection went with the function left out by hand.
    assert_eq!(
        narrowed["kept"],
        json!({ "resources": 3, "relations": 2, "entries": 1 })
    );
    assert_eq!(
        narrowed["leftOut"],
        json!({ "unselected": 5, "excluded": 1, "unconnected": 3, "circular": [] })
    );
    assert_eq!(narrowed["selection"]["connectedOnly"], true);
    // What was left out by hand is still listed, to be brought back.
    let listed: Vec<(&str, bool)> = narrowed["listed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            (
                item["id"].as_str().unwrap(),
                item["kept"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        listed,
        [
            ("shop-alb", true),
            ("storefront", true),
            ("checkout", true),
            ("fulfil", false)
        ]
    );
    // The facets are of the file, whatever is selected.
    assert_eq!(narrowed["resources"], 12);

    // A selection that is no platform is still surveyed, and says so.
    let empty = survey(
        FILE,
        &with_selection(json!({ "regions": ["eu-west-1"] })).to_string(),
    )
    .unwrap();
    let empty = serde_json::to_value(empty).unwrap();
    assert_eq!(empty["kept"]["resources"], 0);
    assert!(
        empty["problem"]
            .as_str()
            .unwrap()
            .contains("leaves no resource"),
        "{}",
        empty["problem"]
    );
}

#[test]
fn an_inventory_is_bounded_like_every_file() {
    // More resources than a topology holds can be listed; bringing them all
    // is refused with what to do about it.
    let mut inventory = shop();
    let many: Vec<Value> = (0..2_100)
        .map(|i| {
            json!({ "id": format!("fn-{i}"), "name": format!("fn-{i}"), "type": "serverless", "native": "AWS::Lambda::Function", "region": "sa-east-1" })
        })
        .collect();
    inventory["resources"].as_array_mut().unwrap().extend(many);
    let error = read(&inventory).expect_err("too many");
    assert!(
        error.contains("2112") && error.contains("Narrow the selection"),
        "{error}"
    );
    inventory["selection"] = json!({ "connectedOnly": true });
    assert!(read(&inventory).is_ok(), "narrowed, it is a platform");

    // A file that lists more than is read at all says so.
    let mut huge = shop();
    let more: Vec<Value> = (0..inventory::MAX_RESOURCES)
        .map(|i| {
            json!({ "id": format!("b-{i}"), "name": "b", "type": "storage", "native": "AWS::S3::Bucket", "region": "sa-east-1" })
        })
        .collect();
    huge["resources"].as_array_mut().unwrap().extend(more);
    let error = read(&huge).expect_err("past the bound");
    assert!(error.contains("at most"), "{error}");
}

// ---------------------------------------------------------------------------
// What the collectors write
// ---------------------------------------------------------------------------

/// `examples/cloud-inventory` is laid out as a workspace. Each file in it is
/// what a collector in `scripts/` writes from the answers its own tests
/// hold, so this is the collectors and the reader held to each other.
#[test]
fn the_example_inventories_are_platforms_the_engine_runs() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/cloud-inventory");
    let sources = workspace::load(&dir).expect("the example loads").sources;
    let files = std::fs::read_dir(dir.join("topologies")).unwrap().count();
    assert_eq!(sources.topologies.len(), files, "every file is a platform");
    let assets = Assets::build(sources.clone()).expect("each compiles");

    for spec in &sources.topologies {
        let said = &spec.description;
        assert!(said.contains("not measurements"), "{}: {said}", spec.id);
        assert_eq!(serde_json::to_value(spec.data_source).unwrap(), "synthetic");
        // Clients have somewhere to enter, and what they send arrives.
        let entered: Vec<&str> = spec
            .edges
            .iter()
            .filter(|edge| edge.source == "clients")
            .map(|edge| edge.target.as_str())
            .collect();
        assert!(!entered.is_empty(), "{} has no entry", spec.id);
        let mut timeline = timeline(&assets, &spec.id);
        for _ in 0..50 {
            timeline.step();
        }
        let view = timeline.topology_view();
        let carried: f64 = view
            .nodes
            .iter()
            .filter(|node| entered.contains(&node.id.as_str()))
            .map(|node| node.metrics.throughput_rps)
            .sum();
        assert!(carried > 90.0, "{}: {carried}", spec.id);
        // Nothing of the file but the platform is in it.
        let written = serde_json::to_string(spec).unwrap();
        for absent in ["\"tags\"", "arn:", "ocid1.", "projects/"] {
            assert!(!written.contains(absent), "{}: {absent}", spec.id);
        }
    }

    // The AWS one, as an account would have it: a distribution, a balancer
    // and a detector are enough for a flood to be tried on it.
    let shop = sources
        .topologies
        .iter()
        .find(|spec| spec.id == "shop-prod")
        .expect("the AWS example");
    assert_eq!(
        shop.roles.get("edgeRouter").map(String::as_str),
        Some("shop.example")
    );
    assert_eq!(
        shop.roles.get("primaryGateway").map(String::as_str),
        Some("shop-alb")
    );
    assert_eq!(
        shop.roles.get("primaryAuth").map(String::as_str),
        Some("shoppers")
    );
    let timeline = timeline(&assets, "shop-prod");
    let flood = timeline
        .scenarios()
        .into_iter()
        .find(|scenario| scenario.id == "ddos-surge")
        .expect("bundled scenario");
    assert!(flood.available, "{:?}", flood.unavailable_reason);
}

// ---------------------------------------------------------------------------
// Through the server
// ---------------------------------------------------------------------------

fn body(files: &[(&str, String)]) -> Value {
    json!({
        "files": files
            .iter()
            .map(|(path, text)| json!({ "path": path, "text": text }))
            .collect::<Vec<_>>()
    })
}

const CHECK: &str = "/api/v1/demo/workspace/check";

#[tokio::test]
async fn a_check_surveys_the_inventories_among_the_files_and_applies_nothing() {
    let state = common::state();
    let check = common::post(&state, CHECK, body(&[(FILE, shop().to_string())])).await;
    assert_eq!(check.status, StatusCode::OK);
    assert_eq!(check.body["valid"], true);
    assert_eq!(check.body["workspace"]["defaultTopologyId"], "shop-prod");
    assert_eq!(check.body["workspace"]["topologies"][0]["nodeCount"], 14);
    let surveys = check.body["inventories"].as_array().expect("surveyed");
    assert_eq!(surveys.len(), 1);
    assert_eq!(surveys[0]["path"], FILE);
    assert_eq!(surveys[0]["kept"]["resources"], 12);
    assert_eq!(state.service.topology_id(), "helios-commerce");

    // A selection that is no platform is an answer, and what there is to
    // choose from comes with it: that is how it is put right.
    let nothing = with_selection(json!({ "regions": ["eu-west-1"] }));
    let check = common::post(&state, CHECK, body(&[(FILE, nothing.to_string())])).await;
    assert_eq!(check.status, StatusCode::OK);
    assert_eq!(check.body["valid"], false);
    assert_eq!(check.body["problem"]["path"], FILE);
    assert!(check.body["problem"]["message"]
        .as_str()
        .unwrap()
        .contains("leaves no resource"));
    assert_eq!(
        check.body["inventories"][0]["regions"][0]["value"],
        "sa-east-1"
    );
    assert!(check.body["inventories"][0]["problem"]
        .as_str()
        .unwrap()
        .contains("leaves no resource"));

    // In the folder of a workspace it is the same file, named by its place.
    let placed = "topologies/aws.json";
    let check = common::post(&state, CHECK, body(&[(placed, shop().to_string())])).await;
    assert_eq!(check.body["inventories"][0]["path"], placed);
    // Anywhere else it is not a topology, and is not surveyed as one.
    let misplaced = common::post(
        &state,
        CHECK,
        body(&[("scenarios/aws.json", shop().to_string())]),
    )
    .await;
    assert_eq!(misplaced.body["valid"], false);
    assert!(misplaced.body.get("inventories").is_none());

    // Files with no inventory among them are answered as they always were.
    let plain = common::post(
        &state,
        CHECK,
        body(&[("workspace.json", json!({ "formatVersion": 1 }).to_string())]),
    )
    .await;
    assert_eq!(plain.body["valid"], true);
    assert!(plain.body.get("inventories").is_none());

    // A file that cannot be read at all is the check's to report.
    let mut broken = shop();
    broken["version"] = json!(2);
    let check = common::post(&state, CHECK, body(&[(FILE, broken.to_string())])).await;
    assert_eq!(check.body["valid"], false);
    assert_eq!(check.body["problem"]["path"], FILE);
    assert!(check.body.get("inventories").is_none());
}

#[tokio::test]
async fn an_inventory_is_imported_as_a_topology_and_nothing_else_of_it_is_kept() {
    let state = common::state();
    let files = body(&[(FILE, shop().to_string())]);
    let imported = common::post(&state, "/api/v1/demo/workspace/import", files.clone()).await;
    assert_eq!(imported.status, StatusCode::OK, "{}", imported.body);
    assert_eq!(state.service.topology_id(), "shop-prod");
    let topology = common::get(&state, "/api/v1/topology").await.body;
    assert_eq!(topology["nodes"].as_array().unwrap().len(), 14);
    assert_eq!(topology["dataSource"], "synthetic");

    // What is in use, saved, is a topology file: the inventory's tags, its
    // networks and its selection are not in it.
    let saved = common::get(&state, "/api/v1/workspace/export").await.body;
    let kept: Vec<&Value> = saved["files"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|file| file["path"].as_str().unwrap().starts_with("topologies/"))
        .collect();
    assert_eq!(kept.len(), 1);
    let text = kept[0]["text"].as_str().unwrap();
    for absent in ["tags", "vpc-shop", "staging\"", "aegis-cloud-inventory"] {
        assert!(!text.contains(absent), "{absent} is in the saved topology");
    }
    let again: TopologySpec = serde_json::from_str(text).expect("a topology file");
    assert_eq!(again.id, "shop-prod");

    // Where importing is off, an inventory is refused like any file.
    let off = common::state_with(&[("AEGIS_IMPORT", "off")]);
    let refused = common::post(&off, CHECK, files).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
}

//! A Compose file read as a topology.
//!
//! `docker-compose.yml` says which services a platform has and which of them
//! need which: that is the shape of a topology, and it is taken from the
//! file as it stands. What a Compose file does not say is how much traffic
//! there is or how slow anything is, and a topology has to: every such
//! figure here is a default of this converter, named below, and none is a
//! measurement of anything. The result is a starting point to edit, and it
//! is `synthetic` like every topology a workspace holds.
//!
//! Nothing is fetched, pulled or run: the file is text, and so is the
//! topology that comes out of it.

use std::collections::{BTreeMap, BTreeSet};

use yaml_rust2::parser::{Event, EventReceiver, Parser};
use yaml_rust2::scanner::{Scanner, TokenType};
use yaml_rust2::{Yaml, YamlLoader};

use crate::domain::{
    DataSource, EdgeSpec, NodeSpec, Protocol, Region, RegionKind, Relationship, ServiceType,
    TopologySpec,
};

/// The requests a second the stand-in for whoever uses the platform sends.
/// A Compose file says nothing of traffic; this is the converter's own.
pub const DEFAULT_CLIENT_RPS: f64 = 100.0;
const CLIENT_ID: &str = "clients";
const REGION_ID: &str = "compose";
/// Most services read from one file: a model that large is not a Compose file.
const MAX_SERVICES: usize = 200;

/// Most values a file may come to once its aliases are written out.
const MAX_YAML_VALUES: u64 = 100_000;
/// Deepest one collection may stand inside others. A Compose file goes five
/// or six deep.
const MAX_YAML_DEPTH: usize = 64;

/// Refuses a file whose collections nest deeper than `MAX_YAML_DEPTH`.
///
/// The parser follows a collection into the one inside it by calling
/// itself, and bounds that for the bracketed style only: `- - - a` is three
/// deep in seven characters, and a file of nothing but those would run a
/// thread out of stack, which ends the process. The scanner under it does
/// not call itself, so the depth is counted from its tokens before the
/// parser is given the text.
fn nests_within_bound(text: &str) -> Result<(), String> {
    let mut depth = 0usize;
    for token in Scanner::new(text.chars()) {
        match token.1 {
            TokenType::BlockSequenceStart
            | TokenType::BlockMappingStart
            | TokenType::FlowSequenceStart
            | TokenType::FlowMappingStart => {
                depth += 1;
                if depth > MAX_YAML_DEPTH {
                    return Err(format!("nests its values more than {MAX_YAML_DEPTH} deep"));
                }
            }
            TokenType::BlockEnd | TokenType::FlowSequenceEnd | TokenType::FlowMappingEnd => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
    }
    Ok(())
}

/// Counts what a file of YAML comes to with every alias written out in
/// full, without writing any out. The loader copies what an alias refers
/// to, and an alias may refer to something made of aliases: a few lines can
/// ask for more memory than there is. Compose files do use aliases, for
/// what several services share, so they are not refused; what is refused is
/// a file that would grow past `MAX_YAML_VALUES`.
#[derive(Default)]
struct Expansion {
    /// Collections still open: the anchor each was given, and its values so far.
    open: Vec<(usize, u64)>,
    /// What each anchor stands for, in values.
    anchored: BTreeMap<usize, u64>,
    total: u64,
}

impl Expansion {
    fn add(&mut self, values: u64) {
        match self.open.last_mut() {
            Some((_, count)) => *count = count.saturating_add(values),
            None => self.total = self.total.saturating_add(values),
        }
    }
}

impl EventReceiver for Expansion {
    fn on_event(&mut self, event: Event) {
        match event {
            Event::Scalar(_, _, anchor, _) => {
                if anchor > 0 {
                    self.anchored.insert(anchor, 1);
                }
                self.add(1);
            }
            Event::SequenceStart(anchor, _) | Event::MappingStart(anchor, _) => {
                self.open.push((anchor, 1));
            }
            Event::SequenceEnd | Event::MappingEnd => {
                if let Some((anchor, values)) = self.open.pop() {
                    if anchor > 0 {
                        self.anchored.insert(anchor, values);
                    }
                    self.add(values);
                }
            }
            Event::Alias(anchor) => {
                let values = self.anchored.get(&anchor).copied().unwrap_or(1);
                self.add(values);
            }
            _ => {}
        }
    }
}

/// The first document of a file of YAML, once it is known neither to nest
/// past what the parser can follow nor to grow past what is read.
fn document(text: &str) -> Result<Yaml, String> {
    nests_within_bound(text)?;
    let mut expansion = Expansion::default();
    Parser::new_from_str(text)
        .load(&mut expansion, false)
        .map_err(|error| error.to_string())?;
    if expansion.total > MAX_YAML_VALUES {
        return Err(format!(
            "comes to more than {MAX_YAML_VALUES} values once its aliases are written out"
        ));
    }
    YamlLoader::load_from_str(text)
        .map_err(|error| error.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "is empty".to_string())
}

/// What a service is taken to be, from the name of its image. Anything not
/// recognised is what Compose says it is: a container.
const KINDS: &[(&[&str], ServiceType)] = &[
    (
        &["redis", "valkey", "memcached", "dragonfly"],
        ServiceType::Cache,
    ),
    (&["kafka", "redpanda", "pulsar"], ServiceType::EventStream),
    (&["haproxy"], ServiceType::LoadBalancer),
    (
        &[
            "postgres",
            "mysql",
            "mariadb",
            "mongo",
            "cassandra",
            "elasticsearch",
            "opensearch",
            "clickhouse",
            "cockroach",
            "influxdb",
            "timescale",
            "couchdb",
            "neo4j",
            "dynamodb",
            "etcd",
        ],
        ServiceType::Database,
    ),
    (
        &["rabbitmq", "nats", "activemq", "mosquitto"],
        ServiceType::MessageQueue,
    ),
    (&["minio", "seaweedfs", "ceph"], ServiceType::Storage),
    (
        &[
            "nginx", "traefik", "envoy", "caddy", "kong", "apisix", "httpd",
        ],
        ServiceType::ApiGateway,
    ),
    (
        &[
            "keycloak",
            "authelia",
            "dex",
            "hydra",
            "kratos",
            "zitadel",
            "authentik",
        ],
        ServiceType::AuthService,
    ),
    (&["cedar-agent", "cedar"], ServiceType::CedarAuthorizer),
    (
        &["falco", "wazuh", "suricata", "crowdsec", "zeek"],
        ServiceType::SecurityMonitor,
    ),
];

/// Milliseconds a service of each kind takes at rest: the converter's own.
pub(super) fn default_latency_ms(kind: ServiceType) -> f64 {
    match kind {
        ServiceType::ExternalClient => 0.0,
        ServiceType::ApiGateway | ServiceType::NetworkGateway => 4.0,
        ServiceType::MessageQueue => 2.0,
        ServiceType::Database => 5.0,
        ServiceType::CedarAuthorizer => 3.0,
        ServiceType::AuthService => 15.0,
        ServiceType::SecurityMonitor => 10.0,
        ServiceType::Storage => 25.0,
        ServiceType::Microservice | ServiceType::Container | ServiceType::Serverless => 20.0,
        ServiceType::VirtualMachine | ServiceType::KubernetesCluster => 20.0,
        ServiceType::LoadBalancer => 2.0,
        ServiceType::Cache => 1.0,
        ServiceType::EventStream => 3.0,
    }
}

/// The last component of an image reference, without registry, tag or digest.
fn image_name(image: &str) -> &str {
    let without_digest = image.split('@').next().unwrap_or(image);
    let last = without_digest.rsplit('/').next().unwrap_or(without_digest);
    last.split(':').next().unwrap_or(last)
}

fn kind_of(service: &str, image: Option<&str>) -> ServiceType {
    let names = [image.map(image_name), Some(service)];
    for name in names.into_iter().flatten() {
        let name = name.to_ascii_lowercase();
        for (known, kind) in KINDS {
            if known.iter().any(|word| name.contains(word)) {
                return *kind;
            }
        }
    }
    ServiceType::Container
}

/// How one service reaches another, by what the other is.
pub(super) fn link(target: ServiceType) -> (Protocol, Relationship) {
    match target {
        ServiceType::Database => (Protocol::Sql, Relationship::Data),
        ServiceType::Cache => (Protocol::Redis, Relationship::Data),
        ServiceType::LoadBalancer => (Protocol::Https, Relationship::Route),
        ServiceType::EventStream => (Protocol::Tcp, Relationship::Publish),
        ServiceType::Storage => (Protocol::S3, Relationship::Data),
        ServiceType::MessageQueue => (Protocol::Amqp, Relationship::Publish),
        ServiceType::AuthService => (Protocol::Https, Relationship::Auth),
        ServiceType::CedarAuthorizer => (Protocol::Https, Relationship::Authz),
        ServiceType::SecurityMonitor => (Protocol::Otlp, Relationship::Telemetry),
        _ => (Protocol::Https, Relationship::Call),
    }
}

/// An id a topology accepts, made of a service's name.
pub(super) fn id_of(name: &str) -> String {
    let id: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    if id.is_empty() {
        "service".to_string()
    } else {
        id
    }
}

/// A field of a service, where the service states it or where it takes it
/// from: Compose files share settings between services with a merge key
/// (`<<: *common`), which this parser leaves as it is written.
fn field<'a>(service: &'a Yaml, key: &str) -> &'a Yaml {
    let own = &service[key];
    if !own.is_badvalue() {
        return own;
    }
    match &service["<<"] {
        merged @ Yaml::Hash(_) => &merged[key],
        Yaml::Array(several) => several
            .iter()
            .map(|merged| &merged[key])
            .find(|value| !value.is_badvalue())
            .unwrap_or(own),
        _ => own,
    }
}

/// The services a service declares it needs: `depends_on` as a list or as a
/// mapping, and the older `links`, whose entries may carry an alias.
fn needs(service: &Yaml) -> Vec<String> {
    let mut found = Vec::new();
    match field(service, "depends_on") {
        Yaml::Array(items) => {
            found.extend(items.iter().filter_map(Yaml::as_str).map(str::to_string))
        }
        Yaml::Hash(map) => found.extend(map.keys().filter_map(Yaml::as_str).map(str::to_string)),
        _ => {}
    }
    if let Yaml::Array(items) = field(service, "links") {
        found.extend(
            items
                .iter()
                .filter_map(Yaml::as_str)
                .map(|entry| entry.split(':').next().unwrap_or(entry).to_string()),
        );
    }
    let mut seen = BTreeSet::new();
    found.retain(|name| seen.insert(name.clone()));
    found
}

fn publishes_a_port(service: &Yaml) -> bool {
    matches!(field(service, "ports"), Yaml::Array(ports) if !ports.is_empty())
}

/// Whether a file of YAML is a Compose file: it has services.
pub fn is_compose(text: &str) -> bool {
    document(text).is_ok_and(|document| matches!(document["services"], Yaml::Hash(_)))
}

/// Reads a Compose file as a topology. `file` is its name, for the id and
/// the name of the platform when the file gives none.
pub fn topology_from_compose(file: &str, text: &str) -> Result<TopologySpec, String> {
    let document = document(text)?;
    let Yaml::Hash(services) = &document["services"] else {
        return Err("has no `services`: it does not look like a Compose file".into());
    };
    if services.is_empty() {
        return Err("declares no service".into());
    }
    if services.len() > MAX_SERVICES {
        return Err(format!(
            "declares {} services; at most {MAX_SERVICES} are read",
            services.len()
        ));
    }

    // In the order the file lists them, which is the order they are drawn in.
    let mut names: Vec<&str> = Vec::with_capacity(services.len());
    let mut kinds: BTreeMap<&str, ServiceType> = BTreeMap::new();
    let mut ids: BTreeMap<&str, String> = BTreeMap::new();
    for (key, service) in services {
        let name = key.as_str().ok_or("has a service whose name is not text")?;
        let id = id_of(name);
        if id == CLIENT_ID || ids.values().any(|other| *other == id) {
            return Err(format!("has two services that would both be `{id}`"));
        }
        names.push(name);
        kinds.insert(name, kind_of(name, field(service, "image").as_str()));
        ids.insert(name, id);
    }

    // What needs what. A service that names one the file does not have is an
    // error of the file, and is said rather than passed over.
    let mut calls: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    for (key, service) in services {
        let name = key.as_str().unwrap_or_default();
        let needed = needs(service);
        for other in &needed {
            if !kinds.contains_key(other.as_str()) {
                return Err(format!(
                    "service `{name}` depends on `{other}`, which the file does not declare"
                ));
            }
            if other == name {
                return Err(format!("service `{name}` depends on itself"));
            }
        }
        calls.insert(name, needed);
    }

    // Who is reached from outside: whatever publishes a port, or, when
    // nothing does, whatever no other service depends on.
    let needed_by_someone: BTreeSet<&str> = calls
        .values()
        .flat_map(|needed| needed.iter().map(String::as_str))
        .collect();
    let mut entries: Vec<&str> = services
        .iter()
        .filter(|(_, service)| publishes_a_port(service))
        .filter_map(|(key, _)| key.as_str())
        .collect();
    if entries.is_empty() {
        entries = names
            .iter()
            .copied()
            .filter(|name| !needed_by_someone.contains(name))
            .collect();
    }
    if entries.is_empty() {
        return Err(
            "has no service to enter by: every service depends on another, in a circle".into(),
        );
    }

    // How far each service is from the outside: the longest chain of needs
    // that leads to it. A circle of needs has no such distance.
    let mut tier: BTreeMap<&str, u8> = BTreeMap::new();
    fn depth<'a>(
        name: &'a str,
        callers: &BTreeMap<&'a str, Vec<&'a str>>,
        entries: &[&'a str],
        tier: &mut BTreeMap<&'a str, u8>,
        walking: &mut Vec<&'a str>,
    ) -> Result<u8, String> {
        if let Some(known) = tier.get(name) {
            return Ok(*known);
        }
        if walking.contains(&name) {
            return Err(format!(
                "has services that depend on each other in a circle: {}",
                walking.join(" -> ")
            ));
        }
        walking.push(name);
        let mut deepest: u8 = if entries.contains(&name) { 1 } else { 0 };
        for caller in callers.get(name).map(Vec::as_slice).unwrap_or_default() {
            deepest =
                deepest.max(depth(caller, callers, entries, tier, walking)?.saturating_add(1));
        }
        walking.pop();
        // A service nothing leads to still stands somewhere: beside the entry.
        let placed = deepest.max(1);
        tier.insert(name, placed);
        Ok(placed)
    }
    let mut callers: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (name, needed) in &calls {
        for other in needed {
            if let Some((other, _)) = kinds.get_key_value(other.as_str()) {
                callers.entry(other).or_default().push(name);
            }
        }
    }
    for name in &names {
        depth(name, &callers, &entries, &mut tier, &mut Vec::new())?;
    }

    let stem = file
        .rsplit('/')
        .next()
        .unwrap_or(file)
        .trim_end_matches(".yaml")
        .trim_end_matches(".yml");
    let project = document["name"].as_str().unwrap_or(stem);
    let mut nodes = vec![NodeSpec {
        id: CLIENT_ID.to_string(),
        name: "Clients".to_string(),
        service_type: ServiceType::ExternalClient,
        region: REGION_ID.to_string(),
        tier: 0,
        description:
            "Whoever uses the platform. The file does not say who; this stands in for them."
                .to_string(),
        environment: Default::default(),
        base_latency_ms: 0.0,
        capacity_rps: None,
        headroom: None,
        base_rps: Some(DEFAULT_CLIENT_RPS),
        rate_limit_rps: None,
        suspicious_filter: None,
        autoscale: None,
    }];
    for name in &names {
        let kind = kinds[name];
        let image = services
            .iter()
            .find(|(key, _)| key.as_str() == Some(name))
            .and_then(|(_, service)| field(service, "image").as_str());
        nodes.push(NodeSpec {
            id: ids[name].clone(),
            name: (*name).to_string(),
            service_type: kind,
            region: REGION_ID.to_string(),
            tier: tier[name],
            description: image.map_or_else(
                || "Built from source, as the file says.".to_string(),
                |image| format!("Image {image}."),
            ),
            environment: Default::default(),
            base_latency_ms: default_latency_ms(kind),
            capacity_rps: None,
            headroom: None,
            base_rps: None,
            rate_limit_rps: None,
            suspicious_filter: None,
            autoscale: None,
        });
    }

    let mut edges = Vec::new();
    for entry in &entries {
        edges.push(EdgeSpec {
            source: CLIENT_ID.to_string(),
            target: ids[entry].clone(),
            protocol: Protocol::Https,
            relationship: Relationship::Route,
            weight: 1.0,
            criticality: None,
            latency_ms: None,
        });
    }
    for name in &names {
        for other in &calls[name] {
            let (protocol, relationship) = link(kinds[other.as_str()]);
            edges.push(EdgeSpec {
                source: ids[name].clone(),
                target: ids[other.as_str()].clone(),
                protocol,
                relationship,
                weight: 1.0,
                criticality: None,
                latency_ms: None,
            });
        }
    }

    // The anchors scenarios look for, where the file has something to be one.
    let first = |kind: ServiceType| {
        names
            .iter()
            .find(|name| kinds[*name] == kind)
            .map(|name| ids[name].clone())
    };
    let mut roles = BTreeMap::new();
    roles.insert("partnerClient".to_string(), CLIENT_ID.to_string());
    for (role, kind) in [
        ("primaryGateway", ServiceType::ApiGateway),
        ("primaryAuth", ServiceType::AuthService),
        ("primaryAuthorizer", ServiceType::CedarAuthorizer),
        ("primaryDatabase", ServiceType::Database),
        ("securityMonitor", ServiceType::SecurityMonitor),
    ] {
        if let Some(id) = first(kind) {
            roles.insert(role.to_string(), id);
        }
    }

    Ok(TopologySpec {
        id: id_of(project),
        name: project.to_string(),
        description: format!(
            "Read from {file}: its {} services and what each depends on, as the file declares them. \
             A Compose file says nothing of traffic or speed: the {DEFAULT_CLIENT_RPS:.0} requests a \
             second and every latency here are defaults of the converter, not measurements.",
            names.len()
        ),
        data_source: DataSource::Synthetic,
        regions: vec![Region {
            id: REGION_ID.to_string(),
            name: project.to_string(),
            kind: RegionKind::Cloud,
            location: "Compose project".to_string(),
        }],
        roles,
        nodes,
        edges,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_service_is_what_its_image_says_whatever_registry_or_tag_it_has() {
        assert_eq!(image_name("postgres:16"), "postgres");
        assert_eq!(
            image_name("ghcr.io/acme/orders-api:2.1@sha256:abc"),
            "orders-api"
        );
        assert_eq!(image_name("registry:5000/team/redis"), "redis");
        assert_eq!(kind_of("db", Some("postgres:16")), ServiceType::Database);
        assert_eq!(
            kind_of("broker", Some("docker.io/bitnami/kafka:3")),
            ServiceType::EventStream
        );
        assert_eq!(
            kind_of("broker", Some("rabbitmq:3-management")),
            ServiceType::MessageQueue
        );
        assert_eq!(kind_of("edge", Some("traefik:v3")), ServiceType::ApiGateway);
        assert_eq!(kind_of("lb", Some("haproxy:3")), ServiceType::LoadBalancer);
        assert_eq!(
            kind_of("sessions", Some("valkey/valkey:8")),
            ServiceType::Cache
        );
        // With no image to go by, the service's own name is.
        assert_eq!(kind_of("redis", None), ServiceType::Cache);
        // Anything else is what Compose runs: a container.
        assert_eq!(
            kind_of("web", Some("acme/storefront")),
            ServiceType::Container
        );
    }

    #[test]
    fn aliases_are_read_as_compose_files_use_them() {
        let text = "x-common: &common\n  restart: always\n  depends_on: [db]\nservices:\n  web:\n    <<: *common\n    image: nginx\n    ports: ['80']\n  db:\n    image: postgres\n";
        let topology = topology_from_compose("compose.yml", text).expect("reads");
        assert_eq!(topology.nodes.len(), 3);
        // What a service takes from a shared block is read as its own.
        assert!(topology
            .edges
            .iter()
            .any(|edge| edge.source == "web" && edge.target == "db"));
    }

    #[test]
    fn a_file_that_would_grow_without_bound_is_refused_before_it_is_loaded() {
        // Each line is ten of the line before: nine lines are a billion values.
        let mut text = String::from("a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n");
        for level in 1..9 {
            let previous = level - 1;
            let aliases = vec![format!("*a{previous}"); 10].join(", ");
            text.push_str(&format!("a{level}: &a{level} [{aliases}]\n"));
        }
        text.push_str("services:\n  web:\n    image: nginx\n");
        assert!(text.len() < 1_000);
        let error = topology_from_compose("bomb.yml", &text).expect_err("refused");
        assert!(
            error.contains("once its aliases are written out"),
            "{error}"
        );
        assert!(!is_compose(&text));
    }

    #[test]
    fn a_file_nested_past_what_the_parser_can_follow_is_refused_before_it_is_parsed() {
        // The parser calls itself once for each level. Run on a small stack,
        // so that a guard that let this through would be seen here and not
        // only in a file a hundred times the size.
        let worked = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                for text in [
                    format!("{}a\n", "- ".repeat(200_000)),
                    format!("{}a\n", "? ".repeat(200_000)),
                    "[".repeat(200_000),
                    "{a: ".repeat(200_000),
                ] {
                    assert!(topology_from_compose("deep.yml", &text).is_err());
                    assert!(!is_compose(&text));
                }
                let error =
                    topology_from_compose("deep.yml", &format!("{}a\n", "- ".repeat(200_000)))
                        .expect_err("refused");
                assert!(error.contains("deep"), "{error}");
            })
            .expect("a thread")
            .join();
        assert!(worked.is_ok(), "the file was followed to the bottom");

        // What a Compose file really is stays well inside the bound.
        let ordinary = "services:\n  web:\n    image: nginx\n    deploy:\n      resources:\n        limits:\n          cpus: '0.5'\n    depends_on:\n      db:\n        condition: service_healthy\n  db:\n    image: postgres\n";
        assert!(topology_from_compose("ok.yml", ordinary).is_ok());
    }

    #[test]
    fn an_id_is_made_of_a_name_a_topology_accepts() {
        assert_eq!(id_of("orders api"), "orders-api");
        assert_eq!(id_of("a/b:c"), "a-b-c");
        assert_eq!(id_of("svc_1.x-y"), "svc_1.x-y");
    }
}

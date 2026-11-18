//! A workspace directory: the operator's own topologies, scenarios,
//! recordings and Cedar policies, read at start-up.
#![allow(clippy::unwrap_used)]

mod common;

use common::TempDir;

use std::fs;
use std::path::Path;
use std::sync::Arc;

use aegis_server::application::{Assets, BootstrapError, Sources};
use aegis_server::config::Config;
use aegis_server::domain::{Decision, EventKind, Health, PlaybackStatus, RejectReason};
use aegis_server::simulation::{Command, Timeline};
use aegis_server::workspace::{self, WorkspaceError, MAX_FILE_BYTES};
use aegis_server::{build_state, StartupError};
use axum::http::StatusCode;
use serde_json::{json, Value};

fn build(dir: &TempDir) -> Result<Assets, BootstrapError> {
    Assets::build(
        workspace::load(dir.path())
            .expect("workspace loads")
            .sources,
    )
}

fn load_error(dir: &TempDir) -> WorkspaceError {
    workspace::load(dir.path()).expect_err("workspace is refused")
}

/// A four-service platform that declares no role at all.
fn shop() -> Value {
    json!({
        "id": "corner-shop",
        "name": "Corner Shop",
        "description": "A small platform written for this test.",
        "dataSource": "synthetic",
        "regions": [{ "id": "home", "name": "Home", "kind": "cloud", "location": "Basement" }],
        "nodes": [
            { "id": "shoppers", "name": "Shoppers", "type": "external-client", "region": "home", "tier": 0, "baseLatencyMs": 0, "baseRps": 120 },
            { "id": "front-door", "name": "Front door", "type": "api-gateway", "region": "home", "tier": 1, "baseLatencyMs": 4 },
            { "id": "till", "name": "Till", "type": "microservice", "region": "home", "tier": 2, "baseLatencyMs": 12 },
            { "id": "ledger", "name": "Ledger", "type": "database", "region": "home", "tier": 3, "baseLatencyMs": 5 }
        ],
        "edges": [
            { "source": "shoppers", "target": "front-door", "protocol": "https", "relationship": "route", "weight": 1.0 },
            { "source": "front-door", "target": "till", "protocol": "grpc", "relationship": "call", "weight": 1.0 },
            { "source": "till", "target": "ledger", "protocol": "sql", "relationship": "data", "weight": 1.0 }
        ]
    })
}

/// Takes the shop's ledger away, naming services by their id.
fn ledger_fire() -> Value {
    json!({
        "id": "ledger-fire",
        "name": "Ledger fire",
        "summary": "The ledger becomes unreachable and comes back.",
        "category": "resilience",
        "severity": "critical",
        "durationMs": 30_000,
        "rootCause": "node:ledger",
        "targets": ["node:ledger", "region:home"],
        "phases": [
            {
                "name": "Dark",
                "atMs": 0,
                "rampMs": 1_000,
                "status": "active",
                "effects": [{ "type": "down", "nodes": "node:ledger" }],
                "events": [{
                    "delayMs": 2_000,
                    "severity": "critical",
                    "kind": "alert",
                    "title": "Ledger unreachable",
                    "nodes": ["node:ledger"]
                }]
            },
            { "name": "Back", "atMs": 12_000, "rampMs": 2_000, "status": "recovering" }
        ]
    })
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

fn run_scenario(assets: &Assets, topology: &str, scenario: &str, ticks: u64) -> Timeline {
    let mut timeline = timeline(assets, topology);
    for _ in 0..10 {
        timeline.step();
    }
    timeline.issue(Command::StartScenario {
        scenario_id: scenario.to_string(),
    });
    for _ in 0..ticks {
        timeline.step();
    }
    timeline
}

// ---------------------------------------------------------------------------
// The bundled set is itself a workspace
// ---------------------------------------------------------------------------

#[test]
fn an_exported_workspace_is_the_bundled_set_bit_for_bit() {
    let dir = TempDir::new();
    let written = workspace::export(dir.path()).expect("exports");
    assert_eq!(written.len(), 13);
    assert!(written.iter().all(|path| path.is_file()));

    let loaded = workspace::load(dir.path()).expect("loads");
    assert_eq!(
        loaded.replaced,
        [
            "topologies",
            "scenarios",
            "recordings",
            "cedar/policies",
            "cedar/entities",
            "cedar/catalog"
        ]
    );
    assert!(loaded.ignored.is_empty());
    // Includes every float of the generated 178-service topology.
    assert_eq!(loaded.sources, Sources::bundled().unwrap());

    let from_files = Assets::build(loaded.sources).unwrap();
    let bundled = Assets::bundled().unwrap();
    assert_eq!(from_files.default_topology, bundled.default_topology);
    assert!(from_files.unavailable.is_empty());
    for (topology, world) in &bundled.worlds {
        assert_eq!(
            from_files.worlds[topology].scenarios, world.scenarios,
            "{topology}: scenarios resolve identically"
        );
        let a = run_scenario(&bundled, topology, "cascading-failure", 150);
        let b = run_scenario(&from_files, topology, "cascading-failure", 150);
        assert_eq!(
            a.state().digest(),
            b.state().digest(),
            "{topology}: same simulation"
        );
    }

    // Export never writes over anything.
    let again = workspace::export(dir.path()).expect_err("directory is not empty");
    assert!(again.message.contains("not empty"), "{again}");
}

#[test]
fn the_repository_fixtures_are_laid_out_as_a_workspace() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
    let loaded = workspace::load(&fixtures).expect("fixtures load");
    let bundled = Sources::bundled().unwrap();
    // The stress topology is generated, so only Helios is a file.
    assert_eq!(loaded.sources.topologies, bundled.topologies[..1]);
    assert_eq!(loaded.sources.scenarios, bundled.scenarios);
    assert_eq!(loaded.sources.recordings, bundled.recordings);
    assert_eq!(loaded.sources.policies, bundled.policies);
    assert_eq!(loaded.sources.catalog, bundled.catalog);
    assert!(
        loaded
            .ignored
            .iter()
            .any(|path| path.ends_with("integrations")),
        "what is not part of the layout is reported, not read"
    );
    Assets::build(loaded.sources).expect("builds");
}

#[test]
fn the_example_workspace_does_what_its_readme_says() {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/corner-shop");
    let loaded = workspace::load(&example).expect("example loads");
    assert_eq!(
        loaded.replaced,
        [
            "topologies",
            "scenarios",
            "recordings",
            "cedar/policies",
            "cedar/entities",
            "cedar/catalog",
            "cedar/schema"
        ]
    );
    let assets = Assets::build(loaded.sources).expect("example builds");
    assert_eq!(assets.unavailable, [], "both scenarios run on its topology");
    assert_eq!(assets.cedar.policies().len(), 3);
    assert!((assets.decisions.baseline_deny_fraction - 0.10).abs() < 1e-12);

    // Ledger fire: the database goes dark and comes back.
    let dark = run_scenario(&assets, "corner-shop", "ledger-fire", 70);
    let ledger = dark.topology().node("ledger").unwrap();
    assert_eq!(dark.state().health[ledger], Health::Down);
    let after = run_scenario(&assets, "corner-shop", "ledger-fire", 320);
    assert_eq!(after.state().health[ledger], Health::Healthy);

    // Receipt snooping: Cedar's own answer stops the flow at the authorizer.
    let snooping = run_scenario(&assets, "corner-shop", "receipt-snooping", 80);
    let snapshot = snooping.telemetry(PlaybackStatus::Playing, 1.0);
    let flow = |id: &str| {
        snapshot
            .flows
            .iter()
            .find(|flow| flow.id.ends_with(id))
            .unwrap_or_else(|| panic!("flow {id} is active"))
    };
    let own = flow("own-receipts");
    assert_eq!(
        own.blocked_at, None,
        "what Cedar permits reaches the ledger"
    );
    assert!(own.delivered_rps > 0.0);
    let other = flow("other-receipts");
    assert_eq!(other.blocked_at.as_deref(), Some("rulebook"));
    assert_eq!(other.blocked_reason, Some(RejectReason::PolicyDeny));
    assert!(other.delivered_rps < 1e-9);
    let denial = snooping
        .events()
        .find(|event| {
            event.kind == EventKind::AuthzDecision
                && event.details["requestId"] == "ana-reads-south"
        })
        .expect("the denial is on the timeline");
    assert_eq!(denial.details["decision"], "deny");
    assert_eq!(
        denial.details["determiningPolicies"],
        json!(["other-shops-are-closed-books"]),
        "attributed to the policy Cedar named"
    );

    // Later the badge is suspended and the same flow stops one step earlier.
    let suspended = run_scenario(&assets, "corner-shop", "receipt-snooping", 130);
    let snapshot = suspended.telemetry(PlaybackStatus::Playing, 1.0);
    let other = snapshot
        .flows
        .iter()
        .find(|flow| flow.id.ends_with("other-receipts"))
        .unwrap();
    assert_eq!(other.blocked_at.as_deref(), Some("badge-reader"));
    assert_eq!(other.blocked_reason, Some(RejectReason::SessionRevoked));

    // The recording replays both incidents.
    let world = &assets.worlds["corner-shop"];
    let mut replayed = Timeline::from_recording(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(&assets.decisions),
        &assets.recordings[0],
    );
    replayed.seek(replayed.head_tick());
    let incidents: Vec<&str> = replayed
        .incidents()
        .iter()
        .map(|incident| incident.scenario_id.as_str())
        .collect();
    assert_eq!(incidents, ["receipt-snooping", "ledger-fire"]);
}

#[test]
fn an_empty_workspace_changes_nothing() {
    let dir = TempDir::new();
    dir.write("README.md", "notes");
    let loaded = workspace::load(dir.path()).expect("loads");
    assert_eq!(loaded.sources, Sources::bundled().unwrap());
    assert!(loaded.replaced.is_empty());
    assert_eq!(loaded.ignored, [dir.path().join("README.md")]);
}

#[test]
fn workspace_versions_are_explicit_and_legacy_files_remain_valid() {
    let dir = TempDir::new();
    let legacy = workspace::load(dir.path()).expect("no manifest means version 1");
    dir.write_json("workspace.json", &json!({ "formatVersion": 1 }));
    let versioned = workspace::load(dir.path()).expect("version 1 loads");
    assert_eq!(versioned.sources, legacy.sources);
    assert!(versioned.ignored.is_empty());

    for version in [0, 2, 100] {
        dir.write_json("workspace.json", &json!({ "formatVersion": version }));
        let error = load_error(&dir);
        assert!(error.path.ends_with("workspace.json"));
        assert!(
            error.message.contains("unsupported formatVersion"),
            "{error}"
        );
    }
    for invalid in [
        json!({}),
        json!({ "formatVersion": "1" }),
        json!({ "formatVersion": 1, "typo": true }),
    ] {
        dir.write_json("workspace.json", &invalid);
        assert!(load_error(&dir).path.ends_with("workspace.json"));
    }
}

#[test]
fn published_workspace_schemas_match_the_file_types() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/v1");
    let generated = workspace::schemas::documents();
    let files: Vec<_> = fs::read_dir(&root).unwrap().collect();
    assert_eq!(
        files.len(),
        generated.len(),
        "every published schema is generated"
    );
    for (name, schema) in generated {
        let path = root.join(format!("{name}.schema.json"));
        let committed: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(schema).unwrap(),
            committed,
            "{} is stale: run pnpm workspace:schemas",
            path.display()
        );
    }
}

#[tokio::test]
async fn unavailable_scenarios_explain_their_resolution_failure_through_the_api() {
    let dir = TempDir::new();
    dir.write_json("topologies/shop.json", &shop());
    let state = build_state(config(dir.path())).expect("state builds");
    let scenarios = common::get(&state, "/api/v1/scenarios").await;
    let listed = scenarios.body["scenarios"].as_array().unwrap();
    let assets = state.service.assets();
    assert_eq!(listed.len(), assets.unavailable.len());
    for scenario in listed {
        assert_eq!(scenario["available"], false);
        let diagnosis = assets
            .unavailable
            .iter()
            .find(|entry| entry.scenario == scenario["id"].as_str().unwrap())
            .unwrap();
        assert_eq!(scenario["unavailableReason"], diagnosis.reason);
    }
}

// ---------------------------------------------------------------------------
// Bringing a platform
// ---------------------------------------------------------------------------

#[test]
fn a_scenario_written_for_one_topology_runs_on_it() {
    let dir = TempDir::new();
    dir.write_json("topologies/shop.json", &shop());
    dir.write_json("scenarios/ledger-fire.json", &ledger_fire());
    let assets = build(&dir).expect("builds");

    assert_eq!(assets.default_topology, "corner-shop");
    assert_eq!(
        assets.worlds.keys().collect::<Vec<_>>(),
        ["corner-shop"],
        "the directory replaces the bundled topologies"
    );
    assert!(
        assets.recordings.is_empty(),
        "bundled recordings of a topology that is gone are dropped"
    );
    assert!(assets.unavailable.is_empty());

    let healthy = timeline(&assets, "corner-shop");
    let ledger = healthy.topology().node("ledger").unwrap();
    let till = healthy.topology().node("till").unwrap();

    let burning = run_scenario(&assets, "corner-shop", "ledger-fire", 40);
    assert_eq!(burning.state().health[ledger], Health::Down);
    assert_ne!(
        burning.state().health[till],
        Health::Healthy,
        "the failure reaches the service that depends on the ledger"
    );
    let incident = &burning.incidents()[0];
    assert_eq!(incident.root_cause_node_id.as_deref(), Some("ledger"));
    assert!(burning
        .events()
        .any(|event| event.title == "Ledger unreachable" && event.node_ids == ["ledger"]));

    let after = run_scenario(&assets, "corner-shop", "ledger-fire", 400);
    assert_eq!(after.state().health[ledger], Health::Healthy);
    assert!(after.state().scenario.is_none(), "the scenario ended");
}

#[test]
fn a_bundled_scenario_says_why_it_cannot_run_on_a_topology() {
    let dir = TempDir::new();
    dir.write_json("topologies/shop.json", &shop());
    let assets = build(&dir).expect("builds");

    // The shop declares no roles, so none of the five bundled scenarios fit.
    assert_eq!(assets.unavailable.len(), 5);
    let outage = assets
        .unavailable
        .iter()
        .find(|entry| entry.scenario == "regional-outage")
        .unwrap();
    assert_eq!(outage.topology, "corner-shop");
    assert!(outage.reason.contains("edgeRouter"), "{}", outage.reason);
    assert!(assets.worlds["corner-shop"]
        .scenarios
        .iter()
        .all(|scenario| !scenario.info.available));

    // Declaring the roles one scenario needs makes that one available.
    let mut with_roles = shop();
    with_roles["roles"] = json!({ "primaryDatabase": "ledger", "securityMonitor": "till" });
    dir.write_json("topologies/shop.json", &with_roles);
    let assets = build(&dir).expect("builds");
    let unavailable: Vec<&str> = assets
        .unavailable
        .iter()
        .map(|entry| entry.scenario.as_str())
        .collect();
    assert_eq!(unavailable.len(), 4);
    assert!(!unavailable.contains(&"cascading-failure"));
}

#[test]
fn extreme_but_valid_effects_never_produce_a_figure_that_is_not_a_number() {
    let dir = TempDir::new();
    dir.write_json(
        "scenarios/everything-at-once.json",
        &json!({
            "id": "everything-at-once",
            "name": "Everything at once",
            "summary": "Every effect at the edge of its range.",
            "category": "resilience",
            "severity": "critical",
            "durationMs": 60_000,
            "flows": [{
                "id": "torrent",
                "label": "Torrent",
                "suspicious": true,
                "hops": [
                    { "from": "role:attackSource", "to": "role:edgeRouter" },
                    { "from": "role:edgeRouter", "to": "role:protectedResource", "via": "path" }
                ],
                "spill": true
            }],
            "phases": [{
                "name": "All of it",
                "atMs": 0,
                "rampMs": 0,
                "status": "active",
                "effects": [
                    { "type": "demand", "node": "role:partnerClient", "factor": 1000.0 },
                    { "type": "capacity", "nodes": "role:primaryGateway", "factor": 0.0 },
                    { "type": "capacity", "nodes": "region:failoverRegion", "factor": 1000.0 },
                    { "type": "latency", "nodes": "role:primaryDatabase", "factor": 1000.0 },
                    { "type": "latency", "nodes": "role:primaryAuth", "factor": 0.0 },
                    { "type": "errorInject", "nodes": "role:primaryAuthorizer", "rate": 1.0 },
                    { "type": "down", "nodes": "region:outageRegion" },
                    { "type": "edgeWeight", "edges": { "inboundSync": "role:primaryDatabase" }, "factor": 1000.0 },
                    { "type": "edgeLatency", "edges": { "between": { "from": "role:edgeRouter", "to": "role:primaryGateway" } }, "factor": 1000.0 },
                    { "type": "edgeError", "edges": { "inboundSync": "role:protectedResource" }, "rate": 1.0 },
                    { "type": "routeShift", "edge": { "from": "role:edgeRouter", "to": "gatewayOf:outageRegion" }, "onto": { "from": "role:edgeRouter", "to": "gatewayOf:failoverRegion" }, "fraction": 1.0 },
                    { "type": "flowRate", "flow": "torrent", "rate": { "rps": 1.0e9 } },
                    { "type": "flowReject", "flow": "torrent", "at": "role:edgeRouter", "fraction": 0.5, "reason": "waf" }
                ]
            }]
        }),
    );
    let assets = build(&dir).expect("builds");
    assert_eq!(assets.unavailable, [], "runs on both bundled topologies");

    for topology in assets.worlds.keys() {
        let mut timeline = timeline(&assets, topology);
        timeline.issue(Command::StartScenario {
            scenario_id: "everything-at-once".into(),
        });
        for tick in 0..120 {
            timeline.step();
            if tick % 20 != 0 {
                continue;
            }
            let snapshot = timeline.telemetry(PlaybackStatus::Playing, 1.0);
            // JSON has no way to write a NaN or an infinity: serde_json turns
            // them into null, so a null among the figures gives one away.
            for (name, figures) in [
                ("global", serde_json::to_value(snapshot.global).unwrap()),
                ("nodes", serde_json::to_value(&snapshot.nodes).unwrap()),
                ("edges", serde_json::to_value(&snapshot.edges).unwrap()),
                ("regions", serde_json::to_value(&snapshot.regions).unwrap()),
            ] {
                assert!(
                    !figures.to_string().contains("null"),
                    "{topology} tick {tick}: {name} holds a figure that is not a number"
                );
            }
        }
        assert!(
            timeline.state().global.error_rate > 0.5,
            "{topology}: the platform is visibly broken, not silently unaffected"
        );
    }
}

// ---------------------------------------------------------------------------
// Bringing policies
// ---------------------------------------------------------------------------

#[test]
fn replacing_only_the_policies_changes_what_cedar_decides() {
    let bundled = Assets::bundled().unwrap();
    let baseline = &bundled.decisions.scenario["alice-view-ledger"];
    assert_eq!(baseline.outcome.decision, Decision::Allow);

    // The bundled policies, minus the one that lets finance read the ledger.
    let mut policies = Sources::bundled().unwrap().policies;
    policies.retain(|policy| policy.id != "finance-view-ledger");
    let dir = TempDir::new();
    dir.write_json(
        "cedar/policies.json",
        &serde_json::to_value(&policies).unwrap(),
    );

    let loaded = workspace::load(dir.path()).unwrap();
    assert_eq!(loaded.replaced, ["cedar/policies"]);
    let assets = Assets::build(loaded.sources).unwrap();

    let changed = &assets.decisions.scenario["alice-view-ledger"];
    assert_eq!(changed.outcome.decision, Decision::Deny);
    assert!(
        changed.outcome.determining_policies.is_empty(),
        "default deny"
    );
    assert!(
        assets.decisions.baseline_deny_fraction > bundled.decisions.baseline_deny_fraction,
        "more of the simulated traffic is denied"
    );

    // And the simulation follows: the flow Cedar used to permit is now
    // stopped at the authorizer.
    let flow = |assets: &Assets| {
        assets.worlds["helios-commerce"]
            .scenarios
            .iter()
            .find(|scenario| scenario.info.id == "cedar-denial")
            .unwrap()
            .flows[0]
            .authz
            .clone()
            .unwrap()
    };
    assert!(!flow(&bundled).deny);
    assert!(flow(&assets).deny);
}

const SHOP_SCHEMA: &str = r#"
entity Clerk { shop: String };
entity Receipt { shop: String };
action read appliesTo { principal: [Clerk], resource: [Receipt], context: {} };
"#;

fn shop_cedar(dir: &TempDir, policies: &str) {
    dir.write("cedar/shop.cedar", policies);
    dir.write_json(
        "cedar/entities.json",
        &json!([
            { "uid": { "type": "Clerk", "id": "ana" }, "attrs": { "shop": "north" }, "parents": [] },
            { "uid": { "type": "Receipt", "id": "r1" }, "attrs": { "shop": "north" }, "parents": [] },
            { "uid": { "type": "Receipt", "id": "r2" }, "attrs": { "shop": "south" }, "parents": [] }
        ]),
    );
    dir.write_json(
        "cedar/catalog.json",
        &json!({
            "tenants": [{ "id": "north", "name": "North shop" }],
            "principals": [{ "uid": "Clerk::\"ana\"", "label": "Ana", "tenant": "north", "roles": [], "note": "Clerk" }],
            "actions": [{ "uid": "Action::\"read\"", "label": "Read receipt", "resourceType": "Receipt" }],
            "resources": [
                { "uid": "Receipt::\"r1\"", "label": "Receipt 1", "tenant": "north", "resourceType": "Receipt" },
                { "uid": "Receipt::\"r2\"", "label": "Receipt 2", "tenant": "south", "resourceType": "Receipt" }
            ],
            "contextKeys": [],
            "trafficMix": [
                { "id": "own", "weight": 3.0, "principal": "Clerk::\"ana\"", "action": "Action::\"read\"", "resource": "Receipt::\"r1\"" },
                { "id": "other", "weight": 1.0, "principal": "Clerk::\"ana\"", "action": "Action::\"read\"", "resource": "Receipt::\"r2\"" }
            ],
            "scenarioRequests": []
        }),
    );
}

const SHOP_POLICIES: &str = r#"
@id("same-shop")
@description("A clerk reads the receipts of their own shop.")
permit(principal, action == Action::"read", resource)
when { principal.shop == resource.shop };

forbid(principal, action, resource)
when { resource.shop == "closed" };
"#;

#[test]
fn policies_can_be_written_in_cedar_syntax() {
    let dir = TempDir::new();
    shop_cedar(&dir, SHOP_POLICIES);
    let loaded = workspace::load(dir.path()).unwrap();
    assert_eq!(
        loaded.replaced,
        ["cedar/policies", "cedar/entities", "cedar/catalog"]
    );
    let policies = &loaded.sources.policies;
    assert_eq!(policies.len(), 2);
    assert_eq!(policies[0].id, "same-shop", "the @id annotation is the id");
    assert_eq!(
        policies[0].description,
        "A clerk reads the receipts of their own shop."
    );
    assert!(policies[0]
        .content
        .contains("principal.shop == resource.shop"));
    assert_eq!(policies[1].id, "shop-2", "otherwise the file and position");

    let assets = Assets::build(loaded.sources).unwrap();
    let own = &assets.decisions.mix[0];
    assert_eq!(own.outcome.decision, Decision::Allow);
    assert_eq!(own.outcome.determining_policies, ["same-shop"]);
    assert_eq!(assets.decisions.mix[1].outcome.decision, Decision::Deny);
    assert!((assets.decisions.baseline_deny_fraction - 0.25).abs() < 1e-12);
    // The bundled scenarios that lean on the bundled catalogue say so.
    assert!(assets
        .unavailable
        .iter()
        .any(|entry| entry.scenario == "cedar-denial"
            && entry.reason.contains("authorization catalogue")));
}

#[test]
fn policy_files_are_refused_when_ambiguous_or_unsupported() {
    let both = TempDir::new();
    shop_cedar(&both, SHOP_POLICIES);
    both.write("cedar/policies.json", "[]");
    assert!(load_error(&both).message.contains("keep one form"));

    let template = TempDir::new();
    shop_cedar(
        &template,
        "permit(principal == ?principal, action, resource);",
    );
    let error = load_error(&template);
    assert!(error.path.ends_with("cedar/shop.cedar"), "{error}");
    assert!(error.message.contains("templates"), "{error}");

    let broken = TempDir::new();
    shop_cedar(&broken, "permit(principal, action, resource) when {");
    assert!(load_error(&broken).path.ends_with("cedar/shop.cedar"));

    let twice = TempDir::new();
    shop_cedar(
        &twice,
        "@id(\"a\") permit(principal, action, resource);\n@id(\"a\") forbid(principal, action, resource);",
    );
    let error = build(&twice).expect_err("duplicate id");
    assert!(
        error.to_string().contains("duplicate policy id `a`"),
        "{error}"
    );
}

#[test]
fn a_schema_makes_cedar_validate_the_policies_and_the_entities() {
    let valid = TempDir::new();
    shop_cedar(&valid, SHOP_POLICIES);
    valid.write("cedar/schema.cedarschema", SHOP_SCHEMA);
    let loaded = workspace::load(valid.path()).unwrap();
    assert!(loaded.replaced.contains(&"cedar/schema"));
    Assets::build(loaded.sources).expect("validates");

    // An attribute the schema does not declare.
    let typo = TempDir::new();
    shop_cedar(
        &typo,
        "@id(\"by-branch\") permit(principal, action == Action::\"read\", resource) when { principal.branch == resource.shop };",
    );
    typo.write("cedar/schema.cedarschema", SHOP_SCHEMA);
    let error = build(&typo).expect_err("does not validate").to_string();
    assert!(
        error.contains("do not validate against the schema"),
        "{error}"
    );
    assert!(
        error.contains("by-branch") && error.contains("branch"),
        "{error}"
    );

    // The same policy is accepted when no schema is supplied: Cedar would
    // only notice while evaluating.
    fs::remove_file(typo.path().join("cedar/schema.cedarschema")).unwrap();
    build(&typo).expect("builds without a schema");

    // An entity that does not fit the schema.
    let entity = TempDir::new();
    shop_cedar(&entity, SHOP_POLICIES);
    entity.write("cedar/schema.cedarschema", SHOP_SCHEMA);
    entity.write_json(
        "cedar/entities.json",
        &json!([{ "uid": { "type": "Clerk", "id": "ana" }, "attrs": { "shop": 7 }, "parents": [] }]),
    );
    let error = build(&entity).expect_err("entity is refused").to_string();
    assert!(error.contains("entity store is invalid"), "{error}");

    let schema = TempDir::new();
    shop_cedar(&schema, SHOP_POLICIES);
    schema.write("cedar/schema.cedarschema", "entity {");
    let error = build(&schema).expect_err("schema is refused").to_string();
    assert!(error.contains("schema does not parse"), "{error}");
}

// ---------------------------------------------------------------------------
// What is refused, and how it is reported
// ---------------------------------------------------------------------------

#[test]
fn a_mistake_in_a_file_is_reported_with_the_file() {
    let malformed = TempDir::new();
    let path = malformed.write("topologies/shop.json", "{ \"id\": \"shop\",\n  nodes: [] }");
    let error = load_error(&malformed);
    assert_eq!(error.path, path);
    assert!(error.message.contains("line 2"), "{error}");

    let mut typo = shop();
    typo["nodes"][1]["baseLatencyMS"] = 4.into();
    let unknown = TempDir::new();
    unknown.write_json("topologies/shop.json", &typo);
    let error = load_error(&unknown);
    assert!(error.message.contains("baseLatencyMS"), "{error}");

    let mut wild = ledger_fire();
    wild["phases"][0]["effects"] =
        json!([{ "type": "capacity", "nodes": "node:ledger", "factor": -3.0 }]);
    let scenario = TempDir::new();
    let path = scenario.write_json("scenarios/ledger-fire.json", &wild);
    let error = load_error(&scenario);
    assert_eq!(error.path, path);
    assert!(error.message.contains("phase `Dark`"), "{error}");

    let mut selector = ledger_fire();
    selector["rootCause"] = "ledger".into();
    let bad = TempDir::new();
    bad.write_json("scenarios/ledger-fire.json", &selector);
    assert!(load_error(&bad).message.contains("not a node selector"));

    let empty = TempDir::new();
    fs::create_dir_all(empty.path().join("topologies")).unwrap();
    assert!(load_error(&empty)
        .message
        .contains("holds no .json or Compose file"));

    let file = TempDir::new();
    file.write("scenarios", "not a directory");
    assert!(load_error(&file).message.contains("is not a directory"));

    let missing = workspace::load(Path::new("/nonexistent/aegis-workspace")).unwrap_err();
    assert!(missing.message.contains("does not exist"), "{missing}");
}

#[test]
fn a_file_larger_than_the_limit_is_not_read() {
    let dir = TempDir::new();
    let mut text = serde_json::to_string(&shop()).unwrap();
    text.push_str(&" ".repeat(MAX_FILE_BYTES as usize));
    dir.write("topologies/shop.json", &text);
    assert!(load_error(&dir).message.contains("larger than 4 MiB"));
}

#[test]
fn a_topology_must_be_a_synthetic_acyclic_graph_with_plain_ids() {
    let provenance = TempDir::new();
    let mut live = shop();
    live["dataSource"] = "live".into();
    provenance.write_json("topologies/shop.json", &live);
    let error = build(&provenance).expect_err("refused").to_string();
    assert!(
        error.contains("corner-shop") && error.contains("synthetic"),
        "{error}"
    );

    let cycle = TempDir::new();
    let mut looped = shop();
    looped["edges"].as_array_mut().unwrap().push(json!({
        "source": "ledger", "target": "till", "protocol": "grpc", "relationship": "call", "weight": 0.1
    }));
    cycle.write_json("topologies/shop.json", &looped);
    let error = build(&cycle).expect_err("refused").to_string();
    assert!(error.contains("dependency cycle"), "{error}");

    let ids = TempDir::new();
    let mut spaced = shop();
    spaced["nodes"][2]["id"] = "the till".into();
    ids.write_json("topologies/shop.json", &spaced);
    let error = build(&ids).expect_err("refused").to_string();
    assert!(error.contains("node id `the till`"), "{error}");

    let twice = TempDir::new();
    twice.write_json("topologies/a.json", &shop());
    twice.write_json("topologies/b.json", &shop());
    let error = build(&twice).expect_err("refused").to_string();
    assert!(error.contains("declared twice"), "{error}");
}

#[test]
fn a_recording_can_only_replay_what_the_workspace_has() {
    let recording = |topology: &str, command: Value| {
        json!({
            "id": "night-shift",
            "name": "Night shift",
            "description": "A recorded fire.",
            "topologyId": topology,
            "seed": 5,
            "durationMs": 60_000,
            "commands": [{ "atMs": 4_000, "command": command }]
        })
    };
    let start = |scenario: &str| json!({ "type": "startScenario", "scenarioId": scenario });
    let workspace_with = |recording: &Value| {
        let dir = TempDir::new();
        dir.write_json("topologies/shop.json", &shop());
        dir.write_json("scenarios/ledger-fire.json", &ledger_fire());
        dir.write_json("recordings/night-shift.json", recording);
        dir
    };

    let good = workspace_with(&recording("corner-shop", start("ledger-fire")));
    let assets = build(&good).expect("builds");
    assert_eq!(assets.recordings.len(), 1);
    let world = &assets.worlds["corner-shop"];
    let mut replayed = Timeline::from_recording(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(&assets.decisions),
        &assets.recordings[0],
    );
    assert!(
        replayed.incidents().is_empty(),
        "a recording opens at its start"
    );
    replayed.seek(100);
    assert_eq!(
        replayed.incidents().len(),
        1,
        "the recorded incident is there"
    );
    assert_eq!(replayed.incidents()[0].scenario_id, "ledger-fire");

    let elsewhere = workspace_with(&recording("helios-commerce", start("ledger-fire")));
    let error = build(&elsewhere).expect_err("refused").to_string();
    assert!(
        error.contains("unknown topology `helios-commerce`"),
        "{error}"
    );

    let unknown = workspace_with(&recording("corner-shop", start("ddos-surge")));
    let error = build(&unknown).expect_err("refused").to_string();
    assert!(error.contains("unknown scenario `ddos-surge`"), "{error}");

    // A file cannot put an event on the timeline by claiming an importer
    // did: no such command exists.
    let forged = workspace_with(&recording(
        "corner-shop",
        json!({ "type": "importEvents", "providerId": "nvd", "events": [] }),
    ));
    let error = load_error(&forged);
    assert!(error.path.ends_with("recordings/night-shift.json"));
    assert!(
        error.message.contains("unknown variant `importEvents`"),
        "{error}"
    );
}

// ---------------------------------------------------------------------------
// Through the server
// ---------------------------------------------------------------------------

fn config(dir: &Path) -> Config {
    let dir = dir.to_string_lossy().into_owned();
    Config::from_lookup(move |name| (name == "AEGIS_WORKSPACE").then(|| dir.clone()))
        .expect("valid configuration")
}

#[tokio::test]
async fn the_server_offers_what_the_workspace_holds() {
    let dir = TempDir::new();
    dir.write_json("topologies/shop.json", &shop());
    dir.write_json("scenarios/ledger-fire.json", &ledger_fire());
    shop_cedar(&dir, SHOP_POLICIES);
    let state = build_state(config(dir.path())).expect("state builds");

    let topologies = common::get(&state, "/api/v1/topologies").await;
    assert_eq!(topologies.body["topologies"][0]["id"], "corner-shop");
    assert_eq!(topologies.body["topologies"].as_array().unwrap().len(), 1);
    assert_eq!(topologies.body["topologies"][0]["dataSource"], "synthetic");

    let topology = common::get(&state, "/api/v1/topology").await;
    assert_eq!(topology.body["id"], "corner-shop");
    assert_eq!(topology.body["nodes"].as_array().unwrap().len(), 4);

    let scenarios = common::get(&state, "/api/v1/scenarios").await;
    assert_eq!(scenarios.body["scenarios"].as_array().unwrap().len(), 1);
    assert_eq!(scenarios.body["scenarios"][0]["id"], "ledger-fire");
    assert_eq!(scenarios.body["scenarios"][0]["available"], true);
    assert_eq!(
        scenarios.body["scenarios"][0]["targetNodeIds"],
        json!(["shoppers", "front-door", "till", "ledger"])
    );

    let recordings = common::get(&state, "/api/v1/recordings").await;
    assert_eq!(recordings.body, json!([]));

    let catalog = common::get(&state, "/api/v1/demo/authorization/catalog").await;
    assert_eq!(catalog.body["policies"][0]["id"], "same-shop");
    assert_eq!(catalog.body["principals"][0]["label"], "Ana");

    let started = common::post(
        &state,
        "/api/v1/demo/scenarios/start",
        json!({ "scenarioId": "ledger-fire" }),
    )
    .await;
    assert_eq!(started.status, StatusCode::OK);
    for _ in 0..40 {
        state.service.advance(std::time::Duration::from_millis(200));
    }
    let incidents = common::get(&state, "/api/v1/incidents").await;
    assert_eq!(incidents.body["incidents"][0]["scenarioId"], "ledger-fire");
    assert_eq!(incidents.body["incidents"][0]["rootCauseNodeId"], "ledger");

    let decision = common::post(
        &state,
        "/api/v1/demo/authorization/evaluate",
        json!({
            "principal": "Clerk::\"ana\"",
            "action": "Action::\"read\"",
            "resource": "Receipt::\"r2\""
        }),
    )
    .await;
    assert_eq!(decision.status, StatusCode::OK);
    assert_eq!(decision.body["decision"], "deny");
    assert_eq!(
        decision.body["path"],
        json!([]),
        "the shop names no gateway or authorizer, so no path is drawn"
    );
}

#[test]
fn an_invalid_workspace_stops_the_server_from_starting() {
    let dir = TempDir::new();
    dir.write("topologies/shop.json", "{");
    assert!(matches!(
        build_state(config(dir.path())),
        Err(StartupError::Workspace(_))
    ));

    let cycle = TempDir::new();
    let mut looped = shop();
    looped["edges"].as_array_mut().unwrap().push(json!({
        "source": "ledger", "target": "front-door", "protocol": "grpc", "relationship": "call", "weight": 0.1
    }));
    cycle.write_json("topologies/shop.json", &looped);
    assert!(matches!(
        build_state(config(cycle.path())),
        Err(StartupError::Bootstrap(BootstrapError::Topology { .. }))
    ));
}

const COMPOSE: &str = r#"
name: shop
services:
  proxy:
    image: nginx:1.27
    ports: ["8080:80"]
    depends_on: [web]
  web:
    build: ./web
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
      queue:
        condition: service_started
  worker:
    image: ghcr.io/acme/worker:2
    depends_on: [queue, db]
  db:
    image: postgres:16
  cache:
    image: redis:7-alpine
  queue:
    image: docker.io/library/rabbitmq:3-management
"#;

#[test]
fn a_compose_file_is_read_as_a_topology_the_engine_can_run() {
    let dir = TempDir::new();
    dir.write("topologies/docker-compose.yml", COMPOSE);
    let sources = workspace::load(dir.path())
        .expect("workspace loads")
        .sources;
    let spec = sources
        .topologies
        .iter()
        .find(|topology| topology.id == "shop")
        .expect("the project's name is the platform's");
    assert_eq!(spec.name, "shop");

    // Its services, each what its image says it is; anything else a container.
    let kind = |id: &str| {
        let node = spec
            .nodes
            .iter()
            .find(|node| node.id == id)
            .unwrap_or_else(|| panic!("no node {id}"));
        serde_json::to_value(node.service_type).unwrap()
    };
    assert_eq!(spec.nodes.len(), 7, "six services and who uses them");
    assert_eq!(kind("clients"), "external-client");
    assert_eq!(kind("proxy"), "api-gateway");
    assert_eq!(kind("web"), "container");
    assert_eq!(kind("worker"), "container");
    assert_eq!(kind("db"), "database");
    assert_eq!(kind("cache"), "database");
    assert_eq!(kind("queue"), "message-queue");

    // What depends on what, as the file declares it, and nothing more.
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
    assert_eq!(
        edges,
        [
            // Only the proxy publishes a port: it is the way in.
            "clients -> proxy (route)",
            "proxy -> web (call)",
            "web -> cache (data)",
            "web -> db (data)",
            "web -> queue (publish)",
            "worker -> db (data)",
            "worker -> queue (publish)",
        ]
    );
    let tier = |id: &str| spec.nodes.iter().find(|node| node.id == id).unwrap().tier;
    assert_eq!(
        (tier("clients"), tier("proxy"), tier("web"), tier("db")),
        (0, 1, 2, 3)
    );

    // It says of itself what was read and what was assumed, and is synthetic.
    assert_eq!(serde_json::to_value(spec.data_source).unwrap(), "synthetic");
    assert!(
        spec.description.contains("docker-compose.yml"),
        "{}",
        spec.description
    );
    assert!(
        spec.description.contains("not measurements"),
        "{}",
        spec.description
    );
    assert_eq!(
        spec.roles.get("primaryGateway").map(String::as_str),
        Some("proxy")
    );
    assert_eq!(
        spec.roles.get("primaryDatabase").map(String::as_str),
        Some("db")
    );

    // The engine takes it: it compiles, runs, and carries traffic to the store.
    let assets = Assets::build(sources).expect("the topology compiles");
    let mut timeline = timeline(&assets, "shop");
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
    assert!(throughput("proxy") > 50.0, "{}", throughput("proxy"));
    assert!(throughput("db") > 10.0, "{}", throughput("db"));
    // The bundled scenarios ask for anchors a Compose file may not have. One
    // that cannot run says which is missing; it is not made to run anyway.
    let cascade = timeline
        .scenarios()
        .into_iter()
        .find(|scenario| scenario.id == "cascading-failure")
        .expect("bundled scenario");
    assert!(!cascade.available);
    assert_eq!(
        cascade.unavailable_reason.as_deref(),
        Some("topology does not define the `securityMonitor` role")
    );
}

#[test]
fn a_compose_file_that_cannot_be_a_topology_says_why() {
    let refused = |text: &str| {
        let dir = TempDir::new();
        dir.write("topologies/compose.yaml", text);
        load_error(&dir).to_string()
    };
    let unknown = refused("services:\n  web:\n    image: app\n    depends_on: [db]\n");
    assert!(
        unknown.contains("compose.yaml") && unknown.contains("depends on `db`"),
        "{unknown}"
    );
    let circle = refused(
        "services:\n  a:\n    image: app\n    ports: ['80']\n    depends_on: [b]\n  b:\n    image: app\n    depends_on: [a]\n",
    );
    assert!(circle.contains("in a circle"), "{circle}");
    let none = refused("volumes:\n  data: {}\n");
    assert!(none.contains("no `services`"), "{none}");
    let empty = refused("services: {}\n");
    assert!(empty.contains("declares no service"), "{empty}");
}

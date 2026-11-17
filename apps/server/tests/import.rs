//! Importing a workspace while the server runs: files held in memory go
//! through the same parts and checks as a directory read at start-up.
#![allow(clippy::unwrap_used)]

mod common;

use std::fs;
use std::path::Path;

use aegis_server::api::{AppState, MAX_BODY_BYTES, MAX_IMPORT_BYTES};
use aegis_server::application::{Assets, Sources};
use aegis_server::domain::Decision;
use aegis_server::workspace::{
    self, bundle_of, from_files, Bundle, SourceFile, MAX_FILE_BYTES, MAX_IMPORT_FILES,
};
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use common::TempDir;
use serde_json::{json, Value};

fn example_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/corner-shop")
}

/// The files of a workspace directory, with paths relative to it.
fn files_in(root: &Path) -> Vec<SourceFile> {
    let mut files = Vec::new();
    let mut read = |dir: &Path, prefix: &str| {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        entries.sort();
        for path in entries.into_iter().filter(|path| path.is_file()) {
            let name = path.file_name().unwrap().to_str().unwrap();
            files.push(SourceFile {
                path: format!("{prefix}{name}"),
                text: fs::read_to_string(&path).unwrap(),
            });
        }
    };
    read(root, "");
    for part in ["topologies", "scenarios", "recordings", "cedar"] {
        if root.join(part).is_dir() {
            read(&root.join(part), &format!("{part}/"));
        }
    }
    files
}

fn file(path: &str, value: &Value) -> SourceFile {
    SourceFile {
        path: path.to_string(),
        text: serde_json::to_string_pretty(value).unwrap(),
    }
}

fn bundled() -> Sources {
    Sources::bundled().unwrap()
}

fn body(files: &[SourceFile]) -> Value {
    json!({ "files": files })
}

fn a_scenario(id: &str) -> Value {
    json!({
        "id": id,
        "name": id,
        "summary": "The gateway slows down.",
        "category": "resilience",
        "severity": "warning",
        "durationMs": 20_000,
        "phases": [{
            "name": "Slow",
            "atMs": 0,
            "rampMs": 1_000,
            "status": "active",
            "effects": [{ "type": "latency", "nodes": "role:primaryGateway", "factor": 4.0 }]
        }]
    })
}

// ---------------------------------------------------------------------------
// Files in memory
// ---------------------------------------------------------------------------

#[test]
fn files_in_memory_give_what_the_same_directory_gives() {
    let from_disk = workspace::load(&example_dir()).unwrap();
    let from_memory = from_files(files_in(&example_dir()), bundled()).unwrap();
    assert_eq!(from_memory.sources, from_disk.sources);
    assert_eq!(from_memory.replaced, from_disk.replaced);
    // The read-me is in neither.
    assert_eq!(from_memory.ignored, [Path::new("README.md")]);

    // A folder picked in a browser names its files from the folder down.
    let nested: Vec<SourceFile> = files_in(&example_dir())
        .into_iter()
        .map(|file| SourceFile {
            path: format!("my-platform/{}", file.path),
            text: file.text,
        })
        .collect();
    assert_eq!(
        from_files(nested, bundled()).unwrap().sources,
        from_disk.sources
    );
}

#[test]
fn a_file_on_its_own_is_recognised_by_what_it_holds() {
    let example = files_in(&example_dir());
    // Every file stripped of its directory, and given a name that says nothing.
    let loose: Vec<SourceFile> = example
        .iter()
        .filter(|file| file.path != "README.md")
        .enumerate()
        .map(|(i, file)| {
            let extension = file.path.rsplit_once('.').unwrap().1;
            SourceFile {
                // Keep the order the directory gives: files are listed by name.
                path: format!("{i:02}-dropped.{extension}"),
                text: file.text.clone(),
            }
        })
        .collect();
    let recognised = from_files(loose, bundled()).unwrap();
    let from_disk = workspace::load(&example_dir()).unwrap();
    assert_eq!(recognised.sources, from_disk.sources);
    assert_eq!(recognised.replaced, from_disk.replaced);
    assert!(recognised.ignored.is_empty());
}

#[test]
fn what_is_exported_reads_back_as_the_same_sources() {
    let example = workspace::load(&example_dir()).unwrap().sources;
    // Each laid over the other: an export holds every part, so nothing of
    // what lies underneath shows through...
    for (sources, underneath) in [(bundled(), example.clone()), (example, bundled())] {
        let bundle = bundle_of(&sources).unwrap();
        assert_eq!(bundle.format_version, workspace::FORMAT_VERSION);
        assert_eq!(bundle.files[0].path, "workspace.json");
        // ...except a Cedar schema, which is a file only when there is one:
        // its absence leaves the schema underneath in place, like any part.
        let mut expected = sources.clone();
        expected.schema = sources.schema.clone().or(underneath.schema.clone());

        let back = from_files(bundle.files.clone(), underneath.clone()).unwrap();
        assert_eq!(back.sources, expected, "file by file");

        // And as the one document the interface downloads.
        let document = SourceFile {
            path: "aegis-workspace.json".into(),
            text: serde_json::to_string(&bundle).unwrap(),
        };
        assert_eq!(
            from_files(vec![document], underneath).unwrap().sources,
            expected
        );
    }
}

#[test]
fn a_part_that_is_not_among_the_files_stays_as_it_was() {
    let base = workspace::load(&example_dir()).unwrap().sources;
    let mut policies = base.policies.clone();
    policies.pop();
    let only_policies = from_files(
        vec![file(
            "policies.json",
            &serde_json::to_value(&policies).unwrap(),
        )],
        base.clone(),
    )
    .unwrap();
    assert_eq!(only_policies.replaced, ["cedar/policies"]);
    assert_eq!(only_policies.sources.policies, policies);
    assert_eq!(only_policies.sources.topologies, base.topologies);
    assert_eq!(only_policies.sources.scenarios, base.scenarios);
    assert_eq!(only_policies.sources.catalog, base.catalog);

    // One scenario is the whole list of scenarios, as one file in a
    // `scenarios/` directory would be.
    let one = from_files(
        vec![file("brownout.json", &a_scenario("brownout"))],
        bundled(),
    )
    .unwrap();
    assert_eq!(one.replaced, ["scenarios"]);
    assert_eq!(one.sources.scenarios.len(), 1);
    assert!(
        one.sources.recordings.is_empty(),
        "recordings of scenarios that are gone go with them"
    );
}

#[test]
fn files_are_ordered_by_name_whatever_order_they_arrive_in() {
    let files = vec![
        file("scenarios/20-second.json", &a_scenario("second")),
        file("10-first.json", &a_scenario("first")),
        file("somewhere/30-third.json", &a_scenario("third")),
    ];
    let mut reversed = files.clone();
    reversed.reverse();
    for order in [files, reversed] {
        let ids: Vec<String> = from_files(order, bundled())
            .unwrap()
            .sources
            .scenarios
            .into_iter()
            .map(|scenario| scenario.id)
            .collect();
        assert_eq!(ids, ["first", "second", "third"]);
    }
}

#[test]
fn files_that_cannot_be_placed_are_refused_with_the_file() {
    let refused = |files: Vec<SourceFile>| from_files(files, bundled()).unwrap_err();

    let unknown = refused(vec![file("notes.json", &json!({ "hello": "world" }))]);
    assert_eq!(unknown.path, Path::new("notes.json"));
    assert!(
        unknown.message.contains("not a file AEGIS recognises"),
        "{unknown}"
    );

    let empty = refused(vec![file("list.json", &json!([]))]);
    assert!(empty.message.contains("policies or entities"), "{empty}");

    let malformed = refused(vec![SourceFile {
        path: "shop.json".into(),
        text: "{ nodes: [] }".into(),
    }]);
    assert_eq!(malformed.path, Path::new("shop.json"));
    assert!(malformed.message.contains("line 1"), "{malformed}");

    // Told from its contents, then held to the same checks as any scenario.
    let mut wild = a_scenario("wild");
    wild["phases"][0]["effects"][0]["factor"] = json!(-2.0);
    let invalid = refused(vec![file("wild.json", &wild)]);
    assert_eq!(invalid.path, Path::new("wild.json"));
    assert!(invalid.message.contains("phase `Slow`"), "{invalid}");

    let twice = refused(vec![
        file(
            "a/catalog.json",
            &serde_json::to_value(bundled().catalog).unwrap(),
        ),
        file(
            "b/catalog.json",
            &serde_json::to_value(bundled().catalog).unwrap(),
        ),
    ]);
    assert!(twice.message.contains("second catalogue"), "{twice}");

    let nothing = refused(vec![SourceFile {
        path: "README.md".into(),
        text: "notes".into(),
    }]);
    assert!(
        nothing.message.contains("holds no workspace file"),
        "{nothing}"
    );

    for path in ["../secret.json", "", "a\u{0}b.json"] {
        let error = refused(vec![file(path, &a_scenario("x"))]);
        assert!(
            error.message.contains("`..`") || error.message.contains("invalid path"),
            "{path:?}: {error}"
        );
    }

    let version = refused(vec![file("workspace.json", &json!({ "formatVersion": 2 }))]);
    assert!(
        version.message.contains("unsupported formatVersion 2"),
        "{version}"
    );

    let bundle_in_bundle = Bundle {
        format_version: 1,
        files: vec![SourceFile {
            path: "inner.json".into(),
            text: serde_json::to_string(&Bundle {
                format_version: 1,
                files: Vec::new(),
            })
            .unwrap(),
        }],
    };
    let nested = refused(vec![file(
        "outer.json",
        &serde_json::to_value(&bundle_in_bundle).unwrap(),
    )]);
    assert!(
        nested.message.contains("cannot hold another bundle"),
        "{nested}"
    );
}

#[test]
fn an_import_is_bounded_in_files_and_in_size() {
    let many: Vec<SourceFile> = (0..=MAX_IMPORT_FILES)
        .map(|i| SourceFile {
            path: format!("notes-{i}.txt"),
            text: String::new(),
        })
        .collect();
    let error = from_files(many, bundled()).unwrap_err();
    assert!(error.message.contains("more than 256 files"), "{error}");

    let mut text = serde_json::to_string(&a_scenario("big")).unwrap();
    text.push_str(&" ".repeat(MAX_FILE_BYTES as usize));
    let error = from_files(
        vec![SourceFile {
            path: "big.json".into(),
            text,
        }],
        bundled(),
    )
    .unwrap_err();
    assert!(error.message.contains("larger than 4 MiB"), "{error}");
}

#[test]
fn a_bundle_file_can_be_named_where_a_directory_is_expected() {
    let dir = TempDir::new();
    let example = workspace::load(&example_dir()).unwrap().sources;
    let path = dir.write(
        "shop.aegis.json",
        &serde_json::to_string(&bundle_of(&example).unwrap()).unwrap(),
    );
    let loaded = workspace::load(&path).expect("loads like the directory");
    assert_eq!(loaded.sources, example);

    // A mistake inside it names the bundle and the file within.
    let mut broken = bundle_of(&example).unwrap();
    broken.files[1].text = "{".into();
    let path = dir.write("broken.json", &serde_json::to_string(&broken).unwrap());
    let error = workspace::load(&path).unwrap_err();
    assert_eq!(error.path, path);
    assert!(
        error.message.starts_with("topologies/01-corner-shop.json:"),
        "{error}"
    );
}

// ---------------------------------------------------------------------------
// Through the server
// ---------------------------------------------------------------------------

async fn status(state: &AppState) -> Value {
    common::get(state, "/api/v1/workspace").await.body
}

#[tokio::test]
async fn a_check_says_what_applying_would_give_and_applies_nothing() {
    let state = common::state();
    let check = common::post(
        &state,
        "/api/v1/demo/workspace/check",
        body(&files_in(&example_dir())),
    )
    .await;
    assert_eq!(check.status, StatusCode::OK);
    assert_eq!(check.body["valid"], true);
    let workspace = &check.body["workspace"];
    assert_eq!(workspace["origin"], "imported");
    assert_eq!(workspace["defaultTopologyId"], "corner-shop");
    assert_eq!(workspace["topologies"][0]["nodeCount"], 6);
    assert_eq!(
        workspace["scenarioIds"],
        json!(["ledger-fire", "receipt-snooping"])
    );
    assert_eq!(workspace["recordingIds"], json!(["a-bad-afternoon"]));
    assert_eq!(workspace["policyCount"], 3);
    assert_eq!(workspace["ignored"], json!(["README.md"]));
    assert!(workspace["unavailable"].as_array().unwrap().is_empty());
    assert!(check.body.get("problem").is_none());

    // Nothing changed.
    assert_eq!(status(&state).await["origin"], "bundled");
    assert_eq!(state.service.topology_id(), "helios-commerce");

    // A scenario that fits no topology is not an error: it is listed.
    let mut files = files_in(&example_dir());
    files.push(file("scenarios/03-outage.json", &{
        let mut scenario = a_scenario("outage");
        scenario["phases"][0]["effects"] =
            json!([{ "type": "down", "nodes": "region:outageRegion" }]);
        scenario
    }));
    let check = common::post(&state, "/api/v1/demo/workspace/check", body(&files)).await;
    assert_eq!(check.body["valid"], true);
    assert_eq!(
        check.body["workspace"]["unavailable"][0],
        json!({
            "topologyId": "corner-shop",
            "scenarioId": "outage",
            "reason": "topology has no region role or region `outageRegion`"
        })
    );
}

#[tokio::test]
async fn a_check_names_the_file_a_mistake_is_in() {
    let state = common::state();
    let mut files = files_in(&example_dir());
    let scenario = files
        .iter_mut()
        .find(|file| file.path == "scenarios/01-ledger-fire.json")
        .unwrap();
    scenario.text = scenario.text.replace("\"rampMs\"", "\"rampMS\"");
    let check = common::post(&state, "/api/v1/demo/workspace/check", body(&files)).await;
    assert_eq!(
        check.status,
        StatusCode::OK,
        "a mistake in the files is an answer"
    );
    assert_eq!(check.body["valid"], false);
    assert_eq!(
        check.body["problem"]["path"],
        "scenarios/01-ledger-fire.json"
    );
    assert!(check.body["problem"]["message"]
        .as_str()
        .unwrap()
        .contains("rampMS"));
    assert!(check.body.get("workspace").is_none());

    // What only shows across files names no single one.
    let mut files = files_in(&example_dir());
    files.retain(|file| !file.path.starts_with("topologies/"));
    let check = common::post(&state, "/api/v1/demo/workspace/check", body(&files)).await;
    assert_eq!(check.body["valid"], false);
    assert!(check.body["problem"].get("path").is_none());
    assert!(check.body["problem"]["message"]
        .as_str()
        .unwrap()
        .contains("unknown topology `corner-shop`"));

    // The same files are refused by the import, and nothing is applied.
    let refused = common::post(&state, "/api/v1/demo/workspace/import", body(&files)).await;
    assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(refused.body["error"]["code"], "invalid_workspace");
    assert_eq!(status(&state).await["origin"], "bundled");
}

#[tokio::test]
async fn an_import_replaces_what_the_server_runs_on_and_a_reset_brings_it_back() {
    let state = common::state();
    let mut stream = state.service.subscribe();
    for _ in 0..10 {
        state.service.advance(std::time::Duration::from_millis(200));
    }

    let imported = common::post(
        &state,
        "/api/v1/demo/workspace/import",
        body(&files_in(&example_dir())),
    )
    .await;
    assert_eq!(imported.status, StatusCode::OK);
    assert_eq!(imported.body["workspace"]["origin"], "imported");
    assert_eq!(imported.body["playback"]["tick"], 0, "a new timeline");

    // Subscribers are told to refetch everything.
    let mut told = false;
    while let Ok(message) = stream.try_recv() {
        told |= message.contains("\"type\":\"timeline\"")
            && message.contains("\"reason\":\"workspace\"");
    }
    assert!(told);

    assert_eq!(status(&state).await["origin"], "imported");
    let topologies = common::get(&state, "/api/v1/topologies").await;
    assert_eq!(topologies.body["activeId"], "corner-shop");
    assert_eq!(topologies.body["topologies"].as_array().unwrap().len(), 1);
    let scenarios = common::get(&state, "/api/v1/scenarios").await;
    assert_eq!(scenarios.body["scenarios"][1]["id"], "receipt-snooping");
    let catalog = common::get(&state, "/api/v1/demo/authorization/catalog").await;
    assert_eq!(catalog.body["policies"].as_array().unwrap().len(), 3);

    // Decisions come from the imported policies.
    let decision = common::post(
        &state,
        "/api/v1/demo/authorization/evaluate",
        json!({
            "principal": "Clerk::\"ana\"",
            "action": "Action::\"read\"",
            "resource": "Receipt::\"south-0077\""
        }),
    )
    .await;
    assert_eq!(decision.body["decision"], "deny");
    assert_eq!(
        decision.body["determiningPolicies"],
        json!(["other-shops-are-closed-books"])
    );
    // And the scenarios run: Cedar's answer stops the flow.
    let started = common::post(
        &state,
        "/api/v1/demo/scenarios/start",
        json!({ "scenarioId": "receipt-snooping" }),
    )
    .await;
    assert_eq!(started.status, StatusCode::OK);

    let reset = common::post(&state, "/api/v1/demo/workspace/reset", json!({})).await;
    assert_eq!(reset.status, StatusCode::OK);
    assert_eq!(reset.body["workspace"]["origin"], "bundled");
    assert_eq!(state.service.topology_id(), "helios-commerce");
    assert_eq!(
        common::get(&state, "/api/v1/incidents").await.body["incidents"],
        json!([]),
        "the timeline of what was imported is gone with it"
    );
    let assets = state.service.assets();
    let bundled = Assets::bundled().unwrap();
    assert_eq!(assets.cedar.policies(), bundled.cedar.policies());
    assert_eq!(
        assets.decisions.scenario["alice-view-ledger"]
            .outcome
            .decision,
        Decision::Allow
    );
}

#[tokio::test]
async fn what_is_exported_can_be_imported_again() {
    let state = common::state();
    let exported = common::get(&state, "/api/v1/workspace/export").await;
    assert_eq!(exported.status, StatusCode::OK);
    assert_eq!(exported.body["formatVersion"], 1);
    let files = exported.body["files"].as_array().unwrap();
    assert_eq!(files[0]["path"], "workspace.json");
    assert!(files
        .iter()
        .any(|file| file["path"] == "topologies/02-hyperscale-stress.json"));

    // Far larger than an ordinary request body is allowed to be.
    let document =
        json!({ "files": [{ "path": "aegis-workspace.json", "text": exported.body.to_string() }] });
    assert!(document.to_string().len() > MAX_BODY_BYTES);
    let imported = common::post(&state, "/api/v1/demo/workspace/import", document).await;
    assert_eq!(imported.status, StatusCode::OK, "{}", imported.body);
    assert_eq!(imported.body["workspace"]["origin"], "imported");
    assert_eq!(
        *state.service.loaded().sources,
        Sources::bundled().unwrap(),
        "the same sources, by way of a file"
    );
}

#[tokio::test]
async fn an_import_is_laid_over_what_the_server_was_started_with() {
    let example = example_dir();
    let state = common::state_with(&[("AEGIS_WORKSPACE", example.to_str().unwrap())]);
    assert_eq!(status(&state).await["origin"], "startup");

    // Only the policies: the platform stays the operator's.
    let policies = json!([{
        "id": "nobody-reads",
        "description": "Nothing is permitted.",
        "content": "forbid(principal, action, resource);"
    }]);
    let imported = common::post(
        &state,
        "/api/v1/demo/workspace/import",
        body(&[file("policies.json", &policies)]),
    )
    .await;
    assert_eq!(imported.status, StatusCode::OK, "{}", imported.body);
    let workspace = &imported.body["workspace"];
    assert_eq!(workspace["replaced"], json!(["cedar/policies"]));
    assert_eq!(workspace["defaultTopologyId"], "corner-shop");
    assert_eq!(workspace["policyCount"], 1);
    assert_eq!(workspace["baselineDenyFraction"], 1.0);

    // A second import starts from the same place, not from the first.
    let second = common::post(
        &state,
        "/api/v1/demo/workspace/import",
        body(&[file("brownout.json", &a_scenario("brownout"))]),
    )
    .await;
    assert_eq!(second.body["workspace"]["replaced"], json!(["scenarios"]));
    assert_eq!(second.body["workspace"]["policyCount"], 3);

    let reset = common::post(&state, "/api/v1/demo/workspace/reset", json!({})).await;
    assert_eq!(reset.body["workspace"]["origin"], "startup");
    assert_eq!(reset.body["workspace"]["policyCount"], 3);
}

#[tokio::test]
async fn importing_can_be_switched_off() {
    let state = common::state_with(&[("AEGIS_IMPORT", "off")]);
    let current = status(&state).await;
    assert_eq!(current["importEnabled"], false);
    assert_eq!(current["origin"], "bundled");

    for (path, sent) in [
        (
            "/api/v1/demo/workspace/check",
            body(&files_in(&example_dir())),
        ),
        (
            "/api/v1/demo/workspace/import",
            body(&files_in(&example_dir())),
        ),
        ("/api/v1/demo/workspace/reset", json!({})),
    ] {
        let refused = common::post(&state, path, sent).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(refused.body["error"]["code"], "import_disabled");
    }
    assert_eq!(state.service.topology_id(), "helios-commerce");
    // Reading what is in use is not importing.
    assert_eq!(
        common::get(&state, "/api/v1/workspace/export").await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn import_requests_are_validated_and_bounded() {
    let state = common::state();
    for invalid in [
        json!({}),
        json!({ "files": [] }),
        json!({ "files": [{ "path": "a.json" }] }),
        json!({ "files": [{ "path": "a.json", "text": "{}", "mode": "0777" }] }),
        json!({ "files": [], "target": "/etc" }),
    ] {
        let reply = common::post(&state, "/api/v1/demo/workspace/import", invalid.clone()).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{invalid}");
    }

    // The larger limit is for the two routes that carry files, and is a limit.
    let padding = "x".repeat(MAX_IMPORT_BYTES);
    let too_large = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/demo/workspace/import")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "files": [{ "path": "notes.txt", "text": padding }] }).to_string(),
        ))
        .unwrap();
    assert_eq!(
        common::raw(&state, too_large).await.status,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let elsewhere = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/demo/scenarios/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "scenarioId": "x".repeat(MAX_BODY_BYTES) }).to_string(),
        ))
        .unwrap();
    assert_eq!(
        common::raw(&state, elsewhere).await.status,
        StatusCode::PAYLOAD_TOO_LARGE,
        "every other route keeps the small limit"
    );
    assert_eq!(status(&state).await["origin"], "bundled");
}

#[test]
fn a_compose_file_dropped_on_its_own_is_taken_for_a_topology() {
    let compose = SourceFile {
        path: "docker-compose.yml".into(),
        text: "services:\n  web:\n    image: nginx\n    ports: ['80:80']\n    depends_on: [db]\n  db:\n    image: postgres:16\n".into(),
    };
    let workspace = from_files(vec![compose], bundled()).expect("a Compose file is a topology");
    assert_eq!(workspace.replaced, ["topologies"]);
    // With no name of its own the project goes by its file's.
    let topology = &workspace.sources.topologies[0];
    assert_eq!(topology.id, "docker-compose");
    assert_eq!(topology.nodes.len(), 3);
    // The rest of what the page opened with stays.
    assert_eq!(workspace.sources.scenarios.len(), bundled().scenarios.len());

    // Any other YAML is said to be what it is, not passed over in silence.
    let other = SourceFile {
        path: "values.yaml".into(),
        text: "replicaCount: 2\n".into(),
    };
    let error = from_files(vec![other], bundled()).expect_err("refused");
    assert!(error.message.contains("not a Compose file"), "{error}");
}

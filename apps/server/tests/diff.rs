//! Comparing two sets of sources: what Cedar decides differently under a
//! candidate workspace, and where simulated traffic stops because of it.
#![allow(clippy::unwrap_used)]

mod common;

use std::path::Path;
use std::process::Command;

use aegis_server::application::diff::{
    compare, ChangeKind, Diff, FlowFate, RequestList, MATRIX_LIMIT,
};
use aegis_server::application::{Assets, Sources};
use aegis_server::authorization::PolicyDocument;
use aegis_server::domain::Decision;
use aegis_server::workspace;
use common::TempDir;
use serde_json::{json, Value};

fn bundled() -> Assets {
    Assets::bundled().unwrap()
}

fn with_policies(edit: impl FnOnce(&mut Vec<PolicyDocument>)) -> Assets {
    let mut sources = Sources::bundled().unwrap();
    edit(&mut sources.policies);
    Assets::build(sources).unwrap()
}

fn without_finance_view() -> Assets {
    with_policies(|policies| policies.retain(|policy| policy.id != "finance-view-ledger"))
}

fn diff(base: &Assets, candidate: &Assets) -> Diff {
    compare(base, candidate).expect("both sides evaluate")
}

#[test]
fn identical_sources_differ_in_nothing() {
    let diff = diff(&bundled(), &bundled());
    assert!(diff.policies.is_empty());
    assert!(!diff.entities_changed && !diff.catalog_changed);
    assert_eq!(diff.requests.compared, 15);
    assert!(diff.requests.changes.is_empty());
    assert!(diff.flows.is_empty() && diff.availability.is_empty());
    // 6 principals over 14 matching action and resource pairs, each with
    // mfa and changeWindow absent, false or true.
    assert_eq!(diff.matrix.compared, 6 * 14 * 9);
    assert_eq!(diff.matrix.context_keys, ["mfa", "changeWindow"]);
    assert_eq!(diff.matrix.note, None);
    assert_eq!(
        (
            diff.matrix.allow_to_deny,
            diff.matrix.deny_to_allow,
            diff.matrix.attribution_only
        ),
        (0, 0, 0)
    );
    assert!(!diff.decisions_changed());
    assert!(diff.render("a", "b").ends_with("No decision differs.\n"));
}

#[test]
fn removing_a_permit_shows_every_request_it_decided() {
    let base = bundled();
    let candidate = without_finance_view();
    let diff = diff(&base, &candidate);

    assert_eq!(diff.policies.removed, ["finance-view-ledger"]);
    assert!(diff.policies.added.is_empty() && diff.policies.changed.is_empty());
    assert!(diff.denied_at_rest.candidate > diff.denied_at_rest.base);
    assert_eq!(
        diff.denied_at_rest.base,
        base.decisions.baseline_deny_fraction
    );

    // The request is in the traffic mix and is the one a scenario flow uses.
    let lists: Vec<RequestList> = diff.requests.changes.iter().map(|c| c.list).collect();
    assert_eq!(
        lists,
        [RequestList::TrafficMix, RequestList::ScenarioRequests]
    );
    for change in &diff.requests.changes {
        assert_eq!(change.id, "alice-view-ledger");
        assert_eq!(change.kind, ChangeKind::Decision);
        let before = change.base.as_ref().unwrap();
        let after = change.candidate.as_ref().unwrap();
        assert_eq!(before.decision, Decision::Allow);
        assert_eq!(before.determining_policies, ["finance-view-ledger"]);
        assert_eq!(after.decision, Decision::Deny);
        assert!(after.determining_policies.is_empty(), "default deny");
    }

    // The flow Cedar used to permit is now stopped, on both topologies.
    assert_eq!(diff.flows.len(), 2);
    for flow in &diff.flows {
        assert_eq!(flow.scenario, "cedar-denial");
        assert_eq!(flow.request, "alice-view-ledger");
        assert_eq!(
            (flow.base, flow.candidate),
            (FlowFate::Permitted, FlowFate::Denied)
        );
    }

    // In the matrix: Alice, that action, her tenant's ledger, whatever the
    // context. Nothing became allowed.
    assert_eq!(diff.matrix.deny_to_allow, 0);
    assert_eq!(diff.matrix.allow_to_deny, 9);
    assert_eq!(diff.matrix.changes.len(), 1);
    let change = &diff.matrix.changes[0];
    assert_eq!(change.principal, "User::\"alice\"");
    assert_eq!(change.action, "Action::\"viewLedger\"");
    assert_eq!(change.resource, "Ledger::\"acme-ledger-2026\"");
    assert!(change.every_context && change.contexts.is_empty());
    assert_eq!(change.base_policies, ["finance-view-ledger"]);

    assert!(diff.decisions_changed());
    let report = diff.render("before", "after");
    assert!(report.contains("removed  finance-view-ledger"), "{report}");
    assert!(report.contains("in every context"), "{report}");
    assert!(
        report.contains("was permitted by finance-view-ledger; now denied by default"),
        "{report}"
    );
    assert!(
        report.contains("reaches its resource -> stops at the authorizer"),
        "{report}"
    );
    assert!(report.ends_with("Decisions differ.\n"));
}

#[test]
fn a_change_that_depends_on_context_names_the_contexts() {
    // Exporting the ledger no longer asks for a fresh MFA assertion.
    let candidate = with_policies(|policies| {
        let policy = policies
            .iter_mut()
            .find(|policy| policy.id == "finance-export-ledger-mfa")
            .unwrap();
        policy.content = policy.content.replace(" && context.mfa == true", "");
    });
    let diff = diff(&bundled(), &candidate);
    assert_eq!(diff.policies.changed, ["finance-export-ledger-mfa"]);

    assert_eq!(diff.matrix.allow_to_deny, 0);
    assert_eq!(diff.matrix.changes.len(), 1);
    let change = &diff.matrix.changes[0];
    assert_eq!(change.action, "Action::\"exportLedger\"");
    assert_eq!(
        (change.base, change.candidate),
        (Decision::Deny, Decision::Allow)
    );
    // Allowed already with mfa=true; changed in the other six contexts.
    assert!(!change.every_context);
    assert_eq!(change.contexts.len(), 6);
    assert_eq!(diff.matrix.deny_to_allow, 6);
    assert!(change
        .contexts
        .iter()
        .all(|context| context.get("mfa") != Some(&Value::Bool(true))));
    assert!(
        diff.render("a", "b").contains("with mfa absent; mfa=false"),
        "the key it does not depend on is left out"
    );

    // A suspended finance analyst is denied either way, but the policy that
    // used to error on the missing attribute no longer does.
    assert!(diff.matrix.attribution_only > 0);
    let request = diff
        .requests
        .changes
        .iter()
        .find(|change| change.id == "alice-export-ledger-no-mfa")
        .unwrap();
    assert_eq!(request.kind, ChangeKind::Decision);
}

#[test]
fn rewriting_policies_without_changing_their_meaning_is_not_a_change() {
    // The bundled policies, moved from the JSON list to Cedar's own syntax
    // with annotations, different line breaks and a comment.
    let dir = TempDir::new();
    let mut text = String::from("// The same nine policies.\n");
    for policy in Sources::bundled().unwrap().policies {
        let body = policy
            .content
            .replace(" when ", "\nwhen ")
            .replace(" unless ", "\n  unless ");
        text.push_str(&format!(
            "\n@id(\"{}\")\n@description(\"{}\")\n{body}\n",
            policy.id,
            policy.description.replace('"', "'")
        ));
    }
    dir.write("cedar/policies.cedar", &text);
    let candidate = Assets::build(workspace::load(dir.path()).unwrap().sources).unwrap();
    assert_eq!(candidate.cedar.policies().len(), 9);

    let diff = diff(&bundled(), &candidate);
    assert!(diff.policies.is_empty(), "{:?}", diff.policies);
    assert!(!diff.decisions_changed());
    assert_eq!(diff.matrix.attribution_only, 0);
    assert!(diff.render("a", "b").contains("Policies\n  no change"));
}

#[test]
fn two_unrelated_workspaces_are_compared_without_inventing_agreement() {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/corner-shop");
    let candidate = Assets::build(workspace::load(&example).unwrap().sources).unwrap();
    let diff = diff(&bundled(), &candidate);

    assert_eq!(diff.topologies.added, ["corner-shop"]);
    assert_eq!(
        diff.topologies.removed,
        ["helios-commerce", "hyperscale-stress"]
    );
    assert_eq!(diff.scenarios.added, ["ledger-fire", "receipt-snooping"]);
    assert_eq!(diff.scenarios.removed.len(), 5);
    assert!(diff.entities_changed && diff.catalog_changed);
    assert_eq!(diff.policies.added.len(), 3);
    assert_eq!(diff.policies.removed.len(), 9);

    // No request id is shared, so none is compared: each is added or removed.
    assert_eq!(diff.requests.compared, 0);
    assert!(diff
        .requests
        .changes
        .iter()
        .all(|change| matches!(change.kind, ChangeKind::Added | ChangeKind::Removed)));
    assert_eq!(
        diff.requests
            .changes
            .iter()
            .filter(|change| change.kind == ChangeKind::Removed)
            .count(),
        15
    );
    // No topology is shared either, so no flow or scenario is compared.
    assert!(diff.flows.is_empty() && diff.availability.is_empty());

    // The matrix is the candidate's catalogue: 3 clerks, 2 actions, 2
    // receipts, no context key. The bundled policies know none of them.
    assert_eq!(diff.matrix.compared, 12);
    assert_eq!(diff.matrix.contexts, 1);
    assert_eq!(diff.matrix.allow_to_deny, 0);
    assert!(diff.matrix.deny_to_allow > 0);
    assert!(diff.decisions_changed());
}

#[test]
fn a_scenario_that_stops_being_runnable_is_reported_with_the_reason() {
    // Without the request the stuffing flow is tied to, that scenario
    // cannot run; nothing else about it is compared.
    let mut sources = Sources::bundled().unwrap();
    sources
        .catalog
        .scenario_requests
        .retain(|request| request.id != "stolen-session-export");
    let candidate = Assets::build(sources).unwrap();
    let diff = diff(&bundled(), &candidate);

    assert_eq!(diff.availability.len(), 2, "on both topologies");
    for change in &diff.availability {
        assert_eq!(change.scenario, "credential-stuffing");
        assert_eq!(change.base, None);
        assert!(change
            .candidate
            .as_deref()
            .is_some_and(|reason| reason.contains("stolen-session-export")));
    }
    let removed: Vec<&str> = diff
        .requests
        .changes
        .iter()
        .filter(|change| change.kind == ChangeKind::Removed)
        .map(|change| change.id.as_str())
        .collect();
    assert_eq!(removed, ["stolen-session-export"]);
    assert!(diff.catalog_changed);
    assert!(
        !diff.decisions_changed(),
        "no request both sides have is decided differently"
    );
    assert!(diff
        .render("a", "b")
        .contains("credential-stuffing on helios-commerce: can run -> cannot run"));
}

#[test]
fn a_catalogue_too_large_for_the_matrix_says_what_was_left_out() {
    // Enough context keys that every assignment would pass the limit.
    let mut sources = Sources::bundled().unwrap();
    let template = sources.catalog.context_keys[0].clone();
    for i in 0..6 {
        let mut key = template.clone();
        key.key = format!("flag{i}");
        sources.catalog.context_keys.push(key);
    }
    assert!(84 * 3usize.pow(8) > MATRIX_LIMIT);
    let candidate = Assets::build(sources).unwrap();
    let diff = diff(&bundled(), &candidate);
    assert_eq!(diff.matrix.contexts, 1);
    assert!(diff.matrix.context_keys.is_empty());
    assert_eq!(diff.matrix.compared, 84);
    let note = diff.matrix.note.as_deref().expect("says so");
    assert!(note.contains("only the empty context"), "{note}");
    assert!(diff.render("a", "b").contains(note));
}

// ---------------------------------------------------------------------------
// Through the binary
// ---------------------------------------------------------------------------

fn candidate_without_finance_view() -> TempDir {
    let dir = TempDir::new();
    let mut policies = Sources::bundled().unwrap().policies;
    policies.retain(|policy| policy.id != "finance-view-ledger");
    dir.write_json(
        "cedar/policies.json",
        &serde_json::to_value(&policies).unwrap(),
    );
    dir
}

fn run(args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_aegis-server"))
        .args(args)
        .output()
        .expect("the server binary runs");
    (
        output.status.code().expect("exits"),
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap(),
    )
}

#[test]
fn the_command_reports_and_can_gate_on_a_changed_decision() {
    let dir = candidate_without_finance_view();
    let candidate = dir.path().to_str().unwrap();

    let (status, report, _) = run(&["diff-workspace", "@bundled", candidate]);
    assert_eq!(status, 0, "reporting alone never fails");
    assert!(report.starts_with("base       @bundled\n"), "{report}");
    assert!(report.contains("removed  finance-view-ledger"));
    assert!(report.contains("allow -> deny"));
    assert!(report.ends_with("Decisions differ.\n"));

    let (status, gated, _) = run(&["diff-workspace", "@bundled", candidate, "--exit-code"]);
    assert_eq!(status, 1, "a decision differs");
    assert_eq!(gated, report);

    // The other way round the same policy is an addition.
    let (_, reversed, _) = run(&["diff-workspace", candidate, "@bundled"]);
    assert!(
        reversed.contains("added    finance-view-ledger"),
        "{reversed}"
    );
    assert!(reversed.contains("deny -> allow"));

    let (status, same, _) = run(&["diff-workspace", "@bundled", "@bundled", "--exit-code"]);
    assert_eq!(status, 0);
    assert!(same.ends_with("No decision differs.\n"));
}

#[test]
fn the_command_writes_json_for_other_tools() {
    let dir = candidate_without_finance_view();
    let candidate = dir.path().to_str().unwrap();
    let (status, stdout, _) = run(&["diff-workspace", "@bundled", candidate, "--json"]);
    assert_eq!(status, 0);
    let report: Value = serde_json::from_str(&stdout).expect("valid JSON");
    assert_eq!(report["base"], "@bundled");
    assert_eq!(report["candidate"], candidate);
    assert_eq!(report["decisionsChanged"], true);
    let diff = &report["diff"];
    assert_eq!(diff["policies"]["removed"], json!(["finance-view-ledger"]));
    assert_eq!(diff["requests"]["changes"][0]["kind"], "decision");
    assert_eq!(diff["requests"]["changes"][0]["list"], "traffic-mix");
    assert_eq!(diff["requests"]["changes"][0]["base"]["decision"], "allow");
    assert_eq!(diff["flows"][0]["candidate"], "denied");
    assert_eq!(diff["matrix"]["allowToDeny"], 9);
    assert_eq!(diff["matrix"]["changes"][0]["everyContext"], true);
}

#[test]
fn the_command_exits_with_two_when_it_cannot_compare() {
    let (status, stdout, stderr) = run(&["diff-workspace", "@bundled", "/nonexistent/workspace"]);
    assert_eq!(status, 2);
    assert!(stdout.is_empty());
    assert!(stderr.contains("does not exist"), "{stderr}");

    let broken = TempDir::new();
    broken.write(
        "cedar/policies.cedar",
        "permit(principal, action, resource) when {",
    );
    let (status, _, stderr) = run(&[
        "diff-workspace",
        "@bundled",
        broken.path().to_str().unwrap(),
        "--exit-code",
    ]);
    assert_eq!(status, 2, "not 1: nothing was compared");
    assert!(stderr.contains("policies.cedar"), "{stderr}");

    for usage in [
        vec!["diff-workspace"],
        vec!["diff-workspace", "@bundled"],
        vec!["diff-workspace", "@bundled", "@bundled", "@bundled"],
        vec!["diff-workspace", "@bundled", "@bundled", "--yaml"],
    ] {
        let (status, _, stderr) = run(&usage);
        assert_eq!(status, 2, "{usage:?}");
        assert!(stderr.contains("usage:"), "{stderr}");
    }
}

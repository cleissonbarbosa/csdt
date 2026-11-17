//! What changes between two sets of sources.
//!
//! The question a policy author asks before merging: under the new policies,
//! which requests are decided differently, and where does simulated traffic
//! now stop? Both sides are built the way start-up builds them, so every
//! answer on either side is Cedar's. This module only compares them. No I/O.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde::Serialize;

use crate::authorization::{AuthzCatalog, PolicyChanges};
use crate::domain::{
    AuthorizationRequest, AuthzError, Decision, PolicyDecision, PolicyDecisionPoint,
};
use crate::simulation::decisions::EvaluatedRequest;

use super::Assets;

/// Most principal × action × resource × context combinations compared.
pub const MATRIX_LIMIT: usize = 20_000;
/// Most access-matrix changes written out in the text report.
const REPORT_LINES: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Change<T> {
    pub base: T,
    pub candidate: T,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct IdChanges {
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

impl IdChanges {
    fn between(base: &[String], candidate: &[String]) -> Self {
        Self {
            added: candidate
                .iter()
                .filter(|id| !base.contains(id))
                .cloned()
                .collect(),
            removed: base
                .iter()
                .filter(|id| !candidate.contains(id))
                .cloned()
                .collect(),
        }
    }

    fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeKind {
    /// Allowed on one side, denied on the other.
    Decision,
    /// The same decision, determined by different policies or with
    /// different evaluation errors.
    Attribution,
    /// Only the candidate's catalogue has the request.
    Added,
    /// Only the base's catalogue has the request.
    Removed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequestList {
    /// Ordinary authorization traffic.
    TrafficMix,
    /// Requests scenario flows are tied to.
    ScenarioRequests,
}

/// A catalogued request whose outcome is not the same on both sides.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestChange {
    pub list: RequestList,
    pub id: String,
    pub kind: ChangeKind,
    pub request: AuthorizationRequest,
    pub base: Option<PolicyDecision>,
    pub candidate: Option<PolicyDecision>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestChanges {
    /// Requests both catalogues have.
    pub compared: usize,
    pub changes: Vec<RequestChange>,
}

/// What happens to a scenario flow at the authorizer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FlowFate {
    /// Cedar permits its request: it goes on to its resource.
    Permitted,
    /// Cedar denies its request: it stops at the authorizer.
    Denied,
}

impl FlowFate {
    fn of(deny: bool) -> Self {
        if deny {
            Self::Denied
        } else {
            Self::Permitted
        }
    }

    fn describe(self) -> &'static str {
        match self {
            Self::Permitted => "reaches its resource",
            Self::Denied => "stops at the authorizer",
        }
    }
}

/// A scenario flow that is stopped on one side and let through on the other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowChange {
    pub topology: String,
    pub scenario: String,
    pub flow: String,
    pub label: String,
    /// Catalogue request the candidate ties the flow to.
    pub request: String,
    pub base: FlowFate,
    pub candidate: FlowFate,
}

/// A scenario that can run on a topology on one side only. Each side holds
/// the reason it cannot run there, or nothing when it can.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityChange {
    pub topology: String,
    pub scenario: String,
    pub base: Option<String>,
    pub candidate: Option<String>,
}

/// One principal, action and resource decided differently, and in which of
/// the contexts tried.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixChange {
    pub principal: String,
    pub action: String,
    pub resource: String,
    pub base: Decision,
    pub candidate: Decision,
    /// True when it changed this way in every context tried.
    pub every_context: bool,
    /// The contexts in which it changed; empty when `every_context`.
    pub contexts: Vec<serde_json::Map<String, serde_json::Value>>,
    /// Policies that determined the decision, over those contexts.
    pub base_policies: Vec<String>,
    pub candidate_policies: Vec<String>,
}

/// Every request the candidate's catalogue lets the request tracer build,
/// evaluated on both sides.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Matrix {
    pub principals: usize,
    pub actions: usize,
    pub resources: usize,
    /// The catalogue's context keys that were varied.
    pub context_keys: Vec<String>,
    /// Context assignments tried for each principal, action and resource:
    /// every varied key absent, false or true.
    pub contexts: usize,
    /// Requests evaluated on each side.
    pub compared: usize,
    /// Set when fewer combinations were compared than the catalogue allows.
    pub note: Option<String>,
    pub allow_to_deny: usize,
    pub deny_to_allow: usize,
    /// Same decision, different determining policies or errors.
    pub attribution_only: usize,
    pub changes: Vec<MatrixChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub policies: PolicyChanges,
    pub entities_changed: bool,
    pub catalog_changed: bool,
    pub topologies: IdChanges,
    pub scenarios: IdChanges,
    /// Share of ordinary authorization traffic Cedar denies.
    pub denied_at_rest: Change<f64>,
    pub requests: RequestChanges,
    pub flows: Vec<FlowChange>,
    pub availability: Vec<AvailabilityChange>,
    pub matrix: Matrix,
}

fn kind_of(base: &PolicyDecision, candidate: &PolicyDecision) -> Option<ChangeKind> {
    if base.decision != candidate.decision {
        Some(ChangeKind::Decision)
    } else if base != candidate {
        Some(ChangeKind::Attribution)
    } else {
        None
    }
}

fn compare_requests<'a>(
    list: RequestList,
    base: impl Iterator<Item = &'a EvaluatedRequest> + Clone,
    candidate: impl Iterator<Item = &'a EvaluatedRequest>,
    out: &mut RequestChanges,
) {
    let mut seen: Vec<&str> = Vec::new();
    for after in candidate {
        seen.push(&after.id);
        let before = base.clone().find(|before| before.id == after.id);
        let kind = match before {
            Some(before) => {
                out.compared += 1;
                kind_of(&before.outcome, &after.outcome)
            }
            None => Some(ChangeKind::Added),
        };
        if let Some(kind) = kind {
            out.changes.push(RequestChange {
                list,
                id: after.id.clone(),
                kind,
                request: after.request.clone(),
                base: before.map(|b| b.outcome.clone()),
                candidate: Some(after.outcome.clone()),
            });
        }
    }
    for before in base.filter(|before| !seen.contains(&before.id.as_str())) {
        out.changes.push(RequestChange {
            list,
            id: before.id.clone(),
            kind: ChangeKind::Removed,
            request: before.request.clone(),
            base: Some(before.outcome.clone()),
            candidate: None,
        });
    }
}

/// How many context keys the matrix can vary without passing the limit, or
/// `None` when even the empty context alone is too many requests.
fn context_keys_within_limit(triples: usize, keys: usize) -> Option<usize> {
    let all = u32::try_from(keys)
        .ok()
        .and_then(|keys| 3usize.checked_pow(keys))
        .and_then(|contexts| contexts.checked_mul(triples));
    if all.is_some_and(|total| total <= MATRIX_LIMIT) {
        Some(keys)
    } else if triples <= MATRIX_LIMIT {
        Some(0)
    } else {
        None
    }
}

/// The `index`-th assignment of `keys`: each absent, false or true. Index 0
/// is the empty context.
fn context(keys: &[String], mut index: usize) -> serde_json::Map<String, serde_json::Value> {
    let mut context = serde_json::Map::new();
    for key in keys {
        match index % 3 {
            1 => {
                context.insert(key.clone(), false.into());
            }
            2 => {
                context.insert(key.clone(), true.into());
            }
            _ => {}
        }
        index /= 3;
    }
    context
}

fn union(into: &mut Vec<String>, more: &[String]) {
    for id in more {
        if !into.contains(id) {
            into.push(id.clone());
        }
    }
    into.sort();
}

fn compare_matrix(base: &Assets, candidate: &Assets) -> Result<Matrix, AuthzError> {
    let catalog: &AuthzCatalog = &candidate.catalog;
    let triples = super::access::triples(catalog);
    let all_keys: Vec<String> = catalog.context_keys.iter().map(|k| k.key.clone()).collect();
    let mut matrix = Matrix {
        principals: catalog.principals.len(),
        actions: catalog.actions.len(),
        resources: catalog.resources.len(),
        ..Matrix::default()
    };
    let keys = match context_keys_within_limit(triples.len(), all_keys.len()) {
        Some(used) if used == all_keys.len() => all_keys,
        Some(_) => {
            matrix.note = Some(format!(
                "the catalogue's {} context keys would make more than {MATRIX_LIMIT} requests; only the empty context was compared",
                all_keys.len()
            ));
            Vec::new()
        }
        None => {
            matrix.note = Some(format!(
                "the catalogue allows {} principal, action and resource combinations, more than the {MATRIX_LIMIT} compared at most; the matrix was skipped",
                triples.len()
            ));
            return Ok(matrix);
        }
    };
    // 3^keys fits: `context_keys_within_limit` multiplied it out.
    let contexts = 3usize.pow(keys.len() as u32);
    matrix.context_keys.clone_from(&keys);
    matrix.contexts = contexts;
    matrix.compared = triples.len() * contexts;

    for (principal, action, resource) in triples {
        // Flips of this triple, by direction.
        let mut flips: BTreeMap<bool, MatrixChange> = BTreeMap::new();
        for index in 0..contexts {
            let context = context(&keys, index);
            let request = AuthorizationRequest {
                principal: principal.to_string(),
                action: action.to_string(),
                resource: resource.to_string(),
                context: context.clone(),
            };
            let before = base.cedar.evaluate(&request, &[])?;
            let after = candidate.cedar.evaluate(&request, &[])?;
            match kind_of(&before, &after) {
                Some(ChangeKind::Decision) => {
                    let to_deny = after.decision == Decision::Deny;
                    if to_deny {
                        matrix.allow_to_deny += 1;
                    } else {
                        matrix.deny_to_allow += 1;
                    }
                    let change = flips.entry(to_deny).or_insert_with(|| MatrixChange {
                        principal: principal.to_string(),
                        action: action.to_string(),
                        resource: resource.to_string(),
                        base: before.decision,
                        candidate: after.decision,
                        every_context: false,
                        contexts: Vec::new(),
                        base_policies: Vec::new(),
                        candidate_policies: Vec::new(),
                    });
                    change.contexts.push(context);
                    union(&mut change.base_policies, &before.determining_policies);
                    union(&mut change.candidate_policies, &after.determining_policies);
                }
                Some(_) => matrix.attribution_only += 1,
                None => {}
            }
        }
        for mut change in flips.into_values() {
            if change.contexts.len() == contexts {
                change.every_context = true;
                change.contexts.clear();
            }
            matrix.changes.push(change);
        }
    }
    Ok(matrix)
}

fn compare_worlds(base: &Assets, candidate: &Assets, diff: &mut Diff) {
    for (topology, after_world) in &candidate.worlds {
        let Some(before_world) = base.worlds.get(topology) else {
            continue;
        };
        for after in after_world.scenarios.iter() {
            let Some(before) = before_world
                .scenarios
                .iter()
                .find(|scenario| scenario.info.id == after.info.id)
            else {
                continue;
            };
            if before.info.available != after.info.available {
                let reason = |info: &crate::domain::Scenario| {
                    (!info.available).then(|| {
                        info.unavailable_reason
                            .clone()
                            .unwrap_or_else(|| "not available".to_string())
                    })
                };
                diff.availability.push(AvailabilityChange {
                    topology: topology.clone(),
                    scenario: after.info.id.clone(),
                    base: reason(&before.info),
                    candidate: reason(&after.info),
                });
                continue;
            }
            for flow in &after.flows {
                let before_flow = before.flows.iter().find(|other| other.id == flow.id);
                let (Some(now), Some(then)) = (
                    flow.authz.as_ref(),
                    before_flow.and_then(|other| other.authz.as_ref()),
                ) else {
                    continue;
                };
                if now.deny != then.deny {
                    diff.flows.push(FlowChange {
                        topology: topology.clone(),
                        scenario: after.info.id.clone(),
                        flow: flow.id.clone(),
                        label: flow.label.clone(),
                        request: now.request_id.clone(),
                        base: FlowFate::of(then.deny),
                        candidate: FlowFate::of(now.deny),
                    });
                }
            }
        }
    }
}

fn scenario_ids(assets: &Assets) -> Vec<String> {
    assets
        .default_world()
        .scenarios
        .iter()
        .map(|scenario| scenario.info.id.clone())
        .collect()
}

/// Compares two built sets of sources. The candidate is the side being
/// proposed; the base is what it would replace.
pub fn compare(base: &Assets, candidate: &Assets) -> Result<Diff, AuthzError> {
    let mut requests = RequestChanges::default();
    compare_requests(
        RequestList::TrafficMix,
        base.decisions.mix.iter(),
        candidate.decisions.mix.iter(),
        &mut requests,
    );
    compare_requests(
        RequestList::ScenarioRequests,
        base.decisions.scenario.values(),
        candidate.decisions.scenario.values(),
        &mut requests,
    );
    let topology_ids = |assets: &Assets| assets.worlds.keys().cloned().collect::<Vec<_>>();
    let mut diff = Diff {
        policies: candidate.cedar.changes_from(&base.cedar),
        entities_changed: base.cedar.entities_json() != candidate.cedar.entities_json(),
        catalog_changed: base.catalog != candidate.catalog,
        topologies: IdChanges::between(&topology_ids(base), &topology_ids(candidate)),
        scenarios: IdChanges::between(&scenario_ids(base), &scenario_ids(candidate)),
        denied_at_rest: Change {
            base: base.decisions.baseline_deny_fraction,
            candidate: candidate.decisions.baseline_deny_fraction,
        },
        requests,
        flows: Vec::new(),
        availability: Vec::new(),
        matrix: compare_matrix(base, candidate)?,
    };
    compare_worlds(base, candidate, &mut diff);
    Ok(diff)
}

fn arrow(base: Decision, candidate: Decision) -> &'static str {
    match (base, candidate) {
        (Decision::Allow, Decision::Deny) => "allow -> deny ",
        (Decision::Deny, Decision::Allow) => "deny -> allow ",
        (Decision::Allow, Decision::Allow) => "allow         ",
        (Decision::Deny, Decision::Deny) => "deny          ",
    }
}

fn because(decision: Decision, policies: &[String], errors: usize) -> String {
    let mut text = match (decision, policies.is_empty()) {
        (Decision::Allow, _) => format!("permitted by {}", policies.join(", ")),
        (Decision::Deny, false) => format!("forbidden by {}", policies.join(", ")),
        (Decision::Deny, true) => "denied by default".to_string(),
    };
    if errors > 0 {
        let _ = write!(
            text,
            " ({errors} evaluation error{})",
            if errors == 1 { "" } else { "s" }
        );
    }
    text
}

/// 0 when the key is absent from the context, 1 when false, 2 when true.
fn setting(context: &serde_json::Map<String, serde_json::Value>, key: &str) -> u8 {
    match context.get(key) {
        None => 0,
        Some(serde_json::Value::Bool(false)) => 1,
        Some(_) => 2,
    }
}

/// Says in which contexts something holds, leaving out every key it does
/// not depend on: "mfa absent; mfa=false" rather than six assignments of
/// two keys. `contexts` is a subset of all assignments of `keys`.
fn describe_contexts(
    contexts: &[serde_json::Map<String, serde_json::Value>],
    keys: &[String],
) -> String {
    // A key does not matter when, for every context listed, the same
    // context with any other setting of that key is listed too.
    let matters = |key: &String| {
        contexts.iter().any(|context| {
            (0..3).any(|wanted| {
                !contexts.iter().any(|other| {
                    setting(other, key) == wanted
                        && keys
                            .iter()
                            .filter(|k| *k != key)
                            .all(|k| setting(other, k) == setting(context, k))
                })
            })
        })
    };
    let relevant: Vec<&String> = keys.iter().filter(|key| matters(key)).collect();
    let mut cases: Vec<Vec<u8>> = contexts
        .iter()
        .map(|context| relevant.iter().map(|key| setting(context, key)).collect())
        .collect();
    cases.sort();
    cases.dedup();
    cases
        .iter()
        .map(|case| {
            relevant
                .iter()
                .zip(case)
                .map(|(key, value)| match value {
                    0 => format!("{key} absent"),
                    1 => format!("{key}=false"),
                    _ => format!("{key}=true"),
                })
                .collect::<Vec<_>>()
                .join(", ")
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn percent(fraction: f64) -> String {
    format!("{:.1} %", fraction * 100.0)
}

impl Diff {
    /// True when anything is decided differently: a catalogued request, a
    /// scenario flow, a request of the access matrix, or the share of
    /// traffic denied at rest. A policy rewritten without changing a
    /// decision does not count.
    pub fn decisions_changed(&self) -> bool {
        (self.denied_at_rest.base - self.denied_at_rest.candidate).abs() > 1e-12
            || self
                .requests
                .changes
                .iter()
                .any(|change| change.kind == ChangeKind::Decision)
            || !self.flows.is_empty()
            || self.matrix.allow_to_deny + self.matrix.deny_to_allow > 0
    }

    /// The report `diff-workspace` prints.
    pub fn render(&self, base: &str, candidate: &str) -> String {
        let mut out = String::new();
        // Writing to a String cannot fail.
        let _ = self.write_report(&mut out, base, candidate);
        out
    }

    fn write_report(&self, out: &mut String, base: &str, candidate: &str) -> std::fmt::Result {
        writeln!(out, "base       {base}")?;
        writeln!(out, "candidate  {candidate}")?;

        writeln!(out, "\nPolicies")?;
        if self.policies.is_empty() {
            writeln!(out, "  no change")?;
        }
        for (label, ids) in [
            ("added  ", &self.policies.added),
            ("removed", &self.policies.removed),
            ("changed", &self.policies.changed),
        ] {
            for id in ids {
                writeln!(out, "  {label}  {id}")?;
            }
        }
        if self.entities_changed {
            writeln!(out, "  the entity store differs")?;
        }
        if self.catalog_changed {
            writeln!(out, "  the catalogue differs")?;
        }

        if !(self.topologies.is_empty() && self.scenarios.is_empty()) {
            writeln!(out, "\nPlatform")?;
            for (what, ids) in [
                ("topology", &self.topologies),
                ("scenario", &self.scenarios),
            ] {
                for id in &ids.added {
                    writeln!(out, "  added    {what} {id}")?;
                }
                for id in &ids.removed {
                    writeln!(out, "  removed  {what} {id}")?;
                }
            }
        }

        writeln!(out, "\nSimulated traffic")?;
        writeln!(
            out,
            "  denied at rest  {} -> {}",
            percent(self.denied_at_rest.base),
            percent(self.denied_at_rest.candidate)
        )?;
        let decided = self
            .requests
            .changes
            .iter()
            .filter(|change| change.kind == ChangeKind::Decision)
            .count();
        writeln!(
            out,
            "  {} catalogue requests compared, {decided} decided differently",
            self.requests.compared
        )?;
        for change in &self.requests.changes {
            let list = match change.list {
                RequestList::TrafficMix => "traffic mix",
                RequestList::ScenarioRequests => "scenario request",
            };
            let request = format!(
                "{} {} {}",
                change.request.principal, change.request.action, change.request.resource
            );
            match (&change.base, &change.candidate) {
                (Some(before), Some(after)) => {
                    writeln!(
                        out,
                        "  {} {} ({list})  {request}",
                        arrow(before.decision, after.decision),
                        change.id
                    )?;
                    writeln!(
                        out,
                        "                 was {}; now {}",
                        because(
                            before.decision,
                            &before.determining_policies,
                            before.errors.len()
                        ),
                        because(
                            after.decision,
                            &after.determining_policies,
                            after.errors.len()
                        )
                    )?;
                }
                (None, Some(after)) => writeln!(
                    out,
                    "  added          {} ({list})  {request}: {}",
                    change.id,
                    because(
                        after.decision,
                        &after.determining_policies,
                        after.errors.len()
                    )
                )?,
                (Some(_), None) => {
                    writeln!(out, "  removed        {} ({list})  {request}", change.id)?;
                }
                (None, None) => {}
            }
        }

        writeln!(out, "\nScenario flows")?;
        if self.flows.is_empty() && self.availability.is_empty() {
            writeln!(out, "  no change")?;
        }
        for flow in &self.flows {
            writeln!(
                out,
                "  {} / {} on {}: {} -> {}",
                flow.scenario,
                flow.label,
                flow.topology,
                flow.base.describe(),
                flow.candidate.describe()
            )?;
        }
        for change in &self.availability {
            let state = |reason: &Option<String>| match reason {
                Some(reason) => format!("cannot run ({reason})"),
                None => "can run".to_string(),
            };
            writeln!(
                out,
                "  {} on {}: {} -> {}",
                change.scenario,
                change.topology,
                state(&change.base),
                state(&change.candidate)
            )?;
        }

        let matrix = &self.matrix;
        writeln!(out, "\nAccess matrix")?;
        if let Some(note) = &matrix.note {
            writeln!(out, "  {note}")?;
        }
        if matrix.compared > 0 {
            writeln!(
                out,
                "  {} principals, {} actions, {} resources, {} context{}: {} requests compared",
                matrix.principals,
                matrix.actions,
                matrix.resources,
                matrix.contexts,
                if matrix.contexts == 1 { "" } else { "s" },
                matrix.compared
            )?;
            writeln!(
                out,
                "  {} allow -> deny, {} deny -> allow, {} decided the same for a different reason",
                matrix.allow_to_deny, matrix.deny_to_allow, matrix.attribution_only
            )?;
        }
        for change in matrix.changes.iter().take(REPORT_LINES) {
            let scope = if change.every_context {
                "in every context".to_string()
            } else {
                format!(
                    "with {}",
                    describe_contexts(&change.contexts, &matrix.context_keys)
                )
            };
            writeln!(
                out,
                "  {} {} {} {}  {scope}",
                arrow(change.base, change.candidate),
                change.principal,
                change.action,
                change.resource
            )?;
            writeln!(
                out,
                "                 was {}; now {}",
                because(change.base, &change.base_policies, 0),
                because(change.candidate, &change.candidate_policies, 0)
            )?;
        }
        if matrix.changes.len() > REPORT_LINES {
            writeln!(
                out,
                "  ... and {} more; --json lists them all",
                matrix.changes.len() - REPORT_LINES
            )?;
        }

        writeln!(
            out,
            "\n{}",
            if self.decisions_changed() {
                "Decisions differ."
            } else {
                "No decision differs."
            }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_matrix_drops_contexts_before_it_drops_requests() {
        // 84 principal, action and resource combinations, as bundled.
        assert_eq!(context_keys_within_limit(84, 2), Some(2));
        assert_eq!(context_keys_within_limit(84, 0), Some(0));
        // 3^6 contexts would be 61 236 requests: fall back to the empty one.
        assert_eq!(context_keys_within_limit(84, 6), Some(0));
        // A key count whose power overflows is the same case, not a panic.
        assert_eq!(context_keys_within_limit(84, 4_000), Some(0));
        assert_eq!(
            context_keys_within_limit(MATRIX_LIMIT, 1),
            Some(0),
            "exactly at the limit with no context"
        );
        assert_eq!(context_keys_within_limit(MATRIX_LIMIT + 1, 0), None);
    }

    #[test]
    fn contexts_enumerate_every_key_absent_false_and_true() {
        let keys = vec!["mfa".to_string(), "changeWindow".to_string()];
        let all: Vec<_> = (0..9).map(|index| context(&keys, index)).collect();
        assert!(all[0].is_empty(), "the first is the empty context");
        let mut distinct = all.clone();
        distinct.dedup();
        assert_eq!(distinct.len(), 9);
        assert!(all
            .iter()
            .any(|c| c.get("mfa") == Some(&true.into())
                && c.get("changeWindow") == Some(&false.into())));
    }

    #[test]
    fn contexts_are_described_by_the_keys_that_matter() {
        let keys = vec!["mfa".to_string(), "changeWindow".to_string()];
        let all: Vec<_> = (0..9).map(|index| context(&keys, index)).collect();
        // Whatever changeWindow is, as long as mfa is not true.
        let without_mfa: Vec<_> = all
            .iter()
            .filter(|c| c.get("mfa") != Some(&true.into()))
            .cloned()
            .collect();
        assert_eq!(without_mfa.len(), 6);
        assert_eq!(
            describe_contexts(&without_mfa, &keys),
            "mfa absent; mfa=false"
        );
        // One exact context depends on both keys.
        let one: Vec<_> = all
            .iter()
            .filter(|c| c.get("mfa") == Some(&true.into()) && !c.contains_key("changeWindow"))
            .cloned()
            .collect();
        assert_eq!(one.len(), 1);
        assert_eq!(
            describe_contexts(&one, &keys),
            "mfa=true, changeWindow absent"
        );
    }

    #[test]
    fn a_decision_is_explained_by_the_policies_cedar_named() {
        let named = ["a".to_string(), "b".to_string()];
        assert_eq!(because(Decision::Allow, &named, 0), "permitted by a, b");
        assert_eq!(because(Decision::Deny, &named[..1], 0), "forbidden by a");
        assert_eq!(
            because(Decision::Deny, &[], 2),
            "denied by default (2 evaluation errors)"
        );
    }
}

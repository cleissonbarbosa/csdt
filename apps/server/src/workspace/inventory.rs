//! A cloud inventory read as a topology.
//!
//! An inventory is a file a script of the operator's writes from what a
//! cloud provider lists of an account: its resources, and the connections
//! the provider itself states between them (a balancer's targets, a
//! function's event source, a rule that admits one group to another). That
//! is the shape of a topology, and it is taken from the file as it stands,
//! narrowed by the selection the file carries.
//!
//! What an inventory does not say is how much traffic there is, how it is
//! shared, or how slow anything is, and a topology has to: every such figure
//! here is a default of this converter, named in the topology's own
//! description, and none is a measurement. Nor does it say who calls whom
//! where no resource of the provider's stands between them: a connection is
//! drawn only from a statement the file holds, and the description says of
//! which kind. The result is `synthetic` like every topology a workspace
//! holds.
//!
//! Nothing is fetched and no cloud is asked anything: the file is text, and
//! so is the topology that comes out of it.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::compose::{default_latency_ms, id_of, link, DEFAULT_CLIENT_RPS};
use crate::domain::{
    is_valid_id, DataSource, EdgeSpec, NodeSpec, Protocol, Region, RegionKind, Relationship,
    ServiceType, TopologySpec, MAX_EDGES, MAX_ID_LEN, MAX_NODES,
};

/// What the `kind` of an inventory file says.
pub const KIND: &str = "aegis-cloud-inventory";
/// The version of the format this reads.
pub const VERSION: u32 = 1;

/// Most resources a file may list. More than a topology holds, so that a
/// selection has something to narrow.
pub const MAX_RESOURCES: usize = 10_000;
/// Most relations a file may list.
pub const MAX_RELATIONS: usize = 50_000;
/// Longest name, native type, network or evidence, in characters.
pub const MAX_TEXT_LEN: usize = 256;
/// Most tags on one resource, and how long a key and a value may be.
pub const MAX_TAGS: usize = 64;
pub const MAX_TAG_KEY_LEN: usize = 128;
pub const MAX_TAG_VALUE_LEN: usize = 256;
/// Most notes a file may carry, and how long one may be.
pub const MAX_NOTES: usize = 40;
pub const MAX_NOTE_LEN: usize = 1280;

/// Most regions or networks a survey lists to choose from.
const MAX_FACET_VALUES: usize = 200;
/// Most tag keys a survey lists, and most values under one key.
const MAX_TAG_KEYS_LISTED: usize = 100;
const MAX_TAG_VALUES_LISTED: usize = 50;
/// Most resources a survey names one by one.
const MAX_LISTED: usize = MAX_NODES;
/// Most connections left out for running in a circle that are named.
const MAX_CIRCULAR_NAMED: usize = 8;

/// The stand-in for whoever uses the platform, as in a Compose file.
const CLIENT_ID: &str = "clients";
/// The stand-in a scenario sends hostile traffic through. Idle at rest.
const UNKNOWN_ID: &str = "unknown-sources";
/// Where a provider's resources that are in no region stand, and with them
/// the two stand-ins: the edge.
const EDGE_REGION: &str = "global";
/// How many nodes a topology read from an inventory adds of its own.
const STAND_INS: usize = 2;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Aws,
    Gcp,
    Oci,
}

impl Provider {
    /// The provider's name, as it is written in a description.
    fn label(self) -> &'static str {
        match self {
            Self::Aws => "AWS",
            Self::Gcp => "Google Cloud",
            Self::Oci => "Oracle Cloud",
        }
    }
}

/// What states a relation. In this order when two statements name the same
/// pair of resources: the first is how the connection is read.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum Basis {
    /// The provider sends requests from one to the other: a balancer's
    /// target, a distribution's origin, an API's integration.
    Routing,
    /// The provider delivers from one to the other when something happens:
    /// a queue a function reads, a topic's subscription.
    Event,
    /// The resource's own configuration names the other, or the operator
    /// declared it when the file was written.
    Declared,
    /// A network rule admits one to the other. A permission to reach, not a
    /// call that was seen.
    Network,
}

impl Basis {
    const ALL: [Self; 4] = [Self::Routing, Self::Event, Self::Declared, Self::Network];

    /// How many relations of this basis are called, in a description.
    fn counted(self, count: usize) -> String {
        let (one, many) = match self {
            Self::Routing => ("route", "routes"),
            Self::Event => ("event delivery", "event deliveries"),
            Self::Declared => ("declared connection", "declared connections"),
            Self::Network => ("network rule", "network rules"),
        };
        format!("{count} {}", if count == 1 { one } else { many })
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// One thing the account holds that is drawn as a piece.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resource {
    /// The id its node takes. The collector makes it from the name; it is
    /// never the provider's own identifier, which can name the account.
    #[schemars(length(min = 1, max = MAX_ID_LEN), regex(pattern = "^[A-Za-z0-9_.-]+$"))]
    pub id: String,
    /// Shown as written.
    #[schemars(length(min = 1, max = MAX_TEXT_LEN))]
    pub name: String,
    /// Which of the kinds of service it is drawn as. Never `external-client`:
    /// a file lists what the account holds, not who uses it.
    #[serde(rename = "type")]
    pub service_type: ServiceType,
    /// What the provider calls it, such as `AWS::RDS::DBCluster`.
    #[schemars(length(min = 1, max = MAX_TEXT_LEN))]
    pub native: String,
    /// The provider's region, or `global` for what is in none.
    #[schemars(length(min = 1, max = MAX_ID_LEN), regex(pattern = "^[A-Za-z0-9_.-]+$"))]
    pub region: String,
    /// The network it is placed in (a VPC, a VCN), where it is in one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = MAX_TEXT_LEN))]
    pub network: Option<String>,
    /// Its tags or labels, as the provider holds them. Used to select;
    /// never copied into the topology.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tags: BTreeMap<String, String>,
    /// Whether the provider states it as reachable from outside.
    #[serde(default, skip_serializing_if = "is_false")]
    pub public: bool,
    /// How many of them the one piece stands for: the instances of a group,
    /// the tasks of a service.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1))]
    pub members: Option<u32>,
}

/// A connection the file states between two of its resources.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Relation {
    pub from: String,
    pub to: String,
    pub basis: Basis,
    /// What states it, in the collector's words: `target group checkout`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[schemars(length(max = MAX_TEXT_LEN))]
    pub evidence: String,
}

/// Two resources, in the direction a connection runs.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Pair {
    pub from: String,
    pub to: String,
}

/// A tag a resource must carry: the key, with one of the values. With no
/// value named, the key alone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TagFilter {
    pub key: String,
    #[serde(default)]
    pub values: Vec<String>,
}

/// Which part of an inventory is brought. Each thing left unsaid asks for
/// everything; everything said must hold.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    /// Only resources in these regions.
    #[serde(default)]
    pub regions: Option<Vec<String>>,
    /// Only resources in these networks; `null` among them stands for the
    /// resources that are in none.
    #[serde(default)]
    pub networks: Option<Vec<Option<String>>>,
    /// Only resources of these kinds.
    #[serde(default)]
    pub kinds: Option<Vec<ServiceType>>,
    /// Only resources that carry every one of these tags.
    #[serde(default)]
    pub tags: Vec<TagFilter>,
    /// Only resources whose name has this in it, whatever the case.
    #[serde(default)]
    pub name: Option<String>,
    /// Only connections stated in these ways.
    #[serde(default)]
    pub bases: Option<Vec<Basis>>,
    /// Also what leads to the resources chosen above and what they lead to.
    #[serde(default)]
    pub along_paths: bool,
    /// Leave out what no connection touches. A security monitor stays: it
    /// watches, and nothing calls it.
    #[serde(default)]
    pub connected_only: bool,
    /// Resources left out by hand, by id.
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Connections left out by hand.
    #[serde(default)]
    pub without: Vec<Pair>,
}

/// The file an inventory collector writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inventory {
    #[schemars(extend("enum" = ["aegis-cloud-inventory"]))]
    pub kind: String,
    #[schemars(range(min = 1, max = 1))]
    pub version: u32,
    pub provider: Provider,
    /// The platform's name, and with it its id. Chosen by the operator: it
    /// need not be the account's.
    #[schemars(length(min = 1, max = MAX_ID_LEN))]
    pub name: String,
    /// When it was read, as the collector wrote it. Shown as written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(max = 64))]
    pub collected_at: Option<String>,
    #[schemars(length(min = 1, max = MAX_RESOURCES))]
    pub resources: Vec<Resource>,
    #[serde(default)]
    #[schemars(length(max = MAX_RELATIONS))]
    pub relations: Vec<Relation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<Selection>,
    /// What the collector could not read or left out, shown as written.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = MAX_NOTES))]
    pub notes: Vec<String>,
}

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

/// Whether a file of JSON says it is an inventory. Nothing else of it is
/// looked at: what is wrong with one is said when it is read.
pub fn is_inventory(text: &str) -> bool {
    #[derive(Deserialize)]
    struct Probe {
        #[serde(default)]
        kind: Option<serde_json::Value>,
    }
    serde_json::from_str::<Probe>(text)
        .is_ok_and(|probe| probe.kind.as_ref().and_then(|kind| kind.as_str()) == Some(KIND))
}

fn too_long(text: &str, most: usize) -> bool {
    text.chars().count() > most
}

/// A file parsed and held to everything that can be said of it alone.
struct Checked {
    inventory: Inventory,
    index: BTreeMap<String, usize>,
}

fn check(text: &str) -> Result<Checked, String> {
    let inventory: Inventory = serde_json::from_str(text).map_err(|error| error.to_string())?;
    if inventory.kind != KIND {
        return Err(format!(
            "is not a cloud inventory: its `kind` is `{}`, not `{KIND}`",
            inventory.kind
        ));
    }
    if inventory.version != VERSION {
        return Err(format!(
            "is version {} of the inventory format; this server reads version {VERSION}",
            inventory.version
        ));
    }
    if inventory.name.trim().is_empty() || too_long(&inventory.name, MAX_ID_LEN) {
        return Err(format!(
            "has a name that is not 1 to {MAX_ID_LEN} characters"
        ));
    }
    if inventory.resources.is_empty() {
        return Err("lists no resource".into());
    }
    if inventory.resources.len() > MAX_RESOURCES {
        return Err(format!(
            "lists {} resources; at most {MAX_RESOURCES} are read",
            inventory.resources.len()
        ));
    }
    if inventory.relations.len() > MAX_RELATIONS {
        return Err(format!(
            "lists {} relations; at most {MAX_RELATIONS} are read",
            inventory.relations.len()
        ));
    }
    if inventory
        .collected_at
        .as_deref()
        .is_some_and(|at| too_long(at, 64))
    {
        return Err("has a `collectedAt` longer than 64 characters".into());
    }
    if inventory.notes.len() > MAX_NOTES
        || inventory
            .notes
            .iter()
            .any(|note| too_long(note, MAX_NOTE_LEN))
    {
        return Err(format!(
            "has more than {MAX_NOTES} notes, or one longer than {MAX_NOTE_LEN} characters"
        ));
    }

    let mut index = BTreeMap::new();
    for (i, resource) in inventory.resources.iter().enumerate() {
        let id = &resource.id;
        if !is_valid_id(id) {
            return Err(format!(
                "has a resource whose id `{id}` is not 1 to {MAX_ID_LEN} letters, digits, `.`, `_` or `-`"
            ));
        }
        if id == CLIENT_ID || id == UNKNOWN_ID {
            return Err(format!(
                "has a resource with the id `{id}`, which stands for whoever is outside the platform"
            ));
        }
        if resource.service_type.is_client() {
            return Err(format!(
                "lists `{id}` as an external-client: a file lists what the account holds, not who uses it"
            ));
        }
        if index.insert(id.clone(), i).is_some() {
            return Err(format!("has two resources with the id `{id}`"));
        }
        if !is_valid_id(&resource.region) {
            return Err(format!(
                "places `{id}` in a region whose id `{}` is not 1 to {MAX_ID_LEN} letters, digits, `.`, `_` or `-`",
                resource.region
            ));
        }
        let texts = [
            Some(resource.name.as_str()),
            Some(resource.native.as_str()),
            resource.network.as_deref(),
        ];
        if texts
            .into_iter()
            .flatten()
            .any(|text| text.is_empty() || too_long(text, MAX_TEXT_LEN))
        {
            return Err(format!(
                "gives `{id}` a name, native type or network that is not 1 to {MAX_TEXT_LEN} characters"
            ));
        }
        if resource.tags.len() > MAX_TAGS
            || resource.tags.iter().any(|(key, value)| {
                key.is_empty()
                    || too_long(key, MAX_TAG_KEY_LEN)
                    || too_long(value, MAX_TAG_VALUE_LEN)
            })
        {
            return Err(format!(
                "gives `{id}` more than {MAX_TAGS} tags, or one with a key longer than {MAX_TAG_KEY_LEN} characters or a value longer than {MAX_TAG_VALUE_LEN}"
            ));
        }
        if resource.members == Some(0) {
            return Err(format!("says `{id}` stands for no member at all"));
        }
    }
    for relation in &inventory.relations {
        let Relation { from, to, .. } = relation;
        for end in [from, to] {
            if !index.contains_key(end) {
                return Err(format!(
                    "has a relation from `{from}` to `{to}`, and does not list `{end}`"
                ));
            }
        }
        if from == to {
            return Err(format!("has a relation from `{from}` to itself"));
        }
        if too_long(&relation.evidence, MAX_TEXT_LEN) {
            return Err(format!(
                "has a relation from `{from}` to `{to}` whose evidence is longer than {MAX_TEXT_LEN} characters"
            ));
        }
    }
    if let Some(selection) = &inventory.selection {
        for id in &selection.exclude {
            if !index.contains_key(id) {
                return Err(format!(
                    "has a selection that leaves out `{id}`, which the file does not list"
                ));
            }
        }
        for Pair { from, to } in &selection.without {
            for end in [from, to] {
                if !index.contains_key(end) {
                    return Err(format!(
                        "has a selection that leaves out a connection from `{from}` to `{to}`, and does not list `{end}`"
                    ));
                }
            }
        }
    }
    Ok(Checked { inventory, index })
}

// ---------------------------------------------------------------------------
// What a selection brings
// ---------------------------------------------------------------------------

/// A connection to draw, between two resources by their place in the file.
#[derive(Debug, Clone, Copy)]
struct Drawn {
    from: usize,
    to: usize,
    basis: Basis,
    /// Where the file first states it, which is the order it is drawn in.
    at: usize,
}

/// What of a file its selection brings, and what it leaves and why.
#[derive(Debug, Default)]
struct Chosen {
    /// For each resource, whether it is in the topology.
    kept: Vec<bool>,
    /// For each resource, whether it was chosen and then left out by hand.
    excluded: Vec<bool>,
    unselected: usize,
    unconnected: usize,
    /// The connections drawn, in the order the file states them.
    drawn: Vec<Drawn>,
    /// Stated by a basis the selection does not ask for.
    undrawn: BTreeMap<Basis, usize>,
    /// Left out so that calls run one way.
    circular: Vec<Pair>,
    /// Where clients enter, and whether the file states them as public.
    entries: Vec<usize>,
    entries_are_public: bool,
    /// Why this is no topology, when it is not.
    problem: Option<String>,
}

impl Chosen {
    fn count(&self) -> usize {
        self.kept.iter().filter(|kept| **kept).count()
    }
}

fn matches(resource: &Resource, selection: &Selection) -> bool {
    let in_list = |list: &Option<Vec<String>>, value: &str| {
        list.as_ref()
            .is_none_or(|list| list.iter().any(|item| item == value))
    };
    in_list(&selection.regions, &resource.region)
        && selection
            .networks
            .as_ref()
            .is_none_or(|networks| networks.contains(&resource.network))
        && selection
            .kinds
            .as_ref()
            .is_none_or(|kinds| kinds.contains(&resource.service_type))
        && selection.tags.iter().all(|filter| {
            resource.tags.get(&filter.key).is_some_and(|value| {
                filter.values.is_empty() || filter.values.iter().any(|wanted| wanted == value)
            })
        })
        && selection.name.as_ref().is_none_or(|wanted| {
            resource
                .name
                .to_lowercase()
                .contains(&wanted.to_lowercase())
        })
}

/// Everything reachable from `seeds` along `next`, the seeds included.
fn reach(seeds: &[bool], next: &[Vec<usize>], blocked: &[bool]) -> Vec<bool> {
    let mut seen = seeds.to_vec();
    let mut stack: Vec<usize> = (0..seeds.len()).filter(|i| seeds[*i]).collect();
    while let Some(node) = stack.pop() {
        for &other in &next[node] {
            if !seen[other] && !blocked[other] {
                seen[other] = true;
                stack.push(other);
            }
        }
    }
    seen
}

/// Whether `from` already leads to `to` along the connections accepted so
/// far. `stamp` marks what one question has visited without clearing it.
fn leads(from: usize, to: usize, out: &[Vec<usize>], seen: &mut [u32], stamp: u32) -> bool {
    let mut stack = vec![from];
    seen[from] = stamp;
    while let Some(node) = stack.pop() {
        if node == to {
            return true;
        }
        for &other in &out[node] {
            if seen[other] != stamp {
                seen[other] = stamp;
                stack.push(other);
            }
        }
    }
    false
}

fn choose(checked: &Checked) -> Chosen {
    let Checked { inventory, index } = checked;
    let default = Selection::default();
    let selection = inventory.selection.as_ref().unwrap_or(&default);
    let resources = &inventory.resources;
    let n = resources.len();
    let at = |id: &String| index[id];

    let by_hand: Vec<bool> = {
        let ids: BTreeSet<&String> = selection.exclude.iter().collect();
        resources
            .iter()
            .map(|resource| ids.contains(&resource.id))
            .collect()
    };
    let without: BTreeSet<(usize, usize)> = selection
        .without
        .iter()
        .map(|pair| (at(&pair.from), at(&pair.to)))
        .collect();
    let asked = |basis: Basis| {
        selection
            .bases
            .as_ref()
            .is_none_or(|bases| bases.contains(&basis))
    };

    // What the filters choose, then what lies on a path through it. A
    // resource left out by hand is not walked through: it is not there.
    let chosen: Vec<bool> = resources
        .iter()
        .map(|resource| matches(resource, selection))
        .collect();
    let selected = if selection.along_paths {
        let mut forward = vec![Vec::new(); n];
        let mut backward = vec![Vec::new(); n];
        for relation in &inventory.relations {
            let (from, to) = (at(&relation.from), at(&relation.to));
            if asked(relation.basis) && !without.contains(&(from, to)) {
                forward[from].push(to);
                backward[to].push(from);
            }
        }
        let seeds: Vec<bool> = (0..n).map(|i| chosen[i] && !by_hand[i]).collect();
        let down = reach(&seeds, &forward, &by_hand);
        let up = reach(&seeds, &backward, &by_hand);
        (0..n).map(|i| chosen[i] || down[i] || up[i]).collect()
    } else {
        chosen
    };
    let excluded: Vec<bool> = (0..n).map(|i| selected[i] && by_hand[i]).collect();
    let present: Vec<bool> = (0..n).map(|i| selected[i] && !by_hand[i]).collect();

    // The connections between what is there: one for each pair, read as the
    // strongest statement of it says.
    let mut undrawn: BTreeMap<Basis, usize> = BTreeMap::new();
    let mut pairs: BTreeMap<(usize, usize), Drawn> = BTreeMap::new();
    for (i, relation) in inventory.relations.iter().enumerate() {
        let (from, to) = (at(&relation.from), at(&relation.to));
        if !present[from] || !present[to] || without.contains(&(from, to)) {
            continue;
        }
        if !asked(relation.basis) {
            *undrawn.entry(relation.basis).or_default() += 1;
            continue;
        }
        pairs
            .entry((from, to))
            .and_modify(|drawn| drawn.basis = drawn.basis.min(relation.basis))
            .or_insert(Drawn {
                from,
                to,
                basis: relation.basis,
                at: i,
            });
    }
    let mut candidates: Vec<Drawn> = pairs.into_values().collect();

    let mut touched = vec![false; n];
    for drawn in &candidates {
        touched[drawn.from] = true;
        touched[drawn.to] = true;
    }
    let kept: Vec<bool> = (0..n)
        .map(|i| {
            present[i]
                && (!selection.connected_only
                    || touched[i]
                    || resources[i].service_type == ServiceType::SecurityMonitor)
        })
        .collect();
    let mut result = Chosen {
        unselected: selected.iter().filter(|selected| !**selected).count(),
        unconnected: (0..n).filter(|i| present[*i] && !kept[*i]).count(),
        kept,
        excluded,
        undrawn,
        ..Chosen::default()
    };

    let count = result.count();
    let most = MAX_NODES - STAND_INS;
    if count == 0 {
        result.problem = Some(if inventory.selection.is_some() {
            "has a selection that leaves no resource".to_string()
        } else {
            "lists no resource".to_string()
        });
    } else if count > most {
        result.problem = Some(format!(
            "selects {count} resources; a topology holds at most {most} besides its two stand-ins. Narrow the selection: to a region, a network, a tag or a kind, or to what is connected"
        ));
    } else if candidates.len() > MAX_EDGES {
        result.problem = Some(format!(
            "selects {} connections; a topology holds at most {MAX_EDGES}. Narrow the selection",
            candidates.len()
        ));
    }
    if result.problem.is_some() {
        candidates.sort_by_key(|drawn| drawn.at);
        result.drawn = candidates;
        return result;
    }

    // A topology is followed one way. Take the connections strongest first,
    // in the file's order, and leave out each that would close a circle.
    candidates.sort_by_key(|drawn| (drawn.basis, drawn.at));
    let mut out = vec![Vec::new(); n];
    let mut seen = vec![0u32; n];
    let mut stamp = 0u32;
    let mut drawn = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        stamp += 1;
        if leads(candidate.to, candidate.from, &out, &mut seen, stamp) {
            result.circular.push(Pair {
                from: resources[candidate.from].id.clone(),
                to: resources[candidate.to].id.clone(),
            });
        } else {
            out[candidate.from].push(candidate.to);
            drawn.push(candidate);
        }
    }
    drawn.sort_by_key(|drawn| drawn.at);

    // Who is reached from outside: what the provider states as public and
    // no other public resource routes to; or, when it states none, what
    // leads somewhere and nothing leads to.
    let mut led_to = vec![false; n];
    let mut leads_on = vec![false; n];
    let mut behind_public = vec![false; n];
    for connection in &drawn {
        led_to[connection.to] = true;
        leads_on[connection.from] = true;
        if connection.basis == Basis::Routing && resources[connection.from].public {
            behind_public[connection.to] = true;
        }
    }
    let kept_where = |test: &dyn Fn(usize) -> bool| -> Vec<usize> {
        (0..n).filter(|i| result.kept[*i] && test(*i)).collect()
    };
    let monitor = |i: usize| resources[i].service_type == ServiceType::SecurityMonitor;
    let mut entries = kept_where(&|i| resources[i].public && !behind_public[i]);
    let entries_are_public = !entries.is_empty();
    if entries.is_empty() {
        entries = kept_where(&|i| !led_to[i] && leads_on[i] && !monitor(i));
    }
    if entries.is_empty() {
        entries = kept_where(&|i| !led_to[i] && !monitor(i));
    }
    if entries.is_empty() {
        entries = kept_where(&|i| !led_to[i]);
    }
    // The two stand-ins each reach every entry: those connections count too.
    let connections = drawn.len() + STAND_INS * entries.len();
    if connections > MAX_EDGES {
        result.problem = Some(format!(
            "draws {connections} connections; a topology holds at most {MAX_EDGES}. Narrow the selection"
        ));
    }
    result.entries_are_public = entries_are_public;
    result.entries = entries;
    result.drawn = drawn;
    result
}

// ---------------------------------------------------------------------------
// The topology
// ---------------------------------------------------------------------------

/// How a connection is drawn, by what states it and what it leads to.
fn drawn_as(basis: Basis, source: ServiceType, target: ServiceType) -> (Protocol, Relationship) {
    match basis {
        Basis::Routing => (Protocol::Https, Relationship::Route),
        Basis::Event if target.is_queue() => (Protocol::Amqp, Relationship::Publish),
        Basis::Event if source.is_queue() => (Protocol::Amqp, Relationship::Consume),
        Basis::Event => (Protocol::Https, Relationship::Consume),
        Basis::Declared | Basis::Network => link(target),
    }
}

/// `a, b and c`.
fn listed(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [one] => one.clone(),
        [most @ .., last] => format!("{} and {last}", most.join(", ")),
    }
}

fn describe(file: &str, inventory: &Inventory, chosen: &Chosen) -> String {
    let provider = inventory.provider.label();
    let mut text = format!(
        "Read from {file}, an inventory of {provider}: {} of its {} resources.",
        chosen.count(),
        inventory.resources.len()
    );
    let excluded = chosen.excluded.iter().filter(|excluded| **excluded).count();
    let left: Vec<String> = [
        (chosen.unselected, "that the selection does not ask for"),
        (excluded, "left out by hand"),
        (chosen.unconnected, "that no connection touches"),
    ]
    .into_iter()
    .filter(|(count, _)| *count > 0)
    .map(|(count, why)| format!("{count} {why}"))
    .collect();
    if !left.is_empty() {
        text.push_str(&format!(" Not brought: {}.", listed(&left)));
    }

    let mut by_basis: BTreeMap<Basis, usize> = BTreeMap::new();
    for drawn in &chosen.drawn {
        *by_basis.entry(drawn.basis).or_default() += 1;
    }
    let counted = |counts: &BTreeMap<Basis, usize>| -> Vec<String> {
        counts
            .iter()
            .map(|(basis, count)| basis.counted(*count))
            .collect()
    };
    if by_basis.is_empty() {
        text.push_str(" It draws no connection: the file states none between them.");
    } else {
        text.push_str(&format!(
            " Its connections are what the file states: {}.",
            listed(&counted(&by_basis))
        ));
    }
    if by_basis.contains_key(&Basis::Network) {
        text.push_str(" A network rule is a permission to reach, not a call that was seen.");
    }
    if !chosen.undrawn.is_empty() {
        text.push_str(&format!(
            " Not drawn, by the selection: {}.",
            listed(&counted(&chosen.undrawn))
        ));
    }
    if !chosen.circular.is_empty() {
        let mut named: Vec<String> = chosen
            .circular
            .iter()
            .take(MAX_CIRCULAR_NAMED)
            .map(|pair| format!("{} to {}", pair.from, pair.to))
            .collect();
        let more = chosen.circular.len().saturating_sub(MAX_CIRCULAR_NAMED);
        if more > 0 {
            named.push(format!("{more} more"));
        }
        text.push_str(&format!(
            " Left out so that calls run one way: {}.",
            listed(&named)
        ));
    }

    text.push_str(if chosen.entries_are_public {
        " Clients enter at what the provider states as public and no other public resource routes to."
    } else {
        " The file states none as public, so clients enter at what leads somewhere and nothing leads to."
    });
    text.push_str(&format!(
        " An inventory says nothing of traffic or speed: the {DEFAULT_CLIENT_RPS:.0} requests a second, \
         shared evenly between the entries, the even share of what each router sends on, and every \
         latency here are defaults of the converter, not measurements. It states no capacity either: \
         each service has the model's default headroom over its load at rest."
    ));
    text
}

fn stand_in(id: &str, name: &str, description: &str, base_rps: f64) -> NodeSpec {
    NodeSpec {
        id: id.to_string(),
        name: name.to_string(),
        service_type: ServiceType::ExternalClient,
        region: EDGE_REGION.to_string(),
        tier: 0,
        description: description.to_string(),
        environment: Default::default(),
        base_latency_ms: 0.0,
        capacity_rps: None,
        headroom: None,
        base_rps: Some(base_rps),
        rate_limit_rps: None,
        suspicious_filter: None,
        autoscale: None,
    }
}

fn build(file: &str, inventory: &Inventory, chosen: &Chosen) -> TopologySpec {
    let resources = &inventory.resources;
    let n = resources.len();
    let kind = |i: usize| resources[i].service_type;

    // How far each resource is from the outside: the longest way to it. The
    // connections run one way, so every resource is settled once those that
    // lead to it are.
    let mut waiting = vec![0usize; n];
    let mut out: Vec<Vec<usize>> = vec![Vec::new(); n];
    for drawn in &chosen.drawn {
        waiting[drawn.to] += 1;
        out[drawn.from].push(drawn.to);
    }
    let mut tier = vec![1u8; n];
    let mut ready: Vec<usize> = (0..n)
        .filter(|i| chosen.kept[*i] && waiting[*i] == 0)
        .collect();
    while let Some(node) = ready.pop() {
        for &next in &out[node] {
            tier[next] = tier[next].max(tier[node].saturating_add(1));
            waiting[next] -= 1;
            if waiting[next] == 0 {
                ready.push(next);
            }
        }
    }

    let mut nodes = vec![
        stand_in(
            CLIENT_ID,
            "Clients",
            "Whoever uses the platform. The file does not say who; this stands in for them.",
            DEFAULT_CLIENT_RPS,
        ),
        stand_in(
            UNKNOWN_ID,
            "Unattributed sources",
            "Traffic nobody asked for. The file names no such source; this stands in for one, and sends nothing until a scenario does.",
            0.0,
        ),
    ];
    for (i, resource) in resources.iter().enumerate() {
        if !chosen.kept[i] {
            continue;
        }
        let mut description = format!("{}.", resource.native);
        match resource.members {
            Some(1) => description.push_str(" Stands for 1 member."),
            Some(members) => description.push_str(&format!(" Stands for {members} members.")),
            None => {}
        }
        if resource.public {
            description.push_str(" The provider states it as public.");
        }
        nodes.push(NodeSpec {
            id: resource.id.clone(),
            name: resource.name.clone(),
            service_type: resource.service_type,
            region: resource.region.clone(),
            tier: tier[i],
            description,
            environment: Default::default(),
            base_latency_ms: default_latency_ms(resource.service_type),
            capacity_rps: None,
            headroom: None,
            base_rps: None,
            rate_limit_rps: None,
            suspicious_filter: None,
            autoscale: None,
        });
    }

    let mut edges = Vec::with_capacity(chosen.drawn.len() + STAND_INS * chosen.entries.len());
    let share = 1.0 / chosen.entries.len().max(1) as f64;
    for source in [CLIENT_ID, UNKNOWN_ID] {
        for &entry in &chosen.entries {
            edges.push(EdgeSpec {
                source: source.to_string(),
                target: resources[entry].id.clone(),
                protocol: Protocol::Https,
                relationship: Relationship::Route,
                weight: share,
                criticality: None,
                latency_ms: None,
            });
        }
    }
    let mut routes = vec![0usize; n];
    for drawn in &chosen.drawn {
        if drawn.basis == Basis::Routing {
            routes[drawn.from] += 1;
        }
    }
    for drawn in &chosen.drawn {
        let (protocol, relationship) = drawn_as(drawn.basis, kind(drawn.from), kind(drawn.to));
        edges.push(EdgeSpec {
            source: resources[drawn.from].id.clone(),
            target: resources[drawn.to].id.clone(),
            protocol,
            relationship,
            weight: if drawn.basis == Basis::Routing {
                1.0 / routes[drawn.from] as f64
            } else {
                1.0
            },
            criticality: None,
            latency_ms: None,
        });
    }

    // Where each stands. The edge comes first: the stand-ins are there.
    let provider = inventory.provider.label();
    let mut regions = vec![Region {
        id: EDGE_REGION.to_string(),
        name: format!("{provider} edge"),
        kind: RegionKind::Edge,
        location: "In no region".to_string(),
    }];
    for (i, resource) in resources.iter().enumerate() {
        if chosen.kept[i] && !regions.iter().any(|region| region.id == resource.region) {
            regions.push(Region {
                id: resource.region.clone(),
                name: resource.region.clone(),
                kind: RegionKind::Cloud,
                location: provider.to_string(),
            });
        }
    }

    // The anchors scenarios look for, where the file has something to be one.
    let first = |test: &dyn Fn(usize) -> bool| -> Option<usize> {
        (0..n).find(|i| chosen.kept[*i] && test(*i))
    };
    let first_of = |wanted: ServiceType| first(&|i| kind(i) == wanted);
    let router =
        first(&|i| kind(i) == ServiceType::NetworkGateway && resources[i].region == EDGE_REGION)
            .or_else(|| {
                first(&|i| kind(i) == ServiceType::NetworkGateway && chosen.entries.contains(&i))
            });
    // The gateway a flood through the edge would meet, where there is one:
    // an API gateway or a load balancer the edge routes to.
    let gateway = router
        .and_then(|router| {
            chosen
                .drawn
                .iter()
                .filter(|drawn| drawn.from == router && drawn.basis == Basis::Routing)
                .map(|drawn| drawn.to)
                .find(|to| kind(*to).is_gateway())
        })
        .or_else(|| first_of(ServiceType::ApiGateway))
        .or_else(|| first_of(ServiceType::LoadBalancer));
    let mut roles = BTreeMap::new();
    roles.insert("partnerClient".to_string(), CLIENT_ID.to_string());
    roles.insert("attackSource".to_string(), UNKNOWN_ID.to_string());
    for (role, node) in [
        ("edgeRouter", router),
        ("primaryGateway", gateway),
        ("primaryAuth", first_of(ServiceType::AuthService)),
        ("primaryAuthorizer", first_of(ServiceType::CedarAuthorizer)),
        ("primaryDatabase", first_of(ServiceType::Database)),
        ("securityMonitor", first_of(ServiceType::SecurityMonitor)),
    ] {
        if let Some(node) = node {
            roles.insert(role.to_string(), resources[node].id.clone());
        }
    }
    // Two regions with a gateway each (an API gateway or a load balancer)
    // are what an outage needs to fail over.
    let with_gateway: Vec<&String> = regions
        .iter()
        .filter(|region| region.kind == RegionKind::Cloud)
        .map(|region| &region.id)
        .filter(|region| {
            first(&|i| kind(i).is_gateway() && resources[i].region == **region).is_some()
        })
        .collect();
    if let [outage, failover, ..] = with_gateway.as_slice() {
        roles.insert("outageRegion".to_string(), (*outage).clone());
        roles.insert("failoverRegion".to_string(), (*failover).clone());
    }

    TopologySpec {
        id: id_of(&inventory.name),
        name: inventory.name.clone(),
        description: describe(file, inventory, chosen),
        data_source: DataSource::Synthetic,
        regions,
        roles,
        nodes,
        edges,
    }
}

/// Reads an inventory as a topology. `file` is its name, for the
/// description.
pub fn topology_from_inventory(file: &str, text: &str) -> Result<TopologySpec, String> {
    let checked = check(text)?;
    let chosen = choose(&checked);
    if let Some(problem) = chosen.problem {
        return Err(problem);
    }
    Ok(build(file, &checked.inventory, &chosen))
}

// ---------------------------------------------------------------------------
// The survey
// ---------------------------------------------------------------------------

/// One thing a selection can ask for, with how many resources have it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Facet<T> {
    pub value: T,
    pub count: usize,
}

/// A tag key, with how many resources carry it and the values they give it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TagFacet {
    pub key: String,
    pub count: usize,
    pub values: Vec<Facet<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Kept {
    pub resources: usize,
    pub relations: usize,
    /// How many resources clients enter at.
    pub entries: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LeftOut {
    /// Resources the selection does not ask for.
    pub unselected: usize,
    /// Resources it asks for that were left out by hand.
    pub excluded: usize,
    /// Resources it asks for that no connection touches.
    pub unconnected: usize,
    /// Connections left out so that calls run one way.
    pub circular: Vec<Pair>,
}

/// A resource named in a survey: one that is brought, or one left out by
/// hand, which can be brought back.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Listed {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub service_type: ServiceType,
    pub region: String,
    pub kept: bool,
}

/// What an inventory holds to choose from, and what its selection brings.
/// It is the same reading the topology is made from, and decides nothing
/// the topology does not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Survey {
    /// The file it is of, as it was named.
    pub path: String,
    pub provider: Provider,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collected_at: Option<String>,
    /// How many resources and relations the file lists, whatever is selected.
    pub resources: usize,
    pub relations: usize,
    pub regions: Vec<Facet<String>>,
    pub networks: Vec<Facet<Option<String>>>,
    pub kinds: Vec<Facet<ServiceType>>,
    pub tags: Vec<TagFacet>,
    pub bases: Vec<Facet<Basis>>,
    /// The selection as the file carries it; the one that asks for
    /// everything when it carries none.
    pub selection: Selection,
    pub kept: Kept,
    pub left_out: LeftOut,
    /// The resources brought and those left out by hand, in the file's
    /// order; the first `MAX_NODES` of them.
    pub listed: Vec<Listed>,
    /// Why the selection is no topology, when it is not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
    /// The file's own notes, as written.
    pub notes: Vec<String>,
}

/// Counts values, most frequent first and then in their own order.
fn facets<T: Ord + Clone>(values: impl Iterator<Item = T>, most: usize) -> Vec<Facet<T>> {
    let mut counts: BTreeMap<T, usize> = BTreeMap::new();
    for value in values {
        *counts.entry(value).or_default() += 1;
    }
    let mut facets: Vec<Facet<T>> = counts
        .into_iter()
        .map(|(value, count)| Facet { value, count })
        .collect();
    // Stable: equal counts stay in the values' own order.
    facets.sort_by_key(|facet| std::cmp::Reverse(facet.count));
    facets.truncate(most);
    facets
}

/// Says what a file holds and what its selection brings. Fails only where
/// the file itself cannot be read; a selection that is no topology is
/// surveyed, with the reason.
pub fn survey(path: &str, text: &str) -> Result<Survey, String> {
    let checked = check(text)?;
    let chosen = choose(&checked);
    let inventory = &checked.inventory;
    let resources = &inventory.resources;

    let mut tag_values: BTreeMap<&String, Vec<String>> = BTreeMap::new();
    for resource in resources {
        for (key, value) in &resource.tags {
            tag_values.entry(key).or_default().push(value.clone());
        }
    }
    let mut tags: Vec<TagFacet> = tag_values
        .into_iter()
        .map(|(key, values)| TagFacet {
            key: key.clone(),
            count: values.len(),
            values: facets(values.into_iter(), MAX_TAG_VALUES_LISTED),
        })
        .collect();
    tags.sort_by_key(|tag| std::cmp::Reverse(tag.count));
    tags.truncate(MAX_TAG_KEYS_LISTED);

    let listed = resources
        .iter()
        .enumerate()
        .filter(|(i, _)| chosen.kept[*i] || chosen.excluded[*i])
        .take(MAX_LISTED)
        .map(|(i, resource)| Listed {
            id: resource.id.clone(),
            name: resource.name.clone(),
            service_type: resource.service_type,
            region: resource.region.clone(),
            kept: chosen.kept[i],
        })
        .collect();

    Ok(Survey {
        path: path.to_string(),
        provider: inventory.provider,
        name: inventory.name.clone(),
        collected_at: inventory.collected_at.clone(),
        resources: resources.len(),
        relations: inventory.relations.len(),
        regions: facets(
            resources.iter().map(|resource| resource.region.clone()),
            MAX_FACET_VALUES,
        ),
        networks: facets(
            resources.iter().map(|resource| resource.network.clone()),
            MAX_FACET_VALUES,
        ),
        kinds: facets(
            resources.iter().map(|resource| resource.service_type),
            usize::MAX,
        ),
        tags,
        bases: Basis::ALL
            .into_iter()
            .map(|basis| Facet {
                value: basis,
                count: inventory
                    .relations
                    .iter()
                    .filter(|relation| relation.basis == basis)
                    .count(),
            })
            .collect(),
        selection: inventory.selection.clone().unwrap_or_default(),
        kept: Kept {
            resources: chosen.count(),
            relations: chosen.drawn.len(),
            entries: chosen.entries.len(),
        },
        left_out: LeftOut {
            unselected: chosen.unselected,
            excluded: chosen.excluded.iter().filter(|excluded| **excluded).count(),
            unconnected: chosen.unconnected,
            circular: chosen.circular.clone(),
        },
        listed,
        problem: chosen.problem.clone(),
        notes: inventory.notes.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resource(id: &str, kind: ServiceType) -> Resource {
        Resource {
            id: id.to_string(),
            name: id.to_string(),
            service_type: kind,
            native: "Test::Kind".to_string(),
            region: "here".to_string(),
            network: None,
            tags: BTreeMap::new(),
            public: false,
            members: None,
        }
    }

    fn relation(from: &str, to: &str, basis: Basis) -> Relation {
        Relation {
            from: from.to_string(),
            to: to.to_string(),
            basis,
            evidence: String::new(),
        }
    }

    fn inventory(resources: Vec<Resource>, relations: Vec<Relation>) -> String {
        serde_json::to_string(&Inventory {
            kind: KIND.to_string(),
            version: VERSION,
            provider: Provider::Oci,
            name: "test".to_string(),
            collected_at: None,
            resources,
            relations,
            selection: None,
            notes: Vec::new(),
        })
        .expect("serialises")
    }

    #[test]
    fn a_connection_is_drawn_as_what_states_it_and_what_it_leads_to() {
        use ServiceType::*;
        let as_drawn = |basis, source, target| drawn_as(basis, source, target).1;
        assert_eq!(
            as_drawn(Basis::Routing, ApiGateway, Container),
            Relationship::Route
        );
        // Into a queue is a publication; out of one, a consumption.
        assert_eq!(
            as_drawn(Basis::Event, MessageQueue, MessageQueue),
            Relationship::Publish
        );
        assert_eq!(
            as_drawn(Basis::Event, MessageQueue, Serverless),
            Relationship::Consume
        );
        assert_eq!(
            as_drawn(Basis::Event, Storage, Serverless),
            Relationship::Consume
        );
        // A rule or a declaration says only that one reaches the other: it
        // is read by what is reached.
        assert_eq!(
            as_drawn(Basis::Network, Container, Database),
            Relationship::Data
        );
        assert_eq!(
            as_drawn(Basis::Declared, ApiGateway, AuthService),
            Relationship::Auth
        );
        assert_eq!(
            as_drawn(Basis::Network, Container, Container),
            Relationship::Call
        );
    }

    #[test]
    fn the_strongest_statement_of_a_circle_is_the_one_kept() {
        // Stated as a rule first and as a route back after: the route is
        // drawn, whatever the order of the file.
        let text = inventory(
            vec![
                resource("a", ServiceType::ApiGateway),
                resource("b", ServiceType::Container),
            ],
            vec![
                relation("b", "a", Basis::Network),
                relation("a", "b", Basis::Routing),
            ],
        );
        let topology = topology_from_inventory("x.json", &text).expect("reads");
        let between: Vec<(&str, &str)> = topology
            .edges
            .iter()
            .filter(|edge| edge.source != CLIENT_ID && edge.source != UNKNOWN_ID)
            .map(|edge| (edge.source.as_str(), edge.target.as_str()))
            .collect();
        assert_eq!(between, [("a", "b")]);
    }

    #[test]
    fn a_long_circle_is_broken_once_and_the_rest_is_kept() {
        let ids = ["a", "b", "c", "d"];
        let mut relations: Vec<Relation> = ids
            .windows(2)
            .map(|pair| relation(pair[0], pair[1], Basis::Network))
            .collect();
        relations.push(relation("d", "a", Basis::Network));
        let text = inventory(
            ids.iter()
                .map(|id| resource(id, ServiceType::Container))
                .collect(),
            relations,
        );
        let surveyed = survey("x.json", &text).expect("surveys");
        assert_eq!(surveyed.kept.relations, 3);
        assert_eq!(
            surveyed.left_out.circular,
            [Pair {
                from: "d".to_string(),
                to: "a".to_string()
            }]
        );
        // With every way in closed by the circle gone, it is entered at its head.
        assert_eq!(surveyed.kept.entries, 1);
    }

    #[test]
    fn tiers_stay_within_what_a_topology_can_say() {
        // A chain longer than a tier counts to is still a topology.
        let ids: Vec<String> = (0..300).map(|i| format!("s{i}")).collect();
        let text = inventory(
            ids.iter()
                .map(|id| resource(id, ServiceType::Container))
                .collect(),
            ids.windows(2)
                .map(|pair| relation(&pair[0], &pair[1], Basis::Declared))
                .collect(),
        );
        let topology = topology_from_inventory("x.json", &text).expect("reads");
        assert_eq!(topology.nodes.last().map(|node| node.tier), Some(u8::MAX));
    }

    #[test]
    fn a_public_resource_behind_a_private_one_is_still_an_entry() {
        let mut door = resource("door", ServiceType::ApiGateway);
        door.public = true;
        let text = inventory(
            vec![resource("inner", ServiceType::NetworkGateway), door],
            vec![relation("inner", "door", Basis::Routing)],
        );
        let topology = topology_from_inventory("x.json", &text).expect("reads");
        assert!(topology
            .edges
            .iter()
            .any(|edge| edge.source == CLIENT_ID && edge.target == "door"));
        assert!(!topology
            .edges
            .iter()
            .any(|edge| edge.source == CLIENT_ID && edge.target == "inner"));
    }

    #[test]
    fn two_regions_with_a_gateway_each_can_fail_over() {
        let mut east = resource("east-gw", ServiceType::ApiGateway);
        east.region = "east".to_string();
        let mut west = resource("west-gw", ServiceType::ApiGateway);
        west.region = "west".to_string();
        let text = inventory(vec![east, west], Vec::new());
        let topology = topology_from_inventory("x.json", &text).expect("reads");
        assert_eq!(
            topology.roles.get("outageRegion").map(String::as_str),
            Some("east")
        );
        assert_eq!(
            topology.roles.get("failoverRegion").map(String::as_str),
            Some("west")
        );
    }

    #[test]
    fn what_a_file_may_hold_is_bounded() {
        let refused = |edit: &dyn Fn(&mut Resource)| {
            let mut one = resource("a", ServiceType::Container);
            edit(&mut one);
            topology_from_inventory("x.json", &inventory(vec![one], Vec::new()))
                .expect_err("refused")
        };
        assert!(refused(&|one| one.name = "n".repeat(MAX_TEXT_LEN + 1)).contains("name"));
        assert!(refused(&|one| one.members = Some(0)).contains("no member"));
        assert!(refused(&|one| one.region = "são paulo".to_string()).contains("region"));
        assert!(refused(&|one| {
            one.tags
                .insert("k".repeat(MAX_TAG_KEY_LEN + 1), String::new());
        })
        .contains("tags"));
        assert!(refused(&|one| {
            for i in 0..=MAX_TAGS {
                one.tags.insert(format!("k{i}"), String::new());
            }
        })
        .contains("tags"));
    }
}

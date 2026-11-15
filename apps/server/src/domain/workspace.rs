//! What the server says about the set of files it is running on.

use serde::{Deserialize, Serialize};

use super::TopologySummary;

/// Where the topologies, scenarios and policies in use came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceOrigin {
    /// The fixtures compiled into the server.
    Bundled,
    /// A workspace the server was started with.
    Startup,
    /// Files imported through the API since the server started. They are
    /// held in memory and are gone when it restarts.
    Imported,
}

/// A scenario that cannot run on one topology, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableScenario {
    pub topology_id: String,
    pub scenario_id: String,
    pub reason: String,
}

/// The files in use, or the files of an import that was checked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub origin: WorkspaceOrigin,
    /// Whether this server accepts imports.
    pub import_enabled: bool,
    /// Version of the workspace file formats this server reads.
    pub format_version: u32,
    /// Parts taken from the workspace, such as `topologies` or
    /// `cedar/policies`. The rest is what the server started with.
    pub replaced: Vec<String>,
    /// Files of the workspace that were not read.
    pub ignored: Vec<String>,
    pub topologies: Vec<TopologySummary>,
    /// The topology that opens.
    pub default_topology_id: String,
    pub scenario_ids: Vec<String>,
    pub recording_ids: Vec<String>,
    pub policy_count: usize,
    /// Share of ordinary authorization traffic Cedar denies.
    pub baseline_deny_fraction: f64,
    pub unavailable: Vec<UnavailableScenario>,
}

/// Why a set of files is not a valid workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProblem {
    /// The file the problem is in, when it is in one file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub message: String,
}

/// The outcome of checking files without applying them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCheck {
    pub valid: bool,
    /// What applying the files would give; present when they are valid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<WorkspaceStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<WorkspaceProblem>,
}

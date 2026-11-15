//! Workspace directory: an operator's own topologies, scenarios, recordings
//! and Cedar policies, read once at start-up.
//!
//! ```text
//! <workspace>/
//!   topologies/*.json        the platforms on offer; the first by file name opens
//!   scenarios/*.json         incident scenarios, offered in file-name order
//!   recordings/*.json        prerecorded incidents (a seed and a command list)
//!   cedar/policies.json      policies, in cedar-agent's PUT /v1/policies shape
//!   cedar/*.cedar            …or the same policies in Cedar's own syntax
//!   cedar/entities.json      the entity store
//!   cedar/catalog.json       who and what the request tracer offers, and the
//!                            request shapes simulated traffic is made of
//!   cedar/schema.cedarschema optional: policies and entities must validate
//! ```
//!
//! Every part is optional. A part that is present replaces the bundled one;
//! a part that is absent comes from the fixtures compiled into the binary.
//! [`export`] writes those fixtures out in this layout, as a starting point.
//!
//! Besides the integrations this is the only module that touches anything
//! outside the process, and all it does is read regular files under the one
//! directory the operator named, before the server starts listening. Nothing
//! here is reachable from the API. What is read is data for the simulation:
//! a scenario file can change numbers inside the model and nothing else.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;

use crate::application::{Sources, MAX_ITEMS};
use crate::authorization::{
    policy_documents_from_cedar, AuthzCatalog, PolicyDocument, BUNDLED_FILES,
};
use crate::domain::TopologySpec;
use crate::incidents::recordings::{self, Recording};
use crate::incidents::{catalog, ScenarioDef};
use crate::simulation::topologies;

/// Largest file read from a workspace.
pub const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

const TOPOLOGIES: &str = "topologies";
const SCENARIOS: &str = "scenarios";
const RECORDINGS: &str = "recordings";
const CEDAR: &str = "cedar";
const POLICIES_FILE: &str = "policies.json";
const ENTITIES_FILE: &str = "entities.json";
const CATALOG_FILE: &str = "catalog.json";
const SCHEMA_FILE: &str = "schema.cedarschema";

/// Something wrong in a workspace, with the file or directory it is in.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{}: {message}", path.display())]
pub struct WorkspaceError {
    pub path: PathBuf,
    pub message: String,
}

fn fail(path: &Path, message: impl Into<String>) -> WorkspaceError {
    WorkspaceError {
        path: path.to_path_buf(),
        message: message.into(),
    }
}

/// What a workspace directory contributed.
#[derive(Debug, Clone, PartialEq)]
pub struct Workspace {
    pub sources: Sources,
    /// Parts the directory replaced, such as `topologies` or `cedar/policies`.
    pub replaced: Vec<&'static str>,
    /// Entries in the directory that were not read.
    pub ignored: Vec<PathBuf>,
}

fn read_text(path: &Path) -> Result<String, WorkspaceError> {
    let file = fs::File::open(path).map_err(|e| fail(path, e.to_string()))?;
    let mut text = String::new();
    // Read one byte past the limit so an oversized file is told apart from
    // one that is exactly at it, without ever buffering more than that.
    file.take(MAX_FILE_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|e| fail(path, e.to_string()))?;
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(fail(
            path,
            format!("larger than {} MiB", MAX_FILE_BYTES / (1024 * 1024)),
        ));
    }
    Ok(text)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, WorkspaceError> {
    serde_json::from_str(&read_text(path)?).map_err(|e| fail(path, e.to_string()))
}

fn is_dir(path: &Path) -> Result<bool, WorkspaceError> {
    match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => Ok(true),
        Ok(_) => Err(fail(path, "is not a directory")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(fail(path, error.to_string())),
    }
}

/// Regular files directly inside `dir`, by file name. Directory order is
/// whatever the file system returns, so it is never relied on.
fn files_in(dir: &Path) -> Result<Vec<PathBuf>, WorkspaceError> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| fail(dir, e.to_string()))? {
        let path = entry.map_err(|e| fail(dir, e.to_string()))?.path();
        files.push(path);
    }
    files.sort();
    Ok(files)
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension().is_some_and(|e| e == extension)
        && fs::metadata(path).is_ok_and(|meta| meta.is_file())
}

/// The `.json` files of one part of the workspace, or `None` when the
/// directory does not exist. Anything else in it is recorded as ignored.
fn json_part(
    root: &Path,
    name: &str,
    ignored: &mut Vec<PathBuf>,
) -> Result<Option<Vec<PathBuf>>, WorkspaceError> {
    let dir = root.join(name);
    if !is_dir(&dir)? {
        return Ok(None);
    }
    let (files, others): (Vec<PathBuf>, Vec<PathBuf>) = files_in(&dir)?
        .into_iter()
        .partition(|path| has_extension(path, "json"));
    ignored.extend(others);
    if files.len() > MAX_ITEMS {
        return Err(fail(
            &dir,
            format!("holds {} files; at most {MAX_ITEMS} are read", files.len()),
        ));
    }
    Ok(Some(files))
}

/// Reads a workspace directory over the bundled fixtures.
///
/// Each file is parsed and checked on its own here, so an error names the
/// file. What only makes sense across files (a recording's topology, a
/// policy's id being unique) is checked by [`crate::application::Assets::build`].
pub fn load(root: &Path) -> Result<Workspace, WorkspaceError> {
    if !is_dir(root)? {
        return Err(fail(root, "does not exist"));
    }
    let mut sources = Sources::bundled()
        .map_err(|e| fail(root, format!("bundled fixtures do not parse: {e}")))?;
    let mut replaced = Vec::new();
    let mut ignored = Vec::new();

    for path in files_in(root)? {
        let known = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| [TOPOLOGIES, SCENARIOS, RECORDINGS, CEDAR].contains(&name));
        if !known {
            ignored.push(path);
        }
    }

    if let Some(files) = json_part(root, TOPOLOGIES, &mut ignored)? {
        if files.is_empty() {
            return Err(fail(
                &root.join(TOPOLOGIES),
                "holds no .json file; remove the directory to keep the bundled topologies",
            ));
        }
        sources.topologies = files
            .iter()
            .map(|path| read_json::<TopologySpec>(path))
            .collect::<Result<_, _>>()?;
        replaced.push(TOPOLOGIES);
    }

    if let Some(files) = json_part(root, SCENARIOS, &mut ignored)? {
        let mut scenarios = Vec::with_capacity(files.len());
        for path in &files {
            let scenario: ScenarioDef = read_json(path)?;
            scenario.validate().map_err(|e| fail(path, e))?;
            scenarios.push(scenario);
        }
        sources.scenarios = scenarios;
        replaced.push(SCENARIOS);
    }

    match json_part(root, RECORDINGS, &mut ignored)? {
        Some(files) => {
            let mut recordings = Vec::with_capacity(files.len());
            for path in &files {
                let recording: Recording = read_json(path)?;
                recording.validate().map_err(|e| fail(path, e))?;
                recordings.push(recording);
            }
            sources.recordings = recordings;
            replaced.push(RECORDINGS);
        }
        None => {
            // A bundled recording only makes sense while the topology it was
            // made on and the scenarios it starts are still there.
            let topologies = &sources.topologies;
            let scenarios = &sources.scenarios;
            sources.recordings.retain(|recording| {
                topologies.iter().any(|t| t.id == recording.topology_id)
                    && recording
                        .scenario_ids()
                        .iter()
                        .all(|id| scenarios.iter().any(|s| &s.id == id))
            });
        }
    }

    load_cedar(root, &mut sources, &mut replaced, &mut ignored)?;

    Ok(Workspace {
        sources,
        replaced,
        ignored,
    })
}

fn load_cedar(
    root: &Path,
    sources: &mut Sources,
    replaced: &mut Vec<&'static str>,
    ignored: &mut Vec<PathBuf>,
) -> Result<(), WorkspaceError> {
    let dir = root.join(CEDAR);
    if !is_dir(&dir)? {
        return Ok(());
    }
    let mut policy_files = Vec::new();
    for path in files_in(&dir)? {
        let name = path.file_name().and_then(|name| name.to_str());
        let is_file = fs::metadata(&path).is_ok_and(|meta| meta.is_file());
        match name {
            Some(POLICIES_FILE | ENTITIES_FILE | CATALOG_FILE | SCHEMA_FILE) if is_file => {}
            _ if has_extension(&path, "cedar") => policy_files.push(path),
            _ => ignored.push(path),
        }
    }
    let present = |name: &str| {
        let path = dir.join(name);
        fs::metadata(&path)
            .is_ok_and(|meta| meta.is_file())
            .then_some(path)
    };

    match (present(POLICIES_FILE), policy_files.is_empty()) {
        (Some(_), false) => {
            return Err(fail(
                &dir,
                format!("holds both {POLICIES_FILE} and .cedar files; keep one form"),
            ));
        }
        (Some(path), true) => {
            sources.policies = read_json::<Vec<PolicyDocument>>(&path)?;
            replaced.push("cedar/policies");
        }
        (None, false) => {
            let mut documents = Vec::new();
            for path in &policy_files {
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| fail(path, "file name is not valid UTF-8"))?;
                documents.extend(
                    policy_documents_from_cedar(name, &read_text(path)?)
                        .map_err(|e| fail(path, e.to_string()))?,
                );
            }
            sources.policies = documents;
            replaced.push("cedar/policies");
        }
        (None, true) => {}
    }
    if let Some(path) = present(ENTITIES_FILE) {
        sources.entities = read_json(&path)?;
        replaced.push("cedar/entities");
    }
    if let Some(path) = present(CATALOG_FILE) {
        let catalog: AuthzCatalog = read_json(&path)?;
        catalog.validate().map_err(|e| fail(&path, e))?;
        sources.catalog = catalog;
        replaced.push("cedar/catalog");
    }
    if let Some(path) = present(SCHEMA_FILE) {
        sources.schema = Some(read_text(&path)?);
        replaced.push("cedar/schema");
    }
    Ok(())
}

/// Writes the bundled fixtures into `root` in the workspace layout and
/// returns the files written. Refuses a directory that already holds
/// something, so it can never overwrite an operator's files.
pub fn export(root: &Path) -> Result<Vec<PathBuf>, WorkspaceError> {
    if is_dir(root)? && !files_in(root)?.is_empty() {
        return Err(fail(
            root,
            "is not empty; export writes into a new or empty directory",
        ));
    }
    let mut stress = serde_json::to_string_pretty(&topologies::stress(topologies::STRESS_SEED))
        .map_err(|e| fail(root, e.to_string()))?;
    stress.push('\n');
    let stress_file = format!("{}.json", topologies::STRESS_ID);

    let mut files: Vec<(&str, &str, &str)> = vec![
        (
            TOPOLOGIES,
            topologies::HELIOS_FILE.0,
            topologies::HELIOS_FILE.1,
        ),
        (TOPOLOGIES, &stress_file, &stress),
    ];
    files.extend(
        catalog::FILES
            .iter()
            .map(|(name, text)| (SCENARIOS, *name, *text)),
    );
    files.extend(
        recordings::FILES
            .iter()
            .map(|(name, text)| (RECORDINGS, *name, *text)),
    );
    files.extend(
        BUNDLED_FILES
            .iter()
            .map(|(name, text)| (CEDAR, *name, *text)),
    );

    let mut written = Vec::with_capacity(files.len());
    for (part, name, text) in files {
        let dir = root.join(part);
        fs::create_dir_all(&dir).map_err(|e| fail(&dir, e.to_string()))?;
        let path = dir.join(name);
        fs::write(&path, text).map_err(|e| fail(&path, e.to_string()))?;
        written.push(path);
    }
    Ok(written)
}

//! Workspace directory: an operator's own topologies, scenarios, recordings
//! and Cedar policies, read once at start-up.
//!
//! ```text
//! <workspace>/
//!   workspace.json           optional file-format version (defaults to 1)
//!   topologies/*.json        the platforms on offer; the first by file name opens
//!                            (a Compose file or a cloud inventory is read as one)
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
//! Every part is optional. A part that is present replaces the one it is
//! laid over; a part that is absent stays. [`export`] writes the bundled
//! fixtures out in this layout, as a starting point.
//!
//! A workspace arrives in one of two ways. [`load`] reads a directory (or a
//! bundle file) the operator named, before the server starts listening; it is
//! the only place in the server that touches the file system. [`from_files`]
//! takes files that are already in memory, which is what the import route
//! hands it, and touches nothing. Both sort the files into the same parts and
//! go through the same checks, so a file is accepted or refused identically
//! whichever way it came. What is read is data for the simulation: a scenario
//! file can change numbers inside the model and nothing else.

use std::borrow::Cow;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::application::{BootstrapError, Loaded, Sources, MAX_ITEMS};
use crate::authorization::{
    policy_documents_from_cedar, AuthzCatalog, PolicyDocument, BUNDLED_FILES,
};
use crate::domain::{TopologySpec, WorkspaceOrigin};
use crate::incidents::recordings::{self, Recording};
use crate::incidents::{catalog, ScenarioDef};
use crate::simulation::topologies;

pub mod compose;
pub mod inventory;
pub mod schemas;

/// Version of all AEGIS-authored file formats inside one workspace.
pub const FORMAT_VERSION: u32 = 1;

/// Optional `workspace.json`. Missing manifests mean version 1 for compatibility.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    #[schemars(range(min = FORMAT_VERSION, max = FORMAT_VERSION))]
    pub format_version: u32,
}

/// Largest file read from a workspace.
pub const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// Most files one import or bundle may hold.
pub const MAX_IMPORT_FILES: usize = 256;
/// Longest path an imported file may declare.
pub const MAX_PATH_LEN: usize = 255;

const TOPOLOGIES: &str = "topologies";
const SCENARIOS: &str = "scenarios";
const RECORDINGS: &str = "recordings";
const CEDAR: &str = "cedar";
const POLICIES_FILE: &str = "policies.json";
const ENTITIES_FILE: &str = "entities.json";
const CATALOG_FILE: &str = "catalog.json";
const SCHEMA_FILE: &str = "schema.cedarschema";
const MANIFEST_FILE: &str = "workspace.json";

/// One file of a workspace held in memory: what the interface uploads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceFile {
    /// Where the file sits in the workspace, such as
    /// `scenarios/01-fire.json`. A bare file name is enough: what kind of
    /// file it is is then told from its contents.
    #[schemars(length(min = 1, max = MAX_PATH_LEN))]
    pub path: String,
    pub text: String,
}

/// A whole workspace as one JSON document: what the interface downloads,
/// and one of the things an import accepts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bundle {
    #[schemars(range(min = FORMAT_VERSION, max = FORMAT_VERSION))]
    pub format_version: u32,
    #[schemars(length(max = MAX_IMPORT_FILES))]
    pub files: Vec<SourceFile>,
}

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

/// What a workspace contributed.
#[derive(Debug, Clone, PartialEq)]
pub struct Workspace {
    pub sources: Sources,
    /// Parts it replaced, such as `topologies` or `cedar/policies`.
    pub replaced: Vec<&'static str>,
    /// Entries in it that were not read.
    pub ignored: Vec<PathBuf>,
}

impl Workspace {
    /// Compiles what was read, the way start-up does.
    pub fn build(self, origin: WorkspaceOrigin) -> Result<Loaded, BootstrapError> {
        Loaded::build(
            self.sources,
            origin,
            self.replaced.iter().map(ToString::to_string).collect(),
            self.ignored
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
        )
    }
}

fn read_text(path: &Path) -> Result<String, WorkspaceError> {
    let file = fs::File::open(path).map_err(|e| fail(path, e.to_string()))?;
    let mut text = String::new();
    // Read one byte past the limit so an oversized file is told apart from
    // one that is exactly at it, without ever buffering more than that.
    file.take(MAX_FILE_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|e| fail(path, e.to_string()))?;
    check_size(path, text.len())?;
    Ok(text)
}

fn check_size(path: &Path, bytes: usize) -> Result<(), WorkspaceError> {
    if bytes as u64 > MAX_FILE_BYTES {
        Err(fail(
            path,
            format!("larger than {} MiB", MAX_FILE_BYTES / (1024 * 1024)),
        ))
    } else {
        Ok(())
    }
}

/// A file of a workspace: on disk, read only when it is needed, or already
/// in memory.
#[derive(Debug, Clone)]
enum Entry {
    Disk(PathBuf),
    Memory { path: PathBuf, text: String },
}

impl Entry {
    fn path(&self) -> &Path {
        match self {
            Self::Disk(path) | Self::Memory { path, .. } => path,
        }
    }

    fn text(&self) -> Result<Cow<'_, str>, WorkspaceError> {
        match self {
            Self::Disk(path) => read_text(path).map(Cow::Owned),
            Self::Memory { text, .. } => Ok(Cow::Borrowed(text)),
        }
    }

    fn json<T: DeserializeOwned>(&self) -> Result<T, WorkspaceError> {
        serde_json::from_str(&self.text()?).map_err(|e| fail(self.path(), e.to_string()))
    }

    /// The topology a file describes: in the topology format, or, for a
    /// Compose file or a cloud inventory, what `compose` or `inventory`
    /// reads from it.
    fn topology(&self) -> Result<TopologySpec, WorkspaceError> {
        let name = self.name()?;
        let text = self.text()?;
        if COMPOSE_EXTENSIONS.contains(&extension(name)) {
            compose::topology_from_compose(name, &text)
                .map_err(|problem| fail(self.path(), problem))
        } else if inventory::is_inventory(&text) {
            inventory::topology_from_inventory(name, &text)
                .map_err(|problem| fail(self.path(), problem))
        } else {
            serde_json::from_str(&text).map_err(|e| fail(self.path(), e.to_string()))
        }
    }

    fn name(&self) -> Result<&str, WorkspaceError> {
        self.path()
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| fail(self.path(), "file name is not valid UTF-8"))
    }
}

/// The files of a workspace sorted into its parts, wherever they came from.
/// A part that is `None` is absent and leaves what it would replace alone.
#[derive(Debug, Default)]
struct Parts {
    manifest: Option<Entry>,
    topologies: Option<Vec<Entry>>,
    scenarios: Option<Vec<Entry>>,
    recordings: Option<Vec<Entry>>,
    policies: Option<Entry>,
    policy_files: Vec<Entry>,
    entities: Option<Entry>,
    catalog: Option<Entry>,
    schema: Option<Entry>,
    /// Named by an error about the part as a whole.
    topologies_at: PathBuf,
    cedar_at: PathBuf,
    ignored: Vec<PathBuf>,
}

// ---------------------------------------------------------------------------
// From a directory
// ---------------------------------------------------------------------------

fn is_dir(path: &Path) -> Result<bool, WorkspaceError> {
    match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => Ok(true),
        Ok(_) => Err(fail(path, "is not a directory")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(fail(path, error.to_string())),
    }
}

fn is_file(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file())
}

/// Entries directly inside `dir`, by file name. Directory order is whatever
/// the file system returns, so it is never relied on.
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
    path.extension().is_some_and(|e| e == extension) && is_file(path)
}

/// A topology may also be a Compose file, read by `compose`.
const COMPOSE_EXTENSIONS: [&str; 2] = ["yml", "yaml"];

/// The `.json` files of one part of a directory, or `None` when the
/// directory does not exist. Anything else in it is recorded as ignored.
/// `also` names other extensions the part takes.
fn json_part(
    root: &Path,
    name: &str,
    also: &[&str],
    ignored: &mut Vec<PathBuf>,
) -> Result<Option<Vec<Entry>>, WorkspaceError> {
    let dir = root.join(name);
    if !is_dir(&dir)? {
        return Ok(None);
    }
    let (files, others): (Vec<PathBuf>, Vec<PathBuf>) =
        files_in(&dir)?.into_iter().partition(|path| {
            has_extension(path, "json") || also.iter().any(|other| has_extension(path, other))
        });
    ignored.extend(others);
    if files.len() > MAX_ITEMS {
        return Err(fail(
            &dir,
            format!("holds {} files; at most {MAX_ITEMS} are read", files.len()),
        ));
    }
    Ok(Some(files.into_iter().map(Entry::Disk).collect()))
}

/// Lists a workspace directory. Nothing is read yet but the listing.
fn parts_in(root: &Path) -> Result<Parts, WorkspaceError> {
    let mut parts = Parts {
        topologies_at: root.join(TOPOLOGIES),
        cedar_at: root.join(CEDAR),
        ..Parts::default()
    };
    let manifest = root.join(MANIFEST_FILE);
    match fs::metadata(&manifest) {
        Ok(_) => parts.manifest = Some(Entry::Disk(manifest)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(fail(&manifest, error.to_string())),
    }
    for path in files_in(root)? {
        let known = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                [TOPOLOGIES, SCENARIOS, RECORDINGS, CEDAR, MANIFEST_FILE].contains(&name)
            });
        if !known {
            parts.ignored.push(path);
        }
    }
    parts.topologies = json_part(root, TOPOLOGIES, &COMPOSE_EXTENSIONS, &mut parts.ignored)?;
    parts.scenarios = json_part(root, SCENARIOS, &[], &mut parts.ignored)?;
    parts.recordings = json_part(root, RECORDINGS, &[], &mut parts.ignored)?;

    let cedar = root.join(CEDAR);
    if is_dir(&cedar)? {
        for path in files_in(&cedar)? {
            let name = path.file_name().and_then(|name| name.to_str());
            let slot = match name {
                Some(POLICIES_FILE) if is_file(&path) => &mut parts.policies,
                Some(ENTITIES_FILE) if is_file(&path) => &mut parts.entities,
                Some(CATALOG_FILE) if is_file(&path) => &mut parts.catalog,
                Some(SCHEMA_FILE) if is_file(&path) => &mut parts.schema,
                _ if has_extension(&path, "cedar") => {
                    parts.policy_files.push(Entry::Disk(path));
                    continue;
                }
                _ => {
                    parts.ignored.push(path);
                    continue;
                }
            };
            *slot = Some(Entry::Disk(path));
        }
    }
    Ok(parts)
}

/// Reads a workspace over the bundled fixtures: a directory in the layout
/// above, or a bundle file such as the interface downloads.
///
/// Each file is parsed and checked on its own here, so an error names the
/// file. What only makes sense across files (a recording's topology, a
/// policy's id being unique) is checked by [`crate::application::Assets::build`].
pub fn load(root: &Path) -> Result<Workspace, WorkspaceError> {
    let bundled = Sources::bundled()
        .map_err(|e| fail(root, format!("bundled fixtures do not parse: {e}")))?;
    if is_file(root) {
        let name = root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| fail(root, "file name is not valid UTF-8"))?;
        let file = SourceFile {
            path: name.to_string(),
            text: read_text(root)?,
        };
        // Errors inside a bundle name the file within it; say which bundle.
        return from_files(vec![file], bundled).map_err(|error| {
            if error.path == Path::new(name) {
                fail(root, error.message)
            } else {
                fail(root, format!("{}: {}", error.path.display(), error.message))
            }
        });
    }
    if !is_dir(root)? {
        return Err(fail(root, "does not exist"));
    }
    overlay(parts_in(root)?, bundled)
}

// ---------------------------------------------------------------------------
// From files in memory
// ---------------------------------------------------------------------------

enum Kind {
    Manifest,
    Topology,
    Scenario,
    Recording,
    Policies,
    PolicyFile,
    Entities,
    Catalog,
    Schema,
    Bundle,
    Ignored,
}

/// The last two components of a declared path: the directory a file says it
/// is in, if any, and its name. Nothing here ever reaches the file system;
/// the path only says which part of the workspace the file belongs to.
fn place(raw: &str) -> Result<(Option<String>, String), WorkspaceError> {
    let shown = Path::new(raw);
    if raw.is_empty() || raw.len() > MAX_PATH_LEN || raw.chars().any(char::is_control) {
        return Err(fail(
            Path::new("import"),
            format!(
                "a file has an invalid path; a path is 1 to {MAX_PATH_LEN} printable characters"
            ),
        ));
    }
    let mut components: Vec<&str> = raw
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if components.contains(&"..") {
        return Err(fail(shown, "a path may not contain `..`"));
    }
    let Some(name) = components.pop() else {
        return Err(fail(shown, "the path names no file"));
    };
    Ok((components.pop().map(str::to_string), name.to_string()))
}

fn extension(name: &str) -> &str {
    name.rsplit_once('.').map_or("", |(_, extension)| extension)
}

/// What a file is, from the directory it says it is in.
fn kind_by_place(parent: Option<&str>, name: &str) -> Option<Kind> {
    let json = extension(name) == "json";
    match parent? {
        TOPOLOGIES => Some(if json || COMPOSE_EXTENSIONS.contains(&extension(name)) {
            Kind::Topology
        } else {
            Kind::Ignored
        }),
        SCENARIOS => Some(if json { Kind::Scenario } else { Kind::Ignored }),
        RECORDINGS => Some(if json { Kind::Recording } else { Kind::Ignored }),
        CEDAR => Some(match name {
            POLICIES_FILE => Kind::Policies,
            ENTITIES_FILE => Kind::Entities,
            CATALOG_FILE => Kind::Catalog,
            SCHEMA_FILE => Kind::Schema,
            _ if extension(name) == "cedar" => Kind::PolicyFile,
            _ => Kind::Ignored,
        }),
        _ => None,
    }
}

/// What a file dropped on its own is, from its name and what it holds.
fn kind_by_content(path: &Path, name: &str, text: &str) -> Result<Kind, WorkspaceError> {
    match extension(name) {
        "cedar" => return Ok(Kind::PolicyFile),
        "cedarschema" => return Ok(Kind::Schema),
        "json" => {}
        // The one kind of YAML that is read: a Compose file, as a topology.
        "yml" | "yaml" => {
            return if compose::is_compose(text) {
                Ok(Kind::Topology)
            } else {
                Err(fail(
                    path,
                    "is YAML but not a Compose file: it has no `services`. Compose files are the only YAML AEGIS reads",
                ))
            };
        }
        _ => return Ok(Kind::Ignored),
    }
    let unknown = || {
        fail(
            path,
            "is not a file AEGIS recognises: expected a topology (`nodes`, `edges`), a cloud inventory (`kind`), a scenario (`phases`), a recording (`commands`), a catalogue (`trafficMix`), a list of policies or entities, a manifest or a bundle",
        )
    };
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| fail(path, e.to_string()))?;
    match &value {
        serde_json::Value::Object(map) => {
            let has = |key: &str| map.contains_key(key);
            // A cloud inventory says what it is; it is read as a topology.
            if map.get("kind").and_then(|kind| kind.as_str()) == Some(inventory::KIND) {
                Ok(Kind::Topology)
            } else if has("files") {
                Ok(Kind::Bundle)
            } else if has("nodes") && has("edges") {
                Ok(Kind::Topology)
            } else if has("phases") {
                Ok(Kind::Scenario)
            } else if has("commands") {
                Ok(Kind::Recording)
            } else if has("trafficMix") || has("principals") {
                Ok(Kind::Catalog)
            } else if has("formatVersion") {
                Ok(Kind::Manifest)
            } else {
                Err(unknown())
            }
        }
        serde_json::Value::Array(items) => match items.first() {
            Some(serde_json::Value::Object(first)) if first.contains_key("content") => {
                Ok(Kind::Policies)
            }
            Some(serde_json::Value::Object(first)) if first.contains_key("uid") => {
                Ok(Kind::Entities)
            }
            None => Err(fail(
                path,
                "is an empty list, which could be policies or entities; name it cedar/policies.json or cedar/entities.json",
            )),
            Some(_) => Err(unknown()),
        },
        _ => Err(unknown()),
    }
}

fn check_version(path: &Path, version: u32) -> Result<(), WorkspaceError> {
    if version == FORMAT_VERSION {
        Ok(())
    } else {
        Err(fail(
            path,
            format!("unsupported formatVersion {version}; this server supports {FORMAT_VERSION}"),
        ))
    }
}

fn only_one(slot: &mut Option<Entry>, entry: Entry, what: &str) -> Result<(), WorkspaceError> {
    if let Some(first) = slot {
        return Err(fail(
            entry.path(),
            format!(
                "is a second {what}; `{}` already is one",
                first.path().display()
            ),
        ));
    }
    *slot = Some(entry);
    Ok(())
}

fn sort_file(
    file: SourceFile,
    inside_bundle: bool,
    count: &mut usize,
    parts: &mut Parts,
) -> Result<(), WorkspaceError> {
    *count += 1;
    if *count > MAX_IMPORT_FILES {
        return Err(fail(
            Path::new("import"),
            format!("holds more than {MAX_IMPORT_FILES} files"),
        ));
    }
    let (parent, name) = place(&file.path)?;
    let path = PathBuf::from(&file.path);
    check_size(&path, file.text.len())?;
    let kind = match kind_by_place(parent.as_deref(), &name) {
        Some(kind) => kind,
        None => kind_by_content(&path, &name, &file.text)?,
    };
    let entry = Entry::Memory {
        path: path.clone(),
        text: file.text,
    };
    match kind {
        Kind::Ignored => parts.ignored.push(path),
        Kind::Manifest => only_one(&mut parts.manifest, entry, "manifest")?,
        Kind::Topology => parts.topologies.get_or_insert_with(Vec::new).push(entry),
        Kind::Scenario => parts.scenarios.get_or_insert_with(Vec::new).push(entry),
        Kind::Recording => parts.recordings.get_or_insert_with(Vec::new).push(entry),
        Kind::Policies => only_one(&mut parts.policies, entry, "list of policies")?,
        Kind::PolicyFile => parts.policy_files.push(entry),
        Kind::Entities => only_one(&mut parts.entities, entry, "entity store")?,
        Kind::Catalog => only_one(&mut parts.catalog, entry, "catalogue")?,
        Kind::Schema => only_one(&mut parts.schema, entry, "Cedar schema")?,
        Kind::Bundle => {
            if inside_bundle {
                return Err(fail(&path, "a bundle cannot hold another bundle"));
            }
            let bundle: Bundle = entry.json()?;
            check_version(&path, bundle.format_version)?;
            for inner in bundle.files {
                sort_file(inner, true, count, parts)?;
            }
        }
    }
    Ok(())
}

/// Lays files that are already in memory over `base`, exactly as [`load`]
/// lays a directory over the bundled set. A file in a known directory
/// (`scenarios/x.json`) is what the directory says; a file on its own is
/// recognised by what it holds. Touches nothing outside its arguments.
pub fn from_files(files: Vec<SourceFile>, base: Sources) -> Result<Workspace, WorkspaceError> {
    let mut parts = Parts {
        topologies_at: PathBuf::from(TOPOLOGIES),
        cedar_at: PathBuf::from(CEDAR),
        ..Parts::default()
    };
    let mut count = 0;
    for file in files {
        sort_file(file, false, &mut count, &mut parts)?;
    }
    // A directory is listed by file name; do the same so the order of an
    // upload does not decide which topology opens or how scenarios are listed.
    let by_name = |entries: &mut Vec<Entry>| {
        entries.sort_by(|a, b| {
            let name = |entry: &Entry| entry.path().file_name().map(ToOwned::to_owned);
            name(a).cmp(&name(b)).then_with(|| a.path().cmp(b.path()))
        });
    };
    for part in [
        &mut parts.topologies,
        &mut parts.scenarios,
        &mut parts.recordings,
    ]
    .into_iter()
    .flatten()
    {
        if part.len() > MAX_ITEMS {
            return Err(fail(
                Path::new("import"),
                format!(
                    "holds {} files of one kind; at most {MAX_ITEMS} are read",
                    part.len()
                ),
            ));
        }
        by_name(part);
    }
    by_name(&mut parts.policy_files);
    let nothing = parts.manifest.is_none()
        && parts.topologies.is_none()
        && parts.scenarios.is_none()
        && parts.recordings.is_none()
        && parts.policies.is_none()
        && parts.policy_files.is_empty()
        && parts.entities.is_none()
        && parts.catalog.is_none()
        && parts.schema.is_none();
    if nothing {
        return Err(fail(
            Path::new("import"),
            "holds no workspace file: nothing in it is a topology, a scenario, a recording or a Cedar file",
        ));
    }
    overlay(parts, base)
}

/// What each cloud inventory among `files` holds and what its selection
/// brings: the files [`from_files`] would read as a topology that say they
/// are one. A file that cannot be read at all is not surveyed; the check of
/// the files reports it. Touches nothing outside its argument.
pub fn surveys(files: &[SourceFile]) -> Vec<inventory::Survey> {
    files
        .iter()
        .take(MAX_IMPORT_FILES)
        .filter(|file| file.text.len() as u64 <= MAX_FILE_BYTES)
        .filter_map(|file| {
            let (parent, name) = place(&file.path).ok()?;
            let a_topology = match kind_by_place(parent.as_deref(), &name) {
                Some(kind) => matches!(kind, Kind::Topology),
                None => true,
            };
            (a_topology && extension(&name) == "json" && inventory::is_inventory(&file.text))
                .then(|| inventory::survey(&file.path, &file.text).ok())
                .flatten()
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Either way
// ---------------------------------------------------------------------------

/// Parses and checks each part that is present and lays it over `sources`.
fn overlay(parts: Parts, mut sources: Sources) -> Result<Workspace, WorkspaceError> {
    let mut replaced = Vec::new();
    if let Some(manifest) = &parts.manifest {
        check_version(manifest.path(), manifest.json::<Manifest>()?.format_version)?;
    }

    if let Some(files) = &parts.topologies {
        if files.is_empty() {
            return Err(fail(
                &parts.topologies_at,
                "holds no .json or Compose file; remove the directory to keep the bundled topologies",
            ));
        }
        sources.topologies = files
            .iter()
            .map(Entry::topology)
            .collect::<Result<_, _>>()?;
        replaced.push(TOPOLOGIES);
    }

    if let Some(files) = &parts.scenarios {
        let mut scenarios = Vec::with_capacity(files.len());
        for file in files {
            let scenario: ScenarioDef = file.json()?;
            scenario.validate().map_err(|e| fail(file.path(), e))?;
            scenarios.push(scenario);
        }
        sources.scenarios = scenarios;
        replaced.push(SCENARIOS);
    }

    match &parts.recordings {
        Some(files) => {
            let mut recordings = Vec::with_capacity(files.len());
            for file in files {
                let recording: Recording = file.json()?;
                recording.validate().map_err(|e| fail(file.path(), e))?;
                recordings.push(recording);
            }
            sources.recordings = recordings;
            replaced.push(RECORDINGS);
        }
        None => {
            // A recording that was already there only makes sense while the
            // topology it was made on and the scenarios it starts still are.
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

    match (&parts.policies, parts.policy_files.is_empty()) {
        (Some(_), false) => {
            return Err(fail(
                &parts.cedar_at,
                format!("holds both {POLICIES_FILE} and .cedar files; keep one form"),
            ));
        }
        (Some(file), true) => {
            sources.policies = file.json::<Vec<PolicyDocument>>()?;
            replaced.push("cedar/policies");
        }
        (None, false) => {
            let mut documents = Vec::new();
            for file in &parts.policy_files {
                documents.extend(
                    policy_documents_from_cedar(file.name()?, &file.text()?)
                        .map_err(|e| fail(file.path(), e.to_string()))?,
                );
            }
            sources.policies = documents;
            replaced.push("cedar/policies");
        }
        (None, true) => {}
    }
    if let Some(file) = &parts.entities {
        sources.entities = file.json()?;
        replaced.push("cedar/entities");
    }
    if let Some(file) = &parts.catalog {
        let catalog: AuthzCatalog = file.json()?;
        catalog.validate().map_err(|e| fail(file.path(), e))?;
        sources.catalog = catalog;
        replaced.push("cedar/catalog");
    }
    if let Some(file) = &parts.schema {
        sources.schema = Some(file.text()?.into_owned());
        replaced.push("cedar/schema");
    }

    Ok(Workspace {
        sources,
        replaced,
        ignored: parts.ignored,
    })
}

/// A set of sources written out as the files of a workspace: every part,
/// numbered so that reading them back gives the same order.
pub fn bundle_of(sources: &Sources) -> Result<Bundle, serde_json::Error> {
    fn pretty(value: &impl Serialize) -> Result<String, serde_json::Error> {
        let mut text = serde_json::to_string_pretty(value)?;
        text.push('\n');
        Ok(text)
    }
    let mut files = vec![SourceFile {
        path: MANIFEST_FILE.to_string(),
        text: pretty(&Manifest {
            format_version: FORMAT_VERSION,
        })?,
    }];
    for (i, topology) in sources.topologies.iter().enumerate() {
        files.push(SourceFile {
            path: format!("{TOPOLOGIES}/{:02}-{}.json", i + 1, topology.id),
            text: pretty(topology)?,
        });
    }
    for (i, scenario) in sources.scenarios.iter().enumerate() {
        files.push(SourceFile {
            path: format!("{SCENARIOS}/{:02}-{}.json", i + 1, scenario.id),
            text: pretty(scenario)?,
        });
    }
    for (i, recording) in sources.recordings.iter().enumerate() {
        files.push(SourceFile {
            path: format!("{RECORDINGS}/{:02}-{}.json", i + 1, recording.id),
            text: pretty(recording)?,
        });
    }
    files.push(SourceFile {
        path: format!("{CEDAR}/{POLICIES_FILE}"),
        text: pretty(&sources.policies)?,
    });
    files.push(SourceFile {
        path: format!("{CEDAR}/{ENTITIES_FILE}"),
        text: pretty(&sources.entities)?,
    });
    files.push(SourceFile {
        path: format!("{CEDAR}/{CATALOG_FILE}"),
        text: pretty(&sources.catalog)?,
    });
    if let Some(schema) = &sources.schema {
        files.push(SourceFile {
            path: format!("{CEDAR}/{SCHEMA_FILE}"),
            text: schema.clone(),
        });
    }
    Ok(Bundle {
        format_version: FORMAT_VERSION,
        files,
    })
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
    let manifest = serde_json::to_string_pretty(&Manifest {
        format_version: FORMAT_VERSION,
    })
    .map_err(|e| fail(root, e.to_string()))?
        + "\n";

    let mut files: Vec<(&str, &str, &str)> = vec![
        ("", MANIFEST_FILE, &manifest),
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

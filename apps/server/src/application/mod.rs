//! Application layer: wires the domain together and exposes use cases.
//!
//! [`Sources`] is what the application is built from: the fixtures compiled
//! into the binary, or those with parts replaced by a workspace directory.
//! [`Assets`] is everything immutable that is built from them once at
//! start-up (Cedar engine, compiled topologies, resolved scenarios,
//! recordings). [`SimulationService`] owns the single mutable timeline and is
//! the only place that advances it.

pub mod diff;
pub mod experiment;
mod service;
pub mod session;

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::authorization::{
    bundled_entities_json, bundled_policy_documents, AuthzCatalog, CedarEngine, CedarSetupError,
    PolicyDocument,
};
use crate::domain::{
    DataSource, PolicyDecisionPoint, TopologySpec, TopologySummary, UnavailableScenario,
    WorkspaceOrigin, WorkspaceStatus,
};
use crate::incidents::recordings::{self, Recording};
use crate::incidents::{catalog, check, resolve_all, resolve_fault, ResolvedScenario, ScenarioDef};
use crate::simulation::topologies;
use crate::simulation::{DecisionTable, SimTopology, TopologyError};

pub use service::{
    ControlAction, EvaluateEngine, EvaluateInput, ResetScope, ServiceError, SimulationService,
    StreamMessage, TimelineReason, PROTOCOL_VERSION, SCHEDULER_PERIOD,
};

/// Most topologies, scenarios or recordings one server offers.
pub const MAX_ITEMS: usize = 64;

#[derive(Debug, thiserror::Error)]
pub enum BootstrapError {
    #[error("authorization: {0}")]
    Cedar(#[from] CedarSetupError),
    #[error("fixture JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("there is no topology to open")]
    NoTopology,
    #[error("at most {MAX_ITEMS} {what} are allowed, found {found}")]
    TooMany { what: &'static str, found: usize },
    #[error("topology `{id}`: {source}")]
    Topology { id: String, source: TopologyError },
    #[error("topology `{0}` is declared twice")]
    DuplicateTopology(String),
    #[error(
        "topology `{0}` must declare `\"dataSource\": \"synthetic\"`: its figures come from the simulation, whatever the platform it describes"
    )]
    TopologyProvenance(String),
    #[error("scenario `{id}`: {message}")]
    Scenario { id: String, message: String },
    #[error("scenario `{0}` is declared twice")]
    DuplicateScenario(String),
    #[error("authorization catalogue: {0}")]
    Catalog(String),
    #[error("recording `{id}`: {message}")]
    Recording { id: String, message: String },
    #[error("recording `{0}` is declared twice")]
    DuplicateRecording(String),
    #[error("recording `{recording}` refers to unknown topology `{topology}`")]
    RecordingTopology { recording: String, topology: String },
    #[error("recording `{recording}` starts unknown scenario `{scenario}`")]
    RecordingScenario { recording: String, scenario: String },
    #[error("recording `{recording}` places a fault its topology cannot take: {message}")]
    RecordingFault { recording: String, message: String },
}

/// Everything the application is built from, before anything is compiled.
#[derive(Debug, Clone, PartialEq)]
pub struct Sources {
    /// Topologies on offer. The first one is opened at start-up.
    pub topologies: Vec<TopologySpec>,
    /// Scenarios, in the order they are offered.
    pub scenarios: Vec<ScenarioDef>,
    pub recordings: Vec<Recording>,
    pub policies: Vec<PolicyDocument>,
    /// Cedar entity store, in the JSON shape Cedar itself reads.
    pub entities: serde_json::Value,
    pub catalog: AuthzCatalog,
    /// Cedar schema the policies and entities must validate against.
    pub schema: Option<String>,
}

impl Sources {
    /// The fixtures compiled into the binary.
    pub fn bundled() -> Result<Self, serde_json::Error> {
        Ok(Self {
            topologies: vec![
                topologies::helios()?,
                topologies::stress(topologies::STRESS_SEED),
            ],
            scenarios: catalog::bundled()?,
            recordings: recordings::bundled()?,
            policies: bundled_policy_documents()?,
            entities: bundled_entities_json()?,
            catalog: AuthzCatalog::bundled()?,
            schema: None,
        })
    }
}

/// A topology together with the scenarios resolved against it.
#[derive(Debug, Clone)]
pub struct World {
    pub topo: Arc<SimTopology>,
    pub scenarios: Arc<Vec<ResolvedScenario>>,
}

impl World {
    pub fn summary(&self) -> TopologySummary {
        let spec = &self.topo.spec;
        TopologySummary {
            id: spec.id.clone(),
            name: spec.name.clone(),
            description: spec.description.clone(),
            node_count: spec.nodes.len(),
            edge_count: spec.edges.len(),
            region_count: spec.regions.len(),
            data_source: spec.data_source,
        }
    }
}

/// Why a scenario cannot run on a topology.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unavailable {
    pub topology: String,
    pub scenario: String,
    pub reason: String,
}

#[derive(Debug)]
pub struct Assets {
    pub cedar: Arc<CedarEngine>,
    pub catalog: AuthzCatalog,
    pub decisions: Arc<DecisionTable>,
    pub worlds: BTreeMap<String, World>,
    pub recordings: Vec<Recording>,
    pub default_topology: String,
    /// Scenarios that cannot run on a topology, and why.
    pub unavailable: Vec<Unavailable>,
}

fn at_most(what: &'static str, found: usize) -> Result<(), BootstrapError> {
    if found > MAX_ITEMS {
        Err(BootstrapError::TooMany { what, found })
    } else {
        Ok(())
    }
}

impl Assets {
    /// Builds everything from the fixtures compiled into the binary.
    pub fn bundled() -> Result<Self, BootstrapError> {
        Self::build(Sources::bundled()?)
    }

    /// Validates and compiles a set of sources. Anything wrong in them is an
    /// error here, at start-up, except a scenario that names a role, a node
    /// or a request one topology does not have: that scenario is listed as
    /// unavailable on that topology.
    pub fn build(sources: Sources) -> Result<Self, BootstrapError> {
        let Sources {
            topologies,
            scenarios,
            recordings,
            policies,
            entities,
            catalog,
            schema,
        } = sources;
        at_most("topologies", topologies.len())?;
        at_most("scenarios", scenarios.len())?;
        at_most("recordings", recordings.len())?;

        let cedar = Arc::new(CedarEngine::with_schema(
            policies,
            entities,
            schema.as_deref(),
        )?);
        catalog.validate().map_err(BootstrapError::Catalog)?;
        // Every request shape the simulation will ever show is evaluated by
        // the real Cedar engine here, once.
        for template in catalog.traffic_mix.iter().chain(&catalog.scenario_requests) {
            cedar
                .evaluate(&template.request(), &[])
                .map_err(|e| BootstrapError::Catalog(format!("request `{}`: {e}", template.id)))?;
        }
        let decisions = Arc::new(
            DecisionTable::build(
                cedar.as_ref(),
                &catalog.traffic_mix,
                &catalog.scenario_requests,
            )
            .map_err(|e| BootstrapError::Catalog(e.to_string()))?,
        );

        for (i, scenario) in scenarios.iter().enumerate() {
            scenario
                .validate()
                .map_err(|message| BootstrapError::Scenario {
                    id: scenario.id.clone(),
                    message,
                })?;
            if scenarios[..i].iter().any(|other| other.id == scenario.id) {
                return Err(BootstrapError::DuplicateScenario(scenario.id.clone()));
            }
        }

        let default_topology = topologies
            .first()
            .map(|spec| spec.id.clone())
            .ok_or(BootstrapError::NoTopology)?;
        let mut worlds = BTreeMap::new();
        let mut unavailable = Vec::new();
        for spec in topologies {
            let id = spec.id.clone();
            if spec.data_source != DataSource::Synthetic {
                return Err(BootstrapError::TopologyProvenance(id));
            }
            if worlds.contains_key(&id) {
                return Err(BootstrapError::DuplicateTopology(id));
            }
            let topo = Arc::new(SimTopology::compile(spec).map_err(|source| {
                BootstrapError::Topology {
                    id: id.clone(),
                    source,
                }
            })?);
            for scenario in &scenarios {
                if let Err(reason) = check(scenario, &topo, &decisions) {
                    unavailable.push(Unavailable {
                        topology: id.clone(),
                        scenario: scenario.id.clone(),
                        reason,
                    });
                }
            }
            let resolved = Arc::new(resolve_all(&scenarios, &topo, &decisions));
            worlds.insert(
                id,
                World {
                    topo,
                    scenarios: resolved,
                },
            );
        }

        for (i, recording) in recordings.iter().enumerate() {
            recording
                .validate()
                .map_err(|message| BootstrapError::Recording {
                    id: recording.id.clone(),
                    message,
                })?;
            if recordings[..i].iter().any(|other| other.id == recording.id) {
                return Err(BootstrapError::DuplicateRecording(recording.id.clone()));
            }
            if !worlds.contains_key(&recording.topology_id) {
                return Err(BootstrapError::RecordingTopology {
                    recording: recording.id.clone(),
                    topology: recording.topology_id.clone(),
                });
            }
            if let Some(scenario) = recording
                .scenario_ids()
                .into_iter()
                .find(|id| !scenarios.iter().any(|s| &s.id == id))
            {
                return Err(BootstrapError::RecordingScenario {
                    recording: recording.id.clone(),
                    scenario,
                });
            }
            // A fault names services and connections; they have to be ones
            // the recording's own topology has.
            if let Some(world) = worlds.get(&recording.topology_id) {
                for effect in recording.faults() {
                    resolve_fault(&world.topo, effect).map_err(|message| {
                        BootstrapError::RecordingFault {
                            recording: recording.id.clone(),
                            message,
                        }
                    })?;
                }
            }
        }

        Ok(Self {
            cedar,
            catalog,
            decisions,
            worlds,
            recordings,
            default_topology,
            unavailable,
        })
    }

    pub fn world(&self, id: &str) -> Option<&World> {
        self.worlds.get(id)
    }

    /// Scenario ids, in the order they are offered.
    pub fn scenario_ids(&self) -> Vec<String> {
        self.default_world()
            .scenarios
            .iter()
            .map(|scenario| scenario.info.id.clone())
            .collect()
    }

    pub fn default_world(&self) -> &World {
        // `build` refuses to return without the default topology.
        &self.worlds[&self.default_topology]
    }
}

/// A set of sources together with what was built from it: what the server
/// runs on at one moment. Cheap to clone; nothing in it changes.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub sources: Arc<Sources>,
    pub assets: Arc<Assets>,
    pub origin: WorkspaceOrigin,
    /// Parts a workspace replaced in what it was laid over.
    pub replaced: Vec<String>,
    /// Files of the workspace that were not read.
    pub ignored: Vec<String>,
}

impl Loaded {
    /// The fixtures compiled into the binary.
    pub fn bundled() -> Result<Self, BootstrapError> {
        Self::build(
            Sources::bundled()?,
            WorkspaceOrigin::Bundled,
            Vec::new(),
            Vec::new(),
        )
    }

    pub fn build(
        sources: Sources,
        origin: WorkspaceOrigin,
        replaced: Vec<String>,
        ignored: Vec<String>,
    ) -> Result<Self, BootstrapError> {
        let assets = Arc::new(Assets::build(sources.clone())?);
        Ok(Self {
            sources: Arc::new(sources),
            assets,
            origin,
            replaced,
            ignored,
        })
    }

    pub fn status(&self, import_enabled: bool) -> WorkspaceStatus {
        let assets = &self.assets;
        // The topology that opens first, then the others by id.
        let mut topologies: Vec<TopologySummary> =
            assets.worlds.values().map(World::summary).collect();
        topologies.sort_by_key(|topology| topology.id != assets.default_topology);
        WorkspaceStatus {
            origin: self.origin,
            import_enabled,
            format_version: crate::workspace::FORMAT_VERSION,
            replaced: self.replaced.clone(),
            ignored: self.ignored.clone(),
            topologies,
            default_topology_id: assets.default_topology.clone(),
            scenario_ids: assets.scenario_ids(),
            recording_ids: assets.recordings.iter().map(|r| r.id.clone()).collect(),
            policy_count: assets.cedar.policies().len(),
            baseline_deny_fraction: assets.decisions.baseline_deny_fraction,
            unavailable: assets
                .unavailable
                .iter()
                .map(|entry| UnavailableScenario {
                    topology_id: entry.topology.clone(),
                    scenario_id: entry.scenario.clone(),
                    reason: entry.reason.clone(),
                })
                .collect(),
        }
    }
}

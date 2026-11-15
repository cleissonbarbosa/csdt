//! Application layer: wires the domain together and exposes use cases.
//!
//! [`Assets`] is everything immutable that is built once at start-up (Cedar
//! engine, compiled topologies, resolved scenarios, recordings).
//! [`SimulationService`] owns the single mutable timeline and is the only
//! place that advances it.

mod service;

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::authorization::{AuthzCatalog, CedarEngine, CedarSetupError};
use crate::domain::{AuthzError, TopologySummary};
use crate::incidents::recordings::{self, Recording};
use crate::incidents::{resolve_all, ResolvedScenario};
use crate::simulation::topologies::{self, HELIOS_ID};
use crate::simulation::{DecisionTable, SimTopology, TopologyError};

pub use service::{
    ControlAction, EvaluateEngine, EvaluateInput, ResetScope, ServiceError, SimulationService,
    StreamMessage, TimelineReason, PROTOCOL_VERSION,
};

#[derive(Debug, thiserror::Error)]
pub enum BootstrapError {
    #[error("authorization fixtures: {0}")]
    Cedar(#[from] CedarSetupError),
    #[error("fixture JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("topology `{id}`: {source}")]
    Topology { id: String, source: TopologyError },
    #[error("evaluating the request catalogue: {0}")]
    Authz(#[from] AuthzError),
    #[error("recording `{recording}` refers to unknown topology `{topology}`")]
    RecordingTopology { recording: String, topology: String },
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

#[derive(Debug)]
pub struct Assets {
    pub cedar: Arc<CedarEngine>,
    pub catalog: AuthzCatalog,
    pub decisions: Arc<DecisionTable>,
    pub worlds: BTreeMap<String, World>,
    pub recordings: Vec<Recording>,
    pub default_topology: String,
}

impl Assets {
    /// Builds everything from the fixtures compiled into the binary.
    pub fn bundled() -> Result<Self, BootstrapError> {
        let cedar = Arc::new(CedarEngine::bundled()?);
        let catalog = AuthzCatalog::bundled()?;
        // Every request shape the simulation will ever show is evaluated by
        // the real Cedar engine here, once.
        let decisions = Arc::new(DecisionTable::build(
            cedar.as_ref(),
            &catalog.traffic_mix,
            &catalog.scenario_requests,
        )?);

        let mut worlds = BTreeMap::new();
        for spec in [topologies::helios()?, topologies::stress(0xAE615)] {
            let id = spec.id.clone();
            let topo = Arc::new(
                SimTopology::compile(spec).map_err(|source| BootstrapError::Topology {
                    id: id.clone(),
                    source,
                })?,
            );
            let scenarios = Arc::new(resolve_all(&topo, &decisions));
            worlds.insert(id, World { topo, scenarios });
        }

        let recordings = recordings::bundled()?;
        for recording in &recordings {
            if !worlds.contains_key(&recording.topology_id) {
                return Err(BootstrapError::RecordingTopology {
                    recording: recording.id.clone(),
                    topology: recording.topology_id.clone(),
                });
            }
        }

        Ok(Self {
            cedar,
            catalog,
            decisions,
            worlds,
            recordings,
            default_topology: HELIOS_ID.to_string(),
        })
    }

    pub fn world(&self, id: &str) -> Option<&World> {
        self.worlds.get(id)
    }

    pub fn default_world(&self) -> &World {
        // `bundled` always registers the default topology.
        &self.worlds[&self.default_topology]
    }
}

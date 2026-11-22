//! A platform described by files that are not in use, at rest.
//!
//! What a set of files describes can be looked at as the engine runs it
//! before it is applied. The files are built the way an import builds them
//! and one of their topologies runs with nothing started and nothing placed,
//! on a timeline of its own from the service's seed, for the quiet lead-in
//! an experiment begins with. The answer is that timeline's topology and
//! snapshot at that moment, which are what the timeline in use shows once
//! the files are applied and as long has passed, and the topology as the
//! server read it, in the format a file writes it: for a Compose file or a
//! cloud inventory, the topology it was converted to. Nothing is estimated
//! and nothing is recorded. Neither the timeline nor the files in use are
//! touched.

use std::sync::Arc;

use serde::Serialize;

use crate::domain::{PlaybackStatus, TelemetrySnapshot, Topology, TopologySpec};
use crate::simulation::{DecisionTable, Timeline, TICK_MS};

use super::experiment::LEAD_IN_MS;
use super::{Loaded, World};

/// One platform of a set of files at rest. See the module.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreview {
    /// The topology with its figures at the end of the run, as
    /// `GET /topology` gives the one in use.
    pub topology: Topology,
    /// The figures at that moment, as the stream sends them. Its playback is
    /// paused: nothing advances this timeline.
    pub snapshot: TelemetrySnapshot,
    /// The topology as the server read it, in the format a file writes it.
    pub spec: TopologySpec,
}

/// Runs `world` at rest for [`LEAD_IN_MS`] from `seed`.
pub fn at_rest(world: &World, decisions: &Arc<DecisionTable>, seed: u64) -> WorkspacePreview {
    let mut timeline = Timeline::new(
        Arc::clone(&world.topo),
        Arc::clone(&world.scenarios),
        Arc::clone(decisions),
        seed,
    );
    while timeline.tick() < LEAD_IN_MS / TICK_MS {
        timeline.step();
    }
    WorkspacePreview {
        topology: timeline.topology_view(),
        snapshot: timeline.telemetry(PlaybackStatus::Paused, 1.0),
        spec: world.topo.spec.clone(),
    }
}

/// The topology of `candidate` named by `topology_id`, or the one its files
/// open on, at rest. A name the files do not give is refused with the ones
/// they do.
pub fn preview(
    candidate: &Loaded,
    topology_id: Option<&str>,
    seed: u64,
) -> Result<WorkspacePreview, String> {
    let assets = &candidate.assets;
    let id = topology_id.unwrap_or(&assets.default_topology);
    let world = assets.world(id).ok_or_else(|| {
        let given: Vec<String> = assets.worlds.keys().map(|id| format!("`{id}`")).collect();
        format!(
            "the files give no topology `{id}`; they give {}",
            given.join(", ")
        )
    })?;
    Ok(at_rest(world, &assets.decisions, seed))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn a_preview_is_the_platform_after_the_lead_in_and_the_same_every_time() {
        let loaded = Loaded::bundled().unwrap();
        let first = preview(&loaded, None, 42).unwrap();
        assert_eq!(first.topology.id, loaded.assets.default_topology);
        assert_eq!(first.snapshot.virtual_time_ms, LEAD_IN_MS);
        assert_eq!(first.snapshot.playback.status, PlaybackStatus::Paused);
        assert!(first.snapshot.incident.is_none() && first.snapshot.faults.is_empty());
        assert_eq!(first.spec, loaded.sources.topologies[0]);
        assert_eq!(preview(&loaded, None, 42).unwrap(), first);
    }

    #[test]
    fn a_topology_the_files_do_not_give_is_refused_with_the_ones_they_do() {
        let loaded = Loaded::bundled().unwrap();
        let stress = preview(&loaded, Some("hyperscale-stress"), 42).unwrap();
        assert_eq!(stress.spec.id, "hyperscale-stress");
        let refused = preview(&loaded, Some("nowhere"), 42).unwrap_err();
        assert!(refused.contains("no topology `nowhere`"), "{refused}");
        assert!(
            refused.contains("`helios-commerce`") && refused.contains("`hyperscale-stress`"),
            "{refused}"
        );
    }
}

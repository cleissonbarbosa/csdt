//! Prerecorded fictional incidents.
//!
//! A recording is not a dump of metrics. Because the engine is deterministic,
//! a recording only needs the seed and the commands that were issued: loading
//! it re-simulates the incident and yields exactly the same history every
//! time. The JSON files live in `fixtures/scenarios/`.

use serde::{Deserialize, Serialize};

use crate::domain::RecordingSummary;
use crate::simulation::engine::Command;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordedCommand {
    pub at_ms: u64,
    pub command: Command,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recording {
    pub id: String,
    pub name: String,
    pub description: String,
    pub topology_id: String,
    pub seed: u64,
    pub duration_ms: u64,
    pub commands: Vec<RecordedCommand>,
}

impl Recording {
    pub fn summary(&self) -> RecordingSummary {
        RecordingSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            topology_id: self.topology_id.clone(),
            duration_ms: self.duration_ms,
            scenario_ids: self
                .commands
                .iter()
                .filter_map(|c| match &c.command {
                    Command::StartScenario { scenario_id } => Some(scenario_id.clone()),
                    _ => None,
                })
                .collect(),
        }
    }
}

const BUNDLED: [&str; 2] = [
    include_str!("../../../../fixtures/scenarios/black-friday-flood.json"),
    include_str!("../../../../fixtures/scenarios/insider-and-outage.json"),
];

/// Recordings shipped with AEGIS.
pub fn bundled() -> Result<Vec<Recording>, serde_json::Error> {
    BUNDLED
        .iter()
        .map(|raw| serde_json::from_str(raw))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_recordings_parse_and_only_start_scenarios() {
        let recordings = bundled().expect("fixtures parse");
        assert_eq!(recordings.len(), 2);
        for recording in &recordings {
            assert!(!recording.commands.is_empty());
            assert!(recording
                .commands
                .iter()
                .all(|c| matches!(c.command, Command::StartScenario { .. })));
            assert!(recording
                .commands
                .iter()
                .all(|c| c.at_ms < recording.duration_ms));
            assert!(!recording.summary().scenario_ids.is_empty());
        }
    }
}

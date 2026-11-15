//! Prerecorded fictional incidents.
//!
//! A recording is not a dump of metrics. Because the engine is deterministic,
//! a recording only needs the seed and the commands that were issued: loading
//! it re-simulates the incident and yields exactly the same history every
//! time. The JSON files live in `fixtures/recordings/`.

use serde::{Deserialize, Serialize};

use crate::domain::{is_valid_id, RecordingSummary};
use crate::simulation::engine::Command;

use super::spec::{MAX_DURATION_MS, MAX_LIST};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordedCommand {
    pub at_ms: u64,
    pub command: Command,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recording {
    #[schemars(length(min = 1, max = crate::domain::MAX_ID_LEN), regex(pattern = "^[A-Za-z0-9_.-]+$"))]
    pub id: String,
    pub name: String,
    pub description: String,
    pub topology_id: String,
    pub seed: u64,
    #[schemars(range(min = 1, max = MAX_DURATION_MS))]
    pub duration_ms: u64,
    #[schemars(length(min = 1, max = MAX_LIST))]
    pub commands: Vec<RecordedCommand>,
}

impl Recording {
    /// Checks a recording on its own. A recording may only start and stop
    /// scenarios: the other commands put a decision or an imported event on
    /// the timeline, and those have to come from an engine or an importer,
    /// never from a file that merely says so.
    pub fn validate(&self) -> Result<(), String> {
        if !is_valid_id(&self.id) {
            return Err(format!("id `{}` is not a valid identifier", self.id));
        }
        if self.name.trim().is_empty() {
            return Err("name is empty".into());
        }
        if self.duration_ms == 0 || self.duration_ms > MAX_DURATION_MS {
            return Err(format!(
                "durationMs must be between 1 and {MAX_DURATION_MS}, got {}",
                self.duration_ms
            ));
        }
        if self.commands.is_empty() || self.commands.len() > MAX_LIST {
            return Err(format!(
                "a recording holds 1 to {MAX_LIST} commands, found {}",
                self.commands.len()
            ));
        }
        for recorded in &self.commands {
            if recorded.at_ms >= self.duration_ms {
                return Err(format!(
                    "a command at {} ms is past the end of the recording",
                    recorded.at_ms
                ));
            }
            if !matches!(
                recorded.command,
                Command::StartScenario { .. } | Command::AbortScenario {}
            ) {
                return Err(
                    "a recording may only contain `startScenario` and `abortScenario` commands"
                        .into(),
                );
            }
        }
        Ok(())
    }

    /// Scenarios the recording starts, in the order it starts them.
    pub fn scenario_ids(&self) -> Vec<String> {
        self.commands
            .iter()
            .filter_map(|c| match &c.command {
                Command::StartScenario { scenario_id } => Some(scenario_id.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn summary(&self) -> RecordingSummary {
        RecordingSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            topology_id: self.topology_id.clone(),
            duration_ms: self.duration_ms,
            scenario_ids: self.scenario_ids(),
        }
    }
}

/// File name and contents of the recordings shipped with AEGIS.
pub const FILES: [(&str, &str); 2] = [
    (
        "black-friday-flood.json",
        include_str!("../../../../fixtures/recordings/black-friday-flood.json"),
    ),
    (
        "insider-and-outage.json",
        include_str!("../../../../fixtures/recordings/insider-and-outage.json"),
    ),
];

/// Recordings shipped with AEGIS.
pub fn bundled() -> Result<Vec<Recording>, serde_json::Error> {
    FILES
        .iter()
        .map(|(_, raw)| serde_json::from_str(raw))
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
            recording.validate().expect("valid");
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

    #[test]
    fn a_recording_cannot_carry_a_decision_or_an_imported_event() {
        let mut recording = bundled().expect("fixtures parse").remove(0);
        recording.commands[0].command = Command::ImportEvents {
            provider_id: "anything".into(),
            events: Vec::new(),
        };
        let error = recording.validate().unwrap_err();
        assert!(error.contains("may only contain"), "{error}");

        let forged: Result<Recording, _> = serde_json::from_value(serde_json::json!({
            "id": "forged",
            "name": "Forged",
            "description": "",
            "topologyId": "helios-commerce",
            "seed": 1,
            "durationMs": 1000,
            "commands": [{ "atMs": 0, "command": { "type": "abortScenario" } }],
            "events": []
        }));
        assert!(forged.is_err(), "unknown fields are rejected");
    }

    #[test]
    fn a_command_takes_no_field_it_does_not_define() {
        let command = |value: serde_json::Value| serde_json::from_value::<Command>(value);
        assert!(command(serde_json::json!({ "type": "startScenario", "scenarioId": "x" })).is_ok());
        assert!(command(serde_json::json!({ "type": "abortScenario" })).is_ok());
        for extra in [
            serde_json::json!({ "type": "startScenario", "scenarioId": "x", "note": "junk" }),
            serde_json::json!({ "type": "abortScenario", "decision": {} }),
        ] {
            assert!(command(extra.clone()).is_err(), "{extra}");
        }
    }
}

//! Prerecorded fictional incidents.
//!
//! A recording is not a dump of metrics. Because the engine is deterministic,
//! a recording only needs the seed and the commands that were issued: loading
//! it re-simulates the incident and yields exactly the same history every
//! time. The JSON files live in `fixtures/recordings/`.

use serde::{Deserialize, Serialize};

use crate::domain::{is_valid_id, RecordingSummary};
use crate::simulation::engine::{Command, MAX_FAULT_RAMP_MS};

use super::spec::{Effect, MAX_DURATION_MS, MAX_LIST};

/// Most commands a session saved from the interface may hold. A recording
/// file is held to the smaller [`MAX_LIST`].
pub const MAX_SESSION_COMMANDS: usize = 512;

/// A fault in a recording is held to what one placed through the interface
/// is: figures in range, and an effect that means something outside a
/// scenario.
fn check_fault(effect: &Effect) -> Result<(), String> {
    if !effect.is_fault() {
        return Err("a fault cannot be an effect on a scenario's own flow".into());
    }
    effect.validate().map_err(|e| format!("fault: {e}"))
}

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
    /// Checks a recording on its own. A recording may start and stop
    /// scenarios and place and lift faults: the other command puts a
    /// decision on the timeline, and a decision has to come from Cedar,
    /// never from a file that merely says so.
    pub fn validate(&self) -> Result<(), String> {
        self.check(1, MAX_LIST)
    }

    /// Checks a session: a timeline written out by the server and handed
    /// back. It is held to what a recording file is, except that it may
    /// hold no command at all (time simply passed) and more of them.
    pub fn validate_session(&self) -> Result<(), String> {
        self.check(0, MAX_SESSION_COMMANDS)
    }

    fn check(&self, fewest: usize, most: usize) -> Result<(), String> {
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
        if self.commands.len() < fewest || self.commands.len() > most {
            return Err(format!(
                "a recording holds {fewest} to {most} commands, found {}",
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
            match &recorded.command {
                Command::StartScenario { .. } | Command::AbortScenario {} => {}
                Command::InjectFault { effect, ramp_ms } => {
                    check_fault(effect)?;
                    if *ramp_ms > MAX_FAULT_RAMP_MS {
                        return Err(format!(
                            "a fault's rampMs must be at most {MAX_FAULT_RAMP_MS}, got {ramp_ms}"
                        ));
                    }
                }
                Command::ClearFaults { effect } => {
                    if let Some(effect) = effect {
                        check_fault(effect)?;
                    }
                }
                Command::RecordDecision { .. } => {
                    return Err(
                        "a recording may only contain `startScenario`, `abortScenario`, `injectFault` and `clearFaults` commands"
                            .into(),
                    );
                }
            }
        }
        Ok(())
    }

    /// The faults the recording places or lifts by hand, in order. Whether
    /// each names something a topology has is checked against that topology.
    pub fn faults(&self) -> impl Iterator<Item = &Effect> {
        self.commands.iter().filter_map(|c| match &c.command {
            Command::InjectFault { effect, .. } => Some(effect),
            Command::ClearFaults { effect } => effect.as_ref(),
            _ => None,
        })
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
    use crate::domain::{
        AuthorizationDecision, AuthorizationRequest, DataSource, Decision, EngineInfo, EngineKind,
    };

    /// A decision no engine made, as a file would have to state it.
    fn forged_decision() -> AuthorizationDecision {
        AuthorizationDecision {
            id: "dec-1".into(),
            virtual_time_ms: 0,
            request: AuthorizationRequest {
                principal: "User::\"anyone\"".into(),
                action: "Action::\"read\"".into(),
                resource: "Resource::\"anything\"".into(),
                context: serde_json::Map::new(),
            },
            decision: Decision::Allow,
            determining_policies: Vec::new(),
            errors: Vec::new(),
            engine: EngineInfo {
                kind: EngineKind::EmbeddedCedar,
                version: None,
            },
            evaluation_micros: 0,
            path: Vec::new(),
            hops: Vec::new(),
            blocked_at: None,
            disabled_policies: Vec::new(),
            data_source: DataSource::Synthetic,
        }
    }

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
    fn a_recording_cannot_carry_a_decision() {
        let mut recording = bundled().expect("fixtures parse").remove(0);
        recording.commands[0].command = Command::RecordDecision {
            decision: Box::new(forged_decision()),
        };
        let error = recording.validate().unwrap_err();
        assert!(error.contains("may only contain"), "{error}");
        let error = recording.validate_session().unwrap_err();
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

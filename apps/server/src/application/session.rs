//! A timeline written out as what reproduces it.
//!
//! Because the engine is deterministic, the history on screen is fully
//! described by a topology, a seed and the commands that were issued: the
//! same three things a recording file holds. A session is the timeline in
//! use in that form, to be saved, sent to someone and loaded again.
//!
//! What a recording may not carry is left out and counted: a decision or an
//! imported event has to come from an engine or an importer, never from a
//! file that says so.

use serde::Serialize;

use crate::domain::{WorkspaceOrigin, SCHEMA_VERSION};
use crate::incidents::recordings::{RecordedCommand, Recording, MAX_SESSION_COMMANDS};
use crate::simulation::{Command, Timeline, TICK_MS};

/// Commands of the timeline that a session does not carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Omitted {
    /// Authorization decisions evaluated on demand.
    pub decisions: usize,
    /// Batches of events imported from an integration.
    pub imported_events: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExport {
    pub schema_version: &'static str,
    /// The timeline as a seed and a command list.
    pub recording: Recording,
    /// Where the cursor is.
    pub cursor_ms: u64,
    pub omitted: Omitted,
    /// False when loading the recording would not give this history back.
    pub reproducible: bool,
    /// Why not, when it would not.
    pub note: Option<String>,
    /// Where the files the timeline runs on came from. Anything but
    /// `bundled` has to travel with the session.
    pub workspace_origin: WorkspaceOrigin,
}

/// Writes a timeline out as a session.
pub fn export(timeline: &Timeline, workspace_origin: WorkspaceOrigin) -> SessionExport {
    let mut omitted = Omitted::default();
    let mut commands = Vec::new();
    for (tick, command) in timeline.commands() {
        match command {
            Command::RecordDecision { .. } => omitted.decisions += 1,
            Command::ImportEvents { .. } => omitted.imported_events += 1,
            command => commands.push(RecordedCommand {
                at_ms: tick * TICK_MS,
                command: command.clone(),
            }),
        }
    }
    let note = if timeline.window_start_tick() > 0 {
        Some("the beginning of this timeline is older than the history that is kept".to_string())
    } else if commands.len() > MAX_SESSION_COMMANDS {
        Some(format!(
            "this timeline holds {} commands; a session carries at most {MAX_SESSION_COMMANDS}",
            commands.len()
        ))
    } else {
        None
    };
    commands.truncate(MAX_SESSION_COMMANDS);
    // A command issued at the head has not been simulated yet; the
    // recording has to last one tick past it for it to count.
    let last = commands.last().map_or(0, |c| c.at_ms + TICK_MS);
    SessionExport {
        schema_version: SCHEMA_VERSION,
        recording: Recording {
            id: "session".to_string(),
            name: "Session".to_string(),
            description: String::new(),
            topology_id: timeline.topology().spec.id.clone(),
            seed: timeline.seed(),
            duration_ms: (timeline.head_tick() * TICK_MS).max(last).max(TICK_MS),
            commands,
        },
        cursor_ms: timeline.tick() * TICK_MS,
        omitted,
        reproducible: note.is_none(),
        note,
        workspace_origin,
    }
}

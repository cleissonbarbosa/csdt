use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Playing,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackMode {
    /// The cursor is at the head of the timeline; new history is being made.
    Live,
    /// The cursor is inside recorded history and re-simulates it.
    Replay,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub status: PlaybackStatus,
    pub mode: PlaybackMode,
    pub speed: f64,
    pub tick: u64,
    pub virtual_time_ms: u64,
    pub head_tick: u64,
    pub head_time_ms: u64,
    /// Earliest point that can still be sought to.
    pub window_start_ms: u64,
    pub tick_ms: u64,
    pub recording_id: Option<String>,
}

/// Speeds the timeline accepts.
pub const PLAYBACK_SPEEDS: [f64; 4] = [0.5, 1.0, 2.0, 4.0];

//! Deterministic, event-driven simulation of a distributed platform.
//!
//! * [`model`] — compiled topology and the flow-propagation maths.
//! * [`channels`] — ramped effect channels scenarios use to bend the model.
//! * [`engine`] — the pure per-tick step function and its state.
//! * [`timeline`] — command log, checkpoints, seek, replay and branching.
//! * [`decisions`] — precomputed Cedar outcomes consumed by the engine.
//! * [`report`] — an incident read back from the timeline it ran on.
//! * [`topologies`] — bundled synthetic topologies.

pub mod channels;
pub mod decisions;
pub mod engine;
pub mod math;
pub mod model;
pub mod report;
pub mod rng;
pub mod timeline;
pub mod topologies;

pub use decisions::{DecisionTable, RequestTemplate};
pub use engine::{Command, SimState};
pub use model::{SimTopology, TopologyError, TICK_MS};
pub use timeline::Timeline;

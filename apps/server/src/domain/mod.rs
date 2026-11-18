//! Domain model: the versioned data contracts AEGIS owns.
//!
//! Nothing in here knows about HTTP, WebSockets, Cedar or the simulation
//! internals. Every type serialises to the camelCase JSON documented in
//! `packages/contracts`.

pub mod authorization;
pub mod events;
pub mod incident;
pub mod integration;
pub mod playback;
pub mod telemetry;
pub mod topology;
pub mod workspace;

pub use authorization::*;
pub use events::*;
pub use incident::*;
pub use integration::*;
pub use playback::*;
pub use telemetry::*;
pub use topology::*;
pub use workspace::*;

/// Version of the JSON contracts. Bumped on any breaking change.
pub const SCHEMA_VERSION: &str = "1.0";

/// Longest identifier a topology, scenario or recording file may declare.
pub const MAX_ID_LEN: usize = 64;

/// True for identifiers made of ASCII letters, digits, `-`, `_` and `.`.
/// The same identifiers travel in URLs and in edge ids (`source->target`),
/// so nothing else is accepted from a file.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// Provenance of a piece of data. AEGIS never presents one as another.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    serde::Serialize,
    serde::Deserialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum DataSource {
    /// Produced by the internal simulation engine.
    Synthetic,
    /// Not produced by the simulation: an incident capture the browser
    /// reads from a file, either measurements a system recorded or a
    /// provider's report transcribed by hand. The server never emits it,
    /// and a workspace topology may not claim it.
    Recording,
    /// Measured from an explicitly connected local instance.
    Live,
}

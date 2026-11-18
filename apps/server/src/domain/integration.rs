use serde::{Deserialize, Serialize};

use super::DataSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IntegrationKind {
    /// The built-in simulation engine.
    Simulation,
    /// A network connection to an explicitly configured local instance.
    LiveAdapter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IntegrationState {
    /// Always on (the simulation).
    Active,
    /// Not configured on the server; cannot be connected from the UI.
    NotConfigured,
    /// Configured or bundled, waiting for the operator to opt in.
    Available,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationMetric {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    pub id: String,
    pub name: String,
    pub kind: IntegrationKind,
    pub state: IntegrationState,
    /// Provenance of the data this integration contributes.
    pub data_source: DataSource,
    pub description: String,
    /// Public repository the integration is built against, if any.
    pub repository: Option<String>,
    /// The interface that was verified in that repository.
    pub verified_interface: Option<String>,
    /// Target the adapter talks to. Never contains credentials.
    pub endpoint: Option<String>,
    pub capabilities: Vec<String>,
    pub metrics: Vec<IntegrationMetric>,
    pub last_error: Option<String>,
}

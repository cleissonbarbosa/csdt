//! What the operator configured for each live adapter. Plain data, kept
//! apart from the adapters themselves so that reading the configuration needs
//! no network client.

use std::time::Duration;

/// How often the rinha adapter probes unless told otherwise.
pub const DEFAULT_PROBE_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct CedarAgentConfig {
    pub base_url: String,
    pub token: Option<String>,
    /// Upload AEGIS' synthetic policies and entities on connect.
    pub sync: bool,
}

impl std::fmt::Debug for CedarAgentConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print the token.
        f.debug_struct("CedarAgentConfig")
            .field("base_url", &self.base_url)
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .field("sync", &self.sync)
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct RinhaConfig {
    pub base_url: String,
    pub probe_interval: Duration,
}

impl RinhaConfig {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url,
            probe_interval: DEFAULT_PROBE_INTERVAL,
        }
    }
}

/// Integration settings read from the environment.
#[derive(Debug, Clone, Default)]
pub struct IntegrationConfig {
    pub cedar_agent: Option<CedarAgentConfig>,
    pub rinha: Option<RinhaConfig>,
    pub allowed_hosts: Vec<String>,
}

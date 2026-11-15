//! Adapters for the public personal projects AEGIS can work with.
//!
//! Every adapter implements [`TelemetryProvider`]. Three kinds exist and are
//! never presented as one another:
//!
//! * the built-in simulation (always on, `DataSource::Synthetic`);
//! * live adapters that talk to an explicitly configured local instance
//!   (`DataSource::Live`), only after the operator opts in;
//! * fixture adapters that parse a bundled file in a public project's format
//!   (`DataSource::Recording`).
//!
//! See `docs/INTEGRATIONS.md` for what was verified in each repository.

pub mod cedar_agent;
pub mod guard;
pub mod network_scanner;
pub mod rinha;
pub mod security_alerts;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use crate::domain::{
    DataSource, ImportedEvent, IntegrationKind, IntegrationState, IntegrationStatus,
};

pub use cedar_agent::{CedarAgentConfig, CedarAgentProvider};
pub use network_scanner::NetworkScannerFixtureProvider;
pub use rinha::{RinhaConfig, RinhaProbeProvider};
pub use security_alerts::SecurityAlertFixtureProvider;

/// Timeout applied to every outbound integration request.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
/// Largest response body an adapter will read.
pub const MAX_RESPONSE_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum ProviderError {
    #[error("this integration is not configured on the server")]
    NotConfigured,
    #[error("target refused: {0}")]
    Refused(String),
    #[error("target unreachable: {0}")]
    Unreachable(String),
    #[error("unexpected response: {0}")]
    Protocol(String),
    #[error("{0}")]
    Unsupported(&'static str),
    #[error("unknown provider `{0}`")]
    Unknown(String),
}

/// What connecting a provider contributed to the timeline.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ConnectOutcome {
    pub events: Vec<ImportedEvent>,
}

#[async_trait]
pub trait TelemetryProvider: Send + Sync {
    fn id(&self) -> &'static str;

    async fn status(&self) -> IntegrationStatus;

    /// Opt in. Live adapters open their connection; fixture adapters parse
    /// their file and return the events to import.
    async fn connect(&self) -> Result<ConnectOutcome, ProviderError>;

    async fn disconnect(&self) -> Result<(), ProviderError>;
}

/// Builds the HTTP client shared by live adapters: short timeout, no
/// redirects and no ambient proxy configuration.
pub fn http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .user_agent(concat!("aegis-server/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// Reads a response body, refusing anything larger than the adapter limit.
pub async fn read_limited(response: reqwest::Response) -> Result<Vec<u8>, ProviderError> {
    if response
        .content_length()
        .is_some_and(|len| len as usize > MAX_RESPONSE_BYTES)
    {
        return Err(ProviderError::Protocol("response body too large".into()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| ProviderError::Unreachable(sanitize(&e)))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(ProviderError::Protocol("response body too large".into()));
    }
    Ok(bytes.to_vec())
}

/// Describes a transport error without echoing URLs (which could carry
/// operator configuration) into logs or API responses.
pub fn sanitize(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "request timed out".into()
    } else if error.is_connect() {
        "connection refused or host unreachable".into()
    } else if error.is_decode() {
        "response could not be decoded".into()
    } else {
        "request failed".into()
    }
}

/// The simulation itself, listed alongside the other providers.
#[derive(Debug, Default)]
pub struct DemoSimulationProvider;

#[async_trait]
impl TelemetryProvider for DemoSimulationProvider {
    fn id(&self) -> &'static str {
        "demo-simulation"
    }

    async fn status(&self) -> IntegrationStatus {
        IntegrationStatus {
            id: self.id().into(),
            name: "Demo Simulation".into(),
            kind: IntegrationKind::Simulation,
            state: IntegrationState::Active,
            data_source: DataSource::Synthetic,
            description: "Deterministic simulation engine built into the AEGIS server. Every node, metric and incident it produces is synthetic.".into(),
            repository: None,
            verified_interface: None,
            endpoint: None,
            capabilities: vec![
                "topology".into(),
                "telemetry".into(),
                "incidents".into(),
                "time travel".into(),
            ],
            metrics: Vec::new(),
            last_error: None,
        }
    }

    async fn connect(&self) -> Result<ConnectOutcome, ProviderError> {
        Ok(ConnectOutcome::default())
    }

    async fn disconnect(&self) -> Result<(), ProviderError> {
        Err(ProviderError::Unsupported(
            "the demo simulation cannot be disconnected",
        ))
    }
}

/// Integration settings read from the environment.
#[derive(Debug, Clone, Default)]
pub struct IntegrationConfig {
    pub cedar_agent: Option<CedarAgentConfig>,
    pub rinha: Option<RinhaConfig>,
    pub allowed_hosts: Vec<String>,
}

pub struct ProviderRegistry {
    providers: Vec<Arc<dyn TelemetryProvider>>,
    cedar_agent: Arc<CedarAgentProvider>,
}

impl ProviderRegistry {
    pub fn new(config: &IntegrationConfig) -> Result<Self, reqwest::Error> {
        let client = http_client()?;
        let cedar_agent = Arc::new(CedarAgentProvider::new(
            config.cedar_agent.clone(),
            &config.allowed_hosts,
            client.clone(),
        ));
        let providers: Vec<Arc<dyn TelemetryProvider>> = vec![
            Arc::new(DemoSimulationProvider),
            Arc::clone(&cedar_agent) as Arc<dyn TelemetryProvider>,
            Arc::new(RinhaProbeProvider::new(
                config.rinha.clone(),
                &config.allowed_hosts,
                client,
            )),
            Arc::new(NetworkScannerFixtureProvider::default()),
            Arc::new(SecurityAlertFixtureProvider::default()),
        ];
        Ok(Self {
            providers,
            cedar_agent,
        })
    }

    pub fn cedar_agent(&self) -> &Arc<CedarAgentProvider> {
        &self.cedar_agent
    }

    pub fn get(&self, id: &str) -> Result<&Arc<dyn TelemetryProvider>, ProviderError> {
        self.providers
            .iter()
            .find(|p| p.id() == id)
            .ok_or_else(|| ProviderError::Unknown(id.to_string()))
    }

    pub async fn statuses(&self) -> Vec<IntegrationStatus> {
        let mut statuses = Vec::with_capacity(self.providers.len());
        for provider in &self.providers {
            statuses.push(provider.status().await);
        }
        statuses
    }
}

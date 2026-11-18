//! AEGIS server.
//!
//! Layering, innermost first:
//!
//! * [`domain`] — versioned data contracts and ports. No I/O.
//! * [`simulation`] / [`incidents`] — the deterministic engine, its timeline
//!   and the declarative incident scenarios. No I/O.
//! * [`authorization`] — embedded Cedar policy decision point.
//! * [`integrations`] — adapters for explicitly configured local instances of
//!   public projects.
//! * [`application`] — use cases; owns the single mutable timeline.
//! * [`workspace`] — reads an operator's own topologies, scenarios and
//!   policies from a directory, once, at start-up.
//! * [`api`] — HTTP and WebSocket shell.
//! * [`config`] — environment configuration.

pub mod api;
pub mod application;
pub mod authorization;
pub mod clock;
pub mod config;
pub mod domain;
pub mod incidents;
pub mod integrations;
pub mod simulation;
pub mod workspace;

use std::sync::Arc;

use api::AppState;
#[cfg(not(target_arch = "wasm32"))]
use api::Limits;
use application::{BootstrapError, Loaded, SimulationService};
use clock::Instant;
use config::Config;
#[cfg(not(target_arch = "wasm32"))]
use domain::WorkspaceOrigin;
use integrations::ProviderRegistry;

#[derive(Debug, thiserror::Error)]
pub enum StartupError {
    #[error(transparent)]
    Bootstrap(#[from] BootstrapError),
    #[cfg(not(target_arch = "wasm32"))]
    #[error("building the HTTP client: {0}")]
    HttpClient(#[from] reqwest::Error),
    #[error("workspace: {0}")]
    Workspace(#[from] workspace::WorkspaceError),
    #[error("configuration: {0}")]
    Config(config::ConfigError),
}

/// Builds the application state of an engine with no network and no file
/// system: the bundled fixtures, the default configuration, and only the
/// providers that need neither. This is what runs in the browser; time is
/// advanced by whoever holds it, through [`SimulationService::advance`].
pub fn build_offline_state(seed: u64) -> Result<AppState, StartupError> {
    let mut config = Config::from_lookup(|_| None).map_err(StartupError::Config)?;
    config.seed = seed;
    let service = SimulationService::new(Loaded::bundled()?, seed);
    Ok(AppState {
        service,
        providers: Arc::new(ProviderRegistry::offline()),
        config: Arc::new(config),
        #[cfg(not(target_arch = "wasm32"))]
        limits: Arc::new(Limits::default()),
        started: Instant::now(),
    })
}

/// Builds the shared application state. Does not start the scheduler; call
/// [`SimulationService::spawn`] for that.
#[cfg(not(target_arch = "wasm32"))]
pub fn build_state(config: Config) -> Result<AppState, StartupError> {
    let loaded = match &config.workspace {
        Some(path) => {
            let read = workspace::load(path)?;
            tracing::info!(
                workspace = %path.display(),
                replaced = ?read.replaced,
                ignored = read.ignored.len(),
                "workspace loaded"
            );
            read.build(WorkspaceOrigin::Startup)?
        }
        None => Loaded::bundled()?,
    };
    let providers = Arc::new(ProviderRegistry::new(
        &config.integrations,
        loaded.assets.cedar.documents(),
        loaded.assets.cedar.entities_json().clone(),
    )?);
    let service = SimulationService::new(loaded, config.seed);
    Ok(AppState {
        service,
        providers,
        config: Arc::new(config),
        limits: Arc::new(Limits::default()),
        started: Instant::now(),
    })
}

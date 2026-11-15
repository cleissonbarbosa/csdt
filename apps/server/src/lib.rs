//! AEGIS server.
//!
//! Layering, innermost first:
//!
//! * [`domain`] — versioned data contracts and ports. No I/O.
//! * [`simulation`] / [`incidents`] — the deterministic engine, its timeline
//!   and the declarative incident scenarios. No I/O.
//! * [`authorization`] — embedded Cedar policy decision point.
//! * [`integrations`] — adapters for explicitly configured local instances of
//!   public projects, and fixture parsers.
//! * [`application`] — use cases; owns the single mutable timeline.
//! * [`api`] — HTTP and WebSocket shell.
//! * [`config`] — environment configuration.

pub mod api;
pub mod application;
pub mod authorization;
pub mod config;
pub mod domain;
pub mod incidents;
pub mod integrations;
pub mod simulation;

use std::sync::Arc;
use std::time::Instant;

use api::{AppState, Limits};
use application::{Assets, BootstrapError, SimulationService};
use config::Config;
use integrations::ProviderRegistry;

#[derive(Debug, thiserror::Error)]
pub enum StartupError {
    #[error(transparent)]
    Bootstrap(#[from] BootstrapError),
    #[error("building the HTTP client: {0}")]
    HttpClient(#[from] reqwest::Error),
}

/// Builds the shared application state. Does not start the scheduler; call
/// [`SimulationService::spawn`] for that.
pub fn build_state(config: Config) -> Result<AppState, StartupError> {
    let assets = Arc::new(Assets::bundled()?);
    let service = SimulationService::new(assets, config.seed);
    let providers = Arc::new(ProviderRegistry::new(&config.integrations)?);
    Ok(AppState {
        service,
        providers,
        config: Arc::new(config),
        limits: Arc::new(Limits::default()),
        started: Instant::now(),
    })
}

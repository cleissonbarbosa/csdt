//! Adapter for a local instance of the public `rinha-backend-2026` project
//! (<https://github.com/cleissonbarbosa/rinha-backend-2026>, and its Rust
//! sibling `rinha-backend-2026-rust`).
//!
//! What the repositories expose (`src/server.nim`, `api/src/http.rs`,
//! `docker-compose.yml`): a load balancer on port 9999 in front of two API
//! instances, answering `GET /ready` and `POST /fraud-score`. There is no
//! metrics, Prometheus or OpenTelemetry endpoint, and no benchmark results are
//! published in the repositories.
//!
//! This adapter therefore does the one honest thing available: it issues
//! read-only `GET /ready` probes at a low, fixed rate and reports what *it*
//! measured (availability and round-trip time of those probes). It never
//! sends `POST /fraud-score`, never generates load and never reports a
//! throughput figure, because none can be observed from outside.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::task::AbortHandle;

use crate::domain::{
    DataSource, IntegrationKind, IntegrationMetric, IntegrationState, IntegrationStatus,
};

use super::guard::{validate_target, Target};
pub use super::settings::RinhaConfig;
use super::{sanitize, ProviderError, TelemetryProvider};

pub const PROVIDER_ID: &str = "rinha-backend";
const REPOSITORY: &str = "https://github.com/cleissonbarbosa/rinha-backend-2026";
/// Probes are never issued more often than this.
pub const MIN_PROBE_INTERVAL: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(16);
const WINDOW: usize = 60;

#[derive(Debug, Default)]
struct ProbeState {
    state: Option<IntegrationState>,
    last_error: Option<String>,
    probes: u64,
    successes: u64,
    /// Round-trip times of the most recent successful probes, in ms.
    latencies_ms: VecDeque<f64>,
    task: Option<AbortHandle>,
}

impl ProbeState {
    fn record(&mut self, outcome: Result<f64, ProviderError>) {
        self.probes += 1;
        match outcome {
            Ok(latency) => {
                self.successes += 1;
                self.latencies_ms.push_back(latency);
                while self.latencies_ms.len() > WINDOW {
                    self.latencies_ms.pop_front();
                }
                self.state = Some(IntegrationState::Connected);
                self.last_error = None;
            }
            Err(error) => {
                self.state = Some(IntegrationState::Error);
                self.last_error = Some(error.to_string());
            }
        }
    }

    fn percentile(&self, q: f64) -> Option<f64> {
        if self.latencies_ms.is_empty() {
            return None;
        }
        let mut sorted: Vec<f64> = self.latencies_ms.iter().copied().collect();
        sorted.sort_by(f64::total_cmp);
        let rank = ((sorted.len() - 1) as f64 * q).round() as usize;
        Some(sorted[rank])
    }
}

pub struct RinhaProbeProvider {
    target: Result<Option<(Target, Duration)>, ProviderError>,
    client: reqwest::Client,
    state: Arc<Mutex<ProbeState>>,
}

/// One `GET /ready` round trip. Succeeds only on `200 {"ready":true}`.
async fn probe(client: &reqwest::Client, url: &str) -> Result<f64, ProviderError> {
    let started = Instant::now();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| ProviderError::Unreachable(sanitize(&e)))?;
    let status = response.status();
    let body = super::read_limited(response).await?;
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    if !status.is_success() {
        return Err(ProviderError::Protocol(format!(
            "GET /ready answered HTTP {}",
            status.as_u16()
        )));
    }
    let ready = serde_json::from_slice::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("ready").and_then(serde_json::Value::as_bool));
    match ready {
        Some(true) => Ok(elapsed),
        Some(false) => Err(ProviderError::Protocol("instance reports not ready".into())),
        None => Err(ProviderError::Protocol(
            "response is not `{\"ready\": <bool>}`".into(),
        )),
    }
}

fn lock(state: &Mutex<ProbeState>) -> std::sync::MutexGuard<'_, ProbeState> {
    state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl RinhaProbeProvider {
    pub fn new(
        config: Option<RinhaConfig>,
        allowed_hosts: &[String],
        client: reqwest::Client,
    ) -> Self {
        let target = match config {
            None => Ok(None),
            Some(config) => validate_target(&config.base_url, allowed_hosts)
                .map(|target| Some((target, config.probe_interval.max(MIN_PROBE_INTERVAL)))),
        };
        Self {
            target,
            client,
            state: Arc::new(Mutex::new(ProbeState::default())),
        }
    }

    fn configured(&self) -> Result<&(Target, Duration), ProviderError> {
        match &self.target {
            Ok(Some(pair)) => Ok(pair),
            Ok(None) => Err(ProviderError::NotConfigured),
            Err(error) => Err(error.clone()),
        }
    }
}

impl Drop for RinhaProbeProvider {
    fn drop(&mut self) {
        if let Some(task) = lock(&self.state).task.take() {
            task.abort();
        }
    }
}

#[async_trait]
impl TelemetryProvider for RinhaProbeProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    async fn status(&self) -> IntegrationStatus {
        let state = lock(&self.state);
        let (derived_state, endpoint, config_error) = match &self.target {
            Ok(Some((target, _))) => (
                state.state.unwrap_or(IntegrationState::Available),
                Some(target.display()),
                None,
            ),
            Ok(None) => (IntegrationState::NotConfigured, None, None),
            Err(error) => (IntegrationState::Error, None, Some(error.to_string())),
        };
        let mut metrics = Vec::new();
        if state.probes > 0 {
            metrics.push(IntegrationMetric {
                label: "Readiness probes".into(),
                value: format!("{} of {} succeeded", state.successes, state.probes),
            });
        }
        if let (Some(p50), Some(p95)) = (state.percentile(0.5), state.percentile(0.95)) {
            metrics.push(IntegrationMetric {
                label: "Probe round trip (p50 / p95)".into(),
                value: format!("{p50:.2} ms / {p95:.2} ms"),
            });
            metrics.push(IntegrationMetric {
                label: "Sample window".into(),
                value: format!("last {} probes", state.latencies_ms.len()),
            });
        }
        IntegrationStatus {
            id: PROVIDER_ID.into(),
            name: "Rinha de Backend 2026".into(),
            kind: IntegrationKind::LiveAdapter,
            state: derived_state,
            data_source: DataSource::Live,
            description: "Read-only readiness probe of a local fraud-scoring stack (load balancer in front of two API instances). Reports only what AEGIS itself measures.".into(),
            repository: Some(REPOSITORY.into()),
            verified_interface: Some("GET /ready → {\"ready\": true}".into()),
            endpoint,
            capabilities: vec!["availability".into(), "probe latency".into()],
            metrics,
            last_error: config_error.or_else(|| state.last_error.clone()),
        }
    }

    async fn connect(&self) -> Result<(), ProviderError> {
        let (target, interval) = self.configured()?.clone();
        let url = target.url("/ready");
        {
            let mut state = lock(&self.state);
            if let Some(task) = state.task.take() {
                task.abort();
            }
            *state = ProbeState {
                state: Some(IntegrationState::Connecting),
                ..ProbeState::default()
            };
        }
        // The first probe decides whether connecting succeeded.
        let first = probe(&self.client, &url).await;
        let failure = first.clone().err();
        lock(&self.state).record(first);

        // Keep probing either way: an instance that comes up later is picked
        // up automatically, with exponential backoff while it is unreachable.
        let client = self.client.clone();
        let shared = Arc::clone(&self.state);
        let task = tokio::spawn(async move {
            let mut delay = interval;
            loop {
                tokio::time::sleep(delay).await;
                let outcome = probe(&client, &url).await;
                delay = if outcome.is_ok() {
                    interval
                } else {
                    (delay * 2).min(MAX_BACKOFF)
                };
                lock(&shared).record(outcome);
            }
        });
        lock(&self.state).task = Some(task.abort_handle());

        match failure {
            None => Ok(()),
            Some(error) => Err(error),
        }
    }

    async fn disconnect(&self) -> Result<(), ProviderError> {
        self.configured()?;
        let mut state = lock(&self.state);
        if let Some(task) = state.task.take() {
            task.abort();
        }
        *state = ProbeState::default();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_come_from_recorded_probes_only() {
        let mut state = ProbeState::default();
        assert_eq!(state.percentile(0.5), None);
        for latency in [4.0, 1.0, 3.0, 2.0, 5.0] {
            state.record(Ok(latency));
        }
        state.record(Err(ProviderError::Unreachable("x".into())));
        assert_eq!(state.probes, 6);
        assert_eq!(state.successes, 5);
        assert_eq!(state.percentile(0.5), Some(3.0));
        assert_eq!(state.percentile(1.0), Some(5.0));
        assert_eq!(state.state, Some(IntegrationState::Error));
    }

    #[test]
    fn window_is_bounded() {
        let mut state = ProbeState::default();
        for i in 0..500 {
            state.record(Ok(f64::from(i)));
        }
        assert_eq!(state.latencies_ms.len(), WINDOW);
    }

    #[test]
    fn probe_interval_has_a_floor() {
        let config = RinhaConfig {
            base_url: "http://127.0.0.1:9999".into(),
            probe_interval: Duration::from_millis(1),
        };
        let provider = RinhaProbeProvider::new(Some(config), &[], reqwest::Client::new());
        let (_, interval) = provider.configured().expect("configured");
        assert_eq!(*interval, MIN_PROBE_INTERVAL);
    }
}

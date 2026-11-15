//! HTTP and WebSocket API (`/api/v1`).
//!
//! The API is a thin shell: it validates input, enforces limits and maps
//! domain errors to status codes. Everything else lives in the application
//! and domain layers.

pub mod error;
pub mod rate_limit;
mod routes;
mod ws;

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::DefaultBodyLimit;
use axum::http::{header, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use tokio::sync::Semaphore;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::application::SimulationService;
use crate::config::Config;
use crate::integrations::ProviderRegistry;

use error::ApiError;
use rate_limit::RateLimiter;

/// Largest request body accepted by any endpoint but the two below.
pub const MAX_BODY_BYTES: usize = 16 * 1024;
/// Largest body of a workspace check or import: the files themselves.
pub const MAX_IMPORT_BYTES: usize = 8 * 1024 * 1024;
/// Concurrent WebSocket subscribers.
pub const MAX_STREAMS: usize = 64;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Limits {
    /// Reads: generous, they are cheap.
    pub read: RateLimiter,
    /// Mutations: a small burst, then a slow trickle.
    pub write: RateLimiter,
    pub streams: Arc<Semaphore>,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            read: RateLimiter::new(240, 120.0),
            write: RateLimiter::new(40, 8.0),
            streams: Arc::new(Semaphore::new(MAX_STREAMS)),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub service: Arc<SimulationService>,
    pub providers: Arc<ProviderRegistry>,
    pub config: Arc<Config>,
    pub limits: Arc<Limits>,
    pub started: Instant,
}

fn security_header(name: &'static str, value: &'static str) -> SetResponseHeaderLayer<HeaderValue> {
    SetResponseHeaderLayer::overriding(
        HeaderName::from_static(name),
        HeaderValue::from_static(value),
    )
}

pub fn router(state: AppState) -> Router {
    let origins: Vec<HeaderValue> = state
        .config
        .allowed_origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE])
        .max_age(Duration::from_secs(600));

    let api = Router::new()
        .route("/health", get(routes::health))
        .route("/topology", get(routes::topology))
        .route("/topologies", get(routes::topologies))
        .route("/metrics", get(routes::metrics))
        .route("/events", get(routes::events))
        .route("/incidents", get(routes::incidents))
        .route("/scenarios", get(routes::scenarios))
        .route("/recordings", get(routes::recordings))
        .route("/providers", get(routes::providers))
        .route("/providers/{id}/connect", post(routes::provider_connect))
        .route(
            "/providers/{id}/disconnect",
            post(routes::provider_disconnect),
        )
        .route("/demo/scenarios/start", post(routes::scenario_start))
        .route("/demo/scenarios/reset", post(routes::scenario_reset))
        .route("/demo/playback/control", post(routes::playback_control))
        .route("/demo/topology/select", post(routes::topology_select))
        .route("/demo/recordings/load", post(routes::recording_load))
        .route("/workspace", get(routes::workspace))
        .route("/workspace/export", get(routes::workspace_export))
        .route(
            "/demo/workspace/check",
            post(routes::workspace_check).layer(DefaultBodyLimit::max(MAX_IMPORT_BYTES)),
        )
        .route(
            "/demo/workspace/import",
            post(routes::workspace_import).layer(DefaultBodyLimit::max(MAX_IMPORT_BYTES)),
        )
        .route("/demo/workspace/reset", post(routes::workspace_reset))
        .route(
            "/demo/authorization/catalog",
            get(routes::authorization_catalog),
        )
        .route(
            "/demo/authorization/decisions",
            get(routes::authorization_decisions),
        )
        .route(
            "/demo/authorization/evaluate",
            post(routes::authorization_evaluate),
        )
        .route("/stream", get(ws::stream))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            rate_limit::enforce,
        ));

    Router::new()
        .nest("/api/v1", api)
        .fallback(|| async { ApiError::not_found("no such route") })
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            REQUEST_TIMEOUT,
        ))
        // The API only ever returns JSON; nothing may be framed, sniffed or cached.
        .layer(security_header("x-content-type-options", "nosniff"))
        .layer(security_header("x-frame-options", "DENY"))
        .layer(security_header("referrer-policy", "no-referrer"))
        .layer(security_header(
            "content-security-policy",
            "default-src 'none'; frame-ancestors 'none'",
        ))
        .layer(security_header("cache-control", "no-store"))
        .layer(cors)
        .layer(
            // Log method and path only: never query strings, headers or bodies.
            TraceLayer::new_for_http().make_span_with(|request: &axum::http::Request<_>| {
                tracing::info_span!(
                    "http",
                    method = %request.method(),
                    path = %request.uri().path(),
                )
            }),
        )
        .with_state(state)
}

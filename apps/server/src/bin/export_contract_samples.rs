//! Writes real API responses and stream messages to disk as contract samples.
//!
//! `packages/contracts` validates its schemas against these files, so the
//! TypeScript contracts can never silently drift from what the server emits.
//! The output is deterministic (fixed seed, virtual time driven manually,
//! wall-clock fields normalised) and is checked in; CI fails if regenerating
//! it changes anything.
//!
//! Usage: `cargo run -p aegis-server --bin export-contract-samples [out-dir]`

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

use aegis_server::api::{self, AppState};
use aegis_server::application::{ControlAction, StreamMessage, TimelineReason};
use aegis_server::build_state;
use aegis_server::config::Config;
use axum::body::Body;
use axum::http::{header, Method, Request};
use serde_json::{json, Value};
use tower::ServiceExt;

type AnyError = Box<dyn std::error::Error>;

async fn call(
    state: &AppState,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, AnyError> {
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"));
    let request = match body {
        Some(body) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            builder.body(Body::from(body.to_string()))?
        }
        None => builder.body(Body::empty())?,
    };
    let response = api::router(state.clone()).oneshot(request).await?;
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 32 * 1024 * 1024).await?;
    if !status.is_success() {
        return Err(format!(
            "{path} answered {status}: {}",
            String::from_utf8_lossy(&bytes)
        )
        .into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn advance(state: &AppState, seconds: u64) {
    for _ in 0..seconds * 5 {
        state.service.advance(Duration::from_millis(200));
    }
}

/// Zeroes fields that depend on the wall clock so the output is reproducible.
fn normalise(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, entry) in map.iter_mut() {
                if matches!(key.as_str(), "evaluationMicros" | "uptimeSeconds") {
                    *entry = json!(0);
                } else {
                    normalise(entry);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalise),
        _ => {}
    }
}

fn write(dir: &Path, name: &str, mut value: Value) -> Result<(), AnyError> {
    normalise(&mut value);
    let mut text = serde_json::to_string_pretty(&value)?;
    text.push('\n');
    std::fs::write(dir.join(format!("{name}.json")), text)?;
    Ok(())
}

async fn export(dir: &Path) -> Result<usize, AnyError> {
    std::fs::create_dir_all(dir)?;
    let state = build_state(Config::from_lookup(|_| None)?)?;
    let get = |path: &'static str| call(&state, Method::GET, path, None);
    let post = |path: &'static str, body: Value| call(&state, Method::POST, path, Some(body));
    let mut written = 0;
    let mut save = |name: &str, value: Value| -> Result<(), AnyError> {
        written += 1;
        write(dir, name, value)
    };

    save(
        "stream-hello",
        serde_json::from_str(&state.service.hello())?,
    )?;
    advance(&state, 8);
    save("health", get("/health").await?)?;
    save("topologies", get("/topologies").await?)?;
    save("recordings", get("/recordings").await?)?;
    save(
        "authorization-catalog",
        get("/demo/authorization/catalog").await?,
    )?;

    // A mid-incident picture: flows, an active incident, unhealthy nodes.
    save(
        "control-response",
        post(
            "/demo/scenarios/start",
            json!({ "scenarioId": "credential-stuffing" }),
        )
        .await?,
    )?;
    advance(&state, 22);
    save(
        "decision-allow",
        post(
            "/demo/authorization/evaluate",
            json!({
                "principal": "User::\"alice\"",
                "action": "Action::\"exportLedger\"",
                "resource": "Ledger::\"acme-ledger-2026\"",
                "context": { "mfa": true },
            }),
        )
        .await?,
    )?;
    save(
        "decision-deny",
        post(
            "/demo/authorization/evaluate",
            json!({
                "principal": "User::\"mallory\"",
                "action": "Action::\"exportLedger\"",
                "resource": "Ledger::\"acme-ledger-2026\"",
            }),
        )
        .await?,
    )?;
    for provider in ["network-scanner", "security-alerts"] {
        post_dynamic(&state, &format!("/providers/{provider}/connect")).await?;
    }
    advance(&state, 2);

    save("topology", get("/topology").await?)?;
    save("scenarios", get("/scenarios").await?)?;
    save("incidents", get("/incidents").await?)?;
    save("metrics", get("/metrics").await?)?;
    save("events", get("/events?limit=1000").await?)?;
    save("providers", get("/providers").await?)?;
    save(
        "authorization-decisions",
        get("/demo/authorization/decisions").await?,
    )?;
    save(
        "stream-snapshot",
        serde_json::from_str(&state.service.snapshot_message())?,
    )?;
    let events = state.service.events(0, 5, None, None);
    save(
        "stream-events",
        serde_json::from_str(&StreamMessage::Events { data: &events }.encode())?,
    )?;
    let playback = state.service.control(ControlAction::Seek { to_ms: 6000 })?;
    save(
        "stream-timeline",
        serde_json::from_str(
            &StreamMessage::Timeline {
                reason: TimelineReason::Seek,
                playback,
            }
            .encode(),
        )?,
    )?;
    save(
        "stream-lagged",
        serde_json::from_str(&StreamMessage::Lagged { dropped: 12 }.encode())?,
    )?;
    save(
        "stream-pong",
        serde_json::from_str(&StreamMessage::Pong { t: 1234.5 }.encode())?,
    )?;

    // The stress topology exercises the same contracts at scale.
    post(
        "/demo/topology/select",
        json!({ "topologyId": "hyperscale-stress" }),
    )
    .await?;
    advance(&state, 2);
    let stress = get("/topology").await?;
    save(
        "topology-stress-summary",
        json!({
            "id": stress["id"],
            "nodes": stress["nodes"].as_array().map_or(0, Vec::len),
            "edges": stress["edges"].as_array().map_or(0, Vec::len),
            "regions": stress["regions"].as_array().map_or(0, Vec::len),
        }),
    )?;
    Ok(written)
}

async fn post_dynamic(state: &AppState, path: &str) -> Result<Value, AnyError> {
    call(state, Method::POST, path, Some(json!({}))).await
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let dir = std::env::args().nth(1).map_or_else(
        || PathBuf::from("packages/contracts/samples"),
        PathBuf::from,
    );
    match export(&dir).await {
        Ok(count) => {
            println!("wrote {count} contract samples to {}", dir.display());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("export-contract-samples: {error}");
            ExitCode::FAILURE
        }
    }
}

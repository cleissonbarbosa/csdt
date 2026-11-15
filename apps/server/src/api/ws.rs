//! `WS /api/v1/stream` — telemetry and event stream.
//!
//! Server → client messages are JSON objects tagged by `type`:
//! `hello`, `snapshot`, `events`, `timeline`, `lagged`, `pong`.
//! Client → server: `{"type":"ping","t":<number>}` and
//! `{"type":"resync","afterSeq":<n>}`.
//!
//! Backpressure: all subscribers read from one bounded broadcast buffer. A
//! subscriber that cannot keep up is not allowed to slow the simulation; it
//! receives a `lagged` notice with the number of dropped messages followed by
//! a fresh snapshot, and can recover missed events with `resync`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::OwnedSemaphorePermit;

use crate::application::StreamMessage;

use super::error::ApiError;
use super::AppState;

/// Largest client message accepted.
const MAX_CLIENT_MESSAGE_BYTES: usize = 1024;
/// A subscriber whose socket stays blocked this long is disconnected.
const SEND_TIMEOUT: Duration = Duration::from_secs(5);
/// Client messages allowed per second.
const CLIENT_MESSAGES_PER_SECOND: u32 = 20;
/// Malformed client messages tolerated before the socket is closed.
const MAX_PROTOCOL_ERRORS: u32 = 8;
/// Most events returned for one `resync`.
const RESYNC_LIMIT: usize = 500;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum ClientMessage {
    Ping {
        t: f64,
    },
    #[serde(rename_all = "camelCase")]
    Resync {
        after_seq: u64,
    },
}

fn origin_allowed(headers: &HeaderMap, allowed: &[String]) -> bool {
    // Browsers always send Origin on WebSocket handshakes and do not apply
    // CORS to them, so it has to be checked here. Non-browser clients send
    // none and are allowed.
    match headers.get(header::ORIGIN).map(|v| v.to_str()) {
        None => true,
        Some(Ok(origin)) => allowed.iter().any(|a| a == origin),
        Some(Err(_)) => false,
    }
}

pub async fn stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !origin_allowed(&headers, &state.config.allowed_origins) {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            "origin_not_allowed",
            "this origin may not open the stream",
        )
        .into_response();
    }
    let Ok(permit) = Arc::clone(&state.limits.streams).try_acquire_owned() else {
        return ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "too_many_streams",
            "too many concurrent stream subscribers",
        )
        .into_response();
    };
    upgrade
        .max_message_size(MAX_CLIENT_MESSAGE_BYTES)
        .max_frame_size(MAX_CLIENT_MESSAGE_BYTES)
        .on_upgrade(move |socket| serve(socket, state, permit))
}

async fn serve(socket: WebSocket, state: AppState, _permit: OwnedSemaphorePermit) {
    let (mut sink, mut incoming) = socket.split();
    // Subscribe before sending the first snapshot so nothing falls in between.
    let mut updates = state.service.subscribe();

    macro_rules! send {
        ($text:expr) => {{
            let text: &str = $text;
            match tokio::time::timeout(SEND_TIMEOUT, sink.send(Message::Text(text.into()))).await {
                Ok(Ok(())) => {}
                _ => break,
            }
        }};
    }

    let mut window_start = Instant::now();
    let mut window_count = 0u32;
    let mut protocol_errors = 0u32;
    let mut greeted = false;

    loop {
        if !greeted {
            greeted = true;
            send!(&state.service.hello());
            send!(&state.service.snapshot_message());
            continue;
        }
        tokio::select! {
            update = updates.recv() => match update {
                Ok(text) => send!(&text),
                Err(RecvError::Lagged(dropped)) => {
                    tracing::debug!(dropped, "stream subscriber lagged");
                    send!(&StreamMessage::Lagged { dropped }.encode());
                    send!(&state.service.snapshot_message());
                }
                Err(RecvError::Closed) => break,
            },
            message = incoming.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    if window_start.elapsed() >= Duration::from_secs(1) {
                        window_start = Instant::now();
                        window_count = 0;
                    }
                    window_count += 1;
                    if window_count > CLIENT_MESSAGES_PER_SECOND {
                        break;
                    }
                    match serde_json::from_str::<ClientMessage>(text.as_str()) {
                        Ok(ClientMessage::Ping { t }) if t.is_finite() => {
                            send!(&StreamMessage::Pong { t }.encode());
                        }
                        Ok(ClientMessage::Resync { after_seq }) => {
                            let events = state.service.events(after_seq, RESYNC_LIMIT, None, None);
                            if !events.is_empty() {
                                send!(&StreamMessage::Events { data: &events }.encode());
                            }
                        }
                        _ => {
                            protocol_errors += 1;
                            if protocol_errors > MAX_PROTOCOL_ERRORS {
                                break;
                            }
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                // Binary frames are not part of the protocol; pings are
                // answered by the WebSocket layer itself.
                Some(Ok(Message::Binary(_))) => {
                    protocol_errors += 1;
                    if protocol_errors > MAX_PROTOCOL_ERRORS {
                        break;
                    }
                }
                Some(Ok(_)) => {}
            },
        }
    }
    let _ = sink.close().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn origin_check_matches_exactly() {
        let allowed = vec!["http://localhost:5173".to_string()];
        let with = |origin: &'static str| {
            let mut headers = HeaderMap::new();
            headers.insert(header::ORIGIN, HeaderValue::from_static(origin));
            headers
        };
        assert!(
            origin_allowed(&HeaderMap::new(), &allowed),
            "non-browser client"
        );
        assert!(origin_allowed(&with("http://localhost:5173"), &allowed));
        assert!(!origin_allowed(
            &with("http://localhost:5173.evil.example"),
            &allowed
        ));
        assert!(!origin_allowed(&with("https://localhost:5173"), &allowed));
        assert!(!origin_allowed(&with("null"), &allowed));
    }

    #[test]
    fn client_messages_are_strictly_typed() {
        assert!(matches!(
            serde_json::from_str::<ClientMessage>(r#"{"type":"ping","t":1.5}"#),
            Ok(ClientMessage::Ping { .. })
        ));
        assert!(matches!(
            serde_json::from_str::<ClientMessage>(r#"{"type":"resync","afterSeq":12}"#),
            Ok(ClientMessage::Resync { after_seq: 12 })
        ));
        assert!(serde_json::from_str::<ClientMessage>(r#"{"type":"start"}"#).is_err());
        assert!(serde_json::from_str::<ClientMessage>(r#"{"type":"ping","t":1,"x":2}"#).is_err());
    }
}

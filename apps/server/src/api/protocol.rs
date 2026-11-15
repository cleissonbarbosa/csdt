//! What a stream subscriber may say, and what it is answered.
//!
//! Shared by the WebSocket handler and the in-browser engine, so a `ping`
//! and a `resync` mean the same thing over a socket and across a function
//! call.

use std::sync::Arc;

use serde::Deserialize;

use crate::application::{SimulationService, StreamMessage};

/// Largest client message accepted.
pub const MAX_CLIENT_MESSAGE_BYTES: usize = 1024;
/// Most events returned for one `resync`.
pub const RESYNC_LIMIT: usize = 500;

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

/// The message was not one a subscriber may send.
#[derive(Debug, PartialEq, Eq)]
pub struct Malformed;

/// The answer to one client message, when it has one: a `pong` for a `ping`,
/// the events after a sequence number for a `resync` (nothing when there are
/// none).
pub fn answer(service: &SimulationService, text: &str) -> Result<Option<Arc<str>>, Malformed> {
    if text.len() > MAX_CLIENT_MESSAGE_BYTES {
        return Err(Malformed);
    }
    match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::Ping { t }) if t.is_finite() => {
            Ok(Some(StreamMessage::Pong { t }.encode()))
        }
        Ok(ClientMessage::Resync { after_seq }) => {
            let events = service.events(after_seq, RESYNC_LIMIT, None, None);
            Ok((!events.is_empty()).then(|| StreamMessage::Events { data: &events }.encode()))
        }
        _ => Err(Malformed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

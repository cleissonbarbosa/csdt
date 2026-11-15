//! WebSocket stream tests against a real listener.
#![allow(clippy::unwrap_used)]

mod common;

use std::sync::Arc;
use std::time::Duration;

use aegis_server::api::{AppState, Limits};
use common::{serve, state};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::sync::broadcast::error::TryRecvError;
use tokio::sync::Semaphore;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn connect(addr: std::net::SocketAddr) -> Socket {
    let (socket, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/api/v1/stream"))
        .await
        .expect("stream connects");
    socket
}

/// Next JSON message, failing the test if none arrives in time.
async fn next(socket: &mut Socket) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .expect("a message arrives in time")
            .expect("stream is open")
            .expect("frame is valid");
        if let Message::Text(text) = message {
            return serde_json::from_str(text.as_str()).expect("message is JSON");
        }
    }
}

/// Reads until a message of the given type arrives.
async fn next_of(socket: &mut Socket, kind: &str) -> Value {
    for _ in 0..2000 {
        let message = next(socket).await;
        if message["type"] == kind {
            return message;
        }
    }
    panic!("no `{kind}` message arrived");
}

fn advance(state: &AppState, ticks: u32) {
    for _ in 0..ticks {
        state.service.advance(Duration::from_millis(200));
    }
}

#[tokio::test]
async fn greets_with_hello_and_a_snapshot_then_streams_updates() {
    let state = state();
    let addr = serve(state.clone()).await;
    let mut socket = connect(addr).await;

    let hello = next(&mut socket).await;
    assert_eq!(hello["type"], "hello");
    assert_eq!(hello["protocolVersion"], 1);
    assert_eq!(hello["schemaVersion"], "1.0");
    assert_eq!(hello["topologyId"], "helios-commerce");
    assert_eq!(hello["playback"]["status"], "playing");

    let first = next(&mut socket).await;
    assert_eq!(first["type"], "snapshot");
    assert_eq!(first["data"]["tick"], 0);
    assert_eq!(first["data"]["dataSource"], "synthetic");
    assert_eq!(
        first["data"]["nodes"]["health"].as_array().unwrap().len(),
        state.service.topology().nodes.len()
    );

    advance(&state, 3);
    for tick in 1..=3 {
        let snapshot = next_of(&mut socket, "snapshot").await;
        assert_eq!(snapshot["data"]["tick"], tick);
        assert_eq!(snapshot["data"]["virtualTimeMs"], tick * 200);
    }
}

#[tokio::test]
async fn streams_incident_events_with_sequence_numbers() {
    let state = state();
    let addr = serve(state.clone()).await;
    let mut socket = connect(addr).await;
    next_of(&mut socket, "snapshot").await;

    state
        .service
        .start_scenario("credential-stuffing")
        .expect("scenario starts");
    advance(&state, 1);
    let events = next_of(&mut socket, "events").await;
    let data = events["data"].as_array().unwrap();
    assert_eq!(data[0]["kind"], "incident-started");
    assert_eq!(data[0]["seq"], 1);
    assert_eq!(data[1]["kind"], "incident-phase");
    assert_eq!(data[1]["seq"], 2);
    assert_eq!(data[0]["incidentId"], "inc-001");

    let snapshot = next_of(&mut socket, "snapshot").await;
    assert_eq!(
        snapshot["data"]["incident"]["scenarioId"],
        "credential-stuffing"
    );
    assert_eq!(snapshot["data"]["seq"], 2);
}

#[tokio::test]
async fn answers_ping_and_resync_and_survives_garbage() {
    let state = state();
    state.service.start_scenario("ddos-surge").expect("starts");
    advance(&state, 60);
    let addr = serve(state.clone()).await;
    let mut socket = connect(addr).await;
    next_of(&mut socket, "snapshot").await;

    socket
        .send(Message::Text(
            json!({ "type": "ping", "t": 12.5 }).to_string().into(),
        ))
        .await
        .unwrap();
    assert_eq!(next_of(&mut socket, "pong").await["t"], 12.5);

    // A reconnecting client asks for everything after the last event it saw.
    socket
        .send(Message::Text(
            json!({ "type": "resync", "afterSeq": 2 })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let events = next_of(&mut socket, "events").await;
    let seqs: Vec<u64> = events["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs.first(), Some(&3));
    assert!(seqs.windows(2).all(|w| w[1] == w[0] + 1));

    // Malformed input is ignored (up to a limit) without killing the stream.
    for garbage in ["", "{", "[]", "{\"type\":\"start\"}", "{\"type\":\"ping\"}"] {
        socket.send(Message::Text(garbage.into())).await.unwrap();
    }
    socket
        .send(Message::Text(
            json!({ "type": "ping", "t": 1 }).to_string().into(),
        ))
        .await
        .unwrap();
    assert_eq!(next_of(&mut socket, "pong").await["t"], 1.0);
}

#[tokio::test]
async fn closes_streams_that_keep_violating_the_protocol() {
    let state = state();
    let addr = serve(state).await;
    let mut socket = connect(addr).await;
    next_of(&mut socket, "snapshot").await;
    for _ in 0..12 {
        if socket.send(Message::Text("nonsense".into())).await.is_err() {
            break;
        }
    }
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                None | Some(Ok(Message::Close(_))) | Some(Err(_)) => break true,
                Some(Ok(_)) => {}
            }
        }
    })
    .await
    .expect("server closes the stream");
    assert!(closed);
}

#[tokio::test]
async fn timeline_changes_are_announced_so_clients_refetch() {
    let state = state();
    let addr = serve(state.clone()).await;
    let mut socket = connect(addr).await;
    next_of(&mut socket, "snapshot").await;
    advance(&state, 30);

    state
        .service
        .control(aegis_server::application::ControlAction::Seek { to_ms: 2000 })
        .expect("seeks");
    let timeline = next_of(&mut socket, "timeline").await;
    assert_eq!(timeline["reason"], "seek");
    assert_eq!(timeline["playback"]["mode"], "replay");
    assert_eq!(timeline["playback"]["tick"], 10);
    let snapshot = next_of(&mut socket, "snapshot").await;
    assert_eq!(snapshot["data"]["tick"], 10);

    // Starting a scenario from the past branches the timeline.
    state
        .service
        .start_scenario("cedar-denial")
        .expect("starts");
    let timeline = next_of(&mut socket, "timeline").await;
    assert_eq!(timeline["reason"], "branch");
    assert_eq!(timeline["playback"]["headTick"], 10);

    state
        .service
        .reset(aegis_server::application::ResetScope::Simulation)
        .expect("resets");
    let timeline = next_of(&mut socket, "timeline").await;
    assert_eq!(timeline["reason"], "reset");
    assert_eq!(timeline["playback"]["tick"], 0);
}

#[tokio::test]
async fn browser_origins_must_be_allowed() {
    let state = state();
    let addr = serve(state).await;
    let request = |origin: &'static str| {
        let mut request = format!("ws://{addr}/api/v1/stream")
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("origin", HeaderValue::from_static(origin));
        request
    };
    let refused = tokio_tungstenite::connect_async(request("https://evil.example")).await;
    let error = refused
        .expect_err("foreign origins are refused")
        .to_string();
    assert!(error.contains("403"), "{error}");

    let (mut socket, _) = tokio_tungstenite::connect_async(request("http://localhost:5173"))
        .await
        .expect("configured origins connect");
    assert_eq!(next(&mut socket).await["type"], "hello");
}

#[tokio::test]
async fn concurrent_streams_are_capped() {
    let mut state = state();
    state.limits = Arc::new(Limits {
        streams: Arc::new(Semaphore::new(1)),
        ..Limits::default()
    });
    let addr = serve(state).await;
    let mut first = connect(addr).await;
    assert_eq!(next(&mut first).await["type"], "hello");

    let second = tokio_tungstenite::connect_async(format!("ws://{addr}/api/v1/stream")).await;
    let error = second
        .expect_err("the second stream is refused")
        .to_string();
    assert!(error.contains("503"), "{error}");

    // Closing the first frees the slot.
    first.close(None).await.unwrap();
    drop(first);
    let mut retry = None;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        if let Ok((socket, _)) =
            tokio_tungstenite::connect_async(format!("ws://{addr}/api/v1/stream")).await
        {
            retry = Some(socket);
            break;
        }
    }
    assert!(retry.is_some(), "slot is released when a stream closes");
}

#[test]
fn slow_subscribers_lag_instead_of_blocking_the_simulation() {
    // No runtime, no reader: the buffer simply fills up.
    let state = state();
    let mut subscriber = state.service.subscribe();
    advance(&state, 2000);
    assert_eq!(
        state.service.playback().tick,
        2000,
        "the simulation never waits for subscribers"
    );
    match subscriber.try_recv() {
        Err(TryRecvError::Lagged(dropped)) => {
            assert!(dropped >= 1700, "only {dropped} messages were dropped");
        }
        other => panic!("expected the subscriber to have lagged, got {other:?}"),
    }
    // After the notice the subscriber continues with the retained tail.
    let mut retained = 0;
    while subscriber.try_recv().is_ok() {
        retained += 1;
    }
    assert!(retained <= 256, "buffer is bounded, held {retained}");
}

#[tokio::test(flavor = "current_thread")]
async fn lagging_streams_are_told_and_resynchronised() {
    let state = state();
    let addr = serve(state.clone()).await;
    let mut socket = connect(addr).await;
    next_of(&mut socket, "snapshot").await;

    // On a single-threaded runtime the connection task cannot run while this
    // loop holds the thread, so it falls behind the bounded buffer.
    advance(&state, 1500);

    let lagged = next_of(&mut socket, "lagged").await;
    assert!(lagged["dropped"].as_u64().unwrap() > 1000);
    // The very next message is a fresh snapshot of the current state.
    let snapshot = next(&mut socket).await;
    assert_eq!(snapshot["type"], "snapshot");
    assert_eq!(snapshot["data"]["tick"], 1500);
}

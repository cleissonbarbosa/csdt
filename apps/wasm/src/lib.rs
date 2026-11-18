//! The AEGIS engine for the browser.
//!
//! This is the server with the network taken away: the same routes, the same
//! `SimulationService`, the same Cedar engine and the same workspace checks,
//! compiled to WebAssembly. A page talks to it the way it talks to the
//! server, except that a request is a function call and the stream is what
//! each call hands back. Nothing here decides anything about the simulation
//! or about a response; it carries text across the boundary.
//!
//! The module imports nothing from its host. The page writes into a buffer
//! the module owns, calls a function and reads the answer out of another, so
//! no pointer is ever dereferenced on this side and there is no `unsafe`
//! block. Wall-clock time arrives as an argument of every call.
//!
//! Everything that crosses is UTF-8 text made of lines. A request is
//! `METHOD path`, then the JSON body if it has one; its answer is the status,
//! the response body and the stream messages the call produced, one per
//! line. JSON as the server writes it holds no line break, so nothing is
//! parsed or re-encoded on the way through.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::sync::Arc;
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use aegis_server::api::{self, protocol, AppState, MAX_IMPORT_BYTES};
use aegis_server::application::{StreamMessage, SCHEDULER_PERIOD};
use aegis_server::build_offline_state;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use tokio::sync::broadcast::error::TryRecvError;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

/// Version of the boundary below. The page refuses a module that reports
/// another, instead of misreading it.
pub const ABI_VERSION: u32 = 1;
/// Seed of the simulation unless the page asks for another.
pub const DEFAULT_SEED: u64 = 42;
/// Largest request accepted across the boundary: the largest body any route
/// takes, and room for the request line.
pub const MAX_REQUEST_BYTES: usize = MAX_IMPORT_BYTES + 4 * 1024;
/// Largest step of wall-clock time one call may ask for. A tab that slept
/// does not make the simulation sprint when it wakes.
pub const MAX_ADVANCE: Duration = Duration::from_secs(1);

/// Runs a future that has nothing to wait for. Every handler behind the
/// offline router finishes without yielding: there is no socket, no timer
/// and no other task. One that did not would be a bug, and is reported as
/// such rather than waited on.
fn now<T>(future: impl Future<Output = T>) -> Option<T> {
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    // A few polls, in case a layer yields once before it is ready.
    for _ in 0..8 {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return Some(value);
        }
    }
    None
}

fn failure(status: StatusCode, code: &str, message: &str) -> (StatusCode, String) {
    (
        status,
        serde_json::json!({ "error": { "code": code, "message": message } }).to_string(),
    )
}

/// What one request comes back with.
#[derive(Debug)]
pub struct Answer {
    pub status: u16,
    /// The response body, exactly as the server would send it.
    pub body: String,
    /// What the request caused subscribers to be told.
    pub stream: Vec<Arc<str>>,
}

/// One simulation, its routes and its place in the stream.
pub struct Engine {
    state: AppState,
    router: Router,
    stream: Receiver<Arc<str>>,
}

impl Engine {
    pub fn boot(seed: u64) -> Result<Self, String> {
        let state = build_offline_state(seed).map_err(|error| error.to_string())?;
        // Subscribe before anything is advanced so no message is missed.
        let stream = state.service.subscribe();
        Ok(Self {
            router: api::offline_router(state.clone()),
            state,
            stream,
        })
    }

    fn respond(&self, call: &str) -> (StatusCode, String) {
        let invalid = |message: &str| failure(StatusCode::BAD_REQUEST, "invalid_request", message);
        let (line, body) = match call.split_once('\n') {
            Some((line, body)) => (line, Some(body)),
            None => (call, None),
        };
        let Some((method, path)) = line.split_once(' ') else {
            return invalid("a request starts with `METHOD path`");
        };
        let method = match method {
            "GET" => Method::GET,
            "POST" => Method::POST,
            _ => {
                return failure(
                    StatusCode::METHOD_NOT_ALLOWED,
                    "invalid_request",
                    "only GET and POST are served",
                )
            }
        };
        let mut request = Request::builder().method(method).uri(path);
        let body = match body {
            Some(body) => {
                request = request.header(header::CONTENT_TYPE, "application/json");
                Body::from(body.to_owned())
            }
            None => Body::empty(),
        };
        let Ok(request) = request.body(body) else {
            return invalid("the path is not a valid request target");
        };
        let stalled = || {
            failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "the request did not complete",
            )
        };
        let Some(Ok(response)) = now(self.router.clone().oneshot(request)) else {
            return stalled();
        };
        let status = response.status();
        match now(axum::body::to_bytes(response.into_body(), usize::MAX)) {
            Some(Ok(bytes)) => (status, String::from_utf8_lossy(&bytes).into_owned()),
            _ => stalled(),
        }
    }

    /// The stream messages produced since the last call.
    fn drain(&mut self) -> Vec<Arc<str>> {
        let mut messages = Vec::new();
        loop {
            match self.stream.try_recv() {
                Ok(message) => messages.push(message),
                // The page fell behind: say how far, and hand it the present,
                // as the server does for a slow subscriber.
                Err(TryRecvError::Lagged(dropped)) => {
                    messages.push(StreamMessage::Lagged { dropped }.encode());
                    messages.push(self.state.service.snapshot_message());
                }
                Err(TryRecvError::Empty | TryRecvError::Closed) => break,
            }
        }
        messages
    }

    /// Answers one request, written as `METHOD path` and, on the lines after
    /// it, the JSON body if there is one.
    pub fn request(&mut self, call: &str) -> Answer {
        let (status, body) = self.respond(call);
        Answer {
            status: status.as_u16(),
            body,
            stream: self.drain(),
        }
    }

    /// Advances wall-clock time and returns the stream messages it produced.
    pub fn advance(&mut self, elapsed: Duration) -> Vec<Arc<str>> {
        self.state.service.advance(elapsed.min(MAX_ADVANCE));
        self.drain()
    }

    /// What a subscriber is sent first: the greeting and the present.
    pub fn open(&mut self) -> Vec<Arc<str>> {
        // Whatever was queued is older than the snapshot about to be sent.
        let _ = self.drain();
        vec![
            self.state.service.hello(),
            self.state.service.snapshot_message(),
        ]
    }

    /// Answers a subscriber's own message (`ping`, `resync`) as the socket
    /// does. One that is neither is dropped.
    pub fn message(&mut self, text: &str) -> Vec<Arc<str>> {
        let mut messages = self.drain();
        if let Ok(Some(reply)) = protocol::answer(&self.state.service, text) {
            messages.push(reply);
        }
        messages
    }
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

thread_local! {
    static ENGINE: RefCell<Option<Engine>> = const { RefCell::new(None) };
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PANIC: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Tells the server library what time the page says it is.
fn clock(_now_ms: f64) {
    #[cfg(target_arch = "wasm32")]
    aegis_server::clock::set_now(_now_ms);
}

fn put(text: String) -> usize {
    OUTPUT.with(|output| {
        let mut output = output.borrow_mut();
        *output = text.into_bytes();
        output.len()
    })
}

fn lines(messages: &[Arc<str>]) -> String {
    messages.join("\n")
}

/// The first `len` bytes of the input, as text.
fn input(len: usize) -> String {
    INPUT.with(|input| {
        let input = input.borrow();
        String::from_utf8_lossy(&input[..len.min(input.len())]).into_owned()
    })
}

/// Runs `work` on the engine, or returns `otherwise` when none was started.
fn with_engine(work: impl FnOnce(&mut Engine) -> String, otherwise: &str) -> usize {
    put(ENGINE.with(|slot| match slot.borrow_mut().as_mut() {
        Some(engine) => work(engine),
        None => otherwise.to_string(),
    }))
}

/// The version of this boundary.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_abi() -> u32 {
    ABI_VERSION
}

/// How often the page should call [`aegis_advance`], in milliseconds: the
/// period of the server's own scheduler.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_period_ms() -> f64 {
    SCHEDULER_PERIOD.as_secs_f64() * 1000.0
}

/// Reserves `len` bytes for the next call's input and returns where to write
/// them, or 0 when that is more than any call may carry.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_input(len: usize) -> usize {
    if len > MAX_REQUEST_BYTES {
        return 0;
    }
    INPUT.with(|input| {
        let mut input = input.borrow_mut();
        input.clear();
        input.resize(len, 0);
        input.as_mut_ptr() as usize
    })
}

/// Where the last call's output is. It stays there until the next call. The
/// calls below return its length in bytes.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_output() -> usize {
    OUTPUT.with(|output| output.borrow().as_ptr() as usize)
}

/// Starts the engine, replacing one already started. The output is `ok`, or
/// the reason it could not start.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_boot(seed: f64, now_ms: f64) -> usize {
    // In the browser a panic has nowhere to be printed: keep what it said
    // for the page to read. Natively it goes to standard error as usual.
    #[cfg(target_arch = "wasm32")]
    std::panic::set_hook(Box::new(|info| {
        PANIC.with(|panic| {
            if let Ok(mut panic) = panic.try_borrow_mut() {
                *panic = info.to_string().into_bytes();
            }
        });
    }));
    clock(now_ms);
    let seed = if seed.is_finite() && seed >= 0.0 {
        seed as u64
    } else {
        DEFAULT_SEED
    };
    put(match Engine::boot(seed) {
        Ok(engine) => {
            ENGINE.with(|slot| *slot.borrow_mut() = Some(engine));
            "ok".to_string()
        }
        Err(error) => error,
    })
}

/// Answers the request in the first `len` bytes of the input. The output is
/// the status, the response body and each stream message the request
/// produced, one per line.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_request(len: usize, now_ms: f64) -> usize {
    clock(now_ms);
    let call = input(len);
    with_engine(
        |engine| {
            let answer = engine.request(&call);
            // A body is one line. JSON may be broken across several only
            // between tokens, where a space means the same.
            let body = if answer.body.contains(['\n', '\r']) {
                answer.body.replace(['\n', '\r'], " ")
            } else {
                answer.body
            };
            let mut out = format!("{}\n{body}", answer.status);
            for message in &answer.stream {
                out.push('\n');
                out.push_str(message);
            }
            out
        },
        "503\n{\"error\":{\"code\":\"not_ready\",\"message\":\"the engine has not been started\"}}",
    )
}

/// Advances the simulation by `elapsed_ms` of wall-clock time. The output is
/// the stream messages that produced, one per line.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_advance(elapsed_ms: f64, now_ms: f64) -> usize {
    clock(now_ms);
    let elapsed = if elapsed_ms.is_finite() && elapsed_ms > 0.0 {
        Duration::from_secs_f64(elapsed_ms.min(60_000.0) / 1000.0)
    } else {
        Duration::ZERO
    };
    with_engine(|engine| lines(&engine.advance(elapsed)), "")
}

/// Opens the stream: the output is the greeting and a snapshot.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_open(now_ms: f64) -> usize {
    clock(now_ms);
    with_engine(|engine| lines(&engine.open()), "")
}

/// Hands the engine the subscriber's message in the first `len` bytes of the
/// input. The output is the stream messages it is answered with.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_message(len: usize, now_ms: f64) -> usize {
    clock(now_ms);
    let text = input(len);
    with_engine(|engine| lines(&engine.message(&text)), "")
}

/// Where the message of the panic that stopped the module is, if one did.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_panic() -> usize {
    PANIC.with(|panic| {
        panic
            .try_borrow()
            .map_or(0, |panic| panic.as_ptr() as usize)
    })
}

/// The length of that message; 0 when nothing panicked.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn aegis_panic_len() -> usize {
    PANIC.with(|panic| panic.try_borrow().map_or(0, |panic| panic.len()))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use serde_json::{json, Value};

    use super::*;

    /// An answer with its body and stream parsed.
    struct Parsed {
        status: u16,
        body: Value,
        stream: Vec<Value>,
    }

    fn engine() -> Engine {
        Engine::boot(DEFAULT_SEED).unwrap()
    }

    fn parse(messages: &[Arc<str>]) -> Vec<Value> {
        messages
            .iter()
            .map(|message| serde_json::from_str(message).expect("a stream message is JSON"))
            .collect()
    }

    fn call(engine: &mut Engine, text: &str) -> Parsed {
        let answer = engine.request(text);
        Parsed {
            status: answer.status,
            body: serde_json::from_str(&answer.body).expect("a response body is JSON"),
            stream: parse(&answer.stream),
        }
    }

    fn get(engine: &mut Engine, path: &str) -> Parsed {
        call(engine, &format!("GET /api/v1{path}"))
    }

    fn post(engine: &mut Engine, path: &str, body: Value) -> Parsed {
        call(engine, &format!("POST /api/v1{path}\n{body}"))
    }

    fn tick(engine: &mut Engine, ticks: u32) -> Vec<Value> {
        (0..ticks)
            .flat_map(|_| parse(&engine.advance(Duration::from_millis(200))))
            .collect()
    }

    #[test]
    fn a_request_is_answered_by_the_servers_own_routes() {
        let mut engine = engine();
        let health = get(&mut engine, "/health");
        assert_eq!(health.status, 200);
        assert_eq!(health.body["status"], "ok");
        assert_eq!(health.body["topologyId"], "helios-commerce");
        assert!(health.body["authorizationEngine"]["version"]
            .as_str()
            .unwrap()
            .starts_with("4."));

        let topology = get(&mut engine, "/topology");
        assert_eq!(topology.body["nodes"].as_array().unwrap().len(), 51);

        // The same validation and the same errors as over HTTP.
        let missing = get(&mut engine, "/nowhere");
        assert_eq!(missing.status, 404);
        assert_eq!(missing.body["error"]["code"], "not_found");
        let invalid = post(
            &mut engine,
            "/demo/scenarios/start",
            json!({ "scenario": "x" }),
        );
        assert_eq!(invalid.status, 400);
        let malformed = call(
            &mut engine,
            "POST /api/v1/demo/scenarios/start\n{\"scenarioId\":",
        );
        assert_eq!(malformed.status, 400);
        let unknown = post(
            &mut engine,
            "/demo/scenarios/start",
            json!({ "scenarioId": "no-such-scenario" }),
        );
        assert_eq!(unknown.status, 404);
        // There is no socket to upgrade: the stream is not a route here.
        assert_eq!(get(&mut engine, "/stream").status, 404);
    }

    #[test]
    fn time_passes_only_when_the_page_says_so() {
        let mut engine = engine();
        let opened = parse(&engine.open());
        assert_eq!(opened[0]["type"], "hello");
        assert_eq!(opened[1]["type"], "snapshot");
        assert_eq!(opened[1]["data"]["tick"], 0);

        // Less than one tick of wall-clock time: nothing to say.
        assert!(engine.advance(Duration::from_millis(50)).is_empty());
        let stream = parse(&engine.advance(Duration::from_millis(150)));
        assert_eq!(stream.len(), 1);
        assert_eq!(stream[0]["type"], "snapshot");
        assert_eq!(stream[0]["data"]["tick"], 1);

        // A tab that slept for a minute advances one second, not sixty.
        let woke = parse(&engine.advance(Duration::from_secs(60)));
        assert_eq!(woke.last().unwrap()["data"]["tick"], 6);
    }

    #[test]
    fn what_a_request_tells_subscribers_comes_back_with_its_answer() {
        let mut engine = engine();
        let _ = engine.open();
        tick(&mut engine, 10);
        let started = post(
            &mut engine,
            "/demo/scenarios/start",
            json!({ "scenarioId": "ddos-surge" }),
        );
        assert_eq!(started.status, 200);
        let events: Vec<Value> = tick(&mut engine, 20)
            .into_iter()
            .filter(|message| message["type"] == "events")
            .flat_map(|message| message["data"].as_array().unwrap().clone())
            .collect();
        assert!(events
            .iter()
            .any(|event| event["kind"] == "incident-started"));

        // A seek reshapes history: the answer carries the stream's notice.
        let seek = post(
            &mut engine,
            "/demo/playback/control",
            json!({ "action": "seek", "toMs": 1000 }),
        );
        assert_eq!(seek.status, 200);
        assert_eq!(seek.stream[0]["type"], "timeline");
        assert_eq!(seek.stream[0]["reason"], "seek");
        assert_eq!(seek.stream[1]["type"], "snapshot");
    }

    #[test]
    fn a_subscriber_is_answered_as_over_the_socket() {
        let mut engine = engine();
        let _ = engine.open();
        let pong = parse(&engine.message(r#"{"type":"ping","t":12.5}"#));
        assert_eq!(pong, [json!({ "type": "pong", "t": 12.5 })]);

        post(
            &mut engine,
            "/demo/scenarios/start",
            json!({ "scenarioId": "ddos-surge" }),
        );
        tick(&mut engine, 20);
        let replay = parse(&engine.message(r#"{"type":"resync","afterSeq":0}"#));
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0]["type"], "events");
        assert_eq!(replay[0]["data"][0]["seq"], 1);
        let events = get(&mut engine, "/events?limit=1000").body;
        let last = events["events"].as_array().unwrap().last().unwrap()["seq"]
            .as_u64()
            .unwrap();
        // Nothing after the newest event, and nothing for what is not a message.
        assert!(engine
            .message(&format!(r#"{{"type":"resync","afterSeq":{last}}}"#))
            .is_empty());
        assert!(engine.message(r#"{"type":"start"}"#).is_empty());
        assert!(engine.message("not json").is_empty());
    }

    #[test]
    fn cedar_decides_in_the_module_as_it_does_on_the_server() {
        let mut engine = engine();
        let decision = post(
            &mut engine,
            "/demo/authorization/evaluate",
            json!({
                "principal": "User::\"mallory\"",
                "action": "Action::\"exportLedger\"",
                "resource": "Ledger::\"acme-ledger-2026\"",
            }),
        );
        assert_eq!(decision.status, 200);
        assert_eq!(decision.body["decision"], "deny");
        assert_eq!(
            decision.body["determiningPolicies"],
            json!(["forbid-cross-tenant"])
        );
        assert_eq!(decision.body["engine"]["kind"], "embedded-cedar");

        // There is no agent to reach, and it is never pretended there is.
        let agent = post(
            &mut engine,
            "/demo/authorization/evaluate",
            json!({
                "principal": "User::\"alice\"",
                "action": "Action::\"viewLedger\"",
                "resource": "Ledger::\"acme-ledger-2026\"",
                "engine": "cedar-agent",
            }),
        );
        assert_eq!(agent.status, 503);
        let providers = get(&mut engine, "/providers");
        let ids: Vec<&str> = providers
            .body
            .as_array()
            .unwrap()
            .iter()
            .map(|provider| provider["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["demo-simulation"]);
    }

    #[test]
    fn a_workspace_is_imported_into_the_module_itself() {
        let mut engine = engine();
        let _ = engine.open();
        let scenario = json!({
            "id": "brownout",
            "name": "Brownout",
            "summary": "The gateway slows down.",
            "category": "resilience",
            "severity": "warning",
            "durationMs": 20000,
            "phases": [{
                "name": "Slow",
                "atMs": 0,
                "rampMs": 1000,
                "status": "active",
                "effects": [{ "type": "latency", "nodes": "role:primaryGateway", "factor": 4.0 }]
            }]
        });
        let files = json!({ "files": [{ "path": "brownout.json", "text": scenario.to_string() }] });
        let check = post(&mut engine, "/demo/workspace/check", files.clone());
        assert_eq!(check.body["valid"], true);
        let imported = post(&mut engine, "/demo/workspace/import", files);
        assert_eq!(imported.status, 200);
        assert_eq!(imported.body["workspace"]["origin"], "imported");
        assert_eq!(
            imported.body["workspace"]["scenarioIds"],
            json!(["brownout"])
        );
        assert_eq!(imported.stream[0]["reason"], "workspace");

        let reset = post(&mut engine, "/demo/workspace/reset", json!({}));
        assert_eq!(reset.body["workspace"]["origin"], "bundled");
    }

    #[test]
    fn what_is_not_a_request_is_refused_without_reaching_a_route() {
        let mut engine = engine();
        for (text, status) in [
            ("", 400),
            ("GET", 400),
            ("DELETE /api/v1/health", 405),
            ("GET not a path", 400),
        ] {
            let answer = call(&mut engine, text);
            assert_eq!(answer.status, status, "{text:?}");
            assert_eq!(answer.body["error"]["code"], "invalid_request", "{text:?}");
        }
        // The body limits of the routes still hold.
        let large = post(
            &mut engine,
            "/demo/scenarios/start",
            json!({ "scenarioId": "x".repeat(20_000) }),
        );
        assert_eq!(large.status, 413);
    }

    #[test]
    fn the_boundary_carries_text_in_and_lines_out() {
        // The exported functions, driven the way the page drives them.
        let read = |len: usize| {
            OUTPUT.with(|output| String::from_utf8(output.borrow()[..len].to_vec()).unwrap())
        };
        let write = |text: &str| {
            assert!(aegis_input(text.len()) != 0);
            INPUT.with(|input| input.borrow_mut().copy_from_slice(text.as_bytes()));
            text.len()
        };
        assert_eq!(aegis_abi(), ABI_VERSION);
        assert_eq!(aegis_period_ms(), 50.0);

        // Before it is started the engine says so and stays silent.
        let early = read(aegis_request(write("GET /api/v1/health"), 0.0));
        assert!(early.starts_with("503\n"), "{early}");
        assert_eq!(aegis_advance(200.0, 0.0), 0);

        assert_eq!(read(aegis_boot(DEFAULT_SEED as f64, 0.0)), "ok");
        assert!(aegis_output() != 0);

        let answer = read(aegis_request(write("GET /api/v1/topologies"), 10.0));
        let (status, body) = answer.split_once('\n').unwrap();
        assert_eq!(status, "200");
        assert!(!body.contains('\n'), "nothing was said on the stream");
        let body: Value = serde_json::from_str(body).unwrap();
        assert_eq!(body["activeId"], "helios-commerce");

        let opened = read(aegis_open(20.0));
        let opened: Vec<Value> = opened
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(opened[0]["type"], "hello");
        assert_eq!(opened[1]["type"], "snapshot");

        // Two ticks in one step: subscribers are told where it ended.
        let stream = read(aegis_advance(400.0, 420.0));
        assert_eq!(stream.lines().count(), 1);
        let snapshot: Value = serde_json::from_str(&stream).unwrap();
        assert_eq!(snapshot["data"]["tick"], 2);
        let pong = read(aegis_message(write(r#"{"type":"ping","t":7}"#), 430.0));
        assert_eq!(pong, r#"{"type":"pong","t":7.0}"#);

        // A request that reshapes history: status, body, then the stream.
        let seek = read(aegis_request(
            write("POST /api/v1/demo/playback/control\n{\"action\":\"pause\"}"),
            440.0,
        ));
        let mut lines = seek.lines();
        assert_eq!(lines.next(), Some("200"));
        assert!(lines.next().unwrap().starts_with('{'));

        assert_eq!(
            aegis_input(MAX_REQUEST_BYTES + 1),
            0,
            "more than any call may carry"
        );
        assert_eq!(aegis_panic_len(), 0);
    }
}

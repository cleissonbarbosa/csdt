use std::net::SocketAddr;
use std::path::Path;
use std::process::ExitCode;

use aegis_server::application::diff::compare;
use aegis_server::application::platforms::across;
use aegis_server::application::{Assets, Loaded, Sources};
use aegis_server::config::{Config, DEFAULT_SEED};
use aegis_server::domain::WorkspaceOrigin;
use aegis_server::{api, build_state, workspace};
use tracing_subscriber::EnvFilter;

/// Names the fixtures compiled into the binary where a workspace is expected.
const BUNDLED: &str = "@bundled";

const USAGE: &str = "\
usage: aegis-server                          run the server
       aegis-server export-workspace <dir>   write the bundled topologies, scenarios,
                                             recordings and Cedar files into <dir>
       aegis-server check-workspace <dir>    validate a workspace without starting
       aegis-server diff-workspace <base> <candidate> [--json] [--exit-code]
                                             what Cedar decides differently under the
                                             candidate; @bundled names the bundled set
       aegis-server compare-incident <base> <candidate> <scenario>
                    [--topology=<id>] [--seed=<n>] [--json]
                                             one scenario on the platform each describes,
                                             from the same seed, side by side
       aegis-server healthcheck              probe the running server
       aegis-server --version";

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}

/// `aegis-server healthcheck`: asks the locally running server for its
/// health endpoint. Exists so minimal container images (no shell, no curl)
/// can still declare a health check.
fn healthcheck(bind: SocketAddr) -> ExitCode {
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, TcpStream};
    use std::time::Duration;

    // The server may listen on 0.0.0.0; probe it over loopback.
    let target = SocketAddr::from((Ipv4Addr::LOCALHOST, bind.port()));
    let timeout = Duration::from_secs(2);
    let outcome = TcpStream::connect_timeout(&target, timeout).and_then(|mut stream| {
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        stream.write_all(b"GET /api/v1/health HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
        let mut head = [0u8; 32];
        let read = stream.read(&mut head)?;
        Ok(head[..read].starts_with(b"HTTP/1.0 200") || head[..read].starts_with(b"HTTP/1.1 200"))
    });
    match outcome {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => {
            eprintln!("aegis-server healthcheck: unexpected response");
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("aegis-server healthcheck: {error}");
            ExitCode::FAILURE
        }
    }
}

/// `aegis-server export-workspace <dir>`: the bundled fixtures as files an
/// operator can edit and point `AEGIS_WORKSPACE` at.
fn export_workspace(dir: &Path) -> ExitCode {
    match workspace::export(dir) {
        Ok(written) => {
            for path in &written {
                println!("{}", path.display());
            }
            println!(
                "\n{} files written. Edit them, then start the server with AEGIS_WORKSPACE={}",
                written.len(),
                dir.display()
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("aegis-server export-workspace: {error}");
            ExitCode::FAILURE
        }
    }
}

/// `aegis-server check-workspace <dir>`: loads and compiles a workspace the
/// way start-up would and says what it found, without serving anything.
fn check_workspace(dir: &Path) -> ExitCode {
    let loaded = match workspace::load(dir) {
        Ok(loaded) => loaded,
        Err(error) => {
            eprintln!("aegis-server check-workspace: {error}");
            return ExitCode::FAILURE;
        }
    };
    let scenario_ids: Vec<String> = loaded
        .sources
        .scenarios
        .iter()
        .map(|s| s.id.clone())
        .collect();
    let assets = match Assets::build(loaded.sources) {
        Ok(assets) => assets,
        Err(error) => {
            eprintln!("aegis-server check-workspace: {}: {error}", dir.display());
            return ExitCode::FAILURE;
        }
    };

    let count = |n: usize, noun: &str| format!("{n} {noun}{}", if n == 1 { "" } else { "s" });
    let list = |items: &[String]| {
        if items.is_empty() {
            "none".to_string()
        } else {
            items.join(", ")
        }
    };
    println!("{}: valid", dir.display());
    println!(
        "  from the workspace: {}",
        list(
            &loaded
                .replaced
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        )
    );
    if !loaded.ignored.is_empty() {
        println!("  not read:");
        for path in &loaded.ignored {
            println!("    {}", path.display());
        }
    }
    println!("  topologies ({}):", assets.worlds.len());
    for (id, world) in &assets.worlds {
        let summary = world.summary();
        println!(
            "    {id}: {}, {}, {}{}",
            count(summary.node_count, "service"),
            count(summary.edge_count, "connection"),
            count(summary.region_count, "region"),
            if *id == assets.default_topology {
                " (opens at start-up)"
            } else {
                ""
            }
        );
    }
    println!(
        "  scenarios ({}): {}",
        scenario_ids.len(),
        list(&scenario_ids)
    );
    let recordings: Vec<String> = assets.recordings.iter().map(|r| r.id.clone()).collect();
    println!("  recordings ({}): {}", recordings.len(), list(&recordings));
    println!(
        "  policies: {}; baseline traffic denied by Cedar: {:.1} %",
        assets.cedar.policies().len(),
        assets.decisions.baseline_deny_fraction * 100.0
    );
    if !assets.unavailable.is_empty() {
        println!("  scenarios that cannot run on a topology:");
        for entry in &assets.unavailable {
            println!(
                "    {} on {}: {}",
                entry.scenario, entry.topology, entry.reason
            );
        }
    }
    ExitCode::SUCCESS
}

/// One side of a comparison: a workspace directory, or `@bundled`.
fn load_side(side: &str) -> Result<Assets, String> {
    let sources = if side == BUNDLED {
        aegis_server::application::Sources::bundled().map_err(|e| e.to_string())?
    } else {
        workspace::load(Path::new(side))
            .map_err(|e| e.to_string())?
            .sources
    };
    Assets::build(sources).map_err(|e| format!("{side}: {e}"))
}

/// `aegis-server diff-workspace <base> <candidate>`: builds both sides the
/// way start-up would and reports what Cedar decides differently. Exit
/// status follows `diff`: 0, or 1 with `--exit-code` when a decision
/// differs, and 2 when a side cannot be built.
fn diff_workspace(args: &[&str]) -> ExitCode {
    let (flags, sides): (Vec<&str>, Vec<&str>) = args.iter().partition(|arg| arg.starts_with("--"));
    let unknown = flags
        .iter()
        .find(|flag| !["--json", "--exit-code"].contains(flag));
    let (Some(base), Some(candidate), None, 2) =
        (sides.first(), sides.get(1), unknown, sides.len())
    else {
        eprintln!("aegis-server diff-workspace: expected <base> <candidate> [--json] [--exit-code]\n{USAGE}");
        return ExitCode::from(2);
    };
    let compared = load_side(base).and_then(|before| {
        let after = load_side(candidate)?;
        compare(&before, &after).map_err(|e| e.to_string())
    });
    let diff = match compared {
        Ok(diff) => diff,
        Err(error) => {
            eprintln!("aegis-server diff-workspace: {error}");
            return ExitCode::from(2);
        }
    };
    if flags.contains(&"--json") {
        let report = serde_json::json!({
            "base": base,
            "candidate": candidate,
            "decisionsChanged": diff.decisions_changed(),
            "diff": diff,
        });
        match serde_json::to_string_pretty(&report) {
            Ok(text) => println!("{text}"),
            Err(error) => {
                eprintln!("aegis-server diff-workspace: {error}");
                return ExitCode::from(2);
            }
        }
    } else {
        print!("{}", diff.render(base, candidate));
    }
    if flags.contains(&"--exit-code") && diff.decisions_changed() {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

/// One side of an incident comparison, with the sources it was built from.
fn load_whole(side: &str) -> Result<Loaded, String> {
    let sources = if side == BUNDLED {
        Sources::bundled().map_err(|e| e.to_string())?
    } else {
        workspace::load(Path::new(side))
            .map_err(|e| e.to_string())?
            .sources
    };
    Loaded::build(sources, WorkspaceOrigin::Startup, Vec::new(), Vec::new())
        .map_err(|e| format!("{side}: {e}"))
}

/// `aegis-server compare-incident <base> <candidate> <scenario>`: runs one
/// scenario on the platform the base opens on and on the candidate's, each
/// on a timeline of its own from the same seed, and prints what differs
/// between the two descriptions and the two runs. Exit status 2 when it
/// cannot be run.
fn compare_incident(args: &[&str]) -> ExitCode {
    const EXPECTED: &str =
        "expected <base> <candidate> <scenario> [--topology=<id>] [--seed=<n>] [--json]";
    let (flags, rest): (Vec<&str>, Vec<&str>) = args.iter().partition(|arg| arg.starts_with("--"));
    let mut json = false;
    let mut topology = None;
    let mut seed = DEFAULT_SEED;
    for flag in &flags {
        let known = if let Some(id) = flag.strip_prefix("--topology=") {
            topology = Some(id);
            !id.is_empty()
        } else if let Some(text) = flag.strip_prefix("--seed=") {
            text.parse().map(|parsed| seed = parsed).is_ok()
        } else {
            json = true;
            *flag == "--json"
        };
        if !known {
            eprintln!("aegis-server compare-incident: {EXPECTED}\n{USAGE}");
            return ExitCode::from(2);
        }
    }
    let [base, candidate, scenario] = rest[..] else {
        eprintln!("aegis-server compare-incident: {EXPECTED}\n{USAGE}");
        return ExitCode::from(2);
    };
    let compared = load_whole(base).and_then(|before| {
        let after = load_whole(candidate)?;
        let in_use = before.assets.default_topology.clone();
        across(&before, &in_use, &after, scenario, topology, seed).map_err(|e| e.to_string())
    });
    let comparison = match compared {
        Ok(comparison) => comparison,
        Err(error) => {
            eprintln!("aegis-server compare-incident: {error}");
            return ExitCode::from(2);
        }
    };
    if json {
        match serde_json::to_string_pretty(&comparison) {
            Ok(text) => println!("{text}"),
            Err(error) => {
                eprintln!("aegis-server compare-incident: {error}");
                return ExitCode::from(2);
            }
        }
    } else {
        print!("{}", comparison.render(base, candidate));
    }
    ExitCode::SUCCESS
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    // Commands that do not serve anything need no server configuration.
    match args.as_slice() {
        ["--version" | "-V"] => {
            println!("aegis-server {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        ["--help" | "-h"] => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        ["export-workspace", dir] => return export_workspace(Path::new(dir)),
        ["check-workspace", dir] => return check_workspace(Path::new(dir)),
        ["diff-workspace", rest @ ..] => return diff_workspace(rest),
        ["compare-incident", rest @ ..] => return compare_incident(rest),
        [] | ["healthcheck"] => {}
        _ => {
            eprintln!("aegis-server: unexpected arguments\n{USAGE}");
            return ExitCode::from(2);
        }
    }
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("aegis-server: invalid configuration: {error}");
            return ExitCode::from(2);
        }
    };
    if args == ["healthcheck"] {
        return healthcheck(config.bind);
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_new(&config.log_filter).unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let bind = config.bind;
    let state = match build_state(config) {
        Ok(state) => state,
        Err(error) => {
            tracing::error!(%error, "start-up failed");
            return ExitCode::FAILURE;
        }
    };
    let scheduler = state.service.spawn();

    let assets = state.service.assets();
    let world = assets.default_world();
    tracing::info!(
        %bind,
        topology = %world.topo.spec.id,
        nodes = world.topo.node_count(),
        edges = world.topo.edge_count(),
        workspace = state.config.workspace.is_some(),
        cedar_agent_configured = state.config.integrations.cedar_agent.is_some(),
        rinha_configured = state.config.integrations.rinha.is_some(),
        "AEGIS server starting in demo mode"
    );

    let listener = match tokio::net::TcpListener::bind(bind).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%bind, %error, "could not bind");
            return ExitCode::FAILURE;
        }
    };
    let app = api::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let served = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await;
    scheduler.abort();
    match served {
        Ok(()) => {
            tracing::info!("AEGIS server stopped");
            ExitCode::SUCCESS
        }
        Err(error) => {
            tracing::error!(%error, "server error");
            ExitCode::FAILURE
        }
    }
}

use std::net::SocketAddr;
use std::path::Path;
use std::process::ExitCode;

use aegis_server::application::Assets;
use aegis_server::config::Config;
use aegis_server::{api, build_state, workspace};
use tracing_subscriber::EnvFilter;

const USAGE: &str = "\
usage: aegis-server                          run the server
       aegis-server export-workspace <dir>   write the bundled topologies, scenarios,
                                             recordings and Cedar files into <dir>
       aegis-server check-workspace <dir>    validate a workspace without starting
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

    let world = state.service.assets().default_world();
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

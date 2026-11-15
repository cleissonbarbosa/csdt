use std::net::SocketAddr;
use std::process::ExitCode;

use aegis_server::config::Config;
use aegis_server::{api, build_state};
use tracing_subscriber::EnvFilter;

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

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("aegis-server: invalid configuration: {error}");
            return ExitCode::from(2);
        }
    };
    match std::env::args().nth(1).as_deref() {
        None => {}
        Some("healthcheck") => return healthcheck(config.bind),
        Some("--version" | "-V") => {
            println!("aegis-server {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Some(other) => {
            eprintln!(
                "aegis-server: unknown argument `{other}` (expected nothing or `healthcheck`)"
            );
            return ExitCode::from(2);
        }
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

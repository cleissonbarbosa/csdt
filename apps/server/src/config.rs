//! Server configuration, read once from the environment.

use std::net::SocketAddr;
use std::time::Duration;

use crate::integrations::{CedarAgentConfig, IntegrationConfig, RinhaConfig};

const DEFAULT_BIND: &str = "127.0.0.1:8787";
const DEFAULT_ORIGINS: &str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173";
const DEFAULT_SEED: u64 = 42;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("AEGIS_BIND `{0}` is not a socket address such as 127.0.0.1:8787")]
    Bind(String),
    #[error("AEGIS_SEED `{0}` is not an unsigned integer")]
    Seed(String),
    #[error("AEGIS_ALLOWED_ORIGINS entry `{0}` is not an origin such as http://localhost:5173")]
    Origin(String),
    #[error("{name} `{value}` is not a boolean (use true or false)")]
    Bool { name: &'static str, value: String },
    #[error("AEGIS_RINHA_PROBE_SECONDS `{0}` is not a positive number of seconds")]
    ProbeInterval(String),
}

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub allowed_origins: Vec<String>,
    pub seed: u64,
    pub log_filter: String,
    pub integrations: IntegrationConfig,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn list(value: Option<String>) -> Vec<String> {
    non_empty(value)
        .map(|v| {
            v.split(',')
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// An origin is `scheme://host[:port]` with nothing after it.
fn valid_origin(origin: &str) -> bool {
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false;
    };
    matches!(scheme, "http" | "https")
        && !rest.is_empty()
        && !rest.contains(['/', '?', '#', '@', ' '])
        && origin.parse::<axum::http::HeaderValue>().is_ok()
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Builds the configuration from any key/value source. Used by tests so
    /// they never have to mutate the process environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get = |name: &str| non_empty(lookup(name));

        let bind_raw = get("AEGIS_BIND").unwrap_or_else(|| DEFAULT_BIND.to_string());
        let bind = bind_raw
            .parse()
            .map_err(|_| ConfigError::Bind(bind_raw.clone()))?;

        let seed = match get("AEGIS_SEED") {
            Some(raw) => raw.parse().map_err(|_| ConfigError::Seed(raw))?,
            None => DEFAULT_SEED,
        };

        let allowed_origins = {
            let configured = list(lookup("AEGIS_ALLOWED_ORIGINS"));
            if configured.is_empty() {
                list(Some(DEFAULT_ORIGINS.to_string()))
            } else {
                configured
            }
        };
        if let Some(bad) = allowed_origins.iter().find(|o| !valid_origin(o)) {
            return Err(ConfigError::Origin(bad.clone()));
        }

        let boolean = |name: &'static str| -> Result<bool, ConfigError> {
            match get(name).as_deref() {
                None => Ok(false),
                Some("true" | "1" | "yes") => Ok(true),
                Some("false" | "0" | "no") => Ok(false),
                Some(other) => Err(ConfigError::Bool {
                    name,
                    value: other.to_string(),
                }),
            }
        };

        let cedar_agent = match get("AEGIS_CEDAR_AGENT_URL") {
            Some(base_url) => Some(CedarAgentConfig {
                base_url,
                token: get("AEGIS_CEDAR_AGENT_TOKEN"),
                sync: boolean("AEGIS_CEDAR_AGENT_SYNC")?,
            }),
            None => None,
        };
        let rinha = match get("AEGIS_RINHA_URL") {
            Some(base_url) => {
                let mut config = RinhaConfig::new(base_url);
                if let Some(raw) = get("AEGIS_RINHA_PROBE_SECONDS") {
                    let seconds: f64 = raw
                        .parse()
                        .ok()
                        .filter(|s: &f64| s.is_finite() && *s > 0.0)
                        .ok_or(ConfigError::ProbeInterval(raw))?;
                    config.probe_interval = Duration::from_secs_f64(seconds.min(3600.0));
                }
                Some(config)
            }
            None => None,
        };

        Ok(Self {
            bind,
            allowed_origins,
            seed,
            log_filter: get("AEGIS_LOG").unwrap_or_else(|| "info".to_string()),
            integrations: IntegrationConfig {
                cedar_agent,
                rinha,
                allowed_hosts: list(lookup("AEGIS_INTEGRATION_ALLOWED_HOSTS")),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(pairs: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let owned: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        Config::from_lookup(move |name| {
            owned
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        })
    }

    #[test]
    fn defaults_need_no_environment_and_enable_no_integration() {
        let config = config(&[]).expect("defaults are valid");
        assert_eq!(config.bind.to_string(), "127.0.0.1:8787");
        assert_eq!(config.seed, 42);
        assert!(config.allowed_origins.contains(&"http://localhost:5173".to_string()));
        assert!(config.integrations.cedar_agent.is_none());
        assert!(config.integrations.rinha.is_none());
    }

    #[test]
    fn blank_values_count_as_unset() {
        let config = config(&[("AEGIS_CEDAR_AGENT_URL", "   "), ("AEGIS_SEED", "")]).unwrap();
        assert!(config.integrations.cedar_agent.is_none());
        assert_eq!(config.seed, 42);
    }

    #[test]
    fn integrations_are_configured_explicitly() {
        let config = config(&[
            ("AEGIS_CEDAR_AGENT_URL", "http://127.0.0.1:8180"),
            ("AEGIS_CEDAR_AGENT_TOKEN", "s3cret"),
            ("AEGIS_CEDAR_AGENT_SYNC", "true"),
            ("AEGIS_RINHA_URL", "http://127.0.0.1:9999"),
            ("AEGIS_INTEGRATION_ALLOWED_HOSTS", "cedar-agent, rinha-lb"),
        ])
        .unwrap();
        let agent = config.integrations.cedar_agent.expect("agent configured");
        assert!(agent.sync);
        assert_eq!(agent.token.as_deref(), Some("s3cret"));
        // The token must never leak through Debug output.
        assert!(!format!("{agent:?}").contains("s3cret"));
        assert_eq!(
            config.integrations.allowed_hosts,
            ["cedar-agent", "rinha-lb"]
        );
    }

    #[test]
    fn rejects_malformed_values() {
        assert_eq!(
            config(&[("AEGIS_BIND", "localhost")]).unwrap_err(),
            ConfigError::Bind("localhost".into())
        );
        assert_eq!(
            config(&[("AEGIS_SEED", "-1")]).unwrap_err(),
            ConfigError::Seed("-1".into())
        );
        for origin in ["*", "localhost:5173", "http://a.example/path", "http://u@a.example"] {
            assert_eq!(
                config(&[("AEGIS_ALLOWED_ORIGINS", origin)]).unwrap_err(),
                ConfigError::Origin(origin.into()),
            );
        }
        assert!(matches!(
            config(&[
                ("AEGIS_CEDAR_AGENT_URL", "http://127.0.0.1:8180"),
                ("AEGIS_CEDAR_AGENT_SYNC", "maybe")
            ]),
            Err(ConfigError::Bool { .. })
        ));
    }
}

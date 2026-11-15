//! Target validation for outbound integration requests.
//!
//! Connected Mode may only talk to instances the operator explicitly
//! configured, and by default only on the loopback interface. This module is
//! the single choke point that enforces it.

use std::net::IpAddr;

use reqwest::Url;

use super::ProviderError;

/// A validated integration target. The base URL never carries credentials,
/// a query string or a fragment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    base: Url,
}

impl Target {
    /// Joins a path onto the base URL.
    pub fn url(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.base.as_str().trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    /// The target as shown to users: scheme, host and port only.
    pub fn display(&self) -> String {
        self.base.as_str().trim_end_matches('/').to_string()
    }
}

fn is_loopback(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.trim_matches(['[', ']'])
        .parse::<IpAddr>()
        .is_ok_and(|ip| ip.is_loopback())
}

/// Validates an operator-supplied base URL.
///
/// Accepts `http`/`https` URLs without credentials, query or fragment whose
/// host is loopback or listed in `allowed_hosts`.
pub fn validate_target(raw: &str, allowed_hosts: &[String]) -> Result<Target, ProviderError> {
    let refuse = |reason: &str| ProviderError::Refused(format!("{reason} ({raw})"));
    let url = Url::parse(raw.trim()).map_err(|_| refuse("not a valid URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(refuse("only http and https targets are supported"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(refuse("credentials must not be embedded in the URL"));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(refuse("the URL must not contain a query or fragment"));
    }
    if !matches!(url.path(), "" | "/") {
        return Err(refuse("the URL must not contain a path"));
    }
    let host = url
        .host_str()
        .ok_or_else(|| refuse("the URL has no host"))?;
    let allowed = is_loopback(host)
        || allowed_hosts
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(host));
    if !allowed {
        return Err(refuse(
            "host is neither loopback nor listed in AEGIS_INTEGRATION_ALLOWED_HOSTS",
        ));
    }
    Ok(Target { base: url })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_loopback_targets() {
        for raw in [
            "http://127.0.0.1:8180",
            "http://localhost:9999/",
            "http://[::1]:8180",
            "https://127.0.0.5:8443",
        ] {
            assert!(validate_target(raw, &[]).is_ok(), "{raw}");
        }
    }

    #[test]
    fn refuses_everything_else_by_default() {
        for raw in [
            "http://example.com",
            "http://10.0.0.8:8180",
            "http://192.168.1.20:8180",
            "http://169.254.169.254/",
            "http://cedar-agent:8180",
            "ftp://127.0.0.1",
            "file:///etc/passwd",
            "http://user:secret@127.0.0.1:8180",
            "http://127.0.0.1:8180/?x=1",
            "http://127.0.0.1:8180/v1",
            "http://127.0.0.1.evil.example:8180",
            "not a url",
        ] {
            assert!(
                matches!(validate_target(raw, &[]), Err(ProviderError::Refused(_))),
                "{raw} must be refused"
            );
        }
    }

    #[test]
    fn allowlist_admits_named_hosts_only() {
        let allowed = vec!["cedar-agent".to_string()];
        assert!(validate_target("http://cedar-agent:8180", &allowed).is_ok());
        assert!(validate_target("http://other:8180", &allowed).is_err());
    }

    #[test]
    fn joins_paths_without_doubling_slashes() {
        let target = validate_target("http://127.0.0.1:8180/", &[]).expect("valid");
        assert_eq!(
            target.url("/v1/is_authorized"),
            "http://127.0.0.1:8180/v1/is_authorized"
        );
        assert_eq!(target.url("v1/"), "http://127.0.0.1:8180/v1/");
        assert_eq!(target.display(), "http://127.0.0.1:8180");
    }
}

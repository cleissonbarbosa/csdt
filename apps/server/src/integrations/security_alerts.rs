//! Fixture adapter modelled on the public `telegram-security-bot` project
//! (<https://github.com/cleissonbarbosa/telegram-security-bot>).
//!
//! The bot has no service or API of its own: it is a Telegram client that
//! queries the public NVD CVE API 2.0 and formats the answer. What can be
//! reused is the *shape of the data it consumes*. Its handlers
//! (`src/commands/handlers/recent_vulnerabilities.py`) read `cve.id`,
//! `cve.descriptions[]` and `cve.metrics.cvssMetricV31[0].cvssData.baseScore`.
//!
//! This adapter parses those same fields from a bundled document in the NVD
//! response shape. Every advisory in it is fictional. AEGIS never contacts
//! NVD or Telegram.

use std::collections::BTreeMap;
use std::sync::Mutex;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::domain::{
    DataSource, EventKind, ImportedEvent, IntegrationKind, IntegrationMetric, IntegrationState,
    IntegrationStatus, Severity,
};

use super::{ConnectOutcome, ProviderError, TelemetryProvider};

pub const PROVIDER_ID: &str = "security-alerts";
const REPOSITORY: &str = "https://github.com/cleissonbarbosa/telegram-security-bot";
const BUNDLED_FEED: &str =
    include_str!("../../../../fixtures/integrations/security-alerts/nvd-recent.json");
const BUNDLED_MAPPING: &str =
    include_str!("../../../../fixtures/integrations/security-alerts/affected-services.json");
const MAX_ADVISORIES: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 400;

// The subset of the NVD CVE API 2.0 response the bot reads.
#[derive(Debug, Deserialize)]
struct NvdResponse {
    vulnerabilities: Vec<NvdItem>,
}

#[derive(Debug, Deserialize)]
struct NvdItem {
    cve: NvdCve,
}

#[derive(Debug, Deserialize)]
struct NvdCve {
    id: String,
    #[serde(default)]
    published: Option<String>,
    #[serde(default)]
    descriptions: Vec<NvdDescription>,
    #[serde(default)]
    metrics: NvdMetrics,
}

#[derive(Debug, Deserialize)]
struct NvdDescription {
    lang: String,
    value: String,
}

#[derive(Debug, Default, Deserialize)]
struct NvdMetrics {
    #[serde(default, rename = "cvssMetricV31")]
    cvss_v31: Vec<NvdCvssMetric>,
}

#[derive(Debug, Deserialize)]
struct NvdCvssMetric {
    #[serde(rename = "cvssData")]
    cvss_data: NvdCvssData,
}

#[derive(Debug, Deserialize)]
struct NvdCvssData {
    #[serde(rename = "baseScore")]
    base_score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Advisory {
    pub id: String,
    pub published: Option<String>,
    pub description: String,
    /// CVSS v3.1 base score when the entry carries one.
    pub base_score: Option<f64>,
}

impl Advisory {
    /// Severity bands follow the CVSS v3.1 qualitative scale.
    pub fn severity(&self) -> Severity {
        match self.base_score {
            Some(score) if score >= 9.0 => Severity::Critical,
            Some(score) if score >= 7.0 => Severity::Warning,
            Some(score) if score >= 4.0 => Severity::Notice,
            _ => Severity::Info,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FeedError {
    #[error("feed is not an NVD CVE API 2.0 response: {0}")]
    Shape(#[from] serde_json::Error),
    #[error("advisory id `{0}` is not a CVE identifier")]
    InvalidId(String),
    #[error("feed holds more than {MAX_ADVISORIES} advisories")]
    TooMany,
}

fn is_cve_id(id: &str) -> bool {
    let mut parts = id.split('-');
    let ok = parts.next() == Some("CVE")
        && parts
            .next()
            .is_some_and(|year| year.len() == 4 && year.bytes().all(|b| b.is_ascii_digit()))
        && parts.next().is_some_and(|number| {
            (4..=9).contains(&number.len()) && number.bytes().all(|b| b.is_ascii_digit())
        });
    ok && parts.next().is_none()
}

/// Parses an NVD CVE API 2.0 document, reading the fields the bot reads.
pub fn parse_feed(raw: &str) -> Result<Vec<Advisory>, FeedError> {
    let response: NvdResponse = serde_json::from_str(raw)?;
    if response.vulnerabilities.len() > MAX_ADVISORIES {
        return Err(FeedError::TooMany);
    }
    response
        .vulnerabilities
        .into_iter()
        .map(|item| {
            let cve = item.cve;
            if !is_cve_id(&cve.id) {
                return Err(FeedError::InvalidId(cve.id.chars().take(40).collect()));
            }
            let description = cve
                .descriptions
                .iter()
                .find(|d| d.lang == "en")
                .map_or("No description available", |d| d.value.as_str())
                .chars()
                .take(MAX_DESCRIPTION_CHARS)
                .collect();
            let base_score = cve
                .metrics
                .cvss_v31
                .first()
                .map(|m| m.cvss_data.base_score)
                .filter(|score| (0.0..=10.0).contains(score));
            Ok(Advisory {
                id: cve.id,
                published: cve.published,
                description,
                base_score,
            })
        })
        .collect()
}

pub fn advisory_events(
    advisories: &[Advisory],
    affected: &BTreeMap<String, Vec<String>>,
) -> Vec<ImportedEvent> {
    advisories
        .iter()
        .map(|advisory| ImportedEvent {
            severity: advisory.severity(),
            kind: EventKind::CveAdvisory,
            title: match advisory.base_score {
                Some(score) => format!("{} · CVSS {score:.1}", advisory.id),
                None => format!("{} · unscored", advisory.id),
            },
            message: advisory.description.clone(),
            node_ids: affected.get(&advisory.id).cloned().unwrap_or_default(),
            data_source: DataSource::Recording,
            details: json!({ "advisory": advisory, "fictional": true }),
        })
        .collect()
}

#[derive(Debug, Default)]
pub struct SecurityAlertFixtureProvider {
    imported: Mutex<Option<Vec<Advisory>>>,
}

#[async_trait]
impl TelemetryProvider for SecurityAlertFixtureProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    async fn status(&self) -> IntegrationStatus {
        let imported = self
            .imported
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let metrics = imported.as_ref().map_or_else(Vec::new, |advisories| {
            let highest = advisories
                .iter()
                .filter_map(|a| a.base_score)
                .fold(None, |max: Option<f64>, score| {
                    Some(max.map_or(score, |m| m.max(score)))
                });
            vec![
                IntegrationMetric {
                    label: "Advisories".into(),
                    value: advisories.len().to_string(),
                },
                IntegrationMetric {
                    label: "Highest CVSS".into(),
                    value: highest.map_or_else(|| "n/a".into(), |s| format!("{s:.1}")),
                },
            ]
        });
        IntegrationStatus {
            id: PROVIDER_ID.into(),
            name: "Security Advisories".into(),
            kind: IntegrationKind::Fixture,
            state: if imported.is_some() {
                IntegrationState::Imported
            } else {
                IntegrationState::Available
            },
            data_source: DataSource::Recording,
            description: "Parses a bundled document in the NVD CVE 2.0 shape the bot consumes and shows the advisories on affected services. All advisories are fictional; NVD is never contacted.".into(),
            repository: Some(REPOSITORY.into()),
            verified_interface: Some(
                "NVD CVE API 2.0 fields: cve.id, descriptions, cvssMetricV31.baseScore".into(),
            ),
            endpoint: None,
            capabilities: vec!["vulnerability advisories".into()],
            metrics,
            last_error: None,
        }
    }

    async fn connect(&self) -> Result<ConnectOutcome, ProviderError> {
        let advisories =
            parse_feed(BUNDLED_FEED).map_err(|e| ProviderError::Protocol(e.to_string()))?;
        let affected: BTreeMap<String, Vec<String>> = serde_json::from_str(BUNDLED_MAPPING)
            .map_err(|e| ProviderError::Protocol(e.to_string()))?;
        let events = advisory_events(&advisories, &affected);
        *self
            .imported
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(advisories);
        Ok(ConnectOutcome { events })
    }

    async fn disconnect(&self) -> Result<(), ProviderError> {
        *self
            .imported
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_bundled_feed() {
        let advisories = parse_feed(BUNDLED_FEED).expect("bundled feed parses");
        assert_eq!(advisories.len(), 4);
        assert!(advisories.iter().all(|a| a.id.starts_with("CVE-2099-")));
        assert!(advisories
            .iter()
            .all(|a| a.description.starts_with("FICTIONAL ADVISORY")));
        assert_eq!(advisories[0].base_score, Some(9.8));
        assert_eq!(advisories[3].base_score, None, "entry without metrics");
    }

    #[test]
    fn severity_follows_cvss_bands() {
        let severity = |score| {
            Advisory {
                id: "CVE-2099-0001".into(),
                published: None,
                description: String::new(),
                base_score: score,
            }
            .severity()
        };
        assert_eq!(severity(Some(9.8)), Severity::Critical);
        assert_eq!(severity(Some(8.1)), Severity::Warning);
        assert_eq!(severity(Some(6.5)), Severity::Notice);
        assert_eq!(severity(Some(2.0)), Severity::Info);
        assert_eq!(severity(None), Severity::Info);
    }

    #[test]
    fn rejects_malformed_feeds() {
        assert!(matches!(parse_feed("{}"), Err(FeedError::Shape(_))));
        let bad_id = r#"{"vulnerabilities":[{"cve":{"id":"<script>alert(1)</script>"}}]}"#;
        assert!(matches!(parse_feed(bad_id), Err(FeedError::InvalidId(_))));
        assert!(is_cve_id("CVE-2099-10001"));
        assert!(!is_cve_id("CVE-99-1"));
        assert!(!is_cve_id("CVE-2099-10001-extra"));
    }

    #[test]
    fn out_of_range_scores_are_dropped_not_trusted() {
        let raw = r#"{"vulnerabilities":[{"cve":{"id":"CVE-2099-0001","metrics":{"cvssMetricV31":[{"cvssData":{"baseScore":42.0}}]}}}]}"#;
        let advisories = parse_feed(raw).expect("parses");
        assert_eq!(advisories[0].base_score, None);
        assert_eq!(advisories[0].description, "No description available");
    }

    #[test]
    fn events_map_to_affected_services_and_are_recordings() {
        let advisories = parse_feed(BUNDLED_FEED).unwrap();
        let affected: BTreeMap<String, Vec<String>> =
            serde_json::from_str(BUNDLED_MAPPING).unwrap();
        let events = advisory_events(&advisories, &affected);
        assert_eq!(events.len(), 4);
        assert_eq!(events[0].severity, Severity::Critical);
        assert!(events[0].node_ids.contains(&"use-gateway".to_string()));
        assert!(events.iter().all(|e| e.data_source == DataSource::Recording));
    }
}

//! Fixture adapter for the public `network-scanner` project
//! (<https://github.com/cleissonbarbosa/network-scanner>).
//!
//! The project is a command-line tool: it scans a fixed list of TCP ports on
//! `127.0.0.1` and writes a plain-text `scan_report.txt`. It has no API.
//! AEGIS therefore integrates with its *output format* only, which was
//! verified in `app/Main.hs`, `app/Scanner.hs` and `app/OSFingerprint.hs`:
//!
//! ```text
//! Scan report generated at: <timestamp>
//!
//! Port <n> is open (<service>)
//! No connection to port <n>
//!
//! OS Fingerprint based on TTL (<ttl>): <guess>
//! ```
//!
//! AEGIS never runs the scanner and never performs a scan of its own. The
//! bundled report is hand-authored and labelled as a recording.

use std::sync::Mutex;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::json;

use crate::domain::{
    DataSource, EventKind, ImportedEvent, IntegrationKind, IntegrationMetric, IntegrationState,
    IntegrationStatus, Severity,
};

use super::{ConnectOutcome, ProviderError, TelemetryProvider};

pub const PROVIDER_ID: &str = "network-scanner";
const REPOSITORY: &str = "https://github.com/cleissonbarbosa/network-scanner";
const BUNDLED_REPORT: &str =
    include_str!("../../../../fixtures/integrations/network-scanner/scan_report.txt");
/// Reports larger than this are refused.
const MAX_REPORT_BYTES: usize = 64 * 1024;
const MAX_FINDINGS: usize = 2048;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortFinding {
    pub port: u16,
    pub open: bool,
    /// Service name the scanner inferred from the port number.
    pub service: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsFingerprint {
    pub ttl: Option<u16>,
    pub guess: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub generated_at: String,
    /// One entry per distinct port, in ascending order.
    pub findings: Vec<PortFinding>,
    pub os_fingerprint: Option<OsFingerprint>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ReportError {
    #[error("report is larger than {MAX_REPORT_BYTES} bytes")]
    TooLarge,
    #[error("missing `Scan report generated at:` header")]
    MissingHeader,
    #[error("line {line}: not a line the scanner produces")]
    UnexpectedLine { line: usize },
    #[error("line {line}: invalid port number")]
    InvalidPort { line: usize },
    #[error("report lists more than {MAX_FINDINGS} ports")]
    TooManyFindings,
}

/// Parses a `scan_report.txt` written by network-scanner. Strict: any line
/// the scanner could not have produced is an error.
pub fn parse_report(text: &str) -> Result<ScanReport, ReportError> {
    if text.len() > MAX_REPORT_BYTES {
        return Err(ReportError::TooLarge);
    }
    let mut generated_at = None;
    let mut findings: Vec<PortFinding> = Vec::new();
    let mut os_fingerprint = None;

    for (index, raw) in text.lines().enumerate() {
        let line_number = index + 1;
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("Scan report generated at:") {
            generated_at = Some(rest.trim().to_string());
            continue;
        }
        let parse_port = |s: &str| {
            s.trim()
                .parse::<u16>()
                .map_err(|_| ReportError::InvalidPort { line: line_number })
        };
        let finding = if let Some(rest) = line.strip_prefix("Port ") {
            let (port, service) = rest
                .split_once(" is open (")
                .and_then(|(port, tail)| tail.strip_suffix(')').map(|service| (port, service)))
                .ok_or(ReportError::UnexpectedLine { line: line_number })?;
            Some(PortFinding {
                port: parse_port(port)?,
                open: true,
                service: Some(service.to_string()),
            })
        } else if let Some(rest) = line.strip_prefix("No connection to port ") {
            Some(PortFinding {
                port: parse_port(rest)?,
                open: false,
                service: None,
            })
        } else {
            None
        };
        if let Some(finding) = finding {
            // The scanner lists port 80 twice (once explicitly, once in its
            // 75..85 range); keep one entry per port.
            if !findings.iter().any(|f| f.port == finding.port) {
                if findings.len() >= MAX_FINDINGS {
                    return Err(ReportError::TooManyFindings);
                }
                findings.push(finding);
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("OS Fingerprint based on TTL (") {
            let (ttl, guess) = rest
                .split_once("): ")
                .ok_or(ReportError::UnexpectedLine { line: line_number })?;
            os_fingerprint = Some(OsFingerprint {
                ttl: ttl.trim().parse().ok(),
                guess: guess.trim().to_string(),
            });
            continue;
        }
        if line == "OS Fingerprint: Unable to determine TTL." {
            os_fingerprint = Some(OsFingerprint {
                ttl: None,
                guess: "Unknown".to_string(),
            });
            continue;
        }
        return Err(ReportError::UnexpectedLine { line: line_number });
    }

    findings.sort_by_key(|f| f.port);
    Ok(ScanReport {
        generated_at: generated_at.ok_or(ReportError::MissingHeader)?,
        findings,
        os_fingerprint,
    })
}

/// Turns a report into timeline events.
pub fn report_events(report: &ScanReport) -> Vec<ImportedEvent> {
    let open: Vec<&PortFinding> = report.findings.iter().filter(|f| f.open).collect();
    let mut events = vec![ImportedEvent {
        severity: Severity::Notice,
        kind: EventKind::ScanFinding,
        title: format!(
            "Port scan report: {} of {} ports open",
            open.len(),
            report.findings.len()
        ),
        message: format!(
            "Imported from a network-scanner report generated at {}.{}",
            report.generated_at,
            report
                .os_fingerprint
                .as_ref()
                .map(|os| format!(" OS guess: {}.", os.guess))
                .unwrap_or_default()
        ),
        node_ids: Vec::new(),
        data_source: DataSource::Recording,
        details: json!({ "report": report }),
    }];
    for finding in open {
        events.push(ImportedEvent {
            severity: Severity::Info,
            kind: EventKind::ScanFinding,
            title: format!("Open port {}", finding.port),
            message: format!(
                "TCP {} accepted a connection ({}).",
                finding.port,
                finding.service.as_deref().unwrap_or("unknown service")
            ),
            node_ids: Vec::new(),
            data_source: DataSource::Recording,
            details: json!({ "finding": finding }),
        });
    }
    events
}

#[derive(Debug, Default)]
pub struct NetworkScannerFixtureProvider {
    imported: Mutex<Option<ScanReport>>,
}

#[async_trait]
impl TelemetryProvider for NetworkScannerFixtureProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    async fn status(&self) -> IntegrationStatus {
        let imported = self
            .imported
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let metrics = imported.as_ref().map_or_else(Vec::new, |report| {
            let open: Vec<String> = report
                .findings
                .iter()
                .filter(|f| f.open)
                .map(|f| f.port.to_string())
                .collect();
            vec![
                IntegrationMetric {
                    label: "Ports in report".into(),
                    value: report.findings.len().to_string(),
                },
                IntegrationMetric {
                    label: "Open".into(),
                    value: if open.is_empty() {
                        "none".into()
                    } else {
                        open.join(", ")
                    },
                },
                IntegrationMetric {
                    label: "OS guess".into(),
                    value: report
                        .os_fingerprint
                        .as_ref()
                        .map_or_else(|| "n/a".into(), |os| os.guess.clone()),
                },
            ]
        });
        IntegrationStatus {
            id: PROVIDER_ID.into(),
            name: "Network Scanner".into(),
            kind: IntegrationKind::Fixture,
            state: if imported.is_some() {
                IntegrationState::Imported
            } else {
                IntegrationState::Available
            },
            data_source: DataSource::Recording,
            description: "Parses a bundled, hand-authored report in the scanner's text format and places its findings on the timeline. AEGIS never runs a scan.".into(),
            repository: Some(REPOSITORY.into()),
            verified_interface: Some("scan_report.txt text format".into()),
            endpoint: None,
            capabilities: vec!["scan findings".into()],
            metrics,
            last_error: None,
        }
    }

    async fn connect(&self) -> Result<ConnectOutcome, ProviderError> {
        let report =
            parse_report(BUNDLED_REPORT).map_err(|e| ProviderError::Protocol(e.to_string()))?;
        let events = report_events(&report);
        *self
            .imported
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(report);
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
    fn parses_the_bundled_report() {
        let report = parse_report(BUNDLED_REPORT).expect("bundled report parses");
        assert_eq!(report.generated_at, "2026-01-15 09:30:00.482913 UTC");
        // 80, 443, 8080 plus 75..=85, with the duplicate 80 folded.
        assert_eq!(report.findings.len(), 13);
        let open: Vec<u16> = report
            .findings
            .iter()
            .filter(|f| f.open)
            .map(|f| f.port)
            .collect();
        assert_eq!(open, [80, 8080]);
        assert_eq!(
            report.findings.iter().find(|f| f.port == 8080).unwrap().service.as_deref(),
            Some("HTTP-Alt")
        );
        assert_eq!(
            report.os_fingerprint,
            Some(OsFingerprint {
                ttl: Some(64),
                guess: "Linux/Unix".into()
            })
        );
    }

    #[test]
    fn handles_the_undetermined_fingerprint_line() {
        let report = parse_report(
            "Scan report generated at: now\n\nNo connection to port 22\n\nOS Fingerprint: Unable to determine TTL.\n",
        )
        .expect("parses");
        assert_eq!(report.os_fingerprint.unwrap().ttl, None);
    }

    #[test]
    fn rejects_lines_the_scanner_cannot_produce() {
        assert_eq!(
            parse_report("Port 80 is open (HTTP)\n"),
            Err(ReportError::MissingHeader)
        );
        assert_eq!(
            parse_report("Scan report generated at: now\nrm -rf /\n"),
            Err(ReportError::UnexpectedLine { line: 2 })
        );
        assert_eq!(
            parse_report("Scan report generated at: now\nPort 99999 is open (X)\n"),
            Err(ReportError::InvalidPort { line: 2 })
        );
        assert_eq!(
            parse_report("Scan report generated at: now\nPort 80 is open\n"),
            Err(ReportError::UnexpectedLine { line: 2 })
        );
        assert_eq!(
            parse_report(&"x".repeat(MAX_REPORT_BYTES + 1)),
            Err(ReportError::TooLarge)
        );
    }

    #[test]
    fn events_are_labelled_as_recordings() {
        let report = parse_report(BUNDLED_REPORT).unwrap();
        let events = report_events(&report);
        assert_eq!(events.len(), 3, "summary plus one per open port");
        assert!(events.iter().all(|e| e.data_source == DataSource::Recording));
        assert!(events.iter().all(|e| e.kind == EventKind::ScanFinding));
    }
}

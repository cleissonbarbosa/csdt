//! The five fictional incident scenarios shipped with AEGIS.
//!
//! They are files in `fixtures/scenarios/`, in the format of
//! [`super::spec`], compiled into the binary. Timings are virtual
//! milliseconds from scenario start. Every phase lists the complete set of
//! effects that hold during it; anything omitted ramps back to nominal.

use super::ScenarioDef;

pub const DDOS_SURGE: &str = "ddos-surge";
pub const CREDENTIAL_STUFFING: &str = "credential-stuffing";
pub const CEDAR_DENIAL: &str = "cedar-denial";
pub const CASCADING_FAILURE: &str = "cascading-failure";
pub const REGIONAL_OUTAGE: &str = "regional-outage";

/// File name and contents. Scenarios are offered in file-name order, here
/// and in a workspace directory, which is why the names carry a number.
pub const FILES: [(&str, &str); 5] = [
    (
        "01-ddos-surge.json",
        include_str!("../../../../fixtures/scenarios/01-ddos-surge.json"),
    ),
    (
        "02-credential-stuffing.json",
        include_str!("../../../../fixtures/scenarios/02-credential-stuffing.json"),
    ),
    (
        "03-cedar-denial.json",
        include_str!("../../../../fixtures/scenarios/03-cedar-denial.json"),
    ),
    (
        "04-cascading-failure.json",
        include_str!("../../../../fixtures/scenarios/04-cascading-failure.json"),
    ),
    (
        "05-regional-outage.json",
        include_str!("../../../../fixtures/scenarios/05-regional-outage.json"),
    ),
];

/// The bundled scenarios, in the order they are offered.
pub fn bundled() -> Result<Vec<ScenarioDef>, serde_json::Error> {
    FILES
        .iter()
        .map(|(_, raw)| serde_json::from_str(raw))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_has_five_unique_well_formed_scenarios() {
        let scenarios = bundled().expect("bundled scenario files parse");
        let ids: Vec<&str> = scenarios.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                DDOS_SURGE,
                CREDENTIAL_STUFFING,
                CEDAR_DENIAL,
                CASCADING_FAILURE,
                REGIONAL_OUTAGE
            ]
        );
        for scenario in &scenarios {
            scenario
                .validate()
                .unwrap_or_else(|e| panic!("{} is valid: {e}", scenario.id));
            let last = scenario.phases.last().expect("has phases");
            assert!(
                last.at_ms + last.ramp_ms <= scenario.duration_ms,
                "{} finishes its last ramp before it ends",
                scenario.id
            );
            assert!(
                last.effects.is_empty(),
                "{} ends with everything back to nominal",
                scenario.id
            );
        }
    }

    #[test]
    fn files_are_listed_in_the_order_a_directory_would_give() {
        let names: Vec<&str> = FILES.iter().map(|(name, _)| *name).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted);
        for ((name, _), scenario) in FILES.iter().zip(bundled().expect("parses")) {
            assert!(
                name.ends_with(&format!("-{}.json", scenario.id)),
                "{name} holds {}",
                scenario.id
            );
        }
    }
}

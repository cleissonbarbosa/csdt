//! What Cedar says of requests nobody has made on the timeline: one request
//! taken policy by policy, and every request the catalogue describes.
//!
//! Both are read straight from the engine and decide nothing themselves.
//! Unlike an evaluation asked for in the tracer, neither is recorded: there
//! is no event for them and no path on the model.

use crate::authorization::AuthzCatalog;
use crate::domain::{
    AccessCell, AccessMatrix, AuthorizationExplanation, AuthorizationRequest, AuthzError,
    DataSource, PolicyDecisionPoint,
};

use super::diff::MATRIX_LIMIT;
use super::{Assets, EvaluateInput};

/// Every principal, action and resource of a catalogue that go together: an
/// action names the type of resource it is done to.
pub(crate) fn triples(catalog: &AuthzCatalog) -> Vec<(&str, &str, &str)> {
    catalog
        .principals
        .iter()
        .flat_map(|principal| {
            catalog.actions.iter().flat_map(move |action| {
                catalog
                    .resources
                    .iter()
                    .filter(move |resource| resource.resource_type == action.resource_type)
                    .map(move |resource| {
                        (
                            principal.uid.as_str(),
                            action.uid.as_str(),
                            resource.uid.as_str(),
                        )
                    })
            })
        })
        .collect()
}

/// Cedar's decision on a request, and how each policy stands to it.
pub fn explain(
    assets: &Assets,
    input: &EvaluateInput,
) -> Result<AuthorizationExplanation, AuthzError> {
    let outcome = assets
        .cedar
        .evaluate(&input.request, &input.disabled_policies)?;
    let policies = assets
        .cedar
        .standings(&input.request, &input.disabled_policies)?;
    Ok(AuthorizationExplanation {
        request: input.request.clone(),
        decision: outcome.decision,
        determining_policies: outcome.determining_policies,
        errors: outcome.errors,
        disabled_policies: input.disabled_policies.clone(),
        policies,
        engine: assets.cedar.engine(),
        data_source: DataSource::Synthetic,
    })
}

/// Who may do what under one context: every request the catalogue describes,
/// asked of Cedar. A catalogue too large to ask in one go is said to be, and
/// nothing is asked.
pub fn matrix(
    assets: &Assets,
    context: serde_json::Map<String, serde_json::Value>,
    disabled_policies: Vec<String>,
) -> Result<AccessMatrix, AuthzError> {
    let triples = triples(&assets.catalog);
    let mut matrix = AccessMatrix {
        context,
        disabled_policies,
        cells: Vec::new(),
        note: None,
        engine: assets.cedar.engine(),
        data_source: DataSource::Synthetic,
    };
    if triples.len() > MATRIX_LIMIT {
        matrix.note = Some(format!(
            "the catalogue allows {} principal, action and resource combinations, more than the {MATRIX_LIMIT} asked at most",
            triples.len()
        ));
        return Ok(matrix);
    }
    matrix.cells.reserve(triples.len());
    for (principal, action, resource) in triples {
        let request = AuthorizationRequest {
            principal: principal.to_string(),
            action: action.to_string(),
            resource: resource.to_string(),
            context: matrix.context.clone(),
        };
        let outcome = assets.cedar.evaluate(&request, &matrix.disabled_policies)?;
        matrix.cells.push(AccessCell {
            principal: request.principal,
            action: request.action,
            resource: request.resource,
            decision: outcome.decision,
            determining_policies: outcome.determining_policies,
        });
    }
    Ok(matrix)
}

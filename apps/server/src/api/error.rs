use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::application::ServiceError;
use crate::domain::AuthzError;
use crate::integrations::ProviderError;

/// Error returned by every API handler: `{"error": {"code", "message"}}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "invalid_request", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "error": { "code": self.code, "message": self.message } })),
        )
            .into_response()
    }
}

impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        let status = match rejection {
            JsonRejection::MissingJsonContentType(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            _ => StatusCode::BAD_REQUEST,
        };
        Self::new(status, "invalid_request", rejection.body_text())
    }
}

impl From<QueryRejection> for ApiError {
    fn from(rejection: QueryRejection) -> Self {
        Self::bad_request(rejection.body_text())
    }
}

impl From<PathRejection> for ApiError {
    fn from(rejection: PathRejection) -> Self {
        Self::bad_request(rejection.body_text())
    }
}

impl From<AuthzError> for ApiError {
    fn from(error: AuthzError) -> Self {
        match &error {
            AuthzError::InvalidRequest { .. } | AuthzError::UnknownPolicy(_) => {
                Self::bad_request(error.to_string())
            }
            AuthzError::EngineUnavailable(_) => Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "engine_unavailable",
                error.to_string(),
            ),
            AuthzError::Protocol(_) => {
                Self::new(StatusCode::BAD_GATEWAY, "engine_error", error.to_string())
            }
        }
    }
}

impl From<ServiceError> for ApiError {
    fn from(error: ServiceError) -> Self {
        match error {
            ServiceError::UnknownScenario(_)
            | ServiceError::UnknownTopology(_)
            | ServiceError::UnknownRecording(_) => Self::not_found(error.to_string()),
            ServiceError::ScenarioUnavailable(_) | ServiceError::NoActiveScenario => {
                Self::new(StatusCode::CONFLICT, "conflict", error.to_string())
            }
            ServiceError::InvalidSpeed(_) => Self::bad_request(error.to_string()),
            ServiceError::Authz(inner) => inner.into(),
        }
    }
}

impl From<ProviderError> for ApiError {
    fn from(error: ProviderError) -> Self {
        let (status, code) = match &error {
            ProviderError::Unknown(_) => (StatusCode::NOT_FOUND, "not_found"),
            ProviderError::NotConfigured => (StatusCode::CONFLICT, "not_configured"),
            ProviderError::Unsupported(_) => (StatusCode::CONFLICT, "unsupported"),
            ProviderError::Refused(_) => (StatusCode::UNPROCESSABLE_ENTITY, "target_refused"),
            ProviderError::Unreachable(_) => (StatusCode::BAD_GATEWAY, "target_unreachable"),
            ProviderError::Protocol(_) => (StatusCode::BAD_GATEWAY, "target_protocol"),
        };
        Self::new(status, code, error.to_string())
    }
}

//! Per-client token-bucket rate limiting.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use super::error::ApiError;
use super::AppState;

/// Buckets idle for longer than this are forgotten.
const IDLE_EVICTION: Duration = Duration::from_secs(120);
/// The table is swept once it holds this many clients.
const SWEEP_THRESHOLD: usize = 4096;

#[derive(Debug, Clone, Copy)]
struct Bucket {
    tokens: f64,
    updated: Instant,
}

#[derive(Debug)]
pub struct RateLimiter {
    capacity: f64,
    refill_per_second: f64,
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
}

impl RateLimiter {
    pub fn new(capacity: u32, refill_per_second: f64) -> Self {
        Self {
            capacity: f64::from(capacity),
            refill_per_second,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Takes one token for `client`. On refusal returns how long to wait.
    pub fn check(&self, client: IpAddr) -> Result<(), Duration> {
        self.check_at(client, Instant::now())
    }

    fn check_at(&self, client: IpAddr, now: Instant) -> Result<(), Duration> {
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if buckets.len() >= SWEEP_THRESHOLD {
            buckets.retain(|_, b| now.duration_since(b.updated) < IDLE_EVICTION);
        }
        let bucket = buckets.entry(client).or_insert(Bucket {
            tokens: self.capacity,
            updated: now,
        });
        let elapsed = now.duration_since(bucket.updated).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.refill_per_second).min(self.capacity);
        bucket.updated = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            let wait = (1.0 - bucket.tokens) / self.refill_per_second;
            Err(Duration::from_secs_f64(wait))
        }
    }
}

/// The peer address, or loopback when the server runs without connection
/// info (in-process tests).
pub fn client_ip(request: &Request) -> IpAddr {
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map_or(IpAddr::V4(Ipv4Addr::LOCALHOST), |info| info.0.ip())
}

pub async fn enforce(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let limiter = if request.method() == Method::GET {
        &state.limits.read
    } else {
        &state.limits.write
    };
    match limiter.check(client_ip(&request)) {
        Ok(()) => next.run(request).await,
        Err(wait) => {
            let mut response = ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "too many requests; slow down",
            )
            .into_response();
            let seconds = wait.as_secs_f64().ceil().max(1.0) as u64;
            if let Ok(value) = HeaderValue::from_str(&seconds.to_string()) {
                response.headers_mut().insert(header::RETRY_AFTER, value);
            }
            response
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: IpAddr = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
    const B: IpAddr = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2));

    #[test]
    fn burst_is_bounded_and_refills_over_time() {
        let limiter = RateLimiter::new(3, 2.0);
        let t0 = Instant::now();
        for _ in 0..3 {
            assert!(limiter.check_at(A, t0).is_ok());
        }
        let wait = limiter.check_at(A, t0).expect_err("burst exhausted");
        assert!((wait.as_secs_f64() - 0.5).abs() < 1e-6);
        // Half a second later one token is back.
        assert!(limiter.check_at(A, t0 + Duration::from_millis(500)).is_ok());
        assert!(limiter
            .check_at(A, t0 + Duration::from_millis(500))
            .is_err());
    }

    #[test]
    fn clients_are_limited_independently() {
        let limiter = RateLimiter::new(1, 1.0);
        let t0 = Instant::now();
        assert!(limiter.check_at(A, t0).is_ok());
        assert!(limiter.check_at(A, t0).is_err());
        assert!(limiter.check_at(B, t0).is_ok());
    }

    #[test]
    fn tokens_never_exceed_capacity() {
        let limiter = RateLimiter::new(2, 100.0);
        let t0 = Instant::now();
        let later = t0 + Duration::from_secs(60);
        assert!(limiter.check_at(A, later).is_ok());
        assert!(limiter.check_at(A, later).is_ok());
        assert!(limiter.check_at(A, later).is_err());
    }
}

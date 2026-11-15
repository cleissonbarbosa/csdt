//! Wall-clock time for the parts that need it: how long a snapshot has gone
//! unsent, how long an evaluation took, how long the server has been up.
//!
//! The simulation never reads this (its time is virtual and lives in its
//! state). On the server it is the operating system's monotonic clock. In the
//! browser build there is no such clock to ask, so the page supplies the time
//! with every call it makes and [`Instant::now`] returns the latest one.

#[cfg(not(target_arch = "wasm32"))]
pub use std::time::Instant;

#[cfg(target_arch = "wasm32")]
pub use browser::{set_now, Instant};

#[cfg(target_arch = "wasm32")]
mod browser {
    use std::cell::Cell;
    use std::time::Duration;

    thread_local! {
        static NOW_MS: Cell<f64> = const { Cell::new(0.0) };
    }

    /// Records the time the page reports, in milliseconds. Time never goes
    /// back: an earlier value than the last is ignored.
    pub fn set_now(milliseconds: f64) {
        NOW_MS.with(|now| {
            if milliseconds.is_finite() && milliseconds > now.get() {
                now.set(milliseconds);
            }
        });
    }

    /// The moment of the call in progress. It does not advance within one
    /// call, so nothing can be timed inside it.
    #[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
    pub struct Instant(f64);

    impl Instant {
        pub fn now() -> Self {
            Self(NOW_MS.with(Cell::get))
        }

        pub fn duration_since(&self, earlier: Self) -> Duration {
            Duration::from_secs_f64(((self.0 - earlier.0) / 1000.0).max(0.0))
        }

        pub fn elapsed(&self) -> Duration {
            Self::now().duration_since(*self)
        }
    }
}

//! Small numeric helpers used by the engine.

pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

pub fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Rounds to `decimals` places so snapshots stay compact on the wire.
pub fn round_to(x: f64, decimals: u32) -> f64 {
    if !x.is_finite() {
        return 0.0;
    }
    let f = 10f64.powi(decimals as i32);
    (x * f).round() / f
}

/// Error function, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7).
pub fn erf(x: f64) -> f64 {
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();
    let t = 1.0 / (1.0 + 0.327_591_1 * x);
    let poly = t
        * (0.254_829_592
            + t * (-0.284_496_736
                + t * (1.421_413_741 + t * (-1.453_152_027 + t * 1.061_405_429))));
    sign * (1.0 - poly * (-x * x).exp())
}

pub fn normal_cdf(z: f64) -> f64 {
    0.5 * (1.0 + erf(z / std::f64::consts::SQRT_2))
}

/// A mixture of log-normal distributions.
///
/// End-to-end request latency is modelled as one log-normal component per
/// client population, weighted by that population's demand. Mean and
/// quantiles of the mixture are computed exactly (to bisection tolerance), so
/// the HUD percentiles are a property of the model, not of sampling noise.
#[derive(Debug, Clone, Default)]
pub struct LogNormalMixture {
    /// `(weight, mu, sigma)` with `mu`/`sigma` in log-milliseconds.
    components: Vec<(f64, f64, f64)>,
    total_weight: f64,
}

impl LogNormalMixture {
    pub fn push(&mut self, weight: f64, median_ms: f64, sigma: f64) {
        if weight <= 0.0 || !weight.is_finite() {
            return;
        }
        let mu = median_ms.max(0.01).ln();
        self.components.push((weight, mu, sigma.max(1e-3)));
        self.total_weight += weight;
    }

    pub fn is_empty(&self) -> bool {
        self.components.is_empty()
    }

    pub fn mean(&self) -> f64 {
        if self.is_empty() {
            return 0.0;
        }
        self.components
            .iter()
            .map(|(w, mu, sigma)| w * (mu + sigma * sigma / 2.0).exp())
            .sum::<f64>()
            / self.total_weight
    }

    pub fn cdf(&self, x_ms: f64) -> f64 {
        if self.is_empty() || x_ms <= 0.0 {
            return 0.0;
        }
        let lx = x_ms.ln();
        self.components
            .iter()
            .map(|(w, mu, sigma)| w * normal_cdf((lx - mu) / sigma))
            .sum::<f64>()
            / self.total_weight
    }

    /// Quantile `q` in `(0, 1)` by bisection in log space.
    pub fn quantile(&self, q: f64) -> f64 {
        if self.is_empty() {
            return 0.0;
        }
        let mut lo = f64::INFINITY;
        let mut hi = f64::NEG_INFINITY;
        for (_, mu, sigma) in &self.components {
            lo = lo.min(mu - 8.0 * sigma);
            hi = hi.max(mu + 8.0 * sigma);
        }
        for _ in 0..60 {
            let mid = 0.5 * (lo + hi);
            if self.cdf(mid.exp()) < q {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        (0.5 * (lo + hi)).exp()
    }
}

/// FNV-1a, used for cheap deterministic state digests.
pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erf_matches_known_values() {
        assert!((erf(0.0)).abs() < 1e-7);
        assert!((erf(1.0) - 0.842_700_79).abs() < 1e-6);
        assert!((erf(-1.0) + 0.842_700_79).abs() < 1e-6);
        assert!((normal_cdf(1.959_964) - 0.975).abs() < 1e-5);
    }

    #[test]
    fn single_component_quantiles_are_analytic() {
        let mut mix = LogNormalMixture::default();
        mix.push(1.0, 100.0, 0.5);
        // Median of a log-normal is exp(mu).
        assert!((mix.quantile(0.5) - 100.0).abs() < 0.01);
        // p95 = exp(mu + 1.6449 sigma)
        let expected = (100f64.ln() + 1.644_853_6 * 0.5).exp();
        assert!((mix.quantile(0.95) - expected).abs() / expected < 1e-4);
        let mean = (100f64.ln() + 0.125).exp();
        assert!((mix.mean() - mean).abs() < 1e-9);
    }

    #[test]
    fn mixture_quantiles_are_ordered_and_invert_the_cdf() {
        let mut mix = LogNormalMixture::default();
        mix.push(900.0, 80.0, 0.4);
        mix.push(400.0, 240.0, 0.7);
        mix.push(50.0, 1200.0, 0.3);
        let (p50, p95, p99) = (mix.quantile(0.5), mix.quantile(0.95), mix.quantile(0.99));
        assert!(p50 < p95 && p95 < p99);
        assert!((mix.cdf(p95) - 0.95).abs() < 1e-6);
        assert!((mix.cdf(p99) - 0.99).abs() < 1e-6);
    }

    #[test]
    fn smoothstep_is_clamped_and_monotonic() {
        assert_eq!(smoothstep(-1.0), 0.0);
        assert_eq!(smoothstep(2.0), 1.0);
        assert!(smoothstep(0.25) < smoothstep(0.5));
    }

    #[test]
    fn rounding_handles_non_finite_values() {
        assert_eq!(round_to(1.23456, 2), 1.23);
        assert_eq!(round_to(f64::NAN, 2), 0.0);
        assert_eq!(round_to(f64::INFINITY, 2), 0.0);
    }
}

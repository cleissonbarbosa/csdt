use serde::{Deserialize, Serialize};

/// xoshiro256** seeded through SplitMix64.
///
/// The generator lives inside the simulation state so that checkpoints
/// capture it and replays draw exactly the same numbers. It is implemented
/// here (rather than pulled from a crate) so the stream can never change
/// underneath recorded timelines.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rng {
    s: [u64; 4],
}

impl Rng {
    pub fn seeded(seed: u64) -> Self {
        let mut z = seed;
        let mut next = || {
            z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut x = z;
            x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            x ^ (x >> 31)
        };
        Self {
            s: [next(), next(), next(), next()],
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// Uniform in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Uniform in `[-1, 1)`.
    pub fn next_signed(&mut self) -> f64 {
        self.next_f64() * 2.0 - 1.0
    }

    /// Uniform integer in `[0, n)`. Returns 0 when `n` is 0.
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        ((self.next_f64() * n as f64) as usize).min(n - 1)
    }

    /// Index drawn proportionally to `weights`. Falls back to the last index
    /// when the weights do not sum to a positive number.
    pub fn pick_weighted(&mut self, weights: &[f64]) -> usize {
        let total: f64 = weights.iter().sum();
        let mut roll = self.next_f64() * total;
        for (i, w) in weights.iter().enumerate() {
            if roll < *w {
                return i;
            }
            roll -= *w;
        }
        weights.len().saturating_sub(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_stream() {
        let mut a = Rng::seeded(7);
        let mut b = Rng::seeded(7);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let mut a = Rng::seeded(1);
        let mut b = Rng::seeded(2);
        assert_ne!(a.next_u64(), b.next_u64());
    }

    #[test]
    fn floats_stay_in_unit_interval() {
        let mut rng = Rng::seeded(99);
        for _ in 0..10_000 {
            let x = rng.next_f64();
            assert!((0.0..1.0).contains(&x));
        }
    }

    #[test]
    fn weighted_pick_respects_zero_weights() {
        let mut rng = Rng::seeded(3);
        for _ in 0..500 {
            assert_eq!(rng.pick_weighted(&[0.0, 1.0, 0.0]), 1);
        }
    }

    #[test]
    fn weighted_pick_is_roughly_proportional() {
        let mut rng = Rng::seeded(11);
        let mut hits = [0u32; 2];
        for _ in 0..20_000 {
            hits[rng.pick_weighted(&[1.0, 3.0])] += 1;
        }
        let share = f64::from(hits[1]) / 20_000.0;
        assert!((share - 0.75).abs() < 0.02, "share was {share}");
    }
}

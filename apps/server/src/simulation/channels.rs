//! Effect channels: the only way scenarios influence the model.
//!
//! A channel is a single scalar (a capacity factor, an injected error rate, a
//! flow rate…) that ramps smoothly from its current value to a target. Each
//! scenario phase declares a full set of targets; anything a phase does not
//! mention ramps back to neutral. Channels are part of the simulation state,
//! so checkpoints capture effects mid-ramp.

use serde::{Deserialize, Serialize};

use super::math::{lerp, smoothstep};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ChannelKey {
    /// Multiplier on a client's demand.
    Demand(u32),
    /// Multiplier on a node's capacity.
    Capacity(u32),
    /// Multiplier on a node's own latency.
    Latency(u32),
    /// Additional failure rate injected at a node.
    ErrorInject(u32),
    /// Above 0.5 the node is unreachable.
    Down(u32),
    /// Multiplier on an edge weight.
    EdgeWeight(u32),
    /// Multiplier on an edge's network latency.
    EdgeLatency(u32),
    /// Additional failure rate injected on an edge.
    EdgeError(u32),
    /// Fraction of the first edge's weight moved onto the second edge.
    RouteShift(u32, u32),
    /// Rate (requests per second) of an injected path flow.
    FlowRate(u16),
    /// Fraction of an injected flow rejected when it arrives at a node.
    FlowReject(u16, u32),
}

impl ChannelKey {
    pub fn neutral(self) -> f64 {
        match self {
            Self::Demand(_)
            | Self::Capacity(_)
            | Self::Latency(_)
            | Self::EdgeWeight(_)
            | Self::EdgeLatency(_) => 1.0,
            Self::ErrorInject(_)
            | Self::Down(_)
            | Self::EdgeError(_)
            | Self::RouteShift(..)
            | Self::FlowRate(_)
            | Self::FlowReject(..) => 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Channel {
    pub key: ChannelKey,
    pub from: f64,
    pub target: f64,
    pub current: f64,
    pub start_tick: u64,
    pub ramp_ticks: u32,
}

/// Channels kept sorted by key so iteration order is deterministic.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ChannelSet(Vec<Channel>);

impl ChannelSet {
    pub fn iter(&self) -> impl Iterator<Item = &Channel> {
        self.0.iter()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn get(&self, key: ChannelKey) -> Option<f64> {
        self.0
            .binary_search_by(|c| c.key.cmp(&key))
            .ok()
            .map(|i| self.0[i].current)
    }

    /// Current value of a channel, or its neutral value when inactive.
    pub fn value(&self, key: ChannelKey) -> f64 {
        self.get(key).unwrap_or_else(|| key.neutral())
    }

    /// Points every channel at `targets`; channels not listed head back to
    /// neutral. All ramps start at `tick` and last `ramp_ticks`.
    pub fn retarget(&mut self, targets: &[(ChannelKey, f64)], tick: u64, ramp_ticks: u32) {
        let ramp_ticks = ramp_ticks.max(1);
        for channel in &mut self.0 {
            let target = targets
                .iter()
                .find(|(key, _)| *key == channel.key)
                .map_or_else(|| channel.key.neutral(), |(_, value)| *value);
            channel.from = channel.current;
            channel.target = target;
            channel.start_tick = tick;
            channel.ramp_ticks = ramp_ticks;
        }
        for (key, value) in targets {
            if let Err(position) = self.0.binary_search_by(|c| c.key.cmp(key)) {
                let neutral = key.neutral();
                self.0.insert(
                    position,
                    Channel {
                        key: *key,
                        from: neutral,
                        target: *value,
                        current: neutral,
                        start_tick: tick,
                        ramp_ticks,
                    },
                );
            }
        }
    }

    /// Advances every ramp to `tick` and drops channels that settled at
    /// their neutral value.
    pub fn advance(&mut self, tick: u64) {
        for channel in &mut self.0 {
            let elapsed = tick.saturating_sub(channel.start_tick) as f64;
            let progress = (elapsed / f64::from(channel.ramp_ticks.max(1))).clamp(0.0, 1.0);
            channel.current = lerp(channel.from, channel.target, smoothstep(progress));
        }
        self.0.retain(|channel| {
            let done = tick.saturating_sub(channel.start_tick) >= u64::from(channel.ramp_ticks);
            !(done && (channel.target - channel.key.neutral()).abs() < 1e-12)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ramps_smoothly_to_target_and_back_to_neutral() {
        let mut set = ChannelSet::default();
        let key = ChannelKey::Capacity(3);
        set.retarget(&[(key, 0.2)], 10, 10);
        set.advance(10);
        assert!((set.value(key) - 1.0).abs() < 1e-12);
        set.advance(15);
        assert!((set.value(key) - 0.6).abs() < 1e-12, "half way");
        set.advance(20);
        assert!((set.value(key) - 0.2).abs() < 1e-12);

        // A phase that no longer mentions the channel sends it home.
        set.retarget(&[], 20, 4);
        set.advance(22);
        assert!(set.value(key) > 0.2 && set.value(key) < 1.0);
        set.advance(24);
        assert!(set.is_empty(), "settled channels are removed");
        assert_eq!(set.value(key), 1.0);
    }

    #[test]
    fn retarget_mid_ramp_starts_from_the_current_value() {
        let mut set = ChannelSet::default();
        let key = ChannelKey::ErrorInject(1);
        set.retarget(&[(key, 1.0)], 0, 10);
        set.advance(5);
        let mid = set.value(key);
        assert!((mid - 0.5).abs() < 1e-12);
        set.retarget(&[(key, 0.0)], 5, 10);
        set.advance(5);
        assert!((set.value(key) - mid).abs() < 1e-12, "no jump on retarget");
    }

    #[test]
    fn keys_stay_sorted() {
        let mut set = ChannelSet::default();
        set.retarget(
            &[
                (ChannelKey::FlowRate(0), 5.0),
                (ChannelKey::Demand(9), 2.0),
                (ChannelKey::Capacity(1), 0.5),
            ],
            0,
            1,
        );
        let keys: Vec<ChannelKey> = set.iter().map(|c| c.key).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }
}

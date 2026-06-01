use crate::constants::{
    MAX_CORRELATION_PAIRS, MAX_GROUP_MARKETS, MAX_OUTCOMES, MAX_SAME_GAME_STATES,
    MAX_SEED_POSITIONS,
};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, Copy)]
pub struct CorrelationPair {
    pub market_a_index: u8,
    pub outcome_a_id: u8,
    pub market_b_index: u8,
    pub outcome_b_id: u8,
    pub weight_bps: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, Copy)]
pub struct SeedPosition {
    pub seeder: Pubkey,
    pub slip_id: u64,
    pub market_index: u8,
    pub outcome_id: u8,
    pub amount: u64,
    pub reward_claimed: bool,
    pub refunded: bool,
}

#[account]
pub struct MarketGroup {
    pub group_id: u64,
    pub creator: Pubkey,
    pub total_group_exposure: u64,
    pub max_group_exposure: u64,
    pub num_markets: u8,
    pub market_ids: [u64; MAX_GROUP_MARKETS],
    pub correlations: [CorrelationPair; MAX_CORRELATION_PAIRS],
    pub num_correlations: u8,
    pub num_states: u8,
    pub state_probabilities: [u64; MAX_SAME_GAME_STATES],
    pub outcome_state_masks: [[u64; MAX_OUTCOMES]; MAX_GROUP_MARKETS],
    pub statistical_discount_bps: u64,
    pub seed_fee_pools: [u64; MAX_GROUP_MARKETS],
    pub seed_fee_share_bps: u64,
    pub seed_min_volume: u64,
    pub seed_max_side_share_bps: u64,
    pub seed_positions: [SeedPosition; MAX_SEED_POSITIONS],
    pub num_seed_positions: u8,
    pub event_start_time: i64,
    pub correlation_locked: bool,
    pub title: String,
    pub bump: u8,
}

impl MarketGroup {
    pub const LEN: usize = 8 // discriminator
        + 8   // group_id
        + 32  // creator
        + 8   // total_group_exposure
        + 8   // max_group_exposure
        + 1   // num_markets
        + 64  // market_ids (8 * u64)
        + 192 // correlations (16 pairs × 12 bytes each in Borsh)
        + 1   // num_correlations
        + 1   // num_states
        + 512 // state_probabilities (64 * u64)
        + 512 // outcome_state_masks (8 * 8 * u64)
        + 8   // statistical_discount_bps
        + 64  // seed_fee_pools
        + 8   // seed_fee_share_bps
        + 8   // seed_min_volume
        + 8   // seed_max_side_share_bps
        + 832 // seed_positions (16 * (32 + 8 + 1 + 1 + 8 + 1 + 1))
        + 1   // num_seed_positions
        + 8   // event_start_time
        + 1   // correlation_locked
        + (4 + 128) // title
        + 1; // bump
}

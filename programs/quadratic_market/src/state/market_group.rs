use anchor_lang::prelude::*;
use crate::constants::{MAX_GROUP_MARKETS, MAX_CORRELATION_PAIRS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, Copy)]
pub struct CorrelationPair {
    pub market_a_index: u8,
    pub outcome_a_id: u8,
    pub market_b_index: u8,
    pub outcome_b_id: u8,
    pub weight_bps: u64,
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
        + 8   // event_start_time
        + 1   // correlation_locked
        + (4 + 128) // title
        + 1;  // bump
}

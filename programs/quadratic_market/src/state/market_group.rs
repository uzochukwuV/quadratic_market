use anchor_lang::prelude::*;
use crate::constants::MAX_GROUP_MARKETS;

/// Simplified MarketGroup for tracking purposes only.
/// Each market (1X2, O/U, GG/NG) settles independently with its own oracle submission.
/// No on-chain correlation enforcement - mutual consistency is not guaranteed.

#[account]
pub struct MarketGroup {
    pub group_id: u64,
    pub creator: Pubkey,
    pub total_group_exposure: u64,
    pub max_group_exposure: u64,
    pub num_markets: u8,
    /// Market IDs in order: 1X2(0), O/U(1), GG/NG(2)
    pub market_ids: [u64; MAX_GROUP_MARKETS],
    pub event_start_time: i64,
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
        + 24  // market_ids (3 * 8 bytes)
        + 8   // event_start_time
        + (4 + 128) // title
        + 1;  // bump
}

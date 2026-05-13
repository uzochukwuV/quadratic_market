use anchor_lang::prelude::*;
use crate::constants::MAX_SLIP_LEGS;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SlipLeg {
    pub market_id: u64,
    pub outcome_id: u8,
    pub num_shares: u64,
}

#[account]
pub struct BetSlip {
    pub slip_id: u64,
    pub creator: Pubkey,
    pub legs: [SlipLeg; MAX_SLIP_LEGS],
    pub num_legs: u8,
    pub total_stake: u64,
    pub combined_odds_fp: u64,       // Q32.32 decimal odds
    pub house_margin_bps: u64,      // margin applied at placement
    pub potential_payout: u64,      // fixed at placement — what user gets if all legs win
    pub locked_amount: u64,         // current treasury lock (<= potential_payout, never increases)
    pub exposure_locked: u64,       // group exposure locked at placement (released on claim)
    pub claimed: bool,
    pub bump: u8,
}

impl BetSlip {
    // 8 + 8 + 32 + 128 + 1 + 7 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1 = 234
    pub const LEN: usize = 8 + 8 + 32 + 128 + 1 + 7 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1;
}

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
    pub combined_odds_bps: u64,
    pub potential_payout: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl BetSlip {
    pub const LEN: usize = 8 // discriminator
        + 8   // slip_id
        + 32  // creator
        + 128 // legs (8 * 16 bytes each due to alignment)
        + 1   // num_legs
        + 7   // padding
        + 8   // total_stake
        + 8   // combined_odds_bps
        + 8   // potential_payout
        + 1   // claimed
        + 1;  // bump
}

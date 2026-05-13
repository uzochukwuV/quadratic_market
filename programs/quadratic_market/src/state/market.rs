use anchor_lang::prelude::*;
use crate::constants::MAX_OUTCOMES;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    Open,
    Suspended,
    AwaitingResult,
    Proposed,
    Disputed,
    Settled,
    Voided,
}

impl Default for MarketStatus {
    fn default() -> Self {
        MarketStatus::Open
    }
}

impl MarketStatus {
    pub fn is_tradable(&self) -> bool {
        matches!(self, MarketStatus::Open)
    }

    pub fn can_settle(&self) -> bool {
        matches!(
            self,
            MarketStatus::Open | MarketStatus::Suspended | MarketStatus::AwaitingResult
        )
    }
}

#[account]
pub struct Market {
    pub market_id: u64,                     // 8
    pub creator: Pubkey,                    // 32
    pub start_time: i64,                    // 8
    pub status: MarketStatus,               // 1 + 1 (enum variant)
    pub bond_amount: u64,                   // 8
    pub bond_claimed: bool,                 // 1
    pub num_outcomes: u8,                   // 1
    pub q_values: [u64; MAX_OUTCOMES],      // 64
    pub exposure: u64,                      // 8
    pub settlement_time: i64,               // 8
    pub winning_outcome: u8,                // 1
    pub outcome_mints: [Pubkey; MAX_OUTCOMES], // 256
    pub lmsr_b: u64,                        // 8 (Q32.32)
    pub title: String,                      // 4 + 128
    pub description: String,                // 4 + 256
    pub category: u8,                       // 1
    pub bump: u8,                           // 1
    // Correlated market fields
    pub group_id: Option<u64>,              // 1 + 8 (+ 7 padding)
    pub group_market_index: u8,             // 1
}

impl Market {
    pub const LEN: usize = 8 // discriminator
        + 8   // market_id
        + 32  // creator
        + 8   // start_time
        + 2   // status (enum)
        + 8   // bond_amount
        + 1   // bond_claimed
        + 1   // num_outcomes
        + 64  // q_values
        + 8   // exposure
        + 8   // settlement_time
        + 1   // winning_outcome
        + 256 // outcome_mints
        + 8   // lmsr_b
        + (4 + 128) // title
        + (4 + 256) // description
        + 1   // category
        + 1   // bump
        + 16  // group_id (Option<u64>: 1 variant + 8 value + 7 padding)
        + 1   // group_market_index
        + 7;  // padding

    pub fn active_q_values(&self) -> Vec<u64> {
        self.q_values[..self.num_outcomes as usize].to_vec()
    }
}

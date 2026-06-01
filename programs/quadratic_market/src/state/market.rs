use crate::constants::MAX_OUTCOMES;
use anchor_lang::prelude::*;

/// Controls whether LMSR share trading is exposed directly to users.
///
/// `FixedOdds` — LMSR is an internal pricing engine only. Users interact via
/// `place_slip` / `cash_out_slip`. Direct `buy_shares` / `sell_shares` calls
/// are rejected. This is the default for sports markets.
///
/// `Trading` — LMSR is fully exposed. `buy_shares` / `sell_shares` are
/// permitted. Intended for prediction markets, not sports.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum MarketMode {
    FixedOdds,
    Trading,
}

impl Default for MarketMode {
    fn default() -> Self {
        MarketMode::FixedOdds
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    PreOpen,
    Open,
    Suspended,
    AwaitingResult,
    Proposed,
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
    pub market_id: u64,                        // 8
    pub creator: Pubkey,                       // 32
    pub start_time: i64,                       // 8
    pub status: MarketStatus,                  // 1
    pub num_outcomes: u8,                      // 1
    pub q_values: [u64; MAX_OUTCOMES],         // 64
    pub exposure: u64,                         // 8
    pub settlement_time: i64,                  // 8
    pub winning_outcome: u8,                   // 1
    pub outcome_mints: [Pubkey; MAX_OUTCOMES], // 256
    pub lmsr_b: u64,                           // 8  (Q32.32)
    pub title: String,                         // 4 + 128
    pub description: String,                   // 4 + 256
    pub category: u8,                          // 1
    pub bump: u8,                              // 1
    // Correlated market fields
    pub group_id: Option<u64>,   // 9 (1 tag + 8 value)
    pub group_market_index: u8,  // 1
    pub market_mode: MarketMode, // 1 (enum tag)
    // Epoch tracking
    pub epoch_id: u64,          // 8 — epoch this market belongs to
    pub settled_in_epoch: bool, // 1 — true when market settlement is counted in epoch
}

impl Market {
    pub const LEN: usize = 8  // discriminator
        + 8   // market_id
        + 32  // creator
        + 8   // start_time
        + 1   // status
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
        + 9   // group_id (Option<u64>: 1 tag + 8 value)
        + 1   // group_market_index
        + 1   // market_mode
        + 8   // epoch_id
        + 1   // settled_in_epoch
        + 3; // padding to align to 8

    pub fn active_q_values(&self) -> Vec<u64> {
        self.q_values[..self.num_outcomes as usize].to_vec()
    }
}

use anchor_lang::prelude::*;
use crate::constants::MAX_OPERATORS;

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,                          // 32
    pub paused: bool,                           // 1
    pub oracle_pubkey: [u8; 32],               // 32  — oracle that signs settlement results
    pub max_market_exposure: u64,               // 8
    pub locked_payouts: u64,                    // 8
    pub total_lp_supply: u64,                   // 8
    pub lp_mint: Pubkey,                        // 32
    pub base_mint: Pubkey,                      // 32
    pub treasury: Pubkey,                       // 32
    pub treasury_bump: u8,                      // 1
    pub next_market_id: u64,                    // 8
    pub challenge_window_seconds: i64,          // 8   — short (default 5 min)
    pub settlement_deadline_seconds: i64,       // 8   — auto-void if oracle silent this long
    pub odds_basis: u64,                        // 8
    pub lmsr_default_b: u64,                   // 8   Q32.32
    pub min_first_liquidity: u64,               // 8
    pub slip_house_margin_bps: u64,            // 8
    pub max_slip_bonus_multiplier_bps: u64,    // 8
    pub next_slip_id: u64,                      // 8
    pub current_epoch: u64,                     // 8
    pub epoch_duration_seconds: i64,            // 8
    pub withdrawal_cooldown_seconds: i64,       // 8
    // Sports risk controls
    pub max_single_bet: u64,                    // 8   — max lamports per single bet
    pub min_outcome_price_bps: u64,            // 8   — minimum implied probability (1 = 0.01%)
    pub buy_fee_bps: u64,                       // 8   — house fee on direct buys
    // Operator allowlist (can create/suspend/settle markets)
    pub operators: [Pubkey; MAX_OPERATORS],     // 32 * 8 = 256
    pub num_operators: u8,                      // 1
    pub bump: u8,                               // 1
}

impl GlobalConfig {
    pub const LEN: usize = 8  // discriminator
        + 32  // admin
        + 1   // paused
        + 32  // oracle_pubkey
        + 8   // max_market_exposure
        + 8   // locked_payouts
        + 8   // total_lp_supply
        + 32  // lp_mint
        + 32  // base_mint
        + 32  // treasury
        + 1   // treasury_bump
        + 8   // next_market_id
        + 8   // challenge_window_seconds
        + 8   // settlement_deadline_seconds
        + 8   // odds_basis
        + 8   // lmsr_default_b
        + 8   // min_first_liquidity
        + 8   // slip_house_margin_bps
        + 8   // max_slip_bonus_multiplier_bps
        + 8   // next_slip_id
        + 8   // current_epoch
        + 8   // epoch_duration_seconds
        + 8   // withdrawal_cooldown_seconds
        + 8   // max_single_bet
        + 8   // min_outcome_price_bps
        + 8   // buy_fee_bps
        + (32 * MAX_OPERATORS) // operators
        + 1   // num_operators
        + 1;  // bump

    pub fn free_liquidity(&self, treasury_balance: u64) -> u64 {
        if treasury_balance > self.locked_payouts {
            treasury_balance - self.locked_payouts
        } else {
            0
        }
    }

    /// Returns true if `key` is the admin or a registered operator.
    pub fn is_authorized(&self, key: &Pubkey) -> bool {
        if key == &self.admin {
            return true;
        }
        self.operators[..self.num_operators as usize]
            .iter()
            .any(|op| op == key)
    }

    /// Converts the stored oracle bytes to a Pubkey for comparison.
    pub fn oracle_pubkey(&self) -> Pubkey {
        Pubkey::from(self.oracle_pubkey)
    }
}

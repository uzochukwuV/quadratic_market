use anchor_lang::prelude::*;

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,                // 32
    pub paused: bool,                 // 1
    pub oracle_pubkey: [u8; 32],     // 32
    pub max_market_exposure: u64,     // 8
    pub locked_payouts: u64,          // 8
    pub total_lp_supply: u64,         // 8
    pub lp_mint: Pubkey,              // 32
    pub base_mint: Pubkey,            // 32
    pub treasury: Pubkey,             // 32
    pub treasury_bump: u8,            // 1
    pub next_market_id: u64,          // 8
    pub min_market_bond: u64,         // 8
    pub challenge_window_seconds: i64, // 8
    pub min_dispute_stake: u64,       // 8
    pub odds_basis: u64,              // 8
    pub lmsr_default_b: u64,          // 8 (Q32.32)
    pub min_first_liquidity: u64,     // 8
    pub slip_house_margin_bps: u64,   // 8 — default house margin for bet slips
    pub max_slip_bonus_multiplier_bps: u64, // 8 — max bonus multiplier for multi-leg slips
    pub bump: u8,                     // 1
}

impl GlobalConfig {
    // 8 (discriminator) + 32+1+32+8+8+8+32+32+32+1+8+8+8+8+8+8+8+8+8+1 = 261
    pub const LEN: usize = 8 + 32 + 1 + 32 + 8 + 8 + 8 + 32 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1;

    pub fn free_liquidity(&self, treasury_balance: u64) -> u64 {
        if treasury_balance > self.locked_payouts {
            treasury_balance - self.locked_payouts
        } else {
            0
        }
    }
}

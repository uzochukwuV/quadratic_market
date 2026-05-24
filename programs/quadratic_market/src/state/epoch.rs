use anchor_lang::prelude::*;

/// Tracks the state of an epoch - a time-bounded period during which
/// markets are created and settled. LPs can only withdraw after their
/// epoch's markets have all settled.
#[account]
pub struct Epoch {
    pub epoch_id: u64,           // 8 — unique epoch identifier
    pub start_time: i64,         // 8 — when this epoch began
    pub end_time: i64,           // 8 — when this epoch ends (start + duration)
    pub total_liquidity_added: u64,  // 8 — total base tokens added during this epoch
    pub total_liquidity_removed: u64, // 8 — total base tokens withdrawn after settlement
    pub num_markets: u16,        // 2 — number of markets created in this epoch
    pub num_settled_markets: u16, // 2 — number of markets that have been settled
    pub all_markets_settled: bool, // 1 — true when all markets in epoch are settled
    pub withdrawals_enabled: bool, // 1 — true when LPs can withdraw for this epoch
    pub lp_shares_at_close: u64, // 8 — total LP supply when epoch closed (for NAV calculation)
    pub bump: u8,                // 1
}

impl Epoch {
    pub const LEN: usize = 8  // discriminator
        + 8   // epoch_id
        + 8   // start_time
        + 8   // end_time
        + 8   // total_liquidity_added
        + 8   // total_liquidity_removed
        + 2   // num_markets
        + 2   // num_settled_markets
        + 1   // all_markets_settled
        + 1   // withdrawals_enabled
        + 8   // lp_shares_at_close
        + 1;  // bump

    /// Check if all markets in this epoch have been settled
    pub fn check_all_settled(&mut self) -> bool {
        if self.num_markets > 0 && self.num_settled_markets >= self.num_markets {
            self.all_markets_settled = true;
            true
        } else {
            false
        }
    }

    /// Mark a market as settled in this epoch
    pub fn mark_market_settled(&mut self) -> Result<()> {
        require!(
            self.num_settled_markets < self.num_markets,
            CustomError::AlreadySettled
        );
        self.num_settled_markets += 1;
        self.check_all_settled();
        Ok(())
    }
}

#[error_code]
pub enum CustomError {
    #[msg("All markets already settled")]
    AlreadySettled,
}

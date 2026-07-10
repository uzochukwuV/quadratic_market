use anchor_lang::prelude::*;

/// Tracks liquidity provided by LPs who opted into a specific epoch.
/// Each epoch has its own vault, isolating capital and preventing cross-epoch contamination.
#[account]
pub struct EpochVault {
    /// The epoch this vault belongs to
    pub epoch_id: u64,
    /// Total base tokens deposited by LPs who opted into this epoch
    pub total_deposits: u64,
    /// Total base tokens withdrawn by LPs after epoch settlement
    pub total_withdrawals: u64,
    /// Total LP shares minted for this epoch
    pub total_shares: u64,
    /// Number of LPs who have opted in
    pub num_lps: u32,
    /// Timestamp when the epoch started
    pub created_at: i64,
    /// Timestamp when the epoch ended (set at close)
    pub closed_at: i64,
    /// Whether withdrawals are enabled
    pub withdrawals_enabled: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl EpochVault {
    pub const LEN: usize = 8   // discriminator
        + 8   // epoch_id
        + 8   // total_deposits
        + 8   // total_withdrawals
        + 8   // total_shares
        + 4   // num_lps
        + 8   // created_at
        + 8   // closed_at
        + 1   // withdrawals_enabled
        + 1;  // bump

    /// Calculate the net result of the epoch (deposits - withdrawals)
    pub fn net_result(&self) -> i64 {
        self.total_deposits as i64 - self.total_withdrawals as i64
    }

    /// Calculate the LP share price (deposits / shares)
    /// Returns 0 if no shares issued yet
    pub fn share_price(&self) -> u64 {
        if self.total_shares == 0 {
            0
        } else {
            (self.total_deposits as u128 * SCALE / self.total_shares as u128) as u64
        }
    }
}

/// Tracks an individual LP's position in an epoch vault
#[account]
pub struct EpochLpPosition {
    /// The LP's public key
    pub owner: Pubkey,
    /// The epoch this position belongs to
    pub epoch_id: u64,
    /// Number of LP shares held
    pub shares: u64,
    /// Whether the LP has withdrawn their position
    pub withdrawn: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl EpochLpPosition {
    pub const LEN: usize = 8   // discriminator
        + 32  // owner
        + 8   // epoch_id
        + 8   // shares
        + 1   // withdrawn
        + 1;  // bump
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_vault_len_matches_expected() {
        // 8 + 8 + 8 + 8 + 8 + 4 + 8 + 8 + 1 + 1 = 62
        assert_eq!(EpochVault::LEN, 62);
    }

    #[test]
    fn epoch_lp_position_len_matches_expected() {
        // 8 + 32 + 8 + 8 + 1 + 1 = 58
        assert_eq!(EpochLpPosition::LEN, 58);
    }

    #[test]
    fn share_price_calculation() {
        let vault = EpochVault {
            epoch_id: 1,
            total_deposits: 100_000_000,
            total_withdrawals: 0,
            total_shares: 100_000_000, // 1:1 initially
            num_lps: 1,
            created_at: 0,
            closed_at: 0,
            withdrawals_enabled: true,
            bump: 1,
        };
        
        assert_eq!(vault.share_price(), SCALE); // 1.0 in Q32.32
    }

    #[test]
    fn share_price_zero_shares() {
        let vault = EpochVault {
            epoch_id: 1,
            total_deposits: 0,
            total_withdrawals: 0,
            total_shares: 0,
            num_lps: 0,
            created_at: 0,
            closed_at: 0,
            withdrawals_enabled: false,
            bump: 1,
        };
        
        assert_eq!(vault.share_price(), 0);
    }

    #[test]
    fn net_result_calculation() {
        let vault = EpochVault {
            epoch_id: 1,
            total_deposits: 100_000_000,
            total_withdrawals: 30_000_000,
            total_shares: 100_000_000,
            num_lps: 1,
            created_at: 0,
            closed_at: 0,
            withdrawals_enabled: false,
            bump: 1,
        };
        
        assert_eq!(vault.net_result(), 70_000_000);
    }
}

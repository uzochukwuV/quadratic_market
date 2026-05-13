use anchor_lang::prelude::*;

#[account]
pub struct WithdrawalRequest {
    pub lp: Pubkey,         // 32
    pub shares: u64,        // 8
    pub requested_at: i64,  // 8
    pub bump: u8,           // 1
}

impl WithdrawalRequest {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1; // 57
}

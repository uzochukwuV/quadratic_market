use anchor_lang::prelude::*;

/// Lifecycle of an oracle-proposed result.
/// No public challengers — admin can override within the challenge window.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum DisputeStatus {
    Pending,     // within challenge window, not yet finalized
    Settled,     // finalized after window expired
    Overridden,  // admin replaced the oracle result before finalization
}

#[account]
pub struct Dispute {
    pub market_id: u64,             // 8
    pub proposed_outcome: u8,       // 1
    pub proposer: Pubkey,           // 32  — oracle pubkey
    pub created_at: i64,            // 8
    pub challenge_deadline: i64,    // 8   — finalize allowed after this
    pub status: DisputeStatus,      // 1
    pub bump: u8,                   // 1
}

impl Dispute {
    pub const LEN: usize = 8  // discriminator
        + 8   // market_id
        + 1   // proposed_outcome
        + 32  // proposer
        + 8   // created_at
        + 8   // challenge_deadline
        + 1   // status
        + 1   // bump
        + 5;  // padding
}

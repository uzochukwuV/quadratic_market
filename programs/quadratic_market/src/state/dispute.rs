use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum DisputeStatus {
    ChallengeWindow,
    Challenged,
    ResolvedProposer,
    ResolvedChallenger,
}

#[account]
pub struct Dispute {
    pub market_id: u64,             // 8
    pub round: u32,                 // 4
    pub proposer: Pubkey,           // 32
    pub proposed_outcome: u8,       // 1
    pub proposer_stake: u64,        // 8
    pub challenger: Pubkey,         // 32
    pub challenge_outcome: u8,      // 1
    pub challenger_stake: u64,      // 8
    pub created_at: i64,            // 8
    pub challenge_deadline: i64,    // 8
    pub status: DisputeStatus,      // 1 + 1 (enum)
    pub bump: u8,                   // 1
}

impl Dispute {
    pub const LEN: usize = 8 // discriminator
        + 8   // market_id
        + 4   // round
        + 32  // proposer
        + 1   // proposed_outcome
        + 8   // proposer_stake
        + 32  // challenger
        + 1   // challenge_outcome
        + 8   // challenger_stake
        + 8   // created_at
        + 8   // challenge_deadline
        + 2   // status (enum)
        + 1;  // bump
}

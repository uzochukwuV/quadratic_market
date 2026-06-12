use crate::constants::MAX_SLIP_LEGS;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, Copy)]
pub struct SlipLeg {
    pub market_id: u64,
    pub outcome_id: u8,
    pub num_shares: u64,
}

/// Lifecycle state of a multi-leg bet slip.
///
/// Single-leg slips placed via `place_slip` are created directly as `Active`.
/// Multi-leg slips are assembled across several transactions: `open_slip`
/// creates the slip as `Building`, each `add_slip_leg` appends one leg (one
/// market per transaction, so the heap never holds more than one leg's worth of
/// state), and `finalize_slip` transitions it to `Active`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlipStatus {
    Building,
    Active,
}

impl Default for SlipStatus {
    fn default() -> Self {
        SlipStatus::Active
    }
}

#[account]
pub struct BetSlip {
    pub slip_id: u64,
    pub creator: Pubkey,
    pub legs: [SlipLeg; MAX_SLIP_LEGS],
    pub num_legs: u8,
    pub total_stake: u64,
    pub combined_odds_fp: u64, // Q32.32 decimal odds
    pub house_margin_bps: u64, // margin applied at placement
    pub potential_payout: u64, // quote at placement; final payout is recomputed at claim
    pub locked_amount: u64,    // LP-backed bonus gap currently reserved for this slip
    pub exposure_locked: u64,  // total group exposure locked at placement (display/backcompat)
    pub group_ids: [u64; MAX_SLIP_LEGS],
    pub group_exposure_locked: [u64; MAX_SLIP_LEGS],
    pub num_groups_locked: u8,
    pub claimed: bool,
    pub is_seed: bool,
    pub seed_group_id: u64,
    pub seed_position_index: u8,
    pub bump: u8,
    // ── Multi-leg state machine (open_slip / add_slip_leg / finalize_slip) ──
    pub status: SlipStatus, // Building while legs are being added, Active once finalized
    pub legs_added: u8,     // number of legs appended so far (Building)
    pub max_payment: u64,   // per-slip stake cap supplied at open_slip
}

impl BetSlip {
    pub const LEN: usize = 8  // discriminator
        + 8   // slip_id
        + 32  // creator
        + 136 // legs: 8 * (u64 + u8 + u64)
        + 1   // num_legs
        + 8   // total_stake
        + 8   // combined_odds_fp
        + 8   // house_margin_bps
        + 8   // potential_payout
        + 8   // locked_amount
        + 8   // exposure_locked
        + 64  // group_ids
        + 64  // group_exposure_locked
        + 1   // num_groups_locked
        + 1   // claimed
        + 1   // is_seed
        + 8   // seed_group_id
        + 1   // seed_position_index
        + 1   // bump
        + 1   // status (SlipStatus enum, 1-byte discriminant)
        + 1   // legs_added
        + 8; // max_payment
}

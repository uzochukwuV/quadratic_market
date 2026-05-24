use anchor_lang::prelude::*;

/// A Polymarket-style listing that allows a bet slip creator to auction their
/// position to any willing buyer.
///
/// When a listing is created:
/// - The seller (slip creator) specifies an asking price in base tokens (USDC).
/// - The bet slip's `creator` field is NOT changed until filled, so the seller
///   retains claim rights until the listing is filled.
///
/// When the listing is filled:
/// - Buyer pays `asking_price` USDC to the seller (minus protocol fee).
/// - `bet_slip.creator` is updated to the buyer's address.
/// - The listing PDA is closed.
///
/// When the listing is cancelled:
/// - The listing PDA is closed; the original seller retains the slip.
#[account]
pub struct SlipListing {
    pub listing_id: u64,          // 8  — unique listing id
    pub slip_id: u64,             // 8  — the BetSlip being listed
    pub seller: Pubkey,           // 32 — must match bet_slip.creator at listing time
    pub asking_price: u64,        // 8  — USDC amount buyer must pay (gross, before protocol fee)
    pub created_at: i64,          // 8
    pub expires_at: i64,          // 8  — 0 = no expiry
    pub bump: u8,                 // 1
}

impl SlipListing {
    pub const LEN: usize = 8  // discriminator
        + 8   // listing_id
        + 8   // slip_id
        + 32  // seller
        + 8   // asking_price
        + 8   // created_at
        + 8   // expires_at
        + 1   // bump
        + 7;  // padding
}

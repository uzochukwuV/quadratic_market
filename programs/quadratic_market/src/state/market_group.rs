use crate::constants::{
    MAX_CORRELATION_PAIRS, MAX_GROUP_MARKETS, MAX_OUTCOMES, MAX_SAME_GAME_STATES,
    MAX_SEED_POSITIONS,
};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, Copy)]
pub struct CorrelationPair {
    pub market_a_index: u8,
    pub outcome_a_id: u8,
    pub market_b_index: u8,
    pub outcome_b_id: u8,
    pub weight_bps: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, Copy)]
pub struct SeedPosition {
    pub seeder: Pubkey,
    pub slip_id: u64,
    pub market_index: u8,
    pub outcome_id: u8,
    pub amount: u64,
    pub reward_claimed: bool,
    pub refunded: bool,
}

#[account]
pub struct MarketGroup {
    pub group_id: u64,
    pub creator: Pubkey,
    pub total_group_exposure: u64,
    pub max_group_exposure: u64,
    pub num_markets: u8,
    pub market_ids: [u64; MAX_GROUP_MARKETS],
    pub correlations: [CorrelationPair; MAX_CORRELATION_PAIRS],
    pub num_correlations: u8,
    pub num_states: u8,
    pub state_probabilities: [u64; MAX_SAME_GAME_STATES],
    pub outcome_state_masks: [[u64; MAX_OUTCOMES]; MAX_GROUP_MARKETS],
    pub statistical_discount_bps: u64,
    pub seed_fee_pools: [u64; MAX_GROUP_MARKETS],
    pub seed_fee_share_bps: u64,
    pub seed_min_volume: u64,
    pub seed_max_side_share_bps: u64,
    pub seed_positions: [SeedPosition; MAX_SEED_POSITIONS],
    pub num_seed_positions: u8,
    pub event_start_time: i64,
    pub correlation_locked: bool,
    pub title: String,
    pub bump: u8,
}

impl MarketGroup {
    pub const LEN: usize = 8 // discriminator
        + 8   // group_id
        + 32  // creator
        + 8   // total_group_exposure
        + 8   // max_group_exposure
        + 1   // num_markets
        + 64  // market_ids (8 * u64)
        + 192 // correlations (16 pairs × 12 bytes each in Borsh)
        + 1   // num_correlations
        + 1   // num_states
        + 512 // state_probabilities (64 * u64)
        + 512 // outcome_state_masks (8 * 8 * u64)
        + 8   // statistical_discount_bps
        + 64  // seed_fee_pools
        + 8   // seed_fee_share_bps
        + 8   // seed_min_volume
        + 8   // seed_max_side_share_bps
        + 832 // seed_positions (16 * (32 + 8 + 1 + 1 + 8 + 1 + 1))
        + 1   // num_seed_positions
        + 8   // event_start_time
        + 1   // correlation_locked
        + (4 + 128) // title
        + 1; // bump
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that the raw byte offsets used in slip.rs / claim.rs for
    /// hand-rolled deserialization still match the actual Borsh layout.
    /// If this test fails, the struct has changed and the offset readers
    /// in slip.rs / claim.rs need updating.
    #[test]
    fn market_group_layout_offsets_match_borsh() {
        let mut group = MarketGroup {
            group_id: 0x0102030405060708u64,
            creator: Pubkey::new_from_array([0xAAu8; 32]),
            total_group_exposure: 0x1112131415161718u64,
            max_group_exposure: 0x2122232425262728u64,
            num_markets: 3,
            market_ids: [0x3132333435363738u64; MAX_GROUP_MARKETS],
            correlations: [CorrelationPair { market_a_index: 1, outcome_a_id: 2, market_b_index: 3, outcome_b_id: 4, weight_bps: 0x5152535455565758u64 }; MAX_CORRELATION_PAIRS],
            num_correlations: 1,
            num_states: 4,
            state_probabilities: [0x6162636465666768u64; MAX_SAME_GAME_STATES],
            outcome_state_masks: {
                let mut m = [[0u64; MAX_GROUP_MARKETS]; MAX_GROUP_MARKETS];
                m[0][0] = 0x7172737475767778u64;
                m
            },
            statistical_discount_bps: 0x8182838485868788u64,
            seed_fee_pools: [0x9192939495969798u64; MAX_GROUP_MARKETS],
            seed_fee_share_bps: 0xA1A2A3A4A5A6A7A8u64,
            seed_min_volume: 0xB1B2B3B4B5B6B7B8u64,
            seed_max_side_share_bps: 0xC1C2C3C4C5C6C7C8u64,
            seed_positions: [SeedPosition { seeder: Pubkey::new_from_array([0xD1u8; 32]), slip_id: 0xE1E2E3E4E5E6E7E8u64, market_index: 5, outcome_id: 6, amount: 0xF1F2F3F4F5F6F7F8u64, reward_claimed: true, refunded: false }; MAX_SEED_POSITIONS],
            num_seed_positions: 1,
            event_start_time: 0x0102030405060708i64,
            correlation_locked: true,
            title: "T".repeat(128),
            bump: 0xAB,
        };

        let mut buf = Vec::new();
        group.serialize(&mut buf).unwrap();

        // Anchor adds an 8-byte discriminator to account data.
        // serialize() only covers struct fields; +8 gives the full account size.
        assert_eq!(
            buf.len() + 8,
            MarketGroup::LEN,
            "Borsh serialized size {} + 8 discriminator != expected LEN {}",
            buf.len(),
            MarketGroup::LEN
        );

        let data = buf.as_slice();

        // ---- Verify the offsets used by slip.rs / claim.rs match the
        //       actual Borsh layout by reading back the sentinel values.
        //
        //   Use read_u64 helper for byte-offset reads.
        fn read_u64(data: &[u8], offset: usize) -> u64 {
            let bytes: [u8; 8] = data[offset..offset + 8].try_into().unwrap();
            u64::from_le_bytes(bytes)
        }

        assert_eq!(read_u64(data, 40), 0x1112131415161718u64, "total_group_exposure offset");
        assert_eq!(data[56], 3u8, "num_markets offset");
        assert_eq!(read_u64(data, 121 + 4), 0x5152535455565758u64, "correlations[0].weight_bps offset");
        assert_eq!(data[314], 4u8, "num_states offset");
        assert_eq!(read_u64(data, 315), 0x6162636465666768u64, "state_probabilities[0] offset");
        assert_eq!(read_u64(data, 827), 0x7172737475767778u64, "outcome_state_masks[0][0] offset");
        assert_eq!(read_u64(data, 1339), 0x8182838485868788u64, "statistical_discount_bps offset");
        assert_eq!(read_u64(data, 1347), 0x9192939495969798u64, "seed_fee_pools[0] offset");
        assert_eq!(read_u64(data, 1411), 0xA1A2A3A4A5A6A7A8u64, "seed_fee_share_bps offset");
        assert_eq!(read_u64(data, 1435 + 32), 0xE1E2E3E4E5E6E7E8u64, "seed_positions[0].slip_id offset");
        assert_eq!(data[2267], 1u8, "num_seed_positions offset");
    }
}

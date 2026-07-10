use anchor_lang::prelude::*;
use crate::constants::{MAX_SETTLEMENT_OPERATORS, MAX_CONFIRMATIONS};

/// Tracks the set of staked operators who can propose and confirm settlement outcomes.
/// Each operator must stake a minimum amount to participate, which can be slashed
/// if they confirm an incorrect outcome.
#[account]
pub struct SettlementCouncil {
    /// Authority that can add/remove operators (admin or governance)
    pub authority: Pubkey,
    /// List of operator pubkeys
    pub operators: [Pubkey; MAX_SETTLEMENT_OPERATORS],
    /// Stake amounts locked by each operator (in base token lamports)
    pub stakes: [u64; MAX_SETTLEMENT_OPERATORS],
    /// Minimum stake required to participate as an operator
    pub min_stake: u64,
    /// Number of confirmations required to finalize settlement (e.g., 2 for 2-of-3)
    pub required_confirmations: u8,
    /// Number of active operators
    pub num_operators: u8,
    /// Bump seed for PDA
    pub bump: u8,
}

impl SettlementCouncil {
    pub const LEN: usize = 8   // discriminator
        + 32  // authority
        + (32 * MAX_SETTLEMENT_OPERATORS)  // operators
        + (8 * MAX_SETTLEMENT_OPERATORS)   // stakes
        + 8   // min_stake
        + 1   // required_confirmations
        + 1   // num_operators
        + 1;  // bump

    /// Returns the index of the operator if found, None otherwise
    pub fn get_operator_index(&self, pubkey: &Pubkey) -> Option<usize> {
        for i in 0..self.num_operators as usize {
            if self.operators[i] == *pubkey {
                return Some(i);
            }
        }
        None
    }

    /// Check if an operator is registered and has sufficient stake
    pub fn is_valid_operator(&self, pubkey: &Pubkey) -> bool {
        if let Some(idx) = self.get_operator_index(pubkey) {
            return self.stakes[idx] >= self.min_stake;
        }
        false
    }

    /// Get the stake amount for an operator
    pub fn get_stake(&self, pubkey: &Pubkey) -> u64 {
        if let Some(idx) = self.get_operator_index(pubkey) {
            self.stakes[idx]
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settlement_council_len_matches_expected() {
        // 8 + 32 + (32*8) + (8*8) + 8 + 1 + 1 + 1 = 8 + 32 + 256 + 64 + 8 + 1 + 1 + 1 = 371
        assert_eq!(SettlementCouncil::LEN, 371);
    }

    #[test]
    fn get_operator_index_found() {
        let mut council = SettlementCouncil {
            authority: Pubkey::default(),
            operators: [Pubkey::default(); MAX_SETTLEMENT_OPERATORS],
            stakes: [0; MAX_SETTLEMENT_OPERATORS],
            min_stake: 1000,
            required_confirmations: 2,
            num_operators: 2,
            bump: 1,
        };
        
        let test_pubkey = Pubkey::new_unique();
        council.operators[0] = test_pubkey;
        council.stakes[0] = 5000;
        
        assert_eq!(council.get_operator_index(&test_pubkey), Some(0));
    }

    #[test]
    fn get_operator_index_not_found() {
        let council = SettlementCouncil {
            authority: Pubkey::default(),
            operators: [Pubkey::default(); MAX_SETTLEMENT_OPERATORS],
            stakes: [0; MAX_SETTLEMENT_OPERATORS],
            min_stake: 1000,
            required_confirmations: 2,
            num_operators: 0,
            bump: 1,
        };
        
        let test_pubkey = Pubkey::new_unique();
        assert_eq!(council.get_operator_index(&test_pubkey), None);
    }
}

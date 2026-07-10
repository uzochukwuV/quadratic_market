use anchor_lang::prelude::*;
use crate::constants::MAX_SETTLEMENT_OPERATORS;

/// Represents a proposed settlement outcome for a market.
/// Multiple operators can confirm the same proposal; when quorum is reached,
/// the proposal can be finalized.
#[account]
pub struct SettlementProposal {
    /// The market this proposal is for
    pub market_id: u64,
    /// The outcome being proposed (outcome index)
    pub proposed_outcome: u8,
    /// Reference to the external transaction/event that established this outcome
    /// (e.g., API transaction hash the operator is attesting to)
    pub tx_hash_ref: [u8; 32],
    /// Bitmask of operators who have confirmed this proposal
    /// Bit i = operator at index i has confirmed
    pub confirmations_mask: u16,
    /// Number of confirmations received
    pub num_confirmations: u8,
    /// Timestamp when the proposal was created
    pub created_at: i64,
    /// Deadline for collecting confirmations
    pub confirmation_deadline: i64,
    /// Whether this proposal has been finalized
    pub finalized: bool,
    /// Whether this proposal has been disputed
    pub disputed: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl SettlementProposal {
    pub const LEN: usize = 8   // discriminator
        + 8   // market_id
        + 1   // proposed_outcome
        + 32  // tx_hash_ref
        + 2   // confirmations_mask
        + 1   // num_confirmations
        + 8   // created_at
        + 8   // confirmation_deadline
        + 1   // finalized
        + 1   // disputed
        + 1;  // bump

    /// Check if a specific operator has confirmed this proposal
    pub fn has_confirmed(&self, operator_index: u8) -> bool {
        if operator_index >= MAX_SETTLEMENT_OPERATORS as u8 {
            return false;
        }
        self.confirmations_mask & (1u16 << operator_index) != 0
    }

    /// Check if quorum has been reached
    pub fn has_quorum(&self, required: u8) -> bool {
        self.num_confirmations >= required
    }

    /// Add a confirmation from an operator
    pub fn add_confirmation(&mut self, operator_index: u8) -> bool {
        if operator_index >= MAX_SETTLEMENT_OPERATORS as u8 {
            return false;
        }
        let bit = 1u16 << operator_index;
        if self.confirmations_mask & bit != 0 {
            return false; // Already confirmed
        }
        self.confirmations_mask |= bit;
        self.num_confirmations += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settlement_proposal_len_matches_expected() {
        // 8 + 8 + 1 + 32 + 2 + 1 + 8 + 8 + 1 + 1 + 1 = 71
        assert_eq!(SettlementProposal::LEN, 71);
    }

    #[test]
    fn has_confirmed_false_when_not_confirmed() {
        let proposal = SettlementProposal {
            market_id: 1,
            proposed_outcome: 0,
            tx_hash_ref: [0u8; 32],
            confirmations_mask: 0,
            num_confirmations: 0,
            created_at: 0,
            confirmation_deadline: 100,
            finalized: false,
            disputed: false,
            bump: 1,
        };
        
        assert!(!proposal.has_confirmed(0));
    }

    #[test]
    fn has_confirmed_true_when_confirmed() {
        let proposal = SettlementProposal {
            market_id: 1,
            proposed_outcome: 0,
            tx_hash_ref: [0u8; 32],
            confirmations_mask: 0b0001, // Operator 0 confirmed
            num_confirmations: 1,
            created_at: 0,
            confirmation_deadline: 100,
            finalized: false,
            disputed: false,
            bump: 1,
        };
        
        assert!(proposal.has_confirmed(0));
        assert!(!proposal.has_confirmed(1));
    }

    #[test]
    fn add_confirmation_new() {
        let mut proposal = SettlementProposal {
            market_id: 1,
            proposed_outcome: 0,
            tx_hash_ref: [0u8; 32],
            confirmations_mask: 0,
            num_confirmations: 0,
            created_at: 0,
            confirmation_deadline: 100,
            finalized: false,
            disputed: false,
            bump: 1,
        };
        
        assert!(proposal.add_confirmation(0));
        assert_eq!(proposal.confirmations_mask, 0b0001);
        assert_eq!(proposal.num_confirmations, 1);
    }

    #[test]
    fn add_confirmation_already_confirmed() {
        let mut proposal = SettlementProposal {
            market_id: 1,
            proposed_outcome: 0,
            tx_hash_ref: [0u8; 32],
            confirmations_mask: 0b0001,
            num_confirmations: 1,
            created_at: 0,
            confirmation_deadline: 100,
            finalized: false,
            disputed: false,
            bump: 1,
        };
        
        assert!(!proposal.add_confirmation(0)); // Already confirmed
        assert_eq!(proposal.num_confirmations, 1); // Should not increment
    }

    #[test]
    fn has_quorum() {
        let mut proposal = SettlementProposal {
            market_id: 1,
            proposed_outcome: 0,
            tx_hash_ref: [0u8; 32],
            confirmations_mask: 0b0011, // 2 confirmations
            num_confirmations: 2,
            created_at: 0,
            confirmation_deadline: 100,
            finalized: false,
            disputed: false,
            bump: 1,
        };
        
        assert!(!proposal.has_quorum(3));
        assert!(proposal.has_quorum(2));
        assert!(proposal.has_quorum(1));
    }
}

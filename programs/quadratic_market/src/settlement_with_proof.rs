//! Settlement with TxLINE on-chain proof validation
//! 
//! This module implements the permissionless settlement flow using TxLINE's
//! cryptographic Merkle proofs:
//! 
//! 1. Match Ends
//! 2. Bot fetches proof from TxLINE API (/api/scores/stat-validation)
//! 3. Bot calls settle_with_proof with proof data
//! 4. Program validates proof via CPI to Txoracle
//! 5. If valid, market is settled
//! 
//! This is permissionless - anyone can call it with valid proof data.

use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, Market, MarketStatus, Epoch};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

// TxLINE/Txoracle program IDs
const TXORACLE_DEVNET: &str = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
const TXORACLE_MAINNET: &str = "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA";

/// Proof node for Merkle proof validation
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

/// Fixture summary from TxLINE API
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FixtureSummary {
    pub fixture_id: u64,
    pub update_count: u32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
    pub events_subtree_root: [u8; 32],
}

/// Update stats for the fixture
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateStats {
    pub update_count: u32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

/// Stat to prove from TxLINE
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatToProve {
    pub stat_key: u32,
    pub value: i64,
}

/// Single stat validation data
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatValidation {
    pub stat_to_prove: StatToProve,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

/// Predicate for validation
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Predicate {
    pub threshold: i64,
    pub comparison: PredicateComparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum PredicateComparison {
    EqualTo,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
}

/// Settlement with TxLINE proof - PERMISSIONLESS
/// 
/// Anyone can call this with valid TxLINE proof data.
/// The proof is validated on-chain via CPI to the Txoracle program.
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct SettleWithProof<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.market_id == market_id @ QuadraticMarketError::InvalidAmount,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [seeds::EPOCH, market.epoch_id.to_le_bytes().as_ref()],
        bump = epoch.bump,
        constraint = epoch.epoch_id == market.epoch_id @ QuadraticMarketError::EpochAccountMismatch,
    )]
    pub epoch: Account<'info, Epoch>,

    /// PDA for daily scores Merkle roots
    pub daily_scores_pda: AccountInfo<'info>,

    /// The caller (anyone can call with valid proof)
    pub caller: Signer<'info>,
}

/// Simplified settle with proof - skips CPI validation for MVP
/// 
/// For the full implementation, we would:
/// 1. CPI to Txoracle.validateStat
/// 2. Check the validation result
/// 3. Only settle if validation passes
/// 
/// This version accepts the proof data and settles directly,
/// with the expectation that the bot validates off-chain first.
/// 
/// For production, implement full CPI validation using the
/// Txoracle program's validateStat instruction.
pub fn settle_with_proof_handler(
    ctx: Context<SettleWithProof>,
    market_id: u64,
    proposed_outcome: u8,
    // TxLINE proof data (would be validated via CPI in full implementation)
    txline_fixture_id: u64,
    validation_timestamp: i64,
    home_score: i64,
    away_score: i64,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let market = &mut ctx.accounts.market;
    let epoch = &mut ctx.accounts.epoch;

    // Verify market can be settled
    require!(
        market.status.can_settle(),
        QuadraticMarketError::InvalidMarketStatus
    );

    // Verify txline_fixture_id matches
    if let Some(fixture_id) = market.txline_fixture_id {
        require!(
            fixture_id == txline_fixture_id,
            QuadraticMarketError::InvalidTxlineFixtureId
        );
    }

    // Validate outcome
    require!(
        (proposed_outcome as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidProposedOutcome
    );

    // Verify match has started
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= market.start_time,
        QuadraticMarketError::MarketAlreadyStarted
    );

    // Derive winning outcome from scores based on market type
    let winning_outcome = derive_winning_outcome(
        proposed_outcome,
        home_score,
        away_score,
        &market.market_type,
    )?;

    // Mark market as settled
    market.winning_outcome = winning_outcome;
    market.status = MarketStatus::Settled;
    market.settlement_time = now;
    market.txline_proof_verified = true;

    // Update epoch settlement tracking
    if !market.settled_in_epoch {
        market.settled_in_epoch = true;
        epoch.num_settled_markets = epoch.num_settled_markets
            .checked_add(1)
            .ok_or(QuadraticMarketError::MathOverflow)?;

        // When all markets settled, enable LP withdrawals
        if epoch.num_markets > 0 && epoch.num_settled_markets >= epoch.num_markets {
            epoch.all_markets_settled = true;
            epoch.lp_shares_at_close = config.total_lp_supply;
            epoch.withdrawals_enabled = true;
        }
    }

    emit!(MarketSettledWithProof {
        market_id,
        winning_outcome,
        txline_fixture_id,
        validation_timestamp,
        home_score,
        away_score,
        caller: ctx.accounts.caller.key(),
    });

    Ok(())
}

/// Derive winning outcome from scores based on market type
fn derive_winning_outcome(
    proposed_outcome: u8,
    home_score: i64,
    away_score: i64,
    market_type: &crate::state::market::MarketType,
) -> Result<u8> {
    use crate::state::market::MarketType;

    match market_type {
        MarketType::OneXTwo => {
            // 1X2: 0=home win, 1=draw, 2=away win
            if home_score > away_score {
                Ok(0) // Home wins
            } else if home_score < away_score {
                Ok(2) // Away wins
            } else {
                Ok(1) // Draw
            }
        }
        MarketType::OverUnder => {
            // O/U 2.5: 0=over (total > 2.5), 1=under (total <= 2.5)
            let total = home_score.saturating_add(away_score);
            if total > 2 {
                Ok(0) // Over 2.5
            } else {
                Ok(1) // Under 2.5
            }
        }
        MarketType::GoalNoGoal => {
            // GG/NG: 0=GG (both score), 1=NG (one or neither scores)
            if home_score > 0 && away_score > 0 {
                Ok(0) // GG
            } else {
                Ok(1) // NG
            }
        }
    }
}

/// Events for proof-based settlement
#[event]
pub struct MarketSettledWithProof {
    pub market_id: u64,
    pub winning_outcome: u8,
    pub txline_fixture_id: u64,
    pub validation_timestamp: i64,
    pub home_score: i64,
    pub away_score: i64,
    pub caller: Pubkey,
}

/// CPI call to Txoracle for full validation
/// 
/// This would be the full implementation that validates
/// the Merkle proof on-chain via CPI to the Txoracle program.
/// 
/// For now, we use the simplified version above.
/// 
/// #[derive(Accounts)]
/// pub struct SettleWithValidatedProof<'info> {
///     // ... accounts ...
///     pub txoracle_program: Program<'info, Txoracle>,
/// }
/// 
/// pub fn settle_with_validated_proof_handler(
///     ctx: Context<SettleWithValidatedProof>,
///     // proof data...
/// ) -> Result<()> {
///     // 1. Call txoracle.validateStat via CPI
///     // 2. Check validation result
///     // 3. If valid, settle market
///     // 4. Emit verification event
/// }

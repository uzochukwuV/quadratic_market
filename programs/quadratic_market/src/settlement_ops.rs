use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, Market, MarketStatus, SettlementCouncil, SettlementProposal, Epoch};
use crate::errors::QuadraticMarketError;
use crate::constants::{
    seeds,
    MAX_SETTLEMENT_OPERATORS,
    DEFAULT_CONFIRMATION_WINDOW_SECONDS,
};

/// Initialize the SettlementCouncil.
/// Can only be called once; subsequent calls are no-ops.
#[derive(Accounts)]
pub struct InitializeSettlementCouncil<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        init_if_needed,
        payer = authority,
        space = SettlementCouncil::LEN,
        seeds = [seeds::SETTLEMENT_COUNCIL],
        bump,
    )]
    pub settlement_council: Account<'info, SettlementCouncil>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_settlement_council_handler(
    ctx: Context<InitializeSettlementCouncil>,
    min_stake: u64,
    required_confirmations: u8,
) -> Result<()> {
    let council = &mut ctx.accounts.settlement_council;
    let config = &ctx.accounts.global_config;

    // Only admin or authorized operator can initialize
    require!(
        ctx.accounts.authority.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    // Only initialize if not already initialized (bump == 0 means fresh account)
    if council.bump == 0 {
        council.authority = ctx.accounts.authority.key();
        council.min_stake = min_stake;
        council.required_confirmations = required_confirmations;
        council.num_operators = 0;
        council.operators = [Pubkey::default(); MAX_SETTLEMENT_OPERATORS];
        council.stakes = [0; MAX_SETTLEMENT_OPERATORS];
        council.bump = ctx.bumps.settlement_council;
        
        emit!(SettlementCouncilInitialized {
            authority: council.authority,
            min_stake,
            required_confirmations,
        });
    }

    Ok(())
}

/// Add a settlement operator to the council.
#[derive(Accounts)]
pub struct AddSettlementOperator<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::SETTLEMENT_COUNCIL],
        bump = settlement_council.bump,
    )]
    pub settlement_council: Account<'info, SettlementCouncil>,

    pub authority: Signer<'info>,
}

pub fn add_settlement_operator_handler(
    ctx: Context<AddSettlementOperator>,
    operator: Pubkey,
    stake: u64,
) -> Result<()> {
    let council = &mut ctx.accounts.settlement_council;

    // Only council authority can add operators
    require!(
        ctx.accounts.authority.key() == council.authority,
        QuadraticMarketError::Unauthorized
    );

    // Check stake requirement
    require!(stake >= council.min_stake, QuadraticMarketError::MinStakeNotMet);

    // Find empty slot
    require!(
        council.num_operators < MAX_SETTLEMENT_OPERATORS as u8,
        QuadraticMarketError::SettlementOperatorListFull
    );

    // Check if operator already exists
    require!(
        council.get_operator_index(&operator).is_none(),
        QuadraticMarketError::OperatorNotInCouncil
    );

    let idx = council.num_operators as usize;
    council.operators[idx] = operator;
    council.stakes[idx] = stake;
    council.num_operators += 1;

    emit!(SettlementOperatorAdded {
        operator,
        stake,
        total_operators: council.num_operators,
    });

    Ok(())
}

/// Remove a settlement operator from the council.
#[derive(Accounts)]
pub struct RemoveSettlementOperator<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::SETTLEMENT_COUNCIL],
        bump = settlement_council.bump,
    )]
    pub settlement_council: Account<'info, SettlementCouncil>,

    pub authority: Signer<'info>,
}

pub fn remove_settlement_operator_handler(
    ctx: Context<RemoveSettlementOperator>,
    operator: Pubkey,
) -> Result<()> {
    let council = &mut ctx.accounts.settlement_council;

    require!(
        ctx.accounts.authority.key() == council.authority,
        QuadraticMarketError::Unauthorized
    );

    let idx = council.get_operator_index(&operator)
        .ok_or(QuadraticMarketError::OperatorNotInCouncil)?;

    // Remove by swapping with last element
    let last_idx = (council.num_operators as usize) - 1;
    if idx != last_idx {
        council.operators[idx] = council.operators[last_idx];
        council.stakes[idx] = council.stakes[last_idx];
    }

    council.num_operators -= 1;
    council.operators[last_idx] = Pubkey::default();
    council.stakes[last_idx] = 0;

    emit!(SettlementOperatorRemoved {
        operator,
        remaining_operators: council.num_operators,
    });

    Ok(())
}

/// Propose a settlement outcome for a market.
/// First operator to propose opens the proposal; subsequent operators confirm.
#[derive(Accounts)]
#[instruction(market_id: u64, proposed_outcome: u8)]
pub struct ProposeSettlement<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [seeds::SETTLEMENT_COUNCIL],
        bump = settlement_council.bump,
    )]
    pub settlement_council: Account<'info, SettlementCouncil>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = operator,
        space = SettlementProposal::LEN,
        seeds = [seeds::SETTLEMENT_PROPOSAL, market_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub proposal: Account<'info, SettlementProposal>,

    #[account(mut)]
    pub operator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn propose_settlement_handler(
    ctx: Context<ProposeSettlement>,
    market_id: u64,
    proposed_outcome: u8,
    tx_hash_ref: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let council = &ctx.accounts.settlement_council;
    let market = &mut ctx.accounts.market;
    let proposal = &mut ctx.accounts.proposal;

    // Verify operator is valid
    require!(
        council.is_valid_operator(&ctx.accounts.operator.key()),
        QuadraticMarketError::InvalidSettlementOperator
    );

    // Market must be in a settlable state
    require!(
        market.status.can_settle(),
        QuadraticMarketError::InvalidMarketStatus
    );

    // Market must have started
    let now = Clock::get()?.unix_timestamp;
    require!(now >= market.start_time, QuadraticMarketError::MarketAlreadyStarted);

    // Validate outcome
    require!(
        (proposed_outcome as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidProposedOutcome
    );

    // Get operator index for confirmation
    let operator_idx = council.get_operator_index(&ctx.accounts.operator.key())
        .ok_or(QuadraticMarketError::InvalidSettlementOperator)?;

    // Initialize proposal
    proposal.market_id = market_id;
    proposal.proposed_outcome = proposed_outcome;
    proposal.tx_hash_ref = tx_hash_ref;
    proposal.confirmations_mask = 1u16 << operator_idx; // First operator auto-confirms
    proposal.num_confirmations = 1;
    proposal.created_at = now;
    proposal.confirmation_deadline = now
        .checked_add(DEFAULT_CONFIRMATION_WINDOW_SECONDS)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    proposal.finalized = false;
    proposal.disputed = false;
    proposal.bump = ctx.bumps.proposal;

    // Update market status
    market.status = MarketStatus::Proposed;
    market.settlement_time = now;

    emit!(SettlementProposed {
        market_id,
        proposed_outcome,
        proposer: ctx.accounts.operator.key(),
        tx_hash_ref,
    });

    // Check if quorum already reached (single operator for 2-of-1)
    if proposal.has_quorum(council.required_confirmations) {
        emit!(SettlementQuorumReached {
            market_id,
            num_confirmations: proposal.num_confirmations,
            required: council.required_confirmations,
        });
    }

    Ok(())
}

/// Confirm an existing settlement proposal.
/// Operator must not have already confirmed this proposal.
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ConfirmSettlement<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [seeds::SETTLEMENT_COUNCIL],
        bump = settlement_council.bump,
    )]
    pub settlement_council: Account<'info, SettlementCouncil>,

    #[account(
        mut,
        seeds = [seeds::SETTLEMENT_PROPOSAL, market_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, SettlementProposal>,

    pub operator: Signer<'info>,
}

pub fn confirm_settlement_handler(
    ctx: Context<ConfirmSettlement>,
    market_id: u64,
) -> Result<()> {
    let council = &ctx.accounts.settlement_council;
    let proposal = &mut ctx.accounts.proposal;

    // Verify operator is valid
    require!(
        council.is_valid_operator(&ctx.accounts.operator.key()),
        QuadraticMarketError::InvalidSettlementOperator
    );

    // Proposal must not be finalized
    require!(!proposal.finalized, QuadraticMarketError::ProposalAlreadyFinalized);

    // Proposal must not be disputed
    require!(!proposal.disputed, QuadraticMarketError::ProposalDisputed);

    // Must be within confirmation window
    let now = Clock::get()?.unix_timestamp;
    require!(
        now <= proposal.confirmation_deadline,
        QuadraticMarketError::ConfirmationDeadlinePassed
    );

    // Get operator index
    let operator_idx = council.get_operator_index(&ctx.accounts.operator.key())
        .ok_or(QuadraticMarketError::InvalidSettlementOperator)?;

    // Add confirmation
    require!(
        proposal.add_confirmation(operator_idx as u8),
        QuadraticMarketError::AlreadyConfirmed
    );

    emit!(SettlementConfirmed {
        market_id,
        confirmer: ctx.accounts.operator.key(),
        operator_index: operator_idx as u8,
        total_confirmations: proposal.num_confirmations,
    });

    // Check if quorum reached
    if proposal.has_quorum(council.required_confirmations) {
        emit!(SettlementQuorumReached {
            market_id,
            num_confirmations: proposal.num_confirmations,
            required: council.required_confirmations,
        });
    }

    Ok(())
}

/// Dispute a settlement proposal.
/// Can be called if another operator disagrees with the proposed outcome.
#[derive(Accounts)]
#[instruction(market_id: u64, alternative_outcome: u8)]
pub struct DisputeSettlement<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [seeds::SETTLEMENT_COUNCIL],
        bump = settlement_council.bump,
    )]
    pub settlement_council: Account<'info, SettlementCouncil>,

    #[account(
        mut,
        seeds = [seeds::SETTLEMENT_PROPOSAL, market_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, SettlementProposal>,

    pub operator: Signer<'info>,
}

pub fn dispute_settlement_handler(
    ctx: Context<DisputeSettlement>,
    market_id: u64,
    alternative_outcome: u8,
) -> Result<()> {
    let council = &ctx.accounts.settlement_council;
    let proposal = &mut ctx.accounts.proposal;

    // Verify operator is valid
    require!(
        council.is_valid_operator(&ctx.accounts.operator.key()),
        QuadraticMarketError::InvalidSettlementOperator
    );

    // Proposal must not already be finalized
    require!(!proposal.finalized, QuadraticMarketError::ProposalAlreadyFinalized);

    // Mark as disputed
    proposal.disputed = true;

    // Slashing: operator who confirmed the wrong outcome loses their stake
    // The stake is not actually transferred here - that's handled by resolve_dispute
    let operator_idx = council.get_operator_index(&ctx.accounts.operator.key())
        .ok_or(QuadraticMarketError::InvalidSettlementOperator)?;

    emit!(SettlementDisputed {
        market_id,
        disputed_by: ctx.accounts.operator.key(),
        operator_index: operator_idx as u8,
        proposed_outcome: proposal.proposed_outcome,
        alternative_outcome,
    });

    Ok(())
}

/// Finalize a settlement proposal.
/// Can be called permissionlessly once quorum is reached.
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct FinalizeSettlement<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [seeds::SETTLEMENT_COUNCIL],
        bump = settlement_council.bump,
    )]
    pub settlement_council: Account<'info, SettlementCouncil>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [seeds::SETTLEMENT_PROPOSAL, market_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, SettlementProposal>,

    #[account(
        mut,
        seeds = [seeds::EPOCH, market.epoch_id.to_le_bytes().as_ref()],
        bump = epoch.bump,
    )]
    pub epoch: Account<'info, Epoch>,

    pub caller: Signer<'info>,
}

pub fn finalize_settlement_handler(
    ctx: Context<FinalizeSettlement>,
    market_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let council = &ctx.accounts.settlement_council;
    let market = &mut ctx.accounts.market;
    let proposal = &mut ctx.accounts.proposal;
    let epoch = &mut ctx.accounts.epoch;

    // Must be in proposed status
    require!(
        market.status == MarketStatus::Proposed,
        QuadraticMarketError::InvalidMarketStatus
    );

    // Must not be disputed
    require!(!proposal.disputed, QuadraticMarketError::ProposalDisputed);

    // Must have quorum (unless disputed, in which case admin resolves)
    if !proposal.disputed {
        require!(
            proposal.has_quorum(council.required_confirmations),
            QuadraticMarketError::QuorumNotReached
        );
    }

    // Must not already be finalized
    require!(!proposal.finalized, QuadraticMarketError::ProposalAlreadyFinalized);

    // Mark proposal as finalized
    proposal.finalized = true;

    // Set winning outcome on market
    market.winning_outcome = proposal.proposed_outcome;
    market.status = MarketStatus::Settled;

    // Release locked_payouts for losing outcomes
    let winning = proposal.proposed_outcome as usize;
    let losing_total: u64 = (0..market.num_outcomes as usize)
        .filter(|&i| i != winning)
        .map(|i| market.q_values[i])
        .fold(0u64, |acc, v| acc.saturating_add(v));
    config.locked_payouts = config.locked_payouts.saturating_sub(losing_total);

    // Update epoch settlement tracking
    if !market.settled_in_epoch {
        market.settled_in_epoch = true;
        epoch.num_settled_markets = epoch.num_settled_markets
            .checked_add(1)
            .ok_or(QuadraticMarketError::MathOverflow)?;

        // Enable withdrawals when all markets settled
        if epoch.num_markets > 0 && epoch.num_settled_markets >= epoch.num_markets {
            epoch.all_markets_settled = true;
            epoch.lp_shares_at_close = config.total_lp_supply;
            epoch.withdrawals_enabled = true;
        }
    }

    emit!(SettlementFinalized {
        market_id,
        winning_outcome: proposal.proposed_outcome,
        num_confirmations: proposal.num_confirmations,
    });

    Ok(())
}

// ─── Events ───────────────────────────────────────────────────────

#[event]
pub struct SettlementCouncilInitialized {
    pub authority: Pubkey,
    pub min_stake: u64,
    pub required_confirmations: u8,
}

#[event]
pub struct SettlementOperatorAdded {
    pub operator: Pubkey,
    pub stake: u64,
    pub total_operators: u8,
}

#[event]
pub struct SettlementOperatorRemoved {
    pub operator: Pubkey,
    pub remaining_operators: u8,
}

#[event]
pub struct SettlementProposed {
    pub market_id: u64,
    pub proposed_outcome: u8,
    pub proposer: Pubkey,
    pub tx_hash_ref: [u8; 32],
}

#[event]
pub struct SettlementConfirmed {
    pub market_id: u64,
    pub confirmer: Pubkey,
    pub operator_index: u8,
    pub total_confirmations: u8,
}

#[event]
pub struct SettlementQuorumReached {
    pub market_id: u64,
    pub num_confirmations: u8,
    pub required: u8,
}

#[event]
pub struct SettlementDisputed {
    pub market_id: u64,
    pub disputed_by: Pubkey,
    pub operator_index: u8,
    pub proposed_outcome: u8,
    pub alternative_outcome: u8,
}

#[event]
pub struct SettlementFinalized {
    pub market_id: u64,
    pub winning_outcome: u8,
    pub num_confirmations: u8,
}

#[event]
pub struct OperatorSlashed {
    pub operator: Pubkey,
    pub slashed_amount: u64,
    pub reason: String,
}

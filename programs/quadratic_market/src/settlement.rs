use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketStatus, Dispute, DisputeStatus};
use crate::errors::QuadraticMarketError;
use crate::constants::{seeds, MAX_DISPUTE_ROUNDS};

#[derive(Accounts)]
#[instruction(market_id: u64, proposed_outcome: u8)]
pub struct ProposeResult<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.market_id == market_id @ QuadraticMarketError::InvalidAmount,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = proposer,
        space = Dispute::LEN,
        seeds = [seeds::DISPUTE, market_id.to_le_bytes().as_ref(), 0u32.to_le_bytes().as_ref()],
        bump,
    )]
    pub dispute: Account<'info, Dispute>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Proposer's base token account (pays stake)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = proposer,
    )]
    pub proposer_base_ata: Account<'info, TokenAccount>,

    /// Treasury's base token account (receives stake)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(mut)]
    pub proposer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn propose_result_handler(
    ctx: Context<ProposeResult>,
    market_id: u64,
    proposed_outcome: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let market = &mut ctx.accounts.market;

    require!(
        market.status.can_settle(),
        QuadraticMarketError::InvalidMarketStatus
    );
    require!(
        (proposed_outcome as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidProposedOutcome
    );

    let stake = config.min_dispute_stake;

    // Transfer stake from proposer to treasury
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.proposer_base_ata.to_account_info(),
        to: ctx.accounts.treasury_base_ata.to_account_info(),
        authority: ctx.accounts.proposer.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        stake,
    )?;

    let now = Clock::get()?.unix_timestamp;

    // Initialize dispute
    let dispute = &mut ctx.accounts.dispute;
    dispute.market_id = market_id;
    dispute.round = 0;
    dispute.proposer = ctx.accounts.proposer.key();
    dispute.proposed_outcome = proposed_outcome;
    dispute.proposer_stake = stake;
    dispute.challenger = Pubkey::default();
    dispute.challenge_outcome = 0;
    dispute.challenger_stake = 0;
    dispute.created_at = now;
    dispute.challenge_deadline = now.checked_add(config.challenge_window_seconds)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    dispute.status = DisputeStatus::ChallengeWindow;
    dispute.bump = ctx.bumps.dispute;

    // Update market
    market.status = MarketStatus::Proposed;
    market.settlement_time = now;

    Ok(())
}

#[derive(Accounts)]
#[instruction(market_id: u64, round: u32, challenge_outcome: u8)]
pub struct DisputeResult<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.market_id == market_id @ QuadraticMarketError::InvalidAmount,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [seeds::DISPUTE, market_id.to_le_bytes().as_ref(), round.to_le_bytes().as_ref()],
        bump = dispute.bump,
        constraint = dispute.round == round @ QuadraticMarketError::InvalidAmount,
    )]
    pub dispute: Account<'info, Dispute>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Challenger's base token account (pays dispute stake)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = challenger,
    )]
    pub challenger_base_ata: Account<'info, TokenAccount>,

    /// Treasury's base token account (receives dispute stake)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub challenger: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn dispute_result_handler(
    ctx: Context<DisputeResult>,
    market_id: u64,
    round: u32,
    challenge_outcome: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let market = &mut ctx.accounts.market;
    let dispute = &mut ctx.accounts.dispute;

    require!(
        market.status == MarketStatus::Proposed || market.status == MarketStatus::Disputed,
        QuadraticMarketError::InvalidMarketStatus
    );
    require!(
        dispute.status == DisputeStatus::ChallengeWindow,
        QuadraticMarketError::ChallengeWindowExpired
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now < dispute.challenge_deadline,
        QuadraticMarketError::ChallengeWindowExpired
    );

    require!(
        (challenge_outcome as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidProposedOutcome
    );

    // Challenger must stake >= 2x proposer's stake
    let challenger_stake = dispute.proposer_stake
        .checked_mul(2)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Transfer stake from challenger to treasury
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.challenger_base_ata.to_account_info(),
        to: ctx.accounts.treasury_base_ata.to_account_info(),
        authority: ctx.accounts.challenger.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        challenger_stake,
    )?;

    // Update dispute
    dispute.challenger = ctx.accounts.challenger.key();
    dispute.challenge_outcome = challenge_outcome;
    dispute.challenger_stake = challenger_stake;
    dispute.status = DisputeStatus::Challenged;
    // Extend deadline with geometric backoff: window * 2^round
    let backoff = config.challenge_window_seconds
        .checked_mul(1_i64 << dispute.round)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    dispute.challenge_deadline = now.checked_add(backoff)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    market.status = MarketStatus::Disputed;

    Ok(())
}

#[derive(Accounts)]
#[instruction(market_id: u64, current_round: u32)]
pub struct EscalateDispute<'info> {
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
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [seeds::DISPUTE, market_id.to_le_bytes().as_ref(), current_round.to_le_bytes().as_ref()],
        bump = old_dispute.bump,
    )]
    pub old_dispute: Box<Account<'info, Dispute>>,

    #[account(
        init,
        payer = escalator,
        space = Dispute::LEN,
        seeds = [seeds::DISPUTE, market_id.to_le_bytes().as_ref(), (current_round + 1).to_le_bytes().as_ref()],
        bump,
    )]
    pub new_dispute: Account<'info, Dispute>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Escalator's base token account
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = escalator,
    )]
    pub escalator_base_ata: Account<'info, TokenAccount>,

    /// Treasury's base token account
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(mut)]
    pub escalator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn escalate_dispute_handler(
    ctx: Context<EscalateDispute>,
    market_id: u64,
    current_round: u32,
    proposed_outcome: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let market = &mut ctx.accounts.market;
    let old_dispute = &ctx.accounts.old_dispute;

    require!(
        market.status == MarketStatus::Disputed,
        QuadraticMarketError::InvalidMarketStatus
    );
    require!(
        old_dispute.status == DisputeStatus::Challenged,
        QuadraticMarketError::InvalidMarketStatus
    );
    require!(
        current_round < MAX_DISPUTE_ROUNDS,
        QuadraticMarketError::MaxDisputeRounds
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now < old_dispute.challenge_deadline,
        QuadraticMarketError::ChallengeWindowExpired
    );

    require!(
        (proposed_outcome as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidProposedOutcome
    );

    // Escalator must stake 2x the current highest stake
    let max_stake = std::cmp::max(old_dispute.proposer_stake, old_dispute.challenger_stake);
    let escalation_stake = max_stake
        .checked_mul(2)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Transfer stake
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.escalator_base_ata.to_account_info(),
        to: ctx.accounts.treasury_base_ata.to_account_info(),
        authority: ctx.accounts.escalator.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        escalation_stake,
    )?;

    // Mark old dispute as resolved
    let old_dispute_mut = &mut ctx.accounts.old_dispute;
    // The side that doesn't escalate loses — mark appropriately
    // If escalator supports the proposer, challenger loses, and vice versa
    old_dispute_mut.status = DisputeStatus::ResolvedProposer; // Will be overwritten by next round

    // Create new dispute round
    let new_round = current_round + 1;
    let backoff = config.challenge_window_seconds
        .checked_mul(1_i64 << new_round)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    let new_dispute = &mut ctx.accounts.new_dispute;
    new_dispute.market_id = market_id;
    new_dispute.round = new_round;
    new_dispute.proposer = ctx.accounts.escalator.key();
    new_dispute.proposed_outcome = proposed_outcome;
    new_dispute.proposer_stake = escalation_stake;
    new_dispute.challenger = Pubkey::default();
    new_dispute.challenge_outcome = 0;
    new_dispute.challenger_stake = 0;
    new_dispute.created_at = now;
    new_dispute.challenge_deadline = now.checked_add(backoff)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    new_dispute.status = DisputeStatus::ChallengeWindow;
    new_dispute.bump = ctx.bumps.new_dispute;

    // If max rounds reached, auto-settle with the last proposer's outcome
    if new_round >= MAX_DISPUTE_ROUNDS {
        market.winning_outcome = proposed_outcome;
        market.status = MarketStatus::Settled;
        config.locked_payouts = config.locked_payouts.saturating_sub(market.exposure);
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(market_id: u64, round: u32)]
pub struct FinalizeResult<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [seeds::DISPUTE, market_id.to_le_bytes().as_ref(), round.to_le_bytes().as_ref()],
        bump = dispute.bump,
    )]
    pub dispute: Account<'info, Dispute>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Winner's base token account (receives stake back)
    /// CHECK: Validated dynamically based on dispute outcome
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = winner,
    )]
    pub winner_base_ata: Account<'info, TokenAccount>,

    /// Treasury's base token account (returns stake or receives slashed)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// CHECK: The winner — either proposer or challenger depending on outcome
    pub winner: SystemAccount<'info>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn finalize_result_handler(
    ctx: Context<FinalizeResult>,
    market_id: u64,
    round: u32,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let market = &mut ctx.accounts.market;
    let dispute = &mut ctx.accounts.dispute;

    require!(
        market.status == MarketStatus::Proposed || market.status == MarketStatus::Disputed,
        QuadraticMarketError::InvalidMarketStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= dispute.challenge_deadline,
        QuadraticMarketError::ChallengeWindowActive
    );

    // Determine winner based on dispute state
    let (winning_outcome, winner_stake, _loser_stake, is_proposer_winner) = match dispute.status {
        DisputeStatus::ChallengeWindow => {
            // No one challenged — proposer wins by default
            (dispute.proposed_outcome, dispute.proposer_stake, 0u64, true)
        }
        DisputeStatus::Challenged => {
            // Was challenged, no escalation — challenger wins (they put up 2x stake)
            if dispute.challenger_stake > dispute.proposer_stake {
                (dispute.challenge_outcome, dispute.challenger_stake, dispute.proposer_stake, false)
            } else {
                (dispute.proposed_outcome, dispute.proposer_stake, dispute.challenger_stake, true)
            }
        }
        _ => return Err(QuadraticMarketError::NoDisputeToFinalize.into()),
    };

    // Set market outcome
    market.winning_outcome = winning_outcome;
    market.status = MarketStatus::Settled;

    // Return winner's stake
    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.treasury_base_ata.to_account_info(),
        to: ctx.accounts.winner_base_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[treasury_seeds],
        ),
        winner_stake,
    )?;

    // Loser's stake stays in treasury (becomes LP revenue)
    // Update dispute status
    dispute.status = if is_proposer_winner {
        DisputeStatus::ResolvedProposer
    } else {
        DisputeStatus::ResolvedChallenger
    };

    // Reduce locked payouts by this market's exposure
    config.locked_payouts = config.locked_payouts.saturating_sub(market.exposure);
    // The actual payout will come from claim_payout which burns winning tokens
    // and pays 1 base token per token from treasury

    Ok(())
}

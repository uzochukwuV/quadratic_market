use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketStatus, Dispute, DisputeStatus};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

// ─── Propose Result (oracle-only) ─────────────────────────────
// The oracle backend signs the Solana transaction.
// No bond, no public challengers. Admin can override within the challenge window.

#[derive(Accounts)]
#[instruction(market_id: u64, proposed_outcome: u8)]
pub struct ProposeResult<'info> {
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
        init,
        payer = oracle,
        space = Dispute::LEN,
        seeds = [seeds::DISPUTE, market_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub dispute: Account<'info, Dispute>,

    // Oracle must sign the transaction — this IS the signature verification.
    // The oracle keypair matches global_config.oracle_pubkey.
    #[account(
        mut,
        constraint = oracle.key() == global_config.oracle_pubkey() @ QuadraticMarketError::InvalidOracleSignature,
    )]
    pub oracle: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn propose_result_handler(
    ctx: Context<ProposeResult>,
    market_id: u64,
    proposed_outcome: u8,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let market = &mut ctx.accounts.market;

    require!(market.status.can_settle(), QuadraticMarketError::InvalidMarketStatus);
    require!(
        (proposed_outcome as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidProposedOutcome
    );

    // Match must have started before settlement is proposed
    let now = Clock::get()?.unix_timestamp;
    require!(now >= market.start_time, QuadraticMarketError::MarketAlreadyStarted);

    let dispute = &mut ctx.accounts.dispute;
    dispute.market_id = market_id;
    dispute.proposed_outcome = proposed_outcome;
    dispute.proposer = ctx.accounts.oracle.key();
    dispute.created_at = now;
    dispute.challenge_deadline = now
        .checked_add(config.challenge_window_seconds)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    dispute.status = DisputeStatus::Pending;
    dispute.bump = ctx.bumps.dispute;

    market.status = MarketStatus::Proposed;
    market.settlement_time = now;

    Ok(())
}

// ─── Admin Override ────────────────────────────────────────────
// Admin can correct the oracle result within the challenge window.

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct AdminOverride<'info> {
    #[account(
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
        seeds = [seeds::DISPUTE, market_id.to_le_bytes().as_ref()],
        bump = dispute.bump,
    )]
    pub dispute: Account<'info, Dispute>,

    pub admin: Signer<'info>,
}

pub fn admin_override_handler(
    ctx: Context<AdminOverride>,
    _market_id: u64,
    correct_outcome: u8,
) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.global_config.admin,
        QuadraticMarketError::Unauthorized
    );

    let dispute = &mut ctx.accounts.dispute;
    require!(
        dispute.status == DisputeStatus::Pending,
        QuadraticMarketError::ChallengeWindowExpired
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now < dispute.challenge_deadline, QuadraticMarketError::ChallengeWindowExpired);

    let market = &ctx.accounts.market;
    require!(
        (correct_outcome as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidProposedOutcome
    );

    dispute.proposed_outcome = correct_outcome;
    dispute.status = DisputeStatus::Overridden;

    Ok(())
}

// ─── Finalize Result ───────────────────────────────────────────
// Callable by anyone after the challenge window expires.
// Settles the market with whatever outcome is in the dispute record
// (either oracle's original or admin's override).

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct FinalizeResult<'info> {
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
        seeds = [seeds::DISPUTE, market_id.to_le_bytes().as_ref()],
        bump = dispute.bump,
    )]
    pub dispute: Account<'info, Dispute>,

    pub caller: Signer<'info>,
}

pub fn finalize_result_handler(
    ctx: Context<FinalizeResult>,
    _market_id: u64,
) -> Result<()> {
    let dispute = &mut ctx.accounts.dispute;
    let market = &mut ctx.accounts.market;
    let config = &mut ctx.accounts.global_config;

    require!(
        market.status == MarketStatus::Proposed,
        QuadraticMarketError::InvalidMarketStatus
    );
    require!(
        dispute.status == DisputeStatus::Pending || dispute.status == DisputeStatus::Overridden,
        QuadraticMarketError::NoDisputeToFinalize
    );

    let now = Clock::get()?.unix_timestamp;
    // If overridden by admin, allow immediate finalization.
    // Otherwise wait for the challenge window to expire.
    if dispute.status == DisputeStatus::Pending {
        require!(now >= dispute.challenge_deadline, QuadraticMarketError::ChallengeWindowActive);
    }

    let winning = dispute.proposed_outcome as usize;
    market.winning_outcome = dispute.proposed_outcome;
    market.status = MarketStatus::Settled;
    dispute.status = DisputeStatus::Settled;

    // Release locked_payouts for all LOSING outcomes — their shares will never be claimed.
    // winning outcome shares remain locked until claimed individually via claim_payout.
    // Using market.exposure here would be wrong: exposure = LP net-risk delta, not losing shares.
    let losing_total: u64 = (0..market.num_outcomes as usize)
        .filter(|&i| i != winning)
        .map(|i| market.q_values[i])
        .fold(0u64, |acc, v| acc.saturating_add(v));
    config.locked_payouts = config.locked_payouts.saturating_sub(losing_total);

    Ok(())
}

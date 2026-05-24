use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, Epoch};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

// ─── Init Epoch ────────────────────────────────────────────────
// Creates the on-chain Epoch account for `global_config.current_epoch`.
// Must be called by admin/operator before any markets can be created in
// the new epoch. Idempotent: if the account already exists the handler
// is a no-op (init_if_needed).

#[derive(Accounts)]
pub struct InitEpoch<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = Epoch::LEN,
        seeds = [seeds::EPOCH, global_config.current_epoch.to_le_bytes().as_ref()],
        bump,
    )]
    pub epoch: Account<'info, Epoch>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_epoch_handler(ctx: Context<InitEpoch>) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let epoch = &mut ctx.accounts.epoch;

    require!(
        config.is_authorized(&ctx.accounts.authority.key()),
        QuadraticMarketError::Unauthorized
    );

    // Only initialise if this is a fresh account (bump == 0 means just created)
    if epoch.bump == 0 {
        let now = Clock::get()?.unix_timestamp;
        let epoch_duration = config.epoch_duration_seconds;
        let epoch_start = if epoch_duration > 0 {
            (now / epoch_duration) * epoch_duration
        } else {
            now
        };

        epoch.epoch_id = config.current_epoch;
        epoch.start_time = epoch_start;
        epoch.end_time = if epoch_duration > 0 {
            epoch_start + epoch_duration
        } else {
            i64::MAX
        };
        epoch.total_liquidity_added = 0;
        epoch.total_liquidity_removed = 0;
        epoch.num_markets = 0;
        epoch.num_settled_markets = 0;
        epoch.all_markets_settled = false;
        epoch.withdrawals_enabled = false;
        epoch.lp_shares_at_close = 0;
        epoch.bump = ctx.bumps.epoch;

        if epoch_duration > 0 {
            config.next_epoch_start = epoch_start + epoch_duration;
        }
    }

    Ok(())
}

// ─── Advance Epoch ─────────────────────────────────────────────
// Moves global_config.current_epoch forward by one and unpauses the
// epoch gate. Called by admin after all markets in the previous epoch
// have settled and LPs have had time to withdraw.
// The caller must then call init_epoch to create the new epoch account.

#[derive(Accounts)]
pub struct AdvanceEpoch<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    /// Previous epoch — must be fully settled before we can advance.
    #[account(
        seeds = [seeds::EPOCH, global_config.current_epoch.to_le_bytes().as_ref()],
        bump = prev_epoch.bump,
    )]
    pub prev_epoch: Account<'info, Epoch>,

    pub admin: Signer<'info>,
}

pub fn advance_epoch_handler(ctx: Context<AdvanceEpoch>) -> Result<()> {
    let config = &mut ctx.accounts.global_config;

    require!(
        ctx.accounts.admin.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    let prev = &ctx.accounts.prev_epoch;
    require!(
        prev.num_markets == 0 || prev.all_markets_settled,
        QuadraticMarketError::EpochNotComplete
    );

    config.current_epoch = config.current_epoch
        .checked_add(1)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    config.epoch_paused = false;

    let now = Clock::get()?.unix_timestamp;
    if config.epoch_duration_seconds > 0 {
        let epoch_start = (now / config.epoch_duration_seconds) * config.epoch_duration_seconds;
        config.next_epoch_start = epoch_start + config.epoch_duration_seconds;
    }

    Ok(())
}

// ─── Pause Epoch ───────────────────────────────────────────────
// Admin-only. Blocks new deposits, withdrawals, and market creation.
// Used to freeze activity between epochs while markets settle.
// Existing bets are unaffected; users can still claim payouts.

#[derive(Accounts)]
pub struct PauseEpoch<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,
}

pub fn pause_epoch_handler(ctx: Context<PauseEpoch>) -> Result<()> {
    let config = &mut ctx.accounts.global_config;

    require!(
        ctx.accounts.admin.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    config.epoch_paused = true;

    Ok(())
}

// ─── Unpause Epoch ─────────────────────────────────────────────
// Admin-only. Re-enables deposits, withdrawals, and market creation.

#[derive(Accounts)]
pub struct UnpauseEpoch<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,
}

pub fn unpause_epoch_handler(ctx: Context<UnpauseEpoch>) -> Result<()> {
    let config = &mut ctx.accounts.global_config;

    require!(
        ctx.accounts.admin.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    config.epoch_paused = false;

    Ok(())
}

// ─── Close Epoch ───────────────────────────────────────────────
// Explicitly marks an epoch as closed and enables LP withdrawals.
// Normally withdrawals are auto-enabled when the last market settles
// (in finalize_result). This is a manual override for edge cases
// (e.g. all markets voided, epoch has zero markets).

#[derive(Accounts)]
pub struct CloseEpoch<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::EPOCH, epoch.epoch_id.to_le_bytes().as_ref()],
        bump = epoch.bump,
    )]
    pub epoch: Account<'info, Epoch>,

    pub authority: Signer<'info>,
}

pub fn close_epoch_handler(ctx: Context<CloseEpoch>) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let epoch = &mut ctx.accounts.epoch;

    require!(
        config.is_authorized(&ctx.accounts.authority.key()),
        QuadraticMarketError::Unauthorized
    );

    require!(
        epoch.num_markets == 0 || epoch.all_markets_settled,
        QuadraticMarketError::EpochNotComplete
    );

    epoch.lp_shares_at_close = config.total_lp_supply;
    epoch.withdrawals_enabled = true;

    Ok(())
}

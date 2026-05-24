use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::{GlobalConfig, Epoch, Market, MarketStatus};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

// ─── Epoch Management ──────────────────────────────────────────

/// Initialize or get the current epoch account
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
    let now = Clock::get()?.unix_timestamp;

    // Only admin or operators can initialize epochs
    require!(
        config.is_authorized(&ctx.accounts.authority.key()),
        QuadraticMarketError::Unauthorized
    );

    // Initialize epoch if it's new
    if epoch.epoch_id == 0 {
        let epoch_duration = config.epoch_duration_seconds;
        let epoch_start = (now / epoch_duration) * epoch_duration;
        
        epoch.epoch_id = config.current_epoch;
        epoch.start_time = epoch_start;
        epoch.end_time = epoch_start + epoch_duration;
        epoch.total_liquidity_added = 0;
        epoch.total_liquidity_removed = 0;
        epoch.num_markets = 0;
        epoch.num_settled_markets = 0;
        epoch.all_markets_settled = false;
        epoch.withdrawals_enabled = false;
        epoch.lp_shares_at_close = 0;
        epoch.bump = ctx.bumps.epoch;
    }

    Ok(())
}

/// Pause epoch - prevents new deposits/withdrawals for current epoch
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

/// Unpause epoch - allows deposits/withdrawals for next epoch
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
    let now = Clock::get()?.unix_timestamp;
    
    require!(
        ctx.accounts.admin.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    config.epoch_paused = false;
    
    // Advance to next epoch if we're past the current one
    if config.epoch_duration_seconds > 0 {
        let computed_epoch = (now / config.epoch_duration_seconds) as u64;
        if computed_epoch > config.current_epoch {
            config.current_epoch = computed_epoch;
            // Set next epoch start time
            config.next_epoch_start = (computed_epoch + 1) * config.epoch_duration_seconds;
        }
    }
    
    Ok(())
}

/// Close epoch - called when all markets in epoch are settled
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

    // Verify all markets are settled
    require!(
        epoch.all_markets_settled,
        QuadraticMarketError::EpochNotComplete
    );

    // Record LP supply at close for NAV calculations
    epoch.lp_shares_at_close = config.total_lp_supply;
    
    // Enable withdrawals for this epoch
    epoch.withdrawals_enabled = true;
    
    Ok(())
}

/// Helper: Get or create epoch for current time
pub fn get_or_create_epoch<'info>(
    config: &mut GlobalConfig,
    epoch_account: Option<&mut Account<'info, Epoch>>,
    now: i64,
) -> Result<u64> {
    if config.epoch_duration_seconds <= 0 {
        return Ok(0);
    }

    let computed_epoch = (now / config.epoch_duration_seconds) as u64;
    
    if computed_epoch > config.current_epoch {
        config.current_epoch = computed_epoch;
        config.next_epoch_start = (computed_epoch + 1) * config.epoch_duration_seconds;
    }

    Ok(config.current_epoch)
}

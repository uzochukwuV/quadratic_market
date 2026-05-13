use anchor_lang::prelude::*;
use crate::state::GlobalConfig;
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

pub fn transfer_admin_handler(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.global_config.admin,
        QuadraticMarketError::Unauthorized
    );
    ctx.accounts.global_config.admin = new_admin;
    Ok(())
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

pub fn pause_handler(ctx: Context<Pause>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.global_config.admin,
        QuadraticMarketError::Unauthorized
    );
    ctx.accounts.global_config.paused = true;
    Ok(())
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

pub fn unpause_handler(ctx: Context<Unpause>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.global_config.admin,
        QuadraticMarketError::Unauthorized
    );
    ctx.accounts.global_config.paused = false;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

pub fn update_config_handler(
    ctx: Context<UpdateConfig>,
    max_market_exposure: Option<u64>,
    challenge_window_seconds: Option<i64>,
    min_dispute_stake: Option<u64>,
    min_market_bond: Option<u64>,
    lmsr_default_b: Option<u64>,
) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.global_config.admin,
        QuadraticMarketError::Unauthorized
    );
    let config = &mut ctx.accounts.global_config;
    if let Some(v) = max_market_exposure { config.max_market_exposure = v; }
    if let Some(v) = challenge_window_seconds { config.challenge_window_seconds = v; }
    if let Some(v) = min_dispute_stake { config.min_dispute_stake = v; }
    if let Some(v) = min_market_bond { config.min_market_bond = v; }
    if let Some(v) = lmsr_default_b { config.lmsr_default_b = v; }
    Ok(())
}

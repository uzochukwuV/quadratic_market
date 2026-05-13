use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token};
use crate::constants::{seeds, DEFAULT_LMSR_B_FP, MIN_FIRST_LIQUIDITY, DEFAULT_SLIP_HOUSE_MARGIN_BPS, DEFAULT_MAX_SLIP_BONUS_BPS, DEFAULT_EPOCH_DURATION_SECONDS, DEFAULT_WITHDRAWAL_COOLDOWN_SECONDS};
use crate::state::GlobalConfig;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = GlobalConfig::LEN,
        seeds = [seeds::GLOBAL_CONFIG],
        bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = admin,
        seeds = [seeds::LP_MINT],
        bump,
        mint::decimals = 6,
        mint::authority = global_config,
    )]
    pub lp_mint: Account<'info, Mint>,

    /// CHECK: Treasury PDA — owns token accounts, no data needed
    #[account(
        seeds = [seeds::TREASURY],
        bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// The base token mint (e.g., USDC)
    /// CHECK: Validated by being a known mint
    pub base_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<Initialize>,
    oracle_pubkey: [u8; 32],
    max_market_exposure: u64,
    challenge_window_seconds: i64,
    min_dispute_stake: u64,
    min_market_bond: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;

    config.admin = ctx.accounts.admin.key();
    config.paused = false;
    config.oracle_pubkey = oracle_pubkey;
    config.max_market_exposure = max_market_exposure;
    config.locked_payouts = 0;
    config.total_lp_supply = 0;
    config.lp_mint = ctx.accounts.lp_mint.key();
    config.base_mint = ctx.accounts.base_mint.key();
    config.treasury = ctx.accounts.treasury.key();
    config.treasury_bump = ctx.bumps.treasury;
    config.next_market_id = 1;
    config.min_market_bond = min_market_bond;
    config.challenge_window_seconds = challenge_window_seconds;
    config.min_dispute_stake = min_dispute_stake;
    config.odds_basis = 10_000;
    config.lmsr_default_b = DEFAULT_LMSR_B_FP;
    config.min_first_liquidity = MIN_FIRST_LIQUIDITY;
    config.slip_house_margin_bps = DEFAULT_SLIP_HOUSE_MARGIN_BPS;
    config.max_slip_bonus_multiplier_bps = DEFAULT_MAX_SLIP_BONUS_BPS;
    config.next_slip_id = 1;
    config.current_epoch = 0;
    config.epoch_duration_seconds = DEFAULT_EPOCH_DURATION_SECONDS;
    config.withdrawal_cooldown_seconds = DEFAULT_WITHDRAWAL_COOLDOWN_SECONDS;
    config.bump = ctx.bumps.global_config;

    Ok(())
}

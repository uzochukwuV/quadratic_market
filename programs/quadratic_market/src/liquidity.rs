use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, WithdrawalRequest};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        constraint = lp_mint.key() == global_config.lp_mint @ QuadraticMarketError::Unauthorized,
    )]
    pub lp_mint: Account<'info, Mint>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Treasury's base token account (receives the deposit)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// LP's base token account (source of deposit)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = provider,
    )]
    pub provider_base_ata: Account<'info, TokenAccount>,

    /// LP's LP token account (receives LP shares)
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = provider,
    )]
    pub provider_lp_ata: Account<'info, TokenAccount>,

    /// The base token mint
    /// CHECK: Validated by constraint against GlobalConfig
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub provider: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn add_liquidity_handler(ctx: Context<AddLiquidity>, amount: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);
    require!(amount > 0, QuadraticMarketError::InvalidAmount);

    let reserve_balance = ctx.accounts.treasury_base_ata.amount;
    let total_supply = config.total_lp_supply;

    let shares_to_mint = if total_supply == 0 || reserve_balance == 0 {
        // ERC4626 First-Depositor Inflation Fix
        // Lock min_first_liquidity shares permanently (no one owns them)
        require!(
            amount > config.min_first_liquidity,
            QuadraticMarketError::AmountTooSmall
        );
        // The first deposit gets (amount - min_liquidity) shares
        // min_liquidity shares are "dead" (minted but held by the mint itself or burned)
        // We track total_supply including the dead shares
        config.total_lp_supply = config.min_first_liquidity;
        amount - config.min_first_liquidity
    } else {
        // shares = amount * total_supply / reserve_balance
        let shares = ((amount as u128)
            .checked_mul(total_supply as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?)
            .checked_div(reserve_balance as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        shares as u64
    };

    require!(shares_to_mint > 0, QuadraticMarketError::InvalidAmount);

    // Transfer base tokens from provider to treasury
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.provider_base_ata.to_account_info(),
        to: ctx.accounts.treasury_base_ata.to_account_info(),
        authority: ctx.accounts.provider.to_account_info(),
    };
    token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), amount)?;

    // Mint LP tokens to provider
    let cpi_accounts = token::MintTo {
        mint: ctx.accounts.lp_mint.to_account_info(),
        to: ctx.accounts.provider_lp_ata.to_account_info(),
        authority: config.to_account_info(),
    };
    let seeds = &[seeds::GLOBAL_CONFIG, &[config.bump]];
    token::mint_to(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        &[seeds],
    ), shares_to_mint)?;

    config.total_lp_supply = config.total_lp_supply
        .checked_add(shares_to_mint)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        constraint = lp_mint.key() == global_config.lp_mint @ QuadraticMarketError::Unauthorized,
    )]
    pub lp_mint: Account<'info, Mint>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Treasury's LP token escrow account
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_lp_ata: Account<'info, TokenAccount>,

    /// LP's LP token account (source of shares)
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = lp,
    )]
    pub lp_lp_ata: Account<'info, TokenAccount>,

    /// LP's withdrawal request PDA
    #[account(
        init,
        payer = lp,
        space = WithdrawalRequest::LEN,
        seeds = [seeds::WITHDRAWAL, lp.key().as_ref()],
        bump,
    )]
    pub withdrawal_request: Account<'info, WithdrawalRequest>,

    #[account(mut)]
    pub lp: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn request_withdraw_handler(ctx: Context<RequestWithdraw>, shares: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);
    require!(shares > 0, QuadraticMarketError::InvalidAmount);
    require!(
        ctx.accounts.lp_lp_ata.amount >= shares,
        QuadraticMarketError::InsufficientLpShares
    );

    // Transfer LP tokens to treasury escrow (held until processed)
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.lp_lp_ata.to_account_info(),
        to: ctx.accounts.treasury_lp_ata.to_account_info(),
        authority: ctx.accounts.lp.to_account_info(),
    };
    token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), shares)?;

    // Record the withdrawal request
    let req = &mut ctx.accounts.withdrawal_request;
    req.lp = ctx.accounts.lp.key();
    req.shares = shares;
    req.requested_at = Clock::get()?.unix_timestamp;
    req.bump = ctx.bumps.withdrawal_request;

    Ok(())
}

#[derive(Accounts)]
pub struct ProcessWithdrawal<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        constraint = lp_mint.key() == global_config.lp_mint @ QuadraticMarketError::Unauthorized,
    )]
    pub lp_mint: Account<'info, Mint>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Treasury's base token account
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// Treasury's LP token escrow account
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_lp_ata: Account<'info, TokenAccount>,

    /// LP's base token account (receives withdrawal)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = withdrawal_request.lp,
    )]
    pub lp_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [seeds::WITHDRAWAL, withdrawal_request.lp.as_ref()],
        bump = withdrawal_request.bump,
    )]
    pub withdrawal_request: Account<'info, WithdrawalRequest>,

    /// Admin or bot processes withdrawals
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn process_withdrawal_handler(ctx: Context<ProcessWithdrawal>) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let req = &ctx.accounts.withdrawal_request;

    let total_reserve = ctx.accounts.treasury_base_ata.amount;
    let free_liquidity = config.free_liquidity(total_reserve);

    // Calculate amount to return: shares * free_liquidity / total_supply
    let amount_to_return = ((req.shares as u128)
        .checked_mul(free_liquidity as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?)
        .checked_div(config.total_lp_supply as u128)
        .ok_or(QuadraticMarketError::MathOverflow)? as u64;

    require!(
        amount_to_return > 0,
        QuadraticMarketError::InsufficientFreeLiquidity
    );
    require!(
        free_liquidity >= amount_to_return,
        QuadraticMarketError::InsufficientFreeLiquidity
    );

    // Reduce total supply
    config.total_lp_supply = config.total_lp_supply
        .checked_sub(req.shares)
        .ok_or(QuadraticMarketError::MathUnderflow)?;

    // Transfer base tokens from treasury to LP
    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.treasury_base_ata.to_account_info(),
        to: ctx.accounts.lp_base_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[treasury_seeds],
        ),
        amount_to_return,
    )?;

    // Burn the escrowed LP tokens
    let cpi_accounts = token::Burn {
        mint: ctx.accounts.lp_mint.to_account_info(),
        from: ctx.accounts.treasury_lp_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[treasury_seeds],
        ),
        req.shares,
    )?;

    // Close the withdrawal request account (return rent)
    let req_account = ctx.accounts.withdrawal_request.to_account_info();
    let sol_lamports = req_account.lamports();
    **req_account.try_borrow_mut_lamports()? = 0;
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += sol_lamports;

    Ok(())
}

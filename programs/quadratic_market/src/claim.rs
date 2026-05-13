use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketStatus};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ClaimPayout<'info> {
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

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Claimer's outcome token account (winning tokens burned)
    #[account(
        mut,
        associated_token::mint = outcome_mint,
        associated_token::authority = claimer,
    )]
    pub claimer_outcome_ata: Account<'info, TokenAccount>,

    /// Claimer's base token account (receives payout)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = claimer,
    )]
    pub claimer_base_ata: Account<'info, TokenAccount>,

    /// Treasury's base token account (pays out)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// The winning outcome token mint
    #[account(
        constraint = outcome_mint.key() == market.outcome_mints[market.winning_outcome as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn claim_payout_handler(ctx: Context<ClaimPayout>, _market_id: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let market = &ctx.accounts.market;

    require!(
        market.status == MarketStatus::Settled,
        QuadraticMarketError::MarketNotSettled
    );

    let amount = ctx.accounts.claimer_outcome_ata.amount;
    require!(amount > 0, QuadraticMarketError::NoWinningPositions);

    // Burn the winning outcome tokens
    let cpi_accounts = token::Burn {
        mint: ctx.accounts.outcome_mint.to_account_info(),
        from: ctx.accounts.claimer_outcome_ata.to_account_info(),
        authority: ctx.accounts.claimer.to_account_info(),
    };
    token::burn(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount,
    )?;

    // Transfer 1 base token per outcome token from treasury to claimer
    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.treasury_base_ata.to_account_info(),
        to: ctx.accounts.claimer_base_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[treasury_seeds],
        ),
        amount,
    )?;

    // Release the locked payout liability
    config.locked_payouts = config.locked_payouts.saturating_sub(amount);

    Ok(())
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ClaimMarketBond<'info> {
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

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Creator's base token account (receives bond)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = market.creator,
    )]
    pub creator_base_ata: Account<'info, TokenAccount>,

    /// Treasury's base token account (returns bond)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn claim_market_bond_handler(ctx: Context<ClaimMarketBond>, _market_id: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(
        market.status == MarketStatus::Settled,
        QuadraticMarketError::MarketNotSettled
    );
    require!(
        !market.bond_claimed,
        QuadraticMarketError::BondAlreadyClaimed
    );
    require!(
        ctx.accounts.creator.key() == market.creator,
        QuadraticMarketError::Unauthorized
    );

    // Transfer bond from treasury back to creator
    let config = &ctx.accounts.global_config;
    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.treasury_base_ata.to_account_info(),
        to: ctx.accounts.creator_base_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[treasury_seeds],
        ),
        market.bond_amount,
    )?;

    market.bond_claimed = true;

    Ok(())
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CloseMarket<'info> {
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
        constraint = market.status == MarketStatus::Settled || market.status == MarketStatus::Voided @ QuadraticMarketError::InvalidMarketStatus,
        constraint = market.bond_claimed @ QuadraticMarketError::BondAlreadyClaimed,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn close_market_handler(ctx: Context<CloseMarket>, _market_id: u64) -> Result<()> {
    // Only creator or admin can close
    require!(
        ctx.accounts.authority.key() == ctx.accounts.market.creator
            || ctx.accounts.authority.key() == ctx.accounts.global_config.admin,
        QuadraticMarketError::Unauthorized
    );

    // Return rent to the authority
    let market_account = ctx.accounts.market.to_account_info();
    let lamports = market_account.lamports();
    **market_account.try_borrow_mut_lamports()? = 0;
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += lamports;

    Ok(())
}

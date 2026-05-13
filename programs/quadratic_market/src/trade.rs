use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketStatus};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;
use crate::math::lmsr::{lmsr_buy_cost, lmsr_sell_payout};

#[derive(Accounts)]
#[instruction(outcome_id: u8, max_payment: u64)]
pub struct BuyShares<'info> {
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

    /// Buyer's base token account
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_base_ata: Account<'info, TokenAccount>,

    /// Treasury's base token account (receives payment)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// Buyer's outcome token account (receives shares)
    #[account(
        mut,
        associated_token::mint = outcome_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_outcome_ata: Account<'info, TokenAccount>,

    /// The outcome token mint
    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn buy_shares_handler(
    ctx: Context<BuyShares>,
    outcome_id: u8,
    num_shares: u64,
    max_payment: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);

    let market = &mut ctx.accounts.market;
    require!(market.status.is_tradable(), QuadraticMarketError::MarketNotOpen);
    require!(
        (outcome_id as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidOutcomeId
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now < market.start_time, QuadraticMarketError::MarketExpired);

    // Compute LMSR buy cost
    let cost = lmsr_buy_cost(
        &market.q_values,
        market.num_outcomes,
        outcome_id,
        num_shares,
        market.lmsr_b,
    )?;

    // Slippage check
    require!(
        cost <= max_payment,
        QuadraticMarketError::LmsrCostExceedsMax
    );

    // Exposure check
    let profit_exposure = cost.saturating_sub(num_shares); // worst case LP loss
    let new_exposure = market.exposure
        .checked_add(profit_exposure)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    require!(
        new_exposure <= config.max_market_exposure,
        QuadraticMarketError::MaxExposureReached
    );

    // Liquidity check: treasury must have enough to cover potential payout
    let free_liquidity = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
    require!(
        free_liquidity >= cost,
        QuadraticMarketError::InsufficientLiquidity
    );

    // Transfer base tokens from buyer to treasury
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.buyer_base_ata.to_account_info(),
        to: ctx.accounts.treasury_base_ata.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        cost,
    )?;

    // Mint outcome tokens to buyer
    let market_id_bytes = market.market_id.to_le_bytes();
    let market_seeds = &[
        seeds::MARKET,
        market_id_bytes.as_ref(),
        &[market.bump],
    ];
    let cpi_accounts = token::MintTo {
        mint: ctx.accounts.outcome_mint.to_account_info(),
        to: ctx.accounts.buyer_outcome_ata.to_account_info(),
        authority: market.to_account_info(),
    };
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[market_seeds],
        ),
        num_shares,
    )?;

    // Update state
    market.q_values[outcome_id as usize] = market.q_values[outcome_id as usize]
        .checked_add(num_shares)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    market.exposure = new_exposure;
    config.locked_payouts = config.locked_payouts
        .checked_add(cost)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(outcome_id: u8, min_payout: u64)]
pub struct SellShares<'info> {
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

    /// Seller's outcome token account (burns shares)
    #[account(
        mut,
        associated_token::mint = outcome_mint,
        associated_token::authority = seller,
    )]
    pub seller_outcome_ata: Account<'info, TokenAccount>,

    /// Seller's base token account (receives payout)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = seller,
    )]
    pub seller_base_ata: Account<'info, TokenAccount>,

    /// Treasury's base token account (pays out)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// The outcome token mint
    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub seller: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn sell_shares_handler(
    ctx: Context<SellShares>,
    outcome_id: u8,
    num_shares: u64,
    min_payout: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);

    let market = &mut ctx.accounts.market;
    require!(market.status.is_tradable(), QuadraticMarketError::MarketNotOpen);
    require!(
        (outcome_id as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidOutcomeId
    );
    require!(
        ctx.accounts.seller_outcome_ata.amount >= num_shares,
        QuadraticMarketError::InsufficientShares
    );

    // Compute LMSR sell payout
    let payout = lmsr_sell_payout(
        &market.q_values,
        market.num_outcomes,
        outcome_id,
        num_shares,
        market.lmsr_b,
    )?;

    // Slippage check
    require!(
        payout >= min_payout,
        QuadraticMarketError::LmsrSellBelowMin
    );

    // Liquidity check
    let free_liquidity = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
    require!(
        free_liquidity >= payout,
        QuadraticMarketError::InsufficientLiquidity
    );

    // Burn outcome tokens from seller
    let cpi_accounts = token::Burn {
        mint: ctx.accounts.outcome_mint.to_account_info(),
        from: ctx.accounts.seller_outcome_ata.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    token::burn(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        num_shares,
    )?;

    // Transfer base tokens from treasury to seller
    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.treasury_base_ata.to_account_info(),
        to: ctx.accounts.seller_base_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[treasury_seeds],
        ),
        payout,
    )?;

    // Update state
    market.q_values[outcome_id as usize] = market.q_values[outcome_id as usize]
        .checked_sub(num_shares)
        .ok_or(QuadraticMarketError::MathUnderflow)?;
    market.exposure = market.exposure.saturating_sub(payout);
    config.locked_payouts = config.locked_payouts.saturating_sub(payout);

    Ok(())
}

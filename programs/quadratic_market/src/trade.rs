use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketStatus};
use crate::state::market_group::MarketGroup;
use crate::errors::QuadraticMarketError;
use crate::constants::{seeds, SCALE, MAX_OUTCOMES, MAX_GROUP_MARKETS};
use crate::math::lmsr::{lmsr_buy_cost, lmsr_sell_payout, lmsr_price};
use crate::math::correlation::compute_adjusted_q_values;

// ─── helpers ───────────────────────────────────────────────────

/// Check that the current LMSR price for `outcome_id` is above the minimum
/// probability floor configured on GlobalConfig.
fn check_price_floor(
    q_values: &[u64; MAX_OUTCOMES],
    num_outcomes: u8,
    outcome_id: u8,
    b_fp: u64,
    min_price_bps: u64,
) -> Result<()> {
    if min_price_bps == 0 {
        return Ok(());
    }
    let price = lmsr_price(q_values, num_outcomes, outcome_id, b_fp)?;
    // price is Q32.32; min_price_bps is in basis points (100 bps = 1%)
    let min_price_fp = (min_price_bps * SCALE) / 10_000;
    require!(price >= min_price_fp, QuadraticMarketError::OddsFloor);
    Ok(())
}

// ─── Buy Shares ────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(outcome_id: u8, max_payment: u64)]
pub struct BuyShares<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(mut, seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = buyer)]
    pub buyer_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = outcome_mint, associated_token::authority = buyer)]
    pub buyer_outcome_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

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

    // Betting closes when match starts
    let now = Clock::get()?.unix_timestamp;
    require!(now < market.start_time, QuadraticMarketError::MarketExpired);

    // Max single-bet guard
    require!(num_shares <= config.max_single_bet, QuadraticMarketError::BetTooLarge);

    // Price floor — block near-certain outcomes
    check_price_floor(
        &market.q_values,
        market.num_outcomes,
        outcome_id,
        market.lmsr_b,
        config.min_outcome_price_bps,
    )?;

    let cost = lmsr_buy_cost(
        &market.q_values, market.num_outcomes, outcome_id, num_shares, market.lmsr_b,
    )?;

    // Apply buy fee (goes to treasury / LP revenue)
    let fee = cost
        .checked_mul(config.buy_fee_bps)
        .ok_or(QuadraticMarketError::MathOverflow)?
        / 10_000;
    let total_charge = cost.checked_add(fee).ok_or(QuadraticMarketError::MathOverflow)?;

    require!(total_charge <= max_payment, QuadraticMarketError::LmsrCostExceedsMax);

    let profit_exposure = num_shares.saturating_sub(cost);
    let new_exposure = market.exposure
        .checked_add(profit_exposure)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    require!(new_exposure <= config.max_market_exposure, QuadraticMarketError::MaxExposureReached);

    let free_liquidity = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
    require!(free_liquidity >= num_shares, QuadraticMarketError::InsufficientLiquidity);

    // Transfer total_charge (cost + fee) from buyer to treasury
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.buyer_base_ata.to_account_info(),
                to: ctx.accounts.treasury_base_ata.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        total_charge,
    )?;

    // Mint outcome tokens to buyer
    let market_id_bytes = market.market_id.to_le_bytes();
    let market_seeds = &[seeds::MARKET, market_id_bytes.as_ref(), &[market.bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                to: ctx.accounts.buyer_outcome_ata.to_account_info(),
                authority: market.to_account_info(),
            },
            &[market_seeds],
        ),
        num_shares,
    )?;

    market.q_values[outcome_id as usize] = market.q_values[outcome_id as usize]
        .checked_add(num_shares)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    market.exposure = new_exposure;
    // Lock the full potential payout (num_shares = 1:1 at settlement)
    config.locked_payouts = config.locked_payouts
        .checked_add(num_shares)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    Ok(())
}

// ─── Sell Shares ───────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(outcome_id: u8, min_payout: u64)]
pub struct SellShares<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(mut, seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = outcome_mint, associated_token::authority = seller)]
    pub seller_outcome_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = seller)]
    pub seller_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

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

    // Betting (and selling) closes when match starts
    let now = Clock::get()?.unix_timestamp;
    require!(now < market.start_time, QuadraticMarketError::MarketExpired);

    let payout = lmsr_sell_payout(
        &market.q_values, market.num_outcomes, outcome_id, num_shares, market.lmsr_b,
    )?;

    require!(payout >= min_payout, QuadraticMarketError::LmsrSellBelowMin);

    let free_liquidity = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
    require!(free_liquidity >= payout, QuadraticMarketError::InsufficientLiquidity);

    // Burn outcome tokens
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Burn {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                from: ctx.accounts.seller_outcome_ata.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        num_shares,
    )?;

    // Transfer payout from treasury
    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.treasury_base_ata.to_account_info(),
                to: ctx.accounts.seller_base_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            &[treasury_seeds],
        ),
        payout,
    )?;

    market.q_values[outcome_id as usize] = market.q_values[outcome_id as usize]
        .checked_sub(num_shares)
        .ok_or(QuadraticMarketError::MathUnderflow)?;
    let profit_exposure_reduction = num_shares.saturating_sub(payout);
    market.exposure = market.exposure.saturating_sub(profit_exposure_reduction);
    config.locked_payouts = config.locked_payouts.saturating_sub(num_shares);

    Ok(())
}

// ─── Correlated Trading ─────────────────────────────────────────

#[derive(Accounts)]
#[instruction(outcome_id: u8, num_shares: u64, max_payment: u64)]
pub struct BuySharesCorrelated<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.group_id.is_some() == market_group.is_some() @ QuadraticMarketError::MarketGroupNotFound,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = buyer)]
    pub buyer_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = outcome_mint, associated_token::authority = buyer)]
    pub buyer_outcome_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, market.group_id.unwrap_or_default().to_le_bytes().as_ref()],
        bump = market_group.bump,
        constraint = market_group.group_id == market.group_id.unwrap_or_default() @ QuadraticMarketError::MarketGroupNotFound,
    )]
    pub market_group: Option<Box<Account<'info, MarketGroup>>>,

    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn buy_shares_correlated_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, BuySharesCorrelated<'info>>,
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

    require!(num_shares <= config.max_single_bet, QuadraticMarketError::BetTooLarge);

    let cost = if let Some(ref mut group) = ctx.accounts.market_group {
        if !group.correlation_locked { group.correlation_locked = true; }

        let correlated_q = assemble_correlated_q_values(
            &ctx.remaining_accounts, &group.market_ids, group.num_markets, market.market_id,
        )?;
        let adjusted_q = compute_adjusted_q_values(
            &market.q_values, market.num_outcomes, market.group_market_index,
            &correlated_q, &group.correlations, group.num_correlations,
        )?;

        check_price_floor(&adjusted_q, market.num_outcomes, outcome_id, market.lmsr_b, config.min_outcome_price_bps)?;

        lmsr_buy_cost(&adjusted_q, market.num_outcomes, outcome_id, num_shares, market.lmsr_b)?
    } else {
        check_price_floor(&market.q_values, market.num_outcomes, outcome_id, market.lmsr_b, config.min_outcome_price_bps)?;
        lmsr_buy_cost(&market.q_values, market.num_outcomes, outcome_id, num_shares, market.lmsr_b)?
    };

    let fee = cost.checked_mul(config.buy_fee_bps).ok_or(QuadraticMarketError::MathOverflow)? / 10_000;
    let total_charge = cost.checked_add(fee).ok_or(QuadraticMarketError::MathOverflow)?;
    require!(total_charge <= max_payment, QuadraticMarketError::LmsrCostExceedsMax);

    let profit_exposure = num_shares.saturating_sub(cost);

    if let Some(ref mut group) = ctx.accounts.market_group {
        let new_group_exposure = group.total_group_exposure
            .checked_add(profit_exposure)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(new_group_exposure <= group.max_group_exposure, QuadraticMarketError::GroupExposureExceeded);
        group.total_group_exposure = new_group_exposure;
    } else {
        let new_exposure = market.exposure
            .checked_add(profit_exposure)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(new_exposure <= config.max_market_exposure, QuadraticMarketError::MaxExposureReached);
        market.exposure = new_exposure;
    }

    let free_liquidity = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
    require!(free_liquidity >= num_shares, QuadraticMarketError::InsufficientLiquidity);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.buyer_base_ata.to_account_info(),
                to: ctx.accounts.treasury_base_ata.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        total_charge,
    )?;

    let market_id_bytes = market.market_id.to_le_bytes();
    let market_seeds = &[seeds::MARKET, market_id_bytes.as_ref(), &[market.bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                to: ctx.accounts.buyer_outcome_ata.to_account_info(),
                authority: market.to_account_info(),
            },
            &[market_seeds],
        ),
        num_shares,
    )?;

    market.q_values[outcome_id as usize] = market.q_values[outcome_id as usize]
        .checked_add(num_shares)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    config.locked_payouts = config.locked_payouts
        .checked_add(num_shares)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    Ok(())
}

// ─── Sell Shares Correlated ────────────────────────────────────

#[derive(Accounts)]
#[instruction(outcome_id: u8, num_shares: u64, min_payout: u64)]
pub struct SellSharesCorrelated<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    // Seeds constraint added — prevents spoofed market accounts
    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.group_id.is_some() == market_group.is_some() @ QuadraticMarketError::MarketGroupNotFound,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = outcome_mint, associated_token::authority = seller)]
    pub seller_outcome_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = seller)]
    pub seller_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, market.group_id.unwrap_or_default().to_le_bytes().as_ref()],
        bump = market_group.bump,
        constraint = market_group.group_id == market.group_id.unwrap_or_default() @ QuadraticMarketError::MarketGroupNotFound,
    )]
    pub market_group: Option<Box<Account<'info, MarketGroup>>>,

    pub seller: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn sell_shares_correlated_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SellSharesCorrelated<'info>>,
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

    let now = Clock::get()?.unix_timestamp;
    require!(now < market.start_time, QuadraticMarketError::MarketExpired);

    let payout = if let Some(ref mut group) = ctx.accounts.market_group {
        if !group.correlation_locked { group.correlation_locked = true; }

        let correlated_q = assemble_correlated_q_values(
            &ctx.remaining_accounts, &group.market_ids, group.num_markets, market.market_id,
        )?;
        let adjusted_q = compute_adjusted_q_values(
            &market.q_values, market.num_outcomes, market.group_market_index,
            &correlated_q, &group.correlations, group.num_correlations,
        )?;
        lmsr_sell_payout(&adjusted_q, market.num_outcomes, outcome_id, num_shares, market.lmsr_b)?
    } else {
        lmsr_sell_payout(&market.q_values, market.num_outcomes, outcome_id, num_shares, market.lmsr_b)?
    };

    require!(payout >= min_payout, QuadraticMarketError::LmsrSellBelowMin);

    let free_liquidity = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
    require!(free_liquidity >= payout, QuadraticMarketError::InsufficientLiquidity);

    let profit_exposure_reduction = num_shares.saturating_sub(payout);
    if let Some(ref mut group) = ctx.accounts.market_group {
        group.total_group_exposure = group.total_group_exposure.saturating_sub(profit_exposure_reduction);
    } else {
        market.exposure = market.exposure.saturating_sub(profit_exposure_reduction);
    }

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Burn {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                from: ctx.accounts.seller_outcome_ata.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        num_shares,
    )?;

    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.treasury_base_ata.to_account_info(),
                to: ctx.accounts.seller_base_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            &[treasury_seeds],
        ),
        payout,
    )?;

    market.q_values[outcome_id as usize] = market.q_values[outcome_id as usize]
        .checked_sub(num_shares)
        .ok_or(QuadraticMarketError::MathUnderflow)?;
    config.locked_payouts = config.locked_payouts.saturating_sub(num_shares);

    Ok(())
}

// ─── assemble_correlated_q_values ──────────────────────────────

fn assemble_correlated_q_values(
    remaining_accounts: &[AccountInfo],
    market_ids: &[u64; MAX_GROUP_MARKETS],
    num_markets: u8,
    current_market_id: u64,
) -> Result<[[u64; MAX_OUTCOMES]; MAX_GROUP_MARKETS]> {
    let mut correlated_q = [[0u64; MAX_OUTCOMES]; MAX_GROUP_MARKETS];

    let mut account_idx: usize = 0;
    let mut market_idx: u8 = 0;
    while market_idx < num_markets {
        let mid = market_ids[market_idx as usize];

        // Skip uninitialized slots and the current market itself
        if mid == 0 || mid == current_market_id {
            market_idx += 1;
            continue;
        }

        require!(
            account_idx < remaining_accounts.len(),
            QuadraticMarketError::InvalidRemainingAccount
        );

        let account = &remaining_accounts[account_idx];
        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, mid.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(account.key() == expected_pda, QuadraticMarketError::InvalidRemainingAccount);

        // Use try_deserialize_unchecked: data starts with discriminator at [0..8],
        // fields start at [8..]. We skip the discriminator ourselves.
        let market_data = account.data.borrow();
        let market: Market = Market::try_deserialize_unchecked(&mut &market_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(market_data);

        for i in 0..MAX_OUTCOMES {
            correlated_q[market_idx as usize][i] = market.q_values[i];
        }

        account_idx += 1;
        market_idx += 1;
    }

    Ok(correlated_q)
}

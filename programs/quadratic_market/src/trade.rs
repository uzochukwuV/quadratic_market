use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketStatus};
use crate::state::market_group::MarketGroup;
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;
use crate::math::lmsr::{lmsr_buy_cost, lmsr_sell_payout, lmsr_price};
use crate::math::correlation::compute_adjusted_q_values;
use crate::constants::{MAX_OUTCOMES, MAX_GROUP_MARKETS};

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

// ─── Correlated Trading ─────────────────────────────────────────

#[derive(Accounts)]
#[instruction(outcome_id: u8, num_shares: u64, max_payment: u64)]
pub struct BuySharesCorrelated<'info> {
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
        constraint = market.group_id.is_some() == market_group.is_some() @ QuadraticMarketError::MarketGroupNotFound,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = outcome_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_outcome_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    // Optional: present when market is in a group
    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, market.group_id.unwrap().to_le_bytes().as_ref()],
        bump = market_group.bump,
        constraint = market_group.group_id == market.group_id.unwrap() @ QuadraticMarketError::MarketGroupNotFound,
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

    // Compute cost using correlation-adjusted q_values if grouped
    let cost = if let Some(ref mut group) = ctx.accounts.market_group {
        // Lock correlation matrix on first trade
        if !group.correlation_locked {
            group.correlation_locked = true;
        }

        // Build correlated market q_values from remaining_accounts
        let correlated_q = assemble_correlated_q_values(
            &ctx.remaining_accounts,
            &group.market_ids,
            group.num_markets,
            market.market_id,
        )?;

        let market_index = market.group_market_index;
        let adjusted_q = compute_adjusted_q_values(
            &market.q_values,
            market.num_outcomes,
            market_index,
            &correlated_q,
            &group.correlations,
            group.num_correlations,
        )?;

        lmsr_buy_cost(
            &adjusted_q,
            market.num_outcomes,
            outcome_id,
            num_shares,
            market.lmsr_b,
        )?
    } else {
        lmsr_buy_cost(
            &market.q_values,
            market.num_outcomes,
            outcome_id,
            num_shares,
            market.lmsr_b,
        )?
    };

    require!(
        cost <= max_payment,
        QuadraticMarketError::LmsrCostExceedsMax
    );

    let profit_exposure = cost.saturating_sub(num_shares);

    // Exposure check: group-level for grouped markets, market-level for standalone
    if let Some(ref mut group) = ctx.accounts.market_group {
        let new_group_exposure = group.total_group_exposure
            .checked_add(profit_exposure)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(
            new_group_exposure <= group.max_group_exposure,
            QuadraticMarketError::GroupExposureExceeded
        );
        group.total_group_exposure = new_group_exposure;
        // Do NOT update market.exposure for grouped markets
    } else {
        let new_exposure = market.exposure
            .checked_add(profit_exposure)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(
            new_exposure <= config.max_market_exposure,
            QuadraticMarketError::MaxExposureReached
        );
        market.exposure = new_exposure;
    }

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
    config.locked_payouts = config.locked_payouts
        .checked_add(cost)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    Ok(())
}

/// Assemble correlated market q_values from remaining_accounts.
/// Expects remaining_accounts to contain Market accounts for each market in the group
/// (excluding the current market), in order of market_index.
/// Verifies each account's PDA to prevent spoofing.
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
        if mid == current_market_id {
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
        require!(
            account.key() == expected_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // Deserialize the Market account to read q_values
        let market_data = account.data.borrow();
        // Skip 8-byte discriminator, then read q_values at the correct offset
        // Market layout after discriminator: market_id(8), creator(32), start_time(8),
        // status(2), bond_amount(8), bond_claimed(1), num_outcomes(1), q_values(64)...
        let q_offset = 8 + 8 + 32 + 8 + 2 + 8 + 1 + 1; // 68
        require!(
            market_data.len() >= q_offset + 64,
            QuadraticMarketError::InvalidRemainingAccount
        );

        for i in 0..MAX_OUTCOMES {
            let byte_offset = q_offset + (i * 8);
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(&market_data[byte_offset..byte_offset + 8]);
            correlated_q[market_idx as usize][i] = u64::from_le_bytes(bytes);
        }

        account_idx += 1;
        market_idx += 1;
    }

    Ok(correlated_q)
}

// ─── Sell Shares Correlated ────────────────────────────────────

#[derive(Accounts)]
#[instruction(outcome_id: u8, num_shares: u64, min_payout: u64)]
pub struct SellSharesCorrelated<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        constraint = market.group_id.is_some() == market_group.is_some() @ QuadraticMarketError::MarketGroupNotFound,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = outcome_mint,
        associated_token::authority = seller,
    )]
    pub seller_outcome_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = seller,
    )]
    pub seller_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, market.group_id.unwrap().to_le_bytes().as_ref()],
        bump = market_group.bump,
        constraint = market_group.group_id == market.group_id.unwrap() @ QuadraticMarketError::MarketGroupNotFound,
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

    // Compute sell payout with correlation adjustment if grouped
    let payout = if let Some(ref mut group) = ctx.accounts.market_group {
        // Lock correlation matrix on first trade
        if !group.correlation_locked {
            group.correlation_locked = true;
        }

        let correlated_q = assemble_correlated_q_values(
            &ctx.remaining_accounts,
            &group.market_ids,
            group.num_markets,
            market.market_id,
        )?;

        let adjusted_q = compute_adjusted_q_values(
            &market.q_values,
            market.num_outcomes,
            market.group_market_index,
            &correlated_q,
            &group.correlations,
            group.num_correlations,
        )?;

        lmsr_sell_payout(
            &adjusted_q,
            market.num_outcomes,
            outcome_id,
            num_shares,
            market.lmsr_b,
        )?
    } else {
        lmsr_sell_payout(
            &market.q_values,
            market.num_outcomes,
            outcome_id,
            num_shares,
            market.lmsr_b,
        )?
    };

    require!(
        payout >= min_payout,
        QuadraticMarketError::LmsrSellBelowMin
    );

    let free_liquidity = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
    require!(
        free_liquidity >= payout,
        QuadraticMarketError::InsufficientLiquidity
    );

    // Reduce exposure: group-level for grouped markets
    if let Some(ref mut group) = ctx.accounts.market_group {
        group.total_group_exposure = group.total_group_exposure.saturating_sub(payout);
    } else {
        market.exposure = market.exposure.saturating_sub(payout);
    }

    // Burn outcome tokens
    let cpi_accounts = token::Burn {
        mint: ctx.accounts.outcome_mint.to_account_info(),
        from: ctx.accounts.seller_outcome_ata.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    token::burn(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        num_shares,
    )?;

    // Transfer payout from treasury
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
    config.locked_payouts = config.locked_payouts.saturating_sub(payout);

    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketStatus};
use crate::errors::QuadraticMarketError;
use crate::constants::{seeds, MAX_OUTCOMES, MAX_TITLE_LEN, MAX_DESCRIPTION_LEN, BASE_MINT_DECIMALS};

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = creator,
        space = Market::LEN,
        seeds = [seeds::MARKET, global_config.next_market_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Treasury's base token account (receives bond)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// Creator's base token account (pays bond)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = creator,
    )]
    pub creator_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_market_handler(
    ctx: Context<CreateMarket>,
    start_time: i64,
    num_outcomes: u8,
    bond_amount: u64,
    title: String,
    description: String,
    category: u8,
    lmsr_b_override: Option<u64>,
    initial_q_values: Option<Vec<u64>>,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);

    // Validate outcomes
    require!(
        num_outcomes >= 2 && (num_outcomes as usize) <= MAX_OUTCOMES,
        QuadraticMarketError::InvalidNumOutcomes
    );

    // Validate bond
    require!(
        bond_amount >= config.min_market_bond,
        QuadraticMarketError::InvalidAmount
    );

    // Validate start time
    let now = Clock::get()?.unix_timestamp;
    require!(
        start_time > now,
        QuadraticMarketError::MarketAlreadyStarted
    );

    // Validate strings
    require!(
        title.len() <= MAX_TITLE_LEN && !title.is_empty(),
        QuadraticMarketError::InvalidAmount
    );
    require!(
        description.len() <= MAX_DESCRIPTION_LEN,
        QuadraticMarketError::InvalidAmount
    );

    // Validate initial q_values if provided
    if let Some(ref q_vals) = initial_q_values {
        require!(
            q_vals.len() == num_outcomes as usize,
            QuadraticMarketError::InvalidOutcomeId
        );
    }

    // Transfer bond from creator to treasury
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.creator_base_ata.to_account_info(),
        to: ctx.accounts.treasury_base_ata.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        bond_amount,
    )?;

    // Initialize market
    let market = &mut ctx.accounts.market;
    market.market_id = config.next_market_id;
    market.creator = ctx.accounts.creator.key();
    market.start_time = start_time;
    market.status = MarketStatus::Open;
    market.bond_amount = bond_amount;
    market.bond_claimed = false;
    market.num_outcomes = num_outcomes;

    // Seed q_values: use initial values if provided, otherwise zero
    let mut q_values: [u64; MAX_OUTCOMES] = [0u64; MAX_OUTCOMES];
    if let Some(q_vals) = initial_q_values {
        for i in 0..num_outcomes as usize {
            q_values[i] = q_vals[i];
        }
    }
    market.q_values = q_values;

    market.exposure = 0;
    market.settlement_time = 0;
    market.winning_outcome = 0;
    market.outcome_mints = [Pubkey::default(); MAX_OUTCOMES];
    market.lmsr_b = lmsr_b_override.unwrap_or(config.lmsr_default_b);
    market.title = title;
    market.description = description;
    market.category = category;
    market.bump = ctx.bumps.market;

    // Increment market ID counter
    config.next_market_id = config.next_market_id
        .checked_add(1)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    Ok(())
}

/// Initialize outcome token mints for a market.
/// Must be called after create_market. Each outcome gets its own SPL token mint.
/// The creator passes remaining_accounts with the outcome mint PDAs.
#[derive(Accounts)]
#[instruction(market_id: u64, outcome_id: u8)]
pub struct InitOutcomeMint<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = payer,
        seeds = [seeds::OUTCOME_MINT, market_id.to_le_bytes().as_ref(), outcome_id.to_le_bytes().as_ref()],
        bump,
        mint::decimals = BASE_MINT_DECIMALS,
        mint::authority = market,
    )]
    pub outcome_mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn init_outcome_mint_handler(ctx: Context<InitOutcomeMint>, market_id: u64, outcome_id: u8) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        (outcome_id as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidOutcomeId
    );
    require!(
        market.outcome_mints[outcome_id as usize] == Pubkey::default(),
        QuadraticMarketError::InvalidAmount
    );
    market.outcome_mints[outcome_id as usize] = ctx.accounts.outcome_mint.key();
    Ok(())
}

#[derive(Accounts)]
pub struct SuspendMarket<'info> {
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
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

pub fn suspend_market_handler(ctx: Context<SuspendMarket>) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == ctx.accounts.global_config.admin
            || ctx.accounts.authority.key() == ctx.accounts.market.creator,
        QuadraticMarketError::Unauthorized
    );
    require!(
        ctx.accounts.market.status == MarketStatus::Open,
        QuadraticMarketError::InvalidMarketStatus
    );
    ctx.accounts.market.status = MarketStatus::Suspended;
    Ok(())
}

#[derive(Accounts)]
pub struct ResumeMarket<'info> {
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
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

pub fn resume_market_handler(ctx: Context<ResumeMarket>) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == ctx.accounts.global_config.admin
            || ctx.accounts.authority.key() == ctx.accounts.market.creator,
        QuadraticMarketError::Unauthorized
    );
    require!(
        ctx.accounts.market.status == MarketStatus::Suspended,
        QuadraticMarketError::InvalidMarketStatus
    );
    ctx.accounts.market.status = MarketStatus::Open;
    Ok(())
}

#[derive(Accounts)]
pub struct VoidMarket<'info> {
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
    pub market: Account<'info, Market>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Treasury's base token account (receives slashed bond)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// Creator's base token account (would receive bond refund, but it's slashed)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = market.creator,
    )]
    pub creator_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn void_market_handler(ctx: Context<VoidMarket>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.global_config.admin,
        QuadraticMarketError::Unauthorized
    );
    require!(
        ctx.accounts.market.status != MarketStatus::Settled
            && ctx.accounts.market.status != MarketStatus::Voided,
        QuadraticMarketError::MarketNotVoidable
    );

    let market = &mut ctx.accounts.market;

    // Bond is slashed to treasury (becomes LP revenue)
    // We don't transfer — the bond was already in treasury_base_ata from create_market
    // Just mark it as claimed so it can't be returned later
    market.bond_claimed = true;

    // Reduce locked_payouts by this market's exposure
    let config = &mut ctx.accounts.global_config;
    config.locked_payouts = config.locked_payouts.saturating_sub(market.exposure);

    market.status = MarketStatus::Voided;

    // Note: Users who hold outcome tokens for this voided market need a separate
    // refund mechanism. In V1, voided markets simply make losing tokens worthless.
    // The bond slash covers LP losses from the voided market.

    Ok(())
}

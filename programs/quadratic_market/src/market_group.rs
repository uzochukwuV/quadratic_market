use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, Market, MarketGroup};
use crate::state::market_group::CorrelationPair;
use crate::errors::QuadraticMarketError;
use crate::constants::{seeds, MAX_GROUP_MARKETS, MAX_CORRELATION_PAIRS, CORRELATION_MAX_BPS};

// ─── Create Market Group ───────────────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct CreateMarketGroup<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = creator,
        space = MarketGroup::LEN,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub market_group: Account<'info, MarketGroup>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_market_group_handler(
    ctx: Context<CreateMarketGroup>,
    group_id: u64,
    max_group_exposure: u64,
    event_start_time: i64,
    title: String,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    require!(
        ctx.accounts.creator.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        event_start_time > now,
        QuadraticMarketError::GroupEventStarted
    );

    let group = &mut ctx.accounts.market_group;
    group.group_id = group_id;
    group.creator = ctx.accounts.creator.key();
    group.total_group_exposure = 0;
    group.max_group_exposure = max_group_exposure;
    group.num_markets = 0;
    group.market_ids = [0u64; MAX_GROUP_MARKETS];
    group.correlations = unsafe { std::mem::zeroed() };
    group.num_correlations = 0;
    group.event_start_time = event_start_time;
    group.correlation_locked = false;
    group.title = title;
    group.bump = ctx.bumps.market_group;

    Ok(())
}

// ─── Add Market to Group ──────────────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64, market_index: u8)]
pub struct AddMarketToGroup<'info> {
    #[account(
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Account<'info, MarketGroup>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

pub fn add_market_to_group_handler(
    ctx: Context<AddMarketToGroup>,
    group_id: u64,
    market_index: u8,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let group = &mut ctx.accounts.market_group;
    let market = &mut ctx.accounts.market;

    require!(
        ctx.accounts.authority.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    require!(
        market.group_id.is_none(),
        QuadraticMarketError::MarketAlreadyInGroup
    );

    require!(
        (group.num_markets as usize) < MAX_GROUP_MARKETS,
        QuadraticMarketError::MarketGroupFull
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now < group.event_start_time,
        QuadraticMarketError::GroupEventStarted
    );

    require!(
        (market_index as usize) < MAX_GROUP_MARKETS,
        QuadraticMarketError::InvalidAmount
    );

    // Link market to group
    market.group_id = Some(group_id);
    market.group_market_index = market_index;

    // Add market to group's list
    let idx = group.num_markets as usize;
    let mid = market.market_id;
    group.market_ids[idx] = mid;
    group.num_markets += 1;

    Ok(())
}

// ─── Add Correlation Pair ─────────────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct AddCorrelationPair<'info> {
    #[account(
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Account<'info, MarketGroup>,

    pub authority: Signer<'info>,
}

pub fn add_correlation_pair_handler(
    ctx: Context<AddCorrelationPair>,
    _group_id: u64,
    pair: CorrelationPair,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let group = &mut ctx.accounts.market_group;

    require!(
        ctx.accounts.authority.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    require!(
        !group.correlation_locked,
        QuadraticMarketError::CorrelationMatrixLocked
    );

    require!(
        group.num_correlations < MAX_CORRELATION_PAIRS as u8,
        QuadraticMarketError::MarketGroupFull
    );

    require!(
        pair.weight_bps <= CORRELATION_MAX_BPS,
        QuadraticMarketError::CorrelationOutOfBounds
    );

    require!(
        (pair.market_a_index as usize) < group.num_markets as usize
            && (pair.market_b_index as usize) < group.num_markets as usize,
        QuadraticMarketError::MarketNotInGroup
    );

    require!(
        pair.market_a_index != pair.market_b_index,
        QuadraticMarketError::InvalidAmount
    );

    // Add the pair
    let idx = group.num_correlations as usize;
    group.correlations[idx] = pair;
    group.num_correlations += 1;

    Ok(())
}

// ─── Update Correlation Weight ────────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64, pair_index: u8)]
pub struct UpdateCorrelationWeight<'info> {
    #[account(
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Account<'info, MarketGroup>,

    pub authority: Signer<'info>,
}

pub fn update_correlation_weight_handler(
    ctx: Context<UpdateCorrelationWeight>,
    _group_id: u64,
    pair_index: u8,
    new_weight_bps: u64,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let group = &mut ctx.accounts.market_group;

    require!(
        ctx.accounts.authority.key() == config.admin,
        QuadraticMarketError::Unauthorized
    );

    require!(
        !group.correlation_locked,
        QuadraticMarketError::CorrelationMatrixLocked
    );

    require!(
        pair_index < group.num_correlations,
        QuadraticMarketError::InvalidAmount
    );

    require!(
        new_weight_bps <= CORRELATION_MAX_BPS,
        QuadraticMarketError::CorrelationOutOfBounds
    );

    let idx = pair_index as usize;
    group.correlations[idx].weight_bps = new_weight_bps;

    Ok(())
}

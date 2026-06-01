use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketGroup, MarketStatus};
use crate::state::market_group::{CorrelationPair, SeedPosition};
use crate::errors::QuadraticMarketError;
use crate::constants::{
    seeds, CORRELATION_MAX_BPS, DEFAULT_MAX_SEED_SIDE_SHARE_BPS, DEFAULT_MIN_SEED_VOLUME,
    DEFAULT_SEED_FEE_SHARE_BPS, MAX_CORRELATION_PAIRS, MAX_GROUP_MARKETS, MAX_OUTCOMES,
    MAX_SAME_GAME_STATES, MAX_SEED_POSITIONS, SCALE,
};

// ─── Create Market Group ───────────────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct CreateMarketGroup<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        init,
        payer = creator,
        space = MarketGroup::LEN,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

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
    group.correlations = [CorrelationPair::default(); MAX_CORRELATION_PAIRS];
    group.num_correlations = 0;
    group.num_states = 0;
    group.state_probabilities = [0u64; MAX_SAME_GAME_STATES];
    group.outcome_state_masks = [[0u64; MAX_OUTCOMES]; MAX_GROUP_MARKETS];
    group.statistical_discount_bps = CORRELATION_MAX_BPS;
    group.seed_fee_pools = [0u64; MAX_GROUP_MARKETS];
    group.seed_fee_share_bps = DEFAULT_SEED_FEE_SHARE_BPS;
    group.seed_min_volume = DEFAULT_MIN_SEED_VOLUME;
    group.seed_max_side_share_bps = DEFAULT_MAX_SEED_SIDE_SHARE_BPS;
    group.seed_positions = [SeedPosition::default(); MAX_SEED_POSITIONS];
    group.num_seed_positions = 0;
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
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

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
    require!(
        market_index == group.num_markets,
        QuadraticMarketError::InvalidAmount
    );

    // Link market to group
    market.group_id = Some(group_id);
    market.group_market_index = market_index;
    market.status = MarketStatus::PreOpen;

    // Add market to group's list
    let idx = market_index as usize;
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
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

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
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

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

// ─── Same-game State Model ────────────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct SetGroupStateModel<'info> {
    #[account(
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

    pub authority: Signer<'info>,
}

pub fn set_group_state_model_handler(
    ctx: Context<SetGroupStateModel>,
    _group_id: u64,
    num_states: u8,
    state_probabilities: Vec<u64>,
    statistical_discount_bps: u64,
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
    require!(num_states > 0, QuadraticMarketError::InvalidAmount);
    require!(
        num_states as usize <= MAX_SAME_GAME_STATES,
        QuadraticMarketError::InvalidAmount
    );
    require!(
        state_probabilities.len() == num_states as usize,
        QuadraticMarketError::InvalidAmount
    );
    require!(
        statistical_discount_bps <= CORRELATION_MAX_BPS,
        QuadraticMarketError::CorrelationOutOfBounds
    );

    let mut total_probability: u128 = 0;
    let mut probabilities = [0u64; MAX_SAME_GAME_STATES];
    for i in 0..num_states as usize {
        probabilities[i] = state_probabilities[i];
        total_probability = total_probability
            .checked_add(state_probabilities[i] as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?;
    }
    require!(
        total_probability == SCALE as u128,
        QuadraticMarketError::InvalidAmount
    );

    group.num_states = num_states;
    group.state_probabilities = probabilities;
    group.statistical_discount_bps = statistical_discount_bps;

    Ok(())
}

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct SetOutcomeStateMask<'info> {
    #[account(
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

    pub authority: Signer<'info>,
}

pub fn set_outcome_state_mask_handler(
    ctx: Context<SetOutcomeStateMask>,
    _group_id: u64,
    market_index: u8,
    outcome_id: u8,
    state_mask: u64,
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
        (market_index as usize) < group.num_markets as usize,
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        (outcome_id as usize) < MAX_OUTCOMES,
        QuadraticMarketError::InvalidOutcomeId
    );
    require!(group.num_states > 0, QuadraticMarketError::InvalidAmount);

    let valid_mask = if group.num_states as usize == MAX_SAME_GAME_STATES {
        u64::MAX
    } else {
        (1u64 << group.num_states) - 1
    };
    require!(state_mask != 0, QuadraticMarketError::InvalidAmount);
    require!(
        state_mask & !valid_mask == 0,
        QuadraticMarketError::InvalidAmount
    );

    group.outcome_state_masks[market_index as usize][outcome_id as usize] = state_mask;

    Ok(())
}

// ─── PreOpen Activation ───────────────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct ActivateSeededMarket<'info> {
    #[account(
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    pub authority: Signer<'info>,
}

pub fn activate_seeded_market_handler(
    ctx: Context<ActivateSeededMarket>,
    _group_id: u64,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let group = &ctx.accounts.market_group;
    let market = &mut ctx.accounts.market;

    require!(
        config.is_authorized(&ctx.accounts.authority.key()),
        QuadraticMarketError::Unauthorized
    );
    require!(
        market.group_id == Some(group.group_id),
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        (market.group_market_index as usize) < group.num_markets as usize
            && group.market_ids[market.group_market_index as usize] == market.market_id,
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        market.status == MarketStatus::PreOpen,
        QuadraticMarketError::InvalidMarketStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now < market.start_time, QuadraticMarketError::MarketExpired);

    let market_index = market.group_market_index;
    let mut total_seed_volume: u64 = 0;
    let mut seeded_sides: u8 = 0;
    let mut largest_side: u64 = 0;

    for outcome_id in 0..market.num_outcomes as usize {
        let mut side_volume: u64 = 0;
        for i in 0..group.num_seed_positions as usize {
            let seed = group.seed_positions[i];
            if seed.market_index == market_index && seed.outcome_id as usize == outcome_id {
                side_volume = side_volume
                    .checked_add(seed.amount)
                    .ok_or(QuadraticMarketError::MathOverflow)?;
            }
        }

        if side_volume > 0 {
            seeded_sides = seeded_sides
                .checked_add(1)
                .ok_or(QuadraticMarketError::MathOverflow)?;
            largest_side = largest_side.max(side_volume);
            total_seed_volume = total_seed_volume
                .checked_add(side_volume)
                .ok_or(QuadraticMarketError::MathOverflow)?;
        }
    }

    require!(
        total_seed_volume >= group.seed_min_volume,
        QuadraticMarketError::SeedMarketNotReady
    );
    require!(seeded_sides >= 2, QuadraticMarketError::SeedMarketNotReady);

    let largest_side_bps = (largest_side as u128)
        .checked_mul(CORRELATION_MAX_BPS as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?
        .checked_div(total_seed_volume as u128)
        .ok_or(QuadraticMarketError::MathOverflow)? as u64;
    require!(
        largest_side_bps <= group.seed_max_side_share_bps,
        QuadraticMarketError::SeedMarketNotReady
    );

    market.status = MarketStatus::Open;

    Ok(())
}

// ─── Seeder Fee Rewards ───────────────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct RegisterSeedPosition<'info> {
    #[account(
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

    pub authority: Signer<'info>,
}

pub fn register_seed_position_handler(
    ctx: Context<RegisterSeedPosition>,
    _group_id: u64,
    seeder: Pubkey,
    market_index: u8,
    outcome_id: u8,
    amount: u64,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let group = &mut ctx.accounts.market_group;

    require!(
        config.is_authorized(&ctx.accounts.authority.key()),
        QuadraticMarketError::Unauthorized
    );
    require!(
        (group.num_seed_positions as usize) < MAX_SEED_POSITIONS,
        QuadraticMarketError::MarketGroupFull
    );
    require!(
        (market_index as usize) < group.num_markets as usize,
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        (outcome_id as usize) < MAX_OUTCOMES,
        QuadraticMarketError::InvalidOutcomeId
    );
    require!(amount > 0, QuadraticMarketError::InvalidAmount);

    let idx = group.num_seed_positions as usize;
    group.seed_positions[idx] = SeedPosition {
        seeder,
        market_index,
        outcome_id,
        amount,
        reward_claimed: false,
    };
    group.num_seed_positions += 1;

    Ok(())
}

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct ClaimSeedFeeReward<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
        bump = market_group.bump,
    )]
    pub market_group: Box<Account<'info, MarketGroup>>,

    #[account(
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = claimer)]
    pub claimer_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn claim_seed_fee_reward_handler(
    ctx: Context<ClaimSeedFeeReward>,
    _group_id: u64,
    seed_index: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let group = &mut ctx.accounts.market_group;
    let market = &ctx.accounts.market;

    require!(
        market.status == crate::state::MarketStatus::Settled,
        QuadraticMarketError::MarketNotSettled
    );
    require!(
        market.group_id == Some(group.group_id),
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        seed_index < group.num_seed_positions,
        QuadraticMarketError::InvalidAmount
    );

    let seed = group.seed_positions[seed_index as usize];
    require!(
        seed.seeder == ctx.accounts.claimer.key(),
        QuadraticMarketError::Unauthorized
    );
    require!(!seed.reward_claimed, QuadraticMarketError::PayoutAlreadyClaimed);
    require!(
        seed.market_index == market.group_market_index,
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        seed.outcome_id != market.winning_outcome,
        QuadraticMarketError::InvalidOutcomeId
    );

    let mut unclaimed_losing_seed_total: u64 = 0;
    for i in 0..group.num_seed_positions as usize {
        let pos = group.seed_positions[i];
        if pos.market_index == seed.market_index
            && pos.outcome_id != market.winning_outcome
            && !pos.reward_claimed
        {
            unclaimed_losing_seed_total = unclaimed_losing_seed_total
                .checked_add(pos.amount)
                .ok_or(QuadraticMarketError::MathOverflow)?;
        }
    }
    require!(
        unclaimed_losing_seed_total > 0,
        QuadraticMarketError::InvalidAmount
    );

    let pool_index = seed.market_index as usize;
    let reward = ((group.seed_fee_pools[pool_index] as u128)
        .checked_mul(seed.amount as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?
        / unclaimed_losing_seed_total as u128) as u64;
    require!(reward > 0, QuadraticMarketError::InvalidAmount);

    group.seed_positions[seed_index as usize].reward_claimed = true;
    group.seed_fee_pools[pool_index] = group.seed_fee_pools[pool_index].saturating_sub(reward);
    config.locked_payouts = config.locked_payouts.saturating_sub(reward);

    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.treasury_base_ata.to_account_info(),
                to: ctx.accounts.claimer_base_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            &[treasury_seeds],
        ),
        reward,
    )?;

    Ok(())
}

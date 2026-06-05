use crate::constants::{
    seeds, CORRELATION_MAX_BPS, DEFAULT_MAX_SEED_SIDE_SHARE_BPS, DEFAULT_MIN_SEED_VOLUME,
    DEFAULT_SEED_FEE_SHARE_BPS, MAX_CORRELATION_PAIRS, MAX_GROUP_MARKETS, MAX_OUTCOMES,
    MAX_SAME_GAME_STATES, MAX_SEED_POSITIONS, MIN_SEED_PER_OUTCOME, SCALE,
};
use crate::errors::QuadraticMarketError;
use crate::math::exp_ln::ln_q32;
use crate::state::market_group::{CorrelationPair, SeedPosition};
use crate::state::{GlobalConfig, Market, MarketGroup, MarketStatus};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

#[repr(u8)]
pub enum MarketStatusCode {
    PreOpen = 0,
    Open = 1,
}

#[event]
pub struct MarketGroupCreated {
    pub group_id: u64,
    pub creator: Pubkey,
    pub max_group_exposure: u64,
    pub event_start_time: i64,
    pub seed_fee_share_bps: u64,
    pub seed_min_volume: u64,
    pub seed_max_side_share_bps: u64,
}

#[event]
pub struct GroupedMarketCreated {
    pub group_id: u64,
    pub market_id: u64,
    pub market_index: u8,
    pub status: u8,
}

#[event]
pub struct SeedMarketActivated {
    pub group_id: u64,
    pub market_id: u64,
    pub market_index: u8,
    pub total_seed_volume: u64,
    pub seeded_sides: u8,
    pub largest_side_bps: u64,
}

#[event]
pub struct SeedFeeRewardClaimed {
    pub group_id: u64,
    pub market_id: u64,
    pub seed_index: u8,
    pub claimer: Pubkey,
    pub reward: u64,
}

/// Returns (total_seed_volume, seeded_sides, largest_side_bps, smallest_side_volume).
/// `smallest_side_volume` is the minimum seed volume across ALL outcomes (an
/// unseeded outcome contributes 0), used to enforce the per-outcome floor.
pub(crate) fn compute_seed_readiness(
    seed_positions: &[SeedPosition],
    num_seed_positions: u8,
    market_index: u8,
    num_outcomes: u8,
) -> Result<(u64, u8, u64, u64)> {
    let mut total_seed_volume: u64 = 0;
    let mut seeded_sides: u8 = 0;
    let mut largest_side: u64 = 0;
    let mut smallest_side: u64 = u64::MAX;

    for outcome_id in 0..num_outcomes as usize {
        let mut side_volume: u64 = 0;
        for i in 0..num_seed_positions as usize {
            let seed = seed_positions[i];
            if seed.market_index == market_index
                && seed.outcome_id as usize == outcome_id
                && !seed.refunded
            {
                side_volume = side_volume
                    .checked_add(seed.amount)
                    .ok_or(QuadraticMarketError::MathOverflow)?;
            }
        }

        smallest_side = smallest_side.min(side_volume);

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

    if num_outcomes == 0 {
        smallest_side = 0;
    }

    let largest_side_bps = if total_seed_volume > 0 {
        (largest_side as u128)
            .checked_mul(CORRELATION_MAX_BPS as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?
            .checked_div(total_seed_volume as u128)
            .ok_or(QuadraticMarketError::MathOverflow)? as u64
    } else {
        0
    };

    Ok((total_seed_volume, seeded_sides, largest_side_bps, smallest_side))
}

pub(crate) fn compute_seed_lmsr_q_values(
    seed_positions: &[SeedPosition],
    num_seed_positions: u8,
    market_index: u8,
    num_outcomes: u8,
    total_seed_volume: u64,
    b_fp: u64,
) -> Result<[u64; MAX_OUTCOMES]> {
    require!(total_seed_volume > 0, QuadraticMarketError::InvalidAmount);

    // lmsr_b is stored as raw lamports (B_raw), not Q32.32.
    let b_raw = b_fp;
    require!(b_raw > 0, QuadraticMarketError::InvalidAmount);

    let mut side_volumes = [0u64; MAX_OUTCOMES];
    let mut ln_probabilities = [0i64; MAX_OUTCOMES];
    let mut min_ln = i64::MAX;

    for i in 0..num_seed_positions as usize {
        let seed = seed_positions[i];
        if seed.market_index == market_index
            && (seed.outcome_id as usize) < num_outcomes as usize
            && !seed.refunded
        {
            side_volumes[seed.outcome_id as usize] = side_volumes[seed.outcome_id as usize]
                .checked_add(seed.amount)
                .ok_or(QuadraticMarketError::MathOverflow)?;
        }
    }

    for outcome_id in 0..num_outcomes as usize {
        require!(
            side_volumes[outcome_id] > 0,
            QuadraticMarketError::SeedMarketNotReady
        );

        let probability_fp = ((side_volumes[outcome_id] as u128)
            .checked_mul(SCALE as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?
            / total_seed_volume as u128) as u64;
        require!(probability_fp > 0, QuadraticMarketError::InvalidAmount);

        let ln_probability = ln_q32(probability_fp)?;
        ln_probabilities[outcome_id] = ln_probability;
        min_ln = min_ln.min(ln_probability);
    }

    let mut q_values = [0u64; MAX_OUTCOMES];
    for outcome_id in 0..num_outcomes as usize {
        let ln_delta = ln_probabilities[outcome_id]
            .checked_sub(min_ln)
            .ok_or(QuadraticMarketError::MathUnderflow)? as u64;
        q_values[outcome_id] = ((b_raw as u128)
            .checked_mul(ln_delta as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?
            / SCALE as u128) as u64;
    }

    Ok(q_values)
}

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

    emit!(MarketGroupCreated {
        group_id,
        creator: group.creator,
        max_group_exposure,
        event_start_time,
        seed_fee_share_bps: group.seed_fee_share_bps,
        seed_min_volume: group.seed_min_volume,
        seed_max_side_share_bps: group.seed_max_side_share_bps,
    });

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

    emit!(GroupedMarketCreated {
        group_id,
        market_id: market.market_id,
        market_index,
        status: MarketStatusCode::PreOpen as u8,
    });

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

pub fn activate_seeded_market_handler(
    ctx: Context<ActivateSeededMarket>,
    _group_id: u64,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let group = &mut ctx.accounts.market_group;
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
    let (total_seed_volume, seeded_sides, largest_side_bps, smallest_side) =
        compute_seed_readiness(
            &group.seed_positions,
            group.num_seed_positions,
            market_index,
            market.num_outcomes,
        )?;

    // Per-outcome floor: every outcome must be seeded with at least
    // MIN_SEED_PER_OUTCOME of real capital. This (not an aggregate) is what makes
    // the market's backstop credible. `smallest_side` is the min across all
    // outcomes (an unseeded outcome is 0), so this also subsumes the old
    // "every side seeded" rule.
    require!(
        smallest_side >= MIN_SEED_PER_OUTCOME,
        QuadraticMarketError::SeedMarketNotReady
    );
    require!(
        seeded_sides == market.num_outcomes,
        QuadraticMarketError::SeedMarketNotReady
    );

    require!(
        largest_side_bps <= group.seed_max_side_share_bps,
        QuadraticMarketError::SeedMarketNotReady
    );

    // NOTE: the opening line (q_values) was set by the operator at create_market
    // (initial_q_values). Seeding only escrows backing capital — it no longer
    // derives the odds. We therefore do NOT overwrite market.q_values here.

    require!(
        total_seed_volume <= config.max_market_exposure,
        QuadraticMarketError::MaxExposureReached
    );
    let new_group_exposure = group
        .total_group_exposure
        .checked_add(total_seed_volume)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    require!(
        new_group_exposure <= group.max_group_exposure,
        QuadraticMarketError::GroupExposureExceeded
    );

    market.exposure = total_seed_volume;
    group.total_group_exposure = new_group_exposure;
    market.status = MarketStatus::Open;

    emit!(SeedMarketActivated {
        group_id: group.group_id,
        market_id: market.market_id,
        market_index,
        total_seed_volume,
        seeded_sides,
        largest_side_bps,
    });

    Ok(())
}

// ─── Seeder Fee Rewards ───────────────────────────────────────

// Seeding is now a REAL early bet that escrows capital. The seeder signs, transfers
// `amount` base tokens to the treasury, and is minted `amount` outcome tokens
// (1 token per base-unit — "H1" accounting, which keeps the treasury solvent:
// a winning seed redeems exactly its stake, a losing seed's stake stays in the
// pool). The escrowed capital is the market's backing (see Market.backing).
#[derive(Accounts)]
#[instruction(group_id: u64, market_id: u64, market_index: u8, outcome_id: u8)]
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

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = seeder)]
    pub seeder_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = outcome_mint,
        associated_token::authority = seeder,
    )]
    pub seeder_outcome_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub seeder: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn register_seed_position_handler(
    ctx: Context<RegisterSeedPosition>,
    _group_id: u64,
    _market_id: u64,
    market_index: u8,
    outcome_id: u8,
    amount: u64,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    let group = &mut ctx.accounts.market_group;
    let market = &mut ctx.accounts.market;

    require!(!config.paused, QuadraticMarketError::Paused);
    require!(
        (group.num_seed_positions as usize) < MAX_SEED_POSITIONS,
        QuadraticMarketError::MarketGroupFull
    );
    require!(
        (market_index as usize) < group.num_markets as usize,
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        group.market_ids[market_index as usize] == market.market_id,
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        market.group_market_index == market_index,
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        (outcome_id as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidOutcomeId
    );
    // Seeding only happens while the market is still bootstrapping.
    require!(
        market.status == MarketStatus::PreOpen,
        QuadraticMarketError::InvalidMarketStatus
    );
    require!(amount > 0, QuadraticMarketError::InvalidAmount);

    // Escrow the seeder's capital into the treasury.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.seeder_base_ata.to_account_info(),
                to: ctx.accounts.treasury_base_ata.to_account_info(),
                authority: ctx.accounts.seeder.to_account_info(),
            },
        ),
        amount,
    )?;

    // Mint 1 outcome token per base-unit seeded (H1). The seeder holds a real
    // settlement claim: winning side redeems 1:1 via claim_payout, losing side's
    // stake stays in the pool (and earns the 5% loser perk).
    let market_id_bytes = market.market_id.to_le_bytes();
    let market_seeds = &[seeds::MARKET, market_id_bytes.as_ref(), &[market.bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                to: ctx.accounts.seeder_outcome_ata.to_account_info(),
                authority: market.to_account_info(),
            },
            &[market_seeds],
        ),
        amount,
    )?;

    // The escrowed capital backs this market and is a 1:1 settlement liability.
    market.backing = market
        .backing
        .checked_add(amount)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    let idx = group.num_seed_positions as usize;
    group.seed_positions[idx] = SeedPosition {
        seeder: ctx.accounts.seeder.key(),
        slip_id: 0,
        market_index,
        outcome_id,
        amount,
        reward_claimed: false,
        refunded: false,
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
        mut,
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

    // Snapshot the market scalars we need so we can take a &mut borrow later
    // (to decrement market.seed_fee_pool) without a borrow conflict.
    let market_status = ctx.accounts.market.status.clone();
    let market_group_id = ctx.accounts.market.group_id;
    let market_group_index = ctx.accounts.market.group_market_index;
    let market_winning_outcome = ctx.accounts.market.winning_outcome;
    let market_id_for_event = ctx.accounts.market.market_id;

    require!(
        market_status == crate::state::MarketStatus::Settled,
        QuadraticMarketError::MarketNotSettled
    );
    require!(
        market_group_id == Some(group.group_id),
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
    require!(
        !seed.reward_claimed,
        QuadraticMarketError::PayoutAlreadyClaimed
    );
    require!(
        seed.market_index == market_group_index,
        QuadraticMarketError::MarketNotInGroup
    );
    require!(
        seed.outcome_id != market_winning_outcome,
        QuadraticMarketError::InvalidOutcomeId
    );

    let mut unclaimed_losing_seed_total: u64 = 0;
    for i in 0..group.num_seed_positions as usize {
        let pos = group.seed_positions[i];
        if pos.market_index == seed.market_index
            && pos.outcome_id != market_winning_outcome
            && !pos.reward_claimed
            && !pos.refunded
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

    // The seed-fee pool now lives on the Market (accrued by every trade path),
    // not on the group, so all of buy_shares / buy_shares_correlated / add_slip_leg
    // can contribute without needing the group account.
    let market_mut = &mut ctx.accounts.market;
    let reward = ((market_mut.seed_fee_pool as u128)
        .checked_mul(seed.amount as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?
        / unclaimed_losing_seed_total as u128) as u64;
    require!(reward > 0, QuadraticMarketError::InvalidAmount);

    group.seed_positions[seed_index as usize].reward_claimed = true;
    market_mut.seed_fee_pool = market_mut.seed_fee_pool.saturating_sub(reward);
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

    emit!(SeedFeeRewardClaimed {
        group_id: group.group_id,
        market_id: market_id_for_event,
        seed_index,
        claimer: ctx.accounts.claimer.key(),
        reward,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::lmsr::lmsr_price;

    fn seed(market_index: u8, outcome_id: u8, amount: u64) -> SeedPosition {
        SeedPosition {
            seeder: Pubkey::new_unique(),
            slip_id: amount,
            market_index,
            outcome_id,
            amount,
            reward_claimed: false,
            refunded: false,
        }
    }

    #[test]
    fn seed_readiness_is_per_market_not_per_group() {
        let mut positions = [SeedPosition::default(); MAX_SEED_POSITIONS];
        positions[0] = seed(0, 0, 3_000);
        positions[1] = seed(0, 1, 2_000);
        positions[2] = seed(1, 0, 9_000);

        let (market_0_total, market_0_sides, market_0_largest, market_0_min) =
            compute_seed_readiness(&positions, 3, 0, 2).unwrap();
        assert_eq!(market_0_total, 5_000);
        assert_eq!(market_0_sides, 2);
        assert_eq!(market_0_largest, 6_000);
        assert_eq!(market_0_min, 2_000);

        let (market_1_total, market_1_sides, market_1_largest, market_1_min) =
            compute_seed_readiness(&positions, 3, 1, 2).unwrap();
        assert_eq!(market_1_total, 9_000);
        assert_eq!(market_1_sides, 1);
        assert_eq!(market_1_largest, 10_000);
        // outcome 1 of market 1 is unseeded → smallest side is 0
        assert_eq!(market_1_min, 0);
    }

    #[test]
    fn refunded_seed_does_not_count_toward_activation() {
        let mut positions = [SeedPosition::default(); MAX_SEED_POSITIONS];
        positions[0] = seed(0, 0, 3_000);
        positions[1] = seed(0, 1, 2_000);
        positions[1].refunded = true;

        let (total, sides, largest, smallest) = compute_seed_readiness(&positions, 2, 0, 2).unwrap();
        assert_eq!(total, 3_000);
        assert_eq!(sides, 1);
        assert_eq!(largest, 10_000);
        // outcome 1's only seed was refunded → smallest side is 0
        assert_eq!(smallest, 0);
    }

    #[test]
    fn seed_ratios_initialize_lmsr_probabilities() {
        let mut positions = [SeedPosition::default(); MAX_SEED_POSITIONS];
        positions[0] = seed(0, 0, 8_000_000_000);
        positions[1] = seed(0, 1, 6_000_000_000);
        positions[2] = seed(0, 2, 6_000_000_000);
        let b_fp = 100_000_000; // B_raw in raw lamports

        let q_values =
            compute_seed_lmsr_q_values(&positions, 3, 0, 3, 20_000_000_000, b_fp).unwrap();

        let home = lmsr_price(&q_values, 3, 0, b_fp).unwrap();
        let away = lmsr_price(&q_values, 3, 1, b_fp).unwrap();
        let draw = lmsr_price(&q_values, 3, 2, b_fp).unwrap();
        let tolerance = SCALE / 100;

        assert!((home as i64 - (SCALE * 40 / 100) as i64).unsigned_abs() < tolerance);
        assert!((away as i64 - (SCALE * 30 / 100) as i64).unsigned_abs() < tolerance);
        assert!((draw as i64 - (SCALE * 30 / 100) as i64).unsigned_abs() < tolerance);
    }

    #[test]
    fn seed_lmsr_initialization_rejects_unseeded_outcomes() {
        let mut positions = [SeedPosition::default(); MAX_SEED_POSITIONS];
        positions[0] = seed(0, 0, 8_000_000_000);
        positions[1] = seed(0, 1, 6_000_000_000);
        let b_fp = 100_000_000; // B_raw in raw lamports

        let result = compute_seed_lmsr_q_values(&positions, 2, 0, 3, 14_000_000_000, b_fp);

        assert!(result.is_err());
    }
}

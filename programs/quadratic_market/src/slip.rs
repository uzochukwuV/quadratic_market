use crate::constants::{
    seeds, CORRELATION_MAX_BPS, MAX_CORRELATION_PAIRS, MAX_OUTCOMES, MAX_SAME_GAME_STATES,
    MAX_SEED_POSITIONS, MAX_SLIP_LEGS, SCALE,
};
use crate::errors::QuadraticMarketError;
use crate::math::correlation::{
    compute_adjusted_q_values, compute_bonus_multiplier, compute_combined_odds_fp,
    compute_joint_probability_fp, LogicalOutcome,
};
use crate::math::lmsr::{lmsr_buy_cost, lmsr_price};
use crate::state::{BetSlip, GlobalConfig, Market, MarketStatus, SlipLeg};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token::{self, Mint, Token, TokenAccount};

#[inline(never)]
fn deserialize_market_info(market_info: &AccountInfo) -> Result<Box<Market>> {
    let market_data = market_info.data.borrow();
    let market = Box::new(
        Market::try_deserialize_unchecked(&mut &market_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?,
    );
    Ok(market)
}

struct MarketGroupSnapshot {
    group_id: u64,
    total_group_exposure: u64,
    max_group_exposure: u64,
    num_markets: u8,
    market_ids: [u64; MAX_OUTCOMES],
    correlations: [crate::state::market_group::CorrelationPair; MAX_CORRELATION_PAIRS],
    num_correlations: u8,
    num_states: u8,
    state_probabilities: [u64; MAX_SAME_GAME_STATES],
    outcome_state_masks: [[u64; MAX_OUTCOMES]; MAX_OUTCOMES],
    statistical_discount_bps: u64,
    seed_fee_pools: [u64; MAX_OUTCOMES],
    seed_fee_share_bps: u64,
    seed_positions: [crate::state::market_group::SeedPosition; MAX_SEED_POSITIONS],
    num_seed_positions: u8,
}

const GROUP_TOTAL_EXPOSURE_OFFSET: usize = 40;
const GROUP_MAX_EXPOSURE_OFFSET: usize = 48;
const GROUP_NUM_MARKETS_OFFSET: usize = 56;
const GROUP_MARKET_IDS_OFFSET: usize = 57;
const GROUP_CORRELATIONS_OFFSET: usize = 121;
const GROUP_NUM_CORRELATIONS_OFFSET: usize = 313;
const GROUP_NUM_STATES_OFFSET: usize = 314;
const GROUP_STATE_PROBABILITIES_OFFSET: usize = 315;
const GROUP_OUTCOME_STATE_MASKS_OFFSET: usize = 827;
const GROUP_STATISTICAL_DISCOUNT_OFFSET: usize = 1339;
const GROUP_SEED_FEE_POOLS_OFFSET: usize = 1347;
const GROUP_SEED_FEE_SHARE_OFFSET: usize = 1411;
const GROUP_SEED_POSITIONS_OFFSET: usize = 1435;
const GROUP_NUM_SEED_POSITIONS_OFFSET: usize = 2267;

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .ok_or(QuadraticMarketError::InvalidRemainingAccount)?
        .try_into()
        .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
    Ok(u64::from_le_bytes(bytes))
}

#[inline(never)]
fn deserialize_market_group_info(group_info: &AccountInfo) -> Result<Box<MarketGroupSnapshot>> {
    let group_data = group_info.data.borrow();
    let data = group_data
        .get(8..)
        .ok_or(QuadraticMarketError::InvalidRemainingAccount)?;

    let mut market_ids = [0u64; MAX_OUTCOMES];
    for (idx, market_id) in market_ids.iter_mut().enumerate() {
        *market_id = read_u64(data, GROUP_MARKET_IDS_OFFSET + idx * 8)?;
    }

    let mut correlations =
        [crate::state::market_group::CorrelationPair::default(); MAX_CORRELATION_PAIRS];
    for (idx, pair) in correlations.iter_mut().enumerate() {
        let offset = GROUP_CORRELATIONS_OFFSET + idx * 12;
        *pair = crate::state::market_group::CorrelationPair {
            market_a_index: *data
                .get(offset)
                .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
            outcome_a_id: *data
                .get(offset + 1)
                .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
            market_b_index: *data
                .get(offset + 2)
                .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
            outcome_b_id: *data
                .get(offset + 3)
                .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
            weight_bps: read_u64(data, offset + 4)?,
        };
    }

    let mut state_probabilities = [0u64; MAX_SAME_GAME_STATES];
    for (idx, probability) in state_probabilities.iter_mut().enumerate() {
        *probability = read_u64(data, GROUP_STATE_PROBABILITIES_OFFSET + idx * 8)?;
    }

    let mut outcome_state_masks = [[0u64; MAX_OUTCOMES]; MAX_OUTCOMES];
    for market_idx in 0..MAX_OUTCOMES {
        for outcome_idx in 0..MAX_OUTCOMES {
            let flat_idx = market_idx * MAX_OUTCOMES + outcome_idx;
            outcome_state_masks[market_idx][outcome_idx] =
                read_u64(data, GROUP_OUTCOME_STATE_MASKS_OFFSET + flat_idx * 8)?;
        }
    }

    let mut seed_fee_pools = [0u64; MAX_OUTCOMES];
    for (idx, fee_pool) in seed_fee_pools.iter_mut().enumerate() {
        *fee_pool = read_u64(data, GROUP_SEED_FEE_POOLS_OFFSET + idx * 8)?;
    }

    let mut seed_positions =
        [crate::state::market_group::SeedPosition::default(); MAX_SEED_POSITIONS];
    for (idx, seed) in seed_positions.iter_mut().enumerate() {
        let offset = GROUP_SEED_POSITIONS_OFFSET + idx * 52;
        let seeder_bytes: [u8; 32] = data
            .get(offset..offset + 32)
            .ok_or(QuadraticMarketError::InvalidRemainingAccount)?
            .try_into()
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        *seed = crate::state::market_group::SeedPosition {
            seeder: Pubkey::new_from_array(seeder_bytes),
            slip_id: read_u64(data, offset + 32)?,
            market_index: *data
                .get(offset + 40)
                .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
            outcome_id: *data
                .get(offset + 41)
                .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
            amount: read_u64(data, offset + 42)?,
            reward_claimed: *data
                .get(offset + 50)
                .ok_or(QuadraticMarketError::InvalidRemainingAccount)?
                != 0,
            refunded: *data
                .get(offset + 51)
                .ok_or(QuadraticMarketError::InvalidRemainingAccount)?
                != 0,
        };
    }

    Ok(Box::new(MarketGroupSnapshot {
        group_id: read_u64(data, 0)?,
        total_group_exposure: read_u64(data, GROUP_TOTAL_EXPOSURE_OFFSET)?,
        max_group_exposure: read_u64(data, GROUP_MAX_EXPOSURE_OFFSET)?,
        num_markets: *data
            .get(GROUP_NUM_MARKETS_OFFSET)
            .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
        market_ids,
        correlations,
        num_correlations: *data
            .get(GROUP_NUM_CORRELATIONS_OFFSET)
            .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
        num_states: *data
            .get(GROUP_NUM_STATES_OFFSET)
            .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
        state_probabilities,
        outcome_state_masks,
        statistical_discount_bps: read_u64(data, GROUP_STATISTICAL_DISCOUNT_OFFSET)?,
        seed_fee_pools,
        seed_fee_share_bps: read_u64(data, GROUP_SEED_FEE_SHARE_OFFSET)?,
        seed_positions,
        num_seed_positions: *data
            .get(GROUP_NUM_SEED_POSITIONS_OFFSET)
            .ok_or(QuadraticMarketError::InvalidRemainingAccount)?,
    }))
}

fn write_group_u64(group_info: &AccountInfo, offset: usize, value: u64) -> Result<()> {
    let mut data = group_info.data.borrow_mut();
    let slot = data
        .get_mut(8 + offset..8 + offset + 8)
        .ok_or(QuadraticMarketError::InvalidRemainingAccount)?;
    slot.copy_from_slice(&value.to_le_bytes());
    Ok(())
}

fn write_group_total_exposure(group_info: &AccountInfo, value: u64) -> Result<()> {
    write_group_u64(group_info, GROUP_TOTAL_EXPOSURE_OFFSET, value)
}

fn write_group_seed_fee_pool(group_info: &AccountInfo, market_index: usize, value: u64) -> Result<()> {
    write_group_u64(
        group_info,
        GROUP_SEED_FEE_POOLS_OFFSET + market_index * 8,
        value,
    )
}

#[inline(never)]
fn compute_group_aware_combined_odds_fp(
    legs: &[SlipLeg],
    num_legs: u8,
    leg_prices: &[u64],
    leg_markets: &[Box<Market>],
    leg_group_indices: &[Option<usize>],
    groups: &[Box<MarketGroupSnapshot>],
    house_margin_bps: u64,
    bonus_multiplier_bps: u64,
) -> Result<u64> {
    let mut odds_probabilities: Vec<u64> = Vec::with_capacity(num_legs as usize);
    let mut processed_groups: [bool; MAX_SLIP_LEGS] = [false; MAX_SLIP_LEGS];
    let mut extra_margin_applications: u8 = 0;
    let mut same_game_discount_bps: u128 = CORRELATION_MAX_BPS as u128;

    for leg_idx in 0..num_legs as usize {
            if let Some(g_idx) = leg_group_indices[leg_idx] {
            if processed_groups[g_idx] {
                continue;
            }
            processed_groups[g_idx] = true;

            let mut group_leg_indices: [usize; MAX_SLIP_LEGS] = [0usize; MAX_SLIP_LEGS];
            let mut group_leg_count: usize = 0;
            for scan_idx in 0..num_legs as usize {
                if leg_group_indices[scan_idx] == Some(g_idx) {
                    group_leg_indices[group_leg_count] = scan_idx;
                    group_leg_count += 1;
                }
            }

            let market_group = &groups[g_idx];
            let mut used_same_game_model = false;
            if group_leg_count > 1 && market_group.num_states > 0 {
                let mut logical_outcomes: Vec<LogicalOutcome> =
                    Vec::with_capacity(group_leg_count);
                let mut all_masks_configured = true;

                for local_idx in 0..group_leg_count {
                    let actual_leg_idx = group_leg_indices[local_idx];
                    let market = &leg_markets[actual_leg_idx];
                    let leg = &legs[actual_leg_idx];
                    let mask = market_group.outcome_state_masks
                        [market.group_market_index as usize][leg.outcome_id as usize];
                    if mask == 0 {
                        all_masks_configured = false;
                        break;
                    }
                    logical_outcomes.push(LogicalOutcome {
                        market_index: market.group_market_index,
                        outcome_id: leg.outcome_id,
                        state_mask: mask,
                    });
                }

                if all_masks_configured {
                    let joint_probability = compute_joint_probability_fp(
                        &logical_outcomes,
                        &market_group.state_probabilities,
                        market_group.num_states,
                    )?;
                    odds_probabilities.push(joint_probability);
                    extra_margin_applications = extra_margin_applications
                        .checked_add((group_leg_count - 1) as u8)
                        .ok_or(QuadraticMarketError::MathOverflow)?;
                    same_game_discount_bps = same_game_discount_bps
                        .checked_mul(market_group.statistical_discount_bps as u128)
                        .ok_or(QuadraticMarketError::MathOverflow)?
                        / CORRELATION_MAX_BPS as u128;
                    used_same_game_model = true;
                }
            }

            if !used_same_game_model {
                for local_idx in 0..group_leg_count {
                    odds_probabilities.push(leg_prices[group_leg_indices[local_idx]]);
                }
            }
        } else {
            odds_probabilities.push(leg_prices[leg_idx]);
        }
    }

    let mut combined_odds_fp = compute_combined_odds_fp(
        &odds_probabilities,
        odds_probabilities.len() as u8,
        house_margin_bps,
        bonus_multiplier_bps,
    )?;

    if extra_margin_applications > 0 {
        let margin_factor = CORRELATION_MAX_BPS
            .checked_sub(house_margin_bps)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        for _ in 0..extra_margin_applications {
            combined_odds_fp = ((combined_odds_fp as u128)
                .checked_mul(margin_factor as u128)
                .ok_or(QuadraticMarketError::MathOverflow)?
                / CORRELATION_MAX_BPS as u128) as u64;
        }
    }

    if same_game_discount_bps != CORRELATION_MAX_BPS as u128 {
        combined_odds_fp = ((combined_odds_fp as u128)
            .checked_mul(same_game_discount_bps)
            .ok_or(QuadraticMarketError::MathOverflow)?
            / CORRELATION_MAX_BPS as u128) as u64;
    }

    Ok(combined_odds_fp)
}

// ─── Place Slip ─────────────────────────────────────────────────

#[derive(Accounts)]
pub struct PlaceSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        init,
        payer = slip_creator,
        space = BetSlip::LEN,
        seeds = [seeds::BET_SLIP, global_config.next_slip_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub bet_slip: Box<Account<'info, BetSlip>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = slip_creator)]
    pub buyer_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub slip_creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn place_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, PlaceSlip<'info>>,
    legs: Vec<SlipLeg>,
    max_payment: u64,
    num_groups: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);

    let num_legs = legs.len() as u8;
    require!(num_legs > 0, QuadraticMarketError::SlipNoLegs);
    require!(
        num_legs <= MAX_SLIP_LEGS as u8,
        QuadraticMarketError::SlipTooManyLegs
    );

    let slip_id = config.next_slip_id;
    config.next_slip_id = config
        .next_slip_id
        .checked_add(1)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // remaining_accounts layout:
    //   Per-leg triplet: [Market, outcome_mint, slip_outcome_ata]  (3 × num_legs)
    //   Then: [MarketGroup, ...]                                   (num_groups)
    let accounts_per_leg = 3usize;
    let total_leg_accounts = num_legs as usize * accounts_per_leg;
    require!(
        ctx.remaining_accounts.len() >= total_leg_accounts + num_groups as usize,
        QuadraticMarketError::InvalidRemainingAccount
    );
    require!(
        (num_groups as usize) <= MAX_SLIP_LEGS,
        QuadraticMarketError::SlipTooManyLegs
    );

    if num_legs == 1 && num_groups == 0 {
        let leg = &legs[0];
        let market_info = &ctx.remaining_accounts[0];
        let outcome_mint_info = &ctx.remaining_accounts[1];
        let slip_outcome_ata_info = &ctx.remaining_accounts[2];

        let (expected_market_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            market_info.key() == expected_market_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        let mut market = deserialize_market_info(market_info)?;
        require!(
            market.status == MarketStatus::Open,
            QuadraticMarketError::MarketNotOpen
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now < market.start_time, QuadraticMarketError::MarketExpired);
        require!(
            (leg.outcome_id as usize) < market.num_outcomes as usize,
            QuadraticMarketError::InvalidOutcomeId
        );

        let (expected_mint_pda, _) = Pubkey::find_program_address(
            &[
                seeds::OUTCOME_MINT,
                leg.market_id.to_le_bytes().as_ref(),
                leg.outcome_id.to_le_bytes().as_ref(),
            ],
            &crate::ID,
        );
        require!(
            outcome_mint_info.key() == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        if slip_outcome_ata_info.data_is_empty() {
            associated_token::create(CpiContext::new(
                ctx.accounts.associated_token_program.to_account_info(),
                associated_token::Create {
                    payer: ctx.accounts.slip_creator.to_account_info(),
                    associated_token: slip_outcome_ata_info.clone(),
                    authority: ctx.accounts.bet_slip.to_account_info(),
                    mint: outcome_mint_info.clone(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
            ))?;
        }
        let ata_data = slip_outcome_ata_info.data.borrow();
        let slip_outcome_ata: TokenAccount = TokenAccount::try_deserialize(&mut ata_data.as_ref())
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(ata_data);
        require!(
            slip_outcome_ata.owner == ctx.accounts.bet_slip.key(),
            QuadraticMarketError::InvalidRemainingAccount
        );
        require!(
            slip_outcome_ata.mint == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        let total_cost = lmsr_buy_cost(
            &market.q_values,
            market.num_outcomes,
            leg.outcome_id,
            leg.num_shares,
            market.lmsr_b,
        )?;
        require!(
            total_cost <= max_payment,
            QuadraticMarketError::SlipCostExceeded
        );

        let price = lmsr_price(
            &market.q_values,
            market.num_outcomes,
            leg.outcome_id,
            market.lmsr_b,
        )?;
        let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
        let combined_odds_fp =
            compute_combined_odds_fp(&[price], num_legs, config.slip_house_margin_bps, bonus)?;
        let potential_payout = ((total_cost as u128)
            .checked_mul(combined_odds_fp as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?)
            / SCALE as u128;
        let potential_payout = potential_payout as u64;
        let bonus_gap = potential_payout.saturating_sub(total_cost);

        let free = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
        require!(
            free >= bonus_gap,
            QuadraticMarketError::InsufficientLiquidity
        );

        let profit = leg.num_shares.saturating_sub(total_cost);
        let new_exposure = market
            .exposure
            .checked_add(profit)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(
            new_exposure <= config.max_market_exposure,
            QuadraticMarketError::MaxExposureReached
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.buyer_base_ata.to_account_info(),
                    to: ctx.accounts.treasury_base_ata.to_account_info(),
                    authority: ctx.accounts.slip_creator.to_account_info(),
                },
            ),
            total_cost,
        )?;

        let market_id_bytes = leg.market_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] =
            &[&[seeds::MARKET, market_id_bytes.as_ref(), &[market.bump]]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: outcome_mint_info.clone(),
                    to: slip_outcome_ata_info.clone(),
                    authority: market_info.clone(),
                },
                signer_seeds,
            ),
            leg.num_shares,
        )?;

        market.q_values[leg.outcome_id as usize] = market.q_values[leg.outcome_id as usize]
            .checked_add(leg.num_shares)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        market.exposure = new_exposure;
        {
            let mut data_mut = market_info.data.borrow_mut();
            let mut writer = &mut data_mut[8..];
            market.serialize(&mut writer)?;
        }

        config.locked_payouts = config
            .locked_payouts
            .checked_add(bonus_gap)
            .ok_or(QuadraticMarketError::MathOverflow)?;

        let slip = &mut ctx.accounts.bet_slip;
        slip.slip_id = slip_id;
        slip.creator = ctx.accounts.slip_creator.key();
        let mut legs_arr = [SlipLeg::default(); MAX_SLIP_LEGS];
        legs_arr[0] = leg.clone();
        slip.legs = legs_arr;
        slip.num_legs = num_legs;
        slip.total_stake = total_cost;
        slip.combined_odds_fp = combined_odds_fp;
        slip.house_margin_bps = config.slip_house_margin_bps;
        slip.potential_payout = potential_payout;
        slip.locked_amount = bonus_gap;
        slip.exposure_locked = 0;
        slip.group_ids = [0u64; MAX_SLIP_LEGS];
        slip.group_exposure_locked = [0u64; MAX_SLIP_LEGS];
        slip.num_groups_locked = 0;
        slip.claimed = false;
        slip.is_seed = false;
        slip.seed_group_id = 0;
        slip.seed_position_index = 0;
        slip.bump = ctx.bumps.bet_slip;

        return Ok(());
    }

    // ── Phase A: validate markets, compute costs, track group exposure ──
    let mut total_cost: u64 = 0;
    let mut leg_prices: Vec<u64> = Vec::with_capacity(num_legs as usize);
    // Per-leg costs from Phase A (correlation-adjusted). Stored here so Phase C
    // can reuse them exactly — recomputing in Phase C without correlation context
    // would produce different values and corrupt exposure accounting (BUG-07).
    let mut leg_costs: Vec<u64> = Vec::with_capacity(num_legs as usize);
    // keep large Market structs on the heap to reduce stack usage
    let mut leg_markets: Vec<Box<Market>> = Vec::with_capacity(num_legs as usize);
    let mut leg_group_indices: Vec<Option<usize>> = Vec::with_capacity(num_legs as usize);

    // Accumulate exposure delta per group index (applied once per group at end)
    let mut group_exposure_deltas: Vec<u64> = vec![0u64; num_groups as usize];
    let mut group_seed_fee_deltas: Vec<[u64; MAX_OUTCOMES]> =
        vec![[0u64; MAX_OUTCOMES]; num_groups as usize];

    let mut i: u8 = 0;
    while i < num_legs {
        let leg = &legs[i as usize];
        let market_idx = (i as usize) * accounts_per_leg;
        let market_info = &ctx.remaining_accounts[market_idx];

        // Validate market PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            market_info.key() == expected_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // Deserialize using try_deserialize_unchecked (data[8..] skips the discriminator)
        let market = deserialize_market_info(market_info)?;

        require!(
            market.status == MarketStatus::Open,
            QuadraticMarketError::MarketNotOpen
        );

        // Betting stops when match starts
        let now = Clock::get()?.unix_timestamp;
        require!(now < market.start_time, QuadraticMarketError::MarketExpired);

        require!(
            (leg.outcome_id as usize) < market.num_outcomes as usize,
            QuadraticMarketError::InvalidOutcomeId
        );

        // Resolve group index for this leg.
        // Each group account is validated against its canonical PDA before
        // deserializing — prevents a crafted account with a matching group_id
        // field but fake max_group_exposure / zeroed correlations from bypassing
        // the exposure cap.
        let mut group_index: Option<usize> = None;
        if let Some(group_id) = market.group_id {
            if num_groups == 0 {
                require!(num_legs == 1, QuadraticMarketError::MarketGroupNotFound);
                group_index = None;
            } else {
            let mut found = false;
            for g in 0..num_groups as usize {
                let group_info = &ctx.remaining_accounts[total_leg_accounts + g];
                // Validate PDA before trusting any deserialized fields
                let (expected_group_pda, _) = Pubkey::find_program_address(
                    &[seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
                    &crate::ID,
                );
                if group_info.key() != expected_group_pda {
                    continue;
                }
                let group = deserialize_market_group_info(group_info)?;
                if group.group_id == group_id {
                    group_index = Some(g);
                    found = true;
                    break;
                }
            }
            require!(found, QuadraticMarketError::MarketGroupNotFound);
            }
        }

        // Compute cost — apply correlation adjustment when grouped
        let (leg_cost, leg_price) = if let Some(g_idx) = group_index {
            let group_info = &ctx.remaining_accounts[total_leg_accounts + g_idx];
            let market_group = deserialize_market_group_info(group_info)?;

            // Build correlated q_values array from leg markets already processed
            // plus search remaining_accounts for group peers not yet seen
            // allocate correlated_q on the heap to avoid large stack frames
            let mut correlated_q: Box<[[u64; MAX_OUTCOMES]; MAX_OUTCOMES]> =
                Box::new([[0u64; MAX_OUTCOMES]; MAX_OUTCOMES]);
            for c in 0..market_group.num_markets as usize {
                let corr_id = market_group.market_ids[c];
                if corr_id == 0 {
                    continue;
                }
                if corr_id == leg.market_id {
                    correlated_q[c] = market.q_values;
                    continue;
                }
                // Search already-deserialized legs for this market
                let mut found_in_legs = false;
                for prev_leg_idx in 0..leg_markets.len() {
                    if leg_markets[prev_leg_idx].market_id == corr_id {
                        correlated_q[c] = leg_markets[prev_leg_idx].q_values;
                        found_in_legs = true;
                        break;
                    }
                }
                if !found_in_legs {
                    // Try to find in remaining_accounts (other legs)
                    for la in 0..num_legs as usize {
                        if la == i as usize {
                            continue;
                        }
                        let ra_info = &ctx.remaining_accounts[la * accounts_per_leg];
                        let (peer_pda, _) = Pubkey::find_program_address(
                            &[seeds::MARKET, corr_id.to_le_bytes().as_ref()],
                            &crate::ID,
                        );
                        if ra_info.key() == peer_pda {
                            if let Ok(peer) = deserialize_market_info(ra_info) {
                                correlated_q[c] = peer.q_values;
                            }
                            break;
                        }
                    }
                }
            }

            let adjusted_q = compute_adjusted_q_values(
                &market.q_values,
                market.num_outcomes,
                market.group_market_index,
                &*correlated_q,
                &market_group.correlations,
                market_group.num_correlations,
            )?;

            let cost = lmsr_buy_cost(
                &adjusted_q,
                market.num_outcomes,
                leg.outcome_id,
                leg.num_shares,
                market.lmsr_b,
            )?;
            let price = lmsr_price(
                &adjusted_q,
                market.num_outcomes,
                leg.outcome_id,
                market.lmsr_b,
            )?;

            // Accumulate exposure delta for this group (not applied yet — done once after Phase A)
            let leg_profit = leg.num_shares.saturating_sub(cost);
            group_exposure_deltas[g_idx] = group_exposure_deltas[g_idx]
                .checked_add(leg_profit)
                .ok_or(QuadraticMarketError::MathOverflow)?;

            let has_market_seed = (0..market_group.num_seed_positions as usize).any(|idx| {
                market_group.seed_positions[idx].market_index == market.group_market_index
            });
            if has_market_seed
                && config.slip_house_margin_bps > 0
                && market_group.seed_fee_share_bps > 0
            {
                let margin_fee = (cost as u128)
                    .checked_mul(config.slip_house_margin_bps as u128)
                    .ok_or(QuadraticMarketError::MathOverflow)?
                    / CORRELATION_MAX_BPS as u128;
                let seed_fee = margin_fee
                    .checked_mul(market_group.seed_fee_share_bps as u128)
                    .ok_or(QuadraticMarketError::MathOverflow)?
                    / CORRELATION_MAX_BPS as u128;
                let market_seed_fee = &mut group_seed_fee_deltas[g_idx]
                    [market.group_market_index as usize];
                *market_seed_fee = market_seed_fee
                    .checked_add(seed_fee as u64)
                    .ok_or(QuadraticMarketError::MathOverflow)?;
            }

            (cost, price)
        } else {
            let cost = lmsr_buy_cost(
                &market.q_values,
                market.num_outcomes,
                leg.outcome_id,
                leg.num_shares,
                market.lmsr_b,
            )?;
            let price = lmsr_price(
                &market.q_values,
                market.num_outcomes,
                leg.outcome_id,
                market.lmsr_b,
            )?;
            (cost, price)
        };

        total_cost = total_cost
            .checked_add(leg_cost)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        leg_prices.push(leg_price);
        leg_costs.push(leg_cost);
        leg_group_indices.push(group_index);
        // move the Market onto the heap
        leg_markets.push(market);

        // Validate outcome mint PDA
        let mint_info = &ctx.remaining_accounts[market_idx + 1];
        let (expected_mint_pda, _) = Pubkey::find_program_address(
            &[
                seeds::OUTCOME_MINT,
                leg.market_id.to_le_bytes().as_ref(),
                leg.outcome_id.to_le_bytes().as_ref(),
            ],
            &crate::ID,
        );
        require!(
            mint_info.key() == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // The slip owns the outcome-token position. This prevents the user from
        // transferring leg shares away and then claiming the slip payout as well.
        let slip_outcome_ata_info = &ctx.remaining_accounts[market_idx + 2];
        if slip_outcome_ata_info.data_is_empty() {
            associated_token::create(CpiContext::new(
                ctx.accounts.associated_token_program.to_account_info(),
                associated_token::Create {
                    payer: ctx.accounts.slip_creator.to_account_info(),
                    associated_token: slip_outcome_ata_info.clone(),
                    authority: ctx.accounts.bet_slip.to_account_info(),
                    mint: mint_info.clone(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
            ))?;
        }
        let ata_data = slip_outcome_ata_info.data.borrow();
        let slip_outcome_ata: TokenAccount = TokenAccount::try_deserialize(&mut ata_data.as_ref())
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(ata_data);
        require!(
            slip_outcome_ata.owner == ctx.accounts.bet_slip.key(),
            QuadraticMarketError::InvalidRemainingAccount
        );
        require!(
            slip_outcome_ata.mint == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        i += 1;
    }

    // Validate group exposure caps — once per group using the total accumulated delta
    for g_idx in 0..num_groups as usize {
        if group_exposure_deltas[g_idx] == 0 {
            continue;
        }
        let group_info = &ctx.remaining_accounts[total_leg_accounts + g_idx];
        let group = deserialize_market_group_info(group_info)?;

        let new_exposure = group
            .total_group_exposure
            .checked_add(group_exposure_deltas[g_idx])
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(
            new_exposure <= group.max_group_exposure,
            QuadraticMarketError::GroupExposureExceeded
        );
    }

    // Compute combined odds with house margin and bonus. When multiple legs
    // belong to a group with a configured same-game state model, collapse those
    // legs into one joint probability so correlated outcomes are not priced as
    // independent events.
    let house_margin_bps = config.slip_house_margin_bps;
    let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
    // store MarketGroup on heap to keep stack usage low
    let mut groups: Vec<Box<MarketGroupSnapshot>> = Vec::with_capacity(num_groups as usize);
    for g_idx in 0..num_groups as usize {
        let group_info = &ctx.remaining_accounts[total_leg_accounts + g_idx];
        let group = deserialize_market_group_info(group_info)?;
        groups.push(group);
    }
    let combined_odds_fp = compute_group_aware_combined_odds_fp(
        &legs,
        num_legs,
        &leg_prices,
        &leg_markets,
        &leg_group_indices,
        &groups,
        house_margin_bps,
        bonus,
    )?;

    let potential_payout = ((total_cost as u128)
        .checked_mul(combined_odds_fp as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?)
        / SCALE as u128;
    let potential_payout = potential_payout as u64;

    require!(
        total_cost <= max_payment,
        QuadraticMarketError::SlipCostExceeded
    );

    // The base payout (total_cost) is self-funded by losing bettors in each market pool —
    // it does not require LP backing. LP only covers the bonus premium above fair value.
    // Locking the full potential_payout would massively over-collateralise the protocol.
    let bonus_gap = potential_payout.saturating_sub(total_cost);

    // Liquidity check: LP only needs to cover the bonus gap
    let treasury_balance = ctx.accounts.treasury_base_ata.amount;
    let free = config.free_liquidity(treasury_balance);
    require!(
        free >= bonus_gap,
        QuadraticMarketError::InsufficientLiquidity
    );

    // ── Phase B: collect payment ──────────────────────────────────────────────
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.buyer_base_ata.to_account_info(),
                to: ctx.accounts.treasury_base_ata.to_account_info(),
                authority: ctx.accounts.slip_creator.to_account_info(),
            },
        ),
        total_cost,
    )?;

    // ── Phase C: mint outcome tokens + update market/group state ─────────────
    // Track which group indices have already been updated to avoid double-application
    let mut updated_groups: [bool; 8] = [false; 8];
    let mut total_exposure_locked: u64 = 0;
    let mut total_seed_fee_locked: u64 = 0;

    let mut leg_idx: u8 = 0;
    while leg_idx < num_legs {
        let leg = &legs[leg_idx as usize];
        let market_info = &ctx.remaining_accounts[(leg_idx as usize) * accounts_per_leg];
        let outcome_mint_info = &ctx.remaining_accounts[(leg_idx as usize) * accounts_per_leg + 1];
        let slip_outcome_ata_info =
            &ctx.remaining_accounts[(leg_idx as usize) * accounts_per_leg + 2];
        let bump = leg_markets[leg_idx as usize].bump;

        // Mint outcome tokens
        let market_id_bytes = leg.market_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[seeds::MARKET, market_id_bytes.as_ref(), &[bump]]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: outcome_mint_info.clone(),
                    to: slip_outcome_ata_info.clone(),
                    authority: market_info.clone(),
                },
                signer_seeds,
            ),
            leg.num_shares,
        )?;

        // Update market state via deserialize → modify → serialize.
        // Use the Phase A cost (correlation-adjusted) — recomputing here without
        // the full correlation context would give a different value (BUG-07).
        {
            let phase_a_cost = leg_costs[leg_idx as usize];
            let profit = leg.num_shares.saturating_sub(phase_a_cost);

            let mut market = deserialize_market_info(market_info)?;

            market.q_values[leg.outcome_id as usize] = market.q_values[leg.outcome_id as usize]
                .checked_add(leg.num_shares)
                .ok_or(QuadraticMarketError::MathOverflow)?;
            market.exposure = market
                .exposure
                .checked_add(profit)
                .ok_or(QuadraticMarketError::MathOverflow)?;

            let mut data_mut = market_info.data.borrow_mut();
            let mut writer = &mut data_mut[8..];
            market.serialize(&mut writer)?;
        }

        // Update group exposure — once per unique group
        if let Some(g_idx) = leg_group_indices[leg_idx as usize] {
            if !updated_groups[g_idx] {
                updated_groups[g_idx] = true;
                let delta = group_exposure_deltas[g_idx];
                total_exposure_locked = total_exposure_locked
                    .checked_add(delta)
                    .ok_or(QuadraticMarketError::MathOverflow)?;

                let group_info = &ctx.remaining_accounts[total_leg_accounts + g_idx];
                let mut market_group = deserialize_market_group_info(group_info)?;

                market_group.total_group_exposure = market_group
                    .total_group_exposure
                    .checked_add(delta)
                    .ok_or(QuadraticMarketError::MathOverflow)?;
                write_group_total_exposure(group_info, market_group.total_group_exposure)?;
                for market_index in 0..market_group.num_markets as usize {
                    let seed_fee_delta = group_seed_fee_deltas[g_idx][market_index];
                    if seed_fee_delta > 0 {
                        market_group.seed_fee_pools[market_index] = market_group.seed_fee_pools
                            [market_index]
                            .checked_add(seed_fee_delta)
                            .ok_or(QuadraticMarketError::MathOverflow)?;
                        write_group_seed_fee_pool(
                            group_info,
                            market_index,
                            market_group.seed_fee_pools[market_index],
                        )?;
                        total_seed_fee_locked = total_seed_fee_locked
                            .checked_add(seed_fee_delta)
                            .ok_or(QuadraticMarketError::MathOverflow)?;
                    }
                }
            }
        }

        leg_idx += 1;
    }

    // Lock only the bonus gap and reserved seed-fee rewards against LP reserves.
    // The base payout (total_cost) is covered by the losing bettors' stakes
    // already sitting in each market's pool.
    config.locked_payouts = config
        .locked_payouts
        .checked_add(bonus_gap)
        .ok_or(QuadraticMarketError::MathOverflow)?
        .checked_add(total_seed_fee_locked)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Write BetSlip
    let slip = &mut ctx.accounts.bet_slip;
    slip.slip_id = slip_id;
    slip.creator = ctx.accounts.slip_creator.key();
    let mut legs_arr = [SlipLeg::default(); MAX_SLIP_LEGS];
    for ci in 0..num_legs as usize {
        legs_arr[ci] = legs[ci].clone();
    }
    slip.legs = legs_arr;
    slip.num_legs = num_legs;
    slip.total_stake = total_cost;
    slip.combined_odds_fp = combined_odds_fp;
    slip.house_margin_bps = house_margin_bps;
    slip.potential_payout = potential_payout;
    slip.locked_amount = bonus_gap; // only the LP-backed premium, not the full payout
    slip.exposure_locked = total_exposure_locked;
    slip.group_ids = [0u64; MAX_SLIP_LEGS];
    slip.group_exposure_locked = [0u64; MAX_SLIP_LEGS];
    slip.num_groups_locked = 0;
    for g_idx in 0..num_groups as usize {
        if group_exposure_deltas[g_idx] == 0 {
            continue;
        }
        let group_info = &ctx.remaining_accounts[total_leg_accounts + g_idx];
        let group = deserialize_market_group_info(group_info)?;
        let out_idx = slip.num_groups_locked as usize;
        require!(
            out_idx < MAX_SLIP_LEGS,
            QuadraticMarketError::SlipTooManyLegs
        );
        slip.group_ids[out_idx] = group.group_id;
        slip.group_exposure_locked[out_idx] = group_exposure_deltas[g_idx];
        slip.num_groups_locked += 1;
    }
    slip.claimed = false;
    slip.bump = ctx.bumps.bet_slip;

    Ok(())
}

// ─── Claim Slip ─────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct ClaimSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
        constraint = bet_slip.creator == claimer.key() @ QuadraticMarketError::Unauthorized,
        close = claimer,
    )]
    pub bet_slip: Box<Account<'info, BetSlip>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = claimer)]
    pub claimer_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn claim_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ClaimSlip<'info>>,
    _slip_id: u64,
    _num_groups: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.bet_slip;

    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(slip.num_legs > 0, QuadraticMarketError::SlipNoLegs);

    // remaining_accounts: [Market, outcome_mint, slip_outcome_ata] × num_legs
    //                     then [MarketGroup] × slip.num_groups_locked
    let accounts_per_leg = 3usize;
    let total_leg_accounts = slip.num_legs as usize * accounts_per_leg;
    let group_accounts = slip.num_groups_locked as usize;
    require!(
        ctx.remaining_accounts.len() >= total_leg_accounts + group_accounts,
        QuadraticMarketError::InvalidRemainingAccount
    );

    let mut all_won = true;
    let mut slip_voided = false;
    let mut num_legs_settled: u8 = 0;
    let mut final_leg_prices: Vec<u64> = Vec::with_capacity(slip.num_legs as usize);
    // keep Market on heap
    let mut final_leg_markets: Vec<Box<Market>> = Vec::with_capacity(slip.num_legs as usize);
    let mut final_leg_group_indices: Vec<Option<usize>> =
        Vec::with_capacity(slip.num_legs as usize);
    let mut final_groups: Vec<Box<MarketGroupSnapshot>> = Vec::with_capacity(group_accounts);
    for g in 0..group_accounts {
        let group_id = slip.group_ids[g];
        let group_info = &ctx.remaining_accounts[total_leg_accounts + g];
        let (expected_group_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            group_info.key() == expected_group_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );
        let group = deserialize_market_group_info(group_info)?;
        require!(
            group.group_id == group_id,
            QuadraticMarketError::InvalidRemainingAccount
        );
        final_groups.push(group);
    }
    let slip_id_bytes = slip.slip_id.to_le_bytes();
    let slip_seeds: &[&[&[u8]]] = &[&[seeds::BET_SLIP, slip_id_bytes.as_ref(), &[slip.bump]]];

    let mut leg_idx: u8 = 0;
    while leg_idx < slip.num_legs {
        let leg = &slip.legs[leg_idx as usize];
        let base_idx = (leg_idx as usize) * accounts_per_leg;

        let market_info = &ctx.remaining_accounts[base_idx];
        let outcome_mint_info = &ctx.remaining_accounts[base_idx + 1];
        let slip_outcome_ata_info = &ctx.remaining_accounts[base_idx + 2];

        // Validate market PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            market_info.key() == expected_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        let market = deserialize_market_info(market_info)?;
        let group_index = market
            .group_id
            .and_then(|gid| final_groups.iter().position(|g| g.group_id == gid));
        final_leg_group_indices.push(group_index);

        // Validate outcome mint PDA
        let (expected_mint_pda, _) = Pubkey::find_program_address(
            &[
                seeds::OUTCOME_MINT,
                leg.market_id.to_le_bytes().as_ref(),
                leg.outcome_id.to_le_bytes().as_ref(),
            ],
            &crate::ID,
        );
        require!(
            outcome_mint_info.key() == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // Burn the escrowed slip shares. The token account is owned by the slip
        // PDA, so users cannot transfer the position out before claiming.
        let ata_data = slip_outcome_ata_info.data.borrow();
        let slip_outcome_ata: TokenAccount = TokenAccount::try_deserialize(&mut ata_data.as_ref())?;
        drop(ata_data);
        require!(
            slip_outcome_ata.owner == slip.key(),
            QuadraticMarketError::InvalidRemainingAccount
        );
        require!(
            slip_outcome_ata.mint == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );
        require!(
            slip_outcome_ata.amount >= leg.num_shares,
            QuadraticMarketError::InsufficientShares
        );

        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: outcome_mint_info.clone(),
                    from: slip_outcome_ata_info.clone(),
                    authority: slip.to_account_info(),
                },
                slip_seeds,
            ),
            leg.num_shares,
        )?;

        if market.status == MarketStatus::Voided {
            slip_voided = true;
            num_legs_settled += 1;
            leg_idx += 1;
            continue;
        }

        require!(
            market.status == MarketStatus::Settled,
            QuadraticMarketError::SlipNotSettled
        );
        num_legs_settled += 1;

        let price = lmsr_price(
            &market.q_values,
            market.num_outcomes,
            leg.outcome_id,
            market.lmsr_b,
        )?;
        final_leg_prices.push(price);

        if market.winning_outcome != leg.outcome_id {
            all_won = false;
        }

        final_leg_markets.push(market);
        leg_idx += 1;
    }

    require!(
        num_legs_settled == slip.num_legs,
        QuadraticMarketError::SlipNotSettled
    );

    let mut final_payout: u64 = 0;
    if !slip_voided && all_won {
        require!(
            final_leg_prices.len() == slip.num_legs as usize,
            QuadraticMarketError::InvalidRemainingAccount
        );
        let bonus = compute_bonus_multiplier(slip.num_legs, config.max_slip_bonus_multiplier_bps)?;
        let final_odds_fp = compute_group_aware_combined_odds_fp(
            &slip.legs,
            slip.num_legs,
            &final_leg_prices,
            &final_leg_markets,
            &final_leg_group_indices,
            &final_groups,
            slip.house_margin_bps,
            bonus,
        )?;
        final_payout = ((slip.total_stake as u128)
            .checked_mul(final_odds_fp as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?)
        .checked_div(SCALE as u128)
        .ok_or(QuadraticMarketError::MathOverflow)? as u64;

        let final_bonus_gap = final_payout.saturating_sub(slip.total_stake);
        let available_bonus = config
            .free_liquidity(ctx.accounts.treasury_base_ata.amount)
            .checked_add(slip.locked_amount)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(
            available_bonus >= final_bonus_gap,
            QuadraticMarketError::InsufficientLiquidity
        );
    }

    slip.claimed = true;

    // Release locked_payouts using the actual locked_amount on the slip
    config.locked_payouts = config.locked_payouts.saturating_sub(slip.locked_amount);

    // Release only the exact group exposure records stored on the slip.
    if group_accounts > 0 {
        for g in 0..group_accounts {
            let group_id = slip.group_ids[g];
            let exposure = slip.group_exposure_locked[g];
            if exposure == 0 {
                continue;
            }
            let group_info = &ctx.remaining_accounts[total_leg_accounts + g];
            let (expected_group_pda, _) = Pubkey::find_program_address(
                &[seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
                &crate::ID,
            );
            require!(
                group_info.key() == expected_group_pda,
                QuadraticMarketError::InvalidRemainingAccount
            );

            let mut market_group = deserialize_market_group_info(group_info)?;
            require!(
                market_group.group_id == group_id,
                QuadraticMarketError::InvalidRemainingAccount
            );

            market_group.total_group_exposure =
                market_group.total_group_exposure.saturating_sub(exposure);
            write_group_total_exposure(group_info, market_group.total_group_exposure)?;
        }
    }

    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];

    if slip_voided {
        // Refund total stake on voided slip
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
            slip.total_stake,
        )?;
        return Ok(());
    }

    if all_won {
        // Pay from final market prices, not the placement-time quote.
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
            final_payout,
        )?;
    }
    // Lost slip: house keeps total_stake, nothing transferred

    Ok(())
}

// ─── Update Slip Lock ──────────────────────────────────────────
// Refreshes the LP-backed bonus reserve as live market prices move. Slip payout
// is not fixed at placement; claim recomputes it from the final settled prices.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct UpdateSlipLock<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
    )]
    pub bet_slip: Box<Account<'info, BetSlip>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    pub updater: Signer<'info>,
}

pub fn update_slip_lock_handler(ctx: Context<UpdateSlipLock>, _slip_id: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.bet_slip;

    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(slip.num_legs > 0, QuadraticMarketError::SlipNoLegs);

    let num_legs = slip.num_legs;
    let group_accounts = slip.num_groups_locked as usize;
    require!(
        ctx.remaining_accounts.len() >= num_legs as usize + group_accounts,
        QuadraticMarketError::InvalidRemainingAccount
    );

    let mut leg_prices: Vec<u64> = Vec::with_capacity(num_legs as usize);
    let mut leg_markets: Vec<Box<Market>> = Vec::with_capacity(num_legs as usize);
    let mut leg_group_indices: Vec<Option<usize>> = Vec::with_capacity(num_legs as usize);
    let mut groups: Vec<Box<MarketGroupSnapshot>> = Vec::with_capacity(group_accounts);

    for g in 0..group_accounts {
        let group_id = slip.group_ids[g];
        let group_info = &ctx.remaining_accounts[num_legs as usize + g];
        let (expected_group_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            group_info.key() == expected_group_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );
        let group = deserialize_market_group_info(group_info)?;
        require!(
            group.group_id == group_id,
            QuadraticMarketError::InvalidRemainingAccount
        );
        groups.push(group);
    }

    for leg_idx in 0..num_legs as usize {
        let leg = &slip.legs[leg_idx];
        let market_info = &ctx.remaining_accounts[leg_idx];

        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            market_info.key() == expected_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        let market = deserialize_market_info(market_info)?;
        let group_index = market
            .group_id
            .and_then(|gid| groups.iter().position(|g| g.group_id == gid));

        let price = lmsr_price(
            &market.q_values,
            market.num_outcomes,
            leg.outcome_id,
            market.lmsr_b,
        )?;
        leg_prices.push(price);
        leg_group_indices.push(group_index);
        leg_markets.push(market);
    }

    let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
    let current_combined_odds_fp = compute_group_aware_combined_odds_fp(
        &slip.legs,
        num_legs,
        &leg_prices,
        &leg_markets,
        &leg_group_indices,
        &groups,
        slip.house_margin_bps,
        bonus,
    )?;

    let current_payout = ((slip.total_stake as u128)
        .checked_mul(current_combined_odds_fp as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?)
        / SCALE as u128;
    let current_payout = current_payout as u64;

    // locked_amount tracks the bonus gap (payout - stake), not the full payout.
    // Recompute the current bonus gap to compare against the stored lock.
    let current_bonus_gap = current_payout.saturating_sub(slip.total_stake);

    if current_bonus_gap > slip.locked_amount {
        let delta = current_bonus_gap
            .checked_sub(slip.locked_amount)
            .ok_or(QuadraticMarketError::MathUnderflow)?;
        let free = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
        require!(free >= delta, QuadraticMarketError::InsufficientLiquidity);
        slip.locked_amount = current_bonus_gap;
        config.locked_payouts = config
            .locked_payouts
            .checked_add(delta)
            .ok_or(QuadraticMarketError::MathOverflow)?;
    } else if current_bonus_gap < slip.locked_amount {
        let delta = slip.locked_amount - current_bonus_gap;
        slip.locked_amount = current_bonus_gap;
        config.locked_payouts = config.locked_payouts.saturating_sub(delta);
    }

    Ok(())
}

// ─── Cash Out Slip ──────────────────────────────────────────────
//
// Allows the slip creator to exit their position early at the current LMSR
// fair value, minus a configurable house margin (cash_out_margin_bps).
//
// Fair value = stake × current_combined_odds (recomputed live from LMSR prices).
// Cash-out payout = fair_value × (10_000 - cash_out_margin_bps) / 10_000.
//
// remaining_accounts: [market, outcome_mint, slip_outcome_ata] per leg,
// then [MarketGroup] × bet_slip.num_groups_locked.
// The slip PDA is closed and rent returned to the claimer.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct CashOutSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
        constraint = bet_slip.creator == claimer.key() @ QuadraticMarketError::Unauthorized,
        close = claimer,
    )]
    pub bet_slip: Box<Account<'info, BetSlip>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = claimer)]
    pub claimer_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn cash_out_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CashOutSlip<'info>>,
    _slip_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &ctx.accounts.bet_slip;

    require!(!config.paused, QuadraticMarketError::Paused);
    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(slip.num_legs > 0, QuadraticMarketError::SlipNoLegs);

    // remaining_accounts layout: [market, outcome_mint, slip_outcome_ata] per leg,
    // then [MarketGroup] × slip.num_groups_locked.
    require!(
        ctx.remaining_accounts.len()
            >= (slip.num_legs as usize) * 3 + slip.num_groups_locked as usize,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // Recompute current combined odds from live LMSR prices
    let num_legs = slip.num_legs;
    let group_accounts = slip.num_groups_locked as usize;
    let total_leg_accounts = num_legs as usize * 3;
    let mut leg_prices: Vec<u64> = Vec::with_capacity(num_legs as usize);
    let mut leg_markets: Vec<Box<Market>> = Vec::with_capacity(num_legs as usize);
    let mut leg_group_indices: Vec<Option<usize>> = Vec::with_capacity(num_legs as usize);
    let mut groups: Vec<Box<MarketGroupSnapshot>> = Vec::with_capacity(group_accounts);

    for g in 0..group_accounts {
        let group_id = slip.group_ids[g];
        let group_info = &ctx.remaining_accounts[num_legs as usize + g];
        let (expected_group_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            group_info.key() == expected_group_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );
        let group = deserialize_market_group_info(group_info)?;
        require!(
            group.group_id == group_id,
            QuadraticMarketError::InvalidRemainingAccount
        );
        groups.push(group);
    }

    for leg_idx in 0..num_legs as usize {
        let leg = &slip.legs[leg_idx];
        let market_info = &ctx.remaining_accounts[leg_idx * 3];
        let outcome_mint_info = &ctx.remaining_accounts[leg_idx * 3 + 1];
        let slip_outcome_ata_info = &ctx.remaining_accounts[leg_idx * 3 + 2];

        // Validate market PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            market_info.key() == expected_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        let market = deserialize_market_info(market_info)?;
        let group_index = market
            .group_id
            .and_then(|gid| groups.iter().position(|g| g.group_id == gid));

        // Can only cash out while the market is still open
        require!(
            market.status == MarketStatus::Open,
            QuadraticMarketError::MarketNotOpen
        );

        let price = lmsr_price(
            &market.q_values,
            market.num_outcomes,
            leg.outcome_id,
            market.lmsr_b,
        )?;
        leg_prices.push(price);
        leg_group_indices.push(group_index);
        leg_markets.push(market);

        let (expected_mint_pda, _) = Pubkey::find_program_address(
            &[
                seeds::OUTCOME_MINT,
                leg.market_id.to_le_bytes().as_ref(),
                leg.outcome_id.to_le_bytes().as_ref(),
            ],
            &crate::ID,
        );
        require!(
            outcome_mint_info.key() == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        let ata_data = slip_outcome_ata_info.data.borrow();
        let ata: TokenAccount = TokenAccount::try_deserialize(&mut ata_data.as_ref())
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(ata_data);
        require!(
            ata.owner == ctx.accounts.bet_slip.key(),
            QuadraticMarketError::InvalidRemainingAccount
        );
        require!(
            ata.mint == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );
        require!(
            ata.amount >= leg.num_shares,
            QuadraticMarketError::InsufficientShares
        );
    }

    // Current fair value = stake × current_combined_odds (with original margin + bonus)
    let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
    let current_odds_fp = compute_group_aware_combined_odds_fp(
        &slip.legs,
        num_legs,
        &leg_prices,
        &leg_markets,
        &leg_group_indices,
        &groups,
        slip.house_margin_bps,
        bonus,
    )?;

    let fair_value = ((slip.total_stake as u128)
        .checked_mul(current_odds_fp as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?)
        / SCALE as u128;

    // Apply cash-out margin — house keeps a cut for providing early-exit liquidity
    let cash_out_margin_bps = config.cash_out_margin_bps;
    let cash_out_payout = (fair_value
        .checked_mul(
            (10_000u128)
                .checked_sub(cash_out_margin_bps as u128)
                .ok_or(QuadraticMarketError::MathOverflow)?,
        )
        .ok_or(QuadraticMarketError::MathOverflow)?)
        / 10_000;
    let cash_out_payout = cash_out_payout as u64;

    require!(cash_out_payout > 0, QuadraticMarketError::InvalidAmount);

    // Release the bonus gap that was locked against LP reserves
    config.locked_payouts = config.locked_payouts.saturating_sub(slip.locked_amount);

    // Transfer cash-out value to claimer
    let treasury_seeds: &[&[&[u8]]] = &[&[seeds::TREASURY, &[config.treasury_bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.treasury_base_ata.to_account_info(),
                to: ctx.accounts.claimer_base_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            treasury_seeds,
        ),
        cash_out_payout,
    )?;

    // Burn escrowed outcome tokens for each leg.
    let slip_id_bytes = slip.slip_id.to_le_bytes();
    let slip_seeds: &[&[&[u8]]] = &[&[seeds::BET_SLIP, slip_id_bytes.as_ref(), &[slip.bump]]];
    for leg_idx in 0..num_legs as usize {
        let leg = &slip.legs[leg_idx];
        let outcome_mint_info = &ctx.remaining_accounts[leg_idx * 3 + 1];
        let outcome_ata_info = &ctx.remaining_accounts[leg_idx * 3 + 2];
        let ata_data = outcome_ata_info.data.borrow();
        let _ata: TokenAccount = TokenAccount::try_deserialize(&mut ata_data.as_ref())
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(ata_data);
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: outcome_mint_info.clone(),
                    from: outcome_ata_info.clone(),
                    authority: ctx.accounts.bet_slip.to_account_info(),
                },
                slip_seeds,
            ),
            leg.num_shares,
        )?;
    }

    // Release exact group exposure records stored on the slip.
    for g in 0..slip.num_groups_locked as usize {
        let group_id = slip.group_ids[g];
        let exposure = slip.group_exposure_locked[g];
        if exposure == 0 {
            continue;
        }
        let group_info = &ctx.remaining_accounts[total_leg_accounts + g];
        let (expected_group_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET_GROUP, group_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            group_info.key() == expected_group_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );
        let mut market_group = deserialize_market_group_info(group_info)?;
        require!(
            market_group.group_id == group_id,
            QuadraticMarketError::InvalidRemainingAccount
        );
        market_group.total_group_exposure =
            market_group.total_group_exposure.saturating_sub(exposure);
        write_group_total_exposure(group_info, market_group.total_group_exposure)?;
    }

    Ok(())
}

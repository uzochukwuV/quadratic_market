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
use crate::state::{BetSlip, GlobalConfig, Market, MarketMode, MarketStatus, SlipLeg, SlipStatus};
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

// Byte offsets of individual Market fields within the account data (including the
// 8-byte Anchor discriminator). Used to read just the settlement-relevant fields
// without deserializing the whole Market (which allocates heap for its String
// fields). Layout: disc(8) + market_id(8) + creator(32) + start_time(8) +
// status(1) + num_outcomes(1) + q_values(64) + exposure(8) + settlement_time(8) +
// winning_outcome(1) + ...
const MARKET_STATUS_OFFSET: usize = 8 + 8 + 32 + 8; // = 56
const MARKET_WINNING_OUTCOME_OFFSET: usize = 8 + 8 + 32 + 8 + 1 + 1 + 64 + 8 + 8; // = 138

/// Heap-light read of just `status` and `winning_outcome` from a Market account.
/// Avoids the full `Market` deserialize (and its String heap allocations), which
/// is what makes multi-leg claim_slip exhaust the bump heap.
fn read_market_settlement_fields(market_info: &AccountInfo) -> Result<(u8, u8)> {
    let data = market_info.data.borrow();
    let status = *data
        .get(MARKET_STATUS_OFFSET)
        .ok_or(QuadraticMarketError::InvalidRemainingAccount)?;
    let winning_outcome = *data
        .get(MARKET_WINNING_OUTCOME_OFFSET)
        .ok_or(QuadraticMarketError::InvalidRemainingAccount)?;
    Ok((status, winning_outcome))
}

/// Reduce market.backing to credit winning leg value to LP when slip loses.
/// Uses zero-copy write to avoid deserializing the entire Market (heap-heavy).
fn reduce_market_backing(market_info: &AccountInfo, amount: u64) -> Result<()> {
    // Market struct layout (Borsh):
    //   disc(8) + market_id(8) + creator(32) + start_time(8) + status(1) +
    //   num_outcomes(1) + q_values(64) + exposure(8) + settlement_time(8) +
    //   winning_outcome(1) + outcome_mints(256) + lmsr_b(8) +
    //   title(4+len) + description(4+len) + category(1) + bump(1) +
    //   group_id(9) + group_market_index(1) + market_mode(1) + epoch_id(8) +
    //   settled_in_epoch(1) + backing(8)
    //
    // Strings are variable-length, so we parse from the fixed-length fields to
    // find where backing starts.
    const LMSR_B_OFFSET: usize = 8 + 8 + 32 + 8 + 1 + 1 + 64 + 8 + 8 + 1 + 256; // = 395
    
    let mut data = market_info.try_borrow_mut_data()?;
    
    // Read title length (4 bytes after lmsr_b)
    let title_len_offset = LMSR_B_OFFSET + 8;
    let title_len = u32::from_le_bytes(
        data[title_len_offset..title_len_offset + 4]
            .try_into()
            .unwrap()
    ) as usize;
    
    // Read description length (4 bytes after title)
    let desc_len_offset = title_len_offset + 4 + title_len;
    let desc_len = u32::from_le_bytes(
        data[desc_len_offset..desc_len_offset + 4]
            .try_into()
            .unwrap()
    ) as usize;
    
    // Calculate backing offset:
    //   after description + category(1) + bump(1) + group_id(9) +
    //   group_market_index(1) + market_mode(1) + epoch_id(8) + settled_in_epoch(1)
    let backing_offset = desc_len_offset + 4 + desc_len + 1 + 1 + 9 + 1 + 1 + 8 + 1;
    
    // Read current backing
    let mut backing = u64::from_le_bytes(
        data[backing_offset..backing_offset + 8]
            .try_into()
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?
    );
    
    // Reduce backing (saturating to avoid underflow)
    backing = backing.saturating_sub(amount);
    
    // Write back
    data[backing_offset..backing_offset + 8].copy_from_slice(&backing.to_le_bytes());
    
    Ok(())
}

// MarketStatus Borsh discriminants (ordinal order in the enum).
const MARKET_STATUS_SETTLED: u8 = 5;
const MARKET_STATUS_VOIDED: u8 = 6;

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

fn write_group_seed_fee_pool(
    group_info: &AccountInfo,
    market_index: usize,
    value: u64,
) -> Result<()> {
    write_group_u64(
        group_info,
        GROUP_SEED_FEE_POOLS_OFFSET + market_index * 8,
        value,
    )
}

fn compute_slip_payout_from_legs(
    legs: &[SlipLeg],
    num_legs: u8,
    bonus_multiplier_bps: u64,
) -> Result<u64> {
    let mut base_payout: u64 = 0;
    for leg in legs.iter().take(num_legs as usize) {
        base_payout = base_payout
            .checked_add(leg.num_shares)
            .ok_or(QuadraticMarketError::MathOverflow)?;
    }

    let bonus = if num_legs >= 2 && bonus_multiplier_bps > CORRELATION_MAX_BPS {
        base_payout
            .checked_mul(
                bonus_multiplier_bps
                    .checked_sub(CORRELATION_MAX_BPS)
                    .ok_or(QuadraticMarketError::MathUnderflow)?,
            )
            .ok_or(QuadraticMarketError::MathOverflow)?
            / CORRELATION_MAX_BPS
    } else {
        0
    };

    base_payout
        .checked_add(bonus)
        .ok_or(QuadraticMarketError::MathOverflow.into())
}

fn compute_effective_odds_fp(total_stake: u64, potential_payout: u64) -> Result<u64> {
    require!(total_stake > 0, QuadraticMarketError::InvalidAmount);
    let odds = (potential_payout as u128)
        .checked_mul(SCALE as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?
        .checked_div(total_stake as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    Ok(odds as u64)
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
                let mut logical_outcomes: Vec<LogicalOutcome> = Vec::with_capacity(group_leg_count);
                let mut all_masks_configured = true;

                for local_idx in 0..group_leg_count {
                    let actual_leg_idx = group_leg_indices[local_idx];
                    let market = &leg_markets[actual_leg_idx];
                    let leg = &legs[actual_leg_idx];
                    let mask = market_group.outcome_state_masks[market.group_market_index as usize]
                        [leg.outcome_id as usize];
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
        require!(
            market.market_mode == MarketMode::Trading,
            QuadraticMarketError::DirectTradingDisabled
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

        let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
        let potential_payout = compute_slip_payout_from_legs(&legs, num_legs, bonus)?;
        let combined_odds_fp = compute_effective_odds_fp(total_cost, potential_payout)?;
        let liability_gap = potential_payout.saturating_sub(total_cost);

        let free = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
        require!(
            free >= liability_gap,
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
            .checked_add(liability_gap)
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
        slip.locked_amount = liability_gap;
        slip.exposure_locked = 0;
        slip.group_ids = [0u64; MAX_SLIP_LEGS];
        slip.group_exposure_locked = [0u64; MAX_SLIP_LEGS];
        slip.num_groups_locked = 0;
        slip.claimed = false;
        slip.is_seed = false;
        slip.seed_group_id = 0;
        slip.seed_position_index = 0;
        slip.bump = ctx.bumps.bet_slip;
        slip.status = SlipStatus::Active;
        slip.legs_added = num_legs;
        slip.max_payment = max_payment;

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

    // Deserialize each group snapshot exactly once and reuse it everywhere below.
    // Re-deserializing per leg / per phase allocates a ~3-4 KB snapshot each time on
    // the bump heap (which never frees), and multi-leg slips quickly exhaust the
    // heap. Each group account is validated against its canonical PDA before its
    // fields are trusted — a snapshot whose stored group_id does not match its PDA
    // is left as None and rejected during leg resolution.
    let mut groups: Vec<Option<Box<MarketGroupSnapshot>>> = Vec::with_capacity(num_groups as usize);
    for g in 0..num_groups as usize {
        let group_info = &ctx.remaining_accounts[total_leg_accounts + g];
        let snapshot = deserialize_market_group_info(group_info)?;
        let (expected_group_pda, _) = Pubkey::find_program_address(
            &[
                seeds::MARKET_GROUP,
                snapshot.group_id.to_le_bytes().as_ref(),
            ],
            &crate::ID,
        );
        if group_info.key() == expected_group_pda {
            groups.push(Some(snapshot));
        } else {
            groups.push(None);
        }
    }

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
        require!(
            market.market_mode == MarketMode::Trading,
            QuadraticMarketError::DirectTradingDisabled
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
                // Match against the pre-validated group snapshots (PDA already checked).
                for g in 0..num_groups as usize {
                    if let Some(group) = &groups[g] {
                        if group.group_id == group_id {
                            group_index = Some(g);
                            found = true;
                            break;
                        }
                    }
                }
                require!(found, QuadraticMarketError::MarketGroupNotFound);
            }
        }

        // Compute cost — apply correlation adjustment when grouped
        let (leg_cost, leg_price) = if let Some(g_idx) = group_index {
            let market_group = groups[g_idx]
                .as_ref()
                .ok_or(QuadraticMarketError::MarketGroupNotFound)?;

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
                let market_seed_fee =
                    &mut group_seed_fee_deltas[g_idx][market.group_market_index as usize];
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
        let group = groups[g_idx]
            .as_ref()
            .ok_or(QuadraticMarketError::MarketGroupNotFound)?;

        let new_exposure = group
            .total_group_exposure
            .checked_add(group_exposure_deltas[g_idx])
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(
            new_exposure <= group.max_group_exposure,
            QuadraticMarketError::GroupExposureExceeded
        );
    }

    // Multi-leg slips are LMSR positions with an all-or-nothing bonus. Each leg
    // is priced through LMSR, escrowed by the slip PDA, and only pays the user
    // if every leg wins. If any leg fails, any winning leg value remains in the
    // treasury for LPs.
    let house_margin_bps = config.slip_house_margin_bps;
    let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
    let potential_payout = compute_slip_payout_from_legs(&legs, num_legs, bonus)?;
    let combined_odds_fp = compute_effective_odds_fp(total_cost, potential_payout)?;

    require!(
        total_cost <= max_payment,
        QuadraticMarketError::SlipCostExceeded
    );

    let liability_gap = potential_payout.saturating_sub(total_cost);

    // Liquidity check: stake funds the first part of the payout; LP liquidity
    // backs the LMSR profit plus the multi-leg bonus.
    let treasury_balance = ctx.accounts.treasury_base_ata.amount;
    let free = config.free_liquidity(treasury_balance);
    require!(
        free >= liability_gap,
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
                let market_group = groups[g_idx]
                    .as_mut()
                    .ok_or(QuadraticMarketError::MarketGroupNotFound)?;

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

    // Lock the external liability gap plus reserved seed-fee rewards.
    config.locked_payouts = config
        .locked_payouts
        .checked_add(liability_gap)
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
    slip.locked_amount = liability_gap;
    slip.exposure_locked = total_exposure_locked;
    slip.group_ids = [0u64; MAX_SLIP_LEGS];
    slip.group_exposure_locked = [0u64; MAX_SLIP_LEGS];
    slip.num_groups_locked = 0;
    for g_idx in 0..num_groups as usize {
        if group_exposure_deltas[g_idx] == 0 {
            continue;
        }
        let group = groups[g_idx]
            .as_ref()
            .ok_or(QuadraticMarketError::MarketGroupNotFound)?;
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
    slip.status = SlipStatus::Active;
    slip.legs_added = num_legs;
    slip.max_payment = max_payment;

    Ok(())
}

// ─── Multi-leg slip state machine (open / add_leg / finalize / cancel) ──
//
// place_slip processes every leg in one transaction, which exhausts the BPF
// bump heap (it never frees) once enough legs / group snapshots are touched.
// These instructions assemble a slip across multiple transactions so each
// transaction starts with a fresh heap and touches at most one market:
//
//   open_slip      → create the BetSlip in Building state, escrow the stake
//   add_slip_leg   → one tx per leg: LMSR-price the leg, mint to the slip, bump
//                    the market, append the leg (no group/correlation logic —
//                    multi-leg slips here are priced as independent LMSR legs)
//   finalize_slip  → require all legs added, compute combined odds + bonus, lock
//                    the LP-backed liability gap, mark Active
//   cancel_slip    → abort a partially-built slip and refund the escrowed stake
//
// Each add_slip_leg escrows that leg's LMSR cost incrementally, so the slip's
// running total_stake equals the sum of leg costs. finalize_slip enforces the
// per-slip max_payment captured at open_slip.

#[derive(Accounts)]
#[instruction(slip_id: u64, num_legs: u8, max_payment: u64)]
pub struct OpenSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        init,
        payer = slip_creator,
        space = BetSlip::LEN,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub bet_slip: Box<Account<'info, BetSlip>>,

    #[account(mut)]
    pub slip_creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn open_slip_handler(
    ctx: Context<OpenSlip>,
    slip_id: u64,
    num_legs: u8,
    max_payment: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);
    require!(num_legs > 0, QuadraticMarketError::SlipNoLegs);
    require!(
        num_legs <= MAX_SLIP_LEGS as u8,
        QuadraticMarketError::SlipTooManyLegs
    );

    // slip_id must be the next id, and is consumed so it can't be reused.
    require!(
        slip_id == config.next_slip_id,
        QuadraticMarketError::InvalidRemainingAccount
    );
    config.next_slip_id = config
        .next_slip_id
        .checked_add(1)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    let slip = &mut ctx.accounts.bet_slip;
    slip.slip_id = slip_id;
    slip.creator = ctx.accounts.slip_creator.key();
    slip.legs = [SlipLeg::default(); MAX_SLIP_LEGS];
    slip.num_legs = num_legs;
    slip.total_stake = 0;
    slip.combined_odds_fp = 0;
    slip.house_margin_bps = config.slip_house_margin_bps;
    slip.potential_payout = 0;
    slip.locked_amount = 0;
    slip.exposure_locked = 0;
    slip.group_ids = [0u64; MAX_SLIP_LEGS];
    slip.group_exposure_locked = [0u64; MAX_SLIP_LEGS];
    slip.num_groups_locked = 0;
    slip.claimed = false;
    slip.is_seed = false;
    slip.seed_group_id = 0;
    slip.seed_position_index = 0;
    slip.bump = ctx.bumps.bet_slip;
    slip.status = SlipStatus::Building;
    slip.legs_added = 0;
    slip.max_payment = max_payment;

    Ok(())
}

#[derive(Accounts)]
#[instruction(slip_id: u64, leg: SlipLeg)]
pub struct AddSlipLeg<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
        constraint = bet_slip.creator == slip_creator.key() @ QuadraticMarketError::Unauthorized,
    )]
    pub bet_slip: Box<Account<'info, BetSlip>>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = slip_creator)]
    pub buyer_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[leg.outcome_id as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = slip_creator,
        associated_token::mint = outcome_mint,
        associated_token::authority = bet_slip,
    )]
    pub slip_outcome_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub slip_creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn add_slip_leg_handler(ctx: Context<AddSlipLeg>, _slip_id: u64, leg: SlipLeg) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);

    let market = &mut ctx.accounts.market;
    require!(
        market.market_id == leg.market_id,
        QuadraticMarketError::InvalidRemainingAccount
    );
    require!(
        market.status == MarketStatus::Open,
        QuadraticMarketError::MarketNotOpen
    );
    require!(
        market.market_mode == MarketMode::Trading,
        QuadraticMarketError::DirectTradingDisabled
    );
    require!(
        (leg.outcome_id as usize) < market.num_outcomes as usize,
        QuadraticMarketError::InvalidOutcomeId
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now < market.start_time, QuadraticMarketError::MarketExpired);

    // Slip state checks. We deliberately scope the slip's mutable borrow so the
    // token CPIs below can borrow account infos without conflicting.
    let slip_key = ctx.accounts.bet_slip.key();
    let leg_index;
    {
        let slip = &ctx.accounts.bet_slip;
        require!(
            slip.status == SlipStatus::Building,
            QuadraticMarketError::SlipNotBuilding
        );
        require!(
            slip.legs_added < slip.num_legs,
            QuadraticMarketError::SlipLegOutOfOrder
        );
        // Reject a second leg on a market already present on the slip — a slip's
        // legs must be independent markets (all-or-nothing parlay semantics).
        for i in 0..slip.legs_added as usize {
            require!(
                slip.legs[i].market_id != leg.market_id,
                QuadraticMarketError::SlipDuplicateMarket
            );
        }
        leg_index = slip.legs_added as usize;
    }

    // Price the leg as an independent LMSR position on its own market.
    let cost = lmsr_buy_cost(
        &market.q_values,
        market.num_outcomes,
        leg.outcome_id,
        leg.num_shares,
        market.lmsr_b,
    )?;

    let profit = leg.num_shares.saturating_sub(cost);
    let new_exposure = market
        .exposure
        .checked_add(profit)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    require!(
        new_exposure <= config.max_market_exposure,
        QuadraticMarketError::MaxExposureReached
    );

    // Stage 2: Both single and multi-leg positions are self-backed by market.backing.
    // LP liquidity only backs the multi-leg slip bonus (potential_payout - total_cost).
    // No backing check needed here; finalize_slip checks LP liquidity for the bonus.

    // Escrow this leg's cost from the buyer to the treasury.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.buyer_base_ata.to_account_info(),
                to: ctx.accounts.treasury_base_ata.to_account_info(),
                authority: ctx.accounts.slip_creator.to_account_info(),
            },
        ),
        cost,
    )?;

    // Mint outcome tokens to the slip-owned ATA (the slip escrows the position).
    let market_id_bytes = market.market_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[seeds::MARKET, market_id_bytes.as_ref(), &[market.bump]]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                to: ctx.accounts.slip_outcome_ata.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        ),
        leg.num_shares,
    )?;

    market.q_values[leg.outcome_id as usize] = market.q_values[leg.outcome_id as usize]
        .checked_add(leg.num_shares)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    market.exposure = new_exposure;
    // The leg's escrowed cost joins this market's backing ledger.
    market.backing = market.backing.saturating_add(cost);

    // Seeder reward: a slip leg has no separate buy fee — the protocol's revenue
    // on a leg is the house margin baked into the parlay odds. Accrue 5% of that
    // margin (cost × slip_house_margin_bps) for losing-side seeders.
    let leg_margin = (cost as u128)
        .checked_mul(config.slip_house_margin_bps as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?
        / 10_000u128;
    crate::trade::accrue_seed_fee(config, market, leg_margin as u64)?;

    // The full minted position is a potential payout liability.
    config.locked_payouts = config
        .locked_payouts
        .checked_add(leg.num_shares)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    let _ = slip_key;
    let slip = &mut ctx.accounts.bet_slip;
    slip.legs[leg_index] = leg;
    slip.legs_added = slip
        .legs_added
        .checked_add(1)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    slip.total_stake = slip
        .total_stake
        .checked_add(cost)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    require!(
        slip.total_stake <= slip.max_payment,
        QuadraticMarketError::SlipCostExceeded
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct FinalizeSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
        constraint = bet_slip.creator == slip_creator.key() @ QuadraticMarketError::Unauthorized,
    )]
    pub bet_slip: Box<Account<'info, BetSlip>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    pub slip_creator: Signer<'info>,
}

pub fn finalize_slip_handler(ctx: Context<FinalizeSlip>, _slip_id: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);

    let slip = &mut ctx.accounts.bet_slip;
    require!(
        slip.status == SlipStatus::Building,
        QuadraticMarketError::SlipAlreadyFinalized
    );
    require!(
        slip.legs_added == slip.num_legs,
        QuadraticMarketError::SlipLegsIncomplete
    );

    let bonus = compute_bonus_multiplier(slip.num_legs, config.max_slip_bonus_multiplier_bps)?;
    let potential_payout = compute_slip_payout_from_legs(&slip.legs, slip.num_legs, bonus)?;
    let combined_odds_fp = compute_effective_odds_fp(slip.total_stake, potential_payout)?;
    let liability_gap = potential_payout.saturating_sub(slip.total_stake);

    // The bonus gap above the escrowed stake is backed by LP liquidity.
    let free = config.free_liquidity(ctx.accounts.treasury_base_ata.amount);
    require!(
        free >= liability_gap,
        QuadraticMarketError::InsufficientLiquidity
    );

    config.locked_payouts = config
        .locked_payouts
        .checked_add(liability_gap)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    slip.combined_odds_fp = combined_odds_fp;
    slip.potential_payout = potential_payout;
    slip.locked_amount = liability_gap;
    slip.status = SlipStatus::Active;

    Ok(())
}

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct CancelSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
        constraint = bet_slip.creator == slip_creator.key() @ QuadraticMarketError::Unauthorized,
        close = slip_creator,
    )]
    pub bet_slip: Box<Account<'info, BetSlip>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = slip_creator)]
    pub buyer_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub slip_creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn cancel_slip_handler(ctx: Context<CancelSlip>, _slip_id: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;

    let slip = &ctx.accounts.bet_slip;
    require!(
        slip.status == SlipStatus::Building,
        QuadraticMarketError::SlipNotBuilding
    );

    // Refund the escrowed stake (sum of leg costs added so far). The minted
    // outcome tokens remain on the slip-owned ATAs; since the slip account is
    // closed here they become unrecoverable dust, and the q_values bumps stay —
    // acceptable for an abandoned build. The locked_payouts added per leg are
    // released here.
    let refund = slip.total_stake;
    let mut released: u64 = 0;
    for i in 0..slip.legs_added as usize {
        released = released
            .checked_add(slip.legs[i].num_shares)
            .ok_or(QuadraticMarketError::MathOverflow)?;
    }
    config.locked_payouts = config.locked_payouts.saturating_sub(released);

    if refund > 0 {
        let treasury_seeds: &[&[&[u8]]] = &[&[seeds::TREASURY, &[config.treasury_bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.treasury_base_ata.to_account_info(),
                    to: ctx.accounts.buyer_base_ata.to_account_info(),
                    authority: ctx.accounts.treasury.to_account_info(),
                },
                treasury_seeds,
            ),
            refund,
        )?;
    }

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

    // Must be writable: `close = claimer` on bet_slip credits the slip's rent
    // lamports to the claimer, which changes the claimer account's balance.
    #[account(mut)]
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
    require!(
        slip.status == SlipStatus::Active,
        QuadraticMarketError::SlipNotActive
    );
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
    }
    let slip_id_bytes = slip.slip_id.to_le_bytes();
    let slip_seeds: &[&[&[u8]]] = &[&[seeds::BET_SLIP, slip_id_bytes.as_ref(), &[slip.bump]]];

    // Track winning legs to credit their value to LP when slip loses
    let mut winning_leg_info: Vec<(usize, u64)> = Vec::new(); // (base_idx, num_shares)

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

        // Read only status + winning_outcome (heap-light): the full Market
        // deserialize would allocate its String fields per leg and exhaust the
        // bump heap on multi-leg claims. The token burn below uses the account
        // infos directly, not the Market struct.
        let (market_status, market_winning_outcome) = read_market_settlement_fields(market_info)?;

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

        if market_status == MARKET_STATUS_VOIDED {
            slip_voided = true;
            num_legs_settled += 1;
            leg_idx += 1;
            continue;
        }

        require!(
            market_status == MARKET_STATUS_SETTLED,
            QuadraticMarketError::SlipNotSettled
        );
        num_legs_settled += 1;

        // Track if this leg won (before we lose the market_winning_outcome value)
        if market_winning_outcome == leg.outcome_id {
            winning_leg_info.push((base_idx, leg.num_shares));
        } else {
            all_won = false;
        }

        leg_idx += 1;
    }

    require!(
        num_legs_settled == slip.num_legs,
        QuadraticMarketError::SlipNotSettled
    );

    let mut final_payout: u64 = 0;
    if !slip_voided && all_won {
        final_payout = slip.potential_payout;
        let available_payout = config
            .free_liquidity(ctx.accounts.treasury_base_ata.amount)
            .checked_add(slip.locked_amount)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(
            available_payout >= final_payout,
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
    } else if !slip_voided && !winning_leg_info.is_empty() {
        // Lost slip with winning legs: credit winning leg value to LP/treasury.
        // The shares were already burned above. At settlement, winning shares are
        // worth 1:1 (num_shares USDC). By reducing market.backing, we transfer
        // that value from the market's self-backing pool to LP revenue.
        //
        // Example: User bets 2,621 USDC on 2-leg slip. Leg1 wins (3k shares = 3k USDC
        // value), Leg2 loses. Slip pays 0 to user. The 3k USDC from Leg1's winning
        // position should go to LP as revenue from a losing slip.
        for (base_idx, num_shares) in winning_leg_info {
            let market_info = &ctx.remaining_accounts[base_idx];
            reduce_market_backing(market_info, num_shares)?;
        }
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
    let slip = &mut ctx.accounts.bet_slip;

    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(slip.num_legs > 0, QuadraticMarketError::SlipNoLegs);

    // Slips now lock a deterministic all-or-nothing LMSR payout at placement.
    // Later price movement should not increase or reduce the user's settled
    // payout, so this legacy instruction is intentionally a no-op.
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

    // Must be writable: the slip PDA is closed to the claimer (rent returned).
    #[account(mut)]
    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn cash_out_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CashOutSlip<'info>>,
    _slip_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &ctx.accounts.bet_slip;

    require!(!config.paused, QuadraticMarketError::Paused);
    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(
        slip.status == SlipStatus::Active,
        QuadraticMarketError::SlipNotActive
    );
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

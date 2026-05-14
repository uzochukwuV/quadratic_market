use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, BetSlip, SlipLeg, Market, MarketGroup, MarketStatus};
use crate::errors::QuadraticMarketError;
use crate::constants::{seeds, MAX_SLIP_LEGS, MAX_OUTCOMES, SCALE};
use crate::math::lmsr::{lmsr_buy_cost, lmsr_price};
use crate::math::correlation::{compute_combined_odds_fp, compute_bonus_multiplier, compute_adjusted_q_values};

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
    pub bet_slip: Account<'info, BetSlip>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = slip_creator)]
    pub buyer_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

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
    require!(num_legs <= MAX_SLIP_LEGS as u8, QuadraticMarketError::SlipTooManyLegs);

    let slip_id = config.next_slip_id;
    config.next_slip_id = config.next_slip_id
        .checked_add(1)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // remaining_accounts layout:
    //   Per-leg triplet: [Market, outcome_mint, buyer_outcome_ata]  (3 × num_legs)
    //   Then: [MarketGroup, ...]                                     (num_groups)
    let accounts_per_leg = 3usize;
    let total_leg_accounts = num_legs as usize * accounts_per_leg;
    require!(
        ctx.remaining_accounts.len() >= total_leg_accounts + num_groups as usize,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // ── Phase A: validate markets, compute costs, track group exposure ──
    let mut total_cost: u64 = 0;
    let mut leg_prices: Vec<u64> = Vec::with_capacity(num_legs as usize);
    let mut leg_markets: Vec<Market> = Vec::with_capacity(num_legs as usize);
    let mut leg_group_indices: Vec<Option<usize>> = Vec::with_capacity(num_legs as usize);

    // Accumulate exposure delta per group index (applied once per group at end)
    let mut group_exposure_deltas: Vec<u64> = vec![0u64; num_groups as usize];

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
        require!(market_info.key() == expected_pda, QuadraticMarketError::InvalidRemainingAccount);

        // Deserialize using try_deserialize_unchecked (data[8..] skips the discriminator)
        let market_data = market_info.data.borrow();
        let market: Market = Market::try_deserialize_unchecked(&mut &market_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(market_data);

        require!(market.status == MarketStatus::Open, QuadraticMarketError::MarketNotOpen);

        // Betting stops when match starts
        let now = Clock::get()?.unix_timestamp;
        require!(now < market.start_time, QuadraticMarketError::MarketExpired);

        require!(
            (leg.outcome_id as usize) < market.num_outcomes as usize,
            QuadraticMarketError::InvalidOutcomeId
        );

        // Resolve group index for this leg
        let mut group_index: Option<usize> = None;
        if let Some(group_id) = market.group_id {
            let mut found = false;
            for g in 0..num_groups as usize {
                let group_info = &ctx.remaining_accounts[total_leg_accounts + g];
                let group_data = group_info.data.borrow();
                let group: MarketGroup = MarketGroup::try_deserialize_unchecked(&mut &group_data[8..])
                    .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
                drop(group_data);
                if group.group_id == group_id {
                    group_index = Some(g);
                    found = true;
                    break;
                }
            }
            require!(found, QuadraticMarketError::MarketGroupNotFound);
        }

        // Compute cost — apply correlation adjustment when grouped
        let (leg_cost, leg_price) = if let Some(g_idx) = group_index {
            let group_info = &ctx.remaining_accounts[total_leg_accounts + g_idx];
            let group_data = group_info.data.borrow();
            let market_group: MarketGroup = MarketGroup::try_deserialize_unchecked(&mut &group_data[8..])
                .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
            drop(group_data);

            // Build correlated q_values array from leg markets already processed
            // plus search remaining_accounts for group peers not yet seen
            let mut correlated_q: [[u64; MAX_OUTCOMES]; MAX_OUTCOMES] = [[0u64; MAX_OUTCOMES]; MAX_OUTCOMES];
            for c in 0..market_group.num_markets as usize {
                let corr_id = market_group.market_ids[c];
                if corr_id == 0 { continue; }
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
                        if la == i as usize { continue; }
                        let ra_info = &ctx.remaining_accounts[la * accounts_per_leg];
                        let (peer_pda, _) = Pubkey::find_program_address(
                            &[seeds::MARKET, corr_id.to_le_bytes().as_ref()],
                            &crate::ID,
                        );
                        if ra_info.key() == peer_pda {
                            let d = ra_info.data.borrow();
                            if let Ok(peer) = Market::try_deserialize_unchecked(&mut &d[8..]) {
                                correlated_q[c] = peer.q_values;
                            }
                            break;
                        }
                    }
                }
            }

            let adjusted_q = compute_adjusted_q_values(
                &market.q_values, market.num_outcomes, market.group_market_index,
                &correlated_q, &market_group.correlations, market_group.num_correlations,
            )?;

            let cost = lmsr_buy_cost(&adjusted_q, market.num_outcomes, leg.outcome_id, leg.num_shares, market.lmsr_b)?;
            let price = lmsr_price(&adjusted_q, market.num_outcomes, leg.outcome_id, market.lmsr_b)?;

            // Accumulate exposure delta for this group (not applied yet — done once after Phase A)
            let leg_profit = leg.num_shares.saturating_sub(cost);
            group_exposure_deltas[g_idx] = group_exposure_deltas[g_idx]
                .checked_add(leg_profit)
                .ok_or(QuadraticMarketError::MathOverflow)?;

            (cost, price)
        } else {
            let cost = lmsr_buy_cost(&market.q_values, market.num_outcomes, leg.outcome_id, leg.num_shares, market.lmsr_b)?;
            let price = lmsr_price(&market.q_values, market.num_outcomes, leg.outcome_id, market.lmsr_b)?;
            (cost, price)
        };

        total_cost = total_cost.checked_add(leg_cost).ok_or(QuadraticMarketError::MathOverflow)?;
        leg_prices.push(leg_price);
        leg_group_indices.push(group_index);
        leg_markets.push(market);

        // Validate outcome mint PDA
        let mint_info = &ctx.remaining_accounts[market_idx + 1];
        let (expected_mint_pda, _) = Pubkey::find_program_address(
            &[seeds::OUTCOME_MINT, leg.market_id.to_le_bytes().as_ref(), leg.outcome_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(mint_info.key() == expected_mint_pda, QuadraticMarketError::InvalidRemainingAccount);

        i += 1;
    }

    // Validate group exposure caps — once per group using the total accumulated delta
    for g_idx in 0..num_groups as usize {
        if group_exposure_deltas[g_idx] == 0 { continue; }
        let group_info = &ctx.remaining_accounts[total_leg_accounts + g_idx];
        let group_data = group_info.data.borrow();
        let group: MarketGroup = MarketGroup::try_deserialize_unchecked(&mut &group_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(group_data);

        let new_exposure = group.total_group_exposure
            .checked_add(group_exposure_deltas[g_idx])
            .ok_or(QuadraticMarketError::MathOverflow)?;
        require!(new_exposure <= group.max_group_exposure, QuadraticMarketError::GroupExposureExceeded);
    }

    // Compute combined odds with house margin and bonus
    let house_margin_bps = config.slip_house_margin_bps;
    let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
    let combined_odds_fp = compute_combined_odds_fp(&leg_prices, num_legs, house_margin_bps, bonus)?;

    let potential_payout = ((total_cost as u128)
        .checked_mul(combined_odds_fp as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?)
        / SCALE as u128;
    let potential_payout = potential_payout as u64;

    require!(total_cost <= max_payment, QuadraticMarketError::SlipCostExceeded);

    // Liquidity check against the full potential payout
    let treasury_balance = ctx.accounts.treasury_base_ata.amount;
    let free = config.free_liquidity(treasury_balance);
    require!(free >= potential_payout, QuadraticMarketError::InsufficientLiquidity);

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

    let mut leg_idx: u8 = 0;
    while leg_idx < num_legs {
        let leg = &legs[leg_idx as usize];
        let market_info = &ctx.remaining_accounts[(leg_idx as usize) * accounts_per_leg];
        let outcome_mint_info = &ctx.remaining_accounts[(leg_idx as usize) * accounts_per_leg + 1];
        let buyer_outcome_ata_info = &ctx.remaining_accounts[(leg_idx as usize) * accounts_per_leg + 2];

        // Read market bump from PDA data
        let bump = {
            let d = market_info.data.borrow();
            d[d.len() - 1]
        };

        // Mint outcome tokens
        let market_id_bytes = leg.market_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[seeds::MARKET, market_id_bytes.as_ref(), &[bump]]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: outcome_mint_info.clone(),
                    to: buyer_outcome_ata_info.clone(),
                    authority: market_info.clone(),
                },
                signer_seeds,
            ),
            leg.num_shares,
        )?;

        // Update market state via deserialize → modify → serialize
        {
            let market_data = market_info.data.borrow();
            let mut market: Market = Market::try_deserialize_unchecked(&mut &market_data[8..])
                .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
            drop(market_data);

            let cost = lmsr_buy_cost(&market.q_values, market.num_outcomes, leg.outcome_id, leg.num_shares, market.lmsr_b)?;
            let profit = leg.num_shares.saturating_sub(cost);

            market.q_values[leg.outcome_id as usize] = market.q_values[leg.outcome_id as usize]
                .checked_add(leg.num_shares)
                .ok_or(QuadraticMarketError::MathOverflow)?;
            market.exposure = market.exposure
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
                let group_data = group_info.data.borrow();
                let mut market_group: MarketGroup = MarketGroup::try_deserialize_unchecked(&mut &group_data[8..])
                    .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
                drop(group_data);

                market_group.total_group_exposure = market_group.total_group_exposure
                    .checked_add(delta)
                    .ok_or(QuadraticMarketError::MathOverflow)?;

                let mut group_data_mut = group_info.data.borrow_mut();
                let mut group_writer = &mut group_data_mut[8..];
                market_group.serialize(&mut group_writer)?;
            }
        }

        leg_idx += 1;
    }

    // Lock the full potential payout in treasury accounting
    config.locked_payouts = config.locked_payouts
        .checked_add(potential_payout)
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
    slip.locked_amount = potential_payout;
    slip.exposure_locked = total_exposure_locked;
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
    )]
    pub bet_slip: Account<'info, BetSlip>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = claimer)]
    pub claimer_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn claim_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ClaimSlip<'info>>,
    _slip_id: u64,
    num_groups: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.bet_slip;

    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(slip.num_legs > 0, QuadraticMarketError::SlipNoLegs);

    // remaining_accounts: [Market, outcome_mint, claimer_outcome_ata] × num_legs
    //                     then [MarketGroup] × num_groups
    let accounts_per_leg = 3usize;
    let total_leg_accounts = slip.num_legs as usize * accounts_per_leg;
    require!(
        ctx.remaining_accounts.len() >= total_leg_accounts + num_groups as usize,
        QuadraticMarketError::InvalidRemainingAccount
    );

    let mut all_won = true;
    let mut slip_voided = false;
    let mut num_legs_settled: u8 = 0;

    let mut leg_idx: u8 = 0;
    while leg_idx < slip.num_legs {
        let leg = &slip.legs[leg_idx as usize];
        let base_idx = (leg_idx as usize) * accounts_per_leg;

        let market_info = &ctx.remaining_accounts[base_idx];
        let outcome_mint_info = &ctx.remaining_accounts[base_idx + 1];
        let claimer_outcome_ata_info = &ctx.remaining_accounts[base_idx + 2];

        // Validate market PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(market_info.key() == expected_pda, QuadraticMarketError::InvalidRemainingAccount);

        let market_data = market_info.data.borrow();
        let market: Market = Market::try_deserialize_unchecked(&mut &market_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(market_data);

        if market.status == MarketStatus::Voided {
            slip_voided = true;
            num_legs_settled += 1;
            leg_idx += 1;
            continue;
        }

        require!(market.status == MarketStatus::Settled, QuadraticMarketError::SlipNotSettled);
        num_legs_settled += 1;

        if market.winning_outcome != leg.outcome_id {
            all_won = false;
        }

        // Validate outcome mint PDA
        let (expected_mint_pda, _) = Pubkey::find_program_address(
            &[seeds::OUTCOME_MINT, leg.market_id.to_le_bytes().as_ref(), leg.outcome_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(outcome_mint_info.key() == expected_mint_pda, QuadraticMarketError::InvalidRemainingAccount);

        // Burn outcome tokens for this leg (exactly leg.num_shares, not full ATA balance)
        let ata_data = claimer_outcome_ata_info.data.borrow();
        let claimer_outcome_ata: TokenAccount =
            TokenAccount::try_deserialize(&mut ata_data.as_ref())?;
        let burn_amount = claimer_outcome_ata.amount.min(leg.num_shares);

        if burn_amount > 0 {
            token::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Burn {
                        mint: outcome_mint_info.clone(),
                        from: claimer_outcome_ata_info.clone(),
                        authority: ctx.accounts.claimer.to_account_info(),
                    },
                ),
                burn_amount,
            )?;
        }

        leg_idx += 1;
    }

    require!(num_legs_settled == slip.num_legs, QuadraticMarketError::SlipNotSettled);

    slip.claimed = true;

    // Release locked_payouts using the actual locked_amount on the slip
    config.locked_payouts = config.locked_payouts.saturating_sub(slip.locked_amount);

    // Release group exposure
    if num_groups > 0 && slip.exposure_locked > 0 {
        for g in 0..num_groups as usize {
            let group_info = &ctx.remaining_accounts[total_leg_accounts + g];
            let group_data = group_info.data.borrow();
            let mut market_group: MarketGroup = MarketGroup::try_deserialize_unchecked(&mut &group_data[8..])
                .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
            drop(group_data);

            market_group.total_group_exposure =
                market_group.total_group_exposure.saturating_sub(slip.exposure_locked);

            let mut group_data_mut = group_info.data.borrow_mut();
            let mut group_writer = &mut group_data_mut[8..];
            market_group.serialize(&mut group_writer)?;
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
        // Pay fixed potential_payout — the odds were locked at placement time.
        // locked_amount is always <= potential_payout (only ever decreases via update_slip_lock).
        // We pay potential_payout because that is what the user was promised.
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
            slip.potential_payout,
        )?;
    }
    // Lost slip: house keeps total_stake, nothing transferred

    Ok(())
}

// ─── Update Slip Lock ──────────────────────────────────────────
// Allows the protocol to reduce the treasury lock as live market prices move.
// The lock NEVER increases — this only frees up liquidity; it does NOT reduce
// the payout owed to the user if they win (potential_payout is immutable).

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
    pub bet_slip: Account<'info, BetSlip>,

    pub updater: Signer<'info>,
}

pub fn update_slip_lock_handler(
    ctx: Context<UpdateSlipLock>,
    _slip_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.bet_slip;

    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(slip.num_legs > 0, QuadraticMarketError::SlipNoLegs);

    let num_legs = slip.num_legs;
    require!(
        ctx.remaining_accounts.len() >= num_legs as usize,
        QuadraticMarketError::InvalidRemainingAccount
    );

    let mut leg_prices: Vec<u64> = Vec::with_capacity(num_legs as usize);

    for leg_idx in 0..num_legs as usize {
        let leg = &slip.legs[leg_idx];
        let market_info = &ctx.remaining_accounts[leg_idx];

        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(market_info.key() == expected_pda, QuadraticMarketError::InvalidRemainingAccount);

        let market_data = market_info.data.borrow();
        let market: Market = Market::try_deserialize_unchecked(&mut &market_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(market_data);

        let price = lmsr_price(&market.q_values, market.num_outcomes, leg.outcome_id, market.lmsr_b)?;
        leg_prices.push(price);
    }

    let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
    let current_combined_odds_fp = compute_combined_odds_fp(
        &leg_prices, num_legs, slip.house_margin_bps, bonus,
    )?;

    let current_potential = ((slip.total_stake as u128)
        .checked_mul(current_combined_odds_fp as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?)
        / SCALE as u128;
    let current_potential = current_potential as u64;

    // Only decrease the lock — never increase. Does NOT change potential_payout.
    if current_potential < slip.locked_amount {
        let delta = slip.locked_amount - current_potential;
        slip.locked_amount = current_potential;
        config.locked_payouts = config.locked_payouts.saturating_sub(delta);
    }

    Ok(())
}

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
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// Bet slip PDA — slip_id is auto-assigned from config.next_slip_id
    #[account(
        init,
        payer = slip_creator,
        space = BetSlip::LEN,
        seeds = [seeds::BET_SLIP, global_config.next_slip_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub bet_slip: Account<'info, BetSlip>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = slip_creator,
    )]
    pub buyer_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
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
    require!(
        num_legs <= MAX_SLIP_LEGS as u8,
        QuadraticMarketError::SlipTooManyLegs
    );

    // Auto-assign slip_id
    let slip_id = config.next_slip_id;
    config.next_slip_id = config.next_slip_id
        .checked_add(1)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // remaining_accounts layout:
    //   Per leg triplet: [Market, outcome_mint, buyer_outcome_ata]
    //   After leg triplets: [MarketGroup accounts, one per unique group]
    let accounts_per_leg = 3;
    let total_leg_accounts = num_legs as usize * accounts_per_leg;
    require!(
        ctx.remaining_accounts.len() >= total_leg_accounts + num_groups as usize,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // Phase A: deserialize markets, compute costs, validate, track group exposure
    let mut total_cost: u64 = 0;
    let mut leg_prices: Vec<u64> = Vec::with_capacity(num_legs as usize);

    // For each leg, store the deserialized market for Phase C reuse
    let mut leg_markets: Vec<Market> = Vec::with_capacity(num_legs as usize);

    // Group exposure tracking: accumulate exposure per unique group
    // We'll track which group indices (0..num_groups) each leg belongs to
    let mut leg_group_indices: Vec<Option<usize>> = Vec::with_capacity(num_legs as usize);
    let mut group_exposure_deltas: Vec<u64> = vec![0; num_groups as usize];

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

        // Deserialize market using Anchor's try_deserialize
        let market_data = market_info.data.borrow();
        let market: Market = AccountDeserialize::try_deserialize(&mut &market_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(market_data);

        require!(market.status == MarketStatus::Open, QuadraticMarketError::MarketNotOpen);

        let now = Clock::get()?.unix_timestamp;
        require!(now < market.start_time, QuadraticMarketError::MarketExpired);

        require!(
            (leg.outcome_id as usize) < market.num_outcomes as usize,
            QuadraticMarketError::InvalidOutcomeId
        );

        // Check if this market belongs to a group
        let mut group_index: Option<usize> = None;
        if let Some(group_id) = market.group_id {
            // Find which group account corresponds to this group_id
            let mut found = false;
            let mut g: usize = 0;
            while g < num_groups as usize {
                let group_account_idx = total_leg_accounts + g;
                let group_info = &ctx.remaining_accounts[group_account_idx];
                let group_data = group_info.data.borrow();
                let group: MarketGroup = AccountDeserialize::try_deserialize(&mut &group_data[8..])
                    .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
                drop(group_data);

                if group.group_id == group_id {
                    group_index = Some(g);
                    found = true;
                    break;
                }
                g += 1;
            }
            require!(found, QuadraticMarketError::MarketGroupNotFound);
        }

        // Compute q_values — apply correlation adjustment if grouped
        let q_values: [u64; MAX_OUTCOMES];
        if let Some(g_idx) = group_index {
            // Load correlated market q_values from remaining_accounts
            // We need to find all markets in this group and read their q_values
            let group_account_idx = total_leg_accounts + g_idx;
            let group_info = &ctx.remaining_accounts[group_account_idx];
            let group_data = group_info.data.borrow();
            let market_group: MarketGroup = AccountDeserialize::try_deserialize(&mut &group_data[8..])
                .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
            drop(group_data);

            // Build correlated_market_q_values array: for each market in the group, read its q_values
            let mut correlated_q: [[u64; MAX_OUTCOMES]; MAX_OUTCOMES] = [[0u64; MAX_OUTCOMES]; MAX_OUTCOMES];
            let mut c: u8 = 0;
            while c < market_group.num_markets {
                let corr_market_id = market_group.market_ids[c as usize];
                // Find the market in remaining_accounts by searching leg markets
                // (for now, we use the market's q_values from legs that share the group)
                // For a more complete solution, we'd need separate remaining_accounts for correlated markets
                // For this implementation, we pass the current market's q_values as-is (correlation applied via weight)
                if corr_market_id == leg.market_id {
                    correlated_q[c as usize] = market.q_values;
                }
                c += 1;
            }

            // Compute adjusted q_values using correlation
            q_values = compute_adjusted_q_values(
                &market.q_values,
                market.num_outcomes,
                market.group_market_index,
                &correlated_q,
                &market_group.correlations,
                market_group.num_correlations,
            )?;

            // Validate group exposure cap
            let leg_cost = lmsr_buy_cost(&q_values, market.num_outcomes, leg.outcome_id, leg.num_shares, market.lmsr_b)?;
            let leg_profit = leg.num_shares.saturating_sub(leg_cost);

            let new_group_exposure = market_group.total_group_exposure
                .checked_add(group_exposure_deltas[g_idx])
                .ok_or(QuadraticMarketError::MathOverflow)?
                .checked_add(leg_profit)
                .ok_or(QuadraticMarketError::MathOverflow)?;
            require!(
                new_group_exposure <= market_group.max_group_exposure,
                QuadraticMarketError::GroupExposureExceeded
            );

            group_exposure_deltas[g_idx] = group_exposure_deltas[g_idx]
                .checked_add(leg_profit)
                .ok_or(QuadraticMarketError::MathOverflow)?;

            total_cost = total_cost.checked_add(leg_cost).ok_or(QuadraticMarketError::MathOverflow)?;
            leg_prices.push(leg_cost); // price = cost for single share buy
        } else {
            // Non-grouped market: use raw q_values
            q_values = market.q_values;

            let leg_cost = lmsr_buy_cost(&q_values, market.num_outcomes, leg.outcome_id, leg.num_shares, market.lmsr_b)?;
            let leg_price = lmsr_price(&q_values, market.num_outcomes, leg.outcome_id, market.lmsr_b)?;

            total_cost = total_cost.checked_add(leg_cost).ok_or(QuadraticMarketError::MathOverflow)?;
            leg_prices.push(leg_price);
        }

        leg_group_indices.push(group_index);
        leg_markets.push(market);

        // Validate outcome mint PDA
        let mint_idx = market_idx + 1;
        let mint_info = &ctx.remaining_accounts[mint_idx];
        let (expected_mint_pda, _) = Pubkey::find_program_address(
            &[seeds::OUTCOME_MINT, leg.market_id.to_le_bytes().as_ref(), leg.outcome_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            mint_info.key() == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        i += 1;
    }

    // Compute combined odds with house margin and bonus
    let house_margin_bps = config.slip_house_margin_bps;
    let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
    let combined_odds_fp = compute_combined_odds_fp(
        &leg_prices, num_legs, house_margin_bps, bonus,
    )?;

    // potential_payout = total_stake * combined_odds_fp / SCALE
    let potential_payout = (total_cost as u128)
        .checked_mul(combined_odds_fp as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?
        / SCALE as u128;
    let potential_payout = potential_payout as u64;

    require!(
        total_cost <= max_payment,
        QuadraticMarketError::SlipCostExceeded
    );

    // Liquidity check: must cover the potential payout, not just the cost
    let treasury_balance = ctx.accounts.treasury_base_ata.amount;
    let free = if treasury_balance > config.locked_payouts {
        treasury_balance - config.locked_payouts
    } else {
        0
    };
    require!(
        free >= potential_payout,
        QuadraticMarketError::InsufficientLiquidity
    );

    // Phase B: transfer total cost
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.buyer_base_ata.to_account_info(),
        to: ctx.accounts.treasury_base_ata.to_account_info(),
        authority: ctx.accounts.slip_creator.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        total_cost,
    )?;

    // Phase C: for each leg, mint outcome tokens and update market state
    let mut total_exposure_locked: u64 = 0;
    let mut leg_idx: u8 = 0;
    while leg_idx < num_legs {
        let leg = &legs[leg_idx as usize];
        let market_idx = (leg_idx as usize) * accounts_per_leg;
        let market_info = &ctx.remaining_accounts[market_idx];
        let outcome_mint_info = &ctx.remaining_accounts[market_idx + 1];
        let buyer_outcome_ata_info = &ctx.remaining_accounts[market_idx + 2];

        // Read bump from market PDA
        let bump = market_info.data.borrow()[market_info.data.borrow().len() - 1];
        drop(market_info.data.borrow());

        // Mint outcome tokens using CPI with signer seeds
        let market_id_bytes = leg.market_id.to_le_bytes();
        let seeds_nested = &[seeds::MARKET, market_id_bytes.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[&seeds_nested[..]];

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

        // Update market state via try_deserialize + serialize
        {
            let market_data = market_info.data.borrow();
            let mut market: Market = AccountDeserialize::try_deserialize(&mut &market_data[8..])
                .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
            drop(market_data);

            let cost = lmsr_buy_cost(&market.q_values, market.num_outcomes, leg.outcome_id, leg.num_shares, market.lmsr_b)?;
            let profit = leg.num_shares.saturating_sub(cost);

            // Update q_values
            market.q_values[leg.outcome_id as usize] = market.q_values[leg.outcome_id as usize]
                .checked_add(leg.num_shares)
                .ok_or(QuadraticMarketError::MathOverflow)?;

            // Update exposure
            market.exposure = market.exposure
                .checked_add(profit)
                .ok_or(QuadraticMarketError::MathOverflow)?;

            // Serialize back
            let mut data_mut = market_info.data.borrow_mut();
            let mut writer = &mut data_mut[8..];
            market.serialize(&mut writer)?;
        }

        // Track group exposure for grouped legs
        if let Some(g_idx) = leg_group_indices[leg_idx as usize] {
            let group_account_idx = total_leg_accounts + g_idx;
            let group_info = &ctx.remaining_accounts[group_account_idx];

            let group_data = group_info.data.borrow();
            let mut market_group: MarketGroup = AccountDeserialize::try_deserialize(&mut &group_data[8..])
                .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
            drop(group_data);

            // We already validated exposure in Phase A, now just apply the delta
            market_group.total_group_exposure = market_group.total_group_exposure
                .checked_add(group_exposure_deltas[g_idx])
                .ok_or(QuadraticMarketError::MathOverflow)?;

            // Serialize back
            let mut group_data_mut = group_info.data.borrow_mut();
            let mut group_writer = &mut group_data_mut[8..];
            market_group.serialize(&mut group_writer)?;

            total_exposure_locked = total_exposure_locked
                .checked_add(group_exposure_deltas[g_idx])
                .ok_or(QuadraticMarketError::MathOverflow)?;
        }

        leg_idx += 1;
    }

    // Lock the full potential payout (not cost)
    config.locked_payouts = config.locked_payouts
        .checked_add(potential_payout)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Write BetSlip
    let slip = &mut ctx.accounts.bet_slip;
    slip.slip_id = slip_id;
    slip.creator = ctx.accounts.slip_creator.key();
    let mut legs_arr: [SlipLeg; MAX_SLIP_LEGS] = unsafe { std::mem::zeroed() };
    let mut ci = 0;
    while ci < num_legs as usize {
        legs_arr[ci] = legs[ci].clone();
        ci += 1;
    }
    slip.legs = legs_arr;
    slip.num_legs = num_legs;
    slip.total_stake = total_cost;
    slip.combined_odds_fp = combined_odds_fp;
    slip.house_margin_bps = house_margin_bps;
    slip.potential_payout = potential_payout;
    slip.locked_amount = potential_payout; // initial lock = max
    slip.exposure_locked = total_exposure_locked;
    slip.claimed = false;
    slip.bump = ctx.bumps.bet_slip;

    Ok(())
}

// ─── Claim Slip ─────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct ClaimSlip<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
        constraint = bet_slip.creator == claimer.key() @ QuadraticMarketError::Unauthorized,
    )]
    pub bet_slip: Account<'info, BetSlip>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = claimer,
    )]
    pub claimer_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn claim_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ClaimSlip<'info>>,
    _slip_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.bet_slip;

    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(slip.num_legs > 0, QuadraticMarketError::SlipNoLegs);

    // remaining_accounts layout per leg: [Market, outcome_mint, claimer_outcome_ata]
    let accounts_per_leg = 3;
    let total_needed = slip.num_legs as usize * accounts_per_leg;
    require!(
        ctx.remaining_accounts.len() >= total_needed,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // Check all legs are settled and burn outcome tokens
    let mut all_won = true;
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
        require!(
            market_info.key() == expected_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // Deserialize market
        let market_data = market_info.data.borrow();
        let market: Market = AccountDeserialize::try_deserialize(&mut &market_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(market_data);

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
        require!(
            outcome_mint_info.key() == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // Burn outcome tokens for this leg
        let claimer_outcome_ata: TokenAccount = TokenAccount::try_deserialize(
            &mut &claimer_outcome_ata_info.data.borrow()[..],
        )?;
        let burn_amount = claimer_outcome_ata.amount;

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

    require!(
        num_legs_settled == slip.num_legs,
        QuadraticMarketError::SlipNotSettled
    );

    slip.claimed = true;

    // Release the locked amount from treasury
    config.locked_payouts = config.locked_payouts
        .saturating_sub(slip.locked_amount);

    // Note: group exposure release would happen here if we had group accounts in claim_slip
    // For now, exposure is released implicitly when the group is recalculated

    if all_won {
        // Pay out the fixed potential_payout (user's locked-in odds)
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
            slip.potential_payout,
        )?;
    }
    // If any leg lost: no payout, house keeps the difference

    Ok(())
}

// ─── Update Slip Lock ──────────────────────────────────────────

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct UpdateSlipLock<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
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

    // remaining_accounts: one Market info account per leg
    let num_legs = slip.num_legs;
    require!(
        ctx.remaining_accounts.len() >= num_legs as usize,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // Recompute current prices for each leg
    let mut leg_prices: Vec<u64> = Vec::with_capacity(num_legs as usize);

    let mut leg_idx: u8 = 0;
    while leg_idx < num_legs {
        let leg = &slip.legs[leg_idx as usize];
        let market_info = &ctx.remaining_accounts[leg_idx as usize];

        // Validate PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            market_info.key() == expected_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // Deserialize market
        let market_data = market_info.data.borrow();
        let market: Market = AccountDeserialize::try_deserialize(&mut &market_data[8..])
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(market_data);

        let price = lmsr_price(&market.q_values, market.num_outcomes, leg.outcome_id, market.lmsr_b)?;
        leg_prices.push(price);

        leg_idx += 1;
    }

    // Recompute combined odds with the same house margin stored on the slip
    let bonus = compute_bonus_multiplier(num_legs, config.max_slip_bonus_multiplier_bps)?;
    let current_combined_odds_fp = compute_combined_odds_fp(
        &leg_prices, num_legs, slip.house_margin_bps, bonus,
    )?;

    // Recompute potential payout at current prices
    let current_potential = (slip.total_stake as u128)
        .checked_mul(current_combined_odds_fp as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?
        / SCALE as u128;
    let current_potential = current_potential as u64;

    // Asymmetric: only decrease the lock, never increase
    if current_potential < slip.locked_amount {
        let delta = slip.locked_amount - current_potential;
        slip.locked_amount = current_potential;
        config.locked_payouts = config.locked_payouts.saturating_sub(delta);
    }
    // If current_potential >= slip.locked_amount: do nothing (lock never increases)

    Ok(())
}

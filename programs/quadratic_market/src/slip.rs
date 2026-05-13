use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, MarketStatus, BetSlip, SlipLeg};
use crate::errors::QuadraticMarketError;
use crate::constants::{seeds, MAX_SLIP_LEGS, MAX_OUTCOMES};
use crate::math::lmsr::{lmsr_buy_cost, lmsr_price};
use crate::math::correlation::compute_combined_odds_bps;

// ─── Place Slip ─────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct PlaceSlip<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        init,
        payer = slip_creator,
        space = BetSlip::LEN,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
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
    slip_id: u64,
    legs: Vec<SlipLeg>,
    max_payment: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);

    let num_legs = legs.len() as u8;
    require!(num_legs > 0, QuadraticMarketError::SlipNoLegs);
    require!(
        num_legs <= MAX_SLIP_LEGS as u8,
        QuadraticMarketError::SlipTooManyLegs
    );

    // remaining_accounts layout per leg: [Market, outcome_mint, buyer_outcome_ata]
    let accounts_per_leg = 3;
    let total_needed = num_legs as usize * accounts_per_leg;
    require!(
        ctx.remaining_accounts.len() >= total_needed,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // Phase A: compute all costs and validate
    let mut total_cost: u64 = 0;
    let mut leg_prices: Vec<u64> = Vec::with_capacity(num_legs as usize);

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

        // Read market data for validation
        let data = market_info.data.borrow();
        require!(data.len() > 413, QuadraticMarketError::InvalidRemainingAccount);

        // status at offset 56 — Open = variant 0
        require!(data[56] == 0, QuadraticMarketError::MarketNotOpen);

        // start_time at offset 48
        let mut st_bytes = [0u8; 8];
        st_bytes.copy_from_slice(&data[48..56]);
        let start_time = i64::from_le_bytes(st_bytes);
        let now = Clock::get()?.unix_timestamp;
        require!(now < start_time, QuadraticMarketError::MarketExpired);

        // num_outcomes at offset 67
        let num_outcomes = data[67] as u8;
        require!(
            (leg.outcome_id as usize) < num_outcomes as usize,
            QuadraticMarketError::InvalidOutcomeId
        );

        // q_values at offset 68
        let mut q_values = [0u64; MAX_OUTCOMES];
        for j in 0..num_outcomes as usize {
            let off = 68 + j * 8;
            let mut b = [0u8; 8];
            b.copy_from_slice(&data[off..off + 8]);
            q_values[j] = u64::from_le_bytes(b);
        }

        // lmsr_b at offset 405
        let mut lb = [0u8; 8];
        lb.copy_from_slice(&data[405..413]);
        let lmsr_b = u64::from_le_bytes(lb);

        let cost = lmsr_buy_cost(&q_values, num_outcomes, leg.outcome_id, leg.num_shares, lmsr_b)?;
        let price = lmsr_price(&q_values, num_outcomes, leg.outcome_id, lmsr_b)?;

        total_cost = total_cost.checked_add(cost).ok_or(QuadraticMarketError::MathOverflow)?;
        leg_prices.push(price);

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

    // Compute multiplicative combined odds
    let combined_odds_bps = compute_combined_odds_bps(&leg_prices, num_legs)?;
    let potential_payout = (total_cost as u128)
        .checked_mul(combined_odds_bps as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?
        / 10_000;

    require!(
        total_cost <= max_payment,
        QuadraticMarketError::SlipCostExceeded
    );

    // Liquidity check
    let treasury_balance = ctx.accounts.treasury_base_ata.amount;
    let free = if treasury_balance > config.locked_payouts {
        treasury_balance - config.locked_payouts
    } else {
        0
    };
    require!(
        free >= total_cost,
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

    // Phase C: for each leg, mint outcome tokens and update market state via CPI
    let mut leg_idx: u8 = 0;
    while leg_idx < num_legs {
        let leg = &legs[leg_idx as usize];
        let market_idx = (leg_idx as usize) * accounts_per_leg;
        let market_info = &ctx.remaining_accounts[market_idx];
        let outcome_mint_info = &ctx.remaining_accounts[market_idx + 1];
        let buyer_outcome_ata_info = &ctx.remaining_accounts[market_idx + 2];

        // Read bump from market data (at the very end of the struct)
        // Market struct size without discriminator: ~530 + 24(new fields) = ~554
        // bump is at offset: after all fields. For safety, read last byte
        let data = market_info.data.borrow();
        let market_len = data.len();
        let bump = data[market_len - 1];

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

        // Compute cost again for state update (we already computed it above)
        let mut q_values = [0u64; MAX_OUTCOMES];
        let num_outcomes = data[67] as u8;
        for j in 0..num_outcomes as usize {
            let off = 68 + j * 8;
            let mut b = [0u8; 8];
            b.copy_from_slice(&data[off..off + 8]);
            q_values[j] = u64::from_le_bytes(b);
        }
        let mut lb = [0u8; 8];
        lb.copy_from_slice(&data[405..413]);
        let lmsr_b = u64::from_le_bytes(lb);

        let cost = lmsr_buy_cost(&q_values, num_outcomes, leg.outcome_id, leg.num_shares, lmsr_b)?;
        let profit = cost.saturating_sub(leg.num_shares);

        // Update q_values via set_account_data
        drop(data); // release borrow
        {
            let mut data_mut = market_info.data.borrow_mut();
            // Update q_values
            let new_q = q_values[leg.outcome_id as usize]
                .checked_add(leg.num_shares)
                .ok_or(QuadraticMarketError::MathOverflow)?;
            let off = 68 + (leg.outcome_id as usize) * 8;
            data_mut[off..off + 8].copy_from_slice(&new_q.to_le_bytes());

            // Update exposure (offset 68 + 64 = 132)
            let exp_offset = 132;
            let mut exp_bytes = [0u8; 8];
            exp_bytes.copy_from_slice(&data_mut[exp_offset..exp_offset + 8]);
            let current_exposure = u64::from_le_bytes(exp_bytes);
            let new_exposure = current_exposure
                .checked_add(profit)
                .ok_or(QuadraticMarketError::MathOverflow)?;
            data_mut[exp_offset..exp_offset + 8].copy_from_slice(&new_exposure.to_le_bytes());
        }

        // Update locked_payouts on global_config
        config.locked_payouts = config.locked_payouts
            .checked_add(cost)
            .ok_or(QuadraticMarketError::MathOverflow)?;

        leg_idx += 1;
    }

    // Write BetSlip
    let slip = &mut ctx.accounts.bet_slip;
    slip.slip_id = slip_id;
    slip.creator = ctx.accounts.slip_creator.key();
    // Copy legs into fixed array
    let mut legs_arr: [SlipLeg; MAX_SLIP_LEGS] = unsafe { std::mem::zeroed() };
    let mut ci = 0;
    while ci < num_legs as usize {
        legs_arr[ci] = legs[ci].clone();
        ci += 1;
    }
    slip.legs = legs_arr;
    slip.num_legs = num_legs;
    slip.total_stake = total_cost;
    slip.combined_odds_bps = combined_odds_bps;
    slip.potential_payout = potential_payout as u64;
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

pub fn claim_slip_handler(
    ctx: Context<ClaimSlip>,
    _slip_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.bet_slip;

    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);
    require!(slip.num_legs > 0, QuadraticMarketError::SlipNoLegs);

    // Check all legs are settled by reading market accounts from remaining_accounts
    let mut all_won = true;
    let mut num_legs_settled: u8 = 0;

    let mut leg_idx: u8 = 0;
    while leg_idx < slip.num_legs {
        let leg = &slip.legs[leg_idx as usize];

        require!(
            (leg_idx as usize) < ctx.remaining_accounts.len(),
            QuadraticMarketError::SlipNotSettled
        );

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

        // Read status (offset 56) and winning_outcome from market data
        let data = market_info.data.borrow();
        // MarketStatus::Settled = variant 5
        require!(data[56] == 5, QuadraticMarketError::SlipNotSettled);
        num_legs_settled += 1;

        // winning_outcome is at offset 68 + 64 + 8 + 8 = 148
        let winning_offset = 68 + 64 + 8 + 8;
        let winning_outcome = data[winning_offset];

        if winning_outcome != leg.outcome_id {
            all_won = false;
        }

        leg_idx += 1;
    }

    require!(
        num_legs_settled == slip.num_legs,
        QuadraticMarketError::SlipNotSettled
    );

    slip.claimed = true;

    if all_won {
        config.locked_payouts = config.locked_payouts
            .saturating_sub(slip.potential_payout);

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

    Ok(())
}

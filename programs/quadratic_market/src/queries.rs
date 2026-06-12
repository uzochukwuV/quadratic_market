/// Query functions for frontend integration
/// 
/// These are read-only view functions that calculate costs, odds, and stats
/// without modifying state. They replicate protocol logic for client preview.

use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, Market, BetSlip};
use crate::math::lmsr;
use crate::constants::*;
use crate::errors::QuadraticMarketError;

// ═══════════════════════════════════════════════════════════════════════════
// Result Structures
// ═══════════════════════════════════════════════════════════════════════════

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct QuoteBuyResult {
    pub cost: u64,              // LMSR cost before fee
    pub fee: u64,               // Buy fee (1% of cost)
    pub total_payment: u64,     // cost + fee
    pub new_q_values: Vec<u64>, // Resulting q_values after purchase
    pub new_odds: Vec<u64>,     // Decimal odds * 10000 (e.g., 25000 = 2.5x)
    pub price_impact_bps: u64,  // Price impact in basis points
    pub shares_received: u64,   // Outcome tokens minted
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct QuoteSellResult {
    pub proceeds: u64,          // LMSR proceeds before fee
    pub fee: u64,               // Sell fee (1% of proceeds)
    pub net_received: u64,      // proceeds - fee
    pub new_q_values: Vec<u64>, // Resulting q_values after sale
    pub new_odds: Vec<u64>,     // Decimal odds * 10000
    pub price_impact_bps: u64,  // Price impact in basis points
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct QuoteSlipResult {
    pub total_cost: u64,            // Cost for all legs
    pub house_margin: u64,          // 5% margin per leg
    pub total_stake: u64,           // total_cost + house_margin
    pub potential_payout: u64,      // If all legs win
    pub individual_odds: Vec<u64>,  // Odds per leg (decimal * 10000)
    pub parlay_odds: u64,           // Combined odds (decimal * 10000)
    pub correlation_bonus_bps: u64, // Bonus from correlation (basis points)
    pub implied_probability: u64,   // Probability * 10000 (e.g., 2500 = 25%)
    pub expected_value: i64,        // EV in basis points (signed)
    pub lp_exposure: u64,           // Amount LP will lock
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MarketStatsResult {
    pub market_id: u64,
    pub status: u8,                 // 0=PreOpen, 1=Open, 2=Suspended, etc.
    pub current_odds: Vec<u64>,     // Decimal odds * 10000
    pub implied_probs: Vec<u64>,    // Probabilities * 10000
    pub total_volume: u64,          // Sum of all q_values
    pub liquidity: u64,             // market.backing
    pub exposure: u64,              // market.exposure
    pub locked_payout: u64,         // Outstanding liability
    pub num_outcomes: u8,
    pub time_to_close: i64,         // Seconds until start_time (negative if closed)
    pub time_to_settlement: i64,    // Seconds until can settle
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LpStatsResult {
    pub total_tvl: u64,             // Treasury balance
    pub total_lp_supply: u64,       // Total LP tokens minted
    pub locked_exposure: u64,       // Locked for outstanding bets
    pub free_liquidity: u64,        // Available for new bets
    pub nav_per_share: u64,         // Net asset value per LP token (scaled by 1e6)
    pub total_markets: u64,
    pub active_markets: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CashOutResult {
    pub current_value: u64,         // Current cash-out value
    pub original_stake: u64,        // What user paid
    pub profit_loss: i64,           // current_value - original_stake (signed)
    pub profit_loss_pct: i64,       // P&L percentage * 10000 (signed)
    pub legs_status: Vec<LegStatus>, // Status of each leg
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LegStatus {
    pub market_id: u64,
    pub outcome_id: u8,
    pub current_odds: u64,          // Current decimal odds * 10000
    pub original_odds: u64,         // Odds when placed * 10000
    pub market_settled: bool,
    pub is_winner: bool,
}

// ═══════════════════════════════════════════════════════════════════════════
// Quote Functions
// ═══════════════════════════════════════════════════════════════════════════

/// Quote cost for buying outcome shares
pub fn quote_buy(
    market: &Market,
    outcome_id: u8,
    num_shares: u64,
) -> Result<QuoteBuyResult> {
    require!(
        outcome_id < market.num_outcomes,
        QuadraticMarketError::InvalidOutcomeId
    );
    require!(num_shares > 0, QuadraticMarketError::InvalidAmount);

    // Calculate cost using LMSR
    let cost = lmsr::lmsr_buy_cost(
        &market.q_values,
        market.num_outcomes,
        outcome_id,
        num_shares,
        market.lmsr_b,
    )?;

    // Calculate fee (1%)
    let fee = cost / 100;
    let total_payment = cost.checked_add(fee).unwrap();

    // Calculate new q_values
    let mut new_q_values = market.q_values.clone();
    new_q_values[outcome_id as usize] = new_q_values[outcome_id as usize]
        .checked_add(num_shares)
        .unwrap();

    // Calculate new odds (decimal * 10000)
    let new_odds = calculate_decimal_odds(&new_q_values, market.num_outcomes as usize)?;

    // Calculate price impact
    let old_odds = calculate_decimal_odds(&market.q_values, market.num_outcomes as usize)?;
    let old_price = old_odds[outcome_id as usize];
    let new_price = new_odds[outcome_id as usize];
    let price_impact_bps = if old_price > 0 {
        (((old_price as i64 - new_price as i64).abs() as u64) * 10000) / old_price
    } else {
        0
    };

    Ok(QuoteBuyResult {
        cost,
        fee,
        total_payment,
        new_q_values: new_q_values.to_vec(),
        new_odds,
        price_impact_bps,
        shares_received: num_shares,
    })
}

/// Quote proceeds for selling outcome shares
pub fn quote_sell(
    market: &Market,
    outcome_id: u8,
    num_shares: u64,
) -> Result<QuoteSellResult> {
    require!(
        outcome_id < market.num_outcomes,
        QuadraticMarketError::InvalidOutcomeId
    );
    require!(num_shares > 0, QuadraticMarketError::InvalidAmount);
    require!(
        market.q_values[outcome_id as usize] >= num_shares,
        QuadraticMarketError::InsufficientShares
    );

    // Calculate proceeds using LMSR
    let proceeds = lmsr::lmsr_sell_payout(
        &market.q_values,
        market.num_outcomes,
        outcome_id,
        num_shares,
        market.lmsr_b,
    )?;

    // Calculate fee (1%)
    let fee = proceeds / 100;
    let net_received = proceeds.saturating_sub(fee);

    // Calculate new q_values
    let mut new_q_values = market.q_values.clone();
    new_q_values[outcome_id as usize] = new_q_values[outcome_id as usize]
        .saturating_sub(num_shares);

    // Calculate new odds
    let new_odds = calculate_decimal_odds(&new_q_values, market.num_outcomes as usize)?;

    // Calculate price impact
    let old_odds = calculate_decimal_odds(&market.q_values, market.num_outcomes as usize)?;
    let old_price = old_odds[outcome_id as usize];
    let new_price = new_odds[outcome_id as usize];
    let price_impact_bps = if old_price > 0 {
        (((new_price as i64 - old_price as i64).abs() as u64) * 10000) / old_price
    } else {
        0
    };

    Ok(QuoteSellResult {
        proceeds,
        fee,
        net_received,
        new_q_values: new_q_values.to_vec(),
        new_odds,
        price_impact_bps,
    })
}

/// Quote multi-leg parlay slip
/// Note: This is simplified - doesn't include correlation adjustments
/// For correlated markets, use the full slip pricing logic
pub fn quote_slip_simple(
    markets: &[Market],
    outcomes: &[u8],
    shares_per_leg: &[u64],
) -> Result<QuoteSlipResult> {
    require!(
        markets.len() == outcomes.len() && markets.len() == shares_per_leg.len(),
        QuadraticMarketError::SlipNoLegs
    );
    require!(markets.len() > 0, QuadraticMarketError::SlipNoLegs);

    let num_legs = markets.len();
    let mut total_cost: u64 = 0;
    let mut individual_odds = Vec::with_capacity(num_legs);

    // Calculate cost for each leg
    for i in 0..num_legs {
        let quote = quote_buy(&markets[i], outcomes[i], shares_per_leg[i])?;
        total_cost = total_cost.checked_add(quote.cost).unwrap();
        individual_odds.push(quote.new_odds[outcomes[i] as usize]);
    }

    // House margin: 5% per leg
    let house_margin = (total_cost * 5 * num_legs as u64) / 100;
    let total_stake = total_cost.checked_add(house_margin).unwrap();

    // Calculate parlay odds (multiply individual odds)
    // odds[i] is decimal * 10000, so we need to divide by 10000 for each multiplication
    let mut parlay_odds: u64 = 10000; // Start at 1.0
    for &odds in &individual_odds {
        parlay_odds = (parlay_odds as u128 * odds as u128 / 10000) as u64;
    }

    // Potential payout = stake * parlay_odds / 10000
    let potential_payout = (total_stake as u128 * parlay_odds as u128 / 10000) as u64;

    // Implied probability = 10000 / parlay_odds
    let implied_probability = if parlay_odds > 0 {
        10000 * 10000 / parlay_odds
    } else {
        0
    };

    // Expected value = (potential_payout - total_stake) / total_stake * 10000
    let expected_value = if total_stake > 0 {
        (((potential_payout as i128 - total_stake as i128) * 10000) / total_stake as i128) as i64
    } else {
        0
    };

    // LP exposure = potential_payout - total_cost
    let lp_exposure = potential_payout.saturating_sub(total_cost);

    Ok(QuoteSlipResult {
        total_cost,
        house_margin,
        total_stake,
        potential_payout,
        individual_odds,
        parlay_odds,
        correlation_bonus_bps: 0, // Simplified - no correlation
        implied_probability,
        expected_value,
        lp_exposure,
    })
}

// ═══════════════════════════════════════════════════════════════════════════
// Market Stats Functions
// ═══════════════════════════════════════════════════════════════════════════

/// Get comprehensive market statistics
pub fn get_market_stats(market: &Market, current_time: i64) -> Result<MarketStatsResult> {
    // Calculate current odds
    let current_odds = calculate_decimal_odds(&market.q_values, market.num_outcomes as usize)?;
    
    // Calculate implied probabilities (inverse of odds, normalized)
    let implied_probs = calculate_implied_probabilities(&current_odds)?;

    // Calculate total volume (sum of q_values)
    let total_volume = market.q_values[0..market.num_outcomes as usize]
        .iter()
        .sum();

    // Time calculations
    let time_to_close = market.start_time - current_time;
    let time_to_settlement = market.settlement_time - current_time;

    // Market status as u8
    let status = match market.status {
        crate::state::market::MarketStatus::PreOpen => 0,
        crate::state::market::MarketStatus::Open => 1,
        crate::state::market::MarketStatus::Suspended => 2,
        crate::state::market::MarketStatus::AwaitingResult => 3,
        crate::state::market::MarketStatus::Proposed => 4,
        crate::state::market::MarketStatus::Settled => 5,
        crate::state::market::MarketStatus::Voided => 6,
    };

    Ok(MarketStatsResult {
        market_id: market.market_id,
        status,
        current_odds,
        implied_probs,
        total_volume,
        liquidity: market.backing,
        exposure: market.exposure,
        locked_payout: market.locked_payout,
        num_outcomes: market.num_outcomes,
        time_to_close,
        time_to_settlement,
    })
}

/// Get LP pool statistics
pub fn get_lp_stats(
    config: &GlobalConfig,
    treasury_balance: u64,
) -> Result<LpStatsResult> {
    let free_liquidity = config.free_liquidity(treasury_balance);
    
    // NAV per share = treasury_balance / total_lp_supply (scaled by 1e6)
    let nav_per_share = if config.total_lp_supply > 0 {
        (treasury_balance as u128 * 1_000_000 / config.total_lp_supply as u128) as u64
    } else {
        1_000_000 // 1.0 if no supply
    };

    Ok(LpStatsResult {
        total_tvl: treasury_balance,
        total_lp_supply: config.total_lp_supply,
        locked_exposure: config.locked_payouts,
        free_liquidity,
        nav_per_share,
        total_markets: 0,      // TODO: Track on-chain
        active_markets: 0,     // TODO: Track on-chain
    })
}

/// Calculate cash-out value for active slip
pub fn calculate_cash_out_value(
    slip: &BetSlip,
    markets: &[Market],
) -> Result<CashOutResult> {
    require!(
        markets.len() == slip.num_legs as usize,
        QuadraticMarketError::SlipNoLegs
    );

    let mut legs_status = Vec::with_capacity(markets.len());
    let mut current_parlay_odds: u64 = 10000; // Start at 1.0

    // Check each leg
    for (i, market) in markets.iter().enumerate() {
        let leg = &slip.legs[i];
        
        // Get current odds for this outcome
        let current_odds_vec = calculate_decimal_odds(
            &market.q_values,
            market.num_outcomes as usize
        )?;
        let current_odds = current_odds_vec[leg.outcome_id as usize];

        // Original odds (approximated from shares and cost)
        // This is simplified - actual original odds would need to be stored
        let original_odds = 20000; // TODO: Store on slip

        // Check if market is settled
        let market_settled = matches!(
            market.status,
            crate::state::market::MarketStatus::Settled
        );
        let is_winner = market_settled && market.winning_outcome == leg.outcome_id;

        legs_status.push(LegStatus {
            market_id: leg.market_id,
            outcome_id: leg.outcome_id,
            current_odds,
            original_odds,
            market_settled,
            is_winner,
        });

        // If any leg lost, entire slip is worthless
        if market_settled && !is_winner {
            return Ok(CashOutResult {
                current_value: 0,
                original_stake: slip.total_stake,
                profit_loss: -(slip.total_stake as i64),
                profit_loss_pct: -10000, // -100%
                legs_status,
            });
        }

        // If leg not settled, include current odds in calculation
        if !market_settled {
            current_parlay_odds = (current_parlay_odds as u128 * current_odds as u128 / 10000) as u64;
        }
    }

    // Calculate current value based on remaining legs
    let current_value = (slip.total_stake as u128 * current_parlay_odds as u128 / 10000) as u64;
    let profit_loss = current_value as i64 - slip.total_stake as i64;
    let profit_loss_pct = if slip.total_stake > 0 {
        (profit_loss * 10000) / slip.total_stake as i64
    } else {
        0
    };

    Ok(CashOutResult {
        current_value,
        original_stake: slip.total_stake,
        profit_loss,
        profit_loss_pct,
        legs_status,
    })
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/// Calculate decimal odds from q_values
/// Returns odds * 10000 (e.g., 25000 = 2.5x)
fn calculate_decimal_odds(q_values: &[u64; MAX_OUTCOMES], num_outcomes: usize) -> Result<Vec<u64>> {
    let mut odds = Vec::with_capacity(num_outcomes);
    let total: u64 = q_values[0..num_outcomes].iter().sum();

    if total == 0 {
        return err!(QuadraticMarketError::MathOverflow);
    }

    for i in 0..num_outcomes {
        let q = q_values[i];
        if q == 0 {
            odds.push(0);
        } else {
            // decimal_odds = total / q
            // Scaled by 10000: (total * 10000) / q
            let decimal_odds = (total as u128 * 10000 / q as u128) as u64;
            odds.push(decimal_odds);
        }
    }

    Ok(odds)
}

/// Calculate implied probabilities from decimal odds
/// Returns probabilities * 10000 (e.g., 2500 = 25%)
fn calculate_implied_probabilities(decimal_odds: &[u64]) -> Result<Vec<u64>> {
    let mut probs = Vec::with_capacity(decimal_odds.len());
    let mut total_prob: u128 = 0;

    for &odds in decimal_odds {
        if odds == 0 {
            probs.push(0);
        } else {
            // implied_prob = 1 / odds
            // Scaled: (10000 * 10000) / odds
            let prob = (10000 * 10000) / odds as u128;
            probs.push(prob as u64);
            total_prob += prob;
        }
    }

    // Normalize probabilities to sum to 10000 (100%)
    if total_prob > 0 {
        for prob in probs.iter_mut() {
            *prob = (*prob as u128 * 10000 / total_prob) as u64;
        }
    }

    Ok(probs)
}

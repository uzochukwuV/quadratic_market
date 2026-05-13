use crate::constants::{MAX_OUTCOMES, SCALE};
use crate::errors::QuadraticMarketError;
use crate::math::exp_ln::{exp_q32, ln_q32};
use crate::math::fixed_point::{from_fp, from_fp_ceil, mul_fp_signed, to_fp};
use anchor_lang::prelude::*;

/// Get the current LMSR price for outcome `outcome_id` given the q_values and liquidity param B.
/// Returns price in Q32.32 (between 0 and SCALE).
/// All outcome prices sum to approximately SCALE (1.0).
pub fn lmsr_price(q_values: &[u64; MAX_OUTCOMES], num_outcomes: u8, outcome_id: u8, b_fp: u64) -> Result<u64> {
    require!(
        (outcome_id as usize) < num_outcomes as usize,
        QuadraticMarketError::InvalidOutcomeId
    );

    // Find max q for normalization (prevents overflow in exp)
    let mut max_q: u64 = 0;
    for i in 0..num_outcomes as usize {
        if q_values[i] > max_q {
            max_q = q_values[i];
        }
    }

    // Compute exp((q_i - max_q) / B) for each outcome, and the sum
    let b_raw = (b_fp >> 32) as u64;
    require!(b_raw > 0, QuadraticMarketError::InvalidAmount);
    let mut sum_exp: u64 = 0;
    let mut target_exp: u64 = 0;

    for i in 0..num_outcomes as usize {
        let q_normalized = if max_q > q_values[i] {
            -(((max_q - q_values[i]) as i128 * SCALE as i128) >> 32) as i64
        } else {
            0
        };

        let exponent = if q_normalized == 0 {
            0i64
        } else {
            (q_normalized as i128 * SCALE as i128 / b_raw as i128) as i64
        };
        let exp_val = exp_q32(exponent);
        sum_exp = sum_exp.checked_add(exp_val).ok_or(QuadraticMarketError::MathOverflow)?;

        if i == outcome_id as usize {
            target_exp = exp_val;
        }
    }

    if sum_exp == 0 {
        // All outcomes have zero probability — shouldn't happen with B > 0
        return Ok(SCALE / num_outcomes as u64);
    }

    // price_i = exp_i / sum_exp (in Q32.32)
    let price = ((target_exp as u128) << 32 / sum_exp as u128) as u64;
    Ok(price)
}

/// Compute the cost to buy `delta_q` shares of outcome `outcome_id`.
/// Returns cost in base token lamports (6-decimal).
pub fn lmsr_buy_cost(
    q_values: &[u64; MAX_OUTCOMES],
    num_outcomes: u8,
    outcome_id: u8,
    delta_q: u64,
    b_fp: u64,
) -> Result<u64> {
    require!(
        (outcome_id as usize) < num_outcomes as usize,
        QuadraticMarketError::InvalidOutcomeId
    );
    require!(delta_q > 0, QuadraticMarketError::InvalidAmount);

    let b_raw = (b_fp >> 32) as u64;

    // Find max q for normalization
    let mut max_q: u64 = 0;
    for i in 0..num_outcomes as usize {
        if q_values[i] > max_q {
            max_q = q_values[i];
        }
    }
    // Also check q_values[outcome_id] + delta_q
    let new_q_outcome = q_values[outcome_id as usize]
        .checked_add(delta_q)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    if new_q_outcome > max_q {
        max_q = new_q_outcome;
    }

    // Compute old_sum and new_sum of exponentials
    let mut old_sum: u64 = 0;
    let mut new_sum: u64 = 0;

    for i in 0..num_outcomes as usize {
        let old_q = q_values[i];

        // Compute normalized exponent for old_q: (old_q - max_q) / B
        let old_exp = compute_normalized_exp(old_q, max_q, b_fp)?;
        old_sum = old_sum.checked_add(old_exp).ok_or(QuadraticMarketError::MathOverflow)?;

        let new_q = if i == outcome_id as usize {
            new_q_outcome
        } else {
            old_q
        };

        let new_exp = compute_normalized_exp(new_q, max_q, b_fp)?;
        new_sum = new_sum.checked_add(new_exp).ok_or(QuadraticMarketError::MathOverflow)?;
    }

    // cost = B * (ln(new_sum) - ln(old_sum)) in Q32.32, then convert to lamports
    if old_sum == 0 || new_sum == 0 {
        return Err(QuadraticMarketError::MathUnderflow.into());
    }

    let ln_new = ln_q32(new_sum)?;
    let ln_old = ln_q32(old_sum)?;
    let cost_fp = mul_fp_signed(b_raw as i64 * SCALE as i64, ln_new.checked_sub(ln_old).ok_or(QuadraticMarketError::MathUnderflow)?)?;

    // Cost must be positive
    require!(cost_fp > 0, QuadraticMarketError::InvalidAmount);

    // Convert from Q32.32 to lamports (round up to protect LPs)
    Ok(from_fp_ceil(cost_fp as u64))
}

/// Compute the payout for selling `delta_q` shares of outcome `outcome_id` back to the AMM.
/// Returns payout in base token lamports.
pub fn lmsr_sell_payout(
    q_values: &[u64; MAX_OUTCOMES],
    num_outcomes: u8,
    outcome_id: u8,
    delta_q: u64,
    b_fp: u64,
) -> Result<u64> {
    require!(
        (outcome_id as usize) < num_outcomes as usize,
        QuadraticMarketError::InvalidOutcomeId
    );
    require!(delta_q > 0, QuadraticMarketError::InvalidAmount);
    require!(
        q_values[outcome_id as usize] >= delta_q,
        QuadraticMarketError::InsufficientShares
    );

    let b_raw = (b_fp >> 32) as u64;

    // Find max q for normalization
    let mut max_q: u64 = 0;
    for i in 0..num_outcomes as usize {
        if q_values[i] > max_q {
            max_q = q_values[i];
        }
    }
    // Also check q_values[outcome_id] - delta_q
    let new_q_outcome = q_values[outcome_id as usize] - delta_q; // safe: checked above
    if new_q_outcome > max_q {
        max_q = new_q_outcome;
    }

    // Compute old_sum and new_sum of exponentials
    let mut old_sum: u64 = 0;
    let mut new_sum: u64 = 0;

    for i in 0..num_outcomes as usize {
        let old_q = q_values[i];

        let old_exp = compute_normalized_exp(old_q, max_q, b_fp)?;
        old_sum = old_sum.checked_add(old_exp).ok_or(QuadraticMarketError::MathOverflow)?;

        let new_q = if i == outcome_id as usize {
            new_q_outcome
        } else {
            old_q
        };

        let new_exp = compute_normalized_exp(new_q, max_q, b_fp)?;
        new_sum = new_sum.checked_add(new_exp).ok_or(QuadraticMarketError::MathOverflow)?;
    }

    if old_sum == 0 || new_sum == 0 {
        return Err(QuadraticMarketError::MathUnderflow.into());
    }

    // payout = B * (ln(old_sum) - ln(new_sum)) in Q32.32
    let ln_old = ln_q32(old_sum)?;
    let ln_new = ln_q32(new_sum)?;
    let payout_fp = mul_fp_signed(b_raw as i64 * SCALE as i64, ln_old.checked_sub(ln_new).ok_or(QuadraticMarketError::MathUnderflow)?)?;

    require!(payout_fp > 0, QuadraticMarketError::InvalidAmount);

    // Convert to lamports (round down — AMM pays out conservatively)
    Ok(from_fp(payout_fp as u64))
}

/// Helper: compute exp((q - max_q) * SCALE / B) in Q32.32
/// Since q <= max_q, the exponent is <= 0, so the result is in [0, SCALE]
fn compute_normalized_exp(q: u64, max_q: u64, b_fp: u64) -> Result<u64> {
    let diff = if q >= max_q {
        0i64
    } else {
        // (q - max_q) is negative. Compute in Q32.32:
        // (q - max_q) * SCALE / B_raw
        // b_fp = B_raw * SCALE, so B_raw = b_fp / SCALE
        -(((max_q - q) as i128 * SCALE as i128) >> 32) as i64
    };

    if b_fp == 0 {
        return Err(QuadraticMarketError::MathOverflow.into());
    }

    // b_fp is stored as B_raw * SCALE, so B_raw = b_fp / SCALE
    let b_raw = (b_fp >> 32) as i64;
    require!(b_raw > 0, QuadraticMarketError::InvalidAmount);

    let exponent = if diff == 0 {
        0i64 // exp(0) = 1 in Q32.32
    } else {
        // exponent in Q32.32 = diff * SCALE / B_raw
        (diff as i128 * SCALE as i128 / b_raw as i128) as i64
    };

    Ok(exp_q32(exponent))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_b_fp() -> u64 {
        // B = 100 USDC in Q32.32: 100_000_000 * 2^32
        100_000_000 * SCALE
    }

    #[test]
    fn test_lmsr_equal_prices_initial() {
        // With all q_values = 0, all prices should be 1/N
        let q = [0u64; MAX_OUTCOMES];
        let b = default_b_fp();

        let price_0 = lmsr_price(&q, 2, 0, b).unwrap();
        let price_1 = lmsr_price(&q, 2, 1, b).unwrap();

        // Both should be ~0.5
        let half = SCALE / 2;
        let tolerance = SCALE / 100; // 1%
        assert!((price_0 as i64 - half as i64).unsigned_abs() < tolerance as u64);
        assert!((price_1 as i64 - half as i64).unsigned_abs() < tolerance as u64);
    }

    #[test]
    fn test_lmsr_prices_sum_to_one() {
        let mut q = [0u64; MAX_OUTCOMES];
        q[0] = 50_000_000; // 50 USDC worth of shares on outcome 0
        let b = default_b_fp();

        let p0 = lmsr_price(&q, 2, 0, b).unwrap();
        let p1 = lmsr_price(&q, 2, 1, b).unwrap();

        let sum = p0 + p1;
        // Should be approximately SCALE (1.0)
        let tolerance = SCALE / 50; // 2%
        assert!(
            (sum as i64 - SCALE as i64).unsigned_abs() < tolerance as u64,
            "Prices sum to {} expected {}",
            sum,
            SCALE
        );
    }

    #[test]
    fn test_lmsr_buy_cost_positive() {
        let q = [0u64; MAX_OUTCOMES];
        let b = default_b_fp();

        let cost = lmsr_buy_cost(&q, 2, 0, 1_000_000, b).unwrap(); // Buy 1 USDC worth of shares
        assert!(cost > 0);
        // For a 50/50 market, buying 1 share should cost roughly 0.5 USDC (price * quantity)
        // But LMSR cost depends on the curve shape
    }

    #[test]
    fn test_lmsr_buy_increases_price() {
        let q = [0u64; MAX_OUTCOMES];
        let b = default_b_fp();

        let price_before = lmsr_price(&q, 2, 0, b).unwrap();

        let mut q_after = q;
        q_after[0] = 10_000_000; // 10 USDC of shares bought on outcome 0

        let price_after = lmsr_price(&q_after, 2, 0, b).unwrap();

        assert!(
            price_after > price_before,
            "Buying shares should increase the price of that outcome"
        );
    }

    #[test]
    fn test_lmsr_sell_decreases_price() {
        let mut q = [0u64; MAX_OUTCOMES];
        q[0] = 10_000_000;
        let b = default_b_fp();

        let price_high = lmsr_price(&q, 2, 0, b).unwrap();

        q[0] = 5_000_000;

        let price_low = lmsr_price(&q, 2, 0, b).unwrap();

        assert!(
            price_low < price_high,
            "Selling shares should decrease the price of that outcome"
        );
    }

    #[test]
    fn test_lmsr_round_trip() {
        // Buy then sell should approximately recover the cost (minus spread)
        let q = [0u64; MAX_OUTCOMES];
        let b = default_b_fp();
        let delta = 1_000_000; // 1 USDC

        let buy_cost = lmsr_buy_cost(&q, 2, 0, delta, b).unwrap();

        let mut q_after_buy = q;
        q_after_buy[0] = delta;

        let sell_payout = lmsr_sell_payout(&q_after_buy, 2, 0, delta, b).unwrap();

        // Sell payout should be <= buy cost (AMM spread)
        assert!(
            sell_payout <= buy_cost,
            "Sell payout ({}) should be <= buy cost ({})",
            sell_payout,
            buy_cost
        );

        // But should be close (within 10% for small trades relative to B)
        let spread = buy_cost - sell_payout;
        let max_spread = buy_cost / 10; // 10% max spread
        assert!(
            spread <= max_spread,
            "Spread ({}) too large relative to cost ({})",
            spread,
            buy_cost
        );
    }

    #[test]
    fn test_lmsr_three_outcomes() {
        let q = [0u64; MAX_OUTCOMES];
        let b = default_b_fp();

        let p0 = lmsr_price(&q, 3, 0, b).unwrap();
        let p1 = lmsr_price(&q, 3, 1, b).unwrap();
        let p2 = lmsr_price(&q, 3, 2, b).unwrap();

        // All should be ~1/3
        let third = SCALE / 3;
        let tolerance = SCALE / 50;
        assert!((p0 as i64 - third as i64).unsigned_abs() < tolerance as u64);
        assert!((p1 as i64 - third as i64).unsigned_abs() < tolerance as u64);
        assert!((p2 as i64 - third as i64).unsigned_abs() < tolerance as u64);
    }

    #[test]
    fn test_lmsr_invalid_outcome() {
        let q = [0u64; MAX_OUTCOMES];
        let b = default_b_fp();

        let result = lmsr_price(&q, 2, 5, b);
        assert!(result.is_err());
    }
}

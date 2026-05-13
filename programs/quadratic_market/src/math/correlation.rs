use crate::constants::{CORRELATION_MAX_BPS, MAX_OUTCOMES, SCALE, MIN_SLIP_LEGS_FOR_BONUS, SLIP_BONUS_INCREMENT_BPS};
use crate::errors::QuadraticMarketError;
use crate::state::CorrelationPair;
use anchor_lang::prelude::*;

/// Compute adjusted q_values for a market given its directional correlations with other markets in the group.
///
/// For each correlation pair (market_a, outcome_a) → (market_b, outcome_b, weight):
///   If we're computing adjusted q for market_b at `this_market_index`, outcome `i`:
///     when pair.market_b_index == this_market_index && pair.outcome_b_id == i:
///       adjusted[i] += (pair.weight_bps * q_a[pair.outcome_a_id]) / CORRELATION_MAX_BPS
///
/// This preserves the directional signal: heavy flow on BTTS Yes only affects
/// the specific correlated outcomes (e.g., Over 2.5), not all outcomes equally.
pub fn compute_adjusted_q_values(
    market_q_values: &[u64; MAX_OUTCOMES],
    num_outcomes: u8,
    this_market_index: u8,
    correlated_market_q_values: &[[u64; MAX_OUTCOMES]; MAX_OUTCOMES],
    correlations: &[CorrelationPair],
    num_correlations: u8,
) -> Result<[u64; MAX_OUTCOMES]> {
    let mut adjusted = *market_q_values;

    let mut pair_idx: u8 = 0;
    while pair_idx < num_correlations {
        let pair = &correlations[pair_idx as usize];

        // Only apply correlations where this market is the target (market_b)
        if pair.market_b_index == this_market_index {
            // Get the source market's q_value for the specific correlated outcome
            let source_market_q = &correlated_market_q_values[pair.market_a_index as usize];
            if (pair.outcome_a_id as usize) < MAX_OUTCOMES {
                let q_source = source_market_q[pair.outcome_a_id as usize];

                if q_source > 0 && pair.weight_bps > 0 {
                    // adjustment = (weight_bps * q_source) / CORRELATION_MAX_BPS
                    let adjustment = (pair.weight_bps as u128)
                        .checked_mul(q_source as u128)
                        .ok_or(QuadraticMarketError::CorrelationOverflow)?
                        / CORRELATION_MAX_BPS as u128;

                    // Add to ALL outcomes of the target market proportionally
                    // The correlated outcome gets the full adjustment, other outcomes get 0
                    if (pair.outcome_b_id as usize) < num_outcomes as usize {
                        adjusted[pair.outcome_b_id as usize] = adjusted[pair.outcome_b_id as usize]
                            .checked_add(adjustment as u64)
                            .ok_or(QuadraticMarketError::CorrelationOverflow)?;
                    }
                }
            }
        }

        pair_idx = pair_idx.checked_add(1).ok_or(QuadraticMarketError::CorrelationOverflow)?;
    }

    Ok(adjusted)
}

/// Compute the multiplicative combined odds from multiple legs.
/// Each leg's probability is computed as its LMSR price.
/// combined_probability = product(p_i) / SCALE^(n-1)
/// Returns combined odds in basis points.
pub fn compute_combined_odds_bps(
    leg_probabilities: &[u64],
    num_legs: u8,
) -> Result<u64> {
    if num_legs == 0 {
        return Err(QuadraticMarketError::SlipNoLegs.into());
    }

    if num_legs == 1 {
        // Single leg: odds = SCALE / probability (in Q32.32)
        let p = leg_probabilities[0];
        require!(p > 0, QuadraticMarketError::InvalidAmount);
        let odds_fp = ((crate::constants::SCALE as u128) << 32)
            .checked_div(p as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        // Convert Q32.32 to bps: (odds_fp / SCALE) * 10000
        let odds_bps = (odds_fp / crate::constants::SCALE as u128)
            .checked_mul(10_000)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        return Ok(odds_bps as u64);
    }

    // Multi-leg: combined_probability = product(p_i) / SCALE^(n-1)
    let mut combined_prob: u128 = crate::constants::SCALE as u128;

    let mut i: usize = 0;
    while i < num_legs as usize {
        let p = leg_probabilities[i];
        require!(p > 0, QuadraticMarketError::InvalidAmount);
        combined_prob = combined_prob
            .checked_mul(p as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?
            / crate::constants::SCALE as u128;
        i += 1;
    }

    require!(combined_prob > 0, QuadraticMarketError::InvalidAmount);

    // combined_odds = SCALE / combined_prob
    let combined_odds_fp = ((crate::constants::SCALE as u128) << 32)
        .checked_div(combined_prob)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Convert to bps
    let odds_bps = (combined_odds_fp / crate::constants::SCALE as u128)
        .checked_mul(10_000)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    Ok(odds_bps as u64)
}

/// Compute the bonus multiplier for multi-leg slips.
/// Bonus kicks in at MIN_SLIP_LEGS_FOR_BONUS legs, increasing by SLIP_BONUS_INCREMENT_BPS per extra leg,
/// capped at max_bonus_bps.
pub fn compute_bonus_multiplier(num_legs: u8, max_bonus_bps: u64) -> Result<u64> {
    if num_legs < MIN_SLIP_LEGS_FOR_BONUS {
        return Ok(CORRELATION_MAX_BPS); // 1.0x (no bonus)
    }
    // At threshold (5 legs): base bonus = SLIP_BONUS_INCREMENT_BPS
    // Each extra leg above threshold adds another increment
    let extra_legs = (num_legs - MIN_SLIP_LEGS_FOR_BONUS) as u64;
    let bonus = CORRELATION_MAX_BPS
        .checked_add(SLIP_BONUS_INCREMENT_BPS)
        .ok_or(QuadraticMarketError::MathOverflow)?
        .checked_add(extra_legs.checked_mul(SLIP_BONUS_INCREMENT_BPS).ok_or(QuadraticMarketError::MathOverflow)?)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    // Cap at max_bonus_bps
    Ok(std::cmp::min(bonus, max_bonus_bps))
}

/// Compute the multiplicative combined odds from multiple legs, with house margin and bonus.
/// Each leg price is an LMSR price (Q32.32 probability).
///
/// For each leg:
///   decimal_odds = SCALE^2 / price     (Q32.32)
///   odds_with_margin = odds * (CORRELATION_MAX_BPS - house_margin_bps) / CORRELATION_MAX_BPS
///
/// Combined = product of all margin-adjusted odds (dividing by SCALE between multiplications)
/// Then apply bonus_multiplier if applicable.
///
/// Returns combined odds in Q32.32 fixed-point (decimal odds, e.g., 2.5x, 32x).
pub fn compute_combined_odds_fp(
    leg_probabilities: &[u64],
    num_legs: u8,
    house_margin_bps: u64,
    bonus_multiplier_bps: u64,
) -> Result<u64> {
    if num_legs == 0 {
        return Err(QuadraticMarketError::SlipNoLegs.into());
    }

    let margin_factor = CORRELATION_MAX_BPS
        .checked_sub(house_margin_bps)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Start with SCALE (1.0 in Q32.32) for the running combined odds
    let mut combined_odds: u128 = SCALE as u128;

    let mut i: usize = 0;
    while i < num_legs as usize {
        let p = leg_probabilities[i];
        require!(p > 0, QuadraticMarketError::InvalidAmount);

        // decimal_odds = SCALE^2 / p (Q32.32)
        let odds_fp = ((SCALE as u128) << 32)
            .checked_div(p as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?;

        // Apply house margin: odds * margin_factor / CORRELATION_MAX_BPS
        let odds_with_margin = odds_fp
            .checked_mul(margin_factor as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?
            / CORRELATION_MAX_BPS as u128;

        // Multiply into combined: combined * odds_with_margin / SCALE
        combined_odds = combined_odds
            .checked_mul(odds_with_margin)
            .ok_or(QuadraticMarketError::MathOverflow)?
            / SCALE as u128;

        i += 1;
    }

    require!(combined_odds > 0, QuadraticMarketError::InvalidAmount);

    // Apply bonus multiplier
    if bonus_multiplier_bps != CORRELATION_MAX_BPS {
        combined_odds = combined_odds
            .checked_mul(bonus_multiplier_bps as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?
            / CORRELATION_MAX_BPS as u128;
    }

    Ok(combined_odds as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_correlation_passthrough() {
        let q = [10_000_000u64, 5_000_000u64, 0, 0, 0, 0, 0, 0];
        let correlated = [[0u64; MAX_OUTCOMES]; MAX_OUTCOMES];
        let correlations: [CorrelationPair; 16] = unsafe { std::mem::zeroed() };

        let adjusted = compute_adjusted_q_values(
            &q, 2, 0, &correlated, &correlations, 0,
        ).unwrap();

        assert_eq!(adjusted, q);
    }

    #[test]
    fn test_single_directional_pair() {
        // Market 0 (BTTS): q = [10M, 5M] (Yes, No)
        // Market 1 (Over/Under): q = [3M, 2M] (Over, Under)
        // Correlation: BTTS Yes (0,0) → Over 2.5 (1,0) at 7500 bps
        let q_market1 = [3_000_000u64, 2_000_000u64, 0, 0, 0, 0, 0, 0];
        let q_market0 = [10_000_000u64, 5_000_000u64, 0, 0, 0, 0, 0, 0];

        let mut correlated = [[0u64; MAX_OUTCOMES]; MAX_OUTCOMES];
        correlated[0] = q_market0;
        correlated[1] = q_market1;

        let mut correlations: [CorrelationPair; 16] = unsafe { std::mem::zeroed() };
        correlations[0] = CorrelationPair {
            market_a_index: 0,
            outcome_a_id: 0, // BTTS Yes
            market_b_index: 1,
            outcome_b_id: 0, // Over 2.5
            weight_bps: 7500,
        };

        // Compute adjusted q for market 1 (Over/Under)
        let adjusted = compute_adjusted_q_values(
            &q_market1, 2, 1, &correlated, &correlations, 1,
        ).unwrap();

        // Only Over 2.5 (outcome 0) should be adjusted
        let expected_adjustment = (7500 * 10_000_000) / 10_000; // 7_500_000
        assert_eq!(adjusted[0], q_market1[0] + expected_adjustment);
        // Under 2.5 (outcome 1) should be unchanged
        assert_eq!(adjusted[1], q_market1[1]);
    }

    #[test]
    fn test_multiple_pairs_cumulative() {
        // Two correlations affecting the same target outcome
        let q_target = [1_000_000u64, 500_000u64, 0, 0, 0, 0, 0, 0];
        let q_source_a = [5_000_000u64, 0, 0, 0, 0, 0, 0, 0];
        let q_source_b = [3_000_000u64, 0, 0, 0, 0, 0, 0, 0];

        let mut correlated = [[0u64; MAX_OUTCOMES]; MAX_OUTCOMES];
        correlated[0] = q_source_a;
        correlated[1] = q_source_b;
        correlated[2] = q_target;

        let mut correlations: [CorrelationPair; 16] = unsafe { std::mem::zeroed() };
        correlations[0] = CorrelationPair {
            market_a_index: 0, outcome_a_id: 0,
            market_b_index: 2, outcome_b_id: 0,
            weight_bps: 5000,
        };
        correlations[1] = CorrelationPair {
            market_a_index: 1, outcome_a_id: 0,
            market_b_index: 2, outcome_b_id: 0,
            weight_bps: 3000,
        };

        let adjusted = compute_adjusted_q_values(
            &q_target, 2, 2, &correlated, &correlations, 2,
        ).unwrap();

        let adj_a = (5000 * 5_000_000) / 10_000; // 2_500_000
        let adj_b = (3000 * 3_000_000) / 10_000; // 900_000
        assert_eq!(adjusted[0], q_target[0] + adj_a + adj_b);
    }

    #[test]
    fn test_zero_weight_no_adjustment() {
        let q = [10_000_000u64, 5_000_000u64, 0, 0, 0, 0, 0, 0];
        let correlated = [[0u64; MAX_OUTCOMES]; MAX_OUTCOMES];
        let mut correlations: [CorrelationPair; 16] = unsafe { std::mem::zeroed() };
        correlations[0] = CorrelationPair {
            market_a_index: 0, outcome_a_id: 0,
            market_b_index: 0, outcome_b_id: 0,
            weight_bps: 0, // zero weight
        };

        let adjusted = compute_adjusted_q_values(
            &q, 2, 0, &correlated, &correlations, 1,
        ).unwrap();

        assert_eq!(adjusted, q);
    }

    #[test]
    fn test_combined_odds_single_leg() {
        // Price of 0.5 (50% probability) in Q32.32
        let p = crate::constants::SCALE / 2;
        let odds = compute_combined_odds_bps(&[p], 1).unwrap();
        // Odds should be 2.0 = 20000 bps
        assert!(odds >= 19900 && odds <= 20100, "Expected ~20000 bps, got {}", odds);
    }

    #[test]
    fn test_combined_odds_two_independent_legs() {
        // Two legs each at 50% probability
        let p = crate::constants::SCALE / 2;
        let odds = compute_combined_odds_bps(&[p, p], 2).unwrap();
        // Combined: 0.5 * 0.5 = 0.25 → odds = 4.0 = 40000 bps
        assert!(odds >= 39800 && odds <= 40200, "Expected ~40000 bps, got {}", odds);
    }

    #[test]
    fn test_bonus_multiplier_no_bonus_below_threshold() {
        // 4 legs < MIN_SLIP_LEGS_FOR_BONUS (5) → no bonus
        let bonus = compute_bonus_multiplier(4, 30_000).unwrap();
        assert_eq!(bonus, CORRELATION_MAX_BPS); // 1.0x
    }

    #[test]
    fn test_bonus_multiplier_at_threshold() {
        // 5 legs → 1 extra leg → +1000 bps = 11000 bps = 1.1x
        let bonus = compute_bonus_multiplier(5, 30_000).unwrap();
        assert_eq!(bonus, CORRELATION_MAX_BPS + SLIP_BONUS_INCREMENT_BPS);
    }

    #[test]
    fn test_bonus_multiplier_capped() {
        // 8 legs → 10000 + 1000 + 3*1000 = 14000, but cap at 12000
        let bonus = compute_bonus_multiplier(8, 12_000).unwrap();
        assert_eq!(bonus, 12_000); // capped
    }

    #[test]
    fn test_combined_odds_fp_no_margin() {
        // Single leg at 50% probability, no margin, no bonus
        let p = SCALE / 2;
        let odds = compute_combined_odds_fp(&[p], 1, 0, CORRELATION_MAX_BPS).unwrap();
        // Expected: 2.0 in Q32.32 = 2 * SCALE = 8589934592
        let expected = 2 * SCALE;
        assert!(
            (odds as i64 - expected as i64).unsigned_abs() < SCALE / 100,
            "Expected ~2.0 ({}), got {}", expected, odds
        );
    }

    #[test]
    fn test_combined_odds_fp_with_margin() {
        // Single leg at 50% probability, 5% margin
        let p = SCALE / 2;
        let odds = compute_combined_odds_fp(&[p], 1, 500, CORRELATION_MAX_BPS).unwrap();
        // Raw odds = 2.0, with 5% margin = 2.0 * 0.95 = 1.9
        let expected_fp = (1.9 * SCALE as f64) as u64;
        assert!(
            (odds as i64 - expected_fp as i64).unsigned_abs() < SCALE / 100,
            "Expected ~1.9 ({}), got {}", expected_fp, odds
        );
    }

    #[test]
    fn test_combined_odds_fp_two_legs_with_margin() {
        // Two legs at 50% each, 5% margin per leg
        let p = SCALE / 2;
        let odds = compute_combined_odds_fp(&[p, p], 2, 500, CORRELATION_MAX_BPS).unwrap();
        // Raw combined = 4.0, with 5% margin per leg = 4.0 * 0.95^2 = 3.61
        let expected_fp = (3.61 * SCALE as f64) as u64;
        assert!(
            (odds as i64 - expected_fp as i64).unsigned_abs() < SCALE / 50,
            "Expected ~3.61 ({}), got {}", expected_fp, odds
        );
    }

    #[test]
    fn test_combined_odds_fp_with_bonus() {
        // 5 legs at 50% each, 5% margin, bonus at 5 legs = 1.1x
        let p = SCALE / 2;
        let prices = [p, p, p, p, p];
        let bonus = compute_bonus_multiplier(5, 30_000).unwrap();
        let odds = compute_combined_odds_fp(&prices, 5, 500, bonus).unwrap();
        // Raw combined = 32.0, margin = 32.0 * 0.95^5 ≈ 24.76, bonus 1.1x = 27.24
        let expected_fp = (27.24 * SCALE as f64) as u64;
        assert!(
            (odds as i64 - expected_fp as i64).unsigned_abs() < SCALE,
            "Expected ~27.24 ({}), got {}", expected_fp, odds
        );
    }
}

use crate::constants::SCALE;
use crate::errors::QuadraticMarketError;
use anchor_lang::prelude::*;

/// Multiply two Q32.32 fixed-point numbers: (a * b) >> 32
#[inline]
pub fn mul_fp(a: u64, b: u64) -> Result<u64> {
    let result = (a as u128)
        .checked_mul(b as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    Ok((result >> 32) as u64)
}

/// Divide two Q32.32 fixed-point numbers: (a << 32) / b
#[inline]
pub fn div_fp(a: u64, b: u64) -> Result<u64> {
    require!(b != 0, QuadraticMarketError::MathOverflow);
    let result = ((a as u128) << 32)
        .checked_div(b as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    Ok(result as u64)
}

/// Convert a raw integer to Q32.32: raw * 2^32
#[inline]
pub fn to_fp(raw: u64) -> u128 {
    (raw as u128) << 32
}

/// Convert Q32.32 back to raw integer: fp >> 32 (truncating)
#[inline]
pub fn from_fp(fp: u64) -> u64 {
    fp >> 32
}

/// Convert Q32.32 to raw integer, rounding up
#[inline]
pub fn from_fp_ceil(fp: u64) -> u64 {
    let truncated = fp >> 32;
    if (fp & 0xFFFFFFFF) > 0 {
        truncated + 1
    } else {
        truncated
    }
}

/// Signed multiply for Q32.32: (a * b) >> 32
#[inline]
pub fn mul_fp_signed(a: i64, b: i64) -> Result<i64> {
    let result = (a as i128)
        .checked_mul(b as i128)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    Ok((result >> 32) as i64)
}

/// Signed divide for Q32.32: (a << 32) / b
#[inline]
pub fn div_fp_signed(a: i64, b: i64) -> Result<i64> {
    require!(b != 0, QuadraticMarketError::MathOverflow);
    let result = ((a as i128) << 32)
        .checked_div(b as i128)
        .ok_or(QuadraticMarketError::MathOverflow)?;
    Ok(result as i64)
}

/// Square root for Q32.32 using Newton-Raphson iteration.
/// Returns the floor of the square root.
/// Note: This is computationally expensive - use sparingly.
pub fn sqrt_fp(a: u64) -> Result<u64> {
    if a == 0 {
        return Ok(0);
    }

    // Initial estimate using standard u64 sqrt
    let a_raw = a >> 32;
    let mut x = if a_raw > 0 {
        (a_raw as f64).sqrt() as u64
    } else {
        1
    };

    // Convert to Q32.32
    x = x << 32;

    // Newton-Raphson iteration for 12 iterations (enough for convergence)
    for _ in 0..12 {
        let x2 = ((x as u128) * (x as u128)) >> 32;
        if x2 >= a as u128 {
            // Check if we've converged
            if ((x as u128) << 32) / (x as u128) == x as u128 {
                break;
            }
        }
        x = (((x as u128) + ((a as u128) << 32) / x as u128) >> 1) as u64;
    }

    Ok(x)
}

/// Power function for Q32.32: a^exp
/// Only supports non-negative integer exponents.
/// Uses binary exponentiation for efficiency.
pub fn pow_fp(base: u64, exp: u32) -> Result<u64> {
    require!(exp <= 32, QuadraticMarketError::MathOverflow); // Limit to prevent overflow

    if exp == 0 {
        return Ok(SCALE); // a^0 = 1
    }

    if exp == 1 {
        return Ok(base);
    }

    let mut result: u64 = SCALE; // Start at 1.0 in Q32.32
    let mut current = base;
    let mut e = exp;

    while e > 0 {
        if e & 1 == 1 {
            result = mul_fp(result, current)?;
        }
        current = mul_fp(current, current)?;
        e >>= 1;
    }

    Ok(result)
}

/// Minimum of two Q32.32 values.
#[inline]
pub fn min_fp(a: u64, b: u64) -> u64 {
    std::cmp::min(a, b)
}

/// Maximum of two Q32.32 values.
#[inline]
pub fn max_fp(a: u64, b: u64) -> u64 {
    std::cmp::max(a, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mul_fp() {
        // 2.0 * 3.0 = 6.0
        let two = 2_u64 * SCALE;
        let three = 3_u64 * SCALE;
        let result = mul_fp(two, three).unwrap();
        assert_eq!(result, 6 * SCALE);
    }

    #[test]
    fn test_div_fp() {
        // 6.0 / 3.0 = 2.0
        let six = 6_u64 * SCALE;
        let three = 3_u64 * SCALE;
        let result = div_fp(six, three).unwrap();
        assert_eq!(result, 2 * SCALE);
    }

    #[test]
    fn test_to_from_fp() {
        let raw = 100_u64;
        let fp = to_fp(raw);
        assert_eq!(from_fp(fp as u64), raw);
    }

    #[test]
    fn test_from_fp_ceil() {
        // Exact value
        let exact = (5_u64 * SCALE) as u64;
        assert_eq!(from_fp_ceil(exact), 5);

        // Fractional value rounds up
        let frac = 5 * SCALE + 1;
        assert_eq!(from_fp_ceil(frac), 6);
    }

    #[test]
    fn test_mul_fp_small() {
        // 0.5 * 0.5 = 0.25
        let half = SCALE / 2;
        let result = mul_fp(half, half).unwrap();
        let expected = SCALE / 4;
        // Allow 1 unit of error due to truncation
        assert!((result as i64 - expected as i64).unsigned_abs() <= 1);
    }
}

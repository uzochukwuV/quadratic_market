use anchor_lang::prelude::*;

/// Get the current unix timestamp from the clock sysvar
pub fn get_current_timestamp(clock: &Sysvar<Clock>) -> i64 {
    clock.unix_timestamp
}

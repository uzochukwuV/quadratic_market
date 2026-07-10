use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{
    GlobalConfig, Market, MarketStatus, MarketMode, Epoch, EpochVault,
    SlipLeg,
};
use crate::errors::QuadraticMarketError;
use crate::constants::{
    seeds, SCALE, MAX_SLIP_LEGS,
};
use crate::math::lmsr::{lmsr_buy_cost, lmsr_price};

/// Maximum number of legs in a slip (fits in u16 bitmask)
pub const MAX_SLIP_LEGS_NEW: usize = 16;

// ─── Slip Status ─────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum SlipStatus {
    /// Slip created, awaiting legs to be bought
    Pending,
    /// All legs bought, awaiting settlement
    Active,
    /// All legs settled, all won
    Won,
    /// All legs settled, at least one lost
    Lost,
    /// Cancelled before completion
    Cancelled,
}

impl Default for SlipStatus {
    fn default() -> Self {
        SlipStatus::Pending
    }
}

// ─── New Slip State ──────────────────────────────────────────────

#[account]
pub struct Slip {
    pub owner: Pubkey,
    pub slip_id: u64,
    pub epoch_id: u64,
    pub num_legs: u8,
    pub leg_market_ids: [u64; MAX_SLIP_LEGS_NEW],
    pub leg_outcome_ids: [u8; MAX_SLIP_LEGS_NEW],
    pub leg_fixed_odds_bps: [u64; MAX_SLIP_LEGS_NEW],  // Locked at placement (Q32.32)
    pub legs_bought_mask: u16,    // bit i = leg i bought
    pub legs_settled_mask: u16,   // bit i = leg i settled
    pub legs_won_mask: u16,       // bit i = leg i won
    pub total_stake: u64,         // Total USDC escrowed
    pub potential_payout: u64,   // Fixed payout if all legs win
    pub locked_amount: u64,       // Current treasury lock
    pub status: SlipStatus,
    pub created_at: i64,
    pub cancel_deadline: i64,
    pub claimed: bool,             // Whether paused bet has been reclaimed
    pub bump: u8,
}

impl Slip {
    pub const LEN: usize = 8   // discriminator
        + 32  // owner
        + 8   // slip_id
        + 8   // epoch_id
        + 1   // num_legs
        + 128 // leg_market_ids (16 * 8)
        + 16  // leg_outcome_ids (16 * 1)
        + 128 // leg_fixed_odds_bps (16 * 8)
        + 2   // legs_bought_mask
        + 2   // legs_settled_mask
        + 2   // legs_won_mask
        + 8   // total_stake
        + 8   // potential_payout
        + 8   // locked_amount
        + 1   // status
        + 8   // created_at
        + 8   // cancel_deadline
        + 1   // claimed
        + 1;  // bump

    /// Check if all legs have been bought
    pub fn all_legs_bought(&self) -> bool {
        let expected = ((1u16 << self.num_legs) - 1) as u16;
        self.legs_bought_mask == expected
    }

    /// Check if all legs have been settled
    pub fn all_legs_settled(&self) -> bool {
        let expected = ((1u16 << self.num_legs) - 1) as u16;
        self.legs_settled_mask == expected
    }

    /// Check if all legs won
    pub fn all_legs_won(&self) -> bool {
        let expected = ((1u16 << self.num_legs) - 1) as u16;
        self.legs_won_mask == expected
    }

    /// Returns true if the slip can be cancelled (deadline passed or not all legs bought).
    pub fn can_cancel(&self, now: i64) -> bool {
        matches!(self.status, SlipStatus::Pending | SlipStatus::Active)
            && now >= self.cancel_deadline
            && !self.all_legs_bought()
    }

    /// Returns the number of legs remaining to be bought.
    pub fn legs_remaining(&self) -> u8 {
        self.legs_bought_mask.count_ones() as u8;
        self.num_legs - (self.legs_bought_mask.count_ones() as u8)
    }

    /// Returns the number of legs that have been bought.
    pub fn legs_bought_count(&self) -> u8 {
        self.legs_bought_mask.count_ones() as u8
    }

    /// Returns the number of legs that have been settled.
    pub fn legs_settled_count(&self) -> u8 {
        self.legs_settled_mask.count_ones() as u8
    }

    /// Returns the number of legs that won.
    pub fn legs_won_count(&self) -> u8 {
        self.legs_won_mask.count_ones() as u8
    }

    /// Returns the number of legs that lost.
    pub fn legs_lost_count(&self) -> u8 {
        let settled = self.legs_settled_count();
        let won = self.legs_won_count();
        settled.saturating_sub(won)
    }

    /// Check if a specific leg has been bought.
    pub fn is_leg_bought(&self, leg_index: u8) -> bool {
        if leg_index >= self.num_legs {
            return false;
        }
        self.legs_bought_mask & (1u16 << leg_index) != 0
    }

    /// Check if a specific leg has been settled.
    pub fn is_leg_settled(&self, leg_index: u8) -> bool {
        if leg_index >= self.num_legs {
            return false;
        }
        self.legs_settled_mask & (1u16 << leg_index) != 0
    }

    /// Check if a specific leg won.
    pub fn is_leg_won(&self, leg_index: u8) -> bool {
        if leg_index >= self.num_legs {
            return false;
        }
        self.legs_won_mask & (1u16 << leg_index) != 0
    }

    /// Returns true if the slip is in a final state (won, lost, or cancelled).
    pub fn is_finalized(&self) -> bool {
        matches!(
            self.status,
            SlipStatus::Won | SlipStatus::Lost | SlipStatus::Cancelled
        )
    }

    /// Returns the time remaining until the cancel deadline (negative if passed).
    pub fn time_until_cancel_deadline(&self, now: i64) -> i64 {
        self.cancel_deadline.saturating_sub(now)
    }
}

// ─── Place Slip Await ───────────────────────────────────────────
// User escrows stake, records legs, locks fixed odds.
// Backend then fires N separate buy_leg_for_slip transactions.

#[derive(Accounts)]
pub struct PlaceSlipAwait<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        init,
        payer = owner,
        space = Slip::LEN,
        seeds = [seeds::SLIP, global_config.next_slip_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub slip: Account<'info, Slip>,

    /// CHECK: Treasury PDA for escrow
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub owner_base_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn place_slip_await_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, PlaceSlipAwait<'info>>,
    legs: Vec<SlipLeg>,
    stake: u64,
    fixed_odds: Vec<u64>, // Q32.32 odds for each leg
    cancel_deadline: i64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.slip;

    require!(!config.paused, QuadraticMarketError::Paused);
    require!(legs.len() > 0, QuadraticMarketError::SlipNoLegs);
    require!(
        legs.len() <= MAX_SLIP_LEGS_NEW,
        QuadraticMarketError::SlipTooManyLegs
    );
    require!(stake > 0, QuadraticMarketError::InvalidAmount);
    require!(
        fixed_odds.len() == legs.len(),
        QuadraticMarketError::InvalidAmount
    );

    // Get slip_id from counter
    let slip_id = config.next_slip_id;
    config.next_slip_id = config.next_slip_id
        .checked_add(1)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    let now = Clock::get()?.unix_timestamp;

    // Initialize slip
    slip.owner = ctx.accounts.owner.key();
    slip.slip_id = slip_id;
    slip.epoch_id = config.current_epoch;
    slip.num_legs = legs.len() as u8;
    slip.legs_bought_mask = 0;
    slip.legs_settled_mask = 0;
    slip.legs_won_mask = 0;
    slip.total_stake = stake;
    slip.potential_payout = 0; // Will be calculated after all legs bought
    slip.locked_amount = 0;
    slip.status = SlipStatus::Pending;
    slip.created_at = now;
    slip.cancel_deadline = cancel_deadline;
    slip.bump = ctx.bumps.slip;

    // Record legs and fixed odds
    for (i, leg) in legs.iter().enumerate() {
        slip.leg_market_ids[i] = leg.market_id;
        slip.leg_outcome_ids[i] = leg.outcome_id;
        slip.leg_fixed_odds_bps[i] = fixed_odds[i]; // Q32.32 fixed odds
    }

    // Initialize remaining slots to zero
    for i in legs.len()..MAX_SLIP_LEGS_NEW {
        slip.leg_market_ids[i] = 0;
        slip.leg_outcome_ids[i] = 0;
        slip.leg_fixed_odds_bps[i] = 0;
    }

    // Transfer stake to treasury escrow
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.owner_base_ata.to_account_info(),
                to: ctx.accounts.treasury_base_ata.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        stake,
    )?;

    emit!(SlipAwaited {
        slip_id,
        owner: slip.owner,
        num_legs: slip.num_legs,
        stake,
        cancel_deadline,
    });

    Ok(())
}

// ─── Buy Leg For Slip ────────────────────────────────────────────
// One instruction per leg. Same account footprint as normal single bet.
// Backend calls this N times after place_slip_await.

#[derive(Accounts)]
#[instruction(slip_id: u64, leg_index: u8)]
pub struct BuyLegForSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::SLIP, slip_id.to_le_bytes().as_ref()],
        bump = slip.bump,
    )]
    pub slip: Account<'info, Slip>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub buyer_outcome_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = outcome_mint.key() == market.outcome_mints[leg_index as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn buy_leg_for_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, BuyLegForSlip<'info>>,
    slip_id: u64,
    leg_index: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.slip;
    let market = &mut ctx.accounts.market;

    // Validate slip
    require!(
        slip.status == SlipStatus::Pending || slip.status == SlipStatus::Active,
        QuadraticMarketError::InvalidMarketStatus
    );
    require!(
        leg_index < slip.num_legs,
        QuadraticMarketError::InvalidOutcomeId
    );

    // Check if leg already bought
    let bit = 1u16 << leg_index;
    require!(
        slip.legs_bought_mask & bit == 0,
        QuadraticMarketError::SlipAlreadyClaimed // Reuse error
    );

    // Validate market matches
    let expected_market_id = slip.leg_market_ids[leg_index as usize];
    require!(
        market.market_id == expected_market_id,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // Validate outcome matches
    let expected_outcome = slip.leg_outcome_ids[leg_index as usize];
    require!(
        expected_outcome < market.num_outcomes,
        QuadraticMarketError::InvalidOutcomeId
    );

    // Market must be open
    require!(
        market.status == MarketStatus::Open,
        QuadraticMarketError::MarketNotOpen
    );

    // Check cancel deadline
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < slip.cancel_deadline,
        QuadraticMarketError::SlipExpired // Reuse error
    );

    // Calculate cost and locked amount
    let leg_stake = slip.total_stake / slip.num_legs as u64;
    let leg_cost = lmsr_buy_cost(
        &market.q_values,
        market.num_outcomes,
        expected_outcome,
        leg_stake,
        market.lmsr_b,
    )?;

    // Mint outcome tokens to buyer
    let market_id_bytes = market.market_id.to_le_bytes();
    let market_seeds = &[seeds::MARKET, market_id_bytes.as_ref(), &[market.bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                to: ctx.accounts.buyer_outcome_ata.to_account_info(),
                authority: market.to_account_info(),
            },
            &[market_seeds],
        ),
        leg_stake,
    )?;

    // Update market q_values
    market.q_values[expected_outcome as usize] = market.q_values[expected_outcome as usize]
        .checked_add(leg_stake)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Update locked_payouts
    config.locked_payouts = config.locked_payouts
        .checked_add(leg_stake)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Mark leg as bought
    slip.legs_bought_mask |= bit;

    // Transition to Active if all legs bought
    if slip.all_legs_bought() {
        slip.status = SlipStatus::Active;
        
        // Calculate potential payout based on fixed odds
        let mut total_payout: u128 = slip.total_stake as u128;
        for i in 0..slip.num_legs as usize {
            let odds_fp = slip.leg_fixed_odds_bps[i];
            total_payout = total_payout
                .checked_mul(odds_fp as u128)
                .ok_or(QuadraticMarketError::MathOverflow)?
                / SCALE as u128;
        }
        slip.potential_payout = total_payout as u64;
        slip.locked_amount = slip.potential_payout;
    }

    emit!(SlipLegBought {
        slip_id,
        leg_index,
        market_id: market.market_id,
        outcome: expected_outcome,
        stake: leg_stake,
        cost: leg_cost,
    });

    Ok(())
}

// ─── Cancel Slip ─────────────────────────────────────────────────
// Permissionless cancellation if deadline passed or market suspended.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct CancelSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::SLIP, slip_id.to_le_bytes().as_ref()],
        bump = slip.bump,
        constraint = slip.owner == canceller.key() @ QuadraticMarketError::Unauthorized,
    )]
    pub slip: Account<'info, Slip>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub canceller_base_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    pub canceller: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn cancel_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CancelSlip<'info>>,
    slip_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.slip;

    require!(
        slip.status == SlipStatus::Pending || slip.status == SlipStatus::Active,
        QuadraticMarketError::InvalidMarketStatus
    );

    let now = Clock::get()?.unix_timestamp;
    
    // Can cancel if deadline passed OR not all legs bought
    let deadline_passed = now >= slip.cancel_deadline;
    let not_all_bought = !slip.all_legs_bought();
    
    require!(
        deadline_passed || not_all_bought,
        QuadraticMarketError::SlipNotExpired // Reuse error
    );

    // Calculate refund amount (total_stake minus legs that were bought)
    let legs_bought = slip.legs_bought_mask.count_ones() as u64;
    let legs_bought_value = legs_bought * (slip.total_stake / slip.num_legs as u64);
    let refund = slip.total_stake - legs_bought_value;

    // Release locked_payouts for unbought legs
    let legs_not_bought = slip.num_legs as u64 - legs_bought;
    let unlocked_amount = legs_not_bought * (slip.total_stake / slip.num_legs as u64);
    config.locked_payouts = config.locked_payouts.saturating_sub(unlocked_amount);

    // Mark as cancelled
    slip.status = SlipStatus::Cancelled;

    // Transfer refund to owner
    let treasury_seeds: &[&[&[u8]]] = &[&[seeds::TREASURY, &[config.treasury_bump]]];
    if refund > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.treasury_base_ata.to_account_info(),
                    to: ctx.accounts.canceller_base_ata.to_account_info(),
                    authority: ctx.accounts.treasury.to_account_info(),
                },
                treasury_seeds,
            ),
            refund,
        )?;
    }

    emit!(SlipCancelled {
        slip_id,
        owner: slip.owner,
        refund,
        legs_bought: legs_bought as u32,
    });

    Ok(())
}

// ─── Settle Slip Leg ────────────────────────────────────────────
// Permissionless. Marks one leg as settled based on market outcome.

#[derive(Accounts)]
#[instruction(slip_id: u64, leg_index: u8)]
pub struct SettleSlipLeg<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::SLIP, slip_id.to_le_bytes().as_ref()],
        bump = slip.bump,
    )]
    pub slip: Account<'info, Slip>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    pub caller: Signer<'info>,
}

pub fn settle_slip_leg_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SettleSlipLeg<'info>>,
    slip_id: u64,
    leg_index: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &mut ctx.accounts.slip;
    let market = &ctx.accounts.market;

    // Slip must be active
    require!(
        slip.status == SlipStatus::Active,
        QuadraticMarketError::InvalidMarketStatus
    );

    // Check leg index
    require!(
        leg_index < slip.num_legs,
        QuadraticMarketError::InvalidOutcomeId
    );

    // Check leg not already settled
    let bit = 1u16 << leg_index;
    require!(
        slip.legs_settled_mask & bit == 0,
        QuadraticMarketError::SlipAlreadyClaimed // Reuse error
    );

    // Validate market matches
    let expected_market_id = slip.leg_market_ids[leg_index as usize];
    require!(
        market.market_id == expected_market_id,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // Market must be settled
    require!(
        market.status == MarketStatus::Settled,
        QuadraticMarketError::MarketNotSettled
    );

    // Determine if leg won
    let expected_outcome = slip.leg_outcome_ids[leg_index as usize];
    let won = market.winning_outcome == expected_outcome;

    // Mark leg as settled
    slip.legs_settled_mask |= bit;
    if won {
        slip.legs_won_mask |= bit;
    }

    // Release exposure from this leg
    let leg_stake = slip.total_stake / slip.num_legs as u64;
    config.locked_payouts = config.locked_payouts.saturating_sub(leg_stake);

    emit!(SlipLegSettled {
        slip_id,
        leg_index,
        market_id: market.market_id,
        outcome: expected_outcome,
        winning_outcome: market.winning_outcome,
        won,
    });

    // Check if all legs settled
    if slip.all_legs_settled() {
        if slip.all_legs_won() {
            slip.status = SlipStatus::Won;
        } else {
            slip.status = SlipStatus::Lost;
        }
    }

    Ok(())
}

// ─── Resolve Slip ───────────────────────────────────────────────
// Finalizes slip and transfers payout. Permissionless.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct ResolveSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::SLIP, slip_id.to_le_bytes().as_ref()],
        bump = slip.bump,
        constraint = slip.owner == claimer.key() @ QuadraticMarketError::Unauthorized,
        close = claimer,
    )]
    pub slip: Account<'info, Slip>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub claimer_base_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn resolve_slip_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ResolveSlip<'info>>,
    slip_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let slip = &ctx.accounts.slip;

    // Must be won or lost
    require!(
        slip.status == SlipStatus::Won || slip.status == SlipStatus::Lost,
        QuadraticMarketError::SlipNotSettled
    );

    let treasury_seeds: &[&[&[u8]]] = &[&[seeds::TREASURY, &[config.treasury_bump]]];

    if slip.status == SlipStatus::Won {
        // Transfer payout to winner
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
            slip.potential_payout,
        )?;

        emit!(SlipResolved {
            slip_id,
            owner: slip.owner,
            status: "won".to_string(),
            payout: slip.potential_payout,
        });
    } else {
        // Lost: payout stays in treasury (house win)
        // The original stake was already taken at place_slip_await
        emit!(SlipResolved {
            slip_id,
            owner: slip.owner,
            status: "lost".to_string(),
            payout: 0,
        });
    }

    // Release remaining locked amount
    config.locked_payouts = config.locked_payouts.saturating_sub(slip.locked_amount);

    Ok(())
}

// ─── Events ─────────────────────────────────────────────────────

#[event]
pub struct SlipAwaited {
    pub slip_id: u64,
    pub owner: Pubkey,
    pub num_legs: u8,
    pub stake: u64,
    pub cancel_deadline: i64,
}

#[event]
pub struct SlipLegBought {
    pub slip_id: u64,
    pub leg_index: u8,
    pub market_id: u64,
    pub outcome: u8,
    pub stake: u64,
    pub cost: u64,
}

#[event]
pub struct SlipCancelled {
    pub slip_id: u64,
    pub owner: Pubkey,
    pub refund: u64,
    pub legs_bought: u32,
}

#[event]
pub struct SlipLegSettled {
    pub slip_id: u64,
    pub leg_index: u8,
    pub market_id: u64,
    pub outcome: u8,
    pub winning_outcome: u8,
    pub won: bool,
}

#[event]
pub struct SlipResolved {
    pub slip_id: u64,
    pub owner: Pubkey,
    pub status: String,
    pub payout: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slip_len_matches_expected() {
        // Verify the LEN constant is correct
        assert_eq!(Slip::LEN, 314);
    }

    #[test]
    fn all_legs_bought_mask() {
        let mut slip = Slip {
            owner: Pubkey::default(),
            slip_id: 1,
            epoch_id: 0,
            num_legs: 3,
            leg_market_ids: [0u64; MAX_SLIP_LEGS_NEW],
            leg_outcome_ids: [0u8; MAX_SLIP_LEGS_NEW],
            leg_fixed_odds_bps: [0u64; MAX_SLIP_LEGS_NEW],
            legs_bought_mask: 0,
            legs_settled_mask: 0,
            legs_won_mask: 0,
            total_stake: 1000,
            potential_payout: 0,
            locked_amount: 0,
            status: SlipStatus::Pending,
            created_at: 0,
            cancel_deadline: 0,
            bump: 1,
            claimed: false,
        };

        // Initially not all bought
        assert!(!slip.all_legs_bought());

        // Buy 2 legs
        slip.legs_bought_mask = 0b0111; // legs 0, 1, 2
        assert!(slip.all_legs_bought());
    }

    #[test]
    fn all_legs_won() {
        let mut slip = Slip {
            owner: Pubkey::default(),
            slip_id: 1,
            epoch_id: 0,
            num_legs: 3,
            leg_market_ids: [0u64; MAX_SLIP_LEGS_NEW],
            leg_outcome_ids: [0u8; MAX_SLIP_LEGS_NEW],
            leg_fixed_odds_bps: [0u64; MAX_SLIP_LEGS_NEW],
            legs_bought_mask: 0b0111,
            legs_settled_mask: 0b0111,
            legs_won_mask: 0b0111,
            total_stake: 1000,
            potential_payout: 0,
            locked_amount: 0,
            status: SlipStatus::Active,
            created_at: 0,
            cancel_deadline: 0,
            bump: 1,
            claimed: false,
        };

        assert!(slip.all_legs_won());

        // One leg lost
        slip.legs_won_mask = 0b0011;
        assert!(!slip.all_legs_won());
    }

    #[test]
    fn test_can_cancel() {
        let mut slip = Slip {
            owner: Pubkey::default(),
            slip_id: 1,
            epoch_id: 0,
            num_legs: 3,
            leg_market_ids: [0u64; MAX_SLIP_LEGS_NEW],
            leg_outcome_ids: [0u8; MAX_SLIP_LEGS_NEW],
            leg_fixed_odds_bps: [0u64; MAX_SLIP_LEGS_NEW],
            legs_bought_mask: 0b0001, // Only leg 0 bought
            legs_settled_mask: 0,
            legs_won_mask: 0,
            total_stake: 1000,
            potential_payout: 0,
            locked_amount: 0,
            status: SlipStatus::Pending,
            created_at: 0,
            cancel_deadline: 1000,
            bump: 1,
            claimed: false,
        };

        // Deadline not passed yet
        assert!(!slip.can_cancel(500));

        // Deadline passed, not all bought
        assert!(slip.can_cancel(1001));

        // All legs bought - can't cancel
        slip.legs_bought_mask = 0b0111;
        assert!(!slip.can_cancel(1001));
    }

    #[test]
    fn test_legs_remaining() {
        let slip = Slip {
            owner: Pubkey::default(),
            slip_id: 1,
            epoch_id: 0,
            num_legs: 5,
            leg_market_ids: [0u64; MAX_SLIP_LEGS_NEW],
            leg_outcome_ids: [0u8; MAX_SLIP_LEGS_NEW],
            leg_fixed_odds_bps: [0u64; MAX_SLIP_LEGS_NEW],
            legs_bought_mask: 0b0011, // legs 0 and 1 bought
            legs_settled_mask: 0,
            legs_won_mask: 0,
            total_stake: 1000,
            potential_payout: 0,
            locked_amount: 0,
            status: SlipStatus::Pending,
            created_at: 0,
            cancel_deadline: 0,
            bump: 1,
            claimed: false,
        };

        assert_eq!(slip.legs_remaining(), 3);
    }

    #[test]
    fn test_legs_count_helpers() {
        let mut slip = Slip {
            owner: Pubkey::default(),
            slip_id: 1,
            epoch_id: 0,
            num_legs: 4,
            leg_market_ids: [0u64; MAX_SLIP_LEGS_NEW],
            leg_outcome_ids: [0u8; MAX_SLIP_LEGS_NEW],
            leg_fixed_odds_bps: [0u64; MAX_SLIP_LEGS_NEW],
            legs_bought_mask: 0b0101, // legs 0 and 2 bought
            legs_settled_mask: 0b0101, // legs 0 and 2 settled
            legs_won_mask: 0b0100, // only leg 2 won
            total_stake: 1000,
            potential_payout: 0,
            locked_amount: 0,
            status: SlipStatus::Active,
            created_at: 0,
            cancel_deadline: 0,
            bump: 1,
            claimed: false,
        };

        assert_eq!(slip.legs_bought_count(), 2);
        assert_eq!(slip.legs_settled_count(), 2);
        assert_eq!(slip.legs_won_count(), 1);
        assert_eq!(slip.legs_lost_count(), 1);
    }

    #[test]
    fn test_is_finalized() {
        let slip_pending = Slip {
            owner: Pubkey::default(),
            slip_id: 1,
            epoch_id: 0,
            num_legs: 2,
            leg_market_ids: [0u64; MAX_SLIP_LEGS_NEW],
            leg_outcome_ids: [0u8; MAX_SLIP_LEGS_NEW],
            leg_fixed_odds_bps: [0u64; MAX_SLIP_LEGS_NEW],
            legs_bought_mask: 0,
            legs_settled_mask: 0,
            legs_won_mask: 0,
            total_stake: 0,
            potential_payout: 0,
            locked_amount: 0,
            status: SlipStatus::Pending,
            created_at: 0,
            cancel_deadline: 0,
            bump: 1,
            claimed: false,
        };
        assert!(!slip_pending.is_finalized());

        let slip_won = Slip {
            status: SlipStatus::Won,
            ..slip_pending
        };
        assert!(slip_won.is_finalized());

        let slip_lost = Slip {
            status: SlipStatus::Lost,
            ..slip_pending
        };
        assert!(slip_lost.is_finalized());

        let slip_cancelled = Slip {
            status: SlipStatus::Cancelled,
            ..slip_pending
        };
        assert!(slip_cancelled.is_finalized());
    }

    #[test]
    fn test_is_leg_bought_settled_won() {
        let slip = Slip {
            owner: Pubkey::default(),
            slip_id: 1,
            epoch_id: 0,
            num_legs: 4,
            leg_market_ids: [0u64; MAX_SLIP_LEGS_NEW],
            leg_outcome_ids: [0u8; MAX_SLIP_LEGS_NEW],
            leg_fixed_odds_bps: [0u64; MAX_SLIP_LEGS_NEW],
            legs_bought_mask: 0b0101, // legs 0 and 2
            legs_settled_mask: 0b0101,
            legs_won_mask: 0b0100, // only leg 2
            total_stake: 1000,
            potential_payout: 0,
            locked_amount: 0,
            status: SlipStatus::Active,
            created_at: 0,
            cancel_deadline: 0,
            bump: 1,
            claimed: false,
        };

        assert!(slip.is_leg_bought(0));
        assert!(!slip.is_leg_bought(1));
        assert!(slip.is_leg_bought(2));
        assert!(!slip.is_leg_bought(3));

        assert!(slip.is_leg_settled(0));
        assert!(!slip.is_leg_settled(1));

        assert!(!slip.is_leg_won(0));
        assert!(slip.is_leg_won(2));

        // Out of range
        assert!(!slip.is_leg_bought(10));
        assert!(!slip.is_leg_settled(10));
        assert!(!slip.is_leg_won(10));
    }
}

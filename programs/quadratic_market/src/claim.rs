use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, Market, MarketStatus, BetSlip};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

// ─── Claim Payout ──────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ClaimPayout<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = outcome_mint,
        associated_token::authority = claimer,
    )]
    pub claimer_outcome_ata: Account<'info, TokenAccount>,

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

    #[account(
        constraint = outcome_mint.key() == market.outcome_mints[market.winning_outcome as usize] @ QuadraticMarketError::WrongOutcomeToken,
    )]
    pub outcome_mint: Account<'info, Mint>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn claim_payout_handler(ctx: Context<ClaimPayout>, _market_id: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let market = &ctx.accounts.market;

    require!(market.status == MarketStatus::Settled, QuadraticMarketError::MarketNotSettled);

    let amount = ctx.accounts.claimer_outcome_ata.amount;
    require!(amount > 0, QuadraticMarketError::NoWinningPositions);

    // Burn winning outcome tokens
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Burn {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                from: ctx.accounts.claimer_outcome_ata.to_account_info(),
                authority: ctx.accounts.claimer.to_account_info(),
            },
        ),
        amount,
    )?;

    // Pay 1 base token per outcome token (1:1 redemption)
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
        amount,
    )?;

    config.locked_payouts = config.locked_payouts.saturating_sub(amount);

    Ok(())
}

// ─── Claim Paused Bet ──────────────────────────────────────────
// When the protocol is paused (global_config.paused == true), users can
// reclaim their original stake from an unclaimed BetSlip. This prevents
// funds from being permanently locked if the protocol is emergency-paused.
// The slip's locked_amount is returned 1:1, outcome tokens are burned, and
// the slip is closed.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct ClaimPausedBet<'info> {
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
        close = claimer,
    )]
    pub bet_slip: Account<'info, BetSlip>,

    /// CHECK: Treasury PDA
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = claimer,
    )]
    pub claimer_base_ata: Account<'info, TokenAccount>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn claim_paused_bet_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ClaimPausedBet<'info>>,
    _slip_id: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.global_config;

    // Only available when the protocol is paused
    require!(config.paused, QuadraticMarketError::NotPaused);

    let slip = &ctx.accounts.bet_slip;
    require!(!slip.claimed, QuadraticMarketError::SlipAlreadyClaimed);

    let refund = slip.total_stake;
    require!(refund > 0, QuadraticMarketError::InvalidAmount);

    // remaining_accounts layout: [Market, outcome_mint, claimer_outcome_ata] per leg
    // burning tokens first prevents double-claim if markets settle normally after unpause
    let num_legs = slip.num_legs;
    let total_needed = (num_legs as usize) * 3;
    require!(
        ctx.remaining_accounts.len() >= total_needed,
        QuadraticMarketError::InvalidRemainingAccount
    );

    // ── Phase 1: Validate remaining_accounts and collect burn info ──
    // Clone AccountInfos to avoid lifetime conflicts with &mut ctx references.
    // Burn amounts are just u64 values so no lifetime issue there.
    let mut burn_data: Vec<(AccountInfo, AccountInfo, u64)> = Vec::with_capacity(num_legs as usize);

    for leg_idx in 0..num_legs as usize {
        let leg = &slip.legs[leg_idx];
        let market_info = &ctx.remaining_accounts[leg_idx * 3];
        let outcome_mint_info = &ctx.remaining_accounts[leg_idx * 3 + 1];
        let outcome_ata_info = &ctx.remaining_accounts[leg_idx * 3 + 2];

        // Validate market PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[seeds::MARKET, leg.market_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            market_info.key() == expected_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // outcome_mint PDA must match the leg's outcome
        let (expected_mint_pda, _) = Pubkey::find_program_address(
            &[seeds::OUTCOME_MINT, leg.market_id.to_le_bytes().as_ref(), leg.outcome_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require!(
            outcome_mint_info.key() == expected_mint_pda,
            QuadraticMarketError::InvalidRemainingAccount
        );

        // Validate ATA ownership and mint
        let ata_data = outcome_ata_info.data.borrow();
        let ata: TokenAccount = TokenAccount::try_deserialize(&mut ata_data.as_ref())
            .map_err(|_| QuadraticMarketError::InvalidRemainingAccount)?;
        drop(ata_data);

        require!(ata.owner == ctx.accounts.claimer.key(), QuadraticMarketError::InvalidRemainingAccount);
        require!(ata.mint == expected_mint_pda, QuadraticMarketError::InvalidRemainingAccount);

        // Clone AccountInfos for burn phase — owned copies have no lifetime constraints
        burn_data.push((
            outcome_mint_info.clone(),
            outcome_ata_info.clone(),
            ata.amount,
        ));
    }

    // Release the locked payout that was reserved for this slip
    config.locked_payouts = config.locked_payouts.saturating_sub(slip.locked_amount);

    // ── Phase 2: Execute burns ──
    // Burn all outcome tokens held by the claimer for each leg.
    // This prevents double-claim: user cannot later call claim_payout for the
    // same outcome tokens after receiving the stake refund.
    let claimer_info = ctx.accounts.claimer.to_account_info();
    for (outcome_mint_info, outcome_ata_info, burn_amount) in burn_data {
        if burn_amount > 0 {
            token::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Burn {
                        mint: outcome_mint_info,
                        from: outcome_ata_info,
                        authority: claimer_info.clone(),
                    },
                ),
                burn_amount,
            )?;
        }
    }

    // ── Phase 3: Transfer refund ──
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
        refund,
    )?;

    // Slip account is closed via `close = claimer` — rent returned to user.
    Ok(())
}

// ─── Close Market ──────────────────────────────────────────────
// Reclaims rent once a market is fully settled or voided.

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CloseMarket<'info> {
    #[account(
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [seeds::MARKET, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Settled
            || market.status == MarketStatus::Voided
            @ QuadraticMarketError::InvalidMarketStatus,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn close_market_handler(ctx: Context<CloseMarket>, _market_id: u64) -> Result<()> {
    // Only admin or the market creator can close
    require!(
        ctx.accounts.authority.key() == ctx.accounts.market.creator
            || ctx.accounts.authority.key() == ctx.accounts.global_config.admin,
        QuadraticMarketError::Unauthorized
    );

    // Zero the discriminator before draining lamports. The previous manual
    // lamport drain left the 8-byte discriminator intact, allowing the PDA to
    // be re-initialized and old stale data to be read by claim/slip logic.
    let market_account = ctx.accounts.market.to_account_info();
    let mut data = market_account.try_borrow_mut_data()?;
    data[0..8].fill(0);
    drop(data);

    // Return rent to authority
    let lamports = market_account.lamports();
    **market_account.try_borrow_mut_lamports()? = 0;
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += lamports;

    Ok(())
}

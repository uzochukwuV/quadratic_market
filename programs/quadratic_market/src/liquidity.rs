use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, WithdrawalRequest, PendingLiquidity};
use crate::errors::QuadraticMarketError;
use crate::constants::{seeds, SCALE};

// ─── Helper: compute fixed activation time ─────────────────────
//
// activation_time = epoch_start(now) + 2 * epoch_duration
// Everyone depositing in the same epoch window gets the same activation time.
// No timing arbitrage.

fn compute_activation_time(now: i64, epoch_duration: i64) -> i64 {
    let epoch_start = (now / epoch_duration) * epoch_duration;
    epoch_start + 2 * epoch_duration
}

// ─── Helper: advance epoch ─────────────────────────────────────

fn advance_epoch(config: &mut GlobalConfig, now: i64) -> Result<()> {
    if config.epoch_duration_seconds > 0 {
        let computed = (now / config.epoch_duration_seconds) as u64;
        if computed > config.current_epoch {
            config.current_epoch = computed;
        }
    }
    Ok(())
}

// ─── Add Liquidity ─────────────────────────────────────────────

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        constraint = lp_mint.key() == global_config.lp_mint @ QuadraticMarketError::Unauthorized,
    )]
    pub lp_mint: Account<'info, Mint>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Treasury's base token account (receives the deposit)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// LP's base token account (source of deposit)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = provider,
    )]
    pub provider_base_ata: Account<'info, TokenAccount>,

    /// LP's LP token account (receives LP shares — minted but shares are locked)
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = provider,
    )]
    pub provider_lp_ata: Account<'info, TokenAccount>,

    /// The base token mint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    /// Pending liquidity PDA — tracks locked shares until activation_time.
    /// Created on first deposit, accumulated on subsequent deposits.
    #[account(
        init_if_needed,
        payer = provider,
        space = PendingLiquidity::LEN,
        seeds = [seeds::PENDING, provider.key().as_ref()],
        bump,
    )]
    pub pending_liquidity: Account<'info, PendingLiquidity>,

    #[account(mut)]
    pub provider: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn add_liquidity_handler(ctx: Context<AddLiquidity>, amount: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);
    require!(amount > 0, QuadraticMarketError::InvalidAmount);

    let now = Clock::get()?.unix_timestamp;

    // Auto-advance epoch
    advance_epoch(config, now)?;

    // Compute fixed activation time
    let activation_time = compute_activation_time(now, config.epoch_duration_seconds);

    let reserve_balance = ctx.accounts.treasury_base_ata.amount;
    let total_supply = config.total_lp_supply;

    let shares_to_mint = if total_supply == 0 || reserve_balance == 0 {
        // First depositor — ERC4626 inflation fix
        require!(
            amount > config.min_first_liquidity,
            QuadraticMarketError::AmountTooSmall
        );
        config.total_lp_supply = config.min_first_liquidity;
        amount - config.min_first_liquidity
    } else {
        // shares = amount * total_supply / reserve_balance
        ((amount as u128)
            .checked_mul(total_supply as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?)
            .checked_div(reserve_balance as u128)
            .ok_or(QuadraticMarketError::MathOverflow)? as u64
    };

    require!(shares_to_mint > 0, QuadraticMarketError::InvalidAmount);

    // Transfer base tokens from provider to treasury
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.provider_base_ata.to_account_info(),
        to: ctx.accounts.treasury_base_ata.to_account_info(),
        authority: ctx.accounts.provider.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount,
    )?;

    // Mint LP tokens immediately — shares count toward total_supply from now
    // This maintains the invariant: assets and supply increase simultaneously
    let cpi_accounts = token::MintTo {
        mint: ctx.accounts.lp_mint.to_account_info(),
        to: ctx.accounts.provider_lp_ata.to_account_info(),
        authority: config.to_account_info(),
    };
    let seeds_list = &[seeds::GLOBAL_CONFIG, &[config.bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[seeds_list],
        ),
        shares_to_mint,
    )?;

    config.total_lp_supply = config.total_lp_supply
        .checked_add(shares_to_mint)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    // Record locked shares in PendingLiquidity PDA
    let pending = &mut ctx.accounts.pending_liquidity;
    if pending.lp == Pubkey::default() {
        // New pending deposit
        pending.lp = ctx.accounts.provider.key();
        pending.shares = shares_to_mint;
        pending.activation_time = activation_time;
        pending.amount_deposited = amount;
        pending.bump = ctx.bumps.pending_liquidity;
    } else {
        // Accumulate into existing pending — activation_time stays the same
        pending.shares = pending.shares
            .checked_add(shares_to_mint)
            .ok_or(QuadraticMarketError::MathOverflow)?;
        pending.amount_deposited = pending.amount_deposited
            .checked_add(amount)
            .ok_or(QuadraticMarketError::MathOverflow)?;
    }

    Ok(())
}

// ─── Request Withdrawal ────────────────────────────────────────

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        constraint = lp_mint.key() == global_config.lp_mint @ QuadraticMarketError::Unauthorized,
    )]
    pub lp_mint: Account<'info, Mint>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Treasury's base token account (for NAV snapshot)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// Treasury's LP token escrow account
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_lp_ata: Account<'info, TokenAccount>,

    /// LP's LP token account (source of shares)
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = lp,
    )]
    pub lp_lp_ata: Account<'info, TokenAccount>,

    /// CHECK: Pending liquidity PDA — used to check locked shares
    #[account(
        seeds = [seeds::PENDING, lp.key().as_ref()],
        bump,
    )]
    pub pending_liquidity: UncheckedAccount<'info>,

    /// LP's withdrawal request PDA
    #[account(
        init,
        payer = lp,
        space = WithdrawalRequest::LEN,
        seeds = [seeds::WITHDRAWAL, lp.key().as_ref()],
        bump,
    )]
    pub withdrawal_request: Account<'info, WithdrawalRequest>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(mut)]
    pub lp: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn request_withdraw_handler(ctx: Context<RequestWithdraw>, shares: u64) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);
    require!(shares > 0, QuadraticMarketError::InvalidAmount);
    require!(
        ctx.accounts.lp_lp_ata.amount >= shares,
        QuadraticMarketError::InsufficientLpShares
    );

    // Check LP doesn't have pending (locked) shares that would prevent withdrawal
    let pending_data = ctx.accounts.pending_liquidity.data.borrow();
    let pending_locked: u64 = if pending_data.len() > 8 {
        // Check if the PDA is initialized (has a valid lp pubkey)
        let mut lp_bytes = [0u8; 32];
        lp_bytes.copy_from_slice(&pending_data[8..40]);
        let pending_lp = Pubkey::new_from_array(lp_bytes);
        if pending_lp != Pubkey::default() {
            // Has pending shares — read shares count at offset 8+32=40
            let mut shares_bytes = [0u8; 8];
            shares_bytes.copy_from_slice(&pending_data[40..48]);
            u64::from_le_bytes(shares_bytes)
        } else {
            0
        }
    } else {
        0
    };
    drop(pending_data);

    // Only check if pending shares exist AND haven't been activated yet
    if pending_locked > 0 {
        // Read activation_time to check if already activated
        let pending_data2 = ctx.accounts.pending_liquidity.data.borrow();
        let mut time_bytes = [0u8; 8];
        time_bytes.copy_from_slice(&pending_data2[48..56]);
        let activation_time = i64::from_le_bytes(time_bytes);
        drop(pending_data2);

        let now = Clock::get()?.unix_timestamp;
        if now < activation_time {
            // Shares are still locked — LP can only withdraw non-locked shares
            let available = ctx.accounts.lp_lp_ata.amount.saturating_sub(pending_locked);
            require!(
                shares <= available,
                QuadraticMarketError::SharesStillLocked
            );
        }
        // If activation_time has passed, the pending lock is effectively expired
        // (activate_liquidity will close the PDA, but until then we allow withdrawal)
    }

    // Transfer LP tokens to treasury escrow
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.lp_lp_ata.to_account_info(),
        to: ctx.accounts.treasury_lp_ata.to_account_info(),
        authority: ctx.accounts.lp.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        shares,
    )?;

    // Snapshot NAV at request time (for NAV-locked payout)
    let total_reserve = ctx.accounts.treasury_base_ata.amount;
    let free_liquidity = config.free_liquidity(total_reserve);

    let share_price_snapshot = if config.total_lp_supply > 0 {
        ((free_liquidity as u128)
            .checked_mul(SCALE as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?)
            .checked_div(config.total_lp_supply as u128)
            .ok_or(QuadraticMarketError::MathOverflow)? as u64
    } else {
        0
    };

    // Record withdrawal request with cooldown + NAV snapshot
    let now = Clock::get()?.unix_timestamp;
    let cooldown_end = now
        .checked_add(config.withdrawal_cooldown_seconds)
        .ok_or(QuadraticMarketError::MathOverflow)?;

    let req = &mut ctx.accounts.withdrawal_request;
    req.lp = ctx.accounts.lp.key();
    req.shares = shares;
    req.requested_at = now;
    req.cooldown_end = cooldown_end;
    req.nav_snapshot = free_liquidity;
    req.share_price_snapshot = share_price_snapshot;
    req.bump = ctx.bumps.withdrawal_request;

    Ok(())
}

// ─── Process Withdrawal ────────────────────────────────────────

#[derive(Accounts)]
pub struct ProcessWithdrawal<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        constraint = lp_mint.key() == global_config.lp_mint @ QuadraticMarketError::Unauthorized,
    )]
    pub lp_mint: Account<'info, Mint>,

    /// CHECK: Treasury PDA
    #[account(
        seeds = [seeds::TREASURY],
        bump = global_config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// Treasury's base token account
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    /// Treasury's LP token escrow account
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_lp_ata: Account<'info, TokenAccount>,

    /// LP's base token account (receives withdrawal)
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = withdrawal_request.lp,
    )]
    pub lp_base_ata: Account<'info, TokenAccount>,

    /// CHECK: Validated by constraint
    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [seeds::WITHDRAWAL, withdrawal_request.lp.as_ref()],
        bump = withdrawal_request.bump,
        close = authority,
    )]
    pub withdrawal_request: Account<'info, WithdrawalRequest>,

    /// Admin or bot processes withdrawals
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn process_withdrawal_handler(ctx: Context<ProcessWithdrawal>) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    let req = &ctx.accounts.withdrawal_request;

    // Enforce cooldown
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= req.cooldown_end,
        QuadraticMarketError::CooldownNotElapsed
    );

    let total_reserve = ctx.accounts.treasury_base_ata.amount;
    let free_liquidity = config.free_liquidity(total_reserve);

    // Compute current share price in Q32.32
    let current_share_price = if config.total_lp_supply > 0 {
        ((free_liquidity as u128)
            .checked_mul(SCALE as u128)
            .ok_or(QuadraticMarketError::MathOverflow)?)
            .checked_div(config.total_lp_supply as u128)
            .ok_or(QuadraticMarketError::MathOverflow)? as u64
    } else {
        0
    };

    // Payout = shares * min(snapshot_price, current_price) / SCALE
    // LP gets the worse of the two prices — prevents gaming the system
    let payout_price = std::cmp::min(req.share_price_snapshot, current_share_price);
    let amount_to_return = ((req.shares as u128)
        .checked_mul(payout_price as u128)
        .ok_or(QuadraticMarketError::MathOverflow)?)
        .checked_div(SCALE as u128)
        .ok_or(QuadraticMarketError::MathOverflow)? as u64;

    require!(
        amount_to_return > 0,
        QuadraticMarketError::InsufficientFreeLiquidity
    );
    require!(
        free_liquidity >= amount_to_return,
        QuadraticMarketError::InsufficientFreeLiquidity
    );

    // Reduce total supply
    config.total_lp_supply = config.total_lp_supply
        .checked_sub(req.shares)
        .ok_or(QuadraticMarketError::MathUnderflow)?;

    // Transfer base tokens from treasury to LP
    let treasury_seeds = &[seeds::TREASURY, &[config.treasury_bump]];
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.treasury_base_ata.to_account_info(),
        to: ctx.accounts.lp_base_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[treasury_seeds],
        ),
        amount_to_return,
    )?;

    // Burn the escrowed LP tokens
    let cpi_accounts = token::Burn {
        mint: ctx.accounts.lp_mint.to_account_info(),
        from: ctx.accounts.treasury_lp_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[treasury_seeds],
        ),
        req.shares,
    )?;

    // withdrawal_request PDA is closed via `close = authority` constraint
    // rent goes to the authority who processed the withdrawal

    Ok(())
}

// ─── Activate Liquidity ────────────────────────────────────────

#[derive(Accounts)]
pub struct ActivateLiquidity<'info> {
    #[account(
        mut,
        seeds = [seeds::GLOBAL_CONFIG],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    /// The pending liquidity PDA to activate
    #[account(
        mut,
        seeds = [seeds::PENDING, pending_liquidity.lp.as_ref()],
        bump = pending_liquidity.bump,
        close = caller,
    )]
    pub pending_liquidity: Account<'info, PendingLiquidity>,

    /// Anyone can call this to earn the rent refund
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn activate_liquidity_handler(ctx: Context<ActivateLiquidity>) -> Result<()> {
    let pending = &ctx.accounts.pending_liquidity;

    require!(pending.shares > 0, QuadraticMarketError::NoPendingLiquidity);

    let now = Clock::get()?.unix_timestamp;

    // Verify activation time has passed
    require!(
        now >= pending.activation_time,
        QuadraticMarketError::CooldownNotElapsed
    );

    // No minting needed — shares were already minted at deposit time.
    // Simply close the PendingLiquidity PDA (done via `close = caller` constraint).
    // The LP's shares are now "unlocked" — they can be used for withdrawal.

    Ok(())
}

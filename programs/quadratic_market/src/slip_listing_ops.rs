use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{GlobalConfig, BetSlip, SlipListing};
use crate::errors::QuadraticMarketError;
use crate::constants::seeds;

// ─── List Slip For Sale ─────────────────────────────────────────
//
// Seller (current slip creator) lists their position at `asking_price` USDC.
// The slip PDA is NOT transferred — the listing just records intent.
// The seller retains the slip until a buyer fills the listing.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct ListSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
        constraint = bet_slip.creator == seller.key() @ QuadraticMarketError::Unauthorized,
        constraint = !bet_slip.claimed @ QuadraticMarketError::SlipAlreadyClaimed,
    )]
    pub bet_slip: Account<'info, BetSlip>,

    #[account(
        init,
        payer = seller,
        space = SlipListing::LEN,
        seeds = [seeds::SLIP_LISTING, slip_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub slip_listing: Account<'info, SlipListing>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn list_slip_handler(
    ctx: Context<ListSlip>,
    slip_id: u64,
    asking_price: u64,
    expires_at: i64,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);
    require!(asking_price > 0, QuadraticMarketError::InvalidAmount);

    let now = Clock::get()?.unix_timestamp;
    if expires_at > 0 {
        require!(expires_at > now, QuadraticMarketError::MarketExpired);
    }

    let listing = &mut ctx.accounts.slip_listing;
    listing.listing_id = slip_id; // use slip_id as listing key (1 listing per slip at a time)
    listing.slip_id = slip_id;
    listing.seller = ctx.accounts.seller.key();
    listing.asking_price = asking_price;
    listing.created_at = now;
    listing.expires_at = expires_at;
    listing.bump = ctx.bumps.slip_listing;

    Ok(())
}

// ─── Cancel Listing ─────────────────────────────────────────────
//
// Seller removes their listing. The slip remains theirs.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct CancelListing<'info> {
    #[account(
        mut,
        seeds = [seeds::SLIP_LISTING, slip_id.to_le_bytes().as_ref()],
        bump = slip_listing.bump,
        constraint = slip_listing.seller == seller.key() @ QuadraticMarketError::Unauthorized,
        close = seller,
    )]
    pub slip_listing: Account<'info, SlipListing>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn cancel_listing_handler(
    _ctx: Context<CancelListing>,
    _slip_id: u64,
) -> Result<()> {
    // Listing PDA is closed via `close = seller`, rent returned.
    Ok(())
}

// ─── Buy Listed Slip ────────────────────────────────────────────
//
// Buyer fills the listing at the asking_price:
//   1. Buyer pays asking_price USDC to seller (minus protocol fee).
//   2. Protocol fee is kept in treasury.
//   3. bet_slip.creator is updated to buyer.
//   4. Listing PDA is closed.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct BuyListedSlip<'info> {
    #[account(mut, seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [seeds::BET_SLIP, slip_id.to_le_bytes().as_ref()],
        bump = bet_slip.bump,
        constraint = !bet_slip.claimed @ QuadraticMarketError::SlipAlreadyClaimed,
    )]
    pub bet_slip: Account<'info, BetSlip>,

    #[account(
        mut,
        seeds = [seeds::SLIP_LISTING, slip_id.to_le_bytes().as_ref()],
        bump = slip_listing.bump,
        constraint = slip_listing.seller == bet_slip.creator @ QuadraticMarketError::Unauthorized,
        close = buyer,
    )]
    pub slip_listing: Account<'info, SlipListing>,

    /// CHECK: Treasury PDA — receives protocol fee
    #[account(seeds = [seeds::TREASURY], bump = global_config.treasury_bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = buyer)]
    pub buyer_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = slip_listing.seller)]
    pub seller_base_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = treasury)]
    pub treasury_base_ata: Account<'info, TokenAccount>,

    #[account(constraint = base_mint.key() == global_config.base_mint @ QuadraticMarketError::Unauthorized)]
    pub base_mint: Account<'info, Mint>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn buy_listed_slip_handler(
    ctx: Context<BuyListedSlip>,
    slip_id: u64,
) -> Result<()> {
    let config = &ctx.accounts.global_config;
    require!(!config.paused, QuadraticMarketError::Paused);

    let listing = &ctx.accounts.slip_listing;
    let now = Clock::get()?.unix_timestamp;
    if listing.expires_at > 0 {
        require!(now < listing.expires_at, QuadraticMarketError::OrderExpired);
    }

    let asking_price = listing.asking_price;
    let fee_bps = config.slip_listing_fee_bps;

    // Protocol fee stays in treasury; seller receives asking_price - fee
    let protocol_fee = asking_price
        .checked_mul(fee_bps)
        .ok_or(QuadraticMarketError::MathOverflow)?
        / 10_000;
    let seller_amount = asking_price
        .checked_sub(protocol_fee)
        .ok_or(QuadraticMarketError::MathUnderflow)?;

    // 1. Transfer seller_amount from buyer to seller
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.buyer_base_ata.to_account_info(),
                to: ctx.accounts.seller_base_ata.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        seller_amount,
    )?;

    // 2. Transfer protocol_fee from buyer to treasury
    if protocol_fee > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.buyer_base_ata.to_account_info(),
                    to: ctx.accounts.treasury_base_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            protocol_fee,
        )?;
    }

    // 3. Transfer slip ownership to buyer
    ctx.accounts.bet_slip.creator = ctx.accounts.buyer.key();

    // Listing PDA is closed via `close = buyer`, rent returned to buyer as incentive.
    let _ = slip_id; // used in PDA derivation via instruction constraint
    Ok(())
}

// ─── Update Listing Price ───────────────────────────────────────
//
// Seller updates the asking price before the listing is filled.

#[derive(Accounts)]
#[instruction(slip_id: u64)]
pub struct UpdateListing<'info> {
    #[account(
        mut,
        seeds = [seeds::SLIP_LISTING, slip_id.to_le_bytes().as_ref()],
        bump = slip_listing.bump,
        constraint = slip_listing.seller == seller.key() @ QuadraticMarketError::Unauthorized,
    )]
    pub slip_listing: Account<'info, SlipListing>,

    pub seller: Signer<'info>,
}

pub fn update_listing_handler(
    ctx: Context<UpdateListing>,
    _slip_id: u64,
    new_asking_price: u64,
    new_expires_at: i64,
) -> Result<()> {
    require!(new_asking_price > 0, QuadraticMarketError::InvalidAmount);

    let now = Clock::get()?.unix_timestamp;
    if new_expires_at > 0 {
        require!(new_expires_at > now, QuadraticMarketError::MarketExpired);
    }

    let listing = &mut ctx.accounts.slip_listing;
    listing.asking_price = new_asking_price;
    listing.expires_at = new_expires_at;

    Ok(())
}

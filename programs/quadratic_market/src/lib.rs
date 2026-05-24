use anchor_lang::prelude::*;

declare_id!("Ag5ccPBKNJbw1JZiTaMEZ1fZpfcDFkMrrwXqCkQA5ji9");

pub mod constants;
pub mod errors;
pub mod math;
pub mod state;
pub mod utils;

// Instruction modules
pub mod initialize;
pub mod admin;
pub mod liquidity;
pub mod market_ops;
pub mod trade;
pub mod swap_trade;
pub mod settlement;
pub mod claim;
pub mod market_group;
pub mod slip;
pub mod orders;
pub mod epoch_ops;
pub mod slip_listing_ops;

// Bring all account structs into scope so Anchor's #[program]
// macro references them directly
use initialize::*;
use admin::*;
use liquidity::*;
use market_ops::*;
use trade::*;
use swap_trade::*;
use settlement::*;
use claim::*;
use market_group::*;
use slip::*;
use orders::*;
use epoch_ops::*;
use slip_listing_ops::*;
use crate::state::market_group::CorrelationPair;
use crate::state::bet_slip::SlipLeg;
use crate::state::market::MarketMode;
use crate::state::order::OrderSide;

#[program]
pub mod quadratic_market {
    use super::*;

    // ─── Initialization ───────────────────────────────────────

    pub fn initialize(
        ctx: Context<Initialize>,
        oracle_pubkey: [u8; 32],
        max_market_exposure: u64,
    ) -> Result<()> {
        handler(ctx, oracle_pubkey, max_market_exposure)
    }

    // ─── Admin ────────────────────────────────────────────────

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        transfer_admin_handler(ctx, new_admin)
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        pause_handler(ctx)
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        unpause_handler(ctx)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        max_market_exposure: Option<u64>,
        challenge_window_seconds: Option<i64>,
        settlement_deadline_seconds: Option<i64>,
        lmsr_default_b: Option<u64>,
        slip_house_margin_bps: Option<u64>,
        max_slip_bonus_multiplier_bps: Option<u64>,
        epoch_duration_seconds: Option<i64>,
        withdrawal_cooldown_seconds: Option<i64>,
        max_single_bet: Option<u64>,
        min_outcome_price_bps: Option<u64>,
        buy_fee_bps: Option<u64>,
        oracle_pubkey: Option<[u8; 32]>,
        cash_out_margin_bps: Option<u64>,
        sell_fee_bps: Option<u64>,
        slip_listing_fee_bps: Option<u64>,
    ) -> Result<()> {
        update_config_handler(ctx, max_market_exposure, challenge_window_seconds, settlement_deadline_seconds, lmsr_default_b, slip_house_margin_bps, max_slip_bonus_multiplier_bps, epoch_duration_seconds, withdrawal_cooldown_seconds, max_single_bet, min_outcome_price_bps, buy_fee_bps, oracle_pubkey, cash_out_margin_bps, sell_fee_bps, slip_listing_fee_bps)
    }

    pub fn add_operator(ctx: Context<AddOperator>, operator: Pubkey) -> Result<()> {
        add_operator_handler(ctx, operator)
    }

    pub fn remove_operator(ctx: Context<RemoveOperator>, operator: Pubkey) -> Result<()> {
        remove_operator_handler(ctx, operator)
    }

    // ─── LP Operations ────────────────────────────────────────

    pub fn add_liquidity(ctx: Context<AddLiquidity>, amount: u64) -> Result<()> {
        add_liquidity_handler(ctx, amount)
    }

    pub fn init_pending_liquidity(
        ctx: Context<InitPendingLiquidity>,
        shares: u64,
        activation_time: i64,
        amount: u64,
    ) -> Result<()> {
        init_pending_liquidity_handler(ctx, shares, activation_time, amount)
    }

    pub fn request_withdraw(ctx: Context<RequestWithdraw>, shares: u64) -> Result<()> {
        request_withdraw_handler(ctx, shares)
    }

    pub fn process_withdrawal(ctx: Context<ProcessWithdrawal>) -> Result<()> {
        process_withdrawal_handler(ctx)
    }

    pub fn activate_liquidity(ctx: Context<ActivateLiquidity>) -> Result<()> {
        activate_liquidity_handler(ctx)
    }

    // ─── Market Operations ────────────────────────────────────

    pub fn create_market(
        ctx: Context<CreateMarket>,
        start_time: i64,
        num_outcomes: u8,
        title: String,
        description: String,
        category: u8,
        lmsr_b_override: Option<u64>,
        initial_q_values: Option<Vec<u64>>,
        market_mode: MarketMode,
    ) -> Result<()> {
        create_market_handler(ctx, start_time, num_outcomes, title, description, category, lmsr_b_override, initial_q_values, market_mode)
    }

    pub fn init_outcome_mint(
        ctx: Context<InitOutcomeMint>,
        market_id: u64,
        outcome_id: u8,
    ) -> Result<()> {
        init_outcome_mint_handler(ctx, market_id, outcome_id)
    }

    pub fn suspend_market(ctx: Context<SuspendMarket>) -> Result<()> {
        suspend_market_handler(ctx)
    }

    pub fn resume_market(ctx: Context<ResumeMarket>) -> Result<()> {
        resume_market_handler(ctx)
    }

    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        void_market_handler(ctx)
    }

    pub fn void_if_expired(ctx: Context<VoidIfExpired>) -> Result<()> {
        void_if_expired_handler(ctx)
    }

    // ─── Trading ──────────────────────────────────────────────

    pub fn buy_shares(
        ctx: Context<BuyShares>,
        outcome_id: u8,
        num_shares: u64,
        max_payment: u64,
    ) -> Result<()> {
        buy_shares_handler(ctx, outcome_id, num_shares, max_payment)
    }

    pub fn sell_shares(
        ctx: Context<SellShares>,
        outcome_id: u8,
        num_shares: u64,
        min_payout: u64,
    ) -> Result<()> {
        sell_shares_handler(ctx, outcome_id, num_shares, min_payout)
    }

    pub fn buy_shares_with_swap(
        ctx: Context<BuySharesWithSwap>,
        outcome_id: u8,
        num_shares: u64,
        max_payment: u64,
        min_base_from_swap: u64,
    ) -> Result<()> {
        buy_shares_with_swap_handler(ctx, outcome_id, num_shares, max_payment, min_base_from_swap)
    }

    // ─── Settlement ───────────────────────────────────────────

    pub fn propose_result(
        ctx: Context<ProposeResult>,
        market_id: u64,
        proposed_outcome: u8,
    ) -> Result<()> {
        propose_result_handler(ctx, market_id, proposed_outcome)
    }

    pub fn admin_override(
        ctx: Context<AdminOverride>,
        market_id: u64,
        correct_outcome: u8,
    ) -> Result<()> {
        admin_override_handler(ctx, market_id, correct_outcome)
    }

    pub fn finalize_result(ctx: Context<FinalizeResult>, market_id: u64) -> Result<()> {
        finalize_result_handler(ctx, market_id)
    }

    // ─── Claims ───────────────────────────────────────────────

    pub fn claim_payout(ctx: Context<ClaimPayout>, market_id: u64) -> Result<()> {
        claim_payout_handler(ctx, market_id)
    }

    pub fn close_market(ctx: Context<CloseMarket>, market_id: u64) -> Result<()> {
        close_market_handler(ctx, market_id)
    }

    /// Refund a user's original stake when the protocol is paused.
    pub fn claim_paused_bet(ctx: Context<ClaimPausedBet>, slip_id: u64) -> Result<()> {
        claim_paused_bet_handler(ctx, slip_id)
    }

    // ─── Market Group Operations ────────────────────────────────

    pub fn create_market_group(
        ctx: Context<CreateMarketGroup>,
        group_id: u64,
        max_group_exposure: u64,
        event_start_time: i64,
        title: String,
    ) -> Result<()> {
        create_market_group_handler(ctx, group_id, max_group_exposure, event_start_time, title)
    }

    pub fn add_market_to_group(
        ctx: Context<AddMarketToGroup>,
        group_id: u64,
        market_index: u8,
    ) -> Result<()> {
        add_market_to_group_handler(ctx, group_id, market_index)
    }

    pub fn add_correlation_pair(
        ctx: Context<AddCorrelationPair>,
        group_id: u64,
        pair: CorrelationPair,
    ) -> Result<()> {
        add_correlation_pair_handler(ctx, group_id, pair)
    }

    pub fn update_correlation_weight(
        ctx: Context<UpdateCorrelationWeight>,
        group_id: u64,
        pair_index: u8,
        new_weight_bps: u64,
    ) -> Result<()> {
        update_correlation_weight_handler(ctx, group_id, pair_index, new_weight_bps)
    }

    // ─── Correlated Trading ─────────────────────────────────────

    pub fn buy_shares_correlated<'info>(
        ctx: Context<'_, '_, '_, 'info, BuySharesCorrelated<'info>>,
        outcome_id: u8,
        num_shares: u64,
        max_payment: u64,
    ) -> Result<()> {
        buy_shares_correlated_handler(ctx, outcome_id, num_shares, max_payment)
    }

    pub fn sell_shares_correlated<'info>(
        ctx: Context<'_, '_, '_, 'info, SellSharesCorrelated<'info>>,
        outcome_id: u8,
        num_shares: u64,
        min_payout: u64,
    ) -> Result<()> {
        sell_shares_correlated_handler(ctx, outcome_id, num_shares, min_payout)
    }

    // ─── Bet Slip ───────────────────────────────────────────────

    pub fn place_slip<'info>(
        ctx: Context<'_, '_, '_, 'info, PlaceSlip<'info>>,
        legs: Vec<SlipLeg>,
        max_payment: u64,
        num_groups: u8,
    ) -> Result<()> {
        place_slip_handler(ctx, legs, max_payment, num_groups)
    }

    pub fn claim_slip<'info>(
        ctx: Context<'_, '_, '_, 'info, ClaimSlip<'info>>,
        slip_id: u64,
        num_groups: u8,
    ) -> Result<()> {
        claim_slip_handler(ctx, slip_id, num_groups)
    }

    pub fn update_slip_lock(
        ctx: Context<UpdateSlipLock>,
        slip_id: u64,
    ) -> Result<()> {
        update_slip_lock_handler(ctx, slip_id)
    }

    pub fn cash_out_slip<'info>(
        ctx: Context<'_, '_, '_, 'info, CashOutSlip<'info>>,
        slip_id: u64,
    ) -> Result<()> {
        cash_out_slip_handler(ctx, slip_id)
    }

    // ─── Peer-to-Peer Order Book ────────────────────────────────

    pub fn place_order(
        ctx: Context<PlaceOrder>,
        market_id: u64,
        outcome_id: u8,
        side: OrderSide,
        num_shares: u64,
        price_per_share: u64,
        expires_at: i64,
    ) -> Result<()> {
        place_order_handler(ctx, market_id, outcome_id, side, num_shares, price_per_share, expires_at)
    }

    pub fn fill_order(
        ctx: Context<FillOrder>,
        order_id: u64,
        fill_shares: u64,
    ) -> Result<()> {
        fill_order_handler(ctx, order_id, fill_shares)
    }

    pub fn cancel_order(
        ctx: Context<CancelOrder>,
        order_id: u64,
    ) -> Result<()> {
        cancel_order_handler(ctx, order_id)
    }

    pub fn expire_order(
        ctx: Context<ExpireOrder>,
        order_id: u64,
    ) -> Result<()> {
        expire_order_handler(ctx, order_id)
    }

    // ─── Epoch Management ─────────────────────────────────────────

    /// Create the on-chain Epoch account for the current epoch.
    /// Must be called before any markets can be created in a new epoch.
    pub fn init_epoch(ctx: Context<InitEpoch>) -> Result<()> {
        init_epoch_handler(ctx)
    }

    /// Advance to the next epoch. Requires all markets in the current epoch
    /// to be settled. Unpauses the epoch gate for the new epoch.
    pub fn advance_epoch(ctx: Context<AdvanceEpoch>) -> Result<()> {
        advance_epoch_handler(ctx)
    }

    /// Pause epoch — blocks deposits, withdrawals, and market creation.
    /// Admin can pause at any time (e.g. between epochs or for emergency).
    pub fn pause_epoch(ctx: Context<PauseEpoch>) -> Result<()> {
        pause_epoch_handler(ctx)
    }

    /// Unpause epoch — re-enables deposits, withdrawals, and market creation.
    pub fn unpause_epoch(ctx: Context<UnpauseEpoch>) -> Result<()> {
        unpause_epoch_handler(ctx)
    }

    /// Manually close an epoch and enable LP withdrawals.
    /// Normally auto-triggered when the last market in the epoch settles.
    pub fn close_epoch(ctx: Context<CloseEpoch>) -> Result<()> {
        close_epoch_handler(ctx)
    }

    // ─── Slip Listing / Auction (Polymarket-style) ─────────────────

    /// List a bet slip for sale at a fixed asking price.
    /// The seller retains the slip until a buyer fills the listing.
    pub fn list_slip(
        ctx: Context<ListSlip>,
        slip_id: u64,
        asking_price: u64,
        expires_at: i64,
    ) -> Result<()> {
        list_slip_handler(ctx, slip_id, asking_price, expires_at)
    }

    /// Cancel a slip listing — slip ownership stays with the original seller.
    pub fn cancel_listing(ctx: Context<CancelListing>, slip_id: u64) -> Result<()> {
        cancel_listing_handler(ctx, slip_id)
    }

    /// Buy a listed slip. Pays asking_price (minus protocol fee) to the seller
    /// and transfers slip ownership to the buyer.
    pub fn buy_listed_slip(ctx: Context<BuyListedSlip>, slip_id: u64) -> Result<()> {
        buy_listed_slip_handler(ctx, slip_id)
    }

    /// Update an active listing's asking price or expiry.
    pub fn update_listing(
        ctx: Context<UpdateListing>,
        slip_id: u64,
        new_asking_price: u64,
        new_expires_at: i64,
    ) -> Result<()> {
        update_listing_handler(ctx, slip_id, new_asking_price, new_expires_at)
    }
}

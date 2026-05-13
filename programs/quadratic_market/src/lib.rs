use anchor_lang::prelude::*;

declare_id!("9H1DCo5QaUtiMne4UH44aefHyv8Xpc8EgZwrshRZqsLC");

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
use crate::state::market_group::CorrelationPair;
use crate::state::bet_slip::SlipLeg;

#[program]
pub mod quadratic_market {
    use super::*;

    // ─── Initialization ───────────────────────────────────────

    pub fn initialize(
        ctx: Context<Initialize>,
        oracle_pubkey: [u8; 32],
        max_market_exposure: u64,
        challenge_window_seconds: i64,
        min_dispute_stake: u64,
        min_market_bond: u64,
    ) -> Result<()> {
        handler(ctx, oracle_pubkey, max_market_exposure, challenge_window_seconds, min_dispute_stake, min_market_bond)
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
        min_dispute_stake: Option<u64>,
        min_market_bond: Option<u64>,
        lmsr_default_b: Option<u64>,
        slip_house_margin_bps: Option<u64>,
        max_slip_bonus_multiplier_bps: Option<u64>,
    ) -> Result<()> {
        update_config_handler(ctx, max_market_exposure, challenge_window_seconds, min_dispute_stake, min_market_bond, lmsr_default_b, slip_house_margin_bps, max_slip_bonus_multiplier_bps)
    }

    // ─── LP Operations ────────────────────────────────────────

    pub fn add_liquidity(ctx: Context<AddLiquidity>, amount: u64) -> Result<()> {
        add_liquidity_handler(ctx, amount)
    }

    pub fn request_withdraw(ctx: Context<RequestWithdraw>, shares: u64) -> Result<()> {
        request_withdraw_handler(ctx, shares)
    }

    pub fn process_withdrawal(ctx: Context<ProcessWithdrawal>) -> Result<()> {
        process_withdrawal_handler(ctx)
    }

    // ─── Market Operations ────────────────────────────────────

    pub fn create_market(
        ctx: Context<CreateMarket>,
        start_time: i64,
        num_outcomes: u8,
        bond_amount: u64,
        title: String,
        description: String,
        category: u8,
        lmsr_b_override: Option<u64>,
        initial_q_values: Option<Vec<u64>>,
    ) -> Result<()> {
        create_market_handler(ctx, start_time, num_outcomes, bond_amount, title, description, category, lmsr_b_override, initial_q_values)
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

    pub fn dispute_result(
        ctx: Context<DisputeResult>,
        market_id: u64,
        round: u32,
        challenge_outcome: u8,
    ) -> Result<()> {
        dispute_result_handler(ctx, market_id, round, challenge_outcome)
    }

    pub fn escalate_dispute(
        ctx: Context<EscalateDispute>,
        market_id: u64,
        current_round: u32,
        proposed_outcome: u8,
    ) -> Result<()> {
        escalate_dispute_handler(ctx, market_id, current_round, proposed_outcome)
    }

    pub fn finalize_result(
        ctx: Context<FinalizeResult>,
        market_id: u64,
        round: u32,
    ) -> Result<()> {
        finalize_result_handler(ctx, market_id, round)
    }

    // ─── Claims ───────────────────────────────────────────────

    pub fn claim_payout(ctx: Context<ClaimPayout>, market_id: u64) -> Result<()> {
        claim_payout_handler(ctx, market_id)
    }

    pub fn claim_market_bond(ctx: Context<ClaimMarketBond>, market_id: u64) -> Result<()> {
        claim_market_bond_handler(ctx, market_id)
    }

    pub fn close_market(ctx: Context<CloseMarket>, market_id: u64) -> Result<()> {
        close_market_handler(ctx, market_id)
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
        slip_id: u64,
        legs: Vec<SlipLeg>,
        max_payment: u64,
    ) -> Result<()> {
        place_slip_handler(ctx, slip_id, legs, max_payment)
    }

    pub fn claim_slip(
        ctx: Context<ClaimSlip>,
        slip_id: u64,
    ) -> Result<()> {
        claim_slip_handler(ctx, slip_id)
    }

    pub fn update_slip_lock(
        ctx: Context<UpdateSlipLock>,
        slip_id: u64,
    ) -> Result<()> {
        update_slip_lock_handler(ctx, slip_id)
    }
}

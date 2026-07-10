# quadratic_market — Architecture Flow & Build Plan (v2)

Branch: `openchange` @ `c104d91` — re-checked against `origin/openchange`, no changes since the last pass. Same ground truth applies: `slip.rs` is deleted (`42bc0b6`), `CorrelationPair`/`profit_exposure`/`locked_payouts` are already fixed on this branch, `MarketMode::FixedOdds` already exists (used by `orders.rs`), `oracle_pubkey` is still a single hot-swappable key, `Epoch` is still a single global rolling struct with no per-LP opt-in or vault segregation.

This version replaces the "phase-by-bug-item" structure with the actual end-to-end lifecycle you described, so the sequencing and account boundaries are explicit at every step.

---

## The flow, start to finish

```
 1. PUBLISH EPOCH        operator aggregates upcoming markets from API, publishes list
        │
 2. LP OPT-IN            LPs choose whether to seed *this* epoch, deposit into epoch vault
        │
 3. SEED & OPEN          initial LMSR q-values set from epoch vault; markets → Open
        │
        ├── 4a. DIRECT TRADE (LMSR)         ── unchanged, existing trade.rs
        │
        └── 4b. BETSLIP (fixed odds)
                 place_slip_await → N individual on-chain buys under 1 Slip PDA
        │
 5. SETTLEMENT           staked operators propose/confirm outcome (2-of-3), quorum finalizes
        │
        ├── 6a. Direct bettors → claim_payout (existing, unchanged)
        │
        └── 6b. SLIP RESOLUTION
                 settle_slip_leg × N (individual, permissionless)
                 → resolve_slip (finalize: all legs won → user, else → LP)
        │
 7. EPOCH CLOSE          all markets settled → epoch vault pays out pro-rata to opted-in LPs
```

Each numbered stage below is one on-chain state transition (or a small state machine), owned by a specific account, with the account boundaries chosen so failure in one stage can't corrupt another.

---

## 1. Publish epoch

**New account:** `Epoch` already exists but is currently opened implicitly. Make publishing explicit and read-only (no funds move):

```rust
pub fn publish_epoch_handler(ctx: Context<PublishEpoch>, epoch_id: u64, market_ids: Vec<u64>) -> Result<()> {
    // operator-gated (config.is_authorized), not admin-only — this is routine ops work
    let epoch = &mut ctx.accounts.epoch;
    epoch.epoch_id = epoch_id;
    epoch.num_markets = market_ids.len() as u16;
    epoch.start_time = Clock::get()?.unix_timestamp;
    // market_ids recorded either inline (if small) or as a separate EpochMarkets PDA
    // if you expect an epoch to hold more markets than comfortably fits one account
    Ok(())
}
```

This is the announcement LPs will see before choosing to seed. No LP funds are touched yet — that's the whole point of splitting this out as its own step instead of the current model where seeding and market creation happen together.

---

## 2. LP opt-in epoch liquidity

This is where the current design's real gap is: today there is one global `treasury: Pubkey` and one rolling `Epoch`, so `free_liquidity()` can't (and doesn't) reason about "capital committed to epoch 5 vs epoch 6" — it only tracks `config.locked_payouts` globally, never rolling up `market.locked_payout` per market. That's the accounting bug from before, and it's still there.

Fix: **per-epoch vault PDA**, not a shared pool.

```rust
seeds = [b"epoch_vault", epoch_id.to_le_bytes().as_ref()]

pub fn opt_in_epoch_liquidity(ctx: Context<OptInEpoch>, epoch_id: u64, amount: u64) -> Result<()> {
    // transfer `amount` from LP into epoch_vault[epoch_id]'s base ATA
    // mint epoch-scoped LP shares (or track amount directly if you don't need transferable shares)
    Ok(())
}
```

- An LP who opts into epoch 5 has capital *only* in `epoch_vault[5]`. Epoch 6's activity cannot touch it, by construction — no shared pot, no need to keep a global subtraction in sync.
- `free_liquidity(epoch_id)` becomes: `epoch_vault_balance - sum(market.locked_payout for market in epoch)`. Since an epoch has a small, known, published set of markets (step 1), this sum is cheap and exact — no drift risk from forgetting to update a counter somewhere.
- LPs who don't opt in have zero exposure to that epoch. This is the "opt-in per round" semantics you described, and it also removes the need for a continuously-fungible cross-epoch LP token, which never quite matched opt-in anyway.

---

## 3. Seed & open

Once an epoch's vault has liquidity, operators set each market's initial LMSR parameters (`lmsr_default_b`, initial q-values) from that epoch's vault, and markets transition `PreOpen → Open`. This is the existing `market_ops.rs` flow, just re-pointed at `epoch_vault[epoch_id]` instead of the global treasury as the backing source.

Important: **LP's role from here on is only the initial hedge.** Once a market is open, LMSR pricing takes over the curve — LP isn't actively rebalancing per-trade, it's just the capital sitting behind the curve's worst case. This matches what you said: *"lp only hedges the initial qvalue and lmrs can take from there."* No change needed to the LMSR math itself (`math/lmsr.rs`) — this is purely about which vault backs it.

---

## 4a. Direct trading (LMSR) — unchanged

Existing `trade.rs` buy/sell paths. `profit_exposure` and `locked_payout` accounting are already correct here (verified against current HEAD). No changes in this plan.

## 4b. Betslip (fixed odds) — the rebuild

**Decision, confirmed:** keep LMSR for direct trading, use `MarketMode::FixedOdds` (already exists, already used by `orders.rs`) for every slip leg. Don't remove LMSR system-wide.

Why, concretely, given the epoch-vault design above: LMSR is what makes step 3 meaningful — an epoch's LP capital is backing a *curve*, not a fixed liability table. If you dropped LMSR entirely, "LP hedges the initial q-value" stops meaning anything, since there'd be no curve to hedge — you'd just be a bookmaker with a fixed payout table, and the whole opt-in-epoch-vault design in step 2 loses its purpose. Fixed odds only makes sense as the *slip-leg-specific* isolation layer, sitting on top of LMSR markets, not as a replacement for LMSR itself.

**place_slip_await(legs, stake):**
- User sends stake + desired markets/outcomes to your API.
- API assigns a protocol-issued `slip_id` (reuse the `next_slip_id` counter pattern already proven for `next_market_id` — never user-supplied, closes the collision/front-running gap from the old code).
- Odds for each leg are locked from your API at this moment into `Slip.leg_fixed_odds_bps` — **this is the number the user's payout is computed against**, not whatever LMSR price the on-chain buy happens to execute at.
- Backend then fires **N separate transactions**, one leg each, each structurally identical to a normal single-market buy (same account set, same stack footprint) — this is what avoids the old stack error: you were never actually forced to fit N legs into one instruction, you just need N *sequential* single-leg instructions all crediting the same Slip PDA as token holder instead of the user's own wallet.
- Any gap between the fixed-odds payout you've promised the user and what the LMSR purchase actually cost is the spread you're taking (or absorbing) for offering fixed odds on top of a floating market — track it as its own liability line (`slip_fixed_odds_exposure`) on the epoch vault, separate from `market.locked_payout`, so it's visible rather than silently blended into the LMSR numbers.
- Odds updates on live legs: allowed only pre-match, gated by `event_start_time` (already tracked on `Market`/`MarketGroup`) — matches what you asked for.
- `cancel_slip` with a deadline handles partial-fill failure (a leg's market got suspended mid-placement) — refunds whatever wasn't consumed rather than stranding funds.

---

## 5. Settlement — staked multi-operator

Current: `settlement.rs`'s `ProposeResult` is gated by a single `global_config.oracle_pubkey` — one key, no quorum, hot-swappable via `admin::update_config` with no timelock or event. This is the piece that needs replacing before slip settlement can trust `market.winning_outcome` at all, so it comes before step 6 in build order even though it's conceptually "just settlement."

```rust
#[account]
pub struct SettlementCouncil {
    pub operators: [Pubkey; MAX_SETTLEMENT_OPERATORS],
    pub stakes: [u64; MAX_SETTLEMENT_OPERATORS],
    pub min_stake: u64,
    pub required_confirmations: u8,   // 2 or 3, your call
    pub num_operators: u8,
}

#[account]
pub struct SettlementProposal {
    pub market_id: u64,
    pub proposed_outcome: u8,
    pub tx_hash_ref: [u8; 32],   // the API tx hash operator is attesting to
    pub confirmations_mask: u16,
    pub num_confirmations: u8,
    pub finalized: bool,
}
```

- `propose_settlement(market_id, outcome, tx_hash_ref)` — first staked operator opens the proposal.
- `confirm_settlement(market_id)` — subsequent operators confirm the *same* outcome; mismatched outcomes route into the existing `Dispute` flow rather than being silently overwritten.
- `finalize_settlement` — permissionless once `num_confirmations >= required_confirmations`; writes `market.winning_outcome`.
- Slashing on a losing dispute gives the stake actual teeth. Emit events at every step (`SettlementProposed/Confirmed/Finalized/OperatorSlashed`) — also plugs the "zero events anywhere in admin.rs" gap from the original review.
- Deprecate `global_config.oracle_pubkey` once this ships — no single key should unilaterally decide settlement outcomes anymore.

---

## 6a. Direct claim — unchanged

Existing `claim.rs` path, already correct.

## 6b. Slip resolution — confirmed design

**Your question 1, answered directly: yes**, settle individually per leg, then a separate finalize call. Concretely:

```rust
pub fn settle_slip_leg(ctx: Context<SettleLeg>, leg_index: u8) -> Result<()> {
    let bit = 1u16 << leg_index;
    require!(slip.legs_settled_mask & bit == 0, SlipError::LegAlreadySettled);
    require!(ctx.accounts.market.market_id == slip.leg_market_ids[leg_index as usize], SlipError::LegMismatch);

    let won = ctx.accounts.market.winning_outcome == slip.leg_outcome_ids[leg_index as usize];
    if won {
        // burn this leg's outcome tokens, redeem into Slip PDA's base ATA
        // — same burn-then-pay call site claim.rs already uses for single bets,
        //   not a hand-rolled variant (this is what prevents double-claim)
        slip.legs_won_mask |= bit;
    }
    // release this leg's exposure from market.exposure now, not deferred to finalize —
    // otherwise a slip with settled losing legs still phantom-blocks the market
    slip.legs_settled_mask |= bit;
    Ok(())
}

pub fn resolve_slip(ctx: Context<ResolveSlip>) -> Result<()> {
    let all_mask = (1u16 << slip.num_legs) - 1;
    require!(slip.legs_settled_mask == all_mask, SlipError::LegsNotSettled);

    if slip.legs_won_mask == all_mask {
        slip.status = SlipStatus::Won;
        // transfer Slip PDA balance → user
    } else {
        slip.status = SlipStatus::Lost;
        // sweep Slip PDA balance → LP vault (epoch_vault[epoch_id], not global treasury)
    }
    Ok(())
}
```

Both instructions are **permissionless** — the bot calls them in the normal case, but neither depends on the bot being online, and the win/loss branch is a program-level mask comparison, not something your backend decides by choosing which endpoint to call. A losing leg moves zero funds in `settle_slip_leg` (its stake already sits in that market's backing pool from the original buy); only winning legs' redemptions accumulate in the Slip PDA, which is what makes `resolve_slip`'s "else → LP" branch correct by construction rather than by extra bookkeeping.

Use a bitmask, not counters, for `legs_settled`/`legs_won` — a counter can be inflated by a retried/duplicate call for the same leg; a mask makes re-calling `settle_slip_leg` on an already-settled leg a guaranteed no-op.

---

## 7. Epoch close

Once `epoch.num_settled_markets == epoch.num_markets` (field already exists, just needs to gate the right vault), `epoch_vault[epoch_id]`'s balance — seed capital ± net LMSR result ± fees ± any `slip_fixed_odds_exposure` swept in from lost slips — distributes pro-rata to that epoch's opted-in LPs. No cross-epoch NAV calculation needed, since nothing crossed epoch boundaries to begin with.

---

## Question 2, answered directly

**Don't remove LMSR.** Keep it for direct single-market trading; route every betslip leg through `MarketMode::FixedOdds` (already built) instead. This is what step 3's "LP hedges the initial q-value" actually depends on — without LMSR there's no curve for an epoch's LP capital to be backing, and the whole opt-in-epoch-vault design in step 2 loses its purpose. Fixed odds is the right tool specifically for insulating slip bettors and LP from a whale moving one leg's curve mid-slip; it's not a reason to drop the curve everywhere.

---

## Build order

1. **Settlement multisig (step 5)** — everything downstream reads `market.winning_outcome`; get quorum trust right first.
2. **Epoch vaults + LP opt-in (steps 1–2)** — changes where LMSR seeding draws from; needs to be stable before slip liability sits on top of it.
3. **Slip rebuild with fixed odds built in from the start (steps 4b, 6b)** — leg settlement, exposure release, and odds-locking are coupled; ship together, not layered on after.

Each new account struct (`Epoch` additions, `SettlementCouncil`, `SettlementProposal`, `Slip`) should get its own Borsh-size unit test mirroring `state/market_group.rs`'s existing `market_group_layout_offsets_match_borsh` test before touching devnet — that one pattern is what catches the exact class of bug (`CorrelationPair` sizing) the old audit flagged, for the cost of five lines per struct.
# Seeding & Backing Model — Spec (for review before implementation)

This documents the agreed redesign of how markets open, who backs them, and how
the multi-leg slip bonus is funded. Nothing here is implemented yet — it is the
plan to approve.

## Goals (confirmed)

1. **Bet9ja-style opening odds** — the operator/oracle sets the opening line when
   a market is created.
2. **Polymarket-style dynamic pricing** — after opening, prices move via the
   existing LMSR (probabilities that sum to ~100%). **We keep LMSR.**
3. **Seeders fund each market's backing capital** — a market stays `PreOpen` until
   seeders escrow its risk budget. Seeder capital (not the LP) is that market's
   bankroll.
4. **LP only funds the multi-leg slip bonus** — single bets and single markets are
   backed by seeders, never the LP.
5. **5% revenue perk for losing-side seeders only** — winners already profit from
   their winning position; losers are consoled with a pro-rata share of the
   market's revenue.

## Why backing is required (the economics)

In an LMSR with liquidity parameter `B` and `N` outcomes, the market maker's
**maximum possible loss** is bounded by:

```
max_loss = B · ln(N)
```

This is the capital that must sit in the market's treasury to guarantee winners
can be paid even in the worst case (all money lands on the eventual winner).
"Setting odds to 2.5" is meaningless unless `max_loss` is funded. In this model
**seeders fund `max_loss` per market**.

> Note: bettors' own bet costs also flow into the treasury and grow the pot, so
> the seeder-funded `max_loss` is the *worst-case* backstop, not the expected
> outlay.

## Opening the line

`create_market` already accepts `initial_q_values: Option<Vec<u64>>`. We use it:

- Operator supplies the opening odds as **implied probabilities** (bps that sum to
  10_000) or decimal odds; the client converts to `q_values` via the existing
  `compute_seed_lmsr_q_values`-style back-solve: `q_i = B_raw·(ln(p_i) − min ln(p))`.
- The market is created `PreOpen` with those `q_values` already set (the line is
  fixed at creation).
- Seeding does **not** change the line anymore — it only funds the backstop.

## Seeding (real escrowed capital)

Replace the current bookkeeping-only `register_seed_position` with a **real,
signed, token-moving** seed instruction. Per seed:

- `seeder` is a **Signer** (today it is a plain `Pubkey` arg — a key bug).
- Transfers `amount` USDC `seeder → treasury` (today: **no transfer at all**).
- Records a `SeedPosition { seeder, market_index, outcome_id, amount, ... }`.
- Mints the seeder **1 outcome token per $1** seeded (H1 accounting — treasury
  solvent: winning seed redeems ≤ dollars collected; losing seed stays in pool).
- Enforces the per-outcome floor (see Activation).

### Activation (PreOpen → Open)

Market opens when the **risk budget is funded**. Two equivalent gates; we use the
clearer one:

- **Per-outcome floor:** every outcome has `seed_total_i ≥ MIN_SEED_PER_OUTCOME`
  (proposed default **$500** = `500_000_000`). This replaces today's aggregate-only
  `seed_min_volume` of $5,000 and the "every side > 0" rule.
- Optionally also assert `Σ seed_total ≥ B·ln(N)` so the backstop is provably
  funded. (If we want the $500/outcome floor to *be* the definition of "enough",
  we size `B` per market so `B·ln(N) ≤ N·$500`.)

The opening `q_values` are **already set from the operator line** at creation, so
activation no longer derives them from seed ratios (current
`compute_seed_lmsr_q_values` call in `activate_seeded_market` is dropped).

## Settlement & seeder returns

A seed is a normal LMSR position (H1: 1 token = $1):

- **Winning-side seeder:** redeems their outcome tokens 1:1 via the existing
  `claim_payout` → gets their **stake back** (no position profit/loss by design).
- **Losing-side seeder:** tokens worthless → stake stays in treasury **and** they
  claim the **5% revenue perk** pro-rata (existing `claim_seed_fee_reward`, which
  already pays only losing-side seeders).

## The 5% revenue perk (fix accrual)

Today the "5%" is 5% of the per-leg house margin (~0.25% of cost) and only accrues
on the legacy grouped `place_slip` path. Fix:

- Accrue **5% of every fee that market generates**, on **all** trade paths:
  - `buy_shares` / `buy_shares_correlated`: 5% of `buy_fee`.
  - slip legs (`add_slip_leg` and legacy `place_slip`): 5% of the leg's house
    margin.
- Accrue into a per-market seed-fee pool (existing `seed_fee_pools[market_index]`),
  reserved in `locked_payouts`.
- `claim_seed_fee_reward` already distributes it pro-rata to losing-side seeders —
  keep as-is.

## LP boundary (multi-slip bonus only)

- Single bets (`buy_shares`) and single-leg slips: backed by the **market treasury
  (seed capital + bet costs)**, not the LP. (Audit gap E4: today LP free-liquidity
  is consumed for single-bet LMSR profit — we move that liability onto the
  per-market seed backing.)
- Multi-leg slip **bonus gap** (`potential_payout − stake`, the amount above a fair
  parlay): funded by the **LP pool** via `locked_payouts`, as today
  (`finalize_slip`). All-win → user gets payout + bonus from treasury/LP;
  any-loss → stake stays for the LP. This branch already matches the model.

## Concrete change list (program)

1. **`create_market`**: keep `initial_q_values`; document that the operator passes
   the opening line. (Likely no code change — just usage.)
2. **New/!reworked `seed_market` instruction** (replaces bookkeeping
   `register_seed_position`):
   - accounts: `global_config`, `market_group`, `market`, `treasury`,
     `seeder_base_ata`, `treasury_base_ata`, `outcome_mint`, `seeder_outcome_ata`,
     `base_mint`, `seeder (Signer, mut)`, token/ata/system programs.
   - transfer `amount` to treasury, mint `amount` outcome tokens to seeder, record
     `SeedPosition`, bump `seed_fee`/exposure accounting.
3. **`activate_seeded_market`**: change gate to **≥ MIN_SEED_PER_OUTCOME per
   outcome**; stop deriving `q_values` from seeds (line already set at creation);
   set `market.exposure`/group exposure from real seeded totals.
4. **Fee accrual**: add 5%-to-seed-pool in `buy_shares`, `buy_shares_correlated`,
   `add_slip_leg`, and legacy `place_slip` (currently only the last, wrong base).
5. **LP boundary**: in `buy_shares`/single-leg paths, back liabilities against the
   market treasury rather than LP `free_liquidity` (keep LP check only for the
   multi-slip bonus gap).
6. **Constants**: add `MIN_SEED_PER_OUTCOME` (default $500); retune
   `DEFAULT_MIN_SEED_VOLUME` or remove its aggregate role.

## Open questions to resolve before coding

- **Q1 — `B` sizing:** do we keep a global default `B` (100,000 USDC) or set `B`
  per market so `B·ln(N)` matches the $500/outcome budget? (Smaller `B` = odds move
  faster per dollar; bigger `B` = deeper/stiffer line.)
- **Q2 — opening-line source:** operator passes implied-probability bps at
  `create_market`, converted client-side to `q_values`? Or add an on-chain helper
  that takes odds and sets `q_values`?
- **Q3 — winning seeder return:** confirm H1 "stake back only" (no position
  profit) is desired, with the 5% perk reserved for losers. (You said perk for
  losers only; winners just get their position. ✔)
- **Q4 — LP relief on single bets:** moving single-bet backing off the LP changes
  `free_liquidity`/`locked_payouts` accounting in `buy_shares` and `sell_shares` —
  confirm we want that now (bigger change) or defer and keep LP backing single
  bets for V1.

# Quadratic Market TxLINE Submission

## Core Idea

Quadratic Market is a Solana prediction market and sportsbook-style frontend powered by TxLINE sports data. Users place multi-leg prediction slips using mock BASE, a mock USDC-style token. LPs fund epoch vaults. A keeper bot creates, updates, settles, and resolves markets using TxLINE fixtures, odds, scores, and proof-oriented settlement data.

## Deployed Links

| Item | Link |
|---|---|
| Frontend | https://dzhigc9xax7br.cloudfront.net |
| Bot API | https://d17eznfv4qokvh.cloudfront.net |
| Public GitHub Repo | https://github.com/uuzor/quadratic_market |
| Solana Devnet Program | `FPaJasqbU2qULcJpbiGwduJix6dFRGK8JUefbXbSDcrN` |
| Base Mint | `8yqhLuiQRnvuU1RjDPM4kcRCcD1D5wPRfWdpG6dom3Vk` |

## What We Built

- A responsive sportsbook-style market dashboard.
- Real market fetch and normalization from on-chain markets created from TxLINE fixtures.
- One-selection-per-market betslip logic, so a user cannot select conflicting outcomes in the same market.
- Wallet connect using Solana wallet adapter.
- Mock BASE minting for devnet testing.
- On-chain multi-leg slip placement.
- Bot execution for pending slip legs.
- User bet slip transaction page at `/bets`.
- LP dashboard at `/lp` for deposits, withdrawals, epoch vault state, and per-wallet LP share tracking.
- Public bot API for minting, pending slip execution, and markets grouped by epoch.
- Anchor Solana program for markets, slips, settlement, epoch vaults, and LP positions.

## TxLINE Usage

TxLINE is the primary external data source.

The bot uses TxLINE for:

| TxLINE Data | Product Use |
|---|---|
| Fixtures | Automatically create fixture-based prediction markets. |
| Odds snapshots | Set and update market odds before match start. |
| Scores and final results | Determine winning outcomes for settlement. |
| Proof-oriented settlement data | Feed the custom settlement path designed around TxLINE validation primitives. |

The current market templates are:

| Market | Outcomes |
|---|---|
| Match result | `1`, `X`, `2` |
| Total goals | `O2.5`, `U2.5` |
| Both teams to score | `GG`, `NG` |

## Technical Highlights

### Solana Program

The Anchor program models the main protocol state on-chain:

- `Market`
- `Slip`
- `MarketGroup`
- `Epoch`
- `EpochVault`
- `EpochLpPosition`

User funds and LP funds move through program-derived accounts rather than a trusted backend wallet. Markets can be suspended, settled, voided, and closed. Slips can be placed, executed leg by leg, settled, and resolved.

### Epoch Liquidity

LP liquidity is grouped by epoch. The bot publishes or initializes an epoch and its vault before markets are created or traded. LPs deposit into the epoch vault before the first market starts. After all markets in the epoch are settled, withdrawals unlock for LPs.

This makes the LP risk window clear:

1. Epoch is published.
2. LP deposits before markets start.
3. Markets run and settle.
4. Epoch closes.
5. LP withdraws pro-rata liquidity.

### Bot Automation

The bot performs the market lifecycle:

1. Ensure active epoch and vault exist.
2. Add automatic epoch liquidity when enabled.
3. Fetch TxLINE fixtures.
4. Create markets.
5. Initialize outcome mints.
6. Update odds before kickoff.
7. Suspend markets at kickoff.
8. Settle markets from TxLINE final results and proof data.
9. Execute pending slip legs.
10. Resolve completed slips.
11. Close settled epochs.

## Bot API

Full API documentation is in [`bot/API.md`](./bot/API.md).

Important endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Bot health check. |
| `POST` | `/api/mint-base` | Mint mock BASE for devnet testing. |
| `GET` | `/api/slips/pending` | Return pending and active slips with unbought legs. |
| `POST` | `/api/slips/execute-pending` | Execute one pass over valid pending slip legs. |
| `GET` | `/api/markets/by-epoch` | Return markets grouped by epoch with vault state. |

## Demo Flow

Recommended judge walkthrough:

1. Open the deployed frontend.
2. Connect wallet.
3. Mint mock BASE if needed.
4. Select three odds from the market dashboard.
5. Show that selecting another outcome in the same market replaces the existing pick.
6. Place the slip.
7. Open `/bets` to show slip status and leg-level details.
8. Open `/lp` to show epoch liquidity vaults and LP tracking.
9. Open the bot API:
   - `https://d17eznfv4qokvh.cloudfront.net/health`
   - `https://d17eznfv4qokvh.cloudfront.net/api/markets/by-epoch`
   - `https://d17eznfv4qokvh.cloudfront.net/api/slips/pending`

## Why This Fits TxLINE

TxLINE is designed to be the sports data layer for betting and prediction apps. Quadratic Market uses it exactly that way:

- TxLINE drives market creation.
- TxLINE odds shape market pricing.
- TxLINE scores and validation data drive settlement.
- Solana handles escrow, LP accounting, and payouts.
- The frontend gives fans a familiar betting interface while keeping the protocol transparent.

## Feedback On TxLINE

What worked well:

- The normalized schema made it straightforward to map fixtures into repeatable market templates.
- Odds and score endpoints were easy to integrate into a keeper bot.
- The proof and validation direction is the strongest part of the platform because it allows apps to move beyond trusted backend settlement.

Friction:

- During a short hackathon, coordinating fixture timing, proof payload shape, and settlement windows required careful debugging.
- More small end-to-end examples for CPI validation and sample proof payloads would help teams move faster.
- Clearer demo data fixtures with predictable start and settlement times would make judging and local testing easier.

## Submission Assets

- Demo video: to be added in the Superteam Earn submission form.
- Frontend: https://dzhigc9xax7br.cloudfront.net
- Bot API: https://d17eznfv4qokvh.cloudfront.net
- Repo: https://github.com/uuzor/quadratic_market


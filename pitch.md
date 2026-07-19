# Quadratic Market Demo Voiceover

Use this as the text-to-speech narration for a screen recording. Target length is about 4 to 5 minutes.

## Voiceover Script

Hi, this is Quadratic Market, a Solana prediction market and sportsbook-style interface powered by TxLINE.

The problem we are solving is trust. Sports prediction apps need fast fixtures, odds, live scores, and final results, but users should not have to trust a private backend to decide who won. TxLINE gives us a normalized sports data layer with real-time odds and scores, plus cryptographic validation primitives that can anchor settlement on Solana.

Quadratic Market uses TxLINE as the primary data source. Our bot fetches TxLINE fixtures, creates standard football markets, updates odds from TxLINE snapshots, watches match start times, and settles markets from TxLINE final result data. The Solana program holds user stakes and LP liquidity in program-derived escrow accounts.

On the screen, this is the main market dashboard. The layout is inspired by familiar sportsbook tables. Each fixture is grouped by league and shows multiple independent markets: match result, over or under two point five goals, and both teams to score. Users can select odds directly from the table.

The betslip enforces the important market rule: a user can only pick one option from the same market. For example, if I pick GG, and then select NG for the same fixture and market, the previous pick is replaced. That prevents conflicting choices inside one slip.

As I select odds, the betslip updates immediately. It shows each selected leg, the total combined odds, the stake, and the potential return. This gives users a consumer-grade betting flow while the actual state is handled by Solana accounts.

Before placing a slip, the user connects a Solana wallet. For demo and devnet usage, we mint mock BASE, our mock USDC-style token. The frontend checks the user's balance and can mint the missing amount before placing the slip.

Now I place a multi-leg slip. The frontend sends the slip to our Anchor program. The slip begins as pending, and the bot later executes each leg while the markets are still open and before the cancel deadline. This design separates user intent from keeper execution and makes pending slip handling visible.

Next, this is the bet slip transaction page. It shows all slips for the connected wallet, grouped by status: pending, live, and settled. Each slip displays its epoch, stake, cost, potential payout, and all leg details. For every leg, users can see the market id, selected outcome, odds, and whether the leg is pending, bought, won, or lost.

This is useful for transparency. A user does not just see a single transaction signature. They can inspect the full lifecycle of their bet slip.

Now we switch to the LP dashboard. Quadratic Market uses epoch-based liquidity vaults. An epoch is a time-bounded pool that backs a group of markets. LPs deposit BASE into an epoch vault before the first market in that epoch starts.

The dashboard shows each epoch, total deposits, total shares, the connected wallet's LP shares, estimated claim value, and settlement progress. The important deposit window is explicit: LPs can deposit after the bot publishes the epoch and before the first market starts. Once markets start, deposits for that epoch should be treated as closed. Withdrawals unlock after the epoch's markets settle.

This gives liquidity providers a clear risk boundary. They know which epoch they are backing, when the markets start, and when withdrawals become available.

Behind the frontend, the bot API exposes operational views. The health endpoint confirms the bot is live. The markets-by-epoch endpoint returns all markets grouped by epoch, including the epoch vault liquidity state. The pending slips endpoint shows unexecuted slips and unbought legs. The execute-pending endpoint lets a keeper pass buy pending slip legs when they are still valid.

The bot also runs continuously. It creates markets from TxLINE fixtures, initializes outcome mints, updates odds, suspends markets at kickoff, settles ended markets from TxLINE final scores and proof data, closes settled epochs, and resolves user slips.

The core technical highlight is the custom Solana settlement engine. Our Anchor program models markets, slips, epoch vaults, and LP positions directly on-chain. TxLINE data powers market creation and settlement, and the architecture is ready for proof-backed validation through TxLINE's Solana validation primitives.

For judges, the deployed frontend is available at dzhigc9xax7br dot cloudfront dot net. The public bot API is available at d17eznfv4qokvh dot cloudfront dot net. The code is public on GitHub under uuzor slash quadratic_market.

In summary, Quadratic Market combines a familiar sportsbook user experience with TxLINE-powered data, Solana escrow, epoch liquidity vaults, and automated settlement. It is a working devnet build, not a concept, and it demonstrates how TxLINE can become the data layer for trust-minimized sports prediction markets.

## Screen Recording Checklist

1. Open `https://dzhigc9xax7br.cloudfront.net`.
2. Show real markets loading in the dashboard.
3. Select three odds from different markets.
4. Demonstrate same-market replacement by switching one pick.
5. Show betslip stake, total odds, and potential payout.
6. Connect wallet and mint mock BASE if needed.
7. Place a slip.
8. Open `/bets` and show slip status and leg details.
9. Open `/lp` and show epoch vault deposit and withdrawal tracking.
10. Open or mention the bot API endpoints:
    - `/health`
    - `/api/markets/by-epoch`
    - `/api/slips/pending`


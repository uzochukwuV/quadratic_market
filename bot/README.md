# Quadratic Market Sports Bot

Automates the full market lifecycle against a public sports API:

1. **Create** — fetches upcoming fixtures from The-Odds-API and creates on-chain markets
2. **Suspend** — at `start_time`, suspends the market (no more bets)
3. **Settle** — after `RESULT_DELAY_SECONDS` post kick-off, fetches the score and the oracle proposes the result
4. **Finalize** — after the challenge window, finalizes the result on-chain
5. **Void** — if the oracle never settled within `settlement_deadline_seconds`, voids the market

## Setup

```bash
cd bot
cp .env.example .env
# Edit .env — fill in RPC_URL, keypair paths, PROGRAM_ID, BASE_MINT, ODDS_API_KEY

pip install -r requirements.txt
```

Get a free API key at https://the-odds-api.com (500 requests/month free tier).

## Keypairs

The bot needs two keypairs:

| Keypair | Role | On-chain requirement |
|---|---|---|
| `OPERATOR_KEYPAIR_PATH` | Creates markets, suspends, finalizes | Must be added as operator via `add_operator` |
| `ORACLE_KEYPAIR_PATH` | Proposes results | Must match `global_config.oracle_pubkey` |

These can be the same keypair on devnet for testing.

## Running

```bash
# Continuous (recommended for production)
python bot.py

# Single pass (for cron)
python bot.py --once
```

## Outcome mapping

| Sport type | Outcome 0 | Outcome 1 | Outcome 2 |
|---|---|---|---|
| 2-way (tennis, basketball, etc.) | Home / Player 1 | Away / Player 2 | — |
| 3-way (soccer) | Home win | Draw | Away win |

Soccer leagues with draw markets: EPL, Champions League, Europa League, La Liga, Bundesliga, Serie A, Ligue 1.

## State file

`bot_state.json` is written next to `bot.py`. It maps The-Odds-API event IDs to on-chain market IDs and tracks lifecycle stage. Safe to delete to reset (markets already on-chain are unaffected).

## Supported sports

Set `SPORTS` in `.env` to any comma-separated list from:
https://the-odds-api.com/sports-odds-data/sports-apis.html

Examples:
```
SPORTS=soccer_epl,basketball_nba,tennis_atp_french_open
```

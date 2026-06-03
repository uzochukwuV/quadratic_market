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

## Running the Bot

```bash
# Continuous (recommended for production)
python bot.py

# Single pass (for cron)
python bot.py --once
```

## Running the API Server

A FastAPI server provides public read-only access to on-chain data:

```bash
# Install API dependencies
pip install fastapi uvicorn pydantic

# Run on default port 8000
python api.py
export ANTHROPIC_BASE_URL=https://api.tokenrouter.com/v1 
export TOKENROUTER_API_KEY=sk-Rz4zPRnKgPqOAqN8Nz42gI2DxyuYZMaUOk29jcSPqdIl2BjG
# Or with custom port
python api.py --port 8080
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API information |
| `/health` | GET | Health check |
| `/api/v1/config` | GET | Global protocol configuration |
| `/api/v1/markets` | GET | List all markets (with filters) |
| `/api/v1/markets/{id}` | GET | Market details |
| `/api/v1/markets/{id}/prices` | GET | Outcome prices |
| `/api/v1/markets/active` | GET | Active (Open) markets |
| `/api/v1/markets/upcoming` | GET | PreOpen markets |
| `/api/v1/markets/settled` | GET | Settled markets |
| `/api/v1/epochs` | GET | List epochs |
| `/api/v1/epochs/{id}` | GET | Epoch details |
| `/api/v1/categories` | GET | Market categories |

### Query Parameters

- `status`: Filter markets by status (Open, Suspended, Settled, etc.)
- `category`: Filter by market category (0=Match Result, 1=BTTS, 2=Totals)
- `limit`: Max results (1-500)
- `offset`: Skip first N results

## Keypairs

The bot needs two keypairs:

| Keypair | Role | On-chain requirement |
|---|---|---|
| `OPERATOR_KEYPAIR_PATH` | Creates markets, suspends, finalizes | Must be added as operator via `add_operator` |
| `ORACLE_KEYPAIR_PATH` | Proposes results | Must match `global_config.oracle_pubkey` |

These can be the same keypair on devnet for testing.

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

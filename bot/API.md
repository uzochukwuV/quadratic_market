# Quadratic Market Bot API

Base URL:

- Local: `http://localhost:8000`
- Deployed: `https://d17eznfv4qokvh.cloudfront.net`

The bot API is served by the FastAPI app in `bot/bot.py` when `BOT_API_ENABLED=true`.

## Authentication

If `BOT_API_KEY` is configured, every `/api/*` endpoint requires:

```http
X-API-Key: your-api-key
```

If `BOT_API_KEY` is empty, the API endpoints are public. `/health` never requires an API key.

Error responses use FastAPI's default shape:

```json
{
  "detail": "Error message"
}
```

## GET /health

Checks whether the API process is reachable.

Request body: none

Response:

```json
{
  "status": "ok"
}
```

## POST /api/mint-base

Mints mock BASE tokens to a recipient wallet. This is for devnet/testnet usage and only works while the configured bot operator wallet is the mint authority for the base mint.

Request:

```json
{
  "recipient": "37x9AGp1ipgNfGbuoEVxQtjT5RJnJss6pT3V49TDnm5p",
  "amount": 1000000
}
```

Fields:

| Field | Type | Required | Description |
|---|---:|---:|---|
| `recipient` | string | yes | Solana wallet public key that receives minted BASE. |
| `amount` | integer | yes | Amount in base mint units. With 6 decimals, `1000000` equals `1.0 BASE`. Must be greater than `0`. |

Success response:

```json
{
  "recipient": "37x9AGp1ipgNfGbuoEVxQtjT5RJnJss6pT3V49TDnm5p",
  "recipient_ata": "RecipientAssociatedTokenAccountPubkey",
  "amount": 1000000,
  "signature": "SolanaTransactionSignature"
}
```

Errors:

| Status | Detail |
|---:|---|
| `422` | Invalid recipient public key, or invalid request body. |
| `500` | Mint failed on-chain. |
| `503` | Bot runtime is not initialized. |

## GET /api/slips/pending

Returns all on-chain slips whose status is `pending` or `active`, including which legs still need to be bought by the bot.

Request body: none

Success response:

```json
{
  "count": 1,
  "slips": [
    {
      "slip_id": 9,
      "owner": "9kaufL5VB6a8T1uV9bpmm6qcgRN7s2BUAA8RELe4yiob",
      "status": "active",
      "num_legs": 3,
      "bought_mask": 7,
      "unbought_legs": [],
      "cancel_deadline": 1794473400
    }
  ]
}
```

Slip fields:

| Field | Type | Description |
|---|---:|---|
| `slip_id` | integer | On-chain slip id. |
| `owner` | string | Slip owner wallet public key. |
| `status` | string | Lowercase slip status, usually `pending` or `active`. |
| `num_legs` | integer | Number of legs in the bet slip. |
| `bought_mask` | integer | Bit mask where bit `leg_index` is `1` when that leg has been bought. |
| `unbought_legs` | array | Legs that still need execution. Empty when all legs are bought. |
| `cancel_deadline` | integer | Unix timestamp in seconds after which unexecuted pending legs should not be bought. |

`unbought_legs[]` fields:

| Field | Type | Description |
|---|---:|---|
| `leg_index` | integer | Zero-based leg index in the slip. |
| `market_id` | integer | Market id for the leg. |
| `outcome_id` | integer | Selected outcome id for the leg. |

## POST /api/slips/execute-pending

Runs one execution pass for pending slip legs. The bot fetches all pending/active slips and buys any unbought leg only when:

- the market status is `open`
- the market has not started
- the slip cancel deadline has not passed
- the selected outcome mint exists, or can be initialized

Request body: none

Success response:

```json
{
  "pending_slips": 3,
  "legs_bought": 4
}
```

Fields:

| Field | Type | Description |
|---|---:|---|
| `pending_slips` | integer | Number of pending/active slips inspected during the pass. |
| `legs_bought` | integer | Number of slip legs successfully bought on-chain during the pass. |

Notes:

- This endpoint is idempotent for already-bought legs because bought legs are skipped by `bought_mask`.
- Non-executable legs are skipped and logged by the bot with a reason such as `market_started`, `market_settled`, or `cancel_deadline_passed`.

## GET /api/markets/by-epoch

Returns all fetched on-chain markets grouped by epoch, including epoch account data and epoch vault liquidity data.

Request body: none

Success response:

```json
{
  "count": 57,
  "epoch_count": 2,
  "epochs": [
    {
      "epoch_id": 1,
      "exists": true,
      "start_time": 1794450000,
      "end_time": 1794536400,
      "num_markets": 24,
      "num_settled_markets": 6,
      "all_markets_settled": false,
      "withdrawals_enabled": false,
      "vault": {
        "exists": true,
        "total_deposits": 1000000000,
        "total_withdrawals": 0,
        "total_shares": 999999000,
        "num_lps": 1,
        "withdrawals_enabled": false
      },
      "markets": [
        {
          "market_id": 82,
          "fixture_id": 18242838,
          "group_id": 18242838,
          "epoch_id": 1,
          "title": "New Zealand vs India - 1X2",
          "description": "Txodds fixture 18242838",
          "status": "open",
          "market_type": "1x2",
          "category": 0,
          "num_outcomes": 3,
          "start_time": 1794474000,
          "odds": [20000, 35000, 30000],
          "winning_outcome": 0,
          "settlement_time": 0,
          "settled_in_epoch": false,
          "stage": "mints_init"
        }
      ]
    }
  ]
}
```

Top-level fields:

| Field | Type | Description |
|---|---:|---|
| `count` | integer | Total number of markets returned across all epochs. |
| `epoch_count` | integer | Number of epoch groups returned. |
| `epochs` | array | Epoch groups sorted by epoch id. |

Epoch fields:

| Field | Type | Description |
|---|---:|---|
| `epoch_id` | integer | Epoch id. |
| `exists` | boolean | Whether the epoch account was fetched successfully. |
| `start_time` | integer or null | Epoch start time as Unix seconds. |
| `end_time` | integer or null | Epoch end time as Unix seconds. |
| `num_markets` | integer | Number of markets tracked by the epoch account. |
| `num_settled_markets` | integer | Number of settled markets tracked by the epoch account. |
| `all_markets_settled` | boolean | Whether all epoch markets are settled. |
| `withdrawals_enabled` | boolean | Whether the epoch account says withdrawals are enabled. |
| `vault` | object | Epoch vault liquidity summary. |
| `markets` | array | Markets in this epoch, sorted by `market_id`. |

Vault fields:

| Field | Type | Description |
|---|---:|---|
| `exists` | boolean | Whether the epoch vault account was fetched successfully. |
| `total_deposits` | integer | Total BASE deposited into this epoch vault, in base units. |
| `total_withdrawals` | integer | Total BASE withdrawn from this epoch vault, in base units. |
| `total_shares` | integer | Total LP shares for this epoch vault. |
| `num_lps` | integer | Number of LPs that opted into this epoch vault. |
| `withdrawals_enabled` | boolean | Whether this epoch vault allows withdrawals. |

Market fields:

| Field | Type | Description |
|---|---:|---|
| `market_id` | integer | On-chain market id. |
| `fixture_id` | integer | TxLINE fixture id, or `0` when unavailable. |
| `group_id` | integer or null | Market group id when present. |
| `epoch_id` | integer | Epoch id assigned to this market. |
| `title` | string | Human-readable market title. |
| `description` | string | Market description. |
| `status` | string | Lowercase market status, for example `open`, `suspended`, `settled`, `voided`, or `closed`. |
| `market_type` | string | Bot-tracked type such as `1x2`, `over_under`, or `gg_ng`. |
| `category` | integer | On-chain category id. |
| `num_outcomes` | integer | Number of market outcomes. |
| `start_time` | integer | Match/market start time as Unix seconds. |
| `odds` | integer[] | Odds in basis points. `20000` means `2.00`. |
| `winning_outcome` | integer | Winning outcome id after settlement. Defaults to `0` before settlement. |
| `settlement_time` | integer | Settlement Unix timestamp, or `0` before settlement. |
| `settled_in_epoch` | boolean | Whether the market has been settled into its epoch accounting. |
| `stage` | string or null | Bot state-machine stage, for example `created`, `mints_init`, `suspended`, `settled`, or `closed`. |

## Common Usage

Mint BASE:

```bash
curl -X POST "$BOT_API/api/mint-base" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $BOT_API_KEY" \
  -d '{"recipient":"37x9AGp1ipgNfGbuoEVxQtjT5RJnJss6pT3V49TDnm5p","amount":1000000}'
```

Fetch pending slips:

```bash
curl "$BOT_API/api/slips/pending" \
  -H "X-API-Key: $BOT_API_KEY"
```

Execute pending slip legs:

```bash
curl -X POST "$BOT_API/api/slips/execute-pending" \
  -H "X-API-Key: $BOT_API_KEY"
```

Fetch markets grouped by epoch:

```bash
curl "$BOT_API/api/markets/by-epoch" \
  -H "X-API-Key: $BOT_API_KEY"
```

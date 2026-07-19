# TxLINE AI Pundit Agent

This is a standalone agent layer for the fan and autonomous-agent tracks. It does not start or modify the existing market bot.

## Inputs

- TxLINE fixtures snapshot
- TxLINE odds snapshot
- TxLINE scores endpoints
- TxLINE odds SSE stream
- Optional OpenRouter narration via `OPENROUTER_API_KEY`
- Optional OpenAI fallback narration via `OPENAI_API_KEY`
- Optional Telegram delivery via `TELEGRAM_BOT_TOKEN`

## Local Setup

Use the same TxLINE token format as the bot:

```bash
export TXODDS_API_TOKEN_FILE=_keys/txodds-api-token.txt
```

Optional:

```bash
export OPENAI_API_KEY=...
export OPENROUTER_API_KEY=...
export OPENROUTER_MODEL=tencent/hy3:free
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=...
```

## Commands

List matches:

```bash
python scripts/txline_pundit_agent.py matches --network devnet
```

Analyze one match:

```bash
python scripts/txline_pundit_agent.py analyze --network devnet --fixture-id 18257739
```

Send analysis to Telegram:

```bash
python scripts/txline_pundit_agent.py analyze --network devnet --fixture-id 18257739 --telegram-chat-id "$TELEGRAM_CHAT_ID"
```

Story mode from odds stream:

```bash
python scripts/txline_pundit_agent.py stream --network devnet --fixture-id 18257739 --seconds 60
```

Telegram polling bot:

```bash
python scripts/txline_telegram_bot.py
```

Telegram commands:

- `/matches`
- `/analyze <fixture_id>`
- `/live <fixture_id>`

## Behavior

The agent builds structured context first:

- fixture
- latest odds and implied probabilities
- current score state
- team profile from available TxLINE score history
- deterministic upper-hand signal

If `OPENROUTER_API_KEY` is present, the structured context is passed through OpenRouter for a short pundit-style explanation. The default model is `tencent/hy3:free`, with `poolside/laguna-xs-2.1:free` as code fallback. If no AI key is set, it uses a deterministic story-mode template so demos still work.

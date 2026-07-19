# Quadratic Market + TxLINE AI Pundit

Solana devnet prediction markets powered by TxLINE sports data, with a Telegram miniapp and AI match-feed agent for World Cup match analysis.

## Live Deployments

- Main frontend: https://dzhigc9xax7br.cloudfront.net
- Telegram miniapp: https://d23b6pp3283f7i.cloudfront.net
- Telegram launch link: Gambit fanz - https://t.me/visualisecryptolink_bot/fanz
- Bot API: https://d17eznfv4qokvh.cloudfront.net
- AI feed API: https://iktsqpo2ybyb4zajecanjii5ky0xpasx.lambda-url.us-east-1.on.aws/api/feeds
- AI feed health: https://iktsqpo2ybyb4zajecanjii5ky0xpasx.lambda-url.us-east-1.on.aws/api/health

## Components

- `frontend/` - main market dashboard and wallet betting flow.
- `bot/` - TxLINE market ingestion, epoch management, settlement, liquidity automation, and public REST API.
- `agent/` - TxLINE AI Pundit logic for match analysis, Telegram delivery, and OpenRouter narration.
- `agent_lambda/` - AWS Lambda handler for the public AI feed API.
- `agents/tg-miniapp/` - standalone Telegram miniapp with markets, bets, and social-style AI match feeds.
- `aws/` - CloudFormation templates for static hosting, bot Fargate service, and AI feed Lambda.

## TxLINE AI Pundit

The AI Pundit ingests TxLINE fixtures, odds snapshots, score endpoints, and odds SSE streams. It builds a structured match context, computes a deterministic upper-hand signal, then optionally sends the context through OpenRouter for short fan-facing analysis.

Local commands:

```bash
export TXODDS_API_TOKEN_FILE=_keys/txodds-api-token.txt
python scripts/txline_pundit_agent.py matches --network devnet
python scripts/txline_pundit_agent.py analyze --network devnet --fixture-id 18257739
python scripts/txline_pundit_agent.py stream --network devnet --seconds 45 --max-stories 1
```

Standalone feed server:

```bash
python scripts/txline_agent_feed_server.py
curl http://localhost:8790/api/feeds
```

## Telegram Miniapp

The miniapp is standalone under `agents/tg-miniapp`.

```bash
cd agents/tg-miniapp
npm install
PORT=3001 BASE_PATH=/ npm run dev
```

Production build with deployed AI feed:

```bash
PORT=3001 BASE_PATH=/ \
VITE_AGENT_FEED_URL=https://iktsqpo2ybyb4zajecanjii5ky0xpasx.lambda-url.us-east-1.on.aws/api/feeds \
npm run build
```

## Secrets

Do not commit secret values. Local secret files are ignored by git.

Expected local variables:

- `TXODDS_API_TOKEN_FILE` or `TXODDS_API_TOKEN`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

AWS Secrets Manager entries used by the deployed feed API:

- `txline-agent-openrouter-api-key`
- `txline-agent-txodds-api-token`

## AWS Deployment

AI feed API:

```bash
python - <<'PY'
from zipfile import ZipFile, ZIP_DEFLATED
with ZipFile('/tmp/txline-agent-feed.zip', 'w', ZIP_DEFLATED) as z:
    z.write('agent_lambda/handler.py', 'handler.py')
PY
aws s3 cp /tmp/txline-agent-feed.zip s3://quadratic-market-frontend-sitebucket-k9vfjlo5baer/deployments/txline-agent-feed.zip
aws cloudformation deploy \
  --stack-name txline-agent-feed \
  --template-file aws/agent-feed-lambda.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
  ProjectName=txline-agent-feed \
  CodeBucket=quadratic-market-frontend-sitebucket-k9vfjlo5baer \
  CodeKey=deployments/txline-agent-feed.zip \
  TxoddsTokenSecretArn=<txodds-secret-arn> \
  OpenRouterSecretArn=<openrouter-secret-arn>
```

Telegram miniapp static hosting:

```bash
aws cloudformation deploy \
  --stack-name txline-tg-miniapp \
  --template-file aws/frontend-static.yaml \
  --parameter-overrides ProjectName=txline-tg-miniapp
aws s3 sync agents/tg-miniapp/dist/public s3://txline-tg-miniapp-sitebucket-hjf3k8unoinl --delete --cache-control max-age=31536000,public --exclude index.html
aws s3 cp agents/tg-miniapp/dist/public/index.html s3://txline-tg-miniapp-sitebucket-hjf3k8unoinl/index.html --cache-control no-cache,no-store,must-revalidate --content-type text/html
aws cloudfront create-invalidation --distribution-id E32L45PNX1HJO8 --paths '/*'
```

## Validation

- `python -m py_compile agent/*.py scripts/txline_pundit_agent.py scripts/txline_telegram_bot.py scripts/txline_agent_feed_server.py`
- `PORT=3001 BASE_PATH=/ VITE_AGENT_FEED_URL=<feed-url> npm run build` from `agents/tg-miniapp`
- `curl` against the deployed AI feed health and feeds endpoints
- `curl -I` against the deployed Telegram miniapp CloudFront URL

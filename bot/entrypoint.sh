#!/bin/sh
set -eu

mkdir -p /tmp/quadratic-market-secrets

if [ -n "${OPERATOR_KEYPAIR_JSON:-}" ]; then
  printf '%s' "$OPERATOR_KEYPAIR_JSON" > /tmp/quadratic-market-secrets/operator-keypair.json
  export OPERATOR_KEYPAIR_PATH=/tmp/quadratic-market-secrets/operator-keypair.json
fi

if [ -n "${ORACLE_KEYPAIR_JSON:-}" ]; then
  printf '%s' "$ORACLE_KEYPAIR_JSON" > /tmp/quadratic-market-secrets/oracle-keypair.json
  export ORACLE_KEYPAIR_PATH=/tmp/quadratic-market-secrets/oracle-keypair.json
elif [ -n "${OPERATOR_KEYPAIR_JSON:-}" ]; then
  cp /tmp/quadratic-market-secrets/operator-keypair.json /tmp/quadratic-market-secrets/oracle-keypair.json
  export ORACLE_KEYPAIR_PATH=/tmp/quadratic-market-secrets/oracle-keypair.json
fi

if [ -n "${BASE_MINT_VALUE:-}" ]; then
  printf '%s' "$BASE_MINT_VALUE" > /tmp/quadratic-market-secrets/base-mint.txt
  export BASE_MINT_FILE=/tmp/quadratic-market-secrets/base-mint.txt
fi

if [ -n "${TXODDS_API_TOKEN_VALUE:-}" ]; then
  printf '%s' "$TXODDS_API_TOKEN_VALUE" > /tmp/quadratic-market-secrets/txodds-api-token.txt
  export TXODDS_API_TOKEN_FILE=/tmp/quadratic-market-secrets/txodds-api-token.txt
fi

exec python bot.py

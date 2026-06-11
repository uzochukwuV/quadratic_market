Bot API (Python)

This small FastAPI service provides a devnet mint endpoint for the frontend.

Environment variables:
- OPERATOR_KEYPAIR_PATH - path to operator keypair JSON (admin) that will sign mints
- RPC_URL - optional RPC URL (defaults to https://api.devnet.solana.com)

Run:
  pip install -r requirements.txt
  export OPERATOR_KEYPAIR_PATH=./operator-keypair.json
  uvicorn bot.api:app --reload --port 8081

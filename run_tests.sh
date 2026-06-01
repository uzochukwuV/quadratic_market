#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# run_tests.sh — Run anchor tests without anchor CLI
# Replicates what `anchor test` does internally:
#   1. Start solana-test-validator with the program deployed
#   2. Run ts-mocha against localnet
#   3. Clean up
# ─────────────────────────────────────────────────────────────

PROGRAM_ID="9H1DCo5QaUtiMne4UH44aefHyv8Xpc8EgZwrshRZqsLC"
PROGRAM_SO="target/deploy/quadratic_market.so"
WALLET=".config/solana/id.json"
RPC_URL="http://127.0.0.1:8899"
LEDGER_DIR="/tmp/test-ledger"
VALIDATOR_LOG="/tmp/validator.log"

export CARGO_HOME="/home/runner/workspace/.local/share/.cargo"
export RUSTUP_HOME="/home/runner/.rustup"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$CARGO_HOME/bin:$PATH"

# Anchor env vars (picked up by @coral-xyz/anchor in tests)
export ANCHOR_PROVIDER_URL="$RPC_URL"
export ANCHOR_WALLET="$WALLET"

echo "=== Quadratic Market Test Runner ==="
echo "Program ID : $PROGRAM_ID"
echo "Wallet     : $WALLET"
echo "RPC URL    : $RPC_URL"
echo ""

# ── 1. Ensure program is built ──────────────────────────────
if [ ! -f "$PROGRAM_SO" ]; then
  echo ">>> Program .so not found — building..."
  cargo build-sbf 2>&1
fi

# ── 2. Kill any lingering test validator ───────────────────
echo ">>> Cleaning up old validator processes..."
pkill -f "solana-test-validator" 2>/dev/null || true
sleep 2
rm -rf "$LEDGER_DIR"

# ── 3. Start solana-test-validator ─────────────────────────
echo ">>> Starting solana-test-validator..."
setsid solana-test-validator \
  --bpf-program "$PROGRAM_ID" "$PROGRAM_SO" \
  --ledger "$LEDGER_DIR" \
  --reset \
  > "$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID=$!
echo "    Validator PID: $VALIDATOR_PID"
echo "    Log: $VALIDATOR_LOG"

# ── 4. Wait for validator to be ready ──────────────────────
echo ">>> Waiting for validator to become healthy (up to 60s)..."
ATTEMPTS=0
MAX_ATTEMPTS=60
until curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('result')=='ok' else 1)" \
  2>/dev/null; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ $ATTEMPTS -ge $MAX_ATTEMPTS ]; then
    echo ""
    echo "ERROR: Validator did not start in ${MAX_ATTEMPTS}s"
    echo "Last 20 lines of validator log:"
    tail -20 "$VALIDATOR_LOG" 2>/dev/null
    kill $VALIDATOR_PID 2>/dev/null || true
    exit 1
  fi
  if [ $((ATTEMPTS % 10)) -eq 0 ]; then
    echo "    Still waiting... ${ATTEMPTS}s elapsed"
    # Show validator log if something went wrong
    if [ -f "$VALIDATOR_LOG" ]; then
      tail -5 "$VALIDATOR_LOG" 2>/dev/null | sed 's/^/    >> /'
    fi
  fi
  sleep 1
done
echo "    Validator healthy after ${ATTEMPTS}s"
echo ""

# ── 5. Fund the wallet ─────────────────────────────────────
echo ">>> Airdropping 100 SOL to test wallet..."
solana airdrop 100 \
  --keypair "$WALLET" \
  --url "$RPC_URL" \
  2>/dev/null && echo "    Airdrop done" || echo "    Airdrop skipped (wallet may already have funds)"

# ── 6. Run TypeScript tests ────────────────────────────────
echo ""
echo "─────────────────────────────────────────────────────"
echo ">>> Running TypeScript tests..."
echo "─────────────────────────────────────────────────────"
echo ""

TEST_EXIT=0
npx ts-mocha \
  -p ./tsconfig.json \
  -t 1000000 \
  "tests/**/*.ts" \
  || TEST_EXIT=$?

# ── 7. Clean up ────────────────────────────────────────────
echo ""
echo ">>> Stopping validator (PID $VALIDATOR_PID)..."
kill $VALIDATOR_PID 2>/dev/null || pkill -f "solana-test-validator" 2>/dev/null || true
sleep 1
rm -rf "$LEDGER_DIR"

echo ""
if [ $TEST_EXIT -eq 0 ]; then
  echo "╔══════════════════════════════╗"
  echo "║    ALL TESTS PASSED ✓        ║"
  echo "╚══════════════════════════════╝"
else
  echo "╔══════════════════════════════╗"
  echo "║    SOME TESTS FAILED ✗       ║"
  echo "║    Exit code: $TEST_EXIT         ║"
  echo "╚══════════════════════════════╝"
fi

exit $TEST_EXIT

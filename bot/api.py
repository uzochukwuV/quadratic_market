#!/usr/bin/env python3
"""Simple FastAPI backend for devnet minting helper.

Usage:
  export OPERATOR_KEYPAIR_PATH=./operator-keypair.json
  uvicorn bot.api:app --reload --port 8081

Endpoints:
  GET /health
  POST /mint-test-usdc { recipient: str, amount: int (usdc) }

This script mints baseMint (from devnet-deployment.json) to recipient ATA when operator keypair is configured.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from base64 import b64decode
from solders.pubkey import Pubkey
from solders.instruction import AccountMeta

from chain import ChainClient, load_keypair, market_pda
import os
import json
from dotenv import load_dotenv
import asyncio

load_dotenv(".env")

app = FastAPI()

# CORS for the Vite client (localhost:5173 in dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# LMSR Math helpers (matching the Rust implementation in programs/quadratic_market/src/math/lmsr.rs)
SCALE = 1 << 32  # Q32.32 fixed point

def exp_q32(x: int) -> int:
    """Compute e^x in Q32.32 format."""
    if x >= 0:
        return SCALE
    if x < -20 * SCALE:
        return 0
    
    # Taylor series: e^x = 1 + x + x^2/2! + ...
    result = SCALE
    term = SCALE
    n = 1
    while n <= 10:
        term = (term * x) >> 32
        term = term // n
        result += term
        n += 1
    return max(0, result)

def ln_q32(x: int) -> int:
    """Compute ln(x) in Q32.32 format."""
    if x <= 0:
        return 0
    
    # Argument reduction: find k such that x/2^k is in [0.5, 1.0)
    k = 0
    m = x
    while m >= SCALE:
        m >>= 1
        k += 1
    while m < SCALE // 2:
        m <<= 1
        k -= 1
    
    # Now compute ln(m) where m is in [0.5, 1.0)
    y = m - SCALE  # y in [-SCALE/2, 0)
    ln_m = 0
    y_power = y
    for n in range(1, 21):
        if n % 2 == 1:
            ln_m += y_power // n
        else:
            ln_m -= y_power // n
        y_power = (y_power * y) >> 32
        if y_power == 0:
            break
    
    # ln(2) in Q32.32
    LN2_FP = 2_973_032_047
    return ln_m + k * LN2_FP

def calculate_lmsr_cost(q_values, outcome_id, delta_q, b_raw):
    """Calculate LMSR cost to buy shares."""
    num_outcomes = len([q for q in q_values if q > 0])
    if num_outcomes == 0:
        num_outcomes = 2
    
    # Find max q for normalization
    max_q = max(q_values)
    new_q_outcome = q_values[outcome_id] + delta_q
    if new_q_outcome > max_q:
        max_q = new_q_outcome
    
    # Compute old and new sums of exponentials
    old_sum = 0
    new_sum = 0
    for i in range(len(q_values)):
        old_exp = compute_normalized_exp(q_values[i], max_q, b_raw)
        old_sum += old_exp
        
        new_q = q_values[i] + delta_q if i == outcome_id else q_values[i]
        new_exp = compute_normalized_exp(new_q, max_q, b_raw)
        new_sum += new_exp
    
    if old_sum == 0 or new_sum == 0:
        return delta_q * 1000000  # rough estimate
    
    ln_new = ln_q32(new_sum)
    ln_old = ln_q32(old_sum)
    
    if ln_new > ln_old:
        ln_diff = ln_new - ln_old
        cost_q32 = b_raw * ln_diff
        cost = (cost_q32 + SCALE - 1) >> 32  # round up
        return cost
    else:
        return delta_q * 1000000  # rough estimate

def compute_normalized_exp(q, max_q, b_raw):
    """Compute exp((q - max_q) * SCALE / B) in Q32.32"""
    if q >= max_q:
        return SCALE
    
    diff = max_q - q
    exponent = (diff * SCALE) // b_raw
    return exp_q32(-exponent)

def calculate_odds_from_q(q_values, num_outcomes):
    """Calculate decimal odds from q_values (odds * 10000)."""
    total = sum(q_values[:num_outcomes])
    if total == 0:
        return [0] * num_outcomes
    
    odds = []
    for i in range(num_outcomes):
        if q_values[i] == 0:
            odds.append(0)
        else:
            o = (total * 10000) // q_values[i]
            odds.append(o)
    return odds


def calculate_lmsr_payout(q_values, outcome_id, delta_q, b_raw):
    """Calculate LMSR sell payout: b * (ln(old_sum) - ln(new_sum))."""
    num_outcomes = sum(1 for q in q_values if q > 0)
    if num_outcomes == 0:
        return 0

    # Find max q for normalization
    max_q = max(q_values[:num_outcomes])
    new_q_outcome = q_values[outcome_id] - delta_q
    if new_q_outcome > max_q:
        max_q = new_q_outcome

    # Compute old_sum and new_sum
    old_sum = 0
    new_sum = 0
    for i in range(num_outcomes):
        old_exp = compute_normalized_exp(q_values[i], max_q, b_raw)
        old_sum += old_exp
        new_q = new_q_outcome if i == outcome_id else q_values[i]
        new_exp = compute_normalized_exp(new_q, max_q, b_raw)
        new_sum += new_exp

    if old_sum == 0 or new_sum == 0:
        return delta_q * 1000000  # fallback

    ln_old = ln_q32(old_sum)
    ln_new = ln_q32(new_sum)

    if ln_old > ln_new:
        ln_diff = ln_old - ln_new
        payout_q32 = b_raw * ln_diff
        return (payout_q32 + SCALE - 1) >> 32
    return 0

DEPLOY_PATHS = ["./devnet-deployment.json", "../devnet-deployment.json"]
deployment = {}
for p in DEPLOY_PATHS:
    if os.path.exists(p):
        with open(p, 'r') as f:
            deployment = json.load(f)
        break

RPC_URL = os.environ.get('RPC_URL') or 'https://api.devnet.solana.com'
OPERATOR_KEYPAIR_PATH = os.environ.get('OPERATOR_KEYPAIR_PATH')
BASE_MINT = deployment.get('baseMint', '8x97aHWPoTY4m9T4tEGDjf4EHYv29nJiX9uEGZHqMyPP')
LP_MINT = deployment.get('lpMint', 'BJtvd9JE3BTSg9Vgp46umX1Qq6GdF1YMiNxpYsnzTZfz')


class MintRequest(BaseModel):
    recipient: str
    amount: int = 1000  # USDC default


@app.get('/health')
async def health():
    return {"ok": True, "rpc": RPC_URL}


async def load_operator():
    if not OPERATOR_KEYPAIR_PATH:
        return None
    if not os.path.exists(OPERATOR_KEYPAIR_PATH):
        return None
    with open(OPERATOR_KEYPAIR_PATH, 'r') as f:
        data = json.load(f)
        print(f"Loaded operator keypair from {OPERATOR_KEYPAIR_PATH}")
    # Try to load using solana-py Keypair if available
    try:
        from solana.keypair import Keypair as SolKeypair
    except Exception:
        SolKeypair = None

    if isinstance(data, list):
        secret = bytes(data)
        if SolKeypair is not None:
            return SolKeypair.from_secret_key(secret)
        # solana Keypair not available in environment; return None so mint endpoint
        # falls back to returning ATA info instead of attempting to mint.
        return None

    # else assume file is keypair with 'secret_key' or base58 - not supported here
    return None


@app.post('/mint-test-usdc')
async def mint_test_usdc(req: MintRequest):
    if not deployment:
        raise HTTPException(status_code=500, detail='deployment info missing')
    base_mint = deployment.get('baseMint')
    if not base_mint:
        raise HTTPException(status_code=500, detail='baseMint not in deployment')

    recipient = PublicKey(req.recipient)
    amount = int(req.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail='invalid amount')
    if amount > 10000:
        amount = 10000

    operator = await load_operator()
    if operator is None:
        # Return ATA info for client to instruct manual minting
        return {"ok": True, "message": 'OPERATOR_KEYPAIR_PATH not configured', "ata": str(get_associated_token_address(recipient, PublicKey(base_mint)))}

    # Lazy import solana and spl packages, they may not be installed in every environment
    try:
        from solana.rpc.async_api import AsyncClient
        from solana.publickey import PublicKey
        from spl.token.async_client import AsyncToken
        from spl.token.constants import TOKEN_PROGRAM_ID
        from spl.token.instructions import get_associated_token_address
    except Exception:
        # If token libs are not available, return the ATA so caller can mint manually
        return {"ok": True, "message": 'token libraries not installed', "ata": str(get_associated_token_address(recipient, PublicKey(base_mint)))}

    async with AsyncClient(RPC_URL) as client:
        token = AsyncToken(client, PublicKey(base_mint), TOKEN_PROGRAM_ID, operator)
        ata = get_associated_token_address(recipient, PublicKey(base_mint))
        # create ATA if doesn't exist
        try:
            await token.create_associated_token_account(recipient)
        except Exception:
            pass
        # mint amount * 10^6 (USDC 6 decimals)
        lamports = amount * 1_000_000
        sig = await token.mint_to(ata, operator, lamports)
        return {"ok": True, "signature": sig, "ata": str(ata), "amount": amount}


# --- View endpoints for on-chain read-only functions (uses anchorpy simulate)

_chain_client: ChainClient | None = None


async def get_chain() -> ChainClient:
    """Lazily create a minimal client for view queries (no anchorpy IDL required)."""
    global _chain_client
    if _chain_client is not None:
        return _chain_client

    # Load deployment info
    if not deployment:
        raise RuntimeError("deployment info missing")
    program_id = deployment.get("programId")
    base_mint = deployment.get("baseMint")
    if not program_id or not base_mint:
        raise RuntimeError("deployment missing programId or baseMint")

    # Create dummy keypair for provider (not actually used for reads)
    from solders.keypair import Keypair as SoldersKeypair
    from solders.pubkey import Pubkey as SoldersPubkey
    
    dummy_kp = SoldersKeypair()
    
    # Try to create ChainClient, but if IDL fails, we'll use a minimal fallback
    try:
        from chain import ChainClient, load_keypair, market_pda
        idl_path = Path(__file__).parent / "idl.json"
        if not idl_path.exists():
            idl_path = Path(__file__).parent.parent / "target" / "idl" / "quadratic_market.json"
        
        op_kp = None
        if OPERATOR_KEYPAIR_PATH and os.path.exists(OPERATOR_KEYPAIR_PATH):
            op_kp = load_keypair(Path(OPERATOR_KEYPAIR_PATH))
        else:
            op_kp = dummy_kp
            
        oracle_kp = dummy_kp
        
        _chain_client = await ChainClient.create(RPC_URL, idl_path, program_id, op_kp, oracle_kp, base_mint)
        return _chain_client
    except Exception:
        # Fallback: create a minimal object with just the needed attributes
        class MinimalClient:
            def __init__(self):
                self.program_id = SoldersPubkey.from_string(program_id)
                self.base_mint = SoldersPubkey.from_string(base_mint)
                self.global_config, _ = SoldersPubkey.find_program_address([b"global_config"], self.program_id)
        
        _chain_client = MinimalClient()
        return _chain_client


def _find_program_return_log(logs: list[str], program_id_str: str) -> bytes:
    """Search simulation logs for the Anchor program return base64 and decode it.

    Anchor prints a line like: "Program return: <programId> <base64>"
    """
    prefix = f"Program return: {program_id_str} "
    for line in logs:
        if line.startswith(prefix):
            b64 = line[len(prefix):].strip()
            return b64decode(b64)
    raise RuntimeError("Program return not found in logs")


def _container_to_py(obj):
    """Recursively convert construct Container/List to plain python types."""
    # Construct Container behaves like dict/list in many cases
    try:
        from construct import Container
    except Exception:
        Container = None

    if obj is None:
        return None
    if isinstance(obj, (int, str, bool)):
        return obj
    # bytes -> int list or hex? return bytes for simplicity
    if isinstance(obj, bytes):
        return obj
    # Lists
    if isinstance(obj, list) or (hasattr(obj, '__iter__') and not isinstance(obj, dict) and not isinstance(obj, (str, bytes)) and not isinstance(obj, int)):
        try:
            return [_container_to_py(v) for v in obj]
        except Exception:
            pass
    # Mapping-like
    if hasattr(obj, 'items'):
        return {k: _container_to_py(v) for k, v in obj.items()}
    # Fallback
    return obj


class QuoteRequest(BaseModel):
    market_id: int
    outcome_id: int
    num_shares: int


@app.post('/view_quote_buy')
async def view_quote_buy(req: QuoteRequest):
    """Calculate quote for buying outcome tokens using LMSR math."""
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        
        chain = await get_chain()
        m_pda, _ = market_pda(chain.program_id, req.market_id)
        
        async with AsyncClient(RPC_URL) as client:
            resp = await client.get_account_info(m_pda)
            if resp.value is None:
                raise HTTPException(status_code=404, detail="Market not found")
            data = resp.value.data
        
        import struct
        num_outcomes = data[57]
        if req.outcome_id >= num_outcomes:
            raise HTTPException(status_code=400, detail="Invalid outcome_id")
        
        # Get q_values (8 u64 starting at offset 58)
        q_values = []
        for i in range(8):
            q = struct.unpack('<Q', data[58 + i*8:58 + (i+1)*8])[0]
            q_values.append(q)
        
        lmsr_b = struct.unpack('<Q', data[395:403])[0] if len(data) > 403 else 100_000_000_000
        if lmsr_b == 0:
            lmsr_b = 100_000_000_000  # default
        
        # Calculate LMSR cost
        cost = calculate_lmsr_cost(q_values, req.outcome_id, req.num_shares, lmsr_b)
        fee = cost // 100
        total_payment = cost + fee
        
        # Calculate new q_values after purchase
        new_q_values = q_values[:]
        new_q_values[req.outcome_id] += req.num_shares
        
        # Calculate new odds
        new_odds = calculate_odds_from_q(new_q_values, num_outcomes)
        old_odds = calculate_odds_from_q(q_values, num_outcomes)
        
        # Price impact in bps
        if old_odds[req.outcome_id] > 0:
            price_impact = abs(old_odds[req.outcome_id] - new_odds[req.outcome_id]) * 10000 // old_odds[req.outcome_id]
        else:
            price_impact = 0
        
        return {
            "cost": cost,
            "fee": fee,
            "total_payment": total_payment,
            "new_q_values": new_q_values,
            "new_odds": new_odds,
            "price_impact_bps": price_impact,
            "shares_received": req.num_shares
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


@app.post('/view_quote_sell')
async def view_quote_sell(req: QuoteRequest):
    """Calculate quote for selling outcome tokens (LMSR-based). Read-only."""
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        import struct

        chain = await get_chain()
        m_pda, _ = market_pda(chain.program_id, req.market_id)

        async with AsyncClient(RPC_URL) as client:
            resp = await client.get_account_info(m_pda)
            if resp.value is None:
                raise HTTPException(status_code=404, detail="Market not found")
            data = bytes(resp.value.data)

        OFFSET = 8
        num_outcomes = data[OFFSET+49] if len(data) > OFFSET+49 else 0
        if req.outcome_id >= num_outcomes:
            raise HTTPException(status_code=400, detail="Invalid outcome_id")

        q_values = []
        for i in range(8):
            q = struct.unpack('<Q', data[OFFSET+50 + i*8:OFFSET+50 + (i+1)*8])[0]
            q_values.append(q)
        lmsr_b = struct.unpack('<Q', data[OFFSET+387:OFFSET+395])[0] if len(data) > OFFSET+395 else 100_000_000_000
        if lmsr_b == 0:
            lmsr_b = 100_000_000_000

        if q_values[req.outcome_id] < req.num_shares:
            raise HTTPException(status_code=400, detail="Insufficient shares")

        # LMSR sell payout = b * (ln(old_sum) - ln(new_sum))
        proceeds = calculate_lmsr_payout(q_values, req.outcome_id, req.num_shares, lmsr_b)
        fee = proceeds // 100
        net_received = proceeds - fee

        new_q_values = q_values[:]
        new_q_values[req.outcome_id] -= req.num_shares

        new_odds = calculate_odds_from_q(new_q_values, num_outcomes)
        old_odds = calculate_odds_from_q(q_values, num_outcomes)

        if old_odds[req.outcome_id] > 0:
            price_impact = abs(old_odds[req.outcome_id] - new_odds[req.outcome_id]) * 10000 // old_odds[req.outcome_id]
        else:
            price_impact = 0

        return {
            "proceeds": proceeds,
            "fee": fee,
            "net_received": net_received,
            "new_q_values": new_q_values,
            "new_odds": new_odds,
            "price_impact_bps": price_impact,
            "shares_sold": req.num_shares,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


class SlipQuoteRequest(BaseModel):
    market_ids: list[int]
    outcomes: list[int]
    shares_per_leg: list[int]


@app.post('/view_quote_slip')
async def view_quote_slip(req: SlipQuoteRequest):
    """Quote a multi-leg parlay slip. Read-only.

    For each leg, fetch the market's q_values and compute the buy cost.
    The slip total = sum of leg costs (simplified, no correlation adjustment).
    """
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        import struct

        chain = await get_chain()
        if not (len(req.market_ids) == len(req.outcomes) == len(req.shares_per_leg)):
            raise HTTPException(status_code=400, detail='mismatched leg arrays')
        if len(req.market_ids) == 0:
            raise HTTPException(status_code=400, detail='empty legs')

        OFFSET = 8
        leg_costs = []
        leg_q_values_before = []
        leg_q_values_after = []
        leg_odds_after = []

        async with AsyncClient(RPC_URL) as client:
            for mid, oid, shares in zip(req.market_ids, req.outcomes, req.shares_per_leg):
                m_pda, _ = market_pda(chain.program_id, mid)
                resp = await client.get_account_info(m_pda)
                if resp.value is None:
                    raise HTTPException(status_code=404, detail=f"Market {mid} not found")
                data = bytes(resp.value.data)
                if len(data) < 200:
                    raise HTTPException(status_code=500, detail=f"Invalid market {mid} data")

                num_outcomes = data[OFFSET+49]
                if oid >= num_outcomes:
                    raise HTTPException(status_code=400, detail=f"Invalid outcome_id {oid} for market {mid}")

                q_values = []
                for i in range(8):
                    q = struct.unpack('<Q', data[OFFSET+50 + i*8:OFFSET+50 + (i+1)*8])[0]
                    q_values.append(q)
                lmsr_b = struct.unpack('<Q', data[OFFSET+387:OFFSET+395])[0] if len(data) > OFFSET+395 else 100_000_000_000
                if lmsr_b == 0:
                    lmsr_b = 100_000_000_000

                cost = calculate_lmsr_cost(q_values, oid, shares, lmsr_b)
                leg_costs.append(cost)

                # Compute new state
                new_q = q_values[:]
                new_q[oid] += shares
                leg_q_values_before.append(q_values[:num_outcomes])
                leg_q_values_after.append(new_q[:num_outcomes])
                leg_odds_after.append(calculate_odds_from_q(new_q, num_outcomes))

        total_cost = sum(leg_costs)
        fee = total_cost // 100
        total_payment = total_cost + fee

        # Combined odds: product of (old/new) ratios
        combined_odds_x10000 = 1
        for before, after, oid, shares in zip(leg_q_values_before, leg_q_values_after, req.outcomes, req.shares_per_leg):
            old_total = sum(before)
            new_total = sum(after)
            if before[oid] == 0:
                combined_odds_x10000 = 0
                break
            ratio_x10000 = (old_total * 10000) // (new_total)
            combined_odds_x10000 = (combined_odds_x10000 * ratio_x10000) // 10000
        if combined_odds_x10000 == 0:
            combined_odds_x10000 = 1
        potential_payout = (total_cost * combined_odds_x10000) // 10000

        return {
            "leg_costs": leg_costs,
            "total_cost": total_cost,
            "fee": fee,
            "total_payment": total_payment,
            "combined_odds_x10000": combined_odds_x10000,
            "potential_payout": potential_payout,
            "num_legs": len(req.market_ids),
            "leg_q_values_before": leg_q_values_before,
            "leg_q_values_after": leg_q_values_after,
            "leg_odds_after": leg_odds_after,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


class MarketStatsRequest(BaseModel):
    market_id: int


@app.get('/view_global_config')
async def view_global_config():
    """Fetch global config to see market count."""
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        
        chain = await get_chain()
        
        async with AsyncClient(RPC_URL) as client:
            resp = await client.get_account_info(chain.global_config)
            if resp.value is None:
                raise HTTPException(status_code=404, detail="GlobalConfig not found")
            
            data = resp.value.data
        
        import struct
        next_market_id = struct.unpack('<Q', data[194:202])[0]
        current_epoch = struct.unpack('<Q', data[266:274])[0]
        
        return {
            "next_market_id": next_market_id,
            "current_epoch": current_epoch,
            "global_config": str(chain.global_config)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


@app.get('/markets')
async def list_markets():
    """List all markets with their data (id, title, status, q_values, prices, etc.)."""
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        import struct
        
        chain = await get_chain()
        async with AsyncClient(RPC_URL) as client:
            resp = await client.get_account_info(chain.global_config)
            if resp.value is None:
                raise HTTPException(status_code=404, detail="GlobalConfig not found")
            gc_data = resp.value.data
        
        # next_market_id at offset 194
        next_market_id = int.from_bytes(gc_data[194:202], "little")
        
        # Pre-defined status names matching the IDL
        status_names = ["PreOpen", "Open", "Suspended", "AwaitingResult", "Proposed", "Settled", "Voided"]
        market_mode_names = ["FixedOdds", "Trading"]
        category_names = {0: "MatchResult", 1: "BTTS", 2: "Totals"}
        
        markets = []
        # Build list of market PDAs
        market_pdas = []
        for market_id in range(1, next_market_id + 1):
            mkt_pda, _ = Pubkey.find_program_address(
                [b"market", market_id.to_bytes(8, "little")], chain.program_id
            )
            market_pdas.append((market_id, mkt_pda))
        
        # Batch fetch markets in chunks of 50 (avoids RPC limits)
        CHUNK = 50
        all_accounts = []
        async with AsyncClient(RPC_URL) as client:
            for i in range(0, len(market_pdas), CHUNK):
                chunk = market_pdas[i:i+CHUNK]
                keys = [pda for _, pda in chunk]
                resp = await client.get_multiple_accounts(keys)
                for (mid, _), acc in zip(chunk, resp.value):
                    if acc is not None:
                        all_accounts.append((mid, bytes(acc.data)))
        
        for m_market_id, data in all_accounts:
            if len(data) < 200:
                continue
            try:
                mkt_pda, _ = Pubkey.find_program_address(
                    [b"market", m_market_id.to_bytes(8, "little")], chain.program_id
                )
                # 8 bytes discriminator first, then fields
                OFFSET = 8
                creator = str(Pubkey(data[OFFSET+8:OFFSET+40]))
                start_time = struct.unpack('<q', data[OFFSET+40:OFFSET+48])[0]
                status_byte = data[OFFSET+48]
                num_outcomes = data[OFFSET+49]
                q_values = []
                for i in range(8):
                    q = struct.unpack('<Q', data[OFFSET+50 + i*8:OFFSET+50 + (i+1)*8])[0]
                    q_values.append(q)
                exposure = struct.unpack('<Q', data[OFFSET+114:OFFSET+122])[0] if len(data) > OFFSET+122 else 0
                settlement_time = struct.unpack('<q', data[OFFSET+122:OFFSET+130])[0] if len(data) > OFFSET+130 else 0
                winning_outcome = data[OFFSET+130] if len(data) > OFFSET+130 else 0
                outcome_mints = []
                for i in range(8):
                    if OFFSET+131 + (i+1)*32 <= len(data):
                        outcome_mints.append(str(Pubkey(data[OFFSET+131 + i*32:OFFSET+131 + (i+1)*32])))
                lmsr_b = struct.unpack('<Q', data[OFFSET+387:OFFSET+395])[0] if len(data) > OFFSET+395 else 0
                if len(data) > OFFSET+399:
                    title_len = struct.unpack('<I', data[OFFSET+395:OFFSET+399])[0]
                    title_bytes = data[OFFSET+399:OFFSET+399+title_len] if OFFSET+399+title_len <= len(data) else b''
                    title = title_bytes.decode('utf-8', errors='ignore').rstrip('\x00')
                else:
                    title = ""
                desc_offset = OFFSET+399 + (title_len if len(data) > OFFSET+399 else 0)
                if desc_offset + 4 <= len(data):
                    desc_len = struct.unpack('<I', data[desc_offset:desc_offset+4])[0]
                    desc_bytes = data[desc_offset+4:desc_offset+4+desc_len] if desc_offset+4+desc_len <= len(data) else b''
                    description = desc_bytes.decode('utf-8', errors='ignore').rstrip('\x00')
                else:
                    description = ""
                cat_offset = desc_offset + 4 + (desc_len if desc_offset + 4 <= len(data) else 0)
                category = data[cat_offset] if cat_offset < len(data) else 0
                
                # Calculate prices/odds
                total_q = sum(q_values[:num_outcomes])
                if total_q == 0:
                    total_q = 1
                prices = []
                current_odds = []
                implied_probs = []
                for i in range(num_outcomes):
                    if q_values[i] == 0:
                        prices.append(0.0)
                        current_odds.append(0)
                        implied_probs.append(0)
                    else:
                        prob = q_values[i] / total_q
                        prices.append(round(prob, 4))
                        current_odds.append(int((total_q * 10000) / q_values[i]))
                        implied_probs.append(int(prob * 10000))
                
                import time
                current_time = int(time.time())
                time_to_close = start_time - current_time
                time_to_settlement = settlement_time - current_time
                
                markets.append({
                    "market_id": m_market_id,
                    "pda": str(mkt_pda),
                    "creator": creator,
                    "title": title,
                    "description": description,
                    "status": status_names[status_byte] if status_byte < len(status_names) else f"Unknown({status_byte})",
                    "status_code": status_byte,
                    "num_outcomes": num_outcomes,
                    "q_values": q_values[:num_outcomes],
                    "prices": prices,
                    "current_odds": current_odds,
                    "implied_probs": implied_probs,
                    "lmsr_b": lmsr_b,
                    "exposure": exposure,
                    "start_time": start_time,
                    "settlement_time": settlement_time,
                    "winning_outcome": winning_outcome,
                    "category": category_names.get(category, f"Unknown({category})"),
                    "outcome_mints": outcome_mints[:num_outcomes],
                    "time_to_close": time_to_close,
                    "time_to_settlement": time_to_settlement,
                })
            except Exception:
                continue
        
        return {
            "total_markets": len(markets),
            "next_market_id": next_market_id,
            "current_epoch": int.from_bytes(gc_data[266:274], "little"),
            "markets": markets
         }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


@app.get('/markets/{market_id}')
async def get_market(market_id: int):
    """Get detailed data for a single market by ID."""
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        import struct
        
        chain = await get_chain()
        mkt_pda, _ = Pubkey.find_program_address(
            [b"market", market_id.to_bytes(8, "little")], chain.program_id
        )
        
        async with AsyncClient(RPC_URL) as client:
            resp = await client.get_account_info(mkt_pda)
        
        if resp.value is None:
            raise HTTPException(status_code=404, detail=f"Market {market_id} not found")
        
        data = resp.value.data
        if len(data) < 200:
            raise HTTPException(status_code=500, detail="Invalid market data")
        
        # Parse market data (8-byte discriminator first, then fields)
        OFFSET = 8
        m_market_id = struct.unpack('<Q', data[OFFSET:OFFSET+8])[0]
        creator = str(Pubkey(data[OFFSET+8:OFFSET+40]))
        start_time = struct.unpack('<q', data[OFFSET+40:OFFSET+48])[0]
        status_byte = data[OFFSET+48]
        num_outcomes = data[OFFSET+49]
        q_values = []
        for i in range(8):
            q = struct.unpack('<Q', data[OFFSET+50 + i*8:OFFSET+50 + (i+1)*8])[0]
            q_values.append(q)
        exposure = struct.unpack('<Q', data[OFFSET+114:OFFSET+122])[0] if len(data) > OFFSET+122 else 0
        settlement_time = struct.unpack('<q', data[OFFSET+122:OFFSET+130])[0] if len(data) > OFFSET+130 else 0
        winning_outcome = data[OFFSET+130] if len(data) > OFFSET+130 else 0
        outcome_mints = []
        for i in range(8):
            if OFFSET+131 + (i+1)*32 <= len(data):
                outcome_mints.append(str(Pubkey(data[OFFSET+131 + i*32:OFFSET+131 + (i+1)*32])))
        lmsr_b = struct.unpack('<Q', data[OFFSET+387:OFFSET+395])[0] if len(data) > OFFSET+395 else 0
        if len(data) > OFFSET+399:
            title_len = struct.unpack('<I', data[OFFSET+395:OFFSET+399])[0]
            title = data[OFFSET+399:OFFSET+399+title_len].decode('utf-8', errors='ignore').rstrip('\x00')
        else:
            title = ""
        desc_offset = OFFSET+399 + (title_len if len(data) > OFFSET+399 else 0)
        if desc_offset + 4 <= len(data):
            desc_len = struct.unpack('<I', data[desc_offset:desc_offset+4])[0]
            description = data[desc_offset+4:desc_offset+4+desc_len].decode('utf-8', errors='ignore').rstrip('\x00')
        else:
            description = ""
        
        # Calculate prices/odds
        total_q = sum(q_values[:num_outcomes])
        if total_q == 0:
            total_q = 1
        prices = []
        current_odds = []
        for i in range(num_outcomes):
            if q_values[i] == 0:
                prices.append(0.0)
                current_odds.append(0)
            else:
                prob = q_values[i] / total_q
                prices.append(round(prob, 4))
                current_odds.append(int((total_q * 10000) / q_values[i]))
        
        status_names = ["PreOpen", "Open", "Suspended", "AwaitingResult", "Proposed", "Settled", "Voided"]
        
        return {
            "market_id": m_market_id,
            "pda": str(mkt_pda),
            "creator": creator,
            "title": title,
            "description": description,
            "status": status_names[status_byte] if status_byte < len(status_names) else f"Unknown({status_byte})",
            "status_code": status_byte,
            "num_outcomes": num_outcomes,
            "q_values": q_values[:num_outcomes],
            "prices": prices,
            "current_odds": current_odds,
            "lmsr_b": lmsr_b,
            "exposure": exposure,
            "start_time": start_time,
            "settlement_time": settlement_time,
            "winning_outcome": winning_outcome,
            "outcome_mints": outcome_mints[:num_outcomes],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


@app.post('/view_market_stats')
async def view_market_stats(req: MarketStatsRequest):
    """Fetch a specific market's stats by ID. Read-only."""
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        import struct

        chain = await get_chain()
        mkt_pda, _ = market_pda(chain.program_id, req.market_id)

        async with AsyncClient(RPC_URL) as client:
            resp = await client.get_account_info(mkt_pda)
            if resp.value is None:
                raise HTTPException(status_code=404, detail="Market not found")
            data = bytes(resp.value.data)

        if len(data) < 200:
            raise HTTPException(status_code=500, detail="Invalid market data")

        # Parse using the same layout as /markets
        OFFSET = 8
        m_market_id = struct.unpack('<Q', data[OFFSET:OFFSET+8])[0]
        creator = str(Pubkey.from_bytes(data[OFFSET+8:OFFSET+40]))
        start_time = struct.unpack('<q', data[OFFSET+40:OFFSET+48])[0]
        status_byte = data[OFFSET+48]
        num_outcomes = data[OFFSET+49]
        q_values = []
        for i in range(8):
            q = struct.unpack('<Q', data[OFFSET+50 + i*8:OFFSET+50 + (i+1)*8])[0]
            q_values.append(q)
        exposure = struct.unpack('<Q', data[OFFSET+114:OFFSET+122])[0] if len(data) > OFFSET+122 else 0
        settlement_time = struct.unpack('<q', data[OFFSET+122:OFFSET+130])[0] if len(data) > OFFSET+130 else 0
        winning_outcome = data[OFFSET+130] if len(data) > OFFSET+130 else 0
        outcome_mints = []
        for i in range(8):
            if OFFSET+131 + (i+1)*32 <= len(data):
                outcome_mints.append(str(Pubkey.from_bytes(data[OFFSET+131 + i*32:OFFSET+131 + (i+1)*32])))
        lmsr_b = struct.unpack('<Q', data[OFFSET+387:OFFSET+395])[0] if len(data) > OFFSET+395 else 0
        if len(data) > OFFSET+399:
            title_len = struct.unpack('<I', data[OFFSET+395:OFFSET+399])[0]
            title = data[OFFSET+399:OFFSET+399+title_len].decode('utf-8', errors='ignore').rstrip('\x00')
        else:
            title = ""
        desc_offset = OFFSET+399 + (title_len if len(data) > OFFSET+399 else 0)
        if desc_offset + 4 <= len(data):
            desc_len = struct.unpack('<I', data[desc_offset:desc_offset+4])[0]
            description = data[desc_offset+4:desc_offset+4+desc_len].decode('utf-8', errors='ignore').rstrip('\x00')
        else:
            description = ""

        total_q = sum(q_values[:num_outcomes])
        if total_q == 0:
            total_q = 1
        prices, current_odds, implied_probs = [], [], []
        for i in range(num_outcomes):
            if q_values[i] == 0:
                prices.append(0.0)
                current_odds.append(0)
                implied_probs.append(0)
            else:
                prob = q_values[i] / total_q
                prices.append(round(prob, 4))
                current_odds.append(int((total_q * 10000) / q_values[i]))
                implied_probs.append(int(prob * 10000))

        import time
        current_time = int(time.time())
        time_to_close = start_time - current_time
        time_to_settlement = settlement_time - current_time if settlement_time else 0

        status_names = ["PreOpen", "Open", "Suspended", "AwaitingResult", "Proposed", "Settled", "Voided"]

        return {
            "market_id": m_market_id,
            "pda": str(mkt_pda),
            "creator": creator,
            "title": title,
            "description": description,
            "status": status_names[status_byte] if status_byte < len(status_names) else f"Unknown({status_byte})",
            "num_outcomes": num_outcomes,
            "q_values": q_values[:num_outcomes],
            "prices": prices,
            "current_odds": current_odds,
            "implied_probs": implied_probs,
            "lmsr_b": lmsr_b,
            "exposure": exposure,
            "start_time": start_time,
            "settlement_time": settlement_time,
            "winning_outcome": winning_outcome,
            "outcome_mints": outcome_mints[:num_outcomes],
            "time_to_close": time_to_close,
            "time_to_settlement": time_to_settlement,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


class LpStatsRequest(BaseModel):
    pass


@app.post('/view_lp_stats')
async def view_lp_stats(_: LpStatsRequest = None):
    """Fetch LP stats directly without anchorpy."""
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        
        chain = await get_chain()
        treasury_ata = deployment.get('treasuryBaseAta')
        if not treasury_ata:
            raise HTTPException(status_code=500, detail='treasuryBaseAta missing in deployment')
        
        # Fetch global config
        async with AsyncClient(RPC_URL) as client:
            # Get global config
            resp = await client.get_account_info(chain.global_config)
            if resp.value is None:
                raise HTTPException(status_code=404, detail="GlobalConfig not found")
            gc_data = resp.value.data
            
            # Get treasury ATA balance
            treasury_pubkey = Pubkey.from_string(treasury_ata)
            treasury_balance = 0
            try:
                resp_ata = await client.get_token_account_balance(treasury_pubkey)
                if resp_ata.value:
                    treasury_balance = int(resp_ata.value.amount)
            except Exception:
                pass  # ATA might not exist yet
        
        import struct
        
        # Extract fields from GlobalConfig
        total_lp_supply = struct.unpack('<Q', gc_data[290:298])[0] if len(gc_data) > 298 else 0
        locked_payouts = struct.unpack('<Q', gc_data[210:218])[0] if len(gc_data) > 218 else 0
        
        # Calculate free liquidity
        free_liquidity = treasury_balance - locked_payouts if treasury_balance > locked_payouts else 0
        
        # NAV per share (scaled by 1e6)
        nav_per_share = 1_000_000  # default if no supply
        if total_lp_supply > 0:
            nav_per_share = (treasury_balance * 1_000_000) // total_lp_supply
        
        return {
            "total_tvl": treasury_balance,
            "total_lp_supply": total_lp_supply,
            "locked_exposure": locked_payouts,
            "free_liquidity": free_liquidity,
            "nav_per_share": nav_per_share,
            "total_markets": 0,
            "active_markets": 0
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


class CashOutRequest(BaseModel):
    slip_id: int
    market_ids: list[int]


@app.post('/view_cash_out_value')
async def view_cash_out_value(req: CashOutRequest):
    """Estimate the cash-out value of a multi-leg slip. Read-only.

    For each leg, fetch the current market q_values and compute the
    sell-payout (LMSR) for the leg's num_shares. Returns the sum of
    leg payouts minus a house margin (if leg is still open).
    """
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        import struct

        chain = await get_chain()
        slip_pda, _ = Pubkey.find_program_address(
            [b"bet_slip", req.slip_id.to_bytes(8, "little")], chain.program_id
        )

        async with AsyncClient(RPC_URL) as client:
            resp = await client.get_account_info(slip_pda)
        if resp.value is None:
            raise HTTPException(status_code=404, detail=f"BetSlip {req.slip_id} not found")
        slip_data = bytes(resp.value.data)
        slip = _parse_bet_slip(slip_data)

        if slip.get("error"):
            raise HTTPException(status_code=500, detail=f"Failed to parse slip: {slip['error']}")
        if not slip.get("legs"):
            raise HTTPException(status_code=400, detail="Slip has no legs")

        OFFSET = 8
        leg_payouts = []
        leg_remaining_shares = []
        leg_market_ids = []
        leg_outcome_ids = []

        async with AsyncClient(RPC_URL) as client:
            for leg in slip["legs"]:
                mid = leg["market_id"]
                oid = leg["outcome_id"]
                shares = leg["num_shares"]
                leg_market_ids.append(mid)
                leg_outcome_ids.append(oid)

                m_pda, _ = market_pda(chain.program_id, mid)
                resp = await client.get_account_info(m_pda)
                if resp.value is None:
                    # Market doesn't exist; leg is likely refunded
                    leg_payouts.append(0)
                    leg_remaining_shares.append(0)
                    continue
                data = bytes(resp.value.data)
                num_outcomes = data[OFFSET+49] if len(data) > OFFSET+49 else 0
                if oid >= num_outcomes:
                    leg_payouts.append(0)
                    leg_remaining_shares.append(0)
                    continue
                q_values = []
                for i in range(8):
                    q = struct.unpack('<Q', data[OFFSET+50 + i*8:OFFSET+50 + (i+1)*8])[0]
                    q_values.append(q)
                lmsr_b = struct.unpack('<Q', data[OFFSET+387:OFFSET+395])[0] if len(data) > OFFSET+395 else 100_000_000_000
                if lmsr_b == 0:
                    lmsr_b = 100_000_000_000

                # Cashout = sell payout for shares held
                sellable = min(shares, q_values[oid])
                if sellable > 0:
                    payout = calculate_lmsr_payout(q_values, oid, sellable, lmsr_b)
                    fee = payout // 100
                    net = payout - fee
                else:
                    net = 0
                leg_payouts.append(net)
                leg_remaining_shares.append(q_values[oid])

        gross_payout = sum(leg_payouts)
        return {
            "slip_id": req.slip_id,
            "slip_status": slip.get("status"),
            "slip_legs": slip.get("legs"),
            "leg_payouts": leg_payouts,
            "leg_remaining_shares": leg_remaining_shares,
            "gross_payout": gross_payout,
            "total_stake": slip.get("total_stake", 0),
            "net_cash_out": gross_payout,
            "house_margin_bps": slip.get("house_margin_bps", 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


# ─── Wallet / Position Query Endpoints (read-only) ──────────────────
#
# These are user-facing query endpoints. They never sign transactions;
# the user signs buy/sell/etc. with their own wallet.

class UserWalletRequest(BaseModel):
    wallet: str  # user wallet pubkey (base58)


def _parse_bet_slip(data: bytes) -> dict:
    """Parse a BetSlip account's raw bytes into a JSON-friendly dict."""
    import struct
    if len(data) < 8:
        return {"error": "data too short"}
    # 8-byte discriminator first
    OFFSET = 8
    try:
        slip_id = struct.unpack('<Q', data[OFFSET:OFFSET+8])[0]
        creator = str(Pubkey.from_bytes(data[OFFSET+8:OFFSET+40]))
        # legs: array of 8 SlipLeg (each 17 bytes: 8 market_id + 1 outcome + 8 num_shares = 17)
        # Actually need to check anchor array layout: vec or fixed array?
        # IDL says `array: [{defined: SlipLeg}, 8]` => fixed [SlipLeg; 8]
        # Each SlipLeg: u64 market_id + u8 outcome_id + u64 num_shares = 17 bytes
        legs = []
        leg_offset = OFFSET + 40
        LEG_SIZE = 17
        for i in range(8):
            base = leg_offset + i * LEG_SIZE
            if base + LEG_SIZE > len(data):
                break
            mid = struct.unpack('<Q', data[base:base+8])[0]
            oid = data[base+8]
            sh = struct.unpack('<Q', data[base+9:base+17])[0]
            if mid != 0 or sh != 0:
                legs.append({"market_id": mid, "outcome_id": oid, "num_shares": sh})
        num_legs = data[leg_offset + 8*LEG_SIZE] if leg_offset + 8*LEG_SIZE < len(data) else 0
        pos = leg_offset + 8*LEG_SIZE + 1
        total_stake = struct.unpack('<Q', data[pos:pos+8])[0] if pos+8 <= len(data) else 0
        pos += 8
        combined_odds_fp = struct.unpack('<Q', data[pos:pos+8])[0] if pos+8 <= len(data) else 0
        pos += 8
        house_margin_bps = struct.unpack('<Q', data[pos:pos+8])[0] if pos+8 <= len(data) else 0
        pos += 8
        potential_payout = struct.unpack('<Q', data[pos:pos+8])[0] if pos+8 <= len(data) else 0
        pos += 8
        locked_amount = struct.unpack('<Q', data[pos:pos+8])[0] if pos+8 <= len(data) else 0
        pos += 8
        exposure_locked = struct.unpack('<Q', data[pos:pos+8])[0] if pos+8 <= len(data) else 0
        pos += 8
        # group_ids: [u64; 8] = 64 bytes
        group_ids = []
        for i in range(8):
            gid = struct.unpack('<Q', data[pos+i*8:pos+(i+1)*8])[0] if pos+(i+1)*8 <= len(data) else 0
            group_ids.append(gid)
        pos += 64
        # group_exposure_locked: [u64; 8] = 64 bytes
        pos += 64
        num_groups_locked = data[pos] if pos < len(data) else 0
        pos += 1
        claimed = bool(data[pos]) if pos < len(data) else False
        pos += 1
        is_seed = bool(data[pos]) if pos < len(data) else False
        pos += 1
        seed_group_id = struct.unpack('<Q', data[pos:pos+8])[0] if pos+8 <= len(data) else 0
        pos += 8
        seed_position_index = data[pos] if pos < len(data) else 0
        pos += 1
        bump = data[pos] if pos < len(data) else 0
        pos += 1
        # status: SlipStatus enum (u8)
        status = data[pos] if pos < len(data) else 0
        pos += 1
        legs_added = data[pos] if pos < len(data) else 0
        pos += 1
        max_payment = struct.unpack('<Q', data[pos:pos+8])[0] if pos+8 <= len(data) else 0

        slip_status_names = ["Open", "Settled", "Voided", "Won", "Lost", "Partial", "Cancelled"]
        return {
            "slip_id": slip_id,
            "creator": creator,
            "legs": legs,
            "num_legs": num_legs,
            "total_stake": total_stake,
            "combined_odds_fp": combined_odds_fp,
            "house_margin_bps": house_margin_bps,
            "potential_payout": potential_payout,
            "locked_amount": locked_amount,
            "exposure_locked": exposure_locked,
            "group_ids": [g for g in group_ids if g != 0],
            "num_groups_locked": num_groups_locked,
            "claimed": claimed,
            "is_seed": is_seed,
            "seed_group_id": seed_group_id,
            "status": slip_status_names[status] if status < len(slip_status_names) else f"Unknown({status})",
            "status_code": status,
            "legs_added": legs_added,
            "max_payment": max_payment,
        }
    except Exception as e:
        return {"error": f"parse failed: {e}", "raw_len": len(data)}


@app.post('/user_positions')
async def user_positions(req: UserWalletRequest):
    """Fetch a user's USDC balance + all outcome token balances across all markets.
    Read-only - never signs transactions.
    """
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey
        from spl.token.instructions import get_associated_token_address
        import struct

        chain = await get_chain()
        base_mint = Pubkey.from_string(BASE_MINT)
        user_pubkey = Pubkey.from_string(req.wallet)

        # USDC balance
        user_base_ata = get_associated_token_address(user_pubkey, base_mint)
        usdc_balance = 0
        usdc_decimals = 6
        async with AsyncClient(RPC_URL) as client:
            try:
                resp = await client.get_token_account_balance(user_base_ata)
                if resp.value:
                    usdc_balance = int(resp.value.amount)
                    usdc_decimals = resp.value.decimals
            except Exception:
                pass

            # Get protocol state
            resp = await client.get_account_info(chain.global_config)
            if resp.value is None:
                raise HTTPException(status_code=404, detail="GlobalConfig not found")
            gc_data = resp.value.data
            next_market_id = int.from_bytes(gc_data[194:202], "little")

        # Fetch all outcome token accounts for this wallet via getTokenAccountsByOwner
        positions = []
        async with AsyncClient(RPC_URL) as client:
            # Use program filter on Token program, then filter for our outcome mints
            # Simpler: compute all outcome mints and batch getMultipleAccounts
            outcome_mints = []
            for mid in range(1, next_market_id + 1):
                m_pda, _ = Pubkey.find_program_address(
                    [b"market", mid.to_bytes(8, "little")], chain.program_id
                )
                # Read num_outcomes from market data
                resp = await client.get_account_info(m_pda)
                if resp.value is None:
                    continue
                num_outcomes = resp.value.data[8 + 49] if len(resp.value.data) > 8 + 49 else 0
                for oid in range(num_outcomes):
                    om, _ = Pubkey.find_program_address(
                        [b"outcome_mint", mid.to_bytes(8, "little"), bytes([oid])], chain.program_id
                    )
                    outcome_mints.append((mid, oid, om))

        # Batch fetch ATAs and balances
        atas = [get_associated_token_address(user_pubkey, om) for _, _, om in outcome_mints]
        # chunk to avoid huge RPC calls
        CHUNK = 100
        all_accounts = []
        async with AsyncClient(RPC_URL) as client:
            for i in range(0, len(atas), CHUNK):
                chunk = atas[i:i+CHUNK]
                resp = await client.get_multiple_accounts(chunk)
                for om, acc in zip([t[2] for t in outcome_mints[i:i+CHUNK]], resp.value):
                    all_accounts.append((om, acc))

        # Now get balances via batch getTokenAccountBalance
        for (mid, oid, om), ata in zip(outcome_mints, atas):
            try:
                async with AsyncClient(RPC_URL) as client:
                    resp = await client.get_token_account_balance(ata)
                    if resp.value and int(resp.value.amount) > 0:
                        positions.append({
                            "market_id": mid,
                            "outcome_id": oid,
                            "outcome_mint": str(om),
                            "balance": int(resp.value.amount),
                            "decimals": resp.value.decimals,
                            "ui_balance": float(resp.value.ui_amount_string or 0),
                        })
            except Exception:
                continue

        return {
            "wallet": req.wallet,
            "usdc_balance": usdc_balance,
            "usdc_decimals": usdc_decimals,
            "usdc_ui_balance": usdc_balance / (10 ** usdc_decimals) if usdc_decimals else 0,
            "positions": positions,
            "total_positions": len(positions),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


class SlipRequest(BaseModel):
    slip_id: int


class UserSlipsRequest(BaseModel):
    wallet: str
    start_id: int = 1
    end_id: int = 50  # scan range
    only_open: bool = True


class BetSlipHistoryRequest(BaseModel):
    wallet: str
    start_id: int = 1
    end_id: int = 100
    only_settled: bool = False


@app.post('/bet_slip')
async def get_bet_slip(req: SlipRequest):
    """Fetch a single bet slip account by slip_id. Read-only."""
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey

        chain = await get_chain()
        slip_pda, _ = Pubkey.find_program_address(
            [b"bet_slip", req.slip_id.to_bytes(8, "little")], chain.program_id
        )

        async with AsyncClient(RPC_URL) as client:
            resp = await client.get_account_info(slip_pda)

        if resp.value is None:
            raise HTTPException(status_code=404, detail=f"BetSlip {req.slip_id} not found")

        parsed = _parse_bet_slip(bytes(resp.value.data))
        parsed["pda"] = str(slip_pda)
        return parsed
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


@app.post('/user_slips')
async def user_slips(req: UserSlipsRequest):
    """Scan bet slip accounts in a slip_id range and return those owned by the wallet.
    Read-only - never signs transactions.
    """
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey

        chain = await get_chain()
        user_pubkey_str = req.wallet

        # Build list of slip PDAs
        slip_pdas = []
        for sid in range(req.start_id, req.end_id + 1):
            sp, _ = Pubkey.find_program_address(
                [b"bet_slip", sid.to_bytes(8, "little")], chain.program_id
            )
            slip_pdas.append((sid, sp))

        # Batch fetch
        CHUNK = 50
        all_accounts = []
        async with AsyncClient(RPC_URL) as client:
            for i in range(0, len(slip_pdas), CHUNK):
                chunk = slip_pdas[i:i+CHUNK]
                keys = [p for _, p in chunk]
                resp = await client.get_multiple_accounts(keys)
                for (sid, _), acc in zip(chunk, resp.value):
                    if acc is not None:
                        all_accounts.append((sid, bytes(acc.data)))

        # Parse and filter by wallet
        slips = []
        for sid, data in all_accounts:
            parsed = _parse_bet_slip(data)
            if parsed.get("error"):
                continue
            if parsed.get("creator") != user_pubkey_str:
                continue
            if req.only_open:
                # status_code: 0=Open, 1=Settled, 2=Voided, 3=Won, 4=Lost, 5=Partial, 6=Cancelled
                if parsed.get("status_code", 0) not in (0, 5):  # Open or Partial
                    continue
            # Add slip_id
            parsed["slip_id"] = sid
            # Derive PDA
            sp, _ = Pubkey.find_program_address(
                [b"bet_slip", sid.to_bytes(8, "little")], chain.program_id
            )
            parsed["pda"] = str(sp)
            slips.append(parsed)

        return {
            "wallet": req.wallet,
            "slip_count": len(slips),
            "slips": slips,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


@app.post('/user_bet_history')
async def user_bet_history(req: BetSlipHistoryRequest):
    """Scan bet slip accounts in a slip_id range and return all slips for a wallet.
    Read-only - never signs transactions.
    """
    try:
        from solana.rpc.async_api import AsyncClient
        from solders.pubkey import Pubkey

        chain = await get_chain()
        user_pubkey_str = req.wallet

        slip_pdas = []
        for sid in range(req.start_id, req.end_id + 1):
            sp, _ = Pubkey.find_program_address(
                [b"bet_slip", sid.to_bytes(8, "little")], chain.program_id
            )
            slip_pdas.append((sid, sp))

        CHUNK = 50
        all_accounts = []
        async with AsyncClient(RPC_URL) as client:
            for i in range(0, len(slip_pdas), CHUNK):
                chunk = slip_pdas[i:i+CHUNK]
                keys = [p for _, p in chunk]
                resp = await client.get_multiple_accounts(keys)
                for (sid, _), acc in zip(chunk, resp.value):
                    if acc is not None:
                        all_accounts.append((sid, bytes(acc.data)))

        history = []
        for sid, data in all_accounts:
            parsed = _parse_bet_slip(data)
            if parsed.get("error"):
                continue
            if parsed.get("creator") != user_pubkey_str:
                continue
            if req.only_settled:
                # status_code: 0=Open, 1=Settled, 2=Voided, 3=Won, 4=Lost, 5=Partial, 6=Cancelled
                if parsed.get("status_code", 0) not in (1, 2, 3, 4, 5, 6):
                    continue
            parsed["slip_id"] = sid
            sp, _ = Pubkey.find_program_address(
                [b"bet_slip", sid.to_bytes(8, "little")], chain.program_id
            )
            parsed["pda"] = str(sp)
            history.append(parsed)

        return {
            "wallet": req.wallet,
            "history_count": len(history),
            "history": history,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {type(e).__name__}: {str(e)}")


if __name__ == '__main__':
    import uvicorn
    uvicorn.run('bot.api:app', host='0.0.0.0', port=8081, reload=True)

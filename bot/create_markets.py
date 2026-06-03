#!/usr/bin/env python3
"""
Create 2 PreOpen football betting markets using raw RPC calls.
No anchorpy dependency needed.

Usage:
    python create_markets.py
"""

import asyncio
import json
import base64
import time
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import Transaction
import httpx

# Configuration
RPC_URL = "https://api.devnet.solana.com"
PROGRAM_ID = "3MsEuMziRKjA1w1WTPeW5NvDUCjGoep2QZ5zBthGq23Z"
OPERATOR_PATH = "/tmp/devnet_wallet.json"
BASE_MINT = "4zJfNn9Vc3sQWGw8qCH8QM8E6P8uFTvCg4k6Ps4R1uA"

SYSTEM_PROGRAM = Pubkey.from_string("11111111111111111111111111111111")
TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
RENT_SYSVAR = Pubkey.from_string("SysvarRent111111111111111111111111111111111")

def load_keypair(path: str) -> Keypair:
    with open(path) as f:
        return Keypair.from_bytes(bytes(json.load(f)))

class SolanaClient:
    def __init__(self, rpc_url: str):
        self.rpc_url = rpc_url
    
    async def fetch(self, method: str, params: list = None) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(self.rpc_url, json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params or []
            })
            return resp.json()
    
    async def get_balance(self, pubkey: str) -> int:
        result = await self.fetch("getBalance", [pubkey])
        return result.get("result", {}).get("value", 0)
    
    async def get_account_info(self, pubkey: str) -> dict | None:
        result = await self.fetch("getAccountInfo", [str(pubkey), {"encoding": "base64"}])
        if "result" in result and result["result"]:
            return result["result"]["value"]
        return None
    
    async def get_recent_blockhash(self) -> str:
        result = await self.fetch("getLatestBlockhash", [])
        return result["result"]["value"]["blockhash"]
    
    async def send_transaction(self, tx: Transaction) -> str | None:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(self.rpc_url, json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [base64.b64encode(bytes(tx)).decode(), {"skipPreflight": False, "preflightCommitment": "confirmed"}]
            })
            if "result" in resp:
                return resp["result"]
            else:
                print(f"RPC Error: {resp}")
                return None
    
    async def confirm_transaction(self, sig: str, timeout: int = 30) -> bool:
        for _ in range(timeout * 2):
            await asyncio.sleep(0.5)
            result = await self.fetch("getSignatureStatuses", [[sig]])
            if "result" in result and result["result"]["value"]:
                status = result["result"]["value"][0]
                if status and (status.get("confirmationStatus") in ["confirmed", "finalized"]):
                    return True
                if status and status.get("err"):
                    print(f"   TX Error: {status['err']}")
                    return False
        return False

def build_ix(program_id: Pubkey, data: bytes, accounts: list) -> dict:
    return {
        "programId": str(program_id),
        "accounts": accounts,
        "data": base64.b64encode(data).decode()
    }

async def create_market_group(client, payer, group_id, max_exposure, event_start, title):
    """Create a market group"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    group_pda, _ = Pubkey.find_program_address([b"market_group", group_id.to_bytes(8, "little")], program_id)
    
    # Check if exists
    info = await client.get_account_info(str(group_pda))
    if info:
        print(f"   Market group {group_id} already exists")
        return group_pda, True
    
    # Discriminator for create_market_group
    data = bytes([63, 31, 199, 113, 16, 206, 105, 218])  # From IDL
    
    # Title encoding
    title_bytes = title.encode('utf-8')
    
    # Build args: group_id (u64) + max_exposure (u64) + event_start (i64) + title (string)
    args = group_id.to_bytes(8, "little")
    args += max_exposure.to_bytes(8, "little")
    args += event_start.to_bytes(8, "little")
    args += len(title_bytes).to_bytes(4, "little")  # string length
    args += title_bytes
    data = data + args
    
    accounts = [
        {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
        {"pubkey": str(group_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
        {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
    ]
    
    ix = build_ix(program_id, data, accounts)
    
    tx = Transaction()
    tx.add(ix)
    tx.recent_blockhash = (await client.get_recent_blockhash())
    tx.fee_payer = payer.pubkey()
    tx.sign(payer)
    
    sig = await client.send_transaction(tx)
    if sig:
        confirmed = await client.confirm_transaction(sig)
        return group_pda, confirmed
    return group_pda, False

async def create_market(client, payer, market_id, start_time, num_outcomes, title, description, category, q_values):
    """Create a market"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    mkt_pda, _ = Pubkey.find_program_address([b"market", market_id.to_bytes(8, "little")], program_id)
    epoch_pda, _ = Pubkey.find_program_address([b"epoch", (0).to_bytes(8, "little")], program_id)
    
    # Check if exists
    info = await client.get_account_info(str(mkt_pda))
    if info:
        print(f"   Market {market_id} already exists")
        return mkt_pda, True
    
    # Discriminator for create_market: [115, 59, 155, 18, 53, 121, 193, 200] from IDL
    # Args: start_time (i64), num_outcomes (u8), title (string), description (string), 
    #       category (u8), lmsr_b_override (option), initial_q_values (option), market_mode (MarketMode)
    
    data = bytes([115, 59, 155, 18, 53, 121, 193, 200])
    
    # Encode args
    args = start_time.to_bytes(8, "little", signed=True)
    args += bytes([num_outcomes])
    
    title_bytes = title.encode('utf-8')
    args += len(title_bytes).to_bytes(4, "little")
    args += title_bytes
    
    desc_bytes = description.encode('utf-8')
    args += len(desc_bytes).to_bytes(4, "little")
    args += desc_bytes
    
    args += bytes([category])  # category
    
    # lmsr_b_override = None (0)
    args += bytes([0])
    
    # initial_q_values = Some
    args += bytes([1])  # Some
    args += len(q_values).to_bytes(4, "little")
    for qv in q_values:
        args += qv.to_bytes(8, "little")
    
    # market_mode = FixedOdds (1)
    args += bytes([1])
    
    data = data + args
    
    accounts = [
        {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
        {"pubkey": str(mkt_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(epoch_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
        {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(RENT_SYSVAR), "isWritable": False, "isSigner": False},
    ]
    
    ix = build_ix(program_id, data, accounts)
    
    tx = Transaction()
    tx.add(ix)
    tx.recent_blockhash = (await client.get_recent_blockhash())
    tx.fee_payer = payer.pubkey()
    tx.sign(payer)
    
    sig = await client.send_transaction(tx)
    if sig:
        confirmed = await client.confirm_transaction(sig)
        return mkt_pda, confirmed
    return mkt_pda, False

async def add_market_to_group(client, payer, group_id, market_index, market_pda):
    """Add a market to group (sets to PreOpen)"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    group_pda, _ = Pubkey.find_program_address([b"market_group", group_id.to_bytes(8, "little")], program_id)
    
    # Discriminator: [3, 83, 89, 73, 170, 79, 154, 103]
    data = bytes([3, 83, 89, 73, 170, 79, 154, 103])
    
    # Args: group_id (u64) + market_index (u8)
    args = group_id.to_bytes(8, "little")
    args += bytes([market_index])
    
    data = data + args
    
    accounts = [
        {"pubkey": str(global_config), "isWritable": False, "isSigner": False},
        {"pubkey": str(group_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(market_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": False, "isSigner": True},
    ]
    
    ix = build_ix(program_id, data, accounts)
    
    tx = Transaction()
    tx.add(ix)
    tx.recent_blockhash = (await client.get_recent_blockhash())
    tx.fee_payer = payer.pubkey()
    tx.sign(payer)
    
    sig = await client.send_transaction(tx)
    if sig:
        return await client.confirm_transaction(sig)
    return False

async def init_outcome_mint(client, payer, market_id, outcome_id, market_pda):
    """Initialize an outcome mint"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    outcome_mint, _ = Pubkey.find_program_address(
        [b"outcome_mint", market_id.to_bytes(8, "little"), bytes([outcome_id])], 
        program_id
    )
    
    # Check if exists
    info = await client.get_account_info(str(outcome_mint))
    if info:
        print(f"   Outcome {outcome_id} mint already exists")
        return outcome_mint, True
    
    # Discriminator: [246, 126, 172, 53, 18, 227, 71, 207]
    data = bytes([246, 126, 172, 53, 18, 227, 71, 207])
    
    # Args: market_id (u64) + outcome_id (u8)
    args = market_id.to_bytes(8, "little")
    args += bytes([outcome_id])
    
    data = data + args
    
    accounts = [
        {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
        {"pubkey": str(market_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(outcome_mint), "isWritable": True, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
        {"pubkey": str(TOKEN_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(RENT_SYSVAR), "isWritable": False, "isSigner": False},
    ]
    
    ix = build_ix(program_id, data, accounts)
    
    tx = Transaction()
    tx.add(ix)
    tx.recent_blockhash = (await client.get_recent_blockhash())
    tx.fee_payer = payer.pubkey()
    tx.sign(payer)
    
    sig = await client.send_transaction(tx)
    if sig:
        confirmed = await client.confirm_transaction(sig)
        return outcome_mint, confirmed
    return outcome_mint, False

async def main():
    print("=" * 60)
    print("Creating 2 PreOpen Football Betting Markets")
    print("=" * 60)
    
    # Load keypair
    payer = load_keypair(OPERATOR_PATH)
    client = SolanaClient(RPC_URL)
    
    print(f"\nOperator: {payer.pubkey()}")
    
    balance = await client.get_balance(str(payer.pubkey()))
    print(f"Balance: {balance / 1e9:.4f} SOL")
    
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    
    # Fetch current next_market_id
    print("\n1. Fetching current protocol state...")
    gc_info = await client.get_account_info(str(global_config))
    if not gc_info:
        print("   ERROR: GlobalConfig not found! Run init_protocol.py first.")
        return
    
    data = base64.b64decode(gc_info['data'][0])
    # Skip 8-byte discriminator, next_market_id is at bytes 48-56
    next_market_id = int.from_bytes(data[48:56], "little")
    print(f"   Current next_market_id: {next_market_id}")
    print(f"   Admin: {Pubkey(data[8:40])}")
    
    # Create market group
    print("\n2. Creating market group...")
    group_id = 1
    event_start = int(time.time()) + (48 * 60 * 60)  # 48 hours from now
    title = "Arsenal vs Liverpool"
    max_exposure = 10_000_000_000  # 10 SOL worth
    
    group_pda, success = await create_market_group(client, payer, group_id, max_exposure, event_start, title)
    if success:
        print(f"   ✅ Market group created: {group_pda}")
    else:
        print(f"   ❌ Failed to create market group")
        return
    
    # Markets to create
    markets = [
        {
            "title": "Arsenal vs Liverpool - Match Result",
            "description": "Which team will win the match? Home win, draw, or away win.",
            "num_outcomes": 3,
            "category": 0,
            "q_values": [2500000000, 4000000000, 3500000000],  # ~4.0, ~2.5, ~2.86 odds
        },
        {
            "title": "Arsenal vs Liverpool - Both Teams To Score",
            "description": "Will both teams score? Yes or No.",
            "num_outcomes": 2,
            "category": 1,
            "q_values": [3000000000, 3000000000],  # ~1.67 odds
        },
    ]
    
    created_markets = []
    
    for i, mkt in enumerate(markets):
        print(f"\n3.{i+1}. Creating market: {mkt['title'][:40]}...")
        
        market_id = next_market_id + i
        mkt_pda, success = await create_market(
            client, payer, market_id, event_start,
            mkt["num_outcomes"], mkt["title"], mkt["description"],
            mkt["category"], mkt["q_values"]
        )
        
        if success:
            print(f"   ✅ Market {market_id} created: {mkt_pda}")
            created_markets.append({"id": market_id, "pda": str(mkt_pda), **mkt})
            
            # Add to group
            print(f"   Adding to group (sets to PreOpen)...")
            success = await add_market_to_group(client, payer, group_id, i, mkt_pda)
            if success:
                print(f"   ✅ Added to group")
            else:
                print(f"   ❌ Failed to add to group")
            
            # Initialize outcome mints
            print(f"   Initializing outcome mints...")
            for outcome_id in range(mkt["num_outcomes"]):
                outcome_mint, success = await init_outcome_mint(client, payer, market_id, outcome_id, mkt_pda)
                if success:
                    print(f"   ✅ Outcome {outcome_id}: {outcome_mint}")
                else:
                    print(f"   ❌ Outcome {outcome_id} failed")
        else:
            print(f"   ❌ Failed to create market")
    
    # Summary
    print("\n" + "=" * 60)
    print("MARKETS CREATED SUCCESSFULLY!")
    print("=" * 60)
    print(f"Group ID: {group_id}")
    print(f"Match: {title}")
    print(f"Start time: {time.ctime(event_start)}")
    print(f"\nMarkets (all in PreOpen status):")
    for i, mkt in enumerate(created_markets):
        print(f"\n  [{i+1}] Market ID: {mkt['id']}")
        print(f"      Title: {mkt['title']}")
        print(f"      Category: {mkt['category']}")
        print(f"      Outcomes: {mkt['num_outcomes']}")
        print(f"      PDA: {mkt['pda']}")

if __name__ == "__main__":
    asyncio.run(main())

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
from solders.message import Message
from solders.instruction import Instruction, AccountMeta
from solders.hash import Hash
import httpx
from spl.token.instructions import get_associated_token_address, create_associated_token_account

# Configuration - load from deployment
import os
from pathlib import Path

DEPLOY_PATH = Path(__file__).parent.parent / "devnet-deployment.json"
if DEPLOY_PATH.exists():
    with open(DEPLOY_PATH) as f:
        deploy = json.load(f)
    RPC_URL = os.environ.get("RPC_URL", "https://api.devnet.solana.com")
    PROGRAM_ID = deploy.get("programId", "54kfyBYeASZr4BqyWatkTqmBJTzgQ8XoEs5vaC8wxkRU")
    BASE_MINT = deploy.get("baseMint", "8x97aHWPoTY4m9T4tEGDjf4EHYv29nJiX9uEGZHqMyPP")
else:
    RPC_URL = "https://api.devnet.solana.com"
    PROGRAM_ID = "54kfyBYeASZr4BqyWatkTqmBJTzgQ8XoEs5vaC8wxkRU"
    BASE_MINT = "8x97aHWPoTY4m9T4tEGDjf4EHYv29nJiX9uEGZHqMyPP"

# Operator keypair path - default to admin wallet
OPERATOR_PATH = os.environ.get("OPERATOR_KEYPAIR_PATH", "")
if not OPERATOR_PATH or not Path(OPERATOR_PATH).expanduser().exists():
    # Try default locations
    for path in [
        Path("~/.config/solana/id.json").expanduser(),
        Path("/tmp/devnet_wallet.json"),
        Path("../.config/solana/id.json"),
    ]:
        if path.exists():
            OPERATOR_PATH = str(path)
            break

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
    
    async def get_recent_blockhash(self) -> Hash:
        result = await self.fetch("getLatestBlockhash", [])
        return Hash.from_string(result["result"]["value"]["blockhash"])
    
    async def send_transaction(self, tx: Transaction) -> str | None:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(self.rpc_url, json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [base64.b64encode(bytes(tx)).decode(), {"skipPreflight": False, "preflightCommitment": "confirmed", "encoding": "base64"}]
            })
            result = resp.json()
            if "result" in result:
                return result["result"]
            else:
                print(f"RPC Error: {result}")
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

def build_ix(program_id: Pubkey, data: bytes, accounts: list) -> Instruction:
    return Instruction(
        program_id=program_id,
        accounts=[AccountMeta(pubkey=Pubkey.from_string(acc["pubkey"]), is_signer=acc.get("isSigner", False), is_writable=acc.get("isWritable", False)) for acc in accounts],
        data=data
    )

async def init_epoch(client, payer, current_epoch):
    """Initialize the epoch account if not exists"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    epoch_pda, _ = Pubkey.find_program_address([b"epoch", current_epoch.to_bytes(8, "little")], program_id)
    
    # Check if exists
    info = await client.get_account_info(str(epoch_pda))
    if info:
        print(f"   Epoch {current_epoch} already initialized: {epoch_pda}")
        return epoch_pda, True
    
    # Discriminator for init_epoch
    data = bytes([78, 81, 66, 76, 217, 113, 189, 109])
    
    accounts = [
        {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
        {"pubkey": str(epoch_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
        {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
    ]
    
    ix = build_ix(program_id, data, accounts)
    
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
    sig = await client.send_transaction(tx)
    if sig:
        confirmed = await client.confirm_transaction(sig)
        return epoch_pda, confirmed
    return epoch_pda, False

async def get_next_market_id(client):
    """Fetch next_market_id from on-chain global config"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    gc_info = await client.get_account_info(str(global_config))
    if not gc_info:
        return 0
    data = base64.b64decode(gc_info['data'][0])
    return int.from_bytes(data[194:202], "little")


async def get_current_epoch(client):
    """Fetch current epoch from on-chain global config"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    gc_info = await client.get_account_info(str(global_config))
    if not gc_info:
        return 0
    data = base64.b64decode(gc_info['data'][0])
    return int.from_bytes(data[266:274], "little")


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
    
    # Discriminator for create_market_group from IDL
    data = bytes([233, 144, 194, 255, 240, 250, 129, 96])
    
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
    
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
    sig = await client.send_transaction(tx)
    if sig:
        confirmed = await client.confirm_transaction(sig)
        return group_pda, confirmed
    return group_pda, False

async def create_market(client, payer, market_id, start_time, num_outcomes, title, description, category, q_values, current_epoch=None):
    """Create a market"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    mkt_pda, _ = Pubkey.find_program_address([b"market", market_id.to_bytes(8, "little")], program_id)
    if current_epoch is None:
        current_epoch = await get_current_epoch(client)
    epoch_pda, _ = Pubkey.find_program_address([b"epoch", current_epoch.to_bytes(8, "little")], program_id)
    
    # Check if exists
    info = await client.get_account_info(str(mkt_pda))
    if info:
        print(f"   Market {market_id} already exists")
        return mkt_pda, True
    
    # Discriminator for create_market from IDL
    data = bytes([103, 226, 97, 235, 200, 188, 251, 254])
    
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
    
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
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
    
    # Discriminator for add_market_to_group from IDL
    data = bytes([16, 123, 193, 117, 168, 99, 47, 86])
    
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
    
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
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
    
    # Discriminator for init_outcome_mint from IDL
    data = bytes([151, 123, 164, 232, 195, 38, 104, 132])
    
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
    
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
    sig = await client.send_transaction(tx)
    if sig:
        confirmed = await client.confirm_transaction(sig)
        return outcome_mint, confirmed
    return outcome_mint, False


async def activate_market(client, payer, market_id, market_pda):
    """Activate a market (set to Open status)"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    
    # Discriminator for activate_seeded_market: this sets status to PreOpen (later we'll use resume_market to Open)
    # Actually let's use a simple approach: just create another market without group for now
    # For now, let's just print the market info
    print(f"   Market {market_id} created at {market_pda}")
    print(f"   NOTE: Market is in PreOpen status. Use resume_market to Open for trading.")
    return True


async def create_outcome_atas(client, payer, market_id, num_outcomes):
    """Pre-create buyer/seeder outcome ATAs for all outcomes of a market"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    ixs = []
    addresses = []
    for outcome_id in range(num_outcomes):
        outcome_mint, _ = Pubkey.find_program_address(
            [b"outcome_mint", market_id.to_bytes(8, "little"), bytes([outcome_id])],
            program_id
        )
        buyer_outcome_ata = get_associated_token_address(payer.pubkey(), outcome_mint)
        addresses.append((outcome_mint, buyer_outcome_ata))
        info = await client.get_account_info(str(buyer_outcome_ata))
        if not info:
            ixs.append(create_associated_token_account(payer.pubkey(), payer.pubkey(), outcome_mint))
    
    if not ixs:
        return True
    
    message = Message(ixs)
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    sig = await client.send_transaction(tx)
    if sig:
        return await client.confirm_transaction(sig)
    return False


async def register_seed_position(client, payer, group_id, market_id, market_index, outcome_id, amount):
    """Register a seed position for an outcome (deposits USDC, gets outcome tokens)"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    base_mint = Pubkey.from_string(BASE_MINT)
    ATOKEN_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    group_pda, _ = Pubkey.find_program_address([b"market_group", group_id.to_bytes(8, "little")], program_id)
    market_pda, _ = Pubkey.find_program_address([b"market", market_id.to_bytes(8, "little")], program_id)
    treasury, _ = Pubkey.find_program_address([b"treasury"], program_id)
    outcome_mint, _ = Pubkey.find_program_address(
        [b"outcome_mint", market_id.to_bytes(8, "little"), bytes([outcome_id])], program_id
    )
    
    seeder_base_ata = get_associated_token_address(payer.pubkey(), base_mint)
    treasury_base_ata = get_associated_token_address(treasury, base_mint)
    seeder_outcome_ata = get_associated_token_address(payer.pubkey(), outcome_mint)
    
    # Discriminator for register_seed_position
    data = bytes([164, 69, 55, 242, 126, 121, 21, 74])
    # Args: group_id (u64), market_id (u64), market_index (u8), outcome_id (u8), amount (u64)
    data += group_id.to_bytes(8, "little")
    data += market_id.to_bytes(8, "little")
    data += bytes([market_index])
    data += bytes([outcome_id])
    data += amount.to_bytes(8, "little")
    
    accounts = [
        {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
        {"pubkey": str(group_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(market_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(treasury), "isWritable": False, "isSigner": False},
        {"pubkey": str(seeder_base_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(treasury_base_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(outcome_mint), "isWritable": True, "isSigner": False},
        {"pubkey": str(seeder_outcome_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(base_mint), "isWritable": False, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
        {"pubkey": str(TOKEN_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(ATOKEN_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
    ]
    
    ix = build_ix(program_id, data, accounts)
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
    sig = await client.send_transaction(tx)
    if sig:
        return await client.confirm_transaction(sig)
    return False


async def activate_seeded_market(client, payer, group_id, market_id):
    """Activate a seeded market - transitions PreOpen → Open"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    group_pda, _ = Pubkey.find_program_address([b"market_group", group_id.to_bytes(8, "little")], program_id)
    market_pda, _ = Pubkey.find_program_address([b"market", market_id.to_bytes(8, "little")], program_id)
    
    # Discriminator for activate_seeded_market
    data = bytes([115, 59, 155, 18, 53, 121, 193, 200])
    data += group_id.to_bytes(8, "little")
    
    accounts = [
        {"pubkey": str(global_config), "isWritable": False, "isSigner": False},
        {"pubkey": str(group_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(market_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": False, "isSigner": True},
    ]
    
    ix = build_ix(program_id, data, accounts)
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
    sig = await client.send_transaction(tx)
    if sig:
        return await client.confirm_transaction(sig)
    return False


async def create_treasury_ata(client, payer):
    """Create treasury_base_ata and provider_lp_ata if they don't exist"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    base_mint = Pubkey.from_string(BASE_MINT)
    lp_mint = Pubkey.from_string("BJtvd9JE3BTSg9Vgp46umX1Qq6GdF1YMiNxpYsnzTZfz")
    treasury, _ = Pubkey.find_program_address([b"treasury"], program_id)
    treasury_base_ata = get_associated_token_address(treasury, base_mint)
    provider_lp_ata = get_associated_token_address(payer.pubkey(), lp_mint)
    
    ixs = []
    
    # Check treasury_base_ata
    info = await client.get_account_info(str(treasury_base_ata))
    if not info:
        print(f"   Creating treasury ATA: {treasury_base_ata}")
        ixs.append(create_associated_token_account(payer.pubkey(), treasury, base_mint))
    else:
        print(f"   Treasury ATA already exists")
    
    # Check provider_lp_ata
    info = await client.get_account_info(str(provider_lp_ata))
    if not info:
        print(f"   Creating provider LP ATA: {provider_lp_ata}")
        ixs.append(create_associated_token_account(payer.pubkey(), payer.pubkey(), lp_mint))
    else:
        print(f"   Provider LP ATA already exists")
    
    if not ixs:
        return True
    
    message = Message(ixs)
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
    sig = await client.send_transaction(tx)
    if sig:
        return await client.confirm_transaction(sig)
    return False


async def add_liquidity(client, payer, amount):
    """Add liquidity to the protocol (creates treasury_base_ata if needed)"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    base_mint = Pubkey.from_string(BASE_MINT)
    lp_mint = Pubkey.from_string("BJtvd9JE3BTSg9Vgp46umX1Qq6GdF1YMiNxpYsnzTZfz")
    ATOKEN_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    treasury, _ = Pubkey.find_program_address([b"treasury"], program_id)
    pending_liquidity, _ = Pubkey.find_program_address(
        [b"pending", bytes(payer.pubkey())], program_id
    )
    
    treasury_base_ata = get_associated_token_address(treasury, base_mint)
    provider_base_ata = get_associated_token_address(payer.pubkey(), base_mint)
    provider_lp_ata = get_associated_token_address(payer.pubkey(), lp_mint)
    
    # Discriminator for add_liquidity
    data = bytes([181, 157, 89, 67, 143, 182, 52, 72])
    data += amount.to_bytes(8, "little")
    
    accounts = [
        {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
        {"pubkey": str(lp_mint), "isWritable": True, "isSigner": False},
        {"pubkey": str(treasury), "isWritable": False, "isSigner": False},
        {"pubkey": str(treasury_base_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(provider_base_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(provider_lp_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(base_mint), "isWritable": False, "isSigner": False},
        {"pubkey": str(pending_liquidity), "isWritable": True, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
        {"pubkey": str(TOKEN_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(ATOKEN_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
    ]
    
    ix = build_ix(program_id, data, accounts)
    
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
    sig = await client.send_transaction(tx)
    if sig:
        confirmed = await client.confirm_transaction(sig)
        return sig, confirmed
    return None, False


async def buy_shares(client, payer, market_id, outcome_id, num_shares, max_payment):
    """Buy outcome tokens (shares)"""
    program_id = Pubkey.from_string(PROGRAM_ID)
    base_mint = Pubkey.from_string(BASE_MINT)
    global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
    market_pda, _ = Pubkey.find_program_address([b"market", market_id.to_bytes(8, "little")], program_id)
    treasury, _ = Pubkey.find_program_address([b"treasury"], program_id)
    
    # Get outcome mint
    outcome_mint, _ = Pubkey.find_program_address(
        [b"outcome_mint", market_id.to_bytes(8, "little"), bytes([outcome_id])], 
        program_id
    )
    
    # Get associated token accounts (ATAs)
    buyer_base_ata = get_associated_token_address(payer.pubkey(), base_mint)
    treasury_base_ata = get_associated_token_address(treasury, base_mint)
    buyer_outcome_ata = get_associated_token_address(payer.pubkey(), outcome_mint)
    
    ATOKEN_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    
    # Discriminator for buy_shares from IDL
    data = bytes([40, 239, 138, 154, 8, 37, 106, 108])
    
    # Args: outcome_id (u8), num_shares (u64), max_payment (u64)
    args = bytes([outcome_id])
    args += num_shares.to_bytes(8, "little")
    args += max_payment.to_bytes(8, "little")
    
    data = data + args
    
    # Accounts in the correct order per IDL:
    # global_config, market, treasury, buyer_base_ata, treasury_base_ata,
    # buyer_outcome_ata, outcome_mint, base_mint, buyer, token_program,
    # associated_token_program, system_program
    accounts = [
        {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
        {"pubkey": str(market_pda), "isWritable": True, "isSigner": False},
        {"pubkey": str(treasury), "isWritable": False, "isSigner": False},
        {"pubkey": str(buyer_base_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(treasury_base_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(buyer_outcome_ata), "isWritable": True, "isSigner": False},
        {"pubkey": str(outcome_mint), "isWritable": True, "isSigner": False},
        {"pubkey": str(base_mint), "isWritable": False, "isSigner": False},
        {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
        {"pubkey": str(TOKEN_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(ATOKEN_PROGRAM), "isWritable": False, "isSigner": False},
        {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
    ]
    
    ix = build_ix(program_id, data, accounts)
    
    message = Message([ix])
    blockhash = await client.get_recent_blockhash()
    tx = Transaction([payer], message, blockhash)
    
    sig = await client.send_transaction(tx)
    if sig:
        confirmed = await client.confirm_transaction(sig)
        return sig, confirmed
    return None, False

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
    # GlobalConfig layout: next_market_id is at offset 194 (after admin+paused+oracle+mints+treasury+etc)
    next_market_id = int.from_bytes(data[194:202], "little")
    current_epoch = int.from_bytes(data[266:274], "little")
    print(f"   Current next_market_id: {next_market_id}")
    print(f"   Current epoch: {current_epoch}")
    print(f"   Admin: {Pubkey(data[8:40])}")
    
    # Initialize epoch if needed
    print(f"\n2. Initializing epoch {current_epoch}...")
    epoch_pda, success = await init_epoch(client, payer, current_epoch)
    if success:
        print(f"   ✅ Epoch ready: {epoch_pda}")
    else:
        print(f"   ❌ Failed to initialize epoch")
        return
    
    # Create treasury_base_ata if not exists (required before add_liquidity)
    print("\n3. Setting up treasury token account...")
    success = await create_treasury_ata(client, payer)
    if success:
        print(f"   ✅ Treasury ATA ready")
    else:
        print(f"   ⚠️  Treasury ATA setup failed, continuing...")
    
    # Add initial liquidity to bootstrap treasury_base_ata
    print("\n4. Adding initial liquidity...")
    initial_liquidity = 100_000_000_000  # 100,000 USDC (with 6 decimals)
    success = await add_liquidity(client, payer, initial_liquidity)
    if success:
        print(f"   ✅ Liquidity added: {initial_liquidity/1e6} USDC")
    else:
        print(f"   ⚠️  Liquidity may already exist, continuing...")
    
    # Create market group
    print("\n5. Creating market group...")
    group_id = 1
    event_start = int(time.time()) + (48 * 60 * 60)  # 48 hours from now
    title = "Arsenal vs Liverpool"
    max_exposure = 10_000_000_000  # 10 SOL worth
    
    group_pda, success = await create_market_group(client, payer, group_id, max_exposure, event_start, title)
    if success:
        print(f"   ✅ Market group created: {group_pda}")
    else:
        print(f"   ⚠️  Failed to create market group (may need admin keypair)")
        print(f"   Continuing without market group - markets will be standalone")
        group_pda = None
    
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
        print(f"\n4.{i+1}. Creating market: {mkt['title'][:40]}...")
        
        # Re-fetch fresh next_market_id; use the current_epoch we already initialized
        market_id = await get_next_market_id(client)
        mkt_pda, success = await create_market(
            client, payer, market_id, event_start,
            mkt["num_outcomes"], mkt["title"], mkt["description"],
            mkt["category"], mkt["q_values"], current_epoch
        )
        
        if success:
            print(f"   ✅ Market {market_id} created: {mkt_pda}")
            created_markets.append({"id": market_id, "pda": str(mkt_pda), **mkt})
            
            # Add to group (only if group was created)
            if group_pda is not None:
                print(f"   Adding to group (sets to PreOpen)...")
                success = await add_market_to_group(client, payer, group_id, i, mkt_pda)
                if success:
                    print(f"   ✅ Added to group")
                else:
                    print(f"   ⚠️  Failed to add to group (will continue)")
            
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
    
    # Seed and activate markets
    if created_markets:
        print("\n" + "=" * 60)
        print("SEEDING & ACTIVATING MARKETS")
        print("=" * 60)
        
        # Pre-create outcome ATAs for all markets
        print("\nPre-creating outcome ATAs for all markets...")
        for mkt in created_markets:
            success = await create_outcome_atas(client, payer, mkt["id"], mkt["num_outcomes"])
            if success:
                print(f"  ✅ Market {mkt['id']} outcome ATAs ready")
            else:
                print(f"  ⚠️  Market {mkt['id']} ATA setup failed")
        
        # Minimum seed amount per outcome: 500 USDC = 500_000_000 lamports
        seed_amount = 500_000_000
        
        for mkt_idx, mkt in enumerate(created_markets):
            market_id = mkt["id"]
            num_outcomes = mkt["num_outcomes"]
            print(f"\nSeeding market {market_id} ({num_outcomes} outcomes)...")
            
            seeded_all = True
            for outcome_id in range(num_outcomes):
                print(f"  Seeding outcome {outcome_id} with {seed_amount/1e6} USDC...")
                success = await register_seed_position(
                    client, payer, group_id, market_id, mkt_idx, outcome_id, seed_amount
                )
                if success:
                    print(f"  ✅ Outcome {outcome_id} seeded")
                else:
                    print(f"  ❌ Outcome {outcome_id} seeding failed")
                    seeded_all = False
            
            if seeded_all:
                print(f"\n  Activating market {market_id}...")
                success = await activate_seeded_market(client, payer, group_id, market_id)
                if success:
                    print(f"  ✅ Market {market_id} is now OPEN for trading")
                else:
                    print(f"  ❌ Failed to activate market {market_id}")
    
    # Example: Buy some shares on first market
    if created_markets:
        print("\n" + "=" * 60)
        print("EXAMPLE: Buying shares on first market...")
        print("=" * 60)
        
        first_market = created_markets[0]
        market_id = first_market["id"]
        
        # Buy 1000000 shares of outcome 0 (home team)
        print(f"\nBuying 1,000,000 shares of outcome 0 on market {market_id}...")
        num_shares = 1_000_000  # 1 USDC worth (1e6 lamports)
        max_payment = 2_000_000  # Allow up to 2 USDC payment
        
        sig, success = await buy_shares(client, payer, market_id, 0, num_shares, max_payment)
        if success:
            print(f"✅ Bought shares! Signature: {sig}")
        else:
            print(f"❌ Failed to buy shares")
        
        # Try outcome 1 (away team)
        print(f"\nBuying 1,000,000 shares of outcome 1 on market {market_id}...")
        sig, success = await buy_shares(client, payer, market_id, 1, num_shares, max_payment)
        if success:
            print(f"✅ Bought shares! Signature: {sig}")
        else:
            print(f"❌ Failed to buy shares")

if __name__ == "__main__":
    asyncio.run(main())

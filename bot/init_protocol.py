#!/usr/bin/env python3
"""
Initialize the Quadratic Market protocol on devnet.
"""

import asyncio
import json
import base64
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.hash import Hash
from solders.transaction import Transaction
from solders.message import Message
from solders.instruction import AccountMeta, Instruction
import httpx

RPC_URL = "https://api.devnet.solana.com"
PROGRAM_ID = "3MsEuMziRKjA1w1WTPeW5NvDUCjGoep2QZ5zBthGq23Z"
OPERATOR_PATH = "/tmp/devnet_wallet.json"
BASE_MINT = "4zJfNn9Vc3sQWGw8qCH8QM8E6P8uFTvCg4k6Ps4R1uA"

SYSTEM_PROGRAM = Pubkey.from_string("11111111111111111111111111111111")
TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
RENT_SYSVAR = Pubkey.from_string("SysvarRent111111111111111111111111111111111")

def load_keypair(path):
    with open(path) as f:
        return Keypair.from_bytes(bytes(json.load(f)))

async def fetch(client, method, params=None):
    resp = await client.post(RPC_URL, json={
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params or []
    })
    return resp.json()

async def get_account_info(client, pubkey):
    result = await fetch(client, "getAccountInfo", [str(pubkey), {"encoding": "base64"}])
    if result.get("result", {}).get("value"):
        return result["result"]["value"]
    return None

async def get_recent_blockhash(client):
    result = await fetch(client, "getLatestBlockhash", [])
    return Hash.from_string(result["result"]["value"]["blockhash"])

async def send_tx(client, tx):
    resp = await client.post(RPC_URL, json={
        "jsonrpc": "2.0", "id": 1, "method": "sendTransaction",
        "params": [base64.b64encode(bytes(tx)).decode(), {"skipPreflight": False, "preflightCommitment": "confirmed"}]
    })
    return resp.json().get("result")

async def confirm_tx(client, sig):
    for _ in range(60):
        await asyncio.sleep(0.5)
        result = await fetch(client, "getSignatureStatuses", [[sig]])
        if result.get("result", {}).get("value"):
            status = result["result"]["value"][0]
            if status and status.get("confirmationStatus") in ["confirmed", "finalized"]:
                return True
            if status and status.get("err"):
                print(f"   Error: {status['err']}")
                return False
    return False

def build_ix(program_id, data, accounts):
    return Instruction(
        program_id=program_id,
        accounts=[AccountMeta(pubkey=Pubkey.from_string(acc["pubkey"]), is_signer=acc.get("isSigner", False), is_writable=acc.get("isWritable", False)) for acc in accounts],
        data=data
    )

async def main():
    print("=" * 60)
    print("Initializing Quadratic Market Protocol")
    print("=" * 60)
    
    payer = load_keypair(OPERATOR_PATH)
    async with httpx.AsyncClient(timeout=60) as client:
        print(f"\nOperator: {payer.pubkey()}")
        
        result = await fetch(client, "getBalance", [str(payer.pubkey())])
        print(f"Balance: {result['result']['value'] / 1e9:.4f} SOL")
        
        program_id = Pubkey.from_string(PROGRAM_ID)
        base_mint = Pubkey.from_string(BASE_MINT)
        
        global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
        lp_mint, _ = Pubkey.find_program_address([b"lp_mint"], program_id)
        treasury, _ = Pubkey.find_program_address([b"treasury"], program_id)
        epoch_pda, _ = Pubkey.find_program_address([b"epoch", (0).to_bytes(8, "little")], program_id)
        
        print(f"\nPDAs:")
        print(f"  GlobalConfig: {global_config}")
        print(f"  LP Mint: {lp_mint}")
        print(f"  Treasury: {treasury}")
        print(f"  Epoch 0: {epoch_pda}")
        
        print("\n1. Checking existing accounts...")
        gc_info = await get_account_info(client, global_config)
        
        if gc_info:
            data_bytes = base64.b64decode(gc_info['data'][0])
            admin = Pubkey(data_bytes[8:40])
            print(f"   ⚠️  GlobalConfig exists! Admin: {admin}")
            print(f"   Is our wallet admin? {admin == payer.pubkey()}")
        else:
            print("   GlobalConfig not found - will create")
        
        oracle_pubkey = bytes(payer.pubkey())
        max_exposure = 10_000_000_000
        
        data = bytes([175, 175, 109, 31, 13, 152, 155, 237]) + oracle_pubkey + max_exposure.to_bytes(8, "little")
        
        accounts = [
            {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
            {"pubkey": str(lp_mint), "isWritable": True, "isSigner": False},
            {"pubkey": str(treasury), "isWritable": False, "isSigner": False},
            {"pubkey": str(base_mint), "isWritable": False, "isSigner": False},
            {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
            {"pubkey": str(TOKEN_PROGRAM), "isWritable": False, "isSigner": False},
            {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
            {"pubkey": str(RENT_SYSVAR), "isWritable": False, "isSigner": False},
        ]
        
        ix = build_ix(program_id, data, accounts)
        
        print("\n2. Sending initialize transaction...")
        
        blockhash = await get_recent_blockhash(client)
        
        message = Message([ix])
        tx = Transaction([payer], message, blockhash)
        
        sig = await send_tx(client, tx)
        if sig:
            print(f"   TX sent: {sig}")
            if await confirm_tx(client, sig):
                print("   ✅ Initialize confirmed!")
                
                print("\n3. Initializing epoch...")
                epoch_data = bytes([36, 168, 248, 56, 195, 19, 235, 62])
                epoch_accounts = [
                    {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
                    {"pubkey": str(epoch_pda), "isWritable": True, "isSigner": False},
                    {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
                    {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
                ]
                
                ix2 = build_ix(program_id, epoch_data, epoch_accounts)
                blockhash2 = await get_recent_blockhash(client)
                message2 = Message([ix2])
                tx2 = Transaction([payer], message2, blockhash2)
                
                sig2 = await send_tx(client, tx2)
                if sig2:
                    print(f"   TX sent: {sig2}")
                    if await confirm_tx(client, sig2):
                        print("   ✅ Epoch initialized!")
                
                print("\n4. Verifying...")
                gc_info = await get_account_info(client, global_config)
                if gc_info:
                    print("   ✅ GlobalConfig verified!")
                epoch_info = await get_account_info(client, epoch_pda)
                if epoch_info:
                    print("   ✅ Epoch 0 verified!")
            else:
                print("   ❌ Transaction not confirmed")
        else:
            print("   ❌ Failed to send transaction")

asyncio.run(main())

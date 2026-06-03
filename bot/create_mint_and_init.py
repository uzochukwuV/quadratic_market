#!/usr/bin/env python3
"""Create a new mint and use it to initialize the protocol."""

import asyncio
import json
import base58
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.hash import Hash
from solders.transaction import Transaction
from solders.message import Message
from solders.instruction import AccountMeta, Instruction
from solders.system_program import create_account, CreateAccountParams
from spl.token.instructions import initialize_mint, InitializeMintParams
import httpx

RPC_URL = "https://api.devnet.solana.com"
OPERATOR_PATH = "/tmp/devnet_wallet.json"
PROGRAM_ID = "3MsEuMziRKjA1w1WTPeW5NvDUCjGoep2QZ5zBthGq23Z"

SYSTEM_PROGRAM = Pubkey.from_string("11111111111111111111111111111111")
TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
RENT_SYSVAR = Pubkey.from_string("SysvarRent111111111111111111111111111111111")

def load_keypair(path):
    with open(path) as f:
        return Keypair.from_bytes(bytes(json.load(f)))

async def get_blockhash(client):
    resp = await client.post(RPC_URL, json={"jsonrpc": "2.0", "id": 1, "method": "getLatestBlockhash", "params": []})
    return Hash.from_string(resp.json()["result"]["value"]["blockhash"])

async def get_rent_exemption(client, space):
    resp = await client.post(RPC_URL, json={"jsonrpc": "2.0", "id": 1, "method": "getMinimumBalanceForRentExemption", "params": [space]})
    return resp.json()["result"]

async def send_and_confirm(client, tx, signers):
    tx_bytes = bytes(tx)
    b58_encoded = base58.b58encode(tx_bytes).decode()
    
    resp = await client.post(RPC_URL, json={
        "jsonrpc": "2.0", "id": 1, "method": "sendTransaction",
        "params": [b58_encoded, {"skipPreflight": False, "preflightCommitment": "confirmed"}]
    })
    result = resp.json()
    
    if "result" not in result:
        print(f"Send error: {result}")
        return None
    
    sig = result["result"]
    print(f"   TX sent: {sig}")
    
    for _ in range(30):
        await asyncio.sleep(0.5)
        resp = await client.post(RPC_URL, json={"jsonrpc": "2.0", "id": 1, "method": "getSignatureStatuses", "params": [[sig]]})
        status = resp.json()["result"]["value"][0]
        if status and status.get("confirmationStatus") in ["confirmed", "finalized"]:
            return sig
        if status and status.get("err"):
            print(f"   Error: {status['err']}")
            return None
    return sig

async def main():
    print("=" * 60)
    print("Creating Protocol Mint and Initializing Protocol")
    print("=" * 60)
    
    payer = load_keypair(OPERATOR_PATH)
    async with httpx.AsyncClient(timeout=60) as client:
        print(f"\nOperator: {payer.pubkey()}")
        
        resp = await client.post(RPC_URL, json={"jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [str(payer.pubkey())]})
        print(f"Balance: {resp.json()['result']['value'] / 1e9:.4f} SOL")
        
        mint_kp = Keypair()
        print(f"\n1. Creating new mint: {mint_kp.pubkey()}")
        
        mint_rent = await get_rent_exemption(client, 82)
        blockhash = await get_blockhash(client)
        
        init_mint_ix = initialize_mint(InitializeMintParams(
            mint=mint_kp.pubkey(),
            decimals=6,
            mint_authority=payer.pubkey(),
            freeze_authority=None,
            program_id=TOKEN_PROGRAM,
        ))
        
        create_ix = create_account(CreateAccountParams(
            from_pubkey=payer.pubkey(),
            to_pubkey=mint_kp.pubkey(),
            lamports=mint_rent,
            space=82,
            owner=TOKEN_PROGRAM,
        ))
        
        message = Message([create_ix, init_mint_ix])
        tx = Transaction([payer, mint_kp], message, blockhash)
        
        sig = await send_and_confirm(client, tx, [payer, mint_kp])
        if sig:
            print(f"   ✅ Mint created!")
            base_mint = str(mint_kp.pubkey())
            
            print(f"\n2. Initializing protocol with mint: {base_mint}")
            
            program_id = Pubkey.from_string(PROGRAM_ID)
            global_config, _ = Pubkey.find_program_address([b"global_config"], program_id)
            lp_mint, _ = Pubkey.find_program_address([b"lp_mint"], program_id)
            treasury, _ = Pubkey.find_program_address([b"treasury"], program_id)
            
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [str(global_config), {"encoding": "base64"}]
            })
            if resp.json().get("result", {}).get("value"):
                print("   ⚠️  GlobalConfig already exists!")
                print(f"\n   Base mint: {base_mint}")
                return
            
            oracle_pubkey = bytes(payer.pubkey())
            max_exposure = 10_000_000_000
            
            init_data = bytes([175, 175, 109, 31, 13, 152, 155, 237]) + oracle_pubkey + max_exposure.to_bytes(8, "little")
            
            init_accounts = [
                {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
                {"pubkey": str(lp_mint), "isWritable": True, "isSigner": False},
                {"pubkey": str(treasury), "isWritable": False, "isSigner": False},
                {"pubkey": base_mint, "isWritable": False, "isSigner": False},
                {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
                {"pubkey": str(TOKEN_PROGRAM), "isWritable": False, "isSigner": False},
                {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
                {"pubkey": str(RENT_SYSVAR), "isWritable": False, "isSigner": False},
            ]
            
            init_ix = Instruction(
                program_id=program_id,
                accounts=[AccountMeta(pubkey=Pubkey.from_string(acc["pubkey"]), is_signer=acc.get("isSigner", False), is_writable=acc.get("isWritable", False)) for acc in init_accounts],
                data=init_data
            )
            
            blockhash = await get_blockhash(client)
            message = Message([init_ix])
            tx = Transaction([payer], message, blockhash)
            
            sig = await send_and_confirm(client, tx, [payer])
            if sig:
                print("   ✅ Protocol initialized!")
                
                print("\n3. Initializing epoch...")
                epoch_pda, _ = Pubkey.find_program_address([b"epoch", (0).to_bytes(8, "little")], program_id)
                
                epoch_data = bytes([36, 168, 248, 56, 195, 19, 235, 62])
                epoch_accounts = [
                    {"pubkey": str(global_config), "isWritable": True, "isSigner": False},
                    {"pubkey": str(epoch_pda), "isWritable": True, "isSigner": False},
                    {"pubkey": str(payer.pubkey()), "isWritable": True, "isSigner": True},
                    {"pubkey": str(SYSTEM_PROGRAM), "isWritable": False, "isSigner": False},
                ]
                
                epoch_ix = Instruction(
                    program_id=program_id,
                    accounts=[AccountMeta(pubkey=Pubkey.from_string(acc["pubkey"]), is_signer=acc.get("isSigner", False), is_writable=acc.get("isWritable", False)) for acc in epoch_accounts],
                    data=epoch_data
                )
                
                blockhash = await get_blockhash(client)
                message = Message([epoch_ix])
                tx = Transaction([payer], message, blockhash)
                
                sig = await send_and_confirm(client, tx, [payer])
                if sig:
                    print("   ✅ Epoch initialized!")
                
                print("\n4. Verification...")
                resp = await client.post(RPC_URL, json={
                    "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                    "params": [str(global_config), {"encoding": "base64"}]
                })
                if resp.json().get("result", {}).get("value"):
                    print("   ✅ GlobalConfig verified!")
                
                resp = await client.post(RPC_URL, json={
                    "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                    "params": [str(epoch_pda), {"encoding": "base64"}]
                })
                if resp.json().get("result", {}).get("value"):
                    print("   ✅ Epoch 0 verified!")
                
                print(f"\n📝 Summary:")
                print(f"   Base Mint: {base_mint}")
                print(f"   LP Mint PDA: {lp_mint}")
                print(f"   Treasury PDA: {treasury}")
                print(f"   GlobalConfig PDA: {global_config}")

asyncio.run(main())

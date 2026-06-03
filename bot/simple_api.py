"""Quadratic Market API - On-chain data queries for devnet deployment.

Supports:
- Global config (admin, mints, epoch info)
- Markets (list and details with q_values)
- Epoch/LP info (current epoch, LP state)
- User bets (BetSlip accounts for a given user)

Usage:
    python simple_api.py
Runs on port 12000 by default.
"""

from fastapi import FastAPI, HTTPException, Query
import uvicorn
import base64
from solders.pubkey import Pubkey
import httpx

app = FastAPI(title="Quadratic Market API", version="1.0.0")

# Configuration
PROGRAM_ID = "3MsEuMziRKjA1w1WTPeW5NvDUCjGoep2QZ5zBthGq23Z"
RPC_URL = "https://api.devnet.solana.com"

def get_pdas(program_id: str):
    pid = Pubkey.from_string(program_id)
    global_config, _ = Pubkey.find_program_address([b"global_config"], pid)
    epoch_pda = lambda e: Pubkey.find_program_address([b"epoch", e.to_bytes(8, "little")], pid)[0]
    market_pda = lambda m: Pubkey.find_program_address([b"market", m.to_bytes(8, "little")], pid)[0]
    return {
        "global_config": str(global_config),
        "lp_mint": str(Pubkey.find_program_address([b"lp_mint"], pid)[0]),
        "epoch": lambda e: str(epoch_pda(e)),
        "market": lambda m: str(market_pda(m)),
    }

@app.get("/")
async def root():
    return {
        "name": "Quadratic Market API",
        "version": "1.0.0",
        "program_id": PROGRAM_ID,
        "network": "devnet",
        "endpoints": [
            "/health", "/config", "/markets", "/markets/{id}",
            "/epochs", "/epochs/{id}", "/lp", 
            "/bets/{wallet}", "/orders/{wallet}"
        ]
    }

@app.get("/health")
async def health():
    try:
        pdas = get_pdas(PROGRAM_ID)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [pdas["global_config"], {"encoding": "base64"}]
            })
            if resp.json().get("result", {}).get("value"):
                return {"status": "healthy", "synced": True}
        return {"status": "unhealthy", "synced": False}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}

@app.get("/config")
async def get_config():
    try:
        pdas = get_pdas(PROGRAM_ID)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [pdas["global_config"], {"encoding": "base64"}]
            })
            result = resp.json()
            
            if result.get("result", {}).get("value"):
                data = base64.b64decode(result["result"]["value"]["data"][0])
                return {
                    "global_config": pdas["global_config"],
                    "admin": str(Pubkey(data[8:40])),
                    "next_market_id": int.from_bytes(data[194:202], "little"),
                    "current_epoch": int.from_bytes(data[266:274], "little"),
                    "lp_mint": str(Pubkey(data[97:129])),
                    "base_mint": str(Pubkey(data[129:161])),
                    "treasury": str(Pubkey(data[161:193])),
                    "total_lp_supply": int.from_bytes(data[290:298], "little"),
                    "locked_payouts": int.from_bytes(data[210:218], "little"),
                    "max_market_exposure": int.from_bytes(data[218:226], "little"),
                }
        raise HTTPException(status_code=404, detail="GlobalConfig not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/epochs")
async def list_epochs():
    """List epochs with LP information."""
    try:
        pdas = get_pdas(PROGRAM_ID)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [pdas["global_config"], {"encoding": "base64"}]
            })
            result = resp.json()
            
            if not result.get("result", {}).get("value"):
                return {"epochs": [], "current_epoch": 0}
            
            data = base64.b64decode(result["result"]["value"]["data"][0])
            current_epoch = int.from_bytes(data[266:274], "little")
            
            epochs = []
            for eid in range(current_epoch + 1):
                epoch_pda = pdas["epoch"](eid)
                resp = await client.post(RPC_URL, json={
                    "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                    "params": [epoch_pda, {"encoding": "base64"}]
                })
                if resp.json().get("result", {}).get("value"):
                    epoch_data = base64.b64decode(resp.json()["result"]["value"]["data"][0])
                    epochs.append({
                        "epoch_id": eid,
                        "started_at": int.from_bytes(epoch_data[16:24], "little"),
                        "ended_at": int.from_bytes(epoch_data[24:32], "little") if epoch_data[24:32] != b'\x00' * 8 else None,
                        "total_exposure": int.from_bytes(epoch_data[32:40], "little"),
                        "market_count": int.from_bytes(epoch_data[40:44], "little"),
                        "settled_count": int.from_bytes(epoch_data[44:48], "little"),
                        "is_active": eid == current_epoch,
                    })
            
            return {"epochs": epochs, "current_epoch": current_epoch}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/epochs/{epoch_id}")
async def get_epoch(epoch_id: int):
    """Get detailed epoch information."""
    try:
        pdas = get_pdas(PROGRAM_ID)
        epoch_pda = pdas["epoch"](epoch_id)
        
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [epoch_pda, {"encoding": "base64"}]
            })
            result = resp.json()
            
            if not result.get("result", {}).get("value"):
                raise HTTPException(status_code=404, detail=f"Epoch {epoch_id} not found")
            
            data = base64.b64decode(result["result"]["value"]["data"][0])
            return {
                "epoch_id": epoch_id,
                "started_at": int.from_bytes(data[16:24], "little"),
                "ended_at": int.from_bytes(data[24:32], "little") if data[24:32] != b'\x00' * 8 else None,
                "total_exposure": int.from_bytes(data[32:40], "little"),
                "market_count": int.from_bytes(data[40:44], "little"),
                "settled_count": int.from_bytes(data[44:48], "little"),
                "pda": epoch_pda,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/lp")
async def get_lp_info():
    """Get LP (Liquidity Provider) state info."""
    try:
        pdas = get_pdas(PROGRAM_ID)
        async with httpx.AsyncClient(timeout=10) as client:
            # Get GlobalConfig for LP state
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [pdas["global_config"], {"encoding": "base64"}]
            })
            result = resp.json()
            
            if not result.get("result", {}).get("value"):
                raise HTTPException(status_code=404, detail="GlobalConfig not found")
            
            data = base64.b64decode(result["result"]["value"]["data"][0])
            current_epoch = int.from_bytes(data[266:274], "little")
            total_lp_supply = int.from_bytes(data[290:298], "little")
            locked_payouts = int.from_bytes(data[210:218], "little")
            lp_mint = str(Pubkey(data[97:129]))
            
            return {
                "lp_mint": lp_mint,
                "total_lp_supply": total_lp_supply,
                "locked_payouts": locked_payouts,
                "current_epoch": current_epoch,
                "epoch_duration_seconds": 86400,  # Default, should be in config
                "withdrawal_cooldown_seconds": 0,  # Default
                "note": "LP deposit/withdraw is epoch-based to prevent manipulation"
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/markets")
async def list_markets():
    try:
        pdas = get_pdas(PROGRAM_ID)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [pdas["global_config"], {"encoding": "base64"}]
            })
            result = resp.json()
            
            if not result.get("result", {}).get("value"):
                return {"markets": [], "total": 0}
            
            data = base64.b64decode(result["result"]["value"]["data"][0])
            next_market_id = int.from_bytes(data[194:202], "little")
            
            markets = []
            for mid in range(1, next_market_id):
                mkt_pda = pdas["market"](mid)
                resp = await client.post(RPC_URL, json={
                    "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                    "params": [mkt_pda, {"encoding": "base64"}]
                })
                if resp.json().get("result", {}).get("value"):
                    mkt_data = base64.b64decode(resp.json()["result"]["value"]["data"][0])
                    title_len = int.from_bytes(mkt_data[403:407], "little")
                    title = mkt_data[407:407+title_len].decode("utf-8", errors="ignore")
                    status_byte = mkt_data[56]
                    statuses = ["PreOpen", "Open", "Settled", "Voided", "Paused"]
                    status = statuses[status_byte] if status_byte < len(statuses) else "Unknown"
                    markets.append({
                        "id": mid,
                        "title": title,
                        "status": status,
                        "num_outcomes": mkt_data[57],
                        "pda": str(mkt_pda)
                    })
            
            return {"markets": markets, "total": len(markets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/markets/{market_id}")
async def get_market(market_id: int):
    try:
        pdas = get_pdas(PROGRAM_ID)
        mkt_pda = pdas["market"](market_id)
        
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [mkt_pda, {"encoding": "base64"}]
            })
            result = resp.json()
            
            if not result.get("result", {}).get("value"):
                raise HTTPException(status_code=404, detail=f"Market {market_id} not found")
            
            mkt_data = base64.b64decode(result["result"]["value"]["data"][0])
            
            market_id_bytes = int.from_bytes(mkt_data[8:16], "little")
            creator = str(Pubkey(mkt_data[16:48]))
            start_time = int.from_bytes(mkt_data[48:56], "little")
            status_byte = mkt_data[56]
            num_outcomes = mkt_data[57]
            exposure = int.from_bytes(mkt_data[122:130], "little")
            lmsr_b = int.from_bytes(mkt_data[395:403], "little")
            
            title_len = int.from_bytes(mkt_data[403:407], "little")
            title = mkt_data[407:407+title_len].decode("utf-8", errors="ignore")
            
            desc_start = 407 + title_len + 4
            desc = mkt_data[desc_start:desc_start+30].decode("utf-8", errors="ignore").rstrip('\x00')
            
            statuses = ["PreOpen", "Open", "Settled", "Voided", "Paused"]
            status = statuses[status_byte] if status_byte < len(statuses) else "Unknown"
            
            q_values = []
            for i in range(num_outcomes):
                q = int.from_bytes(mkt_data[58 + i*8:66 + i*8], "little")
                q_values.append(q)
            
            outcome_mints = []
            for i in range(num_outcomes):
                mint = str(Pubkey(mkt_data[139 + i*32:171 + i*32]))
                outcome_mints.append(mint)
            
            # Calculate prices from q_values
            total_q = sum(q_values) if sum(q_values) > 0 else 1
            prices = []
            for i in range(num_outcomes):
                prob = q_values[i] / total_q
                decimal = 1 / prob if prob > 0 else 0
                prices.append({
                    "outcome_id": i,
                    "decimal_odds": round(decimal, 2),
                    "implied_probability": round(prob, 4),
                    "q_value": q_values[i],
                })
            
            return {
                "market_id": market_id_bytes,
                "creator": creator,
                "title": title,
                "description": desc,
                "status": status,
                "num_outcomes": num_outcomes,
                "start_time": start_time,
                "exposure": exposure,
                "lmsr_b": lmsr_b,
                "q_values": q_values,
                "prices": prices,
                "outcome_mints": outcome_mints,
                "category": mkt_data[817] if len(mkt_data) > 817 else 0,
                "pda": str(mkt_pda)
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/bets/{wallet}")
async def get_user_bets(wallet: str):
    """Get all bet slips for a given wallet address.
    Note: Requires indexing service to track user bets as Solana doesn't support direct queries by owner.
    """
    try:
        # Validate wallet address
        try:
            wallet_pubkey = Pubkey.from_string(wallet)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid wallet address")
        
        pdas = get_pdas(PROGRAM_ID)
        
        async with httpx.AsyncClient(timeout=10) as client:
            # Get GlobalConfig for next_slip_id
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [pdas["global_config"], {"encoding": "base64"}]
            })
            result = resp.json()
            
            if not result.get("result", {}).get("value"):
                return {"bets": [], "total": 0}
            
            data = base64.b64decode(result["result"]["value"]["data"][0])
            next_slip_id = int.from_bytes(data[202:210], "little")
            
            # Search for bet slips (BetSlip PDAs are at [bet_slip, slip_id.to_le_bytes()])
            # Since we can't query by owner, we'll need to scan all slip IDs
            # This is a simplified approach - in production, use an indexer
            bets = []
            
            # Scan first 100 slips (in production, use event/indexer)
            for slip_id in range(1, min(next_slip_id, 100)):
                slip_pda, _ = Pubkey.find_program_address(
                    [b"bet_slip", slip_id.to_bytes(8, "little")],
                    Pubkey.from_string(PROGRAM_ID)
                )
                resp = await client.post(RPC_URL, json={
                    "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                    "params": [str(slip_pda), {"encoding": "base64"}]
                })
                if resp.json().get("result", {}).get("value"):
                    slip_data = base64.b64decode(resp.json()["result"]["value"]["data"][0])
                    # BetSlip: creator(32), num_legs(1), ... 
                    creator = str(Pubkey(slip_data[8:40]))
                    if creator == wallet:
                        num_legs = slip_data[40]
                        status = ["Active", "Won", "Lost", "Claimed"][slip_data[41]] if slip_data[41] < 4 else "Unknown"
                        stake = int.from_bytes(slip_data[42:50], "little")
                        locked_amount = int.from_bytes(slip_data[50:58], "little")
                        bets.append({
                            "slip_id": slip_id,
                            "status": status,
                            "num_legs": num_legs,
                            "stake": stake,
                            "locked_amount": locked_amount,
                            "pda": str(slip_pda)
                        })
            
            return {"bets": bets, "total": len(bets), "wallet": wallet}
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/orders/{wallet}")
async def get_user_orders(wallet: str):
    """Get all limit orders for a given wallet address.
    Note: This requires an indexer as Solana doesn't support direct queries by owner.
    """
    try:
        try:
            wallet_pubkey = Pubkey.from_string(wallet)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid wallet address")
        
        pdas = get_pdas(PROGRAM_ID)
        
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [pdas["global_config"], {"encoding": "base64"}]
            })
            result = resp.json()
            
            if not result.get("result", {}).get("value"):
                return {"orders": [], "total": 0}
            
            data = base64.b64decode(result["result"]["value"]["data"][0])
            next_order_id = int.from_bytes(data[210:218], "little")
            
            orders = []
            # Scan first 100 orders
            for order_id in range(1, min(next_order_id, 100)):
                order_pda, _ = Pubkey.find_program_address(
                    [b"order", order_id.to_bytes(8, "little")],
                    Pubkey.from_string(PROGRAM_ID)
                )
                resp = await client.post(RPC_URL, json={
                    "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                    "params": [str(order_pda), {"encoding": "base64"}]
                })
                if resp.json().get("result", {}).get("value"):
                    order_data = base64.b64decode(resp.json()["result"]["value"]["data"][0])
                    creator = str(Pubkey(order_data[8:40]))
                    if creator == wallet:
                        side = ["Buy", "Sell"][order_data[40]] if order_data[40] < 2 else "Unknown"
                        price = int.from_bytes(order_data[41:49], "little")
                        num_shares = int.from_bytes(order_data[49:57], "little")
                        filled = order_data[57] == 1
                        orders.append({
                            "order_id": order_id,
                            "side": side,
                            "price_per_share": price,
                            "num_shares": num_shares,
                            "filled": filled,
                            "pda": str(order_pda)
                        })
            
            return {"orders": orders, "total": len(orders), "wallet": wallet}
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=12000)
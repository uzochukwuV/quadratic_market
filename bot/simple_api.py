"""Simple API to query the devnet blockchain data without anchorpy IDL."""

from fastapi import FastAPI, HTTPException
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
    return {"global_config": str(global_config)}

@app.get("/")
async def root():
    return {
        "name": "Quadratic Market API",
        "version": "1.0.0",
        "program_id": PROGRAM_ID,
        "endpoints": ["/health", "/config", "/markets", "/markets/{id}"]
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
                }
        raise HTTPException(status_code=404, detail="GlobalConfig not found")
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
            pid = Pubkey.from_string(PROGRAM_ID)
            for mid in range(1, next_market_id):
                mkt_pda, _ = Pubkey.find_program_address([b"market", mid.to_bytes(8, "little")], pid)
                resp = await client.post(RPC_URL, json={
                    "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                    "params": [str(mkt_pda), {"encoding": "base64"}]
                })
                if resp.json().get("result", {}).get("value"):
                    mkt_data = base64.b64decode(resp.json()["result"]["value"]["data"][0])
                    # Title: 4-byte length at 403, starts at 407
                    title_len = int.from_bytes(mkt_data[403:407], "little")
                    title = mkt_data[407:407+title_len].decode("utf-8", errors="ignore")
                    status_byte = mkt_data[56]
                    statuses = ["PreOpen", "Open", "Settled", "Voided", "Paused"]
                    status = statuses[status_byte] if status_byte < len(statuses) else "Unknown"
                    markets.append({
                        "id": mid,
                        "title": title,
                        "status": status,
                        "pda": str(mkt_pda)
                    })
            
            return {"markets": markets, "total": len(markets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/markets/{market_id}")
async def get_market(market_id: int):
    try:
        pid = Pubkey.from_string(PROGRAM_ID)
        mkt_pda, _ = Pubkey.find_program_address([b"market", market_id.to_bytes(8, "little")], pid)
        
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(RPC_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                "params": [str(mkt_pda), {"encoding": "base64"}]
            })
            result = resp.json()
            
            if not result.get("result", {}).get("value"):
                raise HTTPException(status_code=404, detail=f"Market {market_id} not found")
            
            mkt_data = base64.b64decode(result["result"]["value"]["data"][0])
            
            # Market struct layout:
            # 0-7: discriminator (8)
            # 8-15: market_id (8)
            # 16-47: creator (32)
            # 48-55: start_time (8)
            # 56: status (1)
            # 57: num_outcomes (1)
            # 58-121: q_values[8] (64)
            # 122-129: exposure (8)
            # 130-137: settlement_time (8)
            # 138: winning_outcome (1)
            # 139-394: outcome_mints[8] (256)
            # 395-402: lmsr_b (8)
            # 403-406: title_len (4 bytes, little-endian = 35 for market 1)
            # 407+: title string
            # After title: separator bytes (0x1e, 0x00, 0x00, 0x00)
            # Then description length (4 bytes) + description
            
            market_id_bytes = int.from_bytes(mkt_data[8:16], "little")
            creator = str(Pubkey(mkt_data[16:48]))
            start_time = int.from_bytes(mkt_data[48:56], "little")
            status_byte = mkt_data[56]
            num_outcomes = mkt_data[57]
            exposure = int.from_bytes(mkt_data[122:130], "little")
            lmsr_b = int.from_bytes(mkt_data[395:403], "little")
            
            # Parse title - 4-byte length at 403, starts at 407
            title_len = int.from_bytes(mkt_data[403:407], "little")
            title = mkt_data[407:407+title_len].decode("utf-8", errors="ignore")
            
            # Parse description - after title there's separator 0x1e, 0x00, 0x00, 0x00
            # Then description starts directly (no length prefix for description in this contract)
            desc_start = 407 + title_len + 4  # Skip title + separator bytes
            desc = mkt_data[desc_start:desc_start+30].decode("utf-8", errors="ignore").rstrip('\x00')
            
            statuses = ["PreOpen", "Open", "Settled", "Voided", "Paused"]
            status = statuses[status_byte] if status_byte < len(statuses) else "Unknown"
            
            # Parse q_values
            q_values = []
            for i in range(num_outcomes):
                q = int.from_bytes(mkt_data[58 + i*8:66 + i*8], "little")
                q_values.append(q)
            
            # Parse outcome mints
            outcome_mints = []
            for i in range(num_outcomes):
                mint = str(Pubkey(mkt_data[139 + i*32:171 + i*32]))
                outcome_mints.append(mint)
            
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
                "outcome_mints": outcome_mints,
                "category": mkt_data[796],
                "pda": str(mkt_pda)
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=12000)
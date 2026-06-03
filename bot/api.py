"""
FastAPI server for public on-chain data queries.

All endpoints are READ-ONLY and don't require authentication.
Runs on port 8000 by default.

Usage:
    python api.py
    # or with custom port
    python api.py --port 8080
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

import structlog
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solana.rpc.async_api import AsyncClient
from anchorpy import Program, Provider, Wallet

import config
from chain import load_idl, load_keypair, global_config_pda, market_pda, epoch_pda

# ─── Logging ──────────────────────────────────────────────────────────────────

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(20),
)
log = structlog.get_logger(__name__)

# ─── Pydantic models ──────────────────────────────────────────────────────────

class MarketInfo(BaseModel):
    market_id: int
    title: str
    description: str
    status: str
    num_outcomes: int
    category: int
    start_time: int
    outcomes: list[dict] = Field(default_factory=list)
    q_values: list[int] = Field(default_factory=list)
    lmsr_b: int = 0
    exposure: int = 0
    winning_outcome: int | None = None
    group_id: int | None = None
    market_mode: str = "FixedOdds"

class GlobalConfigInfo(BaseModel):
    admin: str
    paused: bool
    epoch_paused: bool
    current_epoch: int
    next_market_id: int
    next_slip_id: int
    next_order_id: int
    lp_mint: str
    base_mint: str
    treasury: str
    locked_payouts: int
    order_collateral_locked: int
    total_lp_supply: int
    max_market_exposure: int
    lmsr_default_b: int
    slip_house_margin_bps: int
    max_slip_bonus_multiplier_bps: int
    buy_fee_bps: int
    cash_out_margin_bps: int
    challenge_window_seconds: int
    settlement_deadline_seconds: int
    epoch_duration_seconds: int
    withdrawal_cooldown_seconds: int

class EpochInfo(BaseModel):
    epoch_id: int
    total_exposure: int
    market_count: int
    settled_count: int
    active: bool
    started_at: int
    ended_at: int | None = None

class PriceInfo(BaseModel):
    outcome_id: int
    decimal_odds: float
    implied_probability: float
    q_value: int

class OrderBookEntry(BaseModel):
    order_id: int
    side: str
    price_per_share: int
    num_shares: int
    creator: str
    expires_at: int

# ─── API Server ────────────────────────────────────────────────────────────────

class OnChainAPI:
    """Wrapper for on-chain data access."""
    
    def __init__(self, program: Program, program_id: Pubkey) -> None:
        self.program = program
        self.program_id = program_id
        self.global_config, _ = global_config_pda(program_id)
    
    async def get_global_config(self) -> dict:
        return await self.program.account["GlobalConfig"].fetch(self.global_config)
    
    async def get_market(self, market_id: int) -> dict:
        pda, _ = market_pda(self.program_id, market_id)
        return await self.program.account["Market"].fetch(pda)
    
    async def get_epoch(self, epoch_id: int) -> dict:
        pda, _ = epoch_pda(self.program_id, epoch_id)
        return await self.program.account["Epoch"].fetch(pda)
    
    async def list_markets(
        self,
        status: str | None = None,
        category: int | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """
        List markets by querying on-chain state.
        Uses getProgramAccounts to find all Market accounts.
        """
        cfg = await self.get_global_config()
        next_market_id = int(cfg.next_market_id)
        
        markets = []
        for mid in range(offset, min(offset + limit, next_market_id)):
            try:
                market = await self.get_market(mid)
                # Apply filters
                if status and market.get("status", {}).name != status:
                    continue
                if category is not None and market.get("category") != category:
                    continue
                markets.append(market)
            except Exception:
                continue
        
        return markets
    
    async def get_market_prices(self, market_id: int) -> list[dict]:
        """Get current prices for all outcomes of a market."""
        market = await self.get_market(market_id)
        num_outcomes = int(market.num_outcomes)
        q_values = list(market.q_values)[:num_outcomes]
        
        # Calculate prices using LMSR formula
        # price = q_i / sum(q_j) for simple case
        total_q = sum(q_values) if sum(q_values) > 0 else 1
        
        prices = []
        for i in range(num_outcomes):
            # Implied probability from q_values
            prob = q_values[i] / total_q if total_q > 0 else 0
            # Convert to decimal odds (1/prob)
            decimal = 1 / prob if prob > 0 else 0
            
            prices.append({
                "outcome_id": i,
                "q_value": q_values[i],
                "implied_probability": prob,
                "decimal_odds": decimal,
            })
        
        return prices

# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Quadratic Market API",
    description="Public read-only API for querying on-chain market data",
    version="1.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
api_state: dict[str, Any] = {}


@app.on_event("startup")
async def startup():
    """Initialize the on-chain client."""
    IDL_PATH = Path(__file__).parent.parent / "target" / "idl" / "quadratic_market.json"
    
    if not IDL_PATH.exists():
        log.error("idl_not_found", path=str(IDL_PATH))
        raise RuntimeError("Run `anchor build` first to generate the IDL.")
    
    # Load operator keypair (read-only operations need a signer for some RPCs)
    try:
        operator_kp = load_keypair(config.OPERATOR_KEYPAIR_PATH)
    except Exception:
        # Create a dummy keypair if not available (for read-only RPC calls)
        operator_kp = Keypair.from_bytes(bytes(32))
    
    client = AsyncClient(config.RPC_URL)
    wallet = Wallet(operator_kp)
    provider = Provider(client, wallet)
    idl = load_idl(IDL_PATH)
    program = Program(idl, Pubkey.from_string(config.PROGRAM_ID), provider)
    
    api_state["api"] = OnChainAPI(program, program.program_id)
    log.info("api_server_started", program_id=config.PROGRAM_ID, rpc=config.RPC_URL)


@app.get("/")
async def root():
    """API information."""
    return {
        "name": "Quadratic Market API",
        "version": "1.0.0",
        "program_id": config.PROGRAM_ID,
        "endpoints": {
            "global_config": "/api/v1/config",
            "markets": "/api/v1/markets",
            "market": "/api/v1/markets/{market_id}",
            "market_prices": "/api/v1/markets/{market_id}/prices",
            "epochs": "/api/v1/epochs",
            "epoch": "/api/v1/epochs/{epoch_id}",
            "health": "/health",
        },
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        cfg = await api_state["api"].get_global_config()
        return {"status": "healthy", "synced": True}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}


# ─── Config Endpoints ─────────────────────────────────────────────────────────

@app.get("/api/v1/config", response_model=GlobalConfigInfo)
async def get_config():
    """Get global protocol configuration."""
    try:
        cfg = await api_state["api"].get_global_config()
        return GlobalConfigInfo(
            admin=str(cfg.admin),
            paused=cfg.paused,
            epoch_paused=cfg.epoch_paused,
            current_epoch=int(cfg.current_epoch),
            next_market_id=int(cfg.next_market_id),
            next_slip_id=int(cfg.next_slip_id),
            next_order_id=int(cfg.next_order_id),
            lp_mint=str(cfg.lp_mint),
            base_mint=str(cfg.base_mint),
            treasury=str(cfg.treasury),
            locked_payouts=int(cfg.locked_payouts),
            order_collateral_locked=int(cfg.order_collateral_locked),
            total_lp_supply=int(cfg.total_lp_supply),
            max_market_exposure=int(cfg.max_market_exposure),
            lmsr_default_b=int(cfg.lmsr_default_b),
            slip_house_margin_bps=int(cfg.slip_house_margin_bps),
            max_slip_bonus_multiplier_bps=int(cfg.max_slip_bonus_multiplier_bps),
            buy_fee_bps=int(cfg.buy_fee_bps),
            cash_out_margin_bps=int(cfg.cash_out_margin_bps),
            challenge_window_seconds=int(cfg.challenge_window_seconds),
            settlement_deadline_seconds=int(cfg.settlement_deadline_seconds),
            epoch_duration_seconds=int(cfg.epoch_duration_seconds),
            withdrawal_cooldown_seconds=int(cfg.withdrawal_cooldown_seconds),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Market Endpoints ─────────────────────────────────────────────────────────

@app.get("/api/v1/markets")
async def list_markets(
    status: str | None = Query(None, description="Filter by status: Open, Suspended, Settled, etc."),
    category: int | None = Query(None, description="Filter by market category"),
    limit: int = Query(50, ge=1, le=500, description="Max results to return"),
    offset: int = Query(0, ge=0, description="Skip first N markets"),
):
    """List all markets with optional filters."""
    try:
        cfg = await api_state["api"].get_global_config()
        next_id = int(cfg.next_market_id)
        
        markets = []
        for mid in range(offset, min(offset + limit, next_id)):
            try:
                m = await api_state["api"].get_market(mid)
                
                # Apply filters
                if status and m.status.name != status:
                    continue
                if category is not None and m.category != category:
                    continue
                
                num_outcomes = int(m.num_outcomes)
                q_vals = list(m.q_values)[:num_outcomes]
                
                market_info = {
                    "market_id": mid,
                    "title": m.title,
                    "description": m.description,
                    "status": m.status.name,
                    "num_outcomes": num_outcomes,
                    "category": int(m.category),
                    "start_time": int(m.start_time),
                    "q_values": q_vals,
                    "lmsr_b": int(m.lmsr_b),
                    "exposure": int(m.exposure),
                    "winning_outcome": int(m.winning_outcome) if m.winning_outcome else None,
                    "group_id": int(m.group_id) if m.group_id else None,
                    "market_mode": m.market_mode.name,
                }
                markets.append(market_info)
            except Exception:
                continue
        
        return {
            "markets": markets,
            "total": next_id,
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/markets/{market_id}", response_model=MarketInfo)
async def get_market(market_id: int):
    """Get detailed information for a specific market."""
    try:
        m = await api_state["api"].get_market(market_id)
        num_outcomes = int(m.num_outcomes)
        q_vals = list(m.q_values)[:num_outcomes]
        
        # Calculate prices
        total_q = sum(q_vals) if sum(q_vals) > 0 else 1
        outcomes = []
        for i in range(num_outcomes):
            prob = q_vals[i] / total_q if total_q > 0 else 0
            decimal = 1 / prob if prob > 0 else 0
            outcomes.append({
                "outcome_id": i,
                "decimal_odds": round(decimal, 2),
                "implied_probability": round(prob, 4),
            })
        
        return MarketInfo(
            market_id=market_id,
            title=m.title,
            description=m.description,
            status=m.status.name,
            num_outcomes=num_outcomes,
            category=int(m.category),
            start_time=int(m.start_time),
            outcomes=outcomes,
            q_values=q_vals,
            lmsr_b=int(m.lmsr_b),
            exposure=int(m.exposure),
            winning_outcome=int(m.winning_outcome) if m.winning_outcome else None,
            group_id=int(m.group_id) if m.group_id else None,
            market_mode=m.market_mode.name,
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Market not found: {e}")


@app.get("/api/v1/markets/{market_id}/prices")
async def get_market_prices(market_id: int):
    """Get current prices for all outcomes of a market."""
    try:
        prices = await api_state["api"].get_market_prices(market_id)
        return {"market_id": market_id, "prices": prices}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Market not found: {e}")


# ─── Epoch Endpoints ──────────────────────────────────────────────────────────

@app.get("/api/v1/epochs")
async def list_epochs(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List epochs."""
    try:
        cfg = await api_state["api"].get_global_config()
        current_epoch = int(cfg.current_epoch)
        
        epochs = []
        for eid in range(offset, min(offset + limit, current_epoch + 1)):
            try:
                epoch = await api_state["api"].get_epoch(eid)
                epochs.append({
                    "epoch_id": eid,
                    "total_exposure": int(epoch.total_exposure),
                    "market_count": int(epoch.market_count),
                    "settled_count": int(epoch.settled_count),
                    "active": eid == current_epoch,
                    "started_at": int(epoch.started_at),
                    "ended_at": int(epoch.ended_at) if epoch.ended_at else None,
                })
            except Exception:
                continue
        
        return {
            "epochs": epochs,
            "current_epoch": current_epoch,
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/epochs/{epoch_id}", response_model=EpochInfo)
async def get_epoch(epoch_id: int):
    """Get detailed information for a specific epoch."""
    try:
        epoch = await api_state["api"].get_epoch(epoch_id)
        cfg = await api_state["api"].get_global_config()
        current = int(cfg.current_epoch)
        
        return EpochInfo(
            epoch_id=epoch_id,
            total_exposure=int(epoch.total_exposure),
            market_count=int(epoch.market_count),
            settled_count=int(epoch.settled_count),
            active=epoch_id == current,
            started_at=int(epoch.started_at),
            ended_at=int(epoch.ended_at) if epoch.ended_at else None,
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Epoch not found: {e}")


# ─── Market Categories ────────────────────────────────────────────────────────

@app.get("/api/v1/categories")
async def list_categories():
    """List available market categories."""
    return {
        "categories": [
            {"id": 0, "name": "Match Result", "description": "Home/Draw/Away", "outcomes": 3},
            {"id": 1, "name": "Both Teams To Score", "description": "Yes/No", "outcomes": 2},
            {"id": 2, "name": "Over/Under", "description": "Over/Under goals", "outcomes": 2},
        ]
    }


# ─── Active Markets ───────────────────────────────────────────────────────────

@app.get("/api/v1/markets/active")
async def get_active_markets(
    limit: int = Query(50, ge=1, le=200),
):
    """Get all currently active (Open) markets."""
    return await list_markets(status="Open", limit=limit, offset=0)


@app.get("/api/v1/markets/upcoming")
async def get_upcoming_markets(
    limit: int = Query(50, ge=1, le=200),
    hours: int = Query(72, ge=1, le=168, description="Hours ahead to look"),
):
    """Get markets that will start within the specified hours."""
    import time
    now = int(time.time())
    cutoff = now + (hours * 3600)
    
    try:
        cfg = await api_state["api"].get_global_config()
        next_id = int(cfg.next_market_id)
        
        markets = []
        for mid in range(next_id):
            try:
                m = await api_state["api"].get_market(mid)
                start = int(m.start_time)
                
                if m.status.name == "PreOpen" and now < start < cutoff:
                    num_outcomes = int(m.num_outcomes)
                    q_vals = list(m.q_values)[:num_outcomes]
                    
                    markets.append({
                        "market_id": mid,
                        "title": m.title,
                        "description": m.description,
                        "status": m.status.name,
                        "num_outcomes": num_outcomes,
                        "category": int(m.category),
                        "start_time": start,
                        "q_values": q_vals,
                    })
            except Exception:
                continue
        
        markets.sort(key=lambda x: x["start_time"])
        return {"markets": markets[:limit], "total": len(markets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/markets/settled")
async def get_settled_markets(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Get settled markets."""
    return await list_markets(status="Settled", limit=limit, offset=offset)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Quadratic Market API server")
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to listen on (default: 8000)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Host to bind to (default: 0.0.0.0)",
    )
    args = parser.parse_args()
    
    import uvicorn
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
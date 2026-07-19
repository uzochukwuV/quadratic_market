"""
Txodds Market Bot for Quadratic Market Protocol.

This bot:
1. Creates market groups (1X2, O/U, GG/NG) for upcoming fixtures
2. Updates odds until match start
3. Suspends markets at match start
4. Settles markets with TxLINE proof
5. Executes slip legs (backend function)
6. Settles and resolves slips

Run continuously:
    python bot.py

Or run a single pass (useful for cron):
    python bot.py --once
"""

from __future__ import annotations

import asyncio
import sys
import time
import argparse
from pathlib import Path
from typing import List, Optional

import structlog
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
import uvicorn
from solders.pubkey import Pubkey
from fastapi.middleware.cors import CORSMiddleware

import config
from chain import ChainClient, load_keypair, market_pda
from txodds_api import (
    TxoddsApiClient, 
    Network, 
    NETWORK_CONFIG,
    TxoddsFixture,
    TxoddsResult,
    MarketType,
    derive_market_odds,
    odds_to_basis_points,
)
from state import BotState, TrackedMarket, TrackedMarketGroup, TrackedSlip, MarketStage, MarketType as StateMarketType

# ─── Logging ──────────────────────────────────────────────────────────────────

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(__import__("logging"), config.LOG_LEVEL, 20)
    ),
)
log = structlog.get_logger(__name__)

# Path to the compiled IDL (built by `anchor build`)
IDL_PATH = Path(
    config.IDL_PATH or Path(__file__).parent.parent / "target" / "idl" / "quadratic_market.json"
).expanduser()

app = FastAPI(title="Quadratic Market Bot API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
_runtime: "BotRuntime | None" = None


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


class BotRuntime:
    def __init__(self, chain: ChainClient, api: TxoddsApiClient, state: BotState) -> None:
        self.chain = chain
        self.api = api
        self.state = state


class MintBaseRequest(BaseModel):
    recipient: str = Field(..., description="Recipient wallet public key")
    amount: int = Field(..., gt=0, description="Amount in base mint units")


class MintBaseResponse(BaseModel):
    recipient: str
    recipient_ata: str
    amount: int
    signature: str


def set_runtime(runtime: BotRuntime) -> None:
    global _runtime
    _runtime = runtime


def get_runtime() -> BotRuntime:
    if _runtime is None:
        raise HTTPException(status_code=503, detail="Bot runtime is not initialized")
    return _runtime


def require_api_key(x_api_key: str | None) -> None:
    if config.BOT_API_KEY and x_api_key != config.BOT_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.post("/api/mint-base", response_model=MintBaseResponse)
async def mint_base(
    body: MintBaseRequest,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> MintBaseResponse:
    require_api_key(x_api_key)
    runtime = get_runtime()

    try:
        recipient = Pubkey.from_string(body.recipient)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid recipient public key") from exc

    try:
        signature, recipient_ata = await runtime.chain.mint_base_to(recipient, body.amount)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mint failed: {exc}") from exc

    return MintBaseResponse(
        recipient=body.recipient,
        recipient_ata=str(recipient_ata),
        amount=body.amount,
        signature=signature,
    )


@app.get("/api/slips/pending")
async def pending_slips(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> dict:
    require_api_key(x_api_key)
    runtime = get_runtime()
    slips = await runtime.chain.fetch_all_slips()
    pending = []

    for slip_id, slip in slips:
        status = _enum_name(slip.status).lower()
        if status not in {"pending", "active"}:
            continue
        num_legs = int(slip.num_legs)
        bought_mask = int(slip.legs_bought_mask)
        pending.append(
            {
                "slip_id": slip_id,
                "owner": str(slip.owner),
                "status": status,
                "num_legs": num_legs,
                "bought_mask": bought_mask,
                "unbought_legs": [
                    {
                        "leg_index": leg_index,
                        "market_id": int(slip.leg_market_ids[leg_index]),
                        "outcome_id": int(slip.leg_outcome_ids[leg_index]),
                    }
                    for leg_index in range(num_legs)
                    if not bought_mask & (1 << leg_index)
                ],
                "cancel_deadline": int(slip.cancel_deadline),
            }
        )

    return {"count": len(pending), "slips": pending}


@app.post("/api/slips/execute-pending")
async def execute_pending_slips(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> dict:
    require_api_key(x_api_key)
    runtime = get_runtime()
    return await task_execute_slip_legs(runtime.chain)


@app.get("/api/markets/by-epoch")
async def markets_by_epoch(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> dict:
    require_api_key(x_api_key)
    runtime = get_runtime()
    return await build_markets_by_epoch(runtime.chain, runtime.state)


async def run_api_server() -> uvicorn.Server:
    server_config = uvicorn.Config(
        app,
        host=config.BOT_API_HOST,
        port=config.BOT_API_PORT,
        log_level="info",
        lifespan="off",
    )
    server = uvicorn.Server(server_config)
    await server.serve()
    return server


# ─── Market Type Mapping ───────────────────────────────────────────────────

MARKET_TYPE_CONFIG = {
    "1x2": {
        "category": 0,
        "num_outcomes": 3,
        "market_type": "oneXTwo",
    },
    "over_under": {
        "category": 1,
        "num_outcomes": 2,
        "market_type": "overUnder",
    },
    "gg_ng": {
        "category": 2,
        "num_outcomes": 2,
        "market_type": "goalNoGoal",
    },
}


def _enum_name(value) -> str:
    if isinstance(value, dict) and len(value) == 1:
        return next(iter(value.keys()))
    for attr in ("name", "variant"):
        name = getattr(value, attr, None)
        if isinstance(name, str) and name:
            return name
    if hasattr(value, "__dict__"):
        variants = [key for key, inner in vars(value).items() if not key.startswith("_") and inner is not None]
        if len(variants) == 1:
            return variants[0]
    rendered = str(value)
    if rendered.endswith("()") and rendered[:-2].isidentifier():
        return rendered[:-2]
    if rendered.endswith("()") and "." in rendered:
        return rendered.rsplit(".", 1)[-1][:-2]
    lowered = rendered.lower()
    for candidate in (
        "pending",
        "active",
        "won",
        "lost",
        "cancelled",
        "open",
        "suspended",
        "settled",
        "voided",
        "closed",
    ):
        if candidate in lowered:
            return candidate
    return str(value)


def _txline_outcome_for_market(market_type: StateMarketType, home_score: int, away_score: int) -> int:
    """Match the on-chain settlement outcome derivation for each market type."""
    if market_type == StateMarketType.OVER_UNDER:
        return 0 if home_score + away_score > 2 else 1
    if market_type == StateMarketType.GG_NG:
        return 0 if home_score > 0 and away_score > 0 else 1
    if home_score > away_score:
        return 0
    if away_score > home_score:
        return 2
    return 1


def _serialize_epoch(epoch_id: int, epoch, vault) -> dict:
    return {
        "epoch_id": epoch_id,
        "exists": epoch is not None,
        "start_time": int(getattr(epoch, "start_time", 0)) if epoch else None,
        "end_time": int(getattr(epoch, "end_time", 0)) if epoch else None,
        "num_markets": int(getattr(epoch, "num_markets", 0)) if epoch else 0,
        "num_settled_markets": int(getattr(epoch, "num_settled_markets", 0)) if epoch else 0,
        "all_markets_settled": bool(getattr(epoch, "all_markets_settled", False)) if epoch else False,
        "withdrawals_enabled": bool(getattr(epoch, "withdrawals_enabled", False)) if epoch else False,
        "vault": {
            "exists": vault is not None,
            "total_deposits": int(getattr(vault, "total_deposits", 0)) if vault else 0,
            "total_withdrawals": int(getattr(vault, "total_withdrawals", 0)) if vault else 0,
            "total_shares": int(getattr(vault, "total_shares", 0)) if vault else 0,
            "num_lps": int(getattr(vault, "num_lps", 0)) if vault else 0,
            "withdrawals_enabled": bool(getattr(vault, "withdrawals_enabled", False)) if vault else False,
        },
    }


def _serialize_market(market_id: int, market, tracked: TrackedMarket | None) -> dict:
    return {
        "market_id": market_id,
        "fixture_id": int(getattr(market, "txline_fixture_id", 0) or (tracked.fixture_id if tracked else 0)),
        "group_id": getattr(market, "group_id", None),
        "epoch_id": int(getattr(market, "epoch_id", tracked.epoch_id if tracked else 0)),
        "title": str(getattr(market, "title", tracked.title if tracked else "")),
        "description": str(getattr(market, "description", "")),
        "status": _enum_name(getattr(market, "status", "")).lower(),
        "market_type": tracked.market_type.value if tracked else _enum_name(getattr(market, "market_type", "")).lower(),
        "category": int(getattr(market, "category", tracked.category if tracked else 0)),
        "num_outcomes": int(getattr(market, "num_outcomes", tracked.num_outcomes if tracked else 0)),
        "start_time": int(getattr(market, "start_time", tracked.start_time if tracked else 0)),
        "odds": [int(odd) for odd in list(getattr(market, "odds", []))[: int(getattr(market, "num_outcomes", 0))]],
        "winning_outcome": int(getattr(market, "winning_outcome", 0)),
        "settlement_time": int(getattr(market, "settlement_time", 0)),
        "settled_in_epoch": bool(getattr(market, "settled_in_epoch", False)),
        "stage": tracked.stage.value if tracked else None,
    }


async def build_markets_by_epoch(chain: ChainClient, state: BotState) -> dict:
    markets = await chain.fetch_all_markets()
    grouped: dict[int, list[dict]] = {}

    for market_id, market in markets:
        epoch_id = int(getattr(market, "epoch_id", 0))
        grouped.setdefault(epoch_id, []).append(
            _serialize_market(market_id, market, state.get_market(market_id))
        )

    epochs = []
    for epoch_id, epoch_markets in sorted(grouped.items()):
        try:
            epoch = await chain.fetch_epoch(epoch_id)
        except Exception:
            epoch = None
        try:
            vault = await chain.fetch_epoch_vault(epoch_id)
        except Exception:
            vault = None

        epochs.append(
            {
                **_serialize_epoch(epoch_id, epoch, vault),
                "markets": sorted(epoch_markets, key=lambda item: item["market_id"]),
            }
        )

    return {
        "count": len(markets),
        "epoch_count": len(epochs),
        "epochs": epochs,
    }


# ─── Bot Tasks ────────────────────────────────────────────────────────────────

async def task_ensure_active_epoch(chain: ChainClient) -> int:
    cfg = await chain.fetch_global_config()
    epoch_id = int(cfg.current_epoch)
    needs_init = False
    try:
        await chain.fetch_epoch(epoch_id)
        log.info("active_epoch_exists", epoch_id=epoch_id)
    except Exception:
        needs_init = True
    try:
        await chain.fetch_epoch_vault(epoch_id)
    except Exception:
        needs_init = True

    if needs_init:
        await chain.init_epoch()
        log.info("active_epoch_published", epoch_id=epoch_id)
    return epoch_id


async def task_auto_epoch_liquidity(chain: ChainClient) -> None:
    if not config.AUTO_EPOCH_LIQUIDITY_ENABLED:
        return

    amount = int(config.AUTO_EPOCH_LIQUIDITY_AMOUNT)
    if amount <= 0:
        return

    cfg = await chain.fetch_global_config()
    epoch_id = int(cfg.current_epoch)
    try:
        vault = await chain.fetch_epoch_vault(epoch_id)
    except Exception as exc:
        log.warning("epoch_vault_missing", epoch_id=epoch_id, error=str(exc))
        return

    try:
        await chain.fetch_epoch_lp_position(epoch_id, chain.operator_kp.pubkey())
        log.info(
            "epoch_liquidity_already_added",
            epoch_id=epoch_id,
            amount=int(getattr(vault, "total_deposits", 0)),
        )
        return
    except Exception:
        pass

    try:
        await chain.opt_in_epoch_liquidity(epoch_id, amount)
        log.info("epoch_liquidity_added", epoch_id=epoch_id, amount=amount)
    except Exception as exc:
        log.error("epoch_liquidity_add_failed", epoch_id=epoch_id, amount=amount, error=str(exc))

async def task_create_markets(
    chain: ChainClient, 
    api: TxoddsApiClient, 
    state: BotState
) -> None:
    """
    Fetch upcoming fixtures and create market groups with 3 markets each:
    1X2, O/U 2.5, GG/NG
    """
    cfg = await chain.fetch_global_config()
    current_epoch = int(cfg.current_epoch)
    fixtures = await api.get_upcoming_fixtures(config.MARKET_LOOKAHEAD_DAYS)
    seen_fixture_ids: set[int] = set()
    
    for fix in fixtures:
        if fix.fixture_id in seen_fixture_ids:
            continue
        seen_fixture_ids.add(fix.fixture_id)

        if state.is_group_tracked(fix.fixture_id):
            continue
        
        log.info("creating_market_group", fixture_id=fix.fixture_id)
        
        # Get odds for the fixture
        odds_snapshot = await api.get_best_odds(fix.fixture_id)
        
        try:
            title = f"{fix.home_team} vs {fix.away_team}"
            market_titles = [
                f"1X2: {title}",
                f"O/U 2.5: {title}",
                f"GG/NG: {title}",
            ]

            # Market group ids live in their own PDA namespace. Use the TxLINE
            # fixture id so retries find the same group without depending on
            # global_config.next_market_id, which only advances for markets.
            group_id = int(fix.fixture_id)
            market_ids = []
            existing_count = 0
            try:
                existing_group = await chain.fetch_market_group(group_id)
                if getattr(existing_group, "title", None) != title:
                    log.error(
                        "market_group_title_mismatch",
                        fixture_id=fix.fixture_id,
                        group_id=group_id,
                        expected=title,
                        actual=getattr(existing_group, "title", None),
                    )
                    continue
                existing_count = min(int(getattr(existing_group, "num_markets", 0)), 3)
                market_ids = [
                    int(market_id)
                    for market_id in list(getattr(existing_group, "market_ids", []))[:existing_count]
                    if int(market_id) != 0
                ]
                log.info(
                    "market_group_exists",
                    fixture_id=fix.fixture_id,
                    group_id=group_id,
                    markets=market_ids,
                )
            except Exception:
                await chain.create_market_group(
                    group_id=group_id,
                    title=title,
                    event_start_time=fix.start_time,
                )

            market_specs = [
                {
                    "num_outcomes": 3,
                    "title": market_titles[0],
                    "description": fix.sport_key,
                    "category": 0,
                    "market_type": "oneXTwo",
                    "initial_odds": derive_market_odds(fix.fixture_id, odds_snapshot, MarketType.ONE_X_TWO) if odds_snapshot else [20000, 35000, 30000],
                },
                {
                    "num_outcomes": 2,
                    "title": market_titles[1],
                    "description": fix.sport_key,
                    "category": 1,
                    "market_type": "overUnder",
                    "initial_odds": derive_market_odds(fix.fixture_id, odds_snapshot, MarketType.OVER_UNDER) if odds_snapshot else [18000, 19000],
                },
                {
                    "num_outcomes": 2,
                    "title": market_titles[2],
                    "description": fix.sport_key,
                    "category": 2,
                    "market_type": "goalNoGoal",
                    "initial_odds": derive_market_odds(fix.fixture_id, odds_snapshot, MarketType.GG_NG) if odds_snapshot else [17000, 20000],
                },
            ]

            if len(market_ids) < len(market_specs):
                next_market_id = await chain.next_market_id()
                recovered_markets: dict[int, int] = {}
                for candidate_market_id in range(max(1, next_market_id - 50), next_market_id):
                    if candidate_market_id in market_ids:
                        continue
                    try:
                        candidate = await chain.fetch_market(candidate_market_id)
                    except Exception:
                        continue
                    candidate_title = getattr(candidate, "title", None)
                    candidate_fixture_id = int(getattr(candidate, "txline_fixture_id", 0) or 0)
                    if candidate_fixture_id != int(fix.fixture_id) or candidate_title not in market_titles:
                        continue
                    if getattr(candidate, "group_id", None) is not None:
                        continue
                    recovered_index = market_titles.index(candidate_title)
                    recovered_markets[recovered_index] = candidate_market_id
                    log.info(
                        "orphan_market_recovered",
                        fixture_id=fix.fixture_id,
                        group_id=group_id,
                        market_id=candidate_market_id,
                        market_index=recovered_index,
                    )
            else:
                next_market_id = 0
                recovered_markets = {}

            for market_index, spec in enumerate(market_specs[len(market_ids):], start=len(market_ids)):
                recovered_market_id = recovered_markets.get(market_index)
                if recovered_market_id is not None:
                    market_ids.append(recovered_market_id)
                    continue

                created_market_id, _ = await chain.create_market(
                    start_time=fix.start_time,
                    num_outcomes=spec["num_outcomes"],
                    title=spec["title"],
                    description=spec["description"],
                    category=spec["category"],
                    market_type=spec["market_type"],
                    initial_odds=spec["initial_odds"],
                    txline_fixture_id=fix.fixture_id,
                    market_id=next_market_id,
                )
                market_ids.append(created_market_id)
                next_market_id = created_market_id + 1

            for i, mkt_id in enumerate(market_ids[existing_count:], start=existing_count):
                await chain.add_market_to_group(group_id, mkt_id, i)

            if len(market_ids) < len(market_specs):
                log.warning(
                    "market_group_incomplete",
                    fixture_id=fix.fixture_id,
                    group_id=group_id,
                    markets=market_ids,
                )
                continue
            
            # Track group
            group = TrackedMarketGroup(
                fixture_id=fix.fixture_id,
                group_id=group_id,
                home_team=fix.home_team,
                away_team=fix.away_team,
                sport_key=fix.sport_key,
                start_time=fix.start_time,
                market_ids=market_ids,
                stage=MarketStage.CREATED,
            )
            state.add_group(group)
            
            # Track individual markets
            for i, mkt_id in enumerate(market_ids):
                mkt_type = ["1x2", "over_under", "gg_ng"][i]
                mkt_config = MARKET_TYPE_CONFIG[mkt_type]
                try:
                    onchain_market = await chain.fetch_market(mkt_id)
                    epoch_id = int(getattr(onchain_market, "epoch_id", current_epoch))
                except Exception:
                    epoch_id = current_epoch
                market = TrackedMarket(
                    fixture_id=fix.fixture_id,
                    market_id=mkt_id,
                    epoch_id=epoch_id,
                    market_type=StateMarketType(mkt_type),
                    category=mkt_config["category"],
                    num_outcomes=mkt_config["num_outcomes"],
                    start_time=fix.start_time,
                    stage=MarketStage.CREATED,
                    title=f"{mkt_type}: {title}",
                    market_index=i,
                )
                state.add_market(market)
            
            log.info("market_group_created", 
                     fixture_id=fix.fixture_id, 
                     group_id=group_id,
                     markets=market_ids)
            
        except Exception as exc:
            log.error("create_market_group_failed", 
                      fixture_id=fix.fixture_id, 
                      error=str(exc))


async def task_init_market_mints(chain: ChainClient, state: BotState) -> None:
    """
    Initialize outcome mints for newly created markets.
    """
    default_pubkey = str(Pubkey.default())
    for market in state.all_markets_in_stage(MarketStage.CREATED):
        try:
            onchain_market = await chain.fetch_market(market.market_id)
            outcome_mints = [
                str(mint) for mint in getattr(onchain_market, "outcome_mints", [])
            ]

            for outcome_id in range(int(market.num_outcomes)):
                if outcome_id < len(outcome_mints) and outcome_mints[outcome_id] != default_pubkey:
                    continue
                await chain.init_outcome_mint(market.market_id, outcome_id)

            state.advance_market(market.market_id, MarketStage.MINTS_INIT)
            log.info("market_mints_initialized", market_id=market.market_id)
        except Exception as exc:
            log.error(
                "init_market_mints_failed",
                market_id=market.market_id,
                error=str(exc),
            )


async def task_update_odds(
    chain: ChainClient, 
    api: TxoddsApiClient, 
    state: BotState
) -> None:
    """
    Update odds for open markets based on latest txodds data.
    Only updates markets that haven't started yet.
    """
    now = int(time.time())
    
    # Get markets that are open for trading
    for market in state.all_markets_in_stage(MarketStage.MINTS_INIT):
        if now >= market.start_time:
            continue  # Market already started
        
        try:
            # Get latest odds from txodds
            odds_snapshot = await api.get_best_odds(market.fixture_id)
            if not odds_snapshot:
                continue
            
            # Derive odds for this market type
            mkt_type = MarketType(market.market_type.value.replace("-", "_"))
            new_odds = derive_market_odds(market.fixture_id, odds_snapshot, mkt_type)
            
            # Update odds
            await chain.update_market_odds(market.market_id, new_odds)
            log.info("odds_updated", 
                     market_id=market.market_id, 
                     odds=new_odds)
            
        except Exception as exc:
            log.error("update_odds_failed", 
                      market_id=market.market_id, 
                      error=str(exc))


async def task_suspend_markets(
    chain: ChainClient, 
    state: BotState
) -> None:
    """
    Suspend markets whose start_time has passed — closes betting.
    """
    now = int(time.time())
    
    for market in state.all_markets_in_stage(MarketStage.MINTS_INIT):
        if now < market.start_time:
            continue
        
        try:
            await chain.suspend_market(market.market_id)
            state.advance_market(market.market_id, MarketStage.SUSPENDED)
            log.info("market_suspended", market_id=market.market_id)
        except Exception as exc:
            log.error("suspend_market_failed", 
                      market_id=market.market_id, 
                      error=str(exc))


async def task_execute_slip_legs(chain: ChainClient) -> dict[str, int]:
    """
    Execute any pending slip legs while their markets are still open.
    """
    now = int(time.time())
    slips = await chain.fetch_all_slips()
    pending_count = 0
    bought_count = 0

    for slip_id, slip in slips:
        try:
            status = _enum_name(slip.status).lower()
            if status not in {"pending", "active"}:
                continue

            pending_count += 1
            num_legs = int(slip.num_legs)
            bought_mask = int(slip.legs_bought_mask)
            log.info(
                "pending_slip_found",
                slip_id=slip_id,
                owner=str(slip.owner),
                status=status,
                num_legs=num_legs,
                bought_mask=bought_mask,
                cancel_deadline=int(slip.cancel_deadline),
            )

            for leg_index in range(num_legs):
                if bought_mask & (1 << leg_index):
                    continue

                market_id = int(slip.leg_market_ids[leg_index])
                outcome_id = int(slip.leg_outcome_ids[leg_index])
                market = await chain.fetch_market(market_id)
                market_status = _enum_name(market.status).lower()
                if market_status != "open":
                    log.info("slip_leg_not_executable", slip_id=slip_id, leg_index=leg_index, market_id=market_id, reason=f"market_{market_status}")
                    continue
                if now >= int(market.start_time):
                    log.info("slip_leg_not_executable", slip_id=slip_id, leg_index=leg_index, market_id=market_id, reason="market_started")
                    continue
                if now >= int(slip.cancel_deadline):
                    log.info("slip_leg_not_executable", slip_id=slip_id, leg_index=leg_index, market_id=market_id, reason="cancel_deadline_passed")
                    continue

                outcome_mints = [str(mint) for mint in getattr(market, "outcome_mints", [])]
                if outcome_id >= len(outcome_mints):
                    log.info("slip_leg_not_executable", slip_id=slip_id, leg_index=leg_index, market_id=market_id, outcome_id=outcome_id, reason="missing_outcome_mint_slot")
                    continue
                if outcome_mints[outcome_id] == str(Pubkey.default()):
                    await chain.init_outcome_mint(market_id, outcome_id)
                    log.info("slip_leg_outcome_mint_initialized", slip_id=slip_id, leg_index=leg_index, market_id=market_id, outcome_id=outcome_id)

                await chain.buy_leg_for_slip(slip_id, leg_index, chain.operator_kp.pubkey())
                bought_count += 1
                log.info(
                    "slip_leg_bought",
                    slip_id=slip_id,
                    leg_index=leg_index,
                    market_id=market_id,
                    outcome_id=outcome_id,
                )
        except Exception as exc:
            log.error("execute_pending_slip_failed", slip_id=slip_id, error=str(exc))

    result = {"pending_slips": pending_count, "legs_bought": bought_count}
    log.info("pending_slips_execution_complete", **result)
    return result


async def task_settle_markets(
    chain: ChainClient, 
    api: TxoddsApiClient, 
    state: BotState
) -> None:
    """
    Fetch the final TxLINE proof bundle and settle markets on-chain.
    """
    now = int(time.time())

    for market in state.all_markets_in_stage(MarketStage.SUSPENDED):
        if now < market.start_time + config.RESULT_DELAY_SECONDS:
            continue

        log.info("market_requires_proof_settlement",
                 market_id=market.market_id,
                 fixture_id=market.fixture_id)
        try:
            proof_bundle = await api.build_final_settlement_proof(market.fixture_id)
            if not proof_bundle:
                continue

            proposed_outcome = _txline_outcome_for_market(
                market.market_type,
                int(proof_bundle["home_score"]),
                int(proof_bundle["away_score"]),
            )

            await chain.settle_with_proof(
                market_id=market.market_id,
                txline_fixture_id=market.fixture_id,
                proposed_outcome=proposed_outcome,
                validation_timestamp=proof_bundle["validation_timestamp"],
                home_score=proof_bundle["home_score"],
                away_score=proof_bundle["away_score"],
                validation_input=proof_bundle["validation_input"],
                strategy=proof_bundle["strategy"],
            )
            state.mark_market_settled(
                market.market_id,
                proposed_outcome,
            )
            log.info(
                "market_settled_with_proof",
                market_id=market.market_id,
                fixture_id=market.fixture_id,
                market_type=market.market_type.value,
                outcome=proposed_outcome,
                home_score=proof_bundle["home_score"],
                away_score=proof_bundle["away_score"],
            )
        except Exception as exc:
            log.error(
                "settle_market_failed",
                market_id=market.market_id,
                fixture_id=market.fixture_id,
                error=str(exc),
            )


async def task_close_settled_epochs(chain: ChainClient, state: BotState) -> None:
    """
    Close epochs once every tracked market in the epoch has finalized.
    """
    epoch_to_markets: dict[int, list[int]] = {}
    for market in state.all_markets_in_stage(MarketStage.FINALIZED):
        epoch_id = int(getattr(market, "epoch_id", 0))
        if epoch_id <= 0:
            try:
                onchain_market = await chain.fetch_market(market.market_id)
                epoch_id = int(getattr(onchain_market, "epoch_id", 0))
            except Exception:
                continue
        if epoch_id <= 0:
            continue
        epoch_to_markets.setdefault(epoch_id, []).append(market.market_id)

    for epoch_id, market_ids in sorted(epoch_to_markets.items()):
        epoch_markets = state.all_markets_in_epoch(epoch_id)
        if epoch_markets and any(market.stage != MarketStage.FINALIZED for market in epoch_markets):
            continue
        try:
            await chain.close_epoch(epoch_id)
            log.info(
                "epoch_closed",
                epoch_id=epoch_id,
                markets=market_ids,
            )
        except Exception as exc:
            log.error("close_epoch_failed", epoch_id=epoch_id, error=str(exc))


async def task_void_expired(
    chain: ChainClient, 
    state: BotState
) -> None:
    """
    Void markets where no result was provided within the deadline.
    """
    cfg = await chain.fetch_global_config()
    deadline_seconds = int(cfg.settlement_deadline_seconds)
    now = int(time.time())
    
    for market in state.all_markets_in_stage(MarketStage.SUSPENDED):
        if now < market.start_time + deadline_seconds:
            continue
        
        try:
            await chain.void_if_expired(market.market_id)
            state.advance_market(market.market_id, MarketStage.VOIDED)
            log.info("market_voided", market_id=market.market_id)
        except Exception as exc:
            log.error("void_market_failed", 
                      market_id=market.market_id, 
                      error=str(exc))


async def task_settle_slips(
    chain: ChainClient, 
    state: BotState
) -> None:
    """
    Settle and resolve slips after their markets finalize.
    """
    slips = await chain.fetch_all_slips()

    for slip_id, slip in slips:
        status = _enum_name(slip.status).lower()
        if status not in {"pending", "active", "won", "lost"}:
            continue

        num_legs = int(slip.num_legs)
        for leg_index in range(num_legs):
            if (int(slip.legs_bought_mask) & (1 << leg_index)) == 0:
                continue
            if int(slip.legs_settled_mask) & (1 << leg_index):
                continue

            market_id = int(slip.leg_market_ids[leg_index])
            market = await chain.fetch_market(market_id)
            market_status = _enum_name(market.status).lower()
            if market_status != "settled":
                continue

            try:
                await chain.settle_slip_leg(slip_id, leg_index)
                log.info(
                    "slip_leg_settled",
                    slip_id=slip_id,
                    leg_index=leg_index,
                    market_id=market_id,
                )
            except Exception as exc:
                log.error(
                    "settle_slip_leg_failed",
                    slip_id=slip_id,
                    leg_index=leg_index,
                    market_id=market_id,
                    error=str(exc),
                )

        try:
            refreshed = await chain.fetch_slip(slip_id)
            refreshed_status = _enum_name(refreshed.status).lower()
            if refreshed_status in {"won", "lost"}:
                await chain.resolve_slip(slip_id)
                log.info("slip_resolved", slip_id=slip_id, status=refreshed_status)
        except Exception as exc:
            log.error("resolve_slip_failed", slip_id=slip_id, error=str(exc))


# ─── Main Loop ────────────────────────────────────────────────────────────────

async def run_once(chain: ChainClient, api: TxoddsApiClient, state: BotState) -> None:
    """Execute one full pass of all bot tasks in dependency order."""
    log.info("bot_pass_start")
    
    # 1. Ensure the active epoch exists
    await task_ensure_active_epoch(chain)

    # 2. Add operator liquidity to the active epoch vault when available
    await task_auto_epoch_liquidity(chain)

    # 3. Create new markets from upcoming fixtures
    await task_create_markets(chain, api, state)
    
    # 4. Initialize outcome mints for newly created markets
    await task_init_market_mints(chain, state)

    # 5. Update odds for open markets
    await task_update_odds(chain, api, state)
    
    # 6. Execute slip legs while markets are still open
    await task_execute_slip_legs(chain)

    # 7. Suspend markets at start time
    await task_suspend_markets(chain, state)

    # 8. Settle markets after delay
    await task_settle_markets(chain, api, state)

    # 9. Close any epochs that have fully finalized
    await task_close_settled_epochs(chain, state)

    # 10. Void expired markets
    await task_void_expired(chain, state)

    # 11. Settle and resolve slips
    await task_settle_slips(chain, state)

    log.info("bot_pass_complete")


async def main(once: bool = False) -> None:
    if not IDL_PATH.exists():
        log.error("idl_not_found", path=str(IDL_PATH))
        log.error("Run `anchor build` first to generate the IDL.")
        sys.exit(1)
    
    # Load keypairs
    operator_kp = load_keypair(config.OPERATOR_KEYPAIR_PATH)
    oracle_kp = load_keypair(config.ORACLE_KEYPAIR_PATH)
    network = Network.DEVNET if config.TXODDS_NETWORK == "devnet" else Network.MAINNET

    # Initialize chain client
    chain = await ChainClient.create(
        rpc_url=config.RPC_URL,
        idl_path=IDL_PATH,
        program_id_str=config.PROGRAM_ID,
        operator_kp=operator_kp,
        oracle_kp=oracle_kp,
        base_mint_str=config.BASE_MINT,
        txoracle_program_id_str=NETWORK_CONFIG[network]["program_id"],
    )
    
    # Initialize txodds API client
    api = TxoddsApiClient(config.TXODDS_API_KEY, network)
    await api.authenticate()
    
    # Load state
    state = BotState()
    runtime = BotRuntime(chain=chain, api=api, state=state)
    set_runtime(runtime)
    api_task: asyncio.Task[uvicorn.Server] | None = None
    
    try:
        if once:
            await run_once(chain, api, state)
            return

        log.info("bot_started", 
                 interval_seconds=config.POLL_INTERVAL_SECONDS,
                 sports=config.SPORTS)

        if config.BOT_API_ENABLED:
            api_task = asyncio.create_task(run_api_server())
            log.info("bot_api_started", host=config.BOT_API_HOST, port=config.BOT_API_PORT)

        if not config.BOT_SCHEDULER_ENABLED:
            log.info("bot_scheduler_disabled")
            if api_task is None:
                return
            await api_task
            return

        # Keep running on a single event loop to avoid cross-loop RPC issues.
        try:
            while True:
                await run_once(chain, api, state)
                await asyncio.sleep(config.POLL_INTERVAL_SECONDS)
        except (KeyboardInterrupt, SystemExit):
            log.info("bot_stopping")
    finally:
        if api_task is not None and not api_task.done():
            api_task.cancel()
            try:
                await api_task
            except asyncio.CancelledError:
                pass
        await chain.close()
        await api.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Txodds Market Bot for Quadratic Market")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single pass and exit (useful for cron jobs)",
    )
    args = parser.parse_args()
    asyncio.run(main(once=args.once))

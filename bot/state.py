"""
Persistent bot state stored as a JSON file.

Tracks the mapping between The-Odds-API event IDs and on-chain market IDs,
plus the lifecycle stage of each market so the bot knows what to do next.

Supports multiple market types per fixture (Match Result, BTTS, Over/Under).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger(__name__)

STATE_FILE = Path(__file__).parent / "bot_state.json"


class MarketStage(str, Enum):
    CREATED = "created"         # market created on-chain, mints not yet initialised
    MINTS_INIT = "mints_init"   # outcome mints initialised, open for trading
    SUSPENDED = "suspended"     # match started, betting closed
    PROPOSED = "proposed"       # oracle proposed result, in challenge window
    FINALIZED = "finalized"     # result finalized, market settled
    VOIDED = "voided"           # market voided (oracle silent / admin action)


@dataclass
class TrackedMarket:
    """
    Tracks a single fixture's markets on-chain.
    
    Each fixture can have multiple market types (Match Result, BTTS, Over/Under).
    The primary_market_id points to the main 3-way market.
    sub_markets contains all markets for this fixture.
    """
    event_id: str           # The-Odds-API event ID
    sport_key: str
    market_id: int          # Primary on-chain market ID (usually Match Result)
    primary_category: int   # Category of primary market (0=3-way, 1=BTTS, 2=Totals)
    num_outcomes: int       # Number of outcomes for primary market
    start_time: int         # Unix timestamp
    stage: MarketStage
    home_team: str
    away_team: str
    proposed_outcome: Optional[int] = None
    created_at: int = field(default_factory=lambda: int(time.time()))
    # Sub-markets: list of {market_id, category, num_outcomes}
    sub_markets: list = field(default_factory=list)


class BotState:
    """
    Thread-safe (single-process) state manager.
    Persists to disk after every mutation.
    """

    def __init__(self, path: Path = STATE_FILE) -> None:
        self._path = path
        # event_id -> TrackedMarket
        self._markets: dict[str, TrackedMarket] = {}
        self._load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text())
            for item in raw.get("markets", []):
                # Handle sub_markets as list of dicts
                sub_markets = item.get("sub_markets", [])
                m = TrackedMarket(
                    event_id=item["event_id"],
                    sport_key=item["sport_key"],
                    market_id=item["market_id"],
                    primary_category=item.get("primary_category", 0),
                    num_outcomes=item["num_outcomes"],
                    start_time=item["start_time"],
                    stage=MarketStage(item["stage"]),
                    home_team=item["home_team"],
                    away_team=item["away_team"],
                    proposed_outcome=item.get("proposed_outcome"),
                    created_at=item.get("created_at", int(time.time())),
                    sub_markets=sub_markets,
                )
                self._markets[m.event_id] = m
            log.info("state_loaded", markets=len(self._markets), path=str(self._path))
        except Exception as exc:
            log.warning("state_load_failed", error=str(exc))

    def _save(self) -> None:
        data = {"markets": [asdict(m) for m in self._markets.values()]}
        self._path.write_text(json.dumps(data, indent=2))

    # ── Queries ───────────────────────────────────────────────────────────────

    def is_tracked(self, event_id: str) -> bool:
        return event_id in self._markets

    def get(self, event_id: str) -> Optional[TrackedMarket]:
        return self._markets.get(event_id)

    def all_in_stage(self, stage: MarketStage) -> list[TrackedMarket]:
        return [m for m in self._markets.values() if m.stage == stage]

    def by_market_id(self, market_id: int) -> Optional[TrackedMarket]:
        for m in self._markets.values():
            if m.market_id == market_id:
                return m
            # Also check sub-markets
            if m.sub_markets:
                for sub in m.sub_markets:
                    if sub.get("market_id") == market_id:
                        return m
        return None

    # ── Mutations ─────────────────────────────────────────────────────────────

    def add(self, market: TrackedMarket) -> None:
        self._markets[market.event_id] = market
        self._save()
        log.info(
            "state_add",
            event_id=market.event_id,
            market_id=market.market_id,
            sub_markets=len(market.sub_markets or []),
        )

    def advance(self, event_id: str, stage: MarketStage, **kwargs) -> None:
        m = self._markets[event_id]
        m.stage = stage
        for k, v in kwargs.items():
            setattr(m, k, v)
        self._save()
        log.info("state_advance", event_id=event_id, stage=stage.value)

"""
Persistent bot state stored as a JSON file.

Tracks the mapping between The-Odds-API event IDs and on-chain market IDs,
plus the lifecycle stage of each market so the bot knows what to do next.
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
    event_id: str           # The-Odds-API event ID
    sport_key: str
    market_id: int          # on-chain market ID
    num_outcomes: int       # 2 or 3
    start_time: int         # Unix timestamp
    stage: MarketStage
    home_team: str
    away_team: str
    proposed_outcome: Optional[int] = None
    created_at: int = field(default_factory=lambda: int(time.time()))


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
                m = TrackedMarket(**{**item, "stage": MarketStage(item["stage"])})
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
        return None

    # ── Mutations ─────────────────────────────────────────────────────────────

    def add(self, market: TrackedMarket) -> None:
        self._markets[market.event_id] = market
        self._save()
        log.info("state_add", event_id=market.event_id, market_id=market.market_id)

    def advance(self, event_id: str, stage: MarketStage, **kwargs) -> None:
        m = self._markets[event_id]
        m.stage = stage
        for k, v in kwargs.items():
            setattr(m, k, v)
        self._save()
        log.info("state_advance", event_id=event_id, stage=stage.value)

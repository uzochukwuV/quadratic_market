"""
Persistent bot state stored as a JSON file.

Tracks:
- Market groups (match groups with 1X2, O/U, GG/NG markets)
- Individual markets within groups
- Slips for execution and settlement
- Epoch progress
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path
from typing import Optional, List

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


class MarketType(str, Enum):
    ONE_X_TWO = "1x2"           # 3-way: home, draw, away
    OVER_UNDER = "over_under"    # 2-way: over, under
    GG_NG = "gg_ng"              # 2-way: gg, ng


@dataclass
class TrackedMarket:
    """An individual market (e.g., 1X2 for a match)."""
    fixture_id: int          # txodds fixture ID
    market_id: int            # on-chain market ID
    market_type: MarketType   # 1x2, over_under, gg_ng
    category: int            # 0=1X2, 1=O/U, 2=GG/NG
    num_outcomes: int       # 2 or 3
    start_time: int         # Unix timestamp
    stage: MarketStage
    title: str
    market_index: int        # 0=1X2, 1=O/U, 2=GG/NG
    created_at: int = field(default_factory=lambda: int(time.time()))
    proposed_outcome: Optional[int] = None


@dataclass
class TrackedMarketGroup:
    """A match group containing 1X2, O/U, GG/NG markets."""
    fixture_id: int          # txodds fixture ID
    group_id: int            # on-chain market group ID
    home_team: str
    away_team: str
    sport_key: str
    start_time: int         # Unix timestamp (earliest market start)
    market_ids: List[int]    # [1x2_id, ou_id, ggng_id]
    stage: MarketStage      # Overall stage (derived from markets)
    created_at: int = field(default_factory=lambda: int(time.time()))


@dataclass
class TrackedSlip:
    """A slip that the bot needs to execute or settle."""
    slip_id: int             # on-chain slip ID
    owner: str                # owner pubkey
    leg_market_ids: List[int]  # [market_id for leg 0, market_id for leg 1, ...]
    leg_indices: List[int]    # [0, 1, 2] (which outcome in each market)
    status: str              # pending, active, settled, resolved
    pending_legs: List[int]  # legs not yet executed
    settled_legs: List[int]  # legs settled
    created_at: int = field(default_factory=lambda: int(time.time()))


@dataclass
class TrackedEpoch:
    """Epoch tracking."""
    epoch_id: int
    market_ids: List[int]
    settled_count: int = 0
    created_at: int = field(default_factory=lambda: int(time.time()))


class BotState:
    """
    Thread-safe (single-process) state manager.
    Persists to disk after every mutation.
    """

    def __init__(self, path: Path = STATE_FILE) -> None:
        self._path = path
        # fixture_id -> TrackedMarketGroup
        self._groups: dict[int, TrackedMarketGroup] = {}
        # market_id -> TrackedMarket
        self._markets: dict[int, TrackedMarket] = {}
        # slip_id -> TrackedSlip
        self._slips: dict[int, TrackedSlip] = {}
        self._load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text())
            
            for item in raw.get("groups", []):
                g = TrackedMarketGroup(
                    fixture_id=item["fixture_id"],
                    group_id=item["group_id"],
                    home_team=item["home_team"],
                    away_team=item["away_team"],
                    sport_key=item["sport_key"],
                    start_time=item["start_time"],
                    market_ids=item["market_ids"],
                    stage=MarketStage(item["stage"]),
                )
                self._groups[g.fixture_id] = g
            
            for item in raw.get("markets", []):
                m = TrackedMarket(
                    fixture_id=item["fixture_id"],
                    market_id=item["market_id"],
                    market_type=MarketType(item["market_type"]),
                    category=item["category"],
                    num_outcomes=item["num_outcomes"],
                    start_time=item["start_time"],
                    stage=MarketStage(item["stage"]),
                    title=item["title"],
                    market_index=item["market_index"],
                )
                self._markets[m.market_id] = m
            
            for item in raw.get("slips", []):
                s = TrackedSlip(
                    slip_id=item["slip_id"],
                    owner=item["owner"],
                    leg_market_ids=item["leg_market_ids"],
                    leg_indices=item["leg_indices"],
                    status=item["status"],
                    pending_legs=item["pending_legs"],
                    settled_legs=item["settled_legs"],
                )
                self._slips[s.slip_id] = s
            
            log.info("state_loaded", 
                     groups=len(self._groups), 
                     markets=len(self._markets),
                     slips=len(self._slips),
                     path=str(self._path))
        except Exception as exc:
            log.warning("state_load_failed", error=str(exc))

    def _save(self) -> None:
        data = {
            "groups": [asdict(g) for g in self._groups.values()],
            "markets": [asdict(m) for m in self._markets.values()],
            "slips": [asdict(s) for s in self._slips.values()],
        }
        self._path.write_text(json.dumps(data, indent=2))

    # ── Group Queries ─────────────────────────────────────────────────────────

    def is_group_tracked(self, fixture_id: int) -> bool:
        return fixture_id in self._groups

    def get_group(self, fixture_id: int) -> Optional[TrackedMarketGroup]:
        return self._groups.get(fixture_id)

    def add_group(self, group: TrackedMarketGroup) -> None:
        self._groups[group.fixture_id] = group
        self._save()
        log.info("state_add_group", fixture_id=group.fixture_id, group_id=group.group_id)

    def advance_group(self, fixture_id: int, stage: MarketStage) -> None:
        g = self._groups[fixture_id]
        g.stage = stage
        self._save()
        log.info("state_advance_group", fixture_id=fixture_id, stage=stage.value)

    # ── Market Queries ─────────────────────────────────────────────────────────

    def is_market_tracked(self, market_id: int) -> bool:
        return market_id in self._markets

    def get_market(self, market_id: int) -> Optional[TrackedMarket]:
        return self._markets.get(market_id)

    def add_market(self, market: TrackedMarket) -> None:
        self._markets[market.market_id] = market
        self._save()
        log.info("state_add_market", market_id=market.market_id, type=market.market_type.value)

    def advance_market(self, market_id: int, stage: MarketStage, **kwargs) -> None:
        m = self._markets[market_id]
        m.stage = stage
        for k, v in kwargs.items():
            setattr(m, k, v)
        self._save()
        log.info("state_advance_market", market_id=market_id, stage=stage.value)

    def all_markets_in_stage(self, stage: MarketStage) -> List[TrackedMarket]:
        return [m for m in self._markets.values() if m.stage == stage]

    # ── Slip Queries ───────────────────────────────────────────────────────────

    def is_slip_tracked(self, slip_id: int) -> bool:
        return slip_id in self._slips

    def get_slip(self, slip_id: int) -> Optional[TrackedSlip]:
        return self._slips.get(slip_id)

    def add_slip(self, slip: TrackedSlip) -> None:
        self._slips[slip.slip_id] = slip
        self._save()
        log.info("state_add_slip", slip_id=slip.slip_id)

    def update_slip(self, slip_id: int, **kwargs) -> None:
        s = self._slips[slip_id]
        for k, v in kwargs.items():
            setattr(s, k, v)
        self._save()
        log.info("state_update_slip", slip_id=slip_id)

    def get_pending_slips(self) -> List[TrackedSlip]:
        return [s for s in self._slips.values() if s.status in ("pending", "active")]

    def get_settable_slips(self) -> List[TrackedSlip]:
        """Get slips where all legs can be settled."""
        return [s for s in self._slips.values() if s.status == "active" and not s.pending_legs]

    # ── Bulk Operations ─────────────────────────────────────────────────────────

    def mark_market_settled(self, market_id: int, outcome: int) -> None:
        """Mark a market as settled in the group."""
        self.advance_market(market_id, MarketStage.FINALIZED, proposed_outcome=outcome)
        
        # Update group stage if all markets settled
        m = self._markets[market_id]
        group = self._groups.get(m.fixture_id)
        if group:
            all_settled = all(
                self._markets[mid].stage == MarketStage.FINALIZED 
                for mid in group.market_ids if mid in self._markets
            )
            if all_settled:
                self.advance_group(m.fixture_id, MarketStage.FINALIZED)

    def cleanup_old_data(self, days: int = 7) -> None:
        """Remove data older than N days."""
        cutoff = int(time.time()) - (days * 86400)
        
        # Keep only recent groups
        self._groups = {
            k: v for k, v in self._groups.items() 
            if v.created_at > cutoff
        }
        
        # Keep only recent markets
        self._markets = {
            k: v for k, v in self._markets.items() 
            if v.created_at > cutoff
        }
        
        # Keep only recent slips
        self._slips = {
            k: v for k, v in self._slips.items() 
            if v.created_at > cutoff
        }
        
        self._save()
        log.info("state_cleanup", 
                 groups=len(self._groups),
                 markets=len(self._markets),
                 slips=len(self._slips))

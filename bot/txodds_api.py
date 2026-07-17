"""
Txodds API client for fetching fixtures, odds, and scores.

Based on https://txline.txodds.com/documentation

Endpoints:
  - /api/fixtures/snapshot - Upcoming fixtures
  - /api/odds/snapshot/{fixtureId} - Odds for a fixture
  - /api/scores/{fixtureId} - Scores for settlement
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Optional
from enum import Enum

import httpx
import structlog

from txline_proof import build_final_settlement_proof_bundle

log = structlog.get_logger(__name__)


# ─── Network Configuration ──────────────────────────────────────

class Network(str, Enum):
    DEVNET = "devnet"
    MAINNET = "mainnet"


NETWORK_CONFIG = {
    Network.DEVNET: {
        "guest_auth": "https://txline-dev.txodds.com/auth/guest/start",
        "api_base": "https://txline-dev.txodds.com/api/",
        "program_id": "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
        "rpc_url": "https://api.devnet.solana.com",
    },
    Network.MAINNET: {
        "guest_auth": "https://txline.txodds.com/auth/guest/start",
        "api_base": "https://txline.txodds.com/api/",
        "program_id": "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
        "rpc_url": "https://api.mainnet-beta.solana.com",
    },
}


# ─── Data Classes ───────────────────────────────────────────────

@dataclass
class TxoddsFixture:
    """A fixture from txodds."""
    fixture_id: int
    home_team: str
    away_team: str
    start_time: int  # Unix timestamp (seconds)
    sport_key: str
    league_id: Optional[int] = None
    league_name: Optional[str] = None


@dataclass
class TxoddsOdds:
    """Odds snapshot for a fixture."""
    fixture_id: int
    ts: int  # Unix timestamp (ms)
    prices: list[int]  # Odds in basis points (10000 = 1.0x)
    price_names: list[str]
    bookmaker: str
    in_running: bool = False


@dataclass
class TxoddsScore:
    """Score record for settlement."""
    fixture_id: int
    seq: Optional[int]
    home_score: int
    away_score: int
    status_id: int
    period: int
    action: str
    ts: int


@dataclass
class TxoddsResult:
    """Settled result for a fixture."""
    fixture_id: int
    home_team: str
    away_team: str
    home_score: int
    away_score: int
    winning_outcome: int  # 0=home, 1=draw, 2=away (or 1 for 2-way)
    market_type: str  # "1x2", "over_under", "gg_ng"
    
    @property
    def total_goals(self) -> int:
        return self.home_score + self.away_score
    
    @property
    def is_over_2_5(self) -> bool:
        return self.total_goals > 2
    
    @property
    def is_gg(self) -> bool:
        return self.home_score > 0 and self.away_score > 0


# ─── Sports with Draw (3-way markets) ───────────────────────────

THREE_WAY_SPORTS = {
    "soccer",
    "football",
}


# ─── Market Type Mapping ────────────────────────────────────────

class MarketType(str, Enum):
    ONE_X_TWO = "1x2"
    OVER_UNDER = "over_under"
    GG_NG = "gg_ng"


# ─── API Client ─────────────────────────────────────────────────

class TxoddsApiClient:
    """
    Client for txodds API.
    
    Usage:
        client = TxoddsApiClient(api_key="your-api-key", network=Network.DEVNET)
        await client.authenticate()
        
        fixtures = await client.get_fixtures()
        odds = await client.get_odds_snapshot(fixture_id)
        scores = await client.get_scores(fixture_id)
    """

    def __init__(
        self,
        api_key: str,
        network: Network = Network.DEVNET,
        jwt: Optional[str] = None,
    ) -> None:
        self._api_key = api_key
        self._network = network
        self._config = NETWORK_CONFIG[network]
        self._jwt: Optional[str] = jwt
        self._http = httpx.AsyncClient(
            base_url=self._config["api_base"],
            timeout=30.0,
        )

    async def authenticate(self) -> str:
        """
        Authenticate and get JWT token.
        Returns the JWT for use in subsequent requests.
        """
        resp = await self._http.post(
            "auth/guest/start",
            json={},
        )
        resp.raise_for_status()
        data = resp.json()
        self._jwt = data.get("token") or data.get("access_token")
        if not self._jwt:
            raise ValueError("No token in auth response")
        log.info("txodds_authenticated", network=self._network.value)
        return self._jwt

    def _headers(self) -> dict:
        """Get headers for authenticated requests."""
        if not self._jwt:
            raise RuntimeError("Not authenticated. Call authenticate() first.")
        return {
            "Authorization": f"Bearer {self._jwt}",
            "X-Api-Token": self._api_key,
        }

    async def close(self) -> None:
        await self._http.aclose()

    # ── Fixtures ────────────────────────────────────────────────

    async def get_fixtures(self, epoch_day: Optional[int] = None) -> list[TxoddsFixture]:
        """
        Get upcoming fixtures.
        
        Args:
            epoch_day: Optional epoch day (days since Unix epoch). 
                      If None, gets current day.
        """
        if epoch_day is None:
            epoch_day = int(time.time()) // 86400

        params = {"epochDay": epoch_day}
        
        resp = await self._http.get(
            "fixtures/snapshot",
            params=params,
            headers=self._headers(),
        )
        
        if resp.status_code == 401:
            # Re-authenticate and retry
            await self.authenticate()
            resp = await self._http.get(
                "fixtures/snapshot",
                params=params,
                headers=self._headers(),
            )
        
        resp.raise_for_status()
        data = resp.json()
        
        fixtures = []
        for item in data:
            fixtures.append(TxoddsFixture(
                fixture_id=item["fixtureId"],
                home_team=item.get("homeTeam", "Home"),
                away_team=item.get("awayTeam", "Away"),
                start_time=item["startTime"] // 1000 if isinstance(item["startTime"], int) else item["startTime"],  # ms to s
                sport_key=item.get("sportKey", "soccer"),
                league_id=item.get("leagueId"),
                league_name=item.get("leagueName"),
            ))
        
        log.info("fixtures_fetched", count=len(fixtures))
        return fixtures

    async def get_upcoming_fixtures(self, days: int = 7) -> list[TxoddsFixture]:
        """Get fixtures for the next N days."""
        all_fixtures = []
        now_epoch_day = int(time.time()) // 86400
        
        for day_offset in range(days):
            fixtures = await self.get_fixtures(now_epoch_day + day_offset)
            all_fixtures.extend(fixtures)
        
        # Filter to future only
        now = int(time.time())
        future_fixtures = [f for f in all_fixtures if f.start_time > now]
        
        log.info("upcoming_fixtures", total=len(all_fixtures), future=len(future_fixtures))
        return future_fixtures

    # ── Odds ────────────────────────────────────────────────────

    async def get_odds_snapshot(self, fixture_id: int) -> list[TxoddsOdds]:
        """
        Get odds snapshots for a fixture.
        
        Returns all available odds lines (multiple bookmakers).
        """
        resp = await self._http.get(
            f"odds/snapshot/{fixture_id}",
            headers=self._headers(),
        )
        
        if resp.status_code == 401:
            await self.authenticate()
            resp = await self._http.get(
                f"odds/snapshot/{fixture_id}",
                headers=self._headers(),
            )
        
        resp.raise_for_status()
        data = resp.json()
        
        if not isinstance(data, list):
            data = [data]
        
        odds_list = []
        for item in data:
            prices = item.get("prices", [])
            # Convert to basis points if decimal
            converted_prices = []
            for p in prices:
                if p < 100:  # Likely decimal odds like 1.5, 2.0
                    converted_prices.append(int(p * 10000))
                else:  # Already in BPS
                    converted_prices.append(p)
            
            odds_list.append(TxoddsOdds(
                fixture_id=item["fixtureId"],
                ts=item["ts"],
                prices=converted_prices,
                price_names=item.get("priceNames", []),
                bookmaker=item.get("bookmaker", "unknown"),
                in_running=item.get("inRunning", False),
            ))
        
        log.debug("odds_snapshot", fixture_id=fixture_id, lines=len(odds_list))
        return odds_list

    async def get_best_odds(self, fixture_id: int) -> Optional[TxoddsOdds]:
        """
        Get the consensus/best odds for a fixture.
        Returns the first odds line (typically the consensus).
        """
        odds_list = await self.get_odds_snapshot(fixture_id)
        if not odds_list:
            return None
        return odds_list[0]

    # ── Scores ───────────────────────────────────────────────────

    async def get_scores(self, fixture_id: int) -> list[TxoddsScore]:
        """
        Get score records for a fixture.
        
        For settlement, look for:
        - action="game_finalised" with status_id=100, period=100
        """
        resp = await self._http.get(
            f"scores/{fixture_id}",
            headers=self._headers(),
        )
        
        if resp.status_code == 401:
            await self.authenticate()
            resp = await self._http.get(
                f"scores/{fixture_id}",
                headers=self._headers(),
            )
        
        resp.raise_for_status()
        data = resp.json()
        
        if not isinstance(data, list):
            data = [data]
        
        scores = []
        for item in data:
            scores.append(TxoddsScore(
                fixture_id=item["fixtureId"],
                seq=item.get("seq") or item.get("Seq"),
                home_score=item.get("homeScore", 0),
                away_score=item.get("awayScore", 0),
                status_id=item.get("statusId", 0),
                period=item.get("period", 0),
                action=item.get("action", ""),
                ts=item.get("ts", 0),
            ))
        
        return scores

    async def get_final_result(self, fixture_id: int) -> Optional[TxoddsResult]:
        """
        Get the final result for a fixture.
        
        Looks for game_finalised action with status_id=100, period=100.
        """
        scores = await self.get_scores(fixture_id)
        
        # Look for final result
        for score in scores:
            if score.action == "game_finalised" and score.status_id == 100 and score.period == 100:
                # Determine winning outcome
                if score.home_score > score.away_score:
                    winning = 0  # home
                elif score.away_score > score.home_score:
                    winning = 2  # away
                else:
                    winning = 1  # draw
                
                return TxoddsResult(
                    fixture_id=fixture_id,
                    home_team="Home",  # Would need to fetch fixture details
                    away_team="Away",
                    home_score=score.home_score,
                    away_score=score.away_score,
                    winning_outcome=winning,
                    market_type="1x2",  # Default, can be derived from price_names
                )
        
        return None

    async def build_final_settlement_proof(self, fixture_id: int) -> Optional[dict]:
        """
        Build the TxLINE V2 proof bundle used by settle_with_proof.

        The bot validates the final score record with statKeys 1002 and 1003,
        which matches the current devnet example shape and gives us a proof
        payload that can be consumed by the on-chain Txoracle CPI.
        """
        scores = await self.get_scores_sequence(fixture_id)
        final_record = next(
            (
                score
                for score in scores
                if score.action == "game_finalised" and score.status_id == 100 and score.period == 100
            ),
            None,
        )
        if final_record is None or final_record.seq is None:
            return None

        resp = await self._http.get(
            "scores/stat-validation",
            params={
                "fixtureId": fixture_id,
                "seq": final_record.seq,
                "statKeys": "1002,1003",
            },
            headers=self._headers(),
        )
        if resp.status_code == 401:
            await self.authenticate()
            resp = await self._http.get(
                "scores/stat-validation",
                params={
                    "fixtureId": fixture_id,
                    "seq": final_record.seq,
                    "statKeys": "1002,1003",
                },
                headers=self._headers(),
            )
        resp.raise_for_status()
        validation = resp.json()

        return build_final_settlement_proof_bundle(validation, final_record)

    async def get_scores_sequence(self, fixture_id: int) -> list[TxoddsScore]:
        """Get the full sequence of score updates."""
        resp = await self._http.get(
            f"scores/sequence/{fixture_id}",
            headers=self._headers(),
        )
        
        if resp.status_code == 401:
            await self.authenticate()
            resp = await self._http.get(
                f"scores/sequence/{fixture_id}",
                headers=self._headers(),
            )
        
        resp.raise_for_status()
        data = resp.json()
        
        scores = []
        for item in data:
            scores.append(TxoddsScore(
                fixture_id=item["fixtureId"],
                seq=item.get("seq") or item.get("Seq"),
                home_score=item.get("homeScore", 0),
                away_score=item.get("awayScore", 0),
                status_id=item.get("statusId", 0),
                period=item.get("period", 0),
                action=item.get("action", ""),
                ts=item.get("ts", 0),
            ))
        
        return scores

    # ── Validation ──────────────────────────────────────────────

    async def validate_odds_proof(self, fixture_id: int, proof: dict) -> bool:
        """
        Validate odds against on-chain Merkle proof.
        
        This is for trustless verification.
        """
        # TODO: Implement Merkle proof verification
        log.info("odds_proof_validation", fixture_id=fixture_id)
        return True

    async def validate_score_proof(self, fixture_id: int, proof: dict) -> bool:
        """
        Validate scores against on-chain Merkle proof.
        """
        # TODO: Implement score proof verification
        log.info("score_proof_validation", fixture_id=fixture_id)
        return True


# ─── Helper Functions ────────────────────────────────────────────

def odds_to_basis_points(odds: float) -> int:
    """Convert decimal odds to basis points."""
    return int(odds * 10000)


def basis_points_to_odds(bps: int) -> float:
    """Convert basis points to decimal odds."""
    return bps / 10000.0


def derive_market_odds(
    fixture_id: int,
    odds_snapshot: TxoddsOdds,
    market_type: MarketType,
) -> list[int]:
    """
    Derive market-specific odds from the odds snapshot.
    
    Args:
        fixture_id: The fixture ID
        odds_snapshot: The odds snapshot
        market_type: Which market (1x2, over_under, gg_ng)
    
    Returns:
        List of odds in basis points for each outcome
    """
    prices = odds_snapshot.prices
    
    if market_type == MarketType.ONE_X_TWO:
        # 3-way: home, draw, away
        if len(prices) >= 3:
            return prices[:3]
        elif len(prices) == 2:
            # 2-way market, map to home/away
            return [prices[0], 30000, prices[1]]  # Estimate draw as 3.0x
        else:
            return [20000, 35000, 30000]  # Default
    
    elif market_type == MarketType.OVER_UNDER:
        # 2-way: over, under
        # txodds might not have this, so estimate from 1x2
        if len(prices) >= 2:
            # Estimate O/U based on implied probabilities
            over_odds = int(20000 * (sum(prices) / len(prices)) / prices[0]) if prices[0] > 0 else 20000
            return [over_odds, int(over_odds * 0.95)]  # Under slightly lower
        return [18000, 19000]  # Default 1.8x, 1.9x
    
    elif market_type == MarketType.GG_NG:
        # 2-way: GG (both score), NG (one or neither scores)
        # Estimate based on total goals probability
        if len(prices) >= 3:
            # High-scoring games more likely GG
            implied_total = sum(prices) / len(prices)
            gg_odds = int(17000 * implied_total / 20000) if implied_total > 0 else 17000
            return [max(gg_odds, 15000), max(20000 - gg_odds + 15000, 18000)]
        return [17000, 20000]  # Default 1.7x GG, 2.0x NG
    
    return [20000, 20000]

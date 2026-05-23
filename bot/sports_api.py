"""
Sports data client using The-Odds-API (https://the-odds-api.com).

Free tier: 500 requests/month. The bot uses two endpoints:
  - /sports/{sport}/odds  — upcoming fixtures with odds (to create markets)
  - /sports/{sport}/scores — completed scores (to settle markets)

Outcome mapping:
  2-way markets (e.g. tennis): outcome_id 0 = home/player1, 1 = away/player2
  3-way markets (e.g. soccer): outcome_id 0 = home, 1 = draw, 2 = away
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
import structlog

log = structlog.get_logger(__name__)

BASE_URL = "https://api.the-odds-api.com/v4"


@dataclass
class Fixture:
    """A single upcoming match."""
    event_id: str           # The-Odds-API event ID (used to look up scores later)
    sport_key: str
    home_team: str
    away_team: str
    start_time: int         # Unix timestamp (UTC)
    has_draw: bool          # True for soccer/3-way markets


@dataclass
class SettledResult:
    """A completed match with a known winner."""
    event_id: str
    sport_key: str
    home_team: str
    away_team: str
    winning_outcome: int    # 0=home, 1=draw (3-way only), 2=away (or 1 for 2-way)
    completed: bool


# Sports that have a draw outcome (3-way markets)
THREE_WAY_SPORTS = {
    "soccer_epl",
    "soccer_uefa_champs_league",
    "soccer_uefa_europa_league",
    "soccer_spain_la_liga",
    "soccer_germany_bundesliga",
    "soccer_italy_serie_a",
    "soccer_france_ligue_one",
}


class OddsApiClient:
    def __init__(self, api_key: str, sports: list[str]) -> None:
        self._key = api_key
        self._sports = sports
        self._http = httpx.AsyncClient(base_url=BASE_URL, timeout=15.0)

    async def close(self) -> None:
        await self._http.aclose()

    # ── Upcoming fixtures ──────────────────────────────────────────────────────

    async def upcoming_fixtures(self, lookahead_seconds: int) -> list[Fixture]:
        """
        Return fixtures starting within the next `lookahead_seconds`.
        Uses the /odds endpoint (also returns start times without consuming
        the scores quota).
        """
        now = int(time.time())
        cutoff = now + lookahead_seconds
        fixtures: list[Fixture] = []

        for sport in self._sports:
            try:
                resp = await self._http.get(
                    f"/sports/{sport}/odds",
                    params={
                        "apiKey": self._key,
                        "regions": "eu",
                        "markets": "h2h",
                        "oddsFormat": "decimal",
                        "dateFormat": "unix",
                    },
                )
                resp.raise_for_status()
                events = resp.json()
                remaining = resp.headers.get("x-requests-remaining", "?")
                log.debug("odds_api_response", sport=sport, events=len(events), remaining=remaining)

                for ev in events:
                    start = int(ev["commence_time"])
                    if start <= now or start > cutoff:
                        continue
                    fixtures.append(Fixture(
                        event_id=ev["id"],
                        sport_key=sport,
                        home_team=ev["home_team"],
                        away_team=ev["away_team"],
                        start_time=start,
                        has_draw=sport in THREE_WAY_SPORTS,
                    ))
            except httpx.HTTPStatusError as exc:
                log.warning("odds_api_error", sport=sport, status=exc.response.status_code)
            except Exception as exc:
                log.warning("odds_api_exception", sport=sport, error=str(exc))

        log.info("upcoming_fixtures", count=len(fixtures))
        return fixtures

    # ── Scores / results ───────────────────────────────────────────────────────

    async def completed_scores(self, sport: str, days_from: int = 1) -> list[SettledResult]:
        """
        Return completed matches for a sport from the last `days_from` days.
        """
        results: list[SettledResult] = []
        try:
            resp = await self._http.get(
                f"/sports/{sport}/scores",
                params={
                    "apiKey": self._key,
                    "daysFrom": days_from,
                    "dateFormat": "unix",
                },
            )
            resp.raise_for_status()
            events = resp.json()

            for ev in events:
                if not ev.get("completed"):
                    continue
                scores = ev.get("scores") or []
                if len(scores) < 2:
                    continue

                # scores is a list of {"name": team, "score": "N"} dicts
                score_map = {s["name"]: int(s["score"]) for s in scores}
                home = ev["home_team"]
                away = ev["away_team"]
                home_score = score_map.get(home, 0)
                away_score = score_map.get(away, 0)
                has_draw = sport in THREE_WAY_SPORTS

                if home_score > away_score:
                    winning_outcome = 0  # home
                elif away_score > home_score:
                    winning_outcome = 2 if has_draw else 1  # away
                else:
                    winning_outcome = 1 if has_draw else None  # draw

                if winning_outcome is None:
                    # Draw in a 2-way market — shouldn't happen but skip safely
                    log.warning("unexpected_draw_in_2way", event_id=ev["id"])
                    continue

                results.append(SettledResult(
                    event_id=ev["id"],
                    sport_key=sport,
                    home_team=home,
                    away_team=away,
                    winning_outcome=winning_outcome,
                    completed=True,
                ))
        except httpx.HTTPStatusError as exc:
            log.warning("scores_api_error", sport=sport, status=exc.response.status_code)
        except Exception as exc:
            log.warning("scores_api_exception", sport=sport, error=str(exc))

        return results

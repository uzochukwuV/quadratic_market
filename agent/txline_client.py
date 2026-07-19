from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from dotenv import load_dotenv

NETWORKS = {
    "devnet": "https://txline-dev.txodds.com",
    "mainnet": "https://txline.txodds.com",
}

load_dotenv()
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
load_dotenv(Path(__file__).resolve().parents[1] / "bot" / ".env", override=False)


def first(item: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in item and item[key] is not None:
            return item[key]
    return default


def read_api_token() -> str:
    token = os.getenv("TXODDS_API_TOKEN") or os.getenv("TXODDS_API_TOKEN_VALUE")
    if token:
        return token.strip()

    token_file = os.getenv("TXODDS_API_TOKEN_FILE")
    if token_file:
        return Path(token_file).expanduser().read_text().strip()

    token = os.getenv("TXODDS_API_KEY") or os.getenv("ODDS_API_KEY")
    if token:
        return token.strip()

    raise RuntimeError("Missing TxLINE API token. Set TXODDS_API_TOKEN_FILE or TXODDS_API_TOKEN.")


def as_seconds(value: Any) -> int:
    if value is None:
        return 0
    numeric = int(value)
    return numeric // 1000 if numeric > 10**12 else numeric


def decimal_odds(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    return numeric / 1000 if numeric >= 100 else numeric


def implied_probability(odds: float) -> float:
    return 1 / odds if odds > 1 else 0


@dataclass
class SseMessage:
    event: str | None
    data: str
    id: str | None = None


def parse_sse_block(block: str) -> SseMessage | None:
    event = None
    mid = None
    data = ""
    for raw_line in block.splitlines():
        if not raw_line or raw_line.startswith(":"):
            continue
        field, _, value = raw_line.partition(":")
        value = value.lstrip(" ")
        if field == "event":
            event = value
        elif field == "id":
            mid = value
        elif field == "data":
            data += f"{value}\n"
    data = data.rstrip("\n")
    return SseMessage(event=event, id=mid, data=data) if event or mid or data else None


def parse_sse_data(data: str) -> Any:
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        return data


class TxlineClient:
    def __init__(self, network: str = "devnet", timeout: float = 15.0) -> None:
        if network not in NETWORKS:
            raise ValueError(f"Unsupported network {network}")
        self.network = network
        self.origin = NETWORKS[network]
        self.timeout = timeout
        self.api_token = read_api_token()
        self.jwt: str | None = None
        self.http = httpx.AsyncClient(base_url=f"{self.origin}/api/", timeout=timeout)

    async def close(self) -> None:
        await self.http.aclose()

    async def authenticate(self) -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(f"{self.origin}/auth/guest/start", json={})
        response.raise_for_status()
        payload = response.json()
        token = payload.get("token") or payload.get("access_token")
        if not token:
            raise RuntimeError(f"Guest auth response missing token; keys={list(payload.keys())}")
        self.jwt = token
        return token

    def headers(self, stream: bool = False) -> dict[str, str]:
        if not self.jwt:
            raise RuntimeError("Call authenticate() first.")
        headers = {
            "Authorization": f"Bearer {self.jwt}",
            "X-Api-Token": self.api_token,
        }
        if stream:
            headers.update({"Accept": "text/event-stream", "Cache-Control": "no-cache"})
        else:
            headers["Content-Type"] = "application/json"
        return headers

    async def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        response = await self.http.get(path, params=params, headers=self.headers())
        if response.status_code == 401:
            await self.authenticate()
            response = await self.http.get(path, params=params, headers=self.headers())
        response.raise_for_status()
        return response.json()

    async def fixtures_for_day(self, epoch_day: int) -> list[dict[str, Any]]:
        try:
            data = await self.get_json("fixtures/snapshot", {"epochDay": epoch_day})
        except (httpx.HTTPError, json.JSONDecodeError):
            return []
        if not isinstance(data, list):
            data = [data]
        fixtures = []
        for item in data:
            fixtures.append(
                {
                    "fixture_id": int(first(item, "fixtureId", "FixtureId")),
                    "home_team": str(first(item, "homeTeam", "HomeTeam", "Participant1", default="Home")),
                    "away_team": str(first(item, "awayTeam", "AwayTeam", "Participant2", default="Away")),
                    "start_time": as_seconds(first(item, "startTime", "StartTime", default=0)),
                    "league_id": first(item, "leagueId", "LeagueId", "CompetitionId"),
                    "league_name": first(item, "leagueName", "LeagueName", "Competition", default="Unknown"),
                    "sport_key": first(item, "sportKey", "SportKey", default="soccer"),
                }
            )
        return fixtures

    async def fixtures_window(self, days_back: int = 1, days_forward: int = 14) -> list[dict[str, Any]]:
        today = int(time.time()) // 86400
        days = range(today - days_back, today + days_forward + 1)
        nested = await asyncio.gather(*(self.fixtures_for_day(day) for day in days))
        by_id = {fixture["fixture_id"]: fixture for items in nested for fixture in items}
        return sorted(by_id.values(), key=lambda fixture: fixture["start_time"])

    async def fixture(self, fixture_id: int) -> dict[str, Any] | None:
        for fixture in await self.fixtures_window(days_back=30, days_forward=180):
            if fixture["fixture_id"] == fixture_id:
                return fixture
        return None

    async def odds_snapshot(self, fixture_id: int) -> list[dict[str, Any]]:
        try:
            data = await self.get_json(f"odds/snapshot/{fixture_id}")
        except (httpx.HTTPError, json.JSONDecodeError):
            return []
        if not isinstance(data, list):
            data = [data]
        return data

    async def scores(self, fixture_id: int, mode: str = "scores") -> list[dict[str, Any]]:
        paths = {
            "scores": f"scores/{fixture_id}",
            "sequence": f"scores/sequence/{fixture_id}",
            "historical": f"scores/historical/{fixture_id}",
        }
        try:
            data = await self.get_json(paths[mode])
        except (httpx.HTTPError, json.JSONDecodeError):
            return []
        if not isinstance(data, list):
            data = [data]
        return data

    async def stream(self, stream_name: str) -> AsyncGenerator[SseMessage, None]:
        url = f"{self.origin}/api/{stream_name}/stream"
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", url, headers=self.headers(stream=True)) as response:
                response.raise_for_status()
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n\n" in buffer or "\r\n\r\n" in buffer:
                        sep = "\r\n\r\n" if "\r\n\r\n" in buffer else "\n\n"
                        block, buffer = buffer.split(sep, 1)
                        message = parse_sse_block(block)
                        if message:
                            yield message


def normalize_odds_line(line: dict[str, Any]) -> dict[str, Any]:
    prices = first(line, "prices", "Prices", default=[]) or []
    pcts = first(line, "pct", "Pct", default=[]) or []
    names = first(line, "priceNames", "PriceNames", default=[]) or []
    raw_prices = []
    for price in prices:
        try:
            raw_prices.append(float(price))
        except (TypeError, ValueError):
            raw_prices.append(0.0)
    raw_pcts = []
    for pct in pcts:
        try:
            raw_pcts.append(float(pct))
        except (TypeError, ValueError):
            raw_pcts.append(0.0)

    unit_probability_prices = bool(raw_prices) and all(0 <= price <= 1 for price in raw_prices) and any(price > 0 for price in raw_prices)
    if raw_pcts:
        odds = [decimal_odds(price) for price in raw_prices]
        implied = [round((pct / 100) if pct > 1 else pct, 4) for pct in raw_pcts]
        price_format = "scaled_decimal"
    elif unit_probability_prices:
        odds = [round(1 / price, 4) if price > 0 else 0 for price in raw_prices]
        implied = [round(price, 4) for price in raw_prices]
        price_format = "probability"
    else:
        odds = [decimal_odds(price) for price in raw_prices]
        implied = [round(implied_probability(odd), 4) for odd in odds]
        price_format = "decimal_or_bps"

    return {
        "fixture_id": first(line, "fixtureId", "FixtureId"),
        "bookmaker": first(line, "bookmaker", "Bookmaker", default="unknown"),
        "game_state": first(line, "gameState", "GameState", default="unknown"),
        "in_running": bool(first(line, "inRunning", "InRunning", default=False)),
        "market": first(line, "superOddsType", "SuperOddsType", "MarketParameters", default="unknown"),
        "price_names": names,
        "raw_prices": raw_prices,
        "odds": odds,
        "implied": implied,
        "price_format": price_format,
        "ts": int(first(line, "ts", "Ts", default=0) or 0),
    }


def normalize_score_line(line: dict[str, Any], fixture_id: int) -> dict[str, Any]:
    return {
        "fixture_id": int(first(line, "fixtureId", "FixtureId", default=fixture_id)),
        "seq": first(line, "seq", "Seq"),
        "home_score": int(first(line, "homeScore", "HomeScore", "Participant1Score", default=0) or 0),
        "away_score": int(first(line, "awayScore", "AwayScore", "Participant2Score", default=0) or 0),
        "game_state": first(line, "gameState", "GameState", default=None),
        "action": first(line, "action", "Action", default=""),
        "status_id": first(line, "statusId", "StatusId", default=None),
        "period": first(line, "period", "Period", default=None),
        "ts": int(first(line, "ts", "Ts", default=0) or 0),
    }

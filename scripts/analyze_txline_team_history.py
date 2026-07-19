#!/usr/bin/env python3
"""Build an AI-ready team history profile from TxLINE fixtures and scores.

This is a standalone local research script. It does not import or start the bot.
It reads the API token with the same env names used by the bot:
TXODDS_API_TOKEN, TXODDS_API_TOKEN_FILE, TXODDS_API_KEY, or ODDS_API_KEY.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from json import JSONDecodeError
import os
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv


NETWORKS = {
    "devnet": "https://txline-dev.txodds.com",
    "mainnet": "https://txline.txodds.com",
}

load_dotenv()
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

    raise SystemExit("Missing TxLINE API token env or file.")


def as_seconds(value: Any) -> int:
    if value is None:
        return 0
    numeric = int(value)
    return numeric // 1000 if numeric > 10**12 else numeric


def normalize_fixture(item: dict[str, Any], epoch_day: int) -> dict[str, Any]:
    fixture_id = int(first(item, "fixtureId", "FixtureId"))
    return {
        "fixture_id": fixture_id,
        "home_team": str(first(item, "homeTeam", "HomeTeam", "Participant1", default="Home")),
        "away_team": str(first(item, "awayTeam", "AwayTeam", "Participant2", default="Away")),
        "start_time": as_seconds(first(item, "startTime", "StartTime", default=0)),
        "league_id": first(item, "leagueId", "LeagueId", "CompetitionId"),
        "league_name": first(item, "leagueName", "LeagueName", "Competition", default="Unknown"),
        "sport_key": first(item, "sportKey", "SportKey", default="soccer"),
        "epoch_day": epoch_day,
    }


def normalize_score(item: dict[str, Any], fixture_id: int) -> dict[str, Any]:
    return {
        "fixture_id": int(first(item, "fixtureId", "FixtureId", default=fixture_id)),
        "seq": first(item, "seq", "Seq"),
        "home_score": int(first(item, "homeScore", "HomeScore", "Participant1Score", default=0) or 0),
        "away_score": int(first(item, "awayScore", "AwayScore", "Participant2Score", default=0) or 0),
        "status_id": int(first(item, "statusId", "StatusId", default=0) or 0),
        "period": int(first(item, "period", "Period", default=0) or 0),
        "action": str(first(item, "action", "Action", default="")),
        "game_state": first(item, "gameState", "GameState", default=None),
        "ts": int(first(item, "ts", "Ts", default=0) or 0),
        "raw_keys": sorted(item.keys()),
    }


async def get_guest_jwt(origin: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{origin}/auth/guest/start", json={})
    response.raise_for_status()
    payload = response.json()
    token = payload.get("token") or payload.get("access_token")
    if not token:
        raise RuntimeError(f"Guest auth response missing token; keys={list(payload.keys())}")
    return token


class TxlineResearchClient:
    def __init__(self, origin: str, api_token: str, jwt: str, timeout: float) -> None:
        self.origin = origin
        self.headers = {
            "Authorization": f"Bearer {jwt}",
            "X-Api-Token": api_token,
            "Content-Type": "application/json",
        }
        self.http = httpx.AsyncClient(base_url=f"{origin}/api/", timeout=timeout)

    async def close(self) -> None:
        await self.http.aclose()

    async def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        response = await self.http.get(path, params=params, headers=self.headers)
        response.raise_for_status()
        try:
            return response.json()
        except JSONDecodeError:
            raise RuntimeError(f"non_json_response:{response.status_code}:{path}")

    async def fixtures_for_day(self, epoch_day: int) -> list[dict[str, Any]]:
        try:
            data = await self.get_json("fixtures/snapshot", {"epochDay": epoch_day})
        except httpx.HTTPStatusError:
            return []
        except httpx.TimeoutException:
            return []
        if not isinstance(data, list):
            data = [data]
        return [normalize_fixture(item, epoch_day) for item in data]

    async def scores(self, fixture_id: int, mode: str) -> list[dict[str, Any]]:
        paths = {
            "current": f"scores/{fixture_id}",
            "sequence": f"scores/sequence/{fixture_id}",
            "historical": f"scores/historical/{fixture_id}",
        }
        try:
            data = await self.get_json(paths[mode])
        except httpx.HTTPStatusError as exc:
            return [{"fixture_id": fixture_id, "error": f"{mode}:{exc.response.status_code}"}]
        except httpx.TimeoutException:
            return [{"fixture_id": fixture_id, "error": f"{mode}:timeout"}]
        except RuntimeError as exc:
            return [{"fixture_id": fixture_id, "error": f"{mode}:{exc}"}]
        if not isinstance(data, list):
            data = [data]
        return [normalize_score(item, fixture_id) for item in data]


def final_score(scores: list[dict[str, Any]]) -> dict[str, Any] | None:
    valid = [score for score in scores if "error" not in score]
    if not valid:
        return None
    finals = [
        score for score in valid
        if score.get("action") == "game_finalised"
        or score.get("status_id") in {100, 9}
        or str(score.get("game_state") or "").lower() in {"f", "ft", "finished", "final"}
    ]
    if finals:
        return sorted(finals, key=lambda score: int(score.get("ts") or 0))[-1]
    return sorted(valid, key=lambda score: int(score.get("ts") or 0))[-1]


def team_result(team: str, fixture: dict[str, Any], score: dict[str, Any]) -> dict[str, Any]:
    home = fixture["home_team"]
    away = fixture["away_team"]
    is_home = home.lower() == team.lower()
    gf = score["home_score"] if is_home else score["away_score"]
    ga = score["away_score"] if is_home else score["home_score"]
    if gf > ga:
        result = "win"
    elif gf < ga:
        result = "loss"
    else:
        result = "draw"
    return {
        "fixture_id": fixture["fixture_id"],
        "date": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(fixture["start_time"])),
        "competition": fixture["league_name"],
        "home_team": home,
        "away_team": away,
        "team_side": "home" if is_home else "away",
        "team_goals": gf,
        "opponent_goals": ga,
        "score": f"{score['home_score']}-{score['away_score']}",
        "result": result,
        "btts": score["home_score"] > 0 and score["away_score"] > 0,
        "over_2_5": score["home_score"] + score["away_score"] > 2,
        "source_action": score.get("action"),
        "source_seq": score.get("seq"),
    }


def summarize_team(team: str, fixtures: list[dict[str, Any]], match_results: list[dict[str, Any]]) -> dict[str, Any]:
    results = Counter(match["result"] for match in match_results)
    goals_for = sum(match["team_goals"] for match in match_results)
    goals_against = sum(match["opponent_goals"] for match in match_results)
    played = len(match_results)
    upcoming = [fixture for fixture in fixtures if fixture["start_time"] > int(time.time())]

    return {
        "team": team,
        "fixtures_found": len(fixtures),
        "completed_matches_with_scores": played,
        "upcoming_matches": len(upcoming),
        "record": {
            "wins": results["win"],
            "draws": results["draw"],
            "losses": results["loss"],
        },
        "goals": {
            "for": goals_for,
            "against": goals_against,
            "for_per_match": round(goals_for / played, 2) if played else None,
            "against_per_match": round(goals_against / played, 2) if played else None,
        },
        "rates": {
            "btts": round(sum(1 for match in match_results if match["btts"]) / played, 2) if played else None,
            "over_2_5": round(sum(1 for match in match_results if match["over_2_5"]) / played, 2) if played else None,
        },
        "strengths": derive_strengths(match_results),
        "weaknesses": derive_weaknesses(match_results),
        "matches": match_results,
        "upcoming": upcoming[:8],
        "ai_context": build_ai_context(team, match_results, upcoming),
    }


def derive_strengths(matches: list[dict[str, Any]]) -> list[str]:
    if not matches:
        return ["No completed TxLINE score history found in the scanned window."]
    strengths = []
    wins = sum(1 for match in matches if match["result"] == "win")
    clean = sum(1 for match in matches if match["opponent_goals"] == 0)
    scored = sum(1 for match in matches if match["team_goals"] > 0)
    if wins / len(matches) >= 0.5:
        strengths.append("Positive recent result profile in scanned TxLINE fixtures.")
    if scored / len(matches) >= 0.7:
        strengths.append("Consistently gets on the scoresheet.")
    if clean / len(matches) >= 0.4:
        strengths.append("Shows clean-sheet potential.")
    return strengths or ["No clear statistical strength from completed matches in the scanned window."]


def derive_weaknesses(matches: list[dict[str, Any]]) -> list[str]:
    if not matches:
        return ["Insufficient completed score history for weakness detection."]
    weaknesses = []
    conceded = sum(1 for match in matches if match["opponent_goals"] > 0)
    losses = sum(1 for match in matches if match["result"] == "loss")
    low_scoring = sum(1 for match in matches if match["team_goals"] == 0)
    if conceded / len(matches) >= 0.7:
        weaknesses.append("Often concedes in the scanned sample.")
    if losses / len(matches) >= 0.5:
        weaknesses.append("Recent result profile leans negative.")
    if low_scoring / len(matches) >= 0.4:
        weaknesses.append("Scoring reliability is a concern.")
    return weaknesses or ["No clear statistical weakness from completed matches in the scanned window."]


def build_ai_context(team: str, matches: list[dict[str, Any]], upcoming: list[dict[str, Any]]) -> str:
    if not matches:
        return (
            f"For {team}, the scanned TxLINE window contains upcoming fixtures but no completed "
            "score history. The AI should rely more heavily on live odds movement, score state, "
            "lineups/events when available, and clearly tell the user that historical confidence is limited."
        )
    last = matches[-5:]
    form = "".join(match["result"][0].upper() for match in last)
    return (
        f"{team} recent TxLINE form sample: {form}. "
        f"Use the listed matches, goals for/against, BTTS rate, over 2.5 rate, and upcoming opponent "
        "to explain likely match direction, scoring risk, and uncertainty."
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", choices=sorted(NETWORKS), default=os.getenv("TXODDS_NETWORK", "devnet"))
    parser.add_argument("--team", default="", help="Team name. If omitted, picks the team with the most fixtures.")
    parser.add_argument("--days-back", type=int, default=14)
    parser.add_argument("--days-forward", type=int, default=14)
    parser.add_argument("--max-fixtures", type=int, default=12)
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--include-future-scores", action="store_true")
    parser.add_argument("--list-teams", action="store_true")
    parser.add_argument("--output", default="", help="Optional JSON output path.")
    args = parser.parse_args()

    origin = NETWORKS[args.network]
    token = read_api_token()
    jwt = await get_guest_jwt(origin)
    client = TxlineResearchClient(origin, token, jwt, args.timeout)

    try:
        today = int(time.time()) // 86400
        days = list(range(today - args.days_back, today + args.days_forward + 1))
        fixtures_nested = await asyncio.gather(*(client.fixtures_for_day(day) for day in days))
        fixtures = [fixture for day_fixtures in fixtures_nested for fixture in day_fixtures]

        fixtures_by_id = {fixture["fixture_id"]: fixture for fixture in fixtures}
        fixtures = list(fixtures_by_id.values())

        by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for fixture in fixtures:
            by_team[fixture["home_team"]].append(fixture)
            by_team[fixture["away_team"]].append(fixture)

        if not by_team:
            print("No fixtures found in scanned TxLINE window.")
            return 1

        if args.list_teams:
            listing = [
                {
                    "team": team_name,
                    "fixtures": len(team_fixtures),
                    "fixture_ids": sorted({fixture["fixture_id"] for fixture in team_fixtures})[:10],
                }
                for team_name, team_fixtures in sorted(by_team.items(), key=lambda item: (-len(item[1]), item[0]))
            ]
            print(json.dumps({"team_count": len(listing), "teams": listing[:50]}, indent=2))
            return 0

        team = args.team
        if not team:
            team = max(by_team.items(), key=lambda item: len(item[1]))[0]
        if team not in by_team:
            lowered = {name.lower(): name for name in by_team}
            team = lowered.get(team.lower(), team)
        if team not in by_team:
            print(f"Team not found: {args.team}")
            print("Available teams:", ", ".join(sorted(by_team)[:50]))
            return 1

        team_fixtures = sorted(by_team[team], key=lambda fixture: fixture["start_time"])
        match_results = []
        score_candidates = [
            fixture
            for fixture in team_fixtures
            if args.include_future_scores or fixture["start_time"] <= int(time.time())
        ][: args.max_fixtures]

        for fixture in score_candidates:
            current = await client.scores(fixture["fixture_id"], "current")
            sequence = await client.scores(fixture["fixture_id"], "sequence")
            historical = await client.scores(fixture["fixture_id"], "historical")
            score = final_score([*current, *sequence, *historical])
            if score:
                match_results.append(team_result(team, fixture, score))

        profile = summarize_team(team, team_fixtures, match_results)
        print(json.dumps(profile, indent=2, sort_keys=True))
        if args.output:
            Path(args.output).write_text(json.dumps(profile, indent=2, sort_keys=True))
            print(f"Wrote {args.output}")
        return 0
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

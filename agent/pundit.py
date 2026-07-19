from __future__ import annotations

import json
import os
import time
from collections import Counter
from typing import Any

import httpx

from .txline_client import TxlineClient, first, normalize_odds_line, normalize_score_line, parse_sse_data


def outcome_labels(names: list[Any], home: str, away: str) -> list[str]:
    mapped = []
    for name in names:
        normalized = str(name).strip().lower()
        if normalized in {"part1", "participant1", "home", "1"}:
            mapped.append(home)
        elif normalized in {"part2", "participant2", "away", "2"}:
            mapped.append(away)
        elif normalized in {"draw", "x", "tie"}:
            mapped.append("Draw")
        else:
            mapped.append(str(name))
    return mapped if mapped else [home, "Draw", away]


def final_score(scores: list[dict[str, Any]], fixture_id: int) -> dict[str, Any] | None:
    normalized = [normalize_score_line(score, fixture_id) for score in scores]
    if not normalized:
        return None
    finals = [
        score for score in normalized
        if str(score.get("action")).lower() == "game_finalised"
        or str(score.get("game_state")).lower() in {"f", "ft", "final", "finished"}
        or score.get("status_id") in {9, 100}
    ]
    pool = finals or normalized
    return sorted(pool, key=lambda score: int(score.get("ts") or 0))[-1]


def team_match_result(team: str, fixture: dict[str, Any], score: dict[str, Any]) -> dict[str, Any]:
    home = fixture["home_team"]
    away = fixture["away_team"]
    is_home = home.lower() == team.lower()
    gf = score["home_score"] if is_home else score["away_score"]
    ga = score["away_score"] if is_home else score["home_score"]
    return {
        "fixture_id": fixture["fixture_id"],
        "opponent": away if is_home else home,
        "side": "home" if is_home else "away",
        "team_goals": gf,
        "opponent_goals": ga,
        "result": "win" if gf > ga else "loss" if gf < ga else "draw",
        "btts": score["home_score"] > 0 and score["away_score"] > 0,
        "over_2_5": score["home_score"] + score["away_score"] > 2,
    }


def summarize_profile(team: str, matches: list[dict[str, Any]], fixture_count: int) -> dict[str, Any]:
    played = len(matches)
    record = Counter(match["result"] for match in matches)
    gf = sum(match["team_goals"] for match in matches)
    ga = sum(match["opponent_goals"] for match in matches)
    strengths = []
    weaknesses = []

    if played == 0:
        strengths.append("No completed TxLINE score sample was found in the scanned window.")
        weaknesses.append("Historical confidence is limited; live odds and score movement matter more.")
    else:
        if gf / played >= 1.5:
            strengths.append("Scoring output has been strong in the scanned sample.")
        if record["win"] / played >= 0.5:
            strengths.append("Recent TxLINE result sample leans positive.")
        if ga / played >= 1.2:
            weaknesses.append("Concedes often enough to keep both-teams-to-score scenarios live.")
        if record["loss"] / played >= 0.5:
            weaknesses.append("Recent TxLINE result sample leans negative.")
        if not strengths:
            strengths.append("No dominant statistical strength in the scanned sample.")
        if not weaknesses:
            weaknesses.append("No obvious statistical weakness in the scanned sample.")

    return {
        "team": team,
        "fixture_count": fixture_count,
        "completed_matches": played,
        "record": {"wins": record["win"], "draws": record["draw"], "losses": record["loss"]},
        "goals_for_per_match": round(gf / played, 2) if played else None,
        "goals_against_per_match": round(ga / played, 2) if played else None,
        "btts_rate": round(sum(1 for match in matches if match["btts"]) / played, 2) if played else None,
        "over_2_5_rate": round(sum(1 for match in matches if match["over_2_5"]) / played, 2) if played else None,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "matches": matches[-5:],
    }


class PunditAgent:
    def __init__(self, client: TxlineClient) -> None:
        self.client = client

    async def list_matches(self) -> list[dict[str, Any]]:
        return await self.client.fixtures_window(days_back=1, days_forward=180)

    async def team_profile(self, team: str, fixtures: list[dict[str, Any]]) -> dict[str, Any]:
        team_fixtures = [
            fixture for fixture in fixtures
            if fixture["home_team"].lower() == team.lower() or fixture["away_team"].lower() == team.lower()
        ]
        now = int(time.time())
        matches = []
        for fixture in team_fixtures:
            if fixture["start_time"] > now:
                continue
            scores = [
                *(await self.client.scores(fixture["fixture_id"], "scores")),
                *(await self.client.scores(fixture["fixture_id"], "sequence")),
                *(await self.client.scores(fixture["fixture_id"], "historical")),
            ]
            score = final_score(scores, fixture["fixture_id"])
            if score:
                matches.append(team_match_result(team, fixture, score))
        return summarize_profile(team, matches, len(team_fixtures))

    async def match_context(self, fixture_id: int) -> dict[str, Any]:
        fixtures = await self.client.fixtures_window(days_back=30, days_forward=180)
        fixture = next((item for item in fixtures if item["fixture_id"] == fixture_id), None)
        if not fixture:
            raise ValueError(f"Fixture {fixture_id} not found in TxLINE fixture window.")

        odds_lines = [normalize_odds_line(line) for line in await self.client.odds_snapshot(fixture_id)]
        scores = await self.client.scores(fixture_id, "scores")
        latest_score = final_score(scores, fixture_id)
        home_profile = await self.team_profile(fixture["home_team"], fixtures)
        away_profile = await self.team_profile(fixture["away_team"], fixtures)

        return {
            "fixture": fixture,
            "score": latest_score,
            "odds": odds_lines[:5],
            "team_profiles": {
                fixture["home_team"]: home_profile,
                fixture["away_team"]: away_profile,
            },
            "generated_at": int(time.time()),
        }

    def deterministic_signal(self, context: dict[str, Any]) -> dict[str, Any]:
        fixture = context["fixture"]
        home = fixture["home_team"]
        away = fixture["away_team"]
        first_odds = context["odds"][0] if context["odds"] else {}
        odds = first_odds.get("odds", [])
        labels = outcome_labels(first_odds.get("price_names", []), home, away)
        implied = first_odds.get("implied", [])

        leader = None
        confidence = 0.5
        if len(odds) >= 3:
            best_index = max(range(min(3, len(implied))), key=lambda index: implied[index])
            leader = labels[best_index] if best_index < len(labels) else [home, "Draw", away][best_index]
            confidence = min(0.82, max(0.5, implied[best_index]))
        elif len(odds) >= 2:
            best_index = max(range(2), key=lambda index: implied[index])
            leader = labels[best_index] if best_index < len(labels) else f"Outcome {best_index}"
            confidence = min(0.78, max(0.5, implied[best_index]))

        score = context.get("score")
        if score and score["home_score"] != score["away_score"]:
            leader = home if score["home_score"] > score["away_score"] else away
            confidence = max(confidence, 0.68)

        return {
            "upper_hand": leader or "Too close to call",
            "confidence": round(confidence, 2),
            "market_basis": first_odds,
            "home_strengths": context["team_profiles"][home]["strengths"],
            "home_weaknesses": context["team_profiles"][home]["weaknesses"],
            "away_strengths": context["team_profiles"][away]["strengths"],
            "away_weaknesses": context["team_profiles"][away]["weaknesses"],
        }

    async def narrate(self, context: dict[str, Any], update: dict[str, Any] | None = None) -> str:
        signal = self.deterministic_signal(context)
        if os.getenv("OPENROUTER_API_KEY"):
            try:
                return await self.openrouter_narration(context, signal, update)
            except Exception as exc:
                return self.template_narration(context, signal, update, note=f"AI provider fallback: {exc}")
        if os.getenv("OPENAI_API_KEY"):
            try:
                return await self.openai_narration(context, signal, update)
            except Exception as exc:
                return self.template_narration(context, signal, update, note=f"AI provider fallback: {exc}")
        return self.template_narration(context, signal, update)

    def template_narration(self, context: dict[str, Any], signal: dict[str, Any], update: dict[str, Any] | None = None, note: str = "") -> str:
        fixture = context["fixture"]
        home = fixture["home_team"]
        away = fixture["away_team"]
        score = context.get("score")
        score_text = "not started" if not score else f"{score['home_score']}-{score['away_score']}"
        update_text = ""
        if update:
            update_text = f"\n\nLive update: {self.describe_update(update, home, away)}"

        return (
            f"{home} vs {away}: AI match read\n\n"
            f"Score state: {score_text}.\n"
            f"Upper hand: {signal['upper_hand']} with {int(signal['confidence'] * 100)}% signal confidence.\n\n"
            f"{home} strengths: {', '.join(signal['home_strengths'][:2])}\n"
            f"{home} concerns: {', '.join(signal['home_weaknesses'][:2])}\n\n"
            f"{away} strengths: {', '.join(signal['away_strengths'][:2])}\n"
            f"{away} concerns: {', '.join(signal['away_weaknesses'][:2])}\n\n"
            f"Story mode: the market is telling us where pressure is building, but this is not a sure outcome. "
            f"Watch the next odds move and the first real score/event swing; that is where the match narrative changes."
            f"{update_text}"
            f"{f'\\n\\n{note}' if note else ''}"
        )

    def describe_update(self, update: dict[str, Any], home: str, away: str) -> str:
        if update.get("type") == "odds":
            line = update["line"]
            odds = line.get("odds", [])
            implied = line.get("implied", [])
            labels = outcome_labels(line.get("price_names", []), home, away)
            if odds:
                if line.get("price_format") in {"probability", "bps_probability"}:
                    pairs = ", ".join(
                        f"{labels[i] if i < len(labels) else i}: {implied[i] * 100:.0f}%"
                        for i in range(min(len(implied), 3))
                        if implied[i] > 0
                    )
                else:
                    pairs = ", ".join(
                        f"{labels[i] if i < len(labels) else i}: {odds[i]:.2f}"
                        f"{f' ({implied[i] * 100:.0f}%)' if i < len(implied) and implied[i] else ''}"
                        for i in range(min(len(odds), 3))
                    )
                return f"odds refreshed from {line.get('bookmaker', 'market')}: {pairs}."
            return "odds refreshed."
        if update.get("type") == "score":
            score = update["line"]
            return f"score stream update, {home} {score.get('home_score', 0)} - {score.get('away_score', 0)} {away}."
        return "new TxLINE stream update received."

    def narration_prompt(self, context: dict[str, Any], signal: dict[str, Any], update: dict[str, Any] | None) -> dict[str, Any]:
        return {
            "context": context,
            "signal": signal,
            "live_update": update,
            "instructions": [
                "You are an exciting but responsible football pundit.",
                "Use only the provided TxLINE data and derived team profiles.",
                "Do not tell the user to place a bet and do not claim certainty.",
                "Explain both teams, who has the upper hand, scoring direction, and uncertainty.",
                "Keep the answer under 180 words.",
            ],
        }

    async def openrouter_narration(self, context: dict[str, Any], signal: dict[str, Any], update: dict[str, Any] | None) -> str:
        prompt = self.narration_prompt(context, signal, update)
        models = [
            os.getenv("OPENROUTER_MODEL", "tencent/hy3:free"),
            "poolside/laguna-xs-2.1:free",
        ]
        last_error: Exception | None = None

        async with httpx.AsyncClient(timeout=45.0) as client:
            for model in dict.fromkeys(model for model in models if model):
                try:
                    response = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                            "Content-Type": "application/json",
                            "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "https://quadratic-markets.local"),
                            "X-OpenRouter-Title": os.getenv("OPENROUTER_APP_TITLE", "TxLINE AI Pundit"),
                        },
                        json={
                            "model": model,
                            "messages": [
                                {
                                    "role": "system",
                                    "content": (
                                        "You turn TxLINE football data into concise fan-friendly match analysis. "
                                        "Be exciting, but never tell users to bet and never claim certainty."
                                    ),
                                },
                                {"role": "user", "content": json.dumps(prompt, default=str)},
                            ],
                            "temperature": 0.7,
                            "max_tokens": 260,
                        },
                    )
                    response.raise_for_status()
                    payload = response.json()
                    choices = payload.get("choices") or []
                    message = choices[0].get("message", {}) if choices else {}
                    text = first(message, "content", default="")
                    if text:
                        return str(text).strip()
                except Exception as exc:
                    last_error = exc

        raise RuntimeError(f"OpenRouter narration failed: {last_error}")

    async def openai_narration(self, context: dict[str, Any], signal: dict[str, Any], update: dict[str, Any] | None) -> str:
        prompt = self.narration_prompt(context, signal, update)
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
                    "input": json.dumps(prompt, default=str),
                },
            )
        response.raise_for_status()
        payload = response.json()
        text = payload.get("output_text")
        if text:
            return text
        chunks = []
        for item in payload.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"}:
                    chunks.append(content.get("text", ""))
        return "\n".join(chunks).strip() or self.template_narration(context, signal, update)

    async def stream_story(self, fixture_id: int | None, seconds: int = 60):
        context = await self.match_context(fixture_id) if fixture_id is not None else None
        deadline = time.monotonic() + seconds
        async for message in self.client.stream("odds"):
            if time.monotonic() > deadline:
                break
            payload = parse_sse_data(message.data)
            if not isinstance(payload, dict):
                continue
            update_fixture_id = int(first(payload, "fixtureId", "FixtureId", default=0) or 0)
            if not update_fixture_id:
                continue
            if fixture_id is not None and update_fixture_id != fixture_id:
                continue
            if context is None:
                context = await self.match_context(update_fixture_id)
            line = normalize_odds_line(payload)
            yield await self.narrate(context, {"type": "odds", "line": line})

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


NETWORKS = {
    "devnet": "https://txline-dev.txodds.com",
    "mainnet": "https://txline.txodds.com",
}


def response(status: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
        },
        "body": json.dumps(payload),
    }


def request_json(url: str, method: str = "GET", headers: dict[str, str] | None = None, body: dict[str, Any] | None = None) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def first(item: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in item and item[key] is not None:
            return item[key]
    return default


def as_seconds(value: Any) -> int:
    if value is None:
        return 0
    numeric = int(value)
    return numeric // 1000 if numeric > 10**12 else numeric


def txline_headers(origin: str) -> dict[str, str]:
    token = os.environ["TXODDS_API_TOKEN"]
    guest = request_json(f"{origin}/auth/guest/start", method="POST", body={})
    jwt = guest.get("token") or guest.get("access_token")
    if not jwt:
        raise RuntimeError("TxLINE guest auth response missing token")
    return {
        "Authorization": f"Bearer {jwt}",
        "X-Api-Token": token,
        "Accept": "application/json",
    }


def fixtures(origin: str, headers: dict[str, str], days_forward: int = 180) -> list[dict[str, Any]]:
    today = int(time.time()) // 86400
    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    for day in range(today - 1, today + days_forward + 1):
        url = f"{origin}/api/fixtures/snapshot?{urllib.parse.urlencode({'epochDay': day})}"
        try:
            data = request_json(url, headers=headers)
        except Exception:
            continue
        for raw in data if isinstance(data, list) else [data]:
            fixture_id = int(first(raw, "fixtureId", "FixtureId", default=0) or 0)
            if not fixture_id or fixture_id in seen:
                continue
            seen.add(fixture_id)
            rows.append(
                {
                    "fixtureId": fixture_id,
                    "homeTeam": str(first(raw, "homeTeam", "HomeTeam", "Participant1", default="Home")),
                    "awayTeam": str(first(raw, "awayTeam", "AwayTeam", "Participant2", default="Away")),
                    "leagueName": str(first(raw, "leagueName", "LeagueName", "Competition", default="TxLINE")),
                    "startTime": as_seconds(first(raw, "startTime", "StartTime", default=0)),
                }
            )
    return sorted(rows, key=lambda item: item["startTime"])


def decimal_odds(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    return numeric / 1000 if numeric >= 100 else numeric


def odds_snapshot(origin: str, headers: dict[str, str], fixture_id: int) -> dict[str, Any] | None:
    try:
        data = request_json(f"{origin}/api/odds/snapshot/{fixture_id}", headers=headers)
    except Exception:
        return None
    rows = data if isinstance(data, list) else [data]
    return rows[0] if rows else None


def market_read(match: dict[str, Any], odds: dict[str, Any] | None) -> tuple[str, float]:
    if not odds:
        return "The agent is waiting for a clean TxLINE price before calling the pressure point.", 0.5
    names = first(odds, "priceNames", "PriceNames", default=[]) or []
    prices = first(odds, "prices", "Prices", default=[]) or []
    pct = first(odds, "pct", "Pct", default=[]) or []
    labels = []
    for name in names:
        lowered = str(name).lower()
        if lowered in {"part1", "participant1", "home", "1"}:
            labels.append(match["homeTeam"])
        elif lowered in {"part2", "participant2", "away", "2"}:
            labels.append(match["awayTeam"])
        elif lowered in {"draw", "x", "tie"}:
            labels.append("Draw")
        else:
            labels.append(str(name))

    implied = []
    for index, price in enumerate(prices):
        if index < len(pct):
            implied.append(float(pct[index]) / 100)
        else:
            odd = decimal_odds(price)
            implied.append(1 / odd if odd > 1 else 0)
    if not implied:
        return "TxLINE odds are live, but this market has no priced outcomes yet.", 0.5
    leader_index = max(range(len(implied)), key=lambda idx: implied[idx])
    leader = labels[leader_index] if leader_index < len(labels) else f"Outcome {leader_index + 1}"
    odd = decimal_odds(prices[leader_index]) if leader_index < len(prices) else 0
    confidence = max(0.5, min(0.82, implied[leader_index]))
    odd_text = f" at {odd:.2f}x" if odd > 0 else ""
    return (
        f"{leader} has the strongest current TxLINE signal{odd_text}, around {implied[leader_index] * 100:.0f}% implied. "
        "This is a live read, not certainty; watch the next odds move for momentum.",
        confidence,
    )


def openrouter_narration(match: dict[str, Any], read: str) -> str | None:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        return None
    prompt = {
        "match": match,
        "market_read": read,
        "instructions": "Write one short social-feed style football pundit post. Be exciting but responsible. No betting instruction. Under 90 words.",
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(
            {
                "model": os.getenv("OPENROUTER_MODEL", "tencent/hy3:free"),
                "messages": [
                    {"role": "system", "content": "You are TxLINE AI Pundit."},
                    {"role": "user", "content": json.dumps(prompt)},
                ],
                "temperature": 0.7,
                "max_tokens": 160,
            }
        ).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "https://txline-tg-miniapp.aws"),
            "X-OpenRouter-Title": os.getenv("OPENROUTER_APP_TITLE", "TxLINE AI Pundit"),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            payload = json.loads(res.read().decode("utf-8"))
        choices = payload.get("choices") or []
        text = (((choices[0] if choices else {}).get("message") or {}).get("content") or "").strip()
        return text or None
    except Exception:
        return None


def build_feeds() -> dict[str, Any]:
    network = os.getenv("TXODDS_NETWORK", "devnet")
    origin = NETWORKS[network]
    headers = txline_headers(origin)
    rows = fixtures(origin, headers)[:8]
    now = int(time.time())
    items = []
    for index, match in enumerate(rows):
        odds = odds_snapshot(origin, headers, match["fixtureId"])
        read, confidence = market_read(match, odds)
        ai_text = openrouter_narration(match, read) if index == 0 else None
        items.append(
            {
                "id": f"{match['fixtureId']}-{now}-{index}",
                "type": "match_read" if index == 0 else "signal",
                "fixtureId": match["fixtureId"],
                "homeTeam": match["homeTeam"],
                "awayTeam": match["awayTeam"],
                "title": f"{match['homeTeam']} vs {match['awayTeam']}: AI match read",
                "body": ai_text or read,
                "source": "TxLINE AI Pundit",
                "confidence": confidence,
                "createdAt": now - index * 90,
                "tags": ["txline", match["leagueName"].lower().replace(" ", "-")],
            }
        )
    return {"count": len(items), "items": items, "state": {"network": network, "generated_at": now}}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method") or event.get("httpMethod")
    if method == "OPTIONS":
        return response(204, {})
    path = event.get("rawPath") or event.get("path") or "/"
    if path.endswith("/api/health"):
        return response(200, {"ok": True, "network": os.getenv("TXODDS_NETWORK", "devnet")})
    if path.endswith("/api/feeds") or path == "/":
        try:
            return response(200, build_feeds())
        except urllib.error.HTTPError as exc:
            return response(exc.code, {"error": exc.reason})
        except Exception as exc:
            return response(500, {"error": str(exc)})
    return response(404, {"error": "not found"})

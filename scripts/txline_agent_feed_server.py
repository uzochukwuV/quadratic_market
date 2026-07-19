#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import os
import re
import sys
import time
from collections import deque
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, os.getcwd())

from agent.pundit import PunditAgent
from agent.txline_client import TxlineClient


MAX_FEEDS = int(os.getenv("AGENT_FEED_MAX_ITEMS", "80"))
NETWORK = os.getenv("TXODDS_NETWORK", "devnet")
HOST = os.getenv("AGENT_FEED_HOST", "0.0.0.0")
PORT = int(os.getenv("AGENT_FEED_PORT", "8790"))

app = FastAPI(title="TxLINE AI Pundit Feed API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

feeds: deque[dict[str, Any]] = deque(maxlen=MAX_FEEDS)
state: dict[str, Any] = {
    "started_at": int(time.time()),
    "last_event_at": None,
    "last_error": None,
    "network": NETWORK,
}


def parse_story(story: str, index: int) -> dict[str, Any]:
    lines = [line.strip() for line in story.splitlines() if line.strip()]
    title = lines[0] if lines else "AI match read"
    home, away = "Home", "Away"
    match = re.match(r"(.+?) vs (.+?):", title)
    if match:
        home = match.group(1).strip()
        away = match.group(2).strip()

    confidence = None
    confidence_match = re.search(r"(\d+)% signal confidence", story)
    if confidence_match:
        confidence = int(confidence_match.group(1)) / 100

    feed_type = "odds_shift" if "Live update:" in story else "match_read"
    body = "\n".join(lines[1:]).strip() or story.strip()
    return {
        "id": f"{int(time.time())}-{index}",
        "type": feed_type,
        "fixtureId": None,
        "homeTeam": home,
        "awayTeam": away,
        "title": title,
        "body": body,
        "source": "TxLINE AI Pundit",
        "confidence": confidence,
        "createdAt": int(time.time()),
        "tags": ["txline", "ai-live"],
    }


async def feed_worker() -> None:
    client = TxlineClient(NETWORK)
    await client.authenticate()
    agent = PunditAgent(client)
    counter = 0
    try:
        while True:
            try:
                async for story in agent.stream_story(None, seconds=300):
                    counter += 1
                    feeds.appendleft(parse_story(story, counter))
                    state["last_event_at"] = int(time.time())
                    state["last_error"] = None
            except Exception as exc:
                state["last_error"] = str(exc)
                await asyncio.sleep(10)
    finally:
        await client.close()


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(feed_worker())


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "network": state["network"],
        "count": len(feeds),
        "started_at": state["started_at"],
        "last_event_at": state["last_event_at"],
        "last_error": state["last_error"],
    }


@app.get("/api/feeds")
async def list_feeds() -> dict[str, Any]:
    return {
        "count": len(feeds),
        "items": list(feeds),
        "state": state,
    }


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level=os.getenv("LOG_LEVEL", "info").lower())

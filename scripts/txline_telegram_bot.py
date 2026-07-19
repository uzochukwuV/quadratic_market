#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.getcwd())

from agent.pundit import PunditAgent
from agent.telegram import TelegramClient
from agent.txline_client import TxlineClient


HELP = """TxLINE AI Pundit

Commands:
/matches - list available TxLINE fixtures
/analyze <fixture_id> - explain both teams and who has the upper hand
/live <fixture_id> - wait up to 60s for matching odds stream updates and narrate them
"""


async def handle_message(text: str, chat_id: int, telegram: TelegramClient, agent: PunditAgent) -> None:
    parts = text.strip().split()
    command = parts[0].lower() if parts else ""

    if command in {"/start", "/help"}:
        await telegram.send_message(chat_id, HELP)
        return

    if command == "/matches":
        matches = await agent.list_matches()
        lines = [
            f"{match['fixture_id']} | {match['home_team']} vs {match['away_team']} | {match['league_name']}"
            for match in matches[:20]
        ]
        await telegram.send_message(chat_id, "\n".join(lines) or "No TxLINE fixtures found.")
        return

    if command == "/analyze" and len(parts) >= 2:
        fixture_id = int(parts[1])
        context = await agent.match_context(fixture_id)
        await telegram.send_message(chat_id, await agent.narrate(context))
        return

    if command == "/live" and len(parts) >= 2:
        fixture_id = int(parts[1])
        await telegram.send_message(chat_id, f"Story mode started for fixture {fixture_id}. Waiting for TxLINE odds movement.")
        delivered = 0
        async for story in agent.stream_story(fixture_id, seconds=60):
            delivered += 1
            await telegram.send_message(chat_id, story)
            if delivered >= 3:
                break
        if delivered == 0:
            await telegram.send_message(chat_id, "The stream opened, but no matching update arrived in this window.")
        return

    await telegram.send_message(chat_id, HELP)


async def main() -> int:
    network = os.getenv("TXODDS_NETWORK", "devnet")
    client = TxlineClient(network)
    await client.authenticate()
    agent = PunditAgent(client)
    telegram = TelegramClient()
    offset = None

    try:
        while True:
            updates = await telegram.get_updates(offset=offset, timeout=25)
            for update in updates:
                offset = update["update_id"] + 1
                message = update.get("message") or {}
                text = message.get("text") or ""
                chat_id = message.get("chat", {}).get("id")
                if text and chat_id:
                    try:
                        await handle_message(text, chat_id, telegram, agent)
                    except Exception as exc:
                        await telegram.send_message(chat_id, f"Agent error: {exc}")
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.getcwd())

from agent.pundit import PunditAgent
from agent.telegram import TelegramClient
from agent.txline_client import TxlineClient


async def main() -> int:
    parser = argparse.ArgumentParser(description="TxLINE AI Match Pundit agent")
    parser.add_argument("command", choices=["matches", "analyze", "stream"])
    parser.add_argument("--network", default=os.getenv("TXODDS_NETWORK", "devnet"), choices=["devnet", "mainnet"])
    parser.add_argument("--fixture-id", type=int)
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--max-stories", type=int, default=3)
    parser.add_argument("--telegram-chat-id", default=os.getenv("TELEGRAM_CHAT_ID", ""))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    client = TxlineClient(args.network)
    await client.authenticate()
    agent = PunditAgent(client)

    try:
        if args.command == "matches":
            matches = await agent.list_matches()
            if args.json:
                print(json.dumps(matches, indent=2))
            else:
                for match in matches:
                    print(f"{match['fixture_id']} | {match['home_team']} vs {match['away_team']} | {match['league_name']} | {match['start_time']}")
            return 0

        if args.command == "analyze" and not args.fixture_id:
            raise SystemExit("--fixture-id is required for analyze")

        if args.command == "analyze":
            context = await agent.match_context(args.fixture_id)
            narration = await agent.narrate(context)
            print(narration)
            if args.telegram_chat_id:
                await TelegramClient().send_message(args.telegram_chat_id, narration)
            return 0

        if args.command == "stream":
            delivered = 0
            telegram = TelegramClient() if args.telegram_chat_id else None
            async for story in agent.stream_story(args.fixture_id, args.seconds):
                delivered += 1
                print(story)
                print("\n---\n")
                if telegram:
                    await telegram.send_message(args.telegram_chat_id, story)
                if delivered >= args.max_stories:
                    break
            if delivered == 0:
                print("Stream opened, but no matching odds update arrived during the window.")
            return 0
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

#!/usr/bin/env python3
"""Smoke-test TxLINE odds or scores SSE streams.

The script intentionally does not print credentials. It accepts an activated
API token from TXODDS_API_TOKEN, TXODDS_API_TOKEN_VALUE, or TXODDS_API_TOKEN_FILE,
then renews a guest JWT from the matching TxLINE host and opens the SSE stream.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from dataclasses import dataclass
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


@dataclass
class SseMessage:
    data: str = ""
    event: str | None = None
    id: str | None = None
    retry: int | None = None


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

    raise SystemExit(
        "Missing API token. Set TXODDS_API_TOKEN, TXODDS_API_TOKEN_FILE, "
        "TXODDS_API_KEY, or ODDS_API_KEY before running this script."
    )


async def get_guest_jwt(origin: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{origin}/auth/guest/start", json={})
    response.raise_for_status()
    payload = response.json()
    token = payload.get("token") or payload.get("access_token")
    if not token:
        raise RuntimeError(f"Guest auth response did not include token fields: {list(payload.keys())}")
    return token


def parse_sse_block(block: str) -> SseMessage | None:
    message = SseMessage()

    for raw_line in block.splitlines():
        if not raw_line or raw_line.startswith(":"):
            continue

        separator_index = raw_line.find(":")
        field = raw_line if separator_index == -1 else raw_line[:separator_index]
        value = "" if separator_index == -1 else raw_line[separator_index + 1 :].lstrip(" ")

        if field == "data":
            message.data += f"{value}\n"
        elif field == "event":
            message.event = value
        elif field == "id":
            message.id = value
        elif field == "retry":
            try:
                message.retry = int(value)
            except ValueError:
                message.retry = None

    message.data = message.data.rstrip("\n")
    if message.data or message.event or message.id:
        return message
    return None


def parse_sse_data(data: str) -> Any:
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        return data


def summarize_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload

    keys = [
        "fixtureId",
        "fixture_id",
        "id",
        "seq",
        "Seq",
        "ts",
        "timestamp",
        "gameState",
        "state",
        "homeScore",
        "awayScore",
        "participant1Score",
        "participant2Score",
    ]
    summary = {key: payload[key] for key in keys if key in payload}
    if summary:
        summary["_keys"] = sorted(payload.keys())[:20]
        return summary
    return {"_keys": sorted(payload.keys())[:30]}


async def stream_once(network: str, stream: str, seconds: int, max_messages: int) -> int:
    origin = NETWORKS[network]
    api_token = read_api_token()
    jwt = os.getenv("TXLINE_JWT") or await get_guest_jwt(origin)
    url = f"{origin}/api/{stream}/stream"
    headers = {
        "Authorization": f"Bearer {jwt}",
        "X-Api-Token": api_token,
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache",
    }

    print(f"Connecting to {network} {stream} stream: {url}")
    print("Credentials loaded: api token yes, jwt yes")

    received = 0
    deadline = time.monotonic() + seconds
    buffer = ""

    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("GET", url, headers=headers) as response:
            print(f"HTTP {response.status_code} content-type={response.headers.get('content-type')}")
            if response.status_code != 200:
                body = await response.aread()
                print(body[:500].decode("utf-8", errors="replace"))
                return 1

            async for chunk in response.aiter_text():
                if time.monotonic() >= deadline:
                    break

                buffer += chunk
                while "\n\n" in buffer or "\r\n\r\n" in buffer:
                    if "\r\n\r\n" in buffer:
                        block, buffer = buffer.split("\r\n\r\n", 1)
                    else:
                        block, buffer = buffer.split("\n\n", 1)

                    message = parse_sse_block(block)
                    if not message:
                        continue

                    received += 1
                    payload = parse_sse_data(message.data)
                    print(
                        json.dumps(
                            {
                                "event": message.event or "message",
                                "id": message.id,
                                "payload": summarize_payload(payload),
                            },
                            default=str,
                        )
                    )

                    if received >= max_messages:
                        print(f"Received {received} SSE message(s); stopping.")
                        return 0

    print(f"Stream opened. Received {received} SSE message(s) in {seconds}s.")
    if received == 0:
        print("No data messages during this window. This can be normal when no covered fixture is active.")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", choices=sorted(NETWORKS), default=os.getenv("TXODDS_NETWORK", "devnet"))
    parser.add_argument("--stream", choices=["odds", "scores"], default="odds")
    parser.add_argument("--seconds", type=int, default=45)
    parser.add_argument("--max-messages", type=int, default=5)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    raise SystemExit(asyncio.run(stream_once(args.network, args.stream, args.seconds, args.max_messages)))


if __name__ == "__main__":
    main()

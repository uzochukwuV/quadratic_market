"""Bot configuration loaded from environment variables."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Required env var {key!r} is not set. Copy .env.example to .env and fill it in.")
    return val


def _keypair_path(key: str) -> Path:
    raw = _require(key)
    p = Path(raw).expanduser()
    if not p.exists():
        raise RuntimeError(f"Keypair file {p} (from {key}) does not exist.")
    return p


RPC_URL: str = os.getenv("RPC_URL", "https://api.devnet.solana.com")
PROGRAM_ID: str = _require("PROGRAM_ID")
BASE_MINT: str = _require("BASE_MINT")

OPERATOR_KEYPAIR_PATH: Path = _keypair_path("OPERATOR_KEYPAIR_PATH")
ORACLE_KEYPAIR_PATH: Path = _keypair_path("ORACLE_KEYPAIR_PATH")

ODDS_API_KEY: str = _require("ODDS_API_KEY")
SPORTS: list[str] = [s.strip() for s in os.getenv("SPORTS", "soccer_epl").split(",") if s.strip()]

MARKET_LOOKAHEAD_SECONDS: int = int(os.getenv("MARKET_LOOKAHEAD_SECONDS", "86400"))
RESULT_DELAY_SECONDS: int = int(os.getenv("RESULT_DELAY_SECONDS", "7200"))
POLL_INTERVAL_SECONDS: int = int(os.getenv("POLL_INTERVAL_SECONDS", "300"))
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()

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


# ─── Solana Configuration ──────────────────────────────────────────────────────

RPC_URL: str = os.getenv("RPC_URL", "https://api.devnet.solana.com")
PROGRAM_ID: str = _require("PROGRAM_ID")
BASE_MINT: str = _require("BASE_MINT")

OPERATOR_KEYPAIR_PATH: Path = _keypair_path("OPERATOR_KEYPAIR_PATH")
ORACLE_KEYPAIR_PATH: Path = _keypair_path("ORACLE_KEYPAIR_PATH")

# ─── Sports API Configuration ───────────────────────────────────────────────────

ODDS_API_KEY: str = _require("ODDS_API_KEY")

# Football leagues to track (comma-separated)
# Supported: soccer_epl, soccer_uefa_champs_league, soccer_uefa_europa_league,
# soccer_spain_la_liga, soccer_germany_bundesliga, soccer_italy_serie_a,
# soccer_france_ligue_one
SPORTS: list[str] = [s.strip() for s in os.getenv("SPORTS", "soccer_epl").split(",") if s.strip()]

# ─── Bot Timing Configuration ───────────────────────────────────────────────────

# How far ahead to look for upcoming matches (seconds)
MARKET_LOOKAHEAD_SECONDS: int = int(os.getenv("MARKET_LOOKAHEAD_SECONDS", "86400"))  # 24 hours

# How long after match start to wait before settling (seconds)
RESULT_DELAY_SECONDS: int = int(os.getenv("RESULT_DELAY_SECONDS", "7200"))  # 2 hours

# How often to poll for updates (seconds)
POLL_INTERVAL_SECONDS: int = int(os.getenv("POLL_INTERVAL_SECONDS", "300"))  # 5 minutes

# ─── Logging ──────────────────────────────────────────────────────────────────

LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()

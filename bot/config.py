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


def _optional(key: str, default: str) -> str:
    return os.getenv(key, default)


def _keypair_path(key: str) -> Path:
    raw = _require(key)
    p = Path(raw).expanduser()
    if not p.exists():
        raise RuntimeError(f"Keypair file {p} (from {key}) does not exist.")
    return p


# ─── Network ───────────────────────────────────────────────────────────────

NETWORK: str = os.getenv("NETWORK", "devnet")  # "devnet" or "mainnet"

RPC_URL: str = os.getenv("RPC_URL", "https://api.devnet.solana.com")
PROGRAM_ID: str = _require("PROGRAM_ID")
BASE_MINT: str = _require("BASE_MINT")

# ─── Keys ──────────────────────────────────────────────────────────────────

OPERATOR_KEYPAIR_PATH: Path = _keypair_path("OPERATOR_KEYPAIR_PATH")
ORACLE_KEYPAIR_PATH: Path = _keypair_path("ORACLE_KEYPAIR_PATH")

# ─── Txodds API ──────────────────────────────────────────────────────────────

TXODDS_API_KEY: str = _require("TXODDS_API_KEY")
TXODDS_NETWORK: str = os.getenv("TXODDS_NETWORK", "devnet")  # "devnet" or "mainnet"

# Sports to track (comma-separated)
SPORTS: list[str] = [s.strip() for s in os.getenv("SPORTS", "soccer").split(",") if s.strip()]

# ─── Timing ─────────────────────────────────────────────────────────────────

MARKET_LOOKAHEAD_DAYS: int = int(os.getenv("MARKET_LOOKAHEAD_DAYS", "7"))
RESULT_DELAY_SECONDS: int = int(os.getenv("RESULT_DELAY_SECONDS", "7200"))
POLL_INTERVAL_SECONDS: int = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))

# ─── Odds ───────────────────────────────────────────────────────────────────

# Min/max odds in basis points (e.g., 10100 = 1.01x, 100000 = 10x)
DEFAULT_MIN_ODDS_BPS: int = int(os.getenv("DEFAULT_MIN_ODDS_BPS", "10100"))
DEFAULT_MAX_ODDS_BPS: int = int(os.getenv("DEFAULT_MAX_ODDS_BPS", "100000"))

# ─── Logging ─────────────────────────────────────────────────────────────────

LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()

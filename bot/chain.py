"""
Low-level Solana helpers: keypair loading, PDA derivation, and
wrappers around every on-chain instruction the bot needs.

All public functions are async and return the transaction signature string.
"""

import json
from pathlib import Path

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import ID as SYS_PROGRAM_ID
from solana.rpc.async_api import AsyncClient
from anchorpy import Program, Provider, Wallet, Context, Idl
from anchorpy.program.namespace.instruction import _InstructionFn  # noqa: F401 (type hint only)

import structlog

log = structlog.get_logger(__name__)

# ─── PDA seeds (must match constants.rs) ──────────────────────────────────────

SEED_GLOBAL_CONFIG = b"global_config"
SEED_TREASURY = b"treasury"
SEED_MARKET = b"market"
SEED_OUTCOME_MINT = b"outcome_mint"
SEED_DISPUTE = b"dispute"
SEED_EPOCH = b"epoch"


def load_keypair(path: Path) -> Keypair:
    """Load a Solana keypair from a JSON file (array of 64 bytes)."""
    raw = json.loads(path.read_text())
    return Keypair.from_bytes(bytes(raw))


def normalize_idl_account_item(item: dict) -> dict:
    """Normalize account items from Anchor's newer IDL shape to AnchorPy-compatible shape."""
    if not isinstance(item, dict):
        return item

    if "accounts" in item:
        return {
            **item,
            "accounts": [normalize_idl_account_item(acc) for acc in item["accounts"]],
        }

    normalized = dict(item)
    if "writable" in normalized:
        normalized["is_mut"] = normalized.pop("writable")
    if "signer" in normalized:
        normalized["is_signer"] = normalized.pop("signer")
    if "optional" in normalized and "is_optional" not in normalized:
        normalized["is_optional"] = normalized.pop("optional")

    normalized.setdefault("is_mut", False)
    normalized.setdefault("is_signer", False)
    normalized.setdefault("is_optional", None)
    normalized.setdefault("docs", None)
    normalized.setdefault("relations", [])

    if "accounts" in normalized:
        normalized["accounts"] = [normalize_idl_account_item(acc) for acc in normalized["accounts"]]

    return normalized


def normalize_idl_json(raw_idl: dict) -> dict:
    normalized = dict(raw_idl)

    if "instructions" in raw_idl:
        normalized["instructions"] = [
            {
                **instr,
                "accounts": [normalize_idl_account_item(acc) for acc in instr.get("accounts", [])],
            }
            for instr in raw_idl["instructions"]
        ]

    if "accounts" in raw_idl:
        normalized["accounts"] = [normalize_idl_account_item(acc) for acc in raw_idl["accounts"]]

    if "state" in raw_idl and isinstance(raw_idl["state"], dict):
        state = dict(raw_idl["state"])
        if "methods" in state:
            state["methods"] = [
                {
                    **method,
                    "accounts": [normalize_idl_account_item(acc) for acc in method.get("accounts", [])],
                }
                for method in state["methods"]
            ]
        normalized["state"] = state

    return normalized


def load_idl(path: Path) -> Idl:
    raw_idl = json.loads(path.read_text())
    normalized = normalize_idl_json(raw_idl)
    return Idl.from_json(json.dumps(normalized))


def global_config_pda(program_id: Pubkey) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address([SEED_GLOBAL_CONFIG], program_id)


def treasury_pda(program_id: Pubkey) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address([SEED_TREASURY], program_id)


def market_pda(program_id: Pubkey, market_id: int) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [SEED_MARKET, market_id.to_bytes(8, "little")],
        program_id,
    )


def outcome_mint_pda(program_id: Pubkey, market_id: int, outcome_id: int) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [SEED_OUTCOME_MINT, market_id.to_bytes(8, "little"), bytes([outcome_id])],
        program_id,
    )


def dispute_pda(program_id: Pubkey, market_id: int) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [SEED_DISPUTE, market_id.to_bytes(8, "little")],
        program_id,
    )


def epoch_pda(program_id: Pubkey, epoch_id: int) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [SEED_EPOCH, epoch_id.to_bytes(8, "little")],
        program_id,
    )


# ─── On-chain client ──────────────────────────────────────────────────────────

class ChainClient:
    """
    Wraps anchorpy Program to expose the specific instructions the bot uses.

    Instantiate once and reuse across the bot's lifetime.
    """

    def __init__(
        self,
        program: Program,
        operator_kp: Keypair,
        oracle_kp: Keypair,
        base_mint: Pubkey,
    ) -> None:
        self.program = program
        self.operator_kp = operator_kp
        self.oracle_kp = oracle_kp
        self.base_mint = base_mint
        self.program_id = program.program_id

        self.global_config, _ = global_config_pda(self.program_id)
        self.treasury, _ = treasury_pda(self.program_id)

    @classmethod
    async def create(
        cls,
        rpc_url: str,
        idl_path: Path,
        program_id_str: str,
        operator_kp: Keypair,
        oracle_kp: Keypair,
        base_mint_str: str,
    ) -> "ChainClient":
        client = AsyncClient(rpc_url)
        wallet = Wallet(operator_kp)
        provider = Provider(client, wallet)
        idl = load_idl(idl_path)
        program = Program(idl, Pubkey.from_string(program_id_str), provider)
        return cls(program, operator_kp, oracle_kp, Pubkey.from_string(base_mint_str))

    async def close(self) -> None:
        await self.program.close()

    # ── Read ──────────────────────────────────────────────────────────────────

    async def fetch_global_config(self) -> dict:
        return await self.program.account["GlobalConfig"].fetch(self.global_config)

    async def fetch_market(self, market_id: int) -> dict:
        pda, _ = market_pda(self.program_id, market_id)
        return await self.program.account["Market"].fetch(pda)

    async def fetch_epoch(self, epoch_id: int) -> dict:
        pda, _ = epoch_pda(self.program_id, epoch_id)
        return await self.program.account["Epoch"].fetch(pda)

    async def next_market_id(self) -> int:
        cfg = await self.fetch_global_config()
        return int(cfg.next_market_id)

    # ── init_epoch ──────────────────────────────────────────────────────────

    async def init_epoch(self) -> str:
        """
        Initialize the current epoch if it doesn't exist.
        Called before creating markets to ensure epoch account exists.
        """
        cfg = await self.fetch_global_config()
        epoch_id = int(cfg.current_epoch)
        epoch_pda, _ = epoch_pda(self.program_id, epoch_id)

        from solders.sysvar import CLOCK as SYSVAR_CLOCK
        
        sig = await self.program.rpc["init_epoch"](
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "epoch": epoch_pda,
                    "payer": self.operator_kp.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("init_epoch", epoch_id=epoch_id, sig=str(sig))
        return str(sig)

    # ── create_market ─────────────────────────────────────────────────────────

    async def create_market(
        self,
        start_time: int,
        num_outcomes: int,
        title: str,
        description: str,
        category: int = 0,
        lmsr_b_override: int | None = None,
        initial_q_values: list[int] | None = None,
    ) -> tuple[int, str]:
        """
        Create a market with optional initial q_values for odds seeding.
        
        Args:
            start_time: Unix timestamp when market becomes inactive
            num_outcomes: 2 or 3
            title: Market title (e.g., "Arsenal vs Liverpool - Match Result")
            description: Market description
            category: Market category (0=3-way, 1=BTTS, 2=Totals, etc.)
            lmsr_b_override: Override liquidity parameter B (optional)
            initial_q_values: Seed q_values from API odds (optional)
                              Must have length >= num_outcomes
        
        Returns:
            (market_id, tx_signature)
        """
        # Ensure epoch exists
        await self.init_epoch()
        
        mid = await self.next_market_id()
        mkt_pda, _ = market_pda(self.program_id, mid)
        cfg = await self.fetch_global_config()
        current_epoch = int(cfg.current_epoch)
        epoch_pda, epoch_bump = epoch_pda(self.program_id, current_epoch)

        # Convert initial_q_values to anchorpy expected format
        q_values_arg = initial_q_values if initial_q_values else None

        # Import MarketMode
        from anchorpy.serializer import Serde
        MarketMode = self.program.type["MarketMode"]

        sig = await self.program.rpc["create_market"](
            start_time,
            num_outcomes,
            title,
            description,
            category,
            lmsr_b_override,
            q_values_arg,
            MarketMode.FixedOdds,  # Use FixedOdds mode for sports
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                    "epoch": epoch_pda,
                    "authority": self.operator_kp.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                    "rent": Pubkey.from_string("SysvarRent111111111111111111111111111111111"),
                },
                signers=[self.operator_kp],
            ),
        )
        log.info(
            "create_market",
            market_id=mid,
            title=title[:50],
            category=category,
            num_outcomes=num_outcomes,
            has_q_values=initial_q_values is not None,
            sig=str(sig),
        )
        return mid, str(sig)

    # ── init_outcome_mint ─────────────────────────────────────────────────────

    async def init_outcome_mint(self, market_id: int, outcome_id: int) -> str:
        mkt_pda, _ = market_pda(self.program_id, market_id)
        mint_pda, _ = outcome_mint_pda(self.program_id, market_id, outcome_id)

        from solders.sysvar import RENT as SYSVAR_RENT
        from spl.token.constants import TOKEN_PROGRAM_ID

        sig = await self.program.rpc["init_outcome_mint"](
            market_id,
            outcome_id,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                    "outcome_mint": mint_pda,
                    "payer": self.operator_kp.pubkey(),
                    "token_program": Pubkey.from_string(str(TOKEN_PROGRAM_ID)),
                    "system_program": SYS_PROGRAM_ID,
                    "rent": SYSVAR_RENT,
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("init_outcome_mint", market_id=market_id, outcome_id=outcome_id, sig=str(sig))
        return str(sig)

    # ── suspend_market ────────────────────────────────────────────────────────

    async def suspend_market(self, market_id: int) -> str:
        """
        Suspend a market when the match starts — no more bets accepted.
        Called by the bot at start_time.
        """
        mkt_pda, _ = market_pda(self.program_id, market_id)
        sig = await self.program.rpc["suspend_market"](
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                    "authority": self.operator_kp.pubkey(),
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("suspend_market", market_id=market_id, sig=str(sig))
        return str(sig)

    # ── propose_result ────────────────────────────────────────────────────────

    async def propose_result(self, market_id: int, winning_outcome: int) -> str:
        """
        Oracle proposes the result. Called after RESULT_DELAY_SECONDS post start_time.
        winning_outcome: 0=Home, 1=Away (or 0=Home, 1=Draw, 2=Away for 3-way).
        """
        mkt_pda, _ = market_pda(self.program_id, market_id)
        dp_pda, _ = dispute_pda(self.program_id, market_id)

        sig = await self.program.rpc["propose_result"](
            market_id,
            winning_outcome,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                    "dispute": dp_pda,
                    "oracle": self.oracle_kp.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                },
                signers=[self.oracle_kp],
            ),
        )
        log.info("propose_result", market_id=market_id, outcome=winning_outcome, sig=str(sig))
        return str(sig)

    # ── finalize_result ───────────────────────────────────────────────────────

    async def finalize_result(self, market_id: int) -> str:
        """
        Finalize after the challenge window. Callable by anyone — bot uses operator key.
        """
        mkt_pda, _ = market_pda(self.program_id, market_id)
        dp_pda, _ = dispute_pda(self.program_id, market_id)

        sig = await self.program.rpc["finalize_result"](
            market_id,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                    "dispute": dp_pda,
                    "caller": self.operator_kp.pubkey(),
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("finalize_result", market_id=market_id, sig=str(sig))
        return str(sig)

    # ── void_if_expired ───────────────────────────────────────────────────────

    async def void_if_expired(self, market_id: int) -> str:
        """Void a market that the oracle never settled within the deadline."""
        mkt_pda, _ = market_pda(self.program_id, market_id)
        sig = await self.program.rpc["void_if_expired"](
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("void_if_expired", market_id=market_id, sig=str(sig))
        return str(sig)

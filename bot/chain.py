"""
Low-level Solana helpers: keypair loading, PDA derivation, and
wrappers around every on-chain instruction the bot needs.

All public functions are async and return the transaction signature string.
"""

import json
from pathlib import Path
from typing import Optional, Tuple, List, Any

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import Transaction as SoldersTransaction
from solders.system_program import ID as SYS_PROGRAM_ID
from solana.rpc.async_api import AsyncClient
from anchorpy import Program, Provider, Wallet, Context, Idl
from anchorpy.program.namespace.instruction import _InstructionFn  # noqa: F401 (type hint only)
from spl.token.constants import ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID
from spl.token.instructions import (
    MintToParams,
    create_associated_token_account,
    get_associated_token_address,
    mint_to,
)

import structlog

log = structlog.get_logger(__name__)

# ─── PDA seeds (must match constants.rs) ──────────────────────────────────────

SEED_GLOBAL_CONFIG = b"global_config"
SEED_TREASURY = b"treasury"
SEED_MARKET = b"market"
SEED_OUTCOME_MINT = b"outcome_mint"
SEED_SLIP = b"slip"
SEED_EPOCH = b"epoch"
SEED_MARKET_GROUP = b"market_group"


def load_keypair(path: Path) -> Keypair:
    """Load a Solana keypair from a JSON file (array of 64 bytes)."""
    raw = json.loads(path.read_text())
    return Keypair.from_bytes(bytes(raw))


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


def slip_pda(program_id: Pubkey, slip_id: int) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [SEED_SLIP, slip_id.to_bytes(8, "little")],
        program_id,
    )


def epoch_pda(program_id: Pubkey, epoch_id: int) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [SEED_EPOCH, epoch_id.to_bytes(8, "little")],
        program_id,
    )


def market_group_pda(program_id: Pubkey, group_id: int) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [SEED_MARKET_GROUP, group_id.to_bytes(8, "little")],
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
        txoracle_program_id: Pubkey,
    ) -> None:
        self.program = program
        self.operator_kp = operator_kp
        self.oracle_kp = oracle_kp
        self.base_mint = base_mint
        self.txoracle_program_id = txoracle_program_id
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
        txoracle_program_id_str: str,
    ) -> "ChainClient":
        client = AsyncClient(rpc_url)
        wallet = Wallet(operator_kp)
        provider = Provider(client, wallet)
        idl = Idl.from_json(idl_path.read_text())
        program = Program(idl, Pubkey.from_string(program_id_str), provider)
        return cls(
            program,
            operator_kp,
            oracle_kp,
            Pubkey.from_string(base_mint_str),
            Pubkey.from_string(txoracle_program_id_str),
        )

    async def close(self) -> None:
        await self.program.close()

    # ── Read ──────────────────────────────────────────────────────────────────

    async def fetch_global_config(self) -> dict:
        return await self.program.account["GlobalConfig"].fetch(self.global_config)

    async def fetch_market(self, market_id: int) -> dict:
        pda, _ = market_pda(self.program_id, market_id)
        return await self.program.account["Market"].fetch(pda)

    async def fetch_market_group(self, group_id: int) -> dict:
        pda, _ = market_group_pda(self.program_id, group_id)
        return await self.program.account["MarketGroup"].fetch(pda)

    async def fetch_slip(self, slip_id: int) -> dict:
        pda, _ = slip_pda(self.program_id, slip_id)
        return await self.program.account["Slip"].fetch(pda)

    async def fetch_epoch(self, epoch_id: int) -> dict:
        pda, _ = epoch_pda(self.program_id, epoch_id)
        return await self.program.account["Epoch"].fetch(pda)

    async def next_market_id(self) -> int:
        cfg = await self.fetch_global_config()
        return int(cfg.next_market_id)

    async def next_slip_id(self) -> int:
        cfg = await self.fetch_global_config()
        return int(cfg.next_slip_id)

    async def fetch_all_slips(self) -> list[tuple[int, Any]]:
        cfg = await self.fetch_global_config()
        slips: list[tuple[int, Any]] = []
        for slip_id in range(1, int(cfg.next_slip_id)):
            try:
                slips.append((slip_id, await self.fetch_slip(slip_id)))
            except Exception:
                continue
        return slips

    @staticmethod
    def _enum_name(value: Any) -> str:
        if isinstance(value, dict) and len(value) == 1:
            return next(iter(value.keys()))
        return str(value)

    async def ensure_associated_token_account(self, owner: Pubkey, mint: Pubkey) -> Pubkey:
        ata = get_associated_token_address(owner, mint)
        conn = self.program.provider.connection
        info = await conn.get_account_info(ata)
        if info.value is None:
            ix = create_associated_token_account(
                payer=self.operator_kp.pubkey(),
                owner=owner,
                mint=mint,
                token_program_id=TOKEN_PROGRAM_ID,
            )
            blockhash = (await conn.get_latest_blockhash()).value.blockhash
            tx = SoldersTransaction.new_signed_with_payer(
                [ix],
                self.operator_kp.pubkey(),
                [self.operator_kp],
                blockhash,
            )
            await self.program.provider.send(tx)
        return ata

    async def mint_base_to(self, recipient: Pubkey, amount: int) -> tuple[str, Pubkey]:
        """
        Mint the base token to a recipient wallet.

        The base mint must still have the operator wallet as mint authority.
        """
        if amount <= 0:
            raise ValueError("amount must be positive")

        recipient_ata = await self.ensure_associated_token_account(recipient, self.base_mint)
        ix = mint_to(
            MintToParams(
                program_id=TOKEN_PROGRAM_ID,
                mint=self.base_mint,
                dest=recipient_ata,
                mint_authority=self.operator_kp.pubkey(),
                amount=amount,
                signers=[],
            )
        )
        blockhash = (await self.program.provider.connection.get_latest_blockhash()).value.blockhash
        tx = SoldersTransaction.new_signed_with_payer(
            [ix],
            self.operator_kp.pubkey(),
            [self.operator_kp],
            blockhash,
        )
        sig = await self.program.provider.send(tx)
        log.info(
            "mint_base_to",
            recipient=str(recipient),
            ata=str(recipient_ata),
            amount=amount,
            sig=str(sig),
        )
        return str(sig), recipient_ata

    def daily_scores_roots_pda(self, validation_timestamp_ms: int) -> Pubkey:
        epoch_day = validation_timestamp_ms // 86_400_000
        pda, _ = Pubkey.find_program_address(
            [
                b"daily_scores_roots",
                int(epoch_day).to_bytes(2, "little", signed=False),
            ],
            self.txoracle_program_id,
        )
        return pda

    # ── Market Group ───────────────────────────────────────────────────────────

    async def create_market_group(
        self,
        group_id: int,
        title: str,
        event_start_time: int,
        max_group_exposure: int = 100_000_000_000,
    ) -> str:
        """
        Create a market group for a match (contains 1X2, O/U, GG/NG markets).
        """
        gp_pda, _ = market_group_pda(self.program_id, group_id)

        sig = await self.program.rpc["create_market_group"](
            group_id,
            max_group_exposure,
            event_start_time,
            title,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market_group": gp_pda,
                    "creator": self.operator_kp.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("create_market_group", group_id=group_id, title=title, sig=str(sig))
        return str(sig)

    # ── create_market (Fixed Odds) ───────────────────────────────────────────

    async def create_market(
        self,
        start_time: int,
        num_outcomes: int,
        title: str,
        description: str,
        category: int = 0,
        market_type: str = "oneXTwo",  # oneXTwo, overUnder, goalNoGoal
        initial_odds: Optional[List[int]] = None,
        txline_fixture_id: Optional[int] = None,
        market_id: Optional[int] = None,
    ) -> tuple[int, str]:
        """
        Create a market with fixed odds. Returns (market_id, tx_signature).
        
        Args:
            start_time: Unix timestamp when match starts
            num_outcomes: 2 or 3
            title: Market title
            description: Market description
            category: 0=1X2, 1=O/U, 2=GG/NG
            market_type: Anchor enum variant name
            initial_odds: List of odds in BPS (e.g., [20000, 35000, 30000])
        """
        mid = market_id if market_id is not None else await self.next_market_id()
        mkt_pda, _ = market_pda(self.program_id, mid)

        # Get current epoch
        cfg = await self.fetch_global_config()
        current_epoch = int(cfg.current_epoch)
        ep_pda, _ = epoch_pda(self.program_id, current_epoch)

        # Convert market_type to the generated Anchor enum variant.
        market_type_enum = self.program.type["MarketType"]
        market_type_map = {
            "oneXTwo": market_type_enum.OneXTwo(),
            "overUnder": market_type_enum.OverUnder(),
            "goalNoGoal": market_type_enum.GoalNoGoal(),
        }
        market_type_arg = market_type_map.get(market_type, market_type_enum.OneXTwo())

        # Default odds if not provided
        if initial_odds is None:
            if num_outcomes == 3:
                initial_odds = [20000, 35000, 30000]  # 2.0x, 3.5x, 3.0x
            else:
                initial_odds = [20000, 20000]  # 2.0x, 2.0x

        from solders.sysvar import RENT as SYSVAR_RENT

        sig = await self.program.rpc["create_market"](
            start_time,
            num_outcomes,
            title,
            description,
            category,
            market_type_arg,
            initial_odds,
            txline_fixture_id,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                    "epoch": ep_pda,
                    "authority": self.operator_kp.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                    "rent": SYSVAR_RENT,
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("create_market", market_id=mid, title=title, odds=initial_odds, sig=str(sig))
        return mid, str(sig)

    async def add_market_to_group(
        self,
        group_id: int,
        market_id: int,
        market_index: int,
    ) -> str:
        """
        Add a market to a market group.
        """
        gp_pda, _ = market_group_pda(self.program_id, group_id)
        mkt_pda, _ = market_pda(self.program_id, market_id)

        sig = await self.program.rpc["add_market_to_group"](
            group_id,
            market_index,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market_group": gp_pda,
                    "market": mkt_pda,
                    "authority": self.operator_kp.pubkey(),
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("add_market_to_group", group_id=group_id, market_id=market_id, index=market_index)
        return str(sig)

    # ── update_market_odds ───────────────────────────────────────────────────

    async def update_market_odds(
        self,
        market_id: int,
        new_odds: List[int],
    ) -> str:
        """
        Update the fixed odds for a market.
        Can only be called before market start_time.
        """
        mkt_pda, _ = market_pda(self.program_id, market_id)

        sig = await self.program.rpc["update_market_odds"](
            market_id,
            new_odds,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                    "authority": self.operator_kp.pubkey(),
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("update_market_odds", market_id=market_id, odds=new_odds, sig=str(sig))
        return str(sig)

    async def settle_with_proof(
        self,
        market_id: int,
        txline_fixture_id: int,
        proposed_outcome: int,
        validation_timestamp: int,
        home_score: int,
        away_score: int,
        validation_input: dict[str, Any],
        strategy: dict[str, Any],
    ) -> str:
        market = await self.fetch_market(market_id)
        mkt_pda, _ = market_pda(self.program_id, market_id)
        epoch_id = int(market.epoch_id)
        ep_pda, _ = epoch_pda(self.program_id, epoch_id)
        daily_scores_roots = self.daily_scores_roots_pda(validation_timestamp)

        sig = await self.program.rpc["settle_with_proof"](
            market_id,
            proposed_outcome,
            txline_fixture_id,
            validation_timestamp,
            home_score,
            away_score,
            validation_input,
            strategy,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "market": mkt_pda,
                    "epoch": ep_pda,
                    "daily_scores_merkle_roots": daily_scores_roots,
                    "txoracle_program": self.txoracle_program_id,
                    "caller": self.operator_kp.pubkey(),
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("settle_with_proof", market_id=market_id, fixture_id=txline_fixture_id, sig=str(sig))
        return str(sig)

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

    # ── Slip Operations ────────────────────────────────────────────────────────

    async def buy_leg_for_slip(
        self,
        slip_id: int,
        leg_index: int,
        buyer: Pubkey,
    ) -> str:
        """
        Execute one leg of a slip (called by backend after user creates slip).
        """
        slip = await self.fetch_slip(slip_id)
        market_id = int(slip.leg_market_ids[leg_index])
        mkt_pda, _ = market_pda(self.program_id, market_id)
        market = await self.fetch_market(market_id)
        outcome_mint = Pubkey.from_string(str(market.outcome_mints[leg_index]))
        buyer_outcome_ata = await self.ensure_associated_token_account(buyer, outcome_mint)
        treasury_base_ata = await self.ensure_associated_token_account(self.treasury, self.base_mint)
        slip_pda, _ = slip_pda(self.program_id, slip_id)

        sig = await self.program.rpc["buy_leg_for_slip"](
            slip_id,
            leg_index,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "slip": slip_pda,
                    "market": mkt_pda,
                    "treasury": self.treasury,
                    "buyer_outcome_ata": buyer_outcome_ata,
                    "treasury_base_ata": treasury_base_ata,
                    "outcome_mint": outcome_mint,
                    "base_mint": self.base_mint,
                    "buyer": buyer,
                    "token_program": TOKEN_PROGRAM_ID,
                    "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                    "system_program": SYS_PROGRAM_ID,
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("buy_leg_for_slip", slip_id=slip_id, leg_index=leg_index, sig=str(sig))
        return str(sig)

    async def place_slip_await(
        self,
        owner: Keypair,
        legs: list[dict[str, int]],
        stake: int,
        cancel_deadline: int,
    ) -> tuple[int, str]:
        """
        Create a slip that records its legs first, then executes them later.
        Returns (slip_id, signature).
        """
        cfg = await self.fetch_global_config()
        slip_id = int(cfg.next_slip_id)
        slip_account_pda, _ = slip_pda(self.program_id, slip_id)

        owner_base_ata = await self.ensure_associated_token_account(owner.pubkey(), self.base_mint)
        treasury_base_ata = await self.ensure_associated_token_account(self.treasury, self.base_mint)

        sig = await self.program.rpc["place_slip_await"](
            legs,
            stake,
            cancel_deadline,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "slip": slip_account_pda,
                    "treasury": self.treasury,
                    "owner_base_ata": owner_base_ata,
                    "treasury_base_ata": treasury_base_ata,
                    "base_mint": self.base_mint,
                    "owner": owner.pubkey(),
                    "token_program": TOKEN_PROGRAM_ID,
                    "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                    "system_program": SYS_PROGRAM_ID,
                },
                signers=[owner],
            ),
        )
        log.info("place_slip_await", slip_id=slip_id, sig=str(sig))
        return slip_id, str(sig)

    async def settle_slip_leg(
        self,
        slip_id: int,
        leg_index: int,
    ) -> str:
        """
        Settle one leg of a slip after the market settles.
        """
        slip = await self.fetch_slip(slip_id)
        market_id = int(slip.leg_market_ids[leg_index])
        mkt_pda, _ = market_pda(self.program_id, market_id)
        slip_pda, _ = slip_pda(self.program_id, slip_id)

        sig = await self.program.rpc["settle_slip_leg"](
            slip_id,
            leg_index,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "slip": slip_pda,
                    "market": mkt_pda,
                    "authority": self.operator_kp.pubkey(),
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("settle_slip_leg", slip_id=slip_id, leg_index=leg_index, sig=str(sig))
        return str(sig)

    async def resolve_slip(self, slip_id: int) -> str:
        """
        Resolve a slip after all legs are settled.
        """
        slip = await self.fetch_slip(slip_id)
        owner = Pubkey.from_string(str(slip.owner))
        slip_pda, _ = slip_pda(self.program_id, slip_id)
        treasury_base_ata = await self.ensure_associated_token_account(self.treasury, self.base_mint)
        claimer_base_ata = await self.ensure_associated_token_account(owner, self.base_mint)

        sig = await self.program.rpc["resolve_slip"](
            slip_id,
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "slip": slip_pda,
                    "treasury": self.treasury,
                    "owner": owner,
                    "claimer_base_ata": claimer_base_ata,
                    "treasury_base_ata": treasury_base_ata,
                    "base_mint": self.base_mint,
                    "token_program": TOKEN_PROGRAM_ID,
                    "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("resolve_slip", slip_id=slip_id, sig=str(sig))
        return str(sig)

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

    # ── Epoch Operations ─────────────────────────────────────────────────────

    async def init_epoch(self) -> str:
        """
        Initialize the current epoch.
        """
        cfg = await self.fetch_global_config()
        epoch_id = int(cfg.current_epoch)
        ep_pda, _ = epoch_pda(self.program_id, epoch_id)

        sig = await self.program.rpc["init_epoch"](
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "epoch": ep_pda,
                    "admin": self.operator_kp.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("init_epoch", epoch_id=epoch_id, sig=str(sig))
        return str(sig)

    async def close_epoch(self, epoch_id: int) -> str:
        """
        Close an epoch once all markets have settled.
        """
        ep_pda, _ = epoch_pda(self.program_id, epoch_id)

        sig = await self.program.rpc["close_epoch"](
            ctx=Context(
                accounts={
                    "global_config": self.global_config,
                    "epoch": ep_pda,
                    "authority": self.operator_kp.pubkey(),
                },
                signers=[self.operator_kp],
            ),
        )
        log.info("close_epoch", epoch_id=epoch_id, sig=str(sig))
        return str(sig)

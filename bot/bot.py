"""
Quadratic Market sports bot.

Lifecycle per match:
  1. [create_markets]   Fetch upcoming fixtures → create_market + init_outcome_mints
  2. [suspend_markets]  At start_time → suspend_market (no more bets)
  3. [settle_markets]   After start_time + RESULT_DELAY_SECONDS → fetch score
                        → propose_result (oracle signs)
  4. [finalize_markets] After challenge window → finalize_result
  5. [void_expired]     If oracle never settled → void_if_expired

Run continuously:
    python bot.py

Or run a single pass (useful for cron):
    python bot.py --once
"""

from __future__ import annotations

import asyncio
import sys
import time
import argparse
from pathlib import Path

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import config
from chain import ChainClient, load_keypair
from sports_api import OddsApiClient
from state import BotState, TrackedMarket, MarketStage

# ─── Logging ──────────────────────────────────────────────────────────────────

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(__import__("logging"), config.LOG_LEVEL, 20)
    ),
)
log = structlog.get_logger(__name__)

# Path to the compiled IDL (built by `anchor build`)
IDL_PATH = Path(__file__).parent.parent / "target" / "idl" / "quadratic_market.json"


# ─── Bot tasks ────────────────────────────────────────────────────────────────

async def task_create_markets(chain: ChainClient, api: OddsApiClient, state: BotState) -> None:
    """
    Fetch upcoming fixtures and create on-chain markets for any not yet tracked.
    Also initialises outcome mints for newly created markets.
    """
    fixtures = await api.upcoming_fixtures(config.MARKET_LOOKAHEAD_SECONDS)

    for fix in fixtures:
        if state.is_tracked(fix.event_id):
            continue

        num_outcomes = 3 if fix.has_draw else 2
        home = fix.home_team
        away = fix.away_team
        title = f"{home} vs {away}"
        desc = f"{fix.sport_key} | {home} vs {away}"

        try:
            market_id, _ = await chain.create_market(
                start_time=fix.start_time,
                num_outcomes=num_outcomes,
                title=title[:128],
                description=desc[:256],
                category=0,
            )
        except Exception as exc:
            log.error("create_market_failed", event_id=fix.event_id, error=str(exc))
            continue

        state.add(TrackedMarket(
            event_id=fix.event_id,
            sport_key=fix.sport_key,
            market_id=market_id,
            num_outcomes=num_outcomes,
            start_time=fix.start_time,
            stage=MarketStage.CREATED,
            home_team=home,
            away_team=away,
        ))

    # Initialise outcome mints for markets in CREATED stage
    for m in state.all_in_stage(MarketStage.CREATED):
        try:
            for oid in range(m.num_outcomes):
                await chain.init_outcome_mint(m.market_id, oid)
            state.advance(m.event_id, MarketStage.MINTS_INIT)
        except Exception as exc:
            log.error("init_mints_failed", market_id=m.market_id, error=str(exc))


async def task_suspend_markets(chain: ChainClient, state: BotState) -> None:
    """
    Suspend markets whose start_time has passed — closes betting.
    The bot calls this so no bets can be placed once the match is live.
    """
    now = int(time.time())
    for m in state.all_in_stage(MarketStage.MINTS_INIT):
        if now < m.start_time:
            continue
        try:
            await chain.suspend_market(m.market_id)
            state.advance(m.event_id, MarketStage.SUSPENDED)
        except Exception as exc:
            log.error("suspend_failed", market_id=m.market_id, error=str(exc))


async def task_settle_markets(chain: ChainClient, api: OddsApiClient, state: BotState) -> None:
    """
    For suspended markets past the result delay, fetch the score and propose result.
    """
    now = int(time.time())
    settle_threshold = now - config.RESULT_DELAY_SECONDS

    pending = [
        m for m in state.all_in_stage(MarketStage.SUSPENDED)
        if m.start_time <= settle_threshold
    ]
    if not pending:
        return

    # Group by sport to minimise API calls
    by_sport: dict[str, list[TrackedMarket]] = {}
    for m in pending:
        by_sport.setdefault(m.sport_key, []).append(m)

    for sport, markets in by_sport.items():
        results = await api.completed_scores(sport, days_from=7)
        result_map = {r.event_id: r for r in results}

        for m in markets:
            result = result_map.get(m.event_id)
            if result is None:
                log.info("score_not_yet_available", market_id=m.market_id, event_id=m.event_id)
                continue
            if not result.completed:
                continue

            try:
                await chain.propose_result(m.market_id, result.winning_outcome)
                state.advance(
                    m.event_id,
                    MarketStage.PROPOSED,
                    proposed_outcome=result.winning_outcome,
                )
            except Exception as exc:
                log.error("propose_result_failed", market_id=m.market_id, error=str(exc))


async def task_finalize_markets(chain: ChainClient, state: BotState) -> None:
    """
    Finalize markets that are in PROPOSED stage and past the challenge window.
    The challenge window is stored on-chain; we read it from the dispute account
    by fetching the market and checking settlement_time + challenge_window.
    """
    cfg = await chain.fetch_global_config()
    challenge_window = int(cfg.challenge_window_seconds)
    now = int(time.time())

    for m in state.all_in_stage(MarketStage.PROPOSED):
        try:
            market = await chain.fetch_market(m.market_id)
            settlement_time = int(market.settlement_time)
            if now < settlement_time + challenge_window:
                continue  # window still open

            await chain.finalize_result(m.market_id)
            state.advance(m.event_id, MarketStage.FINALIZED)
        except Exception as exc:
            log.error("finalize_failed", market_id=m.market_id, error=str(exc))


async def task_void_expired(chain: ChainClient, state: BotState) -> None:
    """
    Void markets where the oracle never proposed a result within the deadline.
    Permissionless on-chain — bot just triggers it.
    """
    cfg = await chain.fetch_global_config()
    deadline_seconds = int(cfg.settlement_deadline_seconds)
    now = int(time.time())

    for m in state.all_in_stage(MarketStage.SUSPENDED):
        if now < m.start_time + deadline_seconds:
            continue
        try:
            await chain.void_if_expired(m.market_id)
            state.advance(m.event_id, MarketStage.VOIDED)
        except Exception as exc:
            log.error("void_expired_failed", market_id=m.market_id, error=str(exc))


# ─── Main loop ────────────────────────────────────────────────────────────────

async def run_once(chain: ChainClient, api: OddsApiClient, state: BotState) -> None:
    """Execute one full pass of all bot tasks in dependency order."""
    log.info("bot_pass_start")
    await task_create_markets(chain, api, state)
    await task_suspend_markets(chain, state)
    await task_settle_markets(chain, api, state)
    await task_finalize_markets(chain, state)
    await task_void_expired(chain, state)
    log.info("bot_pass_complete")


async def main(once: bool = False) -> None:
    if not IDL_PATH.exists():
        log.error("idl_not_found", path=str(IDL_PATH))
        log.error("Run `anchor build` first to generate the IDL.")
        sys.exit(1)

    operator_kp = load_keypair(config.OPERATOR_KEYPAIR_PATH)
    oracle_kp = load_keypair(config.ORACLE_KEYPAIR_PATH)

    chain = await ChainClient.create(
        rpc_url=config.RPC_URL,
        idl_path=IDL_PATH,
        program_id_str=config.PROGRAM_ID,
        operator_kp=operator_kp,
        oracle_kp=oracle_kp,
        base_mint_str=config.BASE_MINT,
    )
    api = OddsApiClient(config.ODDS_API_KEY, config.SPORTS)
    state = BotState()

    try:
        if once:
            await run_once(chain, api, state)
            return

        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            run_once,
            "interval",
            seconds=config.POLL_INTERVAL_SECONDS,
            args=[chain, api, state],
            id="bot_pass",
            max_instances=1,        # prevent overlapping runs
            coalesce=True,
        )
        scheduler.start()
        log.info("bot_started", interval_seconds=config.POLL_INTERVAL_SECONDS)

        # Run immediately on startup, then on schedule
        await run_once(chain, api, state)

        # Keep running until interrupted
        try:
            while True:
                await asyncio.sleep(60)
        except (KeyboardInterrupt, SystemExit):
            log.info("bot_stopping")
            scheduler.shutdown()
    finally:
        await chain.close()
        await api.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Quadratic Market sports bot")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single pass and exit (useful for cron jobs)",
    )
    args = parser.parse_args()
    asyncio.run(main(once=args.once))

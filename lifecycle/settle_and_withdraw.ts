/**
 * lifecycle/settle_and_withdraw.ts  — PHASE 2
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads lifecycle/state.json (written by open_and_bet.ts) and drives the rest of
 * the protocol lifecycle on a live localnet:
 *   1. wait for betting to close (now >= market.start_time)
 *   2. settle each market: propose_result (oracle) → admin_override → finalize
 *   3. single-share winners claim_payout; slip holders claim_slip
 *   4. wait for the LP deposit's activation lock, then request_withdraw + process
 *
 * Run:
 *   npx ts-node lifecycle/settle_and_withdraw.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  anchor,
  BN,
  Keypair,
  PublicKey,
  TOKEN_PROGRAM_ID,
  SEEDS,
  makeCtx,
  banner,
  logLine,
  sub,
  toUsdc,
  getOrCreateAta,
  ataAddress,
  tokenBalance,
  waitUntilChainTime,
  chainTime,
  loadState,
  kpFromJson,
  globalConfigPda,
  treasuryPda,
  lpMintPda,
  marketPda,
  outcomeMintPda,
  epochPda,
  disputePda,
  betSlipPda,
  pendingPda,
  withdrawalPda,
  printOdds,
} from "./common";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";

async function main() {
  const { connection, program, admin } = makeCtx();
  const state = loadState();

  const gcPda = globalConfigPda();
  const trPda = treasuryPda();
  const lpMint = lpMintPda();
  const baseMint = new PublicKey(state.baseMint);
  const oracle = kpFromJson(state.oracle);
  const epochId = new BN(state.epochId);
  const treasuryBaseAta = ataAddress(baseMint, trPda, true);

  banner("PHASE 2 — SETTLE, CLAIM & WITHDRAW");
  logLine(`Markets:      ${state.markets.length}`);
  logLine(`Single bets:  ${state.singleBets.length}`);
  logLine(`Slips:        ${state.slips.length}`);

  // ── 1. Wait for betting to close on all markets ──────────────────────────
  banner("WAIT FOR BETTING TO CLOSE");
  const latestStart = Math.max(...state.markets.map((m) => m.startTime));
  await waitUntilChainTime(
    connection,
    latestStart,
    "betting close (now >= start_time)"
  );

  // ── 2. Settle each market ──────────────────────────────────────────────────
  banner("SETTLE MARKETS");
  for (const mkt of state.markets) {
    const mId = new BN(mkt.marketId);
    const mPda = new PublicKey(mkt.marketPda);
    const dPda = disputePda(mId);
    const win = mkt.winningOutcome;

    logLine(
      `Market ${mkt.marketId} (${mkt.outcomeNames[win]} wins) — proposing...`
    );

    // Oracle proposes the winning outcome (requires now >= start_time).
    await program.methods
      .proposeResult(mId, win)
      .accounts({
        globalConfig: gcPda,
        market: mPda,
        dispute: dPda,
        oracle: oracle.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();
    sub(`proposed outcome ${win}`);

    // Admin override sets the dispute Overridden so finalize runs immediately
    // (no need to wait out the challenge window).
    await program.methods
      .adminOverride(mId, win)
      .accounts({
        globalConfig: gcPda,
        market: mPda,
        dispute: dPda,
        admin: admin.publicKey,
      })
      .rpc();
    sub(`admin override → dispute Overridden`);

    // Finalize (permissionless). Overridden disputes finalize without waiting.
    await program.methods
      .finalizeResult(mId)
      .accounts({
        globalConfig: gcPda,
        market: mPda,
        dispute: dPda,
        epoch: epochPda(epochId),
        caller: admin.publicKey,
      })
      .rpc();

    const m: any = await program.account.market.fetch(mPda);
    sub(
      `finalized → status ${JSON.stringify(m.status)}, winning_outcome ${m.winningOutcome}`
    );
  }

  const epochAfter: any = await program.account.epoch.fetch(epochPda(epochId));
  logLine(
    `Epoch ${state.epochId}: settled ${epochAfter.numSettledMarkets}/${epochAfter.numMarkets}, all_settled=${epochAfter.allMarketsSettled}, withdrawals_enabled=${epochAfter.withdrawalsEnabled}`
  );

  // ── 3a. Single-share winners claim payout ──────────────────────────────────
  banner("SINGLE-SHARE CLAIMS");
  for (const bet of state.singleBets) {
    const mkt = state.markets.find((m) => m.marketId === bet.marketId)!;
    const won = bet.outcomeId === mkt.winningOutcome;
    const user = kpFromJson(bet.user);
    const mId = new BN(bet.marketId);
    const mPda = new PublicKey(mkt.marketPda);
    const winningMint = new PublicKey(mkt.outcomeMints[mkt.winningOutcome]);

    if (!won) {
      sub(
        `${bet.userLabel}: outcome ${bet.outcomeId} (${mkt.outcomeNames[bet.outcomeId]}) LOST — position expires worthless`
      );
      continue;
    }

    const userBase = ataAddress(baseMint, user.publicKey);
    const userWinningAta = await getOrCreateAta(
      connection,
      admin,
      winningMint,
      user.publicKey
    );
    const balBefore = await tokenBalance(connection, userBase);
    await program.methods
      .claimPayout(mId)
      .accounts({
        globalConfig: gcPda,
        market: mPda,
        treasury: trPda,
        claimerOutcomeAta: userWinningAta,
        claimerBaseAta: userBase,
        treasuryBaseAta,
        outcomeMint: winningMint,
        baseMint,
        claimer: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
    const balAfter = await tokenBalance(connection, userBase);
    const payout = Number(balAfter) - Number(balBefore);
    sub(
      `${bet.userLabel}: outcome ${bet.outcomeId} (${mkt.outcomeNames[bet.outcomeId]}) WON — claimed ${toUsdc(payout)}`
    );
  }

  // ── 3b. Slip holders claim ──────────────────────────────────────────────────
  banner("SLIP CLAIMS");
  for (const slip of state.slips) {
    const user = kpFromJson(slip.user);
    const slipId = new BN(slip.slipId);
    const slipPda = betSlipPda(slipId);

    // Determine if every leg won (all-or-nothing).
    const allWon = slip.legs.every((leg) => {
      const mkt = state.markets.find((m) => m.marketId === leg.marketId)!;
      return leg.outcomeId === mkt.winningOutcome;
    });

    // remaining_accounts: [market, outcome_mint, slip_outcome_ata] per leg.
    const remaining: anchor.web3.AccountMeta[] = [];
    for (const leg of slip.legs) {
      const mkt = state.markets.find((m) => m.marketId === leg.marketId)!;
      const mPda = new PublicKey(mkt.marketPda);
      const mint = new PublicKey(leg.mint);
      const slipOutcomeAta = ataAddress(mint, slipPda, true);
      remaining.push({ pubkey: mPda, isSigner: false, isWritable: true });
      remaining.push({ pubkey: mint, isSigner: false, isWritable: true });
      remaining.push({ pubkey: slipOutcomeAta, isSigner: false, isWritable: true });
    }

    const userBase = ataAddress(baseMint, user.publicKey);
    const balBefore = await tokenBalance(connection, userBase);
    await program.methods
      .claimSlip(slipId, 0)
      .accounts({
        globalConfig: gcPda,
        betSlip: slipPda,
        treasury: trPda,
        claimerBaseAta: userBase,
        treasuryBaseAta,
        baseMint,
        claimer: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      // claim_slip deserializes a Market per leg (heap-allocated strings) — give
      // the custom allocator a larger heap frame so multi-leg claims fit.
      .preInstructions([
        ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ])
      .remainingAccounts(remaining)
      .signers([user])
      .rpc();
    const balAfter = await tokenBalance(connection, userBase);
    const delta = Number(balAfter) - Number(balBefore);
    sub(
      `${slip.userLabel} slip #${slip.slipId}: ${allWon ? "ALL LEGS WON" : "LOST (no payout)"} — net ${toUsdc(delta)}`
    );
  }

  // ── 4. LP withdrawal ─────────────────────────────────────────────────────
  banner("LP WITHDRAWAL");
  const lp = kpFromJson(state.lp.provider);
  const lpBaseAta = new PublicKey(state.lp.baseAta);
  const lpLpAta = new PublicKey(state.lp.lpAta);
  const treasuryLpAta = await getOrCreateAta(connection, admin, lpMint, trPda, true);

  // The LP deposit's shares are locked until lpActivationTime.
  await waitUntilChainTime(
    connection,
    state.lpActivationTime,
    "LP shares unlock"
  );

  const lpShares = await tokenBalance(connection, lpLpAta);
  logLine(`LP shares to withdraw: ${lpShares.toString()}`);

  // request_withdraw validates the epoch account against global_config.current_epoch,
  // which advance_epoch (called inside add_liquidity) rolled forward to ~now/dur.
  // That epoch was never initialized; init it now (idempotent). An epoch with 0
  // markets is created with withdrawals_enabled = true, which is exactly what the
  // withdrawal gate requires.
  const cfgNow: any = await program.account.globalConfig.fetch(gcPda);
  const currentEpochId: BN = cfgNow.currentEpoch;
  const currentEpochPda = epochPda(currentEpochId);
  logLine(`current_epoch is ${currentEpochId.toString()} (markets settled in epoch ${state.epochId})`);
  await program.methods
    .initEpoch()
    .accounts({
      globalConfig: gcPda,
      epoch: currentEpochPda,
      authority: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  const ce: any = await program.account.epoch.fetch(currentEpochPda);
  logLine(
    `current_epoch ${currentEpochId.toString()}: withdrawals_enabled=${ce.withdrawalsEnabled}`
  );

  // request_withdraw
  await program.methods
    .requestWithdraw(new BN(lpShares.toString()))
    .accounts({
      globalConfig: gcPda,
      lpMint,
      treasury: trPda,
      treasuryBaseAta,
      treasuryLpAta,
      lpLpAta,
      pendingLiquidity: pendingPda(lp.publicKey),
      withdrawalRequest: withdrawalPda(lp.publicKey),
      baseMint,
      epoch: currentEpochPda,
      lp: lp.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([lp])
    .rpc();
  const req: any = await program.account.withdrawalRequest.fetch(
    withdrawalPda(lp.publicKey)
  );
  logLine(
    `Withdrawal requested: ${req.shares.toString()} shares, cooldown_end unix ${req.cooldownEnd}`
  );

  // Wait out the (possibly zero) cooldown.
  await waitUntilChainTime(
    connection,
    Number(req.cooldownEnd),
    "withdrawal cooldown"
  );

  const balBefore = await tokenBalance(connection, lpBaseAta);
  await program.methods
    .processWithdrawal()
    .accounts({
      globalConfig: gcPda,
      lpMint,
      treasury: trPda,
      treasuryBaseAta,
      treasuryLpAta,
      lpBaseAta,
      baseMint,
      withdrawalRequest: withdrawalPda(lp.publicKey),
      authority: lp.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([lp])
    .rpc();
  const balAfter = await tokenBalance(connection, lpBaseAta);
  const returned = Number(balAfter) - Number(balBefore);
  logLine(`LP withdrawal processed — returned ${toUsdc(returned)}`);
  logLine(`LP deposited ${toUsdc(Number(state.lp.deposited))}, got back ${toUsdc(returned)}`);

  // ── Final summary ─────────────────────────────────────────────────────────
  banner("FINAL SUMMARY");
  const cfg: any = await program.account.globalConfig.fetch(gcPda);
  const treas = await tokenBalance(connection, treasuryBaseAta);
  logLine(`Treasury balance:  ${toUsdc(Number(treas))}`);
  logLine(`Locked payouts:    ${toUsdc(cfg.lockedPayouts)}`);
  logLine(`Total LP supply:   ${cfg.totalLpSupply.toString()}`);
  for (const mkt of state.markets) {
    const m: any = await program.account.market.fetch(new PublicKey(mkt.marketPda));
    logLine(
      `Market ${mkt.marketId}: status ${JSON.stringify(m.status)}, winner ${m.winningOutcome} (${mkt.outcomeNames[m.winningOutcome]})`
    );
  }

  banner("PHASE 2 COMPLETE ✓");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

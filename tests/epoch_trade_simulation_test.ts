/**
 * Epoch-based Trading Simulation
 * ────────────────────────────────────────────────────────────────
 * Full end-to-end simulation of one complete epoch:
 *   1. Protocol initialisation
 *   2. Epoch 0 opened
 *   3. Two LPs fund the pool
 *   4. Two markets created (Team A vs B, Team C vs D)
 *   5. Two traders buy shares in each market
 *   6. Both markets suspended → oracle proposes results → finalized
 *      (settling the last market auto-closes the epoch)
 *   7. LP1 requests and processes withdrawal
 *   8. Assertions on final balances
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { QuadraticMarket } from "../target/types/quadratic_market";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";

const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;

// ─── helpers ────────────────────────────────────────────────────

async function createAta(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  allowOffCurve = false
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(
    mint, owner, allowOffCurve, TOKEN_PROGRAM, ATA_PROGRAM
  );
  await provider.sendAndConfirm(
    new Transaction().add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey, ata, owner, mint, TOKEN_PROGRAM, ATA_PROGRAM
      )
    ),
    []
  );
  return ata;
}

async function airdrop(
  provider: anchor.AnchorProvider,
  kp: Keypair,
  sol = 2
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(
    kp.publicKey, sol * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig);
}

function marketPda(programId: PublicKey, marketId: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

function disputePda(programId: PublicKey, marketId: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("dispute"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

function outcomeMintPda(
  programId: PublicKey, marketId: number, outcomeId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("outcome_mint"),
      new anchor.BN(marketId).toArrayLike(Buffer, "le", 8),
      Buffer.from([outcomeId]),
    ],
    programId
  );
  return pda;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── suite ──────────────────────────────────────────────────────

describe("epoch_trade_simulation — full epoch lifecycle with 2 markets", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
  const admin = provider.wallet.payer;

  // Keypairs
  const oracle    = Keypair.generate();
  const operator  = Keypair.generate();
  const lp1       = Keypair.generate();
  const lp2       = Keypair.generate();
  const trader1   = Keypair.generate();
  const trader2   = Keypair.generate();
  const mintAuth  = Keypair.generate();

  // PDAs – derived once in before()
  let globalConfig: PublicKey;
  let lpMint: PublicKey;
  let treasury: PublicKey;
  let epoch0: PublicKey;

  // Token accounts
  let baseMint: PublicKey;
  let treasuryBaseAta: PublicKey;
  let treasuryLpAta: PublicKey;

  // LP ATAs
  let lp1BaseAta: PublicKey;
  let lp1LpAta: PublicKey;
  let lp1PendingLiquidity: PublicKey;
  let lp1WithdrawReq: PublicKey;

  let lp2BaseAta: PublicKey;
  let lp2LpAta: PublicKey;
  let lp2PendingLiquidity: PublicKey;

  // Market 1 (Team A beats Team B)
  let market1Id: number;
  let market1: PublicKey;
  let market1Mint0: PublicKey;
  let market1Mint1: PublicKey;
  let trader1Outcome0Ata: PublicKey;
  let dispute1: PublicKey;

  // Market 2 (Team C beats Team D)
  let market2Id: number;
  let market2: PublicKey;
  let market2Mint0: PublicKey;
  let market2Mint1: PublicKey;
  let trader2Outcome1Ata: PublicKey;
  let dispute2: PublicKey;

  let skipSuite = false;

  // ── before: derive static PDAs ────────────────────────────────
  before(async () => {
    [globalConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")], program.programId
    );
    [lpMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint")], program.programId
    );
    [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")], program.programId
    );

    // Skip entire suite if protocol was already initialized by a prior test file.
    try {
      await program.account.globalConfig.fetch(globalConfig);
      console.log("  ⚠  Protocol already initialized — skipping epoch_trade_simulation suite");
      skipSuite = true;
      return;
    } catch (_) {
      // fresh validator — proceed
    }

    // Fund all participants with SOL
    for (const kp of [oracle, operator, lp1, lp2, trader1, trader2]) {
      await airdrop(provider, kp);
    }

    // Create base SPL token (6 decimals, like USDC)
    baseMint = await createMint(
      provider.connection, admin,
      mintAuth.publicKey, null, 6,
      undefined, TOKEN_PROGRAM
    );

    // Treasury ATAs (treasury is an off-curve PDA)
    treasuryBaseAta = await createAta(provider, baseMint, treasury, true);

    // LP1 setup
    lp1BaseAta = await createAta(provider, baseMint, lp1.publicKey);
    await mintTo(provider.connection, admin, baseMint, lp1BaseAta, mintAuth, 2_000_000_000);

    // LP2 setup
    lp2BaseAta = await createAta(provider, baseMint, lp2.publicKey);
    await mintTo(provider.connection, admin, baseMint, lp2BaseAta, mintAuth, 1_000_000_000);

    // Trader ATAs
    const trader1BaseAta = await createAta(provider, baseMint, trader1.publicKey);
    await mintTo(provider.connection, admin, baseMint, trader1BaseAta, mintAuth, 500_000_000);
    const trader2BaseAta = await createAta(provider, baseMint, trader2.publicKey);
    await mintTo(provider.connection, admin, baseMint, trader2BaseAta, mintAuth, 500_000_000);

    // PDA derivations for LP accounts
    [lp1PendingLiquidity] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), lp1.publicKey.toBuffer()], program.programId
    );
    [lp1WithdrawReq] = PublicKey.findProgramAddressSync(
      [Buffer.from("withdrawal"), lp1.publicKey.toBuffer()], program.programId
    );
    [lp2PendingLiquidity] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), lp2.publicKey.toBuffer()], program.programId
    );
  });

  // ══════════════════════════════════════════════════════════════
  // PHASE 1 — Protocol Initialisation
  // ══════════════════════════════════════════════════════════════

  it("Phase 1a: Initializes the protocol", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    await program.methods
      .initialize(
        Array.from(oracle.publicKey.toBytes()) as unknown as number[] & { length: 32 },
        new anchor.BN(5_000_000_000)   // max_market_exposure = 5 000 USDC
      )
      .accounts({
        globalConfig,
        lpMint,
        treasury,
        baseMint,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const cfg = await program.account.globalConfig.fetch(globalConfig);
    assert.equal(cfg.admin.toString(), admin.publicKey.toString());
    assert.equal(cfg.paused, false);
    console.log("    ✓ Protocol initialized — oracle:", oracle.publicKey.toBase58().slice(0, 8) + "…");
  });

  it("Phase 1b: Registers operator and tunes config", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    // Register operator so they can create markets and init epochs
    await program.methods
      .addOperator(operator.publicKey)
      .accounts({ globalConfig, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    // Set challenge_window = 0 (instant finalization in tests),
    // withdrawal_cooldown = 0 (instant processing), epoch_duration = 60s.
    await program.methods
      .updateConfig(
        null,                       // max_market_exposure
        new anchor.BN(0),           // challenge_window_seconds = 0
        new anchor.BN(60),          // settlement_deadline_seconds
        null,                       // lmsr_default_b
        null,                       // slip_house_margin_bps
        null,                       // max_slip_bonus_multiplier_bps
        new anchor.BN(60),          // epoch_duration_seconds = 60s
        new anchor.BN(0),           // withdrawal_cooldown_seconds = 0
        null,                       // max_single_bet
        null,                       // min_outcome_price_bps
        null,                       // buy_fee_bps
        null,                       // oracle_pubkey
        null                        // cash_out_margin_bps
      )
      .accounts({ globalConfig, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    const cfg = await program.account.globalConfig.fetch(globalConfig);
    assert.equal(cfg.challengeWindowSeconds.toNumber(), 0);
    assert.equal(cfg.withdrawalCooldownSeconds.toNumber(), 0);
    console.log("    ✓ Operator added, config tuned (challenge_window=0, cooldown=0)");
  });

  // ══════════════════════════════════════════════════════════════
  // PHASE 2 — Open Epoch 0
  // ══════════════════════════════════════════════════════════════

  it("Phase 2: Opens epoch 0", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    const cfg = await program.account.globalConfig.fetch(globalConfig);
    const epochId = cfg.currentEpoch.toNumber();

    [epoch0] = PublicKey.findProgramAddressSync(
      [Buffer.from("epoch"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .initEpoch()
      .accounts({
        globalConfig,
        epoch: epoch0,
        authority: operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([operator])
      .rpc();

    const epochAcc = await program.account.epoch.fetch(epoch0);
    assert.equal(epochAcc.epochId.toNumber(), epochId);
    assert.equal(epochAcc.withdrawalsEnabled, true);  // enabled until first market created
    console.log("    ✓ Epoch", epochId, "opened — PDA:", epoch0.toBase58().slice(0, 8) + "…");
  });

  // ══════════════════════════════════════════════════════════════
  // PHASE 3 — LP Funding
  // ══════════════════════════════════════════════════════════════

  it("Phase 3a: LP1 adds 1 000 USDC of liquidity", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    // Create LP1's LP token ATA now that lpMint exists
    lp1LpAta = await createAta(provider, lpMint, lp1.publicKey);

    const depositAmount = 1_000_000_000; // 1 000 USDC (6 dec)

    await program.methods
      .addLiquidity(new anchor.BN(depositAmount))
      .accounts({
        globalConfig,
        lpMint,
        treasury,
        treasuryBaseAta,
        providerBaseAta: lp1BaseAta,
        providerLpAta: lp1LpAta,
        baseMint,
        pendingLiquidity: lp1PendingLiquidity,
        provider: lp1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp1])
      .rpc();

    const lp1LpBal = await getAccount(provider.connection, lp1LpAta);
    assert.ok(Number(lp1LpBal.amount) > 0, "LP1 should have received LP tokens");

    const treasuryBal = await getAccount(provider.connection, treasuryBaseAta);
    assert.equal(Number(treasuryBal.amount), depositAmount);
    console.log("    ✓ LP1 deposited 1 000 USDC — LP shares:", lp1LpBal.amount.toString());
  });

  it("Phase 3b: LP2 adds 500 USDC of liquidity", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    lp2LpAta = await createAta(provider, lpMint, lp2.publicKey);
    const depositAmount = 500_000_000; // 500 USDC

    await program.methods
      .addLiquidity(new anchor.BN(depositAmount))
      .accounts({
        globalConfig,
        lpMint,
        treasury,
        treasuryBaseAta,
        providerBaseAta: lp2BaseAta,
        providerLpAta: lp2LpAta,
        baseMint,
        pendingLiquidity: lp2PendingLiquidity,
        provider: lp2.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp2])
      .rpc();

    const lp2LpBal = await getAccount(provider.connection, lp2LpAta);
    assert.ok(Number(lp2LpBal.amount) > 0, "LP2 should have received LP tokens");

    const treasuryBal = await getAccount(provider.connection, treasuryBaseAta);
    assert.equal(Number(treasuryBal.amount), 1_500_000_000); // 1 000 + 500
    console.log("    ✓ LP2 deposited 500 USDC — total treasury: 1 500 USDC");
  });

  // ══════════════════════════════════════════════════════════════
  // PHASE 4 — Market Creation
  // ══════════════════════════════════════════════════════════════

  it("Phase 4a: Creates Market 1 — 'Will Team A beat Team B?'", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    const cfg = await program.account.globalConfig.fetch(globalConfig);
    market1Id = cfg.nextMarketId.toNumber();
    market1   = marketPda(program.programId, market1Id);
    dispute1  = disputePda(program.programId, market1Id);

    // start_time = 5 seconds from now (give us a moment to trade, then wait for it to pass)
    const startTime = Math.floor(Date.now() / 1000) + 5;

    await program.methods
      .createMarket(
        new anchor.BN(startTime),
        2,
        "Will Team A beat Team B?",
        "Binary market: Team A wins (outcome 0) or Team B wins (outcome 1)",
        0,          // category (sports = 0 as u8)
        null,       // lmsr_b_override
        null,       // initial_q_values
        { trading: {} } as any   // market_mode
      )
      .accounts({
        globalConfig,
        market: market1,
        epoch: epoch0,
        authority: operator.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([operator])
      .rpc();

    const m = await program.account.market.fetch(market1);
    assert.equal(m.marketId.toNumber(), market1Id);
    assert.equal(m.numOutcomes, 2);
    console.log("    ✓ Market 1 created — id:", market1Id);
  });

  it("Phase 4b: Creates Market 2 — 'Will Team C beat Team D?'", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    const cfg = await program.account.globalConfig.fetch(globalConfig);
    market2Id = cfg.nextMarketId.toNumber();
    market2   = marketPda(program.programId, market2Id);
    dispute2  = disputePda(program.programId, market2Id);

    const startTime = Math.floor(Date.now() / 1000) + 5;

    await program.methods
      .createMarket(
        new anchor.BN(startTime),
        2,
        "Will Team C beat Team D?",
        "Binary market: Team C wins (outcome 0) or Team D wins (outcome 1)",
        0,
        null,
        null,
        { trading: {} } as any
      )
      .accounts({
        globalConfig,
        market: market2,
        epoch: epoch0,
        authority: operator.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([operator])
      .rpc();

    const m = await program.account.market.fetch(market2);
    assert.equal(m.marketId.toNumber(), market2Id);
    console.log("    ✓ Market 2 created — id:", market2Id);

    // Both markets are now registered in epoch 0
    const epochAcc = await program.account.epoch.fetch(epoch0);
    assert.equal(epochAcc.numMarkets, 2);
    console.log("    ✓ Epoch 0 now tracks 2 markets");
  });

  it("Phase 4c: Initializes outcome mints for both markets", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    // Market 1 outcome mints
    market1Mint0 = outcomeMintPda(program.programId, market1Id, 0);
    market1Mint1 = outcomeMintPda(program.programId, market1Id, 1);

    for (const [oid, mintPda] of [[0, market1Mint0], [1, market1Mint1]] as [number, PublicKey][]) {
      await program.methods
        .initOutcomeMint(new anchor.BN(market1Id), oid)
        .accounts({
          globalConfig,
          market: market1,
          outcomeMint: mintPda,
          payer: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    }

    // Market 2 outcome mints
    market2Mint0 = outcomeMintPda(program.programId, market2Id, 0);
    market2Mint1 = outcomeMintPda(program.programId, market2Id, 1);

    for (const [oid, mintPda] of [[0, market2Mint0], [1, market2Mint1]] as [number, PublicKey][]) {
      await program.methods
        .initOutcomeMint(new anchor.BN(market2Id), oid)
        .accounts({
          globalConfig,
          market: market2,
          outcomeMint: mintPda,
          payer: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    }

    console.log("    ✓ All 4 outcome mints initialized");
  });

  // ══════════════════════════════════════════════════════════════
  // PHASE 5 — Trading
  // ══════════════════════════════════════════════════════════════

  it("Phase 5a: Trader1 buys 100 shares of Market 1 outcome 0 (Team A wins)", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    // Create trader1's ATA for market1 outcome 0 token
    trader1Outcome0Ata = await createAta(provider, market1Mint0, trader1.publicKey);
    const trader1BaseAta = getAssociatedTokenAddressSync(
      baseMint, trader1.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
    );

    const baseBalBefore = await getAccount(provider.connection, trader1BaseAta);

    await program.methods
      .buyShares(
        0,                          // outcome_id: Team A wins
        new anchor.BN(100_000_000), // num_shares: 100 shares
        new anchor.BN(200_000_000)  // max_payment: 200 USDC (generous slippage)
      )
      .accounts({
        globalConfig,
        market: market1,
        treasury,
        buyerBaseAta: trader1BaseAta,
        treasuryBaseAta,
        buyerOutcomeAta: trader1Outcome0Ata,
        outcomeMint: market1Mint0,
        baseMint,
        buyer: trader1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader1])
      .rpc();

    const sharesBal = await getAccount(provider.connection, trader1Outcome0Ata);
    assert.equal(Number(sharesBal.amount), 100_000_000, "Trader1 should hold 100 outcome shares");

    const baseBalAfter = await getAccount(provider.connection, trader1BaseAta);
    const paid = Number(baseBalBefore.amount) - Number(baseBalAfter.amount);
    assert.ok(paid > 0, "Trader1 should have paid base tokens");
    console.log("    ✓ Trader1 bought 100 shares of Market 1 outcome 0 — cost:", paid / 1e6, "USDC");
  });

  it("Phase 5b: Trader2 buys 80 shares of Market 2 outcome 1 (Team D wins)", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    trader2Outcome1Ata = await createAta(provider, market2Mint1, trader2.publicKey);
    const trader2BaseAta = getAssociatedTokenAddressSync(
      baseMint, trader2.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
    );

    const baseBalBefore = await getAccount(provider.connection, trader2BaseAta);

    await program.methods
      .buyShares(
        1,                          // outcome_id: Team D wins
        new anchor.BN(80_000_000),  // num_shares: 80 shares
        new anchor.BN(200_000_000)  // max_payment: 200 USDC
      )
      .accounts({
        globalConfig,
        market: market2,
        treasury,
        buyerBaseAta: trader2BaseAta,
        treasuryBaseAta,
        buyerOutcomeAta: trader2Outcome1Ata,
        outcomeMint: market2Mint1,
        baseMint,
        buyer: trader2.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader2])
      .rpc();

    const sharesBal = await getAccount(provider.connection, trader2Outcome1Ata);
    assert.equal(Number(sharesBal.amount), 80_000_000, "Trader2 should hold 80 outcome shares");

    const baseBalAfter = await getAccount(provider.connection, trader2BaseAta);
    const paid = Number(baseBalBefore.amount) - Number(baseBalAfter.amount);
    assert.ok(paid > 0, "Trader2 should have paid base tokens");
    console.log("    ✓ Trader2 bought 80 shares of Market 2 outcome 1 — cost:", paid / 1e6, "USDC");
  });

  // ══════════════════════════════════════════════════════════════
  // PHASE 6 — Settlement (wait for markets to start, then settle)
  // ══════════════════════════════════════════════════════════════

  it("Phase 6: Waits for match start times to pass (6 s)", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }
    console.log("    … waiting 6 s for market start times to pass …");
    await sleep(6_000);
    console.log("    ✓ Start times passed");
  });

  it("Phase 6a: Suspends Market 1 and oracle proposes Team A wins (outcome 0)", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    await program.methods
      .suspendMarket()
      .accounts({ globalConfig, market: market1, authority: operator.publicKey })
      .signers([operator])
      .rpc();

    await program.methods
      .proposeResult(new anchor.BN(market1Id), 0)
      .accounts({
        globalConfig,
        market: market1,
        dispute: dispute1,
        oracle: oracle.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    const m = await program.account.market.fetch(market1);
    assert.deepEqual(m.status, { proposed: {} });
    console.log("    ✓ Market 1 suspended + result proposed (outcome 0 = Team A wins)");
  });

  it("Phase 6b: Finalizes Market 1 (challenge_window = 0 → immediate)", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    await program.methods
      .finalizeResult(new anchor.BN(market1Id))
      .accounts({
        globalConfig,
        market: market1,
        dispute: dispute1,
        epoch: epoch0,
        caller: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    const m = await program.account.market.fetch(market1);
    assert.deepEqual(m.status, { settled: {} });
    assert.equal(m.winningOutcome, 0);

    const epochAcc = await program.account.epoch.fetch(epoch0);
    assert.equal(epochAcc.numSettledMarkets, 1);
    assert.equal(epochAcc.withdrawalsEnabled, false, "Epoch still open — market 2 not settled");
    console.log("    ✓ Market 1 finalized — winning outcome: Team A (0)");
  });

  it("Phase 6c: Suspends Market 2 and oracle proposes Team D wins (outcome 1)", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    await program.methods
      .suspendMarket()
      .accounts({ globalConfig, market: market2, authority: operator.publicKey })
      .signers([operator])
      .rpc();

    await program.methods
      .proposeResult(new anchor.BN(market2Id), 1)
      .accounts({
        globalConfig,
        market: market2,
        dispute: dispute2,
        oracle: oracle.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    const m = await program.account.market.fetch(market2);
    assert.deepEqual(m.status, { proposed: {} });
    console.log("    ✓ Market 2 suspended + result proposed (outcome 1 = Team D wins)");
  });

  it("Phase 6d: Finalizes Market 2 — epoch auto-closes since all markets settled", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    await program.methods
      .finalizeResult(new anchor.BN(market2Id))
      .accounts({
        globalConfig,
        market: market2,
        dispute: dispute2,
        epoch: epoch0,
        caller: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    const m = await program.account.market.fetch(market2);
    assert.deepEqual(m.status, { settled: {} });
    assert.equal(m.winningOutcome, 1);

    // Epoch should now be fully settled → withdrawals unlocked automatically
    const epochAcc = await program.account.epoch.fetch(epoch0);
    assert.equal(epochAcc.numSettledMarkets, 2);
    assert.equal(epochAcc.allMarketsSettled, true);
    assert.equal(epochAcc.withdrawalsEnabled, true,
      "Withdrawals should be unlocked once all markets are settled"
    );
    console.log("    ✓ Market 2 finalized — epoch fully settled, LP withdrawals ENABLED");
  });

  // ══════════════════════════════════════════════════════════════
  // PHASE 7 — LP Withdrawal
  // ══════════════════════════════════════════════════════════════

  it("Phase 7a: LP1 requests withdrawal of LP shares", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    // Create treasury LP ATA (needed by requestWithdraw to escrow LP tokens)
    treasuryLpAta = await createAta(provider, lpMint, treasury, true);

    const lp1LpBal = await getAccount(provider.connection, lp1LpAta);
    const sharesToWithdraw = lp1LpBal.amount;
    assert.ok(Number(sharesToWithdraw) > 0, "LP1 must have LP tokens to withdraw");

    await program.methods
      .requestWithdraw(new anchor.BN(sharesToWithdraw.toString()))
      .accounts({
        globalConfig,
        lpMint,
        treasury,
        treasuryBaseAta,
        treasuryLpAta,
        lpLpAta: lp1LpAta,
        pendingLiquidity: lp1PendingLiquidity,
        withdrawalRequest: lp1WithdrawReq,
        baseMint,
        epoch: epoch0,
        lp: lp1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp1])
      .rpc();

    const req = await program.account.withdrawalRequest.fetch(lp1WithdrawReq);
    assert.equal(req.lp.toString(), lp1.publicKey.toString());
    assert.ok(req.shares.toNumber() > 0);

    // LP tokens should now be in treasury escrow
    const lp1LpBalAfter = await getAccount(provider.connection, lp1LpAta);
    assert.equal(Number(lp1LpBalAfter.amount), 0, "LP tokens escrowed after request");
    console.log("    ✓ LP1 requested withdrawal of", sharesToWithdraw.toString(), "shares");
  });

  it("Phase 7b: LP1 processes withdrawal and receives base tokens back", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    const baseBalBefore = await getAccount(provider.connection, lp1BaseAta);

    await program.methods
      .processWithdrawal()
      .accounts({
        globalConfig,
        lpMint,
        treasury,
        treasuryBaseAta,
        treasuryLpAta,
        lpBaseAta: lp1BaseAta,
        baseMint,
        withdrawalRequest: lp1WithdrawReq,
        authority: lp1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp1])
      .rpc();

    const baseBalAfter = await getAccount(provider.connection, lp1BaseAta);
    const received = Number(baseBalAfter.amount) - Number(baseBalBefore.amount);
    assert.ok(received > 0, "LP1 should have received base tokens back");
    console.log("    ✓ LP1 received", received / 1e6, "USDC back from withdrawal");
  });

  // ══════════════════════════════════════════════════════════════
  // PHASE 8 — Final assertions
  // ══════════════════════════════════════════════════════════════

  it("Phase 8: Final state assertions", async () => {
    if (skipSuite) { console.log("  SKIPPED"); return; }

    // Market 1 — Team A won → trader1 holds winning shares
    const m1 = await program.account.market.fetch(market1);
    assert.deepEqual(m1.status, { settled: {} });
    assert.equal(m1.winningOutcome, 0);

    // Market 2 — Team D won → trader2 holds winning shares
    const m2 = await program.account.market.fetch(market2);
    assert.deepEqual(m2.status, { settled: {} });
    assert.equal(m2.winningOutcome, 1);

    // Epoch: all settled, withdrawals enabled
    const epochAcc = await program.account.epoch.fetch(epoch0);
    assert.equal(epochAcc.allMarketsSettled, true);
    assert.equal(epochAcc.withdrawalsEnabled, true);

    // LP1 has no more LP tokens (fully withdrawn)
    const lp1LpBal = await getAccount(provider.connection, lp1LpAta);
    assert.equal(Number(lp1LpBal.amount), 0, "LP1 fully exited");

    // LP2 still holds their LP tokens
    const lp2LpBal = await getAccount(provider.connection, lp2LpAta);
    assert.ok(Number(lp2LpBal.amount) > 0, "LP2 still holds LP tokens");

    // Protocol global config consistent
    const cfg = await program.account.globalConfig.fetch(globalConfig);
    assert.ok(cfg.totalLpSupply.toNumber() > 0, "Some LP supply remains (LP2 is still in)");

    console.log("    ✓ All final state assertions passed");
    console.log("    ─────────────────────────────────────────────────");
    console.log("    Epoch simulation summary:");
    console.log("      Markets settled:    2 / 2");
    console.log("      LP1 exited:         yes");
    console.log("      LP2 still in pool:  yes");
    console.log("      Winning outcomes:   Market1=0(TeamA), Market2=1(TeamD)");
    console.log("    ─────────────────────────────────────────────────");
  });
});

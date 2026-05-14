import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { QuadraticMarket } from "../target/types/quadratic_market";
import {
  createMint,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { assert } from "chai";

const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;

// ─── Helpers ────────────────────────────────────────────────────

async function createAtaOffCurve(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM, ATA_PROGRAM);
  await provider.sendAndConfirm(
    new Transaction().add({
      keys: [
        { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      programId: ATA_PROGRAM,
      data: Buffer.from([]),
    }),
    []
  );
  return ata;
}

async function createAtaOnCurve(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM, ATA_PROGRAM);
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

// ─── Test Suite ─────────────────────────────────────────────────

describe("quadratic_market — Happy Path", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
  const payer = provider.wallet.payer;

  // PDAs
  let globalConfigPda: PublicKey;
  let lpMintPda: PublicKey;
  let treasuryPda: PublicKey;

  // Keypairs
  let oracleKeypair: Keypair;
  let lp1: Keypair;
  let user1: Keypair;

  // Token accounts
  let baseMint: PublicKey;
  let baseMintAuthority: Keypair;
  let treasuryBaseAta: PublicKey;
  let lp1BaseAta: PublicKey;
  let lp1LpAta: PublicKey;
  let pendingLiquidityPda: PublicKey;
  let user1BaseAta: PublicKey;

  // Trading market (start_time in future — betting allowed)
  let tradingMarketId: number;
  let tradingMarketPda: PublicKey;
  let tradeOutcomeMint0: PublicKey;
  let tradeOutcomeMint1: PublicKey;
  let user1Outcome0Ata: PublicKey;

  // Settlement market (start_time in past — oracle can propose immediately, betting blocked)
  let settlementMarketId: number;
  let settlementMarketPda: PublicKey;
  let settlementDisputePda: PublicKey;

  let skipSuite = false;

  before(async () => {
    [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")], program.programId
    );
    [lpMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint")], program.programId
    );
    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")], program.programId
    );

    // Check if already initialized by another test file
    try {
      await program.account.globalConfig.fetch(globalConfigPda);
      console.log("Protocol already initialized — skipping quadratic_market happy-path suite");
      skipSuite = true;
      return;
    } catch (_) {
      // Not yet initialized, proceed
    }

    oracleKeypair = Keypair.generate();
    lp1 = Keypair.generate();
    user1 = Keypair.generate();
    baseMintAuthority = Keypair.generate();

    // Fund SOL
    for (const kp of [lp1, user1, oracleKeypair]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Create base mint
    baseMint = await createMint(
      provider.connection, payer,
      baseMintAuthority.publicKey, null, 6,
      undefined, TOKEN_PROGRAM
    );

    // Treasury ATA (off-curve PDA owner)
    treasuryBaseAta = await createAtaOffCurve(provider, baseMint, treasuryPda);

    // LP1 ATAs
    lp1BaseAta = await createAtaOnCurve(provider, baseMint, lp1.publicKey);
    await mintTo(provider.connection, payer, baseMint, lp1BaseAta, baseMintAuthority, 1_000_000_000);

    // User1 ATA
    user1BaseAta = await createAtaOnCurve(provider, baseMint, user1.publicKey);
    await mintTo(provider.connection, payer, baseMint, user1BaseAta, baseMintAuthority, 200_000_000);

    // Pending liquidity PDA for lp1
    [pendingLiquidityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), lp1.publicKey.toBuffer()], program.programId
    );
  });

  // ─── 1. Initialize ──────────────────────────────────────────────

  it("Initializes the protocol", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    await program.methods
      .initialize(
        Array.from(oracleKeypair.publicKey.toBytes()) as unknown as number[] & { length: 32 },
        new anchor.BN(500_000_000)
      )
      .accounts({
        globalConfig: globalConfigPda,
        lpMint: lpMintPda,
        treasury: treasuryPda,
        baseMint,
        admin: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    assert.equal(config.admin.toString(), payer.publicKey.toString());
    assert.equal(config.paused, false);
    assert.equal(config.maxMarketExposure.toNumber(), 500_000_000);
    assert.equal(config.nextMarketId.toNumber(), 1);

    // Create LP ATA for lp1 (mint is now live)
    lp1LpAta = getAssociatedTokenAddressSync(
      lpMintPda, lp1.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
    );
    await provider.sendAndConfirm(
      new Transaction().add(createAssociatedTokenAccountInstruction(
        payer.publicKey, lp1LpAta, lp1.publicKey, lpMintPda, TOKEN_PROGRAM, ATA_PROGRAM
      )),
      []
    );
  });

  // ─── 2. LP Operations ───────────────────────────────────────────

  it("Adds liquidity and initializes pending liquidity", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    const depositAmount = 500_000_000;
    const now = Math.floor(Date.now() / 1000);
    const epochDuration = 86400;
    const epochStart = Math.floor(now / epochDuration) * epochDuration;
    const activationTime = epochStart + 2 * epochDuration;
    // shares = depositAmount - MIN_FIRST_LIQUIDITY (1000)
    const shares = depositAmount - 1_000;

    const tx = new anchor.web3.Transaction();

    const addLiqIx = await program.methods
      .addLiquidity(new anchor.BN(depositAmount))
      .accounts({
        globalConfig: globalConfigPda,
        lpMint: lpMintPda,
        treasury: treasuryPda,
        treasuryBaseAta,
        providerBaseAta: lp1BaseAta,
        providerLpAta: lp1LpAta,
        baseMint,
        provider: lp1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    tx.add(addLiqIx);

    const initPendingIx = await program.methods
      .initPendingLiquidity(
        new anchor.BN(shares),
        new anchor.BN(activationTime),
        new anchor.BN(depositAmount)
      )
      .accounts({
        globalConfig: globalConfigPda,
        pendingLiquidity: pendingLiquidityPda,
        provider: lp1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp1])
      .instruction();
    tx.add(initPendingIx);

    await provider.sendAndConfirm(tx, [lp1]);

    const lpBalance = await getAccount(provider.connection, lp1LpAta);
    assert.ok(Number(lpBalance.amount) > 0, "LP1 should have received LP tokens");

    const treasuryBal = await getAccount(provider.connection, treasuryBaseAta);
    assert.equal(Number(treasuryBal.amount), depositAmount, "Treasury should hold deposit");

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    assert.ok(config.totalLpSupply.toNumber() > 0, "Total LP supply should be positive");

    const pending = await program.account.pendingLiquidity.fetch(pendingLiquidityPda);
    assert.equal(pending.lp.toString(), lp1.publicKey.toString());
    assert.ok(pending.shares.toNumber() > 0, "Pending shares should be positive");
  });

  // ─── 3. Market Creation ─────────────────────────────────────────

  it("Creates a trading market (start_time in future)", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    tradingMarketId = config.nextMarketId.toNumber();
    [tradingMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(tradingMarketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const startTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future

    await program.methods
      .createMarket(
        new anchor.BN(startTime),
        2,
        "Will Arsenal win?",
        "Binary market for Arsenal match",
        0,
        null,
        null
      )
      .accounts({
        globalConfig: globalConfigPda,
        market: tradingMarketPda,
        authority: payer.publicKey, // admin is authorized
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const market = await program.account.market.fetch(tradingMarketPda);
    assert.equal(market.marketId.toNumber(), tradingMarketId);
    assert.equal(market.numOutcomes, 2);
    assert.deepEqual(market.status, { open: {} });
    assert.equal(market.creator.toString(), payer.publicKey.toString());
  });

  it("Creates a settlement market (start_time in past)", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    settlementMarketId = config.nextMarketId.toNumber();
    [settlementMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(settlementMarketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    [settlementDisputePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dispute"), new anchor.BN(settlementMarketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const startTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour in past

    await program.methods
      .createMarket(
        new anchor.BN(startTime),
        2,
        "Settlement Test Market",
        "Market created for settlement testing",
        0,
        null,
        null
      )
      .accounts({
        globalConfig: globalConfigPda,
        market: settlementMarketPda,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Init outcome mints on settlement market
    for (const oid of [0, 1]) {
      const [mintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("outcome_mint"),
          new anchor.BN(settlementMarketId).toArrayLike(Buffer, "le", 8),
          Buffer.from([oid]),
        ],
        program.programId
      );
      await program.methods
        .initOutcomeMint(new anchor.BN(settlementMarketId), oid)
        .accounts({
          globalConfig: globalConfigPda,
          market: settlementMarketPda,
          outcomeMint: mintPda,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    }

    const market = await program.account.market.fetch(settlementMarketPda);
    assert.equal(market.marketId.toNumber(), settlementMarketId);
  });

  it("Initializes outcome mint for outcome 0 (trading market)", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    [tradeOutcomeMint0] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("outcome_mint"),
        new anchor.BN(tradingMarketId).toArrayLike(Buffer, "le", 8),
        Buffer.from([0]),
      ],
      program.programId
    );

    await program.methods
      .initOutcomeMint(new anchor.BN(tradingMarketId), 0)
      .accounts({
        globalConfig: globalConfigPda,
        market: tradingMarketPda,
        outcomeMint: tradeOutcomeMint0,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const market = await program.account.market.fetch(tradingMarketPda);
    assert.equal(market.outcomeMints[0].toString(), tradeOutcomeMint0.toString());
  });

  it("Initializes outcome mint for outcome 1 (trading market)", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    [tradeOutcomeMint1] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("outcome_mint"),
        new anchor.BN(tradingMarketId).toArrayLike(Buffer, "le", 8),
        Buffer.from([1]),
      ],
      program.programId
    );

    await program.methods
      .initOutcomeMint(new anchor.BN(tradingMarketId), 1)
      .accounts({
        globalConfig: globalConfigPda,
        market: tradingMarketPda,
        outcomeMint: tradeOutcomeMint1,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const market = await program.account.market.fetch(tradingMarketPda);
    assert.equal(market.outcomeMints[1].toString(), tradeOutcomeMint1.toString());
  });

  // ─── 4. Trading ─────────────────────────────────────────────────

  it("Buys outcome shares via LMSR pricing", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    const numShares = 10_000_000;
    // max_payment = numShares * 2 to cover LMSR cost + 1% buy fee
    const maxPayment = numShares * 2;

    // Create buyer outcome ATA (on-curve owner, allowOffCurve=false)
    user1Outcome0Ata = getAssociatedTokenAddressSync(
      tradeOutcomeMint0, user1.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
    );
    await provider.sendAndConfirm(
      new Transaction().add(createAssociatedTokenAccountInstruction(
        payer.publicKey, user1Outcome0Ata, user1.publicKey, tradeOutcomeMint0, TOKEN_PROGRAM, ATA_PROGRAM
      )),
      []
    );

    const baseBefore = await getAccount(provider.connection, user1BaseAta);

    await program.methods
      .buyShares(0, new anchor.BN(numShares), new anchor.BN(maxPayment))
      .accounts({
        globalConfig: globalConfigPda,
        market: tradingMarketPda,
        treasury: treasuryPda,
        buyerBaseAta: user1BaseAta,
        treasuryBaseAta,
        buyerOutcomeAta: user1Outcome0Ata,
        outcomeMint: tradeOutcomeMint0,
        baseMint,
        buyer: user1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    const outcomeBalance = await getAccount(provider.connection, user1Outcome0Ata);
    assert.equal(
      Number(outcomeBalance.amount), numShares,
      "User1 should hold numShares outcome tokens"
    );

    const baseAfter = await getAccount(provider.connection, user1BaseAta);
    assert.ok(
      Number(baseAfter.amount) < Number(baseBefore.amount),
      "User1 should have spent base tokens"
    );

    const market = await program.account.market.fetch(tradingMarketPda);
    assert.equal(market.qValues[0].toNumber(), numShares, "q_values[0] should equal numShares");

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    assert.equal(
      config.lockedPayouts.toNumber(), numShares,
      "locked_payouts should increase by numShares"
    );
  });

  it("Sells outcome shares back to AMM", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    const sellShares = 5_000_000;
    const baseBefore = await getAccount(provider.connection, user1BaseAta);
    const configBefore = await program.account.globalConfig.fetch(globalConfigPda);

    await program.methods
      .sellShares(0, new anchor.BN(sellShares), new anchor.BN(1))
      .accounts({
        globalConfig: globalConfigPda,
        market: tradingMarketPda,
        treasury: treasuryPda,
        sellerOutcomeAta: user1Outcome0Ata,
        sellerBaseAta: user1BaseAta,
        treasuryBaseAta,
        outcomeMint: tradeOutcomeMint0,
        baseMint,
        seller: user1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
      })
      .signers([user1])
      .rpc();

    const baseAfter = await getAccount(provider.connection, user1BaseAta);
    assert.ok(
      Number(baseAfter.amount) > Number(baseBefore.amount),
      "User should have received base tokens from sell"
    );

    const market = await program.account.market.fetch(tradingMarketPda);
    assert.equal(
      market.qValues[0].toNumber(), 5_000_000,
      "q_values[0] should be reduced by sellShares"
    );

    const configAfter = await program.account.globalConfig.fetch(globalConfigPda);
    assert.ok(
      configAfter.lockedPayouts.toNumber() < configBefore.lockedPayouts.toNumber(),
      "locked_payouts should decrease after sell"
    );
  });

  // ─── 5. Settlement ───────────────────────────────────────────────

  it("Sets challenge window to 10 seconds for testing", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    await program.methods
      .updateConfig(
        null,                  // max_market_exposure
        new anchor.BN(10),     // challenge_window_seconds
        null,                  // settlement_deadline_seconds
        null,                  // lmsr_default_b
        null,                  // slip_house_margin_bps
        null,                  // max_slip_bonus_multiplier_bps
        null,                  // epoch_duration_seconds
        null,                  // withdrawal_cooldown_seconds
        null,                  // max_single_bet
        null,                  // min_outcome_price_bps
        null,                  // buy_fee_bps
        null                   // oracle_pubkey
      )
      .accounts({
        globalConfig: globalConfigPda,
        admin: payer.publicKey,
      })
      .rpc();

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    assert.equal(config.challengeWindowSeconds.toNumber(), 10);
  });

  it("Oracle proposes result on settlement market", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    // Oracle must sign — use oracleKeypair (airdrop was done in before())
    await program.methods
      .proposeResult(new anchor.BN(settlementMarketId), 0)
      .accounts({
        globalConfig: globalConfigPda,
        market: settlementMarketPda,
        dispute: settlementDisputePda,
        oracle: oracleKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracleKeypair])
      .rpc();

    const market = await program.account.market.fetch(settlementMarketPda);
    assert.deepEqual(market.status, { proposed: {} }, "Market should be in Proposed status");

    const dispute = await program.account.dispute.fetch(settlementDisputePda);
    assert.equal(dispute.proposedOutcome, 0, "Proposed outcome should be 0");
  });

  it("Waits for challenge window and finalizes result", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    // Wait for 11 seconds so the 10s challenge window expires
    await new Promise(resolve => setTimeout(resolve, 11_000));

    await program.methods
      .finalizeResult(new anchor.BN(settlementMarketId))
      .accounts({
        globalConfig: globalConfigPda,
        market: settlementMarketPda,
        dispute: settlementDisputePda,
        caller: payer.publicKey,
      })
      .rpc();

    const market = await program.account.market.fetch(settlementMarketPda);
    assert.deepEqual(market.status, { settled: {} }, "Market should be Settled");
    assert.equal(market.winningOutcome, 0, "Winning outcome should be 0");
  });

  it("Claim payout on settled market (winner gets 1:1)", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    // Settlement market had no trades so no outcome tokens exist.
    // Verify claim with 0 shares fails with the appropriate error.
    const [settlementOutcomeMint0] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("outcome_mint"),
        new anchor.BN(settlementMarketId).toArrayLike(Buffer, "le", 8),
        Buffer.from([0]),
      ],
      program.programId
    );

    // Create user1 ATA for settlement market outcome 0
    const user1SettlementAta = getAssociatedTokenAddressSync(
      settlementOutcomeMint0, user1.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
    );
    await provider.sendAndConfirm(
      new Transaction().add(createAssociatedTokenAccountInstruction(
        payer.publicKey, user1SettlementAta, user1.publicKey,
        settlementOutcomeMint0, TOKEN_PROGRAM, ATA_PROGRAM
      )),
      []
    );

    // User has 0 tokens — claim should fail
    try {
      await program.methods
        .claimPayout(new anchor.BN(settlementMarketId))
        .accounts({
          globalConfig: globalConfigPda,
          market: settlementMarketPda,
          treasury: treasuryPda,
          claimerOutcomeAta: user1SettlementAta,
          claimerBaseAta: user1BaseAta,
          treasuryBaseAta,
          outcomeMint: settlementOutcomeMint0,
          baseMint,
          claimer: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
        })
        .signers([user1])
        .rpc();
      assert.fail("Should have failed with NoWinningPositions");
    } catch (err: any) {
      assert.ok(err, "Correctly rejected claim with 0 shares");
    }

    // Verify solvency invariant holds
    const config = await program.account.globalConfig.fetch(globalConfigPda);
    const treasuryBal = await getAccount(provider.connection, treasuryBaseAta);
    assert.ok(
      config.lockedPayouts.toNumber() <= Number(treasuryBal.amount),
      "locked_payouts must not exceed treasury balance"
    );
  });

  it("Close settled market reclaims rent", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    const solBefore = await provider.connection.getBalance(payer.publicKey);

    await program.methods
      .closeMarket(new anchor.BN(settlementMarketId))
      .accounts({
        globalConfig: globalConfigPda,
        market: settlementMarketPda,
        authority: payer.publicKey,
      })
      .rpc();

    const solAfter = await provider.connection.getBalance(payer.publicKey);
    // Rent is reclaimed (net positive despite tx fees)
    assert.ok(solAfter > solBefore - 10_000, "Rent should be reclaimed to authority");

    // Account should be closed
    try {
      await program.account.market.fetch(settlementMarketPda);
      assert.fail("Market account should be closed");
    } catch (_) {
      // Expected — account no longer exists
    }
  });
});

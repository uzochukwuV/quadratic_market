import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { QuadraticMarket } from "../target/types/quadratic_market";
import {
  createMint, mintTo, getAccount, transfer,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";

const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const ATA_PROGRAM  = ASSOCIATED_TOKEN_PROGRAM_ID;

// ─── Shared helpers ──────────────────────────────────────────────

async function airdrop(provider: anchor.AnchorProvider, pk: PublicKey, sol = 2) {
  const sig = await provider.connection.requestAirdrop(pk, sol * anchor.web3.LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig);
}

async function makeAta(provider: anchor.AnchorProvider, mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM, ATA_PROGRAM);
  await provider.sendAndConfirm(
    new Transaction().add(createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey, ata, owner, mint, TOKEN_PROGRAM, ATA_PROGRAM
    )), []
  );
  return ata;
}

// Fund a keypair by transferring from the provider wallet's ATA (no mint authority needed)
async function fundFromAdmin(provider: anchor.AnchorProvider, kp: Keypair, mint: PublicKey, adminAta: PublicKey, amount: number): Promise<PublicKey> {
  await airdrop(provider, kp.publicKey);
  const ata = await makeAta(provider, mint, kp.publicKey);
  await transfer(
    provider.connection,
    provider.wallet.payer,
    adminAta,
    ata,
    provider.wallet.publicKey,
    amount
  );
  return ata;
}

// ─── Suite ───────────────────────────────────────────────────────

describe("Security: fixed vulnerabilities", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.QuadraticMarket as Program<QuadraticMarket>;

  // Protocol-level PDAs
  const [globalConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("global_config")], program.programId);
  const [treasuryPda]     = PublicKey.findProgramAddressSync([Buffer.from("treasury")],      program.programId);
  const [lpMintPda]       = PublicKey.findProgramAddressSync([Buffer.from("lp_mint")],       program.programId);

  // Use provider wallet as admin — matches the initialized protocol's admin key
  // (all test suites share the same localnet validator instance)
  const admin          = (provider.wallet as anchor.Wallet).payer;
  const oracle         = Keypair.generate();
  const lp1            = Keypair.generate();
  const trader         = Keypair.generate();
  const attacker       = Keypair.generate();

  // Mints / ATAs (filled in before())
  let baseMint: PublicKey;
  let treasuryBaseAta: PublicKey;
  let adminBaseAta: PublicKey;
  let lp1BaseAta: PublicKey;
  let lp1LpAta: PublicKey;
  let traderBaseAta: PublicKey;
  let attackerBaseAta: PublicKey;

  // Market state
  let marketId: number;
  let marketPda: PublicKey;
  let outcomeMint0: PublicKey;
  let outcomeMint1: PublicKey;
  let traderOutcomeAta: PublicKey;

  // ── Setup ──────────────────────────────────────────────────────

  before(async () => {
    // admin = provider wallet (already funded by protocol_tests suite).
    await airdrop(provider, oracle.publicKey);
    await airdrop(provider, lp1.publicKey, 5);
    await airdrop(provider, trader.publicKey, 5);
    await airdrop(provider, attacker.publicKey, 5);

    // Read base mint from the already-initialized global config
    const cfg0 = await program.account.globalConfig.fetch(globalConfigPda);
    baseMint = cfg0.baseMint;
    treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);

    // Admin ATA was funded by protocol_tests — transfer from it to fund participants
    adminBaseAta = getAssociatedTokenAddressSync(baseMint, admin.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
    lp1BaseAta      = await fundFromAdmin(provider, lp1,      baseMint, adminBaseAta, 30_000_000);
    traderBaseAta   = await fundFromAdmin(provider, trader,   baseMint, adminBaseAta, 20_000_000);
    attackerBaseAta = await fundFromAdmin(provider, attacker, baseMint, adminBaseAta, 20_000_000);

    lp1LpAta = getAssociatedTokenAddressSync(lpMintPda, lp1.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
    await provider.sendAndConfirm(
      new Transaction().add(createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey, lp1LpAta, lp1.publicKey, lpMintPda, TOKEN_PROGRAM, ATA_PROGRAM
      )), []
    );

    // Add liquidity (pending_liquidity now initialised inline)
    const [pendingPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), lp1.publicKey.toBuffer()], program.programId
    );
    await program.methods.addLiquidity(new anchor.BN(20_000_000))
      .accounts({
        globalConfig: globalConfigPda, lpMint: lpMintPda, treasury: treasuryPda,
        treasuryBaseAta, providerBaseAta: lp1BaseAta, providerLpAta: lp1LpAta,
        baseMint, pendingLiquidity: pendingPda, provider: lp1.publicKey,
        tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp1]).rpc();

    // Create a 2-outcome market
    const cfg = await program.account.globalConfig.fetch(globalConfigPda);
    marketId = cfg.nextMarketId.toNumber();
    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const startTime = Math.floor(Date.now() / 1000) + 3600;
    await program.methods
      .createMarket(new anchor.BN(startTime), 2, "Security Test Market", "sec", 0, null, null)
      .accounts({
        globalConfig: globalConfigPda, market: marketPda,
        authority: admin.publicKey, systemProgram: SystemProgram.programId,
      })
      .signers([admin]).rpc();

    // Init outcome mints
    [outcomeMint0] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
      program.programId
    );
    [outcomeMint1] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
      program.programId
    );
    for (const [oid, mint] of [[0, outcomeMint0], [1, outcomeMint1]] as [number, PublicKey][]) {
      await program.methods.initOutcomeMint(new anchor.BN(marketId), oid)
        .accounts({
          globalConfig: globalConfigPda, market: marketPda, outcomeMint: mint,
          payer: admin.publicKey, tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin]).rpc();
    }

    traderOutcomeAta = await makeAta(provider, outcomeMint0, trader.publicKey);
  });

  // ── SEC-1: swap_trade locked_payouts tracks num_shares not cost ──

  describe("SEC-1: swap_trade solvency — locked_payouts = num_shares", () => {
    it("locked_payouts increases by num_shares after buy_shares_with_swap", async () => {
      const cfgBefore = await program.account.globalConfig.fetch(globalConfigPda);
      const lockedBefore = cfgBefore.lockedPayouts.toNumber();

      const numShares = 1_000_000;
      const maxPayment = 2_000_000;

      await program.methods
        .buyShares(0, new anchor.BN(numShares), new anchor.BN(maxPayment))
        .accounts({
          globalConfig: globalConfigPda, market: marketPda,
          treasury: treasuryPda,
          buyerBaseAta: traderBaseAta, treasuryBaseAta,
          buyerOutcomeAta: traderOutcomeAta, outcomeMint: outcomeMint0,
          baseMint, buyer: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader]).rpc();

      const cfgAfter = await program.account.globalConfig.fetch(globalConfigPda);
      const lockedAfter = cfgAfter.lockedPayouts.toNumber();
      const delta = lockedAfter - lockedBefore;

      // locked_payouts must equal num_shares (the 1:1 settlement obligation)
      assert.equal(delta, numShares,
        `locked_payouts should increase by num_shares (${numShares}), got delta=${delta}`);
    });
  });

  // ── SEC-2: exposure formula — LP net risk = num_shares - cost ────

  describe("SEC-2: exposure formula — num_shares - cost, not cost - num_shares", () => {
    it("market.exposure is non-negative after a buy", async () => {
      const mkt = await program.account.market.fetch(marketPda);
      assert.ok(
        mkt.exposure.toNumber() >= 0,
        `market.exposure must be >= 0, got ${mkt.exposure.toNumber()}`
      );
    });

    it("exposure cap is enforced (buy beyond max_market_exposure fails)", async () => {
      // Set a very tight exposure cap so the next large buy hits it
      await program.methods
        .updateConfig(
          new anchor.BN(1), // max_market_exposure = 1 lamport
          null, null, null, null, null, null, null, null, null, null, null
        )
        .accounts({ globalConfig: globalConfigPda, admin: admin.publicKey })
        .signers([admin]).rpc();

      try {
        await program.methods
          .buyShares(0, new anchor.BN(1_000_000), new anchor.BN(2_000_000))
          .accounts({
            globalConfig: globalConfigPda, market: marketPda,
            treasury: treasuryPda,
            buyerBaseAta: traderBaseAta, treasuryBaseAta,
            buyerOutcomeAta: traderOutcomeAta, outcomeMint: outcomeMint0,
            baseMint, buyer: trader.publicKey,
            tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
            systemProgram: SystemProgram.programId,
          })
          .signers([trader]).rpc();
        assert.fail("Should have failed with MaxExposureReached");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("MaxExposureReached") || err.error?.errorCode?.code === "MaxExposureReached",
          `Expected MaxExposureReached, got: ${err}`
        );
      } finally {
        // Restore a generous cap
        await program.methods
          .updateConfig(new anchor.BN(500_000_000), null, null, null, null, null, null, null, null, null, null, null)
          .accounts({ globalConfig: globalConfigPda, admin: admin.publicKey })
          .signers([admin]).rpc();
      }
    });
  });

  // ── SEC-3: pending_liquidity epoch lock cannot be bypassed ───────

  describe("SEC-3: pending_liquidity epoch lock — shares/activation_time set on-chain", () => {
    it("pending_liquidity is written by add_liquidity with correct activation_time", async () => {
      const lp2 = Keypair.generate();
      await airdrop(provider, lp2.publicKey, 3);
      const lp2BaseAta = await fundFromAdmin(provider, lp2, baseMint, adminBaseAta, 10_000_000);
      const lp2LpAta   = await makeAta(provider, lpMintPda, lp2.publicKey);
      const [lp2Pending] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending"), lp2.publicKey.toBuffer()], program.programId
      );

      const nowBefore = Math.floor(Date.now() / 1000);
      await program.methods.addLiquidity(new anchor.BN(5_000_000))
        .accounts({
          globalConfig: globalConfigPda, lpMint: lpMintPda, treasury: treasuryPda,
          treasuryBaseAta, providerBaseAta: lp2BaseAta, providerLpAta: lp2LpAta,
          baseMint, pendingLiquidity: lp2Pending, provider: lp2.publicKey,
          tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([lp2]).rpc();

      const pending = await program.account.pendingLiquidity.fetch(lp2Pending);
      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      const epochDur = cfg.epochDurationSeconds.toNumber();

      // activation_time must be at least nowBefore (cannot be 0 or in the past)
      assert.ok(
        pending.activationTime.toNumber() >= nowBefore,
        `activation_time ${pending.activationTime.toNumber()} should be >= ${nowBefore}`
      );
      // activation_time must be within 2 epochs from now (correct epoch math)
      assert.ok(
        pending.activationTime.toNumber() <= nowBefore + 2 * epochDur + 60,
        `activation_time too far in future`
      );
      // shares must be positive and match LP tokens minted
      assert.ok(pending.shares.toNumber() > 0, "shares must be positive");
    });

    it("initPendingLiquidity is now a no-op — cannot overwrite shares or activation_time", async () => {
      const lp3 = Keypair.generate();
      await airdrop(provider, lp3.publicKey, 3);
      const lp3BaseAta = await fundFromAdmin(provider, lp3, baseMint, adminBaseAta, 10_000_000);
      const lp3LpAta   = await makeAta(provider, lpMintPda, lp3.publicKey);
      const [lp3Pending] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending"), lp3.publicKey.toBuffer()], program.programId
      );

      // Deposit legitimately
      await program.methods.addLiquidity(new anchor.BN(5_000_000))
        .accounts({
          globalConfig: globalConfigPda, lpMint: lpMintPda, treasury: treasuryPda,
          treasuryBaseAta, providerBaseAta: lp3BaseAta, providerLpAta: lp3LpAta,
          baseMint, pendingLiquidity: lp3Pending, provider: lp3.publicKey,
          tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([lp3]).rpc();

      const pendingBefore = await program.account.pendingLiquidity.fetch(lp3Pending);

      // Attacker calls initPendingLiquidity with inflated shares and activation_time=0
      await program.methods
        .initPendingLiquidity(
          new anchor.BN(999_999_999), // inflated shares
          new anchor.BN(0),           // activation_time = 0 (bypass lock)
          new anchor.BN(999_999_999)
        )
        .accounts({
          globalConfig: globalConfigPda,
          pendingLiquidity: lp3Pending,
          provider: lp3.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([lp3]).rpc();

      const pendingAfter = await program.account.pendingLiquidity.fetch(lp3Pending);

      // State must be unchanged — initPendingLiquidity is now a no-op
      assert.equal(
        pendingAfter.shares.toNumber(), pendingBefore.shares.toNumber(),
        "shares must not change after no-op initPendingLiquidity"
      );
      assert.equal(
        pendingAfter.activationTime.toNumber(), pendingBefore.activationTime.toNumber(),
        "activation_time must not change after no-op initPendingLiquidity"
      );
    });
  });

  // ── SEC-4: void_market releases sum(q_values) not exposure ───────

  describe("SEC-4: void_market releases correct locked_payouts", () => {
    it("locked_payouts decreases by sum(q_values) when market is voided", async () => {
      // Create a fresh market, buy some shares, then void it
      const cfg0 = await program.account.globalConfig.fetch(globalConfigPda);
      const voidMarketId = cfg0.nextMarketId.toNumber();
      const [voidMarketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(voidMarketId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const futureStart = Math.floor(Date.now() / 1000) + 3600;
      await program.methods
        .createMarket(new anchor.BN(futureStart), 2, "Void Test", "void", 0, null, null)
        .accounts({
          globalConfig: globalConfigPda, market: voidMarketPda,
          authority: admin.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([admin]).rpc();

      const [vm0] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(voidMarketId).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
        program.programId
      );
      const [vm1] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(voidMarketId).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
        program.programId
      );
      for (const [oid, mint] of [[0, vm0], [1, vm1]] as [number, PublicKey][]) {
        await program.methods.initOutcomeMint(new anchor.BN(voidMarketId), oid)
          .accounts({
            globalConfig: globalConfigPda, market: voidMarketPda, outcomeMint: mint,
            payer: admin.publicKey, tokenProgram: TOKEN_PROGRAM,
            systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([admin]).rpc();
      }

      // Buy shares on outcome 0
      const buyerOutcomeAta = await makeAta(provider, vm0, trader.publicKey);
      const numShares = 2_000_000;
      await program.methods
        .buyShares(0, new anchor.BN(numShares), new anchor.BN(4_000_000))
        .accounts({
          globalConfig: globalConfigPda, market: voidMarketPda,
          treasury: treasuryPda,
          buyerBaseAta: traderBaseAta, treasuryBaseAta,
          buyerOutcomeAta, outcomeMint: vm0, baseMint,
          buyer: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader]).rpc();

      const mktAfterBuy = await program.account.market.fetch(voidMarketPda);
      const qSum = mktAfterBuy.qValues.reduce((a: anchor.BN, b: anchor.BN) => a.add(b), new anchor.BN(0)).toNumber();
      const cfgBeforeVoid = await program.account.globalConfig.fetch(globalConfigPda);
      const lockedBefore = cfgBeforeVoid.lockedPayouts.toNumber();

      // Void the market
      await program.methods.voidMarket()
        .accounts({
          globalConfig: globalConfigPda, market: voidMarketPda, admin: admin.publicKey,
        })
        .signers([admin]).rpc();

      const cfgAfterVoid = await program.account.globalConfig.fetch(globalConfigPda);
      const lockedAfter = cfgAfterVoid.lockedPayouts.toNumber();
      const released = lockedBefore - lockedAfter;

      // Must release exactly sum(q_values), not market.exposure
      assert.equal(released, qSum,
        `void_market must release sum(q_values)=${qSum}, released=${released}`);
    });
  });

  // ── SEC-5: update_config bounds validation ────────────────────────

  describe("SEC-5: update_config rejects dangerous parameter values", () => {
    it("challenge_window_seconds = 0 is rejected", async () => {
      try {
        await program.methods
          .updateConfig(null, new anchor.BN(0), null, null, null, null, null, null, null, null, null, null)
          .accounts({ globalConfig: globalConfigPda, admin: admin.publicKey })
          .signers([admin]).rpc();
        assert.fail("Should have rejected challenge_window=0");
      } catch (err: any) {
        assert.ok(err.toString().includes("InvalidAmount") || err.error?.errorCode?.code === "InvalidAmount",
          `Expected InvalidAmount, got: ${err}`);
      }
    });

    it("epoch_duration_seconds = 0 is rejected (prevents div-by-zero)", async () => {
      try {
        await program.methods
          .updateConfig(null, null, null, null, null, null, new anchor.BN(0), null, null, null, null, null)
          .accounts({ globalConfig: globalConfigPda, admin: admin.publicKey })
          .signers([admin]).rpc();
        assert.fail("Should have rejected epoch_duration=0");
      } catch (err: any) {
        assert.ok(err.toString().includes("InvalidAmount") || err.error?.errorCode?.code === "InvalidAmount",
          `Expected InvalidAmount, got: ${err}`);
      }
    });

    it("buy_fee_bps = 10000 (100%) is rejected", async () => {
      try {
        await program.methods
          .updateConfig(null, null, null, null, null, null, null, null, null, null, new anchor.BN(10_000), null)
          .accounts({ globalConfig: globalConfigPda, admin: admin.publicKey })
          .signers([admin]).rpc();
        assert.fail("Should have rejected buy_fee_bps=10000");
      } catch (err: any) {
        assert.ok(err.toString().includes("InvalidAmount") || err.error?.errorCode?.code === "InvalidAmount",
          `Expected InvalidAmount, got: ${err}`);
      }
    });

    it("settlement_deadline_seconds = 0 is rejected", async () => {
      try {
        await program.methods
          .updateConfig(null, null, new anchor.BN(0), null, null, null, null, null, null, null, null, null)
          .accounts({ globalConfig: globalConfigPda, admin: admin.publicKey })
          .signers([admin]).rpc();
        assert.fail("Should have rejected settlement_deadline=0");
      } catch (err: any) {
        assert.ok(err.toString().includes("InvalidAmount") || err.error?.errorCode?.code === "InvalidAmount",
          `Expected InvalidAmount, got: ${err}`);
      }
    });

    it("valid update_config values are accepted", async () => {
      // Should not throw
      await program.methods
        .updateConfig(
          new anchor.BN(500_000_000), // max_market_exposure
          new anchor.BN(300),         // challenge_window = 5 min (>= 60)
          null, null, null, null, null, null, null, null, null, null
        )
        .accounts({ globalConfig: globalConfigPda, admin: admin.publicKey })
        .signers([admin]).rpc();

      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      assert.equal(cfg.challengeWindowSeconds.toNumber(), 300);
    });
  });

  // ── SEC-6: close_market zeroes discriminator ──────────────────────

  describe("SEC-6: close_market zeroes discriminator to prevent account reuse", () => {
    it("market account discriminator is zeroed after close_market", async () => {
      // Create a fresh market to close
      const cfg0 = await program.account.globalConfig.fetch(globalConfigPda);
      const closeId = cfg0.nextMarketId.toNumber();
      const [closePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(closeId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      await program.methods
        .createMarket(new anchor.BN(Math.floor(Date.now() / 1000) + 3600), 2, "Close Test", "close", 0, null, null)
        .accounts({
          globalConfig: globalConfigPda, market: closePda,
          authority: admin.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([admin]).rpc();

      // Void it first so it can be closed
      await program.methods.voidMarket()
        .accounts({ globalConfig: globalConfigPda, market: closePda, admin: admin.publicKey })
        .signers([admin]).rpc();

      await program.methods.closeMarket(new anchor.BN(closeId))
        .accounts({
          globalConfig: globalConfigPda, market: closePda,
          authority: admin.publicKey,
        })
        .signers([admin]).rpc();

      // Discriminator (first 8 bytes) must be zeroed
      const accountInfo = await provider.connection.getAccountInfo(closePda);
      if (accountInfo !== null) {
        const disc = accountInfo.data.slice(0, 8);
        assert.ok(
          disc.every(b => b === 0),
          `Discriminator must be zeroed after close_market, got: ${Array.from(disc)}`
        );
      }
      // If accountInfo is null the account was fully reclaimed — also acceptable
    });
  });
});

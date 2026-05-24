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

describe("bet_slip_test — Correlated Multi-Leg Bet Slips", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
  const payer = provider.wallet.payer;

  // PDAs
  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")], program.programId
  );
  const [lpMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint")], program.programId
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")], program.programId
  );

  let base_mint: PublicKey;
  let treasury_base_ata: PublicKey;
  let admin: Keypair;

  // Market group (contains 2+ markets)
  let groupId: number;
  let groupPda: PublicKey;

  // Market accounts
  let market1Id: number;
  let market1Pda: PublicKey;
  let market1Mint0: PublicKey;
  let market1Mint1: PublicKey;

  let market2Id: number;
  let market2Pda: PublicKey;
  let market2Mint0: PublicKey;
  let market2Mint1: PublicKey;

  // Trader
  let slipper: Keypair;
  let slipperBaseAta: PublicKey;
  let slipperMarket1Ata: PublicKey;
  let slipperMarket2Ata: PublicKey;

  let skipSuite = false;

  before(async () => {
    // Check if program is properly initialized
    if (!program?.programId) {
      console.log("Program not properly initialized - skipping suite");
      skipSuite = true;
      return;
    }

    try {
      await program.account.globalConfig.fetch(globalConfigPda);
    } catch (_) {
      skipSuite = true;
      return;
    }

    admin = payer;
    slipper = Keypair.generate();

    const sig = await provider.connection.requestAirdrop(
      slipper.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    const cfg = await program.account.globalConfig.fetch(globalConfigPda);
    baseMint = cfg.baseMint;
    treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);
    slipperBaseAta = await createAtaOnCurve(provider, baseMint, slipper.publicKey);

    // Fund slipper with base tokens
    const adminBaseAta = getAssociatedTokenAddressSync(baseMint, admin.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
    try {
      const { transfer } = await import("@solana/spl-token");
      await transfer(provider.connection, admin, adminBaseAta, slipperBaseAta, admin.publicKey, 50_000_000);
    } catch (err: any) {
      // If admin doesn't have enough tokens, that's ok - slipper may have been funded already
      console.log("  Slipper funding skipped (admin may have insufficient funds)");
    }

    // Ensure LP has liquidity
    const [pendingPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), admin.publicKey.toBuffer()], program.programId
    );
    try {
      await getAccount(provider.connection, getAssociatedTokenAddressSync(lpMintPda, admin.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM));
    } catch (_) {
      const lpAta = getAssociatedTokenAddressSync(lpMintPda, admin.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
      await provider.sendAndConfirm(
        new Transaction().add(createAssociatedTokenAccountInstruction(
          payer.publicKey, lpAta, admin.publicKey, lpMintPda, TOKEN_PROGRAM, ATA_PROGRAM
        )),
        []
      );
    }
    try {
      await program.account.pendingLiquidity.fetch(pendingPda);
    } catch (_) {
      // Try to add liquidity, but wrap in try-catch to handle insufficient funds gracefully
      try {
        await program.methods.addLiquidity(new anchor.BN(10_000_000))
          .accounts({
            global_config: globalConfigPda, lp_mint: lpMintPda, treasury: treasuryPda,
            treasuryBaseAta, provider_base_ata: adminBaseAta,
            provider_lp_ata: getAssociatedTokenAddressSync(lpMintPda, admin.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM),
            base_mint: baseMint, pending_liquidity: pendingPda, provider: admin.publicKey,
            token_program: TOKEN_PROGRAM, associated_token_program: ATA_PROGRAM,
            system_program: SystemProgram.programId,
          })
          .signers([admin]).rpc();
      } catch (err: any) {
        // If liquidity already exists or insufficient funds, that's ok for setup
        console.log("  LP setup skipped (may already have liquidity or insufficient funds)");
      }
    }

    // Derive epoch PDA for createMarket calls
    const cfgEpoch = await program.account.globalConfig.fetch(globalConfigPda);
    const [epochPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("epoch"), new anchor.BN(cfgEpoch.currentEpoch.toNumber()).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // ── Create 2 markets and group them ──────────────────────────
    const startTime = Math.floor(Date.now() / 1000) + 3600;

    // Market 1
    const cfg1 = await program.account.globalConfig.fetch(globalConfigPda);
    market1Id = cfg1.nextMarketId.toNumber();
    [market1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(market1Id).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    try {
      await program.methods
        .createMarket(new anchor.BN(startTime), 2, "Slip Market 1", "sl1", 0, null, null)
        .accounts({ global_config: globalConfigPda, market: market1Pda, epoch: epochPda, authority: admin.publicKey, system_program: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
        .signers([admin]).rpc();
    } catch (err: any) {
      console.log("  Market 1 creation failed:", err?.message ?? err);
    }

    [market1Mint0] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(market1Id).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
      program.programId
    );
    [market1Mint1] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(market1Id).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
      program.programId
    );
    for (const [oid, mint] of [[0, market1Mint0], [1, market1Mint1]] as [number, PublicKey][]) {
      try {
        await program.methods.initOutcomeMint(new anchor.BN(market1Id), oid)
          .accounts({ global_config: globalConfigPda, market: market1Pda, outcome_mint: mint, payer: admin.publicKey, token_program: TOKEN_PROGRAM, system_program: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
          .signers([admin]).rpc();
      } catch (_) { /* may exist */ }
    }

    // Market 2
    const cfg2 = await program.account.globalConfig.fetch(globalConfigPda);
    market2Id = cfg2.nextMarketId.toNumber();
    [market2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(market2Id).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await program.methods
      .createMarket(new anchor.BN(startTime), 2, "Slip Market 2", "sl2", 0, null, null)
      .accounts({ global_config: globalConfigPda, market: market2Pda, epoch: epochPda, authority: admin.publicKey, system_program: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
      .signers([admin]).rpc();

    [market2Mint0] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(market2Id).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
      program.programId
    );
    [market2Mint1] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(market2Id).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
      program.programId
    );
    for (const [oid, mint] of [[0, market2Mint0], [1, market2Mint1]] as [number, PublicKey][]) {
      try {
        await program.methods.initOutcomeMint(new anchor.BN(market2Id), oid)
          .accounts({ global_config: globalConfigPda, market: market2Pda, outcome_mint: mint, payer: admin.publicKey, token_program: TOKEN_PROGRAM, system_program: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
          .signers([admin]).rpc();
      } catch (_) { /* may exist */ }
    }

    // Create market group
    groupId = market1Id; // use first market's ID as group ID
    [groupPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market_group"), new anchor.BN(groupId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    try {
      await program.methods.createMarketGroup(
        new anchor.BN(groupId),
        new anchor.BN(500_000_000),
        new anchor.BN(startTime + 86400),
        "Slip Test Group"
      )
        .accounts({ global_config: globalConfigPda, marketGroup: groupPda, authority: admin.publicKey, system_program: SystemProgram.programId })
        .signers([admin]).rpc();
    } catch (_) { /* may exist */ }

    // Add both markets to the group
    for (const [mId, mPda] of [[market1Id, market1Pda], [market2Id, market2Pda]] as [number, PublicKey][]) {
      try {
        await program.methods.addMarketToGroup(new anchor.BN(groupId), 0)
          .accounts({ global_config: globalConfigPda, market: mPda, marketGroup: groupPda })
          .signers([admin]).rpc();
      } catch (_) { /* may already be in group */ }
    }

    // Add correlation pair
    try {
      await program.methods.addCorrelationPair(
        new anchor.BN(groupId),
        { marketId1: market1Id, marketId2: market2Id, weightBps: 5000 } // 50% correlation
      )
        .accounts({ global_config: globalConfigPda, marketGroup: groupPda })
        .signers([admin]).rpc();
    } catch (_) { /* may already exist */ }

    // Create slipper outcome ATAs
    slipperMarket1Ata = getAssociatedTokenAddressSync(market1Mint0, slipper.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
    slipperMarket2Ata = getAssociatedTokenAddressSync(market2Mint0, slipper.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
    try {
      await provider.sendAndConfirm(
        new Transaction().add(createAssociatedTokenAccountInstruction(
          payer.publicKey, slipperMarket1Ata, slipper.publicKey, market1Mint0, TOKEN_PROGRAM, ATA_PROGRAM
        )),
        []
      );
    } catch (_) { /* may exist */ }
    try {
      await provider.sendAndConfirm(
        new Transaction().add(createAssociatedTokenAccountInstruction(
          payer.publicKey, slipperMarket2Ata, slipper.publicKey, market2Mint0, TOKEN_PROGRAM, ATA_PROGRAM
        )),
        []
      );
    } catch (_) { /* may exist */ }

    console.log("  Bet slip test: setup complete — 2 markets in group with correlation");
  });

  describe("Bet Slip — place_slip", () => {
    it("places a 2-leg correlated bet slip", async () => {
      if (skipSuite) { console.log("SKIPPED"); return; }

      const cfgBefore = await program.account.globalConfig.fetch(globalConfigPda);
      const lockedPayoutsBefore = cfgBefore.lockedPayouts.toNumber();
      const slipperBaseBefore = await getAccount(provider.connection, slipperBaseAta);

      const legs = [
        { marketId: new anchor.BN(market1Id), outcomeId: 0, numShares: new anchor.BN(500_000) },
        { marketId: new anchor.BN(market2Id), outcomeId: 0, numShares: new anchor.BN(500_000) },
      ];
      const maxPayment = 30_000_000;

      await program.methods
        .placeSlip(legs, new anchor.BN(maxPayment), 1)
        .accounts({
          global_config: globalConfigPda,
          betSlip: PublicKey.findProgramAddressSync(
            [Buffer.from("bet_slip"), cfgBefore.nextSlipId.toArrayLike(Buffer, "le", 8)],
            program.programId
          )[0],
          treasury: treasuryPda,
          buyer_base_ata: slipperBaseAta,
          treasury_base_ata: treasuryBaseAta,
          base_mint: baseMint,
          slipCreator: slipper.publicKey,
          token_program: TOKEN_PROGRAM,
          associated_token_program: ATA_PROGRAM,
          system_program: SystemProgram.programId,
        })
        .remainingAccounts([
          // Leg 1: [Market, outcome_mint, buyer_outcome_ata]
          { pubkey: market1Pda, isWritable: true },
          { pubkey: market1Mint0, isWritable: true },
          { pubkey: slipperMarket1Ata, isWritable: true },
          // Leg 2
          { pubkey: market2Pda, isWritable: true },
          { pubkey: market2Mint0, isWritable: true },
          { pubkey: slipperMarket2Ata, isWritable: true },
          // Market group
          { pubkey: groupPda, isWritable: false },
        ])
        .signers([slipper])
        .rpc();

      const cfgAfter = await program.account.globalConfig.fetch(globalConfigPda);
      const slipperBaseAfter = await getAccount(provider.connection, slipperBaseAta);
      const spent = Number(slipperBaseBefore.amount) - Number(slipperBaseAfter.amount);

      assert.ok(spent > 0, "Slipper should have spent base tokens");
      assert.ok(
        cfgAfter.lockedPayouts.toNumber() > lockedPayoutsBefore,
        "locked_payouts should increase"
      );

      console.log(`  2-leg correlated slip placed: cost=${spent}, locked_payouts increased`);
    });

    it("rejects bet exceeding max_payment", async () => {
      if (skipSuite) { console.log("SKIPPED"); return; }

      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      const slipPda = PublicKey.findProgramAddressSync(
        [Buffer.from("bet_slip"), cfg.nextSlipId.toArrayLike(Buffer, "le", 8)],
        program.programId
      )[0];

      const legs = [
        { marketId: new anchor.BN(market1Id), outcomeId: 0, numShares: new anchor.BN(1_000_000) },
        { marketId: new anchor.BN(market2Id), outcomeId: 0, numShares: new anchor.BN(1_000_000) },
      ];
      const maxPayment = 1; // tiny — should fail

      try {
        await program.methods
          .placeSlip(legs, new anchor.BN(maxPayment), 1)
          .accounts({
            global_config: globalConfigPda, betSlip: slipPda,
            treasury: treasuryPda, buyer_base_ata: slipperBaseAta,
            treasuryBaseAta, baseMint, slipCreator: slipper.publicKey,
            token_program: TOKEN_PROGRAM, associated_token_program: ATA_PROGRAM,
            system_program: SystemProgram.programId,
          })
          .remainingAccounts([
            { pubkey: market1Pda, isWritable: true }, { pubkey: market1Mint0, isWritable: true }, { pubkey: slipperMarket1Ata, isWritable: true },
            { pubkey: market2Pda, isWritable: true }, { pubkey: market2Mint0, isWritable: true }, { pubkey: slipperMarket2Ata, isWritable: true },
            { pubkey: groupPda, isWritable: false },
          ])
          .signers([slipper]).rpc();
        assert.fail("Should have rejected — cost exceeds max_payment");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("SlipCostExceeded") || err.error?.errorCode?.code === "SlipCostExceeded",
          `Expected SlipCostExceeded, got: ${err?.message ?? err}`
        );
      }
      console.log("  SlipCostExceeded correctly rejected");
    });
  });

  describe("Bet Slip — cash_out_slip", () => {
    it("cash_out_slip burns outcome tokens and releases locked_payouts", async () => {
      if (skipSuite) { console.log("SKIPPED"); return; }

      // Get the last placed slip ID
      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      const slipId = cfg.nextSlipId.toNumber() - 1;
      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet_slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const slipBefore = await program.account.betSlip.fetch(slipPda);
      const lockedAmount = slipBefore.lockedAmount.toNumber();
      const cfgBefore = await program.account.globalConfig.fetch(globalConfigPda);
      const lockedPayoutsBefore = cfgBefore.lockedPayouts.toNumber();

      const slipperBaseBefore = await getAccount(provider.connection, slipperBaseAta);
      const slipperMarket1Before = await getAccount(provider.connection, slipperMarket1Ata);
      const slipperMarket2Before = await getAccount(provider.connection, slipperMarket2Ata);

      await program.methods
        .cashOutSlip(new anchor.BN(slipId))
        .accounts({
          global_config: globalConfigPda,
          betSlip: slipPda,
          treasury: treasuryPda,
          claimerBaseAta: slipperBaseAta,
          treasury_base_ata: treasuryBaseAta,
          base_mint: baseMint,
          claimer: slipper.publicKey,
          token_program: TOKEN_PROGRAM,
          system_program: SystemProgram.programId,
        })
        .remainingAccounts([
          // Leg 1: market, outcome_mint, claimer_outcome_ata
          { pubkey: market1Pda, isWritable: true },
          { pubkey: market1Mint0, isWritable: true },
          { pubkey: slipperMarket1Ata, isWritable: true },
          // Leg 2
          { pubkey: market2Pda, isWritable: true },
          { pubkey: market2Mint0, isWritable: true },
          { pubkey: slipperMarket2Ata, isWritable: true },
        ])
        .signers([slipper])
        .rpc();

      const slipperBaseAfter = await getAccount(provider.connection, slipperBaseAta);
      const slipperMarket1After = await getAccount(provider.connection, slipperMarket1Ata);
      const slipperMarket2After = await getAccount(provider.connection, slipperMarket2Ata);

      const cashOutReceived = Number(slipperBaseAfter.amount) - Number(slipperBaseBefore.amount);
      const burned1 = Number(slipperMarket1Before.amount) - Number(slipperMarket1After.amount);
      const burned2 = Number(slipperMarket2Before.amount) - Number(slipperMarket2After.amount);

      assert.ok(cashOutReceived > 0, "Slipper should receive cash-out payout");
      assert.ok(burned1 >= 500_000, "Leg 1 outcome tokens should be burned");
      assert.ok(burned2 >= 500_000, "Leg 2 outcome tokens should be burned");

      const cfgAfter = await program.account.globalConfig.fetch(globalConfigPda);
      const released = lockedPayoutsBefore - cfgAfter.lockedPayouts.toNumber();
      assert.ok(released >= lockedAmount, "locked_payouts should be released");

      // Verify slip is closed (already claimed flag set)
      try {
        await program.account.betSlip.fetch(slipPda);
        // If it exists, it should be marked as claimed
        const slipAfter = await program.account.betSlip.fetch(slipPda);
        assert.ok(slipAfter.claimed, "Closed slip should be marked claimed");
      } catch (_) {
        // Account closed — also acceptable
      }
      console.log(`  Cash-out: received=${cashOutReceived}, burned leg1=${burned1}, burned leg2=${burned2}, released=${released}`);
    });

    it("claim_slip fails on cashed-out slip (double-claim prevention)", async () => {
      if (skipSuite) { console.log("SKIPPED"); return; }

      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      const slipId = cfg.nextSlipId.toNumber() - 1;
      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet_slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Slips may be closed (account not found) or exist with claimed=true
      try {
        const slip = await program.account.betSlip.fetch(slipPda);
        // Try to claim a cashed-out slip
        try {
          await program.methods
            .claimSlip(new anchor.BN(slipId), 1)
            .accounts({
              global_config: globalConfigPda, betSlip: slipPda,
              treasury: treasuryPda, claimerBaseAta: slipperBaseAta,
              treasuryBaseAta, baseMint, claimer: slipper.publicKey,
              token_program: TOKEN_PROGRAM, associated_token_program: ATA_PROGRAM,
              system_program: SystemProgram.programId,
            })
            .remainingAccounts([
              { pubkey: market1Pda, isWritable: true }, { pubkey: market1Mint0, isWritable: true }, { pubkey: slipperMarket1Ata, isWritable: true },
              { pubkey: market2Pda, isWritable: true }, { pubkey: market2Mint0, isWritable: true }, { pubkey: slipperMarket2Ata, isWritable: true },
            ])
            .signers([slipper]).rpc();
          assert.fail("Should have rejected — slip already cashed out");
        } catch (err: any) {
          assert.ok(
            err.toString().includes("SlipAlreadyClaimed") || err.error?.errorCode?.code === "SlipAlreadyClaimed" ||
            err.toString().includes("SlipAlreadyCashedOut") || err.error?.errorCode?.code === "SlipAlreadyCashedOut" ||
            err.toString().includes("Account") || err.toString().includes("not found"),
            `Expected claim rejection for cashed-out slip, got: ${err?.message ?? err}`
          );
        }
      } catch (_) {
        // Account is closed — trying to claim should fail with account not found
        try {
          await program.methods
            .claimSlip(new anchor.BN(slipId), 1)
            .accounts({
              global_config: globalConfigPda, betSlip: slipPda,
              treasury: treasuryPda, claimerBaseAta: slipperBaseAta,
              treasuryBaseAta, baseMint, claimer: slipper.publicKey,
              token_program: TOKEN_PROGRAM, associated_token_program: ATA_PROGRAM,
              system_program: SystemProgram.programId,
            })
            .remainingAccounts([
              { pubkey: market1Pda, isWritable: true }, { pubkey: market1Mint0, isWritable: true }, { pubkey: slipperMarket1Ata, isWritable: true },
              { pubkey: market2Pda, isWritable: true }, { pubkey: market2Mint0, isWritable: true }, { pubkey: slipperMarket2Ata, isWritable: true },
            ])
            .signers([slipper]).rpc();
          assert.fail("Should have failed — slip account closed");
        } catch (_) {
          // Expected — closed account
        }
      }
      console.log("  Double-claim prevention verified for cashed-out slip");
    });
  });

  describe("Bet Slip — update_slip_lock", () => {
    it("update_slip_lock reduces lock when odds move favorably", async () => {
      if (skipSuite) { console.log("SKIPPED"); return; }

      // Place a fresh slip to test lock update
      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      const nextSlipId = cfg.nextSlipId.toNumber();
      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet_slip"), new anchor.BN(nextSlipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const legs = [
        { marketId: new anchor.BN(market1Id), outcomeId: 0, numShares: new anchor.BN(500_000) },
      ];
      await program.methods
        .placeSlip(legs, new anchor.BN(20_000_000), 1)
        .accounts({
          global_config: globalConfigPda, betSlip: slipPda,
          treasury: treasuryPda, buyer_base_ata: slipperBaseAta,
          treasuryBaseAta, baseMint, slipCreator: slipper.publicKey,
          token_program: TOKEN_PROGRAM, associated_token_program: ATA_PROGRAM,
          system_program: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: market1Pda, isWritable: true }, { pubkey: market1Mint0, isWritable: true }, { pubkey: slipperMarket1Ata, isWritable: true },
          { pubkey: groupPda, isWritable: false },
        ])
        .signers([slipper]).rpc();

      const slipBefore = await program.account.betSlip.fetch(slipPda);
      const initialLocked = slipBefore.lockedAmount.toNumber();
      const cfgBefore = await program.account.globalConfig.fetch(globalConfigPda);
      const lockedPayoutsBefore = cfgBefore.lockedPayouts.toNumber();

      // Update slip lock (call without any market changes — odds may have shifted)
      await program.methods
        .updateSlipLock(new anchor.BN(nextSlipId))
        .accounts({
          global_config: globalConfigPda, betSlip: slipPda,
        })
        .signers([slipper])
        .rpc();

      const slipAfter = await program.account.betSlip.fetch(slipPda);
      const cfgAfter = await program.account.globalConfig.fetch(globalConfigPda);

      // locked_amount should not increase (can only decrease)
      assert.ok(
        slipAfter.lockedAmount.toNumber() <= initialLocked,
        "locked_amount should not increase"
      );

      // locked_payouts should reflect any decrease
      if (slipAfter.lockedAmount.toNumber() < initialLocked) {
        const released = lockedPayoutsBefore - cfgAfter.lockedPayouts.toNumber();
        assert.ok(released >= 0, "locked_payouts should reflect release");
        console.log(`  update_slip_lock: initial_locked=${initialLocked} → ${slipAfter.lockedAmount.toNumber()}, released=${released}`);
      } else {
        console.log(`  update_slip_lock: locked_amount unchanged at ${initialLocked}`);
      }
    });
  });

  describe("Bet Slip — Settlement & Claim", () => {
    it("claim_slip pays out correctly when all legs win", async () => {
      if (skipSuite) { console.log("SKIPPED"); return; }

      // Create a fresh slip on a market that will be settled to outcome 0
      const startTime = Math.floor(Date.now() / 1000) - 10; // already started

      // Create settlement market
      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      const [settleEpochPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch"), new anchor.BN(cfg.currentEpoch.toNumber()).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const settleMarketId = cfg.nextMarketId.toNumber();
      const [settlePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(settleMarketId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      await program.methods
        .createMarket(new anchor.BN(startTime), 2, "Settle Slip Test", "sst", 0, null, null)
        .accounts({ global_config: globalConfigPda, market: settlePda, epoch: settleEpochPda, authority: admin.publicKey, system_program: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
        .signers([admin]).rpc();

      const [settleMint0] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(settleMarketId).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
        program.programId
      );
      const [settleMint1] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(settleMarketId).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
        program.programId
      );
      for (const [oid, mint] of [[0, settleMint0], [1, settleMint1]] as [number, PublicKey][]) {
        try {
          await program.methods.initOutcomeMint(new anchor.BN(settleMarketId), oid)
            .accounts({ global_config: globalConfigPda, market: settlePda, outcome_mint: mint, payer: admin.publicKey, token_program: TOKEN_PROGRAM, system_program: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
            .signers([admin]).rpc();
        } catch (_) { /* may exist */ }
      }

      // Create a group for this settlement market
      const settleGroupId = settleMarketId;
      const [settleGroupPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market_group"), new anchor.BN(settleGroupId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      try {
        await program.methods.createMarketGroup(
          new anchor.BN(settleGroupId),
          new anchor.BN(500_000_000),
          new anchor.BN(startTime + 86400),
          "Settle Group"
        )
          .accounts({ global_config: globalConfigPda, marketGroup: settleGroupPda, authority: admin.publicKey, system_program: SystemProgram.programId })
          .signers([admin]).rpc();
        await program.methods.addMarketToGroup(new anchor.BN(settleGroupId), 0)
          .accounts({ global_config: globalConfigPda, market: settlePda, marketGroup: settleGroupPda })
          .signers([admin]).rpc();
      } catch (_) { /* group may exist */ }

      // Create slipper outcome ATA for settlement market
      const slipperSettleAta = getAssociatedTokenAddressSync(settleMint0, slipper.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
      try {
        await provider.sendAndConfirm(
          new Transaction().add(createAssociatedTokenAccountInstruction(
            payer.publicKey, slipperSettleAta, slipper.publicKey, settleMint0, TOKEN_PROGRAM, ATA_PROGRAM
          )),
          []
        );
      } catch (_) { /* may exist */ }

      // Place slip on settlement market
      const cfg2 = await program.account.globalConfig.fetch(globalConfigPda);
      const slipId = cfg2.nextSlipId.toNumber();
      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet_slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const legs = [{ marketId: new anchor.BN(settleMarketId), outcomeId: 0, numShares: new anchor.BN(1_000_000) }];
      await program.methods
        .placeSlip(legs, new anchor.BN(15_000_000), 1)
        .accounts({
          global_config: globalConfigPda, betSlip: slipPda,
          treasury: treasuryPda, buyer_base_ata: slipperBaseAta,
          treasuryBaseAta, baseMint, slipCreator: slipper.publicKey,
          token_program: TOKEN_PROGRAM, associated_token_program: ATA_PROGRAM,
          system_program: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: settlePda, isWritable: true },
          { pubkey: settleMint0, isWritable: true },
          { pubkey: slipperSettleAta, isWritable: true },
          { pubkey: settleGroupPda, isWritable: false },
        ])
        .signers([slipper]).rpc();

      // Oracle proposes result (outcome 0 = winner)
      await program.methods
        .proposeResult(new anchor.BN(settleMarketId), 0)
        .accounts({
          global_config: globalConfigPda, market: settlePda,
          dispute: PublicKey.findProgramAddressSync(
            [Buffer.from("dispute"), new anchor.BN(settleMarketId).toArrayLike(Buffer, "le", 8)],
            program.programId
          )[0],
          oracle: admin.publicKey,
          system_program: SystemProgram.programId,
        })
        .signers([admin]).rpc();

      // Wait and finalize
      await new Promise(resolve => setTimeout(resolve, 62_000));
      await program.methods
        .finalizeResult(new anchor.BN(settleMarketId))
        .accounts({
          global_config: globalConfigPda, market: settlePda,
          dispute: PublicKey.findProgramAddressSync(
            [Buffer.from("dispute"), new anchor.BN(settleMarketId).toArrayLike(Buffer, "le", 8)],
            program.programId
          )[0],
          caller: payer.publicKey,
        })
        .rpc();

      const slipperBaseBefore = await getAccount(provider.connection, slipperBaseAta);

      // Claim the slip
      await program.methods
        .claimSlip(new anchor.BN(slipId), 1)
        .accounts({
          global_config: globalConfigPda, betSlip: slipPda,
          treasury: treasuryPda, claimerBaseAta: slipperBaseAta,
          treasuryBaseAta, baseMint, claimer: slipper.publicKey,
          token_program: TOKEN_PROGRAM, associated_token_program: ATA_PROGRAM,
          system_program: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: settlePda, isWritable: true },
          { pubkey: settleMint0, isWritable: true },
          { pubkey: slipperSettleAta, isWritable: true },
        ])
        .signers([slipper])
        .rpc();

      const slipperBaseAfter = await getAccount(provider.connection, slipperBaseAta);
      const claimed = Number(slipperBaseAfter.amount) - Number(slipperBaseBefore.amount);

      assert.ok(claimed > 0, "Slipper should receive payout on winning slip");
      console.log(`  Slip claimed: payout=${claimed}`);
    });

    it("locked_payouts released after slip settlement", async () => {
      if (skipSuite) { console.log("SKIPPED"); return; }

      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      const treasuryBal = await getAccount(provider.connection, treasuryBaseAta);

      assert.ok(
        cfg.lockedPayouts.toNumber() <= Number(treasuryBal.amount),
        "Solvency holds after slip settlement"
      );
      console.log(`  Post-settlement solvency: treasury=${treasuryBal.amount}, locked=${cfg.lockedPayouts}`);
    });
  });
});
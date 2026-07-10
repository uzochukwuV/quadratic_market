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

async function fundAccount(
  provider: anchor.AnchorProvider,
  kp: Keypair,
  amount: number
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(
    kp.publicKey, amount * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig);
}

// ─── Test Suite ─────────────────────────────────────────────────

describe("protocol_core_tests — Core Protocol Functionality", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
  const payer = provider.wallet.payer;

  // PDAs
  let globalConfigPda: PublicKey;
  let lpMintPda: PublicKey;
  let treasuryPda: PublicKey;

  // Keypairs
  let oracle: Keypair;
  let admin: Keypair;
  let lp: Keypair;
  let trader: Keypair;

  // Token accounts
  let baseMint: PublicKey;
  let baseMintAuthority: Keypair;
  let treasuryBaseAta: PublicKey;
  let lpBaseAta: PublicKey;
  let lpLpAta: PublicKey;
  let traderBaseAta: PublicKey;

  // Market data
  let marketPda: PublicKey;
  let marketId: number;

  // Epoch data
  let epochPda: PublicKey;

  let skipSuite = false;

  before(async () => {
    // Check if program exists
    if (!program?.programId) {
      console.log("Program not initialized - skipping suite");
      skipSuite = true;
      return;
    }

    // Find PDAs
    [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")], program.programId
    );
    [lpMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint")], program.programId
    );
    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")], program.programId
    );

    // Check if already initialized
    try {
      await program.account.globalConfig.fetch(globalConfigPda);
      console.log("Protocol already initialized");
      
      // Get existing data
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      baseMint = config.baseMint;
      
      skipSuite = true;
      return;
    } catch {
      // Not initialized, proceed
    }

    // Generate keypairs
    oracle = Keypair.generate();
    admin = Keypair.generate();
    lp = Keypair.generate();
    trader = Keypair.generate();
    baseMintAuthority = Keypair.generate();

    // Fund accounts
    for (const kp of [oracle, admin, lp, trader]) {
      await fundAccount(provider, kp, 5);
    }

    // Create base mint (USDC with 6 decimals)
    baseMint = await createMint(
      provider.connection, payer,
      baseMintAuthority.publicKey, null, 6,
      undefined, TOKEN_PROGRAM
    );

    // Create ATAs
    treasuryBaseAta = await createAtaOffCurve(provider, baseMint, treasuryPda);
    lpBaseAta = await createAtaOnCurve(provider, baseMint, lp.publicKey);
    traderBaseAta = await createAtaOnCurve(provider, baseMint, trader.publicKey);

    // Mint base tokens
    await mintTo(
      provider.connection, payer, baseMint, lpBaseAta,
      baseMintAuthority, 1_000_000_000 // 1000 USDC
    );
    await mintTo(
      provider.connection, payer, baseMint, traderBaseAta,
      baseMintAuthority, 500_000_000 // 500 USDC
    );
  });

  // ─── 1. Initialize Protocol ────────────────────────────────────

  describe("Protocol Initialization", () => {
    it("initializes the protocol with correct settings", async () => {
      if (skipSuite) {
        console.log("SKIPPED - protocol already initialized");
        return;
      }

      const maxExposure = new anchor.BN(500_000_000_000); // 500k USDC

      await program.methods
        .initialize(
          Array.from(oracle.publicKey.toBytes()) as unknown as number[] & { length: 32 },
          maxExposure
        )
        .accounts({
          global_config: globalConfigPda,
          lp_mint: lpMintPda,
          treasury: treasuryPda,
          base_mint: baseMint,
          admin: payer.publicKey,
          token_program: TOKEN_PROGRAM,
          system_program: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const config = await program.account.globalConfig.fetch(globalConfigPda);

      assert.equal(config.admin.toString(), payer.publicKey.toString());
      assert.equal(config.paused, false);
      assert.ok(config.maxMarketExposure.eq(maxExposure));
      assert.equal(config.nextMarketId.toNumber(), 1);
      assert.equal(config.nextSlipId.toNumber(), 1);
      assert.equal(config.currentEpoch.toNumber(), 0);

      // Create LP ATA
      lpLpAta = getAssociatedTokenAddressSync(
        lpMintPda, lp.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
      );
      await provider.sendAndConfirm(
        new Transaction().add(createAssociatedTokenAccountInstruction(
          payer.publicKey, lpLpAta, lp.publicKey, lpMintPda, TOKEN_PROGRAM, ATA_PROGRAM
        )),
        []
      );

      console.log("Protocol initialized successfully");
    });

    it("fails to re-initialize protocol", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      try {
        await program.methods
          .initialize(
            Array.from(oracle.publicKey.toBytes()) as unknown as number[] & { length: 32 },
            new anchor.BN(100_000_000)
          )
          .accounts({
            global_config: globalConfigPda,
            lp_mint: lpMintPda,
            treasury: treasuryPda,
            base_mint: baseMint,
            admin: payer.publicKey,
            token_program: TOKEN_PROGRAM,
            system_program: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err) {
        assert.ok(err, "Expected initialization to fail on second call");
      }
    });
  });

  // ─── 2. LP Operations ─────────────────────────────────────────

  describe("LP Operations", () => {
    it("adds liquidity as LP", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      const depositAmount = new anchor.BN(500_000_000); // 500 USDC
      const treasuryBalBefore = Number((await getAccount(provider.connection, treasuryBaseAta)).amount);

      await program.methods
        .addLiquidity(depositAmount)
        .accounts({
          global_config: globalConfigPda,
          lp_mint: lpMintPda,
          treasury: treasuryPda,
          treasury_base_ata: treasuryBaseAta,
          provider_base_ata: lpBaseAta,
          provider_lp_ata: lpLpAta,
          base_mint: baseMint,
          provider: lp.publicKey,
          token_program: TOKEN_PROGRAM,
          associated_token_program: ATA_PROGRAM,
          system_program: SystemProgram.programId,
        })
        .signers([lp])
        .rpc();

      // Verify LP tokens minted
      const lpBalance = await getAccount(provider.connection, lpLpAta);
      assert.ok(Number(lpBalance.amount) > 0, "LP should have received LP tokens");

      // Verify treasury received funds
      const treasuryBalAfter = Number((await getAccount(provider.connection, treasuryBaseAta)).amount);
      assert.equal(treasuryBalAfter, treasuryBalBefore + Number(depositAmount.toString()));

      // Verify global config updated
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      assert.ok(config.totalLpSupply.toNumber() > 0);

      console.log("Added liquidity:", Number(lpBalance.amount), "LP tokens");
    });

    it("adds more liquidity", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      const additionalDeposit = new anchor.BN(300_000_000); // 300 USDC
      const lpBalBefore = Number((await getAccount(provider.connection, lpLpAta)).amount);

      await program.methods
        .addLiquidity(additionalDeposit)
        .accounts({
          global_config: globalConfigPda,
          lp_mint: lpMintPda,
          treasury: treasuryPda,
          treasury_base_ata: treasuryBaseAta,
          provider_base_ata: lpBaseAta,
          provider_lp_ata: lpLpAta,
          base_mint: baseMint,
          provider: lp.publicKey,
          token_program: TOKEN_PROGRAM,
          associated_token_program: ATA_PROGRAM,
          system_program: SystemProgram.programId,
        })
        .signers([lp])
        .rpc();

      const lpBalAfter = Number((await getAccount(provider.connection, lpLpAta)).amount);
      assert.ok(lpBalAfter > lpBalBefore, "LP balance should increase");

      console.log("Added more liquidity. Total LP tokens:", lpBalAfter);
    });
  });

  // ─── 3. Epoch Operations ──────────────────────────────────────

  describe("Epoch Operations", () => {
    it("initializes an epoch", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const epochId = config.currentEpoch.toNumber();

      [epochPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      await program.methods
        .initEpoch()
        .accounts({
          global_config: globalConfigPda,
          epoch: epochPda,
          payer: payer.publicKey,
          system_program: SystemProgram.programId,
        })
        .rpc();

      const epoch = await program.account.epoch.fetch(epochPda);
      assert.equal(epoch.epochId.toNumber(), epochId);
      assert.equal(epoch.numMarkets.toNumber(), 0);
      assert.equal(epoch.numSettledMarkets.toNumber(), 0);
      assert.equal(epoch.withdrawalsEnabled, false);
      assert.ok(epoch.startTime.toNumber() > 0);
      assert.ok(epoch.endTime.toNumber() > epoch.startTime.toNumber());

      console.log("Initialized epoch:", epochId);
    });
  });

  // ─── 4. Market Creation ───────────────────────────────────────

  describe("Market Creation", () => {
    it("creates a trading market (LMSR mode)", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      marketId = config.nextMarketId.toNumber();

      [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const startTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now

      await program.methods
        .createMarket(
          new anchor.BN(startTime),
          2, // binary outcome
          "Will BTC reach $100k by 2025?",
          "Prediction market for Bitcoin price",
          0, // category: crypto
          null, // lmsr_b_override
          null, // initial_q_values
          { trading: {} } // LMSR trading mode
        )
        .accounts({
          global_config: globalConfigPda,
          market: marketPda,
          treasury: treasuryPda,
          treasury_base_ata: treasuryBaseAta,
          payer: payer.publicKey,
          system_program: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.marketId.toNumber(), marketId);
      assert.equal(market.numOutcomes, 2);
      assert.ok(market.title.includes("BTC"));
      assert.ok(market.status.enum === "Open" || market.status.Open !== undefined);

      console.log("Created trading market:", marketId);
    });

    it("creates a fixed odds market (betslip mode)", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const market2Id = config.nextMarketId.toNumber();

      const [market2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(market2Id).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const startTime = Math.floor(Date.now() / 1000) + 86400; // 1 day from now

      await program.methods
        .createMarket(
          new anchor.BN(startTime),
          3, // 3 outcomes (Home/Draw/Away)
          "Team A vs Team B",
          "Football match winner market",
          1, // category: sports
          null,
          null,
          { fixedOdds: {} } // Fixed odds mode
        )
        .accounts({
          global_config: globalConfigPda,
          market: market2Pda,
          treasury: treasuryPda,
          treasury_base_ata: treasuryBaseAta,
          payer: payer.publicKey,
          system_program: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(market2Pda);
      assert.equal(market.numOutcomes, 3);
      assert.ok(market.marketMode.fixedOdds !== undefined || 
                (market.marketMode as any).fixedOdds !== undefined);

      console.log("Created fixed odds market:", market2Id);
    });
  });

  // ─── 5. Settlement Council ────────────────────────────────────

  describe("Settlement Council", () => {
    it("initializes settlement council", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      const [councilPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("settlement_council")],
        program.programId
      );

      try {
        await program.account.settlementCouncil.fetch(councilPda);
        console.log("Council already initialized");
        return;
      } catch {
        // Not initialized
      }

      const minStake = new anchor.BN(10_000_000_000); // 10,000 USDC
      const requiredConfirmations = 2;

      await program.methods
        .initializeSettlementCouncil(minStake, requiredConfirmations)
        .accounts({
          global_config: globalConfigPda,
          council: councilPda,
          payer: payer.publicKey,
          system_program: SystemProgram.programId,
        })
        .rpc();

      const council = await program.account.settlementCouncil.fetch(councilPda);
      assert.equal(council.requiredConfirmations, requiredConfirmations);
      assert.ok(council.authority.equals(payer.publicKey));

      console.log("Initialized settlement council");
    });
  });

  // ─── 6. BetSlip Operations ───────────────────────────────────

  describe("BetSlip Operations", () => {
    it("creates a multi-leg betslip", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const slipId = config.nextSlipId.toNumber();

      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Define 2 legs for the betslip
      const legs = [
        { marketId: new anchor.BN(0), outcomeId: 0, numShares: new anchor.BN(1_000_000) },
        { marketId: new anchor.BN(1), outcomeId: 1, numShares: new anchor.BN(1_000_000) },
      ];

      // Fixed odds: 2.0x and 3.0x (in basis points)
      const fixedOdds = [
        new anchor.BN(20_000), // 2.0x = 20000 bps
        new anchor.BN(30_000), // 3.0x = 30000 bps
      ];

      const stake = new anchor.BN(1_000_000); // 1 USDC
      const cancelDeadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes

      const traderBaseAtaForSlip = await createAtaOnCurve(provider, baseMint, payer.publicKey);
      await mintTo(
        provider.connection, payer, baseMint, traderBaseAtaForSlip,
        baseMintAuthority, 100_000_000
      );

      await program.methods
        .placeSlipAwait(legs, stake, fixedOdds, new anchor.BN(cancelDeadline))
        .accounts({
          global_config: globalConfigPda,
          slip: slipPda,
          treasury: treasuryPda,
          owner_base_ata: traderBaseAtaForSlip,
          treasury_base_ata: treasuryBaseAta,
          payer: payer.publicKey,
          token_program: TOKEN_PROGRAM,
          associated_token_program: ATA_PROGRAM,
          system_program: SystemProgram.programId,
        })
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      assert.equal(slip.numLegs, 2);
      assert.ok(slip.owner.equals(payer.publicKey));
      assert.ok(slip.totalStake.eq(stake));
      assert.ok(slip.potentialPayout.gt(stake)); // Should be more than stake due to odds

      console.log("Created betslip:", slipId, "with potential payout:", slip.potentialPayout.toString());
    });

    it("can check slip status", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const slipId = config.nextSlipId.toNumber() - 1; // Last created slip

      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const slip = await program.account.slip.fetch(slipPda);
      
      // Check helper method equivalents
      assert.equal(slip.numLegs, 2);
      assert.ok(!slip.allLegsBought); // No legs bought yet (awaiting phase)
      assert.ok(!slip.allLegsSettled);
      
      console.log("Slip status:", JSON.stringify(slip.status));
    });
  });

  // ─── 7. Protocol Pause (Emergency) ───────────────────────────

  describe("Protocol Controls", () => {
    it("pauses and unpauses the protocol", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        return;
      }

      // Pause
      await program.methods
        .pauseProtocol(true)
        .accounts({
          global_config: globalConfigPda,
          admin: payer.publicKey,
        })
        .rpc();

      let config = await program.account.globalConfig.fetch(globalConfigPda);
      assert.equal(config.paused, true);

      // Unpause
      await program.methods
        .pauseProtocol(false)
        .accounts({
          global_config: globalConfigPda,
          admin: payer.publicKey,
        })
        .rpc();

      config = await program.account.globalConfig.fetch(globalConfigPda);
      assert.equal(config.paused, false);

      console.log("Protocol pause/unpause works correctly");
    });
  });
});

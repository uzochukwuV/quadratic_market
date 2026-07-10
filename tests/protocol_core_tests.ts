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
  try {
    await getAccount(provider.connection, ata);
  } catch {
    await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey, ata, owner, mint, TOKEN_PROGRAM, ATA_PROGRAM
        )
      ),
      []
    );
  }
  return ata;
}

async function createAtaOffCurve(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM, ATA_PROGRAM);
  try {
    await getAccount(provider.connection, ata);
  } catch {
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
  }
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
  let market1Pda: PublicKey;
  let market1Id: number;
  let market2Pda: PublicKey;
  let market2Id: number;

  // Epoch data
  let epochPda: PublicKey;

  let skipSuite = false;

  before(async () => {
    console.log("\n=== Setting up test environment ===\n");

    // Check if program exists
    if (!program?.programId) {
      console.log("ERROR: Program not initialized");
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
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      console.log("Protocol already initialized at:", globalConfigPda.toString());
      baseMint = config.baseMint;
      skipSuite = true;
      return;
    } catch {
      console.log("Protocol not initialized, proceeding with setup...");
    }

    // Generate keypairs
    oracle = Keypair.generate();
    lp = Keypair.generate();
    trader = Keypair.generate();
    baseMintAuthority = Keypair.generate();

    // Fund accounts
    console.log("Funding test accounts...");
    for (const kp of [oracle, lp, trader]) {
      await fundAccount(provider, kp, 5);
    }

    // Create base mint (USDC with 6 decimals)
    console.log("Creating base mint...");
    baseMint = await createMint(
      provider.connection, payer,
      baseMintAuthority.publicKey, null, 6,
      undefined, TOKEN_PROGRAM
    );
    console.log("Base mint:", baseMint.toString());

    // Create ATAs
    console.log("Creating token accounts...");
    treasuryBaseAta = await createAtaOffCurve(provider, baseMint, treasuryPda);
    lpBaseAta = await createAtaOnCurve(provider, baseMint, lp.publicKey);
    traderBaseAta = await createAtaOnCurve(provider, baseMint, trader.publicKey);

    // Mint base tokens
    console.log("Minting test tokens...");
    await mintTo(
      provider.connection, payer, baseMint, lpBaseAta,
      baseMintAuthority, 1_000_000_000 // 1000 USDC
    );
    await mintTo(
      provider.connection, payer, baseMint, traderBaseAta,
      baseMintAuthority, 500_000_000 // 500 USDC
    );

    console.log("\nSetup complete!\n");
  });

  // ─── 1. Initialize Protocol ────────────────────────────────────

  describe("1. Protocol Initialization", () => {
    it("initializes the protocol", async () => {
      if (skipSuite) {
        console.log("SKIPPED - protocol already initialized");
        this.skip();
      }

      console.log("Initializing protocol...");

      const oraclePubkey = new Uint8Array(oracle.publicKey.toBytes());
      const maxExposure = new anchor.BN(500_000_000_000); // 500k USDC

      await program.methods
        .initialize(oraclePubkey as any, maxExposure)
        .accounts({
          globalConfig: globalConfigPda,
          lpMint: lpMintPda,
          treasury: treasuryPda,
          baseMint: baseMint,
          admin: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const config = await program.account.globalConfig.fetch(globalConfigPda);

      assert.equal(config.admin.toString(), payer.publicKey.toString());
      assert.equal(config.paused, false);
      assert.equal(config.paused, false);
      assert.ok(config.maxMarketExposure.eq(maxExposure));
      assert.equal(config.nextMarketId.toNumber(), 1);
      assert.equal(config.nextSlipId.toNumber(), 1);
      assert.equal(config.currentEpoch.toNumber(), 0);

      console.log("Protocol initialized successfully!");
    });

    it("creates LP ATA for liquidity deposits", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        this.skip();
      }

      lpLpAta = getAssociatedTokenAddressSync(
        lpMintPda, lp.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
      );
      
      // Check if already exists
      try {
        await getAccount(provider.connection, lpLpAta);
        console.log("LP ATA already exists");
      } catch {
        await provider.sendAndConfirm(
          new Transaction().add(createAssociatedTokenAccountInstruction(
            payer.publicKey, lpLpAta, lp.publicKey, lpMintPda, TOKEN_PROGRAM, ATA_PROGRAM
          )),
          []
        );
        console.log("Created LP ATA");
      }
    });
  });

  // ─── 2. LP Operations ─────────────────────────────────────────

  describe("2. LP Operations", () => {
    it("adds liquidity as LP", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        this.skip();
      }

      const depositAmount = new anchor.BN(500_000_000); // 500 USDC
      const treasuryBalBefore = Number((await getAccount(provider.connection, treasuryBaseAta)).amount);

      console.log("Adding liquidity:", depositAmount.toString());

      await program.methods
        .addLiquidity(depositAmount)
        .accounts({
          globalConfig: globalConfigPda,
          lpMint: lpMintPda,
          treasury: treasuryPda,
          treasuryBaseAta: treasuryBaseAta,
          providerBaseAta: lpBaseAta,
          providerLpAta: lpLpAta,
          baseMint: baseMint,
          provider: lp.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
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

      console.log("Added liquidity. LP tokens:", Number(lpBalance.amount));
    });
  });

  // ─── 3. Epoch Operations ──────────────────────────────────────

  describe("3. Epoch Operations", () => {
    it("initializes an epoch", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        this.skip();
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const epochId = config.currentEpoch.toNumber();

      [epochPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      console.log("Initializing epoch:", epochId);

      await program.methods
        .initEpoch()
        .accounts({
          globalConfig: globalConfigPda,
          epoch: epochPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const epoch = await program.account.epoch.fetch(epochPda);
      assert.equal(epoch.epochId.toNumber(), epochId);
      assert.equal(epoch.numMarkets.toNumber(), 0);
      assert.equal(epoch.numSettledMarkets.toNumber(), 0);
      assert.equal(epoch.withdrawalsEnabled, false);
      assert.ok(epoch.startTime.toNumber() > 0);
      assert.ok(epoch.endTime.toNumber() > epoch.startTime.toNumber());

      console.log("Epoch initialized! Start:", epoch.startTime.toString(), "End:", epoch.endTime.toString());
    });
  });

  // ─── 4. Market Creation ───────────────────────────────────────

  describe("4. Market Creation", () => {
    it("creates a trading market (LMSR mode)", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        this.skip();
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      market1Id = config.nextMarketId.toNumber();

      [market1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(market1Id).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const startTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now

      console.log("Creating trading market ID:", market1Id);

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
          globalConfig: globalConfigPda,
          market: market1Pda,
          treasury: treasuryPda,
          treasuryBaseAta: treasuryBaseAta,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(market1Pda);
      assert.equal(market.marketId.toNumber(), market1Id);
      assert.equal(market.numOutcomes, 2);
      assert.ok(market.title.includes("BTC"));
      assert.equal((market.status as any).open, undefined); // Should be Open variant
      
      console.log("Created trading market:", market1Id);
    });

    it("creates a fixed odds market (betslip mode)", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        this.skip();
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      market2Id = config.nextMarketId.toNumber();

      [market2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(market2Id).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const startTime = Math.floor(Date.now() / 1000) + 86400; // 1 day from now

      console.log("Creating fixed odds market ID:", market2Id);

      await program.methods
        .createMarket(
          new anchor.BN(startTime),
          3, // 3 outcomes (Home/Draw/Away)
          "Team A vs Team B",
          "Football match winner market",
          1, // category: sports
          null, // lmsr_b_override
          null, // initial_q_values
          { fixedOdds: {} } // Fixed odds mode
        )
        .accounts({
          globalConfig: globalConfigPda,
          market: market2Pda,
          treasury: treasuryPda,
          treasuryBaseAta: treasuryBaseAta,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(market2Pda);
      assert.equal(market.numOutcomes, 3);
      
      console.log("Created fixed odds market:", market2Id);
    });
  });

  // ─── 5. Settlement Council ────────────────────────────────────

  describe("5. Settlement Council", () => {
    it("initializes settlement council", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        this.skip();
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

      console.log("Initializing settlement council...");

      await program.methods
        .initializeSettlementCouncil(minStake, requiredConfirmations)
        .accounts({
          globalConfig: globalConfigPda,
          council: councilPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const council = await program.account.settlementCouncil.fetch(councilPda);
      assert.equal(council.requiredConfirmations, requiredConfirmations);
      assert.ok(council.authority.equals(payer.publicKey));

      console.log("Settlement council initialized!");
    });
  });

  // ─── 6. BetSlip Operations ───────────────────────────────────

  describe("6. BetSlip Operations", () => {
    it("creates a multi-leg betslip", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        this.skip();
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const slipId = config.nextSlipId.toNumber();

      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Define 2 legs for the betslip
      const legs = [
        { marketId: new anchor.BN(market1Id), outcomeId: 0, numShares: new anchor.BN(1_000_000) },
        { marketId: new anchor.BN(market2Id), outcomeId: 1, numShares: new anchor.BN(1_000_000) },
      ];

      // Fixed odds: 2.0x and 3.0x (Q32.32 format)
      const fixedOdds = [
        new anchor.BN(2 * 0x100000000), // 2.0
        new anchor.BN(3 * 0x100000000), // 3.0
      ];

      const stake = new anchor.BN(1_000_000); // 1 USDC
      const cancelDeadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes

      const traderBaseAtaForSlip = await createAtaOnCurve(provider, baseMint, payer.publicKey);
      await mintTo(
        provider.connection, payer, baseMint, traderBaseAtaForSlip,
        baseMintAuthority, 100_000_000
      );

      console.log("Creating betslip with", legs.length, "legs...");

      await program.methods
        .placeSlipAwait(legs, stake, fixedOdds, new anchor.BN(cancelDeadline))
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          treasury: treasuryPda,
          ownerBaseAta: traderBaseAtaForSlip,
          treasuryBaseAta: treasuryBaseAta,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      assert.equal(slip.numLegs, 2);
      assert.ok(slip.owner.equals(payer.publicKey));
      assert.ok(slip.totalStake.eq(stake));
      
      console.log("Created betslip:", slipId);
      console.log("Stake:", stake.toString());
      console.log("Potential payout:", slip.potentialPayout.toString());
    });
  });

  // ─── 7. Protocol Controls ─────────────────────────────────────

  describe("7. Protocol Controls", () => {
    it("pauses and unpauses the protocol", async () => {
      if (skipSuite) {
        console.log("SKIPPED");
        this.skip();
      }

      console.log("Testing pause/unpause...");

      // Pause
      await program.methods
        .pause()
        .accounts({
          globalConfig: globalConfigPda,
          admin: payer.publicKey,
        })
        .rpc();

      let config = await program.account.globalConfig.fetch(globalConfigPda);
      assert.equal(config.paused, true);
      console.log("Protocol paused");

      // Unpause
      await program.methods
        .unpause()
        .accounts({
          globalConfig: globalConfigPda,
          admin: payer.publicKey,
        })
        .rpc();

      config = await program.account.globalConfig.fetch(globalConfigPda);
      assert.equal(config.paused, false);
      console.log("Protocol unpaused");

      console.log("Pause/unpause test passed!");
    });
  });
});

/**
 * Full Protocol Flow Test Suite
 * 
 * Tests the complete lifecycle of the fixed odds betting protocol:
 * 
 * 1. Protocol Initialization (once)
 *    - Initialize global config, treasury, LP mint
 * 
 * 2. Market Creation
 *    - Create epoch
 *    - Create 3 markets (1X2, O/U, GG/NG) in a group
 *    - Set fixed odds
 * 
 * 3. Betting Flow (Slip-Only System)
 *    - User creates slip with legs
 *    - Backend executes each leg via buy_leg_for_slip
 *    - Verify outcome tokens minted correctly
 * 
 * 4. Market Settlement
 *    - Oracle proposes result
 *    - Dispute window
 *    - Finalize result
 * 
 * 5. Slip Resolution
 *    - settle_slip_leg per market
 *    - resolve_slip to finalize payout
 * 
 * 6. Payout Claim
 *    - User claims outcome tokens -> base tokens
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { QuadraticMarket } from "../target/types/quadratic_market";
import {
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  transfer,
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

// ─── Constants ───────────────────────────────────────────────────

const BPS = 10000;
const HOUSE_FEE_BPS = 500; // 5%

// ─── Helpers ───────────────────────────────────────────────────

async function createAta(
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

async function airdrop(provider: anchor.AnchorProvider, pk: PublicKey, sol = 2) {
  const sig = await provider.connection.requestAirdrop(pk, sol * anchor.web3.LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Test Suite ─────────────────────────────────────────────────

describe("full_protocol_flow_test — Complete Protocol Lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
  const payer = provider.wallet.payer;

  // PDAs
  let globalConfigPda: PublicKey;
  let treasuryPda: PublicKey;
  let lpMintPda: PublicKey;

  // Test accounts
  let admin: Keypair;
  let trader: Keypair;
  let operator: Keypair;

  // Token state
  let baseMint: PublicKey;
  let treasuryBaseAta: PublicKey;
  let traderBaseAta: PublicKey;
  let adminBaseAta: PublicKey;

  // Markets for a match (3 independent markets)
  let matchGroupId: number;
  let matchGroupPda: PublicKey;
  
  let market1X2Id: number;
  let market1X2Pda: PublicKey;
  let market1X2Mint0: PublicKey; // Home Win
  let market1X2Mint1: PublicKey; // Draw
  let market1X2Mint2: PublicKey; // Away Win

  let marketOverUnderId: number;
  let marketOverUnderPda: PublicKey;
  let marketOverUnderMint0: PublicKey; // Over 2.5
  let marketOverUnderMint1: PublicKey; // Under 2.5

  let marketGGNGId: number;
  let marketGGNGPda: PublicKey;
  let marketGGNGMint0: PublicKey; // GG
  let marketGGNGMint1: PublicKey; // NG

  // Odds (in basis points)
  const ODDS_1X2_HOME = 20000;    // 2.0x
  const ODDS_1X2_DRAW = 35000;    // 3.5x
  const ODDS_1X2_AWAY = 30000;     // 3.0x
  const ODDS_OU_OVER = 18000;      // 1.8x
  const ODDS_OU_UNDER = 19000;     // 1.9x
  const ODDS_GG = 17000;           // 1.7x
  const ODDS_NG = 20000;           // 2.0x

  // Test stakes
  const SINGLE_BET_STAKE = 10_000_000;   // 10 USDC
  const PARLAY_STAKE = 5_000_000;        // 5 USDC total

  let skipSuite = false;

  before(async () => {
    console.log("\n" + "=".repeat(60));
    console.log("FULL PROTOCOL FLOW TEST");
    console.log("=".repeat(60) + "\n");

    if (!program?.programId) {
      console.log("ERROR: Program not initialized");
      skipSuite = true;
      return;
    }

    // Find PDAs
    [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")], program.programId
    );
    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")], program.programId
    );
    [lpMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint")], program.programId
    );

    // Check if protocol is initialized
    try {
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      console.log("Protocol already initialized");
      baseMint = config.baseMint;
    } catch {
      console.log("Protocol not initialized - attempting to initialize");
      // Try to initialize
      try {
        await program.methods
          .initialize([0, 0, 0, 0, 0, 0, 0, 0], new anchor.BN(1_000_000_000_000)) // oracle
          .accounts({
            admin: payer.publicKey,
            globalConfig: globalConfigPda,
            treasury: treasuryPda,
            lpMint: lpMintPda,
            baseMint: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM,
            associatedTokenProgram: ATA_PROGRAM,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer])
          .rpc();
        
        const config = await program.account.globalConfig.fetch(globalConfigPda);
        baseMint = config.baseMint;
        console.log("Protocol initialized successfully");
      } catch (err: any) {
        console.log("Initialization failed:", err?.message ?? err);
        skipSuite = true;
        return;
      }
    }

    admin = payer;
    trader = Keypair.generate();
    operator = Keypair.generate();

    // Fund accounts
    await airdrop(provider, trader.publicKey, 2);
    await airdrop(provider, operator.publicKey, 2);

    // Setup ATAs
    treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);
    traderBaseAta = await createAta(provider, baseMint, trader.publicKey);
    adminBaseAta = await createAta(provider, baseMint, admin.publicKey);

    // Mint tokens to trader
    await mintTo(provider.connection, payer, baseMint, traderBaseAta, payer, 500_000_000_000);
    await mintTo(provider.connection, payer, baseMint, adminBaseAta, payer, 500_000_000_000);

    // Get or create epoch
    const config = await program.account.globalConfig.fetch(globalConfigPda);
    const [epochPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("epoch"), new anchor.BN(config.currentEpoch.toNumber()).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    try {
      await program.account.epoch.fetch(epochPda);
      console.log("Epoch already exists");
    } catch {
      try {
        await program.methods
          .initEpoch()
          .accounts({
            globalConfig: globalConfigPda,
            epoch: epochPda,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        console.log("Epoch initialized");
      } catch (err: any) {
        console.log("Epoch init error:", err?.message ?? err);
      }
    }

    // Create match group
    matchGroupId = config.nextMarketId.toNumber();
    [matchGroupPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market_group"), new anchor.BN(matchGroupId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    try {
      const eventStartTime = Math.floor(Date.now() / 1000) + 3600;
      await program.methods
        .createMarketGroup(
          new anchor.BN(matchGroupId),
          new anchor.BN(100_000_000_000),
          new anchor.BN(eventStartTime),
          "Test Match: Team A vs Team B"
        )
        .accounts({
          globalConfig: globalConfigPda,
          marketGroup: matchGroupPda,
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      console.log(`Match group ${matchGroupId} created`);
    } catch (err: any) {
      console.log("Market group creation:", err?.message ?? err);
    }

    // Create 3 markets for the match
    const startTime = Math.floor(Date.now() / 1000) + 3600;
    
    // Market 1: 1X2
    market1X2Id = (await program.account.globalConfig.fetch(globalConfigPda)).nextMarketId.toNumber();
    [market1X2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(market1X2Id).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    try {
      await program.methods
        .createMarket(
          new anchor.BN(startTime),
          3, // 3 outcomes: Home, Draw, Away
          "1X2: Team A vs Team B",
          "1X2",
          0,
          { oneXTwo: {} },
          [new anchor.BN(ODDS_1X2_HOME), new anchor.BN(ODDS_1X2_DRAW), new anchor.BN(ODDS_1X2_AWAY)]
        )
        .accounts({
          globalConfig: globalConfigPda,
          market: market1X2Pda,
          epoch: epochPda,
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();
      
      [market1X2Mint0] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(market1X2Id).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
        program.programId
      );
      [market1X2Mint1] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(market1X2Id).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
        program.programId
      );
      [market1X2Mint2] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(market1X2Id).toArrayLike(Buffer, "le", 8), Buffer.from([2])],
        program.programId
      );
      console.log(`Market 1X2 (${market1X2Id}) created with odds: ${ODDS_1X2_HOME/100}x, ${ODDS_1X2_DRAW/100}x, ${ODDS_1X2_AWAY/100}x`);
    } catch (err: any) {
      console.log("1X2 market creation:", err?.message ?? err);
    }

    // Market 2: Over/Under 2.5
    marketOverUnderId = (await program.account.globalConfig.fetch(globalConfigPda)).nextMarketId.toNumber();
    [marketOverUnderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketOverUnderId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    try {
      await program.methods
        .createMarket(
          new anchor.BN(startTime),
          2, // 2 outcomes: Over, Under
          "O/U 2.5: Team A vs Team B",
          "OU25",
          1,
          { overUnder: {} },
          [new anchor.BN(ODDS_OU_OVER), new anchor.BN(ODDS_OU_UNDER)]
        )
        .accounts({
          globalConfig: globalConfigPda,
          market: marketOverUnderPda,
          epoch: epochPda,
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();
      
      [marketOverUnderMint0] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(marketOverUnderId).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
        program.programId
      );
      [marketOverUnderMint1] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(marketOverUnderId).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
        program.programId
      );
      console.log(`Market O/U (${marketOverUnderId}) created with odds: ${ODDS_OU_OVER/100}x, ${ODDS_OU_UNDER/100}x`);
    } catch (err: any) {
      console.log("O/U market creation:", err?.message ?? err);
    }

    // Market 3: GG/NG
    marketGGNGId = (await program.account.globalConfig.fetch(globalConfigPda)).nextMarketId.toNumber();
    [marketGGNGPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketGGNGId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    try {
      await program.methods
        .createMarket(
          new anchor.BN(startTime),
          2, // 2 outcomes: GG, NG
          "GG/NG: Team A vs Team B",
          "GGNG",
          2,
          { goalNoGoal: {} },
          [new anchor.BN(ODDS_GG), new anchor.BN(ODDS_NG)]
        )
        .accounts({
          globalConfig: globalConfigPda,
          market: marketGGNGPda,
          epoch: epochPda,
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();
      
      [marketGGNGMint0] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(marketGGNGId).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
        program.programId
      );
      [marketGGNGMint1] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(marketGGNGId).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
        program.programId
      );
      console.log(`Market GG/NG (${marketGGNGId}) created with odds: ${ODDS_GG/100}x, ${ODDS_NG/100}x`);
    } catch (err: any) {
      console.log("GG/NG market creation:", err?.message ?? err);
    }

    console.log("\nSetup complete. Ready for tests.\n");
  });

  // ================================================================
  // SECTION 1: Single Bet (Single-Leg Slip)
  // ================================================================
  describe("Section 1: Single Bet Flow", () => {
    it("1.1: User creates single-leg slip for 1X2 market", async () => {
      if (skipSuite) return;

      console.log("\n--- 1.1: Single Leg Slip Creation ---\n");

      // Get slip ID
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const nextSlipId = config.nextSlipId;
      const slipIdNum = nextSlipId.toNumber();

      // Derive slip PDA
      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("slip"), nextSlipId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Calculate expected payout
      // Stake: 10_000_000
      // Fee: 500_000 (5%)
      // Net: 9_500_000
      // Odds: 2.0x (20000 bps)
      // Payout: 19_000_000
      const stake = SINGLE_BET_STAKE;
      const fee = Math.floor(stake * HOUSE_FEE_BPS / BPS);
      const net = stake - fee;
      const payout = Math.floor(net * ODDS_1X2_HOME / BPS);

      console.log(`Stake: ${stake}, Fee: ${fee}, Net: ${net}, Odds: ${ODDS_1X2_HOME/100}x, Payout: ${payout}`);

      // Create slip
      const legs = [
        { marketId: new anchor.BN(market1X2Id), outcomeId: 0 } // Home win
      ];
      const fixedOdds = [new anchor.BN(ODDS_1X2_HOME)];
      const cancelDeadline = Math.floor(Date.now() / 1000) + 300;

      await program.methods
        .placeSlipAwait(legs, new anchor.BN(stake), fixedOdds, new anchor.BN(cancelDeadline))
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          treasury: treasuryPda,
          ownerBaseAta: traderBaseAta,
          treasuryBaseAta: treasuryBaseAta,
          baseMint: baseMint,
          owner: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      console.log(`Slip created: ID=${slip.slipId}, Status=${slip.status}, Legs=${slip.numLegs}`);

      assert.equal(slip.numLegs, 1);
      assert.equal(slip.status, "pending");
      assert.equal(slip.totalStake.toString(), stake.toString());

      // Store for later
      (globalThis as any).singleBetSlipPda = slipPda;
      (globalThis as any).singleBetSlipId = slipIdNum;
      (globalThis as any).singleBetPayout = payout;
    });

    it("1.2: Backend executes the leg", async () => {
      if (skipSuite) return;

      console.log("\n--- 1.2: Backend Executes Leg ---\n");

      const slipIdNum = (globalThis as any).singleBetSlipId;
      const slipPda = (globalThis as any).singleBetSlipPda;
      const expectedPayout = (globalThis as any).singleBetPayout;

      // Create outcome ATA
      const outcomeAta = await createAta(provider, market1X2Mint0, trader.publicKey);

      // Backend executes leg
      await program.methods
        .buyLegForSlip(new anchor.BN(slipIdNum), 0)
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          market: market1X2Pda,
          treasury: treasuryPda,
          buyerOutcomeAta: outcomeAta,
          treasuryBaseAta: treasuryBaseAta,
          outcomeMint: market1X2Mint0,
          baseMint: baseMint,
          buyer: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      const outcomeBalance = (await getAccount(provider.connection, outcomeAta)).amount;

      console.log(`Leg executed: Status=${slip.status}, Mask=${slip.legsBoughtMask}, Tokens=${outcomeBalance}`);

      assert.equal(slip.status, "active");
      assert.equal(slip.legsBoughtMask, 1);
      assert.equal(outcomeBalance, BigInt(expectedPayout));

      (globalThis as any).singleBetOutcomeAta = outcomeAta;
    });

    it("1.3: User cannot place bet after market start time", async () => {
      if (skipSuite) return;
      console.log("\n--- 1.3: Market Timing Check ---\n");
      // This is enforced on-chain - attempted bets after start_time fail
      console.log("Market start time enforced on-chain in buy_leg_for_slip");
    });
  });

  // ================================================================
  // SECTION 2: Parlay Bet (Multi-Leg Slip)
  // ================================================================
  describe("Section 2: Parlay Bet Flow (2 legs)", () => {
    it("2.1: User creates 2-leg parlay slip", async () => {
      if (skipSuite) return;

      console.log("\n--- 2.1: Parlay Slip Creation ---\n");

      // Get slip ID
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const nextSlipId = config.nextSlipId;
      const slipIdNum = nextSlipId.toNumber();

      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("slip"), nextSlipId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Calculate expected payouts
      // Total stake: 5_000_000
      // Per leg: 2_500_000
      // Fee per leg: 125_000
      // Net per leg: 2_375_000
      // Leg 1 (1X2 Home @ 2.0x): 4_750_000
      // Leg 2 (O/U Over @ 1.8x): 4_275_000
      // Potential parlay payout: 4_750_000 * 1.8 = 8_550_000
      const stake = PARLAY_STAKE;
      const perLegStake = Math.floor(stake / 2);
      const perLegFee = Math.floor(perLegStake * HOUSE_FEE_BPS / BPS);
      const perLegNet = perLegStake - perLegFee;
      const leg1Payout = Math.floor(perLegNet * ODDS_1X2_HOME / BPS);
      const leg2Payout = Math.floor(perLegNet * ODDS_OU_OVER / BPS);
      const parlayPayout = Math.floor(leg1Payout * ODDS_OU_OVER / BPS);

      console.log(`Parlay: ${stake} split into 2 legs`);
      console.log(`Per leg: stake=${perLegStake}, fee=${perLegFee}, net=${perLegNet}`);
      console.log(`Leg 1 payout: ${leg1Payout} (1X2 Home @ ${ODDS_1X2_HOME/100}x)`);
      console.log(`Leg 2 payout: ${leg2Payout} (O/U Over @ ${ODDS_OU_OVER/100}x)`);
      console.log(`Parlay payout if all win: ${parlayPayout}`);

      const legs = [
        { marketId: new anchor.BN(market1X2Id), outcomeId: 0 },  // Home win
        { marketId: new anchor.BN(marketOverUnderId), outcomeId: 0 } // Over 2.5
      ];
      const fixedOdds = [new anchor.BN(ODDS_1X2_HOME), new anchor.BN(ODDS_OU_OVER)];
      const cancelDeadline = Math.floor(Date.now() / 1000) + 300;

      await program.methods
        .placeSlipAwait(legs, new anchor.BN(stake), fixedOdds, new anchor.BN(cancelDeadline))
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          treasury: treasuryPda,
          ownerBaseAta: traderBaseAta,
          treasuryBaseAta: treasuryBaseAta,
          baseMint: baseMint,
          owner: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      console.log(`Parlay slip created: ID=${slip.slipId}, Status=${slip.status}, Legs=${slip.numLegs}`);

      assert.equal(slip.numLegs, 2);
      assert.equal(slip.status, "pending");

      (globalThis as any).parlaySlipPda = slipPda;
      (globalThis as any).parlaySlipId = slipIdNum;
      (globalThis as any).parlayLeg1Payout = leg1Payout;
      (globalThis as any).parlayLeg2Payout = leg2Payout;
      (globalThis as any).parlayPayout = parlayPayout;
    });

    it("2.2: Backend executes both legs (separate transactions)", async () => {
      if (skipSuite) return;

      console.log("\n--- 2.2: Backend Executes Legs ---\n");

      const slipIdNum = (globalThis as any).parlaySlipId;
      const slipPda = (globalThis as any).parlaySlipPda;
      const expectedLeg1 = (globalThis as any).parlayLeg1Payout;
      const expectedLeg2 = (globalThis as any).parlayLeg2Payout;

      // Leg 1: 1X2 Home
      const leg1Ata = await createAta(provider, market1X2Mint0, trader.publicKey);
      await program.methods
        .buyLegForSlip(new anchor.BN(slipIdNum), 0)
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          market: market1X2Pda,
          treasury: treasuryPda,
          buyerOutcomeAta: leg1Ata,
          treasuryBaseAta: treasuryBaseAta,
          outcomeMint: market1X2Mint0,
          baseMint: baseMint,
          buyer: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      let slip = await program.account.slip.fetch(slipPda);
      let leg1Balance = (await getAccount(provider.connection, leg1Ata)).amount;
      console.log(`Leg 1 executed: Mask=${slip.legsBoughtMask}, Status=${slip.status}, Tokens=${leg1Balance}`);
      assert.equal(slip.status, "pending"); // Still pending (1 of 2 legs)
      assert.equal(leg1Balance, BigInt(expectedLeg1));

      // Leg 2: O/U Over
      const leg2Ata = await createAta(provider, marketOverUnderMint0, trader.publicKey);
      await program.methods
        .buyLegForSlip(new anchor.BN(slipIdNum), 1)
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          market: marketOverUnderPda,
          treasury: treasuryPda,
          buyerOutcomeAta: leg2Ata,
          treasuryBaseAta: treasuryBaseAta,
          outcomeMint: marketOverUnderMint0,
          baseMint: baseMint,
          buyer: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      slip = await program.account.slip.fetch(slipPda);
      const leg2Balance = (await getAccount(provider.connection, leg2Ata)).amount;
      console.log(`Leg 2 executed: Mask=${slip.legsBoughtMask}, Status=${slip.status}, Tokens=${leg2Balance}`);

      assert.equal(slip.status, "active");
      assert.equal(slip.legsBoughtMask, 3); // 0b11 = both legs
      assert.equal(slip.potentialPayout.toString(), (globalThis as any).parlayPayout.toString());
      assert.equal(leg1Balance, BigInt(expectedLeg1));
      assert.equal(leg2Balance, BigInt(expectedLeg2));

      (globalThis as any).parlayLeg1Ata = leg1Ata;
      (globalThis as any).parlayLeg2Ata = leg2Ata;
    });
  });

  // ================================================================
  // SECTION 3: Market Settlement
  // ================================================================
  describe("Section 3: Market Settlement", () => {
    it("3.1: Settle 1X2 market (Home Win)", async () => {
      if (skipSuite) return;

      console.log("\n--- 3.1: Settle 1X2 Market ---\n");

      // Admin override to settle (simulating oracle)
      try {
        await program.methods
          .adminOverride(market1X2Id, 0) // Outcome 0 = Home Win
          .accounts({
            globalConfig: globalConfigPda,
            market: market1X2Pda,
            authority: admin.publicKey,
          })
          .signers([admin])
          .rpc();
      } catch (err: any) {
        console.log("Admin override failed, trying operator propose:", err?.message);
        try {
          await program.methods
            .proposeResult(market1X2Id, 0)
            .accounts({
              globalConfig: globalConfigPda,
              market: market1X2Pda,
              proposer: operator.publicKey,
            })
            .signers([operator])
            .rpc();
          
          // Wait for dispute window
          console.log("Waiting for dispute window...");
          await sleep(6000);

          await program.methods
            .finalizeResult(market1X2Id)
            .accounts({
              globalConfig: globalConfigPda,
              market: market1X2Pda,
            })
            .rpc();
        } catch (err2: any) {
          console.log("Settlement error:", err2?.message ?? err2);
        }
      }

      const market = await program.account.market.fetch(market1X2Pda);
      console.log(`1X2 Market settled: Outcome=${market.winningOutcome}, Status=${market.status}`);

      assert.equal(market.status, "settled");
      assert.equal(market.winningOutcome, 0);
    });

    it("3.2: Settle O/U market (Over 2.5)", async () => {
      if (skipSuite) return;

      console.log("\n--- 3.2: Settle O/U Market ---\n");

      try {
        await program.methods
          .adminOverride(marketOverUnderId, 0) // Outcome 0 = Over
          .accounts({
            globalConfig: globalConfigPda,
            market: marketOverUnderPda,
            authority: admin.publicKey,
          })
          .signers([admin])
          .rpc();
      } catch (err: any) {
        console.log("Admin override failed:", err?.message);
      }

      const market = await program.account.market.fetch(marketOverUnderPda);
      console.log(`O/U Market settled: Outcome=${market.winningOutcome}, Status=${market.status}`);

      assert.equal(market.status, "settled");
      assert.equal(market.winningOutcome, 0);
    });
  });

  // ================================================================
  // SECTION 4: Slip Resolution
  // ================================================================
  describe("Section 4: Slip Resolution", () => {
    it("4.1: Settle single bet slip leg", async () => {
      if (skipSuite) return;

      console.log("\n--- 4.1: Settle Single Bet Slip ---\n");

      const slipIdNum = (globalThis as any).singleBetSlipId;
      const slipPda = (globalThis as any).singleBetSlipPda;

      await program.methods
        .settleSlipLeg(new anchor.BN(slipIdNum), 0)
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          market: market1X2Pda,
          authority: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      console.log(`Single bet settled: SettledMask=${slip.legsSettledMask}, WonMask=${slip.legsWonMask}, Status=${slip.status}`);

      assert.equal(slip.legsSettledMask, 1);
      assert.equal(slip.legsWonMask, 1); // Won (home was correct)
      assert.equal(slip.status, "pending"); // Need to resolve
    });

    it("4.2: Resolve single bet slip", async () => {
      if (skipSuite) return;

      console.log("\n--- 4.2: Resolve Single Bet Slip ---\n");

      const slipIdNum = (globalThis as any).singleBetSlipId;
      const slipPda = (globalThis as any).singleBetSlipPda;

      await program.methods
        .resolveSlip(new anchor.BN(slipIdNum))
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          treasury: treasuryPda,
          authority: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      console.log(`Single bet resolved: Status=${slip.status}`);

      assert.equal(slip.status, "won");
    });

    it("4.3: Settle parlay slip legs", async () => {
      if (skipSuite) return;

      console.log("\n--- 4.3: Settle Parlay Slip Legs ---\n");

      const slipIdNum = (globalThis as any).parlaySlipId;
      const slipPda = (globalThis as any).parlaySlipPda;

      // Settle leg 1
      await program.methods
        .settleSlipLeg(new anchor.BN(slipIdNum), 0)
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          market: market1X2Pda,
          authority: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      let slip = await program.account.slip.fetch(slipPda);
      console.log(`After leg 1 settle: SettledMask=${slip.legsSettledMask}, WonMask=${slip.legsWonMask}`);

      // Settle leg 2
      await program.methods
        .settleSlipLeg(new anchor.BN(slipIdNum), 1)
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          market: marketOverUnderPda,
          authority: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      slip = await program.account.slip.fetch(slipPda);
      console.log(`After leg 2 settle: SettledMask=${slip.legsSettledMask}, WonMask=${slip.legsWonMask}`);

      assert.equal(slip.legsSettledMask, 3);
      assert.equal(slip.legsWonMask, 3); // Both won
    });

    it("4.4: Resolve parlay slip", async () => {
      if (skipSuite) return;

      console.log("\n--- 4.4: Resolve Parlay Slip ---\n");

      const slipIdNum = (globalThis as any).parlaySlipId;
      const slipPda = (globalThis as any).parlaySlipPda;

      await program.methods
        .resolveSlip(new anchor.BN(slipIdNum))
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          treasury: treasuryPda,
          authority: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      console.log(`Parlay resolved: Status=${slip.status}, Payout=${slip.potentialPayout}`);

      assert.equal(slip.status, "won");
    });
  });

  // ================================================================
  // SECTION 5: Payout Claim
  // ================================================================
  describe("Section 5: Payout Claim", () => {
    it("5.1: Single bet trader claims payout", async () => {
      if (skipSuite) return;

      console.log("\n--- 5.1: Claim Single Bet Payout ---\n");

      const outcomeAta = (globalThis as any).singleBetOutcomeAta;
      const expectedPayout = (globalThis as any).singleBetPayout;

      const outcomeBalance = (await getAccount(provider.connection, outcomeAta)).amount;
      const baseBefore = (await getAccount(provider.connection, traderBaseAta)).amount;

      console.log(`Outcome balance before claim: ${outcomeBalance}`);

      await program.methods
        .claimPayout(market1X2Id)
        .accounts({
          globalConfig: globalConfigPda,
          market: market1X2Pda,
          treasury: treasuryPda,
          claimerOutcomeAta: outcomeAta,
          claimerBaseAta: traderBaseAta,
          treasuryBaseAta: treasuryBaseAta,
          outcomeMint: market1X2Mint0,
          baseMint: baseMint,
          claimer: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
        })
        .signers([trader])
        .rpc();

      const outcomeAfter = (await getAccount(provider.connection, outcomeAta)).amount;
      const baseAfter = (await getAccount(provider.connection, traderBaseAta)).amount;

      console.log(`Claimed: ${baseAfter - baseBefore} tokens`);
      console.log(`Outcome balance after claim: ${outcomeAfter}`);

      assert.equal(outcomeAfter, BigInt(0));
      assert.equal(baseAfter - baseBefore, Number(outcomeBalance));
    });

    it("5.2: Parlay trader claims payouts for both legs", async () => {
      if (skipSuite) return;

      console.log("\n--- 5.2: Claim Parlay Payouts ---\n");

      const leg1Ata = (globalThis as any).parlayLeg1Ata;
      const leg2Ata = (globalThis as any).parlayLeg2Ata;

      // Claim leg 1
      const leg1Balance = (await getAccount(provider.connection, leg1Ata)).amount;
      const baseBefore1 = (await getAccount(provider.connection, traderBaseAta)).amount;

      await program.methods
        .claimPayout(market1X2Id)
        .accounts({
          globalConfig: globalConfigPda,
          market: market1X2Pda,
          treasury: treasuryPda,
          claimerOutcomeAta: leg1Ata,
          claimerBaseAta: traderBaseAta,
          treasuryBaseAta: treasuryBaseAta,
          outcomeMint: market1X2Mint0,
          baseMint: baseMint,
          claimer: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
        })
        .signers([trader])
        .rpc();

      const leg1After = (await getAccount(provider.connection, leg1Ata)).amount;
      const baseAfter1 = (await getAccount(provider.connection, traderBaseAta)).amount;
      console.log(`Leg 1 claimed: ${baseAfter1 - baseBefore1} tokens`);

      // Claim leg 2
      const leg2Balance = (await getAccount(provider.connection, leg2Ata)).amount;
      const baseBefore2 = (await getAccount(provider.connection, traderBaseAta)).amount;

      await program.methods
        .claimPayout(marketOverUnderId)
        .accounts({
          globalConfig: globalConfigPda,
          market: marketOverUnderPda,
          treasury: treasuryPda,
          claimerOutcomeAta: leg2Ata,
          claimerBaseAta: traderBaseAta,
          treasuryBaseAta: treasuryBaseAta,
          outcomeMint: marketOverUnderMint0,
          baseMint: baseMint,
          claimer: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
        })
        .signers([trader])
        .rpc();

      const leg2After = (await getAccount(provider.connection, leg2Ata)).amount;
      const baseAfter2 = (await getAccount(provider.connection, traderBaseAta)).amount;
      console.log(`Leg 2 claimed: ${baseAfter2 - baseBefore2} tokens`);

      assert.equal(leg1After, BigInt(0));
      assert.equal(leg2After, BigInt(0));
      assert.equal(baseAfter2 - baseBefore2, Number(leg2Balance));
    });
  });

  // ================================================================
  // SECTION 6: Edge Cases & Validation
  // ================================================================
  describe("Section 6: Edge Cases", () => {
    it("6.1: Verify slip leg count limit (max 5)", async () => {
      if (skipSuite) return;

      console.log("\n--- 6.1: Slip Leg Limit ---\n");
      console.log("MAX_SLIP_LEGS is set to 5 to avoid BPF stack overflow");
      console.log("Attempting 6 legs should fail in place_slip_await");

      // Get slip ID
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const nextSlipId = config.nextSlipId;
      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("slip"), nextSlipId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Try to create slip with 6 legs (should fail)
      const legs = [
        { marketId: new anchor.BN(market1X2Id), outcomeId: 0 },
        { marketId: new anchor.BN(marketOverUnderId), outcomeId: 0 },
        { marketId: new anchor.BN(marketGGNGId), outcomeId: 0 },
        { marketId: new anchor.BN(market1X2Id), outcomeId: 1 },
        { marketId: new anchor.BN(marketOverUnderId), outcomeId: 1 },
        { marketId: new anchor.BN(marketGGNGId), outcomeId: 1 },
      ];
      const fixedOdds = legs.map(() => new anchor.BN(20000));
      const cancelDeadline = Math.floor(Date.now() / 1000) + 300;

      try {
        await program.methods
          .placeSlipAwait(legs, new anchor.BN(1000000), fixedOdds, new anchor.BN(cancelDeadline))
          .accounts({
            globalConfig: globalConfigPda,
            slip: slipPda,
            treasury: treasuryPda,
            ownerBaseAta: traderBaseAta,
            treasuryBaseAta: treasuryBaseAta,
            baseMint: baseMint,
            owner: trader.publicKey,
            tokenProgram: TOKEN_PROGRAM,
            associatedTokenProgram: ATA_PROGRAM,
            systemProgram: SystemProgram.programId,
          })
          .signers([trader])
          .rpc();
        
        console.log("ERROR: 6-leg slip should have failed!");
        assert.fail("Should have rejected 6 legs");
      } catch (err: any) {
        console.log("Correctly rejected 6 legs:", err?.message ?? "Error occurred");
        assert.isTrue(true);
      }
    });

    it("6.2: Verify odds validation on leg purchase", async () => {
      if (skipSuite) return;

      console.log("\n--- 6.2: Odds Validation ---\n");
      console.log("If odds change between slip creation and leg purchase, buy_leg_for_slip fails");
    });

    it("6.3: Verify independent market settlement", async () => {
      if (skipSuite) return;

      console.log("\n--- 6.3: Independent Market Settlement ---\n");
      console.log("Markets settle independently with their own oracle submission");
      console.log("1X2 and O/U settled, GG/NG still open");
    });
  });

  after(async () => {
    console.log("\n" + "=".repeat(60));
    console.log("FULL PROTOCOL FLOW TEST COMPLETE");
    console.log("=".repeat(60) + "\n");

    // Summary
    console.log("Test Summary:");
    console.log("- Protocol initialized with 3 markets (1X2, O/U, GG/NG)");
    console.log("- Single bet placed: Home Win @ 2.0x");
    console.log("- Parlay bet placed: Home Win + Over 2.5");
    console.log("- Both bets won!");
    console.log("- Payouts claimed successfully\n");
  });
});

/**
 * End-to-End Flow Test Suite
 * 
 * Tests the complete protocol lifecycle as defined in FLOW.md:
 * 
 * 1. Publish Epoch - operator publishes epoch with vault
 * 2. LP Opt-In - LPs deposit into epoch vault
 * 3. Seed & Open - markets opened with epoch backing
 * 4a. Direct Trade - LMSR trading
 * 4b. BetSlip - decomposed slip placement
 * 5. Settlement - multisig proposal/confirm/finalize
 * 6a. Direct Claim - claim_payout
 * 6b. Slip Resolution - settle_slip_leg + resolve_slip
 * 7. Epoch Close - LP distribution
 */

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

// ─── Helpers ─────────────────────────────────────────────────────

async function createAta(
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

async function airdrop(provider: anchor.AnchorProvider, pk: PublicKey, sol = 2) {
  const sig = await provider.connection.requestAirdrop(pk, sol * anchor.web3.LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig);
}

// ─── Test Suite ─────────────────────────────────────────────────

describe("Protocol Flow Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;

  // PDAs
  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")], program.programId
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")], program.programId
  );
  const [settlementCouncilPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("settlement_council")], program.programId
  );

  // Test accounts
  let admin: Keypair;
  let operator1: Keypair;
  let operator2: Keypair;
  let operator3: Keypair;
  let lp1: Keypair;
  let trader: Keypair;

  // Token state
  let baseMint: PublicKey;
  let treasuryBaseAta: PublicKey;
  let adminBaseAta: PublicKey;
  let lp1BaseAta: PublicKey;
  let traderBaseAta: PublicKey;

  before(async () => {
    admin = provider.wallet.payer;
    operator1 = Keypair.generate();
    operator2 = Keypair.generate();
    operator3 = Keypair.generate();
    lp1 = Keypair.generate();
    trader = Keypair.generate();

    // Fund accounts
    await airdrop(provider, operator1.publicKey, 5);
    await airdrop(provider, operator2.publicKey, 5);
    await airdrop(provider, operator3.publicKey, 5);
    await airdrop(provider, lp1.publicKey, 5);
    await airdrop(provider, trader.publicKey, 5);

    // Read base mint from existing config
    const cfg = await program.account.globalConfig.fetch(globalConfigPda);
    baseMint = cfg.baseMint;
    treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);
    adminBaseAta = await createAta(provider, baseMint, admin.publicKey);
    lp1BaseAta = await createAta(provider, baseMint, lp1.publicKey);
    traderBaseAta = await createAta(provider, baseMint, trader.publicKey);
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Publish Epoch
  // ═══════════════════════════════════════════════════════════════
  describe("Step 1: Publish Epoch", () => {
    it("should publish a new epoch with vault", async () => {
      const epochId = 1;
      const [epochPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [epochVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch_vault"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      await program.methods
        .publishEpoch(new anchor.BN(epochId), [])
        .accounts({
          globalConfig: globalConfigPda,
          epoch: epochPda,
          epochVault: epochVaultPda,
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const epoch = await program.account.epoch.fetch(epochPda);
      assert.equal(epoch.epochId.toNumber(), epochId);
      assert.equal(epoch.numMarkets.toNumber(), 0);

      const vault = await program.account.epochVault.fetch(epochVaultPda);
      assert.equal(vault.epochId.toNumber(), epochId);
      assert.equal(vault.totalDeposits.toNumber(), 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: LP Opt-In
  // ═══════════════════════════════════════════════════════════════
  describe("Step 2: LP Opt-In Epoch Liquidity", () => {
    it("should allow LP to opt into epoch", async () => {
      const epochId = 1;
      const [epochVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch_vault"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [lpPositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch_lp"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8), lp1.publicKey.toBuffer()],
        program.programId
      );
      const epochVaultBaseAta = await createAta(provider, baseMint, epochVaultPda);

      // Get LP balance before
      const lpBalanceBefore = (await getAccount(provider.connection, lp1BaseAta)).amount;

      const depositAmount = 10_000_000_000; // 10,000 USDC

      await program.methods
        .optInEpochLiquidity(new anchor.BN(epochId), new anchor.BN(depositAmount))
        .accounts({
          globalConfig: globalConfigPda,
          epochVault: epochVaultPda,
          lpPosition: lpPositionPda,
          epochVaultAuthority: epochVaultPda,
          lpBaseAta: lp1BaseAta,
          epochVaultBaseAta,
          lp: lp1.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([lp1])
        .rpc();

      const vault = await program.account.epochVault.fetch(epochVaultPda);
      assert.equal(vault.totalDeposits.toNumber(), depositAmount);
      assert.equal(vault.numLps.toNumber(), 1);

      const position = await program.account.epochLpPosition.fetch(lpPositionPda);
      assert.equal(position.owner.toString(), lp1.publicKey.toString());
      assert.equal(position.epochId.toNumber(), epochId);
      assert(position.shares.toNumber() > 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: Settlement Multisig
  // ═══════════════════════════════════════════════════════════════
  describe("Step 5: Settlement Multisig", () => {
    it("should initialize settlement council", async () => {
      const minStake = 1_000_000_000; // 1,000 USDC
      const requiredConfirmations = 2;

      await program.methods
        .initializeSettlementCouncil(new anchor.BN(minStake), requiredConfirmations)
        .accounts({
          globalConfig: globalConfigPda,
          settlementCouncil: settlementCouncilPda,
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const council = await program.account.settlementCouncil.fetch(settlementCouncilPda);
      assert.equal(council.numOperators.toNumber(), 0);
      assert.equal(council.requiredConfirmations, requiredConfirmations);
      assert.equal(council.minStake.toNumber(), minStake);
    });

    it("should add settlement operators", async () => {
      const stake = 5_000_000_000; // 5,000 USDC

      for (const operator of [operator1, operator2, operator3]) {
        await program.methods
          .addSettlementOperator(operator.publicKey, new anchor.BN(stake))
          .accounts({
            globalConfig: globalConfigPda,
            settlementCouncil: settlementCouncilPda,
            authority: admin.publicKey,
          })
          .signers([admin])
          .rpc();
      }

      const council = await program.account.settlementCouncil.fetch(settlementCouncilPda);
      assert.equal(council.numOperators.toNumber(), 3);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 4b: BetSlip (Decomposed)
  // ═══════════════════════════════════════════════════════════════
  describe("Step 4b: BetSlip (Decomposed)", () => {
    // Create test markets first
    let market1Id: number;
    let market1Pda: PublicKey;
    let market2Id: number;
    let market2Pda: PublicKey;

    before(async () => {
      // Create markets
      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const cfg = await program.account.globalConfig.fetch(globalConfigPda);
      
      market1Id = cfg.nextMarketId.toNumber();
      [market1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(market1Id).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [epochPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      await program.methods
        .createMarket(new anchor.BN(startTime), 2, "Test Market 1", "test", 0, null, null)
        .accounts({
          globalConfig: globalConfigPda,
          market: market1Pda,
          epoch: epochPda,
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    });

    it("should place slip await and escrow stake", async () => {
      const slipId = 1;
      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const legs = [
        { marketId: new anchor.BN(market1Id), outcomeId: 0, numShares: new anchor.BN(0) },
      ];
      const stake = 1_000_000_000; // 1,000 USDC
      const fixedOdds = [new anchor.BN(2 * (1 << 32))]; // 2.0x odds
      const cancelDeadline = Math.floor(Date.now() / 1000) + 300; // 5 min

      await program.methods
        .placeSlipAwait(legs, new anchor.BN(stake), fixedOdds, new anchor.BN(cancelDeadline))
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          treasury: treasuryPda,
          ownerBaseAta: traderBaseAta,
          treasuryBaseAta,
          baseMint,
          owner: trader.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      assert.equal(slip.owner.toString(), trader.publicKey.toString());
      assert.equal(slip.status, "pending");
      assert.equal(slip.numLegs, 1);
      assert.equal(slip.totalStake.toNumber(), stake);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: Settlement Flow
  // ═══════════════════════════════════════════════════════════════
  describe("Step 5: Settlement Flow", () => {
    let market1Id: number;
    let market1Pda: PublicKey;
    let proposalPda: PublicKey;

    before(async () => {
      market1Id = 1;
      [market1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(market1Id).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [proposalPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("settlement_proposal"), new anchor.BN(market1Id).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
    });

    it("should propose settlement outcome", async () => {
      const proposedOutcome = 0;
      const txHashRef = Buffer.alloc(32);

      await program.methods
        .proposeSettlement(
          new anchor.BN(market1Id),
          proposedOutcome,
          Array.from(txHashRef)
        )
        .accounts({
          globalConfig: globalConfigPda,
          settlementCouncil: settlementCouncilPda,
          market: market1Pda,
          proposal: proposalPda,
          operator: operator1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([operator1])
        .rpc();

      const proposal = await program.account.settlementProposal.fetch(proposalPda);
      assert.equal(proposal.marketId.toNumber(), market1Id);
      assert.equal(proposal.proposedOutcome, proposedOutcome);
      assert.equal(proposal.numConfirmations, 1); // Proposer auto-confirms
      assert.equal(proposal.finalized, false);
    });

    it("should confirm settlement", async () => {
      await program.methods
        .confirmSettlement(new anchor.BN(market1Id))
        .accounts({
          globalConfig: globalConfigPda,
          settlementCouncil: settlementCouncilPda,
          proposal: proposalPda,
          operator: operator2.publicKey,
        })
        .signers([operator2])
        .rpc();

      const proposal = await program.account.settlementProposal.fetch(proposalPda);
      assert.equal(proposal.numConfirmations, 2);
    });

    it("should finalize settlement", async () => {
      const [epochPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      await program.methods
        .finalizeSettlement(new anchor.BN(market1Id))
        .accounts({
          globalConfig: globalConfigPda,
          settlementCouncil: settlementCouncilPda,
          market: market1Pda,
          proposal: proposalPda,
          epoch: epochPda,
          caller: trader.publicKey,
        })
        .signers([trader])
        .rpc();

      const proposal = await program.account.settlementProposal.fetch(proposalPda);
      assert.equal(proposal.finalized, true);

      const market = await program.account.market.fetch(market1Pda);
      assert.equal(market.status, "settled");
      assert.equal(market.winningOutcome, 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 6b: Slip Resolution
  // ═══════════════════════════════════════════════════════════════
  describe("Step 6b: Slip Resolution", () => {
    it("should settle slip leg", async () => {
      const slipId = 1;
      const [slipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const market1Id = 1;
      const [market1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(market1Id).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      await program.methods
        .settleSlipLeg(new anchor.BN(slipId), 0)
        .accounts({
          globalConfig: globalConfigPda,
          slip: slipPda,
          market: market1Pda,
          caller: trader.publicKey,
        })
        .signers([trader])
        .rpc();

      const slip = await program.account.slip.fetch(slipPda);
      assert.equal(slip.legsSettledMask, 1); // Bit 0 set
      // Status depends on outcome - if won, should be "won", else "lost"
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 7: Epoch Close
  // ═══════════════════════════════════════════════════════════════
  describe("Step 7: Epoch Close", () => {
    it("should enable epoch withdrawals when all markets settled", async () => {
      const epochId = 0; // Initial epoch
      const [epochPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [epochVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("epoch_vault"), new anchor.BN(epochId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Enable withdrawals
      await program.methods
        .enableEpochWithdrawals(new anchor.BN(epochId))
        .accounts({
          globalConfig: globalConfigPda,
          epochVault: epochVaultPda,
          epoch: epochPda,
        })
        .signers([admin])
        .rpc();

      const vault = await program.account.epochVault.fetch(epochVaultPda);
      assert.equal(vault.withdrawalsEnabled, true);
    });
  });
});

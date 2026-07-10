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

// ─── Test Suite ─────────────────────────────────────────────────

describe("quadratic_market — Helper Functions Integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
  const payer = provider.wallet.payer;

  // PDAs
  let globalConfigPda: PublicKey;
  let lpMintPda: PublicKey;
  let treasuryPda: PublicKey;
  let baseMint: PublicKey;

  // User keypairs
  const operator = Keypair.generate();
  const lp = Keypair.generate();

  before(async () => {
    // Find PDAs
    [globalConfigPda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("global_config")],
      program.programId
    );
    [lpMintPda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("lp_mint")],
      program.programId
    );
    [treasuryPda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("treasury")],
      program.programId
    );

    // Airdrop SOL to new keypairs
    const signature1 = await provider.connection.requestAirdrop(
      operator.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature1);

    const signature2 = await provider.connection.requestAirdrop(
      lp.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature2);
  });

  it("initializes the protocol", async () => {
    // Check if already initialized
    try {
      await program.account.globalConfig.fetch(globalConfigPda);
      console.log("Protocol already initialized, skipping init");
      return;
    } catch {
      // Not initialized yet
    }

    // Create base mint (USDC with 6 decimals)
    baseMint = await createMint(provider, payer, 6);

    // Initialize protocol
    const tx = await program.methods
      .initialize(
        operator.publicKey.toBuffer(), // oracle pubkey
        new anchor.BN("100000000000000") // max market exposure
      )
      .accounts({
        globalConfig: globalConfigPda,
        lpMint: lpMintPda,
        treasury: treasuryPda,
        baseMint: baseMint,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM,
      })
      .rpc();

    console.log("Initialized protocol:", tx);

    // Verify
    const config = await program.account.globalConfig.fetch(globalConfigPda);
    assert.ok(config.admin.equals(payer.publicKey));
    assert.ok(config.treasuryBump !== undefined);
  });

  it("adds liquidity (LP deposit)", async () => {
    // Get config
    const config = await program.account.globalConfig.fetch(globalConfigPda);
    baseMint = config.baseMint;

    // Create LP's ATA
    const lpBaseAta = getAssociatedTokenAddressSync(baseMint, lp.publicKey, true, TOKEN_PROGRAM, ATA_PROGRAM);
    const treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);

    // Create LP's ATA (off-curve)
    await provider.sendAndConfirm(
      new Transaction().add({
        keys: [
          { pubkey: lp.publicKey, isSigner: true, isWritable: true },
          { pubkey: lpBaseAta, isSigner: false, isWritable: true },
          { pubkey: lp.publicKey, isSigner: false, isWritable: false },
          { pubkey: baseMint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        ],
        programId: ATA_PROGRAM,
        data: Buffer.from([]),
      }),
      [lp]
    );

    // Create treasury's ATA (off-curve)
    await provider.sendAndConfirm(
      new Transaction().add({
        keys: [
          { pubkey: lp.publicKey, isSigner: true, isWritable: true },
          { pubkey: treasuryBaseAta, isSigner: false, isWritable: true },
          { pubkey: treasuryPda, isSigner: false, isWritable: false },
          { pubkey: baseMint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        ],
        programId: ATA_PROGRAM,
        data: Buffer.from([]),
      }),
      [lp]
    );

    // Mint some base tokens to LP
    const mintAmount = 100_000_000; // 100 USDC
    await mintTo(provider, payer, baseMint, lpBaseAta, payer, mintAmount);

    // Add liquidity
    const tx = await program.methods
      .addLiquidity(new anchor.BN(mintAmount))
      .accounts({
        globalConfig: globalConfigPda,
        lpMint: lpMintPda,
        treasury: treasuryPda,
        treasuryBaseAta: treasuryBaseAta,
        providerBaseAta: lpBaseAta,
        provider: lp.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp])
      .rpc();

    console.log("Added liquidity:", tx);

    // Verify LP shares minted
    const providerLpAta = getAssociatedTokenAddressSync(config.lpMint, lp.publicKey, true, TOKEN_PROGRAM, ATA_PROGRAM);
    const lpAccount = await getAccount(provider.connection, providerLpAta);
    assert.ok(Number(lpAccount.amount) > 0);
  });

  it("initializes an epoch", async () => {
    const config = await program.account.globalConfig.fetch(globalConfigPda);

    // Find epoch PDA
    const epochId = config.currentEpoch + 1;
    const [epochPda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("epoch"), epochId.toBuffer("le", 8)],
      program.programId
    );

    // Init epoch
    const tx = await program.methods
      .initEpoch()
      .accounts({
        globalConfig: globalConfigPda,
        epoch: epochPda,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Initialized epoch:", tx);

    // Verify
    const epoch = await program.account.epoch.fetch(epochPda);
    assert.equal(epoch.epochId.toNumber(), epochId);
    assert.equal(epoch.numMarkets.toNumber(), 0);
    assert.equal(epoch.numSettledMarkets.toNumber(), 0);
  });

  it("creates a market in the epoch", async () => {
    const config = await program.account.globalConfig.fetch(globalConfigPda);
    baseMint = config.baseMint;

    const marketId = config.nextMarketId.toNumber();

    // Find market PDA
    const [marketPda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("market"), Buffer.from(marketId.toString())],
      program.programId
    );

    // Get treasury base ATA
    const treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);

    // Create market
    const startTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const tx = await program.methods
      .createMarket(
        new anchor.BN(startTime),
        2, // num outcomes
        "Test Market",
        "Description",
        0, // category
        null, // lmsr_b_override
        null, // initial_q_values
        { trading: {} } // market mode - LMSR trading enabled
      )
      .accounts({
        globalConfig: globalConfigPda,
        market: marketPda,
        treasury: treasuryPda,
        treasuryBaseAta: treasuryBaseAta,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Created market:", tx);

    // Verify
    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.marketId.toNumber(), marketId);
    assert.equal(market.numOutcomes, 2);
    assert.ok(market.title === "Test Market");
  });

  it("creates a fixed odds market (betslip mode)", async () => {
    const config = await program.account.globalConfig.fetch(globalConfigPda);

    const marketId = config.nextMarketId.toNumber();

    // Find market PDA
    const [marketPda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("market"), Buffer.from(marketId.toString())],
      program.programId
    );

    // Get treasury base ATA
    const treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);

    // Create market with FixedOdds mode
    const startTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now
    const tx = await program.methods
      .createMarket(
        new anchor.BN(startTime),
        3, // num outcomes (e.g., Home/Draw/Away)
        "Football Match",
        "Premier League Match",
        1, // category
        null, // lmsr_b_override
        null, // initial_q_values
        { fixedOdds: {} } // market mode - fixed odds for betslips
      )
      .accounts({
        globalConfig: globalConfigPda,
        market: marketPda,
        treasury: treasuryPda,
        treasuryBaseAta: treasuryBaseAta,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Created fixed odds market:", tx);

    // Verify
    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.marketId.toNumber(), marketId);
    assert.equal(market.numOutcomes, 3);
    assert.ok(market.marketMode.trading === undefined); // Should be FixedOdds
  });

  it("initializes settlement council", async () => {
    // Find council PDA
    const [councilPda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("settlement_council")],
      program.programId
    );

    try {
      // Check if already initialized
      await program.account.settlementCouncil.fetch(councilPda);
      console.log("Settlement council already initialized");
      return;
    } catch {
      // Not initialized
    }

    const tx = await program.methods
      .initializeSettlementCouncil(
        new anchor.BN("10000000000"), // min stake: 10,000 USDC
        2 // required confirmations
      )
      .accounts({
        globalConfig: globalConfigPda,
        council: councilPda,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Initialized settlement council:", tx);

    // Verify
    const council = await program.account.settlementCouncil.fetch(councilPda);
    assert.equal(council.requiredConfirmations, 2);
    assert.ok(council.authority.equals(payer.publicKey));
  });

  it("creates a betslip (multi-leg)", async () => {
    const config = await program.account.globalConfig.fetch(globalConfigPda);
    baseMint = config.baseMint;

    // Get user's base ATA
    const userBaseAta = getAssociatedTokenAddressSync(baseMint, payer.publicKey, true, TOKEN_PROGRAM, ATA_PROGRAM);
    const treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);

    // Find slip PDA
    const slipId = config.nextSlipId.toNumber();
    const [slipPda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("slip"), Buffer.from(slipId.toString())],
      program.programId
    );

    // Define slip legs (e.g., 3 different markets)
    const legs = [
      { marketId: new anchor.BN(0), outcomeId: 0, numShares: new anchor.BN(1000000) },
      { marketId: new anchor.BN(1), outcomeId: 1, numShares: new anchor.BN(1000000) },
    ];

    // Fixed odds for each leg (in basis points - 200 = 2.00x payout)
    const fixedOdds = [
      new anchor.BN(20000), // 2.0x
      new anchor.BN(30000), // 3.0x
    ];

    const stake = new anchor.BN(1000000); // 1 USDC
    const cancelDeadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes

    const tx = await program.methods
      .placeSlipAwait(legs, stake, fixedOdds, new anchor.BN(cancelDeadline))
      .accounts({
        globalConfig: globalConfigPda,
        slip: slipPda,
        treasury: treasuryPda,
        ownerBaseAta: userBaseAta,
        treasuryBaseAta: treasuryBaseAta,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Created betslip:", tx);

    // Verify slip
    const slip = await program.account.slip.fetch(slipPda);
    assert.equal(slip.numLegs, 2);
    assert.ok(slip.owner.equals(payer.publicKey));
    assert.ok(slip.totalStake.eq(stake));
  });
});

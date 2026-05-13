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
import { Keypair, PublicKey, SystemProgram, Transaction, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";

const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;
const TOKEN_ACCOUNT_SIZE = 165;

/**
 * Create a token account for a PDA owner (off-curve) using raw instructions.
 * This avoids the ATA program's GetAccountDataSize call which is Token-2022 only.
 */
async function createTokenAccountRaw(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  newAccount: Keypair
): Promise<PublicKey> {
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    newAccountPubkey: newAccount.publicKey,
    lamports,
    space: TOKEN_ACCOUNT_SIZE,
    programId: TOKEN_PROGRAM,
  });
  const initAccountIx = {
    keys: [
      { pubkey: newAccount.publicKey, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: TOKEN_PROGRAM,
    data: Buffer.from([0x01]),
  };
  await provider.sendAndConfirm(new Transaction().add(createAccountIx).add(initAccountIx), [newAccount]);
  return newAccount.publicKey;
}

/**
 * Create an ATA using the ATA program (for on-curve owners only).
 */
async function createAtaOnCurve(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM, ATA_PROGRAM);
  await provider.sendAndConfirm(
    new Transaction().add(createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey, ata, owner, mint, TOKEN_PROGRAM, ATA_PROGRAM
    )),
    []
  );
  return ata;
}

describe("quadratic_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
  const payer = provider.wallet.payer;

  // PDAs
  let globalConfigPda: PublicKey;
  let lpMintPda: PublicKey;
  let treasuryPda: PublicKey;

  // Test accounts
  let baseMint: PublicKey;
  let baseMintAuthority: Keypair;
  let lp1: Keypair;
  let lp2: Keypair;
  let user1: Keypair;
  let marketCreator: Keypair;

  // Token accounts
  let treasuryBaseAta: PublicKey;
  let lp1BaseAta: PublicKey;
  let lp2BaseAta: PublicKey;
  let lp1LpAta: PublicKey;
  let user1BaseAta: PublicKey;
  let creatorBaseAta: PublicKey;

  const ORACLE_PUBKEY = Keypair.generate().publicKey.toBuffer();

  before(async () => {
    // Derive PDAs
    [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")], program.programId
    );
    [lpMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint")], program.programId
    );
    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")], program.programId
    );

    // Create base mint (standard Token program)
    baseMintAuthority = Keypair.generate();
    baseMint = await createMint(
      provider.connection, payer,
      baseMintAuthority.publicKey, null, 6,
      undefined, TOKEN_PROGRAM
    );

    // Create test wallets
    lp1 = Keypair.generate();
    lp2 = Keypair.generate();
    user1 = Keypair.generate();
    marketCreator = Keypair.generate();

    // Airdrop SOL
    for (const kp of [lp1, lp2, user1, marketCreator]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Create treasury ATA (PDA owner - off curve)
    // Use the ATA program's create instruction which handles off-curve owners
    treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);
    const createAtaIx = {
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: treasuryBaseAta, isSigner: false, isWritable: true },
        { pubkey: treasuryPda, isSigner: false, isWritable: false },
        { pubkey: baseMint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      programId: ATA_PROGRAM,
      data: Buffer.from([]),
    };
    await provider.sendAndConfirm(new Transaction().add(createAtaIx), []);

    // Create user ATAs (on-curve owners)
    lp1BaseAta = await createAtaOnCurve(provider, baseMint, lp1.publicKey);
    await mintTo(provider.connection, payer, baseMint, lp1BaseAta, baseMintAuthority, 1_000_000_000);

    lp2BaseAta = await createAtaOnCurve(provider, baseMint, lp2.publicKey);
    await mintTo(provider.connection, payer, baseMint, lp2BaseAta, baseMintAuthority, 1_000_000_000);

    user1BaseAta = await createAtaOnCurve(provider, baseMint, user1.publicKey);
    await mintTo(provider.connection, payer, baseMint, user1BaseAta, baseMintAuthority, 100_000_000);

    creatorBaseAta = await createAtaOnCurve(provider, baseMint, marketCreator.publicKey);
    await mintTo(provider.connection, payer, baseMint, creatorBaseAta, baseMintAuthority, 200_000_000);

  });

  // ─── Initialize ────────────────────────────────────────────

  it("Initializes the protocol", async () => {
    await program.methods
      .initialize(
        ORACLE_PUBKEY,
        new anchor.BN(500_000_000),
        new anchor.BN(3600),
        new anchor.BN(1_000_000),
        new anchor.BN(50_000_000)
      )
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
    assert.equal(config.maxMarketExposure.toNumber(), 500_000_000);
    assert.equal(config.minMarketBond.toNumber(), 50_000_000);
    assert.equal(config.nextMarketId.toNumber(), 1);

    // Create LP token ATA (mint is now initialized)
    lp1LpAta = getAssociatedTokenAddressSync(lpMintPda, lp1.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
    await provider.sendAndConfirm(
      new Transaction().add(createAssociatedTokenAccountInstruction(
        payer.publicKey, lp1LpAta, lp1.publicKey, lpMintPda, TOKEN_PROGRAM, ATA_PROGRAM
      )),
      []
    );
  });

  // ─── LP Operations ─────────────────────────────────────────

  it("Adds liquidity (first depositor with ERC4626 fix)", async () => {
    const depositAmount = 200_000_000;
    await program.methods
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
      .signers([lp1])
      .rpc();

    const lpBalance = await getAccount(provider.connection, lp1LpAta);
    assert.ok(Number(lpBalance.amount) > 0, "LP should have received tokens");

    const treasuryBalance = await getAccount(provider.connection, treasuryBaseAta);
    assert.equal(Number(treasuryBalance.amount), depositAmount);

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    assert.ok(config.totalLpSupply.toNumber() > 0);
  });

  // ─── Market Creation ────────────────────────────────────────

  it("Creates a market with 2 outcomes", async () => {
    const marketId = 1;
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const startTime = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createMarket(
        new anchor.BN(startTime),
        2,
        new anchor.BN(50_000_000),
        "Will Arsenal win?",
        "Binary market for Arsenal match",
        0,
        null
      )
      .accounts({
        globalConfig: globalConfigPda,
        market: marketPda,
        treasury: treasuryPda,
        treasuryBaseAta,
        creatorBaseAta,
        baseMint,
        creator: marketCreator.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([marketCreator])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.marketId.toNumber(), 1);
    assert.equal(market.numOutcomes, 2);
    assert.deepEqual(market.status, { open: {} });
    assert.equal(market.bondAmount.toNumber(), 50_000_000);
  });

  it("Initializes outcome mint for outcome 0", async () => {
    const marketId = 1;
    const outcomeId = 0;
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [outcomeMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8), Buffer.from([outcomeId])],
      program.programId
    );

    await program.methods
      .initOutcomeMint(new anchor.BN(marketId), outcomeId)
      .accounts({
        globalConfig: globalConfigPda,
        market: marketPda,
        outcomeMint: outcomeMintPda,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.outcomeMints[0].toString(), outcomeMintPda.toString());
  });

  it("Initializes outcome mint for outcome 1", async () => {
    const marketId = 1;
    const outcomeId = 1;
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [outcomeMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8), Buffer.from([outcomeId])],
      program.programId
    );

    await program.methods
      .initOutcomeMint(new anchor.BN(marketId), outcomeId)
      .accounts({
        globalConfig: globalConfigPda,
        market: marketPda,
        outcomeMint: outcomeMintPda,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.outcomeMints[1].toString(), outcomeMintPda.toString());
  });

  // ─── Trading ────────────────────────────────────────────────

  it("Buys outcome shares via LMSR pricing", async () => {
    const marketId = 1;
    const outcomeId = 0;
    const numShares = 10_000_000;
    const maxPayment = 20_000_000;

    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [outcomeMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8), Buffer.from([outcomeId])],
      program.programId
    );

    // User's outcome ATA must be at the proper ATA derived address
    const user1OutcomeAta = getAssociatedTokenAddressSync(
      outcomeMintPda, user1.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
    );
    // Create the ATA
    await provider.sendAndConfirm(
      new Transaction().add(createAssociatedTokenAccountInstruction(
        payer.publicKey, user1OutcomeAta, user1.publicKey, outcomeMintPda, TOKEN_PROGRAM, ATA_PROGRAM
      )),
      []
    );

    await program.methods
      .buyShares(outcomeId, new anchor.BN(numShares), new anchor.BN(maxPayment))
      .accounts({
        globalConfig: globalConfigPda,
        market: marketPda,
        treasury: treasuryPda,
        buyerBaseAta: user1BaseAta,
        treasuryBaseAta,
        buyerOutcomeAta: user1OutcomeAta,
        outcomeMint: outcomeMintPda,
        baseMint,
        buyer: user1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    const outcomeBalance = await getAccount(provider.connection, user1OutcomeAta);
    assert.equal(Number(outcomeBalance.amount), numShares);

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.qValues[0].toNumber(), numShares);
  });

  it("Sells outcome shares back to AMM", async () => {
    const marketId = 1;
    const outcomeId = 0;
    const numShares = 5_000_000;
    const minPayout = 1;

    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [outcomeMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8), Buffer.from([outcomeId])],
      program.programId
    );

    const user1OutcomeAta = getAssociatedTokenAddressSync(
      outcomeMintPda, user1.publicKey, true, TOKEN_PROGRAM, ATA_PROGRAM
    );

    const user1BaseBefore = await getAccount(provider.connection, user1BaseAta);

    await program.methods
      .sellShares(outcomeId, new anchor.BN(numShares), new anchor.BN(minPayout))
      .accounts({
        globalConfig: globalConfigPda,
        market: marketPda,
        treasury: treasuryPda,
        sellerOutcomeAta: user1OutcomeAta,
        sellerBaseAta: user1BaseAta,
        treasuryBaseAta,
        outcomeMint: outcomeMintPda,
        baseMint,
        seller: user1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
      })
      .signers([user1])
      .rpc();

    const user1BaseAfter = await getAccount(provider.connection, user1BaseAta);
    assert.ok(
      Number(user1BaseAfter.amount) > Number(user1BaseBefore.amount),
      "User should have received base tokens from sell"
    );

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.qValues[0].toNumber(), 5_000_000);
  });

  // ─── Settlement ─────────────────────────────────────────────

  it("Proposes a result", async () => {
    const marketId = 1;
    const proposedOutcome = 0;

    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [disputePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dispute"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8), Buffer.alloc(4)],
      program.programId
    );

    await program.methods
      .proposeResult(new anchor.BN(marketId), proposedOutcome)
      .accounts({
        globalConfig: globalConfigPda,
        market: marketPda,
        dispute: disputePda,
        treasury: treasuryPda,
        proposerBaseAta: user1BaseAta,
        treasuryBaseAta,
        baseMint,
        proposer: user1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.deepEqual(market.status, { proposed: {} });
  });
});

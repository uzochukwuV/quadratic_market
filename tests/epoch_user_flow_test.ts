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
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction } from "@solana/web3.js";
import { assert } from "chai";

const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;

async function createAta(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  allowOffCurve = false
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, allowOffCurve, TOKEN_PROGRAM, ATA_PROGRAM);
  await provider.sendAndConfirm(
    new Transaction().add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        ata,
        owner,
        mint,
        TOKEN_PROGRAM,
        ATA_PROGRAM
      )
    ),
    []
  );
  return ata;
}

describe("epoch user flow integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;

  const admin = provider.wallet.payer;
  const oracle = Keypair.generate();
  const operator = Keypair.generate();
  const lp = Keypair.generate();
  const trader = Keypair.generate();
  const mintAuth = Keypair.generate();

  let globalConfig: PublicKey;
  let lpMint: PublicKey;
  let treasury: PublicKey;
  let baseMint: PublicKey;
  let treasuryBaseAta: PublicKey;
  let treasuryLpAta: PublicKey;
  let lpBaseAta: PublicKey;
  let lpLpAta: PublicKey;
  let pendingLiquidity: PublicKey;
  let withdrawReq: PublicKey;
  let market1: PublicKey;
  let market2: PublicKey;
  let epoch: PublicKey;
  let dispute1: PublicKey;
  let dispute2: PublicKey;
  let traderBaseAta: PublicKey;
  let traderOutcomeAta: PublicKey;
  let outcomeMint0: PublicKey;

  const marketId1 = 1;
  const marketId2 = 2;

  it("runs epoch lifecycle from init -> trading -> settlement -> lp withdraw", async () => {
    [globalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global_config")], program.programId);
    [lpMint] = PublicKey.findProgramAddressSync([Buffer.from("lp_mint")], program.programId);
    [treasury] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId);
    [pendingLiquidity] = PublicKey.findProgramAddressSync([Buffer.from("pending"), lp.publicKey.toBuffer()], program.programId);
    [withdrawReq] = PublicKey.findProgramAddressSync([Buffer.from("withdrawal"), lp.publicKey.toBuffer()], program.programId);
    [market1] = PublicKey.findProgramAddressSync([Buffer.from("market"), new anchor.BN(marketId1).toArrayLike(Buffer, "le", 8)], program.programId);
    [market2] = PublicKey.findProgramAddressSync([Buffer.from("market"), new anchor.BN(marketId2).toArrayLike(Buffer, "le", 8)], program.programId);
    [epoch] = PublicKey.findProgramAddressSync([Buffer.from("epoch"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)], program.programId);
    [dispute1] = PublicKey.findProgramAddressSync([Buffer.from("dispute"), new anchor.BN(marketId1).toArrayLike(Buffer, "le", 8)], program.programId);
    [dispute2] = PublicKey.findProgramAddressSync([Buffer.from("dispute"), new anchor.BN(marketId2).toArrayLike(Buffer, "le", 8)], program.programId);

    // If already initialized by another suite, skip to avoid PDA collisions.
    try {
      await program.account.globalConfig.fetch(globalConfig);
      return;
    } catch (_) {}

    for (const kp of [oracle, operator, lp, trader]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    baseMint = await createMint(provider.connection, admin, mintAuth.publicKey, null, 6);
    treasuryBaseAta = await createAta(provider, baseMint, treasury, true);
    treasuryLpAta = await createAta(provider, lpMint, treasury, true);
    lpBaseAta = await createAta(provider, baseMint, lp.publicKey);
    lpLpAta = await createAta(provider, lpMint, lp.publicKey);
    traderBaseAta = await createAta(provider, baseMint, trader.publicKey);

    await mintTo(provider.connection, admin, baseMint, lpBaseAta, mintAuth, 1_000_000_000);
    await mintTo(provider.connection, admin, baseMint, traderBaseAta, mintAuth, 500_000_000);

    await program.methods
      .initialize(Array.from(oracle.publicKey.toBytes()) as unknown as number[] & { length: 32 }, new anchor.BN(2_000_000_000))
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

    await program.methods.addOperator(operator.publicKey).accounts({ globalConfig, admin: admin.publicKey }).signers([admin]).rpc();

    await program.methods
      .updateConfig(
        null, new anchor.BN(60), new anchor.BN(60), null, null, null, new anchor.BN(60), new anchor.BN(0),
        null, null, null, null, null
      )
      .accounts({ globalConfig, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    await program.methods
      .initEpoch()
      .accounts({ globalConfig, epoch, authority: operator.publicKey, systemProgram: SystemProgram.programId })
      .signers([operator])
      .rpc();

    await program.methods
      .addLiquidity(new anchor.BN(300_000_000))
      .accounts({
        globalConfig, lpMint, treasury, treasuryBaseAta, providerBaseAta: lpBaseAta, providerLpAta: lpLpAta, baseMint,
        pendingLiquidity, provider: lp.publicKey, tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM, systemProgram: SystemProgram.programId
      })
      .signers([lp])
      .rpc();

    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) + 600);
    await program.methods
      .createMarket(startTime, 2, "Epoch Flow Market 1", "Integration flow one", 0, null, null, { trading: {} })
      .accounts({
        globalConfig,
        market: market1,
        epoch,
        authority: operator.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([operator])
      .rpc();
    await program.methods
      .createMarket(startTime, 2, "Epoch Flow Market 2", "Integration flow two", 0, null, null, { trading: {} })
      .accounts({
        globalConfig,
        market: market2,
        epoch,
        authority: operator.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([operator])
      .rpc();

    const [outcomeMint1] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId1).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
      program.programId
    );
    [outcomeMint0] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId1).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
      program.programId
    );
    const [outcomeMint20] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId2).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
      program.programId
    );
    const [outcomeMint21] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId2).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
      program.programId
    );

    await program.methods.initOutcomeMint(new anchor.BN(marketId1), 0).accounts({
      globalConfig, market: market1, outcomeMint: outcomeMint0, payer: admin.publicKey, tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY
    }).signers([admin]).rpc();
    await program.methods.initOutcomeMint(new anchor.BN(marketId1), 1).accounts({
      globalConfig, market: market1, outcomeMint: outcomeMint1, payer: admin.publicKey, tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY
    }).signers([admin]).rpc();
    await program.methods.initOutcomeMint(new anchor.BN(marketId2), 0).accounts({
      globalConfig, market: market2, outcomeMint: outcomeMint20, payer: admin.publicKey, tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY
    }).signers([admin]).rpc();
    await program.methods.initOutcomeMint(new anchor.BN(marketId2), 1).accounts({
      globalConfig, market: market2, outcomeMint: outcomeMint21, payer: admin.publicKey, tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY
    }).signers([admin]).rpc();

    traderOutcomeAta = await createAta(provider, outcomeMint0, trader.publicKey);
    const traderOutcomeAta2 = await createAta(provider, outcomeMint20, trader.publicKey);

    await program.methods
      .buyShares(0, new anchor.BN(50_000_000), new anchor.BN(40_000_000))
      .accounts({
        globalConfig, market: market1, treasury, buyerBaseAta: traderBaseAta, treasuryBaseAta, buyerOutcomeAta: traderOutcomeAta,
        outcomeMint: outcomeMint0, baseMint, buyer: trader.publicKey, tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId
      })
      .signers([trader])
      .rpc();
    await program.methods
      .buyShares(0, new anchor.BN(30_000_000), new anchor.BN(25_000_000))
      .accounts({
        globalConfig, market: market2, treasury, buyerBaseAta: traderBaseAta, treasuryBaseAta, buyerOutcomeAta: traderOutcomeAta2,
        outcomeMint: outcomeMint20, baseMint, buyer: trader.publicKey, tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId
      })
      .signers([trader])
      .rpc();

    await program.methods.suspendMarket().accounts({ globalConfig, market: market1, authority: operator.publicKey }).signers([operator]).rpc();
    await program.methods.suspendMarket().accounts({ globalConfig, market: market2, authority: operator.publicKey }).signers([operator]).rpc();
    await program.methods.proposeResult(new anchor.BN(marketId1), 0).accounts({
      globalConfig, market: market1, dispute: dispute1, oracle: oracle.publicKey, systemProgram: SystemProgram.programId
    }).signers([oracle]).rpc();
    await program.methods.proposeResult(new anchor.BN(marketId2), 0).accounts({
      globalConfig, market: market2, dispute: dispute2, oracle: oracle.publicKey, systemProgram: SystemProgram.programId
    }).signers([oracle]).rpc();
    await program.methods.finalizeResult(new anchor.BN(marketId1)).accounts({
      globalConfig, market: market1, dispute: dispute1, epoch, caller: operator.publicKey
    }).signers([operator]).rpc();
    await program.methods.finalizeResult(new anchor.BN(marketId2)).accounts({
      globalConfig, market: market2, dispute: dispute2, epoch, caller: operator.publicKey
    }).signers([operator]).rpc();

    const epochAcc = await program.account.epoch.fetch(epoch);
    assert.equal(epochAcc.withdrawalsEnabled, true);

    await program.methods
      .requestWithdraw(new anchor.BN(50_000_000))
      .accounts({
        globalConfig, lpMint, treasury, treasuryBaseAta, lpLpAta, treasuryLpAta, pendingLiquidity,
        withdrawalRequest: withdrawReq, baseMint, epoch, lp: lp.publicKey, tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM, systemProgram: SystemProgram.programId
      })
      .signers([lp])
      .rpc();

    await program.methods
      .processWithdrawal()
      .accounts({
        globalConfig, lpMint, treasury, treasuryBaseAta, treasuryLpAta, lpBaseAta, baseMint,
        withdrawalRequest: withdrawReq, authority: lp.publicKey, tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId
      })
      .signers([lp])
      .rpc();

    const lpBasePost = await getAccount(provider.connection, lpBaseAta);
    assert.ok(Number(lpBasePost.amount) > 0);
  });
});

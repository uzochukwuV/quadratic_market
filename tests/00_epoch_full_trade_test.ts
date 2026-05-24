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

describe("epoch full trade integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;

  const admin = provider.wallet.payer;
  const oracle = Keypair.generate();
  const operator = Keypair.generate();
  const lp = Keypair.generate();
  const trader = Keypair.generate();
  const mintAuth = Keypair.generate();

  it("simulates a full epoch trade across 2 markets (LP fund -> trade -> settle -> LP withdraw)", async () => {
    const [globalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global_config")], program.programId);
    const [lpMint] = PublicKey.findProgramAddressSync([Buffer.from("lp_mint")], program.programId);
    const [treasury] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId);

    try {
      await program.account.globalConfig.fetch(globalConfig);
      return;
    } catch (_) {}

    for (const kp of [oracle, operator, lp, trader]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    const baseMint = await createMint(provider.connection, admin, mintAuth.publicKey, null, 6);
    const treasuryBaseAta = await createAta(provider, baseMint, treasury, true);
    const treasuryLpAta = await createAta(provider, lpMint, treasury, true);

    const adminBaseAta = await createAta(provider, baseMint, admin.publicKey);
    const lpBaseAta = await createAta(provider, baseMint, lp.publicKey);
    const lpLpAta = await createAta(provider, lpMint, lp.publicKey);
    const traderBaseAta = await createAta(provider, baseMint, trader.publicKey);

    await mintTo(provider.connection, admin, baseMint, adminBaseAta, mintAuth, 2_000_000_000);
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
        null,
        new anchor.BN(60),
        new anchor.BN(60),
        null,
        null,
        null,
        new anchor.BN(60),
        new anchor.BN(0),
        null,
        null,
        null,
        null,
        null
      )
      .accounts({ globalConfig, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    const [epoch] = PublicKey.findProgramAddressSync([Buffer.from("epoch"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)], program.programId);

    await program.methods
      .initEpoch()
      .accounts({ globalConfig, epoch, authority: operator.publicKey, systemProgram: SystemProgram.programId })
      .signers([operator])
      .rpc();

    const [pendingLiquidity] = PublicKey.findProgramAddressSync([Buffer.from("pending"), lp.publicKey.toBuffer()], program.programId);

    await program.methods
      .addLiquidity(new anchor.BN(300_000_000))
      .accounts({
        globalConfig,
        lpMint,
        treasury,
        treasuryBaseAta,
        providerBaseAta: lpBaseAta,
        providerLpAta: lpLpAta,
        baseMint,
        pendingLiquidity,
        provider: lp.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp])
      .rpc();

    const cfg = await program.account.globalConfig.fetch(globalConfig);
    const marketId1 = cfg.nextMarketId.toNumber();
    const marketId2 = marketId1 + 1;

    const [market1] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId1).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [market2] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId2).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) + 600);
    await program.methods
      .createMarket(startTime, 2, "Epoch Full Trade Market 1", "Full epoch trade market one", 0, null, null, { trading: {} })
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
      .createMarket(startTime, 2, "Epoch Full Trade Market 2", "Full epoch trade market two", 0, null, null, { trading: {} })
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

    const epochAfterMarkets = await program.account.epoch.fetch(epoch);
    assert.equal(epochAfterMarkets.numMarkets, 2);
    assert.equal(epochAfterMarkets.withdrawalsEnabled, false);
    assert.equal(epochAfterMarkets.allMarketsSettled, false);

    const [outcomeMint10] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId1).toArrayLike(Buffer, "le", 8), Buffer.from([0])],
      program.programId
    );
    const [outcomeMint11] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId1).toArrayLike(Buffer, "le", 8), Buffer.from([1])],
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

    await program.methods
      .initOutcomeMint(new anchor.BN(marketId1), 0)
      .accounts({
        globalConfig,
        market: market1,
        outcomeMint: outcomeMint10,
        payer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();
    await program.methods
      .initOutcomeMint(new anchor.BN(marketId1), 1)
      .accounts({
        globalConfig,
        market: market1,
        outcomeMint: outcomeMint11,
        payer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();
    await program.methods
      .initOutcomeMint(new anchor.BN(marketId2), 0)
      .accounts({
        globalConfig,
        market: market2,
        outcomeMint: outcomeMint20,
        payer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();
    await program.methods
      .initOutcomeMint(new anchor.BN(marketId2), 1)
      .accounts({
        globalConfig,
        market: market2,
        outcomeMint: outcomeMint21,
        payer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    const traderOutcome1 = await createAta(provider, outcomeMint10, trader.publicKey);
    const traderOutcome2 = await createAta(provider, outcomeMint20, trader.publicKey);

    await program.methods
      .buyShares(0, new anchor.BN(50_000_000), new anchor.BN(40_000_000))
      .accounts({
        globalConfig,
        market: market1,
        treasury,
        buyerBaseAta: traderBaseAta,
        treasuryBaseAta,
        buyerOutcomeAta: traderOutcome1,
        outcomeMint: outcomeMint10,
        baseMint,
        buyer: trader.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();
    await program.methods
      .buyShares(0, new anchor.BN(30_000_000), new anchor.BN(25_000_000))
      .accounts({
        globalConfig,
        market: market2,
        treasury,
        buyerBaseAta: traderBaseAta,
        treasuryBaseAta,
        buyerOutcomeAta: traderOutcome2,
        outcomeMint: outcomeMint20,
        baseMint,
        buyer: trader.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await program.methods.suspendMarket().accounts({ globalConfig, market: market1, authority: operator.publicKey }).signers([operator]).rpc();
    await program.methods.suspendMarket().accounts({ globalConfig, market: market2, authority: operator.publicKey }).signers([operator]).rpc();

    const [dispute1] = PublicKey.findProgramAddressSync(
      [Buffer.from("dispute"), new anchor.BN(marketId1).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [dispute2] = PublicKey.findProgramAddressSync(
      [Buffer.from("dispute"), new anchor.BN(marketId2).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .proposeResult(new anchor.BN(marketId1), 0)
      .accounts({ globalConfig, market: market1, dispute: dispute1, oracle: oracle.publicKey, systemProgram: SystemProgram.programId })
      .signers([oracle])
      .rpc();
    await program.methods
      .proposeResult(new anchor.BN(marketId2), 0)
      .accounts({ globalConfig, market: market2, dispute: dispute2, oracle: oracle.publicKey, systemProgram: SystemProgram.programId })
      .signers([oracle])
      .rpc();

    await program.methods
      .finalizeResult(new anchor.BN(marketId1))
      .accounts({ globalConfig, market: market1, dispute: dispute1, epoch, caller: operator.publicKey })
      .signers([operator])
      .rpc();
    await program.methods
      .finalizeResult(new anchor.BN(marketId2))
      .accounts({ globalConfig, market: market2, dispute: dispute2, epoch, caller: operator.publicKey })
      .signers([operator])
      .rpc();

    const epochAfterSettlement = await program.account.epoch.fetch(epoch);
    assert.equal(epochAfterSettlement.numMarkets, 2);
    assert.equal(epochAfterSettlement.numSettledMarkets, 2);
    assert.equal(epochAfterSettlement.allMarketsSettled, true);
    assert.equal(epochAfterSettlement.withdrawalsEnabled, true);
    assert.ok(epochAfterSettlement.lpSharesAtClose.toNumber() > 0);

    const [withdrawReq] = PublicKey.findProgramAddressSync([Buffer.from("withdrawal"), lp.publicKey.toBuffer()], program.programId);

    await program.methods
      .requestWithdraw(new anchor.BN(50_000_000))
      .accounts({
        globalConfig,
        lpMint,
        treasury,
        treasuryBaseAta,
        lpLpAta,
        treasuryLpAta,
        pendingLiquidity,
        withdrawalRequest: withdrawReq,
        baseMint,
        epoch,
        lp: lp.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp])
      .rpc();

    const lpBaseBefore = await getAccount(provider.connection, lpBaseAta);

    await program.methods
      .processWithdrawal()
      .accounts({
        globalConfig,
        lpMint,
        treasury,
        treasuryBaseAta,
        treasuryLpAta,
        lpBaseAta,
        baseMint,
        withdrawalRequest: withdrawReq,
        authority: lp.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([lp])
      .rpc();

    const lpBaseAfter = await getAccount(provider.connection, lpBaseAta);
    assert.ok(Number(lpBaseAfter.amount) > Number(lpBaseBefore.amount));
  });
});

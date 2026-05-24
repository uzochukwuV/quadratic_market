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

    // Initialize accounts with proper snake_case names
    const accounts_initialize = {
      global_config: globalConfig,
      lp_mint: lpMint,
      treasury: treasury,
      base_mint: baseMint,
      admin: admin.publicKey,
      token_program: TOKEN_PROGRAM,
      system_program: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };
    await program.methods
      .initialize(Array.from(oracle.publicKey.toBytes()) as unknown as number[] & { length: 32 }, new anchor.BN(2_000_000_000))
      .accounts(accounts_initialize)
      .rpc();

    await program.methods.addOperator(operator.publicKey).accounts({ global_config: globalConfig, admin: admin.publicKey }).signers([admin]).rpc();

    const accounts_updateConfig = {
      global_config: globalConfig,
      admin: admin.publicKey
    };
    await program.methods
      .updateConfig(
        null, new anchor.BN(60), new anchor.BN(60), null, null, null, new anchor.BN(60), new anchor.BN(0),
        null, null, null, null, null
      )
      .accounts(accounts_updateConfig)
      .signers([admin])
      .rpc();

    const accounts_initEpoch = {
      global_config: globalConfig,
      epoch: epoch,
      authority: operator.publicKey,
      system_program: SystemProgram.programId,
    };
    await program.methods
      .initEpoch()
      .accounts(accounts_initEpoch)
      .signers([operator])
      .rpc();

    const accounts_addLiquidity = {
      global_config: globalConfig,
      lp_mint: lpMint,
      treasury: treasury,
      treasury_base_ata: treasuryBaseAta,
      provider_base_ata: lpBaseAta,
      provider_lp_ata: lpLpAta,
      base_mint: baseMint,
      pending_liquidity: pendingLiquidity,
      provider: lp.publicKey,
      token_program: TOKEN_PROGRAM,
      associated_token_program: ATA_PROGRAM,
      system_program: SystemProgram.programId,
    };
    await program.methods
      .addLiquidity(new anchor.BN(300_000_000))
      .accounts(accounts_addLiquidity)
      .signers([lp])
      .rpc();

    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) + 600);
    const accounts_createMarket = {
      global_config: globalConfig,
      market: market,
      epoch: epoch,
      creator: operator.publicKey,
      system_program: SystemProgram.programId,
    };
    await program.methods
      .createMarket(startTime, 2, "Epoch Flow Market", "Integration flow", "sports", null, null, { trading: {} })
      .accounts(accounts_createMarket)
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

    const accounts_initOutcomeMint0 = {
      global_config: globalConfig,
      market: market,
      outcome_mint: outcomeMint0,
      payer: admin.publicKey,
      token_program: TOKEN_PROGRAM,
      system_program: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };
    const accounts_initOutcomeMint1 = {
      global_config: globalConfig,
      market: market,
      outcome_mint: outcomeMint1,
      payer: admin.publicKey,
      token_program: TOKEN_PROGRAM,
      system_program: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };
    await program.methods.initOutcomeMint(new anchor.BN(marketId), 0).accounts(accounts_initOutcomeMint0).signers([admin]).rpc();
    await program.methods.initOutcomeMint(new anchor.BN(marketId), 1).accounts(accounts_initOutcomeMint1).signers([admin]).rpc();

    traderOutcomeAta = await createAta(provider, outcomeMint0, trader.publicKey);
    const traderOutcomeAta2 = await createAta(provider, outcomeMint20, trader.publicKey);

    const accounts_buyShares = {
      global_config: globalConfig,
      market: market,
      treasury: treasury,
      buyer_base_ata: traderBaseAta,
      treasury_base_ata: treasuryBaseAta,
      buyer_outcome_ata: traderOutcomeAta,
      outcome_mint: outcomeMint0,
      buyer: trader.publicKey,
      token_program: TOKEN_PROGRAM,
      associated_token_program: ATA_PROGRAM,
      system_program: SystemProgram.programId,
    };
    await program.methods
      .buyShares(new anchor.BN(marketId), 0, new anchor.BN(50_000_000), new anchor.BN(40_000_000))
      .accounts(accounts_buyShares)
      .signers([trader])
      .rpc();
    await program.methods
      .buyShares(new anchor.BN(marketId2), 0, new anchor.BN(30_000_000), new anchor.BN(25_000_000))
      .accounts({
        globalConfig, market: market2, treasury, buyerBaseAta: traderBaseAta, treasuryBaseAta, buyerOutcomeAta: traderOutcomeAta2,
        outcomeMint: outcomeMint20, buyer: trader.publicKey, tokenProgram: TOKEN_PROGRAM
      })
      .signers([trader])
      .rpc();

    const accounts_suspendMarket = {
      global_config: globalConfig,
      market: market,
      authority: operator.publicKey,
    };
    await program.methods.suspendMarket().accounts(accounts_suspendMarket).signers([operator]).rpc();
    
    const accounts_proposeResult = {
      global_config: globalConfig,
      market: market,
      dispute: dispute,
      oracle: oracle.publicKey,
      system_program: SystemProgram.programId,
    };
    await program.methods.proposeResult(new anchor.BN(marketId), 0).accounts(accounts_proposeResult).signers([oracle]).rpc();
    
    const accounts_finalizeResult = {
      global_config: globalConfig,
      market: market,
      dispute: dispute,
      epoch: epoch,
      authority: operator.publicKey,
    };
    await program.methods.finalizeResult(new anchor.BN(marketId)).accounts(accounts_finalizeResult).signers([operator]).rpc();

    const epochAcc = await program.account.epoch.fetch(epoch);
    assert.equal(epochAcc.withdrawalsEnabled, true);

    const accounts_requestWithdraw = {
      global_config: globalConfig,
      lp_mint: lpMint,
      treasury: treasury,
      treasury_base_ata: treasuryBaseAta,
      lp_lp_ata: lpLpAta,
      treasury_lp_ata: treasuryLpAta,
      pending_liquidity: pendingLiquidity,
      withdrawal_request: withdrawReq,
      epoch: epoch,
      lp: lp.publicKey,
      token_program: TOKEN_PROGRAM,
      associated_token_program: ATA_PROGRAM,
      system_program: SystemProgram.programId,
    };
    await program.methods
      .requestWithdraw(new anchor.BN(50_000_000))
      .accounts(accounts_requestWithdraw)
      .signers([lp])
      .rpc();

    const accounts_processWithdrawal = {
      global_config: globalConfig,
      lp_mint: lpMint,
      treasury: treasury,
      treasury_base_ata: treasuryBaseAta,
      treasury_lp_ata: treasuryLpAta,
      lp_base_ata: lpBaseAta,
      base_mint: baseMint,
      withdrawal_request: withdrawReq,
      authority: lp.publicKey,
      token_program: TOKEN_PROGRAM,
      system_program: SystemProgram.programId,
    };
    await program.methods
      .processWithdrawal()
      .accounts(accounts_processWithdrawal)
      .signers([lp])
      .rpc();

    const lpBasePost = await getAccount(provider.connection, lpBaseAta);
    assert.ok(Number(lpBasePost.amount) > 0);
  });
});

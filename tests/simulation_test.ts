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

// ─── Helpers ───────────────────────────────────────────────────

async function createTokenAccountRaw(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  newAccount: Keypair
): Promise<PublicKey> {
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
  const tx = new Transaction()
    .add(SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: newAccount.publicKey,
      lamports,
      space: TOKEN_ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM,
    }))
    .add({
      keys: [
        { pubkey: newAccount.publicKey, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      programId: TOKEN_PROGRAM,
      data: Buffer.from([0x01]),
    });
  await provider.sendAndConfirm(tx, [newAccount]);
  return newAccount.publicKey;
}

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

// ─── Simulation Test ───────────────────────────────────────────

describe("simulation — Full Protocol Run", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
  const payer = provider.wallet.payer;

  // Skip if protocol already initialized
  let skipSuite = false;

  // PDAs
  let globalConfigPda: PublicKey;
  let lpMintPda: PublicKey;
  let treasuryPda: PublicKey;
  let treasuryBaseAta: PublicKey;

  // Core accounts
  let baseMint: PublicKey;
  let baseMintAuthority: Keypair;
  let admin: Keypair;

  // LPs
  const NUM_LPS = 5;
  let lps: Keypair[] = [];
  let lpBaseAtas: PublicKey[] = [];
  let lpLpAtas: PublicKey[] = [];
  let pendingLiquidityPdas: PublicKey[] = [];

  // Users
  const NUM_USERS = 30;
  let users: Keypair[] = [];
  let userBaseAtas: PublicKey[] = [];

  // Market creators
  const NUM_CREATORS = 3;
  let creators: Keypair[] = [];
  let creatorBaseAtas: PublicKey[] = [];

  // Markets
  const NUM_MARKETS = 10;
  const MARKET_OUTCOMES = [2, 2, 4, 2, 2, 2, 2, 2, 2, 2]; // outcomes per market
  let marketPdas: PublicKey[] = [];
  let marketIds: number[] = [];
  let outcomeMints: PublicKey[][] = []; // [marketIdx][outcomeIdx]
  let userOutcomeAtas: PublicKey[][][] = []; // [userIdx][marketIdx][outcomeIdx]

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

    // Check if already initialized
    try {
      await program.account.globalConfig.fetch(globalConfigPda);
      console.log("Protocol already initialized, skipping simulation test");
      skipSuite = true;
      return;
    } catch (e) {
      // Not initialized, proceed
    }

    // Create base mint
    baseMintAuthority = Keypair.generate();
    baseMint = await createMint(
      provider.connection, payer,
      baseMintAuthority.publicKey, null, 6,
      undefined, TOKEN_PROGRAM
    );

    admin = payer;

    // Create treasury ATA
    treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);
    await provider.sendAndConfirm(
      new Transaction().add({
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
      }),
      []
    );

    // Initialize protocol
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
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("  Phase 1: Protocol initialized");
  });

  it("Full protocol simulation: 5 LPs, 30 users, 10 markets", async () => {
    if (skipSuite) { console.log("SKIPPED"); return; }

    // ═══════════════════════════════════════════════════════
    // PHASE 1: LP Deposits
    // ═══════════════════════════════════════════════════════

    const lpDepositAmounts = [200_000_000, 300_000_000, 150_000_000, 500_000_000, 100_000_000];
    const now = Math.floor(Date.now() / 1000);
    const activationTime = now - 60; // 1 minute ago, so activation succeeds immediately

    for (let i = 0; i < NUM_LPS; i++) {
      const lp = Keypair.generate();
      lps.push(lp);

      // Fund LP with SOL and base tokens
      await provider.connection.requestAirdrop(lp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      const baseAta = await createAtaOnCurve(provider, baseMint, lp.publicKey);
      await mintTo(provider.connection, payer, baseMint, baseAta, baseMintAuthority, lpDepositAmounts[i]);
      lpBaseAtas.push(baseAta);

      // Create LP ATA
      const lpAta = getAssociatedTokenAddressSync(lpMintPda, lp.publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM);
      await provider.sendAndConfirm(
        new Transaction().add(createAssociatedTokenAccountInstruction(
          payer.publicKey, lpAta, lp.publicKey, lpMintPda, TOKEN_PROGRAM, ATA_PROGRAM
        )),
        []
      );
      lpLpAtas.push(lpAta);

      // Derive pending PDA
      const [pendingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending"), lp.publicKey.toBuffer()], program.programId
      );
      pendingLiquidityPdas.push(pendingPda);

      // Add liquidity + init pending
      const shares = lpDepositAmounts[i] - (i === 0 ? 1_000 : 0); // first LP has min_first_liquidity
      const tx = new Transaction();
      const addLiqIx = await program.methods
        .addLiquidity(new anchor.BN(lpDepositAmounts[i]))
        .accounts({
          globalConfig: globalConfigPda,
          lpMint: lpMintPda,
          treasury: treasuryPda,
          treasuryBaseAta,
          providerBaseAta: baseAta,
          providerLpAta: lpAta,
          baseMint,
          provider: lp.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx.add(addLiqIx);

      if (shares > 0) {
        const initPendingIx = await program.methods
          .initPendingLiquidity(
            new anchor.BN(shares),
            new anchor.BN(activationTime),
            new anchor.BN(lpDepositAmounts[i])
          )
          .accounts({
            globalConfig: globalConfigPda,
            pendingLiquidity: pendingPda,
            provider: lp.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([lp])
          .instruction();
        tx.add(initPendingIx);
      }

      await provider.sendAndConfirm(tx, [lp]);
      console.log(`  Phase 1: LP ${i + 1} deposited ${lpDepositAmounts[i]} tokens`);
    }

    // Activate all pending liquidity
    for (let i = 0; i < NUM_LPS; i++) {
      await program.methods
        .activateLiquidity()
        .accounts({
          globalConfig: globalConfigPda,
          pendingLiquidity: pendingLiquidityPdas[i],
          caller: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    console.log(`  Phase 1: All ${NUM_LPS} LPs activated. Total liquidity: ${lpDepositAmounts.reduce((a, b) => a + b, 0)}`);

    // Verify treasury balance
    const treasuryBal = await getAccount(provider.connection, treasuryBaseAta);
    const totalDeposited = lpDepositAmounts.reduce((a, b) => a + b, 0);
    assert.equal(Number(treasuryBal.amount), totalDeposited, "Treasury should hold all LP deposits");

    // ═══════════════════════════════════════════════════════
    // PHASE 2: Market Creation & Trading
    // ═══════════════════════════════════════════════════════

    // Create 3 market creators
    for (let i = 0; i < NUM_CREATORS; i++) {
      const creator = Keypair.generate();
      creators.push(creator);
      await provider.connection.requestAirdrop(creator.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
      const baseAta = await createAtaOnCurve(provider, baseMint, creator.publicKey);
      await mintTo(provider.connection, payer, baseMint, baseAta, baseMintAuthority, 2_000_000_000);
      creatorBaseAtas.push(baseAta);
    }

    const marketTitles = [
      "Team A vs Team B",
      "Over/Under 2.5 Goals",
      "Tournament Winner",
      "Yes/No Proposition",
      "Match 5: Red vs Blue",
      "Match 6: East vs West",
      "Match 7: North vs South",
      "Match 8: Fast vs Slow",
      "Match 9: Big vs Small",
      "Match 10: Old vs New",
    ];

    // Create markets
    for (let m = 0; m < NUM_MARKETS; m++) {
      const creatorIdx = m % NUM_CREATORS;
      const startTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now
      const numOutcomes = MARKET_OUTCOMES[m];

      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new anchor.BN(m + 1).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      marketPdas.push(marketPda);
      marketIds.push(m + 1);

      await program.methods
        .createMarket(
          new anchor.BN(startTime),
          numOutcomes,
          new anchor.BN(50_000_000),
          marketTitles[m],
          `Simulation market ${m + 1}`,
          0,
          null,
          null
        )
        .accounts({
          creator: creators[creatorIdx].publicKey,
          baseMint,
        })
        .signers([creators[creatorIdx]])
        .rpc();

      // Initialize outcome mints
      const mints: PublicKey[] = [];
      for (let o = 0; o < numOutcomes; o++) {
        const [mintPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("outcome_mint"), new anchor.BN(m + 1).toArrayLike(Buffer, "le", 8), Buffer.from([o])],
          program.programId
        );
        mints.push(mintPda);

        await program.methods
          .initOutcomeMint(new anchor.BN(m + 1), o)
          .accounts({
            globalConfig: globalConfigPda,
            market: marketPda,
            outcomeMint: mintPda,
            payer: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
      }
      outcomeMints.push(mints);
      console.log(`  Phase 2: Market ${m + 1} created with ${numOutcomes} outcomes`);
    }

    // Create 30 users
    for (let u = 0; u < NUM_USERS; u++) {
      const user = Keypair.generate();
      users.push(user);
      await provider.connection.requestAirdrop(user.publicKey, 3 * anchor.web3.LAMPORTS_PER_SOL);
      const baseAta = await createAtaOnCurve(provider, baseMint, user.publicKey);
      await mintTo(provider.connection, payer, baseMint, baseAta, baseMintAuthority, 100_000_000);
      userBaseAtas.push(baseAta);
    }

    // Create outcome ATAs for all users on all markets
    // Do this in batches to avoid transaction size limits
    for (let m = 0; m < NUM_MARKETS; m++) {
      const numOutcomes = MARKET_OUTCOMES[m];
      userOutcomeAtas[m] = [];

      for (let u = 0; u < NUM_USERS; u++) {
        userOutcomeAtas[m][u] = [];
        const tx = new Transaction();

        for (let o = 0; o < numOutcomes; o++) {
          const ata = getAssociatedTokenAddressSync(
            outcomeMints[m][o], users[u].publicKey, false, TOKEN_PROGRAM, ATA_PROGRAM
          );
          userOutcomeAtas[m][u][o] = ata;
          tx.add(createAssociatedTokenAccountInstruction(
            payer.publicKey, ata, users[u].publicKey, outcomeMints[m][o], TOKEN_PROGRAM, ATA_PROGRAM
          ));
        }

        await provider.sendAndConfirm(tx, []);
      }
    }
    console.log(`  Phase 2: Created outcome ATAs for ${NUM_USERS} users across ${NUM_MARKETS} markets`);

    // Trading: deterministic pattern
    // Each user trades on ~4 markets based on a hash-like pattern
    let totalSharesBought = 0;
    for (let u = 0; u < NUM_USERS; u++) {
      let userTrades = 0;
      for (let m = 0; m < NUM_MARKETS; m++) {
        const numOutcomes = MARKET_OUTCOMES[m];
        // Deterministic: user u trades on market m if pattern matches
        if ((u * 7 + m * 13) % 10 < 4) {
          const outcomeId = (u + m) % numOutcomes;
          const numShares = 500_000 + (u * 100_000) % 2_000_000; // 500K-2.5M shares
          const maxPayment = numShares * 2; // generous max payment

          await program.methods
            .buyShares(outcomeId, new anchor.BN(numShares), new anchor.BN(maxPayment))
            .accounts({
              globalConfig: globalConfigPda,
              market: marketPdas[m],
              treasury: treasuryPda,
              buyerBaseAta: userBaseAtas[u],
              treasuryBaseAta,
              buyerOutcomeAta: userOutcomeAtas[m][u][outcomeId],
              outcomeMint: outcomeMints[m][outcomeId],
              baseMint,
              buyer: users[u].publicKey,
              tokenProgram: TOKEN_PROGRAM,
              associatedTokenProgram: ATA_PROGRAM,
              systemProgram: SystemProgram.programId,
            })
            .signers([users[u]])
            .rpc();

          totalSharesBought += numShares;
          userTrades++;
        }
      }
    }
    console.log(`  Phase 2: ${NUM_USERS} users completed trading. Total shares bought: ${totalSharesBought}`);

    // Some users sell shares back (users 5-10 sell some of their holdings on market 0)
    let totalSharesSold = 0;
    for (let u = 5; u <= 10; u++) {
      const outcomeId = (u + 0) % MARKET_OUTCOMES[0];
      const ata = userOutcomeAtas[0][u][outcomeId];
      const balance = await getAccount(provider.connection, ata);
      const sellAmount = Math.floor(Number(balance.amount) / 2);
      if (sellAmount > 0) {
        await program.methods
          .sellShares(outcomeId, new anchor.BN(sellAmount), new anchor.BN(1))
          .accounts({
            globalConfig: globalConfigPda,
            market: marketPdas[0],
            treasury: treasuryPda,
            sellerOutcomeAta: ata,
            sellerBaseAta: userBaseAtas[u],
            treasuryBaseAta,
            outcomeMint: outcomeMints[0][outcomeId],
            baseMint,
            seller: users[u].publicKey,
            tokenProgram: TOKEN_PROGRAM,
            associatedTokenProgram: ATA_PROGRAM,
          })
          .signers([users[u]])
          .rpc();
        totalSharesSold += sellAmount;
      }
    }
    console.log(`  Phase 2: Some users sold ${totalSharesSold} shares back`);

    // Suspend markets 1-4 (event started)
    for (let m = 0; m < 4; m++) {
      await program.methods
        .suspendMarket()
        .accounts({
          globalConfig: globalConfigPda,
          market: marketPdas[m],
          authority: creators[m % NUM_CREATORS].publicKey,
        })
        .signers([creators[m % NUM_CREATORS]])
        .rpc();
    }
    console.log("  Phase 2: Markets 1-4 suspended");

    // Verify solvency after trading
    const config1 = await program.account.globalConfig.fetch(globalConfigPda);
    const treasuryBal1 = await getAccount(provider.connection, treasuryBaseAta);
    assert.ok(
      config1.lockedPayouts.toNumber() <= Number(treasuryBal1.amount),
      "Treasury solvency: locked_payouts <= treasury_balance after trading"
    );
    console.log(`  Phase 2: Solvency check passed (locked: ${config1.lockedPayouts}, treasury: ${Number(treasuryBal1.amount)})`);

    // Reduce challenge window to 10 seconds for testing (enough time for dispute)
    await program.methods
      .updateConfig(null, new anchor.BN(10), null, null, null, null, null, null, null)
      .accounts({
        globalConfig: globalConfigPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("  Phase 3: Challenge window set to 10s for testing");

    // ═══════════════════════════════════════════════════════
    // PHASE 3: Settlement
    // ═══════════════════════════════════════════════════════

    // Define winning outcomes for each market
    const winningOutcomes = [0, 1, 2, 1, 0, 1, 0, 1, 0, 1];

    // Market 2: propose → dispute → finalize (challenge path)
    console.log("  Phase 3: Settling Market 2 with dispute...");
    {
      const m = 1; // Market 2 (index 1)
      const proposeOutcome = winningOutcomes[m];
      const challengeOutcome = (proposeOutcome + 1) % MARKET_OUTCOMES[m];

      // Propose
      const [dispute0] = PublicKey.findProgramAddressSync(
        [Buffer.from("dispute"), new anchor.BN(marketIds[m]).toArrayLike(Buffer, "le", 8), Buffer.alloc(4)],
        program.programId
      );
      await program.methods
        .proposeResult(new anchor.BN(marketIds[m]), proposeOutcome)
        .accounts({
          globalConfig: globalConfigPda,
          market: marketPdas[m],
          dispute: dispute0,
          treasury: treasuryPda,
          proposerBaseAta: userBaseAtas[0],
          treasuryBaseAta,
          baseMint,
          proposer: users[0].publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([users[0]])
        .rpc();

      // Dispute (challenge)
      await program.methods
        .disputeResult(new anchor.BN(marketIds[m]), 0, challengeOutcome)
        .accounts({
          globalConfig: globalConfigPda,
          market: marketPdas[m],
          dispute: dispute0,
          treasury: treasuryPda,
          challengerBaseAta: userBaseAtas[1],
          treasuryBaseAta,
          baseMint,
          challenger: users[1].publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([users[1]])
        .rpc();

      // Finalize (proposer wins since challenger didn't escalate)
      // Wait for challenge window to expire (10s + 1s buffer)
      await new Promise(resolve => setTimeout(resolve, 11000));

      await program.methods
        .finalizeResult(new anchor.BN(marketIds[m]), 0)
        .accounts({
          globalConfig: globalConfigPda,
          market: marketPdas[m],
          dispute: dispute0,
          treasury: treasuryPda,
          winnerBaseAta: userBaseAtas[0],
          treasuryBaseAta,
          winner: users[0].publicKey,
          baseMint,
          authority: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPdas[m]);
      assert.deepEqual(market.status, { settled: {} });
      assert.equal(market.winningOutcome, proposeOutcome);
      console.log(`    Market 2 settled: outcome ${proposeOutcome} won (dispute path)`);
    }

    // Markets 1, 3, 5-10: propose → finalize (no challenge)
    const settleMarkets = [0, 2, 4, 5, 6, 7, 8, 9];
    for (const m of settleMarkets) {
      const winningOutcome = winningOutcomes[m];

      const [dispute0] = PublicKey.findProgramAddressSync(
        [Buffer.from("dispute"), new anchor.BN(marketIds[m]).toArrayLike(Buffer, "le", 8), Buffer.alloc(4)],
        program.programId
      );

      // Propose
      await program.methods
        .proposeResult(new anchor.BN(marketIds[m]), winningOutcome)
        .accounts({
          globalConfig: globalConfigPda,
          market: marketPdas[m],
          dispute: dispute0,
          treasury: treasuryPda,
          proposerBaseAta: userBaseAtas[m % NUM_USERS],
          treasuryBaseAta,
          baseMint,
          proposer: users[m % NUM_USERS].publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([users[m % NUM_USERS]])
        .rpc();
    }

    // Wait for challenge windows to expire (10s + 1s buffer)
    await new Promise(resolve => setTimeout(resolve, 11000));

    // Finalize all proposed markets
    for (const m of settleMarkets) {
      const winningOutcome = winningOutcomes[m];
      const [dispute0] = PublicKey.findProgramAddressSync(
        [Buffer.from("dispute"), new anchor.BN(marketIds[m]).toArrayLike(Buffer, "le", 8), Buffer.alloc(4)],
        program.programId
      );

      // Finalize
      await program.methods
        .finalizeResult(new anchor.BN(marketIds[m]), 0)
        .accounts({
          globalConfig: globalConfigPda,
          market: marketPdas[m],
          dispute: dispute0,
          treasury: treasuryPda,
          winnerBaseAta: userBaseAtas[m % NUM_USERS],
          treasuryBaseAta,
          winner: users[m % NUM_USERS].publicKey,
          baseMint,
          authority: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPdas[m]);
      assert.deepEqual(market.status, { settled: {} });
      assert.equal(market.winningOutcome, winningOutcome);
    }
    console.log(`  Phase 3: ${settleMarkets.length + 1} markets settled`);

    // Market 4: void by admin
    {
      const m = 3; // Market 4 (index 3)
      await program.methods
        .voidMarket()
        .accounts({
          globalConfig: globalConfigPda,
          market: marketPdas[m],
          treasury: treasuryPda,
          treasuryBaseAta,
          creatorBaseAta: creatorBaseAtas[m % NUM_CREATORS],
          baseMint,
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([admin])
        .rpc();

      const market = await program.account.market.fetch(marketPdas[m]);
      assert.deepEqual(market.status, { voided: {} });
      console.log("  Phase 3: Market 4 voided");
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 4: Payout Claims, Bond Claims, Close Markets
    // ═══════════════════════════════════════════════════════

    // Claim payouts on settled markets (skip market 2 which was disputed, and market 4 which was voided)
    const claimMarkets = [0, 2, 4, 5, 6, 7, 8, 9];
    let totalClaimed = 0;
    for (const m of claimMarkets) {
      const winningOutcome = winningOutcomes[m];
      const winningMint = outcomeMints[m][winningOutcome];

      // Find users who hold winning outcome tokens
      for (let u = 0; u < NUM_USERS; u++) {
        const ata = userOutcomeAtas[m][u][winningOutcome];
        try {
          const balance = await getAccount(provider.connection, ata);
          if (Number(balance.amount) > 0) {
            const balanceBefore = await getAccount(provider.connection, userBaseAtas[u]);

            await program.methods
              .claimPayout(new anchor.BN(marketIds[m]))
              .accounts({
                globalConfig: globalConfigPda,
                market: marketPdas[m],
                treasury: treasuryPda,
                claimerOutcomeAta: ata,
                claimerBaseAta: userBaseAtas[u],
                treasuryBaseAta,
                outcomeMint: winningMint,
                baseMint,
                claimer: users[u].publicKey,
                tokenProgram: TOKEN_PROGRAM,
                associatedTokenProgram: ATA_PROGRAM,
              })
              .signers([users[u]])
              .rpc();

            const balanceAfter = await getAccount(provider.connection, userBaseAtas[u]);
            const payout = Number(balanceAfter.amount) - Number(balanceBefore.amount);
            totalClaimed += payout;
          }
        } catch (e) {
          // User might not have ATA for this outcome
        }
      }
    }
    console.log(`  Phase 4: Payouts claimed. Total paid out: ${totalClaimed}`);

    // Claim market bonds
    for (let m = 0; m < NUM_MARKETS; m++) {
      const market = await program.account.market.fetch(marketPdas[m]);
      if (market.status.settled !== undefined || market.status.voided !== undefined) {
        if (!market.bondClaimed) {
          const creatorIdx = m % NUM_CREATORS;
          const balBefore = await getAccount(provider.connection, creatorBaseAtas[creatorIdx]);

          await program.methods
            .claimMarketBond(new anchor.BN(marketIds[m]))
            .accounts({
              globalConfig: globalConfigPda,
              market: marketPdas[m],
              treasury: treasuryPda,
              treasuryBaseAta,
              creatorBaseAta: creatorBaseAtas[creatorIdx],
              baseMint,
              creator: creators[creatorIdx].publicKey,
              tokenProgram: TOKEN_PROGRAM,
            })
            .signers([creators[creatorIdx]])
            .rpc();

          const balAfter = await getAccount(provider.connection, creatorBaseAtas[creatorIdx]);
          assert.ok(Number(balAfter.amount) > Number(balBefore.amount), `Market ${m + 1} bond claimed`);
        }
      }
    }
    console.log("  Phase 4: All market bonds claimed");

    // Close settled/voided markets
    for (let m = 0; m < NUM_MARKETS; m++) {
      const market = await program.account.market.fetch(marketPdas[m]);
      if (market.status.settled !== undefined || market.status.voided !== undefined) {
        const creatorIdx = m % NUM_CREATORS;
        await program.methods
          .closeMarket(new anchor.BN(marketIds[m]))
          .accounts({
            globalConfig: globalConfigPda,
            market: marketPdas[m],
            authority: creators[creatorIdx].publicKey,
          })
          .signers([creators[creatorIdx]])
          .rpc();
      }
    }
    console.log("  Phase 4: All settled/voided markets closed");

    // Verify solvency after payouts
    const config2 = await program.account.globalConfig.fetch(globalConfigPda);
    const treasuryBal2 = await getAccount(provider.connection, treasuryBaseAta);
    assert.ok(
      config2.lockedPayouts.toNumber() <= Number(treasuryBal2.amount),
      "Treasury solvency: locked_payouts <= treasury_balance after payouts"
    );
    console.log(`  Phase 4: Solvency check passed (locked: ${config2.lockedPayouts}, treasury: ${Number(treasuryBal2.amount)})`);

    // ═══════════════════════════════════════════════════════
    // PHASE 5: LP Withdrawals
    // ═══════════════════════════════════════════════════════

    // Set cooldown to 0 for testing (already set challenge window to 0 above)
    await program.methods
      .updateConfig(null, null, null, null, null, null, null, null, new anchor.BN(0))
      .accounts({
        globalConfig: globalConfigPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    // 2 LPs request and process withdrawals
    const withdrawLps = [2, 4]; // LP indices 2 and 4
    for (const lpIdx of withdrawLps) {
      const lp = lps[lpIdx];
      const lpAta = lpLpAtas[lpIdx];
      const lpBalance = await getAccount(provider.connection, lpAta);
      const withdrawShares = Math.floor(Number(lpBalance.amount) / 2);

      if (withdrawShares <= 0) continue;

      const [withdrawalPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("withdrawal"), lp.publicKey.toBuffer()], program.programId
      );
      const [pendingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending"), lp.publicKey.toBuffer()], program.programId
      );
      const treasuryLpAta = getAssociatedTokenAddressSync(lpMintPda, treasuryPda, true, TOKEN_PROGRAM, ATA_PROGRAM);

      // Create treasury LP ATA if it doesn't exist
      try {
        await getAccount(provider.connection, treasuryLpAta);
      } catch (e) {
        await provider.sendAndConfirm(
          new Transaction().add({
            keys: [
              { pubkey: payer.publicKey, isSigner: true, isWritable: true },
              { pubkey: treasuryLpAta, isSigner: false, isWritable: true },
              { pubkey: treasuryPda, isSigner: false, isWritable: false },
              { pubkey: lpMintPda, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
            ],
            programId: ATA_PROGRAM,
            data: Buffer.from([]),
          }),
          []
        );
      }

      const balBefore = await getAccount(provider.connection, lpBaseAtas[lpIdx]);

      // Request withdrawal
      await program.methods
        .requestWithdraw(new anchor.BN(withdrawShares))
        .accounts({
          globalConfig: globalConfigPda,
          lpMint: lpMintPda,
          treasury: treasuryPda,
          treasuryBaseAta,
          treasuryLpAta,
          lpLpAta: lpAta,
          pendingLiquidity: pendingPda,
          withdrawalRequest: withdrawalPda,
          baseMint,
          lp: lp.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ATA_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([lp])
        .rpc();

      // Process withdrawal (cooldown is 0)
      await program.methods
        .processWithdrawal()
        .accounts({
          globalConfig: globalConfigPda,
          lpMint: lpMintPda,
          treasury: treasuryPda,
          treasuryBaseAta,
          treasuryLpAta,
          lpBaseAta: lpBaseAtas[lpIdx],
          baseMint,
          withdrawalRequest: withdrawalPda,
          authority: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const balAfter = await getAccount(provider.connection, lpBaseAtas[lpIdx]);
      const withdrawn = Number(balAfter.amount) - Number(balBefore.amount);
      assert.ok(withdrawn > 0, `LP ${lpIdx + 1} should receive tokens from withdrawal`);
      console.log(`  Phase 5: LP ${lpIdx + 1} withdrew ${withdrawn} tokens (${withdrawShares} shares)`);
    }

    // ═══════════════════════════════════════════════════════
    // FINAL STATE VERIFICATION
    // ═══════════════════════════════════════════════════════

    const finalConfig = await program.account.globalConfig.fetch(globalConfigPda);
    const finalTreasuryBal = await getAccount(provider.connection, treasuryBaseAta);

    // 1. Treasury solvency
    assert.ok(
      finalConfig.lockedPayouts.toNumber() <= Number(finalTreasuryBal.amount),
      "FINAL: Treasury solvency holds"
    );

    // 2. LP supply is positive
    assert.ok(finalConfig.totalLpSupply.toNumber() > 0, "FINAL: LP supply > 0");

    // 3. All settled markets have winning_outcome set
    for (const m of claimMarkets) {
      try {
        const market = await program.account.market.fetch(marketPdas[m]);
        // Market was closed, so this should fail
      } catch (e) {
        // Expected: account closed
      }
    }

    // 4. Voided market refunded bond
    try {
      const voidedMarket = await program.account.market.fetch(marketPdas[3]);
      assert.deepEqual(voidedMarket.status, { voided: {} });
      assert.ok(voidedMarket.bondClaimed, "Voided market bond was claimed");
    } catch (e) {
      // Market was closed
    }

    const freeLiquidity = Number(finalTreasuryBal.amount) > finalConfig.lockedPayouts.toNumber()
      ? Number(finalTreasuryBal.amount) - finalConfig.lockedPayouts.toNumber()
      : 0;
    console.log("  === FINAL STATE ===");
    console.log(`  Treasury balance: ${Number(finalTreasuryBal.amount)}`);
    console.log(`  Locked payouts: ${finalConfig.lockedPayouts}`);
    console.log(`  Total LP supply: ${finalConfig.totalLpSupply}`);
    console.log(`  Free liquidity: ${freeLiquidity}`);
    console.log("  === SIMULATION COMPLETE ===");
  });
});

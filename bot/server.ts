#!/usr/bin/env node
/**
 * TypeScript API Server for Quadratic Market Protocol
 * Uses Anchor framework for proper instruction encoding
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import { 
  createAssociatedTokenAccountIdempotentInstructionWithDerivation,
  createMintToInstruction,
  createInitializeAccount3Instruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const ROOT_DIR = path.join(__dirname, "..", "..");
const DEPLOY_PATH = path.join(ROOT_DIR, "devnet-deployment.json");
const ADMIN_PATH = path.join(ROOT_DIR, "admin.json");
const RPC_URL = "https://api.devnet.solana.com";
const IDL_PATH = path.join(__dirname, "..", "idl.json");

interface Deployment {
  programId: string;
  baseMint: string;
  admin: string;
}

function loadDeployment(): Deployment {
  const data = JSON.parse(fs.readFileSync(DEPLOY_PATH, "utf-8"));
  return {
    programId: data.programId,
    baseMint: data.baseMint,
    admin: data.admin,
  };
}

function loadKeypair(keyPath: string): Keypair {
  const data = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(data));
}

const deploy = loadDeployment();
const adminKeypair = loadKeypair(ADMIN_PATH);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(adminKeypair), { commitment: "confirmed" });
anchor.setProvider(provider);

const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8")) as anchor.Idl;
(idl as any).address = deploy.programId;
const program: any = new anchor.Program(idl, provider);

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const GLOBAL_CONFIG = PublicKey.findProgramAddressSync(
  [Buffer.from("global_config")],
  program.programId
)[0];

const TREASURY = PublicKey.findProgramAddressSync(
  [Buffer.from("treasury")],
  program.programId
)[0];

function marketPDA(marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), new anchor.BN(marketId).toBuffer("le", 8)],
    program.programId
  )[0];
}

function outcomeMintPDA(marketId: number, outcomeId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_mint"), new anchor.BN(marketId).toBuffer("le", 8), Buffer.from([outcomeId])],
    program.programId
  )[0];
}

function marketGroupPDA(groupId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market_group"), new anchor.BN(groupId).toBuffer("le", 8)],
    program.programId
  )[0];
}

function epochPDA(epochId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("epoch"), new anchor.BN(epochId).toBuffer("le", 8)],
    program.programId
  )[0];
}

function ataPDA(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

// Create associated token account instruction (allows PDA owners like TREASURY)
function createATAIx(owner: PublicKey, mint: PublicKey, payer: PublicKey): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstructionWithDerivation(payer, owner, mint, true);
}

console.log("=== Quadratic Market API Server ===");
console.log(`Program: ${deploy.programId}`);
console.log(`Admin: ${adminKeypair.publicKey.toBase58()}`);
console.log(`Base Mint: ${deploy.baseMint}`);

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_, res) => res.json({ ok: true }));

// Create market group (needed before seeding)
app.post("/create-group", async (req, res) => {
  try {
    const { 
      groupId = 1, 
      maxGroupExposure = 10_000_000_000,
      seedFeeShareBps = 1000,
      seedMinVolume = 1_000_000_000,
      seedMaxSideShareBps = 5000,
    } = req.body;

    const group = marketGroupPDA(groupId);
    
    console.log(`create-group: id=${groupId}`);

    // Get current time
    const startTime = Math.floor(Date.now() / 1000) + 86400; // Start in 24 hours

    const tx = await program.methods
      .createMarketGroup(
        new anchor.BN(groupId),
        new anchor.BN(maxGroupExposure),
        new anchor.BN(startTime),
        new anchor.BN(seedFeeShareBps),
        new anchor.BN(seedMinVolume),
        new anchor.BN(seedMaxSideShareBps),
      )
      .accounts({
        globalConfig: GLOBAL_CONFIG,
        marketGroup: group,
        creator: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`  success: ${tx}`);
    res.json({ ok: true, groupId, tx });
  } catch (e: any) {
    console.error("create-group error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Add market to group (needed before seeding)
app.post("/add-market-to-group", async (req, res) => {
  try {
    const { groupId = 1, marketId, marketIndex = 0 } = req.body;
    if (!marketId) throw new Error("marketId required");

    const group = marketGroupPDA(groupId);
    const market = marketPDA(marketId);

    console.log(`add-market-to-group: groupId=${groupId}, marketId=${marketId}, marketIndex=${marketIndex}`);

    const tx = await program.methods
      .addMarketToGroup(new anchor.BN(groupId), marketIndex)
      .accounts({
        globalConfig: GLOBAL_CONFIG,
        marketGroup: group,
        market: market,
        authority: adminKeypair.publicKey,
      })
      .rpc();

    console.log(`  success: ${tx}`);
    res.json({ ok: true, tx });
  } catch (e: any) {
    console.error("add-market-to-group error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Initialize outcome mint
app.post("/init-outcome-mint", async (req, res) => {
  try {
    const { marketId, outcomeId } = req.body;
    if (!marketId || outcomeId === undefined) throw new Error("marketId and outcomeId required");
    
    const market = marketPDA(marketId);
    const mint = outcomeMintPDA(marketId, outcomeId);

    console.log(`init-outcome-mint: marketId=${marketId}, outcomeId=${outcomeId}`);
    console.log(`  market=${market.toBase58()}, mint=${mint.toBase58()}`);

    // Check if mint already exists (idempotent)
    const mintInfo = await connection.getAccountInfo(mint);
    if (mintInfo) {
      console.log(`  mint already exists, skipping`);
      return res.json({ ok: true, mint: mint.toBase58(), tx: "already-exists" });
    }

    const tx = await program.methods
      .initOutcomeMint(new anchor.BN(marketId), outcomeId)
      .accounts({
        globalConfig: GLOBAL_CONFIG,
        market: market,
        outcomeMint: mint,
        payer: adminKeypair.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log(`  success: ${tx}`);
    res.json({ ok: true, mint: mint.toBase58(), tx });
  } catch (e: any) {
    console.error("init-outcome-mint error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Seed market
app.post("/seed-market", async (req, res) => {
  try {
    const { groupId = 1, marketId, marketIndex = 0, outcomeId, amount = 500_000_000 } = req.body;
    if (!marketId || outcomeId === undefined) throw new Error("marketId and outcomeId required");

    const group = marketGroupPDA(groupId);
    const market = marketPDA(marketId);
    const outcomeMint = outcomeMintPDA(marketId, outcomeId);
    const baseMint = new PublicKey(deploy.baseMint);

    const seederBaseAta = ataPDA(adminKeypair.publicKey, baseMint);
    const treasuryBaseAta = ataPDA(TREASURY, baseMint);
    const seederOutcomeAta = ataPDA(adminKeypair.publicKey, outcomeMint);

    console.log(`seed-market: groupId=${groupId}, marketId=${marketId}, marketIndex=${marketIndex}, outcomeId=${outcomeId}, amount=${amount}`);

    // Build transaction with ATA creation
    const tx = new Transaction();
    
    // Add ATA creation instructions if needed
    tx.add(createATAIx(adminKeypair.publicKey, baseMint, adminKeypair.publicKey));
    tx.add(createATAIx(TREASURY, baseMint, adminKeypair.publicKey));
    tx.add(createATAIx(adminKeypair.publicKey, outcomeMint, adminKeypair.publicKey));

    // Add the register seed position instruction
    tx.add(
      await program.methods
        .registerSeedPosition(new anchor.BN(groupId), new anchor.BN(marketId), marketIndex, outcomeId, new anchor.BN(amount))
        .accounts({
          globalConfig: GLOBAL_CONFIG,
          marketGroup: group,
          market: market,
          treasury: TREASURY,
          seederBaseAta: seederBaseAta,
          treasuryBaseAta: treasuryBaseAta,
          outcomeMint: outcomeMint,
          seederOutcomeAta: seederOutcomeAta,
          baseMint: baseMint,
          seeder: adminKeypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction()
    );

    const signature = await provider.sendAndConfirm(tx);
    console.log(`  success: ${signature}`);
    res.json({ ok: true, tx: signature });
  } catch (e: any) {
    console.error("seed-market error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Activate market
app.post("/activate-market", async (req, res) => {
  try {
    const { groupId = 1, marketId } = req.body;
    if (!marketId) throw new Error("marketId required");

    const group = marketGroupPDA(groupId);
    const market = marketPDA(marketId);

    console.log(`activate-market: groupId=${groupId}, marketId=${marketId}`);

    const tx = await program.methods
      .activateSeededMarket(new anchor.BN(groupId))
      .accounts({
        globalConfig: GLOBAL_CONFIG,
        marketGroup: group,
        market: market,
        authority: adminKeypair.publicKey,
      })
      .rpc();

    console.log(`  success: ${tx}`);
    res.json({ ok: true, tx });
  } catch (e: any) {
    console.error("activate-market error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Buy shares (place bet)
app.post("/buy-shares", async (req, res) => {
  try {
    const { marketId, outcomeId, numShares, maxPayment } = req.body;
    if (marketId === undefined || outcomeId === undefined) {
      throw new Error("marketId and outcomeId required");
    }
    
    const num = numShares || 1000000; // Default 1 share (1e6 with decimals)
    const max = maxPayment || num * 10; // Default max payment 10x shares
    
    const market = marketPDA(marketId);
    const baseMint = new PublicKey(deploy.baseMint);
    const outcomeMint = outcomeMintPDA(marketId, outcomeId);
    
    // Get ATAs
    const buyerBaseAta = ataPDA(adminKeypair.publicKey, baseMint);
    const treasuryBaseAta = ataPDA(TREASURY, baseMint);
    const buyerOutcomeAta = ataPDA(adminKeypair.publicKey, outcomeMint);
    
    console.log(`buy-shares: marketId=${marketId}, outcomeId=${outcomeId}, numShares=${num}, maxPayment=${max}`);
    
    // Create transaction with ATA creation
    const tx = new Transaction();
    
    // Add ATA creation if needed
    tx.add(createATAIx(adminKeypair.publicKey, baseMint, adminKeypair.publicKey));
    tx.add(createATAIx(adminKeypair.publicKey, outcomeMint, adminKeypair.publicKey));
    
    // Add buy instruction
    tx.add(
      await program.methods
        .buyShares(outcomeId, new anchor.BN(num), new anchor.BN(max))
        .accounts({
          globalConfig: GLOBAL_CONFIG,
          market: market,
          treasury: TREASURY,
          buyerBaseAta: buyerBaseAta,
          treasuryBaseAta: treasuryBaseAta,
          buyerOutcomeAta: buyerOutcomeAta,
          outcomeMint: outcomeMint,
          baseMint: baseMint,
          buyer: adminKeypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction()
    );
    
    const signature = await provider.sendAndConfirm(tx);
    console.log(`  success: ${signature}`);
    res.json({ ok: true, tx: signature });
  } catch (e: any) {
    console.error("buy-shares error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Add to group
app.post("/add-to-group", async (req, res) => {
  try {
    const { groupId, marketId } = req.body;
    if (groupId === undefined || marketId === undefined) throw new Error("groupId and marketId required");

    const group = marketGroupPDA(groupId);
    const market = marketPDA(marketId);

    // Fetch group to get numMarkets for marketIndex
    const groupData = await program.account.marketGroup.fetch(group);
    const marketIndex = (groupData as any).numMarkets;

    console.log(`add-to-group: groupId=${groupId}, marketId=${marketId}, marketIndex=${marketIndex}`);

    const tx = await program.methods
      .addMarketToGroup(new anchor.BN(groupId), new anchor.BN(marketId), marketIndex)
      .accounts({
        globalConfig: GLOBAL_CONFIG,
        marketGroup: group,
        market: market,
        payer: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`  success: ${tx}`);
    res.json({ ok: true, marketIndex, tx });
  } catch (e: any) {
    console.error("add-to-group error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Place order (buy shares with swap for fixed-odds markets)
app.post("/place-order", async (req, res) => {
  try {
    const { marketId, outcomeId, amount, maxCost, minBaseFromSwap = 0 } = req.body;
    if (!marketId || outcomeId === undefined || !amount) throw new Error("marketId, outcomeId, and amount required");

    const market = marketPDA(marketId);
    const outcomeMint = outcomeMintPDA(marketId, outcomeId);
    const baseMint = new PublicKey(deploy.baseMint);

    const buyerBaseAta = ataPDA(adminKeypair.publicKey, baseMint);
    const buyerOutcomeAta = ataPDA(adminKeypair.publicKey, outcomeMint);
    const treasuryBaseAta = ataPDA(TREASURY, baseMint);

    console.log(`place-order: marketId=${marketId}, outcomeId=${outcomeId}, amount=${amount}, maxCost=${maxCost}`);

    // Build transaction with ATA creation
    const tx = new Transaction();
    
    // Add ATA creation instructions
    tx.add(createATAIx(adminKeypair.publicKey, baseMint, adminKeypair.publicKey));
    tx.add(createATAIx(adminKeypair.publicKey, outcomeMint, adminKeypair.publicKey));

    // Add the buy shares with swap instruction
    tx.add(
      await program.methods
        .buySharesWithSwap(outcomeId, new anchor.BN(amount), new anchor.BN(maxCost || amount * 2), new anchor.BN(minBaseFromSwap))
        .accounts({
          globalConfig: GLOBAL_CONFIG,
          market: market,
          treasury: TREASURY,
          buyerBaseAta: buyerBaseAta,
          treasuryBaseAta: treasuryBaseAta,
          buyerOutcomeAta: buyerOutcomeAta,
          outcomeMint: outcomeMint,
          baseMint: baseMint,
          buyer: adminKeypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction()
    );

    const signature = await provider.sendAndConfirm(tx);
    console.log(`  success: ${signature}`);
    res.json({ ok: true, tx: signature });
  } catch (e: any) {
    console.error("place-order error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Place slip (open a conditional order) - complex encoding, not yet implemented
// app.post("/place-slip", async (req, res) => { ... });

// Initialize epoch (needed before creating markets)
// Uses global_config.current_epoch for the epoch ID
app.post("/init-epoch", async (req, res) => {
  try {
    // First read current_epoch from global config
    const gcData = await connection.getAccountInfo(GLOBAL_CONFIG, 'confirmed');
    if (!gcData) {
      return res.status(500).json({ error: "GlobalConfig not found" });
    }
    
    // Parse global config to get current_epoch
    // Layout: discriminator(8) + admin(32) + paused(1) + oracle(32) + max_exposure(8) + locked_payouts(8) + 
    // total_lp_supply(8) + lp_mint(32) + base_mint(32) + treasury(32) + treasury_bump(1) + 
    // next_market_id(8) + challenge_window(8) + settlement_deadline(8) + odds_basis(8) + 
    // lmsr_default_b(8) + min_first_liquidity(8) + slip_house_margin_bps(8) + 
    // max_slip_bonus_multiplier_bps(8) + next_slip_id(8) + current_epoch(8)
    const data = gcData.data.slice(8); // Skip discriminator
    
    let offset = 32 + 1 + 32 + 8 + 8 + 8 + 32 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8;
    // = 264
    const currentEpoch = Number(data.readBigUInt64LE(offset));
    
    console.log(`init-epoch: current_epoch=${currentEpoch}`);
    
    const epoch = epochPDA(Number(currentEpoch));
    console.log(`  epoch pda=${epoch.toBase58()}`);
    
    const tx = await program.methods
      .initEpoch()
      .accounts({
        globalConfig: GLOBAL_CONFIG,
        epoch: epoch,
        authority: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log(`  success: ${tx}`);
    res.json({ ok: true, epochId: currentEpoch, tx });
  } catch (e) {
    const err = e as Error;
    console.error("init-epoch error:", err?.message || String(e));
    res.status(500).json({ error: err?.message || "Unknown error" });
  }
});

// Get protocol configuration (for frontend wallet integration)
app.get("/protocol-config", async (req, res) => {
  try {
    const baseMint = new PublicKey(deploy.baseMint);
    
    // Derive treasury (PDA-based)
    const treasury = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      new PublicKey(deploy.programId)
    )[0];
    
    // For treasury (a PDA), we need to manually derive ATA
    // ATA = PDA([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATOKEN_PROGRAM_ID)
    const treasuryAta = PublicKey.findProgramAddressSync(
      [treasury.toBuffer(), new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(), baseMint.toBuffer()],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    )[0];
    
    // Get current slip ID from global config if available
    let nextSlipId = 1;
    try {
      const gcData = await connection.getAccountInfo(GLOBAL_CONFIG, 'confirmed');
      if (gcData && gcData.data.length > 266) {
        // GlobalConfig layout (after 8-byte discriminator):
        // admin(32) + paused(1) + oracle(32) + max_market_exposure(8) + locked_payouts(8) + 
        // total_lp_supply(8) + lp_mint(32) + base_mint(32) + treasury(32) + treasury_bump(1) +
        // next_market_id(8) + challenge_window(8) + settlement_deadline(8) + odds_basis(8) +
        // lmsr_default_b(8) + min_first_liquidity(8) + slip_house_margin_bps(8) + 
        // max_slip_bonus_multiplier_bps(8) + next_slip_id(8) + ...
        // next_slip_id is at offset 258 in data (after discriminator)
        nextSlipId = Number(gcData.data.readBigUInt64LE(258)) + 1;
      }
    } catch (err) {
      console.log("Could not read slip ID:", err);
    }
    
    res.json({
      ok: true,
      program_id: deploy.programId,
      base_mint: deploy.baseMint,
      treasury: treasury.toBase58(),
      treasury_base_ata: treasuryAta.toBase58(),
      rpc_url: RPC_URL,
      next_slip_id: nextSlipId,
    });
  } catch (e) {
    const err = e as Error;
    console.error("protocol-config error:", err?.message || String(e));
    res.status(500).json({ error: err?.message || "Unknown error" });
  }
});

// Mint test USDC to recipient ATA
app.post("/mint-usdc", async (req, res) => {
  try {
    const { recipient, amount = 1000000 } = req.body; // amount in micro-USDC
    
    if (!recipient) {
      return res.status(400).json({ ok: false, error: "recipient is required" });
    }
    
    const recipientPubkey = new PublicKey(recipient);
    const baseMint = new PublicKey(deploy.baseMint);
    
    // Derive the ATA address
    const ata = getAssociatedTokenAddressSync(baseMint, recipientPubkey);
    
    // Check if ATA exists
    const ataInfo = await connection.getAccountInfo(ata);
    
    const instructions: TransactionInstruction[] = [];
    
    if (!ataInfo) {
      // Create ATA using system program
      instructions.push(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: adminKeypair.publicKey,
          newAccountPubkey: ata,
          space: 165,
          lamports: await connection.getMinimumBalanceForRentExemption(165),
          programId: TOKEN_PROGRAM_ID,
        })
      );
      
      // Initialize the token account
      instructions.push(
        createInitializeAccount3Instruction(ata, baseMint, recipientPubkey)
      );
    }
    
    // Mint to ATA
    instructions.push(createMintToInstruction(
      baseMint,
      ata,
      adminKeypair.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    ));
    
    const tx = new Transaction().add(...instructions);
    const signature = await anchor.web3.sendAndConfirmTransaction(connection, tx, [adminKeypair]);
    
    res.json({ ok: true, ata: ata.toBase58(), tx: signature });
  } catch (e: any) {
    console.error("mint-usdc error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Create market
app.post("/create-market", async (req, res) => {
  try {
    const { 
      marketId,
      startTime = Math.floor(Date.now() / 1000) + 86400,
      numOutcomes = 3,
      title = "Test Market",
      description = "Test",
      category = 0,
      lmsrB = 1000000000,
      qValues = [50000000, 50000000, 50000000],
    } = req.body;

    // Get current_epoch from global config
    const gcData = await connection.getAccountInfo(GLOBAL_CONFIG, 'confirmed');
    if (!gcData) {
      return res.status(500).json({ error: "GlobalConfig not found" });
    }
    
    const data = gcData.data.slice(8);
    let offset = 32 + 1 + 32 + 8 + 8 + 8 + 32 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8;
    const currentEpoch = Number(data.readBigUInt64LE(offset));
    
    const market = marketPDA(marketId);
    const epoch = epochPDA(currentEpoch);

    console.log(`create-market: id=${marketId}, epoch=${currentEpoch}, title=${title}, category=${category}`);

    const tx = await program.methods
      .createMarket(
        new anchor.BN(startTime),
        numOutcomes,
        title,
        description,
        category,
        new anchor.BN(lmsrB),
        qValues.map((v: number) => new anchor.BN(v)),
        { trading: {} }  // MarketMode::Trading
      )
      .accounts({
        globalConfig: GLOBAL_CONFIG,
        market: market,
        epoch: epoch,
        authority: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log(`  success: ${tx}`);
    res.json({ ok: true, marketId, tx });
  } catch (e: any) {
    console.error("create-market error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get open markets with odds
app.get("/markets", async (req, res) => {
  try {
    const markets = [];
    
    // Try to fetch market 21 if it exists
    const marketPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from("21")],
      new PublicKey(deploy.programId)
    )[0];
    
    const marketData = await connection.getAccountInfo(marketPDA, 'confirmed');
    
    if (marketData && marketData.data.length > 0) {
      // Market exists - decode from on-chain data
      // New Anchor format stores data after 8-byte discriminator
      const dataWithoutDiscriminator = marketData.data.slice(8);
      
      // Simple manual decoding for market account
      // Layout: title (String), category (u8), numOutcomes (u8), qValues (Vec<u64>), status (u8), ...
      let offset = 4; // Skip disc and title length prefix
      
      // Read title
      const titleLen = dataWithoutDiscriminator.readUInt32LE(offset);
      offset += 4;
      const title = dataWithoutDiscriminator.slice(offset, offset + titleLen).toString('utf8');
      offset += titleLen;
      
      // Read category and numOutcomes
      const category = dataWithoutDiscriminator[offset] || 0;
      offset += 1;
      const numOutcomes = dataWithoutDiscriminator[offset] || 2;
      offset += 1;
      
      // Read qValues array (Vec<u64>)
      const qValuesLen = dataWithoutDiscriminator.readUInt32LE(offset);
      offset += 4;
      const qValues = [];
      for (let i = 0; i < qValuesLen; i++) {
        const val = dataWithoutDiscriminator.readBigUInt64LE(offset);
        qValues.push(Number(val));
        offset += 8;
      }
      
      // Read status (after qValues)
      const status = dataWithoutDiscriminator[offset] || 0;
      const isActive = status === 1;
      
      // Build outcomes
      const outcomes = [];
      const outcomeNames: Record<number, string[]> = {
        0: ["Home", "Draw", "Away"],  // Match Result
        1: ["Yes", "No"],             // BTTS
        2: ["Over", "Under"],         // Over/Under
      };
      
      const names = outcomeNames[category] || ["Outcome 0", "Outcome 1"];
      for (let i = 0; i < numOutcomes; i++) {
        const qValue = qValues[i] || 50000000;
        // Calculate decimal odds: e^(-q/B) where B is liquidity parameter
        // Simplified: odds = 1e9 / qValue
        const odds = qValue > 0 ? Math.round((1e9 / qValue) * 100) / 100 : 2.0;
        
        outcomes.push({
          id: i,
          name: names[i] || `Outcome ${i}`,
          odds: odds > 0 ? odds : 2.0,
          enabled: isActive,
          qValue: qValue,
        });
      }
      
      markets.push({
        marketId: 21,
        title: title,
        category: category,
        numOutcomes: numOutcomes,
        isActive: isActive,
        outcomes: outcomes,
      });
    } else {
      // No market exists - return empty or placeholder
      // Return empty array so frontend can handle gracefully
      markets.push({
        marketId: 21,
        title: "No active markets",
        category: 0,
        numOutcomes: 0,
        isActive: false,
        outcomes: [],
      });
    }
    
    res.json({ markets });
  } catch (e: any) {
    console.error("markets error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get odds table with all market types (for frontend display)
app.get("/odds-table", async (req, res) => {
  try {
    const marketTypes = [
      { key: "h2h", name: "Match Result", category: 0, outcomes: 3, labels: ["Home", "Draw", "Away"] },
      { key: "btts", name: "Both Teams To Score", category: 1, outcomes: 2, labels: ["Yes", "No"] },
      { key: "totals", name: "Over/Under 2.5", category: 2, outcomes: 2, labels: ["Over 2.5", "Under 2.5"] },
      { key: "draw_no_bet", name: "Draw No Bet", category: 3, outcomes: 2, labels: ["Home", "Away"] },
      { key: "double_chance", name: "Double Chance", category: 4, outcomes: 3, labels: ["1X", "12", "X2"] },
      { key: "first_half_h2h", name: "1st Half Result", category: 5, outcomes: 3, labels: ["Home", "Draw", "Away"] },
      { key: "gg_ng", name: "GG/NG", category: 6, outcomes: 2, labels: ["GG", "NG"] },
      { key: "odd_even", name: "Odd/Even", category: 7, outcomes: 2, labels: ["Odd", "Even"] },
    ];
    
    const result: any = { markets: [], fixture: null };
    const activeMarkets: Map<number, any> = new Map();
    const programId = new PublicKey(deploy.programId);
    
    // Use program.account.market to properly deserialize
    for (let marketId = 1; marketId <= 30; marketId++) {
      try {
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64LE(BigInt(marketId), 0);
        const marketPda = PublicKey.findProgramAddressSync(
          [Buffer.from("market"), buf],
          programId
        )[0];
        
        // Try to fetch using Anchor type
        let marketAccount;
        try {
          marketAccount = await program.account.market.fetch(marketPda);
        } catch {
          // Account doesn't exist or can't be deserialized
          continue;
        }
        
        // Market account structure (from IDL):
        // marketId, creator, startTime, status, numOutcomes, qValues, 
        // exposure, settlementTime, winningOutcome, outcomeMints, lmsrB,
        // title, description, category, bump, groupId, groupMarketIndex, 
        // marketMode, epochId, settledInEpoch, backing, seedFeePool, lockedPayout
        
        const status = marketAccount.status;
        const numOutcomes = marketAccount.numOutcomes;
        const qValues = marketAccount.qValues;
        const title = marketAccount.title;
        const category = marketAccount.category;
        
        // Status is an Anchor enum: { preOpen: {} } | { open: {} } | { suspended: {} } | etc.
        // Check which status variant is set
        const isActive = 'open' in status;
        
        // Sum q values for probability calculation
        let sumQ = 0;
        for (const q of qValues) {
          sumQ += Number(q);
        }
        
        if (isActive && category >= 0 && category <= 7) {
          const marketType = marketTypes.find(m => m.category === category);
          if (marketType) {
            const outcomes = [];
            for (let i = 0; i < marketType.outcomes && i < qValues.length; i++) {
              const qValue = Number(qValues[i]) || 50000000;
              sumQ = sumQ || 1;
              const probability = qValue / sumQ;
              const odds = probability > 0 ? Math.round((1 / probability) * 100) / 100 : 2.0;
              
              outcomes.push({
                id: i,
                name: marketType.labels[i] || `Outcome ${i}`,
                odds: odds > 0 ? odds : 2.0,
                enabled: true,
                qValue: qValue,
              });
            }
            
            activeMarkets.set(category, {
              marketId: marketId,
              title: title || "Market " + marketId,
              category: category,
              key: marketType.key,
              marketTypeName: marketType.name,
              isActive: true,
              outcomes: outcomes,
            });
          }
        }
      } catch (e) {
        console.log(`Skipping market ${marketId}: ${e}`);
      }
    }
    
    // Build result with all market types
    for (const mt of marketTypes) {
      if (activeMarkets.has(mt.category)) {
        result.markets.push(activeMarkets.get(mt.category));
      } else {
        const outcomes = mt.labels.map((label, i) => ({
          id: i,
          name: label,
          odds: 0,
          enabled: false,
          qValue: 0,
        }));
        
        result.markets.push({
          marketId: null,
          title: "No market created",
          category: mt.category,
          key: mt.key,
          marketTypeName: mt.name,
          isActive: false,
          outcomes: outcomes,
        });
      }
    }
    
    result.fixture = {
      homeTeam: "Team A",
      awayTeam: "Team B",
      startTime: Date.now() + 86400000,
    };
    
    res.json(result);
  } catch (e: any) {
    console.error("odds-table error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// View single market details
app.get("/view-market/:marketId", async (req, res) => {
  try {
    const marketId = parseInt(req.params.marketId);
    if (isNaN(marketId)) {
      return res.status(400).json({ error: "Invalid market ID" });
    }
    
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(marketId), 0);
    const marketPda = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), buf],
      new PublicKey(deploy.programId)
    )[0];
    
    let marketAccount;
    try {
      marketAccount = await program.account.market.fetch(marketPda);
    } catch {
      return res.status(404).json({ error: "Market not found" });
    }
    
    // Calculate sum of q values
    let sumQ = 0;
    const qValues = [];
    for (const q of marketAccount.qValues) {
      const val = Number(q);
      qValues.push(val);
      sumQ += val;
    }
    
    // Calculate odds
    const outcomes = qValues.map((q, i) => {
      const probability = sumQ > 0 ? q / sumQ : 0;
      const odds = probability > 0 ? Math.round((1 / probability) * 100) / 100 : 0;
      return {
        id: i,
        qValue: q,
        probability: Math.round(probability * 10000) / 10000,
        odds: odds,
      };
    });
    
    // Determine status string
    let statusStr = "Unknown";
    if ('open' in marketAccount.status) statusStr = 'open';
    else if ('preOpen' in marketAccount.status) statusStr = 'preOpen';
    else if ('suspended' in marketAccount.status) statusStr = 'suspended';
    else if ('awaitingResult' in marketAccount.status) statusStr = 'awaitingResult';
    else if ('settled' in marketAccount.status) statusStr = 'settled';
    else if ('voided' in marketAccount.status) statusStr = 'voided';
    
    res.json({
      marketId: marketId,
      marketPda: marketPda.toBase58(),
      title: marketAccount.title,
      category: marketAccount.category,
      status: marketAccount.status,
      statusName: statusStr,
      numOutcomes: marketAccount.numOutcomes,
      qValues: qValues,
      sumQ: sumQ,
      outcomes: outcomes,
      lmsrB: Number(marketAccount.lmsrB),
      startTime: Number(marketAccount.startTime),
      epochId: Number(marketAccount.epochId),
      groupId: marketAccount.groupId ? Number(marketAccount.groupId) : null,
      groupMarketIndex: marketAccount.groupMarketIndex ? Number(marketAccount.groupMarketIndex) : null,
    });
  } catch (e: any) {
    console.error("view-market error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get all market groups (fixtures)
app.get("/market-groups", async (req, res) => {
  try {
    const groups = [];
    const programId = new PublicKey(deploy.programId);
    
    // Query groups 1-20
    for (let groupId = 1; groupId <= 20; groupId++) {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(BigInt(groupId), 0);
      const groupPda = PublicKey.findProgramAddressSync(
        [Buffer.from("market_group"), buf],
        programId
      )[0];
      
      try {
        const groupInfo = await connection.getAccountInfo(groupPda, 'confirmed');
        if (!groupInfo || groupInfo.data.length < 100) continue;
        
        const data = groupInfo.data.slice(8); // Skip discriminator
        
        // Parse fields: group_id(8) + creator(32) + total_exposure(8) + max_exposure(8) + num_markets(1) + market_ids(64)
        let offset = 8 + 8 + 32 + 8 + 8; // Skip to num_markets
        const numMarkets = data[offset];
        offset += 1;
        
        // Get market IDs
        const marketIds = [];
        for (let i = 0; i < 8; i++) {
          const mktId = Number(data.readBigUInt64LE(offset));
          offset += 8;
          if (mktId > 0) marketIds.push(mktId);
        }
        
        if (marketIds.length === 0) continue;
        
        // Parse title - after correlations, states, etc.
        // Title is at the end: title(String) + bump(1)
        // We need to find it by scanning backwards or use the IDL layout
        // For now, use "Match {groupId}" as placeholder
        const title = `Match ${groupId}`;
        
        // Fetch each market's details
        const markets = [];
        for (const mId of marketIds) {
          try {
            const mBuf = Buffer.alloc(8);
            mBuf.writeBigUInt64LE(BigInt(mId), 0);
            const mPda = PublicKey.findProgramAddressSync(
              [Buffer.from("market"), mBuf],
              programId
            )[0];
            
            const mData = await program.account.market.fetch(mPda);
            
            // Determine status
            let status = 'inactive';
            let statusName = 'Inactive';
            if ('open' in mData.status) {
              status = 'open';
              statusName = 'Open';
            } else if ('preOpen' in mData.status) {
              status = 'preOpen';
              statusName = 'Pre-Open';
            } else if ('suspended' in mData.status) {
              status = 'suspended';
              statusName = 'Suspended';
            }
            
            // Calculate odds
            let sumQ = 0;
            const qValues = [];
            for (const q of mData.qValues) {
              const val = Number(q);
              qValues.push(val);
              sumQ += val;
            }
            
            const outcomes = qValues.slice(0, mData.numOutcomes).map((q, idx) => {
              const probability = sumQ > 0 ? q / sumQ : 0;
              const odds = probability > 0 ? Math.round((1 / probability) * 100) / 100 : 0;
              return {
                id: idx,
                name: idx === 0 ? 'Home' : idx === 1 ? 'Draw' : idx === 2 ? 'Away' : `Outcome ${idx}`,
                odds: odds,
                qValue: q,
                enabled: status === 'open',
              };
            });
            
            markets.push({
              marketId: mId,
              title: mData.title,
              category: mData.category,
              status: status,
              statusName: statusName,
              numOutcomes: mData.numOutcomes,
              outcomes: outcomes,
              startTime: Number(mData.startTime),
            });
          } catch {
            // Market not found, skip
          }
        }
        
        if (markets.length > 0) {
          groups.push({
            groupId: groupId,
            title: title,
            startTime: null,
            markets: markets,
            numMarkets: markets.length,
          });
        }
      } catch {
        // Group doesn't exist
      }
    }
    
    res.json({ groups });
  } catch (e: any) {
    console.error("market-groups error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get single market group
app.get("/market-group/:groupId", async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: "Invalid group ID" });
    }
    
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(groupId), 0);
    const groupPda = PublicKey.findProgramAddressSync(
      [Buffer.from("market_group"), buf],
      new PublicKey(deploy.programId)
    )[0];
    
    const groupInfo = await connection.getAccountInfo(groupPda, 'confirmed');
    if (!groupInfo || groupInfo.data.length < 100) {
      return res.status(404).json({ error: "Market group not found" });
    }
    
    const data = groupInfo.data.slice(8);
    
    // Parse market IDs
    const marketIds = [];
    let offset = 8 + 8 + 32 + 8 + 8 + 1; // Skip to market_ids
    for (let i = 0; i < 8; i++) {
      const mktId = Number(data.readBigUInt64LE(offset));
      offset += 8;
      if (mktId > 0) marketIds.push(mktId);
    }
    
    const markets = [];
    const programId = new PublicKey(deploy.programId);
    
    for (const mId of marketIds) {
      try {
        const mBuf = Buffer.alloc(8);
        mBuf.writeBigUInt64LE(BigInt(mId), 0);
        const mPda = PublicKey.findProgramAddressSync(
          [Buffer.from("market"), mBuf],
          programId
        )[0];
        
        const mData = await program.account.market.fetch(mPda);
        
        // Determine status
        let status = 'inactive';
        if ('open' in mData.status) status = 'open';
        else if ('preOpen' in mData.status) status = 'preOpen';
        
        // Calculate odds
        let sumQ = 0;
        const qValues = [];
        for (const q of mData.qValues) {
          const val = Number(q);
          qValues.push(val);
          sumQ += val;
        }
        
        const outcomes = qValues.slice(0, mData.numOutcomes).map((q, idx) => {
          const probability = sumQ > 0 ? q / sumQ : 0;
          const odds = probability > 0 ? Math.round((1 / probability) * 100) / 100 : 0;
          return {
            id: idx,
            name: idx === 0 ? 'Home' : idx === 1 ? 'Draw' : idx === 2 ? 'Away' : `Outcome ${idx}`,
            odds: odds,
            qValue: q,
            enabled: status === 'open',
          };
        });
        
        markets.push({
          marketId: mId,
          title: mData.title,
          category: mData.category,
          status: status,
          statusName: status === 'open' ? 'Open' : status === 'preOpen' ? 'Pre-Open' : 'Inactive',
          numOutcomes: mData.numOutcomes,
          outcomes: outcomes,
          startTime: Number(mData.startTime),
        });
      } catch {
        // Skip invalid markets
      }
    }
    
    res.json({
      groupId: groupId,
      groupPda: groupPda.toBase58(),
      title: `Match ${groupId}`,
      startTime: null,
      markets: markets,
      numMarkets: markets.length,
    });
  } catch (e: any) {
    console.error("market-group error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Football API Routes ──────────────────────────────────────────

import { footballRouter } from "./footballApi";
app.use("/football", footballRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n=== API Server running on port ${PORT} ===`);
  console.log(`Health: GET http://localhost:${PORT}/health`);
  console.log(`Markets: GET http://localhost:${PORT}/markets`);
  console.log(`Odds Table: GET http://localhost:${PORT}/odds-table`);
  console.log(`Create Market: POST http://localhost:${PORT}/create-market`);
  console.log(`Init outcome mint: POST http://localhost:${PORT}/init-outcome-mint`);
  console.log(`Seed market: POST http://localhost:${PORT}/seed-market`);
  console.log(`Activate market: POST http://localhost:${PORT}/activate-market`);
  console.log(`Place order: POST http://localhost:${PORT}/place-order`);
});

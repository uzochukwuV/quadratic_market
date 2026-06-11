/**
 * Initialize Quadratic Market Protocol on Devnet
 * 
 * This script initializes the protocol with default parameters
 * suitable for testing on devnet.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo
} from "@solana/spl-token";
import { QuadraticMarket } from "../target/types/quadratic_market";
import * as fs from "fs";

// Default parameters
const DEFAULT_MAX_EXPOSURE = new anchor.BN("10000000000000"); // 10M USDC
const DEFAULT_MAX_SLIP_BONUS = new anchor.BN("30000"); // 3.0x (30000 bps)
const DEFAULT_CHALLENGE_WINDOW = new anchor.BN("300"); // 5 minutes
const DEFAULT_SETTLEMENT_DEADLINE = new anchor.BN("14400"); // 4 hours
const DEFAULT_EPOCH_DURATION = new anchor.BN("86400"); // 24 hours
const DEFAULT_WITHDRAWAL_COOLDOWN = new anchor.BN("86400"); // 24 hours
const DEFAULT_BUY_FEE_BPS = new anchor.BN("100"); // 1%

async function main() {
  // Configure provider
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.QuadraticMarket as Program<QuadraticMarket>;
  const admin = provider.wallet as Wallet;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Quadratic Market - Devnet Initialization              ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`Admin: ${admin.publicKey.toBase58()}`);
  console.log(`Cluster: ${provider.connection.rpcEndpoint}\n`);

  // Step 1: Create base mint (test USDC)
  console.log("──────────────────────────────────────────────────────────");
  console.log("Step 1: Creating Base Mint (Test USDC)...");
  console.log("──────────────────────────────────────────────────────────");
  
  const baseMint = await createMint(
    provider.connection,
    admin.payer,
    admin.publicKey,
    null,
    6 // USDC decimals
  );
  console.log(`✓ Base Mint created: ${baseMint.toBase58()}\n`);

  // Step 2: Mint some test USDC to admin
  console.log("──────────────────────────────────────────────────────────");
  console.log("Step 2: Minting Test USDC...");
  console.log("──────────────────────────────────────────────────────────");
  
  const adminBaseAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    admin.payer,
    baseMint,
    admin.publicKey
  );
  
  await mintTo(
    provider.connection,
    admin.payer,
    baseMint,
    adminBaseAta.address,
    admin.publicKey,
    10_000_000_000_000 // 10M USDC
  );
  console.log(`✓ Minted 10,000,000 USDC to admin\n`);

  // Step 3: Derive PDAs
  console.log("──────────────────────────────────────────────────────────");
  console.log("Step 3: Deriving Protocol PDAs...");
  console.log("──────────────────────────────────────────────────────────");
  
  const [globalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    program.programId
  );
  
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint")],
    program.programId
  );
  
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  const treasuryBaseAta = await anchor.utils.token.associatedAddress({
    mint: baseMint,
    owner: treasury,
  });

  console.log(`Global Config: ${globalConfig.toBase58()}`);
  console.log(`LP Mint: ${lpMint.toBase58()}`);
  console.log(`Treasury: ${treasury.toBase58()}`);
  console.log(`Treasury Base ATA: ${treasuryBaseAta.toBase58()}\n`);

  // Step 4: Create oracle keypair
  console.log("──────────────────────────────────────────────────────────");
  console.log("Step 4: Creating Oracle Keypair...");
  console.log("──────────────────────────────────────────────────────────");
  
  const oracle = Keypair.generate();
  console.log(`✓ Oracle: ${oracle.publicKey.toBase58()}\n`);

  // Step 5: Initialize protocol
  console.log("──────────────────────────────────────────────────────────");
  console.log("Step 5: Initializing Protocol...");
  console.log("──────────────────────────────────────────────────────────");
  
  try {
    // Convert oracle pubkey to bytes array
    const oraclePubkeyBytes = Array.from(oracle.publicKey.toBytes());
    
    const tx = await program.methods
      .initialize(
        oraclePubkeyBytes,
        DEFAULT_MAX_EXPOSURE
      )
      .accounts({
        baseMint,
        admin: admin.publicKey,
      })
      .rpc();

    console.log(`✓ Protocol initialized!`);
    console.log(`  Signature: ${tx}\n`);
  } catch (error) {
    console.error("✗ Initialization failed:", error);
    throw error;
  }

  // Step 6: Fetch and display config
  console.log("──────────────────────────────────────────────────────────");
  console.log("Step 6: Verifying Configuration...");
  console.log("──────────────────────────────────────────────────────────");
  
  const config = await program.account.globalConfig.fetch(globalConfig);
  
  console.log(`Admin: ${config.admin.toBase58()}`);
  console.log(`Oracle: ${Buffer.from(config.oraclePubkey).toString('hex')}`);
  console.log(`Base Mint: ${config.baseMint.toBase58()}`);
  console.log(`Max Market Exposure: ${config.maxMarketExposure.toString()} lamports`);
  console.log(`Challenge Window: ${config.challengeWindowSeconds.toString()}s`);
  console.log(`Settlement Deadline: ${config.settlementDeadlineSeconds.toString()}s`);
  console.log(`Epoch Duration: ${config.epochDurationSeconds.toString()}s`);
  console.log(`Withdrawal Cooldown: ${config.withdrawalCooldownSeconds.toString()}s`);
  console.log(`Buy Fee: ${config.buyFeeBps.toString()} bps`);
  console.log(`Paused: ${config.paused}`);
  console.log(`Total LP Supply: ${config.totalLpSupply.toString()}`);
  console.log(`Locked Payouts: ${config.lockedPayouts.toString()}\n`);

  // Step 7: Save deployment info
  console.log("──────────────────────────────────────────────────────────");
  console.log("Step 7: Saving Deployment Info...");
  console.log("──────────────────────────────────────────────────────────");
  
  const deploymentInfo = {
    network: "devnet",
    programId: program.programId.toBase58(),
    globalConfig: globalConfig.toBase58(),
    lpMint: lpMint.toBase58(),
    treasury: treasury.toBase58(),
    treasuryBaseAta: treasuryBaseAta.toBase58(),
    baseMint: baseMint.toBase58(),
    oracle: oracle.publicKey.toBase58(),
    admin: admin.publicKey.toBase58(),
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    "devnet-deployment.json",
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Save oracle keypair
  fs.writeFileSync(
    "devnet-oracle-keypair.json",
    JSON.stringify(Array.from(oracle.secretKey))
  );

  console.log(`✓ Saved deployment info to: devnet-deployment.json`);
  console.log(`✓ Saved oracle keypair to: devnet-oracle-keypair.json\n`);

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   ✓ Protocol Initialized Successfully!                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log("Next Steps:");
  console.log("1. Add liquidity: `npm run add-liquidity-devnet`");
  console.log("2. Create markets: `npm run create-market-devnet`");
  console.log("3. Test trading: Place bets and settle markets");
  console.log("\nView on Explorer:");
  console.log(`https://explorer.solana.com/address/${program.programId.toBase58()}?cluster=devnet\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

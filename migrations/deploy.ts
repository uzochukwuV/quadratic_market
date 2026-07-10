// Quadratic Market Protocol Deployment Script
// This script initializes the protocol after deployment

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM } from "@solana/spl-token";
import { QuadraticMarket } from "../target/types/quadratic_market";

// Program ID from Anchor.toml
const PROGRAM_ID = new PublicKey("DEVBnet1111111111111111111111111111111111");

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  const program = new anchor.Program<QuadraticMarket>(
    require("../target/idl/quadratic_market.json"),
    PROGRAM_ID,
    provider
  );

  const admin = provider.wallet.publicKey;
  console.log("Deploying Quadratic Market Protocol...");
  console.log("Admin:", admin.toString());

  // Derive PDAs
  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PROGRAM_ID
  );
  const [lpMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint")],
    PROGRAM_ID
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID
  );

  console.log("Global Config PDA:", globalConfigPda.toString());
  console.log("LP Mint PDA:", lpMintPda.toString());
  console.log("Treasury PDA:", treasuryPda.toString());

  // Check if already initialized
  try {
    const existingConfig = await program.account.globalConfig.fetch(globalConfigPda);
    console.log("Protocol already initialized at:", globalConfigPda.toString());
    console.log("Skipping initialization...");
    return;
  } catch (e) {
    // Not initialized, proceed
    console.log("Protocol not initialized, proceeding with deployment...");
  }

  // For devnet, we use USDC mock as base mint
  // In production, replace with actual USDC mint
  // Devnet USDC mint on Solana: https://spl-token-faucet.com/
  const baseMint = new PublicKey("Gh9ZwEmdLJ8DwrK2fJ1qwYJ5mG4nHHHTq3C1YjWkWBiL2mW");
  
  // Generate oracle keypair for testing
  const oracleKeypair = Keypair.generate();

  console.log("Base Mint:", baseMint.toString());
  console.log("Oracle PublicKey:", oracleKeypair.publicKey.toString());

  try {
    // 1. Initialize the protocol
    console.log("\n1. Initializing protocol...");
    const initializeTx = await program.methods
      .initialize(
        Array.from(oracleKeypair.publicKey.toBytes()),
        new anchor.BN(1_000_000_000) // max_market_exposure: 1000 USDC (6 decimals)
      )
      .accounts({
        globalConfig: globalConfigPda,
        lpMint: lpMintPda,
        treasury: treasuryPda,
        baseMint: baseMint,
        admin: admin,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("Protocol initialized!");
    console.log("Transaction:", initializeTx);

    // 2. Initialize Settlement Council
    console.log("\n2. Initializing Settlement Council...");
    const [settlementCouncilPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("settlement_council")],
      PROGRAM_ID
    );
    console.log("Settlement Council PDA:", settlementCouncilPda.toString());

    const councilTx = await program.methods
      .initializeSettlementCouncil(
        new anchor.BN(100_000_000), // min_stake: 100 USDC
        2 // required_confirmations: 2-of-3
      )
      .accounts({
        globalConfig: globalConfigPda,
        settlementCouncil: settlementCouncilPda,
        authority: admin,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Settlement Council initialized!");
    console.log("Transaction:", councilTx);

    // 3. Initialize the first epoch
    console.log("\n3. Initializing first epoch...");
    const [epochPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("epoch"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    );
    console.log("Epoch 0 PDA:", epochPda.toString());

    const epochTx = await program.methods
      .initEpoch()
      .accounts({
        globalConfig: globalConfigPda,
        epoch: epochPda,
        authority: admin,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Epoch 0 initialized!");
    console.log("Transaction:", epochTx);

    console.log("\n=== Deployment Complete ===");
    console.log("Global Config:", globalConfigPda.toString());
    console.log("Next steps:");
    console.log("1. Add settlement operators with addSettlementOperator");
    console.log("2. Add market operators with addOperator");
    console.log("3. Add initial liquidity with addLiquidity");
    console.log("4. Create markets with createMarket");

  } catch (error) {
    console.error("Deployment failed:", error);
    throw error;
  }
};

// Quadratic Market Protocol Deployment Script
// This script initializes the protocol after deployment

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { QuadraticMarket } from "../target/types/quadratic_market";
import { quadraticMarketProgram } from "../tests/program";

async function main() {
  // Use AnchorProvider.env() which reads from Anchor.toml
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = quadraticMarketProgram(provider);

  const admin = provider.wallet.publicKey;
  console.log("Deploying Quadratic Market Protocol...");
  console.log("Provider cluster:", provider.connection.rpcEndpoint);
  console.log("Admin:", admin.toString());

  // Derive PDAs
  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    program.programId
  );
  const [lpMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint")],
    program.programId
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
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

  // For devnet, we use a custom test mint
  const baseMint = new PublicKey("A8YVMvoxYfJzqqXiq7PDtCkjFp2iWDvn1MnHyzbmUHDx");
  
  // Generate oracle keypair for testing
  const oracleKeypair = Keypair.generate();

  console.log("Base Mint:", baseMint.toString());
  console.log("Oracle PublicKey:", oracleKeypair.publicKey.toString());

  try {
    // 1. Initialize the protocol
    console.log("\n1. Initializing protocol...");
    const initializeIx = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfigPda, isSigner: false, isWritable: true },
        { pubkey: treasuryPda, isSigner: false, isWritable: false },
        { pubkey: baseMint, isSigner: false, isWritable: false },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: program.coder.instruction.encode("initializeProtocol", {
        oraclePubkey: Array.from(oracleKeypair.publicKey.toBytes()),
        maxMarketExposure: new anchor.BN(1_000_000_000), // max_market_exposure: 1000 USDC (6 decimals)
      }),
    });
    const initializeTx = await provider.sendAndConfirm(new Transaction().add(initializeIx), []);

    console.log("Protocol initialized!");
    console.log("Transaction:", initializeTx);

    console.log("\n1b. Initializing LP mint...");
    const lpMintIx = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfigPda, isSigner: false, isWritable: true },
        { pubkey: lpMintPda, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: program.coder.instruction.encode("initializeLpMint", {}),
    });
    const lpMintTx = await provider.sendAndConfirm(new Transaction().add(lpMintIx), []);

    console.log("LP mint initialized!");
    console.log("Transaction:", lpMintTx);

    // 2. Initialize the first epoch
    console.log("\n2. Initializing first epoch...");
    const [epochPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("epoch"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    console.log("Epoch 0 PDA:", epochPda.toString());

    const epochTx = await program.methods
      .initEpoch()
      .accountsStrict({
        globalConfig: globalConfigPda,
        epoch: epochPda,
        authority: admin,
        systemProgram: SystemProgram.programId,
      })
      .signers([])
      .rpc();

    console.log("Epoch 0 initialized!");
    console.log("Transaction:", epochTx);

    console.log("\n=== Deployment Complete ===");
    console.log("Global Config:", globalConfigPda.toString());
    console.log("Next steps:");
    console.log("1. Add authorized operators with addOperator");
    console.log("2. Create markets with createMarket and bind txlineFixtureId");
    console.log("3. Open slips with placeSlipAwait");
    console.log("4. Settle finalized markets with settleWithProof");

  } catch (error) {
    console.error("Deployment failed:", error);
    throw error;
  }
}

// Run main if executed directly
main().catch(console.error);

// Export for anchor deploy
module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  await main();
};

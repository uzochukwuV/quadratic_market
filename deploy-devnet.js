const { Connection, Keypair, Transaction, SystemProgram, PublicKey, TransactionInstruction } = require('@solana/web3.js');
const fs = require('fs');

// Load wallet
const walletData = JSON.parse(fs.readFileSync('/tmp/devnet_wallet.json', 'utf8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

// Load program keypair
const programData = JSON.parse(fs.readFileSync('./target/deploy/quadratic_market-keypair.json', 'utf8'));
const programKeypair = Keypair.fromSecretKey(new Uint8Array(programData));
const programId = programKeypair.publicKey;
console.log(`Program ID: ${programId.toBase58()}`);

// Read program binary
const programBinary = fs.readFileSync('./target/deploy/quadratic_market.so');
console.log(`Program size: ${programBinary.length} bytes`);

// CORRECT BPF Loader Upgradeable address
const BPF_LOADER = new PublicKey('5H8bm4jZZywynv4WwyfRxCr7BfWKXkR5gYfxRoRkBEq5');
console.log(`\n✅ BPF Loader: ${BPF_LOADER.toBase58()}`);

async function deploy() {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Check balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`\n💰 Balance: ${balance / 1e9} SOL`);
    
    // Get rent
    const rentExemption = await connection.getMinimumBalanceForRentExemption(programBinary.length + 128);
    console.log(`📊 Rent needed: ${rentExemption / 1e9} SOL`);
    
    // Check if program already exists
    const existingInfo = await connection.getAccountInfo(programId);
    if (existingInfo) {
        console.log(`\n⚠️ Program account exists`);
        console.log(`   Owner: ${existingInfo.owner.toBase58()}`);
        if (existingInfo.owner.toBase58() === BPF_LOADER.toBase58()) {
            console.log(`   Already deployed!`);
            return;
        }
    }
    
    // Get blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    
    // Create program account
    const createAccountIx = SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: programId,
        lamports: rentExemption,
        space: programBinary.length + 128,
        programId: BPF_LOADER,
    });
    
    const createTx = new Transaction().add(createAccountIx);
    createTx.recentBlockhash = blockhash;
    createTx.feePayer = wallet.publicKey;
    
    console.log('\n🚀 Creating program account...');
    const createSig = await connection.sendTransaction(createTx, [wallet, programKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
    });
    console.log(`✅ TX: ${createSig}`);
    
    await new Promise(r => setTimeout(r, 3000));
    
    // Write program data in chunks
    console.log('\n📝 Writing program data...');
    const chunkSize = 850;
    const numChunks = Math.ceil(programBinary.length / chunkSize);
    
    for (let i = 0; i < numChunks; i++) {
        const chunk = programBinary.slice(i * chunkSize, (i + 1) * chunkSize);
        
        const offsetBuf = Buffer.alloc(8);
        offsetBuf.writeBigUInt64LE(BigInt(i * chunkSize), 0);
        
        const writeData = Buffer.concat([Buffer.from([2]), offsetBuf, chunk]);
        
        const writeIx = new TransactionInstruction({
            programId: BPF_LOADER,
            keys: [{ pubkey: programId, isSigner: false, isWritable: true }],
            data: writeData,
        });
        
        const writeTx = new Transaction().add(writeIx);
        writeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        writeTx.feePayer = wallet.publicKey;
        
        await connection.sendTransaction(writeTx, [wallet], { skipPreflight: true });
        
        if (i % 100 === 0 || i === numChunks - 1) {
            console.log(`   ${Math.min((i + 1) * chunkSize, programBinary.length)}/${programBinary.length} bytes`);
        }
    }
    
    // Finalize
    console.log('\n🔒 Finalizing...');
    const finalizeData = Buffer.from([3]);
    const finalizeIx = new TransactionInstruction({
        programId: BPF_LOADER,
        keys: [{ pubkey: programId, isSigner: false, is_writable: true }],
        data: finalizeData,
    });
    
    const finalizeTx = new Transaction().add(finalizeIx);
    finalizeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    finalizeTx.feePayer = wallet.publicKey;
    
    const finalizeSig = await connection.sendTransaction(finalizeTx, [wallet]);
    console.log(`✅ Finalized: ${finalizeSig}`);
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Verify
    const programInfo = await connection.getAccountInfo(programId);
    if (programInfo) {
        console.log(`\n🎉 DEPLOYMENT SUCCESSFUL!`);
        console.log(`   Address: ${programId.toBase58()}`);
        console.log(`   Owner: ${programInfo.owner.toBase58()}`);
        console.log(`   Size: ${programInfo.data.length} bytes`);
        console.log(`   Executable: ${programInfo.executable}`);
    }
    
    const finalBalance = await connection.getBalance(wallet.publicKey);
    console.log(`\n💰 Final balance: ${finalBalance / 1e9} SOL`);
}

deploy().catch(e => {
    console.error('Deployment failed:', e.message);
    process.exit(1);
});

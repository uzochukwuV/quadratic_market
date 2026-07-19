import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { encodeWithDiscriminator, quadraticMarketProgram } from "../tests/program";

const U64 = (value: number | string | anchor.BN) => new anchor.BN(value);
const i64 = U64;

function pda(programId: PublicKey, seed: string, id?: anchor.BN, extra?: Buffer) {
  const seeds: Buffer[] = [Buffer.from(seed)];
  if (id !== undefined) {
    seeds.push(Buffer.from(id.toArrayLike(Buffer, "le", 8)));
  }
  if (extra) {
    seeds.push(Buffer.from(extra));
  }
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function fetchNullable<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (_err) {
    return null;
  }
}

async function sendIx(
  provider: anchor.AnchorProvider,
  ix: TransactionInstruction,
  signers: Keypair[] = [],
) {
  return provider.sendAndConfirm(new Transaction().add(ix), signers);
}

async function ensureLocalBaseMint(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  mintAuthority: PublicKey,
) {
  const baseMintPath = path.join(process.cwd(), "_keys", "mock-base-mint.localnet.txt");
  if (fs.existsSync(baseMintPath)) {
    const savedMint = new PublicKey(fs.readFileSync(baseMintPath, "utf8").trim());
    const savedMintInfo = await provider.connection.getAccountInfo(savedMint);
    if (savedMintInfo) {
      console.log("base_mint_reused", savedMint.toBase58());
      return savedMint;
    }
  }

  const baseMint = await createMint(provider.connection, payer, mintAuthority, null, 6);
  fs.mkdirSync(path.dirname(baseMintPath), { recursive: true });
  fs.writeFileSync(baseMintPath, `${baseMint.toBase58()}\n`);
  console.log("base_mint_created", baseMint.toBase58());
  return baseMint;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = quadraticMarketProgram(provider);
  const declaredProgramId = new PublicKey(program.idl.address ?? program.programId.toBase58());
  if (!declaredProgramId.equals(program.programId)) {
    throw new Error(
      `Program ID mismatch: client=${program.programId.toBase58()} declared=${declaredProgramId.toBase58()}`,
    );
  }
  const payer = (provider.wallet as any).payer as Keypair;
  const admin = provider.wallet.publicKey;

  console.log("rpc", provider.connection.rpcEndpoint);
  console.log("program", program.programId.toBase58());
  console.log("admin", admin.toBase58());

  const globalConfig = pda(program.programId, "global_config");
  const treasury = pda(program.programId, "treasury");
  const lpMint = pda(program.programId, "lp_mint");
  const epochId = U64(0);
  const epoch = pda(program.programId, "epoch", epochId);
  const epochVault = pda(program.programId, "epoch_vault", epochId);

  const accounts = (program.account as any);
  let config: any = await fetchNullable(() => accounts.globalConfig.fetch(globalConfig));
  let baseMint = config?.baseMint as PublicKey | undefined;
  if (!baseMint) {
    baseMint = await ensureLocalBaseMint(provider, payer, admin);
    const oracle = Keypair.generate();
    const ix = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: false },
        { pubkey: baseMint, isSigner: false, isWritable: false },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeWithDiscriminator(
        program,
        "initializeProtocol",
        {
          oraclePubkey: Array.from(oracle.publicKey.toBytes()),
          maxMarketExposure: U64(1_000_000_000),
        },
        ["initialize_protocol"],
      ),
    });
    console.log("initialize_protocol_sig", await sendIx(provider, ix));
    config = await accounts.globalConfig.fetch(globalConfig);
  } else {
    console.log("protocol_reused", globalConfig.toBase58());
    console.log("base_mint_from_config", baseMint.toBase58());
  }

  const lpMintInfo = await provider.connection.getAccountInfo(lpMint);
  if (!lpMintInfo) {
    const ix = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: true },
        { pubkey: lpMint, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: encodeWithDiscriminator(program, "initializeLpMint", {}, ["initialize_lp_mint"]),
    });
    console.log("initialize_lp_mint_sig", await sendIx(provider, ix));
  }

  const epochInfo = await provider.connection.getAccountInfo(epoch);
  const epochVaultInfo = await provider.connection.getAccountInfo(epochVault);
  if (!epochInfo || !epochVaultInfo) {
    const ix = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: true },
        { pubkey: epoch, isSigner: false, isWritable: true },
        { pubkey: epochVault, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeWithDiscriminator(program, "initEpoch", {}, ["init_epoch"]),
    });
    console.log("init_epoch_sig", await sendIx(provider, ix));
  }

  const adminBaseAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    baseMint,
    admin,
  );
  const vaultBaseAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    baseMint,
    epochVault,
    true,
  );
  await mintTo(provider.connection, payer, baseMint, adminBaseAta.address, payer, 2_000_000_000);

  const lpPosition = PublicKey.findProgramAddressSync(
    [Buffer.from("epoch_lp"), epochId.toArrayLike(Buffer, "le", 8), admin.toBuffer()],
    program.programId,
  )[0];
  const liquidityAmount = U64(500_000_000);
  const liquidityIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: epochVault, isSigner: false, isWritable: true },
      { pubkey: lpPosition, isSigner: false, isWritable: true },
      { pubkey: adminBaseAta.address, isSigner: false, isWritable: true },
      { pubkey: vaultBaseAta.address, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeWithDiscriminator(
      program,
      "optInEpochLiquidity",
      { epochId, amount: liquidityAmount },
      ["opt_in_epoch_liquidity"],
    ),
  });
  console.log("opt_in_liquidity_sig", await sendIx(provider, liquidityIx));

  config = await accounts.globalConfig.fetch(globalConfig);
  const marketId = new anchor.BN(config.nextMarketId.toString());
  const market = pda(program.programId, "market", marketId);
  const startTime = i64(Math.floor(Date.now() / 1000) + 3600);
  const createMarketIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: epoch, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: encodeWithDiscriminator(
      program,
      "createMarket",
      {
        startTime,
        numOutcomes: 2,
        title: "Localnet GG/NG",
        description: "Localnet epoch vault slip flow",
        category: 2,
        marketType: { goalNoGoal: {} },
        initialOdds: [U64(20_000), U64(20_000)],
        txlineFixtureId: null,
      },
      ["create_market"],
    ),
  });
  console.log("create_market_sig", await sendIx(provider, createMarketIx));

  const outcomeMint0 = pda(program.programId, "outcome_mint", marketId, Buffer.from([0]));
  for (const outcomeId of [0, 1]) {
    const outcomeMint = pda(program.programId, "outcome_mint", marketId, Buffer.from([outcomeId]));
    const ix = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: true },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: outcomeMint, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: encodeWithDiscriminator(
        program,
        "initOutcomeMint",
        { marketId, outcomeId },
        ["init_outcome_mint"],
      ),
    });
    console.log(`init_outcome_${outcomeId}_sig`, await sendIx(provider, ix));
  }

  const bettor = Keypair.generate();
  console.log("bettor", bettor.publicKey.toBase58());
  console.log("bettor_airdrop_sig", await provider.connection.requestAirdrop(bettor.publicKey, 2_000_000_000));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const bettorBaseAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    baseMint,
    bettor.publicKey,
  );
  await mintTo(provider.connection, payer, baseMint, bettorBaseAta.address, payer, 100_000_000);

  config = await accounts.globalConfig.fetch(globalConfig);
  const slipId = new anchor.BN(config.nextSlipId.toString());
  const slip = pda(program.programId, "slip", slipId);
  const stake = U64(10_000_000);
  const placeSlipIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: slip, isSigner: false, isWritable: true },
      { pubkey: epochVault, isSigner: false, isWritable: false },
      { pubkey: bettorBaseAta.address, isSigner: false, isWritable: true },
      { pubkey: vaultBaseAta.address, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: false },
      { pubkey: bettor.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeWithDiscriminator(
      program,
      "placeSlipAwait",
      {
        legs: [{ marketId, outcomeId: 0, numShares: U64(1) }],
        stake,
        cancelDeadline: i64(Math.floor(Date.now() / 1000) + 600),
      },
      ["place_slip_await"],
    ),
  });
  console.log("place_slip_sig", await sendIx(provider, placeSlipIx, [bettor]));

  const bettorOutcomeAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    outcomeMint0,
    bettor.publicKey,
  );
  const buyLegIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: slip, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: epochVault, isSigner: false, isWritable: false },
      { pubkey: bettorOutcomeAta.address, isSigner: false, isWritable: true },
      { pubkey: vaultBaseAta.address, isSigner: false, isWritable: true },
      { pubkey: outcomeMint0, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: false },
      { pubkey: bettor.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeWithDiscriminator(
      program,
      "buyLegForSlip",
      { slipId, legIndex: 0, outcomeId: 0 },
      ["buy_leg_for_slip"],
    ),
  });
  console.log("buy_leg_sig", await sendIx(provider, buyLegIx, [bettor]));

  const settleMarketIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: epoch, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
    ],
    data: encodeWithDiscriminator(program, "settleMarket", { winningOutcome: 0 }, ["settle_market"]),
  });
  console.log("settle_market_sig", await sendIx(provider, settleMarketIx));

  const settleSlipIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: slip, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
    ],
    data: encodeWithDiscriminator(
      program,
      "settleSlipLeg",
      { slipId, legIndex: 0 },
      ["settle_slip_leg"],
    ),
  });
  console.log("settle_slip_leg_sig", await sendIx(provider, settleSlipIx));

  const resolveSlipIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: slip, isSigner: false, isWritable: true },
      { pubkey: epochVault, isSigner: false, isWritable: false },
      { pubkey: bettor.publicKey, isSigner: false, isWritable: false },
      { pubkey: bettorBaseAta.address, isSigner: false, isWritable: true },
      { pubkey: vaultBaseAta.address, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeWithDiscriminator(program, "resolveSlip", { slipId }, ["resolve_slip"]),
  });
  console.log("resolve_slip_sig", await sendIx(provider, resolveSlipIx));

  const bettorBalance = await getAccount(provider.connection, bettorBaseAta.address);
  const vaultBalance = await getAccount(provider.connection, vaultBaseAta.address);
  const finalConfig: any = await accounts.globalConfig.fetch(globalConfig);
  const finalSlip: any = await accounts.slip.fetch(slip);
  const finalMarket: any = await accounts.market.fetch(market);
  const finalEpoch: any = await accounts.epoch.fetch(epoch);

  console.log("final", {
    marketId: marketId.toString(),
    slipId: slipId.toString(),
    bettorBaseBalance: bettorBalance.amount.toString(),
    epochVaultBaseBalance: vaultBalance.amount.toString(),
    lockedPayouts: finalConfig.lockedPayouts.toString(),
    slipStatus: finalSlip.status,
    slipPotentialPayout: finalSlip.potentialPayout.toString(),
    marketStatus: finalMarket.status,
    winningOutcome: finalMarket.winningOutcome,
    epochSettled: finalEpoch.allMarketsSettled,
  });
}

main().catch((err) => {
  console.error("localnet_epoch_vault_flow_failed", err);
  process.exit(1);
});

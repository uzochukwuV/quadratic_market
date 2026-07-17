import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import * as fs from "fs/promises";
import * as path from "path";
import { quadraticMarketProgram, sendInitOutcomeMint, sendPlaceSlipAwait, sendCreateMarket } from "../tests/program";
import { buildFinalSettlementProof } from "./txline_proof";

const PROGRAM_ID = new PublicKey("FPaJasqbU2qULcJpbiGwduJix6dFRGK8JUefbXbSDcrN");
const TXORACLE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXORACLE_IDL_URL =
  "https://raw.githubusercontent.com/txodds/tx-on-chain/main/examples/devnet/idl/txoracle.json";
const TXLINE_API_ORIGIN = "https://txline-dev.txodds.com";
const TXLINE_API_BASE = `${TXLINE_API_ORIGIN}/api`;
const TXL_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function ensureAta(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId = TOKEN_PROGRAM_ID,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const ix = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(payer);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await confirmSignature(connection, sig);
  }
  return ata;
}

async function confirmSignature(connection: Connection, signature: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const res = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = res.value[0];
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (status.err) {
        throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for confirmation of ${signature}`);
}

function uniqueSigners(primary: Keypair | undefined, others: Keypair[] = []): Keypair[] {
  const seen = new Map<string, Keypair>();
  if (primary) {
    seen.set(primary.publicKey.toBase58(), primary);
  }
  for (const signer of others) {
    seen.set(signer.publicKey.toBase58(), signer);
  }
  return [...seen.values()];
}

async function sendAndConfirmTx(
  provider: anchor.AnchorProvider,
  tx: Transaction,
  signers: Keypair[] = [],
): Promise<string> {
  const payer = (provider.wallet as any).payer as Keypair | undefined;
  if (!payer) {
    throw new Error("Provider wallet does not expose a signer keypair");
  }
  tx.feePayer = provider.wallet.publicKey;
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...uniqueSigners(payer, signers));
  const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await confirmSignature(provider.connection, sig);
  return sig;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    throw new Error(`${url} -> ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

async function activateTxlineToken(
  payer: Keypair,
  subscribeSig: string,
): Promise<{ jwt: string; apiToken: string }> {
  const jwtResp = await fetchJson(`${TXLINE_API_ORIGIN}/auth/guest/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const jwt = jwtResp.token || jwtResp.access_token;
  if (!jwt) {
    throw new Error("TxLINE guest JWT missing from auth response");
  }

  const message = new TextEncoder().encode(`${subscribeSig}::${jwt}`);
  const signature = ed25519.sign(message, payer.secretKey.slice(0, 32));
  const walletSignature = Buffer.from(signature).toString("base64");

  const activationResp = await fetch(`${TXLINE_API_BASE}/token/activate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      txSig: subscribeSig,
      walletSignature,
      leagues: [],
    }),
  });
  if (!activationResp.ok) {
    throw new Error(`TxLINE activation failed: ${activationResp.status} ${await activationResp.text()}`);
  }
  const activationText = await activationResp.text();
  let apiToken = activationText.trim();
  try {
    const parsed = JSON.parse(activationText);
    apiToken = parsed.token || parsed.access_token || parsed.apiToken || apiToken;
  } catch {
    // Plain-text token response is accepted.
  }
  if (!apiToken) {
    throw new Error("TxLINE API token missing from activation response");
  }

  return { jwt, apiToken };
}

async function txlineFetch(
  jwt: string,
  apiToken: string,
  path: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const url = new URL(`${TXLINE_API_BASE}/${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return fetchJson(url.toString(), {
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-api-token": apiToken,
    },
  });
}

async function findFinalFixture(jwt: string, apiToken: string): Promise<{
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  startTime: number;
  sportKey: string;
  homeScore: number;
  awayScore: number;
  seq: number;
}> {
  const today = Math.floor(Date.now() / 86400000);
  for (const offset of [0, -1, -2, -3, -4, -5, -6, -7]) {
    let fixtures: any[] = [];
    try {
      fixtures = await txlineFetch(jwt, apiToken, "fixtures/snapshot", {
        epochDay: today + offset,
      });
    } catch {
      continue;
    }
    for (const fixture of fixtures.slice(0, 25)) {
      const fixtureId = Number(pick(fixture, "fixtureId", "FixtureId"));
      if (!Number.isFinite(fixtureId)) {
        continue;
      }
      let scores: any[] = [];
      try {
        scores = await txlineFetch(jwt, apiToken, `scores/sequence/${fixtureId}`);
      } catch {
        continue;
      }
      const final = scores.find(
        (item: any) =>
          pick(item, "action", "Action") === "game_finalised" &&
          Number(pick(item, "statusId", "StatusId")) === 100 &&
          Number(pick(item, "period", "Period")) === 100,
      );
      const seq = pick(final, "seq", "Seq");
      if (final && seq != null) {
        return {
          fixtureId,
          homeTeam: String(pick(fixture, "homeTeam", "Participant1") ?? "Home"),
          awayTeam: String(pick(fixture, "awayTeam", "Participant2") ?? "Away"),
          startTime: Math.floor(Number(pick(fixture, "startTime", "StartTime")) / 1000),
          sportKey: String(pick(fixture, "sportKey", "Competition") ?? "soccer"),
          homeScore: Number(pick(final, "homeScore", "HomeScore") ?? 0),
          awayScore: Number(pick(final, "awayScore", "AwayScore") ?? 0),
          seq: Number(seq),
        };
      }
    }
  }
  throw new Error("Could not find a final fixture on TxLINE devnet");
}

function deriveOutcomeScores(homeScore: number, awayScore: number) {
  const oneXTwo = homeScore > awayScore ? 0 : awayScore > homeScore ? 2 : 1;
  const overUnder = homeScore + awayScore > 2 ? 0 : 1;
  const ggNg = homeScore > 0 && awayScore > 0 ? 0 : 1;
  return { oneXTwo, overUnder, ggNg };
}

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) {
    throw new Error("ANCHOR_PROVIDER_URL is not set");
  }
  const wsUrl = process.env.ANCHOR_WS_URL || rpcUrl.replace(/^https:/, "wss:");
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) {
    throw new Error("ANCHOR_WALLET is not set");
  }
  const walletBytes = JSON.parse(await fs.readFile(walletPath, "utf8")) as number[];
  const payer = Keypair.fromSecretKey(Uint8Array.from(walletBytes));
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: wsUrl,
  });
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  (provider as any).sendAndConfirm = async (tx: Transaction, signers: Keypair[] = []) =>
    sendAndConfirmTx(provider, tx, signers);
  const admin = provider.wallet.publicKey;

  const program = quadraticMarketProgram(provider);
  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PROGRAM_ID,
  );
  const [epochPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("epoch"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], PROGRAM_ID);
  const groupId = new anchor.BN(Date.now());
  const [marketGroupPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market_group"), groupId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  );

  const globalConfig: any = await program.account.globalConfig.fetch(globalConfigPda);
  const baseMint: PublicKey = globalConfig.baseMint;

  const txoracleIdl = await fetchJson(TXORACLE_IDL_URL);
  const txoracleCoder = new anchor.BorshCoder(txoracleIdl as anchor.Idl);

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], TXORACLE_PROGRAM_ID);
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], TXORACLE_PROGRAM_ID);
  const txlUserAta = getAssociatedTokenAddressSync(
    TXL_MINT,
    admin,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const txlVaultAta = getAssociatedTokenAddressSync(
    TXL_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  await ensureAta(provider.connection, payer, TXL_MINT, admin, TOKEN_2022_PROGRAM_ID);
  await ensureAta(provider.connection, payer, TXL_MINT, tokenTreasuryPda, TOKEN_2022_PROGRAM_ID);
  await ensureAta(provider.connection, payer, baseMint, admin, TOKEN_PROGRAM_ID);
  await ensureAta(provider.connection, payer, baseMint, treasuryPda, TOKEN_PROGRAM_ID);

  const tokenPath = path.join(process.cwd(), "_keys", "txodds-api-token.txt");
  let apiToken = "";
  if (await fs
    .access(tokenPath)
    .then(() => true)
    .catch(() => false)) {
    apiToken = (await fs.readFile(tokenPath, "utf8")).trim();
    console.log("Reusing TxLINE token from _keys/txodds-api-token.txt");
  } else {
    const subscribeIx = new TransactionInstruction({
      programId: TXORACLE_PROGRAM_ID,
      keys: [
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: pricingMatrixPda, isSigner: false, isWritable: false },
        { pubkey: TXL_MINT, isSigner: false, isWritable: false },
        { pubkey: txlUserAta, isSigner: false, isWritable: true },
        { pubkey: txlVaultAta, isSigner: false, isWritable: true },
        { pubkey: tokenTreasuryPda, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: txoracleCoder.instruction.encode("subscribe", {
        service_level_id: 1,
        weeks: 4,
      }),
    });
    const subscribeSig = await provider.sendAndConfirm(new Transaction().add(subscribeIx), []);
    console.log("TxLINE subscribe:", subscribeSig);

    const activated = await activateTxlineToken(payer, subscribeSig);
    apiToken = activated.apiToken;
    await fs.writeFile(tokenPath, `${apiToken}\n`, {
      encoding: "utf8",
    });
    console.log("TxLINE token written to _keys/txodds-api-token.txt");
  }

  const jwtResp = await fetchJson(`${TXLINE_API_ORIGIN}/auth/guest/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const jwt = jwtResp.token || jwtResp.access_token;
  if (!jwt) {
    throw new Error("TxLINE guest JWT missing from auth response");
  }

  const demoFixtureId = 18175981;
  const demoSeq = 991;
  const scoreSnapshot = await txlineFetch(jwt, apiToken, `scores/snapshot/${demoFixtureId}`);
  const scoreAnchor = scoreSnapshot[0] ?? {};
  const finalFixture = {
    fixtureId: demoFixtureId,
    homeTeam: String(pick(scoreAnchor, "Participant1", "homeTeam") ?? "Home"),
    awayTeam: String(pick(scoreAnchor, "Participant2", "awayTeam") ?? "Away"),
    startTime: nowSeconds() + 18,
    sportKey: String(pick(scoreAnchor, "Type", "Competition") ?? "soccer"),
  };
  const proof = await buildFinalSettlementProof(jwt, apiToken, demoFixtureId, demoSeq);
  if (!proof) {
    throw new Error("Could not build TxLINE proof");
  }
  const result = deriveOutcomeScores(proof.homeScore, proof.awayScore);
  const oddsSnapshot = await txlineFetch(jwt, apiToken, `odds/snapshot/${finalFixture.fixtureId}`).catch(() => []);
  const consensusOdds = Array.isArray(oddsSnapshot) && oddsSnapshot.length > 0 ? oddsSnapshot[0].prices ?? [] : [];
  const oneXTwoOdds = consensusOdds.length >= 3 ? consensusOdds.slice(0, 3) : [20000, 35000, 30000];
  const overUnderOdds = consensusOdds.length >= 2 ? consensusOdds.slice(0, 2) : [18000, 19000];
  const ggNgOdds = consensusOdds.length >= 2 ? consensusOdds.slice(0, 2) : [17000, 20000];

  const marketStartTime = nowSeconds() + 180;
  const groupStartTime = marketStartTime + 180;
  const cancelDeadline = marketStartTime + 900;
  const marketTitle = `${finalFixture.homeTeam} vs ${finalFixture.awayTeam}`;

  const createGroupIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfigPda, isSigner: false, isWritable: true },
      { pubkey: marketGroupPda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: program.coder.instruction.encode("createMarketGroup", {
      groupId,
      maxGroupExposure: new anchor.BN(1_000_000_000_000),
      eventStartTime: new anchor.BN(groupStartTime),
      title: marketTitle,
    }),
  });
  await provider.sendAndConfirm(new Transaction().add(createGroupIx), []);

  const marketIds: number[] = [];
  const marketConfigs = [
    {
      label: "1X2",
      numOutcomes: 3,
      category: 0,
      marketType: { oneXTwo: {} },
      odds: oneXTwoOdds,
    },
    {
      label: "O/U 2.5",
      numOutcomes: 2,
      category: 1,
      marketType: { overUnder: {} },
      odds: overUnderOdds,
    },
    {
      label: "GG/NG",
      numOutcomes: 2,
      category: 2,
      marketType: { goalNoGoal: {} },
      odds: ggNgOdds,
    },
  ] as const;

  const marketPdas: PublicKey[] = [];
  for (const cfg of await program.account.globalConfig.fetch(globalConfigPda).then((g: any) => {
    const next = Number(g.nextMarketId);
    return marketConfigs.map((marketCfg, idx) => ({ marketCfg, marketId: next + idx }));
  })) {
    const marketPda = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(cfg.marketId).toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID,
    )[0];
    marketPdas.push(marketPda);
    await sendCreateMarket(
      provider,
      program,
      payer,
      globalConfigPda,
      marketPda,
      epochPda,
      new anchor.BN(marketStartTime),
      cfg.marketCfg.numOutcomes,
      `${cfg.marketCfg.label}: ${marketTitle}`,
      finalFixture.sportKey,
      cfg.marketCfg.category,
      cfg.marketCfg.marketType as any,
      cfg.marketCfg.odds.map((n) => new anchor.BN(n)),
      new anchor.BN(finalFixture.fixtureId),
    );
    marketIds.push(cfg.marketId);

    for (let outcomeId = 0; outcomeId < cfg.marketCfg.numOutcomes; outcomeId++) {
      const outcomeMint = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome_mint"), new anchor.BN(cfg.marketId).toArrayLike(Buffer, "le", 8), Buffer.from([outcomeId])],
        PROGRAM_ID,
      )[0];
      await sendInitOutcomeMint(
        provider,
        program,
        payer,
        globalConfigPda,
        marketPda,
        outcomeMint,
        new anchor.BN(cfg.marketId),
        outcomeId,
      );
    }
  }

  for (let idx = 0; idx < marketIds.length; idx++) {
    const marketPda = marketPdas[idx];
    const addIx = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfigPda, isSigner: false, isWritable: false },
        { pubkey: marketGroupPda, isSigner: false, isWritable: true },
        { pubkey: marketPda, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: false },
      ],
      data: program.coder.instruction.encode("addMarketToGroup", {
        groupId,
        marketIndex: idx,
      }),
    });
    await provider.sendAndConfirm(new Transaction().add(addIx), []);
  }

  const slipLegs = [
    { marketId: new anchor.BN(marketIds[0]), outcomeId: result.oneXTwo, numShares: new anchor.BN(1) },
    { marketId: new anchor.BN(marketIds[1]), outcomeId: result.overUnder, numShares: new anchor.BN(1) },
  ];

  const slipId = Number((await program.account.globalConfig.fetch(globalConfigPda)).nextSlipId);
  const slipPda = PublicKey.findProgramAddressSync(
    [Buffer.from("slip"), new anchor.BN(slipId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];

  await sendPlaceSlipAwait(
    provider,
    program,
    payer,
    globalConfigPda,
    slipPda,
    treasuryPda,
    await ensureAta(provider.connection, payer, baseMint, admin, TOKEN_PROGRAM_ID),
    await ensureAta(provider.connection, payer, baseMint, treasuryPda, TOKEN_PROGRAM_ID),
    baseMint,
    slipLegs,
    new anchor.BN(1_000_000),
    new anchor.BN(cancelDeadline),
  );
  console.log("Slip placed:", slipId);

  for (const leg of slipLegs) {
    const marketId = Number(leg.marketId);
    const marketPda = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID,
    )[0];
    const outcomeMint = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome_mint"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8), Buffer.from([leg.outcomeId])],
      PROGRAM_ID,
    )[0];
    const buyerOutcomeAta = await ensureAta(provider.connection, payer, outcomeMint, admin, TOKEN_PROGRAM_ID);
    const treasuryBaseAta = await ensureAta(provider.connection, payer, baseMint, treasuryPda, TOKEN_PROGRAM_ID);

    const buyIx = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfigPda, isSigner: false, isWritable: true },
        { pubkey: slipPda, isSigner: false, isWritable: true },
        { pubkey: marketPda, isSigner: false, isWritable: true },
        { pubkey: treasuryPda, isSigner: false, isWritable: false },
        { pubkey: buyerOutcomeAta, isSigner: false, isWritable: true },
        { pubkey: treasuryBaseAta, isSigner: false, isWritable: true },
        { pubkey: outcomeMint, isSigner: false, isWritable: true },
        { pubkey: baseMint, isSigner: false, isWritable: false },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: program.coder.instruction.encode("buyLegForSlip", {
        slipId: new anchor.BN(slipId),
        legIndex: marketId === marketIds[0] ? 0 : 1,
        outcomeId: leg.outcomeId,
      }),
    });
    await provider.sendAndConfirm(new Transaction().add(buyIx), []);
  }
  console.log("Slip legs bought");

  const waitMs = Math.max(0, marketStartTime * 1000 - Date.now() + 2000);
  if (waitMs > 0) {
    console.log(`Waiting ${Math.ceil(waitMs / 1000)}s for market start...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const epochDay = Math.floor(proof.validationTimestamp / 86400000);
  const dailyScoresMerkleRoots = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), Buffer.from([epochDay & 0xff, (epochDay >> 8) & 0xff])],
    TXORACLE_PROGRAM_ID,
  )[0];

  for (let idx = 0; idx < marketIds.length; idx++) {
    const marketId = marketIds[idx];
    const marketPda = marketPdas[idx];
    const settleIx = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfigPda, isSigner: false, isWritable: true },
        { pubkey: marketPda, isSigner: false, isWritable: true },
        { pubkey: epochPda, isSigner: false, isWritable: true },
        { pubkey: dailyScoresMerkleRoots, isSigner: false, isWritable: false },
        { pubkey: TXORACLE_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: admin, isSigner: true, isWritable: true },
      ],
      data: program.coder.instruction.encode("settleWithProof", {
        marketId: new anchor.BN(marketId),
        proposedOutcome: idx === 0
          ? proof.proposedOutcome
          : idx === 1
            ? proof.homeScore + proof.awayScore > 2
              ? 0
              : 1
            : proof.homeScore > 0 && proof.awayScore > 0
              ? 0
              : 1,
        txlineFixtureId: new anchor.BN(finalFixture.fixtureId),
        validationTimestamp: new anchor.BN(proof.validationTimestamp),
        homeScore: new anchor.BN(proof.homeScore),
        awayScore: new anchor.BN(proof.awayScore),
        validationInput: proof.validationInput,
        strategy: proof.strategy,
      }),
    });
    await provider.sendAndConfirm(new Transaction().add(settleIx), []);
  }
  console.log("Markets settled with proof");

  for (let idx = 0; idx < slipLegs.length; idx++) {
    const marketId = marketIds[idx];
    const marketPda = marketPdas[idx];
    const settleSlipIx = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: globalConfigPda, isSigner: false, isWritable: true },
        { pubkey: slipPda, isSigner: false, isWritable: true },
        { pubkey: marketPda, isSigner: false, isWritable: true },
        { pubkey: admin, isSigner: true, isWritable: true },
      ],
      data: program.coder.instruction.encode("settleSlipLeg", {
        slipId: new anchor.BN(slipId),
        legIndex: idx,
      }),
    });
    await provider.sendAndConfirm(new Transaction().add(settleSlipIx), []);
  }

  const ownerBaseAta = await ensureAta(provider.connection, payer, baseMint, admin, TOKEN_PROGRAM_ID);
  const treasuryBaseAta = await ensureAta(provider.connection, payer, baseMint, treasuryPda, TOKEN_PROGRAM_ID);
  const resolveSlipIx = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfigPda, isSigner: false, isWritable: true },
      { pubkey: slipPda, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: false },
      { pubkey: admin, isSigner: false, isWritable: false },
      { pubkey: ownerBaseAta, isSigner: false, isWritable: true },
      { pubkey: treasuryBaseAta, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: program.coder.instruction.encode("resolveSlip", {
      slipId: new anchor.BN(slipId),
    }),
  });
  await provider.sendAndConfirm(new Transaction().add(resolveSlipIx), []);

  console.log("Full devnet slip flow complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

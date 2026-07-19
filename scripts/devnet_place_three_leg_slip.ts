import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as fs from "fs";
import { quadraticMarketProgram } from "../tests/program";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? "FPaJasqbU2qULcJpbiGwduJix6dFRGK8JUefbXbSDcrN");
const BASE_MINT = new PublicKey(process.env.BASE_MINT ?? "8yqhLuiQRnvuU1RjDPM4kcRCcD1D5wPRfWdpG6dom3Vk");
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const BOT_API_ORIGIN = process.env.BOT_API_ORIGIN ?? "https://d17eznfv4qokvh.cloudfront.net";
const STAKE = BigInt(process.env.STAKE_BASE_UNITS ?? "1000000");
const TARGET_FIXTURE_ID = process.env.TARGET_FIXTURE_ID ? Number(process.env.TARGET_FIXTURE_ID) : null;

type MarketAccount = {
  publicKey: PublicKey;
  account: Record<string, any>;
};

function keypairFromFile(path = "_keys/deploy-wallet.json") {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

function u64Seed(value: bigint | number | string) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value.toString()));
  return bytes;
}

function pda(...seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function enumKey(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>)[0] ?? "";
  return "";
}

function stripMarketPrefix(title: string) {
  return title.replace(/^(1x2|o\/u\s*2\.5|gg\/ng)\s*:\s*/i, "").trim();
}

function parseTeams(title: string) {
  const cleaned = stripMarketPrefix(title).trim();
  for (const separator of [" vs ", " v ", " - ", " @ "]) {
    const [home, away, ...rest] = cleaned.split(separator);
    if (home && away && rest.length === 0) return { home: home.trim(), away: away.trim() };
  }
  return cleaned ? { home: cleaned, away: "Market" } : null;
}

function marketType(account: Record<string, any>) {
  const key = enumKey(account.marketType).toLowerCase();
  if (key === "overunder" || key === "over_under") return "total_goals";
  if (key === "goalnogoal" || key === "goal_no_goal") return "gg_ng";
  return "match_result";
}

function toNumber(value: any) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value?.toString) return Number(value.toString());
  return Number(value ?? 0);
}

function fixtureKey(account: Record<string, any>) {
  const teams = parseTeams(String(account.title ?? ""));
  return teams
    ? `match-${teams.home.toLowerCase()}-${teams.away.toLowerCase()}-${toNumber(account.startTime)}`
    : `market-${toNumber(account.marketId)}`;
}

function marketRank(market: MarketAccount) {
  const status = enumKey(market.account.status).toLowerCase();
  const statusRank = status === "open" ? 2 : status === "suspended" ? 1 : 0;
  return statusRank * 1_000_000_000 + toNumber(market.account.marketId);
}

async function ensureAta(provider: anchor.AnchorProvider, payer: Keypair, mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false) {
  const ata = getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const info = await provider.connection.getAccountInfo(ata);
  if (!info) {
    await provider.sendAndConfirm(
      new Transaction().add(createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint)),
      [payer],
    );
  }
  return ata;
}

async function mintBase(recipient: PublicKey, amount: bigint) {
  const response = await fetch(`${BOT_API_ORIGIN}/api/mint-base`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: recipient.toBase58(), amount: Number(amount) }),
  });
  if (!response.ok) {
    throw new Error(`mint-base failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<{ signature: string }>;
}

async function main() {
  const bettor = keypairFromFile();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(RPC_URL, "confirmed"),
    new anchor.Wallet(bettor),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  anchor.setProvider(provider);
  const program = quadraticMarketProgram(provider);

  const ownerBaseAta = await ensureAta(provider, bettor, BASE_MINT, bettor.publicKey);
  let baseBalance = BigInt((await getAccount(provider.connection, ownerBaseAta)).amount.toString());
  if (baseBalance < STAKE) {
    const minted = await mintBase(bettor.publicKey, STAKE - baseBalance);
    console.log("mint_base_sig", minted.signature);
    baseBalance = BigInt((await getAccount(provider.connection, ownerBaseAta)).amount.toString());
  }

  const rawMarkets = (await program.account.market.all()) as MarketAccount[];
  const now = Math.floor(Date.now() / 1000);
  const grouped = new Map<string, MarketAccount[]>();
  for (const market of rawMarkets) {
    const status = enumKey(market.account.status).toLowerCase();
    if (status !== "open" || toNumber(market.account.startTime) <= now) continue;
    if (TARGET_FIXTURE_ID != null && toNumber(market.account.txlineFixtureId) !== TARGET_FIXTURE_ID) continue;
    const key = fixtureKey(market.account);
    grouped.set(key, [...(grouped.get(key) ?? []), market]);
  }

  for (const group of grouped.values()) {
    const byType = new Map<string, MarketAccount>();
    for (const market of group) {
      const key = marketType(market.account);
      const current = byType.get(key);
      if (!current || marketRank(market) > marketRank(current)) byType.set(key, market);
    }

    const selected = ["match_result", "total_goals", "gg_ng"]
      .map((key) => byType.get(key))
      .filter((market): market is MarketAccount => Boolean(market));
    if (selected.length < 3) continue;

    const cfg = await program.account.globalConfig.fetch(pda(Buffer.from("global_config")));
    const slipId = toNumber((cfg as any).nextSlipId);
    const currentEpoch = toNumber((cfg as any).currentEpoch);
    const slip = pda(Buffer.from("slip"), u64Seed(slipId));
    const epochVault = pda(Buffer.from("epoch_vault"), u64Seed(currentEpoch));
    const epochVaultBaseAta = await ensureAta(provider, bettor, BASE_MINT, epochVault, true);
    const cancelDeadline = new anchor.BN(now + 10 * 60);
    const legs = selected.map((market) => ({
      marketId: new anchor.BN(toNumber(market.account.marketId)),
      outcomeId: 0,
      numShares: new anchor.BN(STAKE.toString()),
    }));

    const sig = await program.methods
      .placeSlipAwait(legs, new anchor.BN(STAKE.toString()), cancelDeadline)
      .accounts({
        globalConfig: pda(Buffer.from("global_config")),
        slip,
        epochVault,
        ownerBaseAta,
        epochVaultBaseAta,
        baseMint: BASE_MINT,
        owner: bettor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettor])
      .rpc();

    const first = selected[0].account;
    const teams = parseTeams(String(first.title ?? ""));
    console.log(JSON.stringify({
      bettor: bettor.publicKey.toBase58(),
      slipId,
      signature: sig,
      fixture: teams ? `${teams.home} vs ${teams.away}` : String(first.title ?? ""),
      startTime: toNumber(first.startTime),
      legs: selected.map((market) => ({
        marketId: toNumber(market.account.marketId),
        marketType: marketType(market.account),
        outcomeId: 0,
        odds: toNumber(market.account.odds?.[0]),
      })),
    }, null, 2));
    return;
  }

  throw new Error(
    TARGET_FIXTURE_ID == null
      ? "No open future fixture with 1X2, O/U, and GG/NG markets was found."
      : `No open future fixture ${TARGET_FIXTURE_ID} with 1X2, O/U, and GG/NG markets was found.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

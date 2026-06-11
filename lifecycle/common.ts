/**
 * lifecycle/common.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared helpers for the two-phase lifecycle scripts:
 *   - open_and_bet.ts      (Phase 1: bootstrap, open markets, users bet, persist)
 *   - settle_and_withdraw.ts (Phase 2: settle, claim, LP + user withdrawals)
 *
 * Both scripts run against a live solana-test-validator and share state through a
 * JSON file (lifecycle/state.json). Keypairs are persisted as raw secret-key byte
 * arrays so Phase 2 can re-sign as the same wallets Phase 1 created.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";

// ─── Program / constants ───────────────────────────────────────────────────
export const PROGRAM_ID = new PublicKey(
  "3MsEuMziRKjA1w1WTPeW5NvDUCjGoep2QZ5zBthGq23Z"
);

export const SCALE = new BN("4294967296"); // 2^32  Q32.32
export const USDC_DECIMALS = 6;
export const ONE_USDC = 1_000_000;

export const STATE_PATH = path.resolve(__dirname, "state.json");
const DEFAULT_PROGRAM_ID = "3MsEuMziRKjA1w1WTPeW5NvDUCjGoep2QZ5zBthGq23Z";

export const SEEDS = {
  GLOBAL_CONFIG: Buffer.from("global_config"),
  TREASURY: Buffer.from("treasury"),
  LP_MINT: Buffer.from("lp_mint"),
  MARKET: Buffer.from("market"),
  OUTCOME_MINT: Buffer.from("outcome_mint"),
  DISPUTE: Buffer.from("dispute"),
  EPOCH: Buffer.from("epoch"),
  MARKET_GROUP: Buffer.from("market_group"),
  BET_SLIP: Buffer.from("bet_slip"),
  PENDING: Buffer.from("pending"),
  WITHDRAWAL: Buffer.from("withdrawal"),
};

// ─── Encoding helpers ────────────────────────────────────────────────────────
export function u64LE(n: number | BN): Buffer {
  const b = Buffer.alloc(8);
  const bn = BN.isBN(n) ? n : new BN(n);
  bn.toArrayLike(Buffer, "le", 8).copy(b);
  return b;
}

export function u8(n: number): Buffer {
  return Buffer.from([n]);
}

export function pda(seeds: Buffer[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}

// ─── Pretty printing ─────────────────────────────────────────────────────────
export function toUsdc(lamports: BN | bigint | number): string {
  const n =
    typeof lamports === "bigint"
      ? Number(lamports)
      : BN.isBN(lamports)
      ? lamports.toNumber()
      : lamports;
  return (n / ONE_USDC).toFixed(4) + " USDC";
}

export function fpToPercent(fp: BN): string {
  return ((fp.toNumber() / SCALE.toNumber()) * 100).toFixed(2) + "%";
}

export function fpToDecimalOdds(fp: BN): string {
  return (fp.toNumber() / SCALE.toNumber()).toFixed(4) + "x";
}

let stepCounter = 0;
export function banner(title: string): void {
  console.log("\n══════════════════════════════════════════");
  console.log(`  ${title}`);
  console.log("══════════════════════════════════════════");
}

export function logLine(msg: string): void {
  console.log(`  ${msg}`);
}

export function sub(msg: string): void {
  console.log(`     ${msg}`);
}

function resolveIdlPath(): string {
  const candidates = [
    process.env.ANCHOR_IDL_PATH,
    path.resolve(__dirname, "..", "target", "idl", "quadratic_market.json"),
    path.resolve(
      __dirname,
      "..",
      "programs",
      "quadratic_market",
      "target",
      "idl",
      "quadratic_market.json"
    ),
    path.resolve(__dirname, "..", "bot", "idl.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to find quadratic_market IDL. Looked in ${candidates.join(", ")}`
  );
}

export function loadIdl(): anchor.Idl {
  const idlPath = resolveIdlPath();
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as anchor.Idl;

  const programId =
    process.env.PROGRAM_ID || process.env.ANCHOR_PROGRAM_ID || DEFAULT_PROGRAM_ID;
  if (programId && (idl as { address?: string }).address !== programId) {
    (idl as { address?: string }).address = programId;
  }

  return idl;
}

// ─── Connection / program wiring ─────────────────────────────────────────────
export interface Ctx {
  connection: Connection;
  provider: anchor.AnchorProvider;
  program: anchor.Program<any>;
  admin: Keypair; // the wallet running the scripts
}

export function makeCtx(): Ctx {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = loadIdl();
  const program = new anchor.Program(idl, provider);
  const admin = (provider.wallet as anchor.Wallet).payer;
  return { connection: provider.connection, provider, program, admin };
}

// ─── Token helpers ───────────────────────────────────────────────────────────
export async function tokenBalance(
  connection: Connection,
  ata: PublicKey
): Promise<bigint> {
  try {
    const acc = await getAccount(connection, ata);
    return acc.amount;
  } catch {
    return BigInt(0);
  }
}

export async function getOrCreateAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner,
    allowOwnerOffCurve
  );
  return ata.address;
}

export function ataAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve);
}

export async function airdrop(
  connection: Connection,
  to: PublicKey,
  sol = 100
): Promise<void> {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

// ─── Time helpers ────────────────────────────────────────────────────────────
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export async function chainTime(connection: Connection): Promise<number> {
  const slot = await connection.getSlot();
  const t = await connection.getBlockTime(slot);
  return t ?? nowSec();
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait until the validator's on-chain clock reaches `targetUnix` (+ a small
 * margin), polling so we never under-wait due to drift between wall-clock and
 * the validator clock.
 */
export async function waitUntilChainTime(
  connection: Connection,
  targetUnix: number,
  label: string,
  marginSec = 2
): Promise<void> {
  const target = targetUnix + marginSec;
  for (;;) {
    const t = await chainTime(connection);
    if (t >= target) {
      logLine(`${label}: chain time ${t} >= ${target} ✓`);
      return;
    }
    const remaining = target - t;
    logLine(`${label}: waiting ${remaining}s (chain time ${t} → ${target})...`);
    await sleep(Math.min(remaining, 5) * 1000);
  }
}

// ─── State (de)serialization ─────────────────────────────────────────────────
export interface KeypairJson {
  pubkey: string;
  secret: number[];
}

export function kpToJson(kp: Keypair): KeypairJson {
  return { pubkey: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey) };
}

export function kpFromJson(j: KeypairJson): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(j.secret));
}

export interface MarketState {
  marketId: string;
  marketPda: string;
  outcomeMints: string[];
  outcomeNames: string[];
  startTime: number;
  groupId: string;
  numOutcomes: number;
  winningOutcome: number; // chosen winner for settlement (Phase 1 decides)
  seedCapital: string; // Total seed capital deposited
}

export interface SingleBetState {
  user: KeypairJson;
  userLabel: string;
  marketId: string;
  outcomeId: number;
  shares: string;
  outcomeAta: string;
  cost: string; // Total cost paid (excluding fee)
  fee: string;  // Buy fee (1%)
}

export interface SlipLegState {
  marketId: string;
  outcomeId: number;
  numShares: string;
  mint: string;
  cost?: string;
}

export interface SlipState {
  slipId: string;
  user: KeypairJson;
  userLabel: string;
  legs: SlipLegState[];
  stake: string;        // Total stake paid
  potentialPayout: string; // Expected payout if all legs win
}

export interface LpState {
  provider: KeypairJson;
  baseAta: string;
  lpAta: string;
  deposited: string;
}

export interface LifecycleState {
  baseMint: string;
  oracle: KeypairJson;
  groupId: string;
  epochId: string;
  markets: MarketState[];
  singleBets: SingleBetState[];
  slips: SlipState[];
  lp: LpState;
  config: {
    challengeWindowSeconds: number;
    epochDurationSeconds: number;
    withdrawalCooldownSeconds: number;
  };
  lpActivationTime: number; // when the LP deposit's shares unlock
  createdAt: number;
}

export function saveState(state: LifecycleState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function loadState(): LifecycleState {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(
      `State file not found at ${STATE_PATH}. Run open_and_bet.ts first.`
    );
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

// ─── Common PDA derivations ──────────────────────────────────────────────────
export function globalConfigPda(): PublicKey {
  return pda([SEEDS.GLOBAL_CONFIG])[0];
}
export function treasuryPda(): PublicKey {
  return pda([SEEDS.TREASURY])[0];
}
export function lpMintPda(): PublicKey {
  return pda([SEEDS.LP_MINT])[0];
}
export function marketPda(marketId: BN): PublicKey {
  return pda([SEEDS.MARKET, u64LE(marketId)])[0];
}
export function outcomeMintPda(marketId: BN, outcome: number): PublicKey {
  return pda([SEEDS.OUTCOME_MINT, u64LE(marketId), u8(outcome)])[0];
}
export function epochPda(epochId: BN): PublicKey {
  return pda([SEEDS.EPOCH, u64LE(epochId)])[0];
}
export function marketGroupPda(groupId: BN): PublicKey {
  return pda([SEEDS.MARKET_GROUP, u64LE(groupId)])[0];
}
export function disputePda(marketId: BN): PublicKey {
  return pda([SEEDS.DISPUTE, u64LE(marketId)])[0];
}
export function betSlipPda(slipId: BN): PublicKey {
  return pda([SEEDS.BET_SLIP, u64LE(slipId)])[0];
}
export function pendingPda(lp: PublicKey): PublicKey {
  return pda([SEEDS.PENDING, lp.toBuffer()])[0];
}
export function withdrawalPda(lp: PublicKey): PublicKey {
  return pda([SEEDS.WITHDRAWAL, lp.toBuffer()])[0];
}

export { BN, anchor, Keypair, PublicKey, TOKEN_PROGRAM_ID };

/**
 * Off-chain LMSR price (implied probability) for display, mirroring the on-chain
 * formula. `lmsr_b` is stored as RAW lamports (not Q32.32) after the B fix.
 */
export async function computeLmsrPrice(
  program: anchor.Program<any>,
  marketPda: PublicKey,
  outcomeId: number
): Promise<BN> {
  const m: any = await program.account.market.fetch(marketPda);
  const qValues: BN[] = m.qValues;
  const bRaw: BN = m.lmsrB; // raw lamports
  const n = m.numOutcomes as number;

  let maxQ = new BN(0);
  for (let i = 0; i < n; i++) if (qValues[i].gt(maxQ)) maxQ = qValues[i];

  const expApprox = (q: BN): number => {
    const diff = q.sub(maxQ).toNumber();
    const exponent = diff / bRaw.toNumber();
    return Math.exp(Math.max(exponent, -20));
  };

  let sumExp = 0;
  for (let i = 0; i < n; i++) sumExp += expApprox(qValues[i]);
  const targetExp = expApprox(qValues[outcomeId]);
  const price = (targetExp / sumExp) * SCALE.toNumber();
  return new BN(Math.round(price));
}

/**
 * Convert desired opening implied-probabilities into LMSR q_values (the
 * operator-set opening line). q_i = bRaw · (ln(p_i) − min_j ln(p_j)).
 */
export function oddsToQValues(probs: number[], bRaw: number): BN[] {
  const lns = probs.map((p) => Math.log(p));
  const minLn = Math.min(...lns);
  return lns.map((ln) => new BN(Math.round(bRaw * (ln - minLn))));
}

export async function printOdds(
  program: anchor.Program<any>,
  mPda: PublicKey,
  label: string
): Promise<void> {
  const m: any = await program.account.market.fetch(mPda);
  const n: number = m.numOutcomes;
  console.log(`\n  ┌─ Odds — ${label}`);
  for (let i = 0; i < n; i++) {
    const price = await computeLmsrPrice(program, mPda, i);
    const prob = fpToPercent(price);
    const dec = (SCALE.toNumber() / Math.max(price.toNumber(), 1)).toFixed(3);
    console.log(`  │  Outcome ${i}: ${prob} implied  →  ${dec}x decimal`);
  }
  console.log(`  └─ Market exposure: ${toUsdc(m.exposure)}`);
}

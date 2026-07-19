import { clusterApiUrl } from "@solana/web3.js";

// Program ID for quadratic_market — set VITE_PROGRAM_ID in your env
export const PROGRAM_ID_STR =
  (import.meta.env.VITE_PROGRAM_ID as string) ||
  "11111111111111111111111111111111"; // placeholder — override with real ID

export const RPC_URL =
  (import.meta.env.VITE_RPC_URL as string) || clusterApiUrl("devnet");

// Base token decimals (USDC = 6, override if different)
export const BASE_TOKEN_DECIMALS = Number(
  import.meta.env.VITE_BASE_TOKEN_DECIMALS || "6"
);

// How many base-token lamports per 1 "SOL unit" displayed in UI
// e.g. if baseMint is USDC with 6 decimals: 1_000_000
export const LAMPORTS_PER_UNIT = Math.pow(10, BASE_TOKEN_DECIMALS);

/** Convert a UI amount (e.g. 0.5 SOL displayed) to on-chain lamports */
export function toOnChainAmount(uiAmount: number): bigint {
  return BigInt(Math.round(uiAmount * LAMPORTS_PER_UNIT));
}

/** Convert on-chain lamports to UI amount */
export function fromOnChainAmount(lamports: bigint | number): number {
  return Number(lamports) / LAMPORTS_PER_UNIT;
}

/** Odds in basis points to decimal multiplier */
export function bpsToOdds(bps: number): number {
  return bps / 10_000;
}

/** Decimal odds to basis points */
export function oddsToBps(odds: number): number {
  return Math.round(odds * 10_000);
}

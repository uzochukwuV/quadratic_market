"use client";

import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, type Commitment } from "@solana/web3.js";
import { QUADRATIC_MARKET_PROGRAM_ID, SOLANA_RPC_URL } from "./env";
import { quadraticMarketIdlJson } from "./idl";

export const DEFAULT_COMMITMENT: Commitment = "confirmed";

export function createConnection(endpoint = SOLANA_RPC_URL) {
  return new Connection(endpoint, DEFAULT_COMMITMENT);
}

export function walletAdapterToAnchorWallet(wallet: WalletContextState): Wallet | null {
  if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
    return null;
  }

  return {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions,
  } as unknown as Wallet;
}

export function createAnchorProvider(wallet: WalletContextState, endpoint = SOLANA_RPC_URL) {
  const anchorWallet = walletAdapterToAnchorWallet(wallet);
  if (!anchorWallet) {
    return null;
  }

  return new AnchorProvider(createConnection(endpoint), anchorWallet, {
    commitment: DEFAULT_COMMITMENT,
    preflightCommitment: DEFAULT_COMMITMENT,
  });
}

export function createQuadraticProgram(provider: AnchorProvider) {
  return new Program(
    { ...quadraticMarketIdlJson, address: QUADRATIC_MARKET_PROGRAM_ID.toBase58() },
    provider,
  );
}

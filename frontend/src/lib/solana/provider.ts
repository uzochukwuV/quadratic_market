"use client";

import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  type Commitment,
  type ConfirmOptions,
  type Signer,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { QUADRATIC_MARKET_PROGRAM_ID, SOLANA_RPC_URL } from "./env";
import { quadraticMarketIdlJson } from "./idl";

export const DEFAULT_COMMITMENT: Commitment = "confirmed";
const CONFIRMATION_TIMEOUT_MS = 120_000;
const CONFIRMATION_POLL_MS = 1_500;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSignatureConfirmation(
  connection: Connection,
  signature: string,
  commitment: Commitment = DEFAULT_COMMITMENT,
  timeoutMs = CONFIRMATION_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  let lastStatus = null;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = response.value[0];
    lastStatus = status;

    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}. Signature ${signature}`);
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized" ||
      (commitment === "processed" && status)
    ) {
      return status;
    }

    await wait(CONFIRMATION_POLL_MS);
  }

  console.warn("[solana] signature confirmation timed out; returning accepted signature", {
    signature,
    timeoutMs,
    lastStatus,
  });
  return lastStatus;
}

export function createConnection(endpoint = SOLANA_RPC_URL) {
  console.log("[solana] createConnection", { endpoint });
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

const READONLY_WALLET: Wallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction | VersionedTransaction>(_transaction: T): Promise<T> => {
    throw new Error("Wallet is not connected.");
  },
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(_transactions: T[]): Promise<T[]> => {
    throw new Error("Wallet is not connected.");
  },
} as Wallet;

export function createAnchorProvider(wallet: WalletContextState, endpoint = SOLANA_RPC_URL) {
  const anchorWallet = walletAdapterToAnchorWallet(wallet) ?? READONLY_WALLET;
  console.log("[solana] createAnchorProvider", {
    endpoint,
    walletConnected: Boolean(wallet.publicKey),
    walletPublicKey: wallet.publicKey?.toBase58() ?? null,
    readonly: anchorWallet === READONLY_WALLET,
  });

  const provider = new AnchorProvider(createConnection(endpoint), anchorWallet, {
    commitment: DEFAULT_COMMITMENT,
    preflightCommitment: DEFAULT_COMMITMENT,
    maxRetries: 5,
  });

  provider.sendAndConfirm = async (
    transaction: Transaction,
    signers?: Signer[],
    options?: ConfirmOptions,
  ) => {
    const latestBlockhash = await provider.connection.getLatestBlockhash(DEFAULT_COMMITMENT);
    transaction.feePayer = provider.wallet.publicKey;
    transaction.recentBlockhash = latestBlockhash.blockhash;

    if (signers?.length) {
      transaction.partialSign(...signers);
    }

    const signed = await provider.wallet.signTransaction(transaction);
    const signature = await provider.connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: options?.skipPreflight ?? false,
      preflightCommitment: options?.preflightCommitment ?? DEFAULT_COMMITMENT,
      maxRetries: options?.maxRetries ?? 5,
    });

    console.log("[solana] tx sent", { signature });

    try {
      await provider.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        options?.commitment ?? DEFAULT_COMMITMENT,
      );
    } catch (caught) {
      console.warn("[solana] blockhash confirmation warning; polling signature status", {
        signature,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }

    await waitForSignatureConfirmation(provider.connection, signature, options?.commitment ?? DEFAULT_COMMITMENT);
    return signature;
  };

  return provider;
}

export function createQuadraticProgram(provider: AnchorProvider) {
  console.log("[solana] createQuadraticProgram", {
    programId: QUADRATIC_MARKET_PROGRAM_ID.toBase58(),
    wallet: provider.wallet.publicKey.toBase58(),
  });
  return new Program(
    { ...quadraticMarketIdlJson, address: QUADRATIC_MARKET_PROGRAM_ID.toBase58() },
    provider,
  );
}

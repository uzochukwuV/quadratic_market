"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  deriveGlobalConfig,
  deriveMarket,
  TOKEN_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  SYSTEM_PROGRAM,
} from "@/lib/client";

export function getProgramAddress(): string {
  return "Ag5ccPBKNJbw1JZiTaMEZ1fZpfcDFkMrrwXqCkQA5ji9";
}

export function getGlobalConfig(): PublicKey {
  return deriveGlobalConfig();
}

export interface MarketAccount {
  market_id: number;
  title: string;
  category: string;
  status: "Open" | "Closed" | "Settled";
  epoch_id: number;
  lmsr_b: number;
  exposure: number;
  num_outcomes: number;
  settlement_time: number;
  market_mode: "Trading" | "FixedOdds";
  description?: string;
  winning_outcome?: number;
}

// IDL embedded for client-side use (minimal version for trading)
const IDL = {
  "address": "Ag5ccPBKNJbw1JZiTaMEZ1fZpfcDFkMrrwXqCkQA5ji9",
  "metadata": { "name": "quadraticMarket", "version": "0.1.0", "spec": "0.1.0" },
  "instructions": [
    {
      "name": "buyShares",
      "accounts": [
        { "name": "globalConfig" }, { "name": "market" }, { "name": "treasury" },
        { "name": "buyerBaseAta" }, { "name": "treasuryBaseAta" }, { "name": "buyerOutcomeAta" },
        { "name": "outcomeMint" }, { "name": "baseMint" }, { "name": "buyer", "signer": true },
        { "name": "tokenProgram" }, { "name": "associatedTokenProgram" }, { "name": "systemProgram" }
      ],
      "args": [{ "name": "outcomeId", "type": "u64" }, { "name": "numShares", "type": "u64" }, { "name": "maxPayment", "type": "u64" }]
    },
    {
      "name": "sellShares",
      "accounts": [
        { "name": "globalConfig" }, { "name": "market" }, { "name": "treasury" },
        { "name": "sellerOutcomeAta" }, { "name": "sellerBaseAta" }, { "name": "treasuryBaseAta" },
        { "name": "outcomeMint" }, { "name": "baseMint" }, { "name": "seller", "signer": true },
        { "name": "tokenProgram" }, { "name": "associatedTokenProgram" }
      ],
      "args": [{ "name": "outcomeId", "type": "u64" }, { "name": "numShares", "type": "u64" }, { "name": "minPayout", "type": "u64" }]
    },
    {
      "name": "addLiquidity",
      "accounts": [
        { "name": "globalConfig", "writable": true },
        { "name": "lpMint" }, { "name": "treasury" }, { "name": "treasuryBaseAta" },
        { "name": "providerBaseAta" }, { "name": "providerLpAta" }, { "name": "baseMint" },
        { "name": "pendingLiquidity", "writable": true }, { "name": "provider", "signer": true },
        { "name": "tokenProgram" }, { "name": "associatedTokenProgram" }, { "name": "systemProgram" }
      ],
      "args": [{ "name": "amount", "type": "u64" }]
    }
  ]
};

export function useProgram() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  
  const [program, setProgram] = useState<any>(null);
  const [provider, setProvider] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    
    try {
      const wallet = {
        publicKey: publicKey || PublicKey.default,
        signTransaction: signTransaction || (async (tx: Transaction) => tx),
        signAllTransactions: signAllTransactions || (async (txs: Transaction[]) => txs),
      };
      
      const anchorProvider = new AnchorProvider(connection, wallet as any, {
        commitment: "confirmed",
      });
      
      const prog = new Program(IDL as any, anchorProvider);
      
      setProvider(anchorProvider);
      setProgram(prog);
      setLoading(false);
    } catch (err) {
      console.error("Failed to create program:", err);
      setError(err instanceof Error ? err.message : "Failed to initialize");
      setLoading(false);
    }
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  return { program, provider, loading, error };
}

export function useMarkets() {
  const { connection } = useConnection();
  const [markets, setMarkets] = useState<MarketAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    if (!connection) return;
    
    try {
      setLoading(true);
      setMarkets([]);
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch markets:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch");
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  return { markets, loading, error, refetch: fetchMarkets };
}

export function useBuyShares() {
  const { program, provider } = useProgram();
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyShares = useCallback(async (
    marketId: number,
    outcomeId: number,
    numShares: number,
    maxPayment: number
  ) => {
    if (!program || !provider || !publicKey) {
      setError("Wallet not connected");
      return null;
    }

    try {
      setLoading(true);
      setError(null);

      const marketPubkey = deriveMarket(marketId);
      const globalConfig = deriveGlobalConfig();

      const tx = await program.methods
        .buyShares(
          new BN(outcomeId),
          new BN(numShares),
          new BN(maxPayment)
        )
        .accounts({
          globalConfig: globalConfig,
          market: marketPubkey,
          buyer: publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
          systemProgram: SYSTEM_PROGRAM,
        })
        .transaction();

      const signature = await provider.sendAndConfirm(tx);
      setLoading(false);
      return signature;
    } catch (err) {
      console.error("Buy shares failed:", err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setLoading(false);
      return null;
    }
  }, [program, provider, publicKey]);

  return { buyShares, loading, error };
}

export function useSellShares() {
  const { program, provider } = useProgram();
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sellShares = useCallback(async (
    marketId: number,
    outcomeId: number,
    numShares: number,
    minPayout: number
  ) => {
    if (!program || !provider || !publicKey) {
      setError("Wallet not connected");
      return null;
    }

    try {
      setLoading(true);
      setError(null);

      const marketPubkey = deriveMarket(marketId);
      const globalConfig = deriveGlobalConfig();

      const tx = await program.methods
        .sellShares(
          new BN(outcomeId),
          new BN(numShares),
          new BN(minPayout)
        )
        .accounts({
          globalConfig: globalConfig,
          market: marketPubkey,
          seller: publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
        })
        .transaction();

      const signature = await provider.sendAndConfirm(tx);
      setLoading(false);
      return signature;
    } catch (err) {
      console.error("Sell shares failed:", err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setLoading(false);
      return null;
    }
  }, [program, provider, publicKey]);

  return { sellShares, loading, error };
}

export function useAddLiquidity() {
  const { program, provider } = useProgram();
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addLiquidity = useCallback(async (amount: number) => {
    if (!program || !provider || !publicKey) {
      setError("Wallet not connected");
      return null;
    }

    try {
      setLoading(true);
      setError(null);

      const globalConfig = deriveGlobalConfig();
      const pendingLiquidity = PublicKey.findProgramAddressSync(
        [Buffer.from("pending_liquidity"), publicKey.toBuffer()],
        new PublicKey("Ag5ccPBKNJbw1JZiTaMEZ1fZpfcDFkMrrwXqCkQA5ji9")
      )[0];

      const tx = await program.methods
        .addLiquidity(new BN(amount))
        .accounts({
          globalConfig: globalConfig,
          pendingLiquidity: pendingLiquidity,
          provider: publicKey,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
          systemProgram: SYSTEM_PROGRAM,
        })
        .transaction();

      const signature = await provider.sendAndConfirm(tx);
      setLoading(false);
      return signature;
    } catch (err) {
      console.error("Add liquidity failed:", err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setLoading(false);
      return null;
    }
  }, [program, provider, publicKey]);

  return { addLiquidity, loading, error };
}

export function useMarketPrices(marketId: number) {
  const { connection } = useConnection();
  const [prices, setPrices] = useState<[number, number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPrices() {
      if (!connection) return;
      
      try {
        setLoading(true);
        const marketPubkey = deriveMarket(marketId);
        const accountInfo = await connection.getAccountInfo(marketPubkey);
        
        if (accountInfo) {
          // Would decode Market struct here
        }
        
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch");
        setLoading(false);
      }
    }
    
    fetchPrices();
  }, [connection, marketId]);

  return { prices, loading, error };
}

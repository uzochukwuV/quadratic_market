"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { createAnchorProvider, createConnection, createQuadraticProgram } from "@/lib/solana/provider";

export function useSolanaConnection() {
  return useMemo(() => createConnection(), []);
}

export function useAnchorProvider() {
  const wallet = useWallet();

  return useMemo(() => {
    return createAnchorProvider(wallet);
  }, [wallet]);
}

export function useQuadraticProgram() {
  const provider = useAnchorProvider();

  return useMemo(() => {
    return provider ? createQuadraticProgram(provider) : null;
  }, [provider]);
}

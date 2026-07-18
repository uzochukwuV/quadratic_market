"use client";

import { useEffect, useState } from "react";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { BASE_MINT_ADDRESS } from "@/lib/solana/env";
import { useSolanaConnection } from "./useQuadraticProgram";

export function useBaseTokenBalance() {
  const { publicKey } = useWallet();
  const connection = useSolanaConnection();
  const [amount, setAmount] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function refetch() {
    if (!publicKey) {
      setAmount(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const ata = await getAssociatedTokenAddress(BASE_MINT_ADDRESS, publicKey);
      const account = await getAccount(connection, ata);
      setAmount(account.amount);
    } catch (caught) {
      setAmount(BigInt(0));
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58()]);

  return { amount, loading, error, refetch };
}

"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BOT_API_ORIGIN } from "@/lib/solana/env";

type MintStatus = "idle" | "minting" | "success" | "error";

type MintBaseResponse = {
  recipient: string;
  recipient_ata: string;
  amount: number;
  signature: string;
};

const DEFAULT_MINT_AMOUNT = 1_000_000;

export function useMintBaseToken(onSuccess?: () => Promise<void> | void) {
  const { publicKey, connected } = useWallet();
  const [status, setStatus] = useState<MintStatus>("idle");
  const [error, setError] = useState<string>("");
  const [lastMint, setLastMint] = useState<MintBaseResponse | null>(null);

  async function mint(amount = DEFAULT_MINT_AMOUNT) {
    if (!connected || !publicKey) {
      setStatus("error");
      setError("Connect a wallet first.");
      return null;
    }

    const origin = BOT_API_ORIGIN || "http://localhost:8787";
    setStatus("minting");
    setError("");

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const apiKey = process.env.NEXT_PUBLIC_BOT_API_KEY;
      if (apiKey) headers["X-API-Key"] = apiKey;

      const response = await fetch(`${origin}/api/mint-base`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          recipient: publicKey.toBase58(),
          amount,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.detail ?? `Mint request failed with HTTP ${response.status}`;
        throw new Error(Array.isArray(detail) ? detail.map((item) => item.msg).join(", ") : String(detail));
      }

      setLastMint(payload as MintBaseResponse);
      setStatus("success");
      await onSuccess?.();
      return payload as MintBaseResponse;
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    }
  }

  return { mint, status, error, lastMint };
}

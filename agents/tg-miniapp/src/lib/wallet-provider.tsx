import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "./wallet-modal";
import { RPC_URL } from "./solana-config";

// Modern wallets (Phantom, Solflare, Backpack) self-register via the
// Wallet Standard — no explicit adapter imports needed.
const WALLETS: [] = [];

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => RPC_URL, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={WALLETS} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

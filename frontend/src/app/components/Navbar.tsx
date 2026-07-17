"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useState, useEffect, useCallback } from "react";
import { useBetSlip } from "./BetSlipDrawer";
import { frontendEnv, getNetworkLabel } from "@/lib/env";

const NAV_LINKS = [
  { label: "Markets",   href: "/markets"   },
  { label: "Trade",     href: "/trade"     },
  { label: "Epochs",    href: "/epochs"    },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Liquidity", href: "/liquidity" },
];

const BASE_DECIMALS = 6;
const MAX_MINT_AMOUNT = 1000;
const BASE_MINT_PUBKEY = new PublicKey(frontendEnv.baseMint);
const formatAmount = (value: number, maxFractionDigits = 4) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
const shortSignature = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;

export function Navbar({ onSlipOpen }: { onSlipOpen?: () => void }) {
  const pathname = usePathname();
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mintOpen, setMintOpen] = useState(false);
  const [mintAmount, setMintAmount] = useState("100");
  const [mintBusy, setMintBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [baseBalance, setBaseBalance] = useState<string>("0");
  const [solBalance, setSolBalance] = useState<string>("0");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const { items } = useBetSlip();

  const refreshBalance = useCallback(async () => {
    if (!connection || !publicKey) {
      setBaseBalance("0");
      setSolBalance("0");
      return;
    }

    try {
      setBalanceLoading(true);
      const [lamports, ata] = await Promise.all([
        connection.getBalance(publicKey),
        getAssociatedTokenAddress(BASE_MINT_PUBKEY, publicKey),
      ]);
      setSolBalance(formatAmount(lamports / LAMPORTS_PER_SOL, 4));

      const info = await connection.getAccountInfo(ata);
      if (!info) {
        setBaseBalance("0");
        return;
      }

      const balance = await connection.getTokenAccountBalance(ata);
      setBaseBalance(balance.value.uiAmountString ?? "0");
    } catch {
      setBaseBalance("0");
      setSolBalance("0");
    } finally {
      setBalanceLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance, connected, publicKey?.toBase58(), connection?.rpcEndpoint]);
  useEffect(() => {
    if (!connected) {
      setMintOpen(false);
      setToast(null);
    }
  }, [connected]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleMintBase = async () => {
    if (!publicKey) {
      setToast({ type: "error", message: "Connect a wallet first." });
      return;
    }

    const amountTokens = Number(mintAmount);
    if (!Number.isFinite(amountTokens) || amountTokens <= 0) {
      setToast({ type: "error", message: "Enter a valid token amount." });
      return;
    }

    const amount = Math.round(amountTokens * 10 ** BASE_DECIMALS);
    if (amount <= 0) {
      setToast({ type: "error", message: "Amount is too small." });
      return;
    }

    try {
      setMintBusy(true);
      const response = await fetch("/api/mint-base", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: publicKey.toBase58(),
          amount,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail ?? "Mint request failed");
      }

      setMintAmount("100");
      setToast({
        type: "success",
        message: `Minted ${formatAmount(amountTokens, 2)} BASE${payload?.signature ? ` · ${shortSignature(payload.signature)}` : ""}`,
      });
      await refreshBalance();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Mint request failed",
      });
    } finally {
      setMintBusy(false);
    }
  };

  const balanceLabel = balanceLoading ? "..." : `${baseBalance} BASE`;
  const solLabel = balanceLoading ? "..." : `${solBalance} SOL`;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-rich-black border-b border-graphite">
      <div className="max-w-content mx-auto px-6 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 flex-shrink-0 h-full">
          <div className="w-5 h-5 rounded-full bg-cadmium-green" />
          <span className="text-body text-white font-medium tracking-tight hidden sm:block">
            Quad<span className="text-silver-text font-normal">.market</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center h-full gap-0">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname?.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`h-full px-4 flex items-center text-body transition-all duration-150 font-outfit border-b-2 ${
                  active
                    ? "text-white border-cadmium-green"
                    : "text-silver-text hover:text-white border-transparent hover:border-ash-gray/50"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 h-full">
          {/* Network badge */}
          <span className="hidden sm:flex items-center gap-2 px-3 h-9 text-caption font-mono text-silver-text border border-graphite rounded-full bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-cadmium-green pulse-dot" />
            {getNetworkLabel()}
          </span>

          {/* Balance badge */}
          <div className="hidden sm:flex items-center gap-2 px-3 h-9 text-caption font-mono text-silver-text border border-graphite rounded-full bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-ash-gray" />
            <span>{connected ? solLabel : "-- SOL"}</span>
            <span className="opacity-40">|</span>
            <span>{connected ? balanceLabel : "-- BASE"}</span>
          </div>

          {/* Bet slip button */}
          <button
            onClick={onSlipOpen}
            className="relative flex items-center gap-2 px-3 h-9 rounded-full border border-graphite text-silver-text hover:text-white hover:border-ash-gray hover:bg-white/[0.02] transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.5" y="2" width="11" height="10" rx="1" />
              <path d="M4 5h6M4 7h6M4 9h4" strokeLinecap="round" />
            </svg>
            <span className="text-caption font-mono hidden sm:block">Slip</span>
            {items.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-cadmium-green text-xs font-bold text-true-black flex items-center justify-center">
                {items.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setMintOpen(true)}
            disabled={!connected}
            className="relative flex items-center gap-2 px-3 h-9 rounded-full border border-cadmium-green/40 text-cadmium-green hover:text-white hover:border-cadmium-green hover:bg-cadmium-green/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-caption font-mono hidden sm:block">Mint Base</span>
            <span className="sm:hidden text-caption font-mono">Mint</span>
          </button>

          {/* Wallet - adjust height */}
          <div className="h-9 flex items-center">
            <WalletMultiButton />
          </div>

          {/* Mobile menu toggle */}
          <button
            className="md:hidden h-9 w-9 flex items-center justify-center text-silver-text hover:text-white transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              {menuOpen ? (
                <path d="M2 2L16 16M16 2L2 16" strokeLinecap="round" />
              ) : (
                <path d="M2 5h14M2 9h14M2 13h14" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 bg-rich-black border-b border-graphite py-3 px-6 flex flex-col">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`py-3 text-body font-mono border-b border-graphite last:border-0 transition-colors ${
                  active ? "text-cadmium-green font-medium" : "text-silver-text hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <div className="pt-3">
            <WalletMultiButton />
          </div>
        </div>
      )}

      {mintOpen && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-start justify-center px-4 pt-24">
          <div className="w-full max-w-md rounded-2xl border border-graphite bg-rich-black shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-graphite px-5 py-4">
              <div>
                <div className="text-body font-medium text-white">Mint base tokens</div>
                <div className="text-caption text-silver-text font-mono">Sent to your connected wallet</div>
              </div>
              <button
                onClick={() => setMintOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-full border border-graphite text-silver-text hover:text-white hover:border-ash-gray"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M2 2L12 12M12 2L2 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-caption font-mono text-silver-text">
                <div className="rounded-xl border border-graphite bg-white/[0.02] px-3 py-2">
                  <div className="opacity-60">Wallet</div>
                  <div className="text-white truncate">{publicKey?.toBase58() ?? "Not connected"}</div>
                </div>
                <div className="rounded-xl border border-graphite bg-white/[0.02] px-3 py-2">
                  <div className="opacity-60">SOL / BASE</div>
                  <div className="text-white">{connected ? `${solLabel} / ${balanceLabel}` : "-- / --"}</div>
                </div>
              </div>

              <label className="block space-y-2">
                <span className="flex items-center justify-between text-caption font-mono text-silver-text">
                  <span>Amount in BASE</span>
                  <button
                    type="button"
                    onClick={() => setMintAmount(String(MAX_MINT_AMOUNT))}
                    className="text-cadmium-green hover:text-white transition-colors"
                  >
                    Max
                  </button>
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={mintAmount}
                  onChange={(e) => setMintAmount(e.target.value)}
                  className="w-full h-11 rounded-xl border border-graphite bg-white/[0.03] px-4 text-body text-white outline-none focus:border-cadmium-green"
                />
              </label>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleMintBase}
                  disabled={!connected || mintBusy}
                  className="flex-1 h-11 rounded-xl bg-cadmium-green text-true-black font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {mintBusy ? "Minting..." : "Mint BASE"}
                </button>
                <button
                  onClick={() => setMintOpen(false)}
                  className="h-11 px-4 rounded-xl border border-graphite text-silver-text hover:text-white hover:border-ash-gray"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed right-4 top-20 z-[70] max-w-sm rounded-2xl border px-4 py-3 shadow-xl shadow-black/40 backdrop-blur-sm ${
            toast.type === "success"
              ? "border-cadmium-green/30 bg-cadmium-green/10 text-cadmium-green"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
        >
          <div className="text-caption font-mono opacity-70 mb-1">
            {toast.type === "success" ? "Success" : "Error"}
          </div>
          <div className="text-sm">{toast.message}</div>
        </div>
      )}
    </nav>
  );
}

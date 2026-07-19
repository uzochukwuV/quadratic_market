import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@/lib/wallet-modal";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  ChevronDown,
  Copy,
  LogOut,
  Droplets,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useMintBase, FAUCET_AMOUNT, BASE_MINT_ADDRESS } from "@/lib/bot-api";
import { BASE_TOKEN_DECIMALS } from "@/lib/solana-config";

function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Faucet amount in human-readable units */
const FAUCET_UI = FAUCET_AMOUNT / Math.pow(10, BASE_TOKEN_DECIMALS);

export function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { mutate: doMint, isPending: minting, isSuccess: minted, error: mintError, reset: resetMint } =
    useMintBase();

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        resetMint();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, resetMint]);

  const handleCopy = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey.toBase58());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleMint = () => {
    if (!publicKey || minting || minted) return;
    doMint({ recipient: publicKey.toBase58(), amount: FAUCET_AMOUNT });
  };

  if (!publicKey) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setVisible(true)}
        disabled={connecting}
        className="h-8 gap-1.5 border-primary/40 text-primary hover:bg-primary/10 text-xs font-bold px-3"
      >
        {connecting ? (
          <div className="w-3 h-3 rounded-full border border-primary border-t-transparent animate-spin" />
        ) : (
          <Wallet className="w-3.5 h-3.5" />
        )}
        {connecting ? "Connecting…" : "Connect"}
      </Button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-mono font-bold",
          "border border-primary/30 bg-primary/5 text-primary",
          "hover:bg-primary/10 active:bg-primary/15 transition-colors"
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        {shortenAddress(publicKey.toBase58())}
        <ChevronDown
          className={cn("w-3 h-3 transition-transform", menuOpen && "rotate-180")}
        />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-10 z-50 w-52 rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden">
          {/* Address row */}
          <div className="px-3 py-2 border-b border-border/40 bg-secondary/20">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">
              Wallet
            </p>
            <p className="text-xs font-mono text-foreground truncate">
              {publicKey.toBase58()}
            </p>
          </div>

          {/* Get test USDC */}
          <button
            onClick={handleMint}
            disabled={minting || minted}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-2.5 text-xs transition-colors",
              minted
                ? "bg-primary/10 text-primary"
                : mintError
                ? "text-destructive hover:bg-destructive/10"
                : "text-foreground hover:bg-secondary/60"
            )}
          >
            {minting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Droplets
                className={cn(
                  "w-3.5 h-3.5",
                  minted ? "text-primary" : mintError ? "text-destructive" : "text-cyan-400"
                )}
              />
            )}
            <span className="flex-1 text-left">
              {minting
                ? "Minting…"
                : minted
                ? `${FAUCET_UI} USDC received ✓`
                : mintError
                ? "Mint failed — retry"
                : `Get ${FAUCET_UI} test USDC`}
            </span>
          </button>

          {/* Devnet explorer link for mint */}
          <a
            href={`https://explorer.solana.com/address/${BASE_MINT_ADDRESS}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View USDC mint
          </a>

          <div className="h-px bg-border/40" />

          {/* Copy address */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 w-full px-3 py-2.5 text-xs hover:bg-secondary/60 transition-colors text-foreground"
          >
            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            {copied ? "Copied!" : "Copy address"}
          </button>

          {/* Disconnect */}
          <button
            onClick={() => { disconnect(); setMenuOpen(false); }}
            className="flex items-center gap-2 w-full px-3 py-2.5 text-xs hover:bg-destructive/10 transition-colors text-destructive"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

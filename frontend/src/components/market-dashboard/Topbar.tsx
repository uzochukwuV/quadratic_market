"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { useBaseTokenBalance } from "@/hooks/useBaseTokenBalance";
import { useMintBaseToken } from "@/hooks/useMintBaseToken";
import { Icon } from "./Icon";

function formatBaseBalance(amount: bigint | null) {
  if (amount === null) return "0.00";
  return (Number(amount) / 1_000_000).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function Topbar() {
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const pathname = usePathname();
  const balance = useBaseTokenBalance();
  const mint = useMintBaseToken(balance.refetch);
  const minting = mint.status === "minting";
  const [mintOpen, setMintOpen] = useState(false);
  const [mintAmount, setMintAmount] = useState("1000");

  function mintOrConnect() {
    if (!wallet.connected) {
      walletModal.setVisible(true);
      return;
    }

    setMintOpen(true);
  }

  async function submitMint() {
    const amount = Number(mintAmount);
    if (!Number.isFinite(amount) || amount <= 0 || minting) return;

    const minted = await mint.mint(Math.round(amount * 1_000_000));
    if (minted) setMintOpen(false);
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">Q</span>
        <span>Quadratic Market</span>
      </div>

      <nav className="main-nav" aria-label="Primary">
        <Link className={pathname === "/" ? "active" : ""} href="/">
          Sports
        </Link>
        <button>Live</button>
        <Link className={pathname?.startsWith("/bets") ? "active" : ""} href="/bets">
          My Bets
        </Link>
        <Link className={pathname?.startsWith("/lp") ? "active" : ""} href="/lp">
          Liquidity
        </Link>
      </nav>

      <div className="header-actions">
        <button className="icon-button" aria-label="Search">
          <Icon name="search" />
        </button>
        <div className="balance-pill">
          <span>BASE</span>
          <b>{balance.loading ? "..." : formatBaseBalance(balance.amount)}</b>
        </div>
        <button className="mint-button" type="button" onClick={mintOrConnect} disabled={minting}>
          <Icon name="mint" size={15} />
          <span>{minting ? "Minting" : wallet.connected ? "Mint base" : "Connect to mint"}</span>
        </button>
        <WalletConnectButton />
      </div>

      {mint.error && <div className="topbar-toast">{mint.error}</div>}
      {mint.status === "success" && mint.lastMint && <div className="topbar-toast success">Minted BASE: {mint.lastMint.signature.slice(0, 10)}...</div>}

      {mintOpen && (
        <div className="modal-backdrop" onClick={() => setMintOpen(false)}>
          <div className="mint-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span>Mock USDC BASE</span>
                <b>Mint test balance</b>
              </div>
              <button type="button" onClick={() => setMintOpen(false)} aria-label="Close mint modal">
                <Icon name="x" size={16} />
              </button>
            </div>

            <label className="mint-field">
              <span>Amount</span>
              <div>
                <input
                  inputMode="decimal"
                  value={mintAmount}
                  onChange={(event) => setMintAmount(event.target.value.replace(/[^\d.]/g, ""))}
                />
                <b>BASE</b>
              </div>
            </label>

            <div className="quick-mint">
              {["100", "1000", "5000"].map((amount) => (
                <button key={amount} type="button" onClick={() => setMintAmount(amount)}>
                  {amount}
                </button>
              ))}
            </div>

            {mint.error && <p className="modal-error">{mint.error}</p>}

            <button className="modal-submit" type="button" onClick={() => void submitMint()} disabled={minting || Number(mintAmount) <= 0}>
              {minting ? "Minting" : "Mint mock BASE"}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

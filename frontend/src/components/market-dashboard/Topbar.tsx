"use client";

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
  const balance = useBaseTokenBalance();
  const mint = useMintBaseToken(balance.refetch);
  const minting = mint.status === "minting";

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">Q</span>
        <span>Quadratic Market</span>
      </div>

      <nav className="main-nav" aria-label="Primary">
        <button className="active">Sports</button>
        <button>Live</button>
        <button>My Bets</button>
        <button>Liquidity</button>
      </nav>

      <div className="header-actions">
        <button className="icon-button" aria-label="Search">
          <Icon name="search" />
        </button>
        <div className="balance-pill">
          <span>BASE</span>
          <b>{balance.loading ? "..." : formatBaseBalance(balance.amount)}</b>
        </div>
        <button className="mint-button" onClick={() => void mint.mint()} disabled={minting}>
          <Icon name="mint" size={15} />
          <span>{minting ? "Minting" : "Mint base"}</span>
        </button>
        <WalletConnectButton />
      </div>

      {mint.error && <div className="topbar-toast">{mint.error}</div>}
      {mint.status === "success" && mint.lastMint && <div className="topbar-toast success">Minted BASE: {mint.lastMint.signature.slice(0, 10)}...</div>}
    </header>
  );
}

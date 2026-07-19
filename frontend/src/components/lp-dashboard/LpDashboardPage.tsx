"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Topbar } from "@/components/market-dashboard/Topbar";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import {
  useBaseTokenBalance,
  useEpochLiquidityActions,
  useEpochs,
  useEpochVaults,
  useGlobalConfig,
  useMarkets,
  useMintBaseToken,
  useUserEpochLpPositions,
} from "@/hooks";

const BASE_DECIMALS = 1_000_000;
const SCALE = 1_000_000;

type AccountRecord<T = any> = {
  publicKey?: { toBase58?: () => string };
  account: T;
};

function enumKey(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>)[0] ?? "";
  return "";
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof (value as { toNumber?: () => number }).toNumber === "function") {
    const next = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(next) ? next : fallback;
  }
  if (value && typeof (value as { toString?: () => string }).toString === "function") {
    const next = Number((value as { toString: () => string }).toString());
    return Number.isFinite(next) ? next : fallback;
  }
  return fallback;
}

function base(value: unknown) {
  return (toNumber(value) / BASE_DECIMALS).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shares(value: unknown) {
  return (toNumber(value) / BASE_DECIMALS).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateTime(seconds: unknown) {
  const value = toNumber(seconds);
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-NG", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function durationUntil(seconds: number, now: number) {
  const delta = seconds - now;
  if (delta <= 0) return "now";
  const hours = Math.floor(delta / 3600);
  const minutes = Math.floor((delta % 3600) / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function progress(settled: number, total: number) {
  if (!total) return 100;
  return Math.min(100, Math.round((settled / total) * 100));
}

function sanitizeAmount(value: string) {
  return value.replace(/[^\d.]/g, "");
}

export function LpDashboardPage() {
  const wallet = useWallet();
  const config = useGlobalConfig();
  const epochs = useEpochs();
  const vaults = useEpochVaults();
  const markets = useMarkets();
  const positions = useUserEpochLpPositions(wallet.publicKey);
  const balance = useBaseTokenBalance();
  const mintBase = useMintBaseToken(balance.refetch);
  const liquidity = useEpochLiquidityActions();
  const [depositInputs, setDepositInputs] = useState<Record<string, string>>({});
  const [withdrawInputs, setWithdrawInputs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");

  const now = Math.floor(Date.now() / 1000);
  const paused = Boolean((config.data as any)?.paused);
  const epochPaused = Boolean((config.data as any)?.epochPaused);
  const currentEpoch = toNumber((config.data as any)?.currentEpoch);

  const marketsByEpoch = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const entry of (markets.data ?? []) as AccountRecord[]) {
      const epochId = String(toNumber(entry.account.epochId ?? currentEpoch));
      grouped.set(epochId, [...(grouped.get(epochId) ?? []), entry.account]);
    }
    return grouped;
  }, [markets.data, currentEpoch]);

  const epochById = useMemo(() => {
    const byId = new Map<string, any>();
    for (const entry of (epochs.data ?? []) as AccountRecord[]) {
      byId.set(String(toNumber(entry.account.epochId)), entry.account);
    }
    return byId;
  }, [epochs.data]);

  const positionByEpoch = useMemo(() => {
    const byId = new Map<string, any>();
    for (const entry of (positions.data ?? []) as AccountRecord[]) {
      byId.set(String(toNumber(entry.account.epochId)), entry.account);
    }
    return byId;
  }, [positions.data]);

  const rows = useMemo(() => {
    return ((vaults.data ?? []) as AccountRecord[])
      .map((entry) => {
        const epochId = String(toNumber(entry.account.epochId));
        const epochMarkets = marketsByEpoch.get(epochId) ?? [];
        const starts = epochMarkets.map((market) => toNumber(market.startTime)).filter(Boolean);
        const earliestStart = starts.length ? Math.min(...starts) : 0;
        const marketStarted = epochMarkets.some((market) => {
          const status = enumKey(market.status).toLowerCase();
          const start = toNumber(market.startTime);
          return status !== "open" || (start > 0 && start <= now);
        });
        const settledMarkets = epochMarkets.filter((market) => enumKey(market.status).toLowerCase() === "settled").length;
        return {
          epochId,
          vault: entry.account,
          epoch: epochById.get(epochId),
          position: positionByEpoch.get(epochId),
          markets: epochMarkets,
          earliestStart,
          marketStarted,
          settledMarkets,
        };
      })
      .sort((a, b) => toNumber(b.epochId) - toNumber(a.epochId));
  }, [epochById, marketsByEpoch, now, positionByEpoch, vaults.data]);

  const totalDeposits = rows.reduce((sum, row) => sum + toNumber(row.vault.totalDeposits), 0);
  const totalUserShares = rows.reduce((sum, row) => sum + toNumber(row.position?.shares), 0);
  const activePools = rows.filter((row) => !row.vault.withdrawalsEnabled && !row.marketStarted).length;
  const withdrawablePools = rows.filter((row) => row.vault.withdrawalsEnabled && toNumber(row.position?.shares) > 0).length;

  async function refreshAll() {
    await Promise.all([
      config.refetch(),
      epochs.refetch(),
      vaults.refetch(),
      markets.refetch(),
      positions.refetch(),
      balance.refetch(),
    ]);
  }

  async function deposit(epochId: string) {
    if (!wallet.connected) return;
    const value = Number(depositInputs[epochId] || 0);
    if (!Number.isFinite(value) || value <= 0 || liquidity.loading || mintBase.status === "minting") return;
    const amount = BigInt(Math.round(value * BASE_DECIMALS));
    try {
      setNotice("");
      const currentBalance = balance.amount ?? BigInt(0);
      if (currentBalance < amount) {
        const minted = await mintBase.mint(Number(amount - currentBalance));
        if (!minted) return;
      }
      await liquidity.deposit(epochId, amount);
      setDepositInputs((current) => ({ ...current, [epochId]: "" }));
      setNotice(`Deposited ${value.toLocaleString("en-NG")} BASE into epoch ${epochId}.`);
      await refreshAll();
    } catch {
      // Action hook exposes the error.
    }
  }

  async function withdraw(epochId: string, maxShares: number) {
    if (!wallet.connected) return;
    const value = Number(withdrawInputs[epochId] || 0);
    if (!Number.isFinite(value) || value <= 0 || liquidity.loading) return;
    const shareUnits = BigInt(Math.min(Math.round(value * BASE_DECIMALS), maxShares));
    try {
      setNotice("");
      await liquidity.withdraw(epochId, shareUnits);
      setWithdrawInputs((current) => ({ ...current, [epochId]: "" }));
      setNotice(`Withdrew ${value.toLocaleString("en-NG")} LP shares from epoch ${epochId}.`);
      await refreshAll();
    } catch {
      // Action hook exposes the error.
    }
  }

  return (
    <main className="app-shell">
      <Topbar />

      <section className="lp-page">
        <div className="lp-hero">
          <div>
            <span className="eyebrow">EPOCH LIQUIDITY</span>
            <h1>LP dashboard</h1>
            <p>Deposit BASE into a published epoch before its first market starts, then withdraw pro-rata after that epoch settles.</p>
          </div>
          <WalletConnectButton />
        </div>

        <div className="lp-summary">
          <div><span>Current epoch</span><b>{currentEpoch || "N/A"}</b></div>
          <div><span>Total epoch deposits</span><b>N{base(totalDeposits)}</b></div>
          <div><span>Your LP shares</span><b>{shares(totalUserShares)}</b></div>
          <div><span>Withdrawable pools</span><b>{withdrawablePools}</b></div>
        </div>

        <div className="lp-window-note">
          <b>How LPs know when to deposit</b>
          <span>
            The bot publishes an epoch and vault first. This page reads that vault, lists the epoch timing, and shows the first market start time. Deposit while the window says open; once a market has started, new deposits should be treated as closed for that epoch.
          </span>
        </div>

        {(notice || liquidity.error || mintBase.error) && (
          <div className={`lp-notice ${liquidity.error || mintBase.error ? "error" : ""}`}>
            {liquidity.error?.message ?? mintBase.error ?? notice}
          </div>
        )}

        <div className="lp-panel">
          <div className="lp-panel-head">
            <div>
              <b>Epoch pools</b>
              <span>{activePools} open for pre-market deposits</span>
            </div>
            <button type="button" onClick={() => void refreshAll()}>
              Refresh
            </button>
          </div>

          {(epochs.loading || vaults.loading || markets.loading || positions.loading) && <div className="lp-empty">Loading LP accounts...</div>}
          {(epochs.error || vaults.error || markets.error || positions.error) && (
            <div className="lp-empty error">
              {epochs.error?.message ?? vaults.error?.message ?? markets.error?.message ?? positions.error?.message}
            </div>
          )}
          {!wallet.connected && <div className="lp-empty">Connect your wallet to deposit, withdraw, and track your epoch positions.</div>}
          {wallet.connected && !vaults.loading && rows.length === 0 && <div className="lp-empty">No published epoch vaults found.</div>}

          {rows.map((row) => {
            const epochId = row.epochId;
            const depositOpen = !paused && !epochPaused && !row.vault.withdrawalsEnabled && !row.marketStarted;
            const userShares = toNumber(row.position?.shares);
            const sharePrice = toNumber(row.vault.totalShares) > 0
              ? (toNumber(row.vault.totalDeposits) - toNumber(row.vault.totalWithdrawals)) / toNumber(row.vault.totalShares)
              : 0;
            const claimValue = userShares * sharePrice;
            const canWithdraw = Boolean(row.vault.withdrawalsEnabled && userShares > 0 && !row.position?.withdrawn);
            const settlementProgress = progress(row.settledMarkets, row.markets.length);
            const depositText = row.earliestStart
              ? depositOpen
                ? `Open for ${durationUntil(row.earliestStart, now)}`
                : `Closed at ${dateTime(row.earliestStart)}`
              : depositOpen
                ? "Open until markets are added"
                : "Closed";

            return (
              <article className="lp-card" key={epochId}>
                <div className="lp-card-head">
                  <div>
                    <span>Epoch #{epochId}</span>
                    <b>{toNumber(epochId) === currentEpoch ? "Current pool" : row.vault.withdrawalsEnabled ? "Settlement complete" : "Published pool"}</b>
                  </div>
                  <strong className={depositOpen ? "open" : canWithdraw ? "withdraw" : "closed"}>
                    {depositOpen ? "Deposit open" : canWithdraw ? "Withdraw ready" : "Deposit closed"}
                  </strong>
                </div>

                <div className="lp-metrics">
                  <div><span>Total deposits</span><b>N{base(row.vault.totalDeposits)}</b></div>
                  <div><span>Total shares</span><b>{shares(row.vault.totalShares)}</b></div>
                  <div><span>Your shares</span><b>{shares(userShares)}</b></div>
                  <div><span>Your claim value</span><b>N{base(claimValue)}</b></div>
                </div>

                <div className="lp-epoch-grid">
                  <div><span>Epoch start</span><b>{dateTime(row.epoch?.startTime ?? row.vault.createdAt)}</b></div>
                  <div><span>Epoch end</span><b>{dateTime(row.epoch?.endTime)}</b></div>
                  <div><span>First market starts</span><b>{dateTime(row.earliestStart)}</b></div>
                  <div><span>Markets</span><b>{row.settledMarkets}/{row.markets.length} settled</b></div>
                </div>

                <div className="lp-progress">
                  <span style={{ width: `${settlementProgress}%` }} />
                </div>

                <div className="lp-actions">
                  <div>
                    <label>
                      <span>Deposit BASE</span>
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={depositInputs[epochId] ?? ""}
                        onChange={(event) => setDepositInputs((current) => ({ ...current, [epochId]: sanitizeAmount(event.target.value) }))}
                      />
                    </label>
                    <button type="button" disabled={!wallet.connected || !depositOpen || liquidity.loading} onClick={() => void deposit(epochId)}>
                      {liquidity.loading ? "Working" : "Deposit"}
                    </button>
                  </div>

                  <div>
                    <label>
                      <span>Withdraw shares</span>
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={withdrawInputs[epochId] ?? ""}
                        onChange={(event) => setWithdrawInputs((current) => ({ ...current, [epochId]: sanitizeAmount(event.target.value) }))}
                      />
                    </label>
                    <button type="button" disabled={!wallet.connected || !canWithdraw || liquidity.loading} onClick={() => void withdraw(epochId, userShares)}>
                      Withdraw
                    </button>
                  </div>
                </div>

                <div className="lp-card-foot">
                  <span>{depositText}</span>
                  <span>{paused || epochPaused ? "Protocol or epoch is paused" : row.vault.withdrawalsEnabled ? "Withdrawals enabled" : "Withdrawals unlock after settlement"}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

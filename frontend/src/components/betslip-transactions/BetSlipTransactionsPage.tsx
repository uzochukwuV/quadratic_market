"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Topbar } from "@/components/market-dashboard/Topbar";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { useMarkets, useUserSlips } from "@/hooks";
import { Icon } from "@/components/market-dashboard/Icon";

const BASE_DECIMALS = 1_000_000;

type SlipTab = "all" | "pending" | "live" | "settled";

type AccountRecord<T = any> = {
  publicKey?: { toBase58?: () => string };
  account: T;
};

function enumKey(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys[0] ?? "";
  }
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

function money(value: unknown) {
  return (toNumber(value) / BASE_DECIMALS).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateTime(seconds: unknown) {
  const value = toNumber(seconds);
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-NG", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function expectedMask(numLegs: number) {
  return numLegs <= 0 ? 0 : (1 << numLegs) - 1;
}

function hasBit(mask: number, index: number) {
  return (mask & (1 << index)) !== 0;
}

function statusBucket(slip: any): SlipTab {
  const raw = enumKey(slip.status).toLowerCase();
  const legs = toNumber(slip.numLegs);
  const boughtMask = toNumber(slip.legsBoughtMask);
  if (raw === "pending" && boughtMask !== expectedMask(legs)) return "pending";
  if (raw === "active" || (raw === "pending" && boughtMask === expectedMask(legs))) return "live";
  return "settled";
}

function statusLabel(slip: any) {
  const raw = enumKey(slip.status);
  const bucket = statusBucket(slip);
  if (bucket === "pending") return "Pending purchase";
  if (bucket === "live") return "Live";
  return raw || "Settled";
}

function outcomeName(market: any, outcomeId: number) {
  const marketType = enumKey(market?.marketType).toLowerCase();
  if (marketType === "matchresult") return ["1", "X", "2"][outcomeId] ?? `Outcome ${outcomeId}`;
  if (marketType === "totalgoals") return ["O2.5", "U2.5"][outcomeId] ?? `Outcome ${outcomeId}`;
  if (marketType === "bothteamscore") return ["GG", "NG"][outcomeId] ?? `Outcome ${outcomeId}`;
  return `Outcome ${outcomeId}`;
}

function oddFor(market: any, outcomeId: number) {
  const raw = market?.odds?.[outcomeId];
  const value = toNumber(raw);
  return value ? (value / 10_000).toFixed(2) : "N/A";
}

export function BetSlipTransactionsPage() {
  const wallet = useWallet();
  const slips = useUserSlips(wallet.publicKey);
  const markets = useMarkets();
  const [tab, setTab] = useState<SlipTab>("all");

  const marketById = useMemo(() => {
    const byId = new Map<string, any>();
    for (const entry of (markets.data ?? []) as AccountRecord[]) {
      byId.set(String(toNumber(entry.account.marketId)), entry.account);
    }
    return byId;
  }, [markets.data]);

  const rows = useMemo(() => {
    return ((slips.data ?? []) as AccountRecord[])
      .map((entry) => ({ entry, bucket: statusBucket(entry.account), slipId: toNumber(entry.account.slipId) }))
      .filter((row) => tab === "all" || row.bucket === tab)
      .sort((a, b) => b.slipId - a.slipId);
  }, [slips.data, tab]);

  const counts = useMemo(() => {
    const all = ((slips.data ?? []) as AccountRecord[]).map((entry) => statusBucket(entry.account));
    return {
      all: all.length,
      pending: all.filter((status) => status === "pending").length,
      live: all.filter((status) => status === "live").length,
      settled: all.filter((status) => status === "settled").length,
    };
  }, [slips.data]);

  return (
    <main className="app-shell">
      <Topbar />

      <section className="bets-page">
        <div className="bets-hero">
          <div>
            <span className="eyebrow">USER BETSLIPS</span>
            <h1>Bet slip transactions</h1>
            <p>
              {wallet.connected
                ? `Showing on-chain slips for ${wallet.publicKey?.toBase58().slice(0, 8)}...${wallet.publicKey?.toBase58().slice(-6)}`
                : "Connect a wallet to load your bet slip history"}
            </p>
          </div>
          <WalletConnectButton />
        </div>

        <div className="bets-summary">
          <div><span>Total</span><b>{counts.all}</b></div>
          <div><span>Pending</span><b>{counts.pending}</b></div>
          <div><span>Live</span><b>{counts.live}</b></div>
          <div><span>Settled</span><b>{counts.settled}</b></div>
        </div>

        <div className="bets-panel">
          <div className="bets-tabs">
            {(["all", "pending", "live", "settled"] as SlipTab[]).map((item) => (
              <button key={item} className={tab === item ? "active" : ""} type="button" onClick={() => setTab(item)}>
                {item}
                <span>{counts[item]}</span>
              </button>
            ))}
            <button type="button" onClick={() => { void slips.refetch(); void markets.refetch(); }}>
              Refresh
            </button>
          </div>

          {(slips.loading || markets.loading) && <div className="bets-empty">Loading bet slip transactions...</div>}
          {slips.error && <div className="bets-empty error">Slip fetch failed: {slips.error.message}</div>}
          {markets.error && <div className="bets-empty error">Market details failed: {markets.error.message}</div>}
          {!wallet.connected && <div className="bets-empty">Wallet connection is required to fetch user bet slips.</div>}
          {wallet.connected && !slips.loading && !slips.error && rows.length === 0 && <div className="bets-empty">No bet slips found for this filter.</div>}

          {rows.map(({ entry, bucket }) => {
            const slip = entry.account;
            const numLegs = toNumber(slip.numLegs);
            const marketIds = Array.from({ length: numLegs }, (_, index) => toNumber(slip.legMarketIds?.[index]));
            const outcomeIds = Array.from({ length: numLegs }, (_, index) => toNumber(slip.legOutcomeIds?.[index]));
            const boughtMask = toNumber(slip.legsBoughtMask);
            const settledMask = toNumber(slip.legsSettledMask);
            const wonMask = toNumber(slip.legsWonMask);
            const account = entry.publicKey?.toBase58?.() ?? "";

            return (
              <article className={`bets-card ${bucket}`} key={account || toNumber(slip.slipId)}>
                <div className="bets-card-head">
                  <div>
                    <span>Slip #{String(toNumber(slip.slipId))}</span>
                    <b>{statusLabel(slip)}</b>
                  </div>
                  <div className="bets-status-meta">
                    <span>Epoch {String(toNumber(slip.epochId))}</span>
                    <strong>{bucket}</strong>
                  </div>
                </div>

                <div className="bets-money-grid">
                  <div><span>Stake</span><b>N{money(slip.totalStake)}</b></div>
                  <div><span>Cost</span><b>N{money(slip.totalCost)}</b></div>
                  <div><span>Potential payout</span><b>N{money(slip.potentialPayout)}</b></div>
                  <div><span>Created</span><b>{dateTime(slip.createdAt)}</b></div>
                </div>

                <div className="bets-leg-table">
                  <div className="bets-leg-head">
                    <span>Leg</span>
                    <span>Market</span>
                    <span>Pick</span>
                    <span>Odds</span>
                    <span>State</span>
                  </div>
                  {marketIds.map((marketId, index) => {
                    const market = marketById.get(String(marketId));
                    const outcomeId = outcomeIds[index] ?? 0;
                    const bought = hasBit(boughtMask, index);
                    const settled = hasBit(settledMask, index);
                    const won = hasBit(wonMask, index);
                    return (
                      <div className="bets-leg-row" key={`${marketId}-${index}`}>
                        <span>{index + 1}</span>
                        <span>
                          <b>{market?.title ?? `Market #${marketId}`}</b>
                          <small>#{marketId} - {enumKey(market?.status) || "unknown"}</small>
                        </span>
                        <span>{outcomeName(market, outcomeId)}</span>
                        <span>{oddFor(market, outcomeId)}</span>
                        <span className={settled ? (won ? "won" : "lost") : bought ? "bought" : "pending"}>
                          {settled ? (won ? "Won" : "Lost") : bought ? "Bought" : "Pending"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="bets-card-foot">
                  <span><Icon name="ticket" size={14} /> {numLegs} legs</span>
                  <span>{account ? `Account ${account.slice(0, 8)}...${account.slice(-6)}` : "Account unavailable"}</span>
                  {slip.claimed && <span>Claimed</span>}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

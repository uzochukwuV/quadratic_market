"use client";

import { useState } from "react";
import Link from "next/link";
import { MARKETS, EPOCHS } from "@/lib/mockData";
import type { MarketStatus, MarketMode } from "@/lib/types";
import { deriveMarket, getProgramAddress } from "@/lib/client";

const CATEGORIES = ["All", "Crypto", "Sports", "Finance", "Politics", "Tech"];
const MODES: (MarketMode | "All")[] = ["All", "Trading", "FixedOdds"];
const STATUSES: (MarketStatus | "All")[] = ["All", "Open", "Suspended", "AwaitingResult", "Settled"];

function formatVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

function getMarketPrices(marketId: number) {
  const base = 0.3 + (marketId % 7) * 0.08;
  return [base, 1 - base];
}

export default function MarketsPage() {
  const [category, setCategory] = useState("All");
  const [mode, setMode] = useState<MarketMode | "All">("All");
  const [statusFilter, setStatusFilter] = useState<MarketStatus | "All">("All");
  const [epochFilter, setEpochFilter] = useState<number | "All">("All");
  const [search, setSearch] = useState("");

  const filtered = MARKETS
    .filter((m) => category === "All" || m.category === category)
    .filter((m) => mode === "All" || m.market_mode === mode)
    .filter((m) => statusFilter === "All" || m.status === statusFilter)
    .filter((m) => epochFilter === "All" || m.epoch_id === epochFilter)
    .filter((m) => !search || m.title.toLowerCase().includes(search.toLowerCase()));

  const byEpoch = EPOCHS.map((epoch) => ({
    epoch,
    markets: filtered.filter((m) => m.epoch_id === epoch.epoch_id),
  })).filter((g) => g.markets.length > 0);

  const programAddress = getProgramAddress();

  return (
    <div className="min-h-screen">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-1">Browse</p>
              <h1 className="text-heading text-white font-medium">All Markets</h1>
              <p className="text-body text-silver-text mt-1">
                {filtered.length} markets · {EPOCHS.length} epochs
              </p>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <p className="font-mono text-caption text-silver-text">Program ID</p>
                <p className="font-mono text-caption text-white">{programAddress.slice(0, 16)}...</p>
              </div>
              <div>
                <span className="w-2 h-2 rounded-full bg-cadmium-green pulse-dot" />
                <span className="font-mono text-caption text-silver-text ml-2">
                  {MARKETS.filter(m => m.status === "Open").length} live
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-8">
        <div className="space-y-4 mb-8">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-silver-text" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M6 10a4 4 0 100-8 4 4 0 000 8zM12 12l-2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search markets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`filter-pill ${category === c ? "active" : ""}`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`filter-pill ${mode === m ? "active" : ""}`}
              >
                {m === "All" ? "All Modes" : m === "FixedOdds" ? "Fixed Odds" : "LMSR"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`filter-pill ${statusFilter === s ? "active" : ""}`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setEpochFilter("All")}
              className={`filter-pill ${epochFilter === "All" ? "active" : ""}`}
            >
              All Epochs
            </button>
            {EPOCHS.map((e) => (
              <button
                key={e.epoch_id}
                onClick={() => setEpochFilter(e.epoch_id)}
                className={`filter-pill ${epochFilter === e.epoch_id ? "active" : ""}`}
              >
                Epoch #{e.epoch_id}
              </button>
            ))}
          </div>
        </div>

        {byEpoch.length === 0 ? (
          <div className="table-container flex flex-col items-center justify-center py-24">
            <p className="font-mono text-body text-silver-text mb-4">No markets found</p>
            <button
              onClick={() => { setSearch(""); setCategory("All"); setMode("All"); setStatusFilter("All"); setEpochFilter("All"); }}
              className="btn-ghost text-caption text-silver-text hover:text-white"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {byEpoch.map(({ epoch, markets }) => {
              const now = Math.floor(Date.now() / 1000);
              const isActive = now >= epoch.start_time && now < epoch.end_time;
              const isClosed = epoch.all_markets_settled;

              return (
                <div key={epoch.epoch_id} className="animate-fade-in">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${
                        isActive ? "bg-cadmium-green animate-pulse"
                          : isClosed ? "bg-graphite"
                          : "bg-silver-text"
                      }`} />
                      <h2 className="text-subheading text-white font-medium">
                        Epoch #{epoch.epoch_id}
                      </h2>
                      <span className={`badge ${isActive ? "badge-live" : isClosed ? "badge-closed" : "badge-settled"}`}>
                        {isActive ? "Active" : isClosed ? "Settled" : "Closed"}
                      </span>
                      {epoch.withdrawals_enabled && (
                        <span className="badge" style={{ borderColor: "#5bc8fa", color: "#5bc8fa", background: "rgba(91, 200, 250, 0.08)" }}>
                          Withdrawals Open
                        </span>
                      )}
                    </div>
                    <div className="flex-1 h-px bg-graphite" />
                    <div className="font-mono text-caption text-silver-text">
                      {epoch.num_settled_markets}/{epoch.num_markets} settled
                    </div>
                  </div>

                  <div className="table-container">
                    <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 80px 80px 1fr 100px" }}>
                      <div className="table-header">Market</div>
                      <div className="table-header">Category</div>
                      <div className="table-header">Yes</div>
                      <div className="table-header">No</div>
                      <div className="table-header">Volume</div>
                      <div className="table-header">Action</div>
                    </div>

                    {markets.map((market) => {
                      const prices = getMarketPrices(market.market_id);
                      const yesPrice = prices[0];
                      const noPrice = prices[1];
                      const marketPubkey = deriveMarket(market.market_id);

                      return (
                        <Link
                          key={market.market_id}
                          href={`/trade?market=${market.market_id}`}
                          className="grid table-row"
                          style={{ gridTemplateColumns: "2fr 1fr 80px 80px 1fr 100px" }}
                        >
                          <div className="table-cell">
                            <div className="text-white font-medium truncate">{market.title}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`badge ${market.status === "Open" ? "badge-live" : "badge-closed"}`}>
                                {market.status}
                              </span>
                              <span className="font-mono text-caption text-silver-text/60">
                                {market.market_mode === "Trading" ? "LMSR" : "Fixed"}
                              </span>
                            </div>
                            <div className="font-mono text-caption text-silver-text/40 mt-0.5">
                              {marketPubkey.toBase58().slice(0, 12)}...
                            </div>
                          </div>
                          <div className="table-cell">
                            <span className="inline-block px-2 py-0.5 rounded-full text-caption bg-white/[0.04] text-silver-text border border-graphite">
                              {market.category}
                            </span>
                          </div>
                          <div className="table-cell">
                            <div className="text-cadmium-green font-mono">
                              {(yesPrice * 100).toFixed(0)}¢
                            </div>
                          </div>
                          <div className="table-cell">
                            <div className="text-white font-mono">
                              {(noPrice * 100).toFixed(0)}¢
                            </div>
                          </div>
                          <div className="table-cell">
                            <span className="font-mono">{formatVol(market.exposure * 12)}</span>
                          </div>
                          <div className="table-cell">
                            <button className="btn-secondary text-caption px-3 py-1.5">
                              Trade
                            </button>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

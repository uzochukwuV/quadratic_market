"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useContractSnapshot, useSortedSnapshot } from "@/hooks/useContractData";
import { priceFromMarket } from "@/lib/contract";
import { frontendEnv } from "@/lib/env";
import type { MarketAccount } from "@/lib/types";

const CATEGORIES = ["All", "Crypto", "Sports", "Finance", "Politics", "Tech"];
const MODES = ["All", "Trading", "FixedOdds"] as const;
const STATUSES = ["All", "Open", "Closed", "Settled"] as const;

function getEpochState(epochStart: number, epochEnd: number, allSettled: boolean) {
  const now = Math.floor(Date.now() / 1000);
  if (now >= epochStart && now < epochEnd) return "active";
  if (allSettled) return "settled";
  return "closed";
}

function formatVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function MarketsPage() {
  const [category, setCategory] = useState("All");
  const [mode, setMode] = useState<(typeof MODES)[number]>("All");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("All");
  const [epochFilter, setEpochFilter] = useState<number | "All">("All");
  const [search, setSearch] = useState("");

  const { snapshot, loading, error } = useContractSnapshot();
  const { markets, epochs } = useSortedSnapshot(snapshot);

  const filtered = useMemo(
    () =>
      markets
        .filter((market) => category === "All" || market.category === category)
        .filter((market) => mode === "All" || market.market_mode === mode)
        .filter((market) => statusFilter === "All" || market.status === statusFilter)
        .filter((market) => epochFilter === "All" || market.epoch_id === epochFilter)
        .filter((market) => !search || market.title.toLowerCase().includes(search.toLowerCase())),
    [category, epochFilter, markets, mode, search, statusFilter]
  );

  const byEpoch = epochs
    .map((epoch) => ({
      epoch,
      markets: filtered.filter((market) => market.epoch_id === epoch.epoch_id),
    }))
    .filter((group) => group.markets.length > 0);

  return (
    <div className="min-h-screen bg-rich-black">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-1">Browse</p>
              <h1 className="text-heading text-white font-medium">All Markets</h1>
              <p className="text-body text-silver-text mt-1">
                {loading ? "Loading contract snapshot..." : `${filtered.length} markets · ${epochs.length} epochs`}
              </p>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <p className="font-mono text-caption text-silver-text">Program ID</p>
                <p className="font-mono text-caption text-white">{frontendEnv.programId.slice(0, 16)}...</p>
              </div>
              <div>
                <span className="w-2 h-2 rounded-full bg-cadmium-green pulse-dot" />
                <span className="font-mono text-caption text-silver-text ml-2">
                  {markets.filter((market) => market.status === "Open").length} live
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-caption text-red-200">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-12">
        <div className="space-y-4 mb-8 sticky top-20 bg-rich-black pb-4 z-10 border-b border-graphite">
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
            {CATEGORIES.map((value) => (
              <button
                key={value}
                onClick={() => setCategory(value)}
                className={`filter-pill ${category === value ? "active" : ""}`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {MODES.map((value) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`filter-pill ${mode === value ? "active" : ""}`}
              >
                {value === "All" ? "All Modes" : value === "FixedOdds" ? "Fixed Odds" : "Slip Based"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUSES.map((value) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={`filter-pill ${statusFilter === value ? "active" : ""}`}
              >
                {value}
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
            {epochs.map((epoch) => (
              <button
                key={epoch.epoch_id}
                onClick={() => setEpochFilter(epoch.epoch_id)}
                className={`filter-pill ${epochFilter === epoch.epoch_id ? "active" : ""}`}
              >
                Epoch #{epoch.epoch_id}
              </button>
            ))}
          </div>
        </div>

        {byEpoch.length === 0 ? (
          <div className="table-container flex flex-col items-center justify-center py-24">
            <p className="font-mono text-body text-silver-text mb-4">No markets found</p>
            <button
              onClick={() => {
                setSearch("");
                setCategory("All");
                setMode("All");
                setStatusFilter("All");
                setEpochFilter("All");
              }}
              className="btn-ghost text-caption text-silver-text hover:text-white"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {byEpoch.map(({ epoch, markets: epochMarkets }) => {
              const state = getEpochState(epoch.start_time, epoch.end_time, epoch.all_markets_settled);

              return (
                <div key={epoch.epoch_id} className="animate-fade-in">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${
                        state === "active"
                          ? "bg-cadmium-green animate-pulse"
                          : state === "settled"
                            ? "bg-graphite"
                            : "bg-silver-text"
                      }`} />
                      <h2 className="text-subheading text-white font-medium">
                        Epoch #{epoch.epoch_id}
                      </h2>
                      <span className={`badge ${state === "active" ? "badge-live" : state === "settled" ? "badge-settled" : "badge-closed"}`}>
                        {state === "active" ? "Active" : state === "settled" ? "Settled" : "Closed"}
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

                    {epochMarkets.map((market: MarketAccount) => {
                      const yesPrice = priceFromMarket(market, 0);
                      const noPrice = priceFromMarket(market, 1);
                      const statusLabel = market.status === "Open" ? "Live" : market.status;

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
                                {statusLabel}
                              </span>
                              <span className="font-mono text-caption text-silver-text/60">
                                {market.market_mode === "Trading" ? "Slip" : "Fixed"}
                              </span>
                            </div>
                            <div className="font-mono text-caption text-silver-text/40 mt-0.5">
                              {market.market_id}
                            </div>
                          </div>
                          <div className="table-cell">
                            <span className="inline-block px-2 py-0.5 rounded-full text-caption bg-white/[0.04] text-silver-text border border-graphite">
                              {market.category}
                            </span>
                          </div>
                          <div className="table-cell">
                            <div className="text-cadmium-green font-mono">{(yesPrice * 100).toFixed(0)}¢</div>
                          </div>
                          <div className="table-cell">
                            <div className="text-white font-mono">{(noPrice * 100).toFixed(0)}¢</div>
                          </div>
                          <div className="table-cell font-mono text-silver-text">
                            {formatVol(market.exposure)}
                          </div>
                          <div className="table-cell">
                            <span
                              className={`badge ${
                                market.status === "Open"
                                  ? "badge-live"
                                  : market.status === "Settled"
                                    ? "badge-settled"
                                    : "badge-closed"
                              }`}
                            >
                              {market.status}
                            </span>
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

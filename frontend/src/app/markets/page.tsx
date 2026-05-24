"use client";

import { useState } from "react";
import { MarketCard } from "../components/MarketCard";
import { MARKETS, EPOCHS } from "@/lib/mockData";
import type { MarketStatus, MarketMode } from "@/lib/types";

const CATEGORIES = ["All", "Crypto", "Sports", "Finance", "Politics", "Tech"];
const MODES: (MarketMode | "All")[] = ["All", "Trading", "FixedOdds"];
const STATUSES: (MarketStatus | "All")[] = ["All", "Open", "Suspended", "AwaitingResult", "Settled"];

export default function MarketsPage() {
  const [category, setCategory] = useState("All");
  const [mode, setMode] = useState<MarketMode | "All">("All");
  const [statusFilter, setStatusFilter] = useState<MarketStatus | "All">("All");
  const [epochFilter, setEpochFilter] = useState<number | "All">("All");
  const [search, setSearch] = useState("");
  const [slipOpen, setSlipOpen] = useState(false);

  const filtered = MARKETS
    .filter((m) => category === "All" || m.category === category)
    .filter((m) => mode === "All" || m.market_mode === mode)
    .filter((m) => statusFilter === "All" || m.status === statusFilter)
    .filter((m) => epochFilter === "All" || m.epoch_id === epochFilter)
    .filter((m) => !search || m.title.toLowerCase().includes(search.toLowerCase()));

  // Group by epoch
  const byEpoch = EPOCHS.map((epoch) => ({
    epoch,
    markets: filtered.filter((m) => m.epoch_id === epoch.epoch_id),
  })).filter((g) => g.markets.length > 0);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ background: "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46) 50%, rgb(165,45,37))" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
        <div className="relative max-w-[1078px] mx-auto px-6 py-12">
          <p className="text-[12px] text-whisper-gray uppercase tracking-widest mb-2">Prediction Markets</p>
          <h1 className="text-[45px] font-semibold text-white leading-tight">
            All Markets
          </h1>
          <p className="text-[15px] text-whisper-gray mt-2">
            {MARKETS.filter(m => m.status === "Open").length} live · {MARKETS.length} total across {EPOCHS.length} epochs
          </p>
        </div>
      </div>

      <div className="max-w-[1078px] mx-auto px-6 py-8">
        {/* ── Filters ─────────────────────────────────────── */}
        <div className="space-y-4 mb-8">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-whisper-gray" width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M6.5 11a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM13 13l-2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search markets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-pill bg-white/[0.04] border border-white/[0.08] text-white placeholder-whisper-gray text-[14px] focus:outline-none focus:border-white/20 transition-all"
            />
          </div>

          {/* Filter rows */}
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {/* Categories */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-whisper-gray uppercase tracking-wide mr-1">Category</span>
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-3 py-1 rounded-pill text-[12px] border transition-all ${
                    category === c ? "bg-white text-black border-white" : "border-white/[0.1] text-whisper-gray hover:text-white hover:border-white/20"
                  }`}>{c}</button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {/* Mode */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-whisper-gray uppercase tracking-wide mr-1">Mode</span>
              {MODES.map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1 rounded-pill text-[12px] border transition-all ${
                    mode === m
                      ? m === "Trading" ? "bg-[#a07bff] text-black border-[#a07bff]"
                        : m === "FixedOdds" ? "bg-[#ffac2e] text-black border-[#ffac2e]"
                        : "bg-white text-black border-white"
                      : "border-white/[0.1] text-whisper-gray hover:text-white hover:border-white/20"
                  }`}
                >
                  {m === "FixedOdds" ? "Fixed Odds" : m}
                </button>
              ))}
            </div>

            {/* Status */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-whisper-gray uppercase tracking-wide mr-1">Status</span>
              {STATUSES.map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 rounded-pill text-[12px] border transition-all ${
                    statusFilter === s ? "bg-white text-black border-white" : "border-white/[0.1] text-whisper-gray hover:text-white hover:border-white/20"
                  }`}>{s}</button>
              ))}
            </div>

            {/* Epoch */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-whisper-gray uppercase tracking-wide mr-1">Epoch</span>
              <button onClick={() => setEpochFilter("All")}
                className={`px-3 py-1 rounded-pill text-[12px] border transition-all ${epochFilter === "All" ? "bg-white text-black border-white" : "border-white/[0.1] text-whisper-gray hover:text-white hover:border-white/20"}`}>
                All
              </button>
              {EPOCHS.map((e) => (
                <button key={e.epoch_id} onClick={() => setEpochFilter(e.epoch_id)}
                  className={`px-3 py-1 rounded-pill text-[12px] border transition-all ${
                    epochFilter === e.epoch_id ? "bg-white text-black border-white" : "border-white/[0.1] text-whisper-gray hover:text-white hover:border-white/20"
                  }`}>
                  Epoch #{e.epoch_id} {e.epoch_id === 3 ? "· Current" : e.withdrawals_enabled ? "· Settled" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Epoch-grouped results ──────────────────────── */}
        {byEpoch.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[16px] text-whisper-gray mb-4">No markets found</p>
            <button onClick={() => { setSearch(""); setCategory("All"); setMode("All"); setStatusFilter("All"); setEpochFilter("All"); }}
              className="text-[13px] text-white/50 hover:text-white underline underline-offset-2">Clear all filters</button>
          </div>
        ) : (
          <div className="space-y-12">
            {byEpoch.map(({ epoch, markets }) => {
              const now = Math.floor(Date.now() / 1000);
              const isActive = now >= epoch.start_time && now < epoch.end_time;
              const isClosed = epoch.all_markets_settled;

              return (
                <div key={epoch.epoch_id}>
                  {/* Epoch group header */}
                  <div className="flex items-center gap-4 mb-5">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${
                        isActive ? "bg-[#a0e0ab] animate-pulse"
                          : isClosed ? "bg-whisper-gray"
                          : "bg-[#ffac2e]"
                      }`} />
                      <h2 className="text-[18px] font-semibold text-white">
                        Epoch #{epoch.epoch_id}
                      </h2>
                      <span className={`text-[11px] px-2.5 py-0.5 rounded-pill border ${
                        isActive ? "text-[#a0e0ab] border-[#a0e0ab]/30 bg-[#a0e0ab]/[0.07]"
                          : isClosed ? "text-whisper-gray border-white/10 bg-white/[0.03]"
                          : "text-[#ffac2e] border-[#ffac2e]/30 bg-[#ffac2e]/[0.07]"
                      }`}>
                        {isActive ? "Active" : isClosed ? "All Settled" : "Closed"}
                      </span>
                      {epoch.withdrawals_enabled && (
                        <span className="text-[11px] px-2.5 py-0.5 rounded-pill border text-[#5bc8fa] border-[#5bc8fa]/30 bg-[#5bc8fa]/[0.07]">
                          Withdrawals Open
                        </span>
                      )}
                    </div>
                    <div className="flex-1 h-px bg-white/[0.05]" />
                    <div className="flex items-center gap-4 text-[12px] text-whisper-gray">
                      <span>{epoch.num_settled_markets}/{epoch.num_markets} settled</span>
                      <span>${(epoch.total_liquidity_added / 1e9).toFixed(1)}K pool</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[14px]">
                    {markets.map((market) => (
                      <MarketCard key={market.market_id} market={market} onSlipOpen={() => setSlipOpen(true)} />
                    ))}
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

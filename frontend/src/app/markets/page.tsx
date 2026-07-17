"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useMarketSnapshot } from "@/hooks/useContractData";
import { priceFromMarket, sortEpochs, sortMarkets } from "@/lib/contract";
import { frontendEnv } from "@/lib/env";
import type { MarketAccount } from "@/lib/types";

const CATEGORIES = ["All", "Sports"] as const;
const MODES = ["All", "Trading", "FixedOdds"] as const;
const STATUSES = ["All", "Open", "Closed", "Settled"] as const;
const DEFAULT_FILTERS = {
  category: "All",
  mode: "All",
  status: "All",
  epoch: "All",
  search: "",
} as const;

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

function normalizeQueryParam(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value;
}

function MarketsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [mode, setMode] = useState<(typeof MODES)[number]>("All");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("All");
  const [epochFilter, setEpochFilter] = useState<number | "All">("All");
  const [search, setSearch] = useState("");

  const { markets, epochs, marketGroups, loading, error } = useMarketSnapshot();
  const sortedMarkets = useMemo(() => sortMarkets(markets), [markets]);
  const sortedEpochs = useMemo(() => sortEpochs(epochs), [epochs]);

  useEffect(() => {
    const searchValue = searchParams.get("q");
    const categoryValue = searchParams.get("category");
    const modeValue = searchParams.get("mode");
    const statusValue = searchParams.get("status");
    const epochValue = searchParams.get("epoch");

    setSearch(normalizeQueryParam(searchValue, DEFAULT_FILTERS.search));
    setCategory(
      CATEGORIES.includes(categoryValue as (typeof CATEGORIES)[number])
        ? (categoryValue as (typeof CATEGORIES)[number])
        : DEFAULT_FILTERS.category
    );
    setMode(
      MODES.includes(modeValue as (typeof MODES)[number])
        ? (modeValue as (typeof MODES)[number])
        : DEFAULT_FILTERS.mode
    );
    setStatusFilter(
      STATUSES.includes(statusValue as (typeof STATUSES)[number])
        ? (statusValue as (typeof STATUSES)[number])
        : DEFAULT_FILTERS.status
    );
    setEpochFilter(epochValue ? Number(epochValue) || "All" : DEFAULT_FILTERS.epoch);
  }, [searchParams]);

  const updateQuery = (next: Partial<{ category: string; mode: string; status: string; epoch: number | "All"; q: string }>) => {
    const params = new URLSearchParams(searchParams.toString());

    const setOrDelete = (key: string, value: string | number | "All", defaultValue: string) => {
      if (value === defaultValue || value === "All" || value === "") {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    };

    if ("q" in next) setOrDelete("q", next.q ?? "", "");
    if ("category" in next) setOrDelete("category", next.category ?? "All", "All");
    if ("mode" in next) setOrDelete("mode", next.mode ?? "All", "All");
    if ("status" in next) setOrDelete("status", next.status ?? "All", "All");
    if ("epoch" in next) setOrDelete("epoch", next.epoch ?? "All", "All");

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const filtered = useMemo(
    () =>
      sortedMarkets
        .filter((market) => category === "All" || market.category === category)
        .filter((market) => mode === "All" || market.market_mode === mode)
        .filter((market) => statusFilter === "All" || market.status === statusFilter)
        .filter((market) => epochFilter === "All" || market.epoch_id === epochFilter)
        .filter((market) => {
          if (!search.trim()) return true;
          const q = search.trim().toLowerCase();
          const groupId = market.group_id !== undefined ? String(market.group_id) : "";
          const groupTitle = market.group_id !== undefined
            ? marketGroups.find((group) => group.group_id === market.group_id)?.title ?? ""
            : "";
          const haystack = [
            market.title,
            market.description,
            market.category,
            market.status,
            market.market_mode,
            String(market.market_id),
            String(market.epoch_id),
            groupId,
            groupTitle,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return haystack.includes(q);
        }),
    [category, epochFilter, mode, search, sortedMarkets, statusFilter]
  );

  const byEpoch = sortedEpochs
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
              <h1 className="text-heading text-white font-medium">Sports Markets</h1>
              <p className="text-body text-silver-text mt-1">
                {loading ? "Loading on-chain sports snapshot..." : `${filtered.length} markets · ${sortedEpochs.length} epochs`}
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
                  {sortedMarkets.filter((market) => market.status === "Open").length} live
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
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-silver-text" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M6 10a4 4 0 100-8 4 4 0 000 8zM12 12l-2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search title, description, market id, group id, epoch..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  updateQuery({ q: e.target.value });
                }}
                className="input-field pl-10"
              />
            </div>

            <button
              onClick={() => {
                setSearch("");
                setCategory("All");
                setMode("All");
                setStatusFilter("All");
                setEpochFilter("All");
                router.replace(pathname, { scroll: false });
              }}
              className="btn-secondary shrink-0"
            >
              Clear filters
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mr-1">Category</span>
            {CATEGORIES.map((value) => (
              <button
                key={value}
                onClick={() => {
                  setCategory(value);
                  updateQuery({ category: value });
                }}
                className={`filter-pill flex-none ${category === value ? "active" : ""}`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mr-1">Mode</span>
            {MODES.map((value) => (
              <button
                key={value}
                onClick={() => {
                  setMode(value);
                  updateQuery({ mode: value });
                }}
                className={`filter-pill flex-none ${mode === value ? "active" : ""}`}
              >
                {value === "All" ? "All Modes" : value === "FixedOdds" ? "Fixed Odds" : "Slip Based"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mr-1">Status</span>
            {STATUSES.map((value) => (
              <button
                key={value}
                onClick={() => {
                  setStatusFilter(value);
                  updateQuery({ status: value });
                }}
                className={`filter-pill flex-none ${statusFilter === value ? "active" : ""}`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mr-1">Epoch</span>
            <button
              onClick={() => {
                setEpochFilter("All");
                updateQuery({ epoch: "All" });
              }}
              className={`filter-pill flex-none ${epochFilter === "All" ? "active" : ""}`}
            >
              All Epochs
            </button>
            {sortedEpochs.map((epoch) => (
              <button
                key={epoch.epoch_id}
                onClick={() => {
                  setEpochFilter(epoch.epoch_id);
                  updateQuery({ epoch: epoch.epoch_id });
                }}
                className={`filter-pill flex-none ${epochFilter === epoch.epoch_id ? "active" : ""}`}
              >
                Epoch #{epoch.epoch_id}
              </button>
            ))}
          </div>
        </div>

        {byEpoch.length === 0 ? (
          <div className="table-container flex flex-col items-center justify-center py-24">
            <p className="font-mono text-body text-silver-text mb-4">No sports markets found</p>
            <button onClick={() => router.replace(pathname, { scroll: false })} className="btn-ghost text-caption text-silver-text hover:text-white">
              Reset query
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

                  <div className="table-container hidden md:block">
                    <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 80px 80px 1fr 100px" }}>
                      <div className="table-header">Market</div>
                      <div className="table-header">Sport</div>
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

                  <div className="md:hidden space-y-3">
                    {epochMarkets.map((market: MarketAccount) => {
                      const yesPrice = priceFromMarket(market, 0);
                      const noPrice = priceFromMarket(market, 1);
                      const statusLabel = market.status === "Open" ? "Live" : market.status;

                      return (
                        <Link
                          key={market.market_id}
                          href={`/trade?market=${market.market_id}`}
                          className="block rounded-2xl border border-graphite bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
                        >
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="min-w-0">
                              <div className="text-white font-medium leading-snug line-clamp-2">{market.title}</div>
                              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text">
                                Market #{market.market_id}
                              </div>
                            </div>
                            <span
                              className={`badge shrink-0 ${
                                market.status === "Open"
                                  ? "badge-live"
                                  : market.status === "Settled"
                                    ? "badge-settled"
                                    : "badge-closed"
                              }`}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div className="rounded-xl border border-graphite bg-black/20 p-3">
                              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mb-1">Sport</div>
                              <div className="text-sm text-white">{market.category}</div>
                            </div>
                            <div className="rounded-xl border border-graphite bg-black/20 p-3">
                              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mb-1">Epoch</div>
                              <div className="text-sm text-white">#{market.epoch_id}</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div className="rounded-xl border border-graphite bg-black/20 p-3">
                              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mb-1">Yes</div>
                              <div className="text-cadmium-green font-mono text-base">{(yesPrice * 100).toFixed(0)}¢</div>
                            </div>
                            <div className="rounded-xl border border-graphite bg-black/20 p-3">
                              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mb-1">No</div>
                              <div className="text-white font-mono text-base">{(noPrice * 100).toFixed(0)}¢</div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text mb-1">Volume</div>
                              <div className="font-mono text-sm text-white">{formatVol(market.exposure)}</div>
                            </div>
                            <span className="text-caption text-silver-text">Open in trade</span>
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

export default function MarketsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-graphite border-t-cadmium-green rounded-full animate-spin" />
        </div>
      }
    >
      <MarketsContent />
    </Suspense>
  );
}

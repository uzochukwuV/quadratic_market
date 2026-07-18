"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useMarketSnapshot } from "@/hooks/useContractData";
import { priceFromMarket, sortEpochs, sortMarkets } from "@/lib/contract";
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

function normalizeQueryParam(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value;
}

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

function formatDateTime(ts: number): string {
  if (!ts) return "TBD";
  return new Date(ts * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getMarketModeLabel(mode: MarketAccount["market_mode"]) {
  return mode === "FixedOdds" ? "Fixed odds" : "Live trading";
}

function getOutcomeLabel(market: MarketAccount, outcomeIndex: number) {
  if (market.num_outcomes === 3) {
    return ["Home", "Draw", "Away"][outcomeIndex] ?? `Line ${outcomeIndex + 1}`;
  }
  if (market.num_outcomes === 2) {
    return outcomeIndex === 0 ? "Side A" : "Side B";
  }
  return `Option ${outcomeIndex + 1}`;
}

function getOddsLabel(market: MarketAccount, outcomeIndex: number) {
  const price = priceFromMarket(market, outcomeIndex);
  if (!Number.isFinite(price) || price <= 0) return "—";
  return `${(1 / price).toFixed(2)}x`;
}

function MarketsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const marketFocusParam = searchParams.get("market");
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
          const groupTitle =
            market.group_id !== undefined
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
    [category, epochFilter, marketGroups, mode, search, sortedMarkets, statusFilter]
  );

  const marketGroupById = useMemo(
    () => new Map(marketGroups.map((group) => [group.group_id, group] as const)),
    [marketGroups]
  );

  const groupedSections = useMemo(() => {
    const sectionMap = new Map<
      string,
      {
        key: string;
        label: string;
        epochId: number;
        startTime: number;
        markets: MarketAccount[];
        groupId?: number;
        groupTitle?: string;
        groupExposure?: number;
        groupEventStart?: number;
        correlationSize?: number;
      }
    >();

    filtered.forEach((market) => {
      const group = market.group_id !== undefined ? marketGroupById.get(market.group_id) : undefined;
      const key = group ? `group-${group.group_id}` : `market-${market.market_id}`;
      const label = group?.title || market.title;
      const startTime = group?.event_start_time || market.start_time || 0;

      const existing = sectionMap.get(key);
      if (existing) {
        existing.markets.push(market);
        existing.startTime = Math.min(existing.startTime || startTime, startTime || existing.startTime || startTime);
        return;
      }

      sectionMap.set(key, {
        key,
        label,
        epochId: market.epoch_id,
        startTime,
        markets: [market],
        groupId: group?.group_id,
        groupTitle: group?.title,
        groupExposure: group?.total_group_exposure,
        groupEventStart: group?.event_start_time,
        correlationSize: group?.correlation_matrix?.length,
      });
    });

    return Array.from(sectionMap.values())
      .map((section) => ({
        ...section,
        markets: sortMarkets(section.markets),
      }))
      .sort((a, b) => {
        if (a.epochId !== b.epochId) return a.epochId - b.epochId;
        return (a.startTime || 0) - (b.startTime || 0);
      });
  }, [filtered, marketGroupById]);

  const activeMarkets = sortedMarkets.filter((market) => market.status === "Open").length;
  const settledMarkets = sortedMarkets.filter((market) => market.status === "Settled").length;
  const groupedMarkets = filtered.filter((market) => market.group_id !== undefined).length;
  const featuredGroups = useMemo(() => {
    return [...marketGroups]
      .sort((a, b) => b.total_group_exposure - a.total_group_exposure)
      .slice(0, 3);
  }, [marketGroups]);

  useEffect(() => {
    if (!marketFocusParam) return;
    const marketId = Number(marketFocusParam);
    if (!Number.isFinite(marketId)) return;

    const timer = window.setTimeout(() => {
      document.getElementById(`market-${marketId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [marketFocusParam, sortedMarkets.length]);

  return (
    <div className="min-h-screen bg-rich-black">
      <div className="border-b border-graphite bg-[radial-gradient(circle_at_top,_rgba(91,200,250,0.14),_transparent_38%),linear-gradient(180deg,_rgba(255,255,255,0.03),_transparent)]">
        <div className="max-w-content mx-auto px-4 sm:px-6 py-10 sm:py-12">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6">
              <div className="max-w-3xl">
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-silver-text mb-3">Sportsbook board</p>
                <h1 className="text-heading md:text-display text-white font-medium leading-tight">
                  Sports markets, lines, and fixture groups.
                </h1>
                <p className="text-body text-silver-text mt-3 max-w-2xl">
                  Browse live fixtures, grouped markets, and fixed-odds boards built for sports only.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full xl:w-auto">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Open</p>
                  <p className="text-lg font-semibold text-white mt-1">{activeMarkets}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Settled</p>
                  <p className="text-lg font-semibold text-white mt-1">{settledMarkets}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Groups</p>
                  <p className="text-lg font-semibold text-white mt-1">{marketGroups.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Grouped</p>
                  <p className="text-lg font-semibold text-white mt-1">{groupedMarkets}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              {featuredGroups.map((group) => (
                <div key={group.group_id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text mb-1">Featured group</p>
                      <h2 className="text-white font-medium leading-snug line-clamp-2">{group.title || `Group #${group.group_id}`}</h2>
                      <p className="text-caption text-silver-text mt-1">
                        {group.num_markets} markets · starts {formatDateTime(group.event_start_time)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Exposure</p>
                      <p className="text-white font-mono mt-1">{formatVol(group.total_group_exposure)}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-caption text-silver-text">
                    Same-group selections should carry a smaller bonus so correlated legs do not overpay.
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-caption text-red-200">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-content mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="sticky top-16 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 pb-4 mb-6 border-b border-graphite bg-rich-black/90 backdrop-blur">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div className="relative min-w-0">
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-silver-text" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M6 10a4 4 0 100-8 4 4 0 000 8zM12 12l-2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  placeholder="Search fixtures, market id, group id, epoch..."
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
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text mr-1">Sport</span>
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
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text mr-1">Board</span>
              {MODES.map((value) => (
                <button
                  key={value}
                  onClick={() => {
                    setMode(value);
                    updateQuery({ mode: value });
                  }}
                  className={`filter-pill flex-none ${mode === value ? "active" : ""}`}
                >
                  {value === "All" ? "All Boards" : getMarketModeLabel(value)}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text mr-1">Status</span>
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
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text mr-1">Epoch</span>
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
        </div>

        {groupedSections.length === 0 ? (
          <div className="table-container flex flex-col items-center justify-center py-24">
            <p className="font-mono text-body text-silver-text mb-4">
              {loading ? "Loading sportsbook board..." : "No sports markets found"}
            </p>
            <button onClick={() => router.replace(pathname, { scroll: false })} className="btn-ghost text-caption text-silver-text hover:text-white">
              Reset query
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {sortedEpochs
              .map((epoch) => ({
                epoch,
                sections: groupedSections.filter((section) => section.epochId === epoch.epoch_id),
              }))
              .filter((entry) => entry.sections.length > 0)
              .map(({ epoch, sections }) => {
                const state = getEpochState(epoch.start_time, epoch.end_time, epoch.all_markets_settled);

                return (
                  <section key={epoch.epoch_id} className="animate-fade-in">
                    <div className="flex flex-col md:flex-row md:items-center gap-4 mb-5">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            state === "active"
                              ? "bg-cadmium-green animate-pulse"
                              : state === "settled"
                                ? "bg-graphite"
                                : "bg-silver-text"
                          }`}
                        />
                        <h2 className="text-subheading text-white font-medium">Epoch #{epoch.epoch_id}</h2>
                        <span
                          className={`badge ${
                            state === "active"
                              ? "badge-live"
                              : state === "settled"
                                ? "badge-settled"
                                : "badge-closed"
                          }`}
                        >
                          {state === "active" ? "Active" : state === "settled" ? "Settled" : "Closed"}
                        </span>
                        {epoch.withdrawals_enabled && (
                          <span className="badge" style={{ borderColor: "#5bc8fa", color: "#5bc8fa", background: "rgba(91, 200, 250, 0.08)" }}>
                            Withdrawals open
                          </span>
                        )}
                      </div>

                      <div className="flex-1 h-px bg-graphite hidden md:block" />
                      <div className="font-mono text-caption text-silver-text">
                        {epoch.num_settled_markets}/{epoch.num_markets} settled
                      </div>
                    </div>

                    <div className="space-y-4">
                      {sections.map((section) => (
                        <div key={section.key} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-3">
                                <span className={`badge ${state === "active" ? "badge-live" : state === "settled" ? "badge-settled" : "badge-closed"}`}>
                                  {state === "active" ? "Live fixture" : state === "settled" ? "Final" : "Closed"}
                                </span>
                                <span className="badge" style={{ borderColor: "#5bc8fa", color: "#5bc8fa", background: "rgba(91, 200, 250, 0.08)" }}>
                                  {section.markets.length} market{section.markets.length !== 1 ? "s" : ""}
                                </span>
                                <span className="badge">
                                  {section.groupId !== undefined ? `Group #${section.groupId}` : `Market #${section.markets[0]?.market_id}`}
                                </span>
                                <span className="badge">
                                  {section.groupEventStart ? formatDateTime(section.groupEventStart) : "No start time"}
                                </span>
                              </div>

                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <h3 className="text-white text-lg sm:text-xl font-medium leading-snug">
                                    {section.groupTitle || section.label}
                                  </h3>
                                  <p className="text-silver-text text-body mt-2 max-w-3xl">
                                    {section.markets[0]?.description || "Fixture board with sportsbook-style grouped pricing and settlement tracking."}
                                  </p>
                                </div>
                                <div className="hidden xl:block text-right shrink-0">
                                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Group exposure</p>
                                  <p className="text-white font-mono mt-1">
                                    {section.groupExposure !== undefined ? formatVol(section.groupExposure) : formatVol(section.markets.reduce((sum, market) => sum + market.exposure, 0))}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 lg:w-[320px] xl:w-[360px]">
                              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Type</p>
                                <p className="text-white font-medium mt-1">{getMarketModeLabel(section.markets[0]?.market_mode ?? "Trading")}</p>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Markets</p>
                                <p className="text-white font-medium mt-1">{section.markets.length}</p>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Correlation</p>
                                <p className="text-white font-medium mt-1">
                                  {section.correlationSize ? `${section.correlationSize} points` : "Grouped"}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 grid gap-3">
                            {section.markets.map((market) => {
                              const outcomeCount = Math.max(market.num_outcomes, 2);
                              return (
                                <Link
                                  key={market.market_id}
                                  id={`market-${market.market_id}`}
                                  href={`/markets?market=${market.market_id}`}
                                  className={`group rounded-2xl border bg-black/20 hover:bg-white/[0.05] transition-colors p-4 block ${
                                    marketFocusParam && Number(marketFocusParam) === market.market_id
                                      ? "border-cadmium-green shadow-[0_0_0_1px_rgba(160,224,171,0.45)]"
                                      : "border-white/10"
                                  }`}
                                >
                                  <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex flex-wrap items-center gap-2 mb-2">
                                        <span className={`badge ${market.status === "Open" ? "badge-live" : market.status === "Settled" ? "badge-settled" : "badge-closed"}`}>
                                          {market.status === "Open" ? "Live" : market.status}
                                        </span>
                                        <span className="badge">
                                          {getMarketModeLabel(market.market_mode)}
                                        </span>
                                        <span className="badge">
                                          Market #{market.market_id}
                                        </span>
                                        <span className="badge">
                                          {market.category}
                                        </span>
                                      </div>

                                      <h4 className="text-white text-base sm:text-[17px] font-medium leading-snug">
                                        {market.title}
                                      </h4>
                                      <p className="text-silver-text text-caption mt-1 line-clamp-2">
                                        {market.description || "Sports market with fixed-odds style presentation."}
                                      </p>

                                      <div className="flex flex-wrap items-center gap-3 mt-3 text-caption text-silver-text">
                                        <span>Settles {formatDateTime(market.settlement_time)}</span>
                                        <span>Epoch #{market.epoch_id}</span>
                                        {market.group_id !== undefined && <span>Group #{market.group_id}</span>}
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:w-[420px] gap-2">
                                      {Array.from({ length: Math.min(outcomeCount, 3) }, (_, index) => (
                                        <div key={`${market.market_id}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver-text">
                                            {getOutcomeLabel(market, index)}
                                          </p>
                                          <p className="text-white text-lg font-semibold mt-1">
                                            {getOddsLabel(market, index)}
                                          </p>
                                          <p className="text-[11px] text-silver-text mt-0.5">
                                            {index === 0 ? "Back line" : "Price line"}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
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

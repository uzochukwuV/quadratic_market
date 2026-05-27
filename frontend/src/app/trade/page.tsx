"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MARKETS, MY_POSITIONS, getMarketPrices } from "@/lib/mockData";
import { TradingChart } from "@/app/components/TradingChart";
import { OrderBook } from "@/app/components/OrderBook";
import { BuySellWidget } from "@/app/components/BuySellWidget";
import { PoolFundsDisplay } from "@/app/components/PoolFundsDisplay";
import { BetSlipPanel } from "@/app/components/BetSlipPanel";

function TradeContent() {
  const searchParams = useSearchParams();
  const marketId = parseInt(searchParams.get("market") || "301");
  const market = MARKETS.find((m) => m.market_id === marketId);
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [tradeTab, setTradeTab] = useState<"chart" | "book">("chart");

  if (!market) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-white mb-4">Market not found</p>
          <Link href="/markets" className="btn-primary">
            Back to Markets
          </Link>
        </div>
      </div>
    );
  }

  const prices = getMarketPrices(market);
  const userPosition = MY_POSITIONS.find((p) => p.market_id === marketId);

  return (
    <div className="min-h-screen bg-rich-black">
      <div className="max-w-content mx-auto px-6 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6 text-caption">
          <Link href="/markets" className="text-silver-text hover:text-white transition-colors">
            Markets
          </Link>
          <span className="text-silver-text">/</span>
          <span className="text-white">Epoch #{market.epoch_id}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 auto-rows-max">
          {/* ── LEFT COLUMN: Market Details (60%) ──────────── */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header Card */}
            <div className="card">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="badge badge-live">● Live</span>
                    <span className="font-mono text-caption text-silver-text bg-white/[0.04] px-2 py-0.5 rounded border border-graphite">
                      {market.market_mode === "Trading" ? "LMSR" : "Fixed Odds"}
                    </span>
                  </div>
                  <h1 className="text-heading md:text-display text-white font-medium leading-tight">
                    {market.title}
                  </h1>
                </div>
              </div>

              <p className="text-body text-silver-text mb-4">
                {market.description}
              </p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-white/[0.03] border border-graphite rounded-md p-3">
                  <p className="text-caption text-silver-text mb-1">Category</p>
                  <p className="text-body font-mono text-white">{market.category}</p>
                </div>
                <div className="bg-white/[0.03] border border-graphite rounded-md p-3">
                  <p className="text-caption text-silver-text mb-1">Pool Size</p>
                  <p className="text-body font-mono text-cadmium-green">${(market.exposure * 12 / 1_000_000).toFixed(2)}M</p>
                </div>
                <div className="bg-white/[0.03] border border-graphite rounded-md p-3">
                  <p className="text-caption text-silver-text mb-1">Status</p>
                  <p className="text-body font-mono text-white">{market.status}</p>
                </div>
              </div>
            </div>

            {/* Pool Funds */}
            <PoolFundsDisplay market={market} />

            {/* Trading Chart + Order Book Tabs */}
            <div className="card">
              <div className="flex items-center gap-2 border-b border-graphite mb-4">
                <button
                  onClick={() => setTradeTab("chart")}
                  className={`px-4 py-3 text-body font-medium border-b-2 transition-colors ${
                    tradeTab === "chart"
                      ? "text-white border-cadmium-green"
                      : "text-silver-text border-transparent hover:text-white"
                  }`}
                >
                  Price Chart
                </button>
                <button
                  onClick={() => setTradeTab("book")}
                  className={`px-4 py-3 text-body font-medium border-b-2 transition-colors ${
                    tradeTab === "book"
                      ? "text-white border-cadmium-green"
                      : "text-silver-text border-transparent hover:text-white"
                  }`}
                >
                  Order Book
                </button>
              </div>

              {tradeTab === "chart" ? (
                <TradingChart market={market} />
              ) : (
                <OrderBook marketId={marketId} />
              )}
            </div>

            {/* AI Suggestions */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" className="text-cadmium-green" />
                  <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.2" className="text-cadmium-green" />
                </svg>
                <h3 className="text-body font-medium text-white">AI Insights</h3>
              </div>
              <div className="space-y-3">
                <div className="p-3 bg-cadmium-green/10 border border-cadmium-green/30 rounded-md">
                  <p className="text-caption text-silver-text mb-1">Market Signal</p>
                  <p className="text-body text-white font-medium">Strong YES bias detected</p>
                  <p className="text-caption text-silver-text mt-1">68% of recent trades favor YES. Price: 68¢</p>
                </div>
                <div className="p-3 bg-white/[0.03] border border-graphite rounded-md">
                  <p className="text-caption text-silver-text mb-1">Implied Probability</p>
                  <p className="text-body text-cadmium-green font-mono">YES: 68% · NO: 32%</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Trading & Betslip (40%) ────── */}
          <div className="lg:col-span-1 space-y-6 sticky top-20">
            {/* User Position (if exists) */}
            {userPosition && (
              <div className="card border-cadmium-green/50">
                <h3 className="text-body font-medium text-white mb-4">Your Position</h3>
                <div className="space-y-3 text-caption">
                  <div className="flex justify-between">
                    <span className="text-silver-text">Shares Held</span>
                    <span className="text-white font-mono">{userPosition.shares}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-silver-text">Avg Price</span>
                    <span className="text-white font-mono">{(userPosition.avg_price * 100).toFixed(1)}¢</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-silver-text">Current Price</span>
                    <span className="text-white font-mono">{(userPosition.current_price * 100).toFixed(1)}¢</span>
                  </div>
                  <div className="pt-2 border-t border-graphite flex justify-between">
                    <span className="text-silver-text">P&L</span>
                    <span className={userPosition.pnl > 0 ? "text-cadmium-green" : "text-red-400"}>
                      {userPosition.pnl > 0 ? "+" : ""}{userPosition.pnl.toFixed(2)} SOL ({userPosition.pnl_pct > 0 ? "+" : ""}{userPosition.pnl_pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Outcome Selector */}
            <div className="card">
              <h3 className="text-body font-medium text-white mb-3">Select Outcome</h3>
              <div className="grid grid-cols-2 gap-3">
                {["YES", "NO"].map((label, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedOutcome(idx)}
                    className={`p-3 rounded-md border transition-all ${
                      selectedOutcome === idx
                        ? "bg-cadmium-green/20 border-cadmium-green text-white"
                        : "bg-white/[0.03] border-graphite text-silver-text hover:text-white"
                    }`}
                  >
                    <p className="text-caption font-mono mb-1 uppercase tracking-wider">{label}</p>
                    <p className="text-heading text-cadmium-green font-mono">
                      {(prices[idx] * 100).toFixed(1)}¢
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Buy/Sell Widget */}
            <BuySellWidget
              marketId={marketId}
              outcomeId={selectedOutcome}
              outcomeName={selectedOutcome === 0 ? "YES" : "NO"}
              currentPrice={prices[selectedOutcome]}
            />

            {/* Bet Slip */}
            <BetSlipPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-graphite border-t-cadmium-green rounded-full animate-spin" />
      </div>
    }>
      <TradeContent />
    </Suspense>
  );
}

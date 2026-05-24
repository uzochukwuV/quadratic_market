"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MARKETS, MY_POSITIONS, getMarketPrices } from "@/lib/mockData";

function MarketOverview({ market, yesPrice, noPrice }: any) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <span className={`badge ${market.status === "Open" ? "badge-live" : "badge-closed"}`}>
          {market.status}
        </span>
        <span className="badge" style={{ borderColor: "#a07bff", color: "#a07bff", background: "rgba(160, 122, 255, 0.08)" }}>
          {market.market_mode === "Trading" ? "LMSR" : "Fixed"}
        </span>
        <span className="badge badge-closed">Epoch #{market.epoch_id}</span>
      </div>

      <h1 className="text-heading text-white font-medium mb-2">{market.title}</h1>
      <p className="text-body text-silver-text mb-6">{market.category}</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-dark-granite rounded-md p-4">
          <div className="text-caption text-silver-text font-mono uppercase mb-1">YES</div>
          <div className="text-display text-cadmium-green font-mono">{(yesPrice * 100).toFixed(0)}¢</div>
          <div className="text-caption text-silver-text mt-1">${(1 / yesPrice).toFixed(2)}x</div>
        </div>
        <div className="bg-dark-granite rounded-md p-4">
          <div className="text-caption text-silver-text font-mono uppercase mb-1">NO</div>
          <div className="text-display text-white font-mono">{(noPrice * 100).toFixed(0)}¢</div>
          <div className="text-caption text-silver-text mt-1">${(1 / noPrice).toFixed(2)}x</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-caption mb-1">
          <span className="text-silver-text">Volume</span>
          <span className="text-white font-mono">${((market.exposure * 12) / 1000).toFixed(0)}K</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${yesPrice * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function TradePanel({ market, yesPrice, noPrice }: any) {
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [shares, setShares] = useState("100");
  const price = side === "yes" ? yesPrice : noPrice;
  const sharesNum = parseFloat(shares) || 0;
  const cost = sharesNum * price;
  const potentialWin = sharesNum * (1 - price);
  const roi = ((1 / price) - 1) * 100;

  if (market.status !== "Open") {
    return (
      <div className="card text-center py-12">
        <p className="text-body text-silver-text mb-2">Trading closed</p>
        <p className="text-caption text-silver-text/60">This market is {market.status}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-6">
        <span className="w-2 h-2 rounded-full bg-cadmium-green pulse-dot" />
        <span className="font-mono text-caption text-silver-text uppercase">Trade</span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-6">
        <button
          onClick={() => setSide("yes")}
          className={`py-3 rounded-full font-mono text-body transition-all ${side === "yes" ? "bg-cadmium-green text-true-black" : "bg-dark-granite text-silver-text hover:text-white"}`}
        >
          YES · {(yesPrice * 100).toFixed(0)}¢
        </button>
        <button
          onClick={() => setSide("no")}
          className={`py-3 rounded-full font-mono text-body transition-all ${side === "no" ? "bg-white text-true-black" : "bg-dark-granite text-silver-text hover:text-white"}`}
        >
          NO · {(noPrice * 100).toFixed(0)}¢
        </button>
      </div>

      <div className="mb-4">
        <label className="text-caption text-silver-text font-mono uppercase mb-2 block">Shares</label>
        <input type="number" value={shares} onChange={(e) => setShares(e.target.value)} className="input-field font-mono" />
        <div className="flex gap-2 mt-2">
          {["50", "100", "250", "500"].map((v) => (
            <button key={v} onClick={() => setShares(v)} className="flex-1 py-1.5 rounded-md text-caption font-mono bg-dark-granite text-silver-text hover:text-white transition-all">
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-dark-granite rounded-md p-4 mb-4 space-y-2">
        <div className="flex justify-between text-body">
          <span className="text-silver-text">Price</span>
          <span className="font-mono text-white">{(price * 100).toFixed(0)}¢</span>
        </div>
        <div className="flex justify-between text-body">
          <span className="text-silver-text">Cost</span>
          <span className="font-mono text-white">${cost.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-body">
          <span className="text-silver-text">Potential win</span>
          <span className="font-mono text-cadmium-green">+${potentialWin.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-body">
          <span className="text-silver-text">ROI</span>
          <span className="font-mono text-cadmium-green">+{roi.toFixed(0)}%</span>
        </div>
      </div>

      <button className="btn-primary w-full py-4 font-mono">
        Buy {side.toUpperCase()} · ${cost.toFixed(2)}
      </button>
      <p className="text-caption text-silver-text text-center mt-3">Instant settlement on Solana</p>
    </div>
  );
}

function PositionsTable({ marketId }: { marketId: number }) {
  const position = MY_POSITIONS.find((p) => p.market_id === marketId);
  if (!position) {
    return (
      <div className="card text-center py-8">
        <p className="text-body text-silver-text">No position in this market</p>
        <p className="text-caption text-silver-text/60 mt-1">Place a trade to open a position</p>
      </div>
    );
  }
  const pnlColor = position.pnl >= 0 ? "text-cadmium-green" : "text-[#f47067]";
  return (
    <div className="table-container">
      <div className="table-header grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
        <div>Outcome</div><div>Shares</div><div>Avg Cost</div><div>Value</div><div>P&L</div>
      </div>
      <div className="grid table-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
        <div className="table-cell"><span className={`font-mono ${position.outcome_id === 0 ? "text-cadmium-green" : "text-white"}`}>{position.outcome_label}</span></div>
        <div className="table-cell font-mono">{position.shares.toLocaleString()}</div>
        <div className="table-cell font-mono">{(position.avg_price * 100).toFixed(0)}¢</div>
        <div className="table-cell font-mono">${position.value.toFixed(2)}</div>
        <div className={`table-cell font-mono ${pnlColor}`}>{position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)}</div>
      </div>
    </div>
  );
}

function MarketDetails({ market }: any) {
  return (
    <div className="card">
      <h3 className="text-subheading text-white font-medium mb-4">Market Details</h3>
      <div className="space-y-2">
        {[
          { label: "Market ID", value: `#${market.market_id}` },
          { label: "Epoch", value: `#${market.epoch_id}` },
          { label: "Category", value: market.category },
          { label: "Mode", value: market.market_mode },
          { label: "Outcomes", value: `${market.num_outcomes} (Binary)` },
          { label: "Settlement", value: new Date(market.settlement_time * 1000).toLocaleDateString() },
        ].map((r) => (
          <div key={r.label} className="flex justify-between text-body border-b border-graphite pb-2">
            <span className="text-silver-text">{r.label}</span>
            <span className="font-mono text-white">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeContent() {
  const params = useSearchParams();
  const marketIdStr = params.get("market") ?? "301";
  const marketId = parseInt(marketIdStr);
  const market = MARKETS.find((m) => m.market_id === marketId) ?? MARKETS[0];
  const prices = getMarketPrices(market);
  const yesPrice = prices[0];
  const noPrice = prices[1] ?? 1 - yesPrice;

  return (
    <div className="min-h-screen">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-1">Trading</p>
              <h1 className="text-heading text-white font-medium">{market.title}</h1>
            </div>
            <a href="/markets" className="btn-secondary text-caption">← Markets</a>
          </div>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
          <div className="space-y-6">
            <MarketOverview market={market} yesPrice={yesPrice} noPrice={noPrice} />
            <PositionsTable marketId={marketId} />
          </div>
          <div className="space-y-6">
            <TradePanel market={market} yesPrice={yesPrice} noPrice={noPrice} />
            <MarketDetails market={market} />
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

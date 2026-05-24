"use client";

import Link from "next/link";
import { MARKETS, EPOCHS } from "@/lib/mockData";


function formatVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "Open":
      return <span className="badge badge-live">● Live</span>;
    case "Settled":
      return <span className="badge badge-settled">✓ Settled</span>;
    default:
      return <span className="badge badge-closed">{status}</span>;
  }
}

function getMarketPrices(marketId: number) {
  // Mock prices based on market ID
  const base = 0.3 + (marketId % 7) * 0.08;
  return [base, 1 - base];
}

export default function LandingPage() {
  const liveMarkets = MARKETS.filter((m) => m.status === "Open");
  const recentSettled = MARKETS.filter((m) => m.status === "Settled").slice(0, 5);

  return (
    <div className="min-h-screen">
      {/* ── HEADER / HERO ─────────────────────────────────── */}
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="w-2 h-2 rounded-full bg-cadmium-green pulse-dot" />
                <span className="font-mono text-caption text-silver-text uppercase tracking-widest">
                  Live Protocol
                </span>
              </div>
              <h1 className="text-heading text-white font-medium tracking-tight">
                Prediction Markets
              </h1>
              <p className="text-body text-silver-text mt-1">
                {liveMarkets.length} active markets · {MARKETS.length} total
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/markets" className="btn-secondary">
                All Markets
              </Link>
              <Link href="/liquidity" className="btn-primary">
                Provide Liquidity
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── LIVE MARKETS TABLE ──────────────────────────────── */}
      <div className="max-w-content mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-subheading text-white font-medium">Live Markets</h2>
          <span className="font-mono text-caption text-silver-text">{liveMarkets.length} markets</span>
        </div>

        <div className="table-container">
          {/* Table Header */}
          <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 120px" }}>
            <div className="table-header">Market</div>
            <div className="table-header">Category</div>
            <div className="table-header">Yes</div>
            <div className="table-header">No</div>
            <div className="table-header">Volume</div>
            <div className="table-header">Action</div>
          </div>

          {/* Table Rows */}
          {liveMarkets.slice(0, 10).map((market, idx) => {
            const prices = getMarketPrices(market.market_id);
            const yesPrice = prices[0];
            const noPrice = prices[1];

            return (
              <Link
                key={market.market_id}
                href={`/trade?market=${market.market_id}`}
                className="grid table-row animate-fade-in hover:bg-white/[0.02]"
                style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 120px" }}
              >
                <div className="table-cell">
                  <div className="text-white font-medium truncate">{market.title}</div>
                  <div className="text-caption text-silver-text mt-0.5">
                    Epoch #{market.epoch_id} · {market.market_mode === "Trading" ? "LMSR" : "Fixed Odds"}
                  </div>
                </div>
                <div className="table-cell">
                  <span className="inline-block px-2 py-0.5 rounded-full text-caption bg-white/[0.04] text-silver-text border border-graphite">
                    {market.category}
                  </span>
                </div>
                <div className="table-cell">
                  <div className="text-cadmium-green font-mono">
                    {(yesPrice * 100).toFixed(1)}¢
                  </div>
                  <div className="text-caption text-silver-text mt-0.5">
                    ${(1 / yesPrice).toFixed(2)}x
                  </div>
                </div>
                <div className="table-cell">
                  <div className="text-white font-mono">
                    {(noPrice * 100).toFixed(1)}¢
                  </div>
                  <div className="text-caption text-silver-text mt-0.5">
                    ${(1 / noPrice).toFixed(2)}x
                  </div>
                </div>
                <div className="table-cell">
                  <span className="font-mono">{formatVol(market.exposure * 12)}</span>
                </div>
                <div className="table-cell">
                  <button className="btn-secondary text-caption px-3 py-1.5">
                    Trade →
                  </button>
                </div>
              </Link>
            );
          })}
        </div>

        {liveMarkets.length > 10 && (
          <div className="mt-4 text-center">
            <Link href="/markets" className="btn-ghost text-body text-silver-text hover:text-white">
              View all {liveMarkets.length} markets →
            </Link>
          </div>
        )}
      </div>

      {/* ── STATS ROW ──────────────────────────────────────── */}
      <div className="border-t border-graphite">
        <div className="max-w-content mx-auto px-6 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Volume", value: "$14.2M", sub: "All-time" },
              { label: "Open Interest", value: "$2.8M", sub: "Locked" },
              { label: "Resolved", value: "124", sub: "Markets" },
              { label: "Avg. Fee", value: "0.5%", sub: "Per trade" },
            ].map((stat) => (
              <div key={stat.label} className="card text-center">
                <div className="font-mono text-heading text-cadmium-green">{stat.value}</div>
                <div className="text-caption text-silver-text mt-1">{stat.label}</div>
                <div className="text-caption text-silver-text/60">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RECENTLY SETTLED ──────────────────────────────── */}
      <div className="max-w-content mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-subheading text-white font-medium">Recently Settled</h2>
          <Link href="/markets?status=Settled" className="btn-ghost text-caption text-silver-text hover:text-white">
            View all →
          </Link>
        </div>

        <div className="table-container">
          <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
            <div className="table-header">Market</div>
            <div className="table-header">Result</div>
            <div className="table-header">Winning</div>
            <div className="table-header">Settled</div>
          </div>

          {recentSettled.map((market) => (
            <div
              key={market.market_id}
              className="grid table-row"
              style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}
            >
              <div className="table-cell">
                <div className="text-white truncate">{market.title}</div>
                <div className="text-caption text-silver-text mt-0.5">
                  Epoch #{market.epoch_id}
                </div>
              </div>
              <div className="table-cell">
                {getStatusBadge(market.status)}
              </div>
              <div className="table-cell">
                <span className={`inline-flex items-center gap-1.5 font-mono text-caption ${
                  market.winning_outcome === 0 ? "text-cadmium-green" : "text-frost-white"
                }`}>
                  {market.winning_outcome === 0 ? "YES" : "NO"}
                  <span className="text-silver-text">at 100¢</span>
                </span>
              </div>
              <div className="table-cell text-silver-text text-caption">
                2 days ago
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PROTOCOL FEATURES ─────────────────────────────── */}
      <div className="border-t border-graphite">
        <div className="max-w-content mx-auto px-6 py-8">
          <h2 className="text-subheading text-white font-medium mb-6">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { step: "01", title: "Connect", desc: "Link your Solana wallet (Phantom, Backpack, Solflare) in one click." },
              { step: "02", title: "Choose", desc: "Browse events across sports, finance, crypto. Fair prices via LMSR." },
              { step: "03", title: "Trade", desc: "Buy YES or NO at any size. Instant settlement on Solana." },
              { step: "04", title: "Win", desc: "When oracle resolves, claim your share. Fully non-custodial." },
            ].map((item) => (
              <div key={item.step} className="card">
                <div className="font-mono text-display text-graphite/40 mb-3">{item.step}</div>
                <h3 className="text-body text-white font-medium mb-1">{item.title}</h3>
                <p className="text-caption text-silver-text">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer className="border-t border-graphite py-8">
        <div className="max-w-content mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-cadmium-green" />
            <span className="font-mono text-caption text-silver-text">
              Quadratic Market · Solana Devnet
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="font-mono text-caption text-silver-text hover:text-white transition-colors">Docs</a>
            <a href="#" className="font-mono text-caption text-silver-text hover:text-white transition-colors">GitHub</a>
            <a href="#" className="font-mono text-caption text-silver-text hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

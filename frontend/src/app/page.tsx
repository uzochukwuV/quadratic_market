"use client";

import Link from "next/link";
import { MARKETS, EPOCHS, getMarketPrices } from "@/lib/mockData";


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

export default function LandingPage() {
  const liveMarkets = MARKETS.filter((m) => m.status === "Open");
  const recentSettled = MARKETS.filter((m) => m.status === "Settled").slice(0, 5);

  return (
    <div className="min-h-screen bg-rich-black">
      {/* ── HEADER / HERO ─────────────────────────────────── */}
      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-12 md:py-16">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="w-2 h-2 rounded-full bg-cadmium-green pulse-dot" />
                <span className="font-mono text-caption text-silver-text uppercase tracking-widest">
                  Live Protocol
                </span>
              </div>
              <h1 className="text-heading md:text-display text-white font-medium tracking-tight">
                Prediction Markets
              </h1>
              <p className="text-body text-silver-text mt-2 md:mt-3">
                {liveMarkets.length} active markets · {MARKETS.length} total
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-shrink-0">
              <Link href="/markets" className="btn-secondary w-full sm:w-auto text-center">
                All Markets
              </Link>
              <Link href="/liquidity" className="btn-primary w-full sm:w-auto text-center">
                Provide Liquidity
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── LIVE MARKETS TABLE ──────────────────────────────── */}
      <section className="max-w-content mx-auto px-6 py-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-subheading text-white font-medium">Live Markets</h2>
          <span className="font-mono text-caption text-silver-text">{liveMarkets.length} active</span>
        </div>

        <div className="table-container overflow-x-auto">
          {/* Table Header */}
          <div className="grid min-w-full" style={{ gridTemplateColumns: "2.5fr 1.2fr 1.2fr 1fr 100px" }}>
            <div className="table-header">Market</div>
            <div className="table-header text-center">Yes Odds</div>
            <div className="table-header text-center">No Odds</div>
            <div className="table-header">Volume</div>
            <div className="table-header text-center">Trade</div>
          </div>

          {/* Table Rows */}
          {liveMarkets.slice(0, 10).map((market) => {
            const prices = getMarketPrices(market);
            const yesPrice = prices[0];
            const noPrice = prices[1];
            
            // Convert decimal odds to American odds
            const yesOdds = yesPrice > 0 ? Math.round((-100 * yesPrice) / (1 - yesPrice)) : -200;
            const noOdds = noPrice > 0 ? Math.round((-100 * noPrice) / (1 - noPrice)) : -200;

            return (
              <Link
                key={market.market_id}
                href={`/trade?market=${market.market_id}`}
                className="grid min-w-full table-row animate-fade-in hover:bg-white/[0.02] group"
                style={{ gridTemplateColumns: "2.5fr 1.2fr 1.2fr 1fr 100px" }}
              >
                {/* Market Info */}
                <div className="table-cell">
                  <div className="text-white font-medium truncate group-hover:text-cadmium-green transition-colors">
                    {market.title}
                  </div>
                  <div className="text-caption text-silver-text mt-1 flex items-center gap-2">
                    <span className="inline-block px-2 py-0.5 rounded text-caption bg-white/[0.04] border border-graphite">
                      {market.category}
                    </span>
                    <span>Epoch #{market.epoch_id}</span>
                  </div>
                </div>

                {/* Yes Odds - Sportsbook style */}
                <div className="table-cell flex flex-col items-center gap-1">
                  <div className="px-3 py-1.5 rounded-md bg-cadmium-green/10 border border-cadmium-green/30 w-full text-center">
                    <div className="text-white font-mono font-bold text-sm">
                      {yesOdds > 0 ? "+" : ""}{yesOdds}
                    </div>
                  </div>
                  <span className="text-caption text-silver-text">{(yesPrice * 100).toFixed(0)}¢</span>
                </div>

                {/* No Odds - Sportsbook style */}
                <div className="table-cell flex flex-col items-center gap-1">
                  <div className="px-3 py-1.5 rounded-md bg-white/[0.03] border border-graphite w-full text-center">
                    <div className="text-white font-mono font-bold text-sm">
                      {noOdds > 0 ? "+" : ""}{noOdds}
                    </div>
                  </div>
                  <span className="text-caption text-silver-text">{(noPrice * 100).toFixed(0)}¢</span>
                </div>

                {/* Volume */}
                <div className="table-cell flex items-center">
                  <div className="font-mono text-white">{formatVol(market.exposure * 12)}</div>
                </div>

                {/* Trade Button */}
                <div className="table-cell flex justify-center">
                  <button className="btn-primary text-caption px-4 py-1.5 whitespace-nowrap">
                    Trade
                  </button>
                </div>
              </Link>
            );
          })}
        </div>

        {liveMarkets.length > 10 && (
          <div className="mt-6 text-center">
            <Link href="/markets" className="btn-ghost text-body text-silver-text hover:text-white">
              View all {liveMarkets.length} markets →
            </Link>
          </div>
        )}
      </section>

      {/* ── STATS ROW ──────────────────────────────────────── */}
      <section className="border-t border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Volume", value: "$14.2M", sub: "All-time" },
              { label: "Open Interest", value: "$2.8M", sub: "Locked" },
              { label: "Resolved", value: "124", sub: "Markets" },
              { label: "Avg. Fee", value: "0.5%", sub: "Per trade" },
            ].map((stat) => (
              <div key={stat.label} className="card text-center">
                <div className="font-mono text-heading text-cadmium-green">{stat.value}</div>
                <div className="text-caption text-silver-text mt-2">{stat.label}</div>
                <div className="text-caption text-silver-text/60 mt-0.5">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── RECENTLY SETTLED ──────────────────────────────── */}
      <section className="max-w-content mx-auto px-6 py-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-subheading text-white font-medium">Recently Settled</h2>
          <Link href="/markets?status=Settled" className="btn-ghost text-caption text-silver-text hover:text-white">
            View all →
          </Link>
        </div>

        <div className="table-container overflow-x-auto">
          <div className="grid min-w-full" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
            <div className="table-header">Market</div>
            <div className="table-header">Result</div>
            <div className="table-header">Winning</div>
            <div className="table-header">Settled</div>
          </div>

          {recentSettled.map((market) => (
            <div
              key={market.market_id}
              className="grid min-w-full table-row"
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
      </section>

      {/* ── PROTOCOL FEATURES ─────────────────────────────── */}
      <section className="border-t border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <h2 className="text-subheading text-white font-medium mb-8">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { step: "01", title: "Connect", desc: "Link your Solana wallet (Phantom, Backpack, Solflare) in one click." },
              { step: "02", title: "Choose", desc: "Browse events across sports, finance, crypto. Fair prices via LMSR." },
              { step: "03", title: "Trade", desc: "Buy YES or NO at any size. Instant settlement on Solana." },
              { step: "04", title: "Win", desc: "When oracle resolves, claim your share. Fully non-custodial." },
            ].map((item) => (
              <div key={item.step} className="card">
                <div className="font-mono text-display text-graphite/40 mb-4">{item.step}</div>
                <h3 className="text-body text-white font-medium mb-2">{item.title}</h3>
                <p className="text-caption text-silver-text leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer className="border-t border-graphite py-8">
        <div className="max-w-content mx-auto px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
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

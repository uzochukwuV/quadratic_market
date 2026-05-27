"use client";

import { MY_POSITIONS, MARKETS } from "@/lib/mockData";

function formatVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

export default function PortfolioPage() {
  const totalValue = MY_POSITIONS.reduce((sum, p) => sum + p.value, 0);
  const totalPnl = MY_POSITIONS.reduce((sum, p) => sum + p.pnl, 0);
  const totalCost = MY_POSITIONS.reduce((sum, p) => sum + p.shares * p.avg_price, 0);

  return (
    <div className="min-h-screen">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-6">
          <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-1">Account</p>
          <h1 className="text-heading text-white font-medium">Portfolio</h1>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-8">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Portfolio Value", value: `$${totalValue.toFixed(2)}` },
            { label: "Total P&L", value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, accent: true },
            { label: "Markets", value: MY_POSITIONS.length.toString() },
            { label: "Win Rate", value: "67%" },
          ].map((stat) => (
            <div key={stat.label} className="card text-center">
              <div className={`text-heading font-mono ${stat.accent ? "text-cadmium-green" : "text-white"}`}>
                {stat.value}
              </div>
              <div className="text-caption text-silver-text mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Positions table */}
        <div className="card">
          <h2 className="text-subheading text-white font-medium mb-4">Your Positions</h2>
          <div className="table-container">
            <div className="table-header grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr" }}>
              <div>Market</div>
              <div>Outcome</div>
              <div>Shares</div>
              <div>Value</div>
              <div>P&L</div>
              <div>Action</div>
            </div>
            {MY_POSITIONS.map((position) => {
              const market = MARKETS.find((m) => m.market_id === position.market_id);
              const pnlColor = position.pnl >= 0 ? "text-cadmium-green" : "text-[#f47067]";
              return (
                <a
                  key={position.market_id}
                  href={`/trade?market=${position.market_id}`}
                  className="grid table-row"
                  style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr" }}
                >
                  <div className="table-cell">
                    <div className="text-white font-medium truncate">{market?.title || "Unknown Market"}</div>
                    <div className="text-caption text-silver-text">Epoch #{market?.epoch_id}</div>
                  </div>
                  <div className="table-cell">
                    <span className={`font-mono ${position.outcome_id === 0 ? "text-cadmium-green" : "text-white"}`}>
                      {position.outcome_label}
                    </span>
                  </div>
                  <div className="table-cell font-mono">{position.shares.toLocaleString()}</div>
                  <div className="table-cell font-mono">${position.value.toFixed(2)}</div>
                  <div className={`table-cell font-mono ${pnlColor}`}>
                    {position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)}
                  </div>
                  <div className="table-cell">
                    <button className="btn-secondary text-caption px-3 py-1">Trade</button>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

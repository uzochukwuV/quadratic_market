"use client";

import Link from "next/link";
import { EPOCHS, MARKETS, getMarketPrices } from "@/lib/mockData";

export default function EpochsPage() {
  const now = Math.floor(Date.now() / 1000);

  const getEpochStatus = (epoch: any) => {
    if (now >= epoch.start_time && now < epoch.end_time) return "active";
    if (epoch.all_markets_settled) return "settled";
    return "closed";
  };

  const getEpochStatusLabel = (status: string) => {
    switch (status) {
      case "active":
        return "Active";
      case "settled":
        return "Settled";
      default:
        return "Closed";
    }
  };

  return (
    <div className="min-h-screen bg-rich-black">
      {/* Header */}
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-2">Epochs</p>
          <h1 className="text-heading md:text-display text-white font-medium">All Epochs</h1>
          <p className="text-body text-silver-text mt-2">
            Trading rounds with unique markets and liquidity pools
          </p>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-12">
        <div className="space-y-6">
          {EPOCHS.map((epoch) => {
            const status = getEpochStatus(epoch);
            const epochMarkets = MARKETS.filter((m) => m.epoch_id === epoch.epoch_id);
            const daysUntilEnd = Math.ceil((epoch.end_time - now) / 86400);
            const daysElapsed = Math.floor((now - epoch.start_time) / 86400);

            return (
              <Link
                key={epoch.epoch_id}
                href={`/epochs/${epoch.epoch_id}`}
                className="block"
              >
                <div className="card hover:border-cadmium-green/50 transition-all cursor-pointer">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    {/* Left: Epoch info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <h2 className="text-subheading text-white font-medium">
                          Epoch #{epoch.epoch_id}
                        </h2>
                        <span
                          className={`badge ${
                            status === "active"
                              ? "badge-live"
                              : status === "settled"
                                ? "badge-settled"
                                : "badge-closed"
                          }`}
                        >
                          {getEpochStatusLabel(status)}
                        </span>
                        {epoch.withdrawals_enabled && (
                          <span
                            className="badge"
                            style={{
                              borderColor: "#5bc8fa",
                              color: "#5bc8fa",
                              background: "rgba(91, 200, 250, 0.08)",
                            }}
                          >
                            Withdrawals Open
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-caption text-silver-text mb-1">Duration</p>
                          <p className="text-body font-mono text-white">
                            {daysElapsed > 0
                              ? `Day ${daysElapsed}`
                              : `+${Math.ceil((epoch.start_time - now) / 86400)}d`}
                          </p>
                        </div>
                        <div>
                          <p className="text-caption text-silver-text mb-1">Markets</p>
                          <p className="text-body font-mono text-white">
                            {epoch.num_settled_markets}/{epoch.num_markets}
                          </p>
                        </div>
                        <div>
                          <p className="text-caption text-silver-text mb-1">Total Liquidity</p>
                          <p className="text-body font-mono text-cadmium-green">
                            ${(epoch.total_liquidity_added / 1_000_000_000).toFixed(2)}M
                          </p>
                        </div>
                        <div>
                          <p className="text-caption text-silver-text mb-1">Time Left</p>
                          <p className="text-body font-mono text-white">
                            {daysUntilEnd > 0 ? `${daysUntilEnd}d` : "Closed"}
                          </p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-4">
                        <div className="w-full h-2 bg-graphite rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cadmium-green transition-all"
                            style={{
                              width: `${Math.min(100, (epoch.num_settled_markets / epoch.num_markets) * 100)}%`,
                            }}
                          />
                        </div>
                        <p className="text-caption text-silver-text mt-2">
                          {epoch.num_settled_markets} of {epoch.num_markets} markets settled
                        </p>
                      </div>
                    </div>

                    {/* Right: Top markets in this epoch */}
                    <div className="md:w-48">
                      <p className="text-caption text-silver-text mb-3 uppercase font-mono">
                        Featured Markets
                      </p>
                      <div className="space-y-2">
                        {epochMarkets.slice(0, 3).map((market) => {
                          const prices = getMarketPrices(market);
                          return (
                            <div
                              key={market.market_id}
                              className="p-2 bg-white/[0.03] border border-graphite rounded-md"
                            >
                              <p className="text-caption text-white font-medium line-clamp-1 mb-1">
                                {market.title}
                              </p>
                              <div className="flex items-center justify-between text-caption">
                                <span className="text-silver-text">
                                  {market.status === "Open" ? "Live" : market.status}
                                </span>
                                <span className="text-cadmium-green font-mono">
                                  {(prices[0] * 100).toFixed(0)}¢
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

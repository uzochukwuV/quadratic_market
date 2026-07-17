"use client";

import { useContractSnapshot, useSortedSnapshot } from "@/hooks/useContractData";
import { priceFromMarket } from "@/lib/contract";

export default function EpochsPage() {
  const now = Math.floor(Date.now() / 1000);
  const { snapshot, loading } = useContractSnapshot();
  const { epochs, markets } = useSortedSnapshot(snapshot);

  const getEpochStatus = (epoch: { start_time: number; end_time: number; all_markets_settled: boolean }) => {
    if (now >= epoch.start_time && now < epoch.end_time) return "active";
    if (epoch.all_markets_settled) return "settled";
    return "closed";
  };

  return (
    <div className="min-h-screen bg-rich-black">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-2">Epochs</p>
          <h1 className="text-heading md:text-display text-white font-medium">All Epochs</h1>
          <p className="text-body text-silver-text mt-2">
            {loading ? "Loading snapshot..." : "Trading rounds with their linked markets and liquidity windows"}
          </p>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-12">
        {epochs.length === 0 ? (
          <div className="card text-center py-16">
            <p className="text-white mb-2">No epochs loaded</p>
            <p className="text-caption text-silver-text">The current contract snapshot did not return any epoch accounts.</p>
          </div>
        ) : (
        <div className="space-y-6">
          {epochs.map((epoch) => {
            const status = getEpochStatus(epoch);
            const epochMarkets = markets.filter((market) => market.epoch_id === epoch.epoch_id);
            const daysUntilEnd = Math.ceil((epoch.end_time - now) / 86400);
            const daysElapsed = Math.floor((now - epoch.start_time) / 86400);

            return (
              <div key={epoch.epoch_id} className="card">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                  <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <h2 className="text-subheading text-white font-medium">Epoch #{epoch.epoch_id}</h2>
                        <span className={`badge ${status === "active" ? "badge-live" : status === "settled" ? "badge-settled" : "badge-closed"}`}>
                          {status === "active" ? "Active" : status === "settled" ? "Settled" : "Closed"}
                        </span>
                        {epoch.withdrawals_enabled && (
                          <span className="badge" style={{ borderColor: "#5bc8fa", color: "#5bc8fa", background: "rgba(91, 200, 250, 0.08)" }}>
                            Withdrawals Open
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-caption text-silver-text mb-1">Duration</p>
                          <p className="text-body font-mono text-white">
                            {daysElapsed > 0 ? `Day ${daysElapsed}` : `+${Math.ceil((epoch.start_time - now) / 86400)}d`}
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

                      <div className="mt-4">
                        <div className="w-full h-2 bg-graphite rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cadmium-green transition-all"
                            style={{ width: `${Math.min(100, (epoch.num_settled_markets / Math.max(epoch.num_markets, 1)) * 100)}%` }}
                          />
                        </div>
                        <p className="text-caption text-silver-text mt-2">
                          {epoch.num_settled_markets} of {epoch.num_markets} markets settled
                        </p>
                      </div>
                    </div>

                  <div className="md:w-48">
                    <p className="text-caption text-silver-text mb-3 uppercase font-mono">Featured Markets</p>
                    <div className="space-y-2">
                      {epochMarkets.slice(0, 3).map((market) => {
                        const yesPrice = priceFromMarket(market, 0);
                        return (
                          <div key={market.market_id} className="p-2 bg-white/[0.03] border border-graphite rounded-md">
                            <p className="text-caption text-white font-medium line-clamp-1 mb-1">{market.title}</p>
                            <div className="flex items-center justify-between text-caption">
                              <span className="text-silver-text">{market.status === "Open" ? "Live" : market.status}</span>
                              <span className="text-cadmium-green font-mono">{(yesPrice * 100).toFixed(0)}¢</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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

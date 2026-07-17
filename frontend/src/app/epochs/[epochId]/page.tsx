"use client";

import Link from "next/link";
import { useContractSnapshot, useSortedSnapshot } from "@/hooks/useContractData";
import { priceFromMarket } from "@/lib/contract";

export default function EpochDetailPage({ params }: { params: { epochId: string } }) {
  const epochId = Number(params.epochId);
  const { snapshot } = useContractSnapshot();
  const { epochs, markets } = useSortedSnapshot(snapshot);

  const epoch = epochs.find((entry) => entry.epoch_id === epochId);
  const epochMarkets = markets.filter((market) => market.epoch_id === epochId);

  if (!epoch) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-white mb-4">Epoch not found</p>
          <Link href="/epochs" className="btn-primary">
            Back to Epochs
          </Link>
        </div>
      </div>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const isActive = now >= epoch.start_time && now < epoch.end_time;
  const isClosed = epoch.all_markets_settled;
  const daysElapsed = Math.floor((now - epoch.start_time) / 86400);
  const daysUntilEnd = Math.ceil((epoch.end_time - now) / 86400);
  const progress = Math.min(100, ((now - epoch.start_time) / Math.max(epoch.end_time - epoch.start_time, 1)) * 100);

  const openMarkets = epochMarkets.filter((market) => market.status === "Open");
  const settledMarkets = epochMarkets.filter((market) => market.status === "Settled");
  const awaitingMarkets = epochMarkets.filter((market) => market.status === "AwaitingResult");
  const totalVolume = epochMarkets.reduce((sum, market) => sum + market.exposure * 12, 0);

  return (
    <div className="min-h-screen bg-rich-black">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <Link href="/epochs" className="text-caption text-silver-text hover:text-white mb-4 inline-block">
            ← Back to Epochs
          </Link>

          <h1 className="text-heading md:text-display text-white font-medium mb-2">
            Epoch #{epoch.epoch_id}
          </h1>

          <div className="flex flex-wrap items-center gap-3 mb-6">
            <span className={`badge ${isActive ? "badge-live" : isClosed ? "badge-settled" : "badge-closed"}`}>
              {isActive ? "Active" : isClosed ? "Settled" : "Closed"}
            </span>
            {epoch.withdrawals_enabled && (
              <span className="badge" style={{ borderColor: "#5bc8fa", color: "#5bc8fa", background: "rgba(91, 200, 250, 0.08)" }}>
                Withdrawals Open
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-caption text-silver-text mb-2">Start Date</p>
              <p className="text-body font-mono text-white">{new Date(epoch.start_time * 1000).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-caption text-silver-text mb-2">End Date</p>
              <p className="text-body font-mono text-white">{new Date(epoch.end_time * 1000).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-caption text-silver-text mb-2">Days Elapsed</p>
              <p className="text-body font-mono text-white">{Math.max(0, daysElapsed)} days</p>
            </div>
            <div>
              <p className="text-caption text-silver-text mb-2">Days Remaining</p>
              <p className="text-body font-mono text-cadmium-green">{Math.max(0, daysUntilEnd)} days</p>
            </div>
          </div>

          {isActive && (
            <div className="mt-6">
              <div className="w-full h-3 bg-graphite rounded-full overflow-hidden">
                <div className="h-full bg-cadmium-green transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-caption text-silver-text mt-2">{progress.toFixed(0)}% complete</p>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <p className="text-caption text-silver-text mb-2">Total Markets</p>
            <p className="text-heading font-mono text-white">{epoch.num_markets}</p>
          </div>
          <div className="card">
            <p className="text-caption text-silver-text mb-2">Settled</p>
            <p className="text-heading font-mono text-cadmium-green">{epoch.num_settled_markets}</p>
          </div>
          <div className="card">
            <p className="text-caption text-silver-text mb-2">Total Liquidity</p>
            <p className="text-heading font-mono text-white">
              ${(totalVolume / 1_000_000).toFixed(2)}M
            </p>
          </div>
          <div className="card">
            <p className="text-caption text-silver-text mb-2">LP Shares</p>
            <p className="text-heading font-mono text-cadmium-green">
              {(epoch.lp_shares_at_close / 1_000_000).toFixed(1)}M
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-1">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-body font-medium text-white">Open</h3>
                <span className="text-caption font-mono text-cadmium-green">{openMarkets.length}</span>
              </div>
              <div className="space-y-2">
                {openMarkets.slice(0, 5).map((market) => {
                  const yesPrice = priceFromMarket(market, 0);
                  return (
                    <Link key={market.market_id} href={`/trade?market=${market.market_id}`} className="p-3 bg-white/[0.03] border border-graphite rounded-md hover:bg-white/[0.06] transition-colors block">
                      <p className="text-caption text-white font-medium line-clamp-1 mb-1">{market.title}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-caption text-silver-text">{market.category}</span>
                        <span className="text-caption text-cadmium-green font-mono">{(yesPrice * 100).toFixed(0)}¢</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-body font-medium text-white">Awaiting</h3>
                <span className="text-caption font-mono text-silver-text">{awaitingMarkets.length}</span>
              </div>
              <div className="space-y-2">
                {awaitingMarkets.slice(0, 5).map((market) => {
                  const yesPrice = priceFromMarket(market, 0);
                  return (
                    <Link key={market.market_id} href={`/trade?market=${market.market_id}`} className="p-3 bg-white/[0.03] border border-graphite rounded-md hover:bg-white/[0.06] transition-colors block">
                      <p className="text-caption text-white font-medium line-clamp-1 mb-1">{market.title}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-caption text-silver-text">{market.category}</span>
                        <span className="text-caption text-white font-mono">{(yesPrice * 100).toFixed(0)}¢</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-body font-medium text-white">Settled</h3>
                <span className="text-caption font-mono text-cadmium-green">{settledMarkets.length}</span>
              </div>
              <div className="space-y-2">
                {settledMarkets.slice(0, 5).map((market) => (
                  <Link key={market.market_id} href={`/trade?market=${market.market_id}`} className="p-3 bg-white/[0.03] border border-graphite rounded-md hover:bg-white/[0.06] transition-colors block">
                    <p className="text-caption text-white font-medium line-clamp-1 mb-1">{market.title}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-caption text-silver-text">{market.category}</span>
                      <span className={`text-caption font-mono ${market.winning_outcome === 0 ? "text-cadmium-green" : "text-white"}`}>
                        {market.winning_outcome === 0 ? "YES" : "NO"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-subheading text-white font-medium mb-4">All Markets</h2>
          <div className="table-container overflow-x-auto">
            <div className="grid min-w-full" style={{ gridTemplateColumns: "2fr 1fr 80px 80px 1fr 100px" }}>
              <div className="table-header">Market</div>
              <div className="table-header">Category</div>
              <div className="table-header">Yes</div>
              <div className="table-header">No</div>
              <div className="table-header">Volume</div>
              <div className="table-header">Status</div>
            </div>

            {epochMarkets.map((market) => {
              const yesPrice = priceFromMarket(market, 0);
              const noPrice = priceFromMarket(market, 1);

              return (
                <Link
                  key={market.market_id}
                  href={`/trade?market=${market.market_id}`}
                  className="grid min-w-full table-row hover:bg-white/[0.02]"
                  style={{ gridTemplateColumns: "2fr 1fr 80px 80px 1fr 100px" }}
                >
                  <div className="table-cell">
                    <div className="text-white font-medium truncate">{market.title}</div>
                    <div className="text-caption text-silver-text mt-0.5">
                      {market.market_mode === "Trading" ? "Slip" : "Fixed Odds"}
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
                    ${(market.exposure * 12 / 1_000_000).toFixed(2)}M
                  </div>
                  <div className="table-cell">
                    <span className={`badge ${market.status === "Open" ? "badge-live" : market.status === "Settled" ? "badge-settled" : "badge-closed"}`}>
                      {market.status}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

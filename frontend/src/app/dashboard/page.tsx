"use client";

import Link from "next/link";
import { BetSlipPanel } from "@/app/components/BetSlipPanel";
import { EpochBanner } from "@/app/components/EpochBanner";
import { useProtocol } from "@/hooks/useProtocol";
import { getMarketPrices } from "@/lib/contract";

function formatVolume(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function oddsLabel(price: number): string {
  const cents = Math.max(1, Math.round(price * 100));
  return `${cents}¢`;
}

export default function DashboardPage() {
  const { markets, epochs, marketGroups, orders, loading } = useProtocol();

  const activeMarkets = markets.filter((market) => market.status === "Open");
  const settledMarkets = markets.filter((market) => market.status === "Settled");
  const currentEpoch = epochs[0];
  const latestEpoch = epochs[0];

  const totalExposure = activeMarkets.reduce((sum, market) => sum + market.exposure, 0);
  const totalOrders = orders.length;

  const featuredGroups = marketGroups.slice(0, 3);

  return (
    <div className="min-h-screen bg-rich-black">
      <EpochBanner />

      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_360px]">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="w-2 h-2 rounded-full bg-cadmium-green pulse-dot" />
                <span className="font-mono text-caption text-silver-text uppercase tracking-widest">
                  Live Protocol
                </span>
              </div>
              <h1 className="text-heading md:text-display text-white font-medium tracking-tight">
                Dashboard
              </h1>
              <p className="text-body text-silver-text mt-3 max-w-2xl">
                The frontend now reads protocol state directly. Markets, epochs, slips, and orders are normalized from the on-chain accounts and rendered without a frontend API layer.
              </p>

              <div className="flex flex-wrap gap-3 mt-6">
                <Link href="/markets" className="btn-primary">
                  Browse Markets
                </Link>
                <Link href="/liquidity" className="btn-secondary">
                  Liquidity
                </Link>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-body font-medium text-white">Protocol Snapshot</h2>
                <span className="text-caption text-silver-text">{loading ? "Syncing" : "Live"}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-graphite bg-white/[0.03] p-3">
                  <div className="text-caption text-silver-text">Open Markets</div>
                  <div className="text-heading font-mono text-white mt-1">{activeMarkets.length}</div>
                </div>
                <div className="rounded-md border border-graphite bg-white/[0.03] p-3">
                  <div className="text-caption text-silver-text">Settled</div>
                  <div className="text-heading font-mono text-white mt-1">{settledMarkets.length}</div>
                </div>
                <div className="rounded-md border border-graphite bg-white/[0.03] p-3">
                  <div className="text-caption text-silver-text">Orders</div>
                  <div className="text-heading font-mono text-white mt-1">{totalOrders}</div>
                </div>
                <div className="rounded-md border border-graphite bg-white/[0.03] p-3">
                  <div className="text-caption text-silver-text">Groups</div>
                  <div className="text-heading font-mono text-white mt-1">{marketGroups.length}</div>
                </div>
              </div>

              <div className="mt-4 rounded-md border border-cadmium-green/20 bg-cadmium-green/10 p-3">
                <div className="text-caption text-silver-text mb-1">Current Epoch</div>
                <div className="text-body text-white font-medium">
                  {currentEpoch ? `Epoch #${currentEpoch.epoch_id}` : "No active epoch"}
                </div>
                <div className="text-caption text-silver-text mt-1">
                  {latestEpoch ? `${latestEpoch.num_settled_markets}/${latestEpoch.num_markets} markets settled` : "No epoch data"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-content mx-auto px-6 py-12">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_360px]">
          <div className="space-y-6">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-subheading text-white font-medium">Live Markets</h2>
                <span className="text-caption text-silver-text">{activeMarkets.length} open</span>
              </div>

              <div className="table-container overflow-x-auto">
                <div className="grid min-w-full" style={{ gridTemplateColumns: "2.3fr 1fr 1fr 1fr 92px" }}>
                  <div className="table-header">Market</div>
                  <div className="table-header">YES</div>
                  <div className="table-header">NO</div>
                  <div className="table-header">Volume</div>
                  <div className="table-header text-center">Trade</div>
                </div>

                {activeMarkets.slice(0, 8).map((market) => {
                  const [yesPrice, noPrice] = getMarketPrices(market);
                  return (
                    <Link
                      key={market.market_id}
                      href={`/markets?market=${market.market_id}`}
                      className="grid min-w-full table-row hover:bg-white/[0.02]"
                      style={{ gridTemplateColumns: "2.3fr 1fr 1fr 1fr 92px" }}
                    >
                      <div className="table-cell">
                        <div className="text-white font-medium truncate">{market.title}</div>
                        <div className="text-caption text-silver-text mt-0.5">
                          Epoch #{market.epoch_id} · {market.category}
                        </div>
                      </div>
                      <div className="table-cell text-cadmium-green font-mono">
                        {oddsLabel(yesPrice)}
                      </div>
                      <div className="table-cell text-white font-mono">
                        {oddsLabel(noPrice)}
                      </div>
                      <div className="table-cell text-silver-text font-mono">
                        {formatVolume(market.exposure * 12)}
                      </div>
                      <div className="table-cell text-center">
                        <span className="btn-secondary text-caption px-3 py-1.5">
                          Open
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="card">
                <div className="text-caption text-silver-text">Total Exposure</div>
                <div className="text-heading font-mono text-white mt-1">{formatVolume(totalExposure)}</div>
              </div>
              <div className="card">
                <div className="text-caption text-silver-text">Epoch Count</div>
                <div className="text-heading font-mono text-white mt-1">{epochs.length}</div>
              </div>
              <div className="card">
                <div className="text-caption text-silver-text">Group Bonus</div>
                <div className="text-heading font-mono text-white mt-1">
                  {featuredGroups.length > 0 ? "Active" : "None"}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-subheading text-white font-medium">Market Group Correlation</h2>
                <span className="text-caption text-silver-text">
                  Bonus should stay smaller for same-group selections
                </span>
              </div>

              <div className="space-y-3">
                {featuredGroups.length === 0 ? (
                  <p className="text-caption text-silver-text">No market groups have been created yet.</p>
                ) : (
                  featuredGroups.map((group) => (
                    <div key={group.group_id} className="rounded-md border border-graphite bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-white font-medium">{group.title}</div>
                          <div className="text-caption text-silver-text mt-0.5">
                            Group #{group.group_id} · {group.num_markets} markets
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-caption text-silver-text">Exposure</div>
                          <div className="text-white font-mono">{formatVolume(group.total_group_exposure)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <BetSlipPanel />

            <div className="card">
              <h3 className="text-body font-medium text-white mb-3">Settlement Feed</h3>
              <div className="space-y-3">
                {settledMarkets.slice(0, 4).map((market) => {
                  const [yesPrice] = getMarketPrices(market);
                  return (
                    <div key={market.market_id} className="rounded-md border border-graphite bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-white font-medium truncate">{market.title}</div>
                          <div className="text-caption text-silver-text mt-0.5">
                            {market.status} · {market.category}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-caption text-silver-text">YES</div>
                          <div className="text-cadmium-green font-mono">{oddsLabel(yesPrice)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

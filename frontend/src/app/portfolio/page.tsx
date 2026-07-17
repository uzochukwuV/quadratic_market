"use client";

import Link from "next/link";

import { useContractSnapshot, useSortedSnapshot } from "@/hooks/useContractData";

function formatAmount(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default function PortfolioPage() {
  const { snapshot, loading } = useContractSnapshot();
  const { markets, epochs } = useSortedSnapshot(snapshot);

  const slips = snapshot?.slips ?? [];
  const orders = snapshot?.limitOrders ?? [];
  const pendingLiquidity = snapshot?.pendingLiquidity ?? [];
  const epochPositions = snapshot?.epochLpPositions ?? [];
  const openOrders = orders.filter((order) => order.status === "Open");
  const activeSlips = slips.filter((slip) => !slip.claimed);
  const settledMarkets = markets.filter((market) => market.status === "Settled");
  const openMarkets = markets.filter((market) => market.status === "Open");

  const totalExposure = markets.reduce((sum, market) => sum + market.exposure, 0);
  const totalLiquidity = pendingLiquidity.reduce((sum, item) => sum + item.amount_deposited, 0);
  const totalSlipStake = activeSlips.reduce((sum, slip) => sum + slip.total_stake, 0);
  const totalLockedOrders = openOrders.reduce((sum, order) => sum + order.collateral_locked, 0);

  return (
    <div className="min-h-screen bg-rich-black">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <div className="mb-8">
            <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-2">Portfolio</p>
            <h1 className="text-heading md:text-display text-white font-medium">Protocol Activity</h1>
            <p className="text-body text-silver-text mt-2">
              {loading ? "Loading on-chain snapshot..." : `${markets.length} markets · ${epochs.length} epochs`}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card">
              <p className="text-caption text-silver-text mb-2">Open Markets</p>
              <p className="text-heading font-mono text-white">{openMarkets.length}</p>
              <p className="text-caption text-silver-text mt-1">{settledMarkets.length} settled</p>
            </div>

            <div className="card">
              <p className="text-caption text-silver-text mb-2">Exposure</p>
              <p className="text-heading font-mono text-cadmium-green">{formatAmount(totalExposure)}</p>
              <p className="text-caption text-silver-text mt-1">Across all markets</p>
            </div>

            <div className="card">
              <p className="text-caption text-silver-text mb-2">Active Slips</p>
              <p className="text-heading font-mono text-white">{activeSlips.length}</p>
              <p className="text-caption text-silver-text mt-1">{formatAmount(totalSlipStake)} staked</p>
            </div>

            <div className="card">
              <p className="text-caption text-silver-text mb-2">Pending LP</p>
              <p className="text-heading font-mono text-cadmium-green">{formatAmount(totalLiquidity)}</p>
              <p className="text-caption text-silver-text mt-1">{epochPositions.length} epoch positions</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-subheading text-white font-medium">Open Orders</h2>
                <span className="text-caption text-silver-text">{openOrders.length} open</span>
              </div>
              {openOrders.length === 0 ? (
                <p className="text-caption text-silver-text">No open orders on chain.</p>
              ) : (
                <div className="space-y-2">
                  {openOrders.slice(0, 6).map((order) => (
                    <div key={order.order_id} className="rounded-md border border-graphite bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-white font-medium">Market #{order.market_id}</div>
                          <div className="text-caption text-silver-text">
                            {order.side} {order.num_shares} @ {(order.price_per_share * 100).toFixed(1)}¢
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-caption text-silver-text">Locked</div>
                          <div className="text-cadmium-green font-mono">{formatAmount(order.collateral_locked)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-subheading text-white font-medium">Active Slips</h2>
                <span className="text-caption text-silver-text">{activeSlips.length} active</span>
              </div>
              {activeSlips.length === 0 ? (
                <p className="text-caption text-silver-text">No slips found for the current wallet state.</p>
              ) : (
                <div className="space-y-2">
                  {activeSlips.slice(0, 6).map((slip) => (
                    <div key={slip.slip_id} className="rounded-md border border-graphite bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-white font-medium">{slip.num_legs}-Leg Slip</div>
                          <div className="text-caption text-silver-text">
                            Stake {formatAmount(slip.total_stake)} · Payout {formatAmount(slip.potential_payout)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-caption text-silver-text">Status</div>
                          <div className="text-cadmium-green font-mono">{slip.status}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="card">
              <h3 className="text-body font-medium text-white mb-4">Wallet State</h3>
              <div className="space-y-3 text-caption">
                <div className="flex justify-between">
                  <span className="text-silver-text">Epochs</span>
                  <span className="text-white font-mono">{epochs.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-silver-text">LP Positions</span>
                  <span className="text-white font-mono">{epochPositions.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-silver-text">Pending Liquidity</span>
                  <span className="text-white font-mono">{pendingLiquidity.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-silver-text">Total Locked Orders</span>
                  <span className="text-cadmium-green font-mono">{formatAmount(totalLockedOrders)}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="text-body font-medium text-white mb-4">Navigation</h3>
              <div className="space-y-2">
                <Link href="/markets" className="block btn-secondary text-center">
                  Browse Markets
                </Link>
                <Link href="/epochs" className="block btn-secondary text-center">
                  View Epochs
                </Link>
                <Link href="/liquidity" className="block btn-secondary text-center">
                  Liquidity
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

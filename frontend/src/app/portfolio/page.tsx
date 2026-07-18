"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

import { useProtocol } from "@/hooks/useProtocol";

function formatAmount(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(0)}`;
}

function shortKey(value?: string | null) {
  if (!value) return "Not connected";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export default function PortfolioPage() {
  const { publicKey } = useWallet();
  const { markets, slips, orders, pendingLiquidity, withdrawals, userEpochPositions, loading } = useProtocol();

  const openMarkets = markets.filter((market) => market.status === "Open");
  const settledMarkets = markets.filter((market) => market.status === "Settled");
  const activeSlips = slips.filter((slip) => !slip.claimed);
  const openOrders = orders.filter((order) => order.status === "Open");
  const totalExposure = markets.reduce((sum, market) => sum + market.exposure, 0);
  const totalSlipStake = activeSlips.reduce((sum, slip) => sum + slip.total_stake, 0);
  const totalLockedOrders = openOrders.reduce((sum, order) => sum + order.collateral_locked, 0);

  return (
    <div className="min-h-screen bg-rich-black">
      <div className="border-b border-graphite bg-[radial-gradient(circle_at_top,_rgba(91,200,250,0.12),_transparent_36%),linear-gradient(180deg,_rgba(255,255,255,0.03),_transparent)]">
        <div className="max-w-content mx-auto px-4 sm:px-6 py-10 sm:py-12">
          <div className="flex flex-col gap-6">
            <div className="max-w-3xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-silver-text mb-3">Portfolio overview</p>
              <h1 className="text-heading md:text-display text-white font-medium leading-tight">
                Wallet state across markets, slips, and liquidity.
              </h1>
              <p className="text-body text-silver-text mt-3 max-w-2xl">
                This page shows the current on-chain footprint for the connected wallet and the live protocol surface it interacts with.
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Open markets</p>
                <p className="text-lg font-semibold text-white mt-1">{openMarkets.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Settled</p>
                <p className="text-lg font-semibold text-white mt-1">{settledMarkets.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Active slips</p>
                <p className="text-lg font-semibold text-white mt-1">{activeSlips.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">LP positions</p>
                <p className="text-lg font-semibold text-white mt-1">{userEpochPositions.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Orders</p>
                <p className="text-lg font-semibold text-white mt-1">{orders.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-content mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_360px]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-subheading text-white font-medium">Open slips</h2>
                  <p className="text-caption text-silver-text mt-1">Active bets that are still awaiting settlement.</p>
                </div>
                <Link href="/markets" className="btn-secondary text-caption">
                  Browse markets
                </Link>
              </div>

              {activeSlips.length === 0 ? (
                <p className="text-caption text-silver-text">No active slips are linked to this wallet state.</p>
              ) : (
                <div className="space-y-3">
                  {activeSlips.slice(0, 6).map((slip) => (
                    <div key={slip.slip_id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="badge badge-live">{slip.status}</span>
                            <span className="badge">{slip.num_legs}-leg slip</span>
                          </div>
                          <h3 className="text-white font-medium">Slip #{slip.slip_id}</h3>
                          <p className="text-caption text-silver-text mt-1">
                            Stake {formatAmount(slip.total_stake)} · Potential payout {formatAmount(slip.potential_payout)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Locked</p>
                          <p className="text-white font-mono mt-1">{formatAmount(slip.locked_amount)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h2 className="text-subheading text-white font-medium mb-4">Open orders</h2>
              {openOrders.length === 0 ? (
                <p className="text-caption text-silver-text">No open orders remain on chain for this wallet snapshot.</p>
              ) : (
                <div className="space-y-3">
                  {openOrders.slice(0, 6).map((order) => (
                    <div key={order.order_id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="badge">{order.side}</span>
                            <span className="badge">Market #{order.market_id}</span>
                          </div>
                          <h3 className="text-white font-medium">Order #{order.order_id}</h3>
                          <p className="text-caption text-silver-text mt-1">
                            {order.num_shares} shares @ {(order.price_per_share * 100).toFixed(1)}¢
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Locked</p>
                          <p className="text-cadmium-green font-mono mt-1">{formatAmount(order.collateral_locked)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 sticky top-20">
              <h3 className="text-body font-medium text-white mb-4">Wallet summary</h3>
              <div className="space-y-3 text-caption">
                <div className="flex justify-between gap-4">
                  <span className="text-silver-text">Wallet</span>
                  <span className="text-white font-mono">{shortKey(publicKey?.toBase58())}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-silver-text">Protocol exposure</span>
                  <span className="text-white font-mono">{formatAmount(totalExposure)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-silver-text">Slip stake</span>
                  <span className="text-white font-mono">{formatAmount(totalSlipStake)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-silver-text">Locked orders</span>
                  <span className="text-cadmium-green font-mono">{formatAmount(totalLockedOrders)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-silver-text">Pending liquidity</span>
                  <span className="text-white font-mono">{pendingLiquidity.length}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-silver-text">Withdrawal requests</span>
                  <span className="text-white font-mono">{withdrawals.length}</span>
                </div>
              </div>

              <div className="mt-5 grid gap-2">
                <Link href="/markets" className="btn-primary text-center">
                  Open markets board
                </Link>
                <Link href="/liquidity" className="btn-secondary text-center">
                  Review liquidity
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h3 className="text-body font-medium text-white mb-4">LP positions</h3>
              {userEpochPositions.length === 0 ? (
                <p className="text-caption text-silver-text">{loading ? "Loading wallet snapshot..." : "No LP positions tied to this wallet."}</p>
              ) : (
                <div className="space-y-3">
                  {userEpochPositions.slice(0, 4).map((position) => (
                    <div key={`${position.owner}-${position.epoch_id}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="badge">Epoch #{position.epoch_id}</span>
                            <span className={`badge ${position.withdrawn ? "badge-settled" : "badge-live"}`}>
                              {position.withdrawn ? "Withdrawn" : "Active"}
                            </span>
                          </div>
                          <h4 className="text-white font-medium">LP position</h4>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Shares</p>
                          <p className="text-white font-mono mt-1">{position.shares.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

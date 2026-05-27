"use client";

import Link from "next/link";
import { MY_POSITIONS, MY_SLIPS, MY_ORDERS, MY_LP_EPOCHS, PNL_HISTORY, MARKETS } from "@/lib/mockData";
import { PnLChart } from "@/app/components/PnLChart";
import { PositionsTable } from "@/app/components/PositionsTable";
import { LiquidityTable } from "@/app/components/LiquidityTable";

export default function PortfolioPage() {
  // Calculate totals
  const totalInvested = MY_POSITIONS.reduce((sum, p) => sum + p.cost, 0);
  const totalValue = MY_POSITIONS.reduce((sum, p) => sum + p.value, 0);
  const totalPnL = MY_POSITIONS.reduce((sum, p) => sum + p.pnl, 0);
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const totalLpDeposited = MY_LP_EPOCHS.reduce((sum, e) => sum + e.deposited_sol, 0);
  const totalLpFeesEarned = MY_LP_EPOCHS.reduce((sum, e) => sum + e.fees_earned_sol, 0);

  const openOrders = MY_ORDERS.filter((o) => o.status === "Open");
  const openSlips = MY_SLIPS.filter((s) => !s.claimed);

  const latestPnL = PNL_HISTORY[PNL_HISTORY.length - 1]?.cumulative_pnl || 0;

  return (
    <div className="min-h-screen bg-rich-black">
      {/* Header */}
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-12">
          <div className="mb-8">
            <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-2">Portfolio</p>
            <h1 className="text-heading md:text-display text-white font-medium">Your Activity</h1>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card">
              <p className="text-caption text-silver-text mb-2">Total P&L</p>
              <p className={`text-heading font-mono ${totalPnL >= 0 ? "text-cadmium-green" : "text-red-400"}`}>
                {totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)} SOL
              </p>
              <p className={`text-caption mt-1 font-mono ${totalPnLPct >= 0 ? "text-cadmium-green" : "text-red-400"}`}>
                {totalPnLPct >= 0 ? "+" : ""}{totalPnLPct.toFixed(1)}%
              </p>
            </div>

            <div className="card">
              <p className="text-caption text-silver-text mb-2">Deposited</p>
              <p className="text-heading font-mono text-white">
                {(totalInvested + totalLpDeposited).toFixed(2)} SOL
              </p>
              <p className="text-caption text-silver-text mt-1">Trading + LP</p>
            </div>

            <div className="card">
              <p className="text-caption text-silver-text mb-2">Open Positions</p>
              <p className="text-heading font-mono text-white">
                {MY_POSITIONS.filter((p) => p.market_status === "Open").length}
              </p>
              <p className="text-caption text-silver-text mt-1">{MY_POSITIONS.length} total</p>
            </div>

            <div className="card">
              <p className="text-caption text-silver-text mb-2">LP Liquidity</p>
              <p className="text-heading font-mono text-cadmium-green">
                {totalLpFeesEarned.toFixed(2)} SOL
              </p>
              <p className="text-caption text-silver-text mt-1">Fees earned</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* P&L Chart */}
          <div className="lg:col-span-2">
            <div className="card">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-subheading text-white font-medium">P&L Over Time</h2>
                <div className="flex items-center gap-2">
                  <span className="text-caption text-silver-text">Last 70 days</span>
                  <span className={`text-caption font-mono ${latestPnL >= 0 ? "text-cadmium-green" : "text-red-400"}`}>
                    {latestPnL >= 0 ? "+" : ""}{latestPnL.toFixed(2)} SOL
                  </span>
                </div>
              </div>
              <PnLChart data={PNL_HISTORY} />
            </div>
          </div>

          {/* Stats Sidebar */}
          <div className="space-y-4">
            {/* Slips */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-body font-medium text-white">Bet Slips</h3>
                {openSlips.length > 0 && (
                  <span className="text-caption font-mono text-cadmium-green">{openSlips.length} active</span>
                )}
              </div>
              {openSlips.length === 0 ? (
                <p className="text-caption text-silver-text">No active slips</p>
              ) : (
                <div className="space-y-2">
                  {openSlips.slice(0, 3).map((slip) => (
                    <div key={slip.slip_id} className="text-caption border-b border-graphite pb-2 last:border-0">
                      <p className="text-white font-medium">{slip.num_legs}-Leg Parlay</p>
                      <p className="text-silver-text">
                        Potential: ${(slip.potential_payout / 1_000_000).toFixed(2)}M
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Orders */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-body font-medium text-white">Limit Orders</h3>
                {openOrders.length > 0 && (
                  <span className="text-caption font-mono text-cadmium-green">{openOrders.length} open</span>
                )}
              </div>
              {openOrders.length === 0 ? (
                <p className="text-caption text-silver-text">No open orders</p>
              ) : (
                <div className="space-y-2">
                  {openOrders.slice(0, 3).map((order) => (
                    <div key={order.order_id} className="text-caption border-b border-graphite pb-2 last:border-0">
                      <p className="text-white font-medium">{order.side} {order.num_shares}</p>
                      <p className="text-silver-text">
                        @ {(order.price_per_share * 100).toFixed(1)}¢
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Positions Table */}
        <div className="mt-8">
          <h2 className="text-subheading text-white font-medium mb-4">Trading Positions</h2>
          {MY_POSITIONS.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-silver-text mb-4">No trading positions yet</p>
              <Link href="/markets" className="btn-primary text-caption">
                Browse Markets
              </Link>
            </div>
          ) : (
            <PositionsTable positions={MY_POSITIONS} />
          )}
        </div>

        {/* Liquidity Table */}
        <div className="mt-8">
          <h2 className="text-subheading text-white font-medium mb-4">LP Epochs</h2>
          {MY_LP_EPOCHS.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-silver-text mb-4">No liquidity positions yet</p>
              <Link href="/liquidity" className="btn-primary text-caption">
                Provide Liquidity
              </Link>
            </div>
          ) : (
            <LiquidityTable lpEpochs={MY_LP_EPOCHS} />
          )}
        </div>
      </div>
    </div>
  );
}

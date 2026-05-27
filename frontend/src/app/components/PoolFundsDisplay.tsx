"use client";

import type { MarketAccount } from "@/lib/types";
import { getMarketPrices } from "@/lib/mockData";

export function PoolFundsDisplay({ market }: { market: MarketAccount }) {
  const prices = getMarketPrices(market);
  const totalPool = market.exposure * 12;
  const yesPool = totalPool * prices[0];
  const noPool = totalPool * prices[1];

  return (
    <div className="card">
      <h3 className="text-body font-medium text-white mb-4">Pool Funds</h3>

      <div className="space-y-4">
        {/* Pool Distribution */}
        <div>
          <div className="flex items-center justify-between mb-2 text-caption">
            <span className="text-silver-text">YES Liquidity</span>
            <span className="text-cadmium-green font-mono">${(yesPool / 1_000_000).toFixed(2)}M</span>
          </div>
          <div className="w-full h-2 bg-graphite rounded-full overflow-hidden">
            <div
              className="h-full bg-cadmium-green transition-all"
              style={{ width: `${(prices[0] * 100)}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2 text-caption">
            <span className="text-silver-text">NO Liquidity</span>
            <span className="text-white font-mono">${(noPool / 1_000_000).toFixed(2)}M</span>
          </div>
          <div className="w-full h-2 bg-graphite rounded-full overflow-hidden">
            <div
              className="h-full bg-white/40 transition-all"
              style={{ width: `${(prices[1] * 100)}%` }}
            />
          </div>
        </div>

        {/* Summary */}
        <div className="pt-2 border-t border-graphite space-y-2">
          <div className="flex justify-between text-caption">
            <span className="text-silver-text">Total Pool</span>
            <span className="text-white font-mono">${(totalPool / 1_000_000).toFixed(2)}M</span>
          </div>
          <div className="flex justify-between text-caption">
            <span className="text-silver-text">Liquidity APY</span>
            <span className="text-cadmium-green font-mono">12.4%</span>
          </div>
          <div className="flex justify-between text-caption">
            <span className="text-silver-text">Fees Earned (24h)</span>
            <span className="text-cadmium-green font-mono">+$8,420</span>
          </div>
        </div>

        {/* Provide Liquidity Button */}
        <button className="w-full py-2 rounded-md bg-white/[0.06] border border-graphite text-white text-caption font-medium hover:bg-white/10 transition-colors">
          Provide Liquidity
        </button>
      </div>
    </div>
  );
}

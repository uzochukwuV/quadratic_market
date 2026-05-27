"use client";

import { useBetSlip } from "./BetSlipDrawer";

export function BetSlipPanel() {
  const { items, clear, totalStake, combinedOdds, potentialPayout } = useBetSlip();

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-body font-medium text-white">Bet Slip</h3>
        {items.length > 0 && (
          <button
            onClick={clear}
            className="text-caption text-silver-text hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-graphite flex items-center justify-center mb-3">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="text-silver-text">
              <path d="M3 5h14a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z" strokeWidth="1.2" />
              <path d="M7 8h6M7 11h4" strokeLinecap="round" strokeWidth="1.2" />
            </svg>
          </div>
          <p className="text-caption text-silver-text">No selections yet</p>
          <p className="text-caption text-silver-text/60 mt-1">Add markets to your slip</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Legs */}
          {items.map((item) => (
            <div key={item.market_id} className="p-3 bg-white/[0.03] border border-graphite rounded-md">
              <p className="text-caption text-silver-text uppercase mb-1">{item.outcome_label}</p>
              <p className="text-body text-white font-medium line-clamp-2 mb-2">
                {item.market_title}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-caption text-silver-text">Odds</span>
                <span className="text-body font-mono text-cadmium-green">
                  {(1 / item.implied_odds).toFixed(2)}x
                </span>
              </div>
            </div>
          ))}

          {/* Summary */}
          {items.length > 1 && (
            <div className="p-3 bg-cadmium-green/10 border border-cadmium-green/30 rounded-md">
              <p className="text-caption text-silver-text uppercase mb-1">
                {items.length}-Leg Parlay
              </p>
              <div className="flex items-center justify-between">
                <span className="text-caption text-silver-text">Combined</span>
                <span className="text-body font-mono text-cadmium-green">
                  {combinedOdds.toFixed(2)}x
                </span>
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="space-y-2 pt-2 border-t border-graphite">
            <div className="flex justify-between text-caption">
              <span className="text-silver-text">Total Stake</span>
              <span className="text-white font-mono">${totalStake.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-caption font-mono">
              <span className="text-silver-text">Potential Payout</span>
              <span className="text-cadmium-green font-bold">
                ${potentialPayout.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Place Slip Button */}
          <button className="w-full py-3 rounded-md bg-cadmium-green text-true-black font-mono font-medium text-caption hover:bg-cadmium-green/90 transition-colors disabled:opacity-50">
            Place Slip
          </button>

          <p className="text-caption text-silver-text text-center">
            House margin: 2.5%
          </p>
        </div>
      )}
    </div>
  );
}

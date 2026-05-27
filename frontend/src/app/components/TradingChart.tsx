"use client";

import type { MarketAccount } from "@/lib/types";

export function TradingChart({ market }: { market: MarketAccount }) {
  // Mock chart data
  const chartHeight = 200;
  const candles = Array.from({ length: 30 }, (_, i) => {
    const base = 0.5 + Math.sin(i / 5) * 0.15;
    return {
      open: base + Math.random() * 0.05,
      close: base + Math.random() * 0.05,
      high: base + 0.08,
      low: Math.max(0.1, base - 0.08),
    };
  });

  const maxPrice = Math.max(...candles.map((c) => c.high));
  const minPrice = Math.min(...candles.map((c) => c.low));
  const range = maxPrice - minPrice || 0.1;

  return (
    <div className="h-64 flex flex-col gap-4">
      {/* Chart area */}
      <div className="flex-1 flex items-end justify-between gap-1 pb-4 border-b border-graphite">
        {candles.map((candle, idx) => {
          const openH = ((candle.open - minPrice) / range) * chartHeight;
          const closeH = ((candle.close - minPrice) / range) * chartHeight;
          const highH = ((candle.high - minPrice) / range) * chartHeight;
          const lowH = ((candle.low - minPrice) / range) * chartHeight;
          const bodyH = Math.abs(closeH - openH);
          const isUp = candle.close >= candle.open;

          return (
            <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full">
              <div className="w-full flex flex-col items-center justify-end" style={{ height: `${chartHeight}px` }}>
                {/* Wick */}
                <div
                  className="w-px bg-graphite/50"
                  style={{ height: `${highH - lowH}px` }}
                />
                {/* Body */}
                <div
                  className={`w-full rounded-sm transition-colors ${
                    isUp ? "bg-cadmium-green/40" : "bg-red-400/40"
                  }`}
                  style={{
                    height: `${Math.max(2, bodyH)}px`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 text-caption">
        <div>
          <p className="text-silver-text mb-0.5">High</p>
          <p className="text-white font-mono">${(maxPrice * 100).toFixed(1)}</p>
        </div>
        <div>
          <p className="text-silver-text mb-0.5">Low</p>
          <p className="text-white font-mono">${(minPrice * 100).toFixed(1)}</p>
        </div>
        <div>
          <p className="text-silver-text mb-0.5">Volume</p>
          <p className="text-white font-mono">$2.4M</p>
        </div>
        <div>
          <p className="text-silver-text mb-0.5">24h Change</p>
          <p className="text-cadmium-green font-mono">+2.3%</p>
        </div>
      </div>
    </div>
  );
}

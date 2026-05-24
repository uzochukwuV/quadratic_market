"use client";

import { MARKETS, getMarketPrices } from "@/lib/mockData";

export function Ticker() {
  const items = MARKETS.filter((m) => m.status === "Open").map((m) => {
    const prices = getMarketPrices(m);
    return {
      label: m.title.slice(0, 40) + (m.title.length > 40 ? "…" : ""),
      price: `${(prices[0] * 100).toFixed(0)}¢`,
      mode: m.market_mode,
    };
  });

  const doubled = [...items, ...items];

  return (
    <div className="w-full overflow-hidden border-y border-white/[0.05] py-2.5 bg-black/50">
      <div className="ticker-inner inline-flex">
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-2 px-6 text-[12px]">
            <span className="text-white/25">·</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
              item.mode === "Trading"
                ? "text-[#a07bff] border-[#a07bff]/25"
                : "text-[#ffac2e] border-[#ffac2e]/25"
            }`}>{item.mode === "Trading" ? "AMM" : "Odds"}</span>
            <span className="text-white/70">{item.label}</span>
            <span className="text-[#a0e0ab] font-semibold">{item.price}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

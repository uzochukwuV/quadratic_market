import React from "react";
import { useMarkets, useLpStats, useGlobalConfig } from "@/lib/api";

function formatUsdc(uiAmount) {
  if (uiAmount == null) return "—";
  if (uiAmount >= 1e9) return `$${(uiAmount / 1e9).toFixed(2)}B`;
  if (uiAmount >= 1e6) return `$${(uiAmount / 1e6).toFixed(2)}M`;
  if (uiAmount >= 1e3) return `$${(uiAmount / 1e3).toFixed(1)}K`;
  return `$${uiAmount.toFixed(0)}`;
}

export default function StatsBar() {
  const { data: marketsData } = useMarkets();
  const { data: lpData } = useLpStats();
  const { data: gcData } = useGlobalConfig();

  const totalMarkets = marketsData?.total_markets ?? 0;
  const liveEvents = (marketsData?.markets || []).filter(
    (m) => m.status === "Open"
  ).length;
  const startingSoon = (marketsData?.markets || []).filter((m) => {
    if (typeof m.time_to_close !== "number") return false;
    return m.time_to_close > 0 && m.time_to_close < 60 * 60;
  }).length;

  // Highest decimal odds across all markets/outcomes
  let highestOdds = 0;
  for (const m of marketsData?.markets || []) {
    for (const odds of m.current_odds || []) {
      if (odds > highestOdds) highestOdds = odds;
    }
  }
  const highestOddsStr = highestOdds ? (highestOdds / 10000).toFixed(2) : "—";

  // TVL from LP stats
  const tvlUi = lpData?.total_tvl != null ? lpData.total_tvl / 1e6 : null;

  const stats = [
    { icon: "📊", label: "Total Markets", value: String(totalMarkets) },
    { icon: "🟢", label: "Open Markets", value: String(liveEvents) },
    { icon: "⏰", label: "Starting Soon (1h)", value: String(startingSoon) },
    { icon: "💰", label: "TVL", value: formatUsdc(tvlUi) },
    { icon: "📈", label: "Highest Odds", value: highestOddsStr },
    { icon: "🔢", label: "Epoch", value: gcData ? `#${gcData.current_epoch}` : "—" },
  ];

  return (
    <div className="bg-cloud-whisper border-b border-light-pearl px-6 lg:px-10 py-2 flex items-center gap-6 overflow-x-auto hide-scrollbar">
      {stats.map((stat, i) => (
        <React.Fragment key={stat.label}>
          {i > 0 && <span className="text-light-pearl hidden sm:block">|</span>}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-sm">{stat.icon}</span>
            <span className="font-inter text-[13px] text-dark-shale">
              {stat.label}:
            </span>
            <span className="font-inter text-[13px] font-semibold text-midnight">
              {stat.value}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
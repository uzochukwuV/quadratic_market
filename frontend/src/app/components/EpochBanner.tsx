"use client";

import { useState, useEffect, useMemo } from "react";
import { CURRENT_EPOCH } from "@/lib/mockData";

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Ended";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function EpochBanner() {
  const e = CURRENT_EPOCH;

  // Client-only clock — avoids hydration mismatch from Date.now() on server
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  const timeLeft    = now !== null ? e.end_time - now : null;
  const elapsed     = now !== null ? now - e.start_time : 0;
  const total       = e.end_time - e.start_time;
  const progressPct = now !== null ? Math.min(100, Math.round((elapsed / total) * 100)) : 0;
  const settledPct  = e.num_markets > 0 ? Math.round((e.num_settled_markets / e.num_markets) * 100) : 0;
  void settledPct;

  const statusColor = useMemo(() => {
    if (e.withdrawals_enabled)  return { dot: "bg-[#ffac2e]",                    text: "text-[#ffac2e]", label: "Withdrawals Open" };
    if (e.all_markets_settled)  return { dot: "bg-[#a0e0ab]",                    text: "text-[#a0e0ab]", label: "All Settled"       };
    if (timeLeft !== null && timeLeft < 2 * 86400)
                                return { dot: "bg-[#f47067] animate-pulse",       text: "text-[#f47067]", label: "Ending Soon"       };
    return                             { dot: "bg-[#a0e0ab] animate-pulse",       text: "text-[#a0e0ab]", label: "Active"            };
  }, [e, timeLeft]);

  return (
    <div className="w-full bg-[#0a0a0a] border-b border-white/[0.05]">
      <div className="max-w-[1078px] mx-auto px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-8">
        {/* Epoch ID + status */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${statusColor.dot}`} />
          <span className="text-[12px] text-whisper-gray">
            Epoch <span className="text-white font-semibold">#{e.epoch_id}</span>
          </span>
          <span className={`text-[11px] font-semibold ${statusColor.text}`}>{statusColor.label}</span>
        </div>

        {/* Progress bar */}
        <div className="flex-1 min-w-0 hidden sm:block">
          <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${progressPct}%`,
                background: "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46))",
              }}
            />
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-5 flex-shrink-0 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="text-whisper-gray">Markets</span>
            <span className="text-white font-semibold">{e.num_settled_markets}/{e.num_markets}</span>
            <span className="text-whisper-gray">settled</span>
          </div>
          <div className="w-px h-3 bg-white/[0.08]" />
          <div className="flex items-center gap-1.5">
            <span className="text-whisper-gray">Liquidity</span>
            <span className="text-white font-semibold">${(e.total_liquidity_added / 1e9).toFixed(1)}K</span>
          </div>
          <div className="w-px h-3 bg-white/[0.08]" />
          <div className="flex items-center gap-1.5">
            {/* Render placeholder on server, real countdown on client */}
            {now === null ? (
              <span className="text-whisper-gray">Loading…</span>
            ) : timeLeft !== null && timeLeft > 0 ? (
              <>
                <span className="text-whisper-gray">Ends in</span>
                <span className="text-white font-semibold font-mono">{formatCountdown(timeLeft)}</span>
              </>
            ) : (
              <span className="text-[#ffac2e] font-semibold">Epoch ended</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

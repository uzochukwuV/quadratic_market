"use client";

import Link from "next/link";
import type { UiMarketAccount } from "@/lib/contract";
import { getMarketPrices } from "@/lib/contract";
import { addToBetSlip } from "./BetSlipDrawer";

const CATEGORY_COLORS: Record<string, string> = {
  Sports:   "text-[#a0e0ab] border-[#a0e0ab]/30 bg-[#a0e0ab]/[0.08]",
  Crypto:   "text-[#a07bff] border-[#a07bff]/30 bg-[#a07bff]/[0.08]",
  Finance:  "text-[#5bc8fa] border-[#5bc8fa]/30 bg-[#5bc8fa]/[0.08]",
  Politics: "text-[#ffac2e] border-[#ffac2e]/30 bg-[#ffac2e]/[0.08]",
  Tech:     "text-[#f79aca] border-[#f79aca]/30 bg-[#f79aca]/[0.08]",
  Other:    "text-whisper-gray border-white/20 bg-white/[0.04]",
};

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  Open:           { label: "Live",            color: "text-[#a0e0ab] bg-[#a0e0ab]/[0.08] border-[#a0e0ab]/25" },
  Suspended:      { label: "Suspended",       color: "text-[#ffac2e] bg-[#ffac2e]/[0.08] border-[#ffac2e]/25" },
  AwaitingResult: { label: "Awaiting Result", color: "text-[#5bc8fa] bg-[#5bc8fa]/[0.08] border-[#5bc8fa]/25" },
  Proposed:       { label: "Result Proposed", color: "text-[#f79aca] bg-[#f79aca]/[0.08] border-[#f79aca]/25" },
  Settled:        { label: "Settled",         color: "text-whisper-gray bg-white/[0.04] border-white/10" },
  Voided:         { label: "Voided",          color: "text-[#f47067] bg-[#f47067]/[0.08] border-[#f47067]/25" },
};

function timeLabel(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff < 0) return "Ended";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  if (d > 30) return `${Math.floor(d / 30)}mo left`;
  if (d > 0) return `${d}d left`;
  if (h > 0) return `${h}h left`;
  return "< 1h left";
}

function formatVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

export function MarketCard({
  market,
  onSlipOpen,
}: {
  market: UiMarketAccount;
  onSlipOpen?: () => void;
}) {
  const prices = getMarketPrices(market);
  const yesPrice = prices[0];
  const noPrice = prices[1] ?? 1 - yesPrice;
  const cat = CATEGORY_COLORS[market.category] ?? CATEGORY_COLORS.Other;
  const statusBadge = STATUS_BADGE[market.status];
  const isFixedOdds = market.market_mode === "FixedOdds";
  const isTrading = market.market_mode === "Trading";
  const isTradable = market.status === "Open";

  const handleAddToSlip = (e: React.MouseEvent, outcomeId: number, outcomeLabel: string) => {
    e.preventDefault();
    e.stopPropagation();
    addToBetSlip({
      market_id: market.market_id,
      market_title: market.title,
      outcome_id: outcomeId,
      outcome_label: outcomeLabel,
      implied_odds: outcomeId === 0 ? yesPrice : noPrice,
      stake: 10,
    });
    onSlipOpen?.();
  };

  return (
    <div className="glass-card glass-card-hover rounded-card flex flex-col group">
      {/* Top bar */}
      <Link href={`/trade?market=${market.market_id}`} className="block p-5 pb-0 flex-1">
        {/* Tags row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-pill border ${cat}`}>
            {market.category}
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-pill border ${statusBadge.color}`}>
            {statusBadge.label}
          </span>
          {/* Mode badge */}
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-pill border ml-auto ${
            isFixedOdds
              ? "text-[#ffac2e] border-[#ffac2e]/25 bg-[#ffac2e]/[0.06]"
              : "text-[#a07bff] border-[#a07bff]/25 bg-[#a07bff]/[0.06]"
          }`}>
            {isFixedOdds ? "Fixed Odds" : "Trading"}
          </span>
        </div>

        {/* Epoch tag */}
        <div className="text-[10px] text-whisper-gray mb-2">
          Epoch #{market.epoch_id} · {timeLabel(market.settlement_time)}
        </div>

        {/* Title */}
        <h3 className="text-[15px] font-semibold text-white leading-snug mb-4 line-clamp-2 group-hover:text-white/90 transition-colors">
          {market.title}
        </h3>

        {/* Probability bar — only for Trading mode */}
        {isTrading && market.status !== "Voided" && (
          <div className="mb-4">
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-[#a0e0ab] font-semibold">YES {(yesPrice * 100).toFixed(0)}¢</span>
              <span className="text-[#f47067] font-semibold">NO {(noPrice * 100).toFixed(0)}¢</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(yesPrice * 100).toFixed(0)}%`,
                  background: "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46))",
                }}
              />
            </div>
          </div>
        )}

        {/* FixedOdds — show decimal odds */}
        {isFixedOdds && market.status !== "Voided" && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {["YES", "NO"].map((label, idx) => (
              <div key={label} className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
                <p className="text-[10px] text-whisper-gray mb-0.5">{label}</p>
                <p className="text-[16px] font-bold text-white">
                  {(1 / (idx === 0 ? yesPrice : noPrice)).toFixed(2)}
                  <span className="text-[10px] text-whisper-gray ml-0.5">x</span>
                </p>
                <p className="text-[10px] text-whisper-gray">{((idx === 0 ? yesPrice : noPrice) * 100).toFixed(0)}¢</p>
              </div>
            ))}
          </div>
        )}

        {/* Settled outcome */}
        {market.status === "Settled" && (
          <div className={`mb-4 py-2 px-3 rounded-lg text-center text-[13px] font-semibold ${
            market.winning_outcome === 0
              ? "bg-[#a0e0ab]/10 text-[#a0e0ab] border border-[#a0e0ab]/20"
              : "bg-[#f47067]/10 text-[#f47067] border border-[#f47067]/20"
          }`}>
            Outcome: {market.winning_outcome === 0 ? "YES" : "NO"} ✓
          </div>
        )}
      </Link>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.04] flex items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] text-whisper-gray">Volume</p>
            <p className="text-[12px] font-semibold text-white">{formatVol(market.exposure * 12)}</p>
          </div>
        </div>

        {/* Action buttons */}
        {isTradable && (
          <div className="flex gap-1.5">
            {isFixedOdds ? (
              <>
                <button
                  onClick={(e) => handleAddToSlip(e, 0, "YES")}
                  className="px-3 py-1.5 rounded-pill text-[12px] font-semibold bg-[#a0e0ab]/15 text-[#a0e0ab] border border-[#a0e0ab]/30 hover:bg-[#a0e0ab]/25 transition-all"
                >
                  + YES
                </button>
                <button
                  onClick={(e) => handleAddToSlip(e, 1, "NO")}
                  className="px-3 py-1.5 rounded-pill text-[12px] font-semibold bg-[#f47067]/15 text-[#f47067] border border-[#f47067]/30 hover:bg-[#f47067]/25 transition-all"
                >
                  + NO
                </button>
              </>
            ) : (
              <Link
                href={`/trade?market=${market.market_id}`}
                className="px-4 py-1.5 rounded-pill text-[12px] font-semibold bg-white/[0.08] text-white border border-white/15 hover:bg-white/15 transition-all"
              >
                Trade →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

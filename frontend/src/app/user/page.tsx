"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  MY_POSITIONS, MY_SLIPS, MY_ORDERS, MY_LP_EPOCHS,
  SLIP_AUCTIONS, PNL_HISTORY,
} from "@/lib/mockData";
import type {
  MyPosition, BetSlipAccount, LimitOrderAccount,
  LPEpochPosition, P2PAuction,
} from "@/lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const WALLET = "ALk6…Qyep";
const SOL_BALANCE = 4.218;
const COLLATERAL_LOCKED = 1.63;

function fmtSOL(n: number) { return `${n.toFixed(3)} SOL`; }
function fmtUSD(n: number) { return `$${n.toFixed(2)}`; }
function timeLeft(ts: number) {
  const d = ts - Math.floor(Date.now() / 1000);
  if (d <= 0) return "Expired";
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  if (d > 86400) return `${Math.floor(d / 86400)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function shortDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

// ─── SVG Sparkline ────────────────────────────────────────────────────────────
function Sparkline({ data, width = 280, height = 72, color = "#a0e0ab" }: {
  data: { ts: number; cumulative_pnl: number }[];
  width?: number; height?: number; color?: string;
}) {
  const points = useMemo(() => {
    const minY = Math.min(...data.map(d => d.cumulative_pnl));
    const maxY = Math.max(...data.map(d => d.cumulative_pnl));
    const minX = data[0].ts;
    const maxX = data[data.length - 1].ts;
    const rangeY = maxY - minY || 1;
    const rangeX = maxX - minX || 1;
    const pad = 4;
    return data.map(d => ({
      x: pad + ((d.ts - minX) / rangeX) * (width - pad * 2),
      y: (height - pad) - ((d.cumulative_pnl - minY) / rangeY) * (height - pad * 2),
    }));
  }, [data, width, height]);

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const area = [
    `M ${points[0].x},${height}`,
    ...points.map(p => `L ${p.x},${p.y}`),
    `L ${points[points.length - 1].x},${height}`,
    "Z",
  ].join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkGrad)" />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} />
    </svg>
  );
}

// ─── Donut ring ───────────────────────────────────────────────────────────────
function DonutRing({ pct, color, size = 64 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
    </svg>
  );
}

// ─── P2P Auction Modal ────────────────────────────────────────────────────────
function AuctionModal({ slip, existing, onClose }: {
  slip: BetSlipAccount;
  existing: P2PAuction | null;
  onClose: () => void;
}) {
  const [minBid, setMinBid] = useState("0.08");
  const [buyNow, setBuyNow] = useState("0.20");
  const [duration, setDuration] = useState<"1h" | "6h" | "24h">("6h");
  const [listed, setListed] = useState(!!existing);
  const stakeSOL = (slip.total_stake / 1e9).toFixed(4);
  const payoutSOL = (slip.potential_payout / 1e9).toFixed(4);
  const odds = (slip.combined_odds_fp / 2 ** 32).toFixed(2);
  const auction = existing;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-[540px] glass-card rounded-[16px] border border-white/[0.12] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
          <div>
            <h3 className="text-[16px] font-semibold text-white">P2P Slip Auction</h3>
            <p className="text-[12px] text-whisper-gray">Slip #{slip.slip_id} · {slip.num_legs}-leg</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-whisper-gray hover:text-white transition-all">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Slip summary */}
          <div className="p-4 rounded-card bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-whisper-gray">Combined odds</span>
              <span className="text-[18px] font-bold text-white">{odds}x</span>
            </div>
            <div className="space-y-2">
              {slip.legs.slice(0, slip.num_legs).map((leg, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${leg.outcome_id === 0 ? "bg-[#a0e0ab]/15 text-[#a0e0ab]" : "bg-[#f47067]/15 text-[#f47067]"}`}>
                    {leg.outcome_label}
                  </span>
                  <span className="text-white/80 flex-1 line-clamp-1">{leg.market_title}</span>
                  <span className="text-whisper-gray flex-shrink-0">{(1/(leg.price??0.5)).toFixed(2)}x</span>
                </div>
              ))}
            </div>
            <div className="flex gap-6 mt-3 pt-3 border-t border-white/[0.06] text-[12px]">
              <div><span className="text-whisper-gray">Stake</span><span className="text-white font-semibold ml-2">{stakeSOL} SOL</span></div>
              <div><span className="text-whisper-gray">Potential</span><span className="text-[#a0e0ab] font-semibold ml-2">{payoutSOL} SOL</span></div>
            </div>
          </div>

          {listed && auction ? (
            /* ── Active auction view ── */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white">Live Auction</span>
                <span className="px-2 py-1 rounded-pill bg-[#a0e0ab]/10 border border-[#a0e0ab]/25 text-[#a0e0ab] text-[11px] font-semibold animate-pulse">
                  ● Active — {timeLeft(auction.ends_at)} left
                </span>
              </div>

              {/* Current bid banner */}
              <div className="p-4 rounded-card bg-gradient-to-r from-[#a07bff]/10 to-[#5bc8fa]/10 border border-[#a07bff]/20">
                <p className="text-[11px] text-whisper-gray mb-1">Current highest bid</p>
                <p className="text-[28px] font-bold text-white">
                  {auction.current_bid_sol ? fmtSOL(auction.current_bid_sol) : "No bids yet"}
                </p>
                {auction.current_bidder_short && (
                  <p className="text-[12px] text-whisper-gray mt-1">by {auction.current_bidder_short}</p>
                )}
                {auction.buy_now_sol && (
                  <p className="text-[11px] text-[#ffac2e] mt-2">Buy Now: {fmtSOL(auction.buy_now_sol)}</p>
                )}
              </div>

              {/* Bid history */}
              <div>
                <p className="text-[12px] font-semibold text-white mb-2">Bid history ({auction.bids.length})</p>
                <div className="space-y-2">
                  {auction.bids.map((bid, i) => (
                    <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${i === 0 ? "border-[#a07bff]/30 bg-[#a07bff]/[0.06]" : "border-white/[0.05] bg-white/[0.02]"}`}>
                      <div className="flex items-center gap-2">
                        {i === 0 && <span className="text-[9px] font-bold text-[#a07bff] px-1 py-0.5 rounded bg-[#a07bff]/15">TOP</span>}
                        <span className="font-mono text-[12px] text-whisper-gray">{bid.bidder_short}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold text-white">{fmtSOL(bid.amount_sol)}</p>
                        <p className="text-[10px] text-whisper-gray">{timeLeft(bid.placed_at)} ago</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setListed(false)}
                  className="flex-1 py-2.5 rounded-pill border border-[#f47067]/30 text-[#f47067] text-[13px] hover:bg-[#f47067]/10 transition-all"
                >
                  Cancel Auction
                </button>
                <button className="flex-1 py-2.5 rounded-pill bg-[#a07bff] text-white text-[13px] font-semibold hover:bg-[#9068e8] transition-all">
                  Accept Top Bid · {fmtSOL(auction.current_bid_sol ?? 0)}
                </button>
              </div>
            </div>
          ) : (
            /* ── Create auction form ── */
            <div className="space-y-4">
              <p className="text-[13px] text-whisper-gray">
                List this slip for other traders to bid on. When the auction ends, the highest bidder receives your slip and you receive the SOL.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-whisper-gray mb-1.5 block">Minimum bid (SOL)</label>
                  <input
                    type="number" step="0.01" value={minBid}
                    onChange={e => setMinBid(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[14px] focus:outline-none focus:border-white/20"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-whisper-gray mb-1.5 block">Buy Now price (SOL)</label>
                  <input
                    type="number" step="0.01" value={buyNow}
                    onChange={e => setBuyNow(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[14px] focus:outline-none focus:border-white/20"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-whisper-gray mb-1.5 block">Auction duration</label>
                <div className="flex gap-2">
                  {(["1h", "6h", "24h"] as const).map(d => (
                    <button key={d} onClick={() => setDuration(d)}
                      className={`flex-1 py-2 rounded-pill text-[13px] font-semibold border transition-all ${duration === d ? "bg-white text-black border-white" : "border-white/[0.1] text-whisper-gray hover:text-white"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05] text-[12px] space-y-1.5">
                <div className="flex justify-between"><span className="text-whisper-gray">Starting price</span><span className="text-white">{minBid} SOL</span></div>
                <div className="flex justify-between"><span className="text-whisper-gray">Buy Now</span><span className="text-[#ffac2e]">{buyNow} SOL</span></div>
                <div className="flex justify-between"><span className="text-whisper-gray">Duration</span><span className="text-white">{duration}</span></div>
                <div className="flex justify-between border-t border-white/[0.06] pt-1.5 mt-1.5"><span className="text-whisper-gray">Protocol fee (2%)</span><span className="text-white">~{(parseFloat(minBid) * 0.02).toFixed(4)} SOL</span></div>
              </div>

              <button
                onClick={() => setListed(true)}
                className="w-full py-3.5 rounded-pill bg-[#a07bff] text-white text-[14px] font-semibold hover:bg-[#9068e8] transition-all hover:scale-[1.01]"
              >
                List Slip for Auction
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Positions ──────────────────────────────────────────────────────────
function PositionsTab() {
  const [selling, setSelling] = useState<number | null>(null);
  const [sellShares, setSellShares] = useState("");
  const [sellMode, setSellMode] = useState<"amm" | "limit">("amm");
  const [limitPrice, setLimitPrice] = useState("0.72");

  const open = MY_POSITIONS.filter(p => p.market_status === "Open" || p.market_status === "Suspended");
  const closed = MY_POSITIONS.filter(p => p.market_status === "Settled");

  const PositionRow = ({ p }: { p: MyPosition }) => {
    const expanded = selling === p.market_id;
    const pnlColor = p.pnl >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]";
    const canSell = p.market_status === "Open";
    return (
      <div className="border-b border-white/[0.05] last:border-0">
        <div className="flex items-center gap-3 py-4 px-5">
          <div className={`flex-shrink-0 w-10 h-7 rounded-pill flex items-center justify-center text-[10px] font-bold border ${p.outcome_id === 0 ? "text-[#a0e0ab] border-[#a0e0ab]/30 bg-[#a0e0ab]/[0.08]" : "text-[#f47067] border-[#f47067]/30 bg-[#f47067]/[0.08]"}`}>
            {p.outcome_label}
          </div>
          <div className="flex-1 min-w-0">
            <Link href={`/trade?market=${p.market_id}`} className="text-[13px] font-semibold text-white hover:text-white/80 line-clamp-1">{p.market_title}</Link>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-whisper-gray">
              <span>{p.category}</span><span className="opacity-30">·</span>
              <span>Epoch #{p.epoch_id}</span>
            </div>
          </div>
          <div className="hidden sm:block text-right w-16"><p className="text-[10px] text-whisper-gray">Shares</p><p className="text-[13px] font-semibold text-white">{p.shares.toLocaleString()}</p></div>
          <div className="hidden md:block text-right w-16"><p className="text-[10px] text-whisper-gray">Avg</p><p className="text-[13px] text-white">{(p.avg_price*100).toFixed(0)}¢</p></div>
          <div className="hidden md:block text-right w-16"><p className="text-[10px] text-whisper-gray">Now</p><p className="text-[13px] text-white">{p.market_status === "Settled" ? (p.outcome_id === 0 ? "100¢" : "0¢") : `${(p.current_price*100).toFixed(0)}¢`}</p></div>
          <div className="text-right w-20"><p className="text-[10px] text-whisper-gray">Value</p><p className="text-[13px] font-semibold text-white">{fmtUSD(p.value)}</p></div>
          <div className="text-right w-24">
            <p className={`text-[14px] font-bold ${pnlColor}`}>{p.pnl >= 0 ? "+" : ""}{fmtUSD(p.pnl)}</p>
            <p className={`text-[10px] ${pnlColor}`}>{p.pnl_pct >= 0 ? "+" : ""}{p.pnl_pct.toFixed(1)}%</p>
          </div>
          <div className="w-20 text-right">
            {canSell && (
              <button onClick={() => { setSelling(expanded ? null : p.market_id); setSellShares(String(p.shares)); }}
                className={`px-3 py-1.5 rounded-pill text-[11px] font-semibold border transition-all ${expanded ? "bg-[#f47067] text-white border-[#f47067]" : "border-[#f47067]/40 text-[#f47067] hover:bg-[#f47067]/15"}`}>
                {expanded ? "✕" : "Sell"}
              </button>
            )}
            {p.market_status === "Settled" && (
              <button className={`px-3 py-1.5 rounded-pill text-[11px] font-semibold border transition-all ${p.pnl > 0 ? "border-[#a0e0ab]/40 text-[#a0e0ab] hover:bg-[#a0e0ab]/15" : "border-white/10 text-whisper-gray opacity-40 cursor-not-allowed"}`}>
                {p.pnl > 0 ? "Claim" : "Lost"}
              </button>
            )}
          </div>
        </div>
        {expanded && (
          <div className="mx-5 mb-4 p-4 rounded-card bg-[#0d0d0d] border border-white/[0.08] space-y-3">
            <div className="flex gap-1 rounded-card overflow-hidden border border-white/[0.07]">
              {(["amm","limit"] as const).map(m => (
                <button key={m} onClick={() => setSellMode(m)}
                  className={`flex-1 py-2 text-[12px] font-semibold transition-all ${sellMode === m ? "bg-white text-black" : "text-whisper-gray hover:text-white"}`}>
                  {m === "amm" ? "⚡ Sell Now" : "📋 List Order"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-whisper-gray mb-1 block">Shares (max {p.shares})</label>
                <input type="number" value={sellShares} onChange={e => setSellShares(e.target.value)}
                  className="w-full px-3 py-2 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[13px] focus:outline-none focus:border-white/20" />
                <div className="flex gap-1 mt-1">
                  {[25,50,100].map(pct => (
                    <button key={pct} onClick={() => setSellShares(String(Math.floor(p.shares*pct/100)))}
                      className="flex-1 py-0.5 rounded text-[10px] border border-white/[0.06] text-whisper-gray hover:text-white transition-colors">{pct}%</button>
                  ))}
                </div>
              </div>
              {sellMode === "limit" && (
                <div>
                  <label className="text-[10px] text-whisper-gray mb-1 block">Limit price (¢)</label>
                  <input type="number" value={Math.round(parseFloat(limitPrice)*100)} onChange={e => setLimitPrice(String(parseInt(e.target.value)/100))}
                    className="w-full px-3 py-2 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[13px] focus:outline-none focus:border-white/20" />
                  <p className="text-[10px] text-whisper-gray mt-1">AMM now: {(p.current_price*100).toFixed(0)}¢</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelling(null)} className="flex-1 py-2.5 rounded-pill border border-white/[0.10] text-whisper-gray text-[12px] hover:text-white transition-all">Cancel</button>
              <button className={`flex-1 py-2.5 rounded-pill text-[13px] font-semibold transition-all ${sellMode === "amm" ? "bg-[#f47067] text-white" : "bg-[#5bc8fa] text-black"}`}>
                {sellMode === "amm"
                  ? `Sell · +${fmtUSD((parseFloat(sellShares)||0)*p.current_price)}`
                  : `List @ ${Math.round(parseFloat(limitPrice)*100)}¢`}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {open.length > 0 && (
        <div className="glass-card rounded-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
            <h3 className="text-[14px] font-semibold text-white">Open Positions</h3>
            <span className="text-[11px] text-whisper-gray">{open.length} markets</span>
          </div>
          <div className="hidden sm:flex items-center gap-3 px-5 py-2 border-b border-white/[0.04] text-[10px] text-whisper-gray uppercase tracking-wide">
            <div className="w-10" /><div className="flex-1">Market</div>
            <div className="hidden sm:block w-16 text-right">Shares</div>
            <div className="hidden md:block w-16 text-right">Avg</div>
            <div className="hidden md:block w-16 text-right">Now</div>
            <div className="w-20 text-right">Value</div>
            <div className="w-24 text-right">P&L</div>
            <div className="w-20 text-right">Action</div>
          </div>
          {open.map(p => <PositionRow key={`${p.market_id}-${p.outcome_id}`} p={p} />)}
        </div>
      )}
      {closed.length > 0 && (
        <div className="glass-card rounded-card overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06]">
            <h3 className="text-[14px] font-semibold text-white">Settled Positions</h3>
          </div>
          {closed.map(p => <PositionRow key={`${p.market_id}-${p.outcome_id}`} p={p} />)}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Bet Slips + P2P ────────────────────────────────────────────────────
function SlipsTab() {
  const [auctionSlip, setAuctionSlip] = useState<BetSlipAccount | null>(null);

  return (
    <>
      {auctionSlip && (
        <AuctionModal
          slip={auctionSlip}
          existing={SLIP_AUCTIONS.find(a => a.slip_id === auctionSlip.slip_id) ?? null}
          onClose={() => setAuctionSlip(null)}
        />
      )}
      <div className="space-y-4">
        {/* Active auctions notice */}
        {SLIP_AUCTIONS.filter(a => a.status === "Active").length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-[#a07bff]/[0.08] border border-[#a07bff]/25">
            <span className="text-[#a07bff] text-[18px]">⚡</span>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-white">{SLIP_AUCTIONS.filter(a => a.status === "Active").length} slip auction active</p>
              <p className="text-[11px] text-whisper-gray">Your slips are listed — highest bid wins when the timer ends.</p>
            </div>
          </div>
        )}

        {MY_SLIPS.map(slip => {
          const odds = slip.combined_odds_fp / 2 ** 32;
          const payoutSOL = slip.potential_payout / 1e9;
          const stakeSOL = slip.total_stake / 1e9;
          const hasAuction = SLIP_AUCTIONS.some(a => a.slip_id === slip.slip_id && a.status === "Active");
          const auction = SLIP_AUCTIONS.find(a => a.slip_id === slip.slip_id);

          return (
            <div key={slip.slip_id} className="glass-card rounded-card overflow-hidden">
              {/* Header row */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-card bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-[18px] font-bold text-white">
                    {slip.num_legs}
                  </div>
                  <div>
                    <p className="text-[11px] text-whisper-gray">Slip #{slip.slip_id} · {slip.num_legs}-leg parlay</p>
                    <p className="text-[16px] font-bold text-white">{odds.toFixed(2)}x</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-whisper-gray">Potential payout</p>
                  <p className="text-[18px] font-bold text-[#a0e0ab]">{payoutSOL.toFixed(4)} SOL</p>
                  <p className="text-[11px] text-whisper-gray">Stake: {stakeSOL.toFixed(4)} SOL</p>
                </div>
              </div>

              {/* Legs */}
              <div className="px-5 py-3 space-y-2">
                {slip.legs.slice(0, slip.num_legs).map((leg, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <span className={`w-8 h-6 rounded text-[10px] font-bold flex items-center justify-center ${leg.outcome_id === 0 ? "bg-[#a0e0ab]/15 text-[#a0e0ab]" : "bg-[#f47067]/15 text-[#f47067]"}`}>
                      {leg.outcome_label}
                    </span>
                    <p className="text-[12px] text-white flex-1 line-clamp-1">{leg.market_title}</p>
                    <span className="text-[12px] font-semibold text-white">{(1/(leg.price??0.5)).toFixed(2)}x</span>
                  </div>
                ))}
              </div>

              {/* Auction status */}
              {hasAuction && auction && (
                <div className="mx-5 mb-3 p-3 rounded-card bg-[#a07bff]/[0.08] border border-[#a07bff]/20 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-[#a07bff] font-semibold">⚡ Auction live</p>
                    <p className="text-[12px] text-white">Current bid: {auction.current_bid_sol ? fmtSOL(auction.current_bid_sol) : "—"}</p>
                  </div>
                  <p className="text-[12px] text-whisper-gray">{timeLeft(auction.ends_at)} left</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 px-5 pb-4">
                <button className="flex-1 py-2.5 rounded-pill border border-[#ffac2e]/35 text-[#ffac2e] text-[12px] font-semibold hover:bg-[#ffac2e]/10 transition-all">
                  Cash Out · ~{(stakeSOL * 1.8).toFixed(4)} SOL
                </button>
                <button
                  onClick={() => setAuctionSlip(slip)}
                  className={`flex-1 py-2.5 rounded-pill text-[12px] font-semibold transition-all ${hasAuction ? "bg-[#a07bff]/20 text-[#a07bff] border border-[#a07bff]/30 hover:bg-[#a07bff]/30" : "bg-white/[0.06] text-white border border-white/[0.12] hover:bg-white/[0.12]"}`}>
                  {hasAuction ? "⚡ View Auction" : "List P2P Auction"}
                </button>
                <button className="flex-1 py-2.5 rounded-pill bg-[#a0e0ab] text-black text-[12px] font-semibold hover:bg-[#8dd4a0] transition-all">
                  Claim
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Tab: Orders ──────────────────────────────────────────────────────────────
function OrdersTab() {
  return (
    <div className="glass-card rounded-card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-white">My Limit Orders</h3>
        <span className="text-[11px] text-whisper-gray">{MY_ORDERS.length} orders</span>
      </div>
      {MY_ORDERS.map(order => {
        const filled = order.num_shares > 0 ? (order.filled_shares / order.num_shares) * 100 : 0;
        const remaining = order.num_shares - order.filled_shares;
        return (
          <div key={order.order_id} className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.04] last:border-0">
            <div className={`w-10 h-7 rounded-pill flex items-center justify-center text-[10px] font-bold border ${order.side === "Sell" ? "text-[#f47067] border-[#f47067]/30 bg-[#f47067]/[0.08]" : "text-[#a0e0ab] border-[#a0e0ab]/30 bg-[#a0e0ab]/[0.08]"}`}>
              {order.side}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white">Market #{order.market_id} · {order.outcome_id === 0 ? "YES" : "NO"}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[11px] text-whisper-gray">{order.filled_shares}/{order.num_shares} filled</p>
                <div className="flex-1 max-w-[80px] h-1 rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-[#a0e0ab]" style={{ width: `${filled}%` }} />
                </div>
                <p className="text-[11px] text-whisper-gray">{filled.toFixed(0)}%</p>
              </div>
            </div>
            <div className="text-right hidden sm:block w-16"><p className="text-[10px] text-whisper-gray">Price</p><p className="text-[13px] font-semibold text-white">{(order.price_per_share*100).toFixed(0)}¢</p></div>
            <div className="text-right hidden md:block w-20"><p className="text-[10px] text-whisper-gray">Remaining</p><p className="text-[13px] font-semibold text-white">{remaining.toLocaleString()}</p></div>
            <div className="text-right">
              <p className={`text-[11px] font-semibold mb-1 ${order.status === "Open" ? "text-[#a0e0ab]" : order.status === "PartiallyFilled" ? "text-[#ffac2e]" : "text-whisper-gray"}`}>{order.status}</p>
              <button className="px-3 py-1 rounded-pill border border-[#f47067]/30 text-[#f47067] text-[10px] hover:bg-[#f47067]/10 transition-colors">Cancel</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: LP Analytics ────────────────────────────────────────────────────────
function LPTab() {
  const totalDeposited = MY_LP_EPOCHS.reduce((s, e) => s + e.deposited_sol, 0);
  const totalFees = MY_LP_EPOCHS.reduce((s, e) => s + e.fees_earned_sol, 0);
  const totalPnl = MY_LP_EPOCHS.reduce((s, e) => s + e.pnl_sol, 0);
  const activeEpoch = MY_LP_EPOCHS.find(e => e.status === "Active");

  const STATUS_STYLE: Record<LPEpochPosition["status"], string> = {
    Active: "text-[#a0e0ab] bg-[#a0e0ab]/[0.08] border-[#a0e0ab]/25",
    Settled: "text-[#5bc8fa] bg-[#5bc8fa]/[0.08] border-[#5bc8fa]/25",
    PendingWithdraw: "text-[#ffac2e] bg-[#ffac2e]/[0.08] border-[#ffac2e]/25",
    Withdrawn: "text-whisper-gray bg-white/[0.04] border-white/10",
  };

  return (
    <div className="space-y-5">
      {/* LP summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Deposited", value: `${totalDeposited.toFixed(2)} SOL`, accent: "text-white" },
          { label: "Total Fees Earned", value: `${totalFees.toFixed(3)} SOL`, accent: "text-[#a0e0ab]" },
          { label: "Net LP P&L", value: `+${totalPnl.toFixed(3)} SOL`, accent: "text-[#a0e0ab]" },
          { label: "Active Epoch", value: activeEpoch ? `Epoch #${activeEpoch.epoch_id}` : "—", accent: "text-[#5bc8fa]" },
        ].map(s => (
          <div key={s.label} className="glass-card rounded-card p-4">
            <p className="text-[10px] text-whisper-gray uppercase tracking-wide mb-1.5">{s.label}</p>
            <p className={`text-[18px] font-bold ${s.accent}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Per-epoch table */}
      <div className="glass-card rounded-card overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06]">
          <h3 className="text-[14px] font-semibold text-white">LP History — Per Epoch</h3>
        </div>

        {/* Table header */}
        <div className="hidden sm:flex items-center gap-3 px-5 py-2 border-b border-white/[0.04] text-[10px] text-whisper-gray uppercase tracking-wide">
          <div className="w-16">Epoch</div>
          <div className="flex-1">Entry / Exit</div>
          <div className="w-24 text-right">Deposited</div>
          <div className="w-24 text-right">Value</div>
          <div className="w-24 text-right">Fees</div>
          <div className="w-24 text-right">P&L</div>
          <div className="w-16 text-right">APY</div>
          <div className="w-24 text-right">Status</div>
        </div>

        {MY_LP_EPOCHS.map(ep => (
          <div key={ep.epoch_id} className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04] last:border-0">
            <div className="w-16">
              <p className="text-[13px] font-bold text-white">#{ep.epoch_id}</p>
            </div>
            <div className="flex-1">
              <p className="text-[11px] text-whisper-gray">{shortDate(ep.entry_date)} → {ep.exit_date ? shortDate(ep.exit_date) : "Now"}</p>
              {/* APY progress bar */}
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 max-w-[100px] h-1 rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(ep.apy / 25 * 100, 100)}%`, background: "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46))" }} />
                </div>
              </div>
            </div>
            <div className="w-24 text-right hidden sm:block">
              <p className="text-[13px] font-semibold text-white">{ep.deposited_sol.toFixed(2)} SOL</p>
            </div>
            <div className="w-24 text-right hidden sm:block">
              <p className="text-[13px] font-semibold text-white">{ep.current_value_sol.toFixed(2)} SOL</p>
            </div>
            <div className="w-24 text-right hidden sm:block">
              <p className="text-[13px] text-[#a0e0ab] font-semibold">+{ep.fees_earned_sol.toFixed(3)} SOL</p>
            </div>
            <div className="w-24 text-right">
              <p className={`text-[14px] font-bold ${ep.pnl_sol >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]"}`}>
                {ep.pnl_sol >= 0 ? "+" : ""}{ep.pnl_sol.toFixed(3)} SOL
              </p>
              <p className={`text-[10px] ${ep.pnl_sol >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]"}`}>+{ep.pnl_pct.toFixed(1)}%</p>
            </div>
            <div className="w-16 text-right hidden sm:block">
              <p className="text-[13px] font-semibold text-[#ffac2e]">{ep.apy.toFixed(1)}%</p>
            </div>
            <div className="w-24 text-right">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-pill border ${STATUS_STYLE[ep.status]}`}>
                {ep.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Epoch APY comparison */}
      <div className="glass-card rounded-card p-5">
        <h3 className="text-[14px] font-semibold text-white mb-4">APY by Epoch</h3>
        <div className="space-y-3">
          {MY_LP_EPOCHS.map(ep => (
            <div key={ep.epoch_id} className="flex items-center gap-4">
              <span className="text-[12px] text-whisper-gray w-16">Epoch #{ep.epoch_id}</span>
              <div className="flex-1 h-6 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full flex items-center pl-3 text-[11px] font-semibold text-black"
                  style={{
                    width: `${Math.min(ep.apy / 25 * 100, 100)}%`,
                    background: ep.status === "Active"
                      ? "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46))"
                      : "rgba(255,255,255,0.25)",
                    color: ep.status === "Active" ? "#000" : "#fff",
                  }}
                >
                  {ep.apy.toFixed(1)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Tab = "positions" | "slips" | "orders" | "lp";

export default function UserPage() {
  const [tab, setTab] = useState<Tab>("positions");

  // Derived stats
  const openPositions = MY_POSITIONS.filter(p => p.market_status === "Open");
  const settledPositions = MY_POSITIONS.filter(p => p.market_status === "Settled");
  const unrealizedPnl = openPositions.reduce((s, p) => s + p.pnl, 0);
  const realizedPnl = settledPositions.reduce((s, p) => s + p.pnl, 0);
  const totalPortfolioValue = openPositions.reduce((s, p) => s + p.value, 0);
  const totalLpPnl = MY_LP_EPOCHS.reduce((s, e) => s + e.pnl_sol, 0);

  // Win rate
  const winCount = settledPositions.filter(p => p.pnl > 0).length;
  const winRate = settledPositions.length > 0 ? (winCount / settledPositions.length) * 100 : 0;

  // Best / worst trade
  const bestTrade = MY_POSITIONS.reduce((best, p) => p.pnl > best.pnl ? p : best, MY_POSITIONS[0]);
  const worstTrade = MY_POSITIONS.reduce((worst, p) => p.pnl < worst.pnl ? p : worst, MY_POSITIONS[0]);

  return (
    <div className="min-h-screen">
      {/* ── Header with prominent wallet connect ─────────────── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.08]"
          style={{ background: "linear-gradient(135deg, rgb(160,224,171), rgb(255,172,46) 50%, rgb(165,45,37))" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
        {/* Orbs */}
        <div className="orb w-[400px] h-[400px] -top-32 -right-20 opacity-20" style={{ background: "rgb(160,100,255)" }} />

        <div className="relative max-w-[1078px] mx-auto px-6 py-10">
          {/* Breadcrumb */}
          <p className="text-[11px] text-whisper-gray uppercase tracking-widest mb-4">My Account</p>

          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            {/* Left: identity */}
            <div>
              <h1 className="text-[42px] font-semibold text-white leading-tight mb-2">Account</h1>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-[13px] text-whisper-gray bg-white/[0.04] px-3 py-1 rounded-pill border border-white/[0.08]">
                  {WALLET}
                </span>
                <span className={`text-[13px] font-semibold ${unrealizedPnl >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]"}`}>
                  {unrealizedPnl >= 0 ? "+" : ""}{fmtUSD(unrealizedPnl)} unrealised
                </span>
              </div>
            </div>

            {/* Right: wallet button — always visible, prominent */}
            <div className="flex flex-col items-start md:items-end gap-2">
              <WalletMultiButton />
              <p className="text-[11px] text-whisper-gray">Balance: {fmtSOL(SOL_BALANCE)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1078px] mx-auto px-6 pb-16">
        {/* ── Fund Summary ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "SOL Balance",      value: fmtSOL(SOL_BALANCE),              sub: "Available",              color: "text-white" },
            { label: "Collateral Locked",value: fmtSOL(COLLATERAL_LOCKED),        sub: "In markets / slips",     color: "text-[#ffac2e]" },
            { label: "Unrealised P&L",   value: `${unrealizedPnl >= 0 ? "+" : ""}${fmtUSD(unrealizedPnl)}`, sub: "Open positions", color: unrealizedPnl >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]" },
            { label: "Realised P&L",     value: `${realizedPnl >= 0 ? "+" : ""}${fmtUSD(realizedPnl)}`,     sub: "All-time settled", color: realizedPnl >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]" },
          ].map(s => (
            <div key={s.label} className="glass-card rounded-card p-4">
              <p className="text-[10px] text-whisper-gray uppercase tracking-wide mb-1.5">{s.label}</p>
              <p className={`text-[20px] font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-whisper-gray mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Analytics row ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Cumulative P&L sparkline */}
          <div className="md:col-span-2 glass-card rounded-card p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-[11px] text-whisper-gray uppercase tracking-wide mb-1">Cumulative P&L</p>
                <p className="text-[24px] font-bold text-[#a0e0ab]">+{fmtUSD(PNL_HISTORY[PNL_HISTORY.length - 1].cumulative_pnl)}</p>
                <p className="text-[12px] text-whisper-gray">All-time trading + LP</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-whisper-gray mb-0.5">LP returns</p>
                <p className="text-[14px] font-semibold text-[#a0e0ab]">+{totalLpPnl.toFixed(3)} SOL</p>
              </div>
            </div>
            <div className="h-[90px]">
              <Sparkline data={PNL_HISTORY} />
            </div>
          </div>

          {/* Trading stats */}
          <div className="glass-card rounded-card p-5">
            <p className="text-[11px] text-whisper-gray uppercase tracking-wide mb-4">Trading Stats</p>
            <div className="flex items-center gap-4 mb-5">
              <div className="relative">
                <DonutRing pct={winRate} color="#a0e0ab" size={72} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[14px] font-bold text-white">{winRate.toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-white">Win Rate</p>
                <p className="text-[12px] text-whisper-gray">{winCount}/{settledPositions.length} settled</p>
              </div>
            </div>
            <div className="space-y-2 text-[12px]">
              <div className="flex justify-between">
                <span className="text-whisper-gray">Portfolio value</span>
                <span className="text-white font-semibold">{fmtUSD(totalPortfolioValue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-whisper-gray">Best trade</span>
                <span className="text-[#a0e0ab] font-semibold">+{fmtUSD(bestTrade.pnl)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-whisper-gray">Worst trade</span>
                <span className="text-[#f47067] font-semibold">{fmtUSD(worstTrade.pnl)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-whisper-gray">Open positions</span>
                <span className="text-white font-semibold">{openPositions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-whisper-gray">Active slips</span>
                <span className="text-white font-semibold">{MY_SLIPS.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab bar ───────────────────────────────────────────── */}
        <div className="flex gap-0.5 mb-5 border-b border-white/[0.06]">
          {([
            { key: "positions", label: "Positions",   count: MY_POSITIONS.length },
            { key: "slips",     label: "Bet Slips",   count: MY_SLIPS.length,     badge: SLIP_AUCTIONS.filter(a=>a.status==="Active").length > 0 ? "⚡" : undefined },
            { key: "orders",    label: "Limit Orders",count: MY_ORDERS.length },
            { key: "lp",        label: "LP Analytics",count: MY_LP_EPOCHS.length },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-5 py-3 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${tab === t.key ? "text-white border-white" : "text-whisper-gray border-transparent hover:text-white"}`}>
              {t.label}
              {"badge" in t && t.badge && <span className="text-[#a07bff]">{t.badge}</span>}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${tab === t.key ? "bg-white text-black" : "bg-white/[0.07] text-whisper-gray"}`}>{t.count}</span>
            </button>
          ))}
        </div>

        {tab === "positions" && <PositionsTab />}
        {tab === "slips"     && <SlipsTab />}
        {tab === "orders"    && <OrdersTab />}
        {tab === "lp"        && <LPTab />}
      </div>
    </div>
  );
}

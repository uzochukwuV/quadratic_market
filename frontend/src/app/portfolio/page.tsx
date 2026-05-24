"use client";

import { useState } from "react";
import Link from "next/link";
import { MY_POSITIONS, MY_SLIPS, MY_ORDERS, EPOCHS } from "@/lib/mockData";
import type { MyPosition, BetSlipAccount, LimitOrderAccount } from "@/lib/types";

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function timeLeft(ts: number) {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Expired";
  const d = Math.floor(diff / 86400);
  if (d > 0) return `${d}d left`;
  const h = Math.floor(diff / 3600);
  return `${h}h left`;
}

// ── Positions table (Polymarket style) ─────────────────────────────────────
function PositionsTab() {
  const [selling, setSelling] = useState<number | null>(null);
  const [sellShares, setSellShares] = useState("");
  const [sellMode, setSellMode] = useState<"amm" | "limit">("amm");
  const [limitPrice, setLimitPrice] = useState("0.72");

  const openPositions = MY_POSITIONS.filter((p) => p.market_status === "Open" || p.market_status === "Suspended");
  const closedPositions = MY_POSITIONS.filter((p) => p.market_status === "Settled" || p.market_status === "AwaitingResult");

  const totalValue = openPositions.reduce((s, p) => s + p.value, 0);
  const totalCost = openPositions.reduce((s, p) => s + p.cost, 0);
  const totalPnl = totalValue - totalCost;

  const PositionRow = ({ p }: { p: MyPosition }) => {
    const isExpanded = selling === p.market_id;
    const pnlColor = p.pnl >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]";
    const canSell = p.market_status === "Open";
    const isClaimed = p.market_status === "Settled" && p.outcome_id === 0; // won

    return (
      <div className="border-b border-white/[0.05] last:border-0">
        {/* Main row */}
        <div className="flex items-center gap-3 py-4 px-4">
          {/* Outcome pill */}
          <div className={`flex-shrink-0 w-12 h-8 rounded-pill flex items-center justify-center text-[11px] font-bold border ${
            p.outcome_id === 0
              ? "text-[#a0e0ab] border-[#a0e0ab]/30 bg-[#a0e0ab]/[0.08]"
              : "text-[#f47067] border-[#f47067]/30 bg-[#f47067]/[0.08]"
          }`}>
            {p.outcome_label}
          </div>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <Link href={`/trade?market=${p.market_id}`} className="text-[13px] font-semibold text-white hover:text-white/80 transition-colors line-clamp-1">
              {p.market_title}
            </Link>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-whisper-gray">{p.category}</span>
              <span className="text-white/20">·</span>
              <span className="text-[11px] text-whisper-gray">Epoch #{p.epoch_id}</span>
              <span className="text-white/20">·</span>
              <span className="text-[11px] text-whisper-gray">
                {p.market_status === "Settled" ? "Settled" : timeLeft(p.settlement_time)}
              </span>
            </div>
          </div>

          {/* Shares */}
          <div className="hidden sm:block text-right w-20">
            <p className="text-[12px] text-whisper-gray">Shares</p>
            <p className="text-[14px] font-semibold text-white">{p.shares.toLocaleString()}</p>
          </div>

          {/* Avg cost */}
          <div className="hidden md:block text-right w-20">
            <p className="text-[12px] text-whisper-gray">Avg Cost</p>
            <p className="text-[14px] font-semibold text-white">{(p.avg_price * 100).toFixed(0)}¢</p>
          </div>

          {/* Current price */}
          <div className="hidden md:block text-right w-20">
            <p className="text-[12px] text-whisper-gray">Current</p>
            <p className="text-[14px] font-semibold text-white">
              {p.market_status === "Settled" ? (p.outcome_id === 0 ? "100¢" : "0¢") : `${(p.current_price * 100).toFixed(0)}¢`}
            </p>
          </div>

          {/* Value */}
          <div className="text-right w-20">
            <p className="text-[12px] text-whisper-gray">Value</p>
            <p className="text-[14px] font-semibold text-white">${p.value.toFixed(2)}</p>
          </div>

          {/* P&L */}
          <div className="text-right w-24">
            <p className="text-[12px] text-whisper-gray">P&L</p>
            <p className={`text-[14px] font-bold ${pnlColor}`}>
              {p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}
            </p>
            <p className={`text-[11px] ${pnlColor}`}>
              {p.pnl_pct >= 0 ? "+" : ""}{p.pnl_pct.toFixed(1)}%
            </p>
          </div>

          {/* Action */}
          <div className="w-24 text-right">
            {canSell && (
              <button
                onClick={() => { setSelling(isExpanded ? null : p.market_id); setSellShares(String(p.shares)); }}
                className={`px-3 py-1.5 rounded-pill text-[12px] font-semibold border transition-all ${
                  isExpanded
                    ? "bg-[#f47067] text-white border-[#f47067]"
                    : "border-[#f47067]/40 text-[#f47067] hover:bg-[#f47067]/15"
                }`}>
                {isExpanded ? "✕ Cancel" : "Sell"}
              </button>
            )}
            {p.market_status === "Settled" && (
              <button className={`px-3 py-1.5 rounded-pill text-[12px] font-semibold border transition-all ${
                isClaimed
                  ? "border-[#a0e0ab]/40 text-[#a0e0ab] hover:bg-[#a0e0ab]/15"
                  : "border-white/15 text-whisper-gray cursor-not-allowed opacity-40"
              }`}>
                {isClaimed ? "Claim" : "Lost"}
              </button>
            )}
          </div>
        </div>

        {/* Expanded sell panel — Polymarket style */}
        {isExpanded && (
          <div className="mx-4 mb-4 p-5 rounded-card bg-[#0d0d0d] border border-white/[0.08] space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-[14px] font-semibold text-white">Exit Position</h4>
              <span className="text-[11px] text-whisper-gray">· {p.market_title.slice(0, 50)}…</span>
            </div>

            {/* Mode toggle */}
            <div className="flex rounded-card overflow-hidden border border-white/[0.08]">
              {(["amm", "limit"] as const).map((m) => (
                <button key={m} onClick={() => setSellMode(m)}
                  className={`flex-1 py-2 text-[12px] font-semibold transition-all ${
                    sellMode === m ? "bg-white text-black" : "text-whisper-gray hover:text-white"
                  }`}>
                  {m === "amm" ? "⚡ Sell Now (AMM)" : "📋 List on Market"}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] text-whisper-gray mb-1.5 block">Shares to sell (max {p.shares})</label>
                <input type="number" min="1" max={p.shares} value={sellShares}
                  onChange={(e) => setSellShares(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[14px] focus:outline-none focus:border-white/20" />
                <div className="flex gap-1.5 mt-1.5">
                  {[25, 50, 100].map((pct) => (
                    <button key={pct} onClick={() => setSellShares(String(Math.floor(p.shares * pct / 100)))}
                      className="flex-1 py-1 rounded text-[10px] border border-white/[0.07] text-whisper-gray hover:text-white hover:border-white/15 transition-colors">{pct}%</button>
                  ))}
                </div>
              </div>

              {sellMode === "limit" && (
                <div>
                  <label className="text-[11px] text-whisper-gray mb-1.5 block">Limit price (¢ per share)</label>
                  <input type="number" min="1" max="99" step="1" value={Math.round(parseFloat(limitPrice) * 100)}
                    onChange={(e) => setLimitPrice(String(parseInt(e.target.value) / 100))}
                    className="w-full px-3 py-2.5 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[14px] focus:outline-none focus:border-white/20" />
                  <p className="text-[10px] text-whisper-gray mt-1">AMM: {(p.current_price * 100).toFixed(0)}¢</p>
                </div>
              )}
            </div>

            {/* Quick summary */}
            <div className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.03] text-[12px]">
              <div>
                <span className="text-whisper-gray">Selling</span>{" "}
                <span className="text-white font-semibold">{sellShares} {p.outcome_label}</span>
              </div>
              <div className="w-px h-4 bg-white/[0.08]" />
              {sellMode === "amm" ? (
                <div>
                  <span className="text-whisper-gray">You receive</span>{" "}
                  <span className="text-[#a0e0ab] font-semibold">
                    ${((parseFloat(sellShares) || 0) * p.current_price).toFixed(2)}
                  </span>
                </div>
              ) : (
                <div>
                  <span className="text-whisper-gray">If filled</span>{" "}
                  <span className="text-[#5bc8fa] font-semibold">
                    ${((parseFloat(sellShares) || 0) * parseFloat(limitPrice)).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setSelling(null)}
                className="flex-1 py-3 rounded-pill border border-white/[0.12] text-whisper-gray text-[13px] hover:text-white hover:border-white/25 transition-all">
                Cancel
              </button>
              <button
                className={`flex-1 py-3 rounded-pill text-[14px] font-semibold transition-all hover:scale-[1.01] ${
                  sellMode === "amm"
                    ? "bg-[#f47067] text-white hover:bg-[#d4534a]"
                    : "bg-[#5bc8fa] text-black hover:bg-[#4ab0e0]"
                }`}>
                {sellMode === "amm" ? `Sell Now · +$${((parseFloat(sellShares) || 0) * p.current_price).toFixed(2)}` : `List ${sellShares} shares @ ${Math.round(parseFloat(limitPrice) * 100)}¢`}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Portfolio summary */}
      <div className="glass-card rounded-card p-6">
        <div className="flex flex-wrap gap-8">
          {[
            { label: "Portfolio Value", value: `$${totalValue.toFixed(2)}`, color: "text-white" },
            { label: "Total Cost", value: `$${totalCost.toFixed(2)}`, color: "text-white" },
            { label: "Unrealised P&L", value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]" },
            { label: "Open Positions", value: String(openPositions.length), color: "text-white" },
            { label: "Settled", value: String(closedPositions.length), color: "text-whisper-gray" },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-[11px] text-whisper-gray uppercase tracking-wide mb-1">{s.label}</p>
              <p className={`text-[22px] font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Open positions */}
      {openPositions.length > 0 && (
        <div className="glass-card rounded-card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-white">Open Positions</h3>
            <span className="text-[11px] text-whisper-gray">{openPositions.length} markets</span>
          </div>
          {/* Table header */}
          <div className="hidden sm:flex items-center gap-3 px-4 py-2 border-b border-white/[0.04] text-[11px] text-whisper-gray uppercase tracking-wide">
            <div className="w-12" />
            <div className="flex-1">Market</div>
            <div className="hidden sm:block w-20 text-right">Shares</div>
            <div className="hidden md:block w-20 text-right">Avg</div>
            <div className="hidden md:block w-20 text-right">Now</div>
            <div className="w-20 text-right">Value</div>
            <div className="w-24 text-right">P&L</div>
            <div className="w-24 text-right">Action</div>
          </div>
          {openPositions.map((p) => <PositionRow key={`${p.market_id}-${p.outcome_id}`} p={p} />)}
        </div>
      )}

      {/* Settled positions */}
      {closedPositions.length > 0 && (
        <div className="glass-card rounded-card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h3 className="text-[14px] font-semibold text-white">Settled Positions</h3>
          </div>
          {closedPositions.map((p) => <PositionRow key={`${p.market_id}-${p.outcome_id}`} p={p} />)}
        </div>
      )}
    </div>
  );
}

// ── Slips tab ──────────────────────────────────────────────────────────────
function SlipsTab() {
  return (
    <div className="space-y-4">
      {MY_SLIPS.map((slip) => {
        const odds = slip.combined_odds_fp / 2 ** 32;
        const potentialSOL = slip.potential_payout / 1e9;
        const stakeSOL = slip.total_stake / 1e9;

        return (
          <div key={slip.slip_id} className="glass-card rounded-card p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[11px] text-whisper-gray mb-1">Slip #{slip.slip_id} · {slip.num_legs}-leg</p>
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-bold text-white">{odds.toFixed(2)}x</span>
                  <span className="text-[12px] text-whisper-gray">combined odds</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-whisper-gray mb-0.5">Potential Payout</p>
                <p className="text-[18px] font-bold text-[#a0e0ab]">{potentialSOL.toFixed(4)} SOL</p>
                <p className="text-[11px] text-whisper-gray">Stake: {stakeSOL.toFixed(4)} SOL</p>
              </div>
            </div>

            {/* Legs */}
            <div className="space-y-2 mb-4">
              {slip.legs.slice(0, slip.num_legs).map((leg, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <span className={`w-8 h-6 rounded text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                    leg.outcome_id === 0 ? "bg-[#a0e0ab]/15 text-[#a0e0ab]" : "bg-[#f47067]/15 text-[#f47067]"
                  }`}>
                    {leg.outcome_label}
                  </span>
                  <p className="text-[12px] text-white flex-1 line-clamp-1">{leg.market_title}</p>
                  <span className="text-[12px] font-semibold text-white flex-shrink-0">
                    {(1 / (leg.price ?? 0.5)).toFixed(2)}x
                  </span>
                </div>
              ))}
            </div>

            {/* Cash out + Claim */}
            <div className="flex gap-2 pt-3 border-t border-white/[0.05]">
              <button className="flex-1 py-2.5 rounded-pill border border-[#ffac2e]/40 text-[#ffac2e] text-[13px] font-semibold hover:bg-[#ffac2e]/10 transition-all">
                Cash Out · ~{(stakeSOL * 1.8).toFixed(4)} SOL
              </button>
              <button className="flex-1 py-2.5 rounded-pill bg-[#a0e0ab] text-black text-[13px] font-semibold hover:bg-[#8dd4a0] transition-all">
                Claim Payout
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Orders tab ─────────────────────────────────────────────────────────────
function OrdersTab() {
  return (
    <div className="glass-card rounded-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h3 className="text-[14px] font-semibold text-white">My Limit Orders</h3>
      </div>
      {MY_ORDERS.map((order) => {
        const filled = order.num_shares > 0 ? (order.filled_shares / order.num_shares) * 100 : 0;
        const remaining = order.num_shares - order.filled_shares;

        return (
          <div key={order.order_id} className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.04] last:border-0">
            <div className={`w-10 h-8 rounded-pill flex items-center justify-center text-[11px] font-bold border flex-shrink-0 ${
              order.side === "Sell"
                ? "text-[#f47067] border-[#f47067]/30 bg-[#f47067]/[0.08]"
                : "text-[#a0e0ab] border-[#a0e0ab]/30 bg-[#a0e0ab]/[0.08]"
            }`}>
              {order.side}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white">
                Market #{order.market_id} · Outcome {order.outcome_id === 0 ? "YES" : "NO"}
              </p>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-[11px] text-whisper-gray">
                  {order.filled_shares}/{order.num_shares} filled
                </p>
                <div className="flex-1 max-w-[80px] h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-[#a0e0ab]" style={{ width: `${filled}%` }} />
                </div>
                <p className="text-[11px] text-whisper-gray">{filled.toFixed(0)}%</p>
              </div>
            </div>

            <div className="text-right hidden sm:block">
              <p className="text-[12px] text-whisper-gray">Price</p>
              <p className="text-[14px] font-semibold text-white">{(order.price_per_share * 100).toFixed(0)}¢</p>
            </div>

            <div className="text-right hidden md:block">
              <p className="text-[12px] text-whisper-gray">Remaining</p>
              <p className="text-[14px] font-semibold text-white">{remaining.toLocaleString()}</p>
            </div>

            <div className="text-right hidden sm:block">
              <p className="text-[12px] text-whisper-gray">Status</p>
              <p className={`text-[12px] font-semibold ${
                order.status === "Open" ? "text-[#a0e0ab]"
                  : order.status === "PartiallyFilled" ? "text-[#ffac2e]"
                  : "text-whisper-gray"
              }`}>{order.status}</p>
            </div>

            <div className="text-right">
              <p className="text-[11px] text-whisper-gray mb-1">{timeLeft(order.expires_at)}</p>
              <button className="px-3 py-1.5 rounded-pill border border-[#f47067]/30 text-[#f47067] text-[11px] hover:bg-[#f47067]/10 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main portfolio page ────────────────────────────────────────────────────
type Tab = "positions" | "slips" | "orders";

export default function PortfolioPage() {
  const [tab, setTab] = useState<Tab>("positions");

  const totalOpenPnl = MY_POSITIONS.filter(p => p.market_status === "Open").reduce((s, p) => s + p.pnl, 0);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ background: "linear-gradient(135deg, rgb(160,224,171), rgb(255,172,46) 50%, rgb(165,45,37))" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
        <div className="relative max-w-[1078px] mx-auto px-6 py-12">
          <p className="text-[12px] text-whisper-gray uppercase tracking-widest mb-2">My Account</p>
          <h1 className="text-[45px] font-semibold text-white leading-tight">Portfolio</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="font-mono text-[13px] text-whisper-gray">ALk6…Qyep</span>
            <span className={`text-[13px] font-semibold ${totalOpenPnl >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]"}`}>
              {totalOpenPnl >= 0 ? "+" : ""}${totalOpenPnl.toFixed(2)} unrealised P&L
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-[1078px] mx-auto px-6 py-8">
        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b border-white/[0.06]">
          {([
            { key: "positions", label: "Positions", count: MY_POSITIONS.length },
            { key: "slips", label: "Bet Slips", count: MY_SLIPS.length },
            { key: "orders", label: "Limit Orders", count: MY_ORDERS.length },
          ] as const).map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-5 py-3 text-[14px] font-semibold transition-colors border-b-2 -mb-px ${
                tab === t.key ? "text-white border-white" : "text-whisper-gray border-transparent hover:text-white"
              }`}>
              {t.label}
              <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                tab === t.key ? "bg-white text-black" : "bg-white/[0.07] text-whisper-gray"
              }`}>{t.count}</span>
            </button>
          ))}
        </div>

        {tab === "positions" && <PositionsTab />}
        {tab === "slips" && <SlipsTab />}
        {tab === "orders" && <OrdersTab />}
      </div>
    </div>
  );
}

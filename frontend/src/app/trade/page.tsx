"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MARKETS, MY_POSITIONS, ORDER_BOOK_SELLS, ORDER_BOOK_BUYS, getMarketPrices } from "@/lib/mockData";
import type { LimitOrderAccount } from "@/lib/types";

// ── Sell Panel (Polymarket style) ──────────────────────────────────────────
function SellPanel({ marketId, yesPrice, noPrice }: { marketId: number; yesPrice: number; noPrice: number }) {
  const position = MY_POSITIONS.find((p) => p.market_id === marketId);
  const [sellShares, setSellShares] = useState(position ? String(position.shares) : "100");
  const [minPayout, setMinPayout] = useState("");
  const [mode, setMode] = useState<"amm" | "limit">("amm");
  const [limitPrice, setLimitPrice] = useState(position ? String((position.current_price + 0.04).toFixed(2)) : "0.72");
  const [limitExpiry, setLimitExpiry] = useState("7");

  const outcomePrice = position?.outcome_id === 0 ? yesPrice : noPrice;
  const sharesNum = parseFloat(sellShares) || 0;
  const proceeds = sharesNum * outcomePrice;
  const slippage = proceeds * 0.005;
  const minPayoutCalc = (proceeds - slippage).toFixed(2);

  if (!position) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-4">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 2a9 9 0 100 18A9 9 0 0011 2z" stroke="#6d6d6d" strokeWidth="1.3" />
            <path d="M11 8v5M11 15h.01" stroke="#6d6d6d" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-[14px] text-whisper-gray mb-1">No position in this market</p>
        <p className="text-[12px] text-whisper-gray opacity-60">Buy shares first to enable selling</p>
      </div>
    );
  }

  const pnlColor = position.pnl >= 0 ? "text-[#a0e0ab]" : "text-[#f47067]";

  return (
    <div className="space-y-4">
      {/* Your position summary */}
      <div className="rounded-card p-4 bg-white/[0.03] border border-white/[0.06]">
        <p className="text-[11px] text-whisper-gray uppercase tracking-widest mb-3">Your Position</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Outcome", value: position.outcome_label, color: position.outcome_id === 0 ? "text-[#a0e0ab]" : "text-[#f47067]" },
            { label: "Shares", value: position.shares.toLocaleString(), color: "text-white" },
            { label: "Avg Cost", value: `${(position.avg_price * 100).toFixed(0)}¢`, color: "text-white" },
            { label: "Current", value: `${(position.current_price * 100).toFixed(0)}¢`, color: "text-white" },
            { label: "Value", value: `$${position.value.toFixed(2)}`, color: "text-white" },
            { label: "P&L", value: `${position.pnl >= 0 ? "+" : ""}$${position.pnl.toFixed(2)} (${position.pnl_pct >= 0 ? "+" : ""}${position.pnl_pct.toFixed(1)}%)`, color: pnlColor },
          ].map((r) => (
            <div key={r.label}>
              <p className="text-[10px] text-whisper-gray mb-0.5">{r.label}</p>
              <p className={`text-[13px] font-semibold ${r.color}`}>{r.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mode tabs */}
      <div className="grid grid-cols-2 rounded-card overflow-hidden border border-white/[0.08]">
        {(["amm", "limit"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`py-2.5 text-[13px] font-semibold transition-all ${
              mode === m ? "bg-white text-black" : "text-whisper-gray hover:text-white bg-transparent"
            }`}>
            {m === "amm" ? "Sell Now (AMM)" : "List for Sale"}
          </button>
        ))}
      </div>

      {/* AMM sell */}
      {mode === "amm" && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] text-whisper-gray">Shares to sell</label>
              <button
                onClick={() => setSellShares(String(position.shares))}
                className="text-[11px] text-white/50 hover:text-white border border-white/[0.08] px-2 py-0.5 rounded transition-colors"
              >
                Max ({position.shares})
              </button>
            </div>
            <input
              type="number"
              min="1"
              max={position.shares}
              value={sellShares}
              onChange={(e) => setSellShares(e.target.value)}
              className="w-full px-4 py-3 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[15px] focus:outline-none focus:border-white/20 transition-all"
            />
            {/* Quick fractions */}
            <div className="flex gap-2 mt-2">
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct}
                  onClick={() => setSellShares(String(Math.floor(position.shares * pct / 100)))}
                  className="flex-1 py-1 rounded text-[11px] border border-white/[0.08] text-whisper-gray hover:text-white hover:border-white/20 transition-colors">
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Payout estimate */}
          <div className="glass-card rounded-card p-4 space-y-2.5">
            <div className="flex justify-between text-[13px]">
              <span className="text-whisper-gray">Shares selling</span>
              <span className="text-white">{sharesNum.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-whisper-gray">Price per share</span>
              <span className="text-white">{(outcomePrice * 100).toFixed(0)}¢</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-whisper-gray">AMM fee (0.5%)</span>
              <span className="text-[#f47067]">-${slippage.toFixed(2)}</span>
            </div>
            <div className="h-px bg-white/[0.06]" />
            <div className="flex justify-between text-[14px] font-bold">
              <span className="text-whisper-gray">You receive</span>
              <span className="text-[#a0e0ab]">${proceeds.toFixed(2)}</span>
            </div>
          </div>

          {/* Min payout */}
          <div>
            <label className="text-[12px] text-whisper-gray mb-1.5 block">
              Min payout (slippage protection)
              <span className="ml-2 text-white/30 font-normal">Leave blank for auto ({minPayoutCalc})</span>
            </label>
            <input
              type="number"
              placeholder={minPayoutCalc}
              value={minPayout}
              onChange={(e) => setMinPayout(e.target.value)}
              className="w-full px-4 py-2.5 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[13px] focus:outline-none focus:border-white/20 transition-all"
            />
          </div>

          <button
            disabled={sharesNum === 0}
            className="w-full py-4 rounded-pill bg-[#f47067] text-white text-[15px] font-semibold hover:bg-[#d4534a] transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            Sell {sharesNum > 0 ? `${sharesNum.toLocaleString()} ${position.outcome_label}` : "Shares"} · +${proceeds.toFixed(2)}
          </button>
          <p className="text-[11px] text-whisper-gray text-center">Instant settlement via LMSR AMM</p>
        </div>
      )}

      {/* Limit sell — secondary market */}
      {mode === "limit" && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-[#5bc8fa]/[0.06] border border-[#5bc8fa]/20">
            <p className="text-[12px] text-[#5bc8fa] font-semibold mb-1">Secondary Market</p>
            <p className="text-[11px] text-whisper-gray leading-relaxed">
              List your shares as a limit sell order. Another trader fills it at your price. Shares are locked in escrow until filled or cancelled.
            </p>
          </div>

          <div>
            <label className="text-[12px] text-whisper-gray mb-1.5 block">Shares to list</label>
            <input type="number" min="1" max={position.shares} value={sellShares}
              onChange={(e) => setSellShares(e.target.value)}
              className="w-full px-4 py-3 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[15px] focus:outline-none focus:border-white/20 transition-all" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[12px] text-whisper-gray">Price per share</label>
              <span className="text-[11px] text-whisper-gray">AMM: {(outcomePrice * 100).toFixed(0)}¢</span>
            </div>
            <div className="relative">
              <input type="number" min="0.01" max="1" step="0.01" value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                className="w-full px-4 py-3 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[15px] focus:outline-none focus:border-white/20 transition-all" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-whisper-gray">¢ implied</span>
            </div>
            {parseFloat(limitPrice) > outcomePrice && (
              <p className="text-[11px] text-[#a0e0ab] mt-1">+{((parseFloat(limitPrice) - outcomePrice) * 100).toFixed(0)}¢ premium over AMM</p>
            )}
          </div>

          <div>
            <label className="text-[12px] text-whisper-gray mb-1.5 block">Expires in</label>
            <div className="grid grid-cols-4 gap-2">
              {["1", "3", "7", "30"].map((d) => (
                <button key={d} onClick={() => setLimitExpiry(d)}
                  className={`py-2 rounded-card text-[12px] border transition-colors ${
                    limitExpiry === d ? "bg-white text-black border-white" : "border-white/[0.1] text-whisper-gray hover:text-white"
                  }`}>
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {/* Order summary */}
          <div className="glass-card rounded-card p-4 space-y-2">
            {[
              { label: "Shares listed", value: `${sharesNum} ${position.outcome_label}` },
              { label: "Target price", value: `${(parseFloat(limitPrice) * 100).toFixed(0)}¢` },
              { label: "If fully filled", value: `$${(sharesNum * parseFloat(limitPrice)).toFixed(2)}`, green: true },
              { label: "Expires", value: `${limitExpiry} days from now` },
            ].map((r) => (
              <div key={r.label} className="flex justify-between text-[13px]">
                <span className="text-whisper-gray">{r.label}</span>
                <span className={r.green ? "text-[#a0e0ab] font-semibold" : "text-white"}>{r.value}</span>
              </div>
            ))}
          </div>

          <button className="w-full py-4 rounded-pill bg-[#5bc8fa] text-black text-[15px] font-semibold hover:bg-[#4ab0e0] transition-all hover:scale-[1.01]">
            Place Sell Order · {sharesNum} shares @ {(parseFloat(limitPrice) * 100).toFixed(0)}¢
          </button>
          <p className="text-[11px] text-whisper-gray text-center">
            Shares locked in escrow · Cancel anytime to recover
          </p>
        </div>
      )}
    </div>
  );
}

// ── Buy Panel ──────────────────────────────────────────────────────────────
function BuyPanel({ marketId, yesPrice, noPrice, mode }: { marketId: number; yesPrice: number; noPrice: number; mode: "Trading" | "FixedOdds" }) {
  const [side, setSide] = useState<0 | 1>(0);
  const [shares, setShares] = useState("100");
  const price = side === 0 ? yesPrice : noPrice;
  const sharesNum = parseFloat(shares) || 0;
  const cost = sharesNum * price;
  const maxProfit = sharesNum * (1 - price);
  const roi = ((1 / price) - 1) * 100;

  if (mode === "FixedOdds") {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-[#ffac2e]/[0.08] border border-[#ffac2e]/25 flex items-center justify-center">
          <span className="text-[20px]">🏆</span>
        </div>
        <p className="text-[14px] font-semibold text-white">Fixed Odds Market</p>
        <p className="text-[13px] text-whisper-gray leading-relaxed max-w-xs">
          This market uses fixed-odds pricing. Add it to your Bet Slip using the YES/NO buttons on the market card.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((s) => {
          const p = s === 0 ? yesPrice : noPrice;
          const label = s === 0 ? "YES" : "NO";
          return (
            <button key={s} onClick={() => setSide(s)}
              className={`py-3 rounded-pill border text-[14px] font-semibold transition-all ${
                side === s
                  ? s === 0 ? "bg-[#a0e0ab] text-black border-[#a0e0ab]" : "bg-[#f47067] text-white border-[#f47067]"
                  : "border-white/[0.12] text-whisper-gray hover:text-white hover:border-white/25 bg-transparent"
              }`}>
              {label}
              <span className="ml-2 text-[12px] opacity-75">{(p * 100).toFixed(0)}¢</span>
            </button>
          );
        })}
      </div>

      <div>
        <label className="text-[12px] text-whisper-gray mb-2 block">Number of shares</label>
        <div className="relative">
          <input type="number" min="1" value={shares} onChange={(e) => setShares(e.target.value)}
            className="w-full px-4 py-3 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[15px] focus:outline-none focus:border-white/20 transition-all" />
        </div>
        <div className="flex gap-2 mt-2">
          {["10", "50", "100", "500"].map((v) => (
            <button key={v} onClick={() => setShares(v)}
              className="flex-1 py-1 rounded text-[11px] border border-white/[0.08] text-whisper-gray hover:text-white hover:border-white/20 transition-colors">{v}</button>
          ))}
        </div>
      </div>

      <div className="glass-card rounded-card p-4 space-y-2">
        {[
          { l: "Price per share", v: `${(price * 100).toFixed(0)}¢` },
          { l: "Total cost", v: `$${cost.toFixed(2)}` },
          { l: "Max profit", v: `$${maxProfit.toFixed(2)}`, g: true },
          { l: "Potential ROI", v: `+${roi.toFixed(0)}%`, g: true },
        ].map((r) => (
          <div key={r.l} className="flex justify-between text-[13px]">
            <span className="text-whisper-gray">{r.l}</span>
            <span className={r.g ? "text-[#a0e0ab] font-semibold" : "text-white"}>{r.v}</span>
          </div>
        ))}
      </div>

      <button className={`w-full py-4 rounded-pill text-[15px] font-semibold transition-all hover:scale-[1.01] ${
        side === 0 ? "bg-[#a0e0ab] text-black hover:bg-[#8dd4a0]" : "bg-[#f47067] text-white hover:bg-[#d4534a]"
      }`}>
        Buy {shares} {side === 0 ? "YES" : "NO"} · ${cost.toFixed(2)}
      </button>
      <p className="text-[11px] text-whisper-gray text-center">LMSR AMM · 0.5% fee</p>
    </div>
  );
}

// ── Order Book ─────────────────────────────────────────────────────────────
function SecondaryMarket({ marketId }: { marketId: number }) {
  const [tab, setTab] = useState<"book" | "place">("book");
  const sells = ORDER_BOOK_SELLS.filter((o) => o.market_id === marketId);
  const buys = ORDER_BOOK_BUYS.filter((o) => o.market_id === marketId);

  function timeLeft(ts: number) {
    const diff = ts - Math.floor(Date.now() / 1000);
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    return d > 0 ? `${d}d` : `${h}h`;
  }

  const OrderRow = ({ order, side }: { order: LimitOrderAccount; side: "Sell" | "Buy" }) => {
    const filled = order.num_shares > 0 ? (order.filled_shares / order.num_shares) * 100 : 0;
    const remaining = order.num_shares - order.filled_shares;
    return (
      <div className="group flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer">
        <div className="w-16 text-[13px] font-semibold" style={{ color: side === "Sell" ? "#f47067" : "#a0e0ab" }}>
          {(order.price_per_share * 100).toFixed(0)}¢
        </div>
        <div className="flex-1 px-3">
          <div className="h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full rounded-full bg-white/20 transition-all" style={{ width: `${filled}%` }} />
          </div>
        </div>
        <div className="w-24 text-[12px] text-whisper-gray text-right">
          {remaining.toLocaleString()} shares
        </div>
        <div className="w-12 text-[11px] text-whisper-gray text-right">{timeLeft(order.expires_at)}</div>
        <button
          onClick={(e) => e.stopPropagation()}
          className={`ml-3 opacity-0 group-hover:opacity-100 px-2.5 py-1 rounded-pill text-[11px] font-semibold border transition-all ${
            side === "Sell"
              ? "border-[#a0e0ab]/40 text-[#a0e0ab] hover:bg-[#a0e0ab]/15"
              : "border-[#f47067]/40 text-[#f47067] hover:bg-[#f47067]/15"
          }`}>
          {side === "Sell" ? "Buy" : "Sell"}
        </button>
      </div>
    );
  };

  return (
    <div className="glass-card rounded-card overflow-hidden">
      <div className="flex border-b border-white/[0.06]">
        {(["book", "place"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-[13px] font-semibold transition-colors ${
              tab === t ? "text-white border-b-2 border-white -mb-px" : "text-whisper-gray hover:text-white"
            }`}>
            {t === "book" ? "Order Book" : "Place Limit Order"}
          </button>
        ))}
      </div>

      {tab === "book" && (
        <div className="p-4">
          <div className="flex justify-between text-[10px] text-whisper-gray uppercase tracking-wide mb-2 px-3">
            <span>Price</span><span className="ml-8">Fill %</span><span>Remaining</span><span>Expires</span><span className="mr-12" />
          </div>

          {/* Asks (sells) */}
          <div className="mb-1 space-y-0.5">
            {sells.length === 0 ? (
              <p className="text-[12px] text-whisper-gray text-center py-3">No sell orders</p>
            ) : sells.slice().reverse().map((o) => <OrderRow key={o.order_id} order={o} side="Sell" />)}
          </div>

          {/* Mid */}
          <div className="flex items-center gap-2 py-2 my-1">
            <div className="flex-1 h-px bg-white/[0.05]" />
            <span className="text-[13px] font-bold text-white px-2">
              {((sells[0]?.price_per_share ?? 0.68) * 100).toFixed(0)}¢
            </span>
            <div className="flex-1 h-px bg-white/[0.05]" />
          </div>

          {/* Bids (buys) */}
          <div className="space-y-0.5">
            {buys.length === 0 ? (
              <p className="text-[12px] text-whisper-gray text-center py-3">No buy orders</p>
            ) : buys.map((o) => <OrderRow key={o.order_id} order={o} side="Buy" />)}
          </div>

          <p className="text-[10px] text-whisper-gray text-center mt-4">
            P2P limit orders · Escrow-secured · Partial fills supported
          </p>
        </div>
      )}

      {tab === "place" && (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {["Buy", "Sell"].map((s) => (
              <button key={s} className={`py-2.5 rounded-pill border text-[13px] font-semibold transition-all ${
                s === "Buy" ? "border-[#a0e0ab]/40 text-[#a0e0ab] hover:bg-[#a0e0ab]/10" : "border-[#f47067]/40 text-[#f47067] hover:bg-[#f47067]/10"
              }`}>{s} Limit</button>
            ))}
          </div>
          <div>
            <label className="text-[12px] text-whisper-gray mb-1.5 block">Price (per share, 0–1)</label>
            <input type="number" defaultValue="0.72" step="0.01" min="0.01" max="0.99"
              className="w-full px-4 py-2.5 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[14px] focus:outline-none focus:border-white/20 transition-all" />
          </div>
          <div>
            <label className="text-[12px] text-whisper-gray mb-1.5 block">Number of shares</label>
            <input type="number" defaultValue="100"
              className="w-full px-4 py-2.5 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[14px] focus:outline-none focus:border-white/20 transition-all" />
          </div>
          <div>
            <label className="text-[12px] text-whisper-gray mb-1.5 block">Expires in</label>
            <select defaultValue="7" className="w-full px-4 py-2.5 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[14px] focus:outline-none appearance-none">
              {["1 day", "3 days", "7 days", "30 days"].map((d) => (
                <option key={d} className="bg-[#111]">{d}</option>
              ))}
            </select>
          </div>
          <button className="w-full py-3 rounded-pill bg-white/[0.08] border border-white/15 text-white text-[14px] font-semibold hover:bg-white/15 transition-all">
            Place Order
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sparkline chart ────────────────────────────────────────────────────────
function PriceChart({ yesPrice }: { yesPrice: number }) {
  const base = yesPrice * 100;
  const pts = Array.from({ length: 20 }, (_, i) => {
    const noise = (Math.sin(i * 1.3) + Math.cos(i * 0.7)) * 6;
    return Math.max(5, Math.min(95, base - 8 + (i / 19) * 8 + noise));
  });
  const maxY = Math.max(...pts);
  const minY = Math.min(...pts);
  const normalize = (v: number) => 80 - ((v - minY) / (maxY - minY + 1)) * 70;
  const svgPts = pts.map((v, i) => `${(i / 19) * 380},${normalize(v)}`).join(" ");

  return (
    <svg viewBox="0 0 380 90" className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a0e0ab" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#a0e0ab" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke="#a0e0ab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={svgPts} />
      <polygon fill="url(#cg)" points={`0,90 ${svgPts} 380,90`} />
    </svg>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
function TradeContent() {
  const params = useSearchParams();
  const marketIdStr = params.get("market") ?? "301";
  const marketId = parseInt(marketIdStr);
  const market = MARKETS.find((m) => m.market_id === marketId) ?? MARKETS[0];
  const prices = getMarketPrices(market);
  const yesPrice = prices[0];
  const noPrice = prices[1] ?? 1 - yesPrice;

  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [chartPeriod, setChartPeriod] = useState("1W");

  const epoch = { id: market.epoch_id };
  const isTradable = market.status === "Open";

  return (
    <div className="min-h-screen">
      <div className="h-[2px]" style={{ background: "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46) 50%, rgb(165,45,37))" }} />

      <div className="max-w-[1078px] mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[12px] text-whisper-gray mb-5">
          <a href="/markets" className="hover:text-white transition-colors">Markets</a>
          <span>/</span>
          <span className="text-whisper-gray">{market.category}</span>
          <span>/</span>
          <span className="text-white truncate max-w-[200px]">{market.title.slice(0, 40)}…</span>
        </div>

        {/* Market title + meta row */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[11px] px-2.5 py-0.5 rounded-pill border border-white/15 text-whisper-gray">
              {market.category}
            </span>
            <span className={`text-[11px] px-2.5 py-0.5 rounded-pill border ${
              market.status === "Open" ? "border-[#a0e0ab]/30 text-[#a0e0ab] bg-[#a0e0ab]/[0.07]"
              : market.status === "Suspended" ? "border-[#ffac2e]/30 text-[#ffac2e] bg-[#ffac2e]/[0.07]"
              : market.status === "AwaitingResult" ? "border-[#5bc8fa]/30 text-[#5bc8fa] bg-[#5bc8fa]/[0.07]"
              : "border-white/10 text-whisper-gray"
            }`}>
              {market.status}
            </span>
            <span className={`text-[11px] px-2.5 py-0.5 rounded-pill border ${
              market.market_mode === "Trading"
                ? "border-[#a07bff]/30 text-[#a07bff] bg-[#a07bff]/[0.07]"
                : "border-[#ffac2e]/30 text-[#ffac2e] bg-[#ffac2e]/[0.07]"
            }`}>
              {market.market_mode === "Trading" ? "AMM Trading" : "Fixed Odds"}
            </span>
            <span className="text-[11px] px-2.5 py-0.5 rounded-pill border border-white/[0.08] text-whisper-gray">
              Epoch #{epoch.id}
            </span>
          </div>
          <h1 className="text-[29px] md:text-[39px] font-semibold text-white leading-tight">
            {market.title}
          </h1>
          <p className="text-[14px] text-whisper-gray mt-2 max-w-2xl leading-relaxed">
            {market.description}
          </p>
        </div>

        {/* Suspended/AwaitingResult notice */}
        {(market.status === "Suspended" || market.status === "AwaitingResult") && (
          <div className="mb-6 p-4 rounded-card bg-[#ffac2e]/[0.06] border border-[#ffac2e]/25 flex items-start gap-3">
            <span className="text-[#ffac2e] text-[18px] flex-shrink-0">⚠</span>
            <div>
              <p className="text-[14px] font-semibold text-[#ffac2e] mb-0.5">
                {market.status === "Suspended" ? "Market Suspended" : "Awaiting Oracle Result"}
              </p>
              <p className="text-[13px] text-whisper-gray">
                {market.status === "Suspended"
                  ? "Trading is temporarily paused by the operator. Existing positions are unaffected."
                  : "The event has ended. The oracle is submitting the result. Settlement expected within 24h."}
              </p>
            </div>
          </div>
        )}

        {/* Main 3-col layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-[14px]">
          {/* ── Left column ── */}
          <div className="space-y-[14px]">
            {/* Probability chart */}
            <div className="glass-card rounded-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-baseline gap-3">
                  <span className="text-[29px] font-bold text-[#a0e0ab]">{(yesPrice * 100).toFixed(0)}¢</span>
                  <span className="text-[14px] text-whisper-gray">YES probability</span>
                </div>
                <div className="flex gap-1">
                  {["1D", "1W", "1M", "All"].map((p) => (
                    <button key={p} onClick={() => setChartPeriod(p)}
                      className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                        chartPeriod === p ? "text-white bg-white/[0.08]" : "text-whisper-gray hover:text-white"
                      }`}>{p}</button>
                  ))}
                </div>
              </div>
              <div className="h-40">
                <PriceChart yesPrice={yesPrice} />
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05] text-[12px] text-whisper-gray">
                <span>YES <span className="text-[#a0e0ab] font-semibold">{(yesPrice * 100).toFixed(0)}¢</span></span>
                <span>NO <span className="text-[#f47067] font-semibold">{(noPrice * 100).toFixed(0)}¢</span></span>
                <span>Vol <span className="text-white font-semibold">${((market.exposure * 12) / 1000).toFixed(0)}K</span></span>
                <span>LMSR B <span className="text-white font-semibold">{(market.lmsr_b / 1e6).toFixed(0)}M</span></span>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-[14px]">
              {[
                { label: "YES Price", value: `${(yesPrice * 100).toFixed(0)}¢`, color: "#a0e0ab" },
                { label: "NO Price", value: `${(noPrice * 100).toFixed(0)}¢`, color: "#f47067" },
                { label: "Pool Exposure", value: `$${(market.exposure / 1e4).toFixed(0)}K` },
                { label: "Epoch", value: `#${market.epoch_id}` },
              ].map((s) => (
                <div key={s.label} className="glass-card rounded-card p-4">
                  <p className="text-[10px] text-whisper-gray mb-1 uppercase tracking-wide">{s.label}</p>
                  <p className="text-[20px] font-bold" style={{ color: s.color ?? "#fff" }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Secondary market order book */}
            <SecondaryMarket marketId={marketId} />

            {/* Recent trades */}
            <div className="glass-card rounded-card p-5">
              <h3 className="text-[13px] font-semibold text-white mb-4">Recent Trades</h3>
              <div className="space-y-0">
                {[
                  { side: "YES", shares: 250, price: 68, time: "2m ago", wallet: "9H1D…qsLC", type: "AMM" },
                  { side: "NO", shares: 100, price: 32, time: "5m ago", wallet: "ALk6…Qyep", type: "AMM" },
                  { side: "YES", shares: 500, price: 67, time: "12m ago", wallet: "7xKp…wQ2x", type: "Limit" },
                  { side: "YES", shares: 1000, price: 66, time: "18m ago", wallet: "3mNb…tR9z", type: "AMM" },
                  { side: "NO", shares: 200, price: 33, time: "24m ago", wallet: "Bv4d…kL2p", type: "Limit" },
                ].map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0 text-[12px]">
                    <span className={`font-semibold w-10 ${t.side === "YES" ? "text-[#a0e0ab]" : "text-[#f47067]"}`}>{t.side}</span>
                    <span className="text-white flex-1 text-center">{t.shares.toLocaleString()} shares</span>
                    <span className="text-whisper-gray flex-1 text-center">@ {t.price}¢</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/[0.08] text-whisper-gray mr-2">{t.type}</span>
                    <span className="text-whisper-gray font-mono text-[11px] w-20 text-right">{t.wallet}</span>
                    <span className="text-whisper-gray w-14 text-right">{t.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right: Trade panel ── */}
          <div className="space-y-[14px]">
            <div className="glass-card rounded-card overflow-hidden">
              {/* Buy / Sell tabs */}
              <div className="grid grid-cols-2 border-b border-white/[0.06]">
                {(["buy", "sell"] as const).map((t) => (
                  <button key={t} onClick={() => setActiveTab(t)}
                    className={`py-4 text-[14px] font-semibold capitalize transition-colors ${
                      activeTab === t
                        ? t === "buy" ? "text-[#a0e0ab] border-b-2 border-[#a0e0ab] -mb-px" : "text-[#f47067] border-b-2 border-[#f47067] -mb-px"
                        : "text-whisper-gray hover:text-white"
                    }`}>
                    {t === "buy" ? "Buy" : "Sell / Exit"}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {!isTradable && market.status !== "Settled" && (
                  <div className="mb-4 p-3 rounded-lg bg-[#ffac2e]/[0.06] border border-[#ffac2e]/20 text-[12px] text-[#ffac2e]">
                    Trading paused · Market is {market.status}
                  </div>
                )}
                {activeTab === "buy" ? (
                  <BuyPanel marketId={marketId} yesPrice={yesPrice} noPrice={noPrice} mode={market.market_mode} />
                ) : (
                  <SellPanel marketId={marketId} yesPrice={yesPrice} noPrice={noPrice} />
                )}
              </div>
            </div>

            {/* Market details card */}
            <div className="glass-card rounded-card p-5 space-y-3">
              <h3 className="text-[13px] font-semibold text-white mb-1">Market Details</h3>
              {[
                { label: "Market ID", value: `#${market.market_id}` },
                { label: "Epoch", value: `#${market.epoch_id}` },
                { label: "Mode", value: market.market_mode },
                { label: "Outcomes", value: `${market.num_outcomes} (Binary)` },
                { label: "LMSR B", value: `${(market.lmsr_b / 1e6).toFixed(0)}M` },
                { label: "Resolves", value: new Date(market.settlement_time * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) },
              ].map((r) => (
                <div key={r.label} className="flex justify-between text-[12px]">
                  <span className="text-whisper-gray">{r.label}</span>
                  <span className="text-white font-mono">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <TradeContent />
    </Suspense>
  );
}

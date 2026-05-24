"use client";

import { useState, useCallback } from "react";
import type { BetSlipCartItem } from "@/lib/types";

// Simple global state via module-level singleton (no Redux needed for this demo)
let _items: BetSlipCartItem[] = [];
let _listeners: (() => void)[] = [];
const notify = () => _listeners.forEach((l) => l());

export function addToBetSlip(item: BetSlipCartItem) {
  const idx = _items.findIndex(
    (i) => i.market_id === item.market_id
  );
  if (idx >= 0) {
    _items = _items.map((i, ix) => (ix === idx ? { ...item } : i));
  } else {
    _items = [..._items, item];
  }
  notify();
}

export function useBetSlip() {
  const [, forceUpdate] = useState(0);
  const rerender = useCallback(() => forceUpdate((n) => n + 1), []);

  if (typeof window !== "undefined" && !_listeners.includes(rerender)) {
    _listeners.push(rerender);
  }

  const items = _items;
  const remove = (market_id: number) => {
    _items = _items.filter((i) => i.market_id !== market_id);
    notify();
  };
  const clear = () => { _items = []; notify(); };
  const updateStake = (market_id: number, stake: number) => {
    _items = _items.map((i) => i.market_id === market_id ? { ...i, stake } : i);
    notify();
  };

  const totalStake = items.reduce((s, i) => s + i.stake, 0);
  const combinedOdds = items.reduce((acc, i) => acc / i.implied_odds, 1);
  const potentialPayout = totalStake * combinedOdds;

  return { items, remove, clear, updateStake, totalStake, combinedOdds, potentialPayout };
}

export function BetSlipDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { items, remove, clear, updateStake, totalStake, combinedOdds, potentialPayout } =
    useBetSlip();
  const [globalStake, setGlobalStake] = useState("10");

  const applyGlobalStake = () => {
    const val = parseFloat(globalStake) || 10;
    items.forEach((item) => updateStake(item.market_id, val));
  };

  const decimalOdds = items.length === 0 ? 0 : combinedOdds;

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[360px] max-w-full z-50 flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ background: "#0d0d0d", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="10" rx="2" stroke="#6d6d6d" strokeWidth="1.2" />
              <path d="M5 3V2a1 1 0 011-1h4a1 1 0 011 1v1" stroke="#6d6d6d" strokeWidth="1.2" />
              <path d="M5 8h6M5 11h4" stroke="#6d6d6d" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span className="text-[15px] font-semibold text-white">Bet Slip</span>
            {items.length > 0 && (
              <span className="w-5 h-5 rounded-full gradient-bg text-[11px] font-bold text-black flex items-center justify-center">
                {items.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {items.length > 0 && (
              <button
                onClick={clear}
                className="text-[12px] text-whisper-gray hover:text-[#f47067] transition-colors"
              >
                Clear all
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-whisper-gray hover:text-white transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <rect x="3" y="6" width="22" height="16" rx="3" stroke="#3a3a3a" strokeWidth="1.5" />
                  <path d="M9 12h10M9 16h7" stroke="#3a3a3a" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <p className="text-[15px] text-white mb-1">Your slip is empty</p>
                <p className="text-[13px] text-whisper-gray leading-relaxed">
                  Add selections from FixedOdds markets to build a multi-leg bet.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Legs */}
              {items.map((item) => (
                <div
                  key={item.market_id}
                  className="rounded-card p-4"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-whisper-gray mb-0.5 uppercase tracking-wide">
                        {item.outcome_label}
                      </p>
                      <p className="text-[13px] font-semibold text-white leading-snug line-clamp-2">
                        {item.market_title}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[15px] font-bold text-[#a0e0ab]">
                        {(1 / item.implied_odds).toFixed(2)}x
                      </span>
                      <button
                        onClick={() => remove(item.market_id)}
                        className="text-[11px] text-whisper-gray hover:text-[#f47067] transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {/* Per-leg stake */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-whisper-gray flex-shrink-0">Stake</span>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-whisper-gray">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={item.stake}
                        onChange={(e) => updateStake(item.market_id, parseFloat(e.target.value) || 0)}
                        className="w-full pl-6 pr-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.08] text-white text-[13px] focus:outline-none focus:border-white/20 transition-all"
                      />
                    </div>
                    <span className="text-[11px] text-[#a0e0ab] flex-shrink-0">
                      → ${((item.stake || 0) / item.implied_odds).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}

              {/* Parlay type badge */}
              {items.length > 1 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#a0e0ab]/[0.06] border border-[#a0e0ab]/20">
                  <span className="text-[11px] text-[#a0e0ab] font-semibold uppercase tracking-wide">
                    {items.length}-Leg Parlay
                  </span>
                  <span className="ml-auto text-[11px] text-whisper-gray">
                    Combined odds:
                  </span>
                  <span className="text-[13px] font-bold text-[#a0e0ab]">
                    {decimalOdds.toFixed(2)}x
                  </span>
                </div>
              )}

              {/* Global stake quick-set */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[12px] text-whisper-gray">Set all stakes:</span>
                <div className="flex gap-1">
                  {["5", "10", "25", "50"].map((v) => (
                    <button
                      key={v}
                      onClick={() => { setGlobalStake(v); items.forEach((i) => updateStake(i.market_id, parseFloat(v))); }}
                      className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
                        globalStake === v
                          ? "border-white/30 text-white bg-white/[0.06]"
                          : "border-white/[0.08] text-whisper-gray hover:text-white"
                      }`}
                    >
                      ${v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div
            className="border-t border-white/[0.06] p-5 space-y-4"
            style={{ background: "#0a0a0a" }}
          >
            {/* Summary */}
            <div className="space-y-2">
              {[
                { label: "Total Stake", value: `$${totalStake.toFixed(2)}` },
                { label: "Combined Odds", value: `${decimalOdds.toFixed(2)}x`, bold: true },
                { label: "Potential Payout", value: `$${potentialPayout.toFixed(2)}`, green: true, bold: true },
              ].map((row) => (
                <div key={row.label} className="flex justify-between text-[13px]">
                  <span className="text-whisper-gray">{row.label}</span>
                  <span
                    className={`${row.bold ? "font-bold" : ""} ${
                      row.green ? "text-[#a0e0ab]" : "text-white"
                    }`}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            <button className="w-full py-4 rounded-pill bg-white text-black text-[15px] font-semibold hover:bg-white/90 transition-all hover:scale-[1.01]">
              Place Slip · ${totalStake.toFixed(2)}
            </button>

            <p className="text-[11px] text-whisper-gray text-center">
              House margin: 2.5% · Payout locked on-chain at placement
            </p>
          </div>
        )}
      </div>
    </>
  );
}

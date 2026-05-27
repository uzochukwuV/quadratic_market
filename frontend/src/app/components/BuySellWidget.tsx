"use client";

import { useState } from "react";

interface BuySellWidgetProps {
  marketId: number;
  outcomeId: number;
  outcomeName: string;
  currentPrice: number;
}

export function BuySellWidget({
  marketId,
  outcomeId,
  outcomeName,
  currentPrice,
}: BuySellWidgetProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");

  const sharesAmount = parseFloat(amount) || 0;
  const price = side === "buy" ? currentPrice : currentPrice * 0.98;
  const total = sharesAmount * price;
  const roi = side === "buy" ? ((1 / price) - 1) * 100 : (price - 1) * 100;

  const handleQuickSet = (val: number) => setAmount(val.toString());

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-6">
        <div className="flex-1 flex items-center gap-1 p-1 bg-white/[0.04] rounded-md border border-graphite">
          <button
            onClick={() => setSide("buy")}
            className={`flex-1 py-2 rounded transition-all font-medium text-caption ${
              side === "buy"
                ? "bg-cadmium-green text-true-black"
                : "text-silver-text hover:text-white"
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setSide("sell")}
            className={`flex-1 py-2 rounded transition-all font-medium text-caption ${
              side === "sell"
                ? "bg-white text-true-black"
                : "text-silver-text hover:text-white"
            }`}
          >
            Sell
          </button>
        </div>
      </div>

      {/* Order Type Tabs */}
      <div className="flex items-center gap-2 mb-4 p-1 bg-white/[0.04] rounded-md border border-graphite">
        <button
          onClick={() => setOrderType("market")}
          className={`flex-1 py-2 rounded text-caption font-medium transition-all ${
            orderType === "market"
              ? "bg-white/10 text-white"
              : "text-silver-text hover:text-white"
          }`}
        >
          Market
        </button>
        <button
          onClick={() => setOrderType("limit")}
          className={`flex-1 py-2 rounded text-caption font-medium transition-all ${
            orderType === "limit"
              ? "bg-white/10 text-white"
              : "text-silver-text hover:text-white"
          }`}
        >
          Limit
        </button>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="text-caption text-silver-text font-mono uppercase mb-2 block">
          Shares
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="input-field font-mono mb-2"
        />
        <div className="grid grid-cols-4 gap-2">
          {[50, 100, 250, 500].map((v) => (
            <button
              key={v}
              onClick={() => handleQuickSet(v)}
              className="py-1.5 rounded text-caption font-mono bg-white/[0.04] text-silver-text hover:text-white border border-graphite transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Price Display (Market) or Input (Limit) */}
      {orderType === "market" ? (
        <div className="mb-4 p-3 bg-white/[0.03] border border-graphite rounded-md">
          <p className="text-caption text-silver-text mb-1">Price</p>
          <p className="text-heading font-mono text-cadmium-green">
            {(price * 100).toFixed(1)}¢
          </p>
        </div>
      ) : (
        <div className="mb-4">
          <label className="text-caption text-silver-text font-mono uppercase mb-2 block">
            Limit Price
          </label>
          <input
            type="number"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder={`${(price * 100).toFixed(1)}¢`}
            className="input-field font-mono"
          />
        </div>
      )}

      {/* Summary */}
      <div className="space-y-2 mb-4 p-3 bg-white/[0.03] rounded-md border border-graphite">
        <div className="flex justify-between text-caption">
          <span className="text-silver-text">Total</span>
          <span className="text-white font-mono">${total.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-caption">
          <span className="text-silver-text">ROI</span>
          <span className={`font-mono ${roi > 0 ? "text-cadmium-green" : "text-white"}`}>
            {roi > 0 ? "+" : ""}{roi.toFixed(0)}%
          </span>
        </div>
        {side === "buy" && (
          <div className="flex justify-between text-caption">
            <span className="text-silver-text">Potential Payout</span>
            <span className="text-cadmium-green font-mono">
              ${(sharesAmount / price).toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Submit Button */}
      <button
        disabled={sharesAmount === 0}
        className={`w-full py-3 rounded-md font-mono font-medium text-caption transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
          side === "buy"
            ? "bg-cadmium-green text-true-black hover:bg-cadmium-green/90"
            : "bg-white text-true-black hover:bg-white/90"
        }`}
      >
        {side === "buy" ? "Buy" : "Sell"} {sharesAmount.toFixed(0)} @ {(price * 100).toFixed(1)}¢
      </button>

      <p className="text-caption text-silver-text text-center mt-3">
        Settlement: Instant on Solana
      </p>
    </div>
  );
}

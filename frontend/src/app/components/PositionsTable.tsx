"use client";

import Link from "next/link";
import type { MyPosition } from "@/lib/types";

export function PositionsTable({ positions }: { positions: MyPosition[] }) {
  return (
    <div className="table-container overflow-x-auto">
      <div className="grid min-w-full" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 100px" }}>
        <div className="table-header">Market</div>
        <div className="table-header">Outcome</div>
        <div className="table-header">Shares</div>
        <div className="table-header">Avg Cost</div>
        <div className="table-header">Current</div>
        <div className="table-header">P&L</div>
        <div className="table-header text-right pr-4">Action</div>
      </div>

      {positions.map((position) => {
        const pnlColor = position.pnl >= 0 ? "text-cadmium-green" : "text-red-400";
        const gainLossAmount = position.value - position.cost;
        const gainLossPct = position.pnl_pct;

        return (
          <Link
            key={position.market_id}
            href={`/trade?market=${position.market_id}`}
            className="grid min-w-full table-row hover:bg-white/[0.02]"
            style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 100px" }}
          >
            <div className="table-cell">
              <div className="text-white font-medium truncate">{position.market_title}</div>
              <div className="text-caption text-silver-text mt-0.5">
                Epoch #{position.epoch_id} · {position.market_mode === "Trading" ? "LMSR" : "Fixed"}
              </div>
            </div>

            <div className="table-cell">
              <span className={`font-mono text-caption ${
                position.outcome_id === 0 ? "text-cadmium-green" : "text-white"
              }`}>
                {position.outcome_label}
              </span>
            </div>

            <div className="table-cell font-mono text-white">
              {position.shares.toLocaleString()}
            </div>

            <div className="table-cell font-mono text-silver-text">
              {(position.avg_price * 100).toFixed(1)}¢
            </div>

            <div className="table-cell font-mono text-white">
              {(position.current_price * 100).toFixed(1)}¢
            </div>

            <div className={`table-cell font-mono ${pnlColor}`}>
              <div>{position.pnl >= 0 ? "+" : ""}{position.pnl.toFixed(2)} SOL</div>
              <div className="text-caption opacity-75">
                {position.pnl_pct >= 0 ? "+" : ""}{position.pnl_pct.toFixed(1)}%
              </div>
            </div>

            <div className="table-cell flex justify-end pr-4">
              <button className="btn-secondary text-caption px-3 py-1.5">
                Trade →
              </button>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

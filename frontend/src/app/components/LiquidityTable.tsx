"use client";

import type { LPEpochPosition } from "@/lib/types";

export function LiquidityTable({ lpEpochs }: { lpEpochs: LPEpochPosition[] }) {
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="table-container overflow-x-auto">
      <div className="grid min-w-full" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr 100px" }}>
        <div className="table-header">Epoch</div>
        <div className="table-header">Status</div>
        <div className="table-header">Deposited</div>
        <div className="table-header">Current Value</div>
        <div className="table-header">Fees Earned</div>
        <div className="table-header">APY</div>
        <div className="table-header text-right pr-4">P&L %</div>
      </div>

      {lpEpochs.map((lp) => {
        const statusColor =
          lp.status === "Active"
            ? "badge-live"
            : lp.status === "Withdrawn"
              ? "badge-closed"
              : "badge-settled";

        return (
          <div
            key={lp.epoch_id}
            className="grid min-w-full table-row"
            style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr 100px" }}
          >
            <div className="table-cell">
              <span className="font-mono text-white">Epoch #{lp.epoch_id}</span>
            </div>

            <div className="table-cell">
              <span className={`badge ${statusColor}`}>{lp.status}</span>
            </div>

            <div className="table-cell">
              <div className="text-white font-mono">{lp.deposited_sol.toFixed(2)} SOL</div>
              <div className="text-caption text-silver-text mt-0.5">
                {lp.entry_date ? new Date(lp.entry_date * 1000).toLocaleDateString() : "—"}
              </div>
            </div>

            <div className="table-cell font-mono text-cadmium-green">
              {lp.current_value_sol.toFixed(2)} SOL
            </div>

            <div className="table-cell">
              <span className="font-mono text-cadmium-green">
                +{lp.fees_earned_sol.toFixed(2)} SOL
              </span>
            </div>

            <div className="table-cell">
              <span className="font-mono text-white">{lp.apy.toFixed(1)}%</span>
            </div>

            <div className={`table-cell font-mono text-right pr-4 ${
              lp.pnl_pct >= 0 ? "text-cadmium-green" : "text-red-400"
            }`}>
              {lp.pnl_pct >= 0 ? "+" : ""}{lp.pnl_pct.toFixed(2)}%
            </div>
          </div>
        );
      })}

      {/* Summary row */}
      <div className="grid min-w-full table-row bg-white/[0.06] border-t-2 border-graphite font-mono" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr 100px" }}>
        <div className="table-cell text-white font-medium">Total</div>
        <div className="table-cell" />
        <div className="table-cell text-white font-medium">
          {lpEpochs.reduce((s, e) => s + e.deposited_sol, 0).toFixed(2)} SOL
        </div>
        <div className="table-cell text-cadmium-green font-medium">
          {lpEpochs.reduce((s, e) => s + e.current_value_sol, 0).toFixed(2)} SOL
        </div>
        <div className="table-cell text-cadmium-green font-medium">
          +{lpEpochs.reduce((s, e) => s + e.fees_earned_sol, 0).toFixed(2)} SOL
        </div>
        <div className="table-cell text-white font-medium">
          {(lpEpochs.reduce((s, e) => s + e.apy, 0) / lpEpochs.length).toFixed(1)}%
        </div>
        <div className="table-cell text-cadmium-green font-medium text-right pr-4">
          +{((lpEpochs.reduce((s, e) => s + e.pnl_pct, 0) / lpEpochs.length) || 0).toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

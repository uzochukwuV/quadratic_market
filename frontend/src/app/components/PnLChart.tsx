"use client";

import type { PnLPoint } from "@/lib/types";

export function PnLChart({ data }: { data: PnLPoint[] }) {
  if (data.length === 0) return null;

  const minPnL = Math.min(...data.map((p) => p.cumulative_pnl));
  const maxPnL = Math.max(...data.map((p) => p.cumulative_pnl));
  const range = maxPnL - minPnL || 1;
  const chartHeight = 200;

  return (
    <div className="flex flex-col h-64">
      {/* Chart Area */}
      <div className="flex-1 relative">
        <svg width="100%" height="100%" className="overflow-visible">
          {/* Grid lines */}
          <defs>
            <linearGradient id="pnlGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#faff00" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#faff00" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Y-axis grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((y) => (
            <line
              key={`grid-${y}`}
              x1="0"
              y1={`${y * 100}%`}
              x2="100%"
              y2={`${y * 100}%`}
              stroke="currentColor"
              strokeWidth="0.5"
              opacity="0.1"
              className="text-graphite"
            />
          ))}

          {/* Area chart path */}
          <polyline
            points={data
              .map((point, idx) => {
                const x = (idx / (data.length - 1)) * 100;
                const y = ((maxPnL - point.cumulative_pnl) / range) * 100;
                return `${x},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-cadmium-green"
          />

          {/* Area fill */}
          <polygon
            points={`0,0 ${data
              .map((point, idx) => {
                const x = (idx / (data.length - 1)) * 100;
                const y = ((maxPnL - point.cumulative_pnl) / range) * 100;
                return `${x},${y}`;
              })
              .join(" ")} 100,0`}
            fill="url(#pnlGradient)"
          />
        </svg>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-4 gap-2 pt-4 border-t border-graphite">
        <div>
          <p className="text-caption text-silver-text mb-0.5">Start</p>
          <p className="text-body font-mono text-white">${minPnL.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-caption text-silver-text mb-0.5">Min</p>
          <p className="text-body font-mono text-white">${minPnL.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-caption text-silver-text mb-0.5">Max</p>
          <p className="text-body font-mono text-cadmium-green">${maxPnL.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-caption text-silver-text mb-0.5">Current</p>
          <p className="text-body font-mono text-cadmium-green">
            ${data[data.length - 1].cumulative_pnl.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}

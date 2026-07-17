"use client";

import type { UiLimitOrderAccount } from "@/lib/contract";

export function OrderBook({
  marketId,
  orders,
}: {
  marketId: number;
  orders?: UiLimitOrderAccount[];
}) {
  const sourceOrders = orders ?? [];
  const sells = sourceOrders.filter((o) => o.market_id === marketId && o.side === "Sell");
  const buys = sourceOrders.filter((o) => o.market_id === marketId && o.side === "Buy");

  if (sells.length === 0 && buys.length === 0) {
    return (
      <div className="h-96 flex flex-col items-center justify-center text-center border border-graphite rounded-md bg-white/[0.02] px-6">
        <p className="text-white mb-2">Order book not loaded</p>
        <p className="text-caption text-silver-text max-w-sm">
          The frontend is connected to chain state, but there are no limit orders returned yet for market #{marketId}.
        </p>
      </div>
    );
  }

  const maxSize = Math.max(...sells.map((s) => s.num_shares), ...buys.map((b) => b.num_shares), 1);

  return (
    <div className="grid grid-cols-2 gap-4 h-96">
      {/* Sell Orders */}
      <div className="flex flex-col">
        <h4 className="text-caption font-mono text-silver-text uppercase mb-3">Sell Orders</h4>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {sells.map((order) => (
            <div key={order.order_id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-caption font-mono text-silver-text">
                    {order.num_shares.toLocaleString()}
                  </span>
                  <span className="text-caption font-mono text-white">{(order.price_per_share * 100).toFixed(1)}¢</span>
                </div>
                <div
                  className="h-1.5 bg-red-400/40 rounded-full"
                  style={{ width: `${(order.num_shares / maxSize) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Buy Orders */}
      <div className="flex flex-col">
        <h4 className="text-caption font-mono text-silver-text uppercase mb-3">Buy Orders</h4>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {buys.map((order) => (
            <div key={order.order_id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-caption font-mono text-silver-text">
                    {order.num_shares.toLocaleString()}
                  </span>
                  <span className="text-caption font-mono text-cadmium-green">{(order.price_per_share * 100).toFixed(1)}¢</span>
                </div>
                <div
                  className="h-1.5 bg-cadmium-green/40 rounded-full"
                  style={{ width: `${(order.num_shares / maxSize) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

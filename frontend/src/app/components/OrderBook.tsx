"use client";

import { ORDER_BOOK_SELLS, ORDER_BOOK_BUYS } from "@/lib/mockData";

export function OrderBook({ marketId }: { marketId: number }) {
  const sells = ORDER_BOOK_SELLS.filter((o) => o.market_id === marketId);
  const buys = ORDER_BOOK_BUYS.filter((o) => o.market_id === marketId);

  const maxSize = Math.max(...sells.map((s) => s.num_shares), ...buys.map((b) => b.num_shares));

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

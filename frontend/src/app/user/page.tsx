"use client";

export default function UserPage() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-6">
          <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-1">Account</p>
          <h1 className="text-heading text-white font-medium">Profile</h1>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Wallet Info */}
          <div className="card">
            <h3 className="text-subheading text-white font-medium mb-4">Connected Wallet</h3>
            <div className="bg-dark-granite rounded-md p-4 mb-4">
              <p className="text-caption text-silver-text font-mono uppercase mb-1">Address</p>
              <p className="text-body font-mono text-white truncate">7xKp...wQ2x</p>
            </div>
            <div className="space-y-3">
              {[
                { label: "Total Trades", value: "47" },
                { label: "Markets Traded", value: "12" },
                { label: "First Trade", value: "Mar 15, 2024" },
              ].map((item) => (
                <div key={item.label} className="flex justify-between text-body border-b border-graphite pb-2">
                  <span className="text-silver-text">{item.label}</span>
                  <span className="font-mono text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Trading History */}
          <div className="card">
            <h3 className="text-subheading text-white font-medium mb-4">Trading History</h3>
            <div className="table-container">
              <div className="table-header grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <div>Date</div><div>Action</div><div>Amount</div>
              </div>
              {[
                { date: "May 23", action: "Buy YES", amount: "$24.50" },
                { date: "May 22", action: "Sell NO", amount: "+$18.00" },
                { date: "May 21", action: "Buy NO", amount: "$35.00" },
              ].map((trade, i) => (
                <div key={i} className="grid table-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  <div className="table-cell font-mono text-silver-text">{trade.date}</div>
                  <div className="table-cell font-mono">{trade.action}</div>
                  <div className="table-cell font-mono text-cadmium-green">{trade.amount}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

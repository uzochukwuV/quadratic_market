"use client";

export default function LiquidityPage() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-6">
          <p className="font-mono text-caption text-silver-text uppercase tracking-widest mb-1">Earn</p>
          <h1 className="text-heading text-white font-medium">Provide Liquidity</h1>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Your Position */}
          <div className="card">
            <h3 className="text-subheading text-white font-medium mb-4">Your Position</h3>
            <div className="space-y-4">
              {[
                { label: "LP Tokens", value: "1,234.56", sub: "$1,234.56 value" },
                { label: "Unclaimed Fees", value: "+$45.67", sub: "Ready to claim" },
                { label: "Total P&L", value: "+$234.56", sub: "+18.9% return" },
              ].map((item) => (
                <div key={item.label} className="bg-dark-granite rounded-md p-4">
                  <p className="text-caption text-silver-text font-mono uppercase mb-1">{item.label}</p>
                  <p className="text-heading text-cadmium-green font-mono">{item.value}</p>
                  <p className="text-caption text-silver-text mt-1">{item.sub}</p>
                </div>
              ))}
            </div>
            <button className="btn-primary w-full mt-4">Claim Fees</button>
          </div>

          {/* Add Liquidity */}
          <div className="card">
            <h3 className="text-subheading text-white font-medium mb-4">Add Liquidity</h3>
            <div className="space-y-4">
              <div>
                <label className="text-caption text-silver-text font-mono uppercase mb-2 block">Amount</label>
                <input type="number" placeholder="0.00" className="input-field font-mono" />
              </div>
              <div className="bg-dark-granite rounded-md p-4 text-body text-silver-text">
                You will receive LP tokens representing your share of the pool.
              </div>
              <button className="btn-primary w-full">Add Liquidity</button>
            </div>
          </div>

          {/* Pool Stats */}
          <div className="card">
            <h3 className="text-subheading text-white font-medium mb-4">Pool Stats</h3>
            <div className="space-y-3">
              {[
                { label: "Total Liquidity", value: "$2.4M" },
                { label: "24h Volume", value: "$124K" },
                { label: "APY", value: "24.5%" },
                { label: "Your Share", value: "0.5%" },
              ].map((item) => (
                <div key={item.label} className="flex justify-between text-body border-b border-graphite pb-2">
                  <span className="text-silver-text">{item.label}</span>
                  <span className="font-mono text-cadmium-green">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

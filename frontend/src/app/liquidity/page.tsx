"use client";

import { useState } from "react";
import { EPOCHS, MY_PENDING_LIQUIDITY, MY_WITHDRAWAL_REQUEST } from "@/lib/mockData";

const now = Math.floor(Date.now() / 1000);

function formatCountdown(ts: number): string {
  const diff = ts - now;
  if (diff <= 0) return "Ready";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m`;
}

function EpochLiquidityRow({ epoch }: { epoch: typeof EPOCHS[0] }) {
  const isActive = now >= epoch.start_time && now < epoch.end_time;
  const isClosed = epoch.all_markets_settled;
  const poolSOL = epoch.total_liquidity_added / 1e9;
  const withdrawnSOL = epoch.total_liquidity_removed / 1e9;
  const netSOL = poolSOL - withdrawnSOL;
  const settledPct = epoch.num_markets > 0 ? (epoch.num_settled_markets / epoch.num_markets) * 100 : 0;

  return (
    <div className="glass-card rounded-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            isActive ? "bg-[#a0e0ab] animate-pulse" : isClosed ? "bg-whisper-gray" : "bg-[#ffac2e]"
          }`} />
          <div>
            <h3 className="text-[15px] font-semibold text-white">Epoch #{epoch.epoch_id}</h3>
            <p className="text-[11px] text-whisper-gray mt-0.5">
              {new Date(epoch.start_time * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {" → "}
              {new Date(epoch.end_time * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {isActive && <span className="text-[10px] px-2 py-0.5 rounded-pill border border-[#a0e0ab]/30 text-[#a0e0ab] bg-[#a0e0ab]/[0.07]">Active</span>}
          {epoch.withdrawals_enabled && <span className="text-[10px] px-2 py-0.5 rounded-pill border border-[#5bc8fa]/30 text-[#5bc8fa] bg-[#5bc8fa]/[0.07]">Withdrawals Open</span>}
          {isClosed && !isActive && <span className="text-[10px] px-2 py-0.5 rounded-pill border border-white/10 text-whisper-gray bg-white/[0.03]">Settled</span>}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {[
          { label: "Pool Size", value: `${poolSOL.toFixed(1)} SOL` },
          { label: "Net LP Value", value: `${netSOL.toFixed(1)} SOL`, color: netSOL >= poolSOL ? "text-[#a0e0ab]" : "text-white" },
          { label: "Markets", value: `${epoch.num_settled_markets}/${epoch.num_markets}` },
          { label: "LP Shares", value: epoch.lp_shares_at_close > 0 ? (epoch.lp_shares_at_close / 1e6).toFixed(2) + "M" : "Live" },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-[10px] text-whisper-gray uppercase tracking-wide mb-0.5">{s.label}</p>
            <p className={`text-[16px] font-semibold ${s.color ?? "text-white"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Settlement progress */}
      <div>
        <div className="flex justify-between text-[11px] text-whisper-gray mb-1.5">
          <span>Markets settled</span>
          <span>{epoch.num_settled_markets}/{epoch.num_markets}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
          <div className="h-full rounded-full bg-deep-ocean transition-all duration-1000"
            style={{ width: `${settledPct}%`, backgroundImage: "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46))" }} />
        </div>
        {!isClosed && epoch.withdrawals_enabled === false && (
          <p className="text-[11px] text-whisper-gray mt-1.5">
            {epoch.num_markets - epoch.num_settled_markets} markets remaining before LP withdrawals unlock
          </p>
        )}
      </div>
    </div>
  );
}

export default function LiquidityPage() {
  const [tab, setTab] = useState<"add" | "pending" | "withdraw" | "epochs">("add");
  const [amount, setAmount] = useState("10");
  const currentEpoch = EPOCHS[0];

  const poolSOL = currentEpoch.total_liquidity_added / 1e9;
  const myShareOfPool = (parseFloat(amount) || 0) / poolSOL * 100;

  // Pending liquidity status
  const pendingActivated = now >= MY_PENDING_LIQUIDITY.activation_time;
  const pendingCountdown = formatCountdown(MY_PENDING_LIQUIDITY.activation_time);
  const pendingPct = Math.min(100, Math.max(0,
    ((now - (MY_PENDING_LIQUIDITY.activation_time - 2 * 86400)) / (2 * 86400)) * 100
  ));

  // Withdrawal cooldown
  const cooldownDone = now >= MY_WITHDRAWAL_REQUEST.cooldown_end;
  const cooldownPct = Math.min(100, Math.max(0,
    ((now - MY_WITHDRAWAL_REQUEST.requested_at) / (MY_WITHDRAWAL_REQUEST.cooldown_end - MY_WITHDRAWAL_REQUEST.requested_at)) * 100
  ));
  const withdrawCountdown = formatCountdown(MY_WITHDRAWAL_REQUEST.cooldown_end);

  return (
    <div className="min-h-screen">
      <div className="h-[2px]" style={{ background: "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46) 50%, rgb(165,45,37))" }} />

      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ background: "linear-gradient(135deg, rgb(160,224,171), rgb(255,172,46) 50%, rgb(165,45,37))" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
        <div className="relative max-w-[1078px] mx-auto px-6 py-12">
          <p className="text-[12px] text-whisper-gray uppercase tracking-widest mb-2">Epoch-Based</p>
          <h1 className="text-[45px] font-semibold text-white leading-tight">Liquidity</h1>
          <p className="text-[15px] text-whisper-gray mt-2 max-w-lg">
            Provide liquidity per epoch. Earn fees from all markets in that epoch. Withdraw after all markets settle.
          </p>
        </div>
      </div>

      <div className="max-w-[1078px] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-[14px]">
          {/* ── Left ── */}
          <div className="space-y-[14px]">
            {/* Current epoch overview */}
            <div className="glass-card rounded-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[14px] font-semibold text-white">Current Epoch #{currentEpoch.epoch_id}</h3>
                <span className="text-[11px] text-[#a0e0ab] font-semibold px-2.5 py-1 rounded-pill bg-[#a0e0ab]/[0.08] border border-[#a0e0ab]/25">
                  Active
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Pool Size", value: `${poolSOL.toFixed(1)} SOL` },
                  { label: "Markets", value: `${currentEpoch.num_markets} total` },
                  { label: "Settled", value: `${currentEpoch.num_settled_markets}/${currentEpoch.num_markets}` },
                  { label: "Est. APY", value: "18.4%", color: "text-[#a0e0ab]" },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-[10px] text-whisper-gray uppercase tracking-wide mb-0.5">{s.label}</p>
                    <p className={`text-[18px] font-semibold ${s.color ?? "text-white"}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div className="glass-card rounded-card overflow-hidden">
              <div className="flex border-b border-white/[0.06]">
                {([
                  { key: "add", label: "Add Liquidity" },
                  { key: "pending", label: "Pending" },
                  { key: "withdraw", label: "Withdraw" },
                  { key: "epochs", label: "All Epochs" },
                ] as const).map((t) => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`flex-1 py-3.5 text-[12px] font-semibold transition-colors whitespace-nowrap ${
                      tab === t.key ? "text-white border-b-2 border-white -mb-px" : "text-whisper-gray hover:text-white"
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-6">
                {/* ── Add Liquidity ── */}
                {tab === "add" && (
                  <div className="space-y-5">
                    <div className="p-4 rounded-card bg-[#a0e0ab]/[0.04] border border-[#a0e0ab]/15">
                      <p className="text-[12px] text-[#a0e0ab] font-semibold mb-1">Epoch #{currentEpoch.epoch_id} Pool</p>
                      <p className="text-[12px] text-whisper-gray leading-relaxed">
                        Deposits activate after a short delay. LP shares are minted immediately and count toward total supply — but can't be withdrawn until your activation_time passes and all epoch markets settle.
                      </p>
                    </div>

                    <div>
                      <label className="text-[12px] text-whisper-gray mb-2 block">Amount (SOL)</label>
                      <div className="relative">
                        <input type="number" min="0.01" step="0.01" value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="w-full px-4 py-3 pr-16 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[16px] focus:outline-none focus:border-white/20 transition-all" />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-whisper-gray font-semibold">SOL</span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        {["1", "5", "10", "50"].map((v) => (
                          <button key={v} onClick={() => setAmount(v)}
                            className={`flex-1 py-1.5 rounded text-[12px] border transition-colors ${
                              amount === v ? "border-white/30 text-white" : "border-white/[0.08] text-whisper-gray hover:text-white"
                            }`}>{v}</button>
                        ))}
                      </div>
                    </div>

                    <div className="glass-card rounded-card p-4 space-y-2.5">
                      {[
                        { label: "Your pool share", value: `${myShareOfPool.toFixed(3)}%` },
                        { label: "Activation delay", value: "~48 hours" },
                        { label: "Fee rate", value: "0.5% per trade" },
                        { label: "Est. APY", value: "18.4%", green: true },
                        { label: "Withdraw locked until", value: "All epoch markets settle" },
                      ].map((r) => (
                        <div key={r.label} className="flex justify-between text-[13px]">
                          <span className="text-whisper-gray">{r.label}</span>
                          <span className={r.green ? "text-[#a0e0ab] font-semibold" : "text-white"}>{r.value}</span>
                        </div>
                      ))}
                    </div>

                    <button className="w-full py-4 rounded-pill bg-white text-black text-[15px] font-semibold hover:bg-white/90 transition-all hover:scale-[1.01]">
                      Add {amount} SOL to Epoch #{currentEpoch.epoch_id}
                    </button>
                  </div>
                )}

                {/* ── Pending Liquidity ── */}
                {tab === "pending" && (
                  <div className="space-y-5">
                    <div className="p-5 rounded-card bg-white/[0.03] border border-white/[0.07]">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-[13px] font-semibold text-white mb-0.5">Pending LP Shares</p>
                          <p className="text-[11px] text-whisper-gray">Deposited {(MY_PENDING_LIQUIDITY.amount_deposited / 1e9).toFixed(2)} SOL</p>
                        </div>
                        <span className={`text-[11px] px-2.5 py-1 rounded-pill border font-semibold ${
                          pendingActivated
                            ? "border-[#a0e0ab]/30 text-[#a0e0ab] bg-[#a0e0ab]/[0.08]"
                            : "border-[#ffac2e]/30 text-[#ffac2e] bg-[#ffac2e]/[0.08]"
                        }`}>
                          {pendingActivated ? "Ready to Activate" : `Activates in ${pendingCountdown}`}
                        </span>
                      </div>

                      {/* Countdown progress */}
                      <div className="mb-4">
                        <div className="flex justify-between text-[11px] text-whisper-gray mb-1.5">
                          <span>Activation progress</span>
                          <span className="font-mono">{pendingActivated ? "Done" : pendingCountdown}</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{
                              width: `${pendingPct}%`,
                              background: pendingActivated
                                ? "linear-gradient(90deg, rgb(160,224,171), rgb(160,224,171))"
                                : "linear-gradient(90deg, rgb(255,172,46), rgb(160,224,171))",
                            }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-[12px]">
                        <div>
                          <p className="text-whisper-gray mb-0.5">Shares minted</p>
                          <p className="text-white font-semibold">{(MY_PENDING_LIQUIDITY.shares / 1e6).toFixed(2)}M</p>
                        </div>
                        <div>
                          <p className="text-whisper-gray mb-0.5">Activation time</p>
                          <p className="text-white font-semibold">
                            {new Date(MY_PENDING_LIQUIDITY.activation_time * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    </div>

                    <button
                      disabled={!pendingActivated}
                      className="w-full py-4 rounded-pill bg-[#a0e0ab] text-black text-[15px] font-semibold hover:bg-[#8dd4a0] transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                      {pendingActivated ? "Activate LP Shares" : `Activates in ${pendingCountdown}`}
                    </button>

                    <p className="text-[12px] text-whisper-gray text-center leading-relaxed">
                      Shares are counted toward the pool immediately but the activation delay protects against flash liquidity attacks.
                    </p>
                  </div>
                )}

                {/* ── Withdraw ── */}
                {tab === "withdraw" && (
                  <div className="space-y-5">
                    {/* Existing withdrawal request */}
                    <div className="p-5 rounded-card bg-white/[0.03] border border-white/[0.07]">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-[13px] font-semibold text-white mb-0.5">Pending Withdrawal</p>
                          <p className="text-[11px] text-whisper-gray">
                            Requested {new Date(MY_WITHDRAWAL_REQUEST.requested_at * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        <span className={`text-[11px] px-2.5 py-1 rounded-pill border font-semibold ${
                          cooldownDone
                            ? "border-[#a0e0ab]/30 text-[#a0e0ab] bg-[#a0e0ab]/[0.08]"
                            : "border-[#ffac2e]/30 text-[#ffac2e] bg-[#ffac2e]/[0.08]"
                        }`}>
                          {cooldownDone ? "Ready" : `${withdrawCountdown} remaining`}
                        </span>
                      </div>

                      {/* Cooldown progress */}
                      <div className="mb-4">
                        <div className="flex justify-between text-[11px] text-whisper-gray mb-1.5">
                          <span>Cooldown progress</span>
                          <span className="font-mono">{cooldownPct.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-1000"
                            style={{
                              width: `${cooldownPct}%`,
                              background: cooldownDone
                                ? "rgb(160,224,171)"
                                : "linear-gradient(90deg, rgb(255,172,46), rgb(160,224,171))",
                            }} />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 text-[12px]">
                        <div>
                          <p className="text-whisper-gray mb-0.5">Shares</p>
                          <p className="text-white font-semibold">{(MY_WITHDRAWAL_REQUEST.shares / 1e6).toFixed(2)}M</p>
                        </div>
                        <div>
                          <p className="text-whisper-gray mb-0.5">NAV at request</p>
                          <p className="text-white font-semibold">{(MY_WITHDRAWAL_REQUEST.nav_snapshot / 1e9).toFixed(1)} SOL</p>
                        </div>
                        <div>
                          <p className="text-whisper-gray mb-0.5">Share price</p>
                          <p className="text-white font-semibold">{(MY_WITHDRAWAL_REQUEST.share_price_snapshot / 2 ** 32).toFixed(4)} SOL</p>
                        </div>
                      </div>
                    </div>

                    <button
                      disabled={!cooldownDone}
                      className="w-full py-4 rounded-pill bg-[#a0e0ab] text-black text-[15px] font-semibold hover:bg-[#8dd4a0] transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                      {cooldownDone ? "Process Withdrawal" : `Cooldown ends in ${withdrawCountdown}`}
                    </button>

                    <div className="h-px bg-white/[0.06]" />

                    {/* Request new withdrawal */}
                    <div>
                      <p className="text-[13px] font-semibold text-white mb-3">Request New Withdrawal</p>
                      <div className="p-3 rounded-lg bg-[#ffac2e]/[0.06] border border-[#ffac2e]/20 mb-4">
                        <p className="text-[12px] text-[#ffac2e]">
                          ⚠ Withdrawals are only processed after all markets in your epoch settle. The cooldown prevents price manipulation.
                        </p>
                      </div>
                      <input type="number" placeholder="Shares to withdraw"
                        className="w-full px-4 py-3 rounded-card bg-white/[0.04] border border-white/[0.08] text-white text-[15px] focus:outline-none focus:border-white/20 transition-all mb-3" />
                      <button className="w-full py-3.5 rounded-pill border border-white/[0.15] text-white text-[14px] font-semibold hover:bg-white/[0.06] transition-all">
                        Request Withdrawal
                      </button>
                    </div>
                  </div>
                )}

                {/* ── All Epochs ── */}
                {tab === "epochs" && (
                  <div className="space-y-4">
                    {EPOCHS.map((epoch) => (
                      <EpochLiquidityRow key={epoch.epoch_id} epoch={epoch} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Right ── */}
          <div className="space-y-[14px]">
            {/* My LP position summary */}
            <div className="glass-card rounded-card p-5">
              <h3 className="text-[13px] font-semibold text-white mb-4">My LP Summary</h3>
              <div className="space-y-3">
                {[
                  { label: "Active shares", value: "1.25M LP", color: "text-white" },
                  { label: "Pending shares", value: `${(MY_PENDING_LIQUIDITY.shares / 1e6).toFixed(2)}M LP`, color: "text-[#ffac2e]" },
                  { label: "Total deposited", value: "15.0 SOL", color: "text-white" },
                  { label: "Current value (est.)", value: "15.8 SOL", color: "text-[#a0e0ab]" },
                  { label: "Fees earned", value: "0.8 SOL", color: "text-[#a0e0ab]" },
                  { label: "Pending withdrawal", value: `${(MY_WITHDRAWAL_REQUEST.shares / 1e6).toFixed(2)}M shares`, color: "text-[#5bc8fa]" },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between text-[13px]">
                    <span className="text-whisper-gray">{r.label}</span>
                    <span className={`font-semibold ${r.color}`}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* How epochs work */}
            <div className="glass-card rounded-card p-5">
              <h3 className="text-[13px] font-semibold text-white mb-4">Epoch LP Lifecycle</h3>
              <div className="space-y-4">
                {[
                  { icon: "💧", step: "Deposit", desc: "Add SOL to the current epoch pool. LP shares minted instantly, pending activation." },
                  { icon: "⏳", step: "Activation Delay", desc: "~48h lock prevents flash liquidity attacks. Shares count toward pool supply immediately." },
                  { icon: "💸", step: "Earn Fees", desc: "0.5% fee on every buy/sell across all epoch markets. Distributed pro-rata to LP shares." },
                  { icon: "🔓", step: "Withdrawal Unlocks", desc: "After all epoch markets settle, withdrawals_enabled = true. Cooldown period applies to each request." },
                  { icon: "🏦", step: "Claim", desc: "Process your withdrawal request after cooldown. Receive SOL at the NAV share price snapshot." },
                ].map((s) => (
                  <div key={s.step} className="flex gap-3">
                    <span className="text-[18px] flex-shrink-0">{s.icon}</span>
                    <div>
                      <p className="text-[13px] font-semibold text-white">{s.step}</p>
                      <p className="text-[12px] text-whisper-gray leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
